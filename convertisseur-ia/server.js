#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   CONNECTEUR 1/2 · « Convertisseur IA »
   Convertit n'importe quel document du PC en Markdown léger AVANT que l'IA
   ne le lise → moins de tokens, lecture plus fiable, aucune donnée envoyée
   ailleurs (tout se passe en local).
   ---------------------------------------------------------------------------
   Créateur : Oualid Messaoudi · Éditeur : Vitalink ATLS Education GmbH
   vitalink-atls-education.de · HRB 38336 Dortmund · Licence MIT · v1.0.0
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
let mcpLib;
try { mcpLib = require('./lib/mcp'); } catch (e) { mcpLib = require('../_shared/mcp'); }
const { serve } = mcpLib;
const { convertFile, statsBlock, estTokens, fmtBytes, extOf } = require('./lib/convert');

const FORMATS = 'pdf (couche texte), docx, xlsx/xlsm, pptx, csv, tsv, json, html, xml, rtf, txt, md, log + fichiers de code (js, ts, py, ps1, sql, css, yml…)';

function resolveInput(p) {
  if (!p || typeof p !== 'string') throw new Error('paramètre « chemin » manquant');
  const abs = path.resolve(p.replace(/^"+|"+$/g, ''));
  if (!fs.existsSync(abs)) throw new Error(`introuvable : ${abs}`);
  return abs;
}

function renderOne(res) {
  const head = `# ${res.name} → Markdown\n\n${statsBlock(res)}`;
  if (res.kind === 'image' || res.kind === 'unsupported' || !res.markdown) {
    return `${head}\n\n_(aucun contenu texte produit)_`;
  }
  return `${head}\n\n---\n\n${res.markdown}`;
}

// ── outils ──────────────────────────────────────────────────────────────────
const convertir_document = {
  name: 'convertir_document',
  description:
    "Convertit UN document local (PDF, Word, Excel, PowerPoint, CSV, HTML, JSON, RTF, TXT, code…) en Markdown léger, prêt à lire par l'IA, et affiche l'économie de tokens. À utiliser AVANT de lire un document lourd. Si le PDF est un scan, l'outil le dit et renvoie vers le connecteur OCR.",
  inputSchema: {
    type: 'object',
    properties: {
      chemin: { type: 'string', description: 'Chemin complet du fichier, ex. C:\\Users\\lidom\\Desktop\\facture.pdf' },
      max_chars: { type: 'number', description: 'Longueur maximale du Markdown renvoyé (défaut 120000, 0 = illimité)' },
      page_debut: { type: 'number', description: 'PDF uniquement : première page à extraire' },
      page_fin: { type: 'number', description: 'PDF uniquement : dernière page à extraire' },
    },
    required: ['chemin'],
  },
  async run(a) {
    const abs = resolveInput(a.chemin);
    const res = await convertFile(abs, {
      maxChars: a.max_chars,
      firstPage: a.page_debut,
      lastPage: a.page_fin,
    });
    return renderOne(res);
  },
};

const apercu_document = {
  name: 'apercu_document',
  description:
    "Aperçu bon marché d'un document : type, taille, nombre de tokens estimé avant/après conversion et les premiers caractères. Sert à décider s'il faut tout convertir ou seulement quelques pages.",
  inputSchema: {
    type: 'object',
    properties: {
      chemin: { type: 'string', description: 'Chemin complet du fichier' },
      chars: { type: 'number', description: 'Nombre de caractères d\'aperçu (défaut 1500)' },
    },
    required: ['chemin'],
  },
  async run(a) {
    const abs = resolveInput(a.chemin);
    const res = await convertFile(abs, { maxChars: 0, firstPage: 1, lastPage: 3 });
    const n = a.chars || 1500;
    const extrait = res.markdown ? res.markdown.slice(0, n) : '_(aucun texte)_';
    return `# Aperçu · ${res.name}\n\n${statsBlock(res)}\n\n---\n\n${extrait}${res.markdown && res.markdown.length > n ? '\n\n_[aperçu tronqué — utilise convertir_document pour tout]_' : ''}`;
  },
};

const convertir_dossier = {
  name: 'convertir_dossier',
  description:
    "Convertit TOUS les documents d'un dossier en un seul Markdown (avec un titre par fichier). Idéal pour donner un dossier entier à l'IA sans exploser les tokens.",
  inputSchema: {
    type: 'object',
    properties: {
      dossier: { type: 'string', description: 'Chemin du dossier, ex. C:\\Users\\lidom\\Desktop\\Declarations' },
      filtre: { type: 'string', description: 'Filtre simple sur le nom, ex. "2026" ou ".pdf" (optionnel)' },
      recursif: { type: 'boolean', description: 'Inclure les sous-dossiers (défaut false)' },
      max_fichiers: { type: 'number', description: 'Nombre maximum de fichiers (défaut 25)' },
      max_chars_par_fichier: { type: 'number', description: 'Coupe chaque fichier à N caractères (défaut 20000)' },
    },
    required: ['dossier'],
  },
  async run(a) {
    const dir = resolveInput(a.dossier);
    if (!fs.statSync(dir).isDirectory()) throw new Error(`${dir} n'est pas un dossier`);
    const maxFiles = a.max_fichiers || 25;
    const maxChars = a.max_chars_par_fichier == null ? 20000 : a.max_chars_par_fichier;

    const files = [];
    (function walk(d, depth) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (files.length >= maxFiles * 4) return;
        const full = path.join(d, e.name);
        if (e.isDirectory()) { if (a.recursif && depth < 4) walk(full, depth + 1); continue; }
        if (a.filtre && !e.name.toLowerCase().includes(String(a.filtre).toLowerCase())) continue;
        files.push(full);
      }
    })(dir, 0);

    const chosen = files.slice(0, maxFiles);
    if (!chosen.length) return `Aucun fichier trouvé dans ${dir}${a.filtre ? ` (filtre « ${a.filtre} »)` : ''}.`;

    const parts = [];
    let tokensIn = 0;
    let tokensOut = 0;
    const ignores = [];
    for (const f of chosen) {
      try {
        const res = await convertFile(f, { maxChars });
        tokensIn += Math.ceil(res.bytesBefore / 4);
        tokensOut += estTokens(res.markdown);
        if (!res.markdown) { ignores.push(`${res.name} — ${res.note || 'aucun texte'}`); continue; }
        parts.push(`## ${res.name}\n\n${res.note ? `_${res.note}_\n\n` : ''}${res.markdown}`);
      } catch (err) {
        ignores.push(`${path.basename(f)} — ${err.message}`);
      }
    }

    const head = `# Dossier ${path.basename(dir)} → Markdown\n\n> ${chosen.length} fichier(s) traité(s) sur ${files.length} trouvé(s) · ~${tokensIn.toLocaleString('fr-FR')} → **~${tokensOut.toLocaleString('fr-FR')} tokens**`;
    const skip = ignores.length ? `\n\n### Non convertis\n${ignores.map((i) => `- ${i}`).join('\n')}` : '';
    return `${head}${skip}\n\n---\n\n${parts.join('\n\n---\n\n')}`;
  },
};

const enregistrer_markdown = {
  name: 'enregistrer_markdown',
  description:
    "Convertit un document et enregistre le résultat en fichier .md sur le disque (par défaut à côté du fichier d'origine). Utile pour garder une version légère réutilisable.",
  inputSchema: {
    type: 'object',
    properties: {
      chemin: { type: 'string', description: 'Chemin complet du fichier à convertir' },
      dossier_sortie: { type: 'string', description: 'Dossier de destination (défaut : celui du fichier)' },
    },
    required: ['chemin'],
  },
  async run(a) {
    const abs = resolveInput(a.chemin);
    const res = await convertFile(abs, { maxChars: 0 });
    if (!res.markdown) throw new Error(`rien à enregistrer : ${res.note || 'aucun texte extrait'}`);
    const outDir = a.dossier_sortie ? path.resolve(a.dossier_sortie) : path.dirname(abs);
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, path.basename(abs, path.extname(abs)) + '.md');
    fs.writeFileSync(out, `# ${res.name}\n\n${res.markdown}\n`, 'utf8');
    return `✅ Enregistré : ${out}\n\n${statsBlock(res)}`;
  },
};

const formats_supportes = {
  name: 'formats_supportes',
  description: 'Liste les formats que ce connecteur sait convertir et rappelle quoi faire pour les scans et les images.',
  inputSchema: { type: 'object', properties: {} },
  run() {
    return [
      '# Convertisseur IA · formats gérés',
      '',
      `**Texte / bureautique :** ${FORMATS}`,
      '',
      '**Cas particuliers**',
      "- PDF scanné (image) → aucun texte à extraire : utilise le connecteur « OCR & Images » → `ocr_pdf`.",
      "- Photo / capture d'écran → `ocr_image` du connecteur OCR, ou donne l'image directement à Claude.",
      '- Ancien `.doc` / `.xls` / `.ppt` → ré-enregistre en `.docx` / `.xlsx` / `.pptx`.',
      '- `.zip` → à décompresser d\'abord (une archive n\'est pas lisible telle quelle par une IA).',
      '',
      '**Astuce tokens** : ~4 caractères = 1 token. Un PDF de 2 Mo « brut » ≈ 500 000 tokens estimés ;',
      'converti en Markdown il tombe souvent sous 5 000 tokens.',
    ].join('\n');
  },
};

serve({
  name: 'convertisseur-ia',
  title: 'Convertisseur IA — documents → Markdown',
  version: '1.0.0',
  publisher: 'Vitalink ATLS Education GmbH',
  author: 'Oualid Messaoudi',
  websiteUrl: 'https://vitalink-atls-education.de',
  instructions:
    "Connecteur « Convertisseur IA » — créateur : Oualid Messaoudi, éditeur : Vitalink ATLS Education GmbH (vitalink-atls-education.de). Convertit les documents locaux en Markdown léger AVANT lecture par l'IA. Réflexe conseillé : enregistrer_markdown pour produire un .md à côté de l'original, sans recopier le contenu dans la conversation. Pour un PDF scanné ou une photo, utiliser le connecteur « OCR & Images » du même éditeur.",
  tools: [convertir_document, apercu_document, convertir_dossier, enregistrer_markdown, formats_supportes],
});
