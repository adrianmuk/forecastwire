# Deploy ForecastWire on Render

ForecastWire is a Node web service. Upload the **contents** of the `forecastwire` directory as the root of a GitHub repository, so `package.json`, `server.mjs`, and `render.yaml` are at the repository root. A static site cannot run the server-side Panta API calls or verify receipts.

## 1. Publish the code

Create a GitHub repository. Before pushing, check that `.env` is ignored and is not staged. On Windows PowerShell from `D:\forecastwire`:

```powershell
git init
git branch -M main
git add .
git status --short
git check-ignore .env
git ls-files .env
```

`git check-ignore .env` should print `.env`, and `git ls-files .env` should print nothing. If `.env` appears in `git status --short` or `git ls-files`, remove it from the index before making the repository public. Commit, add the GitHub remote shown by your new repository, and push. You can also use GitHub Desktop, but inspect the staged file list first.

Once the staged files are safe, replace the remote URL with the one GitHub gives you:

```powershell
git commit -m "ForecastWire MVP"
git remote add origin https://github.com/YOUR_USERNAME/forecastwire.git
git push -u origin main
```

## 2. Create the Render service

Use Render Dashboard **New → Blueprint** with this repository. The included `render.yaml` selects a Node web service on the Free plan, runs `npm start`, and checks `/healthz`. On initial creation, Render prompts for:

- `PANTA_API_KEY`: your existing private Panta key. It must work against `https://live-api.panta.market/api/v1`.
- `FORECASTWIRE_RECEIPT_SECRET`: a separate, long random value. Preserve it across future deployments; changing it invalidates old receipt links.

Generate a secret locally in PowerShell if needed:

```powershell
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 32
$rng.GetBytes($bytes)
$rng.Dispose()
[Convert]::ToBase64String($bytes)
```

Copy that output directly into Render's secret field. Keep it out of GitHub, screenshots, and Discord. The Blueprint sets `PANTA_SOLANA_CLUSTER=mainnet-beta`; change this in Render only if the markets and explorer links you verified are on Devnet. Do not set `HOST=127.0.0.1` on Render; the app defaults to `0.0.0.0` and uses Render's `PORT`.

Alternatively, create a Render **Web Service** from the GitHub repository with Language **Node**, Build Command `npm install --omit=dev`, Start Command `npm start`, health check path `/healthz`, and the same two private environment variables. Do not create a Static Site.

## 3. Verify the public URL before sharing it

1. Open `https://YOUR-SERVICE.onrender.com/healthz` and confirm `{"ok":true}`. `/api/health` should say `configured:true`. Neither endpoint checks that Panta accepted the key.
2. Browse an open market with a real title and both YES/NO prices. If the catalog is awkward, paste a known market ID in the search box and press Enter.
3. Select YES or NO, add an optional short note, and capture a receipt. Copy its URL and open it in a private window. Confirm the original timestamp and price survive that separate session, then confirm current prices appear. A lack of price movement is a valid outcome.
4. In the full brief, open a reported trade link, if one is available, and confirm the Solana explorer cluster matches the transaction. Try a phone-sized browser window.
5. Copy a receipt URL before a redeploy, then open it again after the redeploy to confirm the signing secret stayed the same.

If `PANTA_API_KEY` is missing, `/healthz` returns 503 and Render should flag the service. A 200 health check does not prove that the upstream key or market data work; verify step 2 with a real market. If price data is missing, the app shows a retry state and does not invent values.

## Demo reliability on the Free plan

Render's Free web services spin down after 15 minutes without inbound traffic and can take about a minute to wake on the next request. Open the app and wait for it to wake before recording the demo. The first judge visit may see Render's loading page; a paid service avoids that Free-plan behavior if you decide its cost is justified. Receipts survive restarts because their signed data is in the URL and the secret is stored as a Render environment variable. The local watchlist is browser-only.

After deployment, record the live URL, public GitHub URL, and a working receipt URL in [`SUBMISSION.md`](SUBMISSION.md). The user-facing Discord feedback request is in [`DISCORD.md`](DISCORD.md).
