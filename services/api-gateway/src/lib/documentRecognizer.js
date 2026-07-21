// Распознавание загруженного файла (счёт на оплату / платёжное поручение):
// извлекаем текст (из PDF напрямую, либо OCR для сканов и фото) и вытаскиваем
// ключевые поля эвристиками. Результат — черновик для проверки пользователем,
// мы никогда не создаём счёт/платёж автоматически без подтверждения.
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const execFileP = promisify(execFile);
const MAX_OCR_PAGES = 5; // сканы длиннее — распознаём только начало, этого достаточно для шапки документа

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-recognize-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function ocrImageFile(imgPath) {
  const { stdout } = await execFileP('tesseract', [imgPath, 'stdout', '-l', 'rus+eng'], {
    maxBuffer: 10 * 1024 * 1024,
  });
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
    for (const f of files) text += (await ocrImageFile(path.join(dir, f))) + '\n';
    return text;
  });
}

async function extractImageText(buffer, ext) {
  return withTempDir(async (dir) => {
    const imgPath = path.join(dir, `in.${ext}`);
    await fs.writeFile(imgPath, buffer);
    return ocrImageFile(imgPath);
  });
}

async function extractText(buffer, filename, mimetype) {
  const ext = (path.extname(filename || '').slice(1) || '').toLowerCase();
  const isPdf = mimetype === 'application/pdf' || ext === 'pdf';
  if (isPdf) return extractPdfText(buffer);

  const isImage = /^image\//.test(mimetype || '') || ['png', 'jpg', 'jpeg'].includes(ext);
  if (isImage) return extractImageText(buffer, ext === 'jpeg' ? 'jpg' : (ext || 'png'));

  throw new Error('Поддерживаются только PDF, PNG и JPG');
}

function classifyDocument(text) {
  const t = text.toLowerCase();
  if (/платежн[а-яёА-ЯЁa-zA-Z]*\s+поручени/.test(t)) return 'payment_order';
  if (/счет[а-яёА-ЯЁa-zA-Z]*\s+на\s+оплату|счёт[а-яёА-ЯЁa-zA-Z]*\s+на\s+оплату/.test(t)) return 'invoice';
  if (/назначение\s+платежа/.test(t)) return 'payment_order'; // платёжки без явного заголовка
  return 'unknown';
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
    ? /платежн[а-яёА-ЯЁa-zA-Z]*\s+поручени[а-яёА-ЯЁa-zA-Z]*\s*(?:№|N|No\.?)?\s*(\S+)/i
    : /счет[а-яёА-ЯЁa-zA-Z]*\s+на\s+оплату\s*(?:№|N|No\.?)?\s*(\S+)|сч[её]т[а-яёА-ЯЁa-zA-Z]*\s*(?:№|N|No\.?)\s*(\S+)/i;
  const m = text.match(re);
  if (!m) return null;
  return (m[1] || m[2] || '').replace(/[.,;:]+$/, '');
}

// Сумма: "Итого к оплате: 150 000,00" / "Сумма 15000-00" (рубли-копейки через дефис в платёжках).
function findAmountKopecks(text, docType) {
  const dashRub = text.match(/сумма\D{0,10}(\d[\d\s]*)-(\d{2})\b/i);
  if (dashRub) {
    const rub = Number(dashRub[1].replace(/\s/g, ''));
    const kop = Number(dashRub[2]);
    if (Number.isFinite(rub)) return rub * 100 + kop;
  }

  const patterns = docType === 'invoice'
    ? [/итого\s*к\s*оплате\D{0,10}([\d\s]+[.,]\d{2})/i, /всего\s*к\s*оплате\D{0,10}([\d\s]+[.,]\d{2})/i, /итого\D{0,10}([\d\s]+[.,]\d{2})/i]
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

function findInns(text) {
  const matches = [...text.matchAll(/инн\D{0,5}(\d{10}|\d{12})/gi)].map(m => m[1]);
  return [...new Set(matches)];
}

function findKpp(text) {
  const m = text.match(/кпп\D{0,5}(\d{9})/i);
  return m ? m[1] : null;
}

// Для счёта — строка "Поставщик: ООО «Ромашка»" / "Продавец ..."; для платёжки
// это не даёт надёжного результата, поэтому имя не извлекаем, только ИНН.
function findSupplierName(text) {
  const m = text.match(/(?:поставщик|продавец|исполнитель)\s*[:\-]?\s*([^\n\r]{3,120})/i);
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
  const m = purpose.match(/сч[её]т[а-яёА-ЯЁa-zA-Z]*\s*(?:№|N|No\.?)?\s*(\S+)/i);
  return m ? m[1].replace(/[.,;:]+$/, '') : null;
}

async function recognize(buffer, filename, mimetype) {
  const text = await extractText(buffer, filename, mimetype);
  const docType = classifyDocument(text);
  const inns = findInns(text);

  if (docType === 'invoice') {
    return {
      doc_type: 'invoice',
      fields: {
        number: findNumber(text, 'invoice'),
        invoice_date: findDate(text),
        amount_kopecks: findAmountKopecks(text, 'invoice'),
        supplier_name: findSupplierName(text),
        inn: inns[0] || null,
        kpp: findKpp(text),
      },
      text_excerpt: text.trim().slice(0, 1500),
    };
  }

  if (docType === 'payment_order') {
    const purpose = findPurpose(text);
    return {
      doc_type: 'payment_order',
      fields: {
        number: findNumber(text, 'payment_order'),
        payment_date: findDate(text),
        amount_kopecks: findAmountKopecks(text, 'payment_order'),
        purpose,
        referenced_invoice_number: findReferencedInvoiceNumber(purpose),
        inns,
      },
      text_excerpt: text.trim().slice(0, 1500),
    };
  }

  return {
    doc_type: 'unknown',
    fields: {
      amount_kopecks: findAmountKopecks(text, 'invoice') || findAmountKopecks(text, 'payment_order'),
      date: findDate(text),
      inns,
    },
    text_excerpt: text.trim().slice(0, 1500),
  };
}

module.exports = {
  recognize, classifyDocument, extractText,
  // Экспортированы отдельно для юнит-тестов на готовом тексте — без
  // обращения к pdftotext/tesseract, которых может не быть в CI.
  findDate, findNumber, findAmountKopecks, findInns, findKpp,
  findSupplierName, findPurpose, findReferencedInvoiceNumber,
};
