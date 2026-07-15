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
  return media.count > 1 ? `📎 Album ${media.count} ${noun}` : `📎 1 ${noun}`;
}

function unsupportedLabel(msgType: string): string {
  const type = msgType.toLowerCase();
  if (type.includes("sticker")) return "🏷️ Sticker";
  if (type.includes("voice")) return "🎤 Tin nhắn thoại";
  if (type.includes("location")) return "📍 Vị trí";
  if (type.includes("file")) return "📁 Tệp đính kèm";
  return msgType ? `📎 Tin nhắn dạng ${msgType}` : "📎 Tin nhắn không có nội dung text";
}

/** Format thuần text để không phải tin tưởng/escape HTML từ nội dung Zalo. */
export function formatZaloForward(input: ZaloForwardMessage): string {
  const sender = input.displayName.trim() || input.senderId;
  const sentAt = new Date(input.ts).toLocaleString("vi-VN", { hour12: false });
  const body = [input.text, mediaLabel(input.media)].filter(Boolean).join("\n");
  return `💬 Zalo · ${sender}\n🕒 ${sentAt}\n\n${body || unsupportedLabel(input.msgType)}`;
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
      });
    } catch (e) {
      // CDN Zalo có thể chặn Telegram hoặc media vượt giới hạn Bot API. Khi đó vẫn
      // chuyển nội dung/cảnh báo dưới dạng text thay vì làm mất toàn bộ message.
      const fallback = `${formatted}\n\n⚠️ Không tải được media: ${String(e)}`;
      await sendTelegramText(
        truncate(fallback, TELEGRAM_TEXT_LIMIT),
        destination(),
        config.telegramForwardBotToken,
      );
    }
    return;
  }
  await sendTelegramText(
    truncate(formatted, TELEGRAM_TEXT_LIMIT),
    destination(),
    config.telegramForwardBotToken,
  );
}
