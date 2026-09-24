// Request-level rules for claude-opus-5-5.
//
// Source: https://platform.claude.com/docs/en/models/opus-5-5/migration-guide
// Error messages marked `verbatim: true` are copied from the migration guide;
// the others are model-bump's own wording for a request the API rejects.

export const TARGET = {
  id: 'claude-opus-5-5',
  name: 'Claude Opus 5.5',
  released: '2026-09-22',
  guide: 'https://platform.claude.com/docs/en/models/opus-5-5/migration-guide',
};

const DOC = {
  thinking: `${TARGET.guide}#thinking-cant-be-disabled`,
  toolChoice: `${TARGET.guide}#forced-tool-use`,
  sampling: `${TARGET.guide}#request-requirements`,
  prefill: `${TARGET.guide}#request-requirements`,
  computer: `${TARGET.guide}#computer-use-toolset`,
  effort: 'https://platform.claude.com/docs/en/build-with-claude/effort',
  responseShape: `${TARGET.guide}#thinking-in-every-response`,
  preserved: 'https://platform.claude.com/docs/en/build-with-claude/preserved-thinking',
  strict: 'https://platform.claude.com/docs/en/build-with-claude/structured-outputs#json-schema-limitations',
  betas: `${TARGET.guide}#migrating-from-claude-opus-45`,
  outputFormat: `${TARGET.guide}#migrating-from-claude-opus-45`,
};

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Beta headers that have no effect on Opus 5.5 (the feature is GA or built in).
export const OBSOLETE_BETAS = [
  'effort-2025-11-24',
  'interleaved-thinking-2025-05-14',
  'fine-grained-tool-streaming-2025-05-14',
  'token-efficient-tools-2025-02-19',
  'output-128k-2025-02-19',
  'computer-use-2025-11-24',
];

// Synthetic tools that gateways/SDKs use to emulate structured output via a
// forced tool call. On Opus 5.5 they can no longer be forced.
const SYNTHETIC_JSON_TOOLS = ['json_tool_call', 'json'];

const finding = (f) => ({ severity: 'error', ...f });

/**
 * Validate one Messages API request body as if it were sent to claude-opus-5-5.
 * @param {object} body parsed JSON request body
 * @param {{betas?: string[], endpoint?: 'messages'|'count_tokens'}} [ctx]
 * @returns {Array<{id:string,severity:'error'|'warn'|'info',title:string,fix:string,doc:string,apiMessage?:string,verbatim?:boolean}>}
 */
export function validateRequest(body, ctx = {}) {
  const out = [];
  if (!body || typeof body !== 'object') return out;
  const endpoint = ctx.endpoint || 'messages';

  // --- thinking -----------------------------------------------------------
  const thinking = body.thinking;
  if (thinking && typeof thinking === 'object') {
    if (thinking.type === 'disabled') {
      out.push(finding({
        id: 'thinking-disabled',
        title: 'thinking: {type: "disabled"} is rejected — thinking is always on',
        apiMessage: '"thinking.type.disabled" is not supported for this model.',
        verbatim: true,
        fix: 'Remove the `thinking` field and pick a lower `output_config.effort` (e.g. "low") if you disabled thinking to save tokens.',
        doc: DOC.thinking,
      }));
    } else if (thinking.type === 'enabled') {
      out.push(finding({
        id: 'thinking-budget',
        title: 'thinking: {type: "enabled", budget_tokens} is rejected — manual budgets are gone',
        apiMessage: '"thinking.type.enabled" is not supported for this model.',
        verbatim: true,
        fix: 'Remove the `thinking` field (or send {type: "adaptive"}) and control depth with `output_config.effort`.',
        doc: DOC.thinking,
      }));
    }
  }

  // --- tool_choice --------------------------------------------------------
  const tc = body.tool_choice;
  const tcType = tc && typeof tc === 'object' ? tc.type : tc;
  if (tcType === 'any' || tcType === 'tool') {
    out.push(finding({
      id: 'forced-tool-choice',
      title: `tool_choice {type: "${tcType}"} is rejected — forced tool use is not supported`,
      apiMessage: 'tool_choice: type "tool" and "any" are not supported for this model.',
      verbatim: true,
      fix: 'Use tool_choice "auto" plus strict tool use (`strict: true`) or structured outputs (`output_config.format`), and say in the prompt when the tool applies.',
      doc: DOC.toolChoice,
    }));
  }

  // --- sampling parameters -----------------------------------------------
  const sampling = [];
  if (body.temperature != null && body.temperature !== 1) sampling.push(`temperature=${body.temperature}`);
  if (body.top_p != null && body.top_p !== 1) sampling.push(`top_p=${body.top_p}`);
  if (body.top_k != null) sampling.push(`top_k=${body.top_k}`);
  if (sampling.length) {
    out.push(finding({
      id: 'sampling-params',
      title: `Non-default sampling parameters are rejected (${sampling.join(', ')})`,
      apiMessage: `${sampling.map((s) => s.split('=')[0]).join(', ')}: non-default sampling parameters are not supported for this model.`,
      fix: 'Omit temperature / top_p / top_k. Framework wrappers (e.g. ChatAnthropic(temperature=0)) send them for you — remove them there too.',
      doc: DOC.sampling,
    }));
  }

  // --- prefill ------------------------------------------------------------
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const last = msgs[msgs.length - 1];
  if (last && last.role === 'assistant') {
    out.push(finding({
      id: 'assistant-prefill',
      title: '`messages` ends with an assistant turn (prefill) — rejected',
      apiMessage: 'Prefilling the assistant response is not supported for this model.',
      fix: 'Drop the trailing assistant message. Use structured outputs (`output_config.format`) or system-prompt instructions instead.',
      doc: DOC.prefill,
    }));
  }

  // --- tools --------------------------------------------------------------
  const tools = Array.isArray(body.tools) ? body.tools : [];
  if (tools.some((t) => t && t.type === 'computer_20251124')) {
    out.push(finding({
      id: 'computer-use-legacy',
      title: '`computer_20251124` tool is rejected on the Claude API and Google Cloud',
      apiMessage: "'claude-opus-5-5' does not support tool types: computer_20251124.",
      verbatim: true,
      fix: 'Declare the `computer_toolset_20260801` toolset (no name, no display size, no beta header) and handle several member tool_use blocks per turn. Bedrock keeps computer_20251124.',
      doc: DOC.computer,
    }));
  }
  for (const t of tools) {
    if (!t || t.strict !== true || !t.input_schema) continue;
    const bad = objectsMissingAdditionalProps(t.input_schema);
    if (bad.length) {
      out.push(finding({
        id: 'strict-schema',
        severity: 'warn',
        title: `Tool "${t.name}" uses strict: true but ${bad.length} object schema(s) lack additionalProperties: false`,
        fix: `Set additionalProperties: false on every object in the schema (${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ', …' : ''}).`,
        doc: DOC.strict,
      }));
    }
  }
  const synthetic = tools.find((t) => t && SYNTHETIC_JSON_TOOLS.includes(t.name));
  if (synthetic && (tcType == null || tcType === 'auto')) {
    out.push(finding({
      id: 'silent-structured-output',
      severity: 'warn',
      title: `Structured output via synthetic tool "${synthetic.name}" is no longer forced — the model may answer in plain text`,
      fix: 'Your gateway/SDK downgraded a forced tool call to "auto". The request succeeds (HTTP 200) but can come back without the tool call. Use native structured outputs (`output_config.format`) or tell the model in the tool description to always call it.',
      doc: DOC.toolChoice,
    }));
  }

  // --- effort / max_tokens -----------------------------------------------
  if (endpoint === 'messages') {
    const effort = body.output_config && body.output_config.effort;
    if (effort == null) {
      out.push(finding({
        id: 'effort-default',
        severity: 'warn',
        title: 'No effort set — Opus 5.5 defaults to "medium" (Opus 5 / 4.8 / 4.7 / Sonnet 5 default to "high")',
        fix: 'Set `output_config.effort` explicitly and re-run an effort sweep on your own evals; the same level name is not the same thinking budget across models.',
        doc: DOC.effort,
      }));
    } else if (!EFFORT_LEVELS.includes(effort)) {
      out.push(finding({
        id: 'effort-invalid',
        title: `Unknown effort level "${effort}"`,
        apiMessage: `output_config.effort: Input should be ${EFFORT_LEVELS.map((e) => `'${e}'`).join(', ')}`,
        fix: `Use one of: ${EFFORT_LEVELS.join(', ')}.`,
        doc: DOC.effort,
      }));
    }
    const mt = body.max_tokens;
    if ((effort === 'xhigh' || effort === 'max') && typeof mt === 'number' && mt < 64000) {
      out.push(finding({
        id: 'max-tokens-high-effort',
        severity: 'warn',
        title: `effort "${effort}" with max_tokens=${mt} — thinking can exhaust the budget before any text`,
        fix: 'At xhigh/max effort start max_tokens at 64k and tune from there.',
        doc: DOC.responseShape,
      }));
    } else if (typeof mt === 'number' && mt < 2048) {
      out.push(finding({
        id: 'max-tokens-low',
        severity: 'warn',
        title: `max_tokens=${mt} now covers thinking + text — responses may stop with stop_reason "max_tokens"`,
        fix: 'Raise max_tokens (thinking tokens count against it and are billed as output) or lower effort.',
        doc: DOC.responseShape,
      }));
    }
    if (body.stream === true && !(thinking && thinking.display && thinking.display !== 'omitted')) {
      out.push(finding({
        id: 'stream-thinking-hidden',
        severity: 'info',
        title: 'Streaming with thinking.display "omitted" (default) — UIs look frozen while the model thinks, and text between tool calls arrives in empty thinking blocks',
        fix: 'Set thinking: {type: "adaptive", display: "summarized"} (or "updates", beta) and render non-empty thinking blocks.',
        doc: `${TARGET.guide}#text-between-tool-calls`,
      }));
    }
  }

  if (body.output_format != null) {
    out.push(finding({
      id: 'output-format-deprecated',
      severity: 'warn',
      title: '`output_format` is deprecated and will be removed in a future model release',
      fix: 'Move it to output_config: {format: {...}}.',
      doc: DOC.outputFormat,
    }));
  }

  // --- beta headers --------------------------------------------------------
  const betas = (ctx.betas || []).flatMap((b) => String(b).split(',')).map((b) => b.trim()).filter(Boolean);
  const obsolete = betas.filter((b) => OBSOLETE_BETAS.includes(b) || /^context-1m-/.test(b));
  if (obsolete.length) {
    out.push(finding({
      id: 'obsolete-beta',
      severity: 'info',
      title: `Beta header(s) with no effect on Opus 5.5: ${obsolete.join(', ')}`,
      fix: 'Remove them; the features are built in (1M context is the default).',
      doc: DOC.betas,
    }));
  }

  return out;
}

/** JSON-pointer-ish paths of object schemas that don't set additionalProperties: false. */
export function objectsMissingAdditionalProps(schema, path = '$', acc = []) {
  if (!schema || typeof schema !== 'object') return acc;
  const isObj = schema.type === 'object' || (schema.properties && typeof schema.properties === 'object');
  if (isObj && schema.additionalProperties !== false) acc.push(path);
  if (schema.properties) {
    for (const [k, v] of Object.entries(schema.properties)) objectsMissingAdditionalProps(v, `${path}.${k}`, acc);
  }
  if (schema.items) objectsMissingAdditionalProps(schema.items, `${path}[]`, acc);
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(schema[key])) schema[key].forEach((s, i) => objectsMissingAdditionalProps(s, `${path}.${key}[${i}]`, acc));
  }
  for (const key of ['$defs', 'definitions']) {
    if (schema[key]) for (const [k, v] of Object.entries(schema[key])) objectsMissingAdditionalProps(v, `$.${key}.${k}`, acc);
  }
  return acc;
}

export { DOC };
