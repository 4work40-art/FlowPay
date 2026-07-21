function normalizeItemName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function priceChangePct(months) {
  const withData = months.filter(m => m.avg_price_kopecks != null);
  if (withData.length < 2) return null;
  const first = withData[0].avg_price_kopecks;
  const last = withData[withData.length - 1].avg_price_kopecks;
  if (!first) return null;
  return Math.round(((last - first) / first) * 1000) / 10;
}

function peakMonth(months) {
  let best = null;
  for (const m of months) {
    if (m.total_kopecks == null) continue;
    if (!best || m.total_kopecks > best.total_kopecks) best = m;
  }
  return best ? best.month : null;
}

module.exports = { normalizeItemName, priceChangePct, peakMonth };
