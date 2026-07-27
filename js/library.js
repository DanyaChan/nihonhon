"use strict";

/* ============================================================
 * Библиотека: недавние книги (файлы в IndexedDB, список в
 * localStorage) и закладки (localStorage, по id книги).
 * ============================================================ */

const RECENT_MAX = 10;

function bookIdFor(file) {
  const kind = /\.epub$/i.test(file.name) ? "epub" : "txt";
  return kind + ":" + file.name + ":" + file.size;
}

function idbFiles(mode, action) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("nihonhon", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("files");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const req = action(db.transaction("files", mode).objectStore("files"));
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => { db.close(); reject(req.error); };
    };
  });
}

// ---------- недавние книги ----------

function getRecents() {
  try { return JSON.parse(localStorage.getItem("nihonhon:recent")) || []; }
  catch { return []; }
}

function setRecents(list) {
  try { localStorage.setItem("nihonhon:recent", JSON.stringify(list)); } catch {}
}

/** Вызывается при каждом успешном открытии файла. */
async function recordRecent(file) {
  const id = bookIdFor(file);
  try {
    await idbFiles("readwrite", (s) => s.put(file, id));
    // Обложку кладём рядом: полка не должна распаковывать книги при показе
    await idbFiles("readwrite", (s) => s.put(state.cover || null, coverKey(id)));
  } catch (e) {
    console.warn("Не удалось сохранить книгу в хранилище:", e);
  }
  const list = getRecents().filter((r) => r.id !== id);
  list.unshift({ id, name: file.name, title: state.title || file.name,
                 time: Date.now() });
  // Старые книги за пределами лимита выселяем вместе с файлами
  for (const evicted of list.splice(RECENT_MAX)) {
    forgetBookData(evicted.id);
  }
  setRecents(list);
  try { localStorage.setItem("nihonhon:lastBook", id); } catch {}
  if (libraryOpen()) renderLibrary();
}

async function openRecentBook(id, { quiet = false } = {}) {
  try {
    const file = await idbFiles("readonly", (s) => s.get(id));
    if (file instanceof Blob) {
      await openFile(file);
    } else if (!quiet) {
      alert("Файл этой книги уже удалён из хранилища — откройте его заново.");
    }
  } catch (e) {
    console.warn("Не удалось открыть книгу из хранилища:", e);
  }
}

// Удаляет всё, что связано с книгой: файл, обложку, позицию, закладки
function forgetBookData(id) {
  idbFiles("readwrite", (s) => s.delete(id)).catch(() => {});
  idbFiles("readwrite", (s) => s.delete(coverKey(id))).catch(() => {});
  try {
    localStorage.removeItem("nihonhon:" + id);
    localStorage.removeItem("nihonhon:bm:" + id);
  } catch {}
}

function removeRecent(id) {
  setRecents(getRecents().filter((r) => r.id !== id));
  forgetBookData(id);
  renderLibrary();
}

// ---------- обложки ----------

function coverKey(id) {
  return "cover:" + id;
}

/**
 * Обложка книги из хранилища. Для книг, добавленных до появления полки,
 * достаёт её из файла и запоминает (в том числе отсутствие — как null,
 * чтобы не разбирать epub заново при каждом открытии полки).
 */
async function ensureCover(id) {
  try {
    const cached = await idbFiles("readonly", (s) => s.get(coverKey(id)));
    if (cached !== undefined) return cached instanceof Blob ? cached : null;

    let cover = null;
    if (id.startsWith("epub:")) {
      const file = await idbFiles("readonly", (s) => s.get(id));
      if (file instanceof Blob) cover = await epubCoverFromFile(file);
    }
    await idbFiles("readwrite", (s) => s.put(cover, coverKey(id)));
    return cover;
  } catch (e) {
    console.warn("Не удалось получить обложку:", e);
    return null;
  }
}

// ---------- полка ----------

const libModal = $("library-modal");
const libGrid = $("lib-grid");
let libCoverUrls = [];
let libRenderToken = 0;

function libraryOpen() {
  return !libModal.classList.contains("hidden");
}

function openLibrary() {
  libModal.classList.remove("hidden");
  renderLibrary();
}

function closeLibrary() {
  libModal.classList.add("hidden");
  releaseCoverUrls();
}

function releaseCoverUrls() {
  libCoverUrls.forEach((u) => URL.revokeObjectURL(u));
  libCoverUrls = [];
}

function makeCard(r) {
  const card = document.createElement("div");
  card.className = "lib-card" + (r.id === state.bookId ? " active" : "");
  card.addEventListener("click", () => {
    closeLibrary();
    openRecentBook(r.id);
  });

  // Пока обложка не загрузилась (или её нет) — название на «корешке»
  const cover = document.createElement("div");
  cover.className = "lib-cover";
  const stub = document.createElement("div");
  stub.className = "lib-cover-text";
  stub.textContent = clipTitle(r.title || r.name, 60);
  cover.appendChild(stub);

  const title = document.createElement("div");
  title.className = "lib-title";
  title.textContent = r.title || r.name;
  title.title = r.name;

  const date = document.createElement("div");
  date.className = "lib-date";
  date.textContent = new Date(r.time).toLocaleDateString();

  const del = document.createElement("button");
  del.className = "lib-del";
  del.textContent = "✕";
  del.setAttribute("aria-label", "Убрать из списка");
  del.addEventListener("click", (e) => {
    e.stopPropagation(); // клик по карточке открыл бы книгу
    removeRecent(r.id);
  });

  card.append(cover, title, date, del);
  return { card, cover };
}

async function renderLibrary() {
  const token = ++libRenderToken;
  releaseCoverUrls();
  libGrid.innerHTML = "";

  const list = getRecents();
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "lib-empty";
    empty.textContent = "Пока пусто — откройте .epub или .txt";
    libGrid.appendChild(empty);
    return;
  }

  const covers = new Map(); // id -> элемент обложки
  for (const r of list) {
    const { card, cover } = makeCard(r);
    covers.set(r.id, cover);
    libGrid.appendChild(card);
  }

  // По одной: каждая незакэшированная обложка читает файл книги целиком
  for (const r of list) {
    const blob = await ensureCover(r.id);
    if (token !== libRenderToken) return; // полку перерисовали
    if (!blob) continue;
    const url = URL.createObjectURL(blob);
    libCoverUrls.push(url);
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    covers.get(r.id).replaceChildren(img);
  }
}

/** Автозагрузка последней книги при старте. */
function reopenLastBook() {
  // Уборка: запись "last" из старой версии больше не используется
  idbFiles("readwrite", (s) => s.delete("last")).catch(() => {});
  let id = null;
  try { id = localStorage.getItem("nihonhon:lastBook"); } catch {}
  if (id) openRecentBook(id, { quiet: true });
}

// ---------- закладки ----------

function bmStorageKey() {
  return "nihonhon:bm:" + state.bookId;
}

function getBookmarks() {
  if (!state.bookId) return [];
  try { return JSON.parse(localStorage.getItem(bmStorageKey())) || []; }
  catch { return []; }
}

function setBookmarks(list) {
  try { localStorage.setItem(bmStorageKey(), JSON.stringify(list)); } catch {}
  renderBookmarks();
}

function addBookmark() {
  if (state.current < 0) return;
  const pos = getCurrentPosition();
  const list = getBookmarks();
  list.unshift({ ...pos, time: Date.now() });
  setBookmarks(list);
  els.toc.classList.remove("hidden"); // показываем, куда легла закладка
  $("bm-section").open = true;
}

function renderBookmarks() {
  const ul = $("bm-list");
  ul.innerHTML = "";
  getBookmarks().forEach((bm, i) => {
    const li = document.createElement("li");

    const text = document.createElement("span");
    text.className = "item-text";
    text.textContent = bm.snippet || "しおり " + (i + 1);
    text.title = (state.chapters[bm.chapter]?.title || "") +
      " — " + new Date(bm.time).toLocaleString();
    text.addEventListener("click", () =>
      showChapter(bm.chapter, { atPage: bm.page, anchor: bm.anchor }));

    const del = document.createElement("button");
    del.className = "item-del";
    del.textContent = "✕";
    del.title = "Удалить закладку";
    del.addEventListener("click", () => {
      const list = getBookmarks();
      list.splice(i, 1);
      setBookmarks(list);
    });

    li.append(text, del);
    ul.appendChild(li);
  });
}

// ---------- события ----------

$("btn-bookmark").addEventListener("click", addBookmark);

$("btn-recent").addEventListener("click", () =>
  (libraryOpen() ? closeLibrary() : openLibrary()));

$("lib-close").addEventListener("click", closeLibrary);
libModal.querySelector(".lib-backdrop").addEventListener("click", closeLibrary);

$("lib-open").addEventListener("click", () => {
  closeLibrary();
  els.fileInput.click();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && libraryOpen()) closeLibrary();
});
