import { config } from "../config.js";
import {
  getLatestJobRawPostedAt,
  listGroupMessagesBetween,
  saveJobRawBatch,
  setBotState,
} from "../db/index.js";
import { pollTelegramInbox } from "../telegram.js";
import { clusterMessages, type ClusterableMessage } from "./cluster.js";
import { fetchFbGroupJobs } from "./fb-group-source.js";
import { prefilterJobItems } from "./prefilter.js";
import type { RawJobItem } from "./types.js";

/**
 * Thu gom nội dung thô từ cả ba nguồn về bảng job_raw.
 *
 * Mỗi nguồn tự chịu trách nhiệm phần "lấy tới đâu rồi": Facebook và Zalo đi
 * theo mốc bài mới nhất đã lưu, Telegram đi theo con trỏ offset của getUpdates.
 * Nguồn nào lỗi thì các nguồn còn lại vẫn chạy — mất Facebook một hôm không
 * đáng để mất luôn tin Zalo hôm đó.
 */

export const TELEGRAM_OFFSET_KEY = "job_telegram_offset";

export interface CollectResult {
  bySource: Record<string, number>;
  errors: { source: string; message: string }[];
}

/** Mốc bắt đầu lấy của một nguồn: theo bài mới nhất đã có, chưa có gì thì lùi JOB_LOOKBACK_DAYS. */
function sinceFor(source: string, now: number): number {
  const latest = getLatestJobRawPostedAt(source);
  if (latest !== null) return latest;
  return now - config.jobLookbackDays * 24 * 60 * 60 * 1000;
}

async function collectFacebook(now: number): Promise<RawJobItem[]> {
  if (!config.jobFbGroupSlug) return [];
  return fetchFbGroupJobs(sinceFor("facebook", now));
}

async function collectTelegram(): Promise<{ items: RawJobItem[]; commitOffset: () => void }> {
  if (!config.jobTelegramBotToken || !config.jobTelegramChatId) {
    return { items: [], commitOffset: () => {} };
  }

  const { messages, nextOffset } = await pollTelegramInbox({
    botToken: config.jobTelegramBotToken,
    chatId: config.jobTelegramChatId,
    topicId: config.jobTelegramTopicId,
    offsetKey: TELEGRAM_OFFSET_KEY,
  });

  const clusterable: ClusterableMessage[] = messages.map((m) => ({
    senderId: m.senderId,
    author: m.senderName,
    messageId: String(m.messageId),
    text: m.text,
    ts: m.ts,
    // Link tới đúng tin trong supergroup công khai. Chat id dạng -100xxxx nên
    // phải bỏ tiền tố -100 mới ra id dùng được trong đường dẫn t.me/c/.
    url: telegramMessageUrl(config.jobTelegramChatId, m.messageId),
  }));

  return {
    items: clusterMessages(clusterable, "telegram", config.jobClusterGapMinutes * 60_000),
    commitOffset: () => {
      if (nextOffset !== null) setBotState(TELEGRAM_OFFSET_KEY, String(nextOffset), Date.now());
    },
  };
}

export function telegramMessageUrl(chatId: string, messageId: number): string | null {
  const internal = /^-100(\d+)$/.exec(chatId);
  if (!internal) return null;
  return `https://t.me/c/${internal[1]}/${messageId}`;
}

function collectZalo(now: number): RawJobItem[] {
  if (!config.jobZaloEnabled || !config.groupId) return [];

  const since = sinceFor("zalo", now);
  const rows = listGroupMessagesBetween(config.groupId, since + 1, now);

  const clusterable: ClusterableMessage[] = rows.map((row) => ({
    senderId: row.zalo_user_id,
    author: row.display_name,
    // group_messages không trả message_id ra ngoài, mà cụm chỉ cần một khoá ổn
    // định: người gửi + mốc tin đầu cụm là đủ duy nhất và tái lập được.
    messageId: `${row.zalo_user_id}-${row.ts}`,
    text: row.text,
    ts: row.ts,
    url: null,
  }));

  return clusterMessages(clusterable, "zalo", config.jobClusterGapMinutes * 60_000);
}

function saveItems(rawItems: RawJobItem[], now: number): number {
  // Cổng lọc rẻ đứng trước AI — xem jobs/prefilter.ts. Cụm bị gạt KHÔNG vào
  // job_raw: chúng vẫn nằm nguyên trong group_messages nếu sau này cần xem lại.
  const items = prefilterJobItems(rawItems);
  return saveJobRawBatch(
    items.map((item) => ({
      source: item.source,
      sourceId: item.sourceId,
      author: item.author,
      sourceUrl: item.sourceUrl,
      text: item.text,
      postedAt: item.postedAt,
    })),
    now,
  );
}

/**
 * Chỉ hút Telegram về job_raw. Tách riêng để chạy được ở nhịp dày (5 phút) mà
 * không kéo theo lần gọi Facebook — Telegram chỉ giữ update 24 giờ nên không
 * chờ được tới lần chạy hằng ngày.
 */
export async function collectTelegramRaw(now: number): Promise<number> {
  const { items, commitOffset } = await collectTelegram();
  const saved = saveItems(items, now);
  commitOffset();
  return saved;
}

/** Lấy về và lưu vào job_raw. Trả về số mẩu MỚI theo từng nguồn. */
export async function collectRawJobs(now: number): Promise<CollectResult> {
  const bySource: Record<string, number> = { facebook: 0, telegram: 0, zalo: 0 };
  const errors: { source: string; message: string }[] = [];

  const save = (items: RawJobItem[]): number => saveItems(items, now);

  try {
    bySource.facebook = save(await collectFacebook(now));
  } catch (e) {
    errors.push({ source: "facebook", message: String(e) });
  }

  try {
    bySource.telegram = await collectTelegramRaw(now);
  } catch (e) {
    errors.push({ source: "telegram", message: String(e) });
  }

  try {
    bySource.zalo = save(collectZalo(now));
  } catch (e) {
    errors.push({ source: "zalo", message: String(e) });
  }

  return { bySource, errors };
}
