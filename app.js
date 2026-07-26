"use strict";

/* ============================================================
 * 日本本 — простая читалка EPUB/TXT для японских книг.
 * Без внешних библиотек: EPUB (zip) распаковывается через
 * встроенный DecompressionStream.
 * ============================================================ */

// ---------- состояние ----------

const state = {
  bookId: null,        // ключ для localStorage
  title: "",
  chapters: [],        // [{ title, render: () => Promise<Node> }]
  current: -1,
  blobUrls: [],        // для очистки при открытии новой книги
};

// ---------- элементы ----------

const $ = (id) => document.getElementById(id);
const els = {
  fileInput: $("file-input"),
  reader: $("reader"),
  content: $("content"),
  flow: $("flow"),
  welcome: $("welcome"),
  toc: $("toc"),
  tocList: $("toc-list"),
  navbar: $("navbar"),
  bookTitle: $("book-title"),
  chapterInfo: $("chapter-info"),
};

// ============================================================
// ZIP: минимальный распаковщик (для EPUB)
// ============================================================

class ZipArchive {
  constructor(buffer) {
    this.data = new DataView(buffer);
    this.buffer = buffer;
    this.entries = new Map(); // имя файла -> запись центрального каталога
    this._parseCentralDirectory();
  }

  _parseCentralDirectory() {
    const d = this.data;
    // Ищем End of Central Directory (сигнатура 0x06054b50) с конца
    let eocd = -1;
    const min = Math.max(0, d.byteLength - 65558);
    for (let i = d.byteLength - 22; i >= min; i--) {
      if (d.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Не найден каталог ZIP — файл повреждён?");

    const count = d.getUint16(eocd + 10, true);
    let offset = d.getUint32(eocd + 16, true);

    for (let i = 0; i < count; i++) {
      if (d.getUint32(offset, true) !== 0x02014b50) break;
      const method = d.getUint16(offset + 10, true);
      const compressedSize = d.getUint32(offset + 20, true);
      const nameLen = d.getUint16(offset + 28, true);
      const extraLen = d.getUint16(offset + 30, true);
      const commentLen = d.getUint16(offset + 32, true);
      const localOffset = d.getUint32(offset + 42, true);
      const nameBytes = new Uint8Array(this.buffer, offset + 46, nameLen);
      const name = new TextDecoder("utf-8").decode(nameBytes);
      this.entries.set(name, { method, compressedSize, localOffset });
      offset += 46 + nameLen + extraLen + commentLen;
    }
  }

  has(name) {
    return this.entries.has(name);
  }

  /** Возвращает Uint8Array с содержимым файла. */
  async extract(name) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error("В EPUB нет файла: " + name);

    const d = this.data;
    const lo = entry.localOffset;
    if (d.getUint32(lo, true) !== 0x04034b50) {
      throw new Error("Повреждённый локальный заголовок: " + name);
    }
    const nameLen = d.getUint16(lo + 26, true);
    const extraLen = d.getUint16(lo + 28, true);
    const start = lo + 30 + nameLen + extraLen;
    const raw = new Uint8Array(this.buffer, start, entry.compressedSize);

    if (entry.method === 0) return raw; // без сжатия
    if (entry.method !== 8) throw new Error("Неподдерживаемый метод сжатия: " + entry.method);

    const stream = new Blob([raw]).stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async extractText(name) {
    return new TextDecoder("utf-8").decode(await this.extract(name));
  }
}

// ============================================================
// Утилиты путей внутри EPUB
// ============================================================

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

// ============================================================
// EPUB
// ============================================================

const MIME_BY_EXT = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  gif: "image/gif", svg: "image/svg+xml", webp: "image/webp",
};

async function openEpub(file) {
  const zip = new ZipArchive(await file.arrayBuffer());

  // 1. container.xml -> путь к OPF
  const containerXml = await zip.extractText("META-INF/container.xml");
  const container = new DOMParser().parseFromString(containerXml, "application/xml");
  const rootfile = container.querySelector("rootfile");
  if (!rootfile) throw new Error("Некорректный EPUB: нет rootfile в container.xml");
  const opfPath = rootfile.getAttribute("full-path");

  // 2. OPF: метаданные, manifest, spine
  const opfXml = await zip.extractText(opfPath);
  const opf = new DOMParser().parseFromString(opfXml, "application/xml");

  const title =
    opf.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "title")[0]
      ?.textContent?.trim() || file.name.replace(/\.epub$/i, "");

  const manifest = new Map(); // id -> { path, type, properties }
  for (const item of opf.querySelectorAll("manifest > item")) {
    manifest.set(item.getAttribute("id"), {
      path: resolvePath(opfPath, item.getAttribute("href")),
      type: item.getAttribute("media-type") || "",
      properties: item.getAttribute("properties") || "",
    });
  }

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

  loadBook({ id: "epub:" + file.name + ":" + file.size, title, chapters });
}

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

  // Убираем скрипты и стили книги — используем свои
  fragment.querySelectorAll("script, style, link").forEach((n) => n.remove());

  // Картинки: <img src> и svg <image xlink:href> -> blob URL из архива
  const imgTasks = [];
  const inlineImage = (el, attr, value) => {
    imgTasks.push((async () => {
      const imgPath = resolvePath(path, value);
      if (!zip.has(imgPath)) return;
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
    if (/^[a-z]+:/i.test(href)) {
      a.setAttribute("target", "_blank");
      continue;
    }
    const target = pathToIndex.get(resolvePath(path, href.split("#")[0]));
    a.removeAttribute("href");
    if (target !== undefined) {
      a.style.cursor = "pointer";
      a.addEventListener("click", () => showChapter(target));
    }
  }

  return fragment;
}

// ============================================================
// TXT
// ============================================================

const TXT_CHUNK = 20000; // символов на "главу"

async function openTxt(file) {
  const buffer = await file.arrayBuffer();
  const text = decodeJapaneseText(buffer);
  const title = file.name.replace(/\.txt$/i, "");

  // Режем на части по абзацам, чтобы не рендерить огромный DOM разом
  const lines = text.split(/\r\n|\r|\n/);
  const parts = [];
  let current = [];
  let size = 0;
  for (const line of lines) {
    current.push(line);
    size += line.length;
    if (size >= TXT_CHUNK) {
      parts.push(current);
      current = [];
      size = 0;
    }
  }
  if (current.length) parts.push(current);

  const chapters = parts.map((partLines, i) => ({
    title: parts.length === 1 ? title : "ページ " + (i + 1),
    render: async () => renderTxtPart(partLines),
  }));

  loadBook({ id: "txt:" + file.name + ":" + file.size, title, chapters });
}

function decodeJapaneseText(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    // Японские txt часто в Shift_JIS (или EUC-JP)
    for (const enc of ["shift_jis", "euc-jp"]) {
      try {
        return new TextDecoder(enc, { fatal: true }).decode(buffer);
      } catch { /* пробуем следующую */ }
    }
    return new TextDecoder("utf-8").decode(buffer); // как есть
  }
}

function renderTxtPart(lines) {
  const fragment = document.createElement("div");
  for (const line of lines) {
    const p = document.createElement("p");
    if (line.trim() === "") {
      p.innerHTML = "&nbsp;";
    } else {
      appendWithAozoraRuby(p, line);
    }
    fragment.appendChild(p);
  }
  return fragment;
}

/**
 * Поддержка фуриганы в формате Aozora Bunko:
 *   漢字《かんじ》  и  ｜振り仮名《ふりがな》
 */
function appendWithAozoraRuby(parent, line) {
  const re = /(?:[|｜]([^《》|｜]+)|([㐀-鿿豈-﫿々〆ヵヶ]+))《([^《》]+)》/g;
  let last = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) {
      parent.appendChild(document.createTextNode(line.slice(last, m.index)));
    }
    const ruby = document.createElement("ruby");
    ruby.appendChild(document.createTextNode(m[1] || m[2]));
    const rt = document.createElement("rt");
    rt.textContent = m[3];
    ruby.appendChild(rt);
    parent.appendChild(ruby);
    last = re.lastIndex;
  }
  if (last < line.length) {
    parent.appendChild(document.createTextNode(line.slice(last)));
  }
}

// ============================================================
// Общая логика читалки
// ============================================================

function loadBook({ id, title, chapters }) {
  // Чистим blob-URL прошлой книги
  state.blobUrls.forEach((u) => URL.revokeObjectURL(u));
  state.blobUrls = [];

  state.bookId = id;
  state.title = title;
  state.chapters = chapters;
  state.current = -1;

  els.bookTitle.textContent = title;
  document.title = title + " — 日本本";
  els.welcome.classList.add("hidden");
  els.content.classList.remove("hidden");
  els.navbar.classList.remove("hidden");

  // Оглавление
  els.tocList.innerHTML = "";
  chapters.forEach((ch, i) => {
    const li = document.createElement("li");
    li.textContent = ch.title;
    li.addEventListener("click", () => {
      showChapter(i);
      if (window.innerWidth <= 640) els.toc.classList.add("hidden");
    });
    els.tocList.appendChild(li);
  });

  // Восстанавливаем позицию
  let start = 0;
  let startPage = 0;
  try {
    const saved = JSON.parse(localStorage.getItem("nihonhon:" + id));
    if (saved && saved.chapter < chapters.length) {
      start = saved.chapter;
      startPage = saved.page || 0;
    }
  } catch { /* нет сохранения */ }

  showChapter(start, { atPage: startPage });
}

// ---------- пагинация ----------
// Глава раскладывается CSS-колонками шириной с окно чтения;
// листание — сдвиг #flow по горизонтали на ширину страницы.

const page = { current: 0, total: 1, step: 0 };
const PAGE_GAP = 48; // должен совпадать с column-gap в CSS

function paginate() {
  const width = els.content.clientWidth
    - parseFloat(getComputedStyle(els.content).paddingLeft)
    - parseFloat(getComputedStyle(els.content).paddingRight);
  els.flow.style.columnWidth = width + "px";
  els.flow.style.width = width + "px";
  page.step = width + PAGE_GAP;
  page.total = Math.max(1, Math.round((els.flow.scrollWidth + PAGE_GAP) / page.step));
}

function goToPage(i) {
  page.current = Math.max(0, Math.min(page.total - 1, i));
  els.flow.style.transform = "translateX(" + (-page.current * page.step) + "px)";
  updateInfo();
  savePosition();
}

function nextPage() {
  if (page.current < page.total - 1) goToPage(page.current + 1);
  else if (state.current < state.chapters.length - 1) showChapter(state.current + 1);
}

function prevPage() {
  if (page.current > 0) goToPage(page.current - 1);
  else if (state.current > 0) showChapter(state.current - 1, { atEnd: true });
}

function updateInfo() {
  let text = (state.current + 1) + " / " + state.chapters.length;
  if (page.total > 1) text += " ・ " + (page.current + 1) + "/" + page.total + "頁";
  els.chapterInfo.textContent = text;
}

function savePosition() {
  try {
    localStorage.setItem("nihonhon:" + state.bookId,
      JSON.stringify({ chapter: state.current, page: page.current }));
  } catch { /* localStorage недоступен */ }
}

async function showChapter(index, { atEnd = false, atPage = 0 } = {}) {
  if (index < 0 || index >= state.chapters.length) return;
  state.current = index;

  els.flow.innerHTML = "<p>読み込み中…</p>";
  els.flow.style.transform = "none";
  try {
    const node = await state.chapters[index].render();
    els.flow.innerHTML = "";
    els.flow.appendChild(node);
  } catch (e) {
    console.error(e);
    els.flow.innerHTML = "<p>⚠️ Не удалось отобразить главу: " + e.message + "</p>";
  }

  // Ждём загрузки картинок — они влияют на разбивку на страницы
  await Promise.all([...els.flow.querySelectorAll("img")].map((img) =>
    img.complete ? null : new Promise((res) => {
      img.onload = img.onerror = res;
    })));

  paginate();
  goToPage(atEnd ? page.total - 1 : atPage);

  [...els.tocList.children].forEach((li, i) =>
    li.classList.toggle("active", i === index));
}

// ---------- открытие файлов ----------

async function openFile(file) {
  if (!file) return;
  try {
    if (/\.epub$/i.test(file.name)) await openEpub(file);
    else if (/\.txt$/i.test(file.name)) await openTxt(file);
    else alert("Поддерживаются только .epub и .txt");
  } catch (e) {
    console.error(e);
    alert("Не удалось открыть книгу: " + e.message);
  }
}

// ---------- события ----------

$("btn-open").addEventListener("click", () => els.fileInput.click());
$("btn-open-welcome").addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", () => {
  openFile(els.fileInput.files[0]);
  els.fileInput.value = "";
});

$("btn-toc").addEventListener("click", () => {
  els.toc.classList.toggle("hidden");
  if (state.current >= 0) repaginate();
});
$("btn-prev").addEventListener("click", prevPage);
$("btn-next").addEventListener("click", nextPage);

// Пересчёт страниц при изменении размеров/шрифта (позицию держим примерно)
function repaginate() {
  const ratio = page.total > 1 ? page.current / (page.total - 1) : 0;
  paginate();
  goToPage(Math.round(ratio * (page.total - 1)));
}

let resizeTimer;
window.addEventListener("resize", () => {
  if (state.current < 0) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(repaginate, 150);
});

// Размер шрифта
let fontSize = parseInt(localStorage.getItem("nihonhon:fontSize")) || 20;
applyFontSize();

function applyFontSize() {
  document.documentElement.style.setProperty("--content-font-size", fontSize + "px");
  try { localStorage.setItem("nihonhon:fontSize", fontSize); } catch {}
  if (state.current >= 0) repaginate();
}
$("btn-font-plus").addEventListener("click", () => {
  fontSize = Math.min(40, fontSize + 2); applyFontSize();
});
$("btn-font-minus").addEventListener("click", () => {
  fontSize = Math.max(12, fontSize - 2); applyFontSize();
});

// Стрелки ← → и колесо мыши — перелистывание страниц
document.addEventListener("keydown", (e) => {
  if (state.current < 0) return;
  if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); prevPage(); }
  if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
    e.preventDefault(); nextPage();
  }
});

let wheelLock = false;
els.reader.addEventListener("wheel", (e) => {
  if (state.current < 0) return;
  e.preventDefault();
  if (wheelLock) return;
  wheelLock = true;
  setTimeout(() => { wheelLock = false; }, 120);
  if (e.deltaY > 0 || e.deltaX > 0) nextPage();
  else prevPage();
}, { passive: false });

// Drag & drop
els.reader.addEventListener("dragover", (e) => {
  e.preventDefault();
  els.reader.classList.add("dragover");
});
els.reader.addEventListener("dragleave", () => els.reader.classList.remove("dragover"));
els.reader.addEventListener("drop", (e) => {
  e.preventDefault();
  els.reader.classList.remove("dragover");
  openFile(e.dataTransfer.files[0]);
});
