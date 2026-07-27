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

  schedulePageMap(width, height);
}

// ---------- сквозная нумерация страниц ----------
// Число страниц каждой главы считается в фоне в скрытом контейнере
// с теми же параметрами вёрстки; пересчитывается при смене шрифта,
// размеров, ширины области или направления текста.

let pageMap = null;    // [страниц в главе 0, 1, ...]
let pageMapSig = "";   // сигнатура вёрстки, для которой посчитан pageMap
let pageMapToken = 0;

function schedulePageMap(width, height) {
  const sig = [state.bookId, width, height, verticalMode,
    getComputedStyle(els.flow).fontSize].join("|");
  if (sig === pageMapSig) return;
  pageMapSig = sig;
  buildPageMap(width, height);
}

// Освобождает blob-URL картинок внутри узла (после фонового замера
// главы её blob-URL больше никому не нужны — иначе они копятся до
// открытия другой книги)
function revokeBlobUrlsIn(root) {
  if (!root.querySelectorAll) return;
  for (const el of root.querySelectorAll("img, image")) {
    const url = el.getAttribute("src") || el.getAttribute("href") ||
      el.getAttribute("xlink:href") || "";
    if (!url.startsWith("blob:")) continue;
    URL.revokeObjectURL(url);
    const i = state.blobUrls.indexOf(url);
    if (i >= 0) state.blobUrls.splice(i, 1);
  }
}

async function buildPageMap(width, height) {
  const token = ++pageMapToken;
  pageMap = null;
  if (width <= 0 || height <= 0) return;

  const meas = document.createElement("div");
  meas.className = "flow flow-measure" + (verticalMode ? " vertical" : "");
  meas.style.width = width + "px";
  meas.style.height = height + "px";
  meas.style.columnWidth = (verticalMode ? height : width) + "px";
  document.body.appendChild(meas);

  const step = (verticalMode ? height : width) + PAGE_GAP;
  const counts = [];
  try {
    for (const chapter of state.chapters) {
      const node = await chapter.render();
      try {
        if (token !== pageMapToken) return; // вёрстка успела измениться
        meas.innerHTML = "";
        meas.appendChild(node);
        await Promise.all([...meas.querySelectorAll("img")].map((img) =>
          img.complete ? null : new Promise((res) => {
            img.onload = img.onerror = res;
          })));
        if (token !== pageMapToken) return;
        const size = verticalMode ? meas.scrollHeight : meas.scrollWidth;
        counts.push(Math.max(1, Math.round((size + PAGE_GAP) / step)));
      } finally {
        revokeBlobUrlsIn(node);
      }
    }
  } finally {
    meas.remove();
  }
  pageMap = counts;
  invalidateScrollBreaks();
  updateInfo();
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

// Размер «страницы», как если бы книга была в страничном режиме, —
// для подсчёта карты страниц из режима скролла
function pagedViewportSize() {
  const cs = getComputedStyle(els.content);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const maxW = parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue("--content-width")) || 760;
  return {
    width: Math.min(maxW, els.reader.clientWidth) - padX,
    height: els.reader.clientHeight - padY,
  };
}

// Пересчёт страниц при изменении размеров/шрифта (позицию держим примерно)
function repaginate() {
  if (scrollMode) {
    // Браузер сам переверстает текст, но карту страниц надо обновить
    invalidateScrollBreaks();
    const v = pagedViewportSize();
    schedulePageMap(v.width, v.height);
    return;
  }
  const ratio = page.total > 1 ? page.current / (page.total - 1) : 0;
  paginate();
  goToPage(Math.round(ratio * (page.total - 1)));
}

// ---------- счётчик страниц в режиме скролла ----------
// Позиции строк, где начинается новая страница, предпосчитываются
// на BREAKS_AHEAD страниц вперёд; при прокрутке остаётся только
// найти последний разрыв перед концом видимой области.

const BREAKS_AHEAD = 20;
let scrollBreaks = null; // { list: [{off, page}], limit } в координатах потока

function invalidateScrollBreaks() {
  scrollBreaks = null;
}

function computeScrollBreaks() {
  scrollBreaks = null;
  if (!pageMap || pageMap.length !== state.chapters.length) return;
  const v = pagedViewportSize();
  const pageExtent = verticalMode ? v.width : v.height;
  if (pageExtent <= 0) return;
  const lineH = parseFloat(getComputedStyle(els.flow).lineHeight)
    || parseFloat(getComputedStyle(els.flow).fontSize) * 1.9;

  const flowR = els.flow.getBoundingClientRect();
  const rr = els.reader.getBoundingClientRect();
  // Координата вдоль оси чтения от начала потока
  const toOff = (r) => verticalMode ? flowR.right - r.right : r.top - flowR.top;
  const viewEnd = verticalMode ? flowR.right - rr.left : rr.bottom - flowR.top;
  const limit = viewEnd + pageExtent * BREAKS_AHEAD;

  const list = [];
  for (const wrap of els.flow.children) {
    const idx = Number(wrap.dataset.index);
    const wr = wrap.getBoundingClientRect();
    const start = toOff(wr);
    const wrapExtent = verticalMode ? wr.width : wr.height;
    let before = 0;
    for (let i = 0; i < idx; i++) before += pageMap[i];
    list.push({ off: start, page: before + 1 }); // глава = новая страница
    if (start > limit) break;

    // Сетка строк главы: прямоугольники блоков + шаг line-height
    const blocks = [];
    for (const el of wrap.querySelectorAll(ANCHOR_SELECTOR)) {
      const r = el.getBoundingClientRect();
      blocks.push({
        start: toOff(r),
        end: toOff(r) + (verticalMode ? r.width : r.height),
      });
    }

    let target = start + pageExtent;
    let pageInCh = 1;
    let bi = 0;
    while (pageInCh < pageMap[idx] && target < start + wrapExtent
           && target <= limit + pageExtent) {
      while (bi < blocks.length && blocks[bi].end <= target) bi++;
      let snapped = target;
      if (bi < blocks.length) {
        const b = blocks[bi];
        snapped = b.start >= target
          ? b.start // разрыв попал в зазор между блоками
          : b.start + Math.floor((target - b.start) / lineH) * lineH;
      }
      if (snapped <= list[list.length - 1].off) snapped = target; // защита
      pageInCh++;
      list.push({ off: snapped, page: before + pageInCh });
      target = snapped + pageExtent;
    }
  }
  scrollBreaks = { list, limit };
}

function scrollPageNumber() {
  const flowR = els.flow.getBoundingClientRect();
  const rr = els.reader.getBoundingClientRect();
  const viewEnd = verticalMode ? flowR.right - rr.left : rr.bottom - flowR.top;

  if (!scrollBreaks || viewEnd > scrollBreaks.limit) computeScrollBreaks();
  if (!scrollBreaks || !scrollBreaks.list.length) return null;

  const list = scrollBreaks.list;
  let page = list[0].page;
  for (const entry of list) {
    if (entry.off < viewEnd) page = entry.page;
    else break;
  }
  return page;
}

// ---------- отображение прогресса ----------
// Клик по нижней панели переключает режим:
// 0 — сквозной номер страницы, 1 — глава и страница, 2 — процент книги

let infoMode = 0;
try { infoMode = parseInt(localStorage.getItem("nihonhon:infoMode")) || 0; } catch {}

function cycleInfoMode() {
  infoMode = (infoMode + 1) % 3;
  try { localStorage.setItem("nihonhon:infoMode", infoMode); } catch {}
  updateInfo();
}

// Сквозная позиция {current, total} по карте страниц; null, пока не посчитана
function globalPagePosition() {
  if (!pageMap || pageMap.length !== state.chapters.length) return null;
  const total = pageMap.reduce((a, b) => a + b, 0);
  let current;
  if (scrollMode) {
    current = scrollPageNumber();
  } else {
    let before = 0;
    for (let i = 0; i < state.current; i++) before += pageMap[i];
    current = before + page.current + 1;
  }
  if (current == null) return null;
  return { current: Math.min(current, total), total };
}

function updateInfo() {
  const pos = globalPagePosition();
  let text;

  if (infoMode === 2) {
    // Процент книги
    text = pos
      ? Math.round((pos.current / pos.total) * 100) + "%"
      : Math.round(((state.current + 1) / state.chapters.length) * 100) + "%";
  } else if (infoMode === 1) {
    // Глава и страница внутри главы
    if (pos) {
      let before = 0;
      let ch = 0;
      while (ch < pageMap.length - 1 && before + pageMap[ch] < pos.current) {
        before += pageMap[ch];
        ch++;
      }
      text = (ch + 1) + "/" + state.chapters.length + "章 ・ " +
        (pos.current - before) + "/" + pageMap[ch] + "頁";
    } else {
      text = (state.current + 1) + " / " + state.chapters.length;
      if (!scrollMode && page.total > 1) {
        text += " ・ " + (page.current + 1) + "/" + page.total + "頁";
      }
    }
  } else {
    // Сквозной номер страницы
    if (pos) {
      text = pos.current + " / " + pos.total + "頁";
    } else {
      text = (state.current + 1) + " / " + state.chapters.length;
      if (!scrollMode && page.total > 1) {
        text += " ・ " + (page.current + 1) + "/" + page.total + "頁";
      }
    }
  }

  els.chapterInfo.textContent = text;
}

els.chapterInfo.addEventListener("click", cycleInfoMode);

function savePosition(anchor) {
  try {
    const pos = { chapter: state.current, page: page.current };
    // В режиме скролла запоминаем абзац у начала видимой области
    if (scrollMode && anchor != null) pos.anchor = anchor;
    localStorage.setItem("nihonhon:" + state.bookId, JSON.stringify(pos));
    console.debug("[nihonhon] позиция сохранена:", JSON.stringify(pos));
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
    if (saved && Number.isInteger(saved.chapter) &&
        saved.chapter >= 0 && saved.chapter < chapters.length) {
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

const LOAD_MARGIN = 600;       // px до края, на котором подгружаем соседнюю главу
const MAX_LOADED_PAGES = 50;   // сколько страниц держим в DOM одновременно

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
    invalidateScrollBreaks(); // разметка потока изменилась
  } finally {
    appendingChapter = false;
  }
}

// ---------- подгрузка назад ----------
// Вставка главы сверху сдвигает весь текст вниз, поэтому прокрутку
// компенсируем на реальное смещение блока, который был первым.

let scrollLoadedFrom = 0; // индекс первой подгруженной главы
let prependingChapter = false;

// Координата начала блока вдоль оси чтения
function blockStartCoord(el) {
  const r = el.getBoundingClientRect();
  return verticalMode ? r.right : r.top;
}

// Возвращает элемент на прежнее место, доводя прокрутку на его смещение
function keepInPlace(el, coordBefore) {
  const shift = blockStartCoord(el) - coordBefore;
  if (!shift) return;
  if (verticalMode) els.reader.scrollLeft += shift;
  else els.reader.scrollTop += shift;
}

async function prependPrevChapter() {
  if (prependingChapter || scrollLoadedFrom <= 0) return;
  prependingChapter = true;
  try {
    const prev = scrollLoadedFrom - 1;
    const node = await state.chapters[prev].render();
    const wrap = document.createElement("div");
    wrap.className = "chapter-block";
    wrap.dataset.index = prev;
    wrap.appendChild(node);

    const anchorEl = els.flow.firstElementChild;
    const coord = anchorEl ? blockStartCoord(anchorEl) : 0;
    els.flow.insertBefore(wrap, anchorEl);
    if (anchorEl) keepInPlace(anchorEl, coord);

    scrollLoadedFrom = prev;
    invalidateScrollBreaks();

    // Картинки догружаются после вставки и сдвигают текст ещё раз
    const pending = [...wrap.querySelectorAll("img")].filter((i) => !i.complete);
    if (pending.length && anchorEl) {
      const coord2 = blockStartCoord(anchorEl);
      await Promise.all(pending.map((img) => new Promise((res) => {
        img.onload = img.onerror = res;
      })));
      keepInPlace(anchorEl, coord2);
      invalidateScrollBreaks();
    }
  } finally {
    prependingChapter = false;
  }
}

// ---------- выгрузка дальнего конца ----------

// Сколько страниц сейчас в DOM; null — карта страниц ещё не посчитана
function loadedPageCount() {
  if (!pageMap || pageMap.length !== state.chapters.length) return null;
  let n = 0;
  for (const wrap of els.flow.children) n += pageMap[Number(wrap.dataset.index)] || 0;
  return n;
}

// Насколько блок ушёл за пределы окна; отрицательное — блок ещё виден
function blockOutsideDistance(el, fromEnd) {
  const rr = els.reader.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (verticalMode) {
    // Чтение справа налево: начало окна — правый край, конец — левый
    return fromEnd ? rr.left - r.right : r.left - rr.right;
  }
  return fromEnd ? r.top - rr.bottom : rr.top - r.bottom;
}

/**
 * Выгружает главы, пока в DOM больше MAX_LOADED_PAGES страниц: снимается тот
 * конец, который дальше от окна. Ограниченное окно держит полосу прокрутки
 * пригодной — иначе она сжимается в нитку по мере загрузки книги.
 * Трогаем только блоки, ушедшие за окно дальше LOAD_MARGIN, иначе
 * освободившееся место тут же подгрузится обратно.
 */
function trimLoadedChapters() {
  let pages = loadedPageCount();
  if (pages === null) return;

  while (pages > MAX_LOADED_PAGES && els.flow.children.length > 1) {
    const headGap = blockOutsideDistance(els.flow.firstElementChild, false);
    const tailGap = blockOutsideDistance(els.flow.lastElementChild, true);
    if (Math.max(headGap, tailGap) <= LOAD_MARGIN) break;

    const fromEnd = tailGap > headGap;
    const victim = fromEnd ? els.flow.lastElementChild : els.flow.firstElementChild;

    // Удаление блока сверху поднимает текст — держим соседа на месте
    const anchorEl = fromEnd ? els.flow.firstElementChild : victim.nextElementSibling;
    const coord = blockStartCoord(anchorEl);
    const index = Number(victim.dataset.index);
    revokeBlobUrlsIn(victim);
    victim.remove();
    keepInPlace(anchorEl, coord);

    if (fromEnd) scrollLoadedTo = index - 1;
    else scrollLoadedFrom = index + 1;
    pages -= pageMap[index] || 0;
    invalidateScrollBreaks();
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

// Обёртка главы, в которую попадает начало видимой области
function visibleChapterWrap() {
  const rr = els.reader.getBoundingClientRect();
  const x = verticalMode ? rr.right - 10 : rr.left + rr.width / 2;
  const y = verticalMode ? rr.top + rr.height / 2 : rr.top + 10;
  for (const wrap of els.flow.children) {
    const r = wrap.getBoundingClientRect();
    const hit = verticalMode
      ? r.left <= x && x <= r.right
      : r.top <= y && y <= r.bottom;
    if (hit) return wrap;
  }
  return null;
}

// Определяем главу у начала видимой области (для инфо и TOC)
function updateVisibleChapter() {
  const wrap = visibleChapterWrap();
  if (wrap) {
    const index = Number(wrap.dataset.index);
    if (index !== state.current) {
      state.current = index;
      setTocActive(index);
    }
  }
  updateInfo(); // счётчик страниц следует за прокруткой

  // Задержка сохранения выключена — пишем сразу при остановке прокрутки
  if (settings.delayedSave === false) {
    savePosition(wrap ? computeAnchor(wrap) : null);
  }
}

// ---------- отложенное сохранение позиции при скролле ----------
// Позиция пишется только когда чтение "устоялось": в течение
// SAVE_SETTLE_MS прокрутка не ушла дальше SAVE_MOVE_THRESHOLD px.
// Существенное движение перезапускает отсчёт.

const SAVE_SETTLE_MS = 5000;
const SAVE_MOVE_THRESHOLD = 200; // px, примерно пара строк

let settleTimer = null;
let settleOffset = null;

function scrollOffsetNow() {
  return verticalMode ? Math.abs(els.reader.scrollLeft) : els.reader.scrollTop;
}

function noteScrollForSave() {
  if (settings.delayedSave === false) return; // сохраняет updateVisibleChapter
  const offset = scrollOffsetNow();
  if (settleTimer !== null &&
      Math.abs(offset - settleOffset) <= SAVE_MOVE_THRESHOLD) {
    return; // остаёмся у той же точки — отсчёт продолжается
  }
  settleOffset = offset;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(saveSettledPosition, SAVE_SETTLE_MS);
}

function saveSettledPosition() {
  clearTimeout(settleTimer);
  settleTimer = null;
  if (!scrollMode || state.current < 0) return;
  const wrap = visibleChapterWrap();
  savePosition(wrap ? computeAnchor(wrap) : null);
}

// Уход со страницы раньше таймера — сохраняем сразу, чтобы не потерять позицию
window.addEventListener("pagehide", () => {
  if (settleTimer !== null) saveSettledPosition();
});

let scrollSaveTimer;
let scrollInfoQueued = false;
els.reader.addEventListener("scroll", () => {
  if (!scrollMode || state.current < 0) return;
  const r = els.reader;
  // Подгрузка соседней главы + выгрузка дальнего конца
  const nearEnd = verticalMode
    ? r.scrollWidth - Math.abs(r.scrollLeft) - r.clientWidth < LOAD_MARGIN
    : r.scrollHeight - r.scrollTop - r.clientHeight < LOAD_MARGIN;
  if (nearEnd) appendNextChapter().then(trimLoadedChapters);

  const nearStart =
    (verticalMode ? Math.abs(r.scrollLeft) : r.scrollTop) < LOAD_MARGIN;
  if (nearStart) prependPrevChapter().then(trimLoadedChapters);

  // Счётчик страниц обновляется в реальном времени (не чаще кадра);
  // поиск по предпосчитанным разрывам дешёвый
  if (!scrollInfoQueued) {
    scrollInfoQueued = true;
    requestAnimationFrame(() => {
      scrollInfoQueued = false;
      if (!scrollMode || state.current < 0) return;
      trimLoadedChapters(); // держим окно ограниченным и во время прокрутки
      updateInfo();
    });
  }

  // Сохранение позиции — только когда позиция устоится (см. noteScrollForSave)
  noteScrollForSave();

  // Определение главы — по-прежнему с дебаунсом
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(updateVisibleChapter, 200);
});

async function showChapterScroll(index, anchor) {
  state.current = index;
  clearPaginationStyles();
  els.flow.innerHTML = "";
  scrollLoadedTo = index - 1;
  scrollLoadedFrom = index;
  await appendNextChapter();
  await fillViewport();
  els.reader.scrollTop = 0;
  els.reader.scrollLeft = 0;
  if (anchor) scrollToAnchor(anchor);
  invalidateScrollBreaks();
  const v = pagedViewportSize();
  schedulePageMap(v.width, v.height);
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
