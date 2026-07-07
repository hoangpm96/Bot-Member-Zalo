#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/var/www/Bot-Member-Zalo"
CURRENT_DIR="/var/www/Bot-Member-Zalo-current"
RELEASES_DIR="/var/www/Bot-Member-Zalo-releases"
DATA_DIR="/var/lib/bot-member-zalo"
LOCAL_HEALTHCHECK_URL="http://127.0.0.1:5831/login"
KEEP_RELEASES="5"
BRANCH="${DEPLOY_BRANCH:-main}"
LOCK_FILE="/tmp/bot-member-zalo-deploy.lock"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another deploy is already running."
  exit 1
fi

timestamp="$(date +%Y%m%d-%H%M%S)"
release_dir=""
previous_current=""
switched_current=0

rollback() {
  local exit_code=$?
  if [ "$exit_code" -eq 0 ]; then
    return
  fi

  echo
  echo "Deploy failed with exit code $exit_code."
  if [ "$switched_current" -eq 1 ] && [ -n "$previous_current" ] && [ -d "$previous_current" ]; then
    echo "Rolling back current symlink to: $previous_current"
    ln -sfn "$previous_current" "$CURRENT_DIR"
    pm2 startOrReload "$CURRENT_DIR/bot/ecosystem.config.cjs" --update-env || true
    (cd "$CURRENT_DIR/bot" && npm run install-cron) || true
    pm2 save || true
  else
    echo "No previous release available for automatic rollback."
  fi
  exit "$exit_code"
}
trap rollback ERR

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_cmd git
require_cmd npm
require_cmd node
require_cmd pm2
require_cmd curl
require_cmd tar

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" != "20" ]; then
  echo "Node.js 20.x is required."
  echo "Current node: $(node -v) ($(command -v node))"
  exit 1
fi

mkdir -p "$RELEASES_DIR" "$DATA_DIR"

if [ ! -d "$APP_DIR/.git" ]; then
  echo "Missing git checkout at $APP_DIR"
  exit 1
fi
if [ ! -f "$APP_DIR/bot/.env" ]; then
  echo "Missing production env file: $APP_DIR/bot/.env"
  exit 1
fi

if [ -d "$APP_DIR/bot/data" ] &&
  [ ! -L "$APP_DIR/bot/data" ] &&
  [ -z "$(find "$DATA_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo "Migrating existing runtime data from $APP_DIR/bot/data to $DATA_DIR"
  cp -a "$APP_DIR/bot/data/." "$DATA_DIR/"
fi

if [ -L "$CURRENT_DIR" ] || [ -e "$CURRENT_DIR" ]; then
  previous_current="$(readlink -f "$CURRENT_DIR" || true)"
fi

echo "Updating source checkout: $APP_DIR ($BRANCH)"
cd "$APP_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

commit_sha="$(git rev-parse --short HEAD)"
release_dir="$RELEASES_DIR/${timestamp}-${commit_sha}"
echo "Creating release: $release_dir"
mkdir -p "$release_dir"
git archive --format=tar HEAD | tar -x -C "$release_dir"

ln -sfn "$APP_DIR/bot/.env" "$release_dir/bot/.env"
rm -rf "$release_dir/bot/data"
ln -sfn "$DATA_DIR" "$release_dir/bot/data"

backup_dir="$DATA_DIR/backups/deploy-${timestamp}-${commit_sha}"
mkdir -p "$backup_dir"
cp -a "$APP_DIR/bot/.env" "$backup_dir/.env" 2>/dev/null || true
if compgen -G "$DATA_DIR/*.db*" >/dev/null; then
  cp -a "$DATA_DIR"/*.db* "$backup_dir/" 2>/dev/null || true
fi
if [ -f "$DATA_DIR/session.json" ]; then
  cp -a "$DATA_DIR/session.json" "$backup_dir/session.json" 2>/dev/null || true
fi

echo "Installing and validating bot"
cd "$release_dir/bot"
npm ci
npm rebuild better-sqlite3
npm test
npm run typecheck
npm run build

echo "Installing and building web"
cd "$release_dir/web"
npm ci
npm rebuild better-sqlite3
npm run typecheck
npm run build

echo "Switching current release"
ln -sfn "$release_dir" "$CURRENT_DIR"
switched_current=1

echo "Reloading PM2"
# startOrReload chỉ *reload* app đã tồn tại (giữ nguyên cwd cũ → vẫn chạy release cũ),
# chỉ *start mới* khi app chưa có (đọc cwd mới từ ecosystem). Nên phải delete cả hai app
# trước, để chúng start lại và trỏ đúng vào $CURRENT_DIR của release vừa switch.
pm2 delete zalo-bot zalo-web >/dev/null 2>&1 || true
pm2 startOrReload "$CURRENT_DIR/bot/ecosystem.config.cjs" --update-env
pm2 save

echo "Installing cron jobs"
cd "$CURRENT_DIR/bot"
npm run install-cron

echo "Waiting for web health check: $LOCAL_HEALTHCHECK_URL"
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 5 "$LOCAL_HEALTHCHECK_URL" >/dev/null; then
    echo "Health check passed."
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "Health check failed after $attempt attempts."
    false
  fi
  sleep 2
done

echo "Cleaning old releases; keeping latest $KEEP_RELEASES"
mapfile -t releases < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -print | sort -r)
if [ "${#releases[@]}" -gt "$KEEP_RELEASES" ]; then
  for old_release in "${releases[@]:$KEEP_RELEASES}"; do
    if [ "$old_release" != "$(readlink -f "$CURRENT_DIR")" ]; then
      rm -rf "$old_release"
    fi
  done
fi

echo
echo "Deploy complete."
echo "Release: $release_dir"
echo "Commit: $commit_sha"
