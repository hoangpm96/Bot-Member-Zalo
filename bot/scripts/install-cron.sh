#!/usr/bin/env bash
set -euo pipefail

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$BOT_DIR/data"
MARKER_BEGIN="# BEGIN bot-member-zalo managed jobs"
MARKER_END="# END bot-member-zalo managed jobs"
NODE_BIN_DIR="$(dirname "$(command -v node)")"
NPM_BIN="$(command -v npm)"

mkdir -p "$LOG_DIR"

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
* * * * * cd "$BOT_DIR" && "$NPM_BIN" run telegram-poll >> "$LOG_DIR/telegram-poll.log" 2>&1

# Poll voter backup sync. Listener also runs this every 6h; this cron is idempotent fallback.
17 */6 * * * cd "$BOT_DIR" && "$NPM_BIN" run sync-votes >> "$LOG_DIR/sync-votes.log" 2>&1

# Monthly group warning. Sends only because DRY_RUN=0 and SEND_GROUP_WARNINGS=1 are set here.
0 9 25 * * cd "$BOT_DIR" && DRY_RUN=0 SEND_GROUP_WARNINGS=1 "$NPM_BIN" run cleanup-warn >> "$LOG_DIR/cleanup-warn.log" 2>&1

# Monthly cleanup plan. Sends Telegram approval; actual remove happens after approval via telegram-poll.
0 9 3 * * cd "$BOT_DIR" && DRY_RUN=0 "$NPM_BIN" run monthly-cleanup >> "$LOG_DIR/monthly-cleanup.log" 2>&1
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
