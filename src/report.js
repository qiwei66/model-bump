const useColor = () =>
  process.env.FORCE_COLOR ? process.env.FORCE_COLOR !== '0' : !process.env.NO_COLOR && process.stdout.isTTY;

const wrap = (code) => (s) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = {
  red: wrap('31'),
  yellow: wrap('33'),
  blue: wrap('34'),
  green: wrap('32'),
  gray: wrap('90'),
  bold: wrap('1'),
  dim: wrap('2'),
  cyan: wrap('36'),
};

export const SEV_ORDER = { error: 0, warn: 1, info: 2 };
const SEV_LABEL = {
  error: () => c.red(c.bold('✖ error')),
  warn: () => c.yellow(c.bold('▲ warn ')),
  info: () => c.blue('● info '),
};

export function sevLabel(sev) {
  return SEV_LABEL[sev]();
}

/** Group findings with the same rule + title, keeping every location. */
export function groupFindings(findings) {
  const groups = new Map();
  for (const f of findings) {
    const key = `${f.severity}|${f.id}|${f.title}`;
    if (!groups.has(key)) groups.set(key, { ...f, locations: [] });
    groups.get(key).locations.push(f);
  }
  return [...groups.values()].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.locations.length - a.locations.length);
}

export function counts(findings) {
  const n = { error: 0, warn: 0, info: 0 };
  for (const f of findings) n[f.severity]++;
  return n;
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function printCheck(result, target, { maxLocations = 6, verbose = false } = {}) {
  const out = [];
  const log = (s = '') => out.push(s);
  log(`${c.bold('model-bump')} ${c.gray('·')} checking ${c.cyan(result.input || result.root)} for ${c.bold(target.name)} ${c.gray(`(${target.id})`)}`);
  if (!result.targetFiles.length) {
    log(c.gray(`  You don't reference ${target.id} yet — this is what breaks when you bump.`));
  }
  log();

  const groups = groupFindings(result.findings.filter((f) => verbose || f.severity !== 'info' || f.id.startsWith('dep:') || f.id === 'computer-use-legacy'));
  for (const g of groups) {
    log(`${sevLabel(g.severity)}  ${c.bold(g.title)} ${c.gray(`[${g.id}]`)}`);
    for (const loc of g.locations.slice(0, maxLocations)) {
      const where = loc.line ? `${loc.file}:${loc.line}` : loc.file;
      log(`    ${c.cyan(where)}${loc.snippet ? `  ${c.gray(loc.snippet)}` : ''}`);
    }
    if (g.locations.length > maxLocations) log(c.gray(`    … and ${g.locations.length - maxLocations} more`));
    if (verbose && g.detail) log(`    ${c.gray(g.detail)}`);
    log(`    ${c.green('fix:')} ${g.fix}`);
    log(`    ${c.gray(`docs: ${g.doc}`)}`);
    log();
  }

  const n = counts(result.findings);
  const hiddenInfo = verbose ? 0 : result.findings.filter((f) => f.severity === 'info' && !f.id.startsWith('dep:') && f.id !== 'computer-use-legacy').length;
  if (!groups.length) log(`${c.green(c.bold('✔'))} No known Opus 5.5 breaking patterns found.`);
  log(
    `${c.bold('Summary:')} ${c.red(plural(n.error, 'error'))} · ${c.yellow(plural(n.warn, 'warning'))} · ${c.blue(`${n.info} info`)}` +
      c.gray(` in ${plural(result.filesScanned, 'file')}, ${plural(result.manifests.length, 'manifest')}`) +
      (hiddenInfo ? c.gray(` (${hiddenInfo} info hidden, use --verbose)`) : ''),
  );
  if (result.modelRefs.length) {
    const byModel = {};
    for (const r of result.modelRefs) byModel[r.model] = (byModel[r.model] || 0) + 1;
    const top = Object.entries(byModel).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([m, k]) => `${m} ×${k}`).join(', ');
    log(c.gray(`Model IDs to bump: ${result.modelRefs.length} (${top})`));
  }
  log(c.gray(`Static checks can't see what your framework sends. Next: ${c.bold('npx github:qiwei66/model-bump probe -- <your command>')}`));
  return out.join('\n');
}
