# v0.2.5 Implementation Notes


## v0.2.5 export + mode semantics hotfix

The 560/560 TM5 run showed that discovery, cookie handling, and pagination were working, but a listing-only run was being graded with full-detail quality rules and Excel export crashed while applying AutoFilter. v0.2.5 fixes both downstream problems.

- Excel export applies AutoFilter only when columns exist and uses `A1:<last-column>1`.
- `evaluateProductQuality()` now accepts scrape mode; listing mode does not require specifications, description, or assets.
- Automatic comparison baselines must use the same scrape mode. Listing comparison is inventory-only; full mode keeps specification/asset diffs.
- Worker logs state the selected mode and explicitly announce the start of detail scraping in full mode.
- Listing-only retry/resume re-runs discovery and listing validation; it cannot accidentally transition into full detail scraping.


## v0.2.4 cookie + queue runtime hotfix

The TM5 run proved that product discovery itself is now correct: after the cookie prompt was manually closed and page 2 was selected, the scraper automatically traversed pages 2–56 and discovered all 560 unique products. The job then failed at the transition to detail scraping with `PQueue is not a constructor`.

v0.2.4 fixes both blockers without changing the database schema:

1. `gotoStable()` now polls for delayed cookie/consent UI, supports OneTrust close/accept controls and common consent wording, uses guarded force-click fallback, and verifies the known OneTrust overlay is hidden.
2. `electron.vite.config.ts` excludes `p-queue` from dependency externalization, which lets Vite/Rollup normalize the CommonJS default export used by `new PQueue(...)`.
3. Worker and browser-fallback queues keep the existing `PQueue` API; only bundling/externalization behavior changes.
4. The change is build-level and leaves queue behavior/concurrency semantics unchanged.

The verified v0.2.3 pagination and non-blocking network-probe behavior are retained.

## v0.2.3 non-blocking network-probe hotfix

The observed v0.2.2 failure was different from the earlier paginator issue: after logging `Discovering products...`, TM5 stayed at 0% with no error. The cause was `NetworkProbe.settle()` waiting for every pending XHR/fetch body before the first product page was extracted. A long-lived or delayed response could therefore block the critical path indefinitely.

v0.2.3 changes the ordering and timeout rules:

1. Load the series page.
2. Extract the first visible product page immediately.
3. Persist/emit those products so the renderer can show `10 / 560`.
4. Give likely product-feed bodies only a bounded 1.2 s settle window.
5. Attempt network-feed replay within an 8 s total budget.
6. Fall back to the verified browser paginator regardless of unfinished diagnostic traffic.

Request metadata is stored as soon as a response event arrives. Body reads are only attempted for likely catalog/JSON responses, are capped at 1.5 MB, time out after 1.2 s, and ignore `text/event-stream`. Network/API discovery is explicitly an optimization and diagnostic aid; it cannot block normal DOM discovery.

## v0.2.2 pagination hotfix

v0.2.1 improved range detection but still assumed that a paginator could be recognized structurally. The observed TM5 failure was: the page exposed `1-10 of 560`, no numeric control was found by the structural selectors, an SVG-like element was clicked, and the grid remained on page 1. v0.2.2 treats that as a rejected candidate rather than a successful click.

The new page-advance order is:

1. Read the visible product range and derive the current page directly from it.
2. Try conventional accessible Next controls.
3. Search globally for the exact target page text using Playwright locators, including frames and open shadow roots.
4. Rank those candidates using nearby pagination signals, but do not require a pagination class/role.
5. Use Playwright click, then a real pointer click at the candidate's bounding box if needed.
6. Search global page-like hrefs for the desired page.
7. Rank multiple SVG controls and verify each one instead of accepting the first icon.
8. Observe XHR/fetch traffic during each transition and include it in diagnostics.
9. Before browser clicking, attempt to identify a product-feed XHR/fetch response from page 1 and replay it by mutating common page/offset parameters. If replay works, discovery can collect pages directly without manipulating the DOM.

A page transition is successful only when at least one independent signal changes: the visible result range, derived/selected page, or leading SKU signature. A click that fires but leaves all three unchanged is explicitly rejected.

## Network feed replay

The feed replay is intentionally conservative and opportunistic. It only considers XHR/fetch responses that look product-heavy, reuses the browser context's session/cookies, mutates common pagination keys (`page`, `pageNumber`, `pageIndex`, `offset`, `skip`, `start`, etc.), and verifies that the response yields new AVENTICS SKU seeds. If this heuristic cannot prove a useful next page, discovery falls back to normal browser pagination. It does not bypass authentication, CAPTCHA, or other access controls.

## Design boundary

v0.2 keeps the v0.1 process model: renderer → restricted preload → Electron main → isolated Node scraper worker. Site-specific behavior is now routed through `src/scraper/adapters/emerson/` so future providers can be added without coupling them to UI state.

## Scraping strategy

Detailed pages remain HTTP-first because rendering hundreds of product pages is expensive. The worker starts Edge once to establish a modern browser context/cookies and uses browser rendering only when direct HTML parsing fails. Series discovery remains browser-driven because Emerson's internal catalog APIs are not treated as stable public contracts.

## Asset extraction

`parser.ts` collects a conservative set of product assets from OpenGraph metadata, product-related images, downloadable anchors and structured JSON-LD. Links are classified as image, document or CAD and then filtered according to job settings before persistence.

v0.2 stores links only. Bulk download of CAD/PDF assets is intentionally deferred.

## Data quality

Quality is a scraper-completeness signal, not a statement that Emerson's engineering data is correct. Missing identity/specification data can make a result incomplete or failed; missing optional assets are informational.

## Historical comparison

Comparison uses SKU inventories. Removed SKUs are calculated from discovery sets so detail-page failures do not generate false removals. Matching successful products are compared field-by-field after whitespace normalization. Asset links are also diffed.

## Batch behavior

A batch owns multiple ordinary jobs. Series jobs execute sequentially by default while each job retains configurable product-level concurrency. This keeps database/job semantics simple and reduces site load.

## Database migration

Schema version is stored in SQLite `user_version`. Existing v0.1 databases have version 0; before upgrading, the app best-effort checkpoints WAL and copies the DB to a timestamped `v0.1-backup` file. New v0.2 columns are added conditionally using `PRAGMA table_info`.

## Export presets

Built-in presets are inserted with stable IDs. User presets are stored in SQLite. The `Products` sheet respects selected fields; the supporting Excel sheets intentionally retain complete normalized data for auditability.

## Security

- `nodeIntegration` is disabled.
- `contextIsolation` is enabled.
- Renderer operations go through explicit IPC.
- External links are restricted to HTTP/HTTPS.
- The scraper does not bypass authentication, CAPTCHA or access restrictions.
