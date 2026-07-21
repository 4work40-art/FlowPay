const { test } = require('node:test');
const assert = require('node:assert');
const {
  classifyDocument, findDate, findNumber, findAmountKopecks, findVat,
  findInns, findKpp, findKpps, findOgrns, findBankRequisites,
  findSupplierName, findBuyerName, findPurpose, findReferencedInvoiceNumber,
  findPriority, findUin, findKbk, findOktmo, splitPayerPayee, confidenceFor,
} = require('../src/lib/documentRecognizer');

// Тексты — то, что реально возвращает pdftotext/tesseract на счёте, счёте-
// фактуре/УПД и платёжном поручении (см. ручную проверку на сгенерированных
// PDF). Регресс на \w, не покрывающий кириллицу без юникод-флага — тот баг,
// из-за которого номер платёжки и распознанный счёт из назначения платежа
// не находились вообще.
const invoiceText = `Счет на оплату № 126 от 15.07.2026 г.

Поставщик: ООО «Ромашка»
ИНН 7707083893 КПП 773601001

Наименование товара: Услуги консалтинга
Итого к оплате: 150 000,00 руб.`;

const updText = `Счет-фактура № 89 от 10.07.2026

Продавец: ООО «Ромашка»
ИНН 7707083893 КПП 773601001
Покупатель: ООО «Одуванчик»
ИНН 5000000000 КПП 500001001

Наименование товара: Консалтинговые услуги
Ставка НДС 20%
Сумма НДС 25 000,00
Всего к оплате: 150 000,00 руб.`;

const paymentOrderText = `Платежное поручение № 458 от 12.07.2026
Очередность платежа 5

Плательщик: ООО Одуванчик
ИНН 5000000000 КПП 500001001
Р/с 40702810900000012345
Банк плательщика: ПАО Сбербанк
БИК 044525225
К/с 30101810400000000225

Получатель: ООО Ромашка
ИНН 7707083893 КПП 773601001
Р/с 40702810900000099999
Банк получателя: АО Тинькофф Банк
БИК 044525974
К/с 30101810145250000974

Сумма 150000-00
Назначение платежа Оплата по счету № 126 от 15.07.2026, НДС не облагается`;

test('classifyDocument: счёт, счёт-фактура/УПД и платёжное поручение не путаются', () => {
  assert.strictEqual(classifyDocument(invoiceText), 'invoice');
  assert.strictEqual(classifyDocument(updText), 'invoice_for_vat');
  assert.strictEqual(classifyDocument(paymentOrderText), 'payment_order');
  assert.strictEqual(classifyDocument('случайный текст без ключевых слов'), 'unknown');
});

test('findNumber: номер счёта, счёта-фактуры и платёжки (регресс на \\w и кириллицу)', () => {
  assert.strictEqual(findNumber(invoiceText, 'invoice'), '126');
  assert.strictEqual(findNumber(updText, 'invoice_for_vat'), '89');
  assert.strictEqual(findNumber(paymentOrderText, 'payment_order'), '458');
});

test('findDate: ДД.ММ.ГГГГ', () => {
  assert.strictEqual(findDate(invoiceText), '2026-07-15');
  assert.strictEqual(findDate(paymentOrderText), '2026-07-12');
});

test('findAmountKopecks: "Итого к оплате", "Всего к оплате" и рубли-копейки через дефис', () => {
  assert.strictEqual(findAmountKopecks(invoiceText, 'invoice'), 15000000);
  assert.strictEqual(findAmountKopecks(updText, 'invoice_for_vat'), 15000000);
  assert.strictEqual(findAmountKopecks(paymentOrderText, 'payment_order'), 15000000);
});

test('findVat: ставка и сумма НДС, "не облагается"', () => {
  assert.deepStrictEqual(findVat(updText), { vat_rate: 20, vat_kopecks: 2500000 });
  assert.deepStrictEqual(findVat(paymentOrderText), { vat_rate: 0, vat_kopecks: 0 });
  assert.strictEqual(findVat(invoiceText), null);
});

test('findInns / findKpp / findKpps', () => {
  assert.deepStrictEqual(findInns(invoiceText), ['7707083893']);
  assert.strictEqual(findKpp(invoiceText), '773601001');
  assert.deepStrictEqual(findKpps(updText), ['773601001', '500001001']);
});

test('findOgrns', () => {
  assert.deepStrictEqual(findOgrns('ОГРН 1027700132195, прочее'), ['1027700132195']);
  assert.deepStrictEqual(findOgrns(invoiceText), []);
});

test('findBankRequisites: р/с, БИК, к/с, банк', () => {
  const req = findBankRequisites(`Банк плательщика: ПАО Сбербанк\nР/с 40702810900000012345\nБИК 044525225\nК/с 30101810400000000225`);
  assert.deepStrictEqual(req, {
    bank_account: '40702810900000012345',
    bank_corr_account: '30101810400000000225',
    bank_bik: '044525225',
    bank_name: 'ПАО Сбербанк',
  });
  assert.strictEqual(findBankRequisites('нет реквизитов тут'), null);
});

test('findSupplierName / findBuyerName', () => {
  assert.strictEqual(findSupplierName(invoiceText), 'ООО «Ромашка»');
  assert.strictEqual(findSupplierName(updText), 'ООО «Ромашка»');
  assert.strictEqual(findBuyerName(updText), 'ООО «Одуванчик»');
});

test('findPurpose и findReferencedInvoiceNumber: номер счёта из назначения (не подстрока)', () => {
  const purpose = findPurpose(paymentOrderText);
  assert.match(purpose, /Оплата по счету № 126/);
  assert.strictEqual(findReferencedInvoiceNumber(purpose), '126');
});

test('findPriority / findUin / findKbk / findOktmo', () => {
  assert.strictEqual(findPriority(paymentOrderText), 5);
  assert.strictEqual(findUin('УИН 18209999900000000079 прочее'), '18209999900000000079');
  assert.strictEqual(findUin(paymentOrderText), null);
  assert.strictEqual(findKbk('КБК 18210102010011000110'), '18210102010011000110');
  assert.strictEqual(findOktmo('ОКТМО 45397000'), '45397000');
});

test('splitPayerPayee: плательщик и получатель не смешиваются', () => {
  const { payerText, payeeText } = splitPayerPayee(paymentOrderText);
  assert.match(payerText, /Плательщик/);
  assert.doesNotMatch(payerText, /Получатель/);
  assert.match(payeeText, /Получатель/);
  assert.deepStrictEqual(findInns(payerText), ['5000000000']);
  assert.deepStrictEqual(findInns(payeeText), ['7707083893']);
});

test('confidenceFor: доля найденных полей', () => {
  assert.strictEqual(confidenceFor('invoice', { number: '1', invoice_date: null, amount_kopecks: 100, supplier_name: null, inn: null }), 40);
  assert.strictEqual(confidenceFor('unknown_type', {}), null);
});
