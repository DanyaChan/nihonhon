"use strict";

/* ============================================================
 * TXT: определение кодировки, разбивка на части,
 * фуригана в формате Aozora Bunko.
 * ============================================================ */

const TXT_CHUNK = 20000; // символов на "главу"

async function openTxt(file) {
  const buffer = await file.arrayBuffer();
  const text = decodeJapaneseText(buffer);
  const title = file.name.replace(/\.txt$/i, "");

  // Режем на части по строкам, чтобы не рендерить огромный DOM разом
  const lines = text.split(/\r\n|\r|\n/);
  const parts = [];
  let current = [];
  let size = 0;
  for (const line of lines) {
    current.push(line);
    size += line.length;
    if (size >= TXT_CHUNK) {
      parts.push(current);
      current = [];
      size = 0;
    }
  }
  if (current.length) parts.push(current);

  const chapters = parts.map((partLines, i) => ({
    title: parts.length === 1 ? title : chunkTitle(partLines, i),
    render: async () => renderTxtPart(partLines),
  }));

  loadBook({ id: "txt:" + file.name + ":" + file.size, title, chapters });
}

// Заголовок куска — его первая непустая строка (без Aozora-разметки фуриганы)
function chunkTitle(lines, i) {
  for (const line of lines) {
    const clean = line.replace(/《[^《》]*》/g, "").replace(/[|｜]/g, "").trim();
    if (clean) return clipTitle(clean);
  }
  return "ページ " + (i + 1);
}

function decodeJapaneseText(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    // Японские txt часто в Shift_JIS (или EUC-JP)
    for (const enc of ["shift_jis", "euc-jp"]) {
      try {
        return new TextDecoder(enc, { fatal: true }).decode(buffer);
      } catch { /* пробуем следующую */ }
    }
    return new TextDecoder("utf-8").decode(buffer); // как есть
  }
}

function renderTxtPart(lines) {
  const fragment = document.createElement("div");
  for (const line of lines) {
    const p = document.createElement("p");
    if (line.trim() === "") {
      p.innerHTML = "&nbsp;";
    } else {
      appendWithAozoraRuby(p, line);
    }
    fragment.appendChild(p);
  }
  return fragment;
}

/**
 * Поддержка фуриганы в формате Aozora Bunko:
 *   漢字《かんじ》  и  ｜振り仮名《ふりがな》
 */
function appendWithAozoraRuby(parent, line) {
  const re = /(?:[|｜]([^《》|｜]+)|([㐀-鿿豈-﫿々〆ヵヶ]+))《([^《》]+)》/g;
  let last = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) {
      parent.appendChild(document.createTextNode(line.slice(last, m.index)));
    }
    const ruby = document.createElement("ruby");
    ruby.appendChild(document.createTextNode(m[1] || m[2]));
    const rt = document.createElement("rt");
    rt.textContent = m[3];
    ruby.appendChild(rt);
    parent.appendChild(ruby);
    last = re.lastIndex;
  }
  if (last < line.length) {
    parent.appendChild(document.createTextNode(line.slice(last)));
  }
}
