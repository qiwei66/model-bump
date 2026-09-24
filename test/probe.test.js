import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProbeServer, listen } from '../src/probe/server.js';
import { sampleFromSchema } from '../src/probe/mock.js';

async function withServer(opts, fn) {
  const { server, records } = createProbeServer(opts);
  const { port } = await listen(server);
  try {
    await fn(`http://127.0.0.1:${port}`, records);
  } finally {
    server.close();
  }
}

const post = (url, body, headers = {}) =>
  fetch(`${url}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

const ok = { model: 'claude-opus-5-5', max_tokens: 4096, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'hi' }] };

test('valid request → thinking-first message', async () => {
  await withServer({}, async (url) => {
    const r = await post(url, ok);
    assert.equal(r.status, 200);
    const m = await r.json();
    assert.deepEqual(m.content.map((b) => b.type), ['thinking', 'text']);
    assert.equal(m.content[0].thinking, '');
  });
});

test('violation → 400 with Anthropic error shape', async () => {
  await withServer({}, async (url, records) => {
    const r = await post(url, { ...ok, tool_choice: { type: 'any' } });
    assert.equal(r.status, 400);
    const e = await r.json();
    assert.equal(e.type, 'error');
    assert.equal(e.error.type, 'invalid_request_error');
    assert.match(e.error.message, /tool_choice/);
    assert.equal(records[0].status, 400);
  });
});

test('lenient mode records but answers 200', async () => {
  await withServer({ lenient: true }, async (url, records) => {
    const r = await post(url, { ...ok, thinking: { type: 'disabled' } });
    assert.equal(r.status, 200);
    assert.equal(records[0].findings[0].id, 'thinking-disabled');
  });
});

test('streaming emits thinking before text', async () => {
  await withServer({}, async (url) => {
    const r = await post(url, { ...ok, stream: true });
    const text = await r.text();
    const starts = [...text.matchAll(/"content_block":\{"type":"(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(starts, ['thinking', 'text']);
    assert.match(text, /event: message_stop/);
  });
});

test('tool loop: dropping the thinking block is caught', async () => {
  await withServer({ simulateTools: true }, async (url) => {
    const tools = [{ name: 'w', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }];
    const first = await (await post(url, { ...ok, tools })).json();
    const tu = first.content.find((b) => b.type === 'tool_use');
    assert.ok(tu);
    const result = { role: 'user', content: [{ type: 'tool_result', tool_use_id: tu.id, content: '18C' }] };
    const dropped = await post(url, { ...ok, tools, messages: [ok.messages[0], { role: 'assistant', content: [tu] }, result] });
    assert.equal(dropped.status, 400);
    const kept = await post(url, { ...ok, tools, messages: [ok.messages[0], { role: 'assistant', content: first.content }, result] });
    assert.equal(kept.status, 200);
  });
});

test('structured output mock satisfies the schema', () => {
  const v = sampleFromSchema({ type: 'object', properties: { a: { type: 'integer', minimum: 3 }, b: { enum: ['x', 'y'] }, c: { $ref: '#/$defs/C' } }, $defs: { C: { type: 'array', items: { type: 'boolean' } } } });
  assert.deepEqual(v, { a: 3, b: 'x', c: [false] });
});
