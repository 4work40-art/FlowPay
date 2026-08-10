// ЗАГОТОВКА (не активная фича): точка расширения под будущую опциональную
// платную интеграцию с провайдером ЭДО (СБИС/Диадок).
//
// Продукт сейчас НЕ является системой ЭДО и не позиционируется как таковая —
// этот файл не меняет поведение приложения, никуда не подключён (не
// импортируется ни одним роутом) и не выполняет реальных HTTP-вызовов.
// Задача файла — зафиксировать форму будущего клиента по аналогии с
// ./yookassa.js, чтобы реальное подключение провайдера в будущем не
// потребовало рефакторинга ядра (билинга, инвойсов, вебхуков).
//
// Модель по аналогии с yookassa.js:
//   - isConfigured() проверяет наличие env-переменных провайдера.
//   - Методы-заготовки бросают понятную ошибку, если провайдер не настроен
//     (см. паттерн 503 BILLING_NOT_CONFIGURED в routes/billing.js — при
//     реальной интеграции здесь нужно завести аналогичный код ошибки,
//     например EDO_NOT_CONFIGURED, и обрабатывать его в роуте).
//
// Переменные окружения ниже пока НИГДЕ не заданы (ни в .env, ни в
// deploy.sh) — это ожидаемо, isConfigured() всегда возвращает false, пока
// реальная интеграция не реализована.
const PROVIDER = process.env.EDO_PROVIDER;     // 'sbis' | 'diadoc' | ...
const API_KEY  = process.env.EDO_API_KEY;
const API_BASE = process.env.EDO_API_BASE;

function isConfigured() {
  return !!(PROVIDER && API_KEY && API_BASE);
}

function notConfiguredError() {
  return new Error('ЭДО не настроено: интеграция с провайдером ЭДО ещё не реализована');
}

// БУДУЩЕЕ: отправить исходящий счёт (или другой документ) на подпись/обмен
// через провайдера ЭДО. Ожидаемо будет:
//   - подтягивать outgoing_invoices по invoiceId,
//   - формировать документ в формате провайдера (СБИС/Диадок API),
//   - отправлять контрагенту и получать edoDocumentId провайдера,
//   - сохранять edoDocumentId/edoStatus на счёте (см. п.4 — заготовка
//     колонок в БД, если появится).
// Сейчас реального HTTP/SDK-вызова нет — только заглушка.
async function submitDocument(invoiceId) { // eslint-disable-line no-unused-vars
  if (!isConfigured()) throw notConfiguredError();
  throw new Error('submitDocument: интеграция с ЭДО ещё не реализована');
}

// БУДУЩЕЕ: запросить у провайдера текущий статус документа по его
// edoDocumentId (например: отправлен / подписан / отклонён контрагентом).
async function getDocumentStatus(edoDocumentId) { // eslint-disable-line no-unused-vars
  if (!isConfigured()) throw notConfiguredError();
  throw new Error('getDocumentStatus: интеграция с ЭДО ещё не реализована');
}

// БУДУЩЕЕ: валидация подписи входящего webhook-уведомления от провайдера
// ЭДО о смене статуса документа — аналогично тому, как для ЮKassa решено
// не доверять телу вебхука и перезапрашивать статус напрямую (см.
// комментарий в yookassa.js:getPayment). Для ЭДО-провайдеров, которые
// подписывают вебхуки (в отличие от ЮKassa), здесь должна быть проверка
// HMAC/подписи заголовка запроса перед обработкой события.
function verifyWebhookSignature(/* rawBody, signatureHeader */) {
  if (!isConfigured()) throw notConfiguredError();
  throw new Error('verifyWebhookSignature: интеграция с ЭДО ещё не реализована');
}

module.exports = { isConfigured, submitDocument, getDocumentStatus, verifyWebhookSignature };
