# Safe Seller Keep-Alive (G2G & U7BUY) — Edge/Chrome Extension (v1.3.0)

A lightweight Manifest V3 browser extension for Microsoft Edge and Google Chrome that keeps G2G and U7BUY seller accounts active in the background at randomized intervals without stealing window focus or triggering Cloudflare challenges.

## Features

- **100% Background & Silent:** Reuses a single existing tab per marketplace (`g2g.com` and `u7buy.com`) without popping up windows or stealing focus.
- **Randomized Interval (`600s–1000s` Default):** Schedules refreshes at randomized 10 to ~16.5 minute intervals using `chrome.alarms` (minimum safety floor of `60s`).
- **Auto-Recovery After PC Shutdown/Restart:** Automatically detects if a scheduled timer expired while the laptop was turned off and immediately starts a fresh countdown upon browser resume.
- **Laptop No-Sleep (`chrome.power`):** Prevents Windows S0 Modern Standby from locking or sleeping the laptop while running (`display` wake lock + 24s heartbeat).
- **Cloudflare & Logout Auto-Pause Protection:** Checks tab titles and URLs before every refresh. Automatically pauses and alerts you if a Cloudflare challenge or login redirect is detected.
- **Auto-Stop Sleep Safeguard:** Configurable max runtime hours (default `8h`) so the refresher automatically stops after your work session.

## Installation (Microsoft Edge / Chrome)

1. Open `edge://extensions` (or `chrome://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `edge-extension` folder.
4. Pin **Safe Seller Keep-Alive** to your browser toolbar.
