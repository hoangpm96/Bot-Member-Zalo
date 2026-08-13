import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import {
  acquireLock,
  getBotState,
  listGroupMessagesBetween,
  recordBotError,
  releaseLock,
  setBotState,
} from "../db/index.js";
import { sendTelegramText } from "../telegram.js";
import {
  buildTranscript,
  isBotSummaryMessage,
  isoDateFromDayStartVN,
  previousDayWindowVN,
} from "../summary.js";
import {
  type PublicPost,
  brandImage,
  draftPublicPost,
  generateTopicImage,
  postMultiPhoto,
} from "../fb-post.js";

const STATE_KEY = "daily_fb_post_last";
const LOCK_KEY = "daily_fb_post_lock";
const LOCK_STALE_MS = 2 * 60 * 60 * 1000;
/** Heartbeat listener cũ hơn ngưỡng này → "ngày yên ắng" đáng ngờ, không kết luận bừa. */
const HEARTBEAT_STALE_MS = 15 * 60 * 1000;
/** Đăng lỗi: thử lại 3 lần, giãn cách 5 phút (brainstorm Mục 7.2). */
const POST_ATTEMPTS = 3;
const POST_RETRY_GAP_MS = 5 * 60 * 1000;

/**
 * Trạng thái theo ngày trong bot_state: giữ bản public đã soạn để lần chạy lại
 * (cron nhân đôi / retry tay) KHÔNG gọi lại DeepSeek, và postId để chống đăng trùng.
 */
interface FbPostState {
  dayLabel: string;
  post?: PublicPost;
  postId?: string;
  createdAt: number;
}

function readState(): FbPostState | null {
  const raw = getBotState(STATE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FbPostState>;
    if (typeof parsed.dayLabel !== "string") return null;
    return {
      dayLabel: parsed.dayLabel,
      post: parsed.post,
      postId: typeof parsed.postId === "string" ? parsed.postId : undefined,
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : 0,
    };
  } catch {
    return null;
  }
}

function writeState(state: FbPostState): void {
  setBotState(STATE_KEY, JSON.stringify(state), Date.now());
}

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

/**
 * Cron 8:00 sáng: soạn BẢN PUBLIC từ tin nhắn NGÀY HÔM TRƯỚC của GROUP_ID
 * (DeepSeek, lược tên thành viên/chuyện nội bộ), sinh tối đa 3 ảnh minh họa
 * line-art BAHUB, đăng 1 bài nhiều hình lên Facebook Page rồi gửi link qua
 * Telegram để admin bấm Share về group FB + trang cá nhân.
 *
 * Không có FB_PAGE_ID lẫn FB_PAGE_TOKEN = tính năng TẮT (no-op, khớp .env.example).
 * Cấu hình nửa vời → báo lỗi rõ. DRY_RUN=1 → soạn bài + sinh ảnh (có cache) nhưng
 * KHÔNG đăng và KHÔNG nhắn Telegram.
 */
export async function runDailyFbPost(): Promise<void> {
  if (!config.fbPageId && !config.fbPageToken) {
    console.log("[daily-fb-post] Tính năng đang TẮT (không có FB_PAGE_ID/FB_PAGE_TOKEN) — bỏ qua.");
    return;
  }
  if (!config.fbPageId || !config.fbPageToken) {
    throw new Error("Cấu hình dở dang: cần CẢ FB_PAGE_ID và FB_PAGE_TOKEN — hoặc xoá cả hai để tắt.");
  }
  if (!config.deepseekApiKey) {
    throw new Error("Thiếu DEEPSEEK_API_KEY — không soạn được bản tin FB.");
  }
  if (!config.groupId) {
    throw new Error("GROUP_ID chưa cấu hình — không biết lấy nội dung nhóm nào.");
  }

  const now = Date.now();
  const window = previousDayWindowVN(now);
  const dayDate = isoDateFromDayStartVN(window.startTs);

  if (!acquireLock(LOCK_KEY, now, LOCK_STALE_MS)) {
    console.log("[daily-fb-post] Đang có tiến trình daily-fb-post khác chạy — bỏ qua.");
    return;
  }

  try {
    const prev = readState();
    if (prev?.dayLabel === window.label && prev.postId) {
      console.log(`[daily-fb-post] Bài ngày ${window.label} đã đăng (${prev.postId}) — bỏ qua.`);
      return;
    }

    // Lấy tin ngày hôm trước, loại bản tóm tắt cũ do chính bot đăng.
    const rawMessages = listGroupMessagesBetween(config.groupId, window.startTs, window.endTs);
    const messages = rawMessages.filter((m) => !isBotSummaryMessage(m.text));
    if (messages.length === 0) {
      // DB trống có thể do listener chết chứ không phải nhóm im ắng thật.
      if (isListenerHeartbeatStale(now)) {
        const msg =
          `daily-fb-post: không có tin nhắn nào cho ngày ${window.label} nhưng heartbeat listener ` +
          "đang stale — nghi bot gián đoạn thu thập, không đăng bài FB để tránh sai. Kiểm tra zalo-bot trên VPS.";
        console.warn(`[daily-fb-post] ${msg}`);
        recordBotError({ source: "daily-fb-post", code: "quiet_day_suspect", message: msg });
        if (!config.dryRun) await notifyTelegramBestEffort(`⚠️ ${msg}`);
        return;
      }
      console.log(`[daily-fb-post] Ngày ${window.label} nhóm im ắng — bỏ qua, không đăng FB.`);
      return;
    }

    // Soạn bản public — dùng lại bản đã soạn trong state nếu chạy lại cùng ngày.
    let post: PublicPost;
    if (prev?.dayLabel === window.label && prev.post) {
      post = prev.post;
      console.log(`[daily-fb-post] Dùng lại bản public đã soạn của ngày ${window.label}.`);
    } else {
      const transcript = buildTranscript(messages);
      console.log(
        `[daily-fb-post] Ngày ${window.label}: ${transcript.totalMessages} tin, ` +
          `${transcript.uniqueSenders} người, transcript ${transcript.text.length} ký tự. ` +
          `Gọi DeepSeek (${config.deepseekModel})...`,
      );
      post = await draftPublicPost(transcript.text, window.label);
      writeState({ dayLabel: window.label, post, createdAt: Date.now() });
    }

    // Sinh ảnh theo chủ đề, cache theo ngày để chạy lại không tốn tiền gọi AI lần nữa.
    const cacheDir = path.resolve("data", "fb-cache");
    mkdirSync(cacheDir, { recursive: true });
    const photos: { buf: Buffer; caption: string }[] = [];
    let cardFallbacks = 0;
    for (const [i, topic] of post.topics.entries()) {
      const cacheFile = path.join(cacheDir, `${dayDate}-topic-${i + 1}.png`);
      let branded: Buffer;
      if (existsSync(cacheFile)) {
        branded = readFileSync(cacheFile);
        console.log(`[daily-fb-post] Ảnh ${i + 1}/${post.topics.length} lấy từ cache.`);
      } else {
        console.log(`[daily-fb-post] Sinh ảnh ${i + 1}/${post.topics.length}: ${topic.title}...`);
        const generated = await generateTopicImage(topic.image_prompt);
        if (generated.model === "card-fallback") cardFallbacks += 1;
        branded = await brandImage(generated.buf, i + 1, post.topics.length, window.label.slice(0, 5));
        writeFileSync(cacheFile, branded);
        console.log(`[daily-fb-post] Ảnh ${i + 1} xong (model ${generated.model}).`);
      }
      photos.push({ buf: branded, caption: topic.caption });
    }

    if (config.dryRun) {
      console.log(
        `[daily-fb-post] DRY-RUN: sẽ đăng 1 bài ${photos.length} hình lên Page ${config.fbPageId}.\n\n` +
          `${post.main_caption}\n\n${post.topics.map((t, i) => `--- Hình ${i + 1}: ${t.title} ---\n${t.caption}`).join("\n\n")}`,
      );
      return;
    }

    // Đăng bài — thử lại tối đa POST_ATTEMPTS lần, giãn cách POST_RETRY_GAP_MS.
    let postId: string | null = null;
    let lastError: unknown;
    for (let attempt = 1; attempt <= POST_ATTEMPTS; attempt += 1) {
      try {
        postId = await postMultiPhoto(post.main_caption, photos);
        break;
      } catch (e) {
        lastError = e;
        console.warn(`[daily-fb-post] Đăng lỗi (lần ${attempt}/${POST_ATTEMPTS}): ${String(e)}`);
        if (attempt < POST_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, POST_RETRY_GAP_MS));
        }
      }
    }

    if (!postId) {
      // Hết lượt thử — báo admin kèm nội dung để đăng tay (wording E-FB1/E-FB2 trong brainstorm).
      const reason = String(lastError).slice(0, 300);
      const isTokenError = /OAuth|access token|code.*190/i.test(reason);
      const head = isTokenError
        ? "⚠️ Token Page đã hết hạn hoặc bị thu hồi — cần làm mới trong cấu hình bot. Bản tin hôm nay em gửi kèm để anh đăng tay."
        : `⚠️ Đăng bản tin FB ${window.label} thất bại sau ${POST_ATTEMPTS} lần thử (${reason}). Bài đính kèm bên dưới, anh đăng tay giúp nhé.`;
      const body = `${post.main_caption}\n\n${post.topics.map((t, i) => `--- Hình ${i + 1} (${t.title}) ---\n${t.caption}`).join("\n\n")}`;
      await notifyTelegramBestEffort(`${head}\n\n${body}\n\n(Ảnh nằm trong data/fb-cache/ trên server.)`);
      throw new Error(`Đăng FB thất bại sau ${POST_ATTEMPTS} lần: ${String(lastError)}`);
    }

    writeState({ dayLabel: window.label, post, postId, createdAt: prev?.createdAt ?? Date.now() });
    console.log(`[daily-fb-post] Đã đăng bài ngày ${window.label}: ${postId}`);

    const cardNote =
      cardFallbacks > 0
        ? `\n(Lưu ý: ${cardFallbacks} hình dùng ảnh card mẫu vì dịch vụ sinh ảnh lỗi — kiểm tra số dư/API.)`
        : "";
    await notifyTelegramBestEffort(
      `✅ Bản tin FB ${window.label} đã lên Page: https://www.facebook.com/${postId}. ` +
        `Anh bấm Share về group và trang cá nhân nhé.${cardNote}`,
    );
  } finally {
    releaseLock(LOCK_KEY);
  }
}

/** Bọc lỗi: ghi bot_errors + báo Telegram best-effort để không lặng lẽ mất bản tin. */
export async function runDailyFbPostSafe(): Promise<void> {
  try {
    await runDailyFbPost();
  } catch (e) {
    recordBotError({
      source: "daily-fb-post",
      code: "daily_fb_post_failed",
      message: String(e),
      detail: e instanceof Error ? e.stack : null,
    });
    throw e;
  }
}
