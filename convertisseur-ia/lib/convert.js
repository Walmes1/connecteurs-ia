/* ═══════════════════════════════════════════════════════════════════════════
   convert.js · aiguillage « n'importe quel fichier → Markdown léger pour l'IA »
   Reprend la stratégie du Convertisseur IA du Bureau, côté serveur (Node).
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { docxToMd, xlsxToMd, pptxToMd, unesc } = require('./office');
const { pdfToText } = require('./pdftext');

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic'];
const CODE_EXTS = ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'ps1', 'sh', 'bat', 'sql', 'css', 'scss', 'yml', 'yaml', 'ini', 'toml', 'java', 'c', 'cpp', 'cs', 'php', 'rb', 'go', 'rs'];

const estTokens = (s) => Math.ceil((s || '').length / 4);
const fmtBytes = (n) => (n < 1024 ? `${n} o` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} Ko` : `${(n / 1048576).toFixed(2)} Mo`);
const extOf = (p) => (path.extname(p) || '').replace('.', '').toLowerCase();

// ── texte brut ──────────────────────────────────────────────────────────────
function tidy(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{3,}/g, '  ')
    .trim();
}

// ── HTML → Markdown (mini-Turndown intégré) ─────────────────────────────────
function htmlToMd(html) {
  let s = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(br)\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n');

  for (let h = 1; h <= 6; h++) {
    s = s.replace(new RegExp(`<h${h}[^>]*>([\\s\\S]*?)</h${h}>`, 'gi'), (_, t) => `\n\n${'#'.repeat(h)} ${strip(t)}\n\n`);
  }
  s = s
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `- ${strip(t)}\n`)
    .replace(/<\/(ul|ol|p|div|tr|table|section|article)>/gi, '\n\n')
    .replace(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi, (_, t) => `${strip(t)} | `)
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => `**${strip(t)}**`)
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => `*${strip(t)}*`)
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, t) => '`' + strip(t) + '`')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => {
      const label = strip(t);
      return label ? `[${label}](${href})` : '';
    });

  return tidy(unesc(s.replace(/<[^>]+>/g, ' ')));

  function strip(t) { return unesc(String(t).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }
}

// ── CSV → tableau Markdown ──────────────────────────────────────────────────
function detectDelim(text) {
  const line = text.split('\n').find((l) => l.trim()) || '';
  const counts = [[';', line.split(';').length], [',', line.split(',').length], ['\t', line.split('\t').length], ['|', line.split('|').length]];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ',';
}

function parseCsv(text, delim) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === delim) { row.push(cell); cell = ''; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    if (c === '\r') continue;
    cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim()));
}

function csvToMd(text) {
  const rows = parseCsv(text, detectDelim(text));
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const esc = (v) => String(v == null ? '' : v).replace(/\|/g, '\\|').trim();
  const pad = (r) => { const x = r.slice(); while (x.length < width) x.push(''); return x.map(esc); };
  const out = [`| ${pad(rows[0]).join(' | ')} |`, `| ${Array(width).fill('---').join(' | ')} |`];
  for (const r of rows.slice(1)) out.push(`| ${pad(r).join(' | ')} |`);
  return out.join('\n');
}

// ── RTF → texte ─────────────────────────────────────────────────────────────
function rtfToText(rtf) {
  const BS = String.fromCharCode(92); // antislash
  let s = String(rtf)
    .replace(new RegExp(BS + "'([0-9a-fA-F]{2})", 'g'), (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(new RegExp(BS + 'par[d]?', 'g'), '\n')
    .replace(new RegExp(BS + '[a-zA-Z]+-?[0-9]*[ ]?', 'g'), '')
    .replace(/[{}]/g, '');
  return tidy(s);
}

// ── JSON ────────────────────────────────────────────────────────────────────
function jsonToMd(text) {
  try {
    return '```json\n' + JSON.stringify(JSON.parse(text), null, 1) + '\n```';
  } catch {
    return '```\n' + tidy(text) + '\n```';
  }
}

// ── conversion d'un fichier ─────────────────────────────────────────────────
async function convertFile(filePath, opts = {}) {
  const maxChars = opts.maxChars == null ? 120000 : opts.maxChars;
  const abs = path.resolve(filePath);
  const st = fs.statSync(abs);
  if (st.isDirectory()) throw new Error(`${abs} est un dossier (utilise convertir_dossier)`);
  const ext = extOf(abs);
  const name = path.basename(abs);

  const res = { name, path: abs, ext, bytesBefore: st.size, kind: 'text', scanned: false, note: '' };

  if (IMAGE_EXTS.includes(ext)) {
    res.kind = 'image';
    res.markdown = '';
    res.note = "Image : aucun texte à extraire ici → utilise le connecteur « OCR & Images » (ocr_image) pour en tirer le texte, ou donne l'image directement à Claude (il lit les images).";
    return res;
  }

  const buf = fs.readFileSync(abs);

  switch (ext) {
    case 'pdf': {
      const r = await pdfToText(buf, opts);
      res.markdown = r.markdown;
      res.scanned = r.scanned;
      res.note = (r.warning ? r.warning + ' · ' : '') +
        (r.scanned
          ? "PDF SCANNÉ (pas de couche texte) → utilise le connecteur « OCR & Images » : ocr_pdf sur ce fichier."
          : `couche texte extraite (${r.numPages} page(s), moteur ${r.engine})`);
      break;
    }
    case 'docx': res.markdown = docxToMd(buf); break;
    case 'xlsx': case 'xlsm': res.markdown = xlsxToMd(buf, opts); break;
    case 'pptx': res.markdown = pptxToMd(buf); break;
    case 'doc': case 'xls': case 'ppt':
      throw new Error(`ancien format Office « .${ext} » non géré : ré-enregistre en .${ext}x (ou en PDF) puis relance.`);
    case 'csv': case 'tsv': res.markdown = csvToMd(buf.toString('utf8')); break;
    case 'json': res.markdown = jsonToMd(buf.toString('utf8')); break;
    case 'html': case 'htm': case 'xhtml': res.markdown = htmlToMd(buf.toString('utf8')); break;
    case 'xml': res.markdown = tidy(unesc(buf.toString('utf8').replace(/<[^>]+>/g, ' '))); break;
    case 'rtf': res.markdown = rtfToText(buf.toString('latin1')); break;
    case 'md': case 'markdown': case 'txt': case 'log': res.markdown = tidy(buf.toString('utf8')); break;
    default:
      if (CODE_EXTS.includes(ext)) {
        res.markdown = '```' + ext + '\n' + buf.toString('utf8') + '\n```';
      } else {
        // dernier recours : on tente le texte brut si le fichier n'est pas binaire
        const sample = buf.subarray(0, 4096).toString('utf8');
        let weird = 0;
        for (let i = 0; i < sample.length; i++) {
          const c = sample.charCodeAt(i);
          if (c === 0 || c === 0xfffd || c < 9 || (c > 13 && c < 32)) weird++;
        }
        const binaryRatio = weird / Math.max(1, sample.length);
        if (binaryRatio > 0.05) {
          res.kind = 'unsupported';
          res.markdown = '';
          res.note = `format « .${ext} » non géré (fichier binaire). Formats gérés : pdf, docx, xlsx, pptx, csv, json, html, xml, rtf, txt, md + fichiers de code.`;
          return res;
        }
        res.markdown = tidy(sample.length < buf.length ? buf.toString('utf8') : sample);
      }
  }

  res.markdown = (res.markdown || '').trim();
  if (maxChars > 0 && res.markdown.length > maxChars) {
    res.truncated = res.markdown.length;
    res.markdown = res.markdown.slice(0, maxChars) + `\n\n_[… coupé à ${maxChars} caractères sur ${res.truncated}. Relance avec max_chars plus grand ou convertis par tranches.]_`;
  }
  return res;
}

function statsBlock(res) {
  const tIn = Math.ceil(res.bytesBefore / 4);
  const tOut = estTokens(res.markdown);
  const saved = tIn > 0 ? Math.max(0, Math.round((1 - tOut / tIn) * 100)) : 0;
  return `> **${res.name}** · ${fmtBytes(res.bytesBefore)} → ${fmtBytes(Buffer.byteLength(res.markdown || '', 'utf8'))} · ~${tIn.toLocaleString('fr-FR')} → **~${tOut.toLocaleString('fr-FR')} tokens** (−${saved} %)${res.note ? `\n> ℹ️ ${res.note}` : ''}`;
}

module.exports = { convertFile, statsBlock, estTokens, fmtBytes, extOf, IMAGE_EXTS };
