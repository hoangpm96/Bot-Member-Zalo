#!/usr/bin/env bash
set -euo pipefail

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$BOT_DIR/.." && pwd)"
WEB_DIR="$REPO_DIR/web"
cd "$BOT_DIR"

if [ ! -f "$BOT_DIR/.env" ]; then
  cp "$BOT_DIR/.env.example" "$BOT_DIR/.env"
  echo "Created bot/.env from .env.example."
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed or not in PATH."
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 is not installed. Installing globally..."
  npm install -g pm2
fi

npm install
npm rebuild better-sqlite3
npm run typecheck

if [ -d "$WEB_DIR" ]; then
  cd "$WEB_DIR"
  npm install
  npm rebuild better-sqlite3
  npm run typecheck
  npm run build
  cd "$BOT_DIR"
fi

pm2 startOrReload ecosystem.config.cjs
pm2 save

if "$BOT_DIR/scripts/validate-env.sh"; then
  npm run install-cron
  cron_status="installed"
else
  cron_status="not installed (complete bot/.env, then run setup-vps again)"
fi

echo
echo "VPS setup complete."
echo "Dashboard: http://<VPS-IP>:3000/login"
echo "Cron: $cron_status"
echo
echo "Next checks:"
echo "  pm2 status"
echo "  pm2 logs zalo-bot"
echo "  pm2 logs zalo-web"
echo "  crontab -l"
echo "  tail -f data/telegram-poll.log"
echo
echo "Important: run 'pm2 startup' once and execute the sudo command it prints,"
echo "so PM2 restores zalo-bot and zalo-web after VPS reboot."
