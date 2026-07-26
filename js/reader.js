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

// ---------- пагинация ----------
// Глава раскладывается CSS-колонками шириной с окно чтения;
// листание — сдвиг #flow по горизонтали на ширину страницы.

const page = { current: 0, total: 1, step: 0 };
const PAGE_GAP = 48; // должен совпадать с column-gap в CSS

// Режим направления текста: false — горизонтально (слева направо),
// true — вертикально 縦書き (сверху вниз, столбцы справа налево)
let verticalMode = false;
try { verticalMode = localStorage.getItem("nihonhon:vertical") === "1"; } catch {}

function applyWritingMode() {
  els.flow.classList.toggle("vertical", verticalMode);
  // На кнопке — режим, В КОТОРЫЙ переключит нажатие
  $("btn-mode").textContent = verticalMode ? "横書き" : "縦書き";
}

function toggleWritingMode() {
  verticalMode = !verticalMode;
  try { localStorage.setItem("nihonhon:vertical", verticalMode ? "1" : "0"); } catch {}
  applyWritingMode();
  if (state.current >= 0) repaginate();
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
  page.current = Math.max(0, Math.min(page.total - 1, i));
  const shift = -page.current * page.step;
  els.flow.style.transform = verticalMode
    ? "translateY(" + shift + "px)"
    : "translateX(" + shift + "px)";
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

// Пересчёт страниц при изменении размеров/шрифта (позицию держим примерно)
function repaginate() {
  const ratio = page.total > 1 ? page.current / (page.total - 1) : 0;
  paginate();
  goToPage(Math.round(ratio * (page.total - 1)));
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
  try {
    const saved = JSON.parse(localStorage.getItem("nihonhon:" + id));
    if (saved && saved.chapter < chapters.length) {
      start = saved.chapter;
      startPage = saved.page || 0;
    }
  } catch { /* нет сохранения */ }

  showChapter(start, { atPage: startPage });
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
