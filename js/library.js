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
  } catch (e) {
    console.warn("Не удалось сохранить книгу в хранилище:", e);
  }
  const list = getRecents().filter((r) => r.id !== id);
  list.unshift({ id, name: file.name, time: Date.now() });
  // Старые книги за пределами лимита выселяем вместе с файлами
  for (const evicted of list.splice(RECENT_MAX)) {
    forgetBookData(evicted.id);
  }
  setRecents(list);
  try { localStorage.setItem("nihonhon:lastBook", id); } catch {}
  renderRecentMenu();
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

// Удаляет всё, что связано с книгой: файл, позицию, закладки
function forgetBookData(id) {
  idbFiles("readwrite", (s) => s.delete(id)).catch(() => {});
  try {
    localStorage.removeItem("nihonhon:" + id);
    localStorage.removeItem("nihonhon:bm:" + id);
  } catch {}
}

function removeRecent(id) {
  setRecents(getRecents().filter((r) => r.id !== id));
  forgetBookData(id);
  renderRecentMenu();
}

function renderRecentMenu() {
  const ul = $("recent-list");
  ul.innerHTML = "";
  const list = getRecents();
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Пока пусто";
    ul.appendChild(li);
    return;
  }
  for (const r of list) {
    const li = document.createElement("li");

    const name = document.createElement("span");
    name.className = "item-text";
    name.textContent = r.name;
    name.title = new Date(r.time).toLocaleString();
    name.addEventListener("click", () => {
      $("recent-menu").classList.add("hidden");
      openRecentBook(r.id);
    });

    const del = document.createElement("button");
    del.className = "item-del";
    del.textContent = "✕";
    del.title = "Убрать из списка";
    del.addEventListener("click", () => removeRecent(r.id));

    li.append(name, del);
    ul.appendChild(li);
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
  $("recent-menu").classList.toggle("hidden"));

document.addEventListener("pointerdown", (e) => {
  const menu = $("recent-menu");
  if (menu.classList.contains("hidden")) return;
  if (menu.contains(e.target) || e.target === $("btn-recent")) return;
  menu.classList.add("hidden");
});

renderRecentMenu();
