import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.mjs';

const marketId = 'A'.repeat(44);
const wallet = 'C'.repeat(44);

async function withServer(options, callback) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('serves the app without exposing API credentials to browser assets', async () => {
  await withServer({ apiKey: 'pk_test_private' }, async (origin) => {
    const page = await fetch(origin);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Powered by Panta/);
    assert.doesNotMatch(html, /pk_test_private/);
    const health = await (await fetch(`${origin}/api/health`)).json();
    assert.equal(health.configured, true);
    assert.doesNotMatch(JSON.stringify(health), /pk_test_private/);
    assert.equal((await fetch(`${origin}/healthz`)).status, 200);
  });
});

test('forwards authenticated catalog requests and caches successful responses', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ items: [{ marketId, title: 'Will it rain?' }], nextCursor: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  await withServer({ apiKey: 'pk_test_private', fetchImpl, now: () => 1_000 }, async (origin) => {
    for (let i = 0; i < 2; i++) {
      const result = await (await fetch(`${origin}/api/markets?category=science&status=primary&limit=3`)).json();
      assert.equal(result.items[0].marketId, marketId);
      assert.equal(result._meta.source, 'Panta API');
    }
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/markets\/\?limit=3&category=science&status=primary$/);
    assert.equal(calls[0].options.headers['X-Api-Key'], 'pk_test_private');
  });
});

test('rechecks incomplete market detail promptly, then caches complete detail', async () => {
  let clock = 1_000;
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    const detail = calls === 1
      ? { marketId, title: '', phase: 'secondary', yesPrice: null, noPrice: null }
      : calls === 2
        ? { marketId, title: 'Will it rain?', phase: 'secondary', yesPrice: null, noPrice: null }
        : { marketId, title: 'Will it rain?', phase: 'secondary', yesPrice: null, noPrice: null, secondaryYesPrice: '0.4', secondaryNoPrice: '0.6' };
    return new Response(JSON.stringify(detail), { status: 200 });
  };
  await withServer({ apiKey: 'pk_test_private', fetchImpl, now: () => clock }, async (origin) => {
    const read = async () => (await fetch(`${origin}/api/markets/${marketId}`)).json();
    assert.equal((await read()).title, '');
    clock += 500;
    assert.equal((await read()).title, '');
    assert.equal(calls, 1);
    clock += 600;
    assert.equal((await read()).title, 'Will it rain?');
    assert.equal(calls, 2);
    clock += 1_100;
    const complete = await read();
    assert.equal(complete.secondaryYesPrice, '0.4');
    assert.equal(complete.secondaryNoPrice, '0.6');
    assert.equal(calls, 3);
    clock += 2_000;
    assert.equal((await read()).title, 'Will it rain?');
    assert.equal(calls, 3);
  });
});

test('serves app code without browser caching so an update is picked up on refresh', async () => {
  await withServer({ apiKey: 'pk_test_private' }, async (origin) => {
    const response = await fetch(`${origin}/app.js`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

test('accepts opaque Panta pagination cursors and forwards them unchanged', async () => {
  const cursor = `2026-10-05T12:00:00Z|${marketId}`;
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(new URL(url));
    return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
  };
  await withServer({ apiKey: 'pk_test_private', fetchImpl }, async (origin) => {
    const response = await fetch(`${origin}/api/markets?cursor=${encodeURIComponent(cursor)}`);
    assert.equal(response.status, 200);
    assert.equal(calls[0].searchParams.get('cursor'), cursor);

    const bad = await fetch(`${origin}/api/markets?cursor=${encodeURIComponent('bad\nvalue')}`);
    assert.equal(bad.status, 400);
    assert.equal(calls.length, 1);
  });
});

test('rejects invalid addresses before calling Panta', async () => {
  let called = false;
  await withServer({ apiKey: 'pk_test_private', fetchImpl: async () => { called = true; throw new Error('unexpected'); } }, async (origin) => {
    const urls = ['/api/markets/not-an-address', '/api/positions?wallet=bad', '/api/markets?category=%2Fadmin'];
    for (const url of urls) assert.equal((await fetch(`${origin}${url}`)).status, 400);
  });
  assert.equal(called, false);
});

test('reports missing credentials and sanitized upstream errors', async () => {
  await withServer({ apiKey: '' }, async (origin) => {
    assert.equal((await fetch(`${origin}/healthz`)).status, 503);
    const result = await (await fetch(`${origin}/api/categories`)).json();
    assert.equal(result.code, 'API_NOT_CONFIGURED');
  });
  await withServer({ apiKey: 'pk_test_private', fetchImpl: async () => new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'Secret diagnostics' }), { status: 401 }) }, async (origin) => {
    const response = await fetch(`${origin}/api/positions?wallet=${wallet}`);
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(result.code, 'UNAUTHORIZED');
    assert.doesNotMatch(JSON.stringify(result), /Secret diagnostics/);
  });
});

test('a receipt keeps the original Panta quote and rejects an edited link', async () => {
  let clock = Date.UTC(2026, 9, 5, 12);
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response(JSON.stringify({ marketId, title: 'Will it rain?', phase: 'secondary',
      secondaryYesPrice: calls === 1 ? '0.37' : '0.62', secondaryNoPrice: calls === 1 ? '0.63' : '0.38' }), { status: 200 });
  };
  await withServer({ apiKey: 'pk_test_private', receiptSecret: 'stable-private-test-secret', fetchImpl, now: () => clock }, async (origin) => {
    // A quote displayed moments earlier can be captured with its true fetch time.
    const displayed = await (await fetch(`${origin}/api/markets/${marketId}`)).json();
    assert.equal(displayed.secondaryYesPrice, '0.37');
    clock += 5_000;
    const created = await fetch(`${origin}/api/receipts`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketId, side: 'yes', note: 'My published forecast.' }) });
    assert.equal(created.status, 201);
    const { url, snapshot } = await created.json();
    assert.equal(calls, 1);
    assert.equal(snapshot.yes, 0.37);
    assert.equal(snapshot.no, 0.63);
    assert.equal(snapshot.side, 'yes');
    assert.equal(snapshot.note, 'My published forecast.');
    assert.equal(snapshot.capturedAt, displayed._meta.fetchedAt);
    assert.ok(url.startsWith('/receipt?token='));

    const page = await fetch(`${origin}${url}`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    const verified = await (await fetch(`${origin}/api/receipt?${new URL(url, origin).searchParams}`)).json();
    assert.equal(verified.verified, true);
    assert.deepEqual(verified.snapshot, snapshot);

    clock += 16_000;
    const live = await (await fetch(`${origin}/api/markets/${marketId}`)).json();
    assert.equal(live.secondaryYesPrice, '0.62');
    assert.equal(calls, 2);
    const again = await (await fetch(`${origin}/api/receipt?${new URL(url, origin).searchParams}`)).json();
    assert.equal(again.snapshot.yes, 0.37);

    const token = new URL(url, origin).searchParams.get('token');
    const altered = `${token[0] === 'A' ? 'B' : 'A'}${token.slice(1)}`;
    const invalid = await fetch(`${origin}/api/receipt?token=${altered}`);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, 'INVALID_RECEIPT');
  });
});

test('receipt creation requires valid input and a complete Panta quote', async () => {
  let calls = 0;
  await withServer({ apiKey: 'pk_test_private', fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ marketId, title: 'Incomplete market', phase: 'secondary',
      secondaryYesPrice: null, secondaryNoPrice: null }), { status: 200 });
  } }, async (origin) => {
    const create = (body) => fetch(`${origin}/api/receipts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await create({ marketId: 'invalid' })).status, 400);
    assert.equal((await create({ marketId, side: 'maybe' })).status, 400);
    assert.equal((await create({ marketId, side: 'no', note: 'x'.repeat(241) })).status, 400);
    assert.equal(calls, 0);
    const unavailable = await create({ marketId, side: 'no' });
    assert.equal(unavailable.status, 422);
    assert.equal((await unavailable.json()).code, 'MARKET_NOT_READY');
    assert.equal(calls, 1);
  });
});

test('does not issue a new forecast on a resolved market', async () => {
  await withServer({ apiKey: 'pk_test_private', fetchImpl: async () => new Response(JSON.stringify({
    marketId, title: 'Final result', phase: 'resolved', resolved: true, yesPrice: 1, noPrice: 0,
  }), { status: 200 }) }, async (origin) => {
    const response = await fetch(`${origin}/api/receipts`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketId, side: 'yes' }) });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, 'MARKET_NOT_OPEN');
  });
});
