import { config } from "../config.js";
import { sendTelegramText } from "../telegram.js";

/**
 * telegram-test — gửi 1 tin nhắn thử tới chat admin để xác nhận TELEGRAM_BOT_TOKEN +
 * TELEGRAM_CHAT_ID đúng. Nhận được tin trên Telegram = cấu hình OK.
 */
export async function runTelegramTest(): Promise<void> {
  if (config.telegramBotToken === "" || config.telegramChatId === "") {
    console.error("[telegram-test] Chưa cấu hình. Điền TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID vào .env.");
    process.exitCode = 1;
    return;
  }
  try {
    await sendTelegramText(
      "✅ Bot-Member-Zalo: kết nối Telegram thành công. Đây là tin nhắn thử.",
    );
    console.log("[telegram-test] Đã gửi tin thử. Kiểm tra Telegram — nếu thấy tin = cấu hình ĐÚNG.");
  } catch (e) {
    console.error(`[telegram-test] ❌ Gửi thất bại: ${String(e)}`);
    console.error("  → Kiểm lại token (từ @BotFather) + chat id. Nhớ chat với bot trước ít nhất 1 lần.");
    process.exitCode = 1;
  }
}
