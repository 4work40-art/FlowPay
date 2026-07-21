// Распознавание загруженного файла (счёт на оплату / счёт-фактура-УПД /
// платёжное поручение): извлекаем текст (из PDF напрямую, либо OCR для
// сканов и фото) и вытаскиваем ключевые поля эвристиками. Результат —
// черновик для проверки пользователем, мы никогда не создаём счёт/платёж
// автоматически без подтверждения. Файл никогда не попадает на диск дольше
// одного запроса — временная директория удаляется в withTempDir() сразу
// после обработки, даже при ошибке.
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { readSheetRows } = require('./spreadsheetReader');
const { splitCsvToRows } = require('./registerParse');

const execFileP = promisify(execFile);
const MAX_OCR_PAGES = 5; // сканы длиннее — распознаём только начало, этого достаточно для шапки документа
const CYR = '[а-яёА-ЯЁa-zA-Z]'; // \w не матчит кириллицу в JS-регулярках — везде используем этот класс вместо \w

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-recognize-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Предобработка изображения перед OCR — тот же принцип, что у ABBYY Mobile
// Imaging в банковских приложениях: выравнивание ориентации по EXIF,
// перевод в градации серого, нормализация контраста, повышение резкости,
// увеличение мелких фото с телефона до разумного разрешения. Заметно
// поднимает точность Tesseract на некачественных сканах/фото без внешних
// сервисов и GPU.
async function preprocessForOcr(inputPath, outputPath) {
  await sharp(inputPath)
    .rotate()
    .greyscale()
    .normalize()
    .sharpen()
    .resize({ width: 2000, withoutEnlargement: false })
    .toFile(outputPath);
}

async function ocrImageFile(imgPath, dir) {
  const prePath = path.join(dir, `pre-${path.basename(imgPath)}.png`);
  try {
    await preprocessForOcr(imgPath, prePath);
  } catch (e) {
    // Повреждённый/нестандартный файл изображения — пробуем распознать как есть,
    // не проваливая весь запрос из-за необязательного шага предобработки.
    console.warn('[documentRecognizer] предобработка изображения не удалась:', e.message);
    const { stdout } = await execFileP('tesseract', [imgPath, 'stdout', '-l', 'rus+eng'], { maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  }
  const { stdout } = await execFileP('tesseract', [prePath, 'stdout', '-l', 'rus+eng'], { maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

async function extractPdfText(buffer) {
  return withTempDir(async (dir) => {
    const pdfPath = path.join(dir, 'in.pdf');
    await fs.writeFile(pdfPath, buffer);

    const { stdout } = await execFileP('pdftotext', ['-layout', pdfPath, '-'], {
      maxBuffer: 20 * 1024 * 1024,
    });

    // Текстовый слой есть (счета/платёжки из 1С, банк-клиента) — этого достаточно.
    if (stdout.trim().length >= 40) return stdout;

    // Иначе это скан — рендерим первые страницы в изображения и прогоняем OCR.
    await execFileP('pdftoppm', ['-r', '300', '-png', '-l', String(MAX_OCR_PAGES), pdfPath, path.join(dir, 'page')]);
    const files = (await fs.readdir(dir)).filter(f => f.startsWith('page') && f.endsWith('.png')).sort();
    let text = '';
    for (const f of files) text += (await ocrImageFile(path.join(dir, f), dir)) + '\n';
    return text;
  });
}

async function extractImageText(buffer, ext) {
  return withTempDir(async (dir) => {
    const imgPath = path.join(dir, `in.${ext}`);
    await fs.writeFile(imgPath, buffer);
    return ocrImageFile(imgPath, dir);
  });
}

// Строки-массивы ячеек в единую строку текста, по одной строке файла на
// строку текста — тот же вид, что даёт pdftotext -layout, чтобы все
// регулярки ниже (номер, дата, ИНН, банковские реквизиты и т.д.) работали
// одинаково независимо от происхождения текста.
function flattenRowsToText(rows) {
  return rows
    .map(cells => (cells || [])
      .map(c => (c === null || c === undefined ? '' : (c instanceof Date ? c.toISOString().slice(0, 10) : String(c))))
      .filter(Boolean)
      .join(' '))
    .filter(Boolean)
    .join('\n');
}

async function extractText(buffer, filename, mimetype) {
  const ext = (path.extname(filename || '').slice(1) || '').toLowerCase();
  const isPdf = mimetype === 'application/pdf' || ext === 'pdf';
  if (isPdf) return extractPdfText(buffer);

  const isImage = /^image\//.test(mimetype || '') || ['png', 'jpg', 'jpeg'].includes(ext);
  if (isImage) return extractImageText(buffer, ext === 'jpeg' ? 'jpg' : (ext || 'png'));

  throw new Error('Поддерживаются только PDF, PNG, JPG, XLSX, XLS и CSV');
}

// Счёт/платёжка, присланные как Excel/CSV, а не PDF/скан — реальный и
// частый случай (многие учётные системы печатают счёт в файл электронной
// таблицы вместо PDF). В отличие от lib/registerParse.js это НЕ таблица из
// многих строк-счетов, а один документ: реквизиты и таблица товаров внутри
// него не нужно путать со строками реестра. Возвращаем и текст (для тех же
// регулярок, что и у PDF/OCR), и исходные строки-ячейки (для более точного
// поиска итоговой суммы — см. findStructuredAmount).
async function extractSpreadsheetDocument(buffer, ext) {
  const rows = ext === 'csv' ? splitCsvToRows(buffer.toString('utf-8')) : (await readSheetRows(buffer)).rows;
  return { text: flattenRowsToText(rows), rows };
}

// Взвешенная классификация вместо цепочки if/else: считаем очки по
// ключевым словам для каждого типа документа и берём максимум. Так счёт-
// фактура/УПД (где слово «счёт» тоже встречается) не путается со «счётом
// на оплату», а платёжка не путается со счётом только из-за слова «оплата».
function classifyDocument(text) {
  const t = text.toLowerCase();
  const score = { invoice: 0, invoice_for_vat: 0, payment_order: 0 };

  if (/сч[её]т[а-яёa-z]*\s+на\s+оплату/i.test(t)) score.invoice += 3;
  // "СЧЕТ № 126 от ..." без слов "на оплату" — тоже частый вариант шапки
  // (особенно у документов, экспортированных в Excel/из 1С).
  if (/(^|\n)\s*сч[её]т\s*(№|n|no\.?)/i.test(t)) score.invoice += 2;
  if (/поставщик|исполнитель\s*[:\-]/i.test(t)) score.invoice += 1;
  if (/итого\s*к\s*оплате/i.test(t)) score.invoice += 1;

  if (/сч[её]т-фактур/i.test(t)) score.invoice_for_vat += 3;
  if (/универсальн\w*\s+передаточн\w*\s+документ|\bупд\b/i.test(t)) score.invoice_for_vat += 3;
  if (/продавец\s*[:\-]/i.test(t) && /покупатель\s*[:\-]/i.test(t)) score.invoice_for_vat += 2;
  if (/грузоотправител/i.test(t)) score.invoice_for_vat += 1;

  if (/платежн[а-яёa-z]*\s+поручени/i.test(t)) score.payment_order += 3;
  if (/назначение\s+платежа/i.test(t)) score.payment_order += 2;
  if (/очередность\s+платежа/i.test(t)) score.payment_order += 1;
  if (/банк\s+получателя|банк\s+плательщика/i.test(t)) score.payment_order += 1;
  if (/\bуин\b/i.test(t)) score.payment_order += 1;

  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : 'unknown';
}

// ДД.ММ.ГГГГ / ДД месяц ГГГГ -> YYYY-MM-DD
const MONTHS = {
  'январ':'01','феврал':'02','март':'03','апрел':'04','ма':'05','июн':'06',
  'июл':'07','август':'08','сентябр':'09','октябр':'10','ноябр':'11','декабр':'12',
};
function findDate(text) {
  let m = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = text.match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})\s*г/i);
  if (m) {
    const key = Object.keys(MONTHS).find(k => m[2].toLowerCase().startsWith(k));
    if (key) return `${m[3]}-${MONTHS[key]}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

function findNumber(text, docType) {
  const re = docType === 'payment_order'
    ? new RegExp(`платежн${CYR}*\\s+поручени${CYR}*\\s*(?:№|N|No\\.?)?\\s*(\\S+)`, 'i')
    : docType === 'invoice_for_vat'
      ? new RegExp(`сч[её]т-фактур${CYR}*\\s*(?:№|N|No\\.?)?\\s*(\\S+)|упд\\s*(?:№|N|No\\.?)?\\s*(\\S+)`, 'i')
      : new RegExp(`сч[её]т${CYR}*\\s+на\\s+оплату\\s*(?:№|N|No\\.?)?\\s*(\\S+)|сч[её]т${CYR}*\\s*(?:№|N|No\\.?)\\s*(\\S+)`, 'i');
  const m = text.match(re);
  if (!m) return null;
  return (m[1] || m[2] || '').replace(/[.,;:]+$/, '');
}

// Сумма: "Итого к оплате: 150 000,00" / "Сумма 15000-00" (рубли-копейки
// через дефис в платёжках) / "Всего к оплате с НДС" в счёте-фактуре/УПД.
function findAmountKopecks(text, docType) {
  const dashRub = text.match(/сумма\D{0,10}(\d[\d\s]*)-(\d{2})\b/i);
  if (dashRub) {
    const rub = Number(dashRub[1].replace(/\s/g, ''));
    const kop = Number(dashRub[2]);
    if (Number.isFinite(rub)) return rub * 100 + kop;
  }

  const patterns = docType === 'invoice'
    ? [/итого\s*к\s*оплате\D{0,10}([\d\s]+[.,]\d{2})/i, /всего\s*к\s*оплате\D{0,10}([\d\s]+[.,]\d{2})/i, /итого\D{0,10}([\d\s]+[.,]\d{2})/i]
    : docType === 'invoice_for_vat'
      ? [/всего\s*к\s*оплате[^\d]{0,20}([\d\s]+[.,]\d{2})/i, /стоимост\w*\s*всего\s*с\s*ндс\D{0,10}([\d\s]+[.,]\d{2})/i, /итого\D{0,10}([\d\s]+[.,]\d{2})/i]
      : [/сумма\D{0,10}([\d\s]+[.,]\d{2})/i];

  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const value = Number(m[1].replace(/\s/g, '').replace(',', '.'));
      if (Number.isFinite(value) && value > 0) return Math.round(value * 100);
    }
  }
  return null;
}

// Ставка и сумма НДС — "Ставка НДС 20%" / "НДС не облагается" / "Сумма НДС 25 000,00".
function findVat(text) {
  if (/ндс\s+не\s+облагает|без\s+ндс/i.test(text)) return { vat_rate: 0, vat_kopecks: 0 };
  const rateM = text.match(/ставка\s*ндс\D{0,5}(\d{1,2})\s*%/i);
  const sumM = text.match(/сумма\s*ндс\D{0,10}([\d\s]+[.,]\d{2})/i);
  const vat_rate = rateM ? Number(rateM[1]) : null;
  const vat_kopecks = sumM ? Math.round(Number(sumM[1].replace(/\s/g, '').replace(',', '.')) * 100) : null;
  return (vat_rate === null && vat_kopecks === null) ? null : { vat_rate, vat_kopecks };
}

function findInns(text) {
  const matches = [...text.matchAll(/инн\D{0,5}(\d{10}|\d{12})/gi)].map(m => m[1]);
  return [...new Set(matches)];
}

function findKpp(text) {
  const m = text.match(/кпп\D{0,5}(\d{9})/i);
  return m ? m[1] : null;
}

function findKpps(text) {
  const matches = [...text.matchAll(/кпп\D{0,5}(\d{9})/gi)].map(m => m[1]);
  return [...new Set(matches)];
}

function findOgrns(text) {
  const matches = [...text.matchAll(/огрн(?:ип)?\D{0,5}(\d{13}|\d{15})/gi)].map(m => m[1]);
  return [...new Set(matches)];
}

// Банковские реквизиты одним блоком — используется и для счёта (реквизиты
// поставщика), и для платёжки (плательщик/получатель).
function findBankRequisites(text) {
  const account = text.match(/р\/с\D{0,5}(\d{20})|расч[её]тный\s*сч[её]т\D{0,5}(\d{20})/i);
  const corr = text.match(/к\/с\D{0,5}(\d{20})|корр?\.?\s*сч[её]т\D{0,5}(\d{20})/i);
  const bik = text.match(/бик\D{0,5}(\d{9})/i);
  const bankName = text.match(/банк[а-яё]*(?:\s+получателя|\s+плательщика)?\s*[:\-]\s*([^\n\r]{3,120})/i);
  const result = {
    bank_account: account ? (account[1] || account[2]) : null,
    bank_corr_account: corr ? (corr[1] || corr[2]) : null,
    bank_bik: bik ? bik[1] : null,
    bank_name: bankName ? bankName[1].trim().replace(/\s{2,}/g, ' ') : null,
  };
  return Object.values(result).some(v => v !== null) ? result : null;
}

// Для счёта — строка "Поставщик: ООО «Ромашка»" / "Продавец ..."; для платёжки
// это не даёт надёжного результата, поэтому имя не извлекаем, только ИНН.
function findSupplierName(text) {
  const m = text.match(/(?:поставщик|продавец|исполнитель)\s*[:\-]?\s*([^\n\r]{3,120})/i);
  return m ? m[1].trim().replace(/\s{2,}/g, ' ') : null;
}

// Не все шаблоны счёта подписывают поставщика словом "Поставщик:" — многие
// (в том числе часто встречающиеся у 1С-подобных сервисов) используют слово
// "Получатель" отдельной строкой от названия организации (метка и значение
// в разных строках/ячейках, обычную регулярку по одной строке это ломает),
// либо вообще не подписывают, а просто печатают название компании в шапке
// документа первой строкой — стандартное деловое оформление в РФ. Берём
// первую строку среди первых нескольких, которая выглядит как название
// организации (ООО/ИП/АО и т.п.), если по явной метке ничего не нашли.
// \b не матчит границу после кириллицы (тот же класс проблемы, что и с \w
// в остальном файле) — вместо него отрицательный lookahead на кириллицу/латиницу.
const ORG_NAME_RE = new RegExp(`^(?:ООО|ОАО|ЗАО|ПАО|АО|ИП)(?!${CYR})|^Общество\\s+с\\s+ограниченной\\s+ответственностью|^Индивидуальный\\s+предприниматель`, 'i');
function findSupplierNameFallback(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 8);
  const line = lines.find(l => ORG_NAME_RE.test(l));
  return line || null;
}

function findBuyerName(text) {
  const m = text.match(/(?:покупатель|заказчик)\s*[:\-]?\s*([^\n\r]{3,120})/i);
  return m ? m[1].trim().replace(/\s{2,}/g, ' ') : null;
}

function findAddress(text) {
  const m = text.match(/адрес\s*[:\-]?\s*([^\n\r]{5,200})/i);
  return m ? m[1].trim().replace(/\s{2,}/g, ' ') : null;
}

function findPurpose(text) {
  const m = text.match(/назначение\s+платежа\s*[:\-]?\s*([^\n\r]{3,300})/i);
  return m ? m[1].trim() : null;
}

// Номер счёта, упомянутый в назначении платежа платёжки — тот же принцип
// точного совпадения токена, что и в импорте банковской выписки.
function findReferencedInvoiceNumber(purpose) {
  if (!purpose) return null;
  const m = purpose.match(new RegExp(`сч[её]т${CYR}*\\s*(?:№|N|No\\.?)?\\s*(\\S+)`, 'i'));
  return m ? m[1].replace(/[.,;:]+$/, '') : null;
}

// Реквизиты платёжки (форма 0401060, Положение Банка России № 762-П,
// приложение 1) сверх суммы/номера/назначения.
function findPriority(text) {
  const m = text.match(/очередность\s+платежа\D{0,5}(\d{1,2})/i);
  return m ? Number(m[1]) : null;
}
function findUin(text) {
  const m = text.match(/уин\D{0,10}(\d{20}|0)\b/i);
  return m ? m[1] : null;
}
function findKbk(text) {
  const m = text.match(/кбк\D{0,5}(\d{20})/i);
  return m ? m[1] : null;
}
function findOktmo(text) {
  const m = text.match(/октмо\D{0,5}(\d{8}|\d{11})/i);
  return m ? m[1] : null;
}

// Печатная форма платёжки идёт по разделам: сведения о плательщике, затем
// о получателе (после метки «получатель»/«банк получателя»). Делим текст
// по первому вхождению этой метки и извлекаем ИНН/КПП/банк отдельно по
// каждой половине — это эвристика по порядку следования полей в тексте, а
// не разбор таблицы, поэтому она надёжна для линейных PDF-выгрузок (1С,
// банк-клиент) и менее надёжна для сложных сканов с двухколоночной вёрсткой
// — как и всё в этом модуле, требует проверки пользователем.
function splitPayerPayee(text) {
  const idx = text.search(/получател[ья]|банк\s+получателя/i);
  if (idx === -1) return { payerText: text, payeeText: '' };
  return { payerText: text.slice(0, idx), payeeText: text.slice(idx) };
}

function partyFromZone(zoneText) {
  const inns = findInns(zoneText);
  const kpps = findKpps(zoneText);
  const bank = findBankRequisites(zoneText);
  if (!inns.length && !kpps.length && !bank) return null;
  return { inn: inns[0] || null, kpp: kpps[0] || null, ...(bank || {}) };
}

// Сумма из ячеек таблицы (только для Excel/CSV) — там, где число хранится
// как есть, без форматирования "150 000,00", регулярка по тексту (которая
// требует десятичных знаков) ничего не находит. Ищем строку, где есть
// ячейка-метка вроде "Итого"/"Итого к оплате", и берём наибольшее число
// среди остальных ячеек той же строки — это надёжнее регулярки по тексту
// именно потому, что ячейки уже разложены по структуре, а не слиты в одну
// строку.
function findStructuredAmount(rows, labelRe, allowZero = false) {
  if (!rows) return null;
  const min = allowZero ? 0 : Number.MIN_VALUE; // >0 для итоговых сумм; НДС бывает ровно 0 ("не облагается")
  for (const cells of rows) {
    if (!cells) continue;
    const hasLabel = cells.some(c => typeof c === 'string' && labelRe.test(c.trim()));
    if (!hasLabel) continue;
    const numbers = cells
      .filter(c => typeof c === 'number' && Number.isFinite(c) && c >= min)
      .concat(
        cells
          .filter(c => typeof c === 'string')
          .map(c => Number(c.trim().replace(/\s/g, '').replace(',', '.')))
          .filter(n => Number.isFinite(n) && n >= min)
      );
    if (numbers.length) return Math.round(Math.max(...numbers) * 100);
  }
  return null;
}

// Доля найденных ожидаемых полей — показывается пользователю как ориентир,
// каким результатам можно доверять больше, а какие точно нужно перепроверить.
function confidenceFor(docType, fields) {
  const expectedByType = {
    invoice: ['number', 'invoice_date', 'amount_kopecks', 'supplier_name', 'inn'],
    invoice_for_vat: ['number', 'invoice_date', 'amount_kopecks', 'seller_name', 'buyer_name', 'seller_inn', 'buyer_inn'],
    payment_order: ['number', 'payment_date', 'amount_kopecks', 'purpose'],
  };
  const expected = expectedByType[docType];
  if (!expected) return null;
  const found = expected.filter(k => fields[k] !== null && fields[k] !== undefined).length;
  return Math.round((found / expected.length) * 100);
}

async function recognize(buffer, filename, mimetype) {
  const ext = path.extname(filename || '').slice(1).toLowerCase();
  const isSpreadsheet = ['xlsx', 'xls', 'csv'].includes(ext) ||
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv', 'application/csv'].includes(mimetype);

  let text, rows;
  if (isSpreadsheet) {
    ({ text, rows } = await extractSpreadsheetDocument(buffer, ext === 'csv' ? 'csv' : (ext || 'xlsx')));
  } else {
    text = await extractText(buffer, filename, mimetype);
    rows = null;
  }

  const docType = classifyDocument(text);
  const inns = findInns(text);

  if (docType === 'invoice') {
    const fields = {
      number: findNumber(text, 'invoice'),
      invoice_date: findDate(text),
      amount_kopecks: findAmountKopecks(text, 'invoice') ?? findStructuredAmount(rows, /^итого\s*к\s*оплате|^итого\s*:?$/i),
      supplier_name: findSupplierName(text) || findSupplierNameFallback(text),
      inn: inns[0] || null,
      kpp: findKpp(text),
      ogrn: findOgrns(text)[0] || null,
      address: findAddress(text),
      ...(findBankRequisites(text) || {}),
    };
    return { doc_type: 'invoice', fields, confidence: confidenceFor('invoice', fields), text_excerpt: text.trim().slice(0, 1500) };
  }

  if (docType === 'invoice_for_vat') {
    const vat = findVat(text);
    const fields = {
      number: findNumber(text, 'invoice_for_vat'),
      invoice_date: findDate(text),
      amount_kopecks: findAmountKopecks(text, 'invoice_for_vat') ?? findStructuredAmount(rows, /^всего\s*к\s*оплате|^итого\s*:?$/i),
      seller_name: findSupplierName(text) || findSupplierNameFallback(text),
      buyer_name: findBuyerName(text),
      seller_inn: inns[0] || null,
      buyer_inn: inns[1] || null,
      kpps: findKpps(text),
      vat_rate: vat?.vat_rate ?? null,
      vat_kopecks: vat?.vat_kopecks ?? findStructuredAmount(rows, /в\s*том\s*числе\s*ндс|^сумма\s*ндс/i, true),
    };
    return { doc_type: 'invoice_for_vat', fields, confidence: confidenceFor('invoice_for_vat', fields), text_excerpt: text.trim().slice(0, 1500) };
  }

  if (docType === 'payment_order') {
    const purpose = findPurpose(text);
    const { payerText, payeeText } = splitPayerPayee(text);
    const fields = {
      number: findNumber(text, 'payment_order'),
      payment_date: findDate(text),
      amount_kopecks: findAmountKopecks(text, 'payment_order') ?? findStructuredAmount(rows, /^сумма\s*:?$/i),
      purpose,
      referenced_invoice_number: findReferencedInvoiceNumber(purpose),
      inns,
      priority: findPriority(text),
      uin: findUin(text),
      kbk: findKbk(text),
      oktmo: findOktmo(text),
      payer: partyFromZone(payerText),
      payee: partyFromZone(payeeText),
    };
    return { doc_type: 'payment_order', fields, confidence: confidenceFor('payment_order', fields), text_excerpt: text.trim().slice(0, 1500) };
  }

  return {
    doc_type: 'unknown',
    fields: {
      amount_kopecks: findAmountKopecks(text, 'invoice') || findAmountKopecks(text, 'payment_order'),
      date: findDate(text),
      inns,
    },
    confidence: null,
    text_excerpt: text.trim().slice(0, 1500),
  };
}

module.exports = {
  recognize, classifyDocument, extractText,
  // Экспортированы отдельно для юнит-тестов на готовом тексте — без
  // обращения к pdftotext/tesseract, которых может не быть в CI.
  findDate, findNumber, findAmountKopecks, findVat, findInns, findKpp, findKpps,
  findOgrns, findBankRequisites, findSupplierName, findSupplierNameFallback, findBuyerName, findAddress,
  findPurpose, findReferencedInvoiceNumber, findPriority, findUin, findKbk,
  findOktmo, splitPayerPayee, confidenceFor, flattenRowsToText, findStructuredAmount,
};
