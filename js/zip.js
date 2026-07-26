"use strict";

/* ============================================================
 * ZIP: минимальный распаковщик (для EPUB).
 * Сжатые данные распаковываются встроенным DecompressionStream.
 * ============================================================ */

class ZipArchive {
  constructor(buffer) {
    this.data = new DataView(buffer);
    this.buffer = buffer;
    this.entries = new Map(); // имя файла -> запись центрального каталога
    this._parseCentralDirectory();
  }

  _parseCentralDirectory() {
    const d = this.data;
    // Ищем End of Central Directory (сигнатура 0x06054b50) с конца
    let eocd = -1;
    const min = Math.max(0, d.byteLength - 65558);
    for (let i = d.byteLength - 22; i >= min; i--) {
      if (d.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Не найден каталог ZIP — файл повреждён?");

    const count = d.getUint16(eocd + 10, true);
    let offset = d.getUint32(eocd + 16, true);

    for (let i = 0; i < count; i++) {
      if (d.getUint32(offset, true) !== 0x02014b50) break;
      const method = d.getUint16(offset + 10, true);
      const compressedSize = d.getUint32(offset + 20, true);
      const nameLen = d.getUint16(offset + 28, true);
      const extraLen = d.getUint16(offset + 30, true);
      const commentLen = d.getUint16(offset + 32, true);
      const localOffset = d.getUint32(offset + 42, true);
      const nameBytes = new Uint8Array(this.buffer, offset + 46, nameLen);
      const name = new TextDecoder("utf-8").decode(nameBytes);
      this.entries.set(name, { method, compressedSize, localOffset });
      offset += 46 + nameLen + extraLen + commentLen;
    }
  }

  has(name) {
    return this.entries.has(name);
  }

  /** Возвращает Uint8Array с содержимым файла. */
  async extract(name) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error("В EPUB нет файла: " + name);

    const d = this.data;
    const lo = entry.localOffset;
    if (d.getUint32(lo, true) !== 0x04034b50) {
      throw new Error("Повреждённый локальный заголовок: " + name);
    }
    const nameLen = d.getUint16(lo + 26, true);
    const extraLen = d.getUint16(lo + 28, true);
    const start = lo + 30 + nameLen + extraLen;
    const raw = new Uint8Array(this.buffer, start, entry.compressedSize);

    if (entry.method === 0) return raw; // без сжатия
    if (entry.method !== 8) throw new Error("Неподдерживаемый метод сжатия: " + entry.method);

    const stream = new Blob([raw]).stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async extractText(name) {
    return new TextDecoder("utf-8").decode(await this.extract(name));
  }
}
