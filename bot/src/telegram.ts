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
}

function isConfigured(): boolean {
  return config.telegramBotToken !== "" && config.telegramChatId !== "";
}

function assertTelegramConfigured(): void {
  if (!isConfigured()) {
    throw new Error("Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID trong .env");
  }
}

async function telegramCall<T>(method: string, body: Record<string, unknown>): Promise<T> {
  assertTelegramConfigured();
  const res = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!res.ok || !json.ok) {
    throw new Error(`Telegram ${method} lỗi: ${json.description ?? res.statusText}`);
  }
  return json.result as T;
}

export async function sendTelegramText(text: string): Promise<void> {
  await telegramCall("sendMessage", {
    chat_id: config.telegramChatId,
    text,
    disable_web_page_preview: true,
  });
}

export async function sendApprovalMessage(input: {
  scanRunId: number;
  text: string;
}): Promise<void> {
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

export async function pollTelegramUpdates(now: number): Promise<TelegramUpdate[]> {
  assertTelegramConfigured();
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
    });
  }

  if (nextOffset !== (offset ?? 0)) {
    setBotState(KEY_TELEGRAM_OFFSET, String(nextOffset), now);
  }
  return updates.filter((u) => u.chatId === config.telegramChatId);
}
