import { config } from "./config.js";
import { login, getGroupSnapshot, normalizeTs, type SessionKind } from "./zalo/client.js";
import { logInteraction, upsertMember, markMemberLeft } from "./db/index.js";
import { ensureWarmupStarted, daysCollected, warmupDaysRemaining } from "./warmup.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Listener chạy LIÊN TỤC (keep-alive trên VPS). Ghi nhận tương tác real-time:
 *  - message   → interaction type 'message'
 *  - reaction  → interaction type 'reaction'
 *  - group_event join/leave/remove → cập nhật members
 *
 * Voting KHÔNG bắt được qua listener (GroupEventType của zca-js không có poll/vote —
 * đã verify từ source; xem OQ-1). Listener chỉ tính message + reaction.
 *
 * Dùng tài khoản PHỤ (operator). KHÔNG kick/gửi gì ở Milestone 1.
 */

const SESSION: SessionKind = "operator";

/** Chỉ ghi tương tác cho group ta quản lý (bỏ qua DM / group khác). */
function isTargetThread(threadId: unknown): boolean {
  if (!config.groupId) return true; // chưa cấu hình group → ghi tất cả (giai đoạn dò group id)
  return String(threadId ?? "") === config.groupId;
}

function extractSender(payload: any): string | null {
  const id = payload?.data?.uidFrom ?? payload?.uidFrom ?? payload?.data?.uid ?? null;
  const s = id != null ? String(id) : "";
  return s ? s : null;
}

function extractTs(payload: any, now: number): number {
  return normalizeTs(payload?.data?.ts ?? payload?.ts) ?? now;
}

async function syncMembersOnce(api: any, now: number): Promise<void> {
  if (!config.groupId) {
    console.log("[listener] GROUP_ID chưa đặt — bỏ qua sync member. Chạy export-members để lấy group id.");
    return;
  }
  try {
    const snap = await getGroupSnapshot(api, config.groupId);
    for (const m of snap.members) {
      if (!m.id) continue;
      upsertMember({ zaloUserId: m.id, displayName: m.displayName, role: m.role, now });
    }
    console.log(`[listener] Đồng bộ ${snap.members.length}/${snap.totalMember} thành viên group "${snap.name}".`);
  } catch (e) {
    console.warn(`[listener] Không sync được member: ${String(e)}`);
  }
}

export async function runListener(): Promise<void> {
  const now = Date.now();
  const startedAt = ensureWarmupStarted(now);
  console.log(
    `[listener] Bắt đầu. Làm nóng: đã thu thập ${daysCollected(now)} ngày, ` +
      `còn ${warmupDaysRemaining(now)} ngày (mốc bắt đầu: ${new Date(startedAt).toISOString()}).`,
  );

  const api = await login(SESSION);
  await syncMembersOnce(api, now);

  api.listener.on("message", (msg: any) => {
    try {
      if (!isTargetThread(msg?.threadId ?? msg?.data?.idTo)) return;
      const sender = extractSender(msg);
      if (!sender) return;
      const ts = extractTs(msg, Date.now());
      upsertMember({ zaloUserId: sender, displayName: String(msg?.data?.dName ?? ""), now: Date.now() });
      logInteraction({ zaloUserId: sender, type: "message", ts, source: "listener" });
    } catch (e) {
      console.warn(`[listener] lỗi xử lý message: ${String(e)}`);
    }
  });

  api.listener.on("reaction", (rc: any) => {
    try {
      if (!isTargetThread(rc?.threadId ?? rc?.data?.idTo)) return;
      const sender = extractSender(rc);
      if (!sender) return;
      const ts = extractTs(rc, Date.now());
      logInteraction({ zaloUserId: sender, type: "reaction", ts, source: "listener" });
    } catch (e) {
      console.warn(`[listener] lỗi xử lý reaction: ${String(e)}`);
    }
  });

  api.listener.on("group_event", (ev: any) => {
    try {
      const type = String(ev?.type ?? "").toLowerCase();
      const now2 = Date.now();
      // Thành viên mới join → ghi nhận (first_seen_at = giờ; luật miễn người mới ở M2).
      if (type === "join") {
        for (const m of normalizeEventMembers(ev)) {
          upsertMember({ zaloUserId: m.id, displayName: m.name, joinedAt: now2, now: now2 });
        }
      }
      // Rời / bị xoá / bị block → đánh dấu inactive (không còn trong group).
      if (type === "leave" || type === "remove_member" || type === "block_member") {
        for (const m of normalizeEventMembers(ev)) {
          markMemberLeft(m.id, now2);
        }
      }
    } catch (e) {
      console.warn(`[listener] lỗi xử lý group_event: ${String(e)}`);
    }
  });

  api.listener.start();
  console.log("[listener] Đang lắng nghe (message + reaction + group_event). Ctrl+C để dừng.");
}

/** Chuẩn hoá danh sách member trong 1 group_event (shape chưa verify → phòng thủ). */
function normalizeEventMembers(ev: any): { id: string; name: string }[] {
  const raw =
    ev?.data?.updateMembers ?? ev?.data?.members ?? ev?.updateMembers ?? ev?.members ?? [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((m: any) => ({
      id: String(m?.id ?? m?.uid ?? m ?? ""),
      name: String(m?.dName ?? m?.displayName ?? ""),
    }))
    .filter((m: { id: string }) => m.id !== "");
}
