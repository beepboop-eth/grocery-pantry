// Generates web/icon.png: a 512x512 green tile with a white barcode motif.
// Hand-rolled PNG encoding so we need zero dependencies.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const SIZE = 512;
const BG = [0x4c, 0xc3, 0x8a];
const BAR = [0x10, 0x14, 0x18];

// barcode bars: [xStart, width] pairs, drawn between y=160 and y=352
const bars = [
  [120, 14], [148, 8], [170, 22], [206, 8], [228, 14], [256, 8],
  [278, 22], [314, 8], [336, 14], [364, 22], [392, 8],
];

const rows = [];
for (let y = 0; y < SIZE; y++) {
  const row = Buffer.alloc(1 + SIZE * 3); // filter byte + RGB
  for (let x = 0; x < SIZE; x++) {
    let px = BG;
    if (y >= 160 && y < 352 && bars.some(([s, w]) => x >= s && x < s + w)) px = BAR;
    row.set(px, 1 + x * 3);
  }
  rows.push(row);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type RGB

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(Buffer.concat(rows))),
  chunk("IEND", Buffer.alloc(0)),
]);

writeFileSync(new URL("../web/icon.png", import.meta.url), png);
console.log(`wrote web/icon.png (${png.length} bytes)`);
