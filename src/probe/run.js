import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createProbeServer, listen } from './server.js';
import { c, sevLabel, groupFindings, counts, plural } from '../report.js';
import { TARGET } from '../rules/opus-5-5.js';

const PROBE_KEY = 'sk-ant-model-bump-probe-not-a-real-key';

function redact(body) {
  return JSON.parse(JSON.stringify(body, (k, v) => (typeof v === 'string' && v.length > 400 ? `${v.slice(0, 400)}…` : v)));
}

function requestLine(rec) {
  const errs = rec.findings.filter((f) => f.severity === 'error');
  const warns = rec.findings.filter((f) => f.severity === 'warn');
  const status = rec.status === 400 ? c.red(c.bold('400')) : c.green('200');
  const tags = [
    ...errs.map((f) => c.red(f.id)),
    ...warns.map((f) => c.yellow(f.id)),
  ].join(' ');
  const meta = c.gray(`${rec.endpoint} model=${rec.model || '?'}${rec.stream ? ' stream' : ''}${rec.tools ? ` tools=${rec.tools}` : ''}`);
  return `${c.gray('[model-bump]')} #${rec.n} ${meta} → ${status}${tags ? `  ${tags}` : ''}`;
}

export function printProbeReport(records, { lenient }) {
  const out = [];
  const log = (s = '') => out.push(s);
  log();
  log(`${c.bold('model-bump probe')} ${c.gray('·')} ${plural(records.length, 'request')} checked against ${c.bold(TARGET.name)}${lenient ? c.gray(' (lenient: violations were answered with 200)') : ''}`);
  if (!records.length) {
    log(c.yellow('  No requests reached the probe.'));
    log(c.gray('  Does your client read ANTHROPIC_BASE_URL? Bedrock / Vertex / Foundry clients bypass it; point them at the Anthropic provider for the probe run.'));
    return out.join('\n');
  }
  log();
  const all = records.flatMap((r) => r.findings.map((f) => ({ ...f, file: `request #${r.n}`, line: null, snippet: `model=${r.model || '?'}${r.userAgent ? `  ua=${r.userAgent.split(' ')[0]}` : ''}` })));
  for (const g of groupFindings(all)) {
    log(`${sevLabel(g.severity)}  ${c.bold(g.title)} ${c.gray(`[${g.id}]`)}`);
    const nums = g.locations.map((l) => l.file.replace('request ', ''));
    log(`    ${c.cyan(`requests ${nums.slice(0, 12).join(', ')}${nums.length > 12 ? ', …' : ''}`)}  ${c.gray(g.locations[0].snippet)}`);
    if (g.apiMessage) log(`    ${c.gray(g.verbatim ? 'API error (verbatim):' : 'API error (paraphrased):')} ${g.apiMessage}`);
    log(`    ${c.green('fix:')} ${g.fix}`);
    log(`    ${c.gray(`docs: ${g.doc}`)}`);
    log();
  }
  const n = counts(all);
  const rejected = records.filter((r) => r.status === 400).length;
  const wouldFail = records.filter((r) => r.findings.some((f) => f.severity === 'error')).length;
  log(`${c.bold('Summary:')} ${c.red(`${wouldFail}/${records.length} requests would be rejected by Opus 5.5`)}${rejected !== wouldFail ? c.gray(` (${rejected} rejected in this run)`) : ''} · ${c.yellow(plural(n.warn, 'warning'))} · ${c.blue(`${n.info} info`)}`);
  if (!wouldFail) log(`${c.green(c.bold('✔'))} Every captured request is valid for ${TARGET.id}.`);
  return out.join('\n');
}

/**
 * model-bump probe [--port N] [--lenient] [--simulate-tools] [--json] [--dump DIR] -- <command...>
 * model-bump probe --serve [--port N]
 */
export async function runProbe(opts) {
  const { command = [], serve = false, port = 0, lenient = false, simulateTools = false, json = false, dump = null, quiet = false } = opts;
  if (dump) fs.mkdirSync(dump, { recursive: true });

  const { server, records } = createProbeServer({
    lenient,
    simulateTools,
    onRequest: (rec) => {
      if (!quiet && !json) process.stderr.write(`${requestLine(rec)}\n`);
      if (dump) fs.writeFileSync(path.join(dump, `request-${String(rec.n).padStart(3, '0')}.json`), JSON.stringify(redact(rec.body), null, 2));
    },
  });
  const addr = await listen(server, port);
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const finish = (childCode) => {
    server.close();
    if (json) {
      process.stdout.write(`${JSON.stringify({ target: TARGET.id, requests: records.map(({ body, ...r }) => r) }, null, 2)}\n`);
    } else {
      process.stderr.write(`${printProbeReport(records, { lenient })}\n`);
    }
    const wouldFail = records.some((r) => r.findings.some((f) => f.severity === 'error'));
    return wouldFail ? 1 : childCode || 0;
  };

  if (serve || !command.length) {
    process.stderr.write(
      [
        `${c.bold('model-bump probe')} is emulating ${c.bold(TARGET.name)} at ${c.cyan(baseUrl)}`,
        '',
        c.gray('Point your app at it (no real API key needed):'),
        `  export ANTHROPIC_BASE_URL=${baseUrl}`,
        `  export ANTHROPIC_API_KEY=${PROBE_KEY}`,
        '',
        c.gray('Press Ctrl-C to stop and print the report.'),
        '',
      ].join('\n'),
    );
    return new Promise((resolve) => {
      process.once('SIGINT', () => resolve(finish(0)));
      process.once('SIGTERM', () => resolve(finish(0)));
    });
  }

  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: baseUrl, // official SDKs, Vercel AI SDK, Claude Agent SDK
    ANTHROPIC_API_URL: baseUrl, // LangChain ChatAnthropic
    ANTHROPIC_API_BASE: baseUrl, // LiteLLM
    ANTHROPIC_API_KEY: PROBE_KEY,
    MODEL_BUMP_PROBE: '1',
  };
  if (!quiet && !json) process.stderr.write(`${c.gray('[model-bump]')} emulating ${c.bold(TARGET.name)} at ${baseUrl} → running: ${c.bold(command.join(' '))}\n`);

  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), { stdio: 'inherit', env, shell: process.platform === 'win32' });
    const fwd = (sig) => () => child.kill(sig);
    process.on('SIGINT', fwd('SIGINT'));
    process.on('SIGTERM', fwd('SIGTERM'));
    child.on('error', (err) => {
      process.stderr.write(`${c.red('model-bump:')} could not start ${command[0]}: ${err.message}\n`);
      server.close();
      resolve(127);
    });
    child.on('exit', (code) => resolve(finish(code)));
  });
}
