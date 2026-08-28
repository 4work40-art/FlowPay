// Определение РЕАЛЬНОГО типа файла по сигнатуре (magic bytes), а не по
// расширению/MIME из запроса — и то и другое подделывается клиентом. Нужно на
// загрузках, которые СОХРАНЯЮТСЯ и потом ОТДАЮТСЯ обратно (вложение счёта,
// логотип организации): иначе под видом image/png можно положить произвольные
// байты, а под видом «картинки» — SVG со скриптом (stored XSS).
const fs = require('fs');

// Возвращает канонический вид по первым байтам: 'pdf'|'png'|'jpg'|'zip'|'ole2'|
// 'unknown'. Текстовые форматы (CSV/SVG/HTML) сигнатуры не имеют и сюда не
// попадают намеренно — вызывающий решает, разрешён ли не-бинарный тип.
function sniff(buffer) {
  if (!buffer || buffer.length < 4) return 'unknown';
  const b = buffer;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';  // %PDF
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';  // \x89PNG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';                    // JPEG SOI
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) return 'zip'; // PK.. (xlsx/docx)
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'ole2';  // старый OLE2 (.xls/.doc)
  return 'unknown';
}

// Читает первые 16 байт файла с диска и определяет тип (для diskStorage-загрузок,
// где буфера в памяти нет).
function sniffFile(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(16);
    const n = fs.readSync(fd, head, 0, 16, 0);
    return sniff(head.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
}

// Соответствие «заявленный клиентом MIME → ожидаемая сигнатура». Служит для
// сверки: реальный тип содержимого должен совпадать с заявленным.
const MIME_KIND = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

module.exports = { sniff, sniffFile, MIME_KIND };
