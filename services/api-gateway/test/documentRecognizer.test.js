const { test } = require('node:test');
const assert = require('node:assert');
const {
  classifyDocument, findDate, findNumber, findAmountKopecks,
  findInns, findKpp, findSupplierName, findPurpose, findReferencedInvoiceNumber,
} = require('../src/lib/documentRecognizer');

// Тексты — то, что реально возвращает pdftotext/tesseract на счёте и
// платёжном поручении (см. ручную проверку на сгенерированных PDF).
// Регресс на \w, не покрывающий кириллицу без юникод-флага — тот баг,
// из-за которого номер платёжки и распознанный счёт из назначения платежа
// не находились вообще.
const invoiceText = `Счет на оплату № 126 от 15.07.2026 г.

Поставщик: ООО «Ромашка»
ИНН 7707083893 КПП 773601001

Наименование товара: Услуги консалтинга
Итого к оплате: 150 000,00 руб.`;

const paymentOrderText = `Платежное поручение № 458 от 12.07.2026

ИНН 7707083893
Сумма 150000-00
Назначение платежа Оплата по счету № 126 от 15.07.2026, НДС не облагается`;

test('classifyDocument: счёт и платёжное поручение', () => {
  assert.strictEqual(classifyDocument(invoiceText), 'invoice');
  assert.strictEqual(classifyDocument(paymentOrderText), 'payment_order');
  assert.strictEqual(classifyDocument('случайный текст без ключевых слов'), 'unknown');
});

test('findNumber: номер счёта и номер платёжки (регресс на \\w и кириллицу)', () => {
  assert.strictEqual(findNumber(invoiceText, 'invoice'), '126');
  assert.strictEqual(findNumber(paymentOrderText, 'payment_order'), '458');
});

test('findDate: ДД.ММ.ГГГГ', () => {
  assert.strictEqual(findDate(invoiceText), '2026-07-15');
  assert.strictEqual(findDate(paymentOrderText), '2026-07-12');
});

test('findAmountKopecks: "Итого к оплате" и рубли-копейки через дефис', () => {
  assert.strictEqual(findAmountKopecks(invoiceText, 'invoice'), 15000000);
  assert.strictEqual(findAmountKopecks(paymentOrderText, 'payment_order'), 15000000);
});

test('findInns / findKpp', () => {
  assert.deepStrictEqual(findInns(invoiceText), ['7707083893']);
  assert.strictEqual(findKpp(invoiceText), '773601001');
});

test('findSupplierName', () => {
  assert.strictEqual(findSupplierName(invoiceText), 'ООО «Ромашка»');
});

test('findPurpose и findReferencedInvoiceNumber: номер счёта из назначения (не подстрока)', () => {
  const purpose = findPurpose(paymentOrderText);
  assert.match(purpose, /Оплата по счету № 126/);
  assert.strictEqual(findReferencedInvoiceNumber(purpose), '126');
});
