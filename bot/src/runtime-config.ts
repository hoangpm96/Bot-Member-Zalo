import { config } from "./config.js";
import { getBotState } from "./db/index.js";

/**
 * Config ĐỘNG — đọc lúc cần (không phải lúc import). Ưu tiên giá trị trong DB (bảng
 * bot_state, key 'cfg:*' do web admin panel ghi); nếu chưa có → fallback giá trị .env
 * trong `config`. Nhờ vậy panel sửa số là bot dùng ngay ở kỳ kế tiếp, KHÔNG cần restart.
 *
 * Các giá trị hạ tầng (path, token, dryRun, groupId) vẫn lấy thẳng từ `config` (.env).
 */

function dbInt(key: string): number | null {
  const v = getBotState(key);
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

export const runtimeConfig = {
  get targetMemberCount(): number {
    return dbInt("cfg:target_member_count") ?? config.targetMemberCount;
  },
  get warmupDays(): number {
    return dbInt("cfg:warmup_days") ?? config.warmupDays;
  },
  get maxKicksPerRun(): number {
    return dbInt("cfg:max_kicks_per_run") ?? config.maxKicksPerRun;
  },
  get kickThrottleMs(): number {
    return dbInt("cfg:kick_throttle_ms") ?? config.kickThrottleMs;
  },
  get zaloThrottleMs(): number {
    return dbInt("cfg:zalo_throttle_ms") ?? config.zaloThrottleMs;
  },
  get approvalTimeoutHours(): number {
    return dbInt("cfg:approval_timeout_hours") ?? config.approvalTimeoutHours;
  },
};
