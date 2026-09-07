#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   CONNECTEUR 2/2 · « OCR & Images »
   Lit les PDF SCANNÉS et les photos/captures d'écran avec l'OCR intégré à
   Windows (Windows.Media.Ocr) : 100 % local, hors ligne, gratuit, rien à
   installer. Sert de complément au connecteur « Convertisseur IA » quand un
   document n'a pas de couche texte.
   ---------------------------------------------------------------------------
   Créateur : Oualid Messaoudi · Éditeur : Vitalink ATLS Education GmbH
   vitalink-atls-education.de · HRB 38336 Dortmund · Licence MIT · v1.0.0
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
let mcpLib;
try { mcpLib = require('./lib/mcp'); } catch (e) { mcpLib = require('../_shared/mcp'); }
const { serve, log } = mcpLib;

const PS1 = path.join(__dirname, 'win-ocr.ps1');
const PS_EXE = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'powershell.exe';

const estTokens = (s) => Math.ceil((s || '').length / 4);
const visionTokens = (w, h) => Math.ceil((w * h) / 750); // formule vision Anthropic
const fmtBytes = (n) => (n < 1024 ? `${n} o` : n < 1048576 ? `${(n / 1024).toFixed(1)} Ko` : `${(n / 1048576).toFixed(2)} Mo`);

function resolveInput(p) {
  if (!p || typeof p !== 'string') throw new Error('paramètre « chemin » manquant');
  const abs = path.resolve(p.replace(/^"+|"+$/g, ''));
  if (!fs.existsSync(abs)) throw new Error(`introuvable : ${abs}`);
  return abs;
}

function runPs(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      PS_EXE,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1, ...args],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs || 600000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          const msg = (stderr || err.message || '').trim().split('\n').slice(0, 4).join(' ');
          return reject(new Error(`OCR Windows : ${msg || 'échec inconnu'}`));
        }
        const line = String(stdout).trim().split('\n').filter((l) => l.trim().startsWith('{')).pop();
        if (!line) return reject(new Error(`réponse OCR illisible : ${String(stdout).slice(0, 300)}`));
        try { resolve(JSON.parse(line)); } catch (e) { reject(new Error(`JSON OCR invalide : ${e.message}`)); }
      }
    );
  });
}

const cleanOcr = (t) =>
  String(t || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// ── outils ──────────────────────────────────────────────────────────────────
const ocr_image = {
  name: 'ocr_image',
  description:
    "Lit le texte d'une image (photo, capture d'écran, scan JPG/PNG/TIFF/BMP) avec l'OCR local de Windows et renvoie le texte propre. À utiliser quand un document est une image et non du texte.",
  inputSchema: {
    type: 'object',
    properties: {
      chemin: { type: 'string', description: "Chemin complet de l'image, ex. C:\\Users\\lidom\\Desktop\\facture.jpg" },
      langue: { type: 'string', description: 'auto (défaut, teste les langues installées et garde le meilleur résultat), de, fr…' },
    },
    required: ['chemin'],
  },
  async run(a) {
    const abs = resolveInput(a.chemin);
    const r = await runPs(['-Mode', 'image', '-File', abs, '-Lang', a.langue || 'auto'], 120000);
    const texte = cleanOcr(r.texte);
    const vis = visionTokens(r.largeur, r.hauteur);
    const txt = estTokens(texte);
    const head = [
      `# OCR · ${path.basename(abs)}`,
      '',
      `> ${r.largeur}×${r.hauteur} px · langue **${r.langue}** · ${texte.length} caractères`,
      `> Envoyer l'image à l'IA ≈ **${vis.toLocaleString('fr-FR')} tokens** · envoyer ce texte ≈ **${txt.toLocaleString('fr-FR')} tokens**`,
      texte ? '' : "> ⚠️ Aucun texte reconnu : image trop floue, trop petite, ou sans texte. Essaie `optimiser_image` puis relance, ou donne l'image directement à Claude.",
    ].filter((l) => l !== null).join('\n');
    return `${head}\n\n---\n\n${texte || '_(vide)_'}`;
  },
};

const ocr_pdf = {
  name: 'ocr_pdf',
  description:
    "Lit un PDF SCANNÉ (sans couche texte) : chaque page est rendue en image puis passée à l'OCR local de Windows. Renvoie le texte page par page. Pour un PDF normal (avec texte), utiliser plutôt convertir_document du connecteur « Convertisseur IA », plus rapide et plus fidèle.",
  inputSchema: {
    type: 'object',
    properties: {
      chemin: { type: 'string', description: 'Chemin complet du PDF' },
      pages: { type: 'string', description: 'Pages à lire, ex. "1", "1-3", "1,4,7-9". Vide = toutes (attention au temps : ~1 s/page)' },
      langue: { type: 'string', description: 'auto (défaut), de, fr…' },
      qualite: { type: 'number', description: "Facteur de rendu avant OCR : 2 = défaut (~144 dpi), 3 pour les petits caractères" },
    },
    required: ['chemin'],
  },
  async run(a) {
    const abs = resolveInput(a.chemin);
    if (path.extname(abs).toLowerCase() !== '.pdf') throw new Error(`${path.basename(abs)} n'est pas un PDF`);
    const scale = Math.min(4, Math.max(1, a.qualite || 2));
    const r = await runPs(
      ['-Mode', 'pdf', '-File', abs, '-Lang', a.langue || 'auto', '-Pages', a.pages || '', '-Scale', String(scale)],
      900000
    );
    const pages = Array.isArray(r.pages) ? r.pages : [r.pages].filter(Boolean);
    const blocs = pages.map((p) => `## Page ${p.page}\n\n${cleanOcr(p.texte) || '_(aucun texte reconnu)_'}`);
    const total = pages.reduce((n, p) => n + estTokens(cleanOcr(p.texte)), 0);
    const head = [
      `# OCR · ${path.basename(abs)}`,
      '',
      `> ${pages.length} page(s) lue(s) sur ${r.total_pages} · langue **${pages[0] ? pages[0].langue : '?'}** · rendu ×${scale}`,
      `> Texte extrait ≈ **${total.toLocaleString('fr-FR')} tokens** (au lieu d'envoyer ${pages.length} image(s) ≈ ${(pages.length * 1500).toLocaleString('fr-FR')} tokens)`,
      pages.length < r.total_pages ? `> ℹ️ Pages non lues : relance avec pages="${pages.length + 1}-${r.total_pages}".` : null,
      '',
      "> ⚠️ Un OCR n'est jamais parfait (chiffres, tampons, écriture manuscrite) : vérifie les montants et numéros importants sur l'original.",
    ].filter((l) => l !== null).join('\n');
    return `${head}\n\n---\n\n${blocs.join('\n\n')}`;
  },
};

const optimiser_image = {
  name: 'optimiser_image',
  description:
    "Réduit une image à la taille optimale pour la vision de Claude (bord max 1568 px, JPEG) : jusqu'à 80 % de tokens image en moins sans perte de lisibilité. Renvoie le chemin de l'image allégée, à joindre ensuite au chat.",
  inputSchema: {
    type: 'object',
    properties: {
      chemin: { type: 'string', description: "Chemin complet de l'image d'origine" },
      bord_max: { type: 'number', description: 'Taille maximale du plus grand côté en pixels (défaut 1568)' },
      qualite: { type: 'number', description: 'Qualité JPEG 1-100 (défaut 80)' },
      sortie: { type: 'string', description: 'Chemin du fichier de sortie (défaut : à côté de l\'original, suffixe _ia.jpg)' },
    },
    required: ['chemin'],
  },
  async run(a) {
    const abs = resolveInput(a.chemin);
    const args = ['-Mode', 'resize', '-File', abs, '-MaxEdge', String(a.bord_max || 1568), '-Quality', String(a.qualite || 80)];
    if (a.sortie) args.push('-Out', path.resolve(a.sortie));
    const r = await runPs(args, 120000);
    const before = visionTokens(r.largeur_avant, r.hauteur_avant);
    const after = visionTokens(r.largeur_apres, r.hauteur_apres);
    const gain = before > 0 ? Math.round((1 - after / before) * 100) : 0;
    return [
      `# Image optimisée pour l'IA`,
      '',
      `- Source : ${r.source}`,
      `- **Sortie : ${r.sortie}**`,
      `- Dimensions : ${r.largeur_avant}×${r.hauteur_avant} → ${r.largeur_apres}×${r.hauteur_apres}`,
      `- Poids : ${fmtBytes(r.octets_avant)} → ${fmtBytes(r.octets_apres)}`,
      `- Tokens vision estimés : ~${before.toLocaleString('fr-FR')} → **~${after.toLocaleString('fr-FR')}** (−${gain} %)`,
      '',
      gain === 0
        ? "_L'image était déjà à la bonne taille : seul le poids du fichier change._"
        : '_Joins maintenant le fichier de sortie au chat plutôt que l\'original._',
    ].join('\n');
  },
};

const langues_ocr = {
  name: 'langues_ocr',
  description: "Liste les langues OCR installées dans Windows et explique comment en ajouter une.",
  inputSchema: { type: 'object', properties: {} },
  async run() {
    const r = await runPs(['-Mode', 'langs'], 60000);
    const langs = r.langues || [];
    return [
      '# Langues OCR disponibles (moteur Windows, local et gratuit)',
      '',
      langs.length ? langs.map((l) => `- \`${l}\``).join('\n') : '_aucune_',
      '',
      '**En ajouter une** : Paramètres Windows → Heure et langue → Langue et région → « Ajouter une langue »,',
      "puis dans les options de la langue, cocher **Reconnaissance optique de caractères (OCR)**.",
      '',
      "`langue: \"auto\"` teste toutes les langues installées et garde le meilleur résultat (utile pour tes documents allemands et français).",
    ].join('\n');
  },
};

if (process.platform !== 'win32') log('[ocr-images] attention : ce connecteur utilise l\'OCR de Windows et ne fonctionne que sous Windows.');

serve({
  name: 'ocr-images',
  title: 'OCR & Images — scans et photos → texte',
  version: '1.0.0',
  publisher: 'Vitalink ATLS Education GmbH',
  author: 'Oualid Messaoudi',
  websiteUrl: 'https://vitalink-atls-education.de',
  instructions:
    "Connecteur « OCR & Images » — créateur : Oualid Messaoudi, éditeur : Vitalink ATLS Education GmbH (vitalink-atls-education.de). OCR 100 % local via les API Windows : PDF scannés, photos, captures d'écran, plus l'allègement d'images pour la vision. Complète le connecteur « Convertisseur IA » du même éditeur.",
  tools: [ocr_image, ocr_pdf, optimiser_image, langues_ocr],
});
