import { getState, setState } from "./db";

/**
 * Server-only: đọc/ghi cấu hình kiểm duyệt từ khoá trong bot_state (DB). Bot đọc lại các
 * key này ở runtime-config.ts (TẮT mặc định). Web KHÔNG gọi Zalo — chỉ ghi config.
 *
 * Keys:
 *   cfg:moderation_enabled  "1" | "0"
 *   cfg:moderation_action   "delete_only" | "delete_and_ban"
 *   cfg:blacklist_words     JSON mảng string
 */

export const MODERATION_KEYS = {
  enabled: "cfg:moderation_enabled",
  action: "cfg:moderation_action",
  words: "cfg:blacklist_words",
} as const;

export type ModerationAction = "delete_only" | "delete_and_ban";

export interface ModerationConfig {
  enabled: boolean;
  action: ModerationAction;
  words: string[];
}

/** Tối đa số từ khoá — chặn input vô hạn làm chậm listener. */
export const MAX_BLACKLIST_WORDS = 500;
/** Tối đa độ dài 1 từ khoá. */
export const MAX_WORD_LENGTH = 100;

export function readModerationConfig(): ModerationConfig {
  const enabled = getState(MODERATION_KEYS.enabled) === "1";
  const action: ModerationAction =
    getState(MODERATION_KEYS.action) === "delete_only" ? "delete_only" : "delete_and_ban";
  return { enabled, action, words: readWords() };
}

function readWords(): string[] {
  const raw = getState(MODERATION_KEYS.words);
  if (!raw || raw.trim() === "") return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => String(x ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Chuẩn hoá + validate danh sách từ. Bỏ trùng (không phân biệt hoa/thường). */
export function cleanWords(input: unknown): { words: string[]; error: string | null } {
  if (!Array.isArray(input)) return { words: [], error: "Danh sách từ khoá không hợp lệ." };
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    // NFC để khớp nhất quán với matcher của bot (xem moderation.ts normalizeForMatch).
    const w = String(raw ?? "").normalize("NFC").trim();
    if (!w) continue;
    if (w.length > MAX_WORD_LENGTH) return { words: [], error: `Từ khoá quá dài (tối đa ${MAX_WORD_LENGTH} ký tự): "${w.slice(0, 30)}…"` };
    const key = w.toLocaleLowerCase("vi");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  if (out.length > MAX_BLACKLIST_WORDS) {
    return { words: [], error: `Tối đa ${MAX_BLACKLIST_WORDS} từ khoá.` };
  }
  return { words: out, error: null };
}

/** Ghi toàn bộ config kiểm duyệt. Trả lỗi (string) nếu input bậy, null nếu OK. */
export function writeModerationConfig(input: {
  enabled?: unknown;
  action?: unknown;
  words?: unknown;
}): string | null {
  if (input.words !== undefined) {
    const { words, error } = cleanWords(input.words);
    if (error) return error;
    setState(MODERATION_KEYS.words, JSON.stringify(words));
  }
  if (input.enabled !== undefined) {
    setState(MODERATION_KEYS.enabled, input.enabled ? "1" : "0");
  }
  if (input.action !== undefined) {
    const action = input.action === "delete_only" ? "delete_only" : "delete_and_ban";
    setState(MODERATION_KEYS.action, action);
  }
  return null;
}
