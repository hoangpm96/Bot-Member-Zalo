import { config } from "./config.js";
import { getBotState } from "./db/index.js";

/**
 * Config ĐỘNG — đọc lúc cần (không phải lúc import). Ưu tiên giá trị trong DB (bảng
 * bot_state, key 'cfg:*' do web admin panel ghi); nếu chưa có → fallback giá trị .env
 * trong `config`. Nhờ vậy panel sửa số là bot dùng ngay ở kỳ kế tiếp, KHÔNG cần restart.
 *
 * Các giá trị hạ tầng (path, token, dryRun, groupId) vẫn lấy thẳng từ `config` (.env).
 */

/**
 * Đọc int từ bot_state + CLAMP theo [min,max]. Clamp để phòng bot_state bị sửa tay
 * (ngoài web) ra số bậy (âm/quá lớn) làm bot kick sai. Giá trị ngoài range → bỏ
 * (trả null) → fallback .env an toàn.
 */
function dbInt(key: string, min: number, max: number): number | null {
  const v = getBotState(key);
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

/** Đọc bool từ bot_state ("1"/"true" = true). null nếu chưa đặt → caller tự fallback. */
function dbBool(key: string): boolean | null {
  const v = getBotState(key);
  if (v === undefined || v.trim() === "") return null;
  return v === "1" || v.toLowerCase() === "true";
}

export type ModerationAction = "delete_only" | "delete_and_ban";

/**
 * Đọc danh sách từ khoá cấm (JSON mảng string trong bot_state). Lọc rỗng, bỏ trùng (đã
 * lower-case để khớp không phân biệt hoa/thường — vẫn GIỮ DẤU tiếng Việt). Input hỏng → [].
 */
function readBlacklistWords(): string[] {
  const v = getBotState("cfg:blacklist_words");
  if (!v || v.trim() === "") return [];
  let raw: unknown;
  try {
    raw = JSON.parse(v);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const w = String(item ?? "").trim();
    if (!w) continue;
    const key = w.toLocaleLowerCase("vi");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

export const runtimeConfig = {
  get targetMemberCount(): number {
    return dbInt("cfg:target_member_count", 1, 100000) ?? config.targetMemberCount;
  },
  get warmupDays(): number {
    return dbInt("cfg:warmup_days", 0, 365) ?? config.warmupDays;
  },
  get maxKicksPerRun(): number {
    return dbInt("cfg:max_kicks_per_run", 1, 1000) ?? config.maxKicksPerRun;
  },
  get kickThrottleMs(): number {
    return dbInt("cfg:kick_throttle_ms", 1000, 3600000) ?? config.kickThrottleMs;
  },
  get zaloThrottleMs(): number {
    return dbInt("cfg:zalo_throttle_ms", 200, 60000) ?? config.zaloThrottleMs;
  },
  get approvalTimeoutHours(): number {
    return dbInt("cfg:approval_timeout_hours", 1, 240) ?? config.approvalTimeoutHours;
  },

  // ---- Kiểm duyệt real-time theo từ khoá ----

  /** Bật/tắt toàn bộ tính năng lọc từ khoá. Mặc định TẮT (an toàn). */
  get moderationEnabled(): boolean {
    return dbBool("cfg:moderation_enabled") ?? false;
  },
  /** Hành động khi dính từ khoá. Mặc định xoá tin + ban (kick + chặn tham gia lại). */
  get moderationAction(): ModerationAction {
    return getBotState("cfg:moderation_action") === "delete_only" ? "delete_only" : "delete_and_ban";
  },
  /** Danh sách từ khoá cấm (đã chuẩn hoá). */
  get blacklistWords(): string[] {
    return readBlacklistWords();
  },
};
