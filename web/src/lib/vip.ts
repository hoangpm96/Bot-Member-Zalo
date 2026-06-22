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

/**
 * Ghi VIP list. Trả lỗi (string) nếu input bậy / vượt 100 / id trùng.
 * Validate từng entry (phòng input rác như [null]) + ghi ATOMIC (temp rồi rename)
 * để bot không bao giờ đọc trúng file đang ghi dở.
 */
export function writeVip(entries: unknown): string | null {
  if (!Array.isArray(entries)) return "Danh sách không hợp lệ.";

  const clean: VipEntry[] = [];
  const ids = new Set<string>();
  for (const raw of entries) {
    const item = typeof raw === "string" ? { id: raw } : (raw as { id?: unknown; note?: unknown } | null);
    const id = String(item?.id ?? "").trim();
    if (id === "") continue; // bỏ dòng trống
    if (ids.has(id)) return `ID trùng trong danh sách: ${id}`;
    ids.add(id);
    const note = item?.note != null ? String(item.note).trim() : "";
    clean.push(note ? { id, note } : { id });
  }
  if (clean.length > 100) return "VIP list tối đa 100 người.";

  fs.mkdirSync(path.dirname(VIP_PATH), { recursive: true });
  const tmp = `${VIP_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, VIP_PATH); // atomic trên cùng filesystem
  return null;
}
