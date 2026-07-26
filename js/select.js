"use strict";

/* ============================================================
 * Выделение текста: фуригана на всех выделенных словах
 * и поп-ап с переводом на английский.
 * Использует токенизатор и утилиты из furigana.js.
 * ============================================================ */

// Предел длины текста для перевода: текст уходит GET-запросом, и после
// encodeURIComponent японский раздувается ~в 9 раз — длиннее упрётся
// в лимиты URL у прокси/серверов (414)
const TRANSLATE_MAX = 450;

// Обёртки <ruby>, добавленные для текущего выделения
const selRubies = [];

// ---------- поп-ап перевода ----------

const transPop = document.createElement("div");
transPop.id = "translate-pop";
transPop.className = "hidden";
document.body.appendChild(transPop);

let translateRequestId = 0;

function showTransPop(rect) {
  transPop.classList.remove("hidden");
  const w = Math.min(380, window.innerWidth - 16);
  transPop.style.maxWidth = w + "px";
  const rendered = transPop.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - rendered.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - rendered.width - 8));
  let top = rect.bottom + 10;
  if (top + rendered.height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - rendered.height - 10);
  }
  transPop.style.left = left + "px";
  transPop.style.top = top + "px";
}

async function showTranslation(text, rect) {
  const id = ++translateRequestId;
  transPop.textContent = "翻訳中…";
  showTransPop(rect);

  let result;
  try {
    result = await translateToEnglish(text.slice(0, TRANSLATE_MAX));
  } catch (e) {
    console.warn("Перевод не удался:", e);
    result = "⚠️ Не удалось перевести (нет сети?)";
  }
  if (id !== translateRequestId) return; // уже выделили что-то другое
  transPop.textContent = result;
  showTransPop(rect);
}

async function translateToEnglish(text) {
  // Основной вариант: неофициальный endpoint Google Translate
  try {
    const res = await fetch(
      "https://translate.googleapis.com/translate_a/single" +
      "?client=gtx&sl=ja&tl=en&dt=t&q=" + encodeURIComponent(text));
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    return data[0].map((part) => part[0]).join("");
  } catch (e) {
    // Запасной: MyMemory (лимит ~5000 символов в день без ключа)
    const res = await fetch(
      "https://api.mymemory.translated.net/get?q=" +
      encodeURIComponent(text) + "&langpair=ja|en");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const t = data.responseData?.translatedText;
    if (!t) throw e;
    return t;
  }
}

// ---------- фуригана на выделении ----------

function clearSelectionAnnotations() {
  for (const ruby of selRubies) {
    if (!ruby.isConnected) continue;
    const parent = ruby.parentNode;
    ruby.querySelector("rt")?.remove();
    parent.replaceChild(document.createTextNode(ruby.textContent), ruby);
    parent.normalize();
  }
  selRubies.length = 0;
  transPop.classList.add("hidden");
}

function textNodesIn(range) {
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) return [root];
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (range.intersectsNode(n)) nodes.push(n);
  }
  return nodes;
}

function annotateSelection(range) {
  for (const node of textNodesIn(range)) {
    if (node.parentElement?.closest("ruby")) continue; // фуригана уже есть

    const text = node.textContent;
    let selStart = node === range.startContainer ? range.startOffset : 0;
    let selEnd = node === range.endContainer ? range.endOffset : text.length;
    if (selStart >= selEnd) continue;

    const tokens = furiganaTokenizer.tokenize(text);
    // Оборачиваем справа налево: сдвиги слева от обёрнутого куска
    // остаются верными, и ссылка на узел не устаревает
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      const start = t.word_position - 1;
      const end = start + t.surface_form.length;
      if (end <= selStart || start >= selEnd) continue;
      if (!HAS_KANJI.test(t.surface_form) || !t.reading) continue;

      const r = document.createRange();
      r.setStart(node, start);
      r.setEnd(node, Math.min(end, text.length));
      const ruby = document.createElement("ruby");
      ruby.className = "hover-ruby";
      try {
        r.surroundContents(ruby);
      } catch {
        continue; // граница попала внутрь разметки — пропускаем слово
      }
      const rt = document.createElement("rt");
      rt.textContent = kataToHira(t.reading);
      ruby.appendChild(rt);
      selRubies.push(ruby);
    }
  }
}

// ---------- события ----------

/**
 * Текст выделения без фуриганы: sel.toString() включает содержимое
 * <rt> (чтения над словами), поэтому берём копию фрагмента и
 * удаляем из неё rt/rp перед извлечением текста.
 */
function selectionTextWithoutRuby(range) {
  const fragment = range.cloneContents();
  fragment.querySelectorAll("rt, rp").forEach((n) => n.remove());
  return fragment.textContent;
}

function handleSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  let range = sel.getRangeAt(0);
  if (!els.flow.contains(range.commonAncestorContainer)) return;

  const text = selectionTextWithoutRuby(range).replace(/\s+/g, " ").trim();
  if (!text || !/[぀-ヿ㐀-鿿]/.test(text)) return; // нет японского — молчим

  const rect = range.getBoundingClientRect(); // до изменения DOM
  clearSelectionAnnotations();
  // После снятия старых обёрток узлы могли смениться — берём range заново
  if (sel.rangeCount && !sel.isCollapsed) {
    range = sel.getRangeAt(0);
  } else {
    range = null;
  }

  if (range && furiganaTokenizer) {
    annotateSelection(range);
  } else if (!furiganaTokenizer) {
    ensureTokenizer(); // словарь ещё грузится — будет работать со следующего раза
  }
  showTranslation(text, rect);
}

// ---------- запуск: мышь и тачскрин ----------

// На тачскрине mouseup не приходит: выделение делается долгим нажатием
// и перетаскиванием маркеров, а selectionchange сыпется всё это время.
// Поэтому для касаний ждём, пока палец отпущен и выделение "устаканится".

let selPointerType = "mouse";
let selPointerDown = false;
let selTouchTimer;

function scheduleTouchSelection() {
  clearTimeout(selTouchTimer);
  selTouchTimer = setTimeout(() => {
    if (!selPointerDown) handleSelection();
  }, 450);
}

els.reader.addEventListener("mouseup", () => {
  if (selPointerType === "mouse") setTimeout(handleSelection, 0);
});

document.addEventListener("selectionchange", () => {
  if (selPointerType === "touch" || selPointerType === "pen") {
    scheduleTouchSelection();
  }
});

document.addEventListener("pointerdown", (e) => {
  selPointerType = e.pointerType || "mouse";
  selPointerDown = true;
  if (transPop.contains(e.target)) return; // тап по поп-апу — не закрываем
  if (selRubies.length || !transPop.classList.contains("hidden")) {
    clearSelectionAnnotations();
  }
});

document.addEventListener("pointerup", (e) => {
  selPointerDown = false;
  if (e.pointerType === "touch" || e.pointerType === "pen") {
    scheduleTouchSelection();
  }
});

document.addEventListener("pointercancel", () => {
  selPointerDown = false;
});

// Перелистывание страниц — убираем разметку выделения и поп-ап.
// Только клавиши листания: любые другие (в т.ч. Cmd/Ctrl+C) не должны
// трогать DOM, иначе выделение уничтожится до самого копирования.
const CLEAR_KEYS = ["ArrowLeft", "ArrowRight", "PageUp", "PageDown", " ", "Escape"];
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!CLEAR_KEYS.includes(e.key)) return;
  if (selRubies.length || !transPop.classList.contains("hidden")) {
    clearSelectionAnnotations();
  }
});
