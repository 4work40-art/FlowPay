function fmt(kopecks) {
  const n = Math.round(Number(kopecks || 0)) / 100;
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ₽';
}

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function err(res, status, message, code) {
  return res.status(status).json({ success: false, error: { code, message } });
}

// Сырые ошибки Postgres не должны улетать клиенту как есть — известные
// коды валидации превращаем в понятный 400, остальное прячем за 500.
const DB_VALIDATION_MESSAGES = {
  '22007': 'Некорректная дата/время',
  '22008': 'Дата/время вне допустимого диапазона',
  '22P02': 'Некорректный формат данных',
  '23502': 'Не заполнено обязательное поле',
  '23503': 'Связанная запись не найдена',
  '23514': 'Значение нарушает ограничение',
};
function dbErr(res, e, tag) {
  console.error(tag, e.message);
  const msg = DB_VALIDATION_MESSAGES[e.code];
  if (msg) return err(res, 400, msg, 'VALIDATION_ERROR');
  return err(res, 500, 'Внутренняя ошибка сервера', 'SERVER_ERROR');
}

module.exports = { fmt, ok, err, dbErr };
