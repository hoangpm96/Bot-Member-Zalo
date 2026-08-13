import { config } from "../config.js";
import { runtimeConfig } from "../runtime-config.js";
import {
  acquireLock,
  backfillDailySummaryIfMissing,
  countGroupMediaBetween,
  getBotState,
  listGroupMessagesBetween,
  recordBotError,
  releaseLock,
  saveDailySummary,
  setBotState,
} from "../db/index.js";
import { login, sendGroupText, sleep } from "../zalo/client.js";
import { sendTelegramText } from "../telegram.js";
import {
  buildTranscript,
  composeSummaryMessages,
  dayWindowFromLabelVN,
  isBotSummaryMessage,
  isoDateFromDayStartVN,
  previousDayWindowVN,
  summarizeWithDeepSeek,
  topSenders,
} from "../summary.js";

const STATE_KEY_LAST = "daily_summary_last";
/** Dùng chung với backfill-summaries — hai lệnh không được ghi kho/gọi model chồng nhau. */
export const DAILY_SUMMARY_LOCK_KEY = "daily_summary_lock";
// Stale rộng vì các group Zalo được giãn cách SUMMARY_GROUP_GAP_MINUTES —
// một lần chạy nhiều group có thể kéo dài quá 30 phút.
const LOCK_STALE_MS = 3 * 60 * 60 * 1000;
/** Heartbeat listener cũ hơn ngưỡng này → dữ liệu ngày hôm qua coi như đáng ngờ. */
const HEARTBEAT_STALE_MS = 15 * 60 * 1000;

/** Một đích nhận bản tóm tắt. `key` dùng làm khoá tiến độ trong state. */
type SummaryDestination =
  | { key: string; kind: "zalo"; groupId: string }
  | { key: string; kind: "telegram"; chatId: string };

/** Danh sách đích theo config: các group Zalo (theo thứ tự khai báo) rồi Telegram. */
function buildDestinations(): SummaryDestination[] {
  const dests: SummaryDestination[] = config.summaryGroupIds.map((groupId) => ({
    key: `zalo:${groupId}`,
    kind: "zalo" as const,
    groupId,
  }));
  if (config.summaryTelegramChatId) {
    dests.push({
      key: `telegram:${config.summaryTelegramChatId}`,
      kind: "telegram",
      chatId: config.summaryTelegramChatId,
    });
  }
  return dests;
}

/**
 * Trạng thái gửi của một ngày, lưu trong bot_state. Lưu CẢ nội dung parts và
 * tiến độ THEO TỪNG ĐÍCH để:
 *  - chống gửi trùng khi cron nhân đôi / chạy tay lại (đích nào đủ thì bỏ qua);
 *  - resume đúng chỗ khi gửi dở mà KHÔNG gọi lại DeepSeek — gọi lại sẽ ra văn
 *    bản khác, không thể nối tiếp an toàn;
 *  - thêm đích mới trong ngày rồi chạy lại → chỉ đích mới nhận, đích cũ không trùng.
 */
interface SummarySendState {
  dayLabel: string;
  parts: string[];
  /** Số part đã gửi thành công theo key của từng đích. */
  sent: Record<string, number>;
  totalMessages: number;
  createdAt: number;
  sentAt?: number;
}

function readSendState(): SummarySendState | null {
  const raw = getBotState(STATE_KEY_LAST);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SummarySendState> & { partsSent?: number };
    if (typeof parsed.dayLabel !== "string") return null;
    const parts = Array.isArray(parsed.parts) ? parsed.parts.map(String) : [];
    let sent: Record<string, number> = {};
    if (parsed.sent && typeof parsed.sent === "object") {
      for (const [k, v] of Object.entries(parsed.sent)) {
        if (typeof v === "number") sent[k] = v;
      }
    } else if (typeof parsed.partsSent === "number" && config.summaryGroupIds[0]) {
      // State bản cũ (một đích duy nhất): quy tiến độ về group Zalo đầu tiên.
      sent = { [`zalo:${config.summaryGroupIds[0]}`]: parsed.partsSent };
    }
    return {
      dayLabel: parsed.dayLabel,
      parts,
      sent,
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

function isAllSent(state: SummarySendState, dests: SummaryDestination[]): boolean {
  return dests.every((d) => (state.sent[d.key] ?? 0) >= state.parts.length);
}

/**
 * Gửi phần còn thiếu cho từng đích, cập nhật tiến độ sau MỖI tin để resume được.
 * Giữa các GROUP ZALO nghỉ SUMMARY_GROUP_GAP_MINUTES (+jitter 0-25%) — cùng một
 * bản tin xuất hiện ở nhiều group cùng giây trông rất "bot". Telegram không cần.
 */
async function sendParts(state: SummarySendState, dests: SummaryDestination[]): Promise<void> {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  let api: any = null;
  let sentInRun = 0;
  let sentToZaloBefore = false;
  for (const dest of dests) {
    const already = state.sent[dest.key] ?? 0;
    if (already >= state.parts.length) continue;
    const gapMinutes = runtimeConfig.summaryGroupGapMinutes;
    if (dest.kind === "zalo" && sentToZaloBefore && gapMinutes > 0) {
      const gapMs = Math.round(gapMinutes * 60_000 * (1 + Math.random() * 0.25));
      console.log(
        `[daily-summary] Nghỉ ${Math.round(gapMs / 1000)}s trước khi gửi ${dest.key} (giãn cách chống lộ bot)...`,
      );
      await sleep(gapMs);
    }
    for (let i = already; i < state.parts.length; i += 1) {
      if (sentInRun > 0) await sleep(runtimeConfig.zaloThrottleMs);
      const part = state.parts[i] ?? "";
      if (dest.kind === "zalo") {
        api ??= await login();
        await sendGroupText(api, dest.groupId, part);
      } else {
        const topicId = runtimeConfig.summaryTelegramTopicId;
        await sendTelegramText(
          part,
          {
            chatId: dest.chatId,
            ...(topicId !== null ? { messageThreadId: topicId } : {}),
          },
          config.summaryTelegramBotToken || config.telegramBotToken,
        );
      }
      sentInRun += 1;
      state.sent[dest.key] = i + 1;
      if (isAllSent(state, dests)) state.sentAt = Date.now();
      writeSendState(state);
      console.log(
        `[daily-summary] Đã gửi tin ${i + 1}/${state.parts.length} → ${dest.key} (${part.length} ký tự).`,
      );
    }
    if (dest.kind === "zalo") sentToZaloBefore = true;
  }
}

/**
 * Cron 9:10 sáng: tóm tắt tin nhắn NGÀY HÔM TRƯỚC của GROUP_ID bằng DeepSeek
 * rồi gửi đến các đích: group Zalo trong SUMMARY_GROUP_ID (có thể gồm cả nhóm
 * chính) và/hoặc Telegram SUMMARY_TELEGRAM_CHAT_ID. Ngày nhiều nội dung →
 * bản tin tự chia tối đa SUMMARY_MAX_PARTS tin đánh số (1/N).
 *
 * DRY_RUN=1 → chỉ in bản tóm tắt ra console, không gửi (vẫn gọi DeepSeek
 * để test được chất lượng tóm tắt). Cron production đặt DRY_RUN=0.
 *
 * Không có đích nào + không có DEEPSEEK_API_KEY = tính năng TẮT (no-op, khớp
 * .env.example) — cron có cài sẵn cũng không spam lỗi. Cấu hình nửa vời
 * (có key không có đích, hoặc ngược lại) → báo lỗi rõ.
 */
export async function runDailySummary(): Promise<void> {
  const hasDestination = config.summaryGroupIds.length > 0 || config.summaryTelegramChatId !== "";
  if (!hasDestination && !config.deepseekApiKey) {
    console.log(
      "[daily-summary] Tính năng đang TẮT (không có SUMMARY_GROUP_ID/SUMMARY_TELEGRAM_CHAT_ID lẫn DEEPSEEK_API_KEY) — bỏ qua.",
    );
    return;
  }
  if (!hasDestination || !config.deepseekApiKey) {
    throw new Error(
      "Cấu hình tóm tắt dở dang: cần DEEPSEEK_API_KEY VÀ ít nhất một đích " +
        "(SUMMARY_GROUP_ID hoặc SUMMARY_TELEGRAM_CHAT_ID) — hoặc xoá hết để tắt.",
    );
  }
  if (!config.groupId) {
    throw new Error("GROUP_ID chưa cấu hình — không biết tóm tắt nhóm nào.");
  }
  if (config.summaryTelegramChatId && !config.summaryTelegramBotToken && !config.telegramBotToken) {
    throw new Error(
      "Đã đặt SUMMARY_TELEGRAM_CHAT_ID nhưng thiếu bot token (SUMMARY_TELEGRAM_BOT_TOKEN hoặc TELEGRAM_BOT_TOKEN).",
    );
  }

  const now = Date.now();
  const window = previousDayWindowVN(now);
  const dests = buildDestinations();

  // Chống 2 process chạy chồng (cron treo + chạy tay).
  if (!acquireLock(DAILY_SUMMARY_LOCK_KEY, now, LOCK_STALE_MS)) {
    console.log("[daily-summary] Đang có tiến trình daily-summary khác chạy — bỏ qua.");
    return;
  }

  try {
    // Đã gửi đủ hôm nay → skip; gửi dở / có đích mới → gửi phần thiếu từ parts đã lưu.
    const prev = readSendState();
    // Kho daily_summaries ra đời sau tính năng tóm tắt — bản tin đang nằm trong
    // bot_state (sắp bị ghi đè khi sang ngày mới) được cứu vào kho trước.
    if (prev) backfillSummaryArchiveFromState(prev);
    if (prev?.dayLabel === window.label && prev.parts.length > 0) {
      if (isAllSent(prev, dests)) {
        console.log(`[daily-summary] Đã gửi đủ tóm tắt ngày ${window.label} cho mọi đích — bỏ qua.`);
        return;
      }
      if (config.dryRun) {
        console.log(
          `[daily-summary] DRY-RUN: bản tin ngày ${window.label} còn đích chưa gửi đủ, không gửi.`,
        );
        return;
      }
      console.log(`[daily-summary] Gửi phần còn thiếu của bản tin ngày ${window.label}...`);
      await sendParts(prev, dests);
      return;
    }

    console.log(
      `[daily-summary] Tóm tắt ngày ${window.label} ` +
        `(${new Date(window.startTs).toISOString()} → ${new Date(window.endTs).toISOString()}) ` +
        `→ ${dests.map((d) => d.key).join(", ")}.`,
    );

    // GROUP_ID có thể nằm trong SUMMARY_GROUP_ID → bản tin hôm trước do bot đăng
    // lại thành "tin nhắn của ngày"; loại ra kẻo tự tóm tắt lại chính mình.
    const rawMessages = listGroupMessagesBetween(config.groupId, window.startTs, window.endTs);
    const messages = rawMessages.filter((m) => !isBotSummaryMessage(m.text));
    if (messages.length < rawMessages.length) {
      console.log(
        `[daily-summary] Loại ${rawMessages.length - messages.length} tin là bản tóm tắt cũ của bot khỏi dữ liệu.`,
      );
    }
    const media = countGroupMediaBetween(config.groupId, window.startTs, window.endTs);

    const top = topSenders(messages);
    let parts: string[];
    let summaryText: string;
    let transcriptInfo: ReturnType<typeof buildTranscript> | null = null;
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
      summaryText = "Hôm qua nhóm không có tin nhắn nào.";
      parts = [`📋 Tóm tắt nhóm ngày ${window.label}\n\n${summaryText}`];
      console.log("[daily-summary] Không có tin nhắn trong ngày — gửi thông báo ngày yên ắng.");
    } else {
      const transcript = buildTranscript(messages);
      transcriptInfo = transcript;
      console.log(
        `[daily-summary] ${transcript.totalMessages} tin nhắn từ ${transcript.uniqueSenders} người ` +
          `(đưa vào model ${transcript.includedMessages} tin, ${transcript.text.length} ký tự), ` +
          `${media.images} ảnh, ${media.videos} video. Đang gọi DeepSeek (${config.deepseekModel})...`,
      );

      const maxParts = runtimeConfig.summaryMaxParts;
      const summary =
        messages.length > 0
          ? await summarizeWithDeepSeek({ transcript: transcript.text, dayLabel: window.label, maxParts })
          : "- Trong ngày chỉ có ảnh/video, không có tin nhắn văn bản để tóm tắt.";

      summaryText = summary;
      parts = composeSummaryMessages(
        {
          dayLabel: window.label,
          summary,
          totalMessages: transcript.totalMessages,
          includedMessages: transcript.includedMessages,
          uniqueSenders: transcript.uniqueSenders,
          images: media.images,
          videos: media.videos,
          topSenders: top,
        },
        maxParts,
      );
    }

    if (config.dryRun) {
      console.log(
        `[daily-summary] DRY-RUN: sẽ gửi ${parts.length} tin đến [${dests.map((d) => d.key).join(", ")}]:\n\n${parts.join("\n\n---\n\n")}`,
      );
      return;
    }

    // Lưu VĨNH VIỄN vào kho daily_summaries TRƯỚC khi gửi — gửi lỗi thì bản tin
    // vẫn còn nguyên cho việc phân tích/viết blog sau này.
    saveDailySummary({
      dayDate: isoDateFromDayStartVN(window.startTs),
      dayLabel: window.label,
      dayStartTs: window.startTs,
      threadId: config.groupId,
      summaryText,
      parts,
      totalMessages: messages.length,
      includedMessages: transcriptInfo?.includedMessages ?? 0,
      uniqueSenders: transcriptInfo?.uniqueSenders ?? 0,
      images: media.images,
      videos: media.videos,
      topSenders: top,
      model: messages.length > 0 ? config.deepseekModel : "",
      transcriptChars: transcriptInfo ? transcriptInfo.text.length : null,
      source: "live",
      now: Date.now(),
    });
    console.log(`[daily-summary] Đã lưu bản tóm tắt ngày ${window.label} vào kho daily_summaries.`);

    // Ghi state TRƯỚC khi gửi để lần chạy lại resume đúng chỗ thay vì gửi trùng.
    const state: SummarySendState = {
      dayLabel: window.label,
      parts,
      sent: {},
      totalMessages: messages.length,
      createdAt: Date.now(),
    };
    writeSendState(state);
    await sendParts(state, dests);
  } finally {
    releaseLock(DAILY_SUMMARY_LOCK_KEY);
  }
}

/**
 * Cứu bản tin đang nằm trong bot_state vào kho daily_summaries nếu ngày đó chưa
 * có (kho ra đời sau tính năng tóm tắt; state bị ghi đè mỗi ngày). State chỉ giữ
 * parts đã compose nên summary_text là parts nối lại; thống kê ngoài
 * totalMessages và model sinh bản tin đều không rõ → để NULL/rỗng.
 */
function backfillSummaryArchiveFromState(state: SummarySendState): void {
  if (state.parts.length === 0) return;
  const window = dayWindowFromLabelVN(state.dayLabel);
  if (!window) return;
  const inserted = backfillDailySummaryIfMissing({
    dayDate: isoDateFromDayStartVN(window.startTs),
    dayLabel: window.label,
    dayStartTs: window.startTs,
    threadId: config.groupId,
    summaryText: state.parts.join("\n\n"),
    parts: state.parts,
    totalMessages: state.totalMessages,
    now: state.createdAt > 0 ? state.createdAt : Date.now(),
  });
  if (inserted) {
    console.log(
      `[daily-summary] Đã cứu bản tin ngày ${state.dayLabel} từ bot_state vào kho daily_summaries (backfill).`,
    );
  }
}

/** Cứu bản tin trong bot_state vào kho — backfill-summaries gọi trước khi bù quá khứ. */
export function rescueSummaryStateToArchive(): void {
  const prev = readSendState();
  if (prev) backfillSummaryArchiveFromState(prev);
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
