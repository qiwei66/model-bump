import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_RULES, MODEL_REF, TARGET_REF } from './rules/source.js';
import { collectDeps, checkDeps, isManifest } from './deps.js';

const CODE_EXT = new Set([
  '.py', '.ipynb', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx',
  '.java', '.kt', '.go', '.rb', '.php', '.cs', '.rs', '.sh',
]);
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', '.venv', 'venv', 'env',
  '__pycache__', 'site-packages', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache', 'target', 'vendor', '.turbo',
  '.cache', '.yarn', 'bower_components',
]);
const MAX_BYTES = 1_000_000;
const IGNORE_MARK = 'model-bump-ignore';
export const TEST_PATH = /(^|[\\/])(tests?|__tests__|spec|specs|e2e)[\\/]|(^|[\\/])tests?\.rs$|(^|[\\/])test_[^\\/]*$|[._-](test|spec)\.[a-z]+$|_test\.py$|conftest\.py$/;

export function walk(root, { ignore = [], skipTests = false } = {}) {
  const code = [];
  const manifests = [];
  const stat = fs.statSync(root);
  if (stat.isFile()) return { code: [root], manifests: isManifest(path.basename(root)) ? [root] : [] };
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      const rel = path.relative(root, p);
      if (ignore.some((g) => rel === g || rel.startsWith(`${g}/`))) continue;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push(p);
      } else if (e.isFile()) {
        if (isManifest(e.name)) manifests.push(p);
        const ext = path.extname(e.name);
        if (CODE_EXT.has(ext) && !/\.min\.js$/.test(e.name) && !(skipTests && TEST_PATH.test(rel))) code.push(p);
      }
    }
  }
  return { code: code.sort(), manifests: manifests.sort() };
}

function loadSource(file) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  if (st.size > MAX_BYTES) return null;
  const raw = fs.readFileSync(file, 'utf8');
  if (!file.endsWith('.ipynb')) return raw;
  // Notebooks: scan the code cells' source, one cell after another.
  try {
    const nb = JSON.parse(raw);
    return (nb.cells || [])
      .filter((c) => c.cell_type === 'code')
      .map((c) => (Array.isArray(c.source) ? c.source.join('') : String(c.source || '')))
      .join('\n');
  } catch {
    return null;
  }
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}
function lineOf(starts, idx) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= idx) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

const isComment = (line) => /^\s*(#|\/\/|\/\*|\*|--|<!--)/.test(line);
// Is column `col` inside a quoted string on this line? (odd number of unescaped quotes before it)
function inString(line, col) {
  const before = line.slice(0, col).replace(/\\./g, '');
  if (/``/.test(before)) return true; // rst inline literal in a docstring
  for (const q of ['"', "'", '`']) {
    if ((before.split(q).length - 1) % 2 === 1) return true;
  }
  return false;
}
// A quoted dict key like "tool_choice": starts one char earlier, at its opening quote.
function keyStart(line, col, match) {
  const q = line[col - 1];
  const ident = (match.match(/^\w+/) || [''])[0];
  return q && /["'`]/.test(q) && line[col + ident.length] === q ? col - 1 : col;
}
// `x if cond else y` (Python) or `cond ? x : y` (JS/TS) on the same line.
const isConditional = (line) => /\sif\s.+\selse\b/.test(line) || /\?\s*[^:?]+\s:\s/.test(line);

/** Scan one source text. Exported for tests. */
export function scanText(text, file = '<input>') {
  const findings = [];
  const modelRefs = [];
  const starts = lineStarts(text);
  const lines = text.split('\n');
  const ignored = (ln) => (lines[ln - 1] || '').includes(IGNORE_MARK) || (lines[ln - 2] || '').includes(IGNORE_MARK);

  const seen = new Set();
  for (const rule of SOURCE_RULES) {
    if (rule.when && !rule.when.test(text)) continue;
    if (rule.unless && rule.unless.test(text)) continue;
    let hits = 0;
    for (const re of rule.patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        if (m[0].length === 0) re.lastIndex++;
        const ln = lineOf(starts, m.index);
        const key = `${rule.id}:${ln}`;
        const lineText = lines[ln - 1] || '';
        const col = m.index - starts[ln - 1];
        if (seen.has(key) || ignored(ln) || isComment(lineText)) continue;
        if (rule.codeOnly && inString(lineText, keyStart(lineText, col, m[0]))) continue;
        seen.add(key);
        hits++;
        const gated = rule.gateable && isConditional(lineText);
        findings.push({
          id: rule.id,
          severity: gated ? 'info' : rule.severity,
          title: gated ? `${rule.title} — capability-gated here; make sure your model table treats claude-opus-5-5 as unsupported` : rule.title,
          fix: rule.fix,
          doc: rule.doc,
          file,
          line: ln,
          snippet: lineText.trim().slice(0, 140),
        });
        if (rule.once) break;
      }
      if (rule.once && hits) break;
    }
  }

  MODEL_REF.lastIndex = 0;
  let m;
  while ((m = MODEL_REF.exec(text))) {
    if (TARGET_REF.test(m[0])) continue;
    modelRefs.push({ file, line: lineOf(starts, m.index), model: m[0] });
  }
  return { findings, modelRefs, targetSeen: TARGET_REF.test(text) };
}

export function scan(root, opts = {}) {
  const abs = path.resolve(root);
  const { code, manifests } = walk(abs, opts);
  const base = fs.statSync(abs).isFile() ? path.dirname(abs) : abs;
  const findings = [];
  const modelRefs = [];
  const targetFiles = [];
  let scanned = 0;
  for (const f of code) {
    const text = loadSource(f);
    if (text == null) continue;
    scanned++;
    const rel = path.relative(base, f) || path.basename(f);
    const r = scanText(text, rel);
    findings.push(...r.findings);
    modelRefs.push(...r.modelRefs);
    if (r.targetSeen) targetFiles.push(rel);
  }
  const deps = collectDeps(manifests, base);
  findings.push(...checkDeps(deps));
  return { root: abs, input: root, filesScanned: scanned, manifests: manifests.map((f) => path.relative(base, f)), findings, modelRefs, targetFiles, deps };
}
