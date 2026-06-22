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
  /** ID group Zalo cần quản lý. Lấy bằng lệnh `list-groups`. */
  groupId: process.env.GROUP_ID?.trim() || "",

  /** Số thành viên muốn giữ lại sau mỗi kỳ (brainstorm: 965). */
  targetMemberCount: readInt("TARGET_MEMBER_COUNT", 965),

  /** Đường dẫn file SQLite. */
  dbPath: process.env.SQLITE_DB_PATH?.trim() || "./data/bot.db",

  /** Thư mục lưu session đăng nhập Zalo. */
  sessionDir,
  /** Session tài khoản co-admin (dùng cho mọi lệnh). */
  sessionPath: path.join(sessionDir, "session.json"),

  /** Số ngày làm nóng trước khi được phép kick (brainstorm: 30). */
  warmupDays: readInt("WARMUP_DAYS", 30),

  /** Dry-run: không thực hiện hành động phá huỷ (kick). M1 luôn nên là true. */
  dryRun: readBool("DRY_RUN", true),

  /** Nghỉ giữa mỗi lần gọi Zalo nặng (ms) — chống flag. */
  zaloThrottleMs: readInt("ZALO_THROTTLE_MS", 1500),

  /** Trần số member xoá trong một kỳ cleanup (brainstorm: 50). */
  maxKicksPerRun: readInt("MAX_KICKS_PER_RUN", 50),

  /** Nghỉ giữa mỗi lần kick thật (brainstorm: 2 phút). */
  kickThrottleMs: readInt("KICK_THROTTLE_MS", 120_000),

  /** File JSON danh sách trắng: [{"id":"...", "note":"..."}] hoặc ["id"]. */
  vipListPath: process.env.VIP_LIST_PATH?.trim() || "./data/vip-list.json",

  /** Cho phép command cleanup-warn gửi cảnh báo vào group. DRY_RUN=1 vẫn chặn gửi. */
  sendGroupWarnings: readBool("SEND_GROUP_WARNINGS", false),

  /** Telegram bot token để duyệt cleanup. Rỗng = fallback CLI/dry-run. */
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || "",

  /** Telegram chat id admin nhận approval/report. */
  telegramChatId: process.env.TELEGRAM_CHAT_ID?.trim() || "",

  /** Timeout chờ duyệt cleanup qua Telegram (brainstorm: 48h). */
  approvalTimeoutHours: readInt("APPROVAL_TIMEOUT_HOURS", 48),
} as const;

export type AppConfig = typeof config;
