# AVENTICS Product Scraper v0.2.4

Windows desktop catalog-data tool for AVENTICS / Emerson product series. Paste one or more series URLs, scrape product specifications and asset links, validate data completeness, compare with previous runs, browse results, and export Excel / CSV / JSON.

## Highlights in v0.2.4

- **Cookie-gate hotfix:** Emerson/OneTrust cookie overlays are dismissed with delayed polling and verified before pagination.
- **Queue interop hotfix:** `p-queue` is now bundled into the Electron main/worker output instead of being externalized, so its CommonJS default export is normalized by Vite/Rollup before construction.

- **Non-blocking discovery hotfix:** first-page products are extracted and persisted before optional XHR/fetch diagnostics are allowed to settle.
- Network-probe settling is now time-bounded; a long-lived or streaming request cannot hold discovery at 0%.
- XHR/fetch metadata is recorded immediately while response-body capture is limited to likely catalog/JSON responses.
- Response-body reads have a hard timeout and ignore `text/event-stream` traffic.
- Experimental network-feed replay has an overall time budget and short per-request timeout so it remains an optimization, never a blocker.
- Developer diagnostics report probe record/body/pending counts after page 1.
- Existing v0.2.2 verified paginator logic is retained after the non-blocking network probe.

- **Pagination hotfix v2:** the visible result range is the source of truth for the active page (`1-10` = page 1, `11-20` = page 2).
- Product discovery now tries Playwright's global exact-text locator for the target page number across the main page, open shadow DOM, and frames; it no longer requires Emerson's paginator to use normal link/button markup.
- Candidate controls are clicked using normal Playwright input first and a real pointer click as fallback, and every click is rejected unless the result range, page number, or SKU signature actually changes.
- Pagination can replay a detected XHR/fetch product-feed request by mutating common page/offset parameters, allowing discovery to bypass the DOM paginator when Emerson exposes a suitable internal feed.
- Hidden/URL-based page links and multiple scored SVG controls are tried before discovery fails; the first icon is no longer assumed to be the next button.
- Developer diagnostics now report the exact strategy used and any XHR/fetch requests observed during the failed/successful page transition.

- Multi-series batch input and sequential batch execution.
- Product image, document/datasheet, and CAD-link extraction.
- Data-quality evaluation: `complete`, `incomplete`, `failed`, `not_evaluated`.
- Historical comparison by SKU: added, removed, changed, unchanged.
- Specification and asset-level change records.
- Products browser with search, series/quality/change filters and asset filters.
- Product detail panel for specifications, assets and quality notes.
- Export field selector and reusable export presets.
- Excel workbook with `Products`, `Specifications`, `Assets`, `Changes`, `Errors`, `Metadata`.
- CSV folder export and normalized JSON export.
- Automatic v0.1 database upgrade with best-effort pre-migration backup.
- Emerson-specific behavior isolated behind an adapter boundary.

## Core architecture

```text
Electron Renderer (React + TypeScript)
        │
     preload
        │
  typed IPC + Zod
        │
Electron Main
        │
Node child-process scraper
        │
  Emerson adapter
   ├─ series discovery (Playwright + installed Edge)
   ├─ HTTP-first detail scrape
   ├─ browser fallback
   ├─ parser + asset extraction
   ├─ quality engine
   ├─ comparison engine
   └─ SQLite persistence
        │
   Export engine
   ├─ ExcelJS
   ├─ CSV
   └─ JSON
```

The Electron renderer has no direct filesystem, database, or scraper access. Scraping runs in a separate Node child process so browser/network failures do not freeze the UI.

## Development prerequisites

- Windows 10/11 x64.
- Microsoft Edge installed.
- Node.js 22.12+ (or a newer supported release), plus npm.
- Network access to `discreteautomation.emerson.com`.

No Python is required.

## Run from source

```powershell
npm run doctor
npm install
npm run ensure:electron
npm run dev
```

Or double-click `run-dev.bat`.

## Build installer

```powershell
npm install
npm run dist
```

Or double-click `build-installer.bat`.

The NSIS installer is written to `release/`. A portable build can be created with:

```powershell
npm run dist:portable
```

## Main workflow

1. Add one or more Emerson AVENTICS series URLs.
2. Analyze the URLs to detect series names and expected product counts.
3. Start a single scrape or batch.
4. Discovery stores every SKU before detailed scraping begins.
5. Detail pages are fetched over HTTP first; Playwright/Edge is used as fallback.
6. Parsed specifications and selected asset links are saved immediately to SQLite.
7. Quality validation runs per product.
8. If enabled, the completed job is compared with the most recent earlier completed job for the same normalized series URL.
9. Review data in **Products** or export it.

## Scrape settings

Defaults:

- HTTP concurrency: 6
- Retries: 3
- Request timeout: 30 s
- Browser: installed Microsoft Edge, headless
- Extract image links: on
- Extract document links: on
- Extract CAD links: on
- Quality validation: on
- Auto-compare: on

The app intentionally does not attempt to bypass authentication, CAPTCHA, access controls, or rate limits. HTTP 429 responses use longer retry delays.

## Database and migration

The application uses a per-user SQLite database under Electron's `userData` directory. v0.2.4 continues to use schema version 2; no database migration is required from v0.2.0. When an existing v0.1 database is detected, the app attempts to checkpoint and copy a backup before adding the v0.2 tables/columns.

Existing v0.1 jobs remain visible. Old jobs naturally show `not_evaluated` quality and `not_compared` change state until they are re-scraped.

## Comparison rules

- SKU is the primary product identity.
- Added/removed products are determined from the discovered SKU inventories, not successful detail-scrape counts.
- A failed current detail scrape is **not** treated as a removed product.
- Field comparisons normalize whitespace only; v0.2.4 does not perform semantic unit conversion.
- Assets are compared by type/category/title and URL.

## Exports

### Excel

Creates:

- `Products` — wide human-readable table using the selected export fields.
- `Specifications` — long-form SKU / specification / value table.
- `Assets` — image/document/CAD links.
- `Changes` — product, field and asset deltas.
- `Errors` — scrape failures and non-info quality issues.
- `Metadata` — source, counts, settings, comparison summary, versions.

### CSV

Creates a folder containing:

- `products.csv`
- `specifications.csv`
- `assets.csv`
- `changes.csv`

### JSON

Creates a normalized hierarchical export containing job metadata, comparison data, products, quality results, specifications and assets.

## Project structure

```text
src/
├─ main/                 Electron main process and worker bridge
├─ preload/              restricted renderer API
├─ renderer/             React UI
├─ scraper/
│  ├─ adapters/emerson/  Emerson site adapter boundary
│  ├─ comparison/        job/product/spec/asset diff
│  ├─ export/            CSV and JSON exporters
│  ├─ quality/           data completeness evaluation
│  ├─ browser.ts
│  ├─ discovery.ts
│  ├─ parser.ts
│  ├─ scrape.ts
│  ├─ db.ts
│  ├─ excel.ts
│  └─ worker.ts
└─ shared/               shared TypeScript contracts and schemas
```

## Corporate proxy / Electron binary download

Electron's npm package downloads its Windows runtime separately. If installation succeeds but `node_modules\electron\path.txt` is missing, and your environment uses `HTTP_PROXY` / `HTTPS_PROXY`, enable proxy support for Electron's downloader before reinstalling:

```powershell
$env:ELECTRON_GET_USE_PROXY="1"
node .\node_modules\electron\install.js
npx electron --version
```

To persist this for the current Windows user:

```powershell
[Environment]::SetEnvironmentVariable("ELECTRON_GET_USE_PROXY", "1", "User")
```

The included `npm run ensure:electron` helper checks `node_modules\electron\path.txt` and reruns the Electron installer. If proxy environment variables are present, it automatically enables `ELECTRON_GET_USE_PROXY=1` for that repair. `run-dev.bat`, `build-installer.bat`, and `build-portable.bat` call this helper automatically.

Avoid `npm audit fix --force` during normal setup because it may introduce breaking major-version changes. Audit upgrades should be reviewed and tested deliberately.

## Known limitations

- Emerson can change its DOM, pagination, or download-link structure at any time.
- v0.2.4 extracts CAD links but does not bulk-download CAD files.
- It does not schedule background runs or monitor catalog changes automatically.
- Batch series are processed sequentially; product requests inside each series are concurrent.
- Asset detection is intentionally conservative and may require parser updates for newly introduced Emerson components.

See `VALIDATION.md` and `IMPLEMENTATION_NOTES.md` before distributing the first installer internally.
