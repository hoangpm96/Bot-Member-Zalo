/**
 * Lọc tin nhắn theo từ khoá cấm (blacklist) — phần SO KHỚP THUẦN (không side-effect, dễ test).
 * Side-effect (xoá tin/ban) nằm ở listener; module này chỉ trả "có dính từ nào".
 *
 * Quy tắc khớp (chốt với người dùng):
 *  - NGUYÊN TỪ: keyword phải đứng thành từ riêng, không phải substring (tránh "damn" trong
 *    "amsterdam"). Ranh giới từ = mép giữa ký tự chữ/số (\p{L}\p{N}\p{M}) và phần còn lại.
 *  - KHÔNG phân biệt hoa/thường: so sánh sau toLocaleLowerCase("vi").
 *  - GIỮ DẤU tiếng Việt: KHÔNG bỏ dấu — "cam" khác "cấm".
 *  - Keyword nhiều từ (cụm có dấu cách) vẫn khớp, miễn nằm trọn vẹn theo ranh giới từ.
 */

import fs from "node:fs";
import { config } from "./config.js";

/** Ký tự được coi là "trong một từ" (chữ + số + dấu kết hợp Unicode, vd dấu thanh tiếng Việt). */
const WORD_CHAR = "\\p{L}\\p{N}\\p{M}";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Chuẩn hoá để so khớp: NFC + lower-case (vi). PHẢI áp dụng NHẤT QUÁN cho cả từ khoá lẫn
 * text — nếu không, bàn phím/clipboard sinh NFD (macOS/iOS hay gặp) khiến "cấm" (NFC) không
 * khớp "cấm" (NFD) dù trông y hệt → bot báo "sạch" nhầm. GIỮ DẤU (chỉ gộp tổ hợp, không bỏ dấu).
 */
function normalizeForMatch(s: string): string {
  return s.normalize("NFC").toLocaleLowerCase("vi");
}

/**
 * Build regex khớp nguyên-từ cho 1 keyword đã lower-case. Lookaround đảm bảo 2 mép của
 * keyword KHÔNG dính thêm ký tự-trong-từ (nên là từ riêng / cụm riêng). 'u' để \p{...} chạy.
 */
function wordRegex(lowerKeyword: string): RegExp {
  const body = escapeRegExp(lowerKeyword);
  return new RegExp(`(?<![${WORD_CHAR}])${body}(?![${WORD_CHAR}])`, "u");
}

export interface CompiledKeyword {
  /** Từ gốc (để hiển thị/log). */
  word: string;
  re: RegExp;
}

/** Biên dịch danh sách keyword 1 lần (tái dùng regex cho mọi message). Bỏ từ rỗng. */
export function compileBlacklist(words: string[]): CompiledKeyword[] {
  const out: CompiledKeyword[] = [];
  const seen = new Set<string>();
  for (const raw of words) {
    const word = raw.trim();
    if (!word) continue;
    const norm = normalizeForMatch(word);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push({ word, re: wordRegex(norm) });
  }
  return out;
}

/**
 * Trả từ khoá ĐẦU TIÊN khớp trong text (theo nguyên từ, không phân biệt hoa/thường, giữ dấu),
 * hoặc null nếu sạch. Trả `word` gốc để log/báo Telegram.
 */
export function findBlacklistedWord(text: string, compiled: CompiledKeyword[]): string | null {
  if (!text || compiled.length === 0) return null;
  const norm = normalizeForMatch(text);
  for (const k of compiled) {
    if (k.re.test(norm)) return k.word;
  }
  return null;
}

/**
 * Đọc danh sách VIP id (không bao giờ bị auto xoá/kick). Lỗi đọc/parse → coi như rỗng +
 * cảnh báo, KHÔNG ném (tránh 1 message làm crash listener). Cùng file với cleanup dùng.
 */
export function loadVipIds(): Set<string> {
  const p = config.vipListPath;
  if (!fs.existsSync(p)) return new Set();
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.warn(`[moderation] Không đọc được VIP list (${String(e)}) — coi như rỗng.`);
    return new Set();
  }
  if (!Array.isArray(raw)) return new Set();
  const ids = raw
    .map((x) => (typeof x === "string" ? x : (x as { id?: unknown })?.id))
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);
  return new Set(ids);
}
