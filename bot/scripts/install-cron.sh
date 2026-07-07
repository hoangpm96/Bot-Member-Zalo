#!/usr/bin/env bash
set -euo pipefail

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$BOT_DIR/data"
MARKER_BEGIN="# BEGIN bot-member-zalo managed jobs"
MARKER_END="# END bot-member-zalo managed jobs"
NODE_BIN_DIR="$(dirname "$(command -v node)")"
NODE_BIN="$(command -v node)"

mkdir -p "$LOG_DIR"

if [ ! -f "$BOT_DIR/dist/index.js" ]; then
  echo "Missing bot build output: $BOT_DIR/dist/index.js"
  echo "Run 'npm run build' before installing cron jobs."
  exit 1
fi
if [ ! -f "$BOT_DIR/dist/db/schema.sql" ]; then
  echo "Missing bot schema build output: $BOT_DIR/dist/db/schema.sql"
  echo "Run 'npm run build' before installing cron jobs."
  exit 1
fi

existing_cron="$(mktemp)"
new_cron="$(mktemp)"
managed_block="$(mktemp)"
trap 'rm -f "$existing_cron" "$new_cron" "$managed_block"' EXIT

crontab -l > "$existing_cron" 2>/dev/null || true

awk -v begin="$MARKER_BEGIN" -v end="$MARKER_END" '
  $0 == begin { skip = 1; next }
  $0 == end { skip = 0; next }
  skip != 1 { print }
' "$existing_cron" > "$new_cron"

cat > "$managed_block" <<EOF
$MARKER_BEGIN
SHELL=/bin/bash
PATH=$NODE_BIN_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
CRON_TZ=Asia/Ho_Chi_Minh

# Telegram approval/cancel/retry/timeout. Required for approve buttons to work.
* * * * * cd "$BOT_DIR" && "$NODE_BIN" "$BOT_DIR/dist/index.js" telegram-poll >> "$LOG_DIR/telegram-poll.log" 2>&1

# Bot health alert. Sends Telegram when heartbeat is stale and sends recovery once.
*/5 * * * * cd "$BOT_DIR" && "$NODE_BIN" "$BOT_DIR/dist/index.js" health-check >> "$LOG_DIR/health-check.log" 2>&1

# Poll voter backup sync. Listener also runs this every 6h; this cron is idempotent fallback.
17 */6 * * * cd "$BOT_DIR" && "$NODE_BIN" "$BOT_DIR/dist/index.js" sync-votes >> "$LOG_DIR/sync-votes.log" 2>&1

# Monthly group warning. Sends only because DRY_RUN=0 and SEND_GROUP_WARNINGS=1 are set here.
0 9 25 * * cd "$BOT_DIR" && DRY_RUN=0 SEND_GROUP_WARNINGS=1 "$NODE_BIN" "$BOT_DIR/dist/index.js" cleanup-warn >> "$LOG_DIR/cleanup-warn.log" 2>&1

# Monthly cleanup plan. Sends Telegram approval; actual remove happens after approval via telegram-poll.
0 9 3 * * cd "$BOT_DIR" && DRY_RUN=0 "$NODE_BIN" "$BOT_DIR/dist/index.js" monthly-cleanup >> "$LOG_DIR/monthly-cleanup.log" 2>&1
$MARKER_END
EOF

if [ "${1:-}" = "--print" ]; then
  cat "$managed_block"
  exit 0
fi

{
  cat "$new_cron"
  if [ -s "$new_cron" ] && [ "$(tail -c 1 "$new_cron" | wc -l | tr -d ' ')" = "0" ]; then
    printf '\n'
  fi
  cat "$managed_block"
} | crontab -

echo "Installed bot-member-zalo cron jobs for: $BOT_DIR"
echo
echo "Current managed jobs:"
cat "$managed_block"
