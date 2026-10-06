const $ = (id) => document.getElementById(id);
const marketPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const state = { markets: [], nextCursor: null, selectedId: null, detail: null, trades: [], tradesLoading: false, tradesError: false, mode: 'discover', loading: false, searchPending: false, catalogRequest: 0, phaseChecked: new Set(), scanPages: 0, requestId: 0, followed: loadFollowing(), cluster: 'mainnet-beta' };
const titleCache = loadTitleCache();
const titleQueued = new Set();
const titleLoading = new Set();
const titleFailed = new Set();
const titleAttempts = new Map();
const titleRetryTimers = new Map();
const titleRetryDelays = [2_000, 5_000, 12_000, 30_000, 60_000];
let activeTitleLoads = 0;

function loadTitleCache() {
  try {
    const saved = JSON.parse(localStorage.getItem('forecastwire:titles') || '[]');
    if (!Array.isArray(saved)) return new Map();
    const now = Date.now();
    return new Map(saved.filter(([id, value]) => marketPattern.test(id) && typeof value?.title === 'string' && value.title.trim() && Number.isFinite(value.at) && value.at <= now && now - value.at < 86_400_000).slice(-200));
  } catch { return new Map(); }
}
function saveTitleCache() {
  try { localStorage.setItem('forecastwire:titles', JSON.stringify([...titleCache])); }
  catch { /* Private browsing may disable storage. */ }
}

function loadFollowing() {
  try {
    const saved = JSON.parse(localStorage.getItem('forecastwire:following') || '[]');
    return Array.isArray(saved) ? saved.filter((item) => item && marketPattern.test(item.marketId)).slice(0, 40) : [];
  } catch { return []; }
}
function saveFollowing() { localStorage.setItem('forecastwire:following', JSON.stringify(state.followed)); $('follow-count').textContent = String(state.followed.length); }
function dateTime(seconds) { return Number.isFinite(Number(seconds)) && Number(seconds) > 0 ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(Number(seconds) * 1000)) : 'Not specified'; }
function volume(value) { const n = Number(value); return value !== null && value !== undefined && value !== '' && Number.isFinite(n) ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)} USDC` : 'Unavailable'; }
function price(value) { const n = Number(value); return value !== null && value !== undefined && value !== '' && Number.isFinite(n) && n >= 0 && n <= 1 ? `${(n * 100).toFixed(1).replace(/\.0$/, '')}¢` : '—'; }
function shortAddress(value) { return typeof value === 'string' && value.length > 13 ? `${value.slice(0, 6)}…${value.slice(-5)}` : value || '—'; }
function fetchedTime(meta) { const d = new Date(meta?.fetchedAt); return Number.isNaN(d.getTime()) ? 'Time unknown' : `Updated ${new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(d)}`; }
function solscan(signature) { return `https://solscan.io/tx/${encodeURIComponent(signature)}${state.cluster === 'devnet' ? '?cluster=devnet' : ''}`; }
function marketTitle(market, list = false) {
  const title = (typeof market.title === 'string' && market.title.trim()) || titleCache.get(market.marketId)?.title
    || state.markets.find((item) => item.marketId === market.marketId && typeof item.title === 'string' && item.title.trim())?.title;
  if (title) return title;
  return list && marketPattern.test(market.marketId) && !titleFailed.has(market.marketId)
    ? 'Loading market title…' : `Market ${shortAddress(market.marketId)}`;
}

function validSpot(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    && Number(value) >= 0 && Number(value) <= 1;
}

function marketPrices(market) {
  if (!market) return { yes: null, no: null };
  const phase = ['primary', 'secondary'].includes(market.phase) ? market.phase : null;
  const yes = validSpot(market.yesPrice) ? market.yesPrice : phase && market[`${phase}YesPrice`];
  const no = validSpot(market.noPrice) ? market.noPrice : phase && market[`${phase}NoPrice`];
  return { yes: validSpot(yes) ? yes : null, no: validSpot(no) ? no : null };
}
function marketPhase(market) { return market.resolved || market.phase === 'resolved' ? 'resolved' : market.phase || 'unknown'; }
function matchesMarket(market, phase, needle) {
  return (!phase || (state.phaseChecked.has(market.marketId) && marketPhase(market) === phase))
    && (!needle || `${marketTitle(market)} ${market.description || ''} ${market.category || ''}`.toLowerCase().includes(needle));
}

function detailNeedsRetry(detail) {
  const prices = marketPrices(detail);
  return !detail || typeof detail.title !== 'string' || !detail.title.trim() || !detail.phase
    || (['primary', 'secondary'].includes(detail.phase) && (prices.yes === null || prices.no === null));
}

function detailQuality(detail) {
  if (!detail) return -1;
  const prices = marketPrices(detail);
  return (typeof detail.title === 'string' && detail.title.trim() ? 4 : 0)
    + (prices.yes !== null ? 2 : 0) + (prices.no !== null ? 2 : 0)
    + (detail.volumeUsdc != null ? 1 : 0);
}

function clearTitleRetry(id) {
  if (titleRetryTimers.has(id)) clearTimeout(titleRetryTimers.get(id));
  titleRetryTimers.delete(id);
}

async function api(resource, options = {}) {
  const response = await fetch(resource, { ...options, headers: { Accept: 'application/json', ...options.headers }, cache: 'no-store' });
  let body;
  try { body = await response.json(); } catch { throw new Error('The server returned an unreadable response.'); }
  if (!response.ok) {
    const error = new Error(body.message || 'Could not load Panta data.');
    error.status = response.status;
    throw error;
  }
  return body;
}

function rememberTitle(id, value) {
  if (!marketPattern.test(id) || typeof value !== 'string' || !value.trim()) return false;
  const title = value.trim();
  titleCache.delete(id);
  titleCache.set(id, { title, at: Date.now() });
  if (titleCache.size > 200) titleCache.delete(titleCache.keys().next().value);
  titleFailed.delete(id);
  saveTitleCache();
  for (const market of state.markets) if (market.marketId === id) market.title = title;
  let followedChanged = false;
  for (const market of state.followed) if (market.marketId === id && market.title !== title) { market.title = title; followedChanged = true; }
  if (followedChanged) saveFollowing();
  for (const card of $('market-list').children) {
    if (card.dataset.marketId !== id) continue;
    card.querySelector('h3').textContent = title;
    card.setAttribute('aria-label', `Open market brief: ${title}`);
  }
  if ($('search-input').value.trim()) {
    const list = $('market-list'); const scrollTop = list.scrollTop;
    renderList(); list.scrollTop = scrollTop;
  }
  return true;
}

function applyMarketDetail(id, detail) {
  rememberTitle(id, detail.title);
  const row = state.markets.find((market) => market.marketId === id);
  if (row) {
    if (detail.phase) row.phase = detail.phase;
    if (typeof detail.resolved === 'boolean') row.resolved = detail.resolved;
    if (detail.volumeUsdc != null) row.volumeUsdc = detail.volumeUsdc;
  }
  if (detail.phase || typeof detail.resolved === 'boolean') state.phaseChecked.add(id);
  if ($('status-select').value && state.mode === 'discover') renderList();
  if (state.selectedId !== id) return;
  const catalog = state.markets.find((market) => market.marketId === id)
    || state.followed.find((market) => market.marketId === id);
  const merged = { ...detail };
  for (const field of ['title', 'description', 'category', 'phase', 'endTime', 'region', 'volumeUsdc']) {
    if (merged[field] === null || merged[field] === undefined || merged[field] === '') {
      merged[field] = catalog?.[field] ?? state.detail?.[field] ?? merged[field];
    }
  }
  if (detailQuality(merged) < detailQuality(state.detail)) {
    if (state.detail && (detail.phase || typeof detail.resolved === 'boolean')) {
      if (detail.phase) state.detail.phase = detail.phase;
      if (typeof detail.resolved === 'boolean') state.detail.resolved = detail.resolved;
      renderDetail();
    }
    return;
  }
  state.detail = merged;
  renderDetail();
}

function markTitleUnavailable(id) {
  if (titleCache.has(id)) return;
  titleFailed.add(id);
  const title = `Market ${shortAddress(id)}`;
  for (const card of $('market-list').children) {
    if (card.dataset.marketId !== id) continue;
    card.querySelector('h3').textContent = title;
    card.setAttribute('aria-label', `Open market brief: ${title}`);
  }
}

function scheduleTitleRetry(id, minDelay = 0) {
  const selected = state.selectedId === id;
  if (!selected && !state.markets.some((item) => item.marketId === id)) return;
  if (!selected && titleCache.has(id)) return;
  const attempts = titleAttempts.get(id) || 0;
  if (!selected && attempts >= 4) { markTitleUnavailable(id); return; }
  if (titleRetryTimers.has(id) || titleQueued.has(id) || titleLoading.has(id)) return;
  const delay = Math.max(minDelay, titleRetryDelays[Math.min(Math.max(attempts - 1, 0), titleRetryDelays.length - 1)]);
  titleRetryTimers.set(id, setTimeout(() => {
    titleRetryTimers.delete(id);
    queueTitle(id, { force: state.selectedId === id });
  }, delay));
}

function drainTitleQueue() {
  while (activeTitleLoads < 5 && titleQueued.size) {
    const id = titleQueued.values().next().value;
    titleQueued.delete(id); titleLoading.add(id); activeTitleLoads++;
    titleAttempts.set(id, (titleAttempts.get(id) || 0) + 1);
    let retry = false;
    let retryDelay = 0;
    api(`/api/markets/${id}`)
      .then((detail) => {
        applyMarketDetail(id, detail);
        retry = state.selectedId === id ? detailNeedsRetry(state.detail) : !titleCache.has(id);
      })
      .catch((error) => { retry = true; retryDelay = error.status === 429 ? 60_000 : 0; })
      .finally(() => {
        titleLoading.delete(id); activeTitleLoads--;
        if (retry) scheduleTitleRetry(id, retryDelay);
        else if (titleCache.has(id)) { clearTitleRetry(id); titleAttempts.delete(id); }
        if (($('status-select').value || $('search-input').value.trim()) && state.mode === 'discover') renderList();
        drainTitleQueue();
        maybeContinueScan();
      });
  }
}

// Fill a page of state/text matches, or browse the first few category pages.
// Stop at an unverifiable phase page or the scan bound to limit API traffic.
function maybeContinueScan() {
  const phase = $('status-select').value;
  const needle = $('search-input').value.trim().toLowerCase();
  const category = $('category-select').value;
  if ((!phase && !needle && !category) || marketPattern.test(needle) || state.mode !== 'discover' || state.loading || state.searchPending || !state.nextCursor || state.scanPages >= 3) return;
  if (category && !phase && !needle) { loadMarkets({ more: true }); return; }
  if ((phase && state.markets.some((m) => !state.phaseChecked.has(m.marketId))) || titleQueued.size || titleLoading.size) return;
  if (state.markets.filter((m) => matchesMarket(m, phase, needle)).length >= 20) return;
  const empty = $('market-list')?.querySelector?.('.list-message');
  if (empty) empty.textContent = 'Checking the next catalog page for matches…';
  loadMarkets({ more: true });
}

function queueTitle(id, { force = false } = {}) {
  if (!marketPattern.test(id) || (!force && (titleCache.has(id) || titleFailed.has(id))) || titleQueued.has(id) || titleLoading.has(id) || titleRetryTimers.has(id)) return;
  titleQueued.add(id); drainTitleQueue();
}

function renderList() {
  $('follow-count').textContent = String(state.followed.length);
  $('tab-discover').setAttribute('aria-selected', String(state.mode === 'discover'));
  $('tab-following').setAttribute('aria-selected', String(state.mode === 'following'));
  const source = state.mode === 'following' ? state.followed : state.markets;
  const needle = $('search-input').value.trim().toLowerCase();
  const phase = state.mode === 'discover' ? $('status-select').value : '';
  const unchecked = phase && source.some((m) => !state.phaseChecked.has(m.marketId));
  const checking = unchecked && source.some((m) => !state.phaseChecked.has(m.marketId) && (titleQueued.has(m.marketId) || titleLoading.has(m.marketId) || titleRetryTimers.has(m.marketId)));
  const rows = source.filter((m) => matchesMarket(m, phase, needle));
  $('list-label').textContent = state.mode === 'following' ? `${rows.length} followed market${rows.length === 1 ? '' : 's'}` : `${rows.length} matching market${rows.length === 1 ? '' : 's'} in ${source.length} loaded${checking ? ' · checking phases…' : ''}`;
  const list = $('market-list'); list.replaceChildren();
  if (!rows.length) {
    const message = document.createElement('p'); message.className = 'list-message';
    message.textContent = state.mode === 'following' ? 'No markets followed yet. Open a brief and select Follow market.' : checking ? 'Checking phases against current market details…' : unchecked ? 'Some phases could not be verified. Refresh to retry, or load more markets.' : state.nextCursor ? 'No matches in loaded pages. Load more markets to keep looking.' : 'No matching markets in the loaded catalog.';
    list.append(message);
  }
  for (const market of rows) {
    const title = marketTitle(market, true);
    const card = document.createElement('button'); card.type = 'button'; card.className = `market-item${market.marketId === state.selectedId ? ' active' : ''}`;
    card.dataset.marketId = market.marketId;
    card.setAttribute('aria-label', `Open market brief: ${title}`);
    card.innerHTML = '<div class="market-item-top"><span class="category"></span><span class="phase"></span></div><h3></h3><div class="market-item-bottom"><span class="closes"></span><span>VOL <strong class="volume"></strong></span></div>';
    card.querySelector('.category').textContent = market.category || 'Other';
    card.querySelector('.phase').textContent = marketPhase(market);
    card.querySelector('h3').textContent = title;
    card.querySelector('.closes').textContent = `Closes ${dateTime(market.endTime)}`;
    card.querySelector('.volume').textContent = volume(market.volumeUsdc);
    card.addEventListener('click', () => selectMarket(market.marketId)); list.append(card);
  }
  $('load-more').hidden = state.mode !== 'discover' || !state.nextCursor || state.loading;
}

async function loadMarkets({ more = false } = {}) {
  if (more && state.loading) return;
  const request = more ? state.catalogRequest : ++state.catalogRequest;
  state.loading = true;
  if (!more) {
    state.markets = []; state.nextCursor = null; state.phaseChecked.clear(); state.scanPages = 0; titleQueued.clear(); titleFailed.clear(); titleAttempts.clear();
    for (const id of titleRetryTimers.keys()) clearTitleRetry(id);
  }
  $('list-label').textContent = 'Loading Panta markets…'; $('load-more').hidden = true;
  const params = new URLSearchParams({ limit: '20' });
  if ($('category-select').value) params.set('category', $('category-select').value);
  if (more && state.nextCursor) params.set('cursor', state.nextCursor);
  let newItems = [];
  try {
    const result = await api(`/api/markets?${params}`);
    if (request !== state.catalogRequest) return;
    newItems = Array.isArray(result.items) ? result.items : [];
    state.markets = [...state.markets, ...newItems];
    state.nextCursor = result.nextCursor || null;
    state.scanPages++;
  } catch (error) {
    if (request !== state.catalogRequest) return;
    state.loading = false;
    if (more) {
      renderList();
      $('list-label').textContent = `Could not load more markets: ${error.message}`;
      return;
    }
    $('list-label').textContent = 'Unable to load markets';
    $('market-list').replaceChildren();
    const message = document.createElement('p'); message.className = 'list-message'; message.textContent = error.message; $('market-list').append(message);
    return;
  }
  state.loading = false;
  for (const market of newItems) if ($('status-select').value || !market.title || !String(market.title).trim()) queueTitle(market.marketId, { force: Boolean($('status-select').value) });
  renderList();
  maybeContinueScan();
}

async function selectMarket(id) {
  if (!marketPattern.test(id)) return;
  state.selectedId = id; state.detail = null; state.trades = []; state.tradesLoading = true; state.tradesError = false;
  $('receipt-note').value = ''; $('receipt-status').textContent = '';
  for (const option of document.querySelectorAll('input[name="forecast-side"]')) option.checked = false;
  titleFailed.delete(id);
  titleAttempts.delete(id);
  clearTitleRetry(id);
  const requestId = ++state.requestId;
  history.replaceState(null, '', `/?market=${encodeURIComponent(id)}`);
  $('detail-empty').hidden = false; $('detail-content').hidden = true;
  $('detail-empty').querySelector('h3').textContent = 'Loading live brief…';
  renderList();
  // Activity may be slower than market detail; do not hold up the price and
  // capture action while waiting for the independent trades endpoint.
  api(`/api/markets/${id}/trades?limit=40`)
    .then((result) => {
      if (requestId !== state.requestId) return;
      state.trades = Array.isArray(result.items) ? result.items : [];
    })
    .catch(() => { if (requestId === state.requestId) state.tradesError = true; })
    .finally(() => {
      if (requestId !== state.requestId) return;
      state.tradesLoading = false;
      if (state.detail) renderTrades();
    });
  try {
    const detail = await api(`/api/markets/${id}`);
    if (requestId !== state.requestId) return;
    applyMarketDetail(id, detail);
    if (detailNeedsRetry(state.detail)) scheduleTitleRetry(id);
  } catch (error) {
    if (requestId !== state.requestId) return;
    if (!state.detail) {
      $('detail-empty').querySelector('h3').textContent = 'Brief unavailable';
      $('detail-empty').querySelector('p:last-child').textContent = error.message;
    }
    scheduleTitleRetry(id, error.status === 429 ? 60_000 : 0);
  }
}

function renderDetail() {
  const m = state.detail;
  const prices = marketPrices(m);
  const priceUnavailable = prices.yes === null || prices.no === null;
  const titleUnavailable = typeof m.title !== 'string' || !m.title.trim();
  const phaseUnavailable = !m.phase;
  const closed = m.resolved || (m.phase && !['primary', 'secondary'].includes(m.phase));
  const retrying = priceUnavailable && ['primary', 'secondary'].includes(m.phase);
  $('detail-empty').hidden = true; $('detail-content').hidden = false;
  $('detail-category').textContent = (m.category || 'Market').toUpperCase();
  $('detail-phase').textContent = marketPhase(m);
  $('detail-title').textContent = marketTitle(m);
  $('detail-description').textContent = m.description || 'No additional description provided by the market.';
  $('detail-updated').textContent = priceUnavailable ? 'Panta price unavailable' : fetchedTime(m._meta);
  $('detail-updated').title = fetchedTime(m._meta);
  $('yes-price').textContent = price(prices.yes); $('no-price').textContent = price(prices.no);
  $('yes-bar').style.width = prices.yes !== null ? `${Number(prices.yes) * 100}%` : '0%';
  $('capture-submit').disabled = priceUnavailable || titleUnavailable || phaseUnavailable || closed;
  $('capture-submit').textContent = closed ? 'Choose an open market to forecast' : phaseUnavailable ? 'Waiting for market status…' : titleUnavailable ? 'Waiting for market title…' : priceUnavailable ? 'Waiting for Panta prices…' : 'Capture this price ↗';
  $('price-note').textContent = priceUnavailable
    ? `Panta has not returned ${prices.yes === null && prices.no === null ? 'spot prices' : 'both spot prices'} for this market.${retrying ? ' Retrying while this brief is open.' : ''}`
    : 'Spot share prices are market signals, not guaranteed outcomes.';
  $('detail-volume').textContent = volume(m.volumeUsdc);
  $('detail-closes').textContent = dateTime(m.endTime);
  $('detail-region').textContent = m.region || 'Not specified';
  $('detail-id').textContent = shortAddress(m.marketId); $('detail-id').title = m.marketId;
  $('follow-button').textContent = state.followed.some((item) => item.marketId === m.marketId) ? '★ Following' : '☆ Follow market';
  $('action-feedback').textContent = '';
  renderTrades();
}

function renderTrades() {
  const list = $('trade-list'); list.replaceChildren();
  if (state.tradesLoading) {
    $('trade-summary').textContent = 'Checking recent Panta activity';
    const p = document.createElement('p'); p.className = 'trade-empty'; p.textContent = 'Loading reported trades…'; list.append(p); return;
  }
  if (state.tradesError) {
    $('trade-summary').textContent = 'Activity temporarily unavailable';
    const p = document.createElement('p'); p.className = 'trade-empty'; p.textContent = 'The market price is available, but reported trades could not be loaded.'; list.append(p); return;
  }
  $('trade-summary').textContent = `${state.trades.length} recent reported trade${state.trades.length === 1 ? '' : 's'}`;
  if (!state.trades.length) { const p = document.createElement('p'); p.className = 'trade-empty'; p.textContent = 'No reported trades are available for this market.'; list.append(p); return; }
  for (const trade of state.trades.slice(0, 8)) {
    const yes = Number(trade.yesAmount) || 0; const no = Number(trade.noAmount) || 0;
    const row = document.createElement('div'); row.className = 'trade-row';
    const side = document.createElement('span'); side.className = `trade-side${no > yes ? ' no' : ''}`;
    side.textContent = no > yes ? `${no.toLocaleString()} NO shares` : yes > 0 ? `${yes.toLocaleString()} YES shares` : 'Market trade';
    const time = document.createElement('span'); time.className = 'trade-time'; time.textContent = trade.blockTime ? dateTime(trade.blockTime) : 'Time unknown';
    row.append(side, time);
    if (typeof trade.signature === 'string' && /^[1-9A-HJ-NP-Za-km-z]{70,100}$/.test(trade.signature)) {
      const link = document.createElement('a'); link.href = solscan(trade.signature); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Verify ↗'; link.setAttribute('aria-label', 'Verify transaction on Solscan'); row.append(link);
    }
    list.append(row);
  }
}

function feedback(message) { $('action-feedback').textContent = message; }
async function copy(value, label) {
  try { await navigator.clipboard.writeText(value); feedback(`${label} copied.`); }
  catch { feedback('Clipboard unavailable. Use the browser address bar to copy this market link.'); }
}
function shareUrl() { return `${location.origin}/?market=${encodeURIComponent(state.selectedId)}`; }

async function captureForecast(event) {
  event.preventDefault();
  if (!state.detail || !state.selectedId) return;
  const marketId = state.selectedId;
  const side = document.querySelector('input[name="forecast-side"]:checked')?.value;
  if (!side) return;
  const button = $('capture-submit'); const status = $('receipt-status');
  button.disabled = true; status.textContent = 'Recording the latest available Panta quote…';
  try {
    const result = await api('/api/receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketId, side, note: $('receipt-note').value.trim() }) });
    if (state.selectedId === marketId) location.assign(result.url);
  } catch (error) {
    if (state.selectedId === marketId) status.textContent = error.message;
  } finally {
    if (state.selectedId === marketId) {
      const prices = marketPrices(state.detail);
      button.disabled = !state.detail?.title?.trim() || state.detail.resolved || !['primary', 'secondary'].includes(state.detail.phase)
        || prices.yes === null || prices.no === null;
    }
  }
}

function initActions() {
  let searchTimer;
  $('tab-discover').addEventListener('click', () => { state.mode = 'discover'; renderList(); maybeContinueScan(); });
  $('tab-following').addEventListener('click', () => { state.mode = 'following'; renderList(); });
  $('search-input').addEventListener('input', () => {
    state.searchPending = true;
    renderList();
    clearTimeout(searchTimer);
    if (state.mode === 'discover') searchTimer = setTimeout(() => {
      state.searchPending = false;
      if (!marketPattern.test($('search-input').value.trim())) loadMarkets();
    }, 350);
    else state.searchPending = false;
  });
  $('search-input').addEventListener('keydown', (event) => {
    const id = $('search-input').value.trim();
    if (event.key === 'Enter' && marketPattern.test(id)) {
      event.preventDefault(); clearTimeout(searchTimer); state.searchPending = false; $('search-input').value = ''; selectMarket(id);
    }
  });
  $('category-select').addEventListener('change', () => loadMarkets());
  $('status-select').addEventListener('change', () => loadMarkets());
  $('load-more').addEventListener('click', () => loadMarkets({ more: true }));
  $('refresh-button').addEventListener('click', () => {
    loadMarkets();
    if (state.selectedId) selectMarket(state.selectedId);
  });
  $('follow-button').addEventListener('click', () => {
    if (!state.detail) return;
    const index = state.followed.findIndex((item) => item.marketId === state.detail.marketId);
    if (index >= 0) { state.followed.splice(index, 1); feedback('Removed from following.'); }
    else { state.followed.unshift({ marketId: state.detail.marketId, title: state.detail.title, description: state.detail.description, category: state.detail.category, phase: state.detail.phase, endTime: state.detail.endTime, volumeUsdc: state.detail.volumeUsdc }); state.followed = state.followed.slice(0, 40); feedback('Saved in this browser.'); }
    saveFollowing(); renderList(); $('follow-button').textContent = index >= 0 ? '☆ Follow market' : '★ Following';
  });
  $('copy-link').addEventListener('click', () => state.detail && copy(shareUrl(), 'Link'));
  $('copy-brief').addEventListener('click', () => {
    const m = state.detail; if (!m) return;
    const prices = marketPrices(m);
    copy(`${marketTitle(m)}\nYES share: ${price(prices.yes)} · NO share: ${price(prices.no)}\nVolume: ${volume(m.volumeUsdc)} · Closes: ${dateTime(m.endTime)}\nSource: Panta API · ${fetchedTime(m._meta)}\nFull live brief: ${shareUrl()}\nPowered by Panta. Market prices are signals, not guaranteed outcomes.`, 'Brief');
  });
  $('copy-embed').addEventListener('click', () => state.detail && copy(`<iframe src="${location.origin}/embed?market=${encodeURIComponent(state.selectedId)}" title="ForecastWire market brief" width="100%" height="280" style="border:0;max-width:700px" loading="lazy"></iframe>`, 'Embed code'));
  $('wallet-form').addEventListener('submit', inspectWallet);
  $('receipt-form').addEventListener('submit', captureForecast);
}

async function inspectWallet(event) {
  event.preventDefault();
  const wallet = $('wallet-input').value.trim(); const status = $('wallet-status'); const list = $('positions-list');
  list.replaceChildren();
  if (!marketPattern.test(wallet)) { status.textContent = 'Enter a valid base58 Solana address.'; return; }
  status.textContent = 'Loading public positions…';
  try {
    const result = await api(`/api/positions?wallet=${encodeURIComponent(wallet)}`);
    const positions = Array.isArray(result.positions) ? result.positions : [];
    if (!positions.length) { status.textContent = 'No Panta positions were found for this wallet.'; return; }
    status.textContent = `Showing ${Math.min(positions.length, 10)} of ${positions.length} position${positions.length === 1 ? '' : 's'}. Values are estimates from spot prices.`;
    const shown = positions.slice(0, 10);
    const ids = [...new Set(shown.map((p) => p.marketId))];
    const detailMap = new Map();
    for (let i = 0; i < ids.length; i += 3) {
      const results = await Promise.allSettled(ids.slice(i, i + 3).map((id) => marketPattern.test(id) ? api(`/api/markets/${id}`) : Promise.reject()));
      results.forEach((r, j) => { if (r.status === 'fulfilled') detailMap.set(ids[i + j], r.value); });
    }
    for (const position of shown) {
      const detail = detailMap.get(position.marketId);
      const shares = Number(position.shares); const prices = marketPrices(detail);
      const spotValue = position.side === 'yes' ? prices.yes : prices.no;
      const spot = spotValue === null ? NaN : Number(spotValue);
      let estimate = 'Price unavailable';
      if (position.outcome === 'yes' || position.outcome === 'no') estimate = position.outcome === position.side ? `${shares.toFixed(2)} USDC settlement est.` : '0 USDC settlement est.';
      else if (detail && Number.isFinite(shares) && Number.isFinite(spot) && spot >= 0 && spot <= 1) estimate = `${(shares * spot).toFixed(2)} USDC spot est.`;
      const row = document.createElement('div'); row.className = 'position-row';
      const left = document.createElement('div'); const title = document.createElement('strong'); title.textContent = detail?.title || shortAddress(position.marketId);
      const sub = document.createElement('small'); sub.textContent = `${String(position.side || '').toUpperCase()} · ${position.shares} shares · ${position.phase || 'Unknown phase'}`;
      left.append(title, sub);
      const right = document.createElement('div'); right.className = 'position-right'; const amount = document.createElement('strong'); amount.textContent = estimate;
      const claim = document.createElement('small'); claim.textContent = position.claimable ? 'Claimable' : position.claimed ? 'Claimed' : 'Not claimable';
      right.append(amount, claim); row.append(left, right); list.append(row);
    }
  } catch (error) { status.textContent = error.message; }
}

async function init() {
  initActions(); saveFollowing();
  try {
    const health = await api('/api/health'); state.cluster = health.cluster;
    $('setup-banner').hidden = health.configured;
  } catch { /* Catalog request below will surface the error. */ }
  const requested = new URLSearchParams(location.search).get('market');
  const startup = [loadMarkets(), api('/api/categories').then((result) => {
    for (const category of result.categories || []) {
      if (!/^[a-z0-9-]{1,40}$/.test(category)) continue;
      const option = document.createElement('option'); option.value = category; option.textContent = category.charAt(0).toUpperCase() + category.slice(1); $('category-select').append(option);
    }
  }).catch(() => {})];
  if (requested && marketPattern.test(requested)) startup.push(selectMarket(requested));
  await Promise.all(startup);
}
init();
