import { config } from "../config.js";
import {
  acquireLock,
  countGroupMediaBetween,
  getBotState,
  listGroupMessagesBetween,
  recordBotError,
  releaseLock,
  setBotState,
} from "../db/index.js";
import { login, sendGroupText, sleep } from "../zalo/client.js";
import { sendTelegramText } from "../telegram.js";
import {
  buildTranscript,
  composeSummaryMessages,
  previousDayWindowVN,
  summarizeWithDeepSeek,
  topSenders,
} from "../summary.js";

const STATE_KEY_LAST = "daily_summary_last";
const LOCK_KEY = "daily_summary_lock";
const LOCK_STALE_MS = 30 * 60 * 1000;
/** Heartbeat listener cũ hơn ngưỡng này → dữ liệu ngày hôm qua coi như đáng ngờ. */
const HEARTBEAT_STALE_MS = 15 * 60 * 1000;

/**
 * Trạng thái gửi của một ngày, lưu trong bot_state. Lưu CẢ nội dung parts để:
 *  - chống gửi trùng khi cron nhân đôi / chạy tay lại (partsSent đủ → skip);
 *  - resume đúng chỗ khi gửi dở (tin 1 đi rồi, tin 2 lỗi) mà KHÔNG gọi lại
 *    DeepSeek — gọi lại sẽ ra văn bản khác, không thể nối tiếp an toàn.
 */
interface SummarySendState {
  dayLabel: string;
  parts: string[];
  partsSent: number;
  totalMessages: number;
  createdAt: number;
  sentAt?: number;
}

function readSendState(): SummarySendState | null {
  const raw = getBotState(STATE_KEY_LAST);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SummarySendState>;
    if (typeof parsed.dayLabel !== "string") return null;
    return {
      dayLabel: parsed.dayLabel,
      parts: Array.isArray(parsed.parts) ? parsed.parts.map(String) : [],
      partsSent: typeof parsed.partsSent === "number" ? parsed.partsSent : 0,
      totalMessages: typeof parsed.totalMessages === "number" ? parsed.totalMessages : 0,
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : 0,
      sentAt: typeof parsed.sentAt === "number" ? parsed.sentAt : undefined,
    };
  } catch {
    return null; // State hỏng thì coi như chưa gửi.
  }
}

function writeSendState(state: SummarySendState): void {
  setBotState(STATE_KEY_LAST, JSON.stringify(state), Date.now());
}

/** Gửi lần lượt các part còn thiếu, cập nhật tiến độ sau MỖI tin để resume được. */
async function sendParts(state: SummarySendState): Promise<void> {
  const api = await login();
  for (let i = state.partsSent; i < state.parts.length; i += 1) {
    if (i > state.partsSent) await sleep(config.zaloThrottleMs);
    const part = state.parts[i] ?? "";
    await sendGroupText(api, config.summaryGroupId, part);
    state.partsSent = i + 1;
    if (state.partsSent === state.parts.length) state.sentAt = Date.now();
    writeSendState(state);
    console.log(
      `[daily-summary] Đã gửi tin ${i + 1}/${state.parts.length} (${part.length} ký tự) vào group ${config.summaryGroupId}.`,
    );
  }
}

/**
 * Cron 7:30 sáng: tóm tắt tin nhắn NGÀY HÔM TRƯỚC của GROUP_ID bằng DeepSeek
 * rồi gửi vào group phụ SUMMARY_GROUP_ID (cùng tài khoản co-admin, đã join cả 2 nhóm).
 * Ngày nhiều nội dung → bản tin tự chia tối đa 3 tin nhắn đánh số (1/N).
 *
 * DRY_RUN=1 → chỉ in bản tóm tắt ra console, không gửi Zalo (vẫn gọi DeepSeek
 * để test được chất lượng tóm tắt). Cron production đặt DRY_RUN=0.
 *
 * Cả SUMMARY_GROUP_ID lẫn DEEPSEEK_API_KEY đều rỗng = tính năng TẮT (no-op,
 * khớp .env.example) — cron có cài sẵn cũng không spam lỗi. Chỉ điền 1 trong 2
 * = cấu hình dở dang → báo lỗi rõ.
 */
export async function runDailySummary(): Promise<void> {
  if (!config.summaryGroupId && !config.deepseekApiKey) {
    console.log(
      "[daily-summary] Tính năng đang TẮT (SUMMARY_GROUP_ID và DEEPSEEK_API_KEY đều trống) — bỏ qua.",
    );
    return;
  }
  if (!config.summaryGroupId || !config.deepseekApiKey) {
    throw new Error(
      "Cấu hình tóm tắt dở dang: cần điền CẢ SUMMARY_GROUP_ID lẫn DEEPSEEK_API_KEY (hoặc xoá cả hai để tắt).",
    );
  }
  if (!config.groupId) {
    throw new Error("GROUP_ID chưa cấu hình — không biết tóm tắt nhóm nào.");
  }
  if (config.summaryGroupId === config.groupId) {
    throw new Error(
      "SUMMARY_GROUP_ID trùng GROUP_ID — tóm tắt phải gửi sang group phụ, không gửi ngược vào nhóm chính.",
    );
  }

  const now = Date.now();
  const window = previousDayWindowVN(now);

  // Chống 2 process chạy chồng (cron treo + chạy tay).
  if (!acquireLock(LOCK_KEY, now, LOCK_STALE_MS)) {
    console.log("[daily-summary] Đang có tiến trình daily-summary khác chạy — bỏ qua.");
    return;
  }

  try {
    // Đã gửi đủ hôm nay → skip; gửi dở → resume phần còn thiếu, không gọi lại DeepSeek.
    const prev = readSendState();
    if (prev?.dayLabel === window.label) {
      if (prev.parts.length === 0 || prev.partsSent >= prev.parts.length) {
        console.log(`[daily-summary] Đã gửi tóm tắt ngày ${window.label} rồi — bỏ qua.`);
        return;
      }
      if (config.dryRun) {
        console.log(
          `[daily-summary] DRY-RUN: có bản tin gửi dở ${prev.partsSent}/${prev.parts.length} của ngày ${window.label}, không gửi.`,
        );
        return;
      }
      console.log(
        `[daily-summary] Gửi tiếp bản tin ngày ${window.label} từ tin ${prev.partsSent + 1}/${prev.parts.length}...`,
      );
      await sendParts(prev);
      return;
    }

    console.log(
      `[daily-summary] Tóm tắt ngày ${window.label} ` +
        `(${new Date(window.startTs).toISOString()} → ${new Date(window.endTs).toISOString()}).`,
    );

    const messages = listGroupMessagesBetween(config.groupId, window.startTs, window.endTs);
    const media = countGroupMediaBetween(config.groupId, window.startTs, window.endTs);

    let parts: string[];
    if (messages.length === 0 && media.images === 0 && media.videos === 0) {
      // "Ngày yên ắng" chỉ đáng tin nếu listener còn sống — listener chết cả ngày
      // cũng cho ra DB trống y hệt. Heartbeat stale → cảnh báo admin, KHÔNG đăng
      // "nhóm yên ắng" như sự thật.
      if (isListenerHeartbeatStale(now)) {
        const msg =
          `daily-summary: không có tin nhắn nào được ghi cho ngày ${window.label} ` +
          "nhưng heartbeat listener đang stale — nhiều khả năng bot bị gián đoạn thu thập, " +
          "không gửi bản tin 'nhóm yên ắng' để tránh báo sai. Kiểm tra zalo-bot trên VPS.";
        console.warn(`[daily-summary] ${msg}`);
        recordBotError({ source: "daily-summary", code: "quiet_day_suspect", message: msg });
        await notifyTelegramBestEffort(`⚠️ ${msg}`);
        return;
      }
      parts = [`📋 Tóm tắt nhóm ngày ${window.label}\n\nHôm qua nhóm không có tin nhắn nào.`];
      console.log("[daily-summary] Không có tin nhắn trong ngày — gửi thông báo ngày yên ắng.");
    } else {
      const transcript = buildTranscript(messages);
      console.log(
        `[daily-summary] ${transcript.totalMessages} tin nhắn từ ${transcript.uniqueSenders} người ` +
          `(đưa vào model ${transcript.includedMessages} tin, ${transcript.text.length} ký tự), ` +
          `${media.images} ảnh, ${media.videos} video. Đang gọi DeepSeek (${config.deepseekModel})...`,
      );

      const summary =
        messages.length > 0
          ? await summarizeWithDeepSeek({ transcript: transcript.text, dayLabel: window.label })
          : "- Trong ngày chỉ có ảnh/video, không có tin nhắn văn bản để tóm tắt.";

      parts = composeSummaryMessages(
        {
          dayLabel: window.label,
          summary,
          totalMessages: transcript.totalMessages,
          includedMessages: transcript.includedMessages,
          uniqueSenders: transcript.uniqueSenders,
          images: media.images,
          videos: media.videos,
          topSenders: topSenders(messages),
        },
        config.summaryMaxParts,
      );
    }

    if (config.dryRun) {
      console.log(
        `[daily-summary] DRY-RUN: sẽ gửi ${parts.length} tin vào group ${config.summaryGroupId}:\n\n${parts.join("\n\n---\n\n")}`,
      );
      return;
    }

    // Ghi state TRƯỚC khi gửi để lần chạy lại resume đúng chỗ thay vì gửi trùng.
    const state: SummarySendState = {
      dayLabel: window.label,
      parts,
      partsSent: 0,
      totalMessages: messages.length,
      createdAt: Date.now(),
    };
    writeSendState(state);
    await sendParts(state);
  } finally {
    releaseLock(LOCK_KEY);
  }
}

/** Heartbeat listener (bot_state.bot_health) cũ quá ngưỡng hoặc không có → true. */
function isListenerHeartbeatStale(now: number): boolean {
  const raw = getBotState("bot_health");
  if (!raw) return true;
  try {
    const health = JSON.parse(raw) as { heartbeatAt?: number };
    return typeof health.heartbeatAt !== "number" || now - health.heartbeatAt > HEARTBEAT_STALE_MS;
  } catch {
    return true;
  }
}

async function notifyTelegramBestEffort(text: string): Promise<void> {
  if (!config.telegramBotToken || !config.telegramChatId) return;
  try {
    await sendTelegramText(text);
  } catch {
    // Telegram lỗi nốt thì đành chịu — đã có bot_errors + log cron.
  }
}

/** Bọc lỗi: ghi bot_errors + báo Telegram best-effort để không lặng lẽ mất bản tin. */
export async function runDailySummarySafe(): Promise<void> {
  try {
    await runDailySummary();
  } catch (e) {
    recordBotError({
      source: "daily-summary",
      code: "daily_summary_failed",
      message: String(e),
      detail: e instanceof Error ? e.stack : null,
    });
    await notifyTelegramBestEffort(
      `⚠️ daily-summary lỗi, chưa gửi được bản tóm tắt ngày hôm qua:\n${String(e)}`,
    );
    throw e;
  }
}
