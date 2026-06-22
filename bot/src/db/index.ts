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

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);
  return db;
}

// ---- Types ----

export type MemberRole = "owner" | "admin" | "member";
export type InteractionType = "message" | "reaction";
export type InteractionSource = "listener";
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
       VALUES (@id, @name, @role, @joinedAt, @now, 1, NULL)
       ON CONFLICT(zalo_user_id) DO UPDATE SET
         display_name = CASE WHEN @name != '' THEN @name ELSE display_name END,
         role         = @role,
         joined_at    = COALESCE(members.joined_at, @joinedAt),
         is_active    = 1,
         left_at      = NULL`,
    )
    .run({
      id: input.zaloUserId,
      name: input.displayName ?? "",
      role: input.role ?? "member",
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

// ---- Reads cho ranking / export ----

/**
 * Thống kê tương tác mỗi member còn active: số lần + lần cuối.
 * Dùng cho export-members (M1) và ranking (M2 — sắp theo count ASC, last_interaction ASC).
 */
export function getMemberStats(): MemberStats[] {
  return getDb()
    .prepare(
      `SELECT m.zalo_user_id, m.display_name, m.role, m.joined_at, m.first_seen_at,
              COUNT(i.id)       AS interaction_count,
              MAX(i.ts)         AS last_interaction
       FROM members m
       LEFT JOIN interactions i ON i.zalo_user_id = m.zalo_user_id
       WHERE m.is_active = 1
       GROUP BY m.zalo_user_id
       ORDER BY interaction_count ASC, last_interaction ASC`,
    )
    .all() as MemberStats[];
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

export function getLatestScanRun(): ScanRunRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM scan_runs ORDER BY id DESC LIMIT 1`)
    .get() as ScanRunRow | undefined;
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
  scanRunId: number;
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
