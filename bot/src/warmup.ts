import { getBotState, setBotState } from "./db/index.js";
import { runtimeConfig } from "./runtime-config.js";

/**
 * Quản lý "giai đoạn làm nóng" (brainstorm Mục 4 + 7.2):
 *  - Bot chỉ quan sát WARMUP_DAYS ngày đầu, CHƯA kick.
 *  - Kỳ dọn dẹp đầu tiên (tháng đầu) bỏ qua kick hoàn toàn.
 * Trạng thái lưu trong bảng bot_state (key-value) để bền qua restart.
 *
 * Listener gọi ensureWarmupStarted lúc khởi động; job kick gọi isWarmupComplete() /
 * markFirstCycleSkipped() để quyết định có được kick chưa.
 */

const KEY_WARMUP_STARTED_AT = "warmup_started_at";
const KEY_FIRST_CYCLE_SKIPPED = "first_cycle_skipped";

/** Ghi mốc bắt đầu thu thập dữ liệu (chỉ ghi 1 lần, lần bot chạy đầu tiên). */
export function ensureWarmupStarted(now: number): number {
  const existing = getBotState(KEY_WARMUP_STARTED_AT);
  if (existing) return Number(existing);
  setBotState(KEY_WARMUP_STARTED_AT, String(now), now);
  return now;
}

function getWarmupStartedAt(): number | null {
  const v = getBotState(KEY_WARMUP_STARTED_AT);
  return v ? Number(v) : null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Số ngày đã thu thập tính tới `now`. */
export function daysCollected(now: number): number {
  const start = getWarmupStartedAt();
  if (start === null) return 0;
  return Math.floor((now - start) / MS_PER_DAY);
}

/** Đã đủ WARMUP_DAYS chưa? (điều kiện cần để kick — M2 dùng) */
export function isWarmupComplete(now: number): boolean {
  return daysCollected(now) >= runtimeConfig.warmupDays;
}

/** Số ngày còn lại của giai đoạn làm nóng (>= 0). */
export function warmupDaysRemaining(now: number): number {
  return Math.max(0, runtimeConfig.warmupDays - daysCollected(now));
}

/** Kỳ dọn dẹp đầu tiên đã được bỏ qua chưa? (M2 dùng) */
export function isFirstCycleSkipped(): boolean {
  return getBotState(KEY_FIRST_CYCLE_SKIPPED) === "1";
}

export function markFirstCycleSkipped(now: number): void {
  setBotState(KEY_FIRST_CYCLE_SKIPPED, "1", now);
}
