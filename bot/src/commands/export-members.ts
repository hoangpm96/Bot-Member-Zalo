import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { getMemberStats } from "../db/index.js";

/**
 * export-members — xuất danh sách thành viên (đã lưu trong DB) ra CSV để TRA ID
 * khi cần thêm vào VIP list (brainstorm P0: vip list qua file config = ID + ghi chú).
 *
 * Cột: zalo_user_id | display_name | role | so_lan_tuong_tac | lan_cuoi_tuong_tac
 * Sắp theo ít tương tác nhất + lâu nhất lên đầu (giống thứ tự ranking M2) để dễ soi
 * ai đang "nguy hiểm". READ-ONLY với Zalo (chỉ đọc DB, không gọi Zalo).
 */

function fmtTs(ts: number | null): string {
  return ts ? new Date(ts).toISOString() : "";
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function runExportMembers(): void {
  const stats = getMemberStats();
  const header = ["zalo_user_id", "display_name", "role", "so_lan_tuong_tac", "lan_cuoi_tuong_tac"];
  const lines = [header.join(",")];

  for (const s of stats) {
    lines.push(
      [
        csvCell(s.zalo_user_id),
        csvCell(s.display_name),
        csvCell(s.role),
        String(s.interaction_count),
        csvCell(fmtTs(s.last_interaction)),
      ].join(","),
    );
  }

  const outPath = path.join(path.dirname(config.dbPath), "members-export.csv");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");

  console.log(`[export-members] Đã xuất ${stats.length} thành viên ra: ${outPath}`);
  // In nhanh 10 dòng đầu (ít tương tác nhất) ra console để xem ngay.
  console.log("[export-members] 10 thành viên ít tương tác nhất:");
  for (const s of stats.slice(0, 10)) {
    console.log(
      `  ${s.zalo_user_id}  [${s.role}]  "${s.display_name}"  ` +
        `tương tác=${s.interaction_count}  lần cuối=${fmtTs(s.last_interaction) || "chưa có"}`,
    );
  }
}
