const fs = require('node:fs');
const zlib = require('node:zlib');
const size = 128;
const image = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const p = y * (size * 4 + 1) + 1 + x * 4;
  const border = x > 20 && x < 108 && y > 20 && y < 108 && ((x - 22) % 28 < 4 || (y - 22) % 28 < 4);
  image.set(border ? [67, 220, 210, 255] : [17, 24, 39, 255], p);
}
function crc32(buffer) { let c = 0xffffffff; for (const b of buffer) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type), out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length); name.copy(out, 4); data.copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length); return out; }
const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
fs.mkdirSync('media', { recursive: true });
fs.writeFileSync('media/gridlens.png', Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(image)), chunk('IEND', Buffer.alloc(0))]));