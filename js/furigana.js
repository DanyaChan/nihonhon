"use strict";

/* ============================================================
 * Фуригана при наведении: слово под курсором определяется
 * токенизатором kuromoji (словарь IPAdic грузится с CDN при
 * первом наведении), и над словом появляется чтение — обычным
 * тегом <ruby>, как у встроенной фуриганы. При уходе курсора
 * слово разворачивается обратно в текст.
 * ============================================================ */

// Только относительный путь: kuromoji прогоняет его через path.join,
// который калечит абсолютные URL ("https://" -> "https:/")
const KUROMOJI_DICT = "lib/dict/";

let furiganaTokenizer = null;
let furiganaLoading = false;
let furiganaFailed = false;

// Кэш разбора последнего абзаца, чтобы не токенизировать на каждое движение мыши
const tokenCache = { text: null, tokens: null };

// Текущее слово, обёрнутое в <ruby> при наведении
let hoverRuby = null;

// ---------- индикатор загрузки словаря ----------

const furiganaTip = document.createElement("div");
furiganaTip.id = "furigana-tip";
furiganaTip.className = "hidden";
furiganaTip.textContent = "辞書読み込み中…";
document.body.appendChild(furiganaTip);

function showLoadingTip(x, y) {
  furiganaTip.classList.remove("hidden");
  furiganaTip.style.left = x + 12 + "px";
  furiganaTip.style.top = y + 16 + "px";
}

function hideLoadingTip() {
  furiganaTip.classList.add("hidden");
}

// ---------- токенизатор ----------

function ensureTokenizer() {
  if (furiganaTokenizer || furiganaLoading || furiganaFailed) return;
  if (typeof kuromoji === "undefined") {
    furiganaFailed = true;
    console.warn("kuromoji.js не загрузился — фуригана по наведению недоступна");
    return;
  }
  furiganaLoading = true;
  kuromoji.builder({ dicPath: KUROMOJI_DICT }).build((err, tk) => {
    furiganaLoading = false;
    hideLoadingTip();
    if (err) {
      furiganaFailed = true;
      console.warn("Не удалось загрузить словарь фуриганы:", err);
      return;
    }
    furiganaTokenizer = tk;
  });
}

const HAS_KANJI = /[㐀-鿿々〆]/;
const WORD_CHAR = /[㐀-鿿々〆ぁ-ゖァ-ヺー]/;

function kataToHira(s) {
  return s.replace(/[ァ-ヶ]/g,
    (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

// ---------- обёртка слова в <ruby> ----------

function removeHoverRuby() {
  if (!hoverRuby) return;
  if (hoverRuby.isConnected) {
    const parent = hoverRuby.parentNode;
    // Возвращаем на место только основной текст (без rt)
    hoverRuby.querySelector("rt")?.remove();
    parent.replaceChild(document.createTextNode(hoverRuby.textContent), hoverRuby);
    parent.normalize(); // склеиваем соседние текстовые узлы обратно
  }
  hoverRuby = null;
}

function wrapTokenInRuby(node, start, end, reading) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);

  const ruby = document.createElement("ruby");
  ruby.className = "hover-ruby";
  try {
    range.surroundContents(ruby);
  } catch {
    return; // на границах разметки — просто не показываем
  }
  const rt = document.createElement("rt");
  rt.textContent = reading;
  ruby.appendChild(rt);
  hoverRuby = ruby;
}

// ---------- определение слова под курсором ----------

function caretFromPoint(x, y) {
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    return pos && { node: pos.offsetNode, offset: pos.offset };
  }
  if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    return range && { node: range.startContainer, offset: range.startOffset };
  }
  return null;
}

function furiganaAt(e) {
  // Идёт выделение текста — не трогаем DOM, иначе выделение сломается
  if (e.buttons || !window.getSelection().isCollapsed) return;

  // Курсор всё ещё над текущим словом — ничего не делаем
  if (hoverRuby && e.target instanceof Element && hoverRuby.contains(e.target)) {
    return;
  }
  // Снимаем прошлую обёртку до вычисления позиции: DOM возвращается
  // в исходное состояние, и офсеты снова совпадают с разбором
  removeHoverRuby();

  const caret = caretFromPoint(e.clientX, e.clientY);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return;

  // Пропускаем текст, у которого фуригана уже есть
  if (caret.node.parentElement?.closest("ruby")) return;

  const text = caret.node.textContent;
  const offset = Math.min(caret.offset, text.length - 1);
  if (offset < 0 || !WORD_CHAR.test(text[offset])) return;

  if (!furiganaTokenizer) {
    ensureTokenizer();
    if (furiganaLoading) showLoadingTip(e.clientX, e.clientY);
    return;
  }

  if (tokenCache.text !== text) {
    tokenCache.text = text;
    tokenCache.tokens = furiganaTokenizer.tokenize(text);
  }

  // word_position у kuromoji — позиция от 1 в разобранной строке
  const token = tokenCache.tokens.find((t) => {
    const start = t.word_position - 1;
    return offset >= start && offset < start + t.surface_form.length;
  });

  if (!token || !HAS_KANJI.test(token.surface_form) || !token.reading) return;

  const start = token.word_position - 1;
  wrapTokenInRuby(caret.node, start,
    Math.min(start + token.surface_form.length, text.length),
    kataToHira(token.reading));
}

// ---------- события ----------

let furiganaTimer;
els.reader.addEventListener("mousemove", (e) => {
  if (state.current < 0) return;
  clearTimeout(furiganaTimer);
  furiganaTimer = setTimeout(() => furiganaAt(e), 40);
});
els.reader.addEventListener("mouseleave", () => {
  clearTimeout(furiganaTimer);
  removeHoverRuby();
});
