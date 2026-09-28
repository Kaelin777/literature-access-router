---
name: literature-access-router
description: Obtain academic papers through a user's configured, authorized browser and access routes; set up a portable user profile on first use, then run DOI/title batches with PDF verification and optional configured fallback.
metadata:
  compatibility: Node.js 22+ and Python 3. Browser PDF capture requires an already-running Chromium-based browser with user-enabled CDP access. No institution, browser, output path, or paid fallback is assumed.
---

# Literature Access Router

Use this skill when the user wants a paper or a batch of PDFs. The skill is portable: institution, access order, browser, output directory, challenge behavior, and any paid fallback belong in the user's `~/.config/lit-dl/profile.json`, not in this file. Do not infer an institution or publisher entitlement from a domain or a school preset.

## First use: configure once

1. Check for `profile.json` with `scripts/configure_profile.py check` using the skill's Python environment (on Windows, `python.cmd`). A legacy `school.json` can remain for old scripts, but it is not proof of a correct portable profile. Never silently overwrite or migrate it.
2. If the profile is missing, ask together for only the unresolved setup facts: the existing browser to control; output directory; whether the user has institutional access and its exact institution name and resource entry if so; whether an optional fallback may submit requests or spend points; and what to do when a fresh login challenge appears. Institution may be absent. A library URL alone does not identify a school or prove its subscriptions.
3. Detect the already installed/running browser. On Windows use `scripts/detect_browsers.ps1`; on other systems inspect the selected browser and its `DevToolsActivePort`, or ask for its existing path. Do not install, launch, restart, modify, or enable remote debugging without user authorization. The user handles login, consent, 2FA, CAPTCHA, and publisher verification.
4. Create the profile with `scripts/configure_profile.py init`, then `check`. See [setup and profile fields](references/setup.md). Store no passwords, cookies, tokens, SSO screenshots, or browser profile copies. Configure fallback as `none` unless the user opts in and specifies a spending cap.
5. On the first live run, open the configured entry and relevant publisher login pages in the selected browser. Let the user complete the one-time login round. Reuse that browser's existing session afterward; ask again only for a new security challenge or a missing decision that genuinely blocks progress.

## Each download run

1. Identify each paper by DOI, exact title, PMID, arXiv ID, or publisher URL; resolve ambiguous metadata before downloading. Group by publisher when useful. Skip an existing PDF only after rechecking it.
2. Follow `access.order` from the profile, trying only routes that are available for this paper. An institution route uses the configured institution and publisher broker/CARSI/Shibboleth/OpenAthens or the configured library entry. A legitimate open-access route may use the publisher, repository, PMC, arXiv, or another authorized source. Do not use pirate mirrors or bypass paywalls, DRM, CAPTCHA, or institutional verification.
3. For browser capture, use one existing CDP control daemon per session. Check `/health` for `name: literature-access-router-control` before starting it. Do not start a second CDP proxy. Activate each article tab; follow its PDF link and capture in that same tab. Process at most `batch.size` papers per batch, sequentially with randomized delays. See [browser capture](references/literature-download-chrome-cdp.md).
4. If SSO, 2FA, CAPTCHA, or publisher verification appears, record `auth_required` or `challenge_waiting_user`. With `challenge.on_new=wait_for_user`, leave the tab open and ask the user to complete it. With `skip_paper`, stop the blocked route for that paper and continue other configured routes. Neither setting authorizes solving a challenge automatically.
5. A failed page load, HTTP error, or missing selector is not evidence of no entitlement. Distinguish a confirmed access denial from a temporary capture failure. Use publisher-specific reference steps only for the matching publisher. A final publisher capability verdict needs a browser-observed result, not an HTTP probe alone. If the active project requires InstSci CloakBrowser evidence, follow that project's `AGENTS.md` and [publisher workflow](references/publisher-pdf-workflow.md).
6. Verify the output before reporting success: file exists, begins `%PDF-`, has at least one page, and its first-page title or DOI matches the target. Record `unverified` if a PDF exists but the match is inconclusive; never count an HTML response or viewer as a downloaded PDF. Keep a per-paper manifest with DOI/title, source route, file path, result, evidence, and next action.
7. Use an optional fallback only when configured and appropriate. AbleSci request submission requires `fallback.provider=ablesci`, `auto_request=true`, a configured reward, an available logged-in session, and either sufficient remaining `max_points_per_run` or an explicit unlimited-points opt-in. Do not make an automatic paid request when any condition is missing. See [AbleSci workflow](references/ablesci-literature-request.md). Report downloaded, awaiting user, requested, unverified, and unavailable items separately.

## Operational boundaries

- The current request overrides saved preferences when the user gives a new direction. User-specific defaults never become universal skill rules.
- Browser login may expire or a new challenge may arise after setup. Continue independent papers when safe, preserve the blocked tab, and report the exact blocker.
- Do not close, kill, reset, or relaunch the user's browser; do not alter its profile or login state. Close only tabs created by this run after their work is complete, except tabs needed for user verification.
- No downloaded file is accepted on filename, URL, HTTP status, or PDF viewer appearance alone.
- Keep credentials and sensitive institution/session data out of logs, manifests, skill files, and commits.

## References

- [setup.md](references/setup.md): portable profile, one-time browser readiness, and configuration examples.
- [literature-download-chrome-cdp.md](references/literature-download-chrome-cdp.md): one-daemon PDF capture and publisher quirks.
- [publisher-pdf-workflow.md](references/publisher-pdf-workflow.md): optional InstSci evidence route when that project is active.
- [ablesci-literature-request.md](references/ablesci-literature-request.md): optional request, collection, and assist workflow.
- [chrome-profile-safety.md](references/chrome-profile-safety.md): browser state safety details.
