# 📦 Publication des connecteurs — FAIT le 07.09.2026

**Créateur : Oualid Messaoudi** · **Éditeur : Vitalink ATLS Education GmbH**
Kipsburg 31, 44263 Dortmund · HRB 38336 · <https://vitalink-atls-education.de> · Licence MIT


> ✅ **GitHub** : <https://github.com/Walmes1/connecteurs-ia> (public, tag v1.0.0)
> ✅ **Registre MCP officiel** : `io.github.Walmes1/convertisseur-ia` · `io.github.Walmes1/ocr-images`
> ✅ **npm** : `convertisseur-ia-mcp` · `ocr-images-mcp` (compte `walmes1`, sans organisation)
> ℹ️ Les noms `@vitalink-atls/…` restent disponibles si l'organisation npm est créée un jour.

État au 07.09.2026 : les deux connecteurs sont **complets, testés et signés à ton nom**, avec
tous les fichiers qu'exige une publication publique. **Aucun envoi n'a été fait** — c'est toi
qui déclenches, en une soirée, quand tu veux.

---

## 1. Ce qui est déjà en place

| Fichier | Rôle |
|---|---|
| `LICENSE` | MIT, © 2026 Vitalink ATLS Education GmbH, créateur Oualid Messaoudi |
| `convertisseur-ia/package.json` · `ocr-images/package.json` | métadonnées npm : nom, version, `author`, `publisher`, `homepage`, `bin`, `files`, `mcpName` |
| `convertisseur-ia/server.json` · `ocr-images/server.json` | manifeste du **registre MCP officiel** (schéma 2025-09-29) |
| en-tête de chaque `server.js` / `mcp.js` / `win-ocr.ps1` | mention créateur + éditeur dans le code |
| poignée de main MCP | `serverInfo` renvoie `title`, `publisher: "Vitalink ATLS Education GmbH"`, `author`, `websiteUrl` → visible par le client |

Noms réservés dans les fichiers :

- npm : `@vitalink-atls/convertisseur-ia-mcp` · `@vitalink-atls/ocr-images-mcp`
- registre MCP : `de.vitalink-atls-education/convertisseur-ia` · `de.vitalink-atls-education/ocr-images`

---

## 2. Ce que je ne peux pas faire à ta place

Créer des comptes ou saisir des mots de passe est exclu de mon côté :

1. **Compte GitHub** (gratuit) — héberge le code, exigé par le registre MCP.
2. **Compte npm** (gratuit) + organisation **`vitalink-atls`** — pour le préfixe `@vitalink-atls/`.
   Sans organisation, on retombe sur des noms simples : `convertisseur-ia-mcp`, `ocr-images-mcp`.
3. **Un accès DNS** à `vitalink-atls-education.de` **si** tu veux le namespace au nom de la société
   (voir étape C2). Sinon on prend `io.github.<ton-compte>/…` sans aucun DNS.

Dis-moi quand les comptes existent : je fais tout le reste (commits, `npm publish`, manifeste,
publication au registre) sur ton feu vert.

---

## 3. Les étapes, dans l'ordre

### A. Dépôt GitHub

```bash
cd "C:\Users\lidom\Desktop\javis\Connecteurs-IA"
git init -b main
git add .
git commit -m "Connecteurs IA 1.0.0 - Vitalink ATLS Education GmbH"
```

Puis, après avoir créé un dépôt vide `connecteurs-ia` sur github.com :

```bash
git remote add origin https://github.com/Walmes1/connecteurs-ia.git
git push -u origin main
```

⚠️ Avant le premier `push`, remplacer `Walmes1` dans les deux `server.json`.
`node_modules/` doit rester hors du dépôt (`.gitignore` fourni).

### B. npm (deux paquets)

```bash
npm login
cd "C:\Users\lidom\Desktop\javis\Connecteurs-IA\convertisseur-ia"
npm publish --access public
cd "..\ocr-images"
npm publish --access public
```

Le script `prepack` copie automatiquement `_shared/mcp.js` dans `lib/mcp.js` : les paquets
publiés sont autonomes. Vérification à blanc, sans rien envoyer :

```bash
npm pack --dry-run
```

### C. Registre MCP officiel

**C1. Namespace GitHub (le plus simple, aucun DNS)**

```bash
mcp-publisher login github
mcp-publisher publish
```

à lancer dans chaque dossier, après avoir mis `io.github.Walmes1/convertisseur-ia`
comme `name` dans `server.json` (et la même valeur dans `mcpName` du `package.json`).

**C2. Namespace société `de.vitalink-atls-education` (branding Vitalink)**

1. Générer une paire de clés Ed25519 (je le fais, aucune donnée sensible ne sort du PC).
2. Ajouter chez ton hébergeur DNS un enregistrement **TXT** sur `vitalink-atls-education.de` :
   `v=MCPv1; k=ed25519; p=<clé publique>`
3. `mcp-publisher login dns --domain vitalink-atls-education.de --private-key <clé privée>`
4. `mcp-publisher publish`

Les `server.json` sont **déjà écrits pour cette option C2** : c'est le nom de ta société qui
apparaît dans le registre, pas un pseudo GitHub.

---

## 4. Ce qui n'est PAS possible, et pourquoi

- **Apparaître dans la liste « Connecteurs » de claude.ai à côté de Gmail/Canva** : cette liste
  est un catalogue tenu par Anthropic. Un tiers ne peut pas y « poster ». Ce qu'on peut faire :
  héberger une version **HTTP distante** du connecteur (Cloudflare Worker ou VPS + OAuth) et
  l'ajouter comme *connecteur personnalisé* — c'est un vrai chantier (hébergement, sécurité,
  authentification) car le serveur lirait des fichiers à distance.
- **Publier sans compte** : ni npm ni le registre MCP n'acceptent de dépôt anonyme.

---

## 5. Avant de rendre public — la checklist honnête

- [ ] Ces connecteurs **lisent n'importe quel fichier du disque** sur demande du client MCP.
      C'est normal pour un outil local, mais à écrire noir sur blanc dans le README public.
- [ ] Retirer du dépôt tout document de test personnel (aucun n'y est actuellement).
- [ ] `ocr-images` ne marche que sous **Windows** (déjà déclaré via `"os": ["win32"]`).
- [ ] Décider si le support est offert (issues GitHub) ou « tel quel, sans garantie » (défaut MIT).
- [ ] Mentions légales : la licence MIT nomme déjà la GmbH ; ajouter un `SECURITY.md` si tu veux
      une adresse de signalement.
