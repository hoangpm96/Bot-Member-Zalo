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

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(
      `Không tìm thấy DB của bot tại ${DB_PATH}. Chạy bot (npm start) ít nhất 1 lần, ` +
        `hoặc đặt WEB_DB_PATH trỏ đúng file bot.db.`,
    );
  }
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
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

/** Thống kê member còn active: count + lần cuối, sắp ít tương tác nhất lên đầu. */
export function listMemberStats(limit = 2000): MemberStatRow[] {
  return getDb()
    .prepare(
      `SELECT m.zalo_user_id, m.display_name, m.role, m.joined_at, m.first_seen_at,
              COUNT(i.id) AS interaction_count,
              MAX(i.ts)   AS last_interaction
       FROM members m
       LEFT JOIN interactions i ON i.zalo_user_id = m.zalo_user_id
       WHERE m.is_active = 1
       GROUP BY m.zalo_user_id
       ORDER BY interaction_count ASC, last_interaction ASC
       LIMIT @limit`,
    )
    .all({ limit }) as MemberStatRow[];
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
