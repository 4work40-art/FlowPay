// ===========================================================================
// Определение типа файла по сигнатуре (lib/fileType.js).
//
// Загрузки, которые сохраняются и потом отдаются (вложение счёта, логотип),
// раньше доверяли клиентскому MIME/расширению. Здесь проверяем, что реальный
// тип определяется по первым байтам, и что SVG/произвольный текст под видом
// картинки распознаётся как 'unknown' (то есть будет отклонён сверкой с
// заявленным image/png|jpeg).
// ===========================================================================
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sniff, sniffFile, MIME_KIND } = require('../src/lib/fileType');

const png  = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpg  = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const pdf  = Buffer.from('%PDF-1.7\n', 'latin1');
const zip  = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const ole2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const svg  = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf-8');

test('sniff распознаёт бинарные сигнатуры', () => {
  assert.strictEqual(sniff(png), 'png');
  assert.strictEqual(sniff(jpg), 'jpg');
  assert.strictEqual(sniff(pdf), 'pdf');
  assert.strictEqual(sniff(zip), 'zip');
  assert.strictEqual(sniff(ole2), 'ole2');
});

test('SVG/текст под видом картинки — unknown (будет отклонён)', () => {
  assert.strictEqual(sniff(svg), 'unknown');
  // Ключевое свойство: заявленный image/png ожидает 'png', а реальное
  // содержимое SVG даёт 'unknown' — сверка не пройдёт.
  assert.notStrictEqual(sniff(svg), MIME_KIND['image/png']);
});

test('слишком короткий буфер — unknown, без падения', () => {
  assert.strictEqual(sniff(Buffer.from([0x89])), 'unknown');
  assert.strictEqual(sniff(Buffer.alloc(0)), 'unknown');
  assert.strictEqual(sniff(null), 'unknown');
});

test('MIME_KIND сопоставляет заявленный тип с ожидаемой сигнатурой', () => {
  assert.strictEqual(MIME_KIND['application/pdf'], 'pdf');
  assert.strictEqual(MIME_KIND['image/png'], 'png');
  assert.strictEqual(MIME_KIND['image/jpeg'], 'jpg');
});

test('sniffFile читает сигнатуру с диска', () => {
  const p = path.join(os.tmpdir(), `sk-filetype-${Date.now()}.bin`);
  fs.writeFileSync(p, png);
  try {
    assert.strictEqual(sniffFile(p), 'png');
  } finally {
    fs.unlinkSync(p);
  }
});
