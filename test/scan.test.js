import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText, scan } from '../src/scan.js';
import { cmpVersion, checkDeps } from '../src/deps.js';

const ids = (src) => scanText(src).findings.map((f) => f.id);

test('python: every documented breaking pattern is caught', () => {
  const src = `import anthropic
client.messages.create(model="claude-opus-5", thinking={"type": "disabled"}, tool_choice={"type": "any"}, temperature=0.2)
text = resp.content[0].text
`;
  const got = ids(src);
  for (const id of ['thinking-disabled', 'forced-tool-choice', 'sampling-params', 'content-by-position']) assert.ok(got.includes(id), id);
});

test('typescript: forced toolChoice, computer use, content[0]', () => {
  const src = `import Anthropic from "@anthropic-ai/sdk";
const r = await client.messages.create({ tool_choice: { type: "tool", name: "x" }, tools: [{ type: "computer_20251124" }] });
console.log(r.content[0]?.text);
generateText({ toolChoice: "required" });`;
  const got = ids(src);
  assert.equal(got.filter((i) => i === 'forced-tool-choice').length, 2);
  assert.ok(got.includes('computer-use-legacy'));
  assert.ok(got.includes('content-by-position'));
});

test('no false positives in files that never talk to Claude', () => {
  assert.deepEqual(ids(`const r = await openai.chat.completions.create({ temperature: 0, tool_choice: "required" });
console.log(r.choices[0].message.content)`), []);
});

test('OpenAI Responses-style output[0].content[0].text is not flagged', () => {
  assert.deepEqual(ids(`# claude vs openai\nx = resp.output[0].content[0].text`), []);
});

test('safe patterns are not flagged', () => {
  assert.deepEqual(ids(`import anthropic
resp = client.messages.create(model="claude-opus-5-5", tool_choice={"type": "auto"}, temperature=1)
text = next(b.text for b in resp.content if b.type == "text")`), []);
});

test('model-bump-ignore suppresses a line', () => {
  assert.deepEqual(ids(`import anthropic\nx = r.content[0].text  # model-bump-ignore`), []);
});

test('model refs exclude the target', () => {
  const r = scanText(`m1 = "claude-opus-5"; m2 = "claude-opus-5-5"; m3 = "claude-sonnet-5"`);
  assert.deepEqual(r.modelRefs.map((m) => m.model), ['claude-opus-5', 'claude-sonnet-5']);
  assert.equal(r.targetSeen, true);
});

test('version compare and dependency matching', () => {
  assert.equal(cmpVersion('1.7.3', '1.7.4'), -1);
  assert.equal(cmpVersion('1.10.0', '1.9.9'), 1);
  const f = checkDeps([{ ecosystem: 'pypi', name: 'langchain-anthropic', version: '1.7.3', exact: true, file: 'r.txt' }]);
  assert.equal(f[0].severity, 'error');
  const newer = checkDeps([{ ecosystem: 'pypi', name: 'langchain-anthropic', version: '1.8.0', exact: true, file: 'r.txt' }]);
  assert.equal(newer[0].severity, 'info');
});

test('fixtures: end-to-end scan', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
  const r = scan(root);
  const errors = r.findings.filter((f) => f.severity === 'error');
  assert.ok(errors.length >= 10);
  assert.ok(r.deps.some((d) => d.name === 'langchain-anthropic'));
  assert.ok(r.deps.some((d) => d.name === '@ai-sdk/amazon-bedrock'));
});

test('quoted dict keys are code, not strings', () => {
  const got = ids(`import anthropic
body = {"model": "claude-opus-5", "thinking": {"type": "enabled", "budget_tokens": 8000}, "tool_choice": {"type": "any"}}`);
  assert.ok(got.includes('thinking-budget'));
  assert.ok(got.includes('forced-tool-choice'));
});

test('mentions inside strings, comments and type declarations are skipped', () => {
  assert.deepEqual(ids(`import anthropic
raise ValueError(f"{model} does not support tool_choice='required'")
# tool_choice={"type": "any"} is rejected
export interface ToolChoiceAny { type: "any" }`), []);
});

test('capability-gated forced choice is downgraded to info', () => {
  const f = scanText(`import anthropic
tool_choice = {'type': 'any'} if supports_forced else {'type': 'auto'}`).findings;
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'info');
});

test('content[0].text on a response is an error, on other names a warning', () => {
  const f = scanText(`import anthropic
a = response.content[0].text
b = msg.content[0].text`).findings;
  assert.deepEqual(f.map((x) => x.severity), ['error', 'warn']);
});
