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
export type InteractionSource = "listener" | "seed";

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
