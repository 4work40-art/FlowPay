// Подсказки по ИНН через DaData (findById/party) — официальный API с данными
// ЕГРЮЛ/ЕГРИП. Бесплатного тарифа достаточно для старта. Без DADATA_API_KEY
// функция недоступна (фронтенд просто не показывает кнопку/подсказку).
const API_URL = process.env.DADATA_API_BASE ||
  'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party';
const API_KEY = process.env.DADATA_API_KEY;

function isConfigured() {
  return !!API_KEY;
}

async function findPartyByInn(inn) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Token ${API_KEY}`,
    },
    body: JSON.stringify({ query: inn, count: 1 }),
  });
  if (!res.ok) throw new Error(`DaData error ${res.status}`);
  const data = await res.json();
  const s = data.suggestions?.[0];
  if (!s) return null;
  return {
    name: s.value || s.data?.name?.short_with_opf || null,
    inn: s.data?.inn || inn,
    kpp: s.data?.kpp || null,
    address: s.data?.address?.value || null,
    status: s.data?.state?.status || null, // ACTIVE / LIQUIDATED / ...
  };
}

module.exports = { isConfigured, findPartyByInn };
