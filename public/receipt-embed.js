const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.search).get('token');
let snapshot;
let retryCount = 0;

function price(value) {
  const n = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(n) && n >= 0 && n <= 1
    ? `${(n * 100).toFixed(1).replace(/\.0$/, '')}¢` : '—';
}
function spot(market, side) {
  const direct = market?.[`${side}Price`];
  const specific = ['primary', 'secondary'].includes(market?.phase)
    ? market?.[`${market.phase}${side[0].toUpperCase()}${side.slice(1)}Price`] : null;
  return price(direct) !== '—' ? Number(direct) : price(specific) !== '—' ? Number(specific) : null;
}
async function json(resource) {
  const response = await fetch(resource, { cache: 'no-store', headers: { Accept: 'application/json' } });
  const body = await response.json();
  if (!response.ok) { const error = new Error(body.message || 'Panta data is unavailable.'); error.status = response.status; throw error; }
  return body;
}
function schedule(minDelay = 0) {
  const intervals = [2_000, 3_000, 5_000, 10_000, 20_000, 30_000, 60_000];
  setTimeout(loadLive, Math.max(minDelay, intervals[Math.min(retryCount++, intervals.length - 1)]));
}
async function loadLive() {
  try {
    const market = await json(`/api/markets/${snapshot.marketId}`);
    const current = spot(market, snapshot.side);
    $('embed-receipt-now').textContent = price(current);
    $('embed-receipt-status').textContent = current === null ? 'Price temporarily unavailable. Retrying…' : 'Live Panta market data';
    if (current === null) {
      $('embed-receipt-change').textContent = 'Waiting for a current price to compare.';
      schedule();
    } else {
      const change = (current - snapshot[snapshot.side]) * 100;
      $('embed-receipt-change').textContent = Math.abs(change) < .05 ? 'The price is unchanged since capture.'
        : `${snapshot.side.toUpperCase()} ${change > 0 ? 'rose' : 'fell'} ${Math.abs(change).toFixed(1).replace(/\.0$/, '')}¢ since capture.`;
      retryCount = 0;
      setTimeout(loadLive, 60_000);
    }
  } catch (error) {
    $('embed-receipt-status').textContent = `Current price unavailable. Retrying…`;
    $('embed-receipt-change').textContent = 'The captured price remains available.';
    schedule(error.status === 429 ? 60_000 : 0);
  }
}
async function init() {
  if (!token || token.length > 4_096) {
    $('embed-receipt-title').textContent = 'Receipt unavailable';
    $('embed-receipt-error').textContent = 'Open a valid forecast receipt link.';
    $('embed-receipt-error').hidden = false;
    return;
  }
  try {
    ({ snapshot } = await json(`/api/receipt?token=${encodeURIComponent(token)}`));
    $('embed-receipt-title').textContent = snapshot.title;
    $('embed-receipt-call').textContent = `Published call: ${snapshot.side.toUpperCase()}`;
    $('embed-receipt-note').textContent = snapshot.note || '';
    $('embed-receipt-note').hidden = !snapshot.note;
    $('embed-receipt-at').textContent = price(snapshot[snapshot.side]);
    const captured = new Date(snapshot.capturedAt);
    $('embed-receipt-time').textContent = Number.isNaN(captured.getTime()) ? 'Capture time unavailable' : `Captured ${captured.toLocaleString()}`;
    $('embed-receipt-link').href = `/receipt?token=${encodeURIComponent(token)}`;
    $('embed-receipt-content').hidden = false;
    loadLive();
  } catch (error) {
    $('embed-receipt-title').textContent = 'Receipt unavailable';
    $('embed-receipt-error').textContent = error.message;
    $('embed-receipt-error').hidden = false;
  }
}
init();
