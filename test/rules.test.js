import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, objectsMissingAdditionalProps } from '../src/rules/opus-5-5.js';

const ids = (body, ctx) => validateRequest(body, ctx).map((f) => f.id);
const base = { model: 'claude-opus-5-5', max_tokens: 4096, output_config: { effort: 'medium' }, messages: [{ role: 'user', content: 'hi' }] };

test('a clean Opus 5.5 request has no findings', () => {
  assert.deepEqual(ids(base), []);
});

test('thinking disabled / enabled are rejected with the documented messages', () => {
  const d = validateRequest({ ...base, thinking: { type: 'disabled' } });
  assert.equal(d[0].id, 'thinking-disabled');
  assert.equal(d[0].apiMessage, '"thinking.type.disabled" is not supported for this model.');
  assert.deepEqual(ids({ ...base, thinking: { type: 'enabled', budget_tokens: 2000 } }), ['thinking-budget']);
  assert.deepEqual(ids({ ...base, thinking: { type: 'adaptive' } }), []);
});

test('forced tool_choice is rejected; auto and none are fine', () => {
  assert.deepEqual(ids({ ...base, tool_choice: { type: 'any' } }), ['forced-tool-choice']);
  assert.deepEqual(ids({ ...base, tool_choice: { type: 'tool', name: 'x' } }), ['forced-tool-choice']);
  assert.deepEqual(ids({ ...base, tool_choice: { type: 'auto' } }), []);
  assert.deepEqual(ids({ ...base, tool_choice: { type: 'none' } }), []);
  assert.deepEqual(ids({ ...base, tool_choice: { type: 'any' } }, { endpoint: 'count_tokens' }), ['forced-tool-choice']);
});

test('sampling parameters: defaults pass, anything else is rejected', () => {
  assert.deepEqual(ids({ ...base, temperature: 1 }), []);
  assert.deepEqual(ids({ ...base, temperature: 0 }), ['sampling-params']);
  assert.deepEqual(ids({ ...base, top_k: 5 }), ['sampling-params']);
});

test('prefill and legacy computer use', () => {
  assert.deepEqual(ids({ ...base, messages: [...base.messages, { role: 'assistant', content: '{' }] }), ['assistant-prefill']);
  assert.deepEqual(ids({ ...base, tools: [{ type: 'computer_20251124', name: 'computer' }] }), ['computer-use-legacy']);
});

test('effort: missing → warn, unknown → error, xhigh needs room', () => {
  const { output_config, ...noEffort } = base;
  assert.deepEqual(ids(noEffort), ['effort-default']);
  assert.deepEqual(ids({ ...base, output_config: { effort: 'turbo' } }), ['effort-invalid']);
  assert.deepEqual(ids({ ...base, output_config: { effort: 'max' }, max_tokens: 8000 }), ['max-tokens-high-effort']);
});

test('obsolete betas and synthetic structured-output tools', () => {
  assert.deepEqual(ids(base, { betas: ['interleaved-thinking-2025-05-14,context-1m-2025-08-07'] }), ['obsolete-beta']);
  const tools = [{ name: 'json_tool_call', input_schema: { type: 'object', properties: {} } }];
  assert.deepEqual(ids({ ...base, tools }), ['silent-structured-output']);
});

test('strict tools must close every object schema', () => {
  const schema = { type: 'object', properties: { a: { type: 'object', properties: {} } }, additionalProperties: false };
  assert.deepEqual(objectsMissingAdditionalProps(schema), ['$.a']);
  assert.deepEqual(ids({ ...base, tools: [{ name: 't', strict: true, input_schema: schema }] }), ['strict-schema']);
});
