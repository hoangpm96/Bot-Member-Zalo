/**
 * Metadata config — CLIENT-SAFE (không import DB / node:*). Dùng chung cho client form
 * và server. Logic đọc/ghi DB nằm ở lib/config.ts (server-only).
 */

export const CONFIG_KEYS = {
  targetMemberCount: "cfg:target_member_count",
  warmupDays: "cfg:warmup_days",
  maxKicksPerRun: "cfg:max_kicks_per_run",
  kickThrottleMs: "cfg:kick_throttle_ms",
  zaloThrottleMs: "cfg:zalo_throttle_ms",
  approvalTimeoutHours: "cfg:approval_timeout_hours",
} as const;

export type ConfigField = keyof typeof CONFIG_KEYS;

export interface ConfigValues {
  targetMemberCount: number | null;
  warmupDays: number | null;
  maxKicksPerRun: number | null;
  kickThrottleMs: number | null;
  zaloThrottleMs: number | null;
  approvalTimeoutHours: number | null;
}

/** Mặc định (khớp brainstorm) — placeholder khi chưa đặt trong DB. */
export const CONFIG_DEFAULTS: Record<ConfigField, number> = {
  targetMemberCount: 965,
  warmupDays: 30,
  maxKicksPerRun: 50,
  kickThrottleMs: 120000,
  zaloThrottleMs: 1500,
  approvalTimeoutHours: 48,
};

export const CONFIG_META: Record<
  ConfigField,
  { label: string; unit: string; min: number; max: number; hint: string }
> = {
  targetMemberCount: { label: "Số thành viên giữ lại", unit: "người", min: 1, max: 100000, hint: "Mỗi kỳ kéo nhóm về con số này." },
  warmupDays: { label: "Số ngày làm nóng", unit: "ngày", min: 0, max: 365, hint: "Bot chỉ quan sát, chưa kick, trong N ngày đầu." },
  maxKicksPerRun: { label: "Trần kick mỗi kỳ", unit: "người", min: 1, max: 1000, hint: "Tối đa kick bao nhiêu người trong 1 kỳ." },
  kickThrottleMs: { label: "Nghỉ giữa mỗi lần kick", unit: "ms", min: 1000, max: 3600000, hint: "Chống Zalo flag. 120000 = 2 phút." },
  zaloThrottleMs: { label: "Nghỉ giữa call Zalo nặng", unit: "ms", min: 200, max: 60000, hint: "Throttle khi đọc member/poll." },
  approvalTimeoutHours: { label: "Timeout chờ duyệt", unit: "giờ", min: 1, max: 240, hint: "Không phản hồi sau N giờ thì tự kick." },
};

/** Validate giá trị theo CONFIG_META. Trả lỗi (string) nếu sai, null nếu OK. */
export function validateConfig(field: ConfigField, value: number): string | null {
  const meta = CONFIG_META[field];
  if (!Number.isFinite(value) || !Number.isInteger(value)) return `${meta.label} phải là số nguyên.`;
  if (value < meta.min || value > meta.max) {
    return `${meta.label} phải trong khoảng ${meta.min}–${meta.max}.`;
  }
  return null;
}
