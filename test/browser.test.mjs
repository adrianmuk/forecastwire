import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('phase filtering checks detail instead of forwarding a catalog status filter', async () => {
  const id = 'D'.repeat(44);
  const requested = [];
  const queued = [];
  const nodes = new Map([
    ['status-select', { value: 'resolved' }], ['category-select', { value: '' }], ['search-input', { value: '' }],
    ['list-label', { textContent: '' }], ['load-more', { hidden: false }],
  ]);
  const element = (name) => nodes.get(name) || {};
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/init\(\);\s*$/, '');
  const context = {
    document: { getElementById: element },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async (url) => {
      requested.push(url);
      return { ok: true, json: async () => ({ items: [{ marketId: id, title: 'Rain?', phase: 'secondary' }], nextCursor: 'next' }) };
    },
    URLSearchParams, Date, Intl, Number, Map, Set, queued,
  };
  runInNewContext(source, context);
  runInNewContext('renderList = () => {}; queueTitle = (id) => queued.push(id);', context);
  await runInNewContext('loadMarkets()', context);
  assert.equal(requested[0], '/api/markets?limit=20');
  assert.deepEqual(queued, [id]);
  assert.equal(runInNewContext('marketPhase({ phase: "secondary", resolved: true })', context), 'resolved');
  assert.equal(runInNewContext('marketPhase({ phase: "secondary", resolved: false })', context), 'secondary');
});

test('a state filter continues past an early match up to the scan bound', async () => {
  const first = 'E'.repeat(44);
  const second = 'F'.repeat(44);
  const requested = [];
  const nodes = new Map([
    ['status-select', { value: 'resolved' }], ['category-select', { value: '' }], ['search-input', { value: '' }],
    ['list-label', { textContent: '' }], ['load-more', { hidden: false }],
  ]);
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/init\(\);\s*$/, '');
  const context = {
    document: { getElementById: (id) => nodes.get(id) || {} },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async (url) => {
      requested.push(url);
      return { ok: true, json: async () => requested.length === 1
        ? { items: [{ marketId: first, title: 'Open', phase: 'secondary' }], nextCursor: 'page-two' }
        : requested.length === 2
          ? { items: [{ marketId: second, title: 'Done', phase: 'secondary', resolved: true }], nextCursor: 'page-three' }
          : { items: [], nextCursor: null } };
    },
    URLSearchParams, Date, Intl, Number, Map, Set,
  };
  runInNewContext(source, context);
  runInNewContext(`renderList = () => {}; queueTitle = (id) => {
    state.phaseChecked.add(id);
  };`, context);
  await runInNewContext('loadMarkets()', context);
  await new Promise(setImmediate);
  assert.deepEqual(requested, ['/api/markets?limit=20', '/api/markets?limit=20&cursor=page-two', '/api/markets?limit=20&cursor=page-three']);
  assert.equal(runInNewContext('state.scanPages', context), 3);
});

test('text search continues past the first title match to fill results', async () => {
  const first = 'G'.repeat(44);
  const second = 'H'.repeat(44);
  const requested = [];
  const nodes = new Map([
    ['status-select', { value: '' }], ['category-select', { value: '' }],
    ['search-input', { value: 'rain' }], ['list-label', { textContent: '' }], ['load-more', { hidden: false }],
  ]);
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/init\(\);\s*$/, '');
  const context = {
    document: { getElementById: (id) => nodes.get(id) || {} },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async (url) => {
      requested.push(url);
      return { ok: true, json: async () => requested.length === 1
        ? { items: [{ marketId: first, title: 'Football final', phase: 'secondary' }], nextCursor: 'second' }
        : requested.length === 2
          ? { items: [{ marketId: second, title: 'Will it rain?', phase: 'secondary' }], nextCursor: 'third' }
          : { items: [], nextCursor: null } };
    },
    URLSearchParams, Date, Intl, Number, Map, Set,
  };
  runInNewContext(source, context);
  runInNewContext('renderList = () => {};', context);
  await runInNewContext('loadMarkets()', context);
  await new Promise(setImmediate);
  assert.deepEqual(requested, ['/api/markets?limit=20', '/api/markets?limit=20&cursor=second', '/api/markets?limit=20&cursor=third']);
  assert.equal(runInNewContext('state.markets.length', context), 2);
});

test('a full page of text matches does not trigger extra catalog reads', async () => {
  const requested = [];
  const nodes = new Map([
    ['status-select', { value: '' }], ['category-select', { value: '' }],
    ['search-input', { value: 'rain' }], ['list-label', { textContent: '' }], ['load-more', { hidden: false }],
  ]);
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/init\(\);\s*$/, '');
  const context = {
    document: { getElementById: (id) => nodes.get(id) || {} },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async (url) => {
      requested.push(url);
      return { ok: true, json: async () => ({ items: Array.from({ length: 20 }, (_, i) => ({
        marketId: `${'A'.repeat(43)}${'123456789ABCDEFGHJKLM'[i]}`, title: `Rain ${i}`, phase: 'secondary',
      })), nextCursor: 'second' }) };
    },
    URLSearchParams, Date, Intl, Number, Map, Set,
  };
  runInNewContext(source, context);
  runInNewContext('renderList = () => {};', context);
  await runInNewContext('loadMarkets()', context);
  assert.deepEqual(requested, ['/api/markets?limit=20']);
});

test('a category selection automatically browses three category-scoped pages', async () => {
  const requested = [];
  const nodes = new Map([
    ['status-select', { value: '' }], ['category-select', { value: 'science' }],
    ['search-input', { value: '' }], ['list-label', { textContent: '' }], ['load-more', { hidden: false }],
  ]);
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/init\(\);\s*$/, '');
  const context = {
    document: { getElementById: (id) => nodes.get(id) || {} },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async (url) => {
      requested.push(url);
      return { ok: true, json: async () => ({ items: [], nextCursor: `page-${requested.length + 1}` }) };
    },
    URLSearchParams, Date, Intl, Number, Map, Set,
  };
  runInNewContext(source, context);
  runInNewContext('renderList = () => {};', context);
  await runInNewContext('loadMarkets()', context);
  await new Promise(setImmediate);
  assert.deepEqual(requested, [
    '/api/markets?limit=20&category=science',
    '/api/markets?limit=20&category=science&cursor=page-2',
    '/api/markets?limit=20&category=science&cursor=page-3',
  ]);
  assert.equal(runInNewContext('state.scanPages', context), 3);
});

test('the open brief keeps retrying after its title arrives but prices are still unavailable', async () => {
  const id = 'A'.repeat(44);
  const titleNode = { textContent: '' };
  const card = { dataset: { marketId: id }, querySelector: () => titleNode, setAttribute() {} };
  const nodes = new Map([['market-list', { children: [card] }], ['search-input', { value: '' }]]);
  const element = (name) => {
    if (!nodes.has(name)) nodes.set(name, { textContent: '', hidden: false, style: {}, replaceChildren() {}, append() {} });
    return nodes.get(name);
  };
  const timers = new Map();
  let timerId = 0;
  let calls = 0;
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/init\(\);\s*$/, '');
  const context = {
    document: { getElementById: element, createElement: () => ({ textContent: '', className: '' }) },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async () => {
      calls++;
      const detail = calls === 1
        ? { marketId: id, title: '', phase: 'secondary', yesPrice: null, noPrice: null }
        : calls === 2
          ? { marketId: id, title: 'Will Tram finish in the Top 3?', phase: 'secondary', yesPrice: null, noPrice: null }
          : { marketId: id, title: 'Will Tram finish in the Top 3?', phase: 'secondary', yesPrice: null, noPrice: null, secondaryYesPrice: '0.37', secondaryNoPrice: '0.63' };
      return { ok: true, json: async () => detail };
    },
    setTimeout: (callback, delay) => { const token = ++timerId; timers.set(token, { callback, delay }); return token; },
    clearTimeout: (token) => timers.delete(token),
    URLSearchParams, Date, Intl, Number, Map, Set,
  };
  runInNewContext(source, context);
  const state = runInNewContext('state', context);
  state.selectedId = id;
  state.markets = [{ marketId: id, title: '', volumeUsdc: '34' }];
  state.detail = { marketId: id, title: '', phase: 'secondary', yesPrice: null, noPrice: null };
  runInNewContext(`queueTitle('${id}')`, context);
  await new Promise(setImmediate);

  assert.equal(calls, 1);
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 2_000);
  assert.match(element('detail-title').textContent, /^Market A/);

  const [token, retry] = [...timers][0];
  timers.delete(token);
  retry.callback();
  await new Promise(setImmediate);

  assert.equal(calls, 2);
  assert.equal(element('detail-title').textContent, 'Will Tram finish in the Top 3?');
  assert.equal(titleNode.textContent, 'Will Tram finish in the Top 3?');
  assert.equal(element('yes-price').textContent, '—');
  assert.equal(element('detail-volume').textContent, '34 USDC');
  assert.match(element('price-note').textContent, /Retrying/);
  assert.equal(timers.size, 1);

  const [nextToken, nextRetry] = [...timers][0];
  assert.equal(nextRetry.delay, 5_000);
  timers.delete(nextToken);
  nextRetry.callback();
  await new Promise(setImmediate);

  assert.equal(calls, 3);
  assert.equal(element('yes-price').textContent, '37¢');
  assert.equal(element('no-price').textContent, '63¢');
  assert.equal(element('detail-volume').textContent, '34 USDC');
  assert.equal(timers.size, 0);
});

test('market detail appears before a slow trade history response', async () => {
  const id = 'B'.repeat(44);
  const observed = [];
  let completeTrades;
  const nodes = new Map();
  const element = (name) => {
    if (!nodes.has(name)) nodes.set(name, { textContent: '', value: '', hidden: false,
      querySelector: () => ({ textContent: '' }) });
    return nodes.get(name);
  };
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/init\(\);\s*$/, '');
  const context = {
    document: { getElementById: element, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} },
    history: { replaceState() {} },
    fetch: (resource) => resource.includes('/trades')
      ? new Promise((resolve) => { completeTrades = () => resolve({ ok: true, json: async () => ({ items: [{ signature: 'x' }] }) }); })
      : Promise.resolve({ ok: true, json: async () => ({ marketId: id, title: 'Real question', phase: 'secondary', yesPrice: .4, noPrice: .6 }) }),
    URLSearchParams, Date, Intl, Number, Map, Set, encodeURIComponent, observed,
  };
  runInNewContext(source, context);
  runInNewContext("renderList = () => {}; applyMarketDetail = (id, detail) => { observed.push('detail'); state.detail = detail; }; detailNeedsRetry = () => false; renderTrades = () => observed.push('trades');", context);
  await runInNewContext(`selectMarket('${id}')`, context);
  assert.deepEqual(observed, ['detail']);
  completeTrades();
  await new Promise(setImmediate);
  assert.deepEqual(observed, ['detail', 'trades']);
});

test('an embedded secondary market also updates prices without reloading', async () => {
  const id = 'C'.repeat(44);
  const nodes = new Map();
  const element = (name) => {
    if (!nodes.has(name)) nodes.set(name, { textContent: '', hidden: false });
    return nodes.get(name);
  };
  const timers = [];
  let calls = 0;
  const source = await readFile(new URL('../public/embed.js', import.meta.url), 'utf8');
  const context = {
    document: { getElementById: element },
    location: { search: `?market=${id}` },
    URLSearchParams, Date, Number,
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); },
    fetch: async () => {
      calls++;
      return { ok: true, json: async () => ({ marketId: id, title: 'Match forecast', phase: 'secondary', yesPrice: null, noPrice: null,
        secondaryYesPrice: calls === 1 ? null : 0, secondaryNoPrice: calls === 1 ? null : 1 }) };
    },
  };
  runInNewContext(source, context);
  await new Promise(setImmediate);
  assert.equal(element('embed-time').textContent, 'PANTA PRICE UNAVAILABLE');
  assert.equal(timers[0].delay, 2_000);

  timers.shift().callback();
  await new Promise(setImmediate);
  assert.equal(element('embed-yes').textContent, '0¢');
  assert.equal(element('embed-no').textContent, '100¢');
  assert.equal(timers.length, 0);
});

test('receipt compares the captured quote when Panta prices arrive later', async () => {
  const id = 'D'.repeat(44);
  const nodes = new Map();
  const element = (name) => {
    if (!nodes.has(name)) nodes.set(name, { textContent: '', hidden: false, href: '', addEventListener() {} });
    return nodes.get(name);
  };
  const timers = [];
  let liveCalls = 0;
  const source = await readFile(new URL('../public/receipt.js', import.meta.url), 'utf8');
  const context = {
    document: { getElementById: element },
    location: { search: '?token=signed-token', href: 'https://example.test/receipt?token=signed-token' },
    URLSearchParams, Date, Number, Intl, Error, encodeURIComponent,
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); },
    fetch: async (resource) => ({ ok: true, json: async () => resource.startsWith('/api/receipt')
      ? { verified: true, snapshot: { marketId: id, title: 'Will it rain?', side: 'yes', yes: 0.37, no: 0.63,
        note: 'Expecting rain.', capturedAt: '2026-10-05T12:00:00.000Z', cluster: 'mainnet-beta' } }
      : (liveCalls++, { marketId: id, phase: 'secondary', secondaryYesPrice: liveCalls === 1 ? null : 0.62,
        secondaryNoPrice: liveCalls === 1 ? null : 0.38, _meta: { fetchedAt: '2026-10-05T12:01:00.000Z' } }) }),
  };
  runInNewContext(source, context);
  await new Promise(setImmediate);
  assert.equal(element('receipt-title').textContent, 'Will it rain?');
  assert.equal(element('receipt-side').textContent, 'Published call: YES.');
  assert.equal(element('receipt-at-yes').textContent, '37¢');
  assert.equal(element('receipt-now-yes').textContent, '—');
  assert.match(element('receipt-live-status').textContent, /Retrying/);
  assert.equal(timers[0].delay, 2_000);

  timers.shift().callback();
  await new Promise(setImmediate);
  assert.equal(element('receipt-at-yes').textContent, '37¢');
  assert.equal(element('receipt-now-yes').textContent, '62¢');
  assert.match(element('receipt-change').textContent, /rose 25¢/);
  assert.equal(timers[0].delay, 60_000);
  assert.equal(runInNewContext("snapshot.side = 'no'; changeText(0.38)", context), 'The NO share price fell 25¢ since capture.');
});
