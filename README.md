# ForecastWire

**Capture the quote. Revisit the signal.** ForecastWire lets anyone publish a YES/NO call on a Panta market with its source price and time, then lets others see how the market price changes. It is an MVP for the Colosseum Crypto World's Fair and Panta API Sidetrack.

**Live app:** https://forecastwire.onrender.com/  
**Public source:** https://github.com/adrianmuk/forecastwire

## The problem

When a prediction is shared in a chat or post, the market price quoted alongside it soon becomes stale. Others need to see what Panta reported at the time of the call and how that price has moved since.

Choose an open Panta market, make a YES or NO call, optionally add a short publishing note, and capture its YES/NO spot prices and server fetch timestamp in a signed, shareable forecast receipt. The receipt checks the current Panta prices when opened and shows how the chosen side's share price changed. The live brief also shows market context, reported trades linked to Solana explorers, a copyable summary, and an embeddable card. A local watchlist and a public Wallet Lens support further exploration.

## Panta and Solana integration

The server calls the official Panta API using a private `X-Api-Key` header:

| Feature | Panta endpoint |
| --- | --- |
| Browse and filter | `GET /categories/`, `GET /markets/` |
| Live brief, embedded card, captured receipt, current comparison | `GET /markets/{marketId}/` |
| Verify activity | `GET /markets/{marketId}/trades/` |
| Inspect public wallet holdings | `GET /positions/?wallet=` plus market detail |

Panta's market identifiers are Solana addresses and reported trade signatures link to a Solana explorer. Prices come from the market detail endpoint. Detail spot prices depend on Panta's availability. The brief and receipt use phase-specific prices if generic spot prices are absent, show an unavailable state when Panta supplies neither, and retry missing live prices. The server adds its fetch timestamp to each response and briefly caches reads. The browser never receives the API key.

The server signs each receipt with HMAC SHA-256. A reader's browser asks the same ForecastWire server to verify the signed snapshot before showing it. Editing the quote, market, note, or time in the link invalidates the signature. This proves the receipt was issued by that server; it is **not independent on-chain proof of a historical price**. The timestamp is when the server fetched the quote and can be up to 15 seconds before the user clicks Capture. No account or database is needed. Keep a stable private `FORECASTWIRE_RECEIPT_SECRET` on the deployed server: changing that secret invalidates existing receipts. For local testing only, the server derives a receipt signing key from `PANTA_API_KEY` when no separate secret is set, so rotating that API key also invalidates local links.

This MVP does not create markets, place orders, or request a wallet signature. It does not simulate live market data when the API is unavailable. Panta's documented market detail response reports resolved status but no winning side, so the receipt does not declare a winning forecast.

## Run locally

1. Install Node.js 20 or later.
2. Create a Panta account and test API key using the [official quickstart](https://docs.panta.market/quickstart). The test key prefix is `pk_test_` and is accepted on the public API.
3. Copy `.env.example` to `.env` and set `PANTA_API_KEY`. Keep this file private. For durable share links, also set a long random `FORECASTWIRE_RECEIPT_SECRET` and keep it unchanged. Node does not load `.env` by itself; use `node --env-file=.env server.mjs` or set environment variables in your shell.
4. Open <http://localhost:3000>.

```bash
cp .env.example .env
# Edit .env and set PANTA_API_KEY=pk_test_...
node --env-file=.env server.mjs
```

No package installation or database is required. `npm start` also works when environment variables are already set. `npm test` runs integration tests with mocked Panta responses.

### Windows: port 3000 is denied

Some Windows configurations reserve or block a port. If startup says `listen EACCES` for `0.0.0.0:3000`, try a different local port and bind only to loopback:

```powershell
$env:HOST = '127.0.0.1'
$env:PORT = '4173'
node --env-file=.env server.mjs
```

Then open <http://127.0.0.1:4173>. These two environment values affect only the current PowerShell session. If `4173` is also denied, inspect Windows' excluded TCP ranges with `netsh interface ipv4 show excludedportrange protocol=tcp` and choose a port outside them. There is no need to modify or delete the excluded ranges.

## Deploy

Deploy the directory as a Node web service. The included `render.yaml` configures a Render web service and prompts for the two private secrets; see [Render deployment instructions](docs/RENDER.md). The included `Dockerfile` is an alternative. Set `PANTA_API_KEY` and a stable, long random `FORECASTWIRE_RECEIPT_SECRET` on the server. Keep the same signing secret across instances and deployments. `PANTA_API_BASE_URL` defaults to `https://live-api.panta.market/api/v1`. Set `PANTA_SOLANA_CLUSTER=devnet` only if the Panta market signatures you are actually displaying are on Devnet; the default explorer links target Mainnet. Verify the deployed `/healthz` returns `{"ok":true}`, then capture and reopen a real receipt.

Do not put an API key in a frontend environment variable, commit `.env`, or include the key in a URL. The published app reads only Panta's public market information through the server.

## Demo flow

1. Browse Panta markets or paste a known market ID into search and press Enter. Open a real market and show its live YES/NO price and fetch time. The price loads independently of reported trades.
2. Make a YES or NO call, optionally add context, and select **Capture this price**. Copy the receipt URL into another browser session. Show the published call and captured quote beside the current Panta quote and the price change.
3. Show the market's reported trades and Solana explorer links from the live brief. Copy the embed code and show the live card.
4. If time permits, follow a market or inspect a public wallet with Panta positions.

The last step requires a wallet with positions. An empty wallet correctly shows an empty state. Do not use synthetic positions in a live demo.

## How valuation works

For an open position, the displayed estimate is `shares × current price of that side`. Resolved winners display approximately 1 USDC per share; resolved losers display zero. This is a read-only indication, not a trading quote or guaranteed settlement value. If a spot price is unavailable, the app says so.

## Technical notes

- `server.mjs` exposes allowlisted, validated market reads and a receipt creation/verification route; it forwards reads to Panta with a server-only key, times out requests after eight seconds, and returns structured errors. Receipt creation accepts only a valid market ID, a YES/NO call, and up to 240 characters of context, and requires title and both spot prices.
- Successful reads have short in-memory TTLs: 15 seconds for complete market detail, 1 second for incomplete market detail, 20 for positions, 30 for lists/trades, 60 for categories. Cache is per process and bounded to 250 entries.
- `public/app.js` renders values as text, stores followed markets only in browser local storage, and supports deep links to market briefs. The embed uses the same live detail endpoint. The brief does not wait for the separate trade activity request before displaying prices.
- State and text searches scan up to three catalog pages automatically (20 markets per page), stopping when they collect 20 matches or reach the bound. A category selection alone automatically loads up to three Panta category pages (up to 60 markets). Load more continues beyond that bound. Category is sent to Panta for every page, including when combined with search or state. Text search matches market title, description, and category; missing titles are requested from detail. The state dropdown checks detail because catalog phase labels can lag: `resolved` appears under Resolved even if an older catalog row says Secondary. This is bounded catalog browsing, not a guarantee of searching every Panta market. Phase checks can take a few seconds or stop if detail calls fail.
- When a catalog row has no title, the browser requests detail for the loaded page with at most five concurrent calls and caches up to 200 successful titles for a day in local storage. Incomplete details are retried with increasing delays; background rows stop after four attempts and show the short market ID. The selected active market keeps retrying missing prices at most once per minute; prices appear automatically if Panta later returns them. The app never fabricates a price from volume or trades. Refresh retries the catalog and selected market.
- No analytics, cookies, or wallet connection are used by this MVP. A public wallet address typed into Wallet Lens is sent to the app server and Panta to look up positions. A receipt note and captured market data are encoded in its URL; anyone with the link can read them. Do not put private information in the note.
- Attribution appears beside Panta-powered data and in every embed: **Powered by Panta**.

## Project status

The public MVP is live on Render. A real Panta market and signed receipt were checked in a separate private browser session and on a phone; the captured quote remained verifiable, and current prices loaded. Panta details can intermittently omit prices, so the receipt shows an unavailable state and retries. External user feedback, the presentation and demo videos, and the two hackathon submissions remain to be completed. See [submission preparation](docs/SUBMISSION.md), the [pitch script](docs/PITCH.md), and [demo shot list](docs/DEMO.md).

## Sources

- [Panta API documentation](https://docs.panta.market/)
- [Panta API Playground](https://github.com/Kaito-HQ/panta-api-playground)
- [Panta API Sidetrack](https://superteam.fun/earn/listing/panta-api-side-track)
- [Colosseum Crypto World's Fair](https://colosseum.com/worldsfair)

This is an independent hackathon project. Attribution identifies the source of market infrastructure, not an endorsement by Panta.

The application code is offered under the [MIT License](LICENSE). Panta's API and market data remain subject to Panta's own terms.
