# 🔌 Connecteurs IA · Convertisseur + OCR

**Créateur : Oualid Messaoudi** · **Éditeur : Vitalink ATLS Education GmbH**
Kipsburg 31, 44263 Dortmund · HRB 38336 · [vitalink-atls-education.de](https://vitalink-atls-education.de)
v1.0.0 · licence MIT

Deux serveurs **MCP** locaux qui font lire à l'IA des documents **déjà convertis et allégés**,
au lieu de lui envoyer des PDF et des images bruts. **100 % hors ligne : aucun appel réseau.**

| Connecteur | Ce qu'il fait | Prérequis |
|---|---|---|
| **`convertisseur-ia`** | Tout document → Markdown léger (PDF avec texte, Word, Excel, PowerPoint, CSV, HTML, JSON, XML, RTF, TXT, code) + calcul de l'économie de tokens | Node.js ≥ 18 (multi-plateforme) |
| **`ocr-images`** | PDF **scannés**, photos et captures → texte, via l'OCR **intégré à Windows** · allègement d'images pour la vision | Node.js ≥ 18 + **Windows 10/11** |

Économie typique : un courrier PDF de 88 Ko passe de **~22 000 tokens estimés à ~480**, une
capture d'écran de **~945 tokens image à ~90 tokens de texte**.

---

## Installation

```bash
git clone https://github.com/Walmes1/connecteurs-ia.git
cd connecteurs-ia/convertisseur-ia
npm install
```

`ocr-images` n'a aucune dépendance : rien à installer.

Puis déclarer les deux serveurs dans le client MCP (Claude Desktop, Claude Code, Cursor,
VS Code, LM Studio…) — voir [`config-a-coller.json`](config-a-coller.json) :

```json
{
  "mcpServers": {
    "convertisseur-ia": {
      "command": "node",
      "args": ["C:\\chemin\\vers\\Connecteurs-IA\\convertisseur-ia\\server.js"]
    },
    "ocr-images": {
      "command": "node",
      "args": ["C:\\chemin\\vers\\Connecteurs-IA\\ocr-images\\server.js"]
    }
  }
}
```

Emplacements habituels du fichier de configuration :

- Claude Desktop (Windows) : `%APPDATA%\Claude\claude_desktop_config.json`
- Claude Code : `~/.claude.json`

Redémarrer le client après modification.

---

## Les outils

### `convertisseur-ia`

| Outil | Description |
|---|---|
| `convertir_document` | Un fichier → Markdown + statistiques de tokens. Options : `max_chars`, `page_debut`, `page_fin` |
| `apercu_document` | Aperçu bon marché : type, poids, tokens estimés, premiers caractères |
| `convertir_dossier` | Un dossier entier en un seul Markdown. Options : `filtre`, `recursif`, `max_fichiers` |
| `enregistrer_markdown` | Convertit et écrit un `.md` à côté de l'original |
| `formats_supportes` | Liste des formats et cas particuliers |

### `ocr-images`

| Outil | Description |
|---|---|
| `ocr_image` | Photo / capture / scan → texte. `langue` : `auto`, `de`, `fr`… |
| `ocr_pdf` | PDF scanné → texte page par page. Options : `pages` (`"1-3,7"`), `qualite` (2 par défaut, 3 pour les petits caractères) |
| `optimiser_image` | Réduit une image à 1568 px max en JPEG → jusqu'à −80 % de tokens vision |
| `langues_ocr` | Langues OCR installées dans Windows + comment en ajouter une |

### Le duo

```
document
   │
   ├─ couche texte présente ? ── oui ─▶  convertir_document   (rapide, fidèle)
   │
   └─ non (scan, photo)      ────────▶  ocr_pdf / ocr_image   (OCR Windows, ~1 s/page)
```

`convertir_document` détecte les PDF scannés et renvoie explicitement vers `ocr_pdf`.

---

## Comment ça marche

- **Office sans bibliothèque externe** : `.docx`, `.xlsx`, `.pptx` sont des archives ZIP —
  lecteur ZIP minimal basé sur le `zlib` de Node, puis conversion XML → Markdown.
- **PDF** : couche texte extraite via [pdf.js](https://mozilla.github.io/pdf.js/), avec un
  repli intégré si la bibliothèque manque.
- **OCR** : `Windows.Media.Ocr`, déjà présent dans Windows — aucun Tesseract, aucun modèle à
  télécharger, aucun compte. Les pages PDF sont rendues en image par `Windows.Data.Pdf`.
  `langue: "auto"` essaie chaque langue installée et garde le meilleur résultat.
- **Tokens** : estimation ~4 caractères = 1 token pour le texte, `largeur × hauteur / 750`
  pour les images.

---

## Confidentialité et périmètre

- Aucun appel réseau : les fichiers sont lus sur le disque, convertis en mémoire, et seul le
  Markdown obtenu arrive dans la conversation.
- **Ces serveurs lisent les fichiers locaux que le client MCP leur demande de lire**, sans
  restriction de dossier — c'est le principe d'un outil local. À n'exposer qu'à un client de
  confiance, jamais derrière un service public.
- `enregistrer_markdown` et `optimiser_image` écrivent un fichier (par défaut à côté de
  l'original) ; aucun autre outil n'écrit sur le disque.
- Un OCR n'est jamais parfait : vérifier montants, numéros et écriture manuscrite sur
  l'original.

---

## Dépannage

| Symptôme | Solution |
|---|---|
| Les connecteurs n'apparaissent pas | Client MCP non redémarré, ou `mcpServers` mal placé dans le fichier de configuration |
| « aucune langue OCR installée » | Windows → Heure et langue → Langue et région → options de la langue → cocher **OCR** |
| Un PDF est signalé « scanné » | Il n'a pas de couche texte : passer par `ocr_pdf` |
| `.doc` / `.xls` / `.ppt` refusés | Anciens formats binaires : ré-enregistrer en `.docx` / `.xlsx` / `.pptx` |
| OCR imprécis sur petits caractères | `ocr_pdf` avec `qualite: 3` |

Vérification rapide (doit lister les outils) :

```bash
echo {"jsonrpc":"2.0","id":1,"method":"tools/list"} | node convertisseur-ia/server.js
```

---

## Structure

```
Connecteurs-IA/
├── README.md · PUBLICATION.md · LICENSE · config-a-coller.json
├── _shared/mcp.js             micro-serveur MCP (stdio, 0 dépendance)
├── convertisseur-ia/
│   ├── server.js              5 outils
│   ├── server.json            manifeste registre MCP
│   └── lib/                   convert · office · zip · pdftext
└── ocr-images/
    ├── server.js              4 outils
    ├── server.json            manifeste registre MCP
    └── win-ocr.ps1            OCR Windows + rendu PDF + redimensionnement
```

---

## Licence

MIT — © 2026 **Vitalink ATLS Education GmbH**, Dortmund (HRB 38336).
Conçu et développé par **Oualid Messaoudi**.

Noms réservés pour la distribution : `@vitalink-atls/convertisseur-ia-mcp`,
`@vitalink-atls/ocr-images-mcp`, `de.vitalink-atls-education/convertisseur-ia`,
`de.vitalink-atls-education/ocr-images` — détails dans [`PUBLICATION.md`](PUBLICATION.md).
