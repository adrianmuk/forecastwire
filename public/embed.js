const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('market');
const marketPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function sharePrice(value) { const n = Number(value); return value !== null && value !== undefined && value !== '' && Number.isFinite(n) && n >= 0 && n <= 1 ? `${(n * 100).toFixed(1).replace(/\.0$/, '')}¢` : '—'; }
function spot(market, side) {
  const valid = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1;
  const generic = market[`${side}Price`];
  const specific = ['primary', 'secondary'].includes(market.phase) ? market[`${market.phase}${side[0].toUpperCase()}${side.slice(1)}Price`] : null;
  return valid(generic) ? generic : valid(specific) ? specific : null;
}
let retryCount = 0;
let hasMarket = false;
function retry(minDelay = 0) {
  const delay = Math.max(minDelay, [2_000, 5_000, 12_000, 30_000, 60_000][Math.min(retryCount++, 4)]);
  setTimeout(render, delay);
}
async function render() {
  if (!id || !marketPattern.test(id)) { $('embed-title').textContent = 'Select a valid market to embed.'; $('embed-prices').hidden = true; return; }
  $('embed-link').href = `/?market=${encodeURIComponent(id)}`;
  try {
    const response = await fetch(`/api/markets/${id}`, { cache: 'no-store' });
    const market = await response.json();
    if (!response.ok) { const error = new Error(market.message || 'Market unavailable'); error.status = response.status; throw error; }
    hasMarket = true;
    $('embed-prices').hidden = false;
    const yes = spot(market, 'yes'); const no = spot(market, 'no');
    $('embed-title').textContent = (typeof market.title === 'string' && market.title.trim()) || `Market ${id.slice(0, 6)}…${id.slice(-5)}`;
    $('embed-category').textContent = `${market.category || 'Panta'} / ${market.phase || 'Market'}`.toUpperCase();
    $('embed-yes').textContent = sharePrice(yes); $('embed-no').textContent = sharePrice(no);
    const missingPrices = yes === null || no === null;
    const updated = new Date(market._meta?.fetchedAt);
    $('embed-time').textContent = missingPrices ? 'PANTA PRICE UNAVAILABLE' : Number.isNaN(updated.getTime()) ? 'MARKET PRICE' : `UPDATED ${updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    if (!market.title || (['primary', 'secondary'].includes(market.phase) && missingPrices)) retry();
    else retryCount = 0;
  } catch (error) {
    if (!hasMarket) { $('embed-title').textContent = error.message; $('embed-prices').hidden = true; }
    if (![401, 404, 503].includes(error.status)) retry(error.status === 429 ? 60_000 : 0);
  }
}
render();
