#!/usr/bin/env bash
set -euo pipefail

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$BOT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing .env. Create it first:"
  echo "  cp .env.example .env"
  echo "  nano .env"
  exit 1
fi

read_env() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  local value="${line#*=}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

require_env() {
  local key="$1"
  local value
  value="$(read_env "$key")"
  if [ -z "$value" ]; then
    echo "Missing required env: $key"
    return 1
  fi
}

failed=0
for key in GROUP_ID TARGET_MEMBER_COUNT SQLITE_DB_PATH SESSION_DIR TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID; do
  require_env "$key" || failed=1
done

if [ "$failed" -ne 0 ]; then
  echo
  echo "Complete .env before enabling scheduled jobs."
  exit 1
fi

warmup_days="$(read_env WARMUP_DAYS)"
if [ "${warmup_days:-30}" = "0" ]; then
  echo "Warning: WARMUP_DAYS=0. Good for testing, risky for production cleanup."
fi

dry_run="$(read_env DRY_RUN)"
if [ "${dry_run:-1}" != "1" ]; then
  echo "Warning: DRY_RUN=$dry_run in .env. Cron overrides cleanup jobs to DRY_RUN=0 when scheduled."
fi

self_listen="$(read_env ZALO_SELF_LISTEN)"
if [ -n "$self_listen" ] && [ "$self_listen" != "1" ] && [ "$self_listen" != "true" ]; then
  echo "Warning: ZALO_SELF_LISTEN=$self_listen. Self messages will not be archived/counted."
fi

echo "Env validation OK."
