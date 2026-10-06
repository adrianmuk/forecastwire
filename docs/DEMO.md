# ForecastWire technical demo video

Target length: 2–3 minutes. Record the actual deployed app and briefly show the relevant code or README. Do not record `.env`, the Render secret screen, or an API key. Choose an **open** Panta market with a real title and both spot prices before recording. If catalog discovery is awkward, paste a known market ID into search and press Enter.

## Shot list

| Time | Show | Explain |
| --- | --- | --- |
| 0:00–0:20 | Deployed home page and open market | This is live Panta data. Point out the source timestamp and YES/NO prices. |
| 0:20–0:55 | Choose YES or NO, add context, capture | The server validates the open market and records both Panta prices at its fetch time. |
| 0:55–1:25 | Receipt in a private browser window | The signed URL carries the original call; a new session verifies it without a database or login. |
| 1:25–1:50 | Captured and current prices | Show the movement on the chosen side. If unchanged, say the current quote is unchanged. If live prices are absent, show the retry message and move on. |
| 1:50–2:15 | Full market brief and one real trade link | Panta's market and trade endpoints supply the data. The explorer link points to the reported Solana transaction when one exists. |
| 2:15–2:40 | `server.mjs` endpoint or README architecture table | Show the server-side `X-Api-Key`, HMAC receipt check, and the honest limitation: ForecastWire signs the snapshot; it is not independent on-chain price history. |
| 2:40–2:55 | Public GitHub repo and live URL | Show run instructions, tests, and attribution. |

## What to verify before the final recording

- `/healthz` returns `{"ok":true}` and a real market loads through the deployed URL.
- Capture one receipt; reopen it in a private window and after a Render redeploy if possible. Preserve its original quote and timestamp.
- If no reported trade exists for that market, show the truthful empty state instead of inventing a transaction.
- Confirm the explorer cluster matches the transaction you show.
- Trim loading pauses in the recording without implying data arrived instantly; record an uninterrupted core interaction when possible.
