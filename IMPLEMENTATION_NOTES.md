# v0.2.2 Implementation Notes

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
