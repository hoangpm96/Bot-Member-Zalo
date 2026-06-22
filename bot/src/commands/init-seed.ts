import { config } from "../config.js";
import { login, getGroupSnapshot, fetchChatHistory } from "../zalo/client.js";
import { upsertMember, logInteraction, countActiveMembers } from "../db/index.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * init-seed — KHỞI TẠO DB lần đầu bằng TÀI KHOẢN CHÍNH (owner). CHỈ ĐỌC.
 *
 * ⚠️⚠️ RÀNG BUỘC AN TOÀN CỨNG ⚠️⚠️
 * Lệnh này dùng tài khoản chính đang vận hành nhóm. NÓ TUYỆT ĐỐI:
 *   - KHÔNG gửi tin nhắn.
 *   - KHÔNG kick / xoá thành viên.
 *   - KHÔNG sửa group.
 * Chỉ gọi các hàm READ: getGroupSnapshot (getGroupInfo), fetchChatHistory
 * (getGroupChatHistory). Không hàm nào ở đây chạm tới sendMessage / removeUser.
 *
 * Mục đích: lấy danh sách thành viên hiện tại + (nếu có) ngày join (OQ-2) + seed lịch
 * sử chat quá khứ (OQ-5) để rút ngắn giai đoạn làm nóng cho phần CHAT.
 * Lưu ý: KHÔNG có reaction/vote quá khứ — chỉ chat.
 *
 * Chạy 1 LẦN lúc setup. Sau đó vận hành hằng ngày dùng tài khoản phụ (listener).
 */

export async function runInitSeed(): Promise<void> {
  if (!config.groupId) {
    console.error(
      "[init-seed] Chưa có GROUP_ID trong .env. Chạy `npm run list-groups` trước để lấy ID nhóm, " +
        "copy vào .env (dòng GROUP_ID=...), rồi chạy lại lệnh này.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("[init-seed] ⚠️  Đăng nhập TÀI KHOẢN CHÍNH ở chế độ CHỈ-ĐỌC (không gửi/không kick).");
  // Dùng session 'owner' — tách hẳn khỏi session vận hành 'operator'.
  const api = await login("owner");

  const now = Date.now();

  // --- 1. Snapshot thành viên + role + (thử) joined_at ---
  const snap = await getGroupSnapshot(api, config.groupId);
  let withJoinDate = 0;
  for (const m of snap.members) {
    if (!m.id) continue;
    // getGroupInfo không có field ngày-join đáng tin (OQ-2) → joinedAt để null.
    // Nếu phiên bản zca-js trả về, có thể bổ sung sau khi verify thật.
    upsertMember({ zaloUserId: m.id, displayName: m.displayName, role: m.role, now });
  }
  console.log(
    `[init-seed] Đã ghi ${snap.members.length} thành viên (owner/admin/member). ` +
      `Có ngày join: ${withJoinDate} (OQ-2: ngày join thường KHÔNG lấy được).`,
  );

  // --- 2. Seed lịch sử chat (READ-ONLY) ---
  const sinceTs =
    config.seedMaxMonths > 0 ? now - config.seedMaxMonths * 30 * 24 * 60 * 60 * 1000 : null;

  console.log(
    `[init-seed] Kéo lịch sử chat (tối đa ${config.seedMaxPages} trang` +
      `${sinceTs ? `, từ ${new Date(sinceTs).toISOString()}` : ", tối đa có thể"})...`,
  );

  const history = await fetchChatHistory(api, config.groupId, {
    maxPages: config.seedMaxPages,
    sinceTs,
    throttleMs: config.zaloThrottleMs,
  });

  // Chỉ seed chat của member còn active (đã có trong snapshot). Người lạ/đã rời → bỏ.
  const activeIds = new Set(snap.members.map((m) => m.id));
  let seeded = 0;
  for (const h of history) {
    if (!activeIds.has(h.senderId)) continue;
    logInteraction({ zaloUserId: h.senderId, type: "message", ts: h.ts, source: "seed" });
    seeded += 1;
  }

  console.log(
    `[init-seed] ✅ Hoàn tất (chỉ-đọc). Lịch sử chat lấy được: ${history.length} tin, ` +
      `seed cho member còn active: ${seeded}. Group hiện có ${countActiveMembers()} thành viên trong DB.`,
  );
  console.log(
    "[init-seed] LƯU Ý: chỉ seed được CHAT, không có reaction/vote quá khứ. " +
      "Giai đoạn làm nóng vẫn nên giữ cho phần reaction (OQ-5).",
  );
}
