# Security Policy

## Sensitive data

Never commit or attach these files to an issue:

- `bot/.env`
- `bot/data/session.json`
- `bot/data/*.db`
- Telegram bot tokens
- Zalo cookies, IMEI or QR images

If a credential is exposed, revoke or rotate it before removing it from Git
history.

## Reporting a vulnerability

Please report security issues privately to the repository owner instead of
opening a public issue. Include the affected version, reproduction steps and
impact. Do not include live credentials or personal group data.
