"use strict";

/* ============================================================
 * Панель настроек (⚙): цвет текста и фона области чтения,
 * ширина текстовой области. Хранится в localStorage.
 * ============================================================ */

const SETTINGS_DEFAULTS = {
  fg: "#2b2a27",   // должны совпадать с --fg / --bg в style.css
  bg: "#faf7f0",
  width: 760,      // px, --content-width
  delayedSave: true, // позиция в скролле пишется после 5 с неподвижности
  hideTop: false,    // верхняя панель выезжает по наведению на край
  hideBottom: false, // то же для нижней
};

let settings = { ...SETTINGS_DEFAULTS };
try {
  Object.assign(settings,
    JSON.parse(localStorage.getItem("nihonhon:settings")) || {});
} catch { /* нет сохранённых настроек */ }

const settingsPanel = $("settings");
const setFg = $("set-fg");
const setBg = $("set-bg");
const setWidth = $("set-width");
const setWidthVal = $("set-width-val");
const setDelayedSave = $("set-delayed-save");
const setHideTop = $("set-hide-top");
const setHideBottom = $("set-hide-bottom");

function applySettings() {
  const root = document.documentElement.style;
  root.setProperty("--reader-fg", settings.fg);
  root.setProperty("--reader-bg", settings.bg);
  root.setProperty("--content-width", settings.width + "px");

  document.body.classList.toggle("hide-top", !!settings.hideTop);
  document.body.classList.toggle("hide-bottom", !!settings.hideBottom);

  setFg.value = settings.fg;
  setBg.value = settings.bg;
  setWidth.value = settings.width;
  setWidthVal.textContent = settings.width + " px";
  setDelayedSave.checked = settings.delayedSave !== false;
  setHideTop.checked = !!settings.hideTop;
  setHideBottom.checked = !!settings.hideBottom;
}

function saveSettings() {
  try {
    localStorage.setItem("nihonhon:settings", JSON.stringify(settings));
  } catch { /* localStorage недоступен */ }
}

// Настройки, меняющие размер области чтения
const LAYOUT_KEYS = ["width", "hideTop", "hideBottom"];

function updateSetting(key, value) {
  settings[key] = value;
  applySettings();
  saveSettings();
  if (LAYOUT_KEYS.includes(key)) repaginate();
}

setFg.addEventListener("input", () => updateSetting("fg", setFg.value));
setBg.addEventListener("input", () => updateSetting("bg", setBg.value));
setWidth.addEventListener("input", () =>
  updateSetting("width", Number(setWidth.value)));
setDelayedSave.addEventListener("change", () =>
  updateSetting("delayedSave", setDelayedSave.checked));
setHideTop.addEventListener("change", () =>
  updateSetting("hideTop", setHideTop.checked));
setHideBottom.addEventListener("change", () =>
  updateSetting("hideBottom", setHideBottom.checked));

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
