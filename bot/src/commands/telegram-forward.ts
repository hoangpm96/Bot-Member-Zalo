import { config } from "../config.js";
import {
  forwardZaloMessageToTelegram,
  isTelegramForwardConfigured,
} from "../telegram-forward.js";
import { findTelegramDestinations } from "../telegram.js";

export async function runTelegramForwardTest(): Promise<void> {
  if (!isTelegramForwardConfigured()) {
    console.error(
      "[telegram-forward-test] Chưa đủ cấu hình. Cần TELEGRAM_FORWARD_ENABLED=1, " +
        "TELEGRAM_FORWARD_BOT_TOKEN và TELEGRAM_FORWARD_CHAT_ID.",
    );
    process.exitCode = 1;
    return;
  }
  await forwardZaloMessageToTelegram({
    senderId: "test",
    displayName: "Bot-Member-Zalo",
    text: "✅ Kết nối forward thành công. Tin nhắn Zalo mới sẽ xuất hiện tại đây.",
    msgType: "webchat",
    media: null,
    ts: Date.now(),
  });
  console.log(
    `[telegram-forward-test] Đã gửi tới ${config.telegramForwardChatId}` +
      `${config.telegramForwardTopicId === null ? "" : `, topic ${config.telegramForwardTopicId}`}.`,
  );
}

export async function runTelegramFindTopic(): Promise<void> {
  if (!config.telegramForwardBotToken) {
    console.error("[telegram-find-topic] Chưa có TELEGRAM_FORWARD_BOT_TOKEN trong .env.");
    process.exitCode = 1;
    return;
  }
  const destinations = await findTelegramDestinations(config.telegramForwardBotToken);
  if (destinations.length === 0) {
    console.log(
      "[telegram-find-topic] Không thấy message mới. Gửi một tin vào topic bằng tài khoản " +
        "Telegram, rồi chạy lại ngay (tạm dừng cron telegram-poll nếu cần).",
    );
    return;
  }
  console.log("[telegram-find-topic] Các đích Telegram đang chờ:");
  for (const item of destinations) {
    console.log(
      `- ${item.chatTitle || "(không tên)"} [${item.chatType}]: ` +
        `TELEGRAM_FORWARD_CHAT_ID=${item.chatId}, ` +
        `TELEGRAM_FORWARD_TOPIC_ID=${item.messageThreadId ?? "(để trống)"}`,
    );
  }
}
