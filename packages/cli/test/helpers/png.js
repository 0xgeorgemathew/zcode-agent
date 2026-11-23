'use strict';
// Test fixture (not a test): a PNG showing a number in large white digits on
// a blue background, built with zlib alone. Only a model that really sees
// the image can read the number back.
const zlib = require('node:zlib');

const FONT = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['10010', '10010', '10010', '11111', '00010', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['01110', '10000', '11110', '10001', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
};

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([head, body, crc]);
}

function numberPng(number, { scale = 16 } = {}) {
  const digits = String(number).split('');
  const width = 80 + digits.length * (6 * scale + 10);
  const height = 120 + 7 * scale;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) row.set([20, 90, 200], 1 + x * 3);
    rows.push(row);
  }
  digits.forEach((d, i) => {
    const x0 = 40 + i * (6 * scale + 10);
    FONT[d].forEach((line, r) => {
      [...line].forEach((bit, c) => {
        if (bit !== '1') return;
        for (let yy = 0; yy < scale; yy++) {
          for (let xx = 0; xx < scale; xx++) rows[60 + r * scale + yy].set([255, 255, 255], 1 + (x0 + c * scale + xx) * 3);
        }
      });
    });
  });
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { numberPng };
