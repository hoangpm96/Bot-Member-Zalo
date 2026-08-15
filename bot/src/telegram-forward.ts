import { config } from "./config.js";
import {
  deleteTelegramMessage,
  replaceTelegramMessageContent,
  sendTelegramMedia,
  sendTelegramText,
  type TelegramDestination,
} from "./telegram.js";
import {
  listPendingTelegramForwards,
  markTelegramForwardRemoved,
  saveTelegramForward,
} from "./db/index.js";

export interface ZaloForwardMessage {
  senderId: string;
  displayName: string;
  text: string | null;
  msgType: string;
  media: { type: "image" | "video"; count: number; url: string | null } | null;
  ts: number;
  /** Thread + id tin Zalo — để sau này tin bị thu hồi thì gỡ đúng bản sao bên Telegram. */
  threadId?: string;
  messageId?: string;
}

/** Nhãn thay chỗ khi Telegram không cho xoá nữa (tin quá 48 giờ). */
const RECALLED_LABEL = "🗑 (tin đã thu hồi bên Zalo)";

const TELEGRAM_TEXT_LIMIT = 4096;
const TELEGRAM_CAPTION_LIMIT = 1024;

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function escapeTelegramHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function destination(): TelegramDestination {
  if (!config.telegramForwardBotToken || !config.telegramForwardChatId) {
    throw new Error(
      "Thiếu TELEGRAM_FORWARD_BOT_TOKEN hoặc TELEGRAM_FORWARD_CHAT_ID để forward Zalo → Telegram",
    );
  }
  return {
    chatId: config.telegramForwardChatId,
    ...(config.telegramForwardTopicId !== null
      ? { messageThreadId: config.telegramForwardTopicId }
      : {}),
  };
}

export function isTelegramForwardConfigured(): boolean {
  return Boolean(
    config.telegramForwardEnabled &&
      config.telegramForwardBotToken &&
      config.telegramForwardChatId,
  );
}

function mediaLabel(media: ZaloForwardMessage["media"]): string {
  if (!media) return "";
  const noun = media.type === "image" ? "ảnh" : "video";
  const icon = media.type === "image" ? "🖼️" : "🎬";
  return media.count > 1 ? `${icon} ${media.count} ${noun}` : `${icon} ${noun}`;
}

function unsupportedLabel(msgType: string): string {
  const type = msgType.toLowerCase();
  if (type.includes("sticker")) return "🏷️ Sticker";
  if (type.includes("voice")) return "🎤 Tin nhắn thoại";
  if (type.includes("location")) return "📍 Vị trí";
  if (type.includes("file")) return "📁 Tệp đính kèm";
  if (type.includes("poll")) return "📊 Bình chọn";
  return "📎 Nội dung đính kèm";
}

/** Format HTML tối giản: tên người gửi in đậm, nội dung nằm ngay sau dấu hai chấm. */
export function formatZaloForward(input: ZaloForwardMessage): string {
  const sender = escapeTelegramHtml(input.displayName.trim() || input.senderId);
  const body = [input.text, mediaLabel(input.media)]
    .filter(Boolean)
    .map((part) => escapeTelegramHtml(String(part)))
    .join("\n");
  const content = body || escapeTelegramHtml(unsupportedLabel(input.msgType));
  return `<b>${sender}:</b> ${content}`;
}

/**
 * Zalo không hỗ trợ Telegram forward nguyên bản, nên bot sao chép nội dung sang đích.
 * Ảnh/video dùng URL CDN tạm của Zalo; nếu payload không có URL thì vẫn gửi metadata.
 */
export async function forwardZaloMessageToTelegram(input: ZaloForwardMessage): Promise<void> {
  const formatted = formatZaloForward(input);
  const remember = (tgMessageId: number | null): void => {
    if (tgMessageId === null || !input.threadId || !input.messageId) return;
    saveTelegramForward({
      threadId: input.threadId,
      zaloMessageId: input.messageId,
      chatId: destination().chatId,
      tgMessageId,
      ts: input.ts,
      now: Date.now(),
    });
  };

  if (input.media?.url) {
    try {
      remember(
        await sendTelegramMedia({
          type: input.media.type,
          url: input.media.url,
          caption: truncate(formatted, TELEGRAM_CAPTION_LIMIT),
          destination: destination(),
          botToken: config.telegramForwardBotToken,
          parseMode: "HTML",
        }),
      );
    } catch (e) {
      // CDN Zalo có thể chặn Telegram hoặc media vượt giới hạn Bot API. Khi đó vẫn
      // chuyển nội dung/cảnh báo dưới dạng text thay vì làm mất toàn bộ message.
      const fallback = `${formatted}\n⚠️ Không tải được media: ${escapeTelegramHtml(String(e))}`;
      remember(
        await sendTelegramText(
          truncate(fallback, TELEGRAM_TEXT_LIMIT),
          destination(),
          config.telegramForwardBotToken,
          "HTML",
        ),
      );
    }
    return;
  }
  remember(
    await sendTelegramText(
      truncate(formatted, TELEGRAM_TEXT_LIMIT),
      destination(),
      config.telegramForwardBotToken,
      "HTML",
    ),
  );
}

/**
 * Gỡ bản sao bên Telegram của các tin Zalo vừa bị thu hồi (hoặc bị bot kiểm duyệt xoá).
 *
 * Telegram chỉ cho bot xoá tin của chính nó trong vòng 48 giờ; quá hạn thì thay
 * nội dung bằng nhãn thu hồi để người đọc không còn thấy nội dung cũ. Tin forward
 * từ trước khi có bảng ánh xạ thì không tra được — bỏ qua, không có cách gỡ.
 *
 * Trả về số tin đã xoá hẳn và số tin chỉ đổi được nhãn.
 */
export async function removeForwardedTelegramMessages(
  threadId: string,
  zaloMessageIds: string[],
): Promise<{ deleted: number; relabeled: number }> {
  if (!isTelegramForwardConfigured()) return { deleted: 0, relabeled: 0 };

  const rows = listPendingTelegramForwards(threadId, zaloMessageIds);
  let deleted = 0;
  let relabeled = 0;

  for (const row of rows) {
    const target = {
      chatId: row.chat_id,
      messageId: row.tg_message_id,
      botToken: config.telegramForwardBotToken,
    };
    if (await deleteTelegramMessage(target)) {
      deleted += 1;
      markTelegramForwardRemoved(row.id, "deleted", Date.now());
      continue;
    }
    if (await replaceTelegramMessageContent({ ...target, text: RECALLED_LABEL })) {
      relabeled += 1;
      markTelegramForwardRemoved(row.id, "relabeled", Date.now());
    }
    // Cả hai đều hỏng (tin đã bị xoá tay, bot mất quyền...) → để nguyên removed_at
    // NULL, lần thu hồi sau của cùng tin sẽ thử lại.
  }

  return { deleted, relabeled };
}
