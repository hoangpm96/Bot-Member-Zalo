import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import {
  acquireLock,
  deleteBotState,
  getBotState,
  getPublicPostByDate,
  listGroupMessagesBetween,
  listMemberDisplayNames,
  recordBotError,
  releaseLock,
  savePublicPost,
  setPublicPostFbId,
  type PublicPostRow,
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
  type PublicPostTopic,
  brandImage,
  draftPublicPost,
  generateTopicImage,
  postMultiPhoto,
  publishTopicImage,
  scrubMemberNames,
} from "../fb-post.js";

/** Key bot_state của bản cũ (trước khi có bảng daily_public_posts) — chỉ còn dùng để cứu 1 lần. */
const LEGACY_STATE_KEY = "daily_fb_post_last";
/** Lock dùng chung với backfill-fb-posts — hai bên đều gọi model + sinh ảnh, không được chồng. */
export const FB_POST_LOCK_KEY = "daily_fb_post_lock";
const LOCK_KEY = FB_POST_LOCK_KEY;
const LOCK_STALE_MS = 2 * 60 * 60 * 1000;
/** Heartbeat listener cũ hơn ngưỡng này → "ngày yên ắng" đáng ngờ, không kết luận bừa. */
const HEARTBEAT_STALE_MS = 15 * 60 * 1000;
/** Đăng lỗi: thử lại 3 lần, giãn cách 5 phút (brainstorm Mục 7.2). */
const POST_ATTEMPTS = 3;
const POST_RETRY_GAP_MS = 5 * 60 * 1000;

/** Thư mục cache ảnh PNG đã brand (bản gửi Facebook), theo ngày. */
export function fbCacheDir(): string {
  return path.resolve("data", "fb-cache");
}

export function parseTopics(topicsJson: string): PublicPostTopic[] {
  try {
    const parsed = JSON.parse(topicsJson || "[]");
    return Array.isArray(parsed) ? (parsed as PublicPostTopic[]) : [];
  } catch {
    return [];
  }
}

/**
 * Bản tin công khai từng nằm trong bot_state (chỉ giữ ngày mới nhất) — đưa vào
 * kho daily_public_posts rồi xoá key cũ. Chạy một lần sau khi lên bản mới để
 * ngày hôm đó không bị soạn lại (tốn tiền model) và không bị đăng trùng.
 */
export function rescueFbStateToArchive(): void {
  const raw = getBotState(LEGACY_STATE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw) as {
      dayLabel?: string;
      post?: PublicPost;
      postId?: string;
      createdAt?: number;
    };
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(parsed.dayLabel ?? "");
    if (!m || !parsed.post) {
      deleteBotState(LEGACY_STATE_KEY);
      return;
    }
    const dayDate = `${m[3]}-${m[2]}-${m[1]}`;

    if (!getPublicPostByDate(dayDate)) {
      const now = parsed.createdAt || Date.now();
      savePublicPost({
        dayDate,
        dayLabel: parsed.dayLabel!,
        dayStartTs: Date.parse(`${dayDate}T00:00:00+07:00`),
        mainCaption: parsed.post.main_caption ?? "",
        topicsJson: JSON.stringify(parsed.post.topics ?? []),
        model: config.deepseekModel,
        source: "live",
        now,
      });
      if (parsed.postId) setPublicPostFbId(dayDate, parsed.postId, now);
      console.log(`[daily-fb-post] Đã cứu bản tin ngày ${parsed.dayLabel} từ bot_state vào kho.`);
    }
    deleteBotState(LEGACY_STATE_KEY);
  } catch {
    deleteBotState(LEGACY_STATE_KEY); // State hỏng thì bỏ, không chặn luồng chính.
  }
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
 * Sinh (hoặc lấy từ cache) ảnh đã brand cho từng chủ đề, đồng thời xuất bản
 * WebP nhẹ ra thư mục nginx serve cho bahub.vn/ban-tin.
 *
 * Trả về buffer PNG để đăng Facebook và topics đã gắn image_file/image_url.
 */
export async function renderTopicImages(
  topics: PublicPostTopic[],
  dayDate: string,
  dayLabel: string,
  version: number,
): Promise<{
  photos: { buf: Buffer; caption: string }[];
  topics: PublicPostTopic[];
  cardFallbacks: number;
}> {
  const cacheDir = fbCacheDir();
  mkdirSync(cacheDir, { recursive: true });

  const photos: { buf: Buffer; caption: string }[] = [];
  const out: PublicPostTopic[] = [];
  let cardFallbacks = 0;

  for (const [i, topic] of topics.entries()) {
    const fileName = `${dayDate}-topic-${i + 1}.png`;
    const cacheFile = path.join(cacheDir, fileName);
    let branded: Buffer;
    if (existsSync(cacheFile)) {
      branded = readFileSync(cacheFile);
      console.log(`[daily-fb-post] Ảnh ${i + 1}/${topics.length} lấy từ cache.`);
    } else {
      console.log(`[daily-fb-post] Sinh ảnh ${i + 1}/${topics.length}: ${topic.title}...`);
      const generated = await generateTopicImage(topic.image_prompt);
      if (generated.model === "card-fallback") cardFallbacks += 1;
      branded = await brandImage(generated.buf, i + 1, topics.length, dayLabel.slice(0, 5));
      writeFileSync(cacheFile, branded);
      console.log(`[daily-fb-post] Ảnh ${i + 1} xong (model ${generated.model}).`);
    }

    const imageUrl = await publishTopicImage(branded, dayDate, i + 1, version);
    photos.push({ buf: branded, caption: topic.caption });
    out.push({ ...topic, image_file: fileName, image_url: imageUrl ?? undefined });
  }

  return { photos, topics: out, cardFallbacks };
}

/**
 * Cron 8:00 sáng: soạn BẢN PUBLIC từ tin nhắn NGÀY HÔM TRƯỚC của GROUP_ID
 * (DeepSeek, lược tên thành viên/chuyện nội bộ), sinh tối đa 3 ảnh minh họa
 * line-art BAHUB, đăng 1 bài nhiều hình lên Facebook Page rồi gửi link qua
 * Telegram để admin bấm Share về group FB + trang cá nhân.
 *
 * Bản tin được lưu vào kho daily_public_posts — cùng nguồn mà lệnh `sync-posts`
 * đẩy sang bahub.vn/ban-tin, nên web và Facebook luôn khớp nhau từng chữ.
 * Ngày không có chủ đề nào đáng đăng: ghi kho kèm lý do, KHÔNG đăng, không lên web.
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
    rescueFbStateToArchive();

    const prev: PublicPostRow | undefined = getPublicPostByDate(dayDate);
    if (prev?.fb_post_id) {
      console.log(`[daily-fb-post] Bài ngày ${window.label} đã đăng (${prev.fb_post_id}) — bỏ qua.`);
      return;
    }
    if (prev && !prev.fb_post_id && parseTopics(prev.topics_json).length === 0 && prev.skipped_reason) {
      console.log(`[daily-fb-post] Ngày ${window.label} đã kết luận không đăng: ${prev.skipped_reason}`);
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

    // Soạn bản public — dùng lại bản đã soạn trong kho nếu chạy lại cùng ngày.
    let post: PublicPost;
    const prevTopics = prev ? parseTopics(prev.topics_json) : [];
    if (prev && prevTopics.length > 0) {
      post = { main_caption: prev.main_caption, topics: prevTopics };
      console.log(`[daily-fb-post] Dùng lại bản public đã soạn của ngày ${window.label}.`);
    } else {
      const transcript = buildTranscript(messages);
      console.log(
        `[daily-fb-post] Ngày ${window.label}: ${transcript.totalMessages} tin, ` +
          `${transcript.uniqueSenders} người, transcript ${transcript.text.length} ký tự. ` +
          `Gọi DeepSeek (${config.deepseekModel})...`,
      );
      post = await draftPublicPost(transcript.text, window.label);

      // Chốt chặn tên riêng chỉ chạy trên bản VỪA SOẠN. Bản lấy lại từ kho đã
      // qua bước này rồi, quét lại chỉ tốn thêm một lần gọi model.
      const scrub = await scrubMemberNames(post, listMemberDisplayNames());
      post = scrub.post;
      if (scrub.leaked.length > 0) {
        const how = scrub.maskedHard ? "viết lại vẫn còn nên em thay cứng" : "đã cho viết lại";
        console.warn(`[daily-fb-post] Bản nháp nêu tên: ${scrub.leaked.join(", ")} — ${how}.`);
        if (!config.dryRun) {
          await notifyTelegramBestEffort(
            `⚠️ Bản tin ${window.label} lỡ nhắc tên thành viên (${scrub.leaked.join(", ")}) — ${how}. ` +
              "Anh liếc lại bài trước khi share nhé.",
          );
        }
      }
    }

    // Ngày không có gì đáng chia sẻ ra ngoài: ghi nhận rồi dừng — thà im lặng
    // còn hơn đẩy một bài nhạt lên Page và lên bahub.vn.
    if (post.topics.length === 0) {
      const reason = post.skip_reason || "Không có chủ đề nào đủ giá trị.";
      savePublicPost({
        dayDate,
        dayLabel: window.label,
        dayStartTs: window.startTs,
        mainCaption: "",
        topicsJson: "[]",
        skippedReason: reason,
        model: config.deepseekModel,
        source: "live",
        now: Date.now(),
      });
      console.log(`[daily-fb-post] Ngày ${window.label} KHÔNG đăng — ${reason}`);
      if (!config.dryRun) {
        await notifyTelegramBestEffort(
          `ℹ️ Bản tin ${window.label}: em không đăng vì ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`,
        );
      }
      return;
    }

    // Lưu nội dung TRƯỚC khi sinh ảnh: sinh ảnh có thể mất vài phút và chết
    // giữa chừng, lưu trước thì lần chạy sau không phải gọi lại DeepSeek.
    const version = Date.now();
    savePublicPost({
      dayDate,
      dayLabel: window.label,
      dayStartTs: window.startTs,
      mainCaption: post.main_caption,
      topicsJson: JSON.stringify(post.topics),
      model: config.deepseekModel,
      source: "live",
      now: version,
    });

    const rendered = await renderTopicImages(post.topics, dayDate, window.label, version);
    savePublicPost({
      dayDate,
      dayLabel: window.label,
      dayStartTs: window.startTs,
      mainCaption: post.main_caption,
      topicsJson: JSON.stringify(rendered.topics),
      model: config.deepseekModel,
      source: "live",
      now: version,
    });

    if (config.dryRun) {
      console.log(
        `[daily-fb-post] DRY-RUN: sẽ đăng 1 bài ${rendered.photos.length} hình lên Page ${config.fbPageId}.\n\n` +
          `${post.main_caption}\n\n${post.topics.map((t, i) => `--- Hình ${i + 1}: ${t.title} ---\n${t.caption}`).join("\n\n")}`,
      );
      return;
    }

    // Đăng bài — thử lại tối đa POST_ATTEMPTS lần, giãn cách POST_RETRY_GAP_MS.
    let postId: string | null = null;
    let lastError: unknown;
    for (let attempt = 1; attempt <= POST_ATTEMPTS; attempt += 1) {
      try {
        postId = await postMultiPhoto(post.main_caption, rendered.photos);
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

    setPublicPostFbId(dayDate, postId, Date.now());
    console.log(`[daily-fb-post] Đã đăng bài ngày ${window.label}: ${postId}`);

    const cardNote =
      rendered.cardFallbacks > 0
        ? `\n(Lưu ý: ${rendered.cardFallbacks} hình dùng ảnh card mẫu vì dịch vụ sinh ảnh lỗi — kiểm tra số dư/API.)`
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
