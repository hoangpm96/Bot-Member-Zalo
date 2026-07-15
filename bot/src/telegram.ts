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

export async function sendTelegramText(
  text: string,
  destination?: TelegramDestination,
  botToken = config.telegramBotToken,
): Promise<void> {
  if (!destination) assertTelegramAdminConfigured();
  await telegramCall("sendMessage", {
    chat_id: destination?.chatId ?? config.telegramChatId,
    ...(destination?.messageThreadId !== undefined
      ? { message_thread_id: destination.messageThreadId }
      : {}),
    text,
    disable_web_page_preview: true,
  }, botToken);
}

/** Gửi media bằng URL vào chat/channel/forum topic Telegram. */
export async function sendTelegramMedia(input: {
  type: "image" | "video";
  url: string;
  caption: string;
  destination: TelegramDestination;
  botToken?: string;
}): Promise<void> {
  const mediaField = input.type === "image" ? "photo" : "video";
  await telegramCall(input.type === "image" ? "sendPhoto" : "sendVideo", {
    chat_id: input.destination.chatId,
    ...(input.destination.messageThreadId !== undefined
      ? { message_thread_id: input.destination.messageThreadId }
      : {}),
    [mediaField]: input.url,
    caption: input.caption,
  }, input.botToken ?? config.telegramBotToken);
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
