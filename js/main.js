"use strict";

/* ============================================================
 * Точка входа: открытие файлов и обработчики событий.
 * ============================================================ */

// ---------- открытие файлов ----------

async function openFile(file) {
  if (!file) return;
  try {
    if (/\.epub$/i.test(file.name)) await openEpub(file);
    else if (/\.txt$/i.test(file.name)) await openTxt(file);
    else { alert("Поддерживаются только .epub и .txt"); return; }
    // библиотека: недавние + файл и обложка в IndexedDB (ждём, иначе
    // полка, открытая сразу после, не найдёт записи книги)
    await recordRecent(file, { title: state.title, cover: state.cover });
  } catch (e) {
    console.error(e);
    alert("Не удалось открыть книгу: " + e.message);
  }
}

/** Выбрали несколько файлов: первый открываем, остальные — просто в полку. */
async function openFiles(fileList) {
  const files = [...fileList].filter((f) => /\.(epub|txt)$/i.test(f.name));
  if (!files.length) {
    if (fileList.length) alert("Поддерживаются только .epub и .txt");
    return;
  }
  await openFile(files[0]);
  for (const file of files.slice(1)) {
    try {
      await importBook(file);
    } catch (e) {
      console.warn("Не удалось добавить книгу в полку:", file.name, e);
    }
  }
}

reopenLastBook();

$("btn-open").addEventListener("click", () => els.fileInput.click());
$("btn-open-welcome").addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", () => {
  const files = [...els.fileInput.files];
  els.fileInput.value = "";
  openFiles(files);
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
$("btn-view").addEventListener("click", toggleViewMode);

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
  if (state.current < 0 || scrollMode) return; // в скролле листает браузер
  if (libraryOpen()) return; // открыта полка — книгу не листаем
  // Комбинации с модификаторами (Cmd+← и т.п.) — браузеру
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Фокус в элементах управления (ползунок, пикеры, кнопки) — им
  if (e.target instanceof Element &&
      e.target.closest("input, textarea, select, button, [contenteditable]")) {
    return;
  }
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
  if (scrollMode) {
    // Вертикальное письмо скроллится горизонтально: колесо → сдвиг влево
    if (verticalMode && e.deltaY) {
      e.preventDefault();
      els.reader.scrollBy({ left: -e.deltaY });
    }
    return; // горизонтальное письмо — обычный браузерный скролл
  }
  e.preventDefault();
  if (wheelLock) return;
  wheelLock = true;
  setTimeout(() => { wheelLock = false; }, 120);
  if (e.deltaY > 0 || e.deltaX > 0) nextPage();
  else prevPage();
}, { passive: false });

// ---------- размер шрифта ----------

let fontSize = 20;
try { fontSize = parseInt(localStorage.getItem("nihonhon:fontSize")) || 20; } catch {}
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
  openFiles(e.dataTransfer.files);
});
