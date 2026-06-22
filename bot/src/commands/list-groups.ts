import { config } from "../config.js";
import { login, listGroups } from "../zalo/client.js";

/**
 * list-groups — liệt kê các group tài khoản đang tham gia + ID, để copy GROUP_ID vào .env.
 * Đăng nhập bằng tài khoản CHÍNH (owner) — đằng nào cũng dùng cho init-seed sau đó.
 * READ-ONLY: chỉ gọi getAllGroups + getGroupInfo. Không gửi/không kick.
 */
export async function runListGroups(): Promise<void> {
  console.log("[list-groups] Đăng nhập (owner) để liệt kê group. Quét QR nếu chưa có session.");
  const api = await login("owner");

  const groups = await listGroups(api, config.zaloThrottleMs);
  if (groups.length === 0) {
    console.log("[list-groups] Không thấy group nào (hoặc API trả rỗng).");
    return;
  }

  // Sắp theo số thành viên giảm dần — group cần quản lý thường đông nhất, dễ nhận ra.
  groups.sort((a, b) => b.totalMember - a.totalMember);

  console.log(`\n[list-groups] Tìm thấy ${groups.length} group:\n`);
  console.log("  GROUP_ID".padEnd(26) + "Số TV".padEnd(8) + "Tên group");
  console.log("  " + "-".repeat(60));
  for (const g of groups) {
    console.log("  " + g.groupId.padEnd(24) + String(g.totalMember).padEnd(8) + g.name);
  }
  console.log("\n→ Copy GROUP_ID của nhóm cần quản lý vào file .env (dòng GROUP_ID=...).");
}
