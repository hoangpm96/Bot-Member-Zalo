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
};
