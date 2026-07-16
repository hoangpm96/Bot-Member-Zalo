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

function ensureWebSchema(database: Database.Database): void {
  database.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_cleanup_draft_items_plan
      ON cleanup_draft_plan_items(draft_plan_id, rank);
  `);
}

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
  ensureWebSchema(db);
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

export interface OverTargetCandidateRow extends MemberStatRow {
  rank: number;
  action: "grace" | "remove";
  reason: string;
}

export interface OverTargetCandidatePlan {
  total: number;
  target: number;
  overTarget: number;
  maxKicks: number;
  needToReview: number;
  eligibleCount: number;
  graceCount: number;
  removableCount: number;
  candidates: OverTargetCandidateRow[];
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

export interface MemberSyncRunRow {
  id: number;
  requested_by: string;
  started_at: number;
  finished_at: number | null;
  status: "running" | "done" | "failed";
  group_id: string | null;
  group_name: string | null;
  member_count: number | null;
  snapshot_count: number | null;
  upserted: number | null;
  marked_left: number | null;
  error: string | null;
}

export interface MemberEventRow {
  id: number;
  zalo_user_id: string;
  display_name: string;
  role: "owner" | "admin" | "member" | null;
  event_type: string;
  source: string;
  sync_run_id: number | null;
  ts: number;
  note: string | null;
}

export interface MemberEventFilters {
  eventType?: string;
  source?: string;
  from?: number | null;
  to?: number | null;
  limit?: number;
}

export interface BotHealth {
  reason?: string;
  pid?: number;
  startedAt?: number;
  heartbeatAt?: number;
  uptimeMs?: number;
  socketState?: string;
  lastSocketError?: string | null;
  messageEvents?: number;
  reactionEvents?: number;
  selfEvents?: number;
  totalEvents?: number;
  lastEventAt?: number | null;
  lastEventType?: string | null;
  lastEventSender?: string;
}

export interface PermissionCheckStatus {
  checkedAt?: number;
  requestedBy?: string;
  groupId?: string;
  groupName?: string;
  ownId?: string;
  role?: string;
  canReadMembers?: boolean;
  likelyCanKick?: boolean;
  likelyCanDeleteMessages?: boolean;
  likelyCanBlockMembers?: boolean;
  issues?: string[];
  error?: string;
}

export interface BotErrorRow {
  id: number;
  source: string;
  code: string;
  message: string;
  detail: string | null;
  created_at: number;
}

export interface SchemaMigrationRow {
  version: string;
  applied_at: number;
  note: string | null;
}

export interface GroupMediaEventRow {
  id: number;
  thread_id: string;
  message_id: string;
  zalo_user_id: string;
  display_name: string;
  media_type: "image" | "video";
  media_count: number;
  msg_type: string;
  ts: number;
  is_self: number;
  source: string;
  created_at: number;
}

export interface MediaSummary {
  imageEvents: number;
  imageCount: number;
  videoEvents: number;
  videoCount: number;
}

export interface CleanupPlanItemRow {
  id: number;
  scan_run_id: number;
  zalo_user_id: string;
  display_name: string;
  interaction_count: number;
  last_interaction: number | null;
  rank: number;
  status: "planned" | "removed" | "failed" | "skipped";
  error: string | null;
  updated_at: number;
}

export interface CleanupDraftPlanRow {
  id: number;
  created_at: number;
  target_count: number;
  member_count: number;
  over_target: number;
  max_kicks: number;
  candidate_count: number;
  grace_count: number;
  removable_count: number;
  note: string | null;
}

export interface CleanupDraftComparison {
  plan: CleanupDraftPlanRow;
  stillActive: number;
  noLongerActive: number;
  interactedMore: number;
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

export type LeaderboardPeriod = "7d" | "30d" | "all";

export interface LeaderboardRow {
  rank: number;
  display_name: string;
  interaction_count: number;
  message_count: number;
  reaction_count: number;
  vote_count: number;
  other_count: number;
  last_interaction: number;
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

/**
 * Bảng xếp hạng public: chỉ trả tên + số liệu tổng hợp, tuyệt đối không trả Zalo ID.
 * Mỗi row interactions được tính là 1 lượt. Chỉ xếp hạng member còn active.
 */
export function listLeaderboard(period: LeaderboardPeriod, limit = 50): LeaderboardRow[] {
  const now = Date.now();
  const since =
    period === "7d"
      ? now - 7 * 86400000
      : period === "30d"
        ? now - 30 * 86400000
        : 0;

  const rows = getDb()
    .prepare(
      `SELECT
         m.display_name,
         COUNT(i.id) AS interaction_count,
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

export function getScanRun(id: number): ScanRunRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM scan_runs WHERE id = @id`)
    .get({ id }) as ScanRunRow | undefined;
}

export function getLatestPlanRun(): ScanRunRow | undefined {
  return getDb()
    .prepare(
      `SELECT r.*
       FROM scan_runs r
       WHERE EXISTS (SELECT 1 FROM cleanup_plan_items i WHERE i.scan_run_id = r.id)
       ORDER BY r.id DESC
       LIMIT 1`,
    )
    .get() as ScanRunRow | undefined;
}

export function listCleanupPlanItems(scanRunId: number): CleanupPlanItemRow[] {
  return getDb()
    .prepare(
      `SELECT *
       FROM cleanup_plan_items
       WHERE scan_run_id = @scanRunId
       ORDER BY rank ASC`,
    )
    .all({ scanRunId }) as CleanupPlanItemRow[];
}

export function setCleanupPlanItemStatus(input: {
  id: number;
  status: "planned" | "skipped";
  error?: string | null;
}): boolean {
  const res = getDb()
    .prepare(
      `UPDATE cleanup_plan_items
       SET status = @status, error = @error, updated_at = @now
       WHERE id = @id
         AND status IN ('planned', 'skipped', 'failed')
         AND EXISTS (
           SELECT 1
           FROM scan_runs r
           WHERE r.id = cleanup_plan_items.scan_run_id
             AND r.status IN ('planned', 'pending_approval', 'failed')
         )`,
    )
    .run({
      id: input.id,
      status: input.status,
      error: input.status === "skipped" ? input.error ?? "Admin bỏ chọn trên dashboard." : null,
      now: Date.now(),
    });
  return res.changes > 0;
}

function readJsonState<T>(key: string): T | null {
  const raw = getState(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getBotHealth(): BotHealth | null {
  return readJsonState<BotHealth>("bot_health");
}

export function getPermissionCheckStatus(): PermissionCheckStatus | null {
  return readJsonState<PermissionCheckStatus>("permission_check");
}

export function isBotHealthFresh(health: BotHealth | null, maxAgeMs = 2 * 60 * 1000): boolean {
  return Boolean(health?.heartbeatAt && Date.now() - health.heartbeatAt <= maxAgeMs);
}

export function listBotErrors(limit = 100): BotErrorRow[] {
  if (!tableExists("bot_errors")) return [];
  return getDb()
    .prepare(
      `SELECT *
       FROM bot_errors
       ORDER BY created_at DESC, id DESC
       LIMIT @limit`,
    )
    .all({ limit: Math.min(Math.max(limit, 1), 500) }) as BotErrorRow[];
}

export function listSchemaMigrations(limit = 20): SchemaMigrationRow[] {
  if (!tableExists("schema_migrations")) return [];
  return getDb()
    .prepare(
      `SELECT *
       FROM schema_migrations
       ORDER BY applied_at DESC
       LIMIT @limit`,
    )
    .all({ limit: Math.min(Math.max(limit, 1), 100) }) as SchemaMigrationRow[];
}

export function getLatestMemberSyncRun(): MemberSyncRunRow | undefined {
  if (!tableExists("member_sync_runs")) return undefined;
  return getDb()
    .prepare(`SELECT * FROM member_sync_runs ORDER BY id DESC LIMIT 1`)
    .get() as MemberSyncRunRow | undefined;
}

function memberEventWhere(filters: MemberEventFilters): { sql: string; params: Record<string, string | number | null> } {
  const clauses: string[] = [];
  const params: Record<string, string | number | null> = {
    eventType: filters.eventType ?? "all",
    source: filters.source ?? "all",
    from: filters.from ?? null,
    to: filters.to ?? null,
    limit: Math.min(Math.max(filters.limit ?? 200, 1), 5000),
  };
  if (filters.eventType && filters.eventType !== "all") clauses.push(`event_type = @eventType`);
  if (filters.source && filters.source !== "all") clauses.push(`source = @source`);
  if (filters.from) clauses.push(`ts >= @from`);
  if (filters.to) clauses.push(`ts <= @to`);
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export function listMemberEvents(filtersOrLimit: MemberEventFilters | number = 200): MemberEventRow[] {
  if (!tableExists("member_events")) return [];
  const filters = typeof filtersOrLimit === "number" ? { limit: filtersOrLimit } : filtersOrLimit;
  const where = memberEventWhere(filters);
  return getDb()
    .prepare(
      `SELECT *
       FROM member_events
       ${where.sql}
       ORDER BY ts DESC, id DESC
       LIMIT @limit`,
    )
    .all(where.params) as MemberEventRow[];
}

export function countMemberEvents(filters: MemberEventFilters = {}): number {
  if (!tableExists("member_events")) return 0;
  const where = memberEventWhere(filters);
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM member_events ${where.sql}`)
    .get(where.params) as { n: number };
  return row.n;
}

export function buildOverTargetCandidatePlan(input: {
  target: number;
  maxKicks: number;
  vipIds?: string[];
  now?: number;
}): OverTargetCandidatePlan {
  const total = countActiveMembers();
  const overTarget = Math.max(0, total - input.target);
  const needToReview = Math.min(overTarget, input.maxKicks);
  const vipIds = [...new Set(input.vipIds ?? [])].filter(Boolean);
  const cycleStart = (() => {
    const d = new Date(input.now ?? Date.now());
    return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
  })();
  const vipParams = Object.fromEntries(vipIds.map((id, idx) => [`vip${idx}`, id]));
  const vipClause = vipIds.length ? `AND m.zalo_user_id NOT IN (${vipIds.map((_, idx) => `@vip${idx}`).join(", ")})` : "";
  const params = {
    cycleStart,
    limit: Math.max(needToReview, 1),
    ...vipParams,
  };
  const cte = `WITH member_stats AS (
    SELECT m.zalo_user_id, m.display_name, m.role, m.joined_at, m.first_seen_at,
           COUNT(i.id) AS interaction_count,
           MAX(i.ts) AS last_interaction,
           COALESCE(cw.warning_count, 0) AS warning_count,
           cw.last_warned_at AS last_warned_at
    FROM members m
    LEFT JOIN interactions i ON i.zalo_user_id = m.zalo_user_id
    LEFT JOIN cleanup_warnings cw ON cw.zalo_user_id = m.zalo_user_id
    WHERE m.is_active = 1
      AND m.role = 'member'
      AND m.first_seen_at < @cycleStart
      AND (m.joined_at IS NULL OR m.joined_at < @cycleStart)
      ${vipClause}
    GROUP BY m.zalo_user_id
  )`;

  const eligible = getDb()
    .prepare(`${cte} SELECT COUNT(*) AS n FROM member_stats`)
    .get(params) as { n: number };

  const rows =
    needToReview > 0
      ? (getDb()
          .prepare(
            `${cte}
             SELECT *
             FROM member_stats
             ORDER BY interaction_count ASC, last_interaction ASC
             LIMIT @limit`,
          )
          .all(params) as MemberStatRow[])
      : [];

  const candidates = rows.map((row, idx): OverTargetCandidateRow => {
    const action = row.interaction_count === 0 && row.warning_count === 0 ? "grace" : "remove";
    return {
      ...row,
      rank: idx + 1,
      action,
      reason:
        row.interaction_count === 0
          ? row.warning_count === 0
            ? "0 tương tác, kỳ đầu sẽ ân hạn"
            : "0 tương tác, đã từng cảnh báo"
          : `${row.interaction_count} tương tác`,
    };
  });

  return {
    total,
    target: input.target,
    overTarget,
    maxKicks: input.maxKicks,
    needToReview,
    eligibleCount: eligible.n,
    graceCount: candidates.filter((c) => c.action === "grace").length,
    removableCount: candidates.filter((c) => c.action === "remove").length,
    candidates,
  };
}

export function saveCleanupDraftPlan(plan: OverTargetCandidatePlan, note?: string): number {
  const now = Date.now();
  const db = getDb();
  const tx = db.transaction(() => {
    const res = db
      .prepare(
        `INSERT INTO cleanup_draft_plans
           (created_at, target_count, member_count, over_target, max_kicks,
            candidate_count, grace_count, removable_count, note)
         VALUES
           (@createdAt, @target, @total, @overTarget, @maxKicks,
            @candidateCount, @graceCount, @removableCount, @note)`,
      )
      .run({
        createdAt: now,
        target: plan.target,
        total: plan.total,
        overTarget: plan.overTarget,
        maxKicks: plan.maxKicks,
        candidateCount: plan.candidates.length,
        graceCount: plan.graceCount,
        removableCount: plan.removableCount,
        note: note ?? null,
      });
    const draftPlanId = Number(res.lastInsertRowid);
    const stmt = db.prepare(
      `INSERT INTO cleanup_draft_plan_items
         (draft_plan_id, zalo_user_id, display_name, interaction_count, last_interaction,
          warning_count, rank, action, reason)
       VALUES
         (@draftPlanId, @zaloUserId, @displayName, @interactionCount, @lastInteraction,
          @warningCount, @rank, @action, @reason)`,
    );
    for (const item of plan.candidates) {
      stmt.run({
        draftPlanId,
        zaloUserId: item.zalo_user_id,
        displayName: item.display_name,
        interactionCount: item.interaction_count,
        lastInteraction: item.last_interaction,
        warningCount: item.warning_count,
        rank: item.rank,
        action: item.action,
        reason: item.reason,
      });
    }
    return draftPlanId;
  });
  return tx() as number;
}

export function getLatestCleanupDraftComparison(): CleanupDraftComparison | null {
  const plan = getDb()
    .prepare(`SELECT * FROM cleanup_draft_plans ORDER BY id DESC LIMIT 1`)
    .get() as CleanupDraftPlanRow | undefined;
  if (!plan) return null;

  const row = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN m.is_active = 1 THEN 1 ELSE 0 END), 0) AS stillActive,
         COALESCE(SUM(CASE WHEN m.is_active IS NULL OR m.is_active != 1 THEN 1 ELSE 0 END), 0) AS noLongerActive,
         COALESCE(SUM(CASE WHEN cur.interaction_count > i.interaction_count THEN 1 ELSE 0 END), 0) AS interactedMore
       FROM cleanup_draft_plan_items i
       LEFT JOIN members m ON m.zalo_user_id = i.zalo_user_id
       LEFT JOIN (
         SELECT zalo_user_id, COUNT(*) AS interaction_count
         FROM interactions
         GROUP BY zalo_user_id
       ) cur ON cur.zalo_user_id = i.zalo_user_id
       WHERE i.draft_plan_id = @id`,
    )
    .get({ id: plan.id }) as {
    stillActive: number;
    noLongerActive: number;
    interactedMore: number;
  };

  return { plan, ...row };
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

function mediaWhere(filters: MessageFilters): { sql: string; params: Record<string, string | number | null> } {
  const clauses: string[] = [];
  const q = filters.q?.trim().toLowerCase() ?? "";
  const params: Record<string, string | number | null> = {
    q,
    like: `%${q}%`,
    from: filters.from ?? null,
    to: filters.to ?? null,
    limit: Math.min(Math.max(filters.limit ?? 200, 1), 5000),
  };

  if (q) clauses.push(`(LOWER(display_name) LIKE @like OR zalo_user_id LIKE @like OR media_type LIKE @like)`);
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
  const where = mediaWhere(filters);
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM group_messages ${where.sql}`)
    .get(where.params) as { n: number };
  return row.n;
}

export function listGroupMessages(filters: MessageFilters = {}): GroupMessageRow[] {
  if (!tableExists("group_messages")) return [];
  const where = mediaWhere(filters);
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

export function summarizeGroupMedia(filters: MessageFilters = {}): MediaSummary {
  if (!tableExists("group_media_events")) {
    return { imageEvents: 0, imageCount: 0, videoEvents: 0, videoCount: 0 };
  }
  const where = messageWhere(filters);
  const row = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN media_type = 'image' THEN 1 ELSE 0 END), 0) AS imageEvents,
         COALESCE(SUM(CASE WHEN media_type = 'image' THEN media_count ELSE 0 END), 0) AS imageCount,
         COALESCE(SUM(CASE WHEN media_type = 'video' THEN 1 ELSE 0 END), 0) AS videoEvents,
         COALESCE(SUM(CASE WHEN media_type = 'video' THEN media_count ELSE 0 END), 0) AS videoCount
       FROM group_media_events
       ${where.sql}`,
    )
    .get(where.params) as MediaSummary;
  return row;
}

export function listGroupMediaEvents(filters: MessageFilters = {}): GroupMediaEventRow[] {
  if (!tableExists("group_media_events")) return [];
  const where = messageWhere(filters);
  return getDb()
    .prepare(
      `SELECT *
       FROM group_media_events
       ${where.sql}
       ORDER BY ts DESC, id DESC
       LIMIT @limit`,
    )
    .all(where.params) as GroupMediaEventRow[];
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
