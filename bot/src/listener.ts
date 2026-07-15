import { config } from "./config.js";
import { runtimeConfig } from "./runtime-config.js";
import {
  login,
  normalizeTs,
  fetchGroupPollVotes,
  consumeMemberSyncRequest,
  consumePermissionCheckRequest,
  consumeReloginRequest,
  consumeKickNowRequest,
  reloginRequestExists,
  hasSavedCredentials,
  writeLoginReadyStatus,
  deleteGroupMessage,
  removeGroupMember,
  blockGroupMember,
} from "./zalo/client.js";
import {
  logInteraction,
  upsertMember,
  markMemberLeft,
  getMember,
  recordMemberEvent,
  recordRemoval,
  saveGroupMessage,
  saveGroupMediaEvent,
  recordBotError,
  recordModerationAction,
  setBotState,
  acquireLock,
  releaseLock,
} from "./db/index.js";
import { syncGroupMembers } from "./member-sync.js";
import { KICK_LOCK_KEY, KICK_LOCK_STALE_MS } from "./commands/monthly-cleanup.js";
import {
  compileBlacklist,
  findBlacklistedWord,
  loadVipIds,
  type CompiledKeyword,
} from "./moderation.js";
import { sendTelegramText } from "./telegram.js";
import { checkBotPermissions } from "./permissions.js";
import { ensureWarmupStarted, daysCollected, warmupDaysRemaining } from "./warmup.js";
import { extractText, extractMediaSummary, extractMediaUrl } from "./message-extract.js";
import {
  forwardZaloMessageToTelegram,
  isTelegramForwardConfigured,
} from "./telegram-forward.js";

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

// ---- Kiểm duyệt real-time theo từ khoá (xoá tin + ban) ----

/** Cache biên dịch blacklist: chỉ re-compile khi danh sách từ đổi (so theo chuỗi nối). */
let blacklistSig = "";
let blacklistCompiled: CompiledKeyword[] = [];
function getCompiledBlacklist(words: string[]): CompiledKeyword[] {
  const sig = words.join("\0");
  if (sig !== blacklistSig) {
    blacklistSig = sig;
    blacklistCompiled = compileBlacklist(words);
  }
  return blacklistCompiled;
}

/** Người đang được xử lý ban — chặn xử lý chồng khi spam nhiều tin dính cùng lúc. */
const moderationInFlight = new Set<string>();

/**
 * Các msgId đã kiểm duyệt gần đây — chống Zalo redeliver/duplicate event khiến xử lý 2 lần
 * (2 lần xoá/kick + 2 alert Telegram + 2 dòng DB). Bounded để không rò bộ nhớ.
 */
const recentlyModerated = new Set<string>();
const RECENT_MODERATED_MAX = 2000;
function markModerated(msgId: string): void {
  if (!msgId) return;
  recentlyModerated.add(msgId);
  if (recentlyModerated.size > RECENT_MODERATED_MAX) {
    // Xoá phần tử cũ nhất (Set giữ thứ tự chèn) để giữ kích thước bounded.
    const oldest = recentlyModerated.values().next().value;
    if (oldest !== undefined) recentlyModerated.delete(oldest);
  }
}

/**
 * Kiểm duyệt 1 message. Gọi async (fire-and-forget) từ record() để không chặn vòng nhận event.
 * Luồng: tìm từ cấm → (miễn trừ owner/admin/VIP) → xoá tin → nếu action ban thì kick + chặn
 * tham gia lại. Tôn trọng DRY_RUN. Báo Telegram mỗi lần. Ghi moderation_actions.
 */
async function moderateMessage(
  api: any,
  input: { threadId: string; sender: string; text: string; msgId: string; cliMsgId: string; displayName: string },
): Promise<void> {
  if (!runtimeConfig.moderationEnabled) return;
  // Không có GROUP_ID thì không xác định được nhóm để kick/chặn (isTargetThread cho mọi thread
  // qua khi groupId rỗng) → không kiểm duyệt để tránh kick nhầm bằng groupId rỗng.
  if (!config.groupId) return;
  const words = runtimeConfig.blacklistWords;
  if (words.length === 0) return;

  const matched = findBlacklistedWord(input.text, getCompiledBlacklist(words));
  if (!matched) return;

  // Chống xử lý lại cùng 1 tin (Zalo redeliver). Đánh dấu NGAY khi quyết định xử lý.
  if (input.msgId && recentlyModerated.has(input.msgId)) return;
  markModerated(input.msgId);

  // Miễn trừ VIP. Không xoá/kick.
  if (loadVipIds().has(input.sender)) {
    console.log(`[moderation] Bỏ qua VIP ${input.sender} dù dính từ "${matched}".`);
    return;
  }

  // Miễn trừ owner/admin (role suy từ group snapshot, lưu ở bảng members).
  // AN TOÀN khi không chắc role: nếu member CHƯA có trong DB (sync chưa kịp / lỗi) thì với
  // hành động ban (phá huỷ, khó hoàn tác) HẠ XUỐNG chỉ xoá tin — thà sót còn hơn ban nhầm admin.
  const member = getMember(input.sender);
  if (member && (member.role === "owner" || member.role === "admin")) {
    console.log(`[moderation] Bỏ qua ${input.sender} (role=${member.role}) dù dính từ "${matched}".`);
    return;
  }
  const roleUnknown = member === undefined;

  // 1 người spam nhiều tin → chỉ xử lý 1 luồng ban; các tin khác vẫn được xoá riêng ở dưới
  // nhưng không kick lại. Dùng cờ in-flight quanh phần kick để không gọi kick/chặn 2 lần.
  let action = runtimeConfig.moderationAction; // "delete_only" | "delete_and_ban"
  if (action === "delete_and_ban" && roleUnknown) {
    console.warn(
      `[moderation] Chưa rõ role của ${input.sender} (chưa có trong DB) — hạ xuống CHỈ XOÁ, ` +
        `không ban, để tránh ban nhầm admin. Sync member rồi sẽ ban ở lần sau nếu vẫn vi phạm.`,
    );
    action = "delete_only";
  }
  const dryRun = config.dryRun;
  const now = Date.now();
  let deleted = false;
  let kicked = false;
  let blocked = false;
  let error: string | null = null;

  // --- Bước 1: xoá tin (luôn cố, kể cả khi sẽ ban) ---
  try {
    if (!dryRun) {
      await deleteGroupMessage(api, {
        threadId: input.threadId,
        msgId: input.msgId,
        cliMsgId: input.cliMsgId,
        uidFrom: input.sender,
      });
    }
    deleted = !dryRun;
  } catch (e) {
    error = `xoá tin lỗi: ${String(e)}`;
    console.warn(`[moderation] ${error}`);
  }

  // --- Bước 2: ban (kick + chặn tham gia lại) — chỉ khi action=delete_and_ban ---
  if (action === "delete_and_ban" && !moderationInFlight.has(input.sender)) {
    moderationInFlight.add(input.sender);
    try {
      if (!dryRun) {
        await removeGroupMember(api, config.groupId, input.sender);
        kicked = true;
        const removedAt = Date.now();
        markMemberLeft(input.sender, removedAt);
        recordMemberEvent({
          zaloUserId: input.sender,
          displayName: input.displayName,
          role: "member",
          eventType: "removed",
          source: "moderation",
          ts: removedAt,
          note: "delete_and_ban",
        });
        // Chặn tham gia lại là bước RIÊNG; lỗi ở đây không huỷ việc đã kick.
        try {
          await blockGroupMember(api, config.groupId, input.sender);
          blocked = true;
        } catch (e) {
          const msg = `chặn tham gia lại lỗi: ${String(e)}`;
          error = error ? `${error}; ${msg}` : msg;
          console.warn(`[moderation] ${msg}`);
        }
      }
    } catch (e) {
      // Xoá tin đã thành công vẫn giữ; chỉ báo lỗi kick (theo yêu cầu).
      const msg = `kick lỗi: ${String(e)}`;
      error = error ? `${error}; ${msg}` : msg;
      console.warn(`[moderation] ${msg}`);
    } finally {
      moderationInFlight.delete(input.sender);
    }
  }

  recordModerationAction({
    threadId: input.threadId,
    messageId: input.msgId,
    zaloUserId: input.sender,
    displayName: input.displayName,
    matchedWord: matched,
    text: input.text.slice(0, 500),
    action,
    dryRun,
    deleted,
    kicked,
    blocked,
    error,
    now,
  });

  await notifyModeration({
    sender: input.sender,
    displayName: input.displayName,
    matched,
    text: input.text,
    action,
    dryRun,
    deleted,
    kicked,
    blocked,
    error,
  });
}

/** Báo Telegram mỗi lần kiểm duyệt (best-effort, lỗi gửi không chặn listener). */
async function notifyModeration(d: {
  sender: string;
  displayName: string;
  matched: string;
  text: string;
  action: "delete_only" | "delete_and_ban";
  dryRun: boolean;
  deleted: boolean;
  kicked: boolean;
  blocked: boolean;
  error: string | null;
}): Promise<void> {
  if (!config.telegramBotToken || !config.telegramChatId) return;
  const who = `${d.displayName || "(không tên)"} (${d.sender})`;
  const head = d.dryRun ? "🧪 [DRY-RUN] Phát hiện từ cấm" : "🚫 Đã xử lý từ cấm";
  const steps: string[] = [];
  steps.push(d.dryRun ? "sẽ xoá tin" : d.deleted ? "đã xoá tin" : "xoá tin THẤT BẠI");
  if (d.action === "delete_and_ban") {
    steps.push(d.dryRun ? "sẽ kick + chặn vào lại" : d.kicked ? "đã kick" : "kick THẤT BẠI");
    if (!d.dryRun && d.kicked) steps.push(d.blocked ? "đã chặn vào lại" : "chặn vào lại THẤT BẠI");
  }
  const lines = [
    `${head}`,
    `Người: ${who}`,
    `Từ khoá: "${d.matched}"`,
    `Tin: ${d.text.slice(0, 200)}`,
    `Xử lý: ${steps.join(", ")}.`,
  ];
  if (d.error) lines.push(`⚠️ Lỗi: ${d.error}`);
  try {
    await sendTelegramText(lines.join("\n"));
  } catch (e) {
    console.warn(`[moderation] gửi Telegram lỗi: ${String(e)}`);
  }
}

async function syncMembersOnce(api: any, now: number, requestedBy = "listener"): Promise<void> {
  if (!config.groupId) {
    console.log("[listener] GROUP_ID chưa đặt — bỏ qua sync member. Chạy export-members để lấy group id.");
    return;
  }
  try {
    const result = await syncGroupMembers(api, now, { requestedBy });
    console.log(
      `[listener] Đồng bộ member: snapshot=${result.snapshotCount}/${result.memberCount}, ` +
        `upsert=${result.upserted}, inactive=${result.markedLeft}, group="${result.groupName}".`,
    );
  } catch (e) {
    recordBotError({
      source: "listener",
      code: "sync_members_once_failed",
      message: String(e),
      detail: e instanceof Error ? e.stack : null,
    });
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

  let memberSyncInFlight = false;
  let memberSyncTimer: NodeJS.Timeout | null = null;
  async function runMemberSync(reason: string): Promise<void> {
    if (memberSyncInFlight) {
      console.log(`[listener] Bỏ qua sync member (${reason}) vì lần trước còn đang chạy.`);
      return;
    }
    memberSyncInFlight = true;
    try {
      console.log(`[listener] Bắt đầu sync member (${reason}).`);
      await syncMembersOnce(api, Date.now(), `listener:${reason}`);
    } finally {
      memberSyncInFlight = false;
    }
  }
  function scheduleMemberSync(reason: string, delayMs = 15_000): void {
    if (config.listenerMemberSyncIntervalMs === 0) return;
    if (memberSyncTimer) return;
    memberSyncTimer = setTimeout(() => {
      memberSyncTimer = null;
      void runMemberSync(reason).catch((e) => console.warn(`[listener] sync member lỗi: ${String(e)}`));
    }, delayMs);
  }

  await runMemberSync("startup");

  setInterval(() => {
    const request = consumeMemberSyncRequest();
    if (!request) return;
    void runMemberSync(request.requestedBy).catch((e) => console.warn(`[listener] sync member theo yêu cầu lỗi: ${String(e)}`));
  }, 1_000);

  setInterval(() => {
    const request = consumePermissionCheckRequest();
    if (!request) return;
    void (async () => {
      try {
        const checkedAt = Date.now();
        const result = await checkBotPermissions(api, checkedAt);
        setBotState("permission_check", JSON.stringify({ ...result, requestedBy: request.requestedBy }), checkedAt);
        console.log(`[listener] Đã check quyền theo yêu cầu dashboard: role=${result.role}.`);
      } catch (e) {
        const checkedAt = Date.now();
        recordBotError({
          source: "listener",
          code: "permission_check_failed",
          message: String(e),
          detail: e instanceof Error ? e.stack : null,
          now: checkedAt,
        });
        setBotState(
          "permission_check",
          JSON.stringify({ checkedAt, requestedBy: request.requestedBy, error: String(e), issues: [String(e)] }),
          checkedAt,
        );
        console.warn(`[listener] check quyền lỗi: ${String(e)}`);
      }
    })();
  }, 1_000);

  setInterval(() => {
    const request = consumeKickNowRequest();
    if (!request) return;
    void (async () => {
      const finishedAt0 = Date.now();
      // Dùng CHUNG khoá với monthly-cleanup: nếu batch đang kick thì kick nhanh phải chờ
      // lượt sau (dashboard sẽ poll và báo "đang bận"), không được chen ngang.
      if (!acquireLock(KICK_LOCK_KEY, Date.now(), KICK_LOCK_STALE_MS)) {
        setBotState(
          "kick_now_result",
          JSON.stringify({
            requestId: request.requestId,
            zaloUserId: request.zaloUserId,
            ok: false,
            error: "Đang có tiến trình kick khác chạy (batch dọn dẹp). Thử lại sau ít phút.",
            finishedAt: finishedAt0,
          }),
          finishedAt0,
        );
        return;
      }
      try {
        const active = getMember(request.zaloUserId);
        if (!active || active.is_active !== 1) {
          throw new Error("Người này không còn active trong nhóm (có thể đã rời/bị xoá trước đó).");
        }
        await removeGroupMember(api, config.groupId, request.zaloUserId);
        const removedAt = Date.now();
        let blockError: string | null = null;
        if (request.block) {
          try {
            await blockGroupMember(api, config.groupId, request.zaloUserId);
          } catch (e) {
            blockError = String(e);
          }
        }
        recordRemoval({
          scanRunId: null,
          zaloUserId: request.zaloUserId,
          displayName: request.displayName || active.display_name,
          interactionCount: 0,
          lastInteraction: null,
          removedAt,
        });
        markMemberLeft(request.zaloUserId, removedAt);
        recordMemberEvent({
          zaloUserId: request.zaloUserId,
          displayName: request.displayName || active.display_name,
          role: active.role,
          eventType: "removed",
          source: "manual_web",
          ts: removedAt,
          note: `Kick nhanh từ dashboard bởi ${request.requestedBy}${request.block ? " (kèm chặn tham gia lại)" : ""}`,
        });
        console.log(`[listener] Đã kick nhanh (dashboard): ${request.displayName} (${request.zaloUserId}).`);
        setBotState(
          "kick_now_result",
          JSON.stringify({
            requestId: request.requestId,
            zaloUserId: request.zaloUserId,
            ok: true,
            blocked: request.block && !blockError,
            blockError,
            finishedAt: removedAt,
          }),
          removedAt,
        );
      } catch (e) {
        const finishedAt = Date.now();
        recordBotError({
          source: "listener",
          code: "kick_now_failed",
          message: String(e),
          detail: e instanceof Error ? e.stack : null,
          now: finishedAt,
        });
        setBotState(
          "kick_now_result",
          JSON.stringify({
            requestId: request.requestId,
            zaloUserId: request.zaloUserId,
            ok: false,
            error: String(e),
            finishedAt,
          }),
          finishedAt,
        );
        console.warn(`[listener] kick nhanh lỗi: ${String(e)}`);
      } finally {
        releaseLock(KICK_LOCK_KEY);
      }
    })();
  }, 1_000);

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
  let lastSocketError: string | null = null;
  const processStartedAt = Date.now();
  // Một queue nối tiếp giữ đúng thứ tự Zalo và tránh bắn đồng thời quá nhiều request Telegram.
  let telegramForwardQueue = Promise.resolve();

  function enqueueTelegramForward(input: Parameters<typeof forwardZaloMessageToTelegram>[0]): void {
    telegramForwardQueue = telegramForwardQueue
      .then(() => forwardZaloMessageToTelegram(input))
      .catch((e) => console.warn(`[telegram-forward] gửi lỗi: ${String(e)}`));
  }

  function writeHealth(reason: string): void {
    const nowHealth = Date.now();
    setBotState(
      "bot_health",
      JSON.stringify({
        reason,
        pid: process.pid,
        startedAt: processStartedAt,
        heartbeatAt: nowHealth,
        uptimeMs: nowHealth - processStartedAt,
        socketState,
        lastSocketError,
        messageEvents,
        reactionEvents,
        selfEvents,
        totalEvents: messageEvents + reactionEvents,
        lastEventAt,
        lastEventType,
        lastEventSender,
      }),
      nowHealth,
    );
  }
  writeHealth("startup");

  /** Ghi 1 tương tác (message/reaction) real-time vào DB. */
  function record(payload: any, type: "message" | "reaction"): void {
    const threadId = String(payload?.threadId ?? payload?.data?.idTo ?? "");
    if (!isTargetThread(threadId)) return;
    const sender = extractSender(payload);
    if (!sender) return;
    const ts = extractTs(payload, Date.now());
    if (type === "message") {
      const text = extractText(payload);
      const media = extractMediaSummary(payload);
      const displayName = String(payload?.data?.dName ?? "");
      if (text) {
        upsertMember({ zaloUserId: sender, displayName, now: Date.now() });
        saveGroupMessage({
          threadId,
          messageId: extractMessageId(payload, sender, ts, text),
          zaloUserId: sender,
          displayName,
          text,
          msgType: String(payload?.data?.msgType ?? ""),
          ts,
          isSelf: Boolean(payload?.isSelf),
          now: Date.now(),
        });
        // Kiểm duyệt từ khoá cấm: KHÔNG tự xử lý tin của chính bot (isSelf). Fire-and-forget
        // để không chặn vòng nhận event; lỗi nuốt bên trong moderateMessage.
        if (!payload?.isSelf) {
          void moderateMessage(api, {
            threadId,
            sender,
            text,
            msgId: String(payload?.data?.msgId ?? ""),
            cliMsgId: String(payload?.data?.cliMsgId ?? ""),
            displayName,
          }).catch((e) => console.warn(`[moderation] lỗi không bắt được: ${String(e)}`));
        }
      }
      if (media) {
        upsertMember({ zaloUserId: sender, displayName, now: Date.now() });
        saveGroupMediaEvent({
          threadId,
          messageId: extractMessageId(payload, sender, ts, `${media.type}:${media.count}`),
          zaloUserId: sender,
          displayName,
          mediaType: media.type,
          mediaCount: media.count,
          msgType: String(payload?.data?.msgType ?? ""),
          ts,
          isSelf: Boolean(payload?.isSelf),
          now: Date.now(),
        });
      }
      if (isTelegramForwardConfigured()) {
        enqueueTelegramForward({
          senderId: sender,
          displayName,
          text,
          msgType: String(payload?.data?.msgType ?? ""),
          media: media ? { ...media, url: extractMediaUrl(payload) } : null,
          ts,
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
      const threadId = String(ev?.threadId ?? ev?.data?.groupId ?? ev?.groupId ?? "");
      if (!isTargetThread(threadId)) return;
      const type = normalizeGroupEventType(ev);
      const now2 = Date.now();
      // Thành viên mới join → ghi nhận (first_seen_at = giờ; luật miễn người mới ở M2).
      if (isJoinGroupEvent(type)) {
        for (const m of normalizeEventMembers(ev)) {
          upsertMember({ zaloUserId: m.id, displayName: m.name, joinedAt: now2, now: now2 });
          recordMemberEvent({
            zaloUserId: m.id,
            displayName: m.name,
            eventType: "joined",
            source: "listener",
            ts: now2,
            note: `group_event:${type}`,
          });
        }
        scheduleMemberSync("group_event:join");
      }
      // Rời / bị xoá / bị block → đánh dấu inactive (không còn trong group).
      if (isLeaveGroupEvent(type)) {
        for (const m of normalizeEventMembers(ev)) {
          markMemberLeft(m.id, now2);
          recordMemberEvent({
            zaloUserId: m.id,
            displayName: m.name,
            eventType: groupEventToMemberEvent(type),
            source: "listener",
            ts: now2,
            note: `group_event:${type}`,
          });
        }
        scheduleMemberSync(`group_event:${type}`);
      }
    } catch (e) {
      console.warn(`[listener] lỗi xử lý group_event: ${String(e)}`);
    }
  });

  api.listener.on("connected", () => {
    socketState = "connected";
    lastSocketError = null;
    writeHealth("connected");
    console.log("[listener] WebSocket connected.");
  });

  api.listener.on("disconnected", (code: number, reason: string) => {
    socketState = "disconnected";
    lastSocketError = `code=${code}, reason=${reason || "-"}`;
    writeHealth("disconnected");
    console.warn(`[listener] WebSocket disconnected: code=${code}, reason=${reason || "-"}.`);
  });

  api.listener.on("closed", (code: number, reason: string) => {
    socketState = "closed";
    lastSocketError = `code=${code}, reason=${reason || "-"}`;
    writeHealth("closed");
    console.warn(`[listener] WebSocket closed: code=${code}, reason=${reason || "-"}.`);
  });

  api.listener.on("error", (err: unknown) => {
    socketState = "error";
    lastSocketError = String(err);
    recordBotError({
      source: "listener",
      code: "socket_error",
      message: String(err),
      detail: err instanceof Error ? err.stack : null,
    });
    writeHealth("error");
    console.warn(`[listener] WebSocket error: ${String(err)}`);
  });

  api.listener.start({ retryOnClose: true });
  console.log("[listener] Đang lắng nghe (message + reaction + group_event). Ctrl+C để dừng.");

  if (runtimeConfig.moderationEnabled) {
    const wc = runtimeConfig.blacklistWords.length;
    console.log(
      `[moderation] BẬT — ${wc} từ khoá, action=${runtimeConfig.moderationAction}` +
        `${config.dryRun ? " (DRY_RUN: chỉ log, không xoá/kick thật)" : ""}.`,
    );
  } else {
    console.log("[moderation] TẮT (bật trong dashboard /settings để lọc từ khoá).");
  }

  if (config.telegramForwardEnabled) {
    if (isTelegramForwardConfigured()) {
      const topic = config.telegramForwardTopicId ?? "chat/channel chính";
      console.log(
        `[telegram-forward] BẬT — đích=${config.telegramForwardChatId}, topic=${topic}.`,
      );
    } else {
      console.warn(
        "[telegram-forward] Đã bật nhưng thiếu TELEGRAM_FORWARD_BOT_TOKEN hoặc " +
          "TELEGRAM_FORWARD_CHAT_ID — tạm không forward.",
      );
    }
  } else {
    console.log("[telegram-forward] TẮT (TELEGRAM_FORWARD_ENABLED=0).");
  }

  if (config.listenerHeartbeatMs > 0) {
    setInterval(() => {
      const totalEvents = messageEvents + reactionEvents;
      writeHealth("heartbeat");
      console.log(
        `[listener] Heartbeat OK: socket=${socketState}, event=${totalEvents} ` +
          `(message=${messageEvents}, reaction=${reactionEvents}, self=${selfEvents}), ` +
          `last=${lastEventType ?? "chưa có"} user=${lastEventSender || "-"} at=${fmtTime(lastEventAt)}.`,
      );
    }, config.listenerHeartbeatMs);
  }

  if (config.listenerMemberSyncIntervalMs > 0) {
    setInterval(
      () => void runMemberSync("periodic").catch((e) => console.warn(`[listener] sync member lỗi: ${String(e)}`)),
      config.listenerMemberSyncIntervalMs,
    );
    console.log(`[listener] Sync member định kỳ mỗi ${Math.round(config.listenerMemberSyncIntervalMs / 1000)}s.`);
  } else {
    console.log("[listener] Sync member định kỳ đang tắt (LISTENER_MEMBER_SYNC_INTERVAL_MS=0).");
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

function normalizeGroupEventType(ev: any): string {
  return String(ev?.type ?? ev?.act ?? ev?.data?.act ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
}

function isJoinGroupEvent(type: string): boolean {
  return type === "join" || type === "member_join" || type === "add_member";
}

function isLeaveGroupEvent(type: string): boolean {
  return [
    "leave",
    "member_leave",
    "remove_member",
    "member_removed",
    "remove",
    "kick_member",
    "kicked",
    "block_member",
    "block",
  ].includes(type);
}

function groupEventToMemberEvent(type: string): "left" | "removed" | "blocked" {
  if (type === "block_member" || type === "block") return "blocked";
  if (type === "remove_member" || type === "member_removed" || type === "remove" || type === "kick_member" || type === "kicked") {
    return "removed";
  }
  return "left";
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
