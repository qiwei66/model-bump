// Render ANSI terminal output as a terminal-window SVG (used for docs/check.svg).
// usage: node scripts/ansi-to-svg.mjs input.ansi "$ command" > out.svg
import fs from 'node:fs';

const [, , input, prompt = ''] = process.argv;
const raw = fs.readFileSync(input, 'utf8').replace(/\n+$/, '');
const WIDTH_COLS = 112;
const CW = 8.4; // char width at 14px monospace
const LH = 20;
const PAD = 22;
const TOP = 44;

const FG = { 31: '#ff7b72', 32: '#7ee787', 33: '#e3b341', 34: '#79c0ff', 36: '#56d4dd', 90: '#8b949e' };
const DEFAULT = '#e6edf3';

function parse(line) {
  const segs = [];
  let style = { fg: DEFAULT, bold: false, dim: false };
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) segs.push({ text: line.slice(last, m.index), ...style });
    for (const code of m[1].split(';').map(Number)) {
      if (code === 0) style = { fg: DEFAULT, bold: false, dim: false };
      else if (code === 1) style = { ...style, bold: true };
      else if (code === 2) style = { ...style, dim: true };
      else if (FG[code]) style = { ...style, fg: FG[code] };
    }
    last = re.lastIndex;
  }
  if (last < line.length) segs.push({ text: line.slice(last), ...style });
  return segs;
}

function wrap(segs) {
  const lines = [[]];
  let col = 0;
  const lead = (segs.map((s) => s.text).join('').match(/^\s*/) || [''])[0].length;
  const indent = lead + 6;
  for (const s of segs) {
    let text = s.text;
    while (text.length) {
      const room = WIDTH_COLS - col;
      if (text.length <= room) {
        lines[lines.length - 1].push({ ...s, text });
        col += text.length;
        break;
      }
      let cut = text.lastIndexOf(' ', room);
      if (cut <= 0 && col > indent && text.length <= WIDTH_COLS - indent) {
        // Unbreakable token: move it to the next line whole.
        lines.push([{ ...s, text: ' '.repeat(indent) }]);
        col = indent;
        continue;
      }
      if (cut <= 0) cut = room;
      lines[lines.length - 1].push({ ...s, text: text.slice(0, cut) });
      text = text.slice(cut).replace(/^ /, '');
      lines.push([{ ...s, text: ' '.repeat(indent) }]);
      col = indent;
    }
  }
  return lines;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rows = [];
if (prompt) rows.push([{ text: prompt, fg: '#7ee787', bold: true }], []);
for (const l of raw.split('\n')) rows.push(...wrap(parse(l)));

const width = Math.ceil(WIDTH_COLS * CW + PAD * 2);
const height = TOP + rows.length * LH + PAD;
const body = rows
  .map((segs, i) => {
    const spans = segs
      .map((s) => `<tspan fill="${s.fg}"${s.bold ? ' font-weight="700"' : ''}${s.dim ? ' opacity="0.7"' : ''}>${esc(s.text)}</tspan>`)
      .join('');
    return `<text x="${PAD}" y="${TOP + (i + 1) * LH - 5}" xml:space="preserve">${spans}</text>`;
  })
  .join('\n');

process.stdout.write(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" rx="10" fill="#0d1117"/>
<rect width="100%" height="32" rx="10" fill="#161b22"/><rect y="22" width="100%" height="10" fill="#161b22"/>
<circle cx="20" cy="16" r="6" fill="#ff5f57"/><circle cx="40" cy="16" r="6" fill="#febc2e"/><circle cx="60" cy="16" r="6" fill="#28c840"/>
<g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace" font-size="14">
${body}
</g>
</svg>
`);
