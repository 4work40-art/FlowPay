const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const { recognize } = require('../src/lib/documentRecognizer');

// Инвариант продукта: распознанный файл никогда не остаётся на диске дольше
// одного запроса — ни во временной директории при успехе, ни при ошибке
// разбора. Фиксируем это тестом, чтобы будущие изменения в documentRecognizer
// не сломали его случайно (например, забыв try/finally вокруг временной
// директории).
function leftoverTempDirs() {
  return fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('sk-recognize-'));
}

test('recognize: временная директория удаляется после успешного распознавания', async () => {
  const before = leftoverTempDirs().length;
  const minimalPdf = Buffer.from(
    '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
    'trailer<</Root 1 0 R>>'
  );
  await recognize(minimalPdf, 'empty.pdf', 'application/pdf').catch(() => {});
  assert.strictEqual(leftoverTempDirs().length, before);
});

test('recognize: временная директория удаляется, даже если файл повреждён', async () => {
  const before = leftoverTempDirs().length;
  await assert.rejects(() => recognize(Buffer.from('это не PDF и не изображение'), 'bad.pdf', 'application/pdf'));
  assert.strictEqual(leftoverTempDirs().length, before);
});
