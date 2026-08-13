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

function readOptionalPositiveInt(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`Env ${name} phải là số nguyên dương, nhận được: "${raw}"`);
  }
  return n;
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

  /** In heartbeat listener mỗi N ms. 0 = tắt. */
  listenerHeartbeatMs: readInt("LISTENER_HEARTBEAT_MS", 60_000),

  /** Listener chủ động đồng bộ snapshot member mỗi N ms. 0 = tắt sync chủ động sau startup. */
  listenerMemberSyncIntervalMs: readInt("LISTENER_MEMBER_SYNC_INTERVAL_MS", 30 * 60 * 1000),

  /** Log mỗi N event message/reaction nhận được. 1 = log từng event, 0 = tắt. */
  listenerEventLogEvery: readInt("LISTENER_EVENT_LOG_EVERY", 1),

  /** Cho phép zca-js emit event do chính tài khoản bot gửi để lưu và tính interaction. */
  zaloSelfListen: readBool("ZALO_SELF_LISTEN", true),

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

  /** Bật sao chép message Zalo live sang một Telegram chat/channel/topic riêng. */
  telegramForwardEnabled: readBool("TELEGRAM_FORWARD_ENABLED", false),

  /** Bot Telegram riêng chỉ dùng cho luồng forward Zalo, không dùng chung bot notification. */
  telegramForwardBotToken: process.env.TELEGRAM_FORWARD_BOT_TOKEN?.trim() || "",

  /** ID supergroup/channel nhận message Zalo. Tách khỏi chat admin dùng để duyệt cleanup. */
  telegramForwardChatId: process.env.TELEGRAM_FORWARD_CHAT_ID?.trim() || "",

  /** message_thread_id của forum topic. Để trống nếu đích là channel/chat thường. */
  telegramForwardTopicId: readOptionalPositiveInt("TELEGRAM_FORWARD_TOPIC_ID"),

  /** Timeout chờ duyệt cleanup qua Telegram (brainstorm: 48h). */
  approvalTimeoutHours: readInt("APPROVAL_TIMEOUT_HOURS", 48),

  /**
   * Các group Zalo nhận bản tóm tắt hằng ngày, phân tách dấu phẩy (lấy ID bằng
   * `npm run list-groups`). Có thể gồm cả GROUP_ID (nhóm chính). Rỗng = không gửi Zalo.
   */
  summaryGroupIds: [
    ...new Set(
      (process.env.SUMMARY_GROUP_ID ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== ""),
    ),
  ],

  /** Chat/channel Telegram nhận bản tóm tắt (vd @tenchannel hoặc -100...). Rỗng = không gửi Telegram. */
  summaryTelegramChatId: process.env.SUMMARY_TELEGRAM_CHAT_ID?.trim() || "",

  /** message_thread_id nếu đích Telegram là forum topic. Trống nếu là channel/chat thường. */
  summaryTelegramTopicId: readOptionalPositiveInt("SUMMARY_TELEGRAM_TOPIC_ID"),

  /** Bot token riêng cho đích tóm tắt Telegram. Rỗng = dùng chung TELEGRAM_BOT_TOKEN. */
  summaryTelegramBotToken: process.env.SUMMARY_TELEGRAM_BOT_TOKEN?.trim() || "",

  /** API key DeepSeek cho tóm tắt hằng ngày (https://platform.deepseek.com). Rỗng = tắt. */
  deepseekApiKey: process.env.DEEPSEEK_API_KEY?.trim() || "",

  /**
   * Model DeepSeek dùng để tóm tắt. deepseek-v4-flash: bản nhanh/rẻ dòng V4,
   * test hiểu ngữ cảnh hội thoại tốt; cần sâu hơn nữa thì deepseek-v4-pro.
   */
  deepseekModel: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash",

  /** Facebook Page nhận bản tin hằng ngày (Pages API). Rỗng cả 2 = tắt daily-fb-post. */
  fbPageId: process.env.FB_PAGE_ID?.trim() || "",
  /** Page access token KHÔNG hết hạn (lấy từ /me/accounts với user token dài hạn). */
  fbPageToken: process.env.FB_PAGE_TOKEN?.trim() || "",

  /** API key Beeknoee (sk-bee-...) — tầng sinh ảnh dự phòng. Rỗng = bỏ tầng này. */
  beeknoeeApiKey: process.env.BEEKNOEE_API_KEY?.trim() || "",
  /** Endpoint sinh ảnh OpenAI-compatible ưu tiên (cùng cơ chế ai4ba). Rỗng = bỏ tầng này. */
  fbImageBaseUrl: process.env.FB_IMAGE_BASE_URL?.trim() || "",
  fbImageApiKey: process.env.FB_IMAGE_API_KEY?.trim() || "",
  fbImageModel: process.env.FB_IMAGE_MODEL?.trim() || "",

  /**
   * Số tin nhắn Zalo tối đa cho một bản tóm tắt (1-9). Số tin thực tế tự co
   * giãn theo nội dung; tăng số này = ngày sôi động được tóm tắt chi tiết hơn.
   */
  summaryMaxParts: Math.min(9, Math.max(1, readInt("SUMMARY_MAX_PARTS", 3))),

  /**
   * Giãn cách giữa các GROUP ZALO khi gửi tóm tắt (phút, kèm jitter ngẫu nhiên
   * +0-25%) — cùng một bản tin đập vào nhiều group cùng giây trông rất "bot".
   * 0 = gửi liền nhau. Không áp dụng cho Telegram.
   */
  summaryGroupGapMinutes: Math.max(0, readInt("SUMMARY_GROUP_GAP_MINUTES", 10)),
} as const;

export type AppConfig = typeof config;
