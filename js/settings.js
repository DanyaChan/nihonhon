"use strict";

/* ============================================================
 * Панель настроек (⚙): цвет текста и фона области чтения,
 * ширина текстовой области. Хранится в localStorage.
 * ============================================================ */

/* Шрифты — только системные: приложение работает без сети и без сборки.
   Первый пункт — стек по умолчанию, дальше конкретные семейства.
   Что из этого есть на машине, выясняет fontInstalled(). */
const FONTS = [
  {
    id: "gothic",
    name: "システム標準 (по умолчанию)",
    stack: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", ' +
           '"Noto Sans JP", "Meiryo", sans-serif',
  },
  { id: "hiragino-sans", name: "ヒラギノ角ゴシック",
    stack: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif' },
  { id: "hiragino-mincho", name: "ヒラギノ明朝",
    stack: '"Hiragino Mincho ProN", "Hiragino Mincho Pro", serif' },
  { id: "hiragino-maru", name: "ヒラギノ丸ゴシック",
    stack: '"Hiragino Maru Gothic ProN", "Hiragino Maru Gothic Pro", sans-serif' },
  { id: "yu-gothic", name: "游ゴシック",
    stack: '"YuGothic", "Yu Gothic", sans-serif' },
  { id: "yu-mincho", name: "游明朝",
    stack: '"YuMincho", "Yu Mincho", serif' },
  { id: "toppan-mincho", name: "凸版文久明朝",
    stack: '"Toppan Bunkyu Mincho", "Toppan Bunkyu Midashi Mincho", serif' },
  { id: "toppan-gothic", name: "凸版文久ゴシック",
    stack: '"Toppan Bunkyu Gothic", sans-serif' },
  { id: "klee", name: "クレー (рукописный)",
    stack: '"Klee One", "Klee", "Klee Medium", cursive' },
  { id: "osaka", name: "Osaka",
    stack: '"Osaka", sans-serif' },
  { id: "osaka-mono", name: "Osaka−等幅",
    stack: '"Osaka-Mono", monospace' },
  { id: "meiryo", name: "メイリオ (Meiryo)",
    stack: '"Meiryo", "Meiryo UI", sans-serif' },
  { id: "ms-gothic", name: "ＭＳ ゴシック (MS Gothic)",
    stack: '"MS Gothic", "MS PGothic", monospace' },
  { id: "ms-mincho", name: "ＭＳ 明朝 (MS Mincho)",
    stack: '"MS Mincho", "MS PMincho", serif' },
  { id: "biz-gothic", name: "BIZ UDゴシック",
    stack: '"BIZ UDGothic", "BIZ UDPGothic", sans-serif' },
  { id: "biz-mincho", name: "BIZ UD明朝",
    stack: '"BIZ UDMincho", "BIZ UDPMincho", serif' },
  { id: "ud-kyokasho", name: "UDデジタル教科書体",
    stack: '"UD Digi Kyokasho N-R", "UD Digi Kyokasho NK-R", sans-serif' },
  { id: "noto-sans", name: "Noto Sans JP",
    stack: '"Noto Sans JP", "Noto Sans CJK JP", sans-serif' },
  { id: "noto-serif", name: "Noto Serif JP",
    stack: '"Noto Serif JP", "Noto Serif CJK JP", serif' },
  { id: "ipa-mincho", name: "IPA明朝 (IPAMincho)",
    stack: '"IPAMincho", "IPAexMincho", serif' },
];

/**
 * Есть ли семейство в системе. Ширину образца сравниваем с двумя
 * запасными шрифтами: если хоть с одним она разошлась, значит текст
 * нарисовало запрошенное семейство, а не подмена.
 */
let fontProbe = null;
function fontInstalled(family) {
  fontProbe = fontProbe || document.createElement("canvas").getContext("2d");
  const sample = "日本語あアAWM";
  for (const generic of ["monospace", "serif"]) {
    fontProbe.font = "16px " + generic;
    const base = fontProbe.measureText(sample).width;
    fontProbe.font = '16px "' + family + '", ' + generic;
    if (Math.abs(fontProbe.measureText(sample).width - base) > 0.5) return true;
  }
  return false;
}

/* ------------------------- темы оформления -------------------------
 * Цвета темы раскладываются в CSS-переменные, которыми пользуется вся
 * разметка. Первая тема повторяет значения :root в style.css.
 */
const COLOR_FIELDS = [
  { key: "readerFg", cssVar: "--reader-fg", id: "col-reader-fg" },
  { key: "readerBg", cssVar: "--reader-bg", id: "col-reader-bg" },
  { key: "fg", cssVar: "--fg", id: "col-fg" },
  { key: "bg", cssVar: "--bg", id: "col-bg" },
  { key: "panel", cssVar: "--panel", id: "col-panel" },
  { key: "border", cssVar: "--border", id: "col-border" },
  { key: "accent", cssVar: "--accent", id: "col-accent" },
  { key: "muted", cssVar: "--muted", id: "col-muted" },
];

const THEMES = [
  { id: "washi", name: "和紙 — бумага (по умолчанию)", colors: {
    readerFg: "#2b2a27", readerBg: "#faf7f0", fg: "#2b2a27", bg: "#faf7f0",
    panel: "#f1ece1", border: "#ddd6c8", accent: "#b3452f", muted: "#8a857a" } },
  { id: "sepia", name: "セピア — сепия", colors: {
    readerFg: "#4a3a29", readerBg: "#f3e7d0", fg: "#4a3a29", bg: "#f3e7d0",
    panel: "#ece0c9", border: "#d9c9ab", accent: "#9a5b2c", muted: "#8d7a5e" } },
  { id: "paper", name: "白 — белая", colors: {
    readerFg: "#1a1a1a", readerBg: "#ffffff", fg: "#1a1a1a", bg: "#ffffff",
    panel: "#f4f4f6", border: "#dcdce0", accent: "#0b6ebd", muted: "#777777" } },
  { id: "night", name: "夜 — тёмная", colors: {
    readerFg: "#cfcdc8", readerBg: "#16181c", fg: "#d8d6d1", bg: "#16181c",
    panel: "#1f2228", border: "#2e333b", accent: "#e0794f", muted: "#8a8f98" } },
  { id: "sumi", name: "墨 — чёрная (OLED)", colors: {
    readerFg: "#c9c7c2", readerBg: "#000000", fg: "#c9c7c2", bg: "#000000",
    panel: "#0c0c0c", border: "#242424", accent: "#cf6f45", muted: "#7e7c78" } },
  { id: "ai", name: "藍 — индиго", colors: {
    readerFg: "#cfdae3", readerBg: "#14202b", fg: "#cfdae3", bg: "#14202b",
    panel: "#1a2937", border: "#294055", accent: "#6fb2d2", muted: "#7f95a6" } },
  { id: "moss", name: "苔 — зелёная", colors: {
    readerFg: "#e2e6d8", readerBg: "#1c221b", fg: "#e2e6d8", bg: "#1c221b",
    panel: "#242b22", border: "#38412f", accent: "#a3c46b", muted: "#8b9480" } },
  { id: "contrast", name: "高コントラスト — контрастная", colors: {
    readerFg: "#ffffff", readerBg: "#000000", fg: "#ffffff", bg: "#000000",
    panel: "#111111", border: "#555555", accent: "#ffd400", muted: "#bbbbbb" } },
];

const CUSTOM_THEME = "custom";

const SETTINGS_DEFAULTS = {
  font: "gothic",  // id из FONTS
  theme: "washi",  // id из THEMES либо "custom"
  custom: null,    // цвета своей темы, создаются при первом выборе
  width: 760,      // px, --content-width
  lineHeight: 1.9, // --content-line-height
  indent: 1,       // отступ первой строки абзаца, em
  delayedSave: true, // позиция в скролле пишется после 5 с неподвижности
  hideTop: false,    // верхняя панель выезжает по наведению на край
  hideBottom: false, // то же для нижней
  blurImages: false, // картинки размыты, пока не кликнешь по ним
};

let settings = { ...SETTINGS_DEFAULTS };
try {
  Object.assign(settings,
    JSON.parse(localStorage.getItem("nihonhon:settings")) || {});
} catch { /* нет сохранённых настроек */ }

// Раньше цвета книги были двумя отдельными настройками — переносим их
// в свою тему, чтобы у тех, кто их менял, ничего не сбросилось
if (settings.fg || settings.bg) {
  const base = THEMES[0].colors;
  if (settings.fg !== base.readerFg || settings.bg !== base.readerBg) {
    settings.theme = CUSTOM_THEME;
    settings.custom = { ...base,
      readerFg: settings.fg || base.readerFg,
      readerBg: settings.bg || base.readerBg };
  }
  delete settings.fg;
  delete settings.bg;
}

const settingsPanel = $("settings");
const setTheme = $("set-theme");
const customColors = $("custom-colors");
const setWidth = $("set-width");
const setWidthVal = $("set-width-val");
const setFont = $("set-font");
const setLineHeight = $("set-line-height");
const setLineHeightVal = $("set-line-height-val");
const setIndent = $("set-indent");
const setIndentVal = $("set-indent-val");
const setDelayedSave = $("set-delayed-save");
const setHideTop = $("set-hide-top");
const setHideBottom = $("set-hide-bottom");
const setBlurImages = $("set-blur-images");

// Список шрифтов: пункт нарисован своим шрифтом, а отсутствующие в системе
// собраны отдельной группой — выбрать их всё равно можно (проверка не
// абсолютна, да и шрифт можно доустановить)
(function buildFontOptions() {
  const present = document.createElement("optgroup");
  present.label = "Есть в системе";
  const missing = document.createElement("optgroup");
  missing.label = "Не найдены";

  FONTS.forEach((f, i) => {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.name;
    opt.style.fontFamily = f.stack;
    const families = [...f.stack.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const ok = i === 0 || families.some(fontInstalled);
    (ok ? present : missing).appendChild(opt);
  });

  setFont.appendChild(present);
  if (missing.children.length) setFont.appendChild(missing);
})();

// Список тем
for (const t of THEMES) {
  const opt = document.createElement("option");
  opt.value = t.id;
  opt.textContent = t.name;
  setTheme.appendChild(opt);
}
setTheme.appendChild(Object.assign(document.createElement("option"),
  { value: CUSTOM_THEME, textContent: "Своя тема" }));

// Цвета текущей темы (для своей — сохранённые, иначе цвета пресета)
function themeColors() {
  if (settings.theme === CUSTOM_THEME && settings.custom) return settings.custom;
  return (THEMES.find((t) => t.id === settings.theme) || THEMES[0]).colors;
}

function applySettings() {
  const root = document.documentElement.style;
  const font = FONTS.find((f) => f.id === settings.font) || FONTS[0];
  root.setProperty("--content-font", font.stack);
  setFont.value = font.id;

  const colors = themeColors();
  for (const f of COLOR_FIELDS) {
    root.setProperty(f.cssVar, colors[f.key]);
    $(f.id).value = colors[f.key];
  }
  setTheme.value = settings.theme;
  customColors.classList.toggle("hidden", settings.theme !== CUSTOM_THEME);

  root.setProperty("--content-width", settings.width + "px");
  root.setProperty("--content-line-height", settings.lineHeight);
  // Японский текст часто уже начинается с идеографического пробела U+3000
  // шириной в знак. До 1em он лишний — прячем его; от 1em и выше он и есть
  // первый em отступа, поэтому CSS добавляет только остаток
  const indent = Number(settings.indent);
  root.setProperty("--content-indent",
    (indent >= 1 ? indent - 1 : indent) + "em");
  document.body.classList.toggle("hide-u3000", indent < 1);

  document.body.classList.toggle("hide-top", !!settings.hideTop);
  document.body.classList.toggle("hide-bottom", !!settings.hideBottom);
  document.body.classList.toggle("blur-images", !!settings.blurImages);

  setWidth.value = settings.width;
  setWidthVal.textContent = settings.width + " px";
  setLineHeight.value = settings.lineHeight;
  setLineHeightVal.textContent = Number(settings.lineHeight).toFixed(1);
  setIndent.value = settings.indent;
  setIndentVal.textContent = Number(settings.indent).toFixed(1) + " em";
  setDelayedSave.checked = settings.delayedSave !== false;
  setHideTop.checked = !!settings.hideTop;
  setHideBottom.checked = !!settings.hideBottom;
  setBlurImages.checked = !!settings.blurImages;
}

function saveSettings() {
  try {
    localStorage.setItem("nihonhon:settings", JSON.stringify(settings));
  } catch { /* localStorage недоступен */ }
}

// Настройки, меняющие размер области чтения
const LAYOUT_KEYS = ["font", "width", "lineHeight", "indent",
                     "hideTop", "hideBottom"];

function updateSetting(key, value) {
  settings[key] = value;
  applySettings();
  saveSettings();
  if (LAYOUT_KEYS.includes(key)) repaginate();
}

// Выбор темы. Своя тема при первом выборе наследует цвета текущей —
// её удобнее править от готового набора, чем собирать с нуля
setTheme.addEventListener("change", () => {
  if (setTheme.value === CUSTOM_THEME && !settings.custom) {
    settings.custom = { ...themeColors() };
  }
  updateSetting("theme", setTheme.value);
});

// Пипетки своей темы
for (const f of COLOR_FIELDS) {
  $(f.id).addEventListener("input", () => {
    settings.custom = { ...themeColors(), [f.key]: $(f.id).value };
    updateSetting("theme", CUSTOM_THEME);
  });
}

setWidth.addEventListener("input", () =>
  updateSetting("width", Number(setWidth.value)));
setFont.addEventListener("change", () => updateSetting("font", setFont.value));
setLineHeight.addEventListener("input", () =>
  updateSetting("lineHeight", Number(setLineHeight.value)));
setIndent.addEventListener("input", () =>
  updateSetting("indent", Number(setIndent.value)));
setDelayedSave.addEventListener("change", () =>
  updateSetting("delayedSave", setDelayedSave.checked));
setHideTop.addEventListener("change", () =>
  updateSetting("hideTop", setHideTop.checked));
setHideBottom.addEventListener("change", () =>
  updateSetting("hideBottom", setHideBottom.checked));
setBlurImages.addEventListener("change", () =>
  updateSetting("blurImages", setBlurImages.checked));

// Клик по размытой картинке открывает её (повторный — снова прячет).
// Снятие размытия живёт до перерисовки главы.
els.flow.addEventListener("click", (e) => {
  if (!settings.blurImages) return;
  const img = e.target.closest("img, svg");
  if (img) img.classList.toggle("revealed");
});

// Тачскрин: наведения нет, поэтому панель выдвигается тапом по краю
for (const [zoneId, panelId] of [["edge-top", "toolbar"],
                                 ["edge-bottom", "navbar"]]) {
  $(zoneId).addEventListener("click", () => {
    $(panelId).classList.toggle("peek");
  });
}

// Тап мимо выдвинутой панели убирает её обратно
document.addEventListener("pointerdown", (e) => {
  if (e.target.classList.contains("edge-zone")) return; // это переключатель
  for (const id of ["toolbar", "navbar"]) {
    const panel = $(id);
    if (panel.classList.contains("peek") && !panel.contains(e.target)) {
      panel.classList.remove("peek");
    }
  }
});

// Вкладки панели настроек
const settingsTabs = [...settingsPanel.querySelectorAll(".set-tab")];
const settingsPanes = [...settingsPanel.querySelectorAll(".set-pane")];
for (const tab of settingsTabs) {
  tab.addEventListener("click", () => {
    settingsTabs.forEach((t) => t.classList.toggle("active", t === tab));
    settingsPanes.forEach((p) =>
      p.classList.toggle("hidden", p.dataset.pane !== tab.dataset.tab));
  });
}

$("set-reset").addEventListener("click", () => {
  settings = { ...SETTINGS_DEFAULTS };
  applySettings();
  saveSettings();
  repaginate();
});

$("btn-settings").addEventListener("click", () =>
  settingsPanel.classList.toggle("hidden"));

// Клик вне панели закрывает её
document.addEventListener("pointerdown", (e) => {
  if (settingsPanel.classList.contains("hidden")) return;
  if (settingsPanel.contains(e.target) || e.target === $("btn-settings")) return;
  settingsPanel.classList.add("hidden");
});

applySettings();
