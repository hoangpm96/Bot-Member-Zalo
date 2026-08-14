import { config } from "../config.js";
import { getBotState, recordBotError, saveJobRawBatch, setBotState } from "../db/index.js";
import { TELEGRAM_LAST_ID_KEY } from "../jobs/collect.js";
import { prefilterJobItems } from "../jobs/prefilter.js";
import { crawlRange, findIdAtTime, findLatestId } from "../jobs/telegram-crawl.js";

/**
 * Bù tin tuyển dụng Telegram cho N ngày quá khứ.
 *
 * Tách khỏi `daily-jobs` vì đây là việc chạy MỘT LẦN và tốn thời gian: group
 * đăng khoảng 200 tin/ngày, nên 30 ngày là hơn 6.000 lượt tải. Lần chạy hằng
 * ngày sau đó chỉ đi tiếp từ id đã duyệt nên rất nhẹ.
 *
 * Lệnh chỉ ghi vào job_raw. Việc gọi AI bóc tách vẫn do `daily-jobs` làm, theo
 * đúng trần JOB_MAX_ITEMS_PER_RUN mỗi lần — nhờ vậy backfill không tạo ra một
 * hoá đơn model khổng lồ trong một lần chạy.
 *
 * Cách dùng:
 *   npm run backfill-telegram-jobs -- --days=30
 *   npm run backfill-telegram-jobs -- --days=7 --dry-run
 */

function readDays(argv: string[]): number {
  const raw = argv.find((a) => a.startsWith("--days="))?.split("=")[1];
  const days = Number(raw ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error(`--days phải là số nguyên 1-365, nhận được: "${raw}"`);
  }
  return days;
}

export async function runBackfillTelegramJobs(argv: string[] = []): Promise<void> {
  const slug = config.jobTelegramGroupSlug;
  if (!slug) {
    console.log("[backfill-telegram-jobs] Chưa cấu hình JOB_TELEGRAM_GROUP_SLUG — bỏ qua.");
    return;
  }

  const days = readDays(argv);
  const dryRun = argv.includes("--dry-run") || config.dryRun;
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  console.log(`[backfill-telegram-jobs] Dò id mới nhất của @${slug}...`);
  const latestId = await findLatestId(slug, 1);

  console.log(`[backfill-telegram-jobs] Dò id ứng với ${days} ngày trước (id mới nhất ${latestId})...`);
  const fromId = await findIdAtTime(slug, since, { low: 1, high: latestId });

  const total = latestId - fromId + 1;
  const topicLabel = config.jobTelegramTopicId ?? "mọi topic";
  console.log(
    `[backfill-telegram-jobs] Sẽ duyệt id ${fromId} → ${latestId} (${total.toLocaleString()} tin), ` +
      `lọc topic ${topicLabel}.`,
  );

  const result = await crawlRange({
    groupSlug: slug,
    fromId,
    toId: latestId,
    topicId: config.jobTelegramTopicId,
    onProgress: (done, all) =>
      console.log(`[backfill-telegram-jobs]   ...${done}/${all} tin`),
  });

  console.log(
    `[backfill-telegram-jobs] Tải được ${result.scanned}/${total} tin, ` +
      `${result.items.length} tin thuộc topic cần lấy.`,
  );

  if (dryRun) {
    for (const item of result.items.slice(0, 10)) {
      const when = new Date(item.postedAt).toISOString().slice(0, 16);
      console.log(`  [${when}] ${item.author}: ${item.text.slice(0, 90).replace(/\n/g, " / ")}`);
    }
    console.log("[backfill-telegram-jobs] DRY-RUN: không ghi gì vào DB.");
    return;
  }

  const kept = prefilterJobItems(result.items);
  const saved = saveJobRawBatch(
    kept.map((item) => ({
      source: item.source,
      sourceId: item.sourceId,
      author: item.author,
      sourceUrl: item.sourceUrl,
      text: item.text,
      postedAt: item.postedAt,
    })),
    Date.now(),
  );

  // Chỉ đẩy con trỏ TIẾN, không kéo lùi: backfill chạy sau khi cron hằng ngày
  // đã đi xa hơn thì không được bắt cron duyệt lại từ đầu.
  const current = Number(getBotState(TELEGRAM_LAST_ID_KEY) ?? 0);
  if (result.lastId > current) {
    setBotState(TELEGRAM_LAST_ID_KEY, String(result.lastId), Date.now());
  }

  console.log(
    `[backfill-telegram-jobs] Qua cổng lọc từ khoá: ${kept.length}/${result.items.length}; ` +
      `ghi mới vào job_raw: ${saved}. Chạy \`npm run daily-jobs\` để AI bóc tách.`,
  );
}

/** Bọc lỗi để cron ghi lại thay vì im lặng. */
export async function runBackfillTelegramJobsSafe(argv: string[] = []): Promise<void> {
  try {
    await runBackfillTelegramJobs(argv);
  } catch (e) {
    recordBotError({
      source: "backfill-telegram-jobs",
      code: "backfill_failed",
      message: String(e),
      detail: e instanceof Error ? e.stack : null,
    });
    throw e;
  }
}
