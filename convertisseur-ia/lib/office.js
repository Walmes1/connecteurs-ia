/* docx / xlsx / pptx → Markdown, sans aucune dépendance externe. */
'use strict';
const { readZip } = require('./zip');

// ── utilitaires XML ─────────────────────────────────────────────────────────
function unesc(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}
const stripTags = (xml) => unesc(String(xml).replace(/<[^>]*>/g, ''));
const mdCell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

// ── DOCX ────────────────────────────────────────────────────────────────────
function runsToMd(paraXml) {
  let out = '';
  const runRe = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
  let m;
  while ((m = runRe.exec(paraXml))) {
    const run = m[1];
    const props = (/<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run) || [, ''])[1];
    const bold = /<w:b(?:\s[^>]*)?\/?>/.test(props) && !/<w:b\s+w:val="(0|false)"/.test(props);
    const italic = /<w:i(?:\s[^>]*)?\/?>/.test(props) && !/<w:i\s+w:val="(0|false)"/.test(props);

    let txt = '';
    const partRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g;
    let p;
    while ((p = partRe.exec(run))) {
      if (p[1] !== undefined) txt += unesc(p[1]);
      else if (p[0].startsWith('<w:tab')) txt += '\t';
      else txt += '\n';
    }
    if (!txt) continue;
    const lead = txt.match(/^\s*/)[0];
    const tail = txt.match(/\s*$/)[0];
    const core = txt.trim();
    if (core && (bold || italic)) {
      const marks = bold && italic ? '***' : bold ? '**' : '*';
      txt = lead + marks + core + marks + tail;
    }
    out += txt;
  }
  return out.replace(/\t/g, '  ').trim();
}

function docxTableToMd(tblXml) {
  const rows = [];
  const trRe = /<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g;
  let r;
  while ((r = trRe.exec(tblXml))) {
    const cells = [];
    const tcRe = /<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g;
    let c;
    while ((c = tcRe.exec(r[1]))) {
      const paras = [];
      const pRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
      let p;
      while ((p = pRe.exec(c[1]))) paras.push(runsToMd(p[1]));
      cells.push(mdCell(paras.filter(Boolean).join(' ')));
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return '';
  const width = Math.max(...rows.map((x) => x.length));
  const pad = (row) => { while (row.length < width) row.push(''); return row; };
  const lines = [`| ${pad(rows[0]).join(' | ')} |`, `| ${Array(width).fill('---').join(' | ')} |`];
  for (const row of rows.slice(1)) lines.push(`| ${pad(row).join(' | ')} |`);
  return lines.join('\n');
}

function docxToMd(buf) {
  const zip = readZip(buf);
  const xml = zip.text('word/document.xml');
  if (!xml) throw new Error('.docx invalide (word/document.xml absent)');
  const body = (/<w:body>([\s\S]*)<\/w:body>/.exec(xml) || [, xml])[1];

  const out = [];
  const blockRe = /<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p(?:\s[^>]*)?\/>/g;
  let b;
  while ((b = blockRe.exec(body))) {
    const block = b[0];
    if (block.startsWith('<w:tbl')) {
      const t = docxTableToMd(block);
      if (t) out.push(t);
      continue;
    }
    const text = runsToMd(block);
    const style = (/<w:pStyle\s+w:val="([^"]+)"/.exec(block) || [, ''])[1];
    // styles FR / DE / EN : Heading1 · Titre1 · berschrift1 (Überschrift 1)
    const lvl = /(?:heading|titre|berschrift|titolo)\s*-?(\d)/i.exec(style);
    if (!text) { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    if (lvl) { out.push(`${'#'.repeat(Math.min(6, +lvl[1]))} ${text}`); continue; }
    if (/<w:numPr>/.test(block)) {
      const ilvl = +(/<w:ilvl\s+w:val="(\d+)"/.exec(block) || [, 0])[1];
      out.push(`${'  '.repeat(ilvl)}- ${text}`);
      continue;
    }
    out.push(text);
  }
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── XLSX ────────────────────────────────────────────────────────────────────
function colIndex(ref) {
  const letters = (/^([A-Z]+)/.exec(ref) || [, 'A'])[1];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function xlsxToMd(buf, opts = {}) {
  const maxRows = opts.maxRows || 5000;
  const zip = readZip(buf);

  // chaînes partagées
  const shared = [];
  const ssXml = zip.text('xl/sharedStrings.xml');
  if (ssXml) {
    const siRe = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = siRe.exec(ssXml))) {
      let s = '';
      const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
      let t;
      while ((t = tRe.exec(m[1]))) s += unesc(t[1]);
      shared.push(s);
    }
  }

  // noms de feuilles + fichiers (via les relations quand elles existent)
  const wbXml = zip.text('xl/workbook.xml') || '';
  const relsXml = zip.text('xl/_rels/workbook.xml.rels') || '';
  const rels = new Map();
  const relRe = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  let rm;
  while ((rm = relRe.exec(relsXml))) rels.set(rm[1], rm[2].replace(/^\/?xl\//, '').replace(/^\//, ''));

  const sheets = [];
  const shRe = /<sheet\s([^>]*)\/?>/g;
  let s;
  let idx = 0;
  while ((s = shRe.exec(wbXml))) {
    const attrs = s[1];
    const name = (/name="([^"]+)"/.exec(attrs) || [, ''])[1];
    if (!name) continue;
    idx++;
    const rid = (/r:id="([^"]+)"/.exec(attrs) || [, ''])[1];
    const target = rid && rels.get(rid);
    sheets.push({ name: unesc(name), path: `xl/${target || `worksheets/sheet${idx}.xml`}` });
  }
  if (!sheets.length) {
    zip.names().filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()
      .forEach((n, i) => sheets.push({ name: `Feuille ${i + 1}`, path: n }));
  }
  return renderSheets(zip, sheets, shared, maxRows);
}

function renderSheets(zip, sheets, shared, maxRows) {
  const out = [];
  for (const sheet of sheets) {
    const xml = zip.text(sheet.path);
    if (!xml) continue;
    const grid = [];
    const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>|<row(?:\s[^>]*)?\/>/g;
    let r;
    while ((r = rowRe.exec(xml)) && grid.length < maxRows) {
      const cells = [];
      if (r[1]) {
        const cRe = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
        let c;
        while ((c = cRe.exec(r[1]))) {
          const attrs = c[1] || '';
          const inner = c[2] || '';
          const ref = (/r="([A-Z]+\d+)"/.exec(attrs) || [, ''])[1];
          const type = (/t="([^"]+)"/.exec(attrs) || [, ''])[1];
          let val = '';
          if (type === 's') {
            const i = +(/<v>([\s\S]*?)<\/v>/.exec(inner) || [, -1])[1];
            val = shared[i] != null ? shared[i] : '';
          } else if (type === 'inlineStr') {
            val = stripTags((/<is>([\s\S]*?)<\/is>/.exec(inner) || [, ''])[1]);
          } else if (type === 'b') {
            val = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [, ''])[1] === '1' ? 'VRAI' : 'FAUX';
          } else {
            val = unesc((/<v>([\s\S]*?)<\/v>/.exec(inner) || [, ''])[1]);
          }
          const at = ref ? colIndex(ref) : cells.length;
          while (cells.length < at) cells.push('');
          cells[at] = val;
        }
      }
      grid.push(cells);
    }

    while (grid.length && grid[grid.length - 1].every((v) => !String(v).trim())) grid.pop();
    if (!grid.length) { out.push(`## ${sheet.name}\n\n_(feuille vide)_`); continue; }
    const width = Math.max(...grid.map((row) => row.length));
    const pad = (row) => { const x = row.slice(); while (x.length < width) x.push(''); return x.map(mdCell); };

    const lines = [`## ${sheet.name}`, ''];
    lines.push(`| ${pad(grid[0]).join(' | ')} |`);
    lines.push(`| ${Array(width).fill('---').join(' | ')} |`);
    for (const row of grid.slice(1)) lines.push(`| ${pad(row).join(' | ')} |`);
    out.push(lines.join('\n'));
  }
  return out.join('\n\n').trim();
}

// ── PPTX ────────────────────────────────────────────────────────────────────
function pptxToMd(buf) {
  const zip = readZip(buf);
  const slides = zip.names()
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => (+a.match(/(\d+)/)[1]) - (+b.match(/(\d+)/)[1]));
  const out = [];
  slides.forEach((path, i) => {
    const xml = zip.text(path) || '';
    const lines = [];
    const pRe = /<a:p>([\s\S]*?)<\/a:p>/g;
    let p;
    while ((p = pRe.exec(xml))) {
      let txt = '';
      const tRe = /<a:t>([\s\S]*?)<\/a:t>/g;
      let t;
      while ((t = tRe.exec(p[1]))) txt += unesc(t[1]);
      txt = txt.trim();
      if (txt) lines.push(txt);
    }
    // notes de presentation, si presentes
    const notesPath = `ppt/notesSlides/notesSlide${i + 1}.xml`;
    let notes = '';
    if (zip.has(notesPath)) {
      const nxml = zip.text(notesPath) || '';
      const parts = [];
      const tRe = /<a:t>([\s\S]*?)<\/a:t>/g;
      let t;
      while ((t = tRe.exec(nxml))) parts.push(unesc(t[1]));
      notes = parts.join(' ').trim();
    }
    const body = lines.length
      ? lines.map((l, k) => (k === 0 ? `**${l}**` : `- ${l}`)).join('\n')
      : '_(pas de texte)_';
    out.push(`## Diapositive ${i + 1}\n\n${body}${notes ? `\n\n> Notes : ${notes}` : ''}`);
  });
  return out.join('\n\n').trim();
}

module.exports = { docxToMd, xlsxToMd, pptxToMd, unesc, stripTags, mdCell };
