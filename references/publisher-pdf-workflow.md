# Publisher PDF evidence and optional InstSci route

For ordinary downloads, follow the configured browser route and verify the resulting PDF. If the active project explicitly requires InstSci's built-in CloakBrowser evidence for closed-access capability statements, read that project's `AGENTS.md` and InstSci's current publisher workflow before acting. Project-specific requirements apply to that project; they do not become defaults for every installation of this skill.

## Route selection

- Use the user's selected institution and actual library/publisher entry. A school name or preset is a hint, not proof that a publisher subscription exists.
- Publisher institutional login, Shibboleth, OpenAthens, CARSI, and institution-specific links may be available. Use WebVPN only when the institution has a configured gateway and the route actually works in the browser.
- The user completes credentials, QR/SMS/2FA, CAPTCHA, and publisher verification. Preserve the visible browser context while waiting.
- HTTP DOI resolution, publisher API results, cookies, and candidate URLs are preflight evidence. They are insufficient to claim that a publisher PDF can or cannot be downloaded in the current session.

## Evidence and reporting

After important browser actions, inspect the visible result before continuing. For each paper record: publisher, DOI, institution if any, route attempted, PDF path or exact blocker, and next action. Use `downloaded_verified` only after file and metadata checks. If a PDF exists but title/DOI verification is inconclusive, use `unverified`. If browser access is blocked by login, report `auth_required`; if explicitly denied, report `access_denied`; if capture fails after a viewer loads, report `capture_failed`. Do not turn one paper's result into a universal publisher capability claim.
