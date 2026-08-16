import { config } from "../config.js";
import { runtimeConfig } from "../runtime-config.js";
import {
  acquireLock,
  backfillDailySummaryIfMissing,
  countGroupMediaBetween,
  getEarliestGroupMessageTs,
  hasDailySummaryForDate,
  listGroupMessagesBetween,
  recordBotError,
  releaseLock,
} from "../db/index.js";
import {
  buildTranscript,
  composeSummaryMessages,
  dayWindowFromLabelVN,
  dayWindowVNAt,
  isBotSummaryMessage,
  isoDateFromDayStartVN,
  summarizeWithDeepSeek,
  topSenders,
  type DayWindow,
} from "../summary.js";
import { imageTextMessages } from "../jobs/zalo-ocr.js";
import { DAILY_SUMMARY_LOCK_KEY, rescueSummaryStateToArchive } from "./daily-summary.js";

/**
 * Chạy bù kho daily_summaries cho các ngày QUÁ KHỨ từ group_messages đã thu
 * thập: ngày nào chưa có trong kho thì dựng transcript → gọi DeepSeek → lưu
 * (source='backfill'). KHÔNG gửi đi đâu cả — chỉ ghi DB làm nguyên liệu
 * phân tích/viết blog.
 *
 *   npm run backfill-summaries                         # bù mọi ngày còn thiếu
 *   npm run backfill-summaries -- --from 2026-07-16 --to 2026-07-31
 *   npm run backfill-summaries -- --max-days 5         # tối đa 5 ngày mỗi lần chạy
 *   DRY_RUN=1 npm run backfill-summaries               # chỉ liệt kê ngày sẽ bù, không gọi model
 *
 * Ngày không có cả tin nhắn lẫn ảnh/video → BỎ QUA không lưu: quá khứ không
 * phân biệt được "nhóm yên ắng" với "listener chết", lưu bản 'yên ắng' dễ sai.
 * Dùng chung lock với daily-summary để không gọi model/ghi kho chồng nhau.
 */

const LOCK_STALE_MS = 3 * 60 * 60 * 1000;
/** Nghỉ giữa 2 lần gọi DeepSeek — backfill không vội, tránh dí rate limit. */
const MODEL_GAP_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BackfillArgs {
  fromWindow: DayWindow | null;
  toWindow: DayWindow | null;
  maxDays: number;
}

/** 'YYYY-MM-DD' → khung ngày VN (null nếu không hợp lệ). */
function windowFromIso(iso: string): DayWindow | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  return dayWindowFromLabelVN(`${m[3]}/${m[2]}/${m[1]}`);
}

export function parseBackfillArgs(argv: string[]): BackfillArgs {
  const args: BackfillArgs = { fromWindow: null, toWindow: null, maxDays: Number.POSITIVE_INFINITY };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inlineValue] = (argv[i] ?? "").split("=", 2);
    const value = inlineValue ?? argv[i + 1] ?? "";
    if (inlineValue === undefined) i += 1;
    switch (flag) {
      case "--from": {
        const w = windowFromIso(value);
        if (!w) throw new Error(`--from không hợp lệ: "${value}" (cần YYYY-MM-DD).`);
        args.fromWindow = w;
        break;
      }
      case "--to": {
        const w = windowFromIso(value);
        if (!w) throw new Error(`--to không hợp lệ: "${value}" (cần YYYY-MM-DD).`);
        args.toWindow = w;
        break;
      }
      case "--max-days": {
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0) {
          throw new Error(`--max-days không hợp lệ: "${value}" (cần số nguyên dương).`);
        }
        args.maxDays = n;
        break;
      }
      default:
        throw new Error(`Tham số không hợp lệ: "${flag}". Hỗ trợ: --from, --to, --max-days.`);
    }
  }
  return args;
}

export async function runBackfillSummaries(): Promise<void> {
  const args = parseBackfillArgs(process.argv.slice(3));
  if (!config.groupId) {
    throw new Error("GROUP_ID chưa cấu hình — không biết tóm tắt nhóm nào.");
  }
  if (!config.deepseekApiKey) {
    throw new Error("Thiếu DEEPSEEK_API_KEY trong .env — backfill cần gọi model.");
  }

  const now = Date.now();
  if (!acquireLock(DAILY_SUMMARY_LOCK_KEY, now, LOCK_STALE_MS)) {
    console.log("[backfill-summaries] daily-summary/backfill khác đang chạy — bỏ qua.");
    return;
  }

  try {
    // Cứu bản tin đang nằm trong bot_state trước — đó là bản ĐÃ GỬI THẬT,
    // đáng giữ hơn bản regen (regen ra văn bản khác).
    rescueSummaryStateToArchive();

    const earliest = getEarliestGroupMessageTs(config.groupId);
    if (earliest === null) {
      console.log("[backfill-summaries] group_messages trống — không có gì để bù.");
      return;
    }

    // Chỉ bù ngày ĐÃ TRỌN VẸN (trước 00:00 hôm nay giờ VN) — hôm nay để cron lo.
    const todayStartTs = dayWindowVNAt(now).startTs;
    let cursorTs = dayWindowVNAt(earliest).startTs;
    if (args.fromWindow) cursorTs = Math.max(cursorTs, args.fromWindow.startTs);
    let endExclusiveTs = todayStartTs;
    if (args.toWindow) endExclusiveTs = Math.min(endExclusiveTs, args.toWindow.endTs);

    const days: DayWindow[] = [];
    for (let ts = cursorTs; ts < endExclusiveTs; ts += 24 * 60 * 60 * 1000) {
      days.push(dayWindowVNAt(ts));
    }
    console.log(
      `[backfill-summaries] Quét ${days.length} ngày (${days[0]?.label ?? "—"} → ${days[days.length - 1]?.label ?? "—"})` +
        (Number.isFinite(args.maxDays) ? `, tối đa ${args.maxDays} ngày được bù.` : "."),
    );

    let saved = 0;
    let skippedExisting = 0;
    let skippedEmpty = 0;
    let planned = 0;
    const failedDays: string[] = [];
    let calledModelBefore = false;

    for (const day of days) {
      if (saved + planned >= args.maxDays) {
        console.log(`[backfill-summaries] Đã chạm --max-days=${args.maxDays} — dừng, chạy lại để bù tiếp.`);
        break;
      }
      const dayDate = isoDateFromDayStartVN(day.startTs);
      // Check ngay trước khi xử lý (không prefetch) — cron 9:10 có thể vừa thêm ngày mới.
      if (hasDailySummaryForDate(dayDate)) {
        skippedExisting += 1;
        continue;
      }

      const rawMessages = listGroupMessagesBetween(config.groupId, day.startTs, day.endTs);
      // Chữ đã đọc được từ ảnh của ngày đó cũng vào bản bù. KHÔNG đọc ảnh mới ở
      // đây: ảnh của ngày quá khứ đã bị xoá khỏi đĩa từ lâu, chỉ những ngày mà
      // luồng hằng ngày từng đọc mới có chữ để dùng lại.
      const messages = [
        ...rawMessages.filter((m) => !isBotSummaryMessage(m.text)),
        ...imageTextMessages(config.groupId, day.startTs, day.endTs),
      ].sort((a, b) => a.ts - b.ts);
      const media = countGroupMediaBetween(config.groupId, day.startTs, day.endTs);
      if (messages.length === 0 && media.images === 0 && media.videos === 0) {
        skippedEmpty += 1;
        console.log(`[backfill-summaries] ${day.label}: không có dữ liệu — bỏ qua (không lưu).`);
        continue;
      }

      if (config.dryRun) {
        planned += 1;
        console.log(
          `[backfill-summaries] DRY-RUN ${day.label}: sẽ tóm tắt ${messages.length} tin, ` +
            `${media.images} ảnh, ${media.videos} video.`,
        );
        continue;
      }

      try {
        const transcript = buildTranscript(messages);
        const maxParts = runtimeConfig.summaryMaxParts;
        let summary: string;
        if (messages.length > 0) {
          if (calledModelBefore) await sleep(MODEL_GAP_MS);
          console.log(
            `[backfill-summaries] ${day.label}: ${transcript.totalMessages} tin / ${transcript.uniqueSenders} người ` +
              `(${transcript.text.length} ký tự) — gọi DeepSeek (${config.deepseekModel})...`,
          );
          summary = await summarizeWithDeepSeek({
            transcript: transcript.text,
            dayLabel: day.label,
            maxParts,
          });
          calledModelBefore = true;
        } else {
          summary = "- Trong ngày chỉ có ảnh/video, không có tin nhắn văn bản để tóm tắt.";
        }

        const top = topSenders(messages);
        const parts = composeSummaryMessages(
          {
            dayLabel: day.label,
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

        const inserted = backfillDailySummaryIfMissing({
          dayDate,
          dayLabel: day.label,
          dayStartTs: day.startTs,
          threadId: config.groupId,
          summaryText: summary,
          parts,
          totalMessages: messages.length,
          includedMessages: transcript.includedMessages,
          uniqueSenders: transcript.uniqueSenders,
          images: media.images,
          videos: media.videos,
          topSenders: top,
          model: messages.length > 0 ? config.deepseekModel : "",
          transcriptChars: transcript.text.length,
          source: "backfill",
          now: Date.now(),
        });
        if (inserted) {
          saved += 1;
          console.log(`[backfill-summaries] ${day.label}: đã lưu (${summary.length} ký tự tóm tắt).`);
        } else {
          skippedExisting += 1;
          console.log(`[backfill-summaries] ${day.label}: ngày đã có trong kho (tiến trình khác vừa ghi) — bỏ qua.`);
        }
      } catch (e) {
        // Một ngày lỗi không được chặn các ngày còn lại — ghi nhận rồi đi tiếp.
        failedDays.push(day.label);
        console.error(`[backfill-summaries] ${day.label}: LỖI — ${String(e)}`);
        recordBotError({
          source: "backfill-summaries",
          code: "day_failed",
          message: `Backfill ngày ${day.label} lỗi: ${String(e)}`,
          detail: e instanceof Error ? e.stack : null,
        });
      }
    }

    console.log(
      `[backfill-summaries] Xong: ${config.dryRun ? `${planned} ngày sẽ bù (dry-run)` : `${saved} ngày đã lưu`}, ` +
        `${skippedExisting} đã có sẵn, ${skippedEmpty} trống bỏ qua` +
        (failedDays.length > 0 ? `, LỖI ${failedDays.length} ngày: ${failedDays.join(", ")}.` : "."),
    );
    if (failedDays.length > 0) process.exitCode = 1;
  } finally {
    releaseLock(DAILY_SUMMARY_LOCK_KEY);
  }
}
