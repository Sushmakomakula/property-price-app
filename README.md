# US Property Price Finder

See what homes and property sell for across the United States: typical home values for every state, county and ZIP code, actual median sale prices for 773 metro areas, current asking prices, and links to recently sold properties and land.

## What's in this folder

| Folder / file | What it is |
|---|---|
| `www/` | The app itself (a web page that also installs on phones and works offline). |
| `www/data/` | Price data as of October 2026 (Zillow Research and Realtor.com). |
| `android/` | The Android app, which wraps `www/`. |
| `assets/` | The app icon and splash screen used to make the Android icons. |
| `.github/workflows/` | Free GitHub automation that publishes the website and builds the Android app. |

## Getting it on your phone (free)

Once this folder is on GitHub (see below), GitHub does the work every time you save a change:

- **Website / iPhone:** GitHub Pages publishes it at `https://<your-username>.github.io/<repo-name>/`.
  - **iPhone:** open that link in Safari, tap **Share**, then **Add to Home Screen**.
  - **Android:** open it in Chrome, tap **⋮**, then **Install app** (or **Add to Home screen**).
- **Android app file (APK):** open the repository's **Releases** page on your phone, download `PriceFinder.apk`, and open it. Android asks you to allow installing apps from your browser the first time.

### One-time GitHub setup

1. Create a free account at github.com and a new **public** repository (Pages is free for public repos).
2. Upload this folder (or let Claude push it).
3. In the repository, go to **Settings → Pages** and set **Source** to **GitHub Actions**.

### App stores (optional, not free)

- **Google Play:** a one-time $25 developer fee.
- **Apple App Store:** $99 per year, and building the iPhone app needs a Mac with Xcode (`npx cap add ios`).

## Updating the price data

The data files are monthly snapshots. To refresh them, download the latest files from Zillow Research (`files.zillowstatic.com/research/public_csvs/...`) and Realtor.com (`econdata.s3-us-west-2.amazonaws.com/Reports/Core/...`), rebuild `www/data/*.json`, and change `VERSION` in `www/sw.js` so phones fetch the new data.

## Run it on a computer

```bash
npm run serve
```

Then open http://localhost:8080.

## Data sources and limits

- **Typical home value:** Zillow Home Value Index (homes in the middle third of prices).
- **Median sale price:** Zillow, metro areas only.
- **Asking price:** Realtor.com Residential Listings Database.
- Vacant land has no free price averages; the app links to land sold and land for sale instead.
- This is not an appraisal.

## Full records for any US address (PropertyLayer)

"Look up any property" → **Get full county record** shows that property's official county record from
[PropertyLayer](https://propertylayer.com): owner and mailing address, assessed/market/taxable values,
tax bills (and whether taxes are delinquent), every sale and transfer with price, buyer and seller,
bedrooms, bathrooms, square feet, year built, lot, zoning and flood zone.

1. Create a free PropertyLayer account (100 lookups a month, no credit card) and create an API key
   under **API Keys** in the dashboard.
2. In the app, open **Full records for any US address (PropertyLayer settings)**, paste the key and tap **Save**.
   The key is stored only on that device.

**Android app:** that's all. **Website:** PropertyLayer doesn't accept calls from other websites, so the
website needs a small free connector:

### PropertyLayer connector (website only, free)

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com) (no card needed for Workers).
2. **Workers & Pages → Create → Create Worker**, name it `propertylayer-connector`, **Deploy**.
3. **Edit code**, replace everything with the contents of `workers/propertylayer-proxy.js`, **Deploy**.
4. **Settings → Variables and Secrets → Add**: type **Secret**, name `PL_KEY`, value = your PropertyLayer key. Save.
5. Copy the worker's address (like `https://propertylayer-connector.yourname.workers.dev`) into the
   app's **Connector address** box and tap **Save**. You can then leave the key box empty on the website.

The connector only answers requests from `https://sushmakomakula.github.io`, so other sites can't use your lookups.
