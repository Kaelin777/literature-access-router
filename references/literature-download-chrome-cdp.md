# Browser PDF capture through one CDP daemon

This is the browser-backed route for a user's existing, authorized Chromium session. It is not tied to an institution or a particular browser brand.

## Session invariant

- Read `browser.engine`, `browser.control_url`, and optional `browser.devtools_file` from the user's profile. Reuse a running daemon only when its `/health` reports `name: literature-access-router-control`. Do not run a second CDP proxy or create a new WebSocket per paper.
- Do not launch, close, reset, or change the user's browser or profile. If CDP is unavailable, ask the user to enable it in their existing browser and wait. One daemon should serve browser control and PDF capture for the whole run.
- Activate the article target with `Target.activateTarget` (daemon `/activate`) so the user can see login and verification prompts. Navigate the same article tab to its article-provided PDF link and capture that target. Do not use a separate `about:blank` capture tab.
- Run sequentially in batches of at most the configured size (maximum 10). Use slow randomized delays, avoid repeatedly hammering failed pages, and skip previously verified files.

## Capture and verification

1. Open the DOI-resolved article page and inspect the actual rendered page for `View PDF`, `Download PDF`, or a publisher PDF link. Selectors and signed URLs can change; do not synthesize a privileged PDF URL from a guess.
2. On the article target, attach a single CDP session and enable response-stage `Fetch`. Navigate that target to its PDF link. Save only a genuine PDF response. Some viewer links return HTML first and redirect to a PDF response.
3. If `Fetch.getResponseBody` reports that headers have not been received, retry briefly a bounded number of times. If the viewer loaded but capture failed, classify it as a capture failure. A browser viewer is not a saved file.
4. Verify the saved file begins `%PDF-`, has a nonzero page count, and matches the requested DOI or first-page title. Record the exact source URL and file path without retaining signed tokens in shared logs.
5. If a login, CAPTCHA, Cloudflare, or publisher verification page appears, stop interacting with that challenge. Leave the tab open for the user or skip the blocked paper according to `challenge.on_new`.

## Publisher observations to recheck

- ScienceDirect has exposed signed article links containing `/pdfft` or `/pdf`; an intermediate response may be HTML before the real PDF. Only treat the final PDF bytes as success.
- Wiley `/doi/epdf/<DOI>` may be a viewer; an article-provided `/doi/pdfdirect/<DOI>?download=true` route has worked. Verify current page links and entitlement before using it.
- A publisher's `Buy article PDF` or explicit no-access page can indicate missing entitlement for that session. A network error or missing selector alone does not.

These observations guide inspection; none establishes that an arbitrary user or institution has access.
