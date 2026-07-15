import { config } from "./config.js";
import { sendTelegramMedia, sendTelegramText, type TelegramDestination } from "./telegram.js";

export interface ZaloForwardMessage {
  senderId: string;
  displayName: string;
  text: string | null;
  msgType: string;
  media: { type: "image" | "video"; count: number; url: string | null } | null;
  ts: number;
}

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
  if (input.media?.url) {
    try {
      await sendTelegramMedia({
        type: input.media.type,
        url: input.media.url,
        caption: truncate(formatted, TELEGRAM_CAPTION_LIMIT),
        destination: destination(),
        botToken: config.telegramForwardBotToken,
        parseMode: "HTML",
      });
    } catch (e) {
      // CDN Zalo có thể chặn Telegram hoặc media vượt giới hạn Bot API. Khi đó vẫn
      // chuyển nội dung/cảnh báo dưới dạng text thay vì làm mất toàn bộ message.
      const fallback = `${formatted}\n⚠️ Không tải được media: ${escapeTelegramHtml(String(e))}`;
      await sendTelegramText(
        truncate(fallback, TELEGRAM_TEXT_LIMIT),
        destination(),
        config.telegramForwardBotToken,
        "HTML",
      );
    }
    return;
  }
  await sendTelegramText(
    truncate(formatted, TELEGRAM_TEXT_LIMIT),
    destination(),
    config.telegramForwardBotToken,
    "HTML",
  );
}
