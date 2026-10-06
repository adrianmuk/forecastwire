# ForecastWire submission pack

The [Panta API Sidetrack](https://superteam.fun/earn/listing/panta-api-side-track) requires a working demonstration, a clear use case and Panta explanation, and submissions to **both** the official Colosseum Crypto World's Fair hackathon and Superteam Earn. The [Colosseum portal FAQ](https://colosseum.com/hackathon?year=fall2026) also asks for team background, location, a product logo or graphic, a GitHub repository, a 2–3 minute presentation video, a product demo of no more than three minutes, and a go-to-market plan. The official rules set the deadline at **October 12, 2026, 11:59 p.m. Pacific Time**. Verify the exact fields inside your signed-in portals before final submission.

## Copy for the official Colosseum submission

**Project name:** ForecastWire

**Tagline:** Capture the quote. Revisit the signal.

**Short description:** ForecastWire lets anyone publish a YES/NO call on an open Panta prediction market with the quoted prices and server fetch time. A signed, shareable receipt later compares the captured quote with the current market price.

**Problem:** People share predictions in chats and posts alongside a market price. That price soon changes, and a screenshot or plain market link cannot show both what was quoted when the call was made and what the same market says now.

**Product:** Select an open Panta market, choose YES or NO, optionally add up to 240 characters of context, and capture a signed receipt. Anyone with the link can verify the ForecastWire signature and see the original price/time next to the current Panta quote. The live brief offers market details, reported trades linked to Solana explorers, a watchlist stored in the user's browser, and an embed. A public wallet lens reads Panta positions.

**Why Panta:** Panta supplies the market catalog, market details, spot share prices, reported trades, and wallet positions through its API. ForecastWire uses market detail to record a time-stamped quote and to refresh the comparison when the receipt is opened. The Panta key is server-side. The product depends on live market data for its core user value.

**Why Solana:** Panta market IDs and reported trade signatures provide a path from a brief to the underlying Solana market and transactions. ForecastWire does not deploy a Solana program or execute trades. Its HMAC signature attests that the ForecastWire server issued a snapshot; it is not independent on-chain proof of historical price or a guarantee about the winning outcome.

**Who and distribution:** The first users are people who already make public YES/NO calls in crypto or event communities. A receipt can travel in the same chat or post as the prediction. The initial test is to share a working URL in relevant Panta and Colosseum community feedback channels and measure whether people can create and revisit a receipt without help. [Replace with actual usage and feedback, if any.] The longer-term hypothesis is a public history of calls and reusable community embeds; this is not yet validated.

**Business hypothesis:** Free receipts can establish the workflow. If repeat users find value, possible paid tools include organization workspaces, branded embeds, and analytics for communities. Pricing, customers, and demand have not been validated. Describe this as a hypothesis, not current revenue.

**Team and founder-market fit:** [Your verified name, location, relevant background, role, and why this problem interests you. Include every teammate and their actual contribution.]

**Development history:** [Record work completed within the September 14–October 12 hackathon period; disclose any earlier ForecastWire or reused project code accurately. Mention AI coding assistance if the portal asks about tools or development process.]

**Stage and validation:** Public MVP deployed on Render. On October 6, a signed receipt from a real Panta market was opened in a separate private browser session and on a phone. The original quote verified and current prices appeared. Current prices can be temporarily unavailable while Panta market detail is incomplete; the app retries. No external user feedback or usage is claimed yet.

**Live URL:** https://forecastwire.onrender.com/

**Public source repository:** https://github.com/adrianmuk/forecastwire

**Product graphic:** `assets/forecastwire-card.png`; square logo: `assets/forecastwire-logo.png` (use whichever the portal asks for)

**Presentation video:** [Video URL after recording; see PITCH.md]

**Product demo video:** [Video URL after recording; see DEMO.md]

## Copy for the Panta Sidetrack

**What we built:** ForecastWire turns Panta market prices into shareable prediction receipts. A user makes a YES/NO call on an open market, captures Panta's quoted YES/NO share prices with the server fetch time, and receives a signed link. Anyone opening it later can compare that original quote with current Panta market data.

**Problem:** Public predictions lose their price context as markets move. ForecastWire makes it easy to revisit the quoted price, the current quote, and the original market question from one link.

**Panta API integration:** The server authenticates with Panta using `X-Api-Key` and reads categories, catalog markets, market detail, recent trades, and public positions. The receipt uses a validated open market's detail response and later fetches detail again for the live comparison. Reported trade signatures link to Solana explorers. A missing price remains visibly unavailable and is retried; no synthetic quote is substituted. The receipt signature is issued by ForecastWire, not Panta or a Solana program.

**Product and potential:** Start with individual public calls and short links in community discussions. The next product test is whether repeat posters want an embeddable history or community workspace. [Add observed usage or feedback only after it occurs.]

**Working demo:** https://forecastwire.onrender.com/

**Official Colosseum submission:** [Project URL after submitting there]

**Public code:** https://github.com/adrianmuk/forecastwire

**Demo video:** [Video URL]

## Final sequence

- [ ] Register for and join the Crypto World's Fair in Colosseum. Add any teammates before submitting.
- [x] Publish the application files at the root of a public GitHub repository. Before final submission, review the repository for accidental secrets and the included MIT `LICENSE`.
- [x] Deploy the Node web service on Render and configure its private Panta key and receipt signing secret. Keep the signing secret stable across redeployments.
- [ ] Finish the public smoke check: `/healthz`, open market and both prices, capture, receipt in a private window and on a phone were observed; verify an explorer link where a real trade is available and reopen an earlier receipt after a redeploy.
- [ ] Upload a real logo/graphic, record the [pitch](PITCH.md) and [technical demo](DEMO.md), and confirm both URLs are publicly accessible.
- [ ] Share the live app using the [feedback draft](DISCORD.md). Record only feedback and usage that actually occurred; zero external traction is permissible.
- [ ] Fill the remaining placeholders above with verified URLs, team background, development history, and actual results.
- [ ] Complete the official Colosseum submission before the deadline, copy its project URL, then separately submit to the Panta Sidetrack on Superteam Earn.

Do not claim a winning side after resolution based solely on market detail: the documented response used by this MVP reports status without a reliable winner field. Do not call a ForecastWire signature independent on-chain evidence.
