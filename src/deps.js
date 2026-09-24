// Read dependency versions from manifests and lockfiles (Python + JS), then
// match them against DEP_RULES.

import fs from 'node:fs';
import path from 'node:path';
import { DEP_RULES } from './rules/deps.js';

const normPy = (n) => n.toLowerCase().replace(/[-_.]+/g, '-');

/** Compare dotted numeric versions; pre-release suffixes are ignored. */
export function cmpVersion(a, b) {
  const pa = String(a).split(/[.+-]/).map((x) => parseInt(x, 10));
  const pb = String(b).split(/[.+-]/).map((x) => parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number.isNaN(pa[i]) || pa[i] == null ? 0 : pa[i];
    const y = Number.isNaN(pb[i]) || pb[i] == null ? 0 : pb[i];
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const read = (p) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};

/**
 * Collect {ecosystem, name, version, exact, file} for watched packages found
 * in a list of manifest/lockfile paths.
 */
export function collectDeps(files, root) {
  const watched = {
    pypi: new Set(DEP_RULES.filter((r) => r.ecosystem === 'pypi').map((r) => normPy(r.name))),
    npm: new Set(DEP_RULES.filter((r) => r.ecosystem === 'npm').map((r) => r.name)),
  };
  const found = [];
  const add = (ecosystem, name, version, exact, file) => {
    const key = ecosystem === 'pypi' ? normPy(name) : name;
    if (!watched[ecosystem].has(key) || !version) return;
    found.push({ ecosystem, name: key, version, exact, file: path.relative(root, file) || file });
  };

  for (const file of files) {
    const base = path.basename(file);
    const text = read(file);
    if (text == null) continue;

    if (/^requirements.*\.(txt|in)$/.test(base) || base === 'constraints.txt') {
      for (const line of text.split('\n')) {
        const m = line.match(/^\s*([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*(==|>=|~=|<=|>|<)?\s*([\d][\w.]*)?/);
        if (m && m[3]) add('pypi', m[1], m[3], m[2] === '==', file);
      }
    } else if (base === 'pyproject.toml' || base === 'Pipfile' || base === 'setup.py' || base === 'setup.cfg') {
      for (const name of watched.pypi) {
        const r = new RegExp(`["'\\s]${name.replace(/-/g, '[-_.]')}(?:\\[[^\\]]*\\])?["']?\\s*(?:=\\s*["'])?\\s*(==|>=|~=|\\^|<=)?\\s*([\\d][\\w.]*)`, 'gi');
        let m;
        while ((m = r.exec(text))) add('pypi', name, m[2], m[1] === '==', file);
      }
    } else if (base === 'poetry.lock' || base === 'uv.lock' || base === 'pdm.lock') {
      const re = /name\s*=\s*"([^"]+)"\s*\n\s*version\s*=\s*"([^"]+)"/g;
      let m;
      while ((m = re.exec(text))) add('pypi', m[1], m[2], true, file);
    } else if (base === 'Pipfile.lock') {
      try {
        const j = JSON.parse(text);
        for (const sec of ['default', 'develop']) {
          for (const [n, v] of Object.entries(j[sec] || {})) add('pypi', n, String(v.version || '').replace(/^==/, ''), true, file);
        }
      } catch {}
    } else if (base === 'package.json') {
      try {
        const j = JSON.parse(text);
        for (const sec of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
          for (const [n, v] of Object.entries(j[sec] || {})) {
            const m = String(v).match(/(\d+\.\d+(?:\.\d+)?)/);
            if (m) add('npm', n, m[1], /^\d/.test(String(v)), file);
          }
        }
      } catch {}
    } else if (base === 'package-lock.json') {
      try {
        const j = JSON.parse(text);
        for (const [k, v] of Object.entries(j.packages || {})) {
          const n = k.replace(/^.*node_modules\//, '');
          if (k && v && v.version) add('npm', n, v.version, true, file);
        }
        for (const [n, v] of Object.entries(j.dependencies || {})) if (v && v.version) add('npm', n, v.version, true, file);
      } catch {}
    } else if (base === 'pnpm-lock.yaml') {
      for (const n of watched.npm) {
        const esc = n.replace(/[/@.]/g, (c) => `\\${c}`);
        const re = new RegExp(`(?:^|[\\s'"/])${esc}@(\\d+\\.\\d+\\.\\d+[\\w.-]*)`, 'gm');
        let m;
        while ((m = re.exec(text))) add('npm', n, m[1], true, file);
      }
    } else if (base === 'yarn.lock') {
      for (const n of watched.npm) {
        const esc = n.replace(/[/@.]/g, (c) => `\\${c}`);
        const re = new RegExp(`^"?${esc}@[^\\n]*:\\n\\s+version:?\\s+"?([\\d][\\w.-]*)`, 'gm');
        let m;
        while ((m = re.exec(text))) add('npm', n, m[1], true, file);
      }
    }
  }

  // Prefer exact (lockfile) versions; drop duplicates.
  const byKey = new Map();
  for (const d of found) {
    const k = `${d.ecosystem}:${d.name}:${d.file}:${d.version}`;
    if (!byKey.has(k)) byKey.set(k, d);
  }
  return [...byKey.values()];
}

export const MANIFEST_NAMES = new Set([
  'pyproject.toml', 'Pipfile', 'Pipfile.lock', 'poetry.lock', 'uv.lock', 'pdm.lock', 'setup.py', 'setup.cfg', 'constraints.txt',
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
]);
export const isManifest = (base) => MANIFEST_NAMES.has(base) || /^requirements.*\.(txt|in)$/.test(base);

/** Match collected deps against DEP_RULES → findings. */
export function checkDeps(deps) {
  const findings = [];
  const seen = new Set();
  for (const d of deps) {
    for (const r of DEP_RULES) {
      const rname = r.ecosystem === 'pypi' ? normPy(r.name) : r.name;
      if (r.ecosystem !== d.ecosystem || rname !== d.name) continue;
      let affected;
      if (r.fixedIn && cmpVersion(d.version, r.fixedIn) >= 0) affected = false;
      else if (r.affectedUpTo == null) affected = true; // behaviour note, applies to all versions
      else if (cmpVersion(d.version, r.affectedUpTo) <= 0) affected = true;
      else affected = r.fixedIn ? false : 'unknown';
      if (affected === false) continue;
      const key = `${r.link}:${d.file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let severity = r.severity;
      let title = r.title;
      if (affected === 'unknown') {
        severity = 'info';
        title = `${r.title} (reported on ≤${r.affectedUpTo}; ${d.version} not verified yet)`;
      } else if (!d.exact && severity === 'error') {
        severity = 'warn';
      }
      findings.push({
        id: `dep:${r.name}`,
        severity,
        title: `${r.name} ${d.version}${d.exact ? '' : ' (declared range)'}: ${title}`,
        fix: r.fix,
        detail: r.detail,
        doc: r.link,
        file: d.file,
        line: null,
      });
    }
  }
  return findings;
}
