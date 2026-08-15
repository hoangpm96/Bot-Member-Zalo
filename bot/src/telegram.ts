import { config } from "./config.js";
import { getBotState, setBotState } from "./db/index.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const KEY_TELEGRAM_OFFSET = "telegram_update_offset";

export interface TelegramUpdate {
  updateId: number;
  messageText: string | null;
  callbackData: string | null;
  callbackQueryId: string | null;
  chatId: string | null;
  messageId: number | null;
}

function isConfigured(): boolean {
  return config.telegramBotToken !== "" && config.telegramChatId !== "";
}

export interface TelegramDestination {
  chatId: string;
  messageThreadId?: number;
}

function assertTelegramBotToken(botToken: string): void {
  if (!botToken) {
    throw new Error("Thiếu Telegram bot token trong .env");
  }
}

function assertTelegramAdminConfigured(): void {
  if (!isConfigured()) {
    throw new Error("Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID trong .env");
  }
}

async function telegramCall<T>(
  method: string,
  body: Record<string, unknown>,
  botToken = config.telegramBotToken,
): Promise<T> {
  assertTelegramBotToken(botToken);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      ok: boolean;
      result?: T;
      description?: string;
      parameters?: { retry_after?: number };
    };
    if (res.ok && json.ok) return json.result as T;

    const retryAfter = Number(json.parameters?.retry_after);
    if (res.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0 && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter, 60) * 1_000));
      continue;
    }
    throw new Error(`Telegram ${method} lỗi: ${json.description ?? res.statusText}`);
  }
  throw new Error(`Telegram ${method} lỗi sau nhiều lần thử`);
}

/** Id tin vừa gửi (để sau này sửa/xoá); null khi Telegram không trả message_id. */
function sentMessageId(result: unknown): number | null {
  const id = (result as { message_id?: unknown } | null)?.message_id;
  return typeof id === "number" ? id : null;
}

export async function sendTelegramText(
  text: string,
  destination?: TelegramDestination,
  botToken = config.telegramBotToken,
  parseMode?: "HTML",
): Promise<number | null> {
  if (!destination) assertTelegramAdminConfigured();
  const result = await telegramCall("sendMessage", {
    chat_id: destination?.chatId ?? config.telegramChatId,
    ...(destination?.messageThreadId !== undefined
      ? { message_thread_id: destination.messageThreadId }
      : {}),
    text,
    disable_web_page_preview: true,
    ...(parseMode ? { parse_mode: parseMode } : {}),
  }, botToken);
  return sentMessageId(result);
}

/** Gửi media bằng URL vào chat/channel/forum topic Telegram. */
export async function sendTelegramMedia(input: {
  type: "image" | "video";
  url: string;
  caption: string;
  destination: TelegramDestination;
  botToken?: string;
  parseMode?: "HTML";
}): Promise<number | null> {
  const mediaField = input.type === "image" ? "photo" : "video";
  const result = await telegramCall(input.type === "image" ? "sendPhoto" : "sendVideo", {
    chat_id: input.destination.chatId,
    ...(input.destination.messageThreadId !== undefined
      ? { message_thread_id: input.destination.messageThreadId }
      : {}),
    [mediaField]: input.url,
    caption: input.caption,
    ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
  }, input.botToken ?? config.telegramBotToken);
  return sentMessageId(result);
}

/**
 * Xoá 1 tin do chính bot gửi. Telegram CHỈ cho xoá tin gửi dưới 48 giờ — quá hạn
 * (hoặc tin đã bị xoá tay) API trả lỗi, ở đây nuốt và trả false để bên gọi còn
 * chuyển sang phương án sửa nhãn thay vì đứt luồng.
 */
export async function deleteTelegramMessage(input: {
  chatId: string;
  messageId: number;
  botToken?: string;
}): Promise<boolean> {
  try {
    await telegramCall(
      "deleteMessage",
      { chat_id: input.chatId, message_id: input.messageId },
      input.botToken ?? config.telegramBotToken,
    );
    return true;
  } catch (e) {
    console.warn(`[telegram] xoá tin ${input.messageId} không được: ${String(e)}`);
    return false;
  }
}

/**
 * Sửa nội dung tin bot đã gửi. Tin có media thì phần chữ nằm ở caption chứ không
 * phải text, nên thử editMessageText trước rồi rơi sang editMessageCaption.
 */
export async function replaceTelegramMessageContent(input: {
  chatId: string;
  messageId: number;
  text: string;
  botToken?: string;
}): Promise<boolean> {
  const botToken = input.botToken ?? config.telegramBotToken;
  const base = { chat_id: input.chatId, message_id: input.messageId };
  try {
    await telegramCall("editMessageText", { ...base, text: input.text }, botToken);
    return true;
  } catch {
    try {
      await telegramCall("editMessageCaption", { ...base, caption: input.text }, botToken);
      return true;
    } catch (e) {
      console.warn(`[telegram] sửa tin ${input.messageId} không được: ${String(e)}`);
      return false;
    }
  }
}

export async function sendApprovalMessage(input: {
  scanRunId: number;
  text: string;
}): Promise<void> {
  assertTelegramAdminConfigured();
  await telegramCall("sendMessage", {
    chat_id: config.telegramChatId,
    text: input.text,
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Duyệt", callback_data: `cleanup:approve:${input.scanRunId}` },
          { text: "Huỷ", callback_data: `cleanup:cancel:${input.scanRunId}` },
        ],
      ],
    },
  });
}

export async function answerCallbackQuery(callbackQueryId: string, text: string): Promise<void> {
  await telegramCall("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

export async function editTelegramMessage(input: {
  chatId: string;
  messageId: number;
  text: string;
}): Promise<void> {
  await telegramCall("editMessageText", {
    chat_id: input.chatId,
    message_id: input.messageId,
    text: input.text,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [] },
  });
}

export async function pollTelegramUpdates(now: number): Promise<TelegramUpdate[]> {
  assertTelegramAdminConfigured();
  const offsetRaw = getBotState(KEY_TELEGRAM_OFFSET);
  const offset = offsetRaw ? Number(offsetRaw) : undefined;
  const result = await telegramCall<any[]>("getUpdates", {
    offset,
    timeout: 0,
    allowed_updates: ["message", "callback_query"],
  });

  const updates: TelegramUpdate[] = [];
  let nextOffset = offset ?? 0;
  for (const u of result) {
    const updateId = Number(u?.update_id);
    if (Number.isFinite(updateId)) nextOffset = Math.max(nextOffset, updateId + 1);
    updates.push({
      updateId,
      messageText: typeof u?.message?.text === "string" ? u.message.text : null,
      callbackData:
        typeof u?.callback_query?.data === "string" ? u.callback_query.data : null,
      callbackQueryId:
        typeof u?.callback_query?.id === "string" ? u.callback_query.id : null,
      chatId: String(u?.message?.chat?.id ?? u?.callback_query?.message?.chat?.id ?? ""),
      messageId:
        typeof u?.message?.message_id === "number"
          ? u.message.message_id
          : typeof u?.callback_query?.message?.message_id === "number"
            ? u.callback_query.message.message_id
            : null,
    });
  }

  if (nextOffset !== (offset ?? 0)) {
    setBotState(KEY_TELEGRAM_OFFSET, String(nextOffset), now);
  }
  return updates.filter((u) => u.chatId === config.telegramChatId);
}

export interface TelegramInboxMessage {
  messageId: number;
  senderId: string;
  senderName: string;
  text: string;
  ts: number;
}

/**
 * Đọc tin nhắn thường của MỘT chat (tuỳ chọn: một topic trong forum group) bằng
 * một bot token riêng, có con trỏ offset riêng trong bot_state.
 *
 * Vì sao phải token riêng: mỗi bot Telegram chỉ có MỘT hàng đợi getUpdates, và
 * đọc xong là offset nhích, update biến mất với mọi người đọc khác. Dùng chung
 * token với bot duyệt cleanup (pollTelegramUpdates) thì hai bên nuốt tin của
 * nhau. Telegram cũng chỉ giữ update chưa đọc trong 24 giờ, nên hàm này phải
 * được gọi thường xuyên chứ không chỉ một lần mỗi ngày.
 *
 * Bot phải đã TẮT privacy mode (BotFather → /setprivacy → Disable) rồi được
 * kick ra add lại, nếu không Telegram sẽ không gửi tin nhắn group cho nó.
 *
 * Hàm này KHÔNG tự ghi con trỏ offset — nó trả `nextOffset` để bên gọi ghi SAU
 * khi đã lưu tin vào DB. Nhích con trỏ trước mà ghi DB lỗi là mất tin vĩnh viễn.
 */
export async function pollTelegramInbox(input: {
  botToken: string;
  chatId: string;
  topicId: number | null;
  offsetKey: string;
}): Promise<{ messages: TelegramInboxMessage[]; nextOffset: number | null }> {
  assertTelegramBotToken(input.botToken);
  const offsetRaw = getBotState(input.offsetKey);
  const offset = offsetRaw ? Number(offsetRaw) : undefined;

  const result = await telegramCall<any[]>(
    "getUpdates",
    { offset, timeout: 0, limit: 100, allowed_updates: ["message", "channel_post"] },
    input.botToken,
  );

  const messages: TelegramInboxMessage[] = [];
  let nextOffset = offset ?? 0;

  for (const update of result) {
    const updateId = Number(update?.update_id);
    if (Number.isFinite(updateId)) nextOffset = Math.max(nextOffset, updateId + 1);

    const message = update?.message ?? update?.channel_post;
    if (!message) continue;
    if (String(message?.chat?.id ?? "") !== input.chatId) continue;
    if (input.topicId !== null && Number(message?.message_thread_id) !== input.topicId) continue;

    // Ảnh kèm chú thích vẫn là tin tuyển dụng — lấy caption khi không có text.
    const text = typeof message.text === "string" ? message.text : (message.caption ?? "");
    if (typeof text !== "string" || text.trim() === "") continue;

    const from = message.from ?? {};
    const senderName = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
    messages.push({
      messageId: Number(message.message_id),
      senderId: String(from.id ?? message?.sender_chat?.id ?? "unknown"),
      senderName: senderName || String(from.username ?? ""),
      text,
      ts: Number(message.date) * 1000,
    });
  }

  return {
    messages,
    nextOffset: nextOffset !== (offset ?? 0) ? nextOffset : null,
  };
}

export interface TelegramDestinationInfo {
  chatId: string;
  chatTitle: string;
  chatType: string;
  messageThreadId: number | null;
}

/** Đọc message update đang chờ mà không đổi offset, phục vụ tìm chat/topic ID. */
export async function findTelegramDestinations(botToken: string): Promise<TelegramDestinationInfo[]> {
  const result = await telegramCall<any[]>("getUpdates", {
    timeout: 0,
    allowed_updates: ["message", "channel_post"],
  }, botToken);
  const unique = new Map<string, TelegramDestinationInfo>();
  for (const update of result) {
    const message = update?.message ?? update?.channel_post;
    const chatId = String(message?.chat?.id ?? "");
    if (!chatId) continue;
    const messageThreadId = Number.isSafeInteger(message?.message_thread_id)
      ? Number(message.message_thread_id)
      : null;
    const personName = [message?.chat?.first_name, message?.chat?.last_name]
      .filter(Boolean)
      .join(" ");
    const info: TelegramDestinationInfo = {
      chatId,
      chatTitle: String(message?.chat?.title ?? personName ?? ""),
      chatType: String(message?.chat?.type ?? ""),
      messageThreadId,
    };
    unique.set(`${chatId}:${messageThreadId ?? "main"}`, info);
  }
  return [...unique.values()];
}
