/* ═══════════════════════════════════════════════════════════════════════════
   pdftext.js · extraction de la couche texte d'un PDF
   1) pdf.js (pdfjs-dist) si installé  → qualité maximale
   2) sinon repli 100 % intégré (zlib + opérateurs de texte)
   Si le PDF est un scan (pas de texte), on le signale : il faut l'OCR.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const zlib = require('node:zlib');

const MIN_CHARS_PER_PAGE = 40; // en dessous → page considérée comme image/scan

async function viaPdfjs(buf, opts) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;

  const first = Math.max(1, opts.firstPage || 1);
  const last = Math.min(doc.numPages, opts.lastPage || doc.numPages);
  const pages = [];
  for (let n = first; n <= last; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    let line = '';
    const lines = [];
    for (const item of tc.items) {
      if (item.str) line += item.str;
      if (item.hasEOL) { lines.push(line.trim()); line = ''; }
    }
    if (line.trim()) lines.push(line.trim());
    pages.push(lines.join('\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
    page.cleanup();
  }
  await doc.destroy();
  return { pages, engine: 'pdf.js', numPages: doc.numPages };
}

// ── repli intégré ───────────────────────────────────────────────────────────
function decodePdfString(s) {
  // littéral (….) avec échappements
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const n = s[++i];
    if (n === 'n') out += '\n';
    else if (n === 'r') out += '\r';
    else if (n === 't') out += '\t';
    else if (n === 'b' || n === 'f') out += ' ';
    else if (n >= '0' && n <= '7') {
      let oct = n;
      while (oct.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') oct += s[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else out += n;
  }
  return out;
}

function textFromContentStream(str) {
  const parts = [];
  // (…)Tj · (…)' · [(…)…]TJ · ET/Td → sauts de ligne
  const re = /\((?:\\.|[^\\()])*\)|<[0-9a-fA-F\s]+>|\bT[Jj*]\b|\bTd\b|\bTD\b|\bET\b|\bT\*/g;
  let m;
  let line = '';
  while ((m = re.exec(str))) {
    const tok = m[0];
    if (tok.startsWith('(')) {
      line += decodePdfString(tok.slice(1, -1));
    } else if (tok.startsWith('<')) {
      const hex = tok.slice(1, -1).replace(/\s+/g, '');
      // hexa 2 octets = CID non résolvable sans la table de police → on ignore
      if (hex.length % 2 === 0 && hex.length <= 4) {
        for (let i = 0; i < hex.length; i += 2) line += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
      }
    } else if (tok === 'ET' || tok === 'Td' || tok === 'TD' || tok === 'T*') {
      if (line.trim()) { parts.push(line.trim()); line = ''; }
    }
  }
  if (line.trim()) parts.push(line.trim());
  return parts.join('\n');
}

function viaFallback(buf) {
  const latin = buf.toString('latin1');
  const chunks = [];
  const re = /stream\r?\n?/g;
  let m;
  while ((m = re.exec(latin))) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) continue;
    const raw = buf.subarray(start, end);
    let data = null;
    try { data = zlib.inflateSync(raw); } catch { /* flux non compressé ou autre filtre */ }
    if (!data) { try { data = zlib.inflateRawSync(raw); } catch { data = null; } }
    const s = (data || raw).toString('latin1');
    if (!/\bBT\b/.test(s) || !/\bT[Jj]\b/.test(s)) continue; // pas un flux de contenu texte
    const t = textFromContentStream(s);
    if (t) chunks.push(t);
    re.lastIndex = end;
  }
  return { pages: chunks, engine: 'repli intégré', numPages: chunks.length };
}

async function pdfToText(buf, opts = {}) {
  let res;
  try {
    res = await viaPdfjs(buf, opts);
  } catch (err) {
    res = viaFallback(buf);
    res.warning = `pdf.js indisponible (${err && err.message}) → repli intégré, qualité réduite`;
  }
  const total = res.pages.join('').replace(/\s/g, '').length;
  const scanned = res.pages.length > 0 && total / res.pages.length < MIN_CHARS_PER_PAGE;
  const md = res.pages
    .map((p, i) => `## Page ${i + 1}\n\n${p || '_(aucun texte : page image / scannée)_'}`)
    .join('\n\n');
  return { markdown: md.trim(), scanned, engine: res.engine, numPages: res.numPages, warning: res.warning };
}

module.exports = { pdfToText };
