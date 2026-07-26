"use strict";

/* ============================================================
 * Точка входа: открытие файлов и обработчики событий.
 * ============================================================ */

// ---------- хранение последнего файла (IndexedDB) ----------

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

async function saveLastFile(file) {
  try {
    await idbFiles("readwrite", (store) => store.put(file, "last"));
  } catch (e) {
    console.warn("Не удалось сохранить книгу для автозагрузки:", e);
  }
}

async function reopenLastFile() {
  try {
    const file = await idbFiles("readonly", (store) => store.get("last"));
    if (file instanceof Blob) await openFile(file, { remember: false });
  } catch (e) {
    console.warn("Не удалось открыть последнюю книгу:", e);
  }
}

// ---------- открытие файлов ----------

async function openFile(file, { remember = true } = {}) {
  if (!file) return;
  try {
    if (/\.epub$/i.test(file.name)) await openEpub(file);
    else if (/\.txt$/i.test(file.name)) await openTxt(file);
    else { alert("Поддерживаются только .epub и .txt"); return; }
    if (remember) saveLastFile(file);
  } catch (e) {
    console.error(e);
    alert("Не удалось открыть книгу: " + e.message);
  }
}

reopenLastFile();

$("btn-open").addEventListener("click", () => els.fileInput.click());
$("btn-open-welcome").addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", () => {
  openFile(els.fileInput.files[0]);
  els.fileInput.value = "";
});

// ---------- навигация ----------

$("btn-toc").addEventListener("click", () => {
  els.toc.classList.toggle("hidden");
  if (state.current >= 0) repaginate();
});
$("btn-prev").addEventListener("click", prevPage);
$("btn-next").addEventListener("click", nextPage);

applyWritingMode();
$("btn-mode").addEventListener("click", toggleWritingMode);

let resizeTimer;
window.addEventListener("resize", () => {
  if (state.current < 0) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(repaginate, 150);
});

// Стрелки ← → и колесо мыши — перелистывание страниц.
// В вертикальном режиме чтение идёт справа налево, поэтому стрелки меняются
// местами: ← — вперёд, → — назад.
document.addEventListener("keydown", (e) => {
  if (state.current < 0) return;
  const forwardKey = verticalMode ? "ArrowLeft" : "ArrowRight";
  const backKey = verticalMode ? "ArrowRight" : "ArrowLeft";
  if (e.key === backKey || e.key === "PageUp") { e.preventDefault(); prevPage(); }
  if (e.key === forwardKey || e.key === "PageDown" || e.key === " ") {
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

// ---------- размер шрифта ----------

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

// ---------- drag & drop ----------

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
