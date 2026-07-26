"use strict";

/* ============================================================
 * Панель настроек (⚙): цвет текста и фона области чтения,
 * ширина текстовой области. Хранится в localStorage.
 * ============================================================ */

const SETTINGS_DEFAULTS = {
  fg: "#2b2a27",   // должны совпадать с --fg / --bg в style.css
  bg: "#faf7f0",
  width: 760,      // px, --content-width
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

function applySettings() {
  const root = document.documentElement.style;
  root.setProperty("--reader-fg", settings.fg);
  root.setProperty("--reader-bg", settings.bg);
  root.setProperty("--content-width", settings.width + "px");

  setFg.value = settings.fg;
  setBg.value = settings.bg;
  setWidth.value = settings.width;
  setWidthVal.textContent = settings.width + " px";
}

function saveSettings() {
  try {
    localStorage.setItem("nihonhon:settings", JSON.stringify(settings));
  } catch { /* localStorage недоступен */ }
}

function updateSetting(key, value) {
  settings[key] = value;
  applySettings();
  saveSettings();
  if (key === "width") repaginate(); // ширина влияет на разбивку страниц
}

setFg.addEventListener("input", () => updateSetting("fg", setFg.value));
setBg.addEventListener("input", () => updateSetting("bg", setBg.value));
setWidth.addEventListener("input", () =>
  updateSetting("width", Number(setWidth.value)));

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
