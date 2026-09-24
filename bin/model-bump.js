#!/usr/bin/env node
import { scan } from '../src/scan.js';
import { printCheck, SEV_ORDER, counts } from '../src/report.js';
import { runProbe } from '../src/probe/run.js';
import { TARGET } from '../src/rules/opus-5-5.js';
import { SOURCE_RULES } from '../src/rules/source.js';
import { DEP_RULES } from '../src/rules/deps.js';

const VERSION = '0.1.0';

const HELP = `model-bump ${VERSION} — will your code survive the bump to ${TARGET.name}?

Usage
  model-bump check [path]            Scan code + dependencies for Opus 5.5 breaking changes
  model-bump probe -- <command...>   Run your app against a local fake Opus 5.5 and check
                                     every request your code/framework actually sends
  model-bump probe --serve           Only start the fake API (set ANTHROPIC_BASE_URL yourself)
  model-bump rules                   List every rule and known-broken dependency

check options
  --json                 Machine-readable output
  --fail-on <level>      Exit 1 on: error (default) | warn | never
  --ignore <dir>         Skip a path (repeatable)
  --skip-tests           Skip test files (tests/, *_test.py, *.test.ts, …)
  --verbose              Also show info-level notes

probe options
  --lenient              Answer violations with 200 instead of 400, to find every issue in one run
  --simulate-tools       Mock answers call your first tool (exercises tool loops and thinking pass-back)
  --port <n>             Port for the fake API (default: random)
  --dump <dir>           Save captured request bodies as JSON
  --json                 Machine-readable report

No API key is needed for either command. Nothing leaves your machine.
Docs: https://github.com/qiwei66/model-bump`;

function parse(argv) {
  const args = { _: [], ignore: [], command: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      args.command = argv.slice(i + 1);
      break;
    }
    if (a === '--json') args.json = true;
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a === '--lenient') args.lenient = true;
    else if (a === '--simulate-tools') args.simulateTools = true;
    else if (a === '--serve') args.serve = true;
    else if (a === '--quiet' || a === '-q') args.quiet = true;
    else if (a === '--skip-tests') args.skipTests = true;
    else if (a === '--fail-on') args.failOn = argv[++i];
    else if (a === '--ignore') args.ignore.push(argv[++i]);
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--dump') args.dump = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--version' || a === '-V') args.version = true;
    else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parse(process.argv.slice(2));
  const cmd = args._[0];
  if (args.version) return console.log(VERSION);
  if (args.help || !cmd) {
    console.log(HELP);
    return;
  }

  if (cmd === 'check') {
    const target = args._[1] || '.';
    let result;
    try {
      result = scan(target, { ignore: args.ignore, skipTests: args.skipTests });
    } catch (e) {
      console.error(`model-bump: cannot read ${target}: ${e.message}`);
      process.exitCode = 2;
      return;
    }
    if (args.json) {
      console.log(JSON.stringify({ target: TARGET.id, ...result, summary: counts(result.findings) }, null, 2));
    } else {
      console.log(printCheck(result, TARGET, { verbose: args.verbose }));
    }
    if (process.env.GITHUB_ACTIONS === 'true' && !args.json) {
      // Inline annotations on the PR diff.
      const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
      for (const f of result.findings) {
        if (f.severity === 'info') continue;
        const level = f.severity === 'error' ? 'error' : 'warning';
        const loc = `file=${f.file}${f.line ? `,line=${f.line}` : ''}`;
        console.log(`::${level} ${loc},title=${esc(`model-bump: ${f.id}`)}::${esc(`${f.title}\nfix: ${f.fix}\n${f.doc}`)}`);
      }
    }
    const failOn = args.failOn || 'error';
    if (failOn !== 'never') {
      const limit = SEV_ORDER[failOn] ?? 0;
      if (result.findings.some((f) => SEV_ORDER[f.severity] <= limit)) process.exitCode = 1;
    }
    return;
  }

  if (cmd === 'probe') {
    process.exitCode = await runProbe({
      command: args.command,
      serve: args.serve,
      port: args.port || 0,
      lenient: args.lenient,
      simulateTools: args.simulateTools,
      json: args.json,
      dump: args.dump,
      quiet: args.quiet,
    });
    return;
  }

  if (cmd === 'rules') {
    console.log(`Target: ${TARGET.name} (${TARGET.id}) — ${TARGET.guide}\n`);
    console.log('Source rules:');
    const seen = new Set();
    for (const r of SOURCE_RULES) {
      if (seen.has(r.id + r.title)) continue;
      seen.add(r.id + r.title);
      console.log(`  [${r.severity}] ${r.id}: ${r.title}`);
    }
    console.log('\nKnown-affected dependencies:');
    for (const d of DEP_RULES) {
      console.log(`  [${d.severity}] ${d.ecosystem}:${d.name} ${d.affectedUpTo ? `≤${d.affectedUpTo}` : '(all)'} — ${d.title}\n      ${d.link}`);
    }
    return;
  }

  console.error(`model-bump: unknown command "${cmd}"\n`);
  console.log(HELP);
  process.exitCode = 2;
}

main();
