# Changelog

## 0.2.3

- Fixed v0.2.2 discovery hanging at 0% while waiting for captured XHR/fetch response bodies.
- First-page product extraction/persistence now happens before optional network-probe settling, so the UI can report the first 10 products immediately.
- Network-probe `settle()` is bounded and can no longer wait indefinitely for long-lived responses.
- XHR/fetch request metadata is recorded immediately; body capture is restricted to likely catalog/JSON responses.
- Added a 1.2 s response-body read timeout and excluded `text/event-stream` responses.
- Added an 8 s overall budget and <=4 s request timeout for experimental network-feed replay.
- Developer diagnostics now report network record/body/pending counts after page 1.
- Retained the v0.2.2 verified browser-pagination fallbacks and database schema v2.

## 0.2.2

- Reworked Emerson pagination after v0.2.1 could still click an icon without advancing the product grid.
- Visible product range now derives the current page and is the primary pagination truth source.
- Added global Playwright exact-text target-page discovery across frames/open shadow DOM; paginator-specific markup is no longer required.
- Added real mouse/pointer click fallback after normal Playwright clicks for non-semantic page controls.
- Every paginator candidate is verified; controls that do not change range/page/SKU signature are rejected and the next candidate is tried.
- Added global href-based page navigation fallback for links whose page numbers are not exposed accessibly.
- Replaced single SVG-next guess with ranked, verified icon candidates.
- Added XHR/fetch capture during discovery and diagnostic reporting of requests triggered by pagination attempts.
- Added experimental API/feed replay fallback: likely product-feed requests can be replayed with common page/pageIndex/offset/skip/start parameters to discover products without DOM pagination.
- Added full-feed detection when an internal endpoint returns most/all products in one response.
- Corrected failure diagnostics so `1-10 of 560` reports page `1/56` rather than `unknown/56`.
- Added unit coverage for deriving page number from result ranges.
- No database migration; schema remains v2.

## 0.2.1

- Fixed Emerson series discovery stopping after the first 10 products on icon/non-semantic paginators.
- Added result-range parsing for labels such as `1 - 10 of 560 results for products`.
- Page advancement now succeeds when any of these change: result range, active page number, or product SKU signature.
- Added paginator-aware numeric page navigation before generic fallbacks.
- Added support for nested/non-semantic numeric page controls (`li`, `span`, `div`, custom clickable wrappers).
- Added SVG/icon-only next-arrow fallback for Emerson pagination controls.
- Added direct navigation through numeric page `href` values when available.
- Increased pagination settle/wait robustness for XHR-rendered product grids.
- Added detailed discovery failure diagnostics including current range, page count, and attempted navigation methods.
- Added optional per-page discovery diagnostics when Developer diagnostics is enabled.
- Added unit tests for Emerson result-range parsing and expected-page calculation.
- Added `npm run ensure:electron` and proxy-aware repair in the Windows run/build scripts for corporate environments.

## 0.2.0

- Added multi-series batch jobs.
- Added product image, document/datasheet and CAD-link extraction.
- Added product data-quality scoring and incomplete-product retry.
- Added previous-vs-current series comparison with product/specification/asset changes.
- Added cross-job Products browser with search and filters.
- Added product detail view and external asset opening.
- Added dynamic export field selector and persistent presets.
- Expanded Excel export to six worksheets.
- Added CSV and JSON exports.
- Added database schema v2 and v0.1 migration backup path.
- Added Emerson site adapter boundary.
- Added batch/history enhancements and new settings.
- Added parser asset tests and quality tests.

## 0.1.0

- Initial Electron + React + TypeScript desktop scraper.
- AVENTICS series analysis and product discovery.
- HTTP-first product scrape with Microsoft Edge / Playwright fallback.
- SQLite persistence, retry, pause/resume, cancellation and history.
- Excel export.
