# One-time portable setup

Run commands from this skill directory. The profile is stored outside the skill at `~/.config/lit-dl/profile.json` (or below `LIT_DL_CONFIG_DIR`). It is machine/user-specific and must not be distributed with the skill. `school.json` is a legacy file and is left untouched.

Use Python 3 and Node.js 22+. Install `requirements.txt` into an isolated Python environment for PDF text/page verification; set `LIT_DL_PYTHON` to that environment's Python if it is not this skill's `.venv`. The configuration command itself uses only Python's standard library. A missing PDF parser yields `unverified`, never a false success.

## Collect the minimum inputs

- Choose an existing Chrome, Edge, or Chromium session that the user is willing to make controllable. On Windows, `pwsh -File scripts/detect_browsers.ps1` reports installed, running, and CDP-ready status. On macOS/Linux, inspect the selected browser's existing `DevToolsActivePort` location or accept a user-provided path. Never create/modify a browser profile or start the user's browser without authorization.
- Ask for an absolute output directory. A task-specific `--out` can override it.
- Institution is optional. If present, record the user's exact institution name and, when available, the library/resource entry URL. Do not infer name, subscriptions, or entitlement from the URL. A school preset is a discovery hint only.
- Choose route order. With an institution, the CLI defaults to `institution,open_access`; without one, to `open_access`. The user can override this order.
- Ask whether a paid request service is enabled. Its account login is completed manually. Automatic requests require an explicit reward and point cap. The default is `none`.
- Choose `wait_for_user` or `skip_paper` for a new authentication challenge. The default is `wait_for_user`.

## Create and check the profile

Open-access-only example (replace the output path and browser as needed; use `python.cmd` on Windows if the system `python` alias is unavailable):

```text
python scripts/configure_profile.py init --browser chrome --output-dir <absolute-output-directory>
python scripts/configure_profile.py check
```

Institutional example (use the user's own values):

```text
python scripts/configure_profile.py init --browser edge --output-dir <absolute-output-directory> --institution-name <exact-institution-name> --resource-url <library-entry-url> --access-order institution,open_access
python scripts/configure_profile.py check
```

Optional fields include `--discovery-url` (Web of Science compatible topic search), `--cnki-url`, `--devtools-file`, `--control-url`, `--batch-size`, `--on-challenge`, and `--auth-hint`. `--fallback ablesci --auto-request --reward-points N --max-points-per-run M` is available only when the user has opted in and `M >= N`. If the user explicitly authorizes requests without a per-run cap, use `--unlimited-points` instead; this records `max_points_per_run: null`. The default is zero points. The profile stores preferences and entry points, never passwords or browser cookies. Use `--replace` to back up and replace an existing profile after review.

## Browser readiness and login

Read the selected browser and control URL from the profile. If a matching single control daemon is already healthy, reuse it. Otherwise, and only after the user has enabled CDP on their existing browser, start:

```text
node scripts/pdf_capture_daemon_target.mjs --browser <profile.browser.engine> --http-port <port-from-profile.browser.control_url> [--devtools-file <profile.browser.devtools_file>]
```

The daemon uses one CDP connection. The browser may ask the user to allow remote debugging. Open configured library and publisher login pages only when needed, and leave credentials, 2FA, and CAPTCHA to the user. Once this login round is complete, subsequent download batches reuse the same session. No skill can guarantee permanent unattended operation when a site requires fresh verification or denies access.

`scripts/download_doi_list_inline.mjs` and other helpers accept the configured control URL through `LIT_DL_CONTROL_URL` or their explicit `--proxy` / `--capture-server` option. For topic search, `batch_download.mjs --topic` needs a user-configured `access.discovery_url`; it no longer assumes a particular Web of Science portal. DOI/title input does not require that portal.

## Profile interpretation

`data/profile.schema.json` defines the nonsecret profile shape. The configuration command validates cross-field rules as well: an institution route requires an institution, and automatic paid requests require a provider, reward, and adequate cap. The legacy `school.json` remains readable by old code, but the new workflow uses `profile.json` when present. A malformed `profile.json` must be repaired rather than silently falling back to a different institution.
