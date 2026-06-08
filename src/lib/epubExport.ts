import JSZip from "jszip";
import { marked } from "marked";
import { SummaryData } from "../types";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Échapper les caractères XML/XHTML spéciaux dans du texte brut. */
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Convertir Markdown → HTML (synchrone, marked est sync par défaut). */
const md2html = (text: string): string => {
  if (!text) return "";
  const result = marked.parse(text, { async: false });
  return typeof result === "string" ? result : "";
};

/** Générer un slug URL-safe à partir d'un titre. */
const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "doc";

// ── Squelettes XML/XHTML ─────────────────────────────────────────────────────

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const buildOpf = (
  title: string,
  author: string,
  uid: string,
  manifestItems: string,
  spineItems: string
) => `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${esc(title)}</dc:title>
    <dc:creator>${esc(author)}</dc:creator>
    <dc:language>fr</dc:language>
    <dc:identifier id="bookid">${uid}</dc:identifier>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
  </metadata>
  <manifest>
    <item id="nav"  href="nav.xhtml"  media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx"  href="toc.ncx"    media-type="application/x-dtbncx+xml"/>
    <item id="css"  href="style.css"  media-type="text/css"/>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    ${spineItems}
  </spine>
</package>`;

const buildNav = (title: string, navPoints: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="fr" xml:lang="fr">
<head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" href="style.css"/></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table des matières</h1>
    <ol>${navPoints}</ol>
  </nav>
</body>
</html>`;

const buildNcx = (title: string, author: string, uid: string, navPoints: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${uid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${esc(title)}</text></docTitle>
  <docAuthor><text>${esc(author)}</text></docAuthor>
  <navMap>${navPoints}</navMap>
</ncx>`;

const xhtmlPage = (title: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="fr" lang="fr">
<head>
  <meta charset="utf-8"/>
  <title>${esc(title)}</title>
  <link rel="stylesheet" href="style.css"/>
</head>
<body>
${body}
</body>
</html>`;

// ── CSS ──────────────────────────────────────────────────────────────────────

const STYLE_CSS = `
/* Ilm — ePub stylesheet */
body {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1em;
  line-height: 1.75;
  color: #1a1a1a;
  margin: 1.5em 2em;
  max-width: 42em;
}
h1, h2, h3, h4 {
  font-family: "Helvetica Neue", Arial, sans-serif;
  color: #111;
  line-height: 1.3;
  margin-top: 1.6em;
  margin-bottom: 0.5em;
}
h1 { font-size: 2em;   page-break-before: always; }
h2 { font-size: 1.4em; border-bottom: 1px solid #ddd; padding-bottom: 0.3em; }
h3 { font-size: 1.15em; color: #333; }
p  { margin: 0.8em 0; orphans: 2; widows: 2; }
ul, ol { padding-left: 1.6em; margin: 0.8em 0; }
li { margin-bottom: 0.4em; }
blockquote {
  border-left: 3px solid #c9a84c;
  margin: 1.2em 0 1.2em 0;
  padding: 0.6em 1.2em;
  color: #444;
  font-style: italic;
  background: #fdf8ec;
}
.label {
  display: inline-block;
  background: #fdf8ec;
  border: 1px solid #c9a84c;
  color: #7a5c00;
  padding: 0.15em 0.6em;
  border-radius: 2em;
  font-family: "Helvetica Neue", Arial, sans-serif;
  font-size: 0.7em;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 0.8em;
}
.title-page {
  text-align: center;
  padding: 3em 1em 2em;
  page-break-after: always;
}
.title-page h1 { font-size: 2.4em; border: none; page-break-before: auto; }
.title-page .author { font-style: italic; color: #555; font-size: 1.1em; margin-top: 0.4em; }
.central-idea {
  font-size: 1.15em;
  font-style: italic;
  border-left: 3px solid #c9a84c;
  padding: 0.8em 1.2em;
  margin: 1.5em 0;
  color: #333;
}
.example-box {
  background: #fdf8ec;
  border: 1px solid #e8d49a;
  border-left: 4px solid #c9a84c;
  border-radius: 4px;
  padding: 0.8em 1.2em;
  margin: 1em 0;
}
.example-box .example-label {
  font-family: "Helvetica Neue", Arial, sans-serif;
  font-size: 0.75em;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #7a5c00;
  font-weight: bold;
  margin-bottom: 0.5em;
}
.mindmap-row {
  display: flex;
  align-items: baseline;
  padding: 0.35em 0;
  border-bottom: 1px dotted #eee;
}
.mindmap-parent { color: #888; width: 40%; text-align: right; padding-right: 0.8em; font-size: 0.9em; }
.mindmap-arrow  { color: #c9a84c; padding: 0 0.5em; }
.mindmap-child  { font-weight: 600; color: #1a1a1a; flex: 1; }
`;

// ── Builder principal ─────────────────────────────────────────────────────────

export async function buildEpubBlob(data: SummaryData): Promise<Blob> {
  const zip = new JSZip();
  const uid = `ilm-${data.id ?? Date.now()}`;

  // mimetype DOIT être le 1er fichier, non compressé
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER_XML);

  const oebps = zip.folder("OEBPS")!;
  oebps.file("style.css", STYLE_CSS);

  // ── Sections à générer ───────────────────────────────────────────────────
  type Section = { id: string; file: string; title: string; content: string };
  const sections: Section[] = [];

  const addSection = (id: string, title: string, body: string) => {
    const file = `${id}.xhtml`;
    sections.push({ id, file, title, content: xhtmlPage(title, body) });
  };

  // 1. Page de titre
  addSection(
    "title",
    data.title,
    `<div class="title-page">
      <p class="label">${esc(data.category || "Connaissances")}</p>
      <h1>${esc(data.title)}</h1>
      <p class="author">par ${esc(data.author)}</p>
    </div>`
  );

  // 2. Idée centrale
  addSection(
    "central-idea",
    "Idée Centrale",
    `<h1>Idée Centrale</h1>
    <p class="central-idea">${esc(data.centralIdea)}</p>`
  );

  // 3. Leçons pratiques
  if (data.practicalLessons?.length) {
    const items = data.practicalLessons
      .map((l, i) => `<li><strong>${i + 1}.</strong> ${esc(l)}</li>`)
      .join("\n");
    addSection(
      "lessons",
      "Leçons Pratiques",
      `<h1>Leçons Pratiques</h1><ol>${items}</ol>`
    );
  }

  // 4. Citations mémorables
  if (data.memorableQuotes?.length) {
    const quotes = data.memorableQuotes
      .map((q) => `<blockquote><p>${esc(q)}</p></blockquote>`)
      .join("\n");
    addSection(
      "quotes",
      "Citations Mémorables",
      `<h1>Citations Mémorables</h1>${quotes}`
    );
  }

  // 5. Un chapitre par concept
  for (let i = 0; i < (data.keyConcepts ?? []).length; i++) {
    const c = data.keyConcepts[i];
    const cid = `concept-${i + 1}`;
    const detailsHtml = c.details ? `<h2>Explication détaillée</h2>${md2html(c.details)}` : "";
    const exampleHtml = c.example
      ? `<div class="example-box">
          <p class="example-label">Exemple d'application</p>
          ${md2html(c.example)}
        </div>`
      : "";
    addSection(
      cid,
      c.concept,
      `<h1>${esc(c.concept)}</h1>
      <p>${esc(c.explanation)}</p>
      ${detailsHtml}
      ${exampleHtml}`
    );
  }

  // 6. Structure des connaissances (mind-map)
  if (data.mindMap?.length) {
    const rows = data.mindMap
      .map(
        (n) =>
          `<div class="mindmap-row">
            <span class="mindmap-parent">${esc(n.parent)}</span>
            <span class="mindmap-arrow">→</span>
            <span class="mindmap-child">${esc(n.child)}</span>
          </div>`
      )
      .join("\n");
    addSection(
      "mindmap",
      "Structure des Connaissances",
      `<h1>Structure des Connaissances</h1>${rows}`
    );
  }

  // ── Écrire les fichiers XHTML ────────────────────────────────────────────
  for (const s of sections) {
    oebps.file(s.file, s.content);
  }

  // ── OPF manifest + spine ─────────────────────────────────────────────────
  const manifestItems = sections
    .map((s) => `<item id="${s.id}" href="${s.file}" media-type="application/xhtml+xml"/>`)
    .join("\n    ");
  const spineItems = sections
    .map((s) => `<itemref idref="${s.id}"/>`)
    .join("\n    ");

  oebps.file("content.opf", buildOpf(data.title, data.author, uid, manifestItems, spineItems));

  // ── Navigation ───────────────────────────────────────────────────────────
  const navLi = sections
    .map((s) => `<li><a href="${s.file}">${esc(s.title)}</a></li>`)
    .join("\n      ");
  oebps.file("nav.xhtml", buildNav(data.title, navLi));

  let ncxOrder = 1;
  const ncxPoints = sections
    .map(
      (s) =>
        `<navPoint id="nav-${s.id}" playOrder="${ncxOrder++}">
      <navLabel><text>${esc(s.title)}</text></navLabel>
      <content src="${s.file}"/>
    </navPoint>`
    )
    .join("\n  ");
  oebps.file("toc.ncx", buildNcx(data.title, data.author, uid, ncxPoints));

  // ── Génération du Blob ───────────────────────────────────────────────────
  const arrayBuffer = await zip.generateAsync({ type: "arraybuffer", mimeType: "application/epub+zip" });
  return new Blob([arrayBuffer], { type: "application/epub+zip" });
}
