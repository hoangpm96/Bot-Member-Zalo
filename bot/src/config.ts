import "dotenv/config";
import path from "node:path";

/**
 * Đọc + validate cấu hình từ env (.env). Mọi số liệu nghiệp vụ (965, warmup 30 ngày,
 * throttle) đến từ đây — KHÔNG hardcode rải rác trong code.
 */

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`Env ${name} phải là số nguyên, nhận được: "${raw}"`);
  }
  return n;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

const sessionDir = process.env.SESSION_DIR?.trim() || "./data";

export const config = {
  /** ID group Zalo cần quản lý. Rỗng ở Milestone 1 đầu (lấy được qua export-members). */
  groupId: process.env.GROUP_ID?.trim() || "",

  /** Số thành viên muốn giữ lại sau mỗi kỳ (brainstorm: 965). */
  targetMemberCount: readInt("TARGET_MEMBER_COUNT", 965),

  /** Đường dẫn file SQLite. */
  dbPath: process.env.SQLITE_DB_PATH?.trim() || "./data/bot.db",

  /** Thư mục lưu session đăng nhập Zalo. */
  sessionDir,
  /** Session tài khoản phụ (vận hành: listener). */
  operatorSessionPath: path.join(sessionDir, "session-operator.json"),
  /** Session tài khoản chính (chỉ init-seed, read-only). */
  ownerSessionPath: path.join(sessionDir, "session-owner.json"),

  /** Số ngày làm nóng trước khi được phép kick (brainstorm: 30). */
  warmupDays: readInt("WARMUP_DAYS", 30),

  /** Dry-run: không thực hiện hành động phá huỷ (kick). M1 luôn nên là true. */
  dryRun: readBool("DRY_RUN", true),

  /** Nghỉ giữa mỗi lần gọi Zalo nặng (ms) — chống flag. */
  zaloThrottleMs: readInt("ZALO_THROTTLE_MS", 1500),

  /** init-seed: số tháng lịch sử chat tối đa kéo về (0 = tối đa tới trần). */
  seedMaxMonths: readInt("SEED_MAX_MONTHS", 0),
  /** init-seed: trần số trang lịch sử chat (chặn vòng lặp / tránh flag). */
  seedMaxPages: readInt("SEED_MAX_PAGES", 200),
} as const;

export type AppConfig = typeof config;
