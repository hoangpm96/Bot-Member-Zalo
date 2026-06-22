import fs from "node:fs";
import path from "node:path";

/**
 * Đọc/ghi VIP list (cùng file bot dùng). Mỗi entry: { id, note? }. Giới hạn 100.
 * Đường dẫn: env WEB_VIP_PATH, default ../bot/data/vip-list.json.
 */

const VIP_PATH =
  process.env.WEB_VIP_PATH?.trim() ||
  path.resolve(process.cwd(), "..", "bot", "data", "vip-list.json");

export interface VipEntry {
  id: string;
  note?: string;
}

export function readVip(): VipEntry[] {
  if (!fs.existsSync(VIP_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(VIP_PATH, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((x) => (typeof x === "string" ? { id: x } : (x as VipEntry)))
      .filter((x) => typeof x?.id === "string" && x.id.trim() !== "")
      .map((x) => ({ id: String(x.id).trim(), note: x.note ? String(x.note) : undefined }));
  } catch {
    return [];
  }
}

/** Ghi VIP list. Trả lỗi (string) nếu vượt 100 hoặc id trùng. */
export function writeVip(entries: VipEntry[]): string | null {
  const clean = entries
    .map((x) => ({ id: String(x.id ?? "").trim(), note: x.note?.trim() || undefined }))
    .filter((x) => x.id !== "");
  if (clean.length > 100) return "VIP list tối đa 100 người.";
  const ids = new Set<string>();
  for (const e of clean) {
    if (ids.has(e.id)) return `ID trùng trong danh sách: ${e.id}`;
    ids.add(e.id);
  }
  fs.mkdirSync(path.dirname(VIP_PATH), { recursive: true });
  fs.writeFileSync(VIP_PATH, JSON.stringify(clean, null, 2) + "\n", "utf8");
  return null;
}
