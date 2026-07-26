"use strict";

/* ============================================================
 * Читалка: состояние книги, пагинация и отображение глав.
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

// Обрезка текста для заголовка главы в оглавлении
function clipTitle(s, max = 30) {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// Текст элемента без фуриганы
function textWithoutRt(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll("rt, rp").forEach((n) => n.remove());
  return clone.textContent.trim();
}

// Текущая позиция чтения — для закладок
function getCurrentPosition() {
  const chTitle = state.chapters[state.current]?.title || "";
  const pos = { chapter: state.current, page: page.current, anchor: null, snippet: "" };
  if (scrollMode) {
    const wrap = els.flow.querySelector(
      '.chapter-block[data-index="' + state.current + '"]');
    if (wrap) {
      pos.anchor = computeAnchor(wrap);
      const el = wrap.querySelectorAll(ANCHOR_SELECTOR)[pos.anchor];
      if (el) pos.snippet = clipTitle(textWithoutRt(el));
    }
  }
  if (!pos.snippet) {
    pos.snippet = clipTitle(chTitle);
    if (!scrollMode && page.total > 1) {
      pos.snippet += " ・ " + (page.current + 1) + "頁";
    }
  }
  return pos;
}

// ---------- пагинация ----------
// Глава раскладывается CSS-колонками шириной с окно чтения;
// листание — сдвиг #flow по горизонтали на ширину страницы.

const page = { current: 0, total: 1, step: 0 };
const PAGE_GAP = 48; // должен совпадать с column-gap в CSS

// Режим направления текста: false — горизонтально (слева направо),
// true — вертикально 縦書き (сверху вниз, столбцы справа налево)
let verticalMode = false;
try { verticalMode = localStorage.getItem("nihonhon:vertical") === "1"; } catch {}

// Режим отображения: false — по страницам, true — бесконечный скролл
let scrollMode = false;
try { scrollMode = localStorage.getItem("nihonhon:scroll") === "1"; } catch {}

function applyWritingMode() {
  els.flow.classList.toggle("vertical", verticalMode);
  // На кнопке — режим, В КОТОРЫЙ переключит нажатие
  $("btn-mode").textContent = verticalMode ? "横書き" : "縦書き";
  applyViewMode();
}

function toggleWritingMode() {
  verticalMode = !verticalMode;
  try { localStorage.setItem("nihonhon:vertical", verticalMode ? "1" : "0"); } catch {}
  applyWritingMode();
  if (state.current < 0) return;
  if (scrollMode) showChapter(state.current);
  else repaginate();
}

function applyViewMode() {
  els.reader.classList.toggle("scroll-h", scrollMode && !verticalMode);
  els.reader.classList.toggle("scroll-v", scrollMode && verticalMode);
  $("btn-view").textContent = scrollMode ? "ページ" : "スクロール";
}

function toggleViewMode() {
  scrollMode = !scrollMode;
  try { localStorage.setItem("nihonhon:scroll", scrollMode ? "1" : "0"); } catch {}
  applyViewMode();
  if (state.current >= 0) showChapter(state.current);
}

function clearPaginationStyles() {
  els.flow.style.columnWidth = "";
  els.flow.style.width = "";
  els.flow.style.height = "";
  els.flow.style.transform = "";
  page.step = 0;
  page.total = 1;
  page.current = 0;
}

function paginate() {
  const cs = getComputedStyle(els.content);
  const width = els.content.clientWidth
    - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const height = els.content.clientHeight
    - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  els.flow.style.width = width + "px";
  els.flow.style.height = height + "px";

  if (verticalMode) {
    // В vertical-rl колонки укладываются по инлайн-оси — вертикально:
    // каждая колонка высотой с окно становится страницей, листаем по Y
    els.flow.style.columnWidth = height + "px";
    page.step = height + PAGE_GAP;
    page.total = Math.max(1, Math.round((els.flow.scrollHeight + PAGE_GAP) / page.step));
  } else {
    els.flow.style.columnWidth = width + "px";
    page.step = width + PAGE_GAP;
    page.total = Math.max(1, Math.round((els.flow.scrollWidth + PAGE_GAP) / page.step));
  }
}

function goToPage(i) {
  if (scrollMode) return;
  page.current = Math.max(0, Math.min(page.total - 1, i));
  const shift = -page.current * page.step;
  els.flow.style.transform = verticalMode
    ? "translateY(" + shift + "px)"
    : "translateX(" + shift + "px)";
  updateInfo();
  savePosition();
}

function nextPage() {
  if (scrollMode) {
    if (state.current < state.chapters.length - 1) showChapter(state.current + 1);
    return;
  }
  if (page.current < page.total - 1) goToPage(page.current + 1);
  else if (state.current < state.chapters.length - 1) showChapter(state.current + 1);
}

function prevPage() {
  if (scrollMode) {
    if (state.current > 0) showChapter(state.current - 1);
    return;
  }
  if (page.current > 0) goToPage(page.current - 1);
  else if (state.current > 0) showChapter(state.current - 1, { atEnd: true });
}

// Пересчёт страниц при изменении размеров/шрифта (позицию держим примерно)
function repaginate() {
  if (scrollMode) return; // в режиме скролла браузер сам переверстает
  const ratio = page.total > 1 ? page.current / (page.total - 1) : 0;
  paginate();
  goToPage(Math.round(ratio * (page.total - 1)));
}

function updateInfo() {
  let text = (state.current + 1) + " / " + state.chapters.length;
  if (!scrollMode && page.total > 1) {
    text += " ・ " + (page.current + 1) + "/" + page.total + "頁";
  }
  els.chapterInfo.textContent = text;
}

function savePosition(anchor) {
  try {
    const pos = { chapter: state.current, page: page.current };
    // В режиме скролла запоминаем абзац у начала видимой области
    if (scrollMode && anchor != null) pos.anchor = anchor;
    localStorage.setItem("nihonhon:" + state.bookId, JSON.stringify(pos));
  } catch { /* localStorage недоступен */ }
}

// ---------- загрузка книги и глав ----------

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
  let startAnchor = null;
  try {
    const saved = JSON.parse(localStorage.getItem("nihonhon:" + id));
    if (saved && saved.chapter < chapters.length) {
      start = saved.chapter;
      startPage = saved.page || 0;
      startAnchor = saved.anchor ?? null;
    }
  } catch { /* нет сохранения */ }

  showChapter(start, { atPage: startPage, anchor: startAnchor });
  renderBookmarks(); // список закладок этой книги (library.js)
}

// ---------- бесконечный скролл ----------
// Показанная глава кладётся в обёртку .chapter-block; при приближении
// к концу прокрутки дописывается следующая глава.

let scrollLoadedTo = -1; // индекс последней подгруженной главы
let appendingChapter = false;

async function appendNextChapter() {
  if (appendingChapter || scrollLoadedTo + 1 >= state.chapters.length) return;
  appendingChapter = true;
  try {
    const next = scrollLoadedTo + 1;
    const node = await state.chapters[next].render();
    const wrap = document.createElement("div");
    wrap.className = "chapter-block";
    wrap.dataset.index = next;
    wrap.appendChild(node);
    els.flow.appendChild(wrap);
    scrollLoadedTo = next;
  } finally {
    appendingChapter = false;
  }
}

// Пока контент короче окна — дозаполняем следующими главами
async function fillViewport() {
  for (let guard = 0; guard < 50; guard++) {
    const r = els.reader;
    const short = verticalMode
      ? r.scrollWidth <= r.clientWidth + 200
      : r.scrollHeight <= r.clientHeight + 200;
    if (!short || scrollLoadedTo + 1 >= state.chapters.length) break;
    await appendNextChapter();
  }
}

function setTocActive(index) {
  [...els.tocList.children].forEach((li, i) =>
    li.classList.toggle("active", i === index));
}

// Элементы, которые могут служить якорем позиции чтения
const ANCHOR_SELECTOR = "p, h1, h2, h3, h4, h5, blockquote, li, img, table";

// Первый блок главы, ещё не ушедший за начало видимой области
function computeAnchor(wrap) {
  const rr = els.reader.getBoundingClientRect();
  const items = wrap.querySelectorAll(ANCHOR_SELECTOR);
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect();
    // Прочитанные блоки уходят вверх (или вправо при вертикальном письме)
    const past = verticalMode ? r.left >= rr.right - 2 : r.bottom <= rr.top + 2;
    if (!past) return i;
  }
  return 0;
}

// Прокрутка к сохранённому якорю (вызывается при сброшенном скролле)
function scrollToAnchor(anchor) {
  const wrap = els.flow.querySelector(
    '.chapter-block[data-index="' + state.current + '"]');
  const el = wrap && wrap.querySelectorAll(ANCHOR_SELECTOR)[anchor];
  if (!el) return;
  const rr = els.reader.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (verticalMode) {
    els.reader.scrollBy({ left: r.right - rr.right });
  } else {
    els.reader.scrollBy({ top: r.top - rr.top });
  }
}

// Определяем главу у начала видимой области (для инфо, TOC и сохранения)
function updateVisibleChapter() {
  const rr = els.reader.getBoundingClientRect();
  const x = verticalMode ? rr.right - 10 : rr.left + rr.width / 2;
  const y = verticalMode ? rr.top + rr.height / 2 : rr.top + 10;
  let anchor = null;
  for (const wrap of els.flow.children) {
    const r = wrap.getBoundingClientRect();
    const hit = verticalMode
      ? r.left <= x && x <= r.right
      : r.top <= y && y <= r.bottom;
    if (hit) {
      const index = Number(wrap.dataset.index);
      if (index !== state.current) {
        state.current = index;
        updateInfo();
        setTocActive(index);
      }
      anchor = computeAnchor(wrap);
      break;
    }
  }
  savePosition(anchor);
}

let scrollSaveTimer;
els.reader.addEventListener("scroll", () => {
  if (!scrollMode || state.current < 0) return;
  const r = els.reader;
  const nearEnd = verticalMode
    ? r.scrollWidth - Math.abs(r.scrollLeft) - r.clientWidth < 600
    : r.scrollHeight - r.scrollTop - r.clientHeight < 600;
  if (nearEnd) appendNextChapter().then(() => {});
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(updateVisibleChapter, 200);
});

async function showChapterScroll(index, anchor) {
  state.current = index;
  clearPaginationStyles();
  els.flow.innerHTML = "";
  scrollLoadedTo = index - 1;
  await appendNextChapter();
  await fillViewport();
  els.reader.scrollTop = 0;
  els.reader.scrollLeft = 0;
  if (anchor) scrollToAnchor(anchor);
  updateInfo();
  setTocActive(index);
  savePosition(anchor);
}

// ---------- показ главы ----------

async function showChapter(index, { atEnd = false, atPage = 0, anchor = null } = {}) {
  if (index < 0 || index >= state.chapters.length) return;
  if (scrollMode) return showChapterScroll(index, anchor);
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
