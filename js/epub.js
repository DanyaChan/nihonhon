"use strict";

/* ============================================================
 * EPUB: разбор container.xml / OPF, оглавление, отрисовка глав.
 * ============================================================ */

// ---------- утилиты путей внутри EPUB ----------

function dirOf(path) {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i + 1);
}

function resolvePath(base, rel) {
  rel = decodeURIComponent(rel);
  if (rel.startsWith("/")) rel = rel.slice(1);
  const parts = (dirOf(base) + rel).split("/");
  const out = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

const DC_NS = "http://purl.org/dc/elements/1.1/";

const MIME_BY_EXT = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  gif: "image/gif", svg: "image/svg+xml", webp: "image/webp",
};

// ---------- открытие книги ----------

/** container.xml -> OPF: документ, его путь и разобранный manifest. */
async function readOpf(zip) {
  const containerXml = await zip.extractText("META-INF/container.xml");
  const container = new DOMParser().parseFromString(containerXml, "application/xml");
  const rootfile = container.querySelector("rootfile");
  if (!rootfile) throw new Error("Некорректный EPUB: нет rootfile в container.xml");
  const opfPath = rootfile.getAttribute("full-path");

  const opfXml = await zip.extractText(opfPath);
  const opf = new DOMParser().parseFromString(opfXml, "application/xml");

  const manifest = new Map(); // id -> { path, type, properties }
  for (const item of opf.querySelectorAll("manifest > item")) {
    manifest.set(item.getAttribute("id"), {
      path: resolvePath(opfPath, item.getAttribute("href")),
      type: item.getAttribute("media-type") || "",
      properties: item.getAttribute("properties") || "",
    });
  }
  return { opf, opfPath, manifest };
}

async function openEpub(file) {
  const zip = new ZipArchive(await file.arrayBuffer());
  const { opf, opfPath, manifest } = await readOpf(zip);

  const title = opf.getElementsByTagNameNS(DC_NS, "title")[0]?.textContent?.trim()
    || file.name.replace(/\.epub$/i, "");

  const spinePaths = [];
  for (const ref of opf.querySelectorAll("spine > itemref")) {
    const item = manifest.get(ref.getAttribute("idref"));
    if (item) spinePaths.push(item.path);
  }
  if (!spinePaths.length) throw new Error("Некорректный EPUB: пустой spine");

  // 3. Названия глав из nav.xhtml или toc.ncx
  const titles = await loadTocTitles(zip, opf, manifest);
  const pathToIndex = new Map(spinePaths.map((p, i) => [p, i]));

  const chapters = spinePaths.map((path, i) => ({
    title: titles.get(path) || "第" + (i + 1) + "章",
    render: () => renderEpubChapter(zip, path, pathToIndex),
  }));

  loadBook({
    id: "epub:" + file.name + ":" + file.size,
    title,
    chapters,
    cover: await extractEpubCover(zip, opf, manifest),
  });
}

// ---------- обложка ----------

/**
 * Ищет обложку: EPUB3 properties="cover-image", EPUB2 <meta name="cover">,
 * иначе любая картинка со словом cover в пути. Возвращает Blob или null.
 */
async function extractEpubCover(zip, opf, manifest) {
  const usable = (m) => m && m.type.startsWith("image/") && zip.has(m.path);
  const items = [...manifest.values()];

  let item = items.find((m) => m.properties.includes("cover-image") && usable(m));
  if (!item) {
    const metaId = opf.querySelector('meta[name="cover"]')?.getAttribute("content");
    const byMeta = manifest.get(metaId);
    if (usable(byMeta)) item = byMeta;
  }
  if (!item) item = items.find((m) => usable(m) && /cover/i.test(m.path));
  if (!item) return null;

  try {
    const ext = item.path.split(".").pop().toLowerCase();
    return new Blob([await zip.extract(item.path)],
      { type: MIME_BY_EXT[ext] || item.type });
  } catch (e) {
    console.warn("Не удалось прочитать обложку:", e);
    return null;
  }
}

/** Название и обложка книги без её открытия (для полки). */
async function epubMetaFromFile(file) {
  const fallback = { title: file.name.replace(/\.epub$/i, ""), cover: null };
  try {
    const zip = new ZipArchive(await file.arrayBuffer());
    const { opf, manifest } = await readOpf(zip);
    return {
      title: opf.getElementsByTagNameNS(DC_NS, "title")[0]?.textContent?.trim()
        || fallback.title,
      cover: await extractEpubCover(zip, opf, manifest),
    };
  } catch (e) {
    console.warn("Не удалось прочитать метаданные книги:", e);
    return fallback;
  }
}

// ---------- оглавление ----------

async function loadTocTitles(zip, opf, manifest) {
  const titles = new Map(); // путь главы -> название
  try {
    // EPUB3: nav-документ
    let tocItem = [...manifest.values()].find((m) => m.properties.includes("nav"));
    // EPUB2: NCX
    if (!tocItem) {
      const ncxId = opf.querySelector("spine")?.getAttribute("toc");
      tocItem = manifest.get(ncxId) ||
        [...manifest.values()].find((m) => m.type === "application/x-dtbncx+xml");
    }
    if (!tocItem || !zip.has(tocItem.path)) return titles;

    const doc = new DOMParser().parseFromString(
      await zip.extractText(tocItem.path), "application/xml");

    const add = (href, text) => {
      if (!href || !text) return;
      const path = resolvePath(tocItem.path, href.split("#")[0]);
      if (!titles.has(path)) titles.set(path, text.trim());
    };

    if (tocItem.type === "application/x-dtbncx+xml") {
      for (const np of doc.querySelectorAll("navPoint")) {
        add(np.querySelector("content")?.getAttribute("src"),
            np.querySelector("navLabel > text")?.textContent);
      }
    } else {
      for (const a of doc.querySelectorAll("nav a[href]")) {
        add(a.getAttribute("href"), a.textContent);
      }
    }
  } catch (e) {
    console.warn("Не удалось прочитать оглавление:", e);
  }
  return titles;
}

// ---------- отрисовка главы ----------

async function renderEpubChapter(zip, path, pathToIndex) {
  const html = await zip.extractText(path);
  let doc;
  try {
    doc = new DOMParser().parseFromString(html, "application/xhtml+xml");
    if (doc.querySelector("parsererror")) throw new Error("xhtml parse error");
  } catch {
    doc = new DOMParser().parseFromString(html, "text/html");
  }

  const body = doc.body || doc.documentElement;
  const fragment = document.createElement("div");
  fragment.append(...document.importNode(body, true).childNodes);

  // Зачистка: книга — недоверенный файл, её скрипты выполняться не должны.
  // Удаляем активные теги и все inline-обработчики (onclick, onload, ...)
  fragment.querySelectorAll(
    "script, style, link, iframe, object, embed, form, base, meta")
    .forEach((n) => n.remove());
  for (const el of fragment.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    }
  }

  // Картинки: <img src> и svg <image xlink:href> -> blob URL из архива
  const imgTasks = [];
  const inlineImage = (el, attr, value) => {
    imgTasks.push((async () => {
      const imgPath = resolvePath(path, value);
      if (!zip.has(imgPath)) {
        // Оставленный относительный путь браузер попытался бы грузить
        // с диска (file:) — Safari на это ругается в консоль
        el.remove();
        return;
      }
      const ext = imgPath.split(".").pop().toLowerCase();
      const blob = new Blob([await zip.extract(imgPath)],
        { type: MIME_BY_EXT[ext] || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      state.blobUrls.push(url);
      el.setAttribute(attr, url);
    })());
  };
  for (const img of fragment.querySelectorAll("img[src]")) {
    inlineImage(img, "src", img.getAttribute("src"));
  }
  for (const image of fragment.querySelectorAll("image")) {
    const href = image.getAttribute("xlink:href") || image.getAttribute("href");
    if (href) inlineImage(image, "href", href);
  }
  await Promise.all(imgTasks);

  // Внутренние ссылки -> переход на нужную главу
  for (const a of fragment.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (/^https?:/i.test(href)) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
      continue;
    }
    if (/^[a-z]+:/i.test(href)) { // javascript:, data:, file: и т.п.
      a.removeAttribute("href");
      continue;
    }
    const target = pathToIndex.get(resolvePath(path, href.split("#")[0]));
    a.removeAttribute("href");
    if (target !== undefined) {
      a.style.cursor = "pointer";
      a.addEventListener("click", () => showChapter(target));
    }
  }

  return markIdeographicSpaces(fragment);
}
