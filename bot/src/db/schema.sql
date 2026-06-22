-- Schema Bot-Member-Zalo (Milestone 1). Toàn bộ idempotent (CREATE IF NOT EXISTS).
-- Chạy qua db.exec() mỗi lần khởi động. Timestamp = epoch milliseconds (INTEGER).

-- Thành viên group. zalo_user_id là khoá nghiệp vụ (id nội bộ Zalo, không đổi).
CREATE TABLE IF NOT EXISTS members (
  zalo_user_id   TEXT PRIMARY KEY,
  display_name   TEXT NOT NULL DEFAULT '',
  -- role: 'owner' | 'admin' | 'member' (suy từ group info; quyết định miễn kick).
  role           TEXT NOT NULL DEFAULT 'member',
  -- Mốc tham gia: lấy từ Zalo nếu có (OQ-2), nếu không thì để NULL.
  joined_at      INTEGER,
  -- Mốc bot lần đầu "thấy" member này (luôn ghi được, dùng cho luật miễn người mới).
  first_seen_at  INTEGER NOT NULL,
  -- 1 = còn trong group, 0 = đã rời/bị kick.
  is_active      INTEGER NOT NULL DEFAULT 1,
  left_at        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_members_active ON members(is_active);

-- Log tương tác (append-only). Mỗi event 1 row, KHÔNG update/overwrite.
-- type: 'message' | 'reaction'  (voting KHÔNG bắt được qua listener — xem OQ-1).
-- source: 'listener' (real-time, nguồn duy nhất — Zalo Community không cho lấy lịch sử cũ).
CREATE TABLE IF NOT EXISTS interactions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  zalo_user_id   TEXT NOT NULL,
  type           TEXT NOT NULL,
  ts             INTEGER NOT NULL,
  source         TEXT NOT NULL DEFAULT 'listener',
  FOREIGN KEY (zalo_user_id) REFERENCES members(zalo_user_id)
);

CREATE INDEX IF NOT EXISTS idx_interactions_user_ts ON interactions(zalo_user_id, ts);
-- Chống ghi trùng cùng event (cùng người + cùng mốc + cùng loại + cùng nguồn).
CREATE UNIQUE INDEX IF NOT EXISTS idx_interactions_dedupe
  ON interactions(zalo_user_id, ts, type, source);

-- Các kỳ quét/dọn dẹp.
CREATE TABLE IF NOT EXISTS scan_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at     INTEGER NOT NULL,
  finished_at    INTEGER,
  -- 'collecting' | 'warned' | 'planned' | 'pending_approval' | 'kicking' | 'done' | 'cancelled' | 'skipped' | 'failed'
  status         TEXT NOT NULL,
  target_count   INTEGER NOT NULL,
  member_count   INTEGER,
  planned_kicks  INTEGER,
  actual_kicks   INTEGER,
  note           TEXT
);

-- Plan xoá theo từng kỳ. Lưu bền để Telegram approval/timeout/retry không mất danh sách
-- khi process restart.
CREATE TABLE IF NOT EXISTS cleanup_plan_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id       INTEGER NOT NULL,
  zalo_user_id      TEXT NOT NULL,
  display_name      TEXT NOT NULL DEFAULT '',
  interaction_count INTEGER NOT NULL DEFAULT 0,
  last_interaction  INTEGER,
  rank              INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'planned',
  error             TEXT,
  updated_at        INTEGER NOT NULL,
  FOREIGN KEY (scan_run_id) REFERENCES scan_runs(id),
  UNIQUE (scan_run_id, zalo_user_id)
);

CREATE INDEX IF NOT EXISTS idx_cleanup_plan_run_status
  ON cleanup_plan_items(scan_run_id, status);

-- Ai bị kick (Milestone 2). M1 chỉ tạo bảng.
CREATE TABLE IF NOT EXISTS removals (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id       INTEGER,
  zalo_user_id      TEXT NOT NULL,
  display_name      TEXT NOT NULL DEFAULT '',
  interaction_count INTEGER NOT NULL DEFAULT 0,
  last_interaction  INTEGER,
  removed_at        INTEGER NOT NULL,
  FOREIGN KEY (scan_run_id) REFERENCES scan_runs(id)
);

-- Danh sách cảnh báo/ân hạn: member 0 tương tác lần đầu lọt diện sẽ được ghi ở đây,
-- kỳ sau vẫn 0 tương tác mới được đưa vào danh sách xoá.
CREATE TABLE IF NOT EXISTS cleanup_warnings (
  zalo_user_id      TEXT PRIMARY KEY,
  first_warned_run  INTEGER,
  first_warned_at   INTEGER NOT NULL,
  last_warned_run   INTEGER,
  last_warned_at    INTEGER NOT NULL,
  warning_count     INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (zalo_user_id) REFERENCES members(zalo_user_id),
  FOREIGN KEY (first_warned_run) REFERENCES scan_runs(id),
  FOREIGN KEY (last_warned_run) REFERENCES scan_runs(id)
);

-- Trạng thái bot dạng key-value (warmup start, kỳ-đầu-đã-bỏ-qua...).
CREATE TABLE IF NOT EXISTS bot_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
