# Existing browser and profile safety

- Detect which supported browser is installed, running, and controllable before choosing it. Do not assume Chrome, Edge, an institution, a fixed profile location, or an existing login.
- Never close, kill, reset, or relaunch the user's browser without explicit authorization. Do not modify its user-data directory, `DevToolsActivePort`, Preferences, extensions, cookies, junctions, or login state.
- If CDP is unavailable, ask the user to open their browser and enable remote debugging. Wait for them; do not launch a different profile or bypass the requirement.
- Use one control daemon per session. Reuse it after its identity is verified. Do not start the web-access proxy beside it for the same browser session.
- The user completes SSO, 2FA, CAPTCHA, institutional login, publisher verification, and browser consent. Never automate bypass or ask for credentials in chat.
- Close only tabs created for this task after their work finishes. Keep any tab waiting for user verification open.
