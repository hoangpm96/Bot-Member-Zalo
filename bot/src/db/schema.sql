-- Schema Bot-Member-Zalo. Toàn bộ idempotent (CREATE IF NOT EXISTS).
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

-- Lịch sử đồng bộ member từ Zalo về DB.
CREATE TABLE IF NOT EXISTS member_sync_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  requested_by   TEXT NOT NULL DEFAULT 'system',
  started_at     INTEGER NOT NULL,
  finished_at    INTEGER,
  status         TEXT NOT NULL,
  group_id       TEXT,
  group_name     TEXT,
  member_count   INTEGER,
  snapshot_count INTEGER,
  upserted       INTEGER,
  marked_left    INTEGER,
  error          TEXT
);

CREATE INDEX IF NOT EXISTS idx_member_sync_runs_started ON member_sync_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_member_sync_runs_status ON member_sync_runs(status);

-- Audit join/leave/remove/reactivate. source: listener | snapshot_sync | bot_cleanup | moderation.
CREATE TABLE IF NOT EXISTS member_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  zalo_user_id   TEXT NOT NULL,
  display_name   TEXT NOT NULL DEFAULT '',
  role           TEXT,
  event_type     TEXT NOT NULL,
  source         TEXT NOT NULL,
  sync_run_id    INTEGER,
  ts             INTEGER NOT NULL,
  note           TEXT,
  FOREIGN KEY (sync_run_id) REFERENCES member_sync_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_member_events_ts ON member_events(ts);
CREATE INDEX IF NOT EXISTS idx_member_events_user_ts ON member_events(zalo_user_id, ts);
CREATE INDEX IF NOT EXISTS idx_member_events_type ON member_events(event_type);

-- Log tương tác (append-only). Mỗi event 1 row, KHÔNG update/overwrite.
-- type: 'message' | 'reaction' | 'vote' | 'manual'.
-- source: 'listener' (real-time) | 'manual' (import CSV/JSON từ poll/vote cũ).
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

-- Lưu nội dung tin nhắn text trong group để sau này tổng hợp/viết blog.
-- Chỉ lưu text message của GROUP_ID target; không lưu ảnh/audio/file/sticker.
CREATE TABLE IF NOT EXISTS group_messages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id      TEXT NOT NULL,
  message_id     TEXT NOT NULL,
  zalo_user_id   TEXT NOT NULL,
  display_name   TEXT NOT NULL DEFAULT '',
  text           TEXT NOT NULL,
  msg_type       TEXT NOT NULL DEFAULT '',
  ts             INTEGER NOT NULL,
  is_self        INTEGER NOT NULL DEFAULT 0,
  source         TEXT NOT NULL DEFAULT 'listener',
  created_at     INTEGER NOT NULL,
  FOREIGN KEY (zalo_user_id) REFERENCES members(zalo_user_id),
  UNIQUE (thread_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_group_messages_ts ON group_messages(ts);
CREATE INDEX IF NOT EXISTS idx_group_messages_user_ts ON group_messages(zalo_user_id, ts);

-- Metadata ảnh/video trong group. Không lưu URL/file/media binary, chỉ lưu loại + số lượng.
CREATE TABLE IF NOT EXISTS group_media_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id      TEXT NOT NULL,
  message_id     TEXT NOT NULL,
  zalo_user_id   TEXT NOT NULL,
  display_name   TEXT NOT NULL DEFAULT '',
  media_type     TEXT NOT NULL,
  media_count    INTEGER NOT NULL DEFAULT 1,
  msg_type       TEXT NOT NULL DEFAULT '',
  ts             INTEGER NOT NULL,
  is_self        INTEGER NOT NULL DEFAULT 0,
  source         TEXT NOT NULL DEFAULT 'listener',
  created_at     INTEGER NOT NULL,
  FOREIGN KEY (zalo_user_id) REFERENCES members(zalo_user_id),
  UNIQUE (thread_id, message_id, media_type)
);

CREATE INDEX IF NOT EXISTS idx_group_media_events_ts ON group_media_events(ts);
CREATE INDEX IF NOT EXISTS idx_group_media_events_user_ts ON group_media_events(zalo_user_id, ts);
CREATE INDEX IF NOT EXISTS idx_group_media_events_type_ts ON group_media_events(media_type, ts);

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

-- Plan nháp do dashboard lưu từ trang Ứng viên để so sánh trước khi cleanup thật.
CREATE TABLE IF NOT EXISTS cleanup_draft_plans (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at        INTEGER NOT NULL,
  target_count      INTEGER NOT NULL,
  member_count      INTEGER NOT NULL,
  over_target       INTEGER NOT NULL,
  max_kicks         INTEGER NOT NULL,
  candidate_count   INTEGER NOT NULL,
  grace_count       INTEGER NOT NULL,
  removable_count   INTEGER NOT NULL,
  note              TEXT
);

CREATE TABLE IF NOT EXISTS cleanup_draft_plan_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_plan_id      INTEGER NOT NULL,
  zalo_user_id       TEXT NOT NULL,
  display_name       TEXT NOT NULL DEFAULT '',
  interaction_count  INTEGER NOT NULL DEFAULT 0,
  last_interaction   INTEGER,
  warning_count      INTEGER NOT NULL DEFAULT 0,
  rank               INTEGER NOT NULL,
  action             TEXT NOT NULL,
  reason             TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (draft_plan_id) REFERENCES cleanup_draft_plans(id),
  UNIQUE (draft_plan_id, zalo_user_id)
);

CREATE INDEX IF NOT EXISTS idx_cleanup_draft_items_plan ON cleanup_draft_plan_items(draft_plan_id, rank);

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

-- Lịch sử kiểm duyệt real-time: tin nhắn dính từ khoá cấm → xoá tin + ban người gửi.
-- Append-only (mỗi lần xử lý 1 row). Lưu cả khi DRY_RUN để soi lại bot "sẽ" làm gì.
-- action: 'delete_only' | 'delete_and_ban' (ban = kick khỏi group + chặn tham gia lại).
-- deleted/kicked/blocked: 1 nếu bước đó thực sự chạy thành công (0 khi dry-run hoặc lỗi).
CREATE TABLE IF NOT EXISTS moderation_actions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id      TEXT NOT NULL,
  message_id     TEXT NOT NULL DEFAULT '',
  zalo_user_id   TEXT NOT NULL,
  display_name   TEXT NOT NULL DEFAULT '',
  matched_word   TEXT NOT NULL,
  text           TEXT NOT NULL DEFAULT '',
  action         TEXT NOT NULL,
  dry_run        INTEGER NOT NULL DEFAULT 0,
  deleted        INTEGER NOT NULL DEFAULT 0,
  kicked         INTEGER NOT NULL DEFAULT 0,
  blocked        INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  created_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_moderation_created ON moderation_actions(created_at);
CREATE INDEX IF NOT EXISTS idx_moderation_user ON moderation_actions(zalo_user_id);
