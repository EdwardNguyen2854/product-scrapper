# Validation status — v0.2.6 source package

## Completed in this packaging environment

- Generic SKU normalization smoke tests cover `R480698477`, `0821000002`, `G617A40010A0006`, `SH03101LB16DS4`, and `G651A5S610A00FH`.
- Network/feed extraction regression tests cover mixed alphanumeric canonical product URLs and tagged `partNumber` JSON values.
- Product parser regression tests cover mixed alphanumeric SKU URLs and Part Number labels.
- Source inspection confirms first-page product-card identity is derived primarily from `aventics-sku-*` hrefs, not the legacy R/10-digit regex.
- Zero-product Developer diagnostics now report product-link and canonical-SKU-link counts plus sample hrefs.
- Excel AutoFilter regression: source now emits a header-row range (`A1:<last>1`) and skips zero-column sheets.
- Listing quality regression test added: zero detail specifications remain complete when discovery fields are present.
- Same-mode comparison baseline restriction verified by source inspection.
- Explicit mode/detail-transition logging verified by source inspection.
- `package.json` JSON parse: PASS.
- Node syntax check for `scripts/doctor.mjs` and `scripts/ensure-electron.mjs`: PASS.
- TypeScript/TSX syntax transpilation across source and tests: PASS (37 source/test files checked, excluding `.d.ts`).
- Product-range helper smoke checks for `1 - 10 of 560`, en-dash ranges, comma-formatted totals, and malformed ranges: PASS.
- v0.2.6 version labels updated in package metadata, navigation UI, schema message, doctor, README, and VERSION.
- Database schema remains version 2; v0.2.6 adds no migration.
- Static source inspection confirms first-page extraction occurs before `probe.settle()`.
- Static source inspection confirms `NetworkProbe.settle()` is timeout-bounded and response-body reads use a 1.2 s timeout.
- Static source inspection confirms network-feed replay has an 8 s overall budget and bounded per-request timeout.
- Static source inspection confirms Electron-vite v5 bundles `p-queue` via `build.externalizeDeps.exclude`.

The v0.2.6 change is concentrated in generic SKU discovery/parsing and zero-product diagnostics. The v0.2.5 export/mode fixes and v0.2.4 consent/pagination/queue fixes are retained. Static packaging checks cannot prove the Excel writer against the installed ExcelJS runtime or Emerson's live behavior; Windows integration testing is still required.

## Not possible in this Linux packaging environment

A full production validation requires Windows because the application intentionally launches the locally installed Microsoft Edge using Playwright. An attempted package-registry install in this environment timed out, so the final Electron/Vite build, full TypeScript semantic typecheck with installed dependencies, Vitest execution, native `better-sqlite3` rebuild, and live Emerson pagination run could not be completed here.

## Required Windows validation before team rollout

1. Extract the source to a normal local path.
2. Run `npm run doctor`.
3. Run `npm install --ignore-scripts=false`.
4. Run `npm run ensure:electron` (the batch scripts do this automatically).
5. Run `npm run typecheck` and `npm test`.
6. Run `npm run dev`.
7. Analyze the TM5 TaskMaster series and confirm total = 560.
8. Start discovery and confirm it advances beyond the first 10 products.
9. Confirm page/range progression reaches the final page (expected 56 pages at 10/page) and discovery reaches 560 unique SKUs before detail scraping begins.
10. Enable Developer diagnostics once and verify per-page discovery logs appear.
11. Run a **Full specifications** scrape and verify the log includes `Mode: FULL specifications`, `Starting detail scrape: 560 products`, then specifications plus image/document/CAD links. Also run **Listing only** once and confirm zero specifications do not make every product incomplete.
12. Export XLSX, CSV and JSON; confirm XLSX opens successfully and contains Products / Specifications / Assets / Changes / Errors / Metadata. Confirm the previous `undefined (reading 'row')` error is gone.
13. Interrupt an active job, restart the app and confirm it can resume.
14. Test a two-series batch.
15. If upgrading from v0.1, confirm the existing v0.2 migration path still preserves history.
16. Analyze `https://discreteautomation.emerson.com/product/aventics-617`; confirm mixed alphanumeric SKUs are discovered and a Full specifications run transitions into detail scraping rather than `No products were discovered`.
17. Run `build-installer.bat` and test the installer on a second Windows 10/11 x64 machine without Node/npm installed.

## v0.2.6 discovery regression focus

The discovery regression should remain successful for TM5, and v0.2.6 additionally succeeds on mixed-alphanumeric series such as 617. TM5 should not remain at 0% after `Discovering products...`: page 1 should be committed promptly, then discovery should reach 560 unique products through a detected network feed or verified browser pagination:

```text
Page 1/56     10 / 560
Page 2/56     20 / 560
...
Page 56/56   560 / 560
Discovery complete: 560 unique products
```

Browser page advancement is confirmed only by a changed result range, page number, or SKU signature. If discovery still stops, the thrown error includes the last range, derived page/expected pages, all locator/click strategies, and XHR/fetch requests observed during the final attempt. With Developer diagnostics enabled, successful transitions also report their selected method.

The included `tests/discovery.test.ts` covers product-range parsing and expected-page calculation. A live Emerson pagination test remains a Windows + Edge + network integration test rather than a deterministic unit test.


## v0.2.6 targeted runtime checks

On Windows, enable Developer diagnostics for the first TM5 and Series 617 runs. Series 617 should report a nonzero first discovery page (for example `G617...` SKUs) rather than returning zero products. Then run TM5 to confirm the existing 560/560 behavior.  If an Emerson/OneTrust banner appears, discovery should dismiss it without manual input. The expected transition is `discovery page 1: +10` followed by an automatic `pagination 1->2` and eventually `Discovery complete: 560 unique products`, then `Scraping 560 product detail pages ...` rather than `PQueue is not a constructor`.
