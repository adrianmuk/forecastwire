import { createServer } from 'node:http';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const marketPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const categoryPattern = /^[a-z0-9-]{1,40}$/;
const statuses = new Set(['primary', 'secondary', 'resolved', 'cancelled']);
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/embed', ['embed.html', 'text/html; charset=utf-8']],
  ['/embed-receipt', ['receipt-embed.html', 'text/html; charset=utf-8']],
  ['/receipt', ['receipt.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/embed.js', ['embed.js', 'text/javascript; charset=utf-8']],
  ['/receipt-embed.js', ['receipt-embed.js', 'text/javascript; charset=utf-8']],
  ['/receipt.js', ['receipt.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class PantaClient {
  constructor({ apiKey, baseUrl = 'https://live-api.panta.market/api/v1', fetchImpl = fetch, now = Date.now }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.cache = new Map();
    this.pending = new Map();
  }

  async get(resource, ttlMs = 20_000) {
    if (!this.apiKey) throw new ApiError(503, 'API_NOT_CONFIGURED', 'Panta API key is not configured on the server.');
    const cached = this.cache.get(resource);
    if (cached && this.now() - cached.fetchedAt < Math.min(ttlMs, cached.ttlMs ?? ttlMs)) return cached;
    if (this.pending.has(resource)) return this.pending.get(resource);

    const task = (async () => {
      let response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${resource}`, {
          headers: { 'X-Api-Key': this.apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(8_000),
        });
      } catch {
        throw new ApiError(502, 'PANTA_UNAVAILABLE', 'Panta did not respond. Please retry.');
      }
      let body;
      try {
        body = await response.json();
      } catch {
        throw new ApiError(502, 'PANTA_INVALID_RESPONSE', 'Panta returned an unreadable response.');
      }
      if (!response.ok) {
        const code = typeof body?.code === 'string' ? body.code : 'PANTA_ERROR';
        const message = response.status === 401 ? 'The server Panta API key was rejected.'
          : response.status === 429 ? 'Panta rate limit reached. Please retry shortly.'
          : response.status === 404 ? 'This market was not found in the Panta catalog.'
          : 'Panta could not complete this request.';
        throw new ApiError(response.status === 429 ? 429 : response.status === 404 ? 404 : 502, code, message);
      }
      // Market detail can briefly arrive without its metadata or spot prices.
      // Keep that response only long enough to coalesce simultaneous browser reads.
      const validSpot = (value) => value !== null && value !== undefined && value !== ''
        && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1;
      const phase = ['primary', 'secondary'].includes(body?.phase) ? body.phase : null;
      const yes = validSpot(body?.yesPrice) || (phase && validSpot(body?.[`${phase}YesPrice`]));
      const no = validSpot(body?.noPrice) || (phase && validSpot(body?.[`${phase}NoPrice`]));
      const incompleteMarket = /^\/markets\/[^/]+\/$/.test(resource)
        && (typeof body?.title !== 'string' || !body.title.trim() || !body?.phase || (phase && (!yes || !no)));
      const entry = { data: body, fetchedAt: this.now(), ttlMs: incompleteMarket ? 1_000 : ttlMs };
      this.cache.set(resource, entry);
      if (this.cache.size > 250) this.cache.delete(this.cache.keys().next().value);
      return entry;
    })();
    this.pending.set(resource, task);
    try { return await task; } finally { this.pending.delete(resource); }
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function limit(value, defaultValue, max) {
  if (value === null) return defaultValue;
  if (!/^\d+$/.test(value)) throw new ApiError(400, 'INVALID_LIMIT', 'Limit must be a positive integer.');
  return Math.min(Math.max(Number(value), 1), max);
}

function spotPrice(market, side) {
  const valid = (value) => value !== null && value !== undefined && value !== ''
    && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1;
  const direct = market?.[`${side}Price`];
  const phase = ['primary', 'secondary'].includes(market?.phase) ? market.phase : null;
  const specific = phase ? market?.[`${phase}${side[0].toUpperCase()}${side.slice(1)}Price`] : null;
  return valid(direct) ? Number(direct) : valid(specific) ? Number(specific) : null;
}

async function jsonBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    throw new ApiError(415, 'INVALID_CONTENT_TYPE', 'Send a JSON request body.');
  }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 4_096) throw new ApiError(413, 'BODY_TOO_LARGE', 'The receipt request is too large.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* Invalid JSON is reported below. */ }
  throw new ApiError(400, 'INVALID_BODY', 'Send a JSON object with a marketId.');
}

function receiptKey(apiKey, receiptSecret) {
  if (receiptSecret) return createHash('sha256').update(receiptSecret).digest();
  // Local receipts work with an existing Panta key. Set a separate secret on a
  // public deployment so rotating the Panta key does not invalidate old links.
  return apiKey ? createHash('sha256').update(`forecastwire-receipts-v1:${apiKey}`).digest() : null;
}

function signReceipt(snapshot, key) {
  if (!key) throw new ApiError(503, 'API_NOT_CONFIGURED', 'Receipt creation is not configured.');
  const payload = Buffer.from(JSON.stringify(snapshot)).toString('base64url');
  const signature = createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyReceipt(token, key) {
  if (!key) throw new ApiError(503, 'RECEIPTS_NOT_CONFIGURED', 'Receipt verification is not configured.');
  if (!token || token.length > 4_096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new ApiError(400, 'INVALID_RECEIPT', 'Invalid forecast receipt link.');
  }
  const [payload, signature] = token.split('.');
  const expected = createHmac('sha256', key).update(payload).digest('base64url');
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new ApiError(400, 'INVALID_RECEIPT', 'This forecast receipt has been altered or cannot be verified.');
  }
  try {
    const snapshot = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (snapshot.v === 1 && marketPattern.test(snapshot.marketId) && ['yes', 'no'].includes(snapshot.side)
      && typeof snapshot.title === 'string' && Number.isFinite(Date.parse(snapshot.capturedAt))
      && spotPrice({ yesPrice: snapshot.yes }, 'yes') !== null
      && spotPrice({ noPrice: snapshot.no }, 'no') !== null) return snapshot;
  } catch { /* Verified signature with invalid content is still rejected. */ }
  throw new ApiError(400, 'INVALID_RECEIPT', 'Invalid forecast receipt data.');
}

async function serveAsset(res, pathname) {
  const asset = assets.get(pathname);
  if (!asset) throw new ApiError(404, 'NOT_FOUND', 'Page not found.');
  const [filename, contentType] = asset;
  const content = await readFile(path.join(publicDir, filename));
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: https:; frame-ancestors *; base-uri 'none'; object-src 'none'",
  });
  res.end(content);
}

export function createApp({ apiKey = process.env.PANTA_API_KEY, receiptSecret = process.env.FORECASTWIRE_RECEIPT_SECRET, baseUrl = process.env.PANTA_API_BASE_URL, cluster = process.env.PANTA_SOLANA_CLUSTER || 'mainnet-beta', fetchImpl, now, usageLog = (event) => console.info(`forecastwire_usage event=${event}`) } = {}) {
  const client = new PantaClient({ apiKey, baseUrl, fetchImpl, now });
  const signingKey = receiptKey(apiKey, receiptSecret);
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const { pathname, searchParams } = url;
      if (pathname === '/api/receipts' && req.method === 'POST') {
        const input = await jsonBody(req);
        if (!marketPattern.test(input.marketId || '')) throw new ApiError(400, 'INVALID_MARKET', 'Select a valid market to capture.');
        if (!['yes', 'no'].includes(input.side)) throw new ApiError(400, 'INVALID_SIDE', 'Choose YES or NO for your forecast.');
        if (input.note !== undefined && typeof input.note !== 'string') throw new ApiError(400, 'INVALID_NOTE', 'The note must be text.');
        const note = (input.note || '').trim();
        if (note.length > 240) throw new ApiError(400, 'INVALID_NOTE', 'Keep the note under 240 characters.');
        if (!signingKey) throw new ApiError(503, 'API_NOT_CONFIGURED', 'Panta API key is not configured on the server.');
        // A recently fetched complete quote carries its original fetch time.
        // Reuse it for up to 15 seconds instead of failing when a fresh Panta
        // response briefly omits prices that the selected brief already had.
        const { data: market, fetchedAt } = await client.get(`/markets/${input.marketId}/`, 15_000);
        if (!market.phase) throw new ApiError(422, 'MARKET_NOT_READY', 'Panta has not returned the market status yet. Please retry shortly.');
        if (market.resolved || !['primary', 'secondary'].includes(market.phase)) {
          throw new ApiError(422, 'MARKET_NOT_OPEN', 'Choose an open Panta market to publish a forecast.');
        }
        const yes = spotPrice(market, 'yes'); const no = spotPrice(market, 'no');
        if (typeof market.title !== 'string' || !market.title.trim() || market.title.length > 300 || yes === null || no === null) {
          throw new ApiError(422, 'MARKET_NOT_READY', 'Panta has not returned a complete market title and spot prices yet. Please retry shortly.');
        }
        const snapshot = { v: 1, marketId: input.marketId, title: market.title.trim(), side: input.side, yes, no,
          phase: market.phase || 'unknown', cluster, capturedAt: new Date(fetchedAt).toISOString(), note };
        const token = signReceipt(snapshot, signingKey);
        usageLog('receipt_created');
        return sendJson(res, 201, { url: `/receipt?token=${token}`, snapshot });
      }
      if (req.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Only GET requests are supported here.');
      if (pathname === '/api/receipt') {
        const snapshot = verifyReceipt(searchParams.get('token'), signingKey);
        usageLog('receipt_verified');
        return sendJson(res, 200, { snapshot, verified: true });
      }
      if (pathname === '/healthz') {
        return sendJson(res, apiKey ? 200 : 503, { ok: Boolean(apiKey) });
      }
      if (pathname === '/api/health') {
        return sendJson(res, 200, { configured: Boolean(apiKey), cluster, product: 'ForecastWire' });
      }
      let resource;
      let ttl;
      if (pathname === '/api/categories') {
        resource = '/categories/'; ttl = 60_000;
      } else if (pathname === '/api/markets') {
        const query = new URLSearchParams();
        query.set('limit', String(limit(searchParams.get('limit'), 20, 50)));
        const category = searchParams.get('category');
        if (category) {
          if (!categoryPattern.test(category)) throw new ApiError(400, 'INVALID_CATEGORY', 'Invalid category.');
          query.set('category', category);
        }
        const status = searchParams.get('status');
        if (status) {
          if (!statuses.has(status)) throw new ApiError(400, 'INVALID_STATUS', 'Invalid market status.');
          query.set('status', status);
        }
        const cursor = searchParams.get('cursor');
        if (cursor) {
          // Panta cursors are opaque; they need not have the shape of a Solana address.
          if (cursor.length > 512 || /[\u0000-\u001f\u007f]/.test(cursor)) {
            throw new ApiError(400, 'INVALID_CURSOR', 'Invalid catalog cursor.');
          }
          query.set('cursor', cursor);
        }
        resource = `/markets/?${query}`; ttl = 30_000;
      } else if (pathname === '/api/positions') {
        const wallet = searchParams.get('wallet');
        if (!wallet || !marketPattern.test(wallet)) throw new ApiError(400, 'INVALID_WALLET', 'Enter a valid Solana wallet address.');
        resource = `/positions/?wallet=${wallet}`; ttl = 20_000;
      } else {
        const match = pathname.match(/^\/api\/markets\/([^/]+)(\/trades)?$/);
        if (match) {
          const marketId = match[1];
          if (!marketPattern.test(marketId)) throw new ApiError(400, 'INVALID_MARKET', 'Invalid Solana market address.');
          if (match[2]) {
            resource = `/markets/${marketId}/trades/?limit=${limit(searchParams.get('limit'), 40, 200)}`;
            ttl = 30_000;
          } else {
            resource = `/markets/${marketId}/`;
            ttl = 15_000;
          }
        }
      }
      if (resource) {
        const result = await client.get(resource, ttl);
        return sendJson(res, 200, { ...result.data, _meta: { source: 'Panta API', fetchedAt: new Date(result.fetchedAt).toISOString(), cluster } });
      }
      await serveAsset(res, pathname);
    } catch (error) {
      if (error instanceof ApiError) return sendJson(res, error.status, { code: error.code, message: error.message });
      console.error('Request failed:', error);
      sendJson(res, 500, { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be an integer between 1 and 65535.');
    process.exitCode = 1;
  } else {
    const server = createApp();
    server.on('error', (error) => {
      if (error.code === 'EACCES' || error.code === 'EADDRINUSE') {
        console.error(`Cannot listen on ${host}:${port} (${error.code}). Try a different PORT and, for local Windows use, HOST=127.0.0.1.`);
        process.exitCode = 1;
      } else {
        console.error('ForecastWire could not start:', error);
        process.exitCode = 1;
      }
    });
    server.listen(port, host, () => console.log(`ForecastWire listening at http://${host}:${port}`));
  }
}
