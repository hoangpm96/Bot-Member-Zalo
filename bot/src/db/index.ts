import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

/**
 * Lớp truy cập DB. better-sqlite3 ĐỒNG BỘ (không async). 1 connection chia sẻ.
 * Mọi truy cập SQL nằm ở đây — phần còn lại của code chỉ gọi hàm typed export.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_VERSION = "2026-08-14-daily-public-posts";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);
  db.prepare(
    `INSERT OR IGNORE INTO schema_migrations (version, applied_at, note)
     VALUES (@version, @appliedAt, @note)`,
  ).run({
    version: SCHEMA_VERSION,
    appliedAt: Date.now(),
    note: "Kho bản tin công khai hằng ngày (daily_public_posts) cho Facebook + bahub.vn/ban-tin.",
  });
  return db;
}

// ---- Types ----

export type MemberRole = "owner" | "admin" | "member";
export type MemberEventType = "joined" | "left" | "removed" | "blocked" | "reactivated";
export type MemberEventSource = "listener" | "snapshot_sync" | "bot_cleanup" | "moderation" | "manual_web";
export type MemberSyncRunStatus = "running" | "done" | "failed";
export type InteractionType = "message" | "reaction" | "vote" | "manual" | "image" | "video";
export type InteractionSource = "listener" | "manual" | "poll";
export type ScanRunStatus =
  | "collecting"
  | "warned"
  | "planned"
  | "pending_approval"
  | "kicking"
  | "done"
  | "cancelled"
  | "skipped"
  | "failed";

export interface MemberRow {
  zalo_user_id: string;
  display_name: string;
  role: MemberRole;
  joined_at: number | null;
  first_seen_at: number;
  is_active: number;
  left_at: number | null;
}

export interface MemberStats {
  zalo_user_id: string;
  display_name: string;
  role: MemberRole;
  joined_at: number | null;
  first_seen_at: number;
  interaction_count: number;
  last_interaction: number | null;
}

export interface MemberSyncRunRow {
  id: number;
  requested_by: string;
  started_at: number;
  finished_at: number | null;
  status: MemberSyncRunStatus;
  group_id: string | null;
  group_name: string | null;
  member_count: number | null;
  snapshot_count: number | null;
  upserted: number | null;
  marked_left: number | null;
  error: string | null;
}

export interface BotErrorRow {
  id: number;
  source: string;
  code: string;
  message: string;
  detail: string | null;
  created_at: number;
}

export interface ScanRunRow {
  id: number;
  started_at: number;
  finished_at: number | null;
  status: ScanRunStatus;
  target_count: number;
  member_count: number | null;
  planned_kicks: number | null;
  actual_kicks: number | null;
  note: string | null;
}

export type CleanupPlanItemStatus = "planned" | "removed" | "failed" | "skipped";

export interface CleanupPlanItemRow {
  id: number;
  scan_run_id: number;
  zalo_user_id: string;
  display_name: string;
  interaction_count: number;
  last_interaction: number | null;
  rank: number;
  status: CleanupPlanItemStatus;
  error: string | null;
  updated_at: number;
}

export interface GroupMessageInput {
  threadId: string;
  messageId: string;
  zaloUserId: string;
  displayName?: string;
  text: string;
  msgType?: string;
  ts: number;
  isSelf?: boolean;
  source?: "listener";
  now: number;
}

export interface GroupMediaEventInput {
  threadId: string;
  messageId: string;
  zaloUserId: string;
  displayName?: string;
  mediaType: "image" | "video";
  mediaCount: number;
  msgType?: string;
  ts: number;
  isSelf?: boolean;
  source?: "listener";
  now: number;
}

// ---- Members ----

/**
 * Tạo mới hoặc cập nhật member. Giữ nguyên first_seen_at của lần đầu (COALESCE),
 * cập nhật tên/role/joined_at mới nhất, đánh dấu active lại nếu họ quay lại.
 */
export function upsertMember(input: {
  zaloUserId: string;
  displayName?: string;
  role?: MemberRole;
  joinedAt?: number | null;
  now: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO members (zalo_user_id, display_name, role, joined_at, first_seen_at, is_active, left_at)
       VALUES (@id, @name, @roleInsert, @joinedAt, @now, 1, NULL)
       ON CONFLICT(zalo_user_id) DO UPDATE SET
         display_name = CASE WHEN @name != '' THEN @name ELSE display_name END,
         role         = CASE WHEN @role != '' THEN @role ELSE role END,
         joined_at    = COALESCE(members.joined_at, @joinedAt),
         is_active    = 1,
         left_at      = NULL`,
    )
    .run({
      id: input.zaloUserId,
      name: input.displayName ?? "",
      role: input.role ?? "",
      roleInsert: input.role ?? "member",
      joinedAt: input.joinedAt ?? null,
      now: input.now,
    });
}

/** Đánh dấu member đã rời/bị kick (không xoá row — giữ lịch sử). */
export function markMemberLeft(zaloUserId: string, now: number): void {
  getDb()
    .prepare(`UPDATE members SET is_active = 0, left_at = @now WHERE zalo_user_id = @id`)
    .run({ id: zaloUserId, now });
}

export function getMember(zaloUserId: string): MemberRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM members WHERE zalo_user_id = @id`)
    .get({ id: zaloUserId }) as MemberRow | undefined;
}

// ---- Ops errors ----

export function recordBotError(input: {
  source: string;
  code?: string;
  message: string;
  detail?: string | null;
  now?: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO bot_errors (source, code, message, detail, created_at)
       VALUES (@source, @code, @message, @detail, @now)`,
    )
    .run({
      source: input.source,
      code: input.code ?? "",
      message: input.message.slice(0, 1000),
      detail: input.detail ? input.detail.slice(0, 5000) : null,
      now: input.now ?? Date.now(),
    });
}

// ---- Member sync / audit ----

export function createMemberSyncRun(input: { requestedBy: string; startedAt: number }): number {
  const res = getDb()
    .prepare(
      `INSERT INTO member_sync_runs (requested_by, started_at, status)
       VALUES (@requestedBy, @startedAt, 'running')`,
    )
    .run(input);
  return Number(res.lastInsertRowid);
}

export function finishMemberSyncRun(input: {
  id: number;
  finishedAt: number;
  status: MemberSyncRunStatus;
  groupId?: string | null;
  groupName?: string | null;
  memberCount?: number | null;
  snapshotCount?: number | null;
  upserted?: number | null;
  markedLeft?: number | null;
  error?: string | null;
}): void {
  getDb()
    .prepare(
      `UPDATE member_sync_runs
       SET finished_at = @finishedAt,
           status = @status,
           group_id = COALESCE(@groupId, group_id),
           group_name = COALESCE(@groupName, group_name),
           member_count = COALESCE(@memberCount, member_count),
           snapshot_count = COALESCE(@snapshotCount, snapshot_count),
           upserted = COALESCE(@upserted, upserted),
           marked_left = COALESCE(@markedLeft, marked_left),
           error = @error
       WHERE id = @id`,
    )
    .run({
      id: input.id,
      finishedAt: input.finishedAt,
      status: input.status,
      groupId: input.groupId ?? null,
      groupName: input.groupName ?? null,
      memberCount: input.memberCount ?? null,
      snapshotCount: input.snapshotCount ?? null,
      upserted: input.upserted ?? null,
      markedLeft: input.markedLeft ?? null,
      error: input.error ?? null,
    });
}

export function recordMemberEvent(input: {
  zaloUserId: string;
  displayName?: string;
  role?: MemberRole | null;
  eventType: MemberEventType;
  source: MemberEventSource;
  syncRunId?: number | null;
  ts: number;
  note?: string | null;
}): void {
  if (!input.zaloUserId) return;
  getDb()
    .prepare(
      `INSERT INTO member_events
         (zalo_user_id, display_name, role, event_type, source, sync_run_id, ts, note)
       VALUES
         (@zaloUserId, @displayName, @role, @eventType, @source, @syncRunId, @ts, @note)`,
    )
    .run({
      zaloUserId: input.zaloUserId,
      displayName: input.displayName ?? "",
      role: input.role ?? null,
      eventType: input.eventType,
      source: input.source,
      syncRunId: input.syncRunId ?? null,
      ts: input.ts,
      note: input.note ?? null,
    });
}

export function getLatestMemberSyncRun(): MemberSyncRunRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM member_sync_runs ORDER BY id DESC LIMIT 1`)
    .get() as MemberSyncRunRow | undefined;
}

// ---- Interactions (append-only) ----

/**
 * Ghi 1 tương tác. INSERT OR IGNORE để seed lịch sử chạy lại không nhân đôi
 * (unique index dedupe theo user+ts+type+source).
 */
export function logInteraction(input: {
  zaloUserId: string;
  type: InteractionType;
  ts: number;
  source?: InteractionSource;
}): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO interactions (zalo_user_id, type, ts, source)
       VALUES (@id, @type, @ts, @source)`,
    )
    .run({
      id: input.zaloUserId,
      type: input.type,
      ts: input.ts,
      source: input.source ?? "listener",
    });
}

// ---- Group text message archive ----

/** Lưu text message để sau này export/tổng hợp blog. Dedupe theo thread_id + message_id. */
export function saveGroupMessage(input: GroupMessageInput): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO group_messages
         (thread_id, message_id, zalo_user_id, display_name, text, msg_type, ts, is_self, source, created_at)
       VALUES
         (@threadId, @messageId, @zaloUserId, @displayName, @text, @msgType, @ts, @isSelf, @source, @now)`,
    )
    .run({
      threadId: input.threadId,
      messageId: input.messageId,
      zaloUserId: input.zaloUserId,
      displayName: input.displayName ?? "",
      text: input.text,
      msgType: input.msgType ?? "",
      ts: input.ts,
      isSelf: input.isSelf ? 1 : 0,
      source: input.source ?? "listener",
      now: input.now,
    });
}

/** Lưu metadata ảnh/video. Không lưu URL/file; chỉ đếm loại media theo message. */
export function saveGroupMediaEvent(input: GroupMediaEventInput): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO group_media_events
         (thread_id, message_id, zalo_user_id, display_name, media_type, media_count,
          msg_type, ts, is_self, source, created_at)
       VALUES
         (@threadId, @messageId, @zaloUserId, @displayName, @mediaType, @mediaCount,
          @msgType, @ts, @isSelf, @source, @now)`,
    )
    .run({
      threadId: input.threadId,
      messageId: input.messageId,
      zaloUserId: input.zaloUserId,
      displayName: input.displayName ?? "",
      mediaType: input.mediaType,
      mediaCount: Math.max(1, Math.trunc(input.mediaCount)),
      msgType: input.msgType ?? "",
      ts: input.ts,
      isSelf: input.isSelf ? 1 : 0,
      source: input.source ?? "listener",
      now: input.now,
    });
}

// ---- Reads cho tóm tắt hằng ngày ----

export interface GroupMessageRow {
  zalo_user_id: string;
  display_name: string;
  text: string;
  ts: number;
}

/**
 * Tin nhắn text của 1 thread trong [startTs, endTs), sắp theo thời gian tăng dần.
 * Loại tin bot tự gửi (is_self=1) — cảnh báo cleanup/bản tin của bot không phải
 * thảo luận của thành viên, không được lọt vào tóm tắt hay top "sôi nổi nhất".
 */
export function listGroupMessagesBetween(
  threadId: string,
  startTs: number,
  endTs: number,
): GroupMessageRow[] {
  return getDb()
    .prepare(
      `SELECT zalo_user_id, display_name, text, ts
       FROM group_messages
       WHERE thread_id = @threadId AND ts >= @startTs AND ts < @endTs AND is_self = 0
       ORDER BY ts ASC`,
    )
    .all({ threadId, startTs, endTs }) as GroupMessageRow[];
}

/** Đếm ảnh/video thành viên gửi trong [startTs, endTs) — cho phần thống kê của tóm tắt. */
export function countGroupMediaBetween(
  threadId: string,
  startTs: number,
  endTs: number,
): { images: number; videos: number } {
  const row = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN media_type = 'image' THEN media_count ELSE 0 END), 0) AS images,
         COALESCE(SUM(CASE WHEN media_type = 'video' THEN media_count ELSE 0 END), 0) AS videos
       FROM group_media_events
       WHERE thread_id = @threadId AND ts >= @startTs AND ts < @endTs AND is_self = 0`,
    )
    .get({ threadId, startTs, endTs }) as { images: number; videos: number };
  return { images: Number(row.images), videos: Number(row.videos) };
}

// ---- Daily summaries (kho lưu vĩnh viễn) ----

export interface DailySummaryInput {
  /** 'YYYY-MM-DD' theo giờ VN — khoá nghiệp vụ, mỗi ngày đúng 1 dòng. */
  dayDate: string;
  /** 'dd/mm/yyyy' đúng như in trong bản tin. */
  dayLabel: string;
  /** Epoch ms 00:00 giờ VN của ngày được tóm tắt. */
  dayStartTs: number;
  threadId: string;
  /** Bản tóm tắt thô từ model (chưa chia tin, chưa gắn header/footer). */
  summaryText: string;
  /** Các tin nhắn đã compose để gửi đi. */
  parts: string[];
  totalMessages?: number | null;
  includedMessages?: number | null;
  uniqueSenders?: number | null;
  images?: number | null;
  videos?: number | null;
  topSenders?: string[];
  model?: string;
  transcriptChars?: number | null;
  source?: "live" | "state_backfill" | "backfill";
  now: number;
}

function dailySummaryParams(input: DailySummaryInput): Record<string, unknown> {
  return {
    dayDate: input.dayDate,
    dayLabel: input.dayLabel,
    dayStartTs: input.dayStartTs,
    threadId: input.threadId,
    summaryText: input.summaryText,
    partsJson: JSON.stringify(input.parts),
    totalMessages: input.totalMessages ?? null,
    includedMessages: input.includedMessages ?? null,
    uniqueSenders: input.uniqueSenders ?? null,
    images: input.images ?? null,
    videos: input.videos ?? null,
    topSendersJson: JSON.stringify(input.topSenders ?? []),
    model: input.model ?? "",
    transcriptChars: input.transcriptChars ?? null,
    source: input.source ?? "live",
    now: input.now,
  };
}

const DAILY_SUMMARY_INSERT_SQL = `INTO daily_summaries
    (day_date, day_label, day_start_ts, thread_id, summary_text, parts_json,
     total_messages, included_messages, unique_senders, images, videos,
     top_senders_json, model, transcript_chars, source, created_at)
  VALUES
    (@dayDate, @dayLabel, @dayStartTs, @threadId, @summaryText, @partsJson,
     @totalMessages, @includedMessages, @uniqueSenders, @images, @videos,
     @topSendersJson, @model, @transcriptChars, @source, @now)`;

/**
 * Lưu bản tóm tắt của 1 ngày (upsert theo day_date). Chạy lại cùng ngày sau khi
 * state bị mất → bản sinh mới (đầy đủ thống kê) ghi đè bản cũ.
 */
export function saveDailySummary(input: DailySummaryInput): void {
  getDb()
    .prepare(
      `INSERT ${DAILY_SUMMARY_INSERT_SQL}
       ON CONFLICT(day_date) DO UPDATE SET
         day_label = @dayLabel,
         day_start_ts = @dayStartTs,
         thread_id = @threadId,
         summary_text = @summaryText,
         parts_json = @partsJson,
         total_messages = @totalMessages,
         included_messages = @includedMessages,
         unique_senders = @uniqueSenders,
         images = @images,
         videos = @videos,
         top_senders_json = @topSendersJson,
         model = @model,
         transcript_chars = @transcriptChars,
         source = @source,
         created_at = @now`,
    )
    .run(dailySummaryParams(input));
}

/**
 * Backfill từ bot_state cũ: chỉ chèn khi ngày đó CHƯA có trong kho — bản 'live'
 * (đầy đủ thống kê) không bao giờ bị bản khôi phục nghèo dữ liệu hơn ghi đè.
 */
export function backfillDailySummaryIfMissing(input: DailySummaryInput): boolean {
  const res = getDb()
    .prepare(`INSERT OR IGNORE ${DAILY_SUMMARY_INSERT_SQL}`)
    .run(dailySummaryParams({ ...input, source: input.source ?? "state_backfill" }));
  return res.changes > 0;
}

/** Ngày ('YYYY-MM-DD') đã có trong kho chưa — backfill check trước khi tốn tiền gọi model. */
export function hasDailySummaryForDate(dayDate: string): boolean {
  const row = getDb()
    .prepare(`SELECT 1 AS ok FROM daily_summaries WHERE day_date = @dayDate`)
    .get({ dayDate }) as { ok: number } | undefined;
  return row !== undefined;
}

/** Mốc ts của tin nhắn thành viên đầu tiên trong kho — điểm bắt đầu quét backfill. */
export function getEarliestGroupMessageTs(threadId: string): number | null {
  const row = getDb()
    .prepare(
      `SELECT MIN(ts) AS t FROM group_messages WHERE thread_id = @threadId AND is_self = 0`,
    )
    .get({ threadId }) as { t: number | null };
  return row.t ?? null;
}

// ---- Bản tin công khai hằng ngày (Facebook Page + bahub.vn/ban-tin) ----

export interface PublicPostRow {
  day_date: string;
  day_label: string;
  day_start_ts: number;
  main_caption: string;
  topics_json: string;
  fb_post_id: string | null;
  fb_posted_at: number | null;
  skipped_reason: string | null;
  model: string;
  source: string;
  created_at: number;
  updated_at: number;
}

export interface PublicPostInput {
  dayDate: string;
  dayLabel: string;
  dayStartTs: number;
  mainCaption: string;
  /** JSON array [{title, caption, image_prompt, image_file, image_url}] — rỗng = ngày không có bản tin. */
  topicsJson: string;
  skippedReason?: string | null;
  model?: string;
  source?: "live" | "backfill";
  now: number;
}

/**
 * Lưu bản tin công khai của 1 ngày (upsert theo day_date).
 *
 * KHÔNG đụng fb_post_id: soạn lại nội dung không có nghĩa là bài trên Page biến
 * mất — giữ id để lần chạy sau vẫn biết ngày này đã đăng rồi.
 * created_at giữ nguyên lần đầu; updated_at là con trỏ cho lệnh sync-posts.
 */
export function savePublicPost(input: PublicPostInput): void {
  getDb()
    .prepare(
      `INSERT INTO daily_public_posts
         (day_date, day_label, day_start_ts, main_caption, topics_json,
          skipped_reason, model, source, created_at, updated_at)
       VALUES
         (@dayDate, @dayLabel, @dayStartTs, @mainCaption, @topicsJson,
          @skippedReason, @model, @source, @now, @now)
       ON CONFLICT(day_date) DO UPDATE SET
         day_label = @dayLabel,
         day_start_ts = @dayStartTs,
         main_caption = @mainCaption,
         topics_json = @topicsJson,
         skipped_reason = @skippedReason,
         model = @model,
         source = @source,
         updated_at = @now`,
    )
    .run({
      dayDate: input.dayDate,
      dayLabel: input.dayLabel,
      dayStartTs: input.dayStartTs,
      mainCaption: input.mainCaption,
      topicsJson: input.topicsJson,
      skippedReason: input.skippedReason ?? null,
      model: input.model ?? "",
      source: input.source ?? "live",
      now: input.now,
    });
}

export function getPublicPostByDate(dayDate: string): PublicPostRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM daily_public_posts WHERE day_date = @dayDate`)
    .get({ dayDate }) as PublicPostRow | undefined;
}

/** Ghi id bài Facebook sau khi đăng thành công (chống đăng trùng khi cron chạy lại). */
export function setPublicPostFbId(dayDate: string, fbPostId: string, now: number): void {
  getDb()
    .prepare(
      `UPDATE daily_public_posts
          SET fb_post_id = @fbPostId, fb_posted_at = @now, updated_at = @now
        WHERE day_date = @dayDate`,
    )
    .run({ dayDate, fbPostId, now });
}

/**
 * Ghi lại topics_json sau khi đã có URL ảnh công khai.
 *
 * KHÔNG chạm updated_at: con trỏ sync chỉ nên nhích khi NỘI DUNG đổi. Lệnh
 * sync-posts tự gọi hàm này ngay trước lúc đẩy, nhích con trỏ ở đây sẽ khiến
 * chính nó thấy dòng "mới" và đẩy lại vòng sau, lặp vô tận.
 */
export function updatePublicPostTopics(dayDate: string, topicsJson: string): void {
  getDb()
    .prepare(`UPDATE daily_public_posts SET topics_json = @topicsJson WHERE day_date = @dayDate`)
    .run({ dayDate, topicsJson });
}

/**
 * Các bản tin công khai cần đẩy lên bahub.vn, cũ → mới theo con trỏ ghép
 * (updated_at, day_date): backfill chạy vòng lặp nhanh có thể ghi nhiều ngày
 * trong cùng một mili-giây — chỉ so updated_at là mất ngày.
 *
 * Ngày topics rỗng (không đủ nội dung đáng đăng) VẪN nằm trong kết quả: web
 * cần biết để gỡ ngày đó xuống nếu trước đó đã trót đăng.
 */
export function listPublicPostsForSync(
  cursor: { updatedAt: number; dayDate: string },
  limit: number,
): PublicPostRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM daily_public_posts
        WHERE updated_at > @updatedAt
           OR (updated_at = @updatedAt AND day_date > @dayDate)
        ORDER BY updated_at ASC, day_date ASC
        LIMIT @limit`,
    )
    .all({ updatedAt: cursor.updatedAt, dayDate: cursor.dayDate, limit }) as PublicPostRow[];
}

/** Ngày đã có bản tin công khai chưa — backfill check trước khi tốn tiền gọi model/sinh ảnh. */
export function hasPublicPostForDate(dayDate: string): boolean {
  const row = getDb()
    .prepare(`SELECT 1 AS ok FROM daily_public_posts WHERE day_date = @dayDate`)
    .get({ dayDate }) as { ok: number } | undefined;
  return row !== undefined;
}

// ---- Reads cho ranking / export ----

/**
 * Trọng số điểm tương tác theo loại — reaction quá dễ thả trên Zalo nên bị hạ thấp
 * so với message. vote (poll) đứng giữa. manual/image/video giữ tương đương gốc.
 * Dùng chung ở mọi query tính interaction_count (bot + web) để khỏi lệch điểm.
 */
export const INTERACTION_WEIGHT_SQL = `CASE i.type
    WHEN 'message' THEN 10
    WHEN 'image'   THEN 10
    WHEN 'video'   THEN 10
    WHEN 'vote'    THEN 3
    WHEN 'reaction' THEN 1
    WHEN 'manual'  THEN 1
    ELSE 1
  END`;

/**
 * Thống kê tương tác mỗi member còn active: điểm có trọng số + lần cuối.
 * Dùng cho export-members (M1) và ranking (M2 — sắp theo count ASC, last_interaction ASC).
 * Trọng số: message/image/video = 10, vote = 3, reaction/manual = 1.
 */
export function getMemberStats(): MemberStats[] {
  return getDb()
    .prepare(
      `SELECT m.zalo_user_id, m.display_name, m.role, m.joined_at, m.first_seen_at,
              COALESCE(SUM(${INTERACTION_WEIGHT_SQL}), 0) AS interaction_count,
              MAX(i.ts)         AS last_interaction
       FROM members m
       LEFT JOIN interactions i ON i.zalo_user_id = m.zalo_user_id
       WHERE m.is_active = 1
       GROUP BY m.zalo_user_id
       ORDER BY interaction_count ASC, last_interaction ASC`,
    )
    .all() as MemberStats[];
}

export type LeaderboardPeriod = "7d" | "30d" | "all";

export interface LeaderboardRow {
  rank: number;
  display_name: string;
  interaction_count: number;
  message_count: number;
  reaction_count: number;
  vote_count: number;
  other_count: number;
  last_interaction: number | null;
}

/**
 * Bảng xếp hạng public: chỉ trả tên + số liệu tổng hợp, tuyệt đối không trả Zalo ID.
 * Cùng query với web/src/lib/db.ts listLeaderboard (2 project riêng, không share code)
 * — dùng cho sync-leaderboard đẩy lên bahub.vn.
 */
export function listLeaderboard(period: LeaderboardPeriod, limit = 50): LeaderboardRow[] {
  const now = Date.now();
  const since =
    period === "7d" ? now - 7 * 86400000 : period === "30d" ? now - 30 * 86400000 : 0;

  const rows = getDb()
    .prepare(
      `SELECT
         m.display_name,
         SUM(${INTERACTION_WEIGHT_SQL}) AS interaction_count,
         SUM(CASE WHEN i.type = 'message' THEN 1 ELSE 0 END) AS message_count,
         SUM(CASE WHEN i.type = 'reaction' THEN 1 ELSE 0 END) AS reaction_count,
         SUM(CASE WHEN i.type = 'vote' THEN 1 ELSE 0 END) AS vote_count,
         SUM(CASE WHEN i.type NOT IN ('message', 'reaction', 'vote') THEN 1 ELSE 0 END) AS other_count,
         MAX(i.ts) AS last_interaction
       FROM interactions i
       JOIN members m ON m.zalo_user_id = i.zalo_user_id
       WHERE m.is_active = 1
         AND i.ts >= @since
       GROUP BY i.zalo_user_id, m.display_name
       ORDER BY interaction_count DESC, last_interaction DESC, LOWER(m.display_name) ASC
       LIMIT @limit`,
    )
    .all({
      since,
      limit: Math.min(Math.max(limit, 1), 100),
    }) as Omit<LeaderboardRow, "rank">[];

  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function countActiveMembers(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM members WHERE is_active = 1`)
    .get() as { n: number };
  return row.n;
}

// ---- Scan runs / cleanup warnings / removals ----

export function createScanRun(input: {
  startedAt: number;
  status: ScanRunStatus;
  targetCount: number;
  memberCount?: number | null;
  plannedKicks?: number | null;
  actualKicks?: number | null;
  note?: string | null;
}): number {
  const res = getDb()
    .prepare(
      `INSERT INTO scan_runs
         (started_at, status, target_count, member_count, planned_kicks, actual_kicks, note)
       VALUES
         (@startedAt, @status, @targetCount, @memberCount, @plannedKicks, @actualKicks, @note)`,
    )
    .run({
      startedAt: input.startedAt,
      status: input.status,
      targetCount: input.targetCount,
      memberCount: input.memberCount ?? null,
      plannedKicks: input.plannedKicks ?? null,
      actualKicks: input.actualKicks ?? null,
      note: input.note ?? null,
    });
  return Number(res.lastInsertRowid);
}

export function finishScanRun(input: {
  id: number;
  finishedAt: number;
  status: ScanRunStatus;
  memberCount?: number | null;
  plannedKicks?: number | null;
  actualKicks?: number | null;
  note?: string | null;
}): void {
  getDb()
    .prepare(
      `UPDATE scan_runs
       SET finished_at = @finishedAt,
           status = @status,
           member_count = COALESCE(@memberCount, member_count),
           planned_kicks = COALESCE(@plannedKicks, planned_kicks),
           actual_kicks = COALESCE(@actualKicks, actual_kicks),
           note = COALESCE(@note, note)
       WHERE id = @id`,
    )
    .run({
      id: input.id,
      finishedAt: input.finishedAt,
      status: input.status,
      memberCount: input.memberCount ?? null,
      plannedKicks: input.plannedKicks ?? null,
      actualKicks: input.actualKicks ?? null,
      note: input.note ?? null,
    });
}

export function getScanRun(id: number): ScanRunRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM scan_runs WHERE id = @id`)
    .get({ id }) as ScanRunRow | undefined;
}

export function getLatestScanRunByStatus(statuses: ScanRunStatus[]): ScanRunRow | undefined {
  if (statuses.length === 0) return undefined;
  const placeholders = statuses.map((_, i) => `@s${i}`).join(", ");
  const params = Object.fromEntries(statuses.map((s, i) => [`s${i}`, s]));
  return getDb()
    .prepare(`SELECT * FROM scan_runs WHERE status IN (${placeholders}) ORDER BY id DESC LIMIT 1`)
    .get(params) as ScanRunRow | undefined;
}

export function saveCleanupPlanItems(input: {
  scanRunId: number;
  items: {
    zaloUserId: string;
    displayName: string;
    interactionCount: number;
    lastInteraction: number | null;
    rank: number;
  }[];
  now: number;
}): void {
  const stmt = getDb().prepare(
    `INSERT INTO cleanup_plan_items
       (scan_run_id, zalo_user_id, display_name, interaction_count, last_interaction, rank, status, updated_at)
     VALUES
       (@scanRunId, @zaloUserId, @displayName, @interactionCount, @lastInteraction, @rank, 'planned', @now)
     ON CONFLICT(scan_run_id, zalo_user_id) DO UPDATE SET
       display_name = @displayName,
       interaction_count = @interactionCount,
       last_interaction = @lastInteraction,
       rank = @rank,
       updated_at = @now`,
  );
  const tx = getDb().transaction(() => {
    for (const item of input.items) {
      stmt.run({ scanRunId: input.scanRunId, now: input.now, ...item });
    }
  });
  tx();
}

export function listCleanupPlanItems(scanRunId: number): CleanupPlanItemRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM cleanup_plan_items
       WHERE scan_run_id = @scanRunId
       ORDER BY rank ASC`,
    )
    .all({ scanRunId }) as CleanupPlanItemRow[];
}

export function markCleanupPlanItem(input: {
  id: number;
  status: CleanupPlanItemStatus;
  error?: string | null;
  now: number;
}): void {
  getDb()
    .prepare(
      `UPDATE cleanup_plan_items
       SET status = @status, error = @error, updated_at = @now
       WHERE id = @id`,
    )
    .run({ id: input.id, status: input.status, error: input.error ?? null, now: input.now });
}

export function markCleanupPlanItemsForRun(input: {
  scanRunId: number;
  fromStatus: CleanupPlanItemStatus;
  toStatus: CleanupPlanItemStatus;
  error?: string | null;
  now: number;
}): void {
  getDb()
    .prepare(
      `UPDATE cleanup_plan_items
       SET status = @toStatus, error = @error, updated_at = @now
       WHERE scan_run_id = @scanRunId AND status = @fromStatus`,
    )
    .run({
      scanRunId: input.scanRunId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      error: input.error ?? null,
      now: input.now,
    });
}

export function hasCleanupWarning(zaloUserId: string): boolean {
  const row = getDb()
    .prepare(`SELECT 1 AS ok FROM cleanup_warnings WHERE zalo_user_id = @id`)
    .get({ id: zaloUserId }) as { ok: number } | undefined;
  return row !== undefined;
}

export function upsertCleanupWarning(input: {
  zaloUserId: string;
  scanRunId: number;
  now: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO cleanup_warnings
         (zalo_user_id, first_warned_run, first_warned_at, last_warned_run, last_warned_at, warning_count)
       VALUES
         (@id, @runId, @now, @runId, @now, 1)
       ON CONFLICT(zalo_user_id) DO UPDATE SET
         last_warned_run = @runId,
         last_warned_at = @now,
         warning_count = warning_count + 1`,
    )
    .run({ id: input.zaloUserId, runId: input.scanRunId, now: input.now });
}

export function recordRemoval(input: {
  scanRunId: number | null;
  zaloUserId: string;
  displayName: string;
  interactionCount: number;
  lastInteraction: number | null;
  removedAt: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO removals
         (scan_run_id, zalo_user_id, display_name, interaction_count, last_interaction, removed_at)
       VALUES
         (@scanRunId, @zaloUserId, @displayName, @interactionCount, @lastInteraction, @removedAt)`,
    )
    .run(input);
}

// ---- Moderation (real-time keyword filter) ----

export type ModerationActionType = "delete_only" | "delete_and_ban";

/** Ghi 1 lần kiểm duyệt (append-only). Lưu cả khi dry-run để soi lại bot "sẽ" làm gì. */
export function recordModerationAction(input: {
  threadId: string;
  messageId: string;
  zaloUserId: string;
  displayName: string;
  matchedWord: string;
  text: string;
  action: ModerationActionType;
  dryRun: boolean;
  deleted: boolean;
  kicked: boolean;
  blocked: boolean;
  error?: string | null;
  now: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO moderation_actions
         (thread_id, message_id, zalo_user_id, display_name, matched_word, text,
          action, dry_run, deleted, kicked, blocked, error, created_at)
       VALUES
         (@threadId, @messageId, @zaloUserId, @displayName, @matchedWord, @text,
          @action, @dryRun, @deleted, @kicked, @blocked, @error, @now)`,
    )
    .run({
      threadId: input.threadId,
      messageId: input.messageId,
      zaloUserId: input.zaloUserId,
      displayName: input.displayName,
      matchedWord: input.matchedWord,
      text: input.text,
      action: input.action,
      dryRun: input.dryRun ? 1 : 0,
      deleted: input.deleted ? 1 : 0,
      kicked: input.kicked ? 1 : 0,
      blocked: input.blocked ? 1 : 0,
      error: input.error ?? null,
      now: input.now,
    });
}

// ---- bot_state (key-value) ----

export function getBotState(key: string): string | undefined {
  const row = getDb()
    .prepare(`SELECT value FROM bot_state WHERE key = @key`)
    .get({ key }) as { value: string } | undefined;
  return row?.value;
}

export function setBotState(key: string, value: string, now: number): void {
  getDb()
    .prepare(
      `INSERT INTO bot_state (key, value, updated_at) VALUES (@key, @value, @now)
       ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = @now`,
    )
    .run({ key, value, now });
}

export function deleteBotState(key: string): void {
  getDb().prepare(`DELETE FROM bot_state WHERE key = @key`).run({ key });
}

/**
 * Khóa chống chạy chồng (ATOMIC). Trả true nếu giành được khóa, false nếu đã có khóa
 * còn hiệu lực. Khóa cũ hơn staleMs coi như chết (process trước crash) → cho phép chiếm lại.
 *
 * Phải atomic vì `telegram-poll` chạy cron MỖI PHÚT còn 1 batch kick kéo dài tới ~100 phút
 * (50 người × 2 phút) → nhiều tiến trình chạy CHỒNG nhau. Read-then-write (2 statement) bị
 * TOCTOU: 2 process cùng SELECT thấy trống rồi cùng INSERT → cả hai tưởng thắng → KICK CHỒNG.
 * Gộp check-and-set vào 1 statement: INSERT ... ON CONFLICT DO UPDATE chỉ ghi đè khi khóa cũ
 * đã stale (WHERE), nếu khóa còn tươi thì UPDATE thành no-op (changes=0 = thua). SQLite ghi
 * tuần tự từng statement nên 1 trong 2 process chắc chắn changes=0.
 */
export function acquireLock(key: string, now: number, staleMs: number): boolean {
  const res = getDb()
    .prepare(
      `INSERT INTO bot_state (key, value, updated_at) VALUES (@key, @now, @now)
       ON CONFLICT(key) DO UPDATE SET value = @now, updated_at = @now
       WHERE CAST(bot_state.value AS INTEGER) <= 0
          OR @now - CAST(bot_state.value AS INTEGER) >= @staleMs`,
    )
    .run({ key, now, staleMs });
  // changes=1: INSERT mới / chiếm lại khóa stale / khóa giá trị hỏng (<=0) → an toàn không kẹt vĩnh viễn.
  // changes=0: khóa còn tươi → thua.
  return res.changes > 0;
}

export function releaseLock(key: string): void {
  deleteBotState(key);
}
