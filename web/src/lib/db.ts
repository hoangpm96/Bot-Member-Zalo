import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

/**
 * Mở CHUNG file SQLite của bot (read + ghi config/vip). Panel KHÔNG gọi Zalo —
 * chỉ đọc dữ liệu + ghi config/bot_state để bot đọc lại.
 *
 * Đường dẫn DB: env WEB_DB_PATH, default ../bot/data/bot.db (web và bot cùng repo).
 */

const DB_PATH =
  process.env.WEB_DB_PATH?.trim() ||
  path.resolve(process.cwd(), "..", "bot", "data", "bot.db");

/** Lỗi nhận diện được khi DB của bot chưa tồn tại (cho API trả 503 thân thiện). */
export class DbNotReadyError extends Error {}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  if (!fs.existsSync(DB_PATH)) {
    throw new DbNotReadyError(
      `Không tìm thấy DB của bot tại ${DB_PATH}. Chạy bot (npm start) ít nhất 1 lần, ` +
        `hoặc đặt WEB_DB_PATH trỏ đúng file bot.db.`,
    );
  }
  // Mở chung file bot đang dùng (WAL). KHÔNG set journal_mode ở đây (bot là chủ).
  // busy_timeout: chờ tối đa 5s nếu bot đang giữ write-lock thay vì lỗi SQLITE_BUSY ngay.
  db = new Database(DB_PATH);
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  return db;
}

/** Kiểm tra DB có tồn tại không (cho trang hiển thị thông báo thân thiện). */
export function dbExists(): boolean {
  return fs.existsSync(DB_PATH);
}

export function dbPath(): string {
  return DB_PATH;
}

// ---- Types ----

export interface MemberStatRow {
  zalo_user_id: string;
  display_name: string;
  role: "owner" | "admin" | "member";
  interaction_count: number;
  last_interaction: number | null;
  joined_at: number | null;
  first_seen_at: number;
  warning_count: number;
  last_warned_at: number | null;
}

export type MemberRoleFilter = "all" | "owner" | "admin" | "member";
export type MemberActivityFilter = "all" | "zero" | "never" | "recent" | "inactive30" | "inactive90" | "warned";
export type MemberSort = "risk" | "interactions" | "last" | "name" | "joined" | "warnings";

export interface MemberFilters {
  q?: string;
  role?: MemberRoleFilter;
  activity?: MemberActivityFilter;
  sort?: MemberSort;
  limit?: number;
}

export interface MemberSummary {
  total: number;
  owner: number;
  admin: number;
  member: number;
  zero_interactions: number;
  never_interacted: number;
  inactive_30d: number;
  inactive_90d: number;
  warned: number;
  removable_candidates: number;
  total_interactions: number;
}

export interface MemberOption {
  id: string;
  displayName: string;
  role: "owner" | "admin" | "member";
}

export interface RemovalRow {
  id: number;
  scan_run_id: number | null;
  zalo_user_id: string;
  display_name: string;
  interaction_count: number;
  last_interaction: number | null;
  removed_at: number;
}

export interface ScanRunRow {
  id: number;
  started_at: number;
  finished_at: number | null;
  status: string;
  target_count: number;
  member_count: number | null;
  planned_kicks: number | null;
  actual_kicks: number | null;
  note: string | null;
}

export interface GroupMessageRow {
  id: number;
  thread_id: string;
  message_id: string;
  zalo_user_id: string;
  display_name: string;
  text: string;
  msg_type: string;
  ts: number;
  is_self: number;
  source: string;
  created_at: number;
}

export interface MessageFilters {
  q?: string;
  from?: number | null;
  to?: number | null;
  self?: "all" | "self" | "member";
  limit?: number;
}

// ---- Reads ----

export function countActiveMembers(): number {
  const r = getDb().prepare(`SELECT COUNT(*) AS n FROM members WHERE is_active = 1`).get() as {
    n: number;
  };
  return r.n;
}

export function countByRole(): { owner: number; admin: number; member: number } {
  const rows = getDb()
    .prepare(`SELECT role, COUNT(*) AS n FROM members WHERE is_active = 1 GROUP BY role`)
    .all() as { role: string; n: number }[];
  const out = { owner: 0, admin: 0, member: 0 };
  for (const r of rows) {
    if (r.role === "owner" || r.role === "admin" || r.role === "member") out[r.role] = r.n;
  }
  return out;
}

export function countInteractions(): number {
  const r = getDb().prepare(`SELECT COUNT(*) AS n FROM interactions`).get() as { n: number };
  return r.n;
}

export function listActiveMemberOptions(limit = 5000): MemberOption[] {
  return getDb()
    .prepare(
      `SELECT zalo_user_id AS id, display_name AS displayName, role
       FROM members
       WHERE is_active = 1
       ORDER BY LOWER(display_name) ASC, zalo_user_id ASC
       LIMIT @limit`,
    )
    .all({ limit: Math.min(Math.max(limit, 1), 5000) }) as MemberOption[];
}

function tableExists(name: string): boolean {
  const row = getDb()
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = @name`)
    .get({ name }) as { ok: number } | undefined;
  return row !== undefined;
}

/** Thống kê member còn active: count + lần cuối, sắp ít tương tác nhất lên đầu. */
export function listMemberStats(limit = 2000): MemberStatRow[] {
  return getDb()
    .prepare(
      `SELECT m.zalo_user_id, m.display_name, m.role, m.joined_at, m.first_seen_at,
              COUNT(i.id) AS interaction_count,
              MAX(i.ts)   AS last_interaction,
              COALESCE(cw.warning_count, 0) AS warning_count,
              cw.last_warned_at AS last_warned_at
       FROM members m
       LEFT JOIN interactions i ON i.zalo_user_id = m.zalo_user_id
       LEFT JOIN cleanup_warnings cw ON cw.zalo_user_id = m.zalo_user_id
       WHERE m.is_active = 1
       GROUP BY m.zalo_user_id
       ORDER BY interaction_count ASC, last_interaction ASC
       LIMIT @limit`,
    )
    .all({ limit }) as MemberStatRow[];
}

function memberStatsCte(): string {
  return `WITH member_stats AS (
    SELECT m.zalo_user_id, m.display_name, m.role, m.joined_at, m.first_seen_at,
           COUNT(i.id) AS interaction_count,
           MAX(i.ts) AS last_interaction,
           COALESCE(cw.warning_count, 0) AS warning_count,
           cw.last_warned_at AS last_warned_at
    FROM members m
    LEFT JOIN interactions i ON i.zalo_user_id = m.zalo_user_id
    LEFT JOIN cleanup_warnings cw ON cw.zalo_user_id = m.zalo_user_id
    WHERE m.is_active = 1
      AND (@q = '' OR LOWER(m.display_name) LIKE @like OR LOWER(m.zalo_user_id) LIKE @like)
    GROUP BY m.zalo_user_id
  )`;
}

function memberFilterWhere(filters: MemberFilters): string {
  const clauses: string[] = [];
  if (filters.role && filters.role !== "all") clauses.push(`role = @role`);

  switch (filters.activity) {
    case "zero":
      clauses.push(`interaction_count = 0`);
      break;
    case "never":
      clauses.push(`last_interaction IS NULL`);
      break;
    case "recent":
      clauses.push(`last_interaction >= @since30`);
      break;
    case "inactive30":
      clauses.push(`(last_interaction IS NULL OR last_interaction < @since30)`);
      break;
    case "inactive90":
      clauses.push(`(last_interaction IS NULL OR last_interaction < @since90)`);
      break;
    case "warned":
      clauses.push(`warning_count > 0`);
      break;
  }

  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

function memberFilterParams(filters: MemberFilters): Record<string, string | number> {
  const q = filters.q?.trim().toLowerCase() ?? "";
  return {
    q,
    like: `%${q}%`,
    role: filters.role ?? "all",
    since30: Date.now() - 30 * 86400000,
    since90: Date.now() - 90 * 86400000,
    limit: Math.min(Math.max(filters.limit ?? 2000, 1), 5000),
  };
}

function memberSortSql(sort: MemberSort | undefined): string {
  switch (sort) {
    case "interactions":
      return `interaction_count DESC, last_interaction DESC`;
    case "last":
      return `last_interaction IS NULL DESC, last_interaction ASC, interaction_count ASC`;
    case "name":
      return `LOWER(display_name) ASC, zalo_user_id ASC`;
    case "joined":
      return `joined_at IS NULL ASC, joined_at DESC`;
    case "warnings":
      return `warning_count DESC, last_warned_at DESC, interaction_count ASC`;
    case "risk":
    default:
      return `role = 'member' DESC, interaction_count ASC, last_interaction IS NULL DESC, last_interaction ASC`;
  }
}

export function listMemberStatsFiltered(filters: MemberFilters = {}): MemberStatRow[] {
  return getDb()
    .prepare(
      `${memberStatsCte()}
       SELECT *
       FROM member_stats
       ${memberFilterWhere(filters)}
       ORDER BY ${memberSortSql(filters.sort)}
       LIMIT @limit`,
    )
    .all(memberFilterParams(filters)) as MemberStatRow[];
}

export function summarizeMemberStats(filters: MemberFilters = {}): MemberSummary {
  const row = getDb()
    .prepare(
      `${memberStatsCte()}
       SELECT
         COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN role = 'owner' THEN 1 ELSE 0 END), 0) AS owner,
         COALESCE(SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END), 0) AS admin,
         COALESCE(SUM(CASE WHEN role = 'member' THEN 1 ELSE 0 END), 0) AS member,
         COALESCE(SUM(CASE WHEN interaction_count = 0 THEN 1 ELSE 0 END), 0) AS zero_interactions,
         COALESCE(SUM(CASE WHEN last_interaction IS NULL THEN 1 ELSE 0 END), 0) AS never_interacted,
         COALESCE(SUM(CASE WHEN last_interaction IS NULL OR last_interaction < @since30 THEN 1 ELSE 0 END), 0) AS inactive_30d,
         COALESCE(SUM(CASE WHEN last_interaction IS NULL OR last_interaction < @since90 THEN 1 ELSE 0 END), 0) AS inactive_90d,
         COALESCE(SUM(CASE WHEN warning_count > 0 THEN 1 ELSE 0 END), 0) AS warned,
         COALESCE(SUM(CASE WHEN role = 'member' AND interaction_count = 0 AND warning_count > 0 THEN 1 ELSE 0 END), 0) AS removable_candidates,
         COALESCE(SUM(interaction_count), 0) AS total_interactions
       FROM member_stats
       ${memberFilterWhere(filters)}`,
    )
    .get(memberFilterParams(filters)) as MemberSummary;

  return row;
}

export function listRemovals(limit = 500): RemovalRow[] {
  return getDb()
    .prepare(`SELECT * FROM removals ORDER BY removed_at DESC LIMIT @limit`)
    .all({ limit }) as RemovalRow[];
}

export function listScanRuns(limit = 100): ScanRunRow[] {
  return getDb()
    .prepare(`SELECT * FROM scan_runs ORDER BY id DESC LIMIT @limit`)
    .all({ limit }) as ScanRunRow[];
}

// ---- Group message archive ----

function messageWhere(filters: MessageFilters): { sql: string; params: Record<string, string | number | null> } {
  const clauses: string[] = [];
  const q = filters.q?.trim().toLowerCase() ?? "";
  const params: Record<string, string | number | null> = {
    q,
    like: `%${q}%`,
    from: filters.from ?? null,
    to: filters.to ?? null,
    limit: Math.min(Math.max(filters.limit ?? 200, 1), 5000),
  };

  if (q) clauses.push(`(LOWER(text) LIKE @like OR LOWER(display_name) LIKE @like OR zalo_user_id LIKE @like)`);
  if (filters.from) clauses.push(`ts >= @from`);
  if (filters.to) clauses.push(`ts <= @to`);
  if (filters.self === "self") clauses.push(`is_self = 1`);
  if (filters.self === "member") clauses.push(`is_self = 0`);

  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export function countGroupMessages(filters: MessageFilters = {}): number {
  if (!tableExists("group_messages")) return 0;
  const where = messageWhere(filters);
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM group_messages ${where.sql}`)
    .get(where.params) as { n: number };
  return row.n;
}

export function listGroupMessages(filters: MessageFilters = {}): GroupMessageRow[] {
  if (!tableExists("group_messages")) return [];
  const where = messageWhere(filters);
  return getDb()
    .prepare(
      `SELECT *
       FROM group_messages
       ${where.sql}
       ORDER BY ts DESC, id DESC
       LIMIT @limit`,
    )
    .all(where.params) as GroupMessageRow[];
}

// ---- bot_state (config) ----

export function getState(key: string): string | undefined {
  const r = getDb().prepare(`SELECT value FROM bot_state WHERE key = @key`).get({ key }) as
    | { value: string }
    | undefined;
  return r?.value;
}

export function setState(key: string, value: string): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO bot_state (key, value, updated_at) VALUES (@key, @value, @now)
       ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = @now`,
    )
    .run({ key, value, now });
}
