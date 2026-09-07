/* Lecteur ZIP minimal (docx/xlsx/pptx sont des ZIP) — via zlib intégré à Node. */
'use strict';
const zlib = require('node:zlib');

function readZip(buf) {
  // End Of Central Directory : on remonte depuis la fin (commentaire ≤ 64 Ko)
  const sig = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === sig) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('archive ZIP illisible (fin de catalogue introuvable)');

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (off === 0xffffffff) throw new Error('ZIP64 non géré par ce lecteur');

  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const cmtLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.set(name, { method, compSize, local });
    off += 46 + nameLen + extraLen + cmtLen;
  }

  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    read(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (buf.readUInt32LE(e.local) !== 0x04034b50) throw new Error(`entrée ZIP corrompue : ${name}`);
      const nameLen = buf.readUInt16LE(e.local + 26);
      const extraLen = buf.readUInt16LE(e.local + 28);
      const start = e.local + 30 + nameLen + extraLen;
      const raw = buf.subarray(start, start + e.compSize);
      if (e.method === 0) return raw;
      if (e.method === 8) return zlib.inflateRawSync(raw);
      throw new Error(`compression ZIP non gérée (méthode ${e.method}) : ${name}`);
    },
    text(name) {
      const b = this.read(name);
      return b ? b.toString('utf8') : null;
    },
  };
}

module.exports = { readZip };
