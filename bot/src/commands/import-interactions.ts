import fs from "node:fs";
import path from "node:path";
import { logInteraction, upsertMember, type InteractionType } from "../db/index.js";

/**
 * Import tương tác thủ công từ CSV/JSON. Dùng cho vote/poll cũ khi Zalo/zca-js không
 * expose API đọc danh sách voter. Mỗi dòng được ghi vào interactions như 1 event,
 * nên ranking cleanup sẽ tự tính là có tương tác.
 *
 * CSV header hỗ trợ:
 *   zalo_user_id,type,ts,display_name,note
 * hoặc:
 *   id,type,date,name
 *
 * JSON hỗ trợ mảng object cùng field.
 */

interface ImportRow {
  zalo_user_id?: unknown;
  id?: unknown;
  type?: unknown;
  ts?: unknown;
  date?: unknown;
  display_name?: unknown;
  name?: unknown;
}

const ALLOWED_TYPES = new Set<InteractionType>(["message", "reaction", "vote", "manual", "image", "video"]);

export function runImportInteractions(fileArg?: string): void {
  if (!fileArg) {
    console.error(
      "Thiếu file import.\n" +
        "Ví dụ: npm run import-interactions -- ./data/manual-votes.csv",
    );
    process.exitCode = 1;
    return;
  }

  const filePath = path.resolve(fileArg);
  const rows = readRows(filePath);
  const now = Date.now();
  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const id = String(row.zalo_user_id ?? row.id ?? "").trim();
    if (!id) {
      skipped += 1;
      continue;
    }

    const typeRaw = String(row.type ?? "vote").trim().toLowerCase();
    const type = ALLOWED_TYPES.has(typeRaw as InteractionType)
      ? (typeRaw as InteractionType)
      : "vote";
    const ts = parseTs(row.ts ?? row.date) ?? now;
    const displayName = String(row.display_name ?? row.name ?? "").trim();

    // Đảm bảo FK không fail nếu CSV có user id chưa từng sync. Nếu member đã tồn tại,
    // upsert giữ first_seen_at cũ và chỉ cập nhật tên khi có.
    upsertMember({ zaloUserId: id, displayName, now });
    logInteraction({ zaloUserId: id, type, ts, source: "manual" });
    imported += 1;
  }

  console.log(
    `[import-interactions] Đã đọc ${rows.length} dòng từ ${filePath}. ` +
      `Import=${imported}, bỏ qua=${skipped}.`,
  );
}

function readRows(filePath: string): ImportRow[] {
  const text = fs.readFileSync(filePath, "utf8");
  if (filePath.toLowerCase().endsWith(".json")) {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) throw new Error("JSON import phải là mảng object.");
    return parsed as ImportRow[];
  }
  return parseCsv(text);
}

function parseTs(raw: unknown): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const s = String(raw).trim();
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function parseCsv(text: string): ImportRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];
  const headerLine = lines[0];
  if (headerLine === undefined) return [];
  const headers = splitCsvLine(headerLine).map((x) => x.trim());
  const rows: ImportRow[] = [];

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i += 1) {
      const key = headers[i];
      if (!key) continue;
      row[key] = cells[i] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === "," && !quoted) {
      out.push(cell);
      cell = "";
      continue;
    }
    cell += ch;
  }
  out.push(cell);
  return out;
}
