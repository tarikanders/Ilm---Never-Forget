import JSZip from "jszip";
import { convert } from "html-to-text";

/**
 * Extrait le texte d'un fichier EPUB.
 *
 * Un EPUB est une archive ZIP. On la lit directement (plus fiable que l'API
 * événementielle d'epub2) : META-INF/container.xml -> OPF -> spine (ordre de
 * lecture) -> chaque document (X)HTML -> texte brut.
 */
export const extractTextFromEpub = async (buffer: Buffer): Promise<string> => {
  const zip = await JSZip.loadAsync(buffer);

  const readText = async (zipPath: string): Promise<string> => {
    const file = zip.file(zipPath);
    return file ? file.async("text") : "";
  };

  // Résout un href relatif (gère ./ et ../) par rapport au dossier de l'OPF.
  const resolvePath = (baseDir: string, relative: string): string => {
    const parts = baseDir ? baseDir.split("/") : [];
    const rel = decodeURIComponent(relative.split("#")[0]).split("/");
    for (const part of rel) {
      if (part === "" || part === ".") continue;
      if (part === "..") parts.pop();
      else parts.push(part);
    }
    return parts.join("/");
  };

  // 1) Localiser l'OPF via META-INF/container.xml (repli sur n'importe quel .opf).
  let opfPath =
    (await readText("META-INF/container.xml")).match(/full-path="([^"]+)"/i)?.[1] || "";
  if (!opfPath) {
    opfPath = Object.keys(zip.files).find((p) => p.toLowerCase().endsWith(".opf")) || "";
  }
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";

  // 2) Lire le manifest (id -> href des documents (x)html) puis le spine (ordre).
  let orderedHrefs: string[] = [];
  if (opfPath) {
    const opf = await readText(opfPath);
    const manifest: Record<string, string> = {};
    for (const tag of opf.match(/<item\b[^>]*>/gi) || []) {
      const id = tag.match(/\bid="([^"]+)"/i)?.[1];
      const href = tag.match(/\bhref="([^"]+)"/i)?.[1];
      const mediaType = tag.match(/\bmedia-type="([^"]+)"/i)?.[1] || "";
      if (id && href && /xhtml|html/i.test(mediaType)) manifest[id] = href;
    }
    for (const tag of opf.match(/<itemref\b[^>]*>/gi) || []) {
      const idref = tag.match(/\bidref="([^"]+)"/i)?.[1];
      if (idref && manifest[idref]) orderedHrefs.push(resolvePath(opfDir, manifest[idref]));
    }
  }

  // 3) Repli : si aucun spine exploitable, prendre tous les (x)html de l'archive.
  if (orderedHrefs.length === 0) {
    orderedHrefs = Object.keys(zip.files)
      .filter((p) => /\.x?html?$/i.test(p))
      .sort();
  }

  let fullText = "";
  for (const href of orderedHrefs) {
    const html = await readText(href);
    if (!html) continue;
    const text = convert(html, { wordwrap: false }).trim();
    if (text) fullText += text + "\n\n";
  }

  return fullText.trim();
};
