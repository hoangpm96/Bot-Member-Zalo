import { config } from "../config.js";
import {
  getBotState,
  getLatestJobRawPostedAt,
  listGroupMessagesBetween,
  saveJobRawBatch,
  setBotState,
} from "../db/index.js";
import { clusterMessages, type ClusterableMessage } from "./cluster.js";
import { fetchFbGroupJobs } from "./fb-group-source.js";
import { crawlRange, findIdAtTime, findLatestId } from "./telegram-crawl.js";
import { prefilterJobItems } from "./prefilter.js";
import type { RawJobItem } from "./types.js";

/**
 * Thu gom nội dung thô từ cả ba nguồn về bảng job_raw.
 *
 * Mỗi nguồn tự chịu trách nhiệm phần "lấy tới đâu rồi": Facebook và Zalo đi
 * theo mốc bài mới nhất đã lưu, Telegram đi theo message id lớn nhất đã duyệt.
 * Nguồn nào lỗi thì các nguồn còn lại vẫn chạy — mất Facebook một hôm không
 * đáng để mất luôn tin Zalo hôm đó.
 */

export const TELEGRAM_LAST_ID_KEY = "job_telegram_last_id";

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

/**
 * Đọc tin mới của group Telegram công khai kể từ id đã duyệt lần trước.
 *
 * Lần đầu chưa có con trỏ thì lùi lại JOB_LOOKBACK_DAYS. Muốn lấy xa hơn thì
 * dùng lệnh `backfill-telegram-jobs`.
 */
async function collectTelegram(
  now: number,
): Promise<{ items: RawJobItem[]; lastId: number | null }> {
  const slug = config.jobTelegramGroupSlug;
  if (!slug) return { items: [], lastId: null };

  const saved = getBotState(TELEGRAM_LAST_ID_KEY);
  let fromId = saved ? Number(saved) + 1 : 0;

  if (!Number.isSafeInteger(fromId) || fromId <= 0) {
    const since = now - config.jobLookbackDays * 24 * 60 * 60 * 1000;
    const latest = await findLatestId(slug, 1);
    fromId = await findIdAtTime(slug, since, { low: 1, high: latest });
  }

  const toId = await findLatestId(slug, fromId - 1);
  if (toId < fromId) return { items: [], lastId: null };

  const result = await crawlRange({
    groupSlug: slug,
    fromId,
    toId,
    topicId: config.jobTelegramTopicId,
  });

  // Trả id ra ngoài chứ không tự ghi: con trỏ chỉ được nhích SAU khi tin đã vào DB.
  return { items: result.items, lastId: result.lastId };
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
    const telegram = await collectTelegram(now);
    bySource.telegram = saveItems(telegram.items, now);
    // Con trỏ chỉ nhích khi đã ghi DB xong — ghi lỗi thì lần sau duyệt lại.
    if (telegram.lastId !== null) {
      setBotState(TELEGRAM_LAST_ID_KEY, String(telegram.lastId), Date.now());
    }
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
