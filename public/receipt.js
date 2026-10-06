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
function formattedDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
async function json(resource) {
  const response = await fetch(resource, { cache: 'no-store', headers: { Accept: 'application/json' } });
  const body = await response.json();
  if (!response.ok) { const error = new Error(body.message || 'Panta data is unavailable.'); error.status = response.status; throw error; }
  return body;
}
function schedule(minDelay = 0) {
  // Retry incomplete market details promptly at first, then ease off so an
  // extended Panta outage does not generate a steady stream of requests.
  const intervals = [2_000, 3_000, 5_000, 10_000, 20_000, 30_000, 60_000];
  const delay = Math.max(minDelay, intervals[Math.min(retryCount++, intervals.length - 1)]);
  setTimeout(loadLive, delay);
}
function changeText(nowSide) {
  const side = snapshot.side.toUpperCase();
  const difference = (nowSide - snapshot[snapshot.side]) * 100;
  if (Math.abs(difference) < .05) return `The ${side} share price is unchanged since capture.`;
  const cents = Math.abs(difference).toFixed(1).replace(/\.0$/, '');
  return `The ${side} share price ${difference > 0 ? 'rose' : 'fell'} ${cents}¢ since capture.`;
}
async function loadLive() {
  try {
    const market = await json(`/api/markets/${snapshot.marketId}`);
    const yes = spot(market, 'yes'); const no = spot(market, 'no');
    $('receipt-now-yes').textContent = price(yes); $('receipt-now-no').textContent = price(no);
    $('receipt-now-time').textContent = `Panta checked ${formattedDate(market._meta?.fetchedAt)}`;
    const missing = yes === null || no === null;
    $('receipt-live-status').textContent = missing ? 'Panta has not returned both spot prices. Retrying…' : 'Live Panta market data';
    const currentSidePrice = snapshot.side === 'yes' ? yes : no;
    $('receipt-change').textContent = currentSidePrice === null ? `Waiting for a current ${snapshot.side.toUpperCase()} price to compare.` : changeText(currentSidePrice);
    const phase = market.phase || 'unknown';
    $('receipt-phase').textContent = market.resolved || phase === 'resolved'
      ? 'Panta reports this market as resolved. Its market detail response does not specify the winning side.'
      : `Current market phase: ${phase}.`;
    if (missing) schedule();
    else { retryCount = 0; setTimeout(loadLive, 60_000); }
  } catch (error) {
    $('receipt-live-status').textContent = `Could not check Panta now: ${error.message} Retrying…`;
    $('receipt-change').textContent = 'The captured quote remains available above.';
    schedule(error.status === 429 ? 60_000 : 0);
  }
}
async function init() {
  if (!token || token.length > 4_096) { $('receipt-title').textContent = 'Receipt unavailable'; $('receipt-error').textContent = 'Open a valid forecast receipt link.'; $('receipt-error').hidden = false; return; }
  try {
    ({ snapshot } = await json(`/api/receipt?token=${encodeURIComponent(token)}`));
    $('receipt-title').textContent = snapshot.title;
    $('receipt-side').textContent = `Published call: ${snapshot.side.toUpperCase()}.`;
    $('receipt-note').textContent = snapshot.note || '';
    $('receipt-note').hidden = !snapshot.note;
    $('receipt-at-time').textContent = `Panta checked ${formattedDate(snapshot.capturedAt)}`;
    $('receipt-at-yes').textContent = price(snapshot.yes);
    $('receipt-at-no').textContent = price(snapshot.no);
    $('receipt-market-link').href = `/?market=${encodeURIComponent(snapshot.marketId)}`;
    $('receipt-chain-link').href = `https://solscan.io/account/${encodeURIComponent(snapshot.marketId)}${snapshot.cluster === 'devnet' ? '?cluster=devnet' : ''}`;
    $('receipt-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.href); $('receipt-copy-status').textContent = 'Receipt link copied.'; }
      catch { $('receipt-copy-status').textContent = 'Copy this page’s URL from your browser address bar.'; }
    });
    $('receipt-content').hidden = false;
    loadLive();
  } catch (error) {
    $('receipt-title').textContent = 'Receipt unavailable';
    $('receipt-error').textContent = error.message;
    $('receipt-error').hidden = false;
  }
}
init();
