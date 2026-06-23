import { config } from "./config.js";
import {
  login,
  getGroupSnapshot,
  normalizeTs,
  fetchGroupPollVotes,
  consumeReloginRequest,
  reloginRequestExists,
  hasSavedCredentials,
  writeLoginReadyStatus,
} from "./zalo/client.js";
import { logInteraction, upsertMember, markMemberLeft, getMember, saveGroupMessage } from "./db/index.js";
import { ensureWarmupStarted, daysCollected, warmupDaysRemaining } from "./warmup.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Listener chạy LIÊN TỤC (keep-alive trên VPS). Ghi nhận tương tác real-time:
 *  - message   → interaction 'message'
 *  - reaction  → interaction 'reaction'
 *  - group_event join/leave/remove → cập nhật members
 *
 * KHÔNG lấy được tương tác QUÁ KHỨ: getGroupChatHistory trả 404 với Community, còn
 * old_messages/old_reactions của zca-js chỉ là batch offline-sync (không request theo
 * group, không backfill sâu) — đã verify từ source + review độc lập (codex). Nên bỏ.
 * Dữ liệu chỉ tích luỹ từ lúc listener chạy → giai đoạn làm nóng là bắt buộc.
 *
 * Voting KHÔNG bắt được qua listener (GroupEventType không có poll/vote — OQ-1).
 *
 * Dùng tài khoản co-admin. KHÔNG kick/gửi gì ở listener.
 */

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

function extractText(payload: any): string | null {
  const content = payload?.data?.content;
  if (typeof content !== "string") return null;
  const text = content.trim();
  return text ? text : null;
}

function extractMessageId(payload: any, sender: string, ts: number, text: string): string {
  const data = payload?.data ?? {};
  const raw = data.msgId ?? data.cliMsgId ?? data.realMsgId ?? data.actionId ?? "";
  const id = String(raw).trim();
  if (id) return id;
  // Defensive fallback for unexpected zca-js payloads; keeps UNIQUE deterministic enough.
  return `${sender}:${ts}:${text.slice(0, 120)}`;
}

function fmtTime(ts: number | null): string {
  if (!ts) return "chưa có";
  return new Date(ts).toLocaleString("vi-VN", { hour12: false });
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
  const requestedAtStart = consumeReloginRequest();
  if (requestedAtStart) {
    console.log("[listener] Đã nhận yêu cầu đăng nhập lại trước khi khởi động.");
  }

  if (!hasSavedCredentials() && !requestedAtStart) {
    writeLoginReadyStatus();
    console.log("[listener] Chưa có Zalo session. Đang chờ thao tác đăng nhập trên web /login.");
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (!consumeReloginRequest()) return;
        clearInterval(timer);
        resolve();
      }, 1_000);
    });
    console.log("[listener] Đã nhận yêu cầu đăng nhập lần đầu. Đang tạo QR...");
  }

  // Khi listener/login đang hoạt động, giữ marker qua lần restart. Process mới sẽ
  // consume marker, dọn credential rồi tạo QR; như vậy không có hai socket song song.
  setInterval(() => {
    if (!reloginRequestExists()) return;
    console.log("[listener] Dashboard yêu cầu đăng nhập lại. Đang restart để tạo QR mới...");
    process.exit(0);
  }, 1_000);

  const now = Date.now();
  const startedAt = ensureWarmupStarted(now);
  console.log(
    `[listener] Bắt đầu. Làm nóng: đã thu thập ${daysCollected(now)} ngày, ` +
      `còn ${warmupDaysRemaining(now)} ngày (mốc bắt đầu: ${new Date(startedAt).toISOString()}).`,
  );

  const api = await login();
  await syncMembersOnce(api, now);

  if (!config.groupId) {
    console.warn(
      "[listener] Đã đăng nhập nhưng GROUP_ID chưa được cấu hình. Bot đang tạm ngưng; " +
        "điền GROUP_ID rồi restart zalo-bot.",
    );
    await new Promise<never>(() => {
      // Giữ process ổn định để PM2 không restart liên tục trong lúc chờ cấu hình.
    });
  }

  let messageEvents = 0;
  let reactionEvents = 0;
  let selfEvents = 0;
  let lastEventAt: number | null = null;
  let lastEventType: "message" | "reaction" | null = null;
  let lastEventSender = "";
  let socketState: "starting" | "connected" | "disconnected" | "closed" | "error" = "starting";

  /** Ghi 1 tương tác (message/reaction) real-time vào DB. */
  function record(payload: any, type: "message" | "reaction"): void {
    const threadId = String(payload?.threadId ?? payload?.data?.idTo ?? "");
    if (!isTargetThread(threadId)) return;
    const sender = extractSender(payload);
    if (!sender) return;
    const ts = extractTs(payload, Date.now());
    if (type === "message") {
      const text = extractText(payload);
      if (text) {
        upsertMember({ zaloUserId: sender, displayName: String(payload?.data?.dName ?? ""), now: Date.now() });
        saveGroupMessage({
          threadId,
          messageId: extractMessageId(payload, sender, ts, text),
          zaloUserId: sender,
          displayName: String(payload?.data?.dName ?? ""),
          text,
          msgType: String(payload?.data?.msgType ?? ""),
          ts,
          isSelf: Boolean(payload?.isSelf),
          now: Date.now(),
        });
      }
    }
    if (payload?.isSelf) selfEvents += 1;
    if (type === "message") {
      upsertMember({ zaloUserId: sender, displayName: String(payload?.data?.dName ?? ""), now: Date.now() });
    }
    logInteraction({ zaloUserId: sender, type, ts, source: "listener" });

    if (type === "message") messageEvents += 1;
    if (type === "reaction") reactionEvents += 1;
    lastEventAt = Date.now();
    lastEventType = type;
    lastEventSender = sender;

    const totalEvents = messageEvents + reactionEvents;
    const every = config.listenerEventLogEvery;
    if (every > 0 && totalEvents % every === 0) {
      console.log(
        `[listener] Nhận ${type}: user=${sender}, ` +
          `event=${totalEvents} (message=${messageEvents}, reaction=${reactionEvents}, self=${selfEvents}), ` +
          `zalo_ts=${fmtTime(ts)}.`,
      );
    }
  }

  api.listener.on("message", (msg: any) => {
    try {
      record(msg, "message");
    } catch (e) {
      console.warn(`[listener] lỗi xử lý message: ${String(e)}`);
    }
  });

  api.listener.on("reaction", (rc: any) => {
    try {
      record(rc, "reaction");
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

  api.listener.on("connected", () => {
    socketState = "connected";
    console.log("[listener] WebSocket connected.");
  });

  api.listener.on("disconnected", (code: number, reason: string) => {
    socketState = "disconnected";
    console.warn(`[listener] WebSocket disconnected: code=${code}, reason=${reason || "-"}.`);
  });

  api.listener.on("closed", (code: number, reason: string) => {
    socketState = "closed";
    console.warn(`[listener] WebSocket closed: code=${code}, reason=${reason || "-"}.`);
  });

  api.listener.on("error", (err: unknown) => {
    socketState = "error";
    console.warn(`[listener] WebSocket error: ${String(err)}`);
  });

  api.listener.start({ retryOnClose: true });
  console.log("[listener] Đang lắng nghe (message + reaction + group_event). Ctrl+C để dừng.");

  if (config.listenerHeartbeatMs > 0) {
    setInterval(() => {
      const totalEvents = messageEvents + reactionEvents;
      console.log(
        `[listener] Heartbeat OK: socket=${socketState}, event=${totalEvents} ` +
          `(message=${messageEvents}, reaction=${reactionEvents}, self=${selfEvents}), ` +
          `last=${lastEventType ?? "chưa có"} user=${lastEventSender || "-"} at=${fmtTime(lastEventAt)}.`,
      );
    }, config.listenerHeartbeatMs);
  }

  // Đọc vote trong poll định kỳ (mỗi 6h) — vote không đến qua event, phải chủ động đọc.
  // Đọc được cả vote cũ (poll lưu trạng thái server). Dedupe lo trùng.
  const SYNC_VOTES_INTERVAL_MS = 6 * 60 * 60 * 1000;
  async function syncVotesOnce(): Promise<void> {
    if (!config.groupId) return;
    try {
      const votes = await fetchGroupPollVotes(api, config.groupId, {
        maxPages: 50,
        throttleMs: config.zaloThrottleMs,
      });
      let written = 0;
      for (const v of votes) {
        if (!getMember(v.voterId)) continue;
        logInteraction({ zaloUserId: v.voterId, type: "vote", ts: v.ts, source: "poll" });
        written += 1;
      }
      if (written > 0) console.log(`[listener] Đồng bộ vote từ poll: ghi ${written} lượt.`);
    } catch (e) {
      console.warn(`[listener] sync vote lỗi: ${String(e)}`);
    }
  }
  await syncVotesOnce(); // chạy 1 lần ngay khi start
  setInterval(() => void syncVotesOnce(), SYNC_VOTES_INTERVAL_MS);
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
