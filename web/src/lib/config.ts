import { getState, setState } from "./db";
import { CONFIG_KEYS, validateConfig, type ConfigField, type ConfigValues } from "./config-meta";

/**
 * Server-only: đọc/ghi config trong bot_state (DB). Metadata client-safe ở config-meta.ts.
 * Bot đọc các key 'cfg:*' này TRƯỚC khi fallback .env (xem bot/src/runtime-config.ts).
 */

function readNum(key: string): number | null {
  const v = getState(key);
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function readConfig(): ConfigValues {
  return {
    targetMemberCount: readNum(CONFIG_KEYS.targetMemberCount),
    warmupDays: readNum(CONFIG_KEYS.warmupDays),
    maxKicksPerRun: readNum(CONFIG_KEYS.maxKicksPerRun),
    kickThrottleMs: readNum(CONFIG_KEYS.kickThrottleMs),
    zaloThrottleMs: readNum(CONFIG_KEYS.zaloThrottleMs),
    approvalTimeoutHours: readNum(CONFIG_KEYS.approvalTimeoutHours),
  };
}

/** Ghi 1 config sau khi validate. Trả lỗi (string) nếu không hợp lệ, null nếu OK. */
export function writeConfig(field: ConfigField, value: number): string | null {
  const err = validateConfig(field, value);
  if (err) return err;
  setState(CONFIG_KEYS[field], String(value));
  return null;
}
