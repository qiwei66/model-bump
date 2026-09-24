// Mock Claude Opus 5.5 responses: every response starts with a thinking block,
// exactly like the real model, so code that reads content[0].text breaks here
// the same way it will break in production.

import crypto from 'node:crypto';

const rid = (prefix) => `${prefix}${crypto.randomBytes(12).toString('hex')}`;

export function newState() {
  return { issuedTools: new Map(), requests: 0 };
}

/** Produce a minimal value that satisfies a JSON Schema (best effort). */
export function sampleFromSchema(schema, root = schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 8) return null;
  if (schema.$ref) {
    const m = String(schema.$ref).match(/^#\/(\$defs|definitions)\/(.+)$/);
    return m && root[m[1]] ? sampleFromSchema(root[m[1]][m[2]], root, depth + 1) : null;
  }
  if ('const' in schema) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if ('default' in schema) return schema.default;
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(schema[key]) && schema[key].length) {
      const pick = schema[key].find((s) => s && s.type !== 'null') || schema[key][0];
      return sampleFromSchema(pick, root, depth + 1);
    }
  }
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  switch (type || (schema.properties ? 'object' : undefined)) {
    case 'object': {
      const o = {};
      for (const [k, v] of Object.entries(schema.properties || {})) o[k] = sampleFromSchema(v, root, depth + 1);
      return o;
    }
    case 'array': {
      const n = Math.max(1, schema.minItems || 0);
      return Array.from({ length: n }, () => sampleFromSchema(schema.items || {}, root, depth + 1));
    }
    case 'string':
      if (schema.format === 'date') return '2026-09-22';
      if (schema.format === 'date-time') return '2026-09-22T00:00:00Z';
      if (schema.format === 'email') return 'probe@example.com';
      if (schema.format === 'uri') return 'https://example.com';
      return 'model-bump';
    case 'integer':
      return schema.minimum != null ? Math.ceil(schema.minimum) : 0;
    case 'number':
      return schema.minimum != null ? schema.minimum : 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return 'model-bump';
  }
}

const estimateTokens = (body) => Math.max(1, Math.ceil(JSON.stringify(body.messages || []).length / 4));

/**
 * Check that thinking blocks this mock issued alongside tool_use blocks come
 * back complete and unmodified (what the real API enforces in tool loops).
 */
export function checkPreservedThinking(body, state) {
  const out = [];
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  msgs.forEach((msg, i) => {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return;
    for (const block of msg.content) {
      if (block.type !== 'tool_use' || !state.issuedTools.has(block.id)) continue;
      const issued = state.issuedTools.get(block.id);
      const th = msg.content.find((b) => b.type === 'thinking' && b.signature === issued.signature);
      if (!th) {
        out.push({
          id: 'thinking-dropped',
          severity: 'error',
          title: `messages[${i}]: the thinking block returned with tool_use "${block.name}" was dropped before sending the tool result`,
          apiMessage: `messages.${i}.content: thinking blocks from the previous assistant turn must be passed back unmodified with tool results.`,
          fix: 'Echo the assistant message exactly as received (all blocks, same order) when you append tool results. Do not filter content blocks by type.',
          doc: 'https://platform.claude.com/docs/en/build-with-claude/thinking#preserving-thinking-blocks',
        });
      } else if (th.thinking !== issued.thinking) {
        out.push({
          id: 'thinking-modified',
          severity: 'error',
          title: `messages[${i}]: a thinking block was edited before being sent back`,
          apiMessage: `messages.${i}.content: thinking blocks cannot be modified.`,
          fix: 'Pass thinking blocks back byte-for-byte, including empty `thinking` fields.',
          doc: 'https://platform.claude.com/docs/en/build-with-claude/thinking#preserving-thinking-blocks',
        });
      }
    }
  });
  return out;
}

export function buildMessage(body, { simulateTools = false } = {}, state) {
  const display = body.thinking && body.thinking.display;
  const signature = rid('mb_sig_');
  const thinkingText = display === 'summarized' || display === 'updates' ? 'model-bump probe: placeholder thinking summary.' : '';
  const content = [{ type: 'thinking', thinking: thinkingText, signature }];

  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const last = msgs[msgs.length - 1];
  const lastIsToolResult = last && Array.isArray(last.content) && last.content.some((b) => b && b.type === 'tool_result');
  const customTools = (Array.isArray(body.tools) ? body.tools : []).filter((t) => t && t.input_schema);
  let stopReason = 'end_turn';

  const fmt = (body.output_config && body.output_config.format) || body.output_format;
  if (simulateTools && customTools.length && !lastIsToolResult && !(body.tool_choice && body.tool_choice.type === 'none')) {
    const tool = customTools[0];
    const id = rid('toolu_mb_');
    content.push({ type: 'tool_use', id, name: tool.name, input: sampleFromSchema(tool.input_schema) || {} });
    state.issuedTools.set(id, { signature, thinking: thinkingText });
    stopReason = 'tool_use';
  } else if (fmt && fmt.type === 'json_schema' && fmt.schema) {
    content.push({ type: 'text', text: JSON.stringify(sampleFromSchema(fmt.schema)) });
  } else {
    content.push({ type: 'text', text: 'model-bump probe: mock Claude Opus 5.5 response. This request passed the Opus 5.5 checks.' });
  }

  const outputTokens = 24;
  return {
    id: rid('msg_mb_'),
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: estimateTokens(body), output_tokens: outputTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}

/** Server-sent events for a complete message, in Messages API streaming order. */
export function toSSE(message) {
  const ev = [];
  const push = (type, data) => ev.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  push('message_start', {
    message: { ...message, content: [], stop_reason: null, stop_sequence: null, usage: { ...message.usage, output_tokens: 1 } },
  });
  message.content.forEach((block, index) => {
    if (block.type === 'thinking') {
      push('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      if (block.thinking) push('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: block.thinking } });
      push('content_block_delta', { index, delta: { type: 'signature_delta', signature: block.signature } });
    } else if (block.type === 'text') {
      push('content_block_start', { index, content_block: { type: 'text', text: '' } });
      push('content_block_delta', { index, delta: { type: 'text_delta', text: block.text } });
    } else if (block.type === 'tool_use') {
      push('content_block_start', { index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
      push('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    }
    push('content_block_stop', { index });
  });
  push('message_delta', { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: message.usage.output_tokens } });
  push('message_stop', {});
  return ev.join('');
}
