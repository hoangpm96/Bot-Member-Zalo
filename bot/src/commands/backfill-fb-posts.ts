import { config } from "../config.js";
import {
  acquireLock,
  getEarliestGroupMessageTs,
  getPublicPostByDate,
  listGroupMessagesBetween,
  listMemberDisplayNames,
  recordBotError,
  releaseLock,
  savePublicPost,
} from "../db/index.js";
import {
  buildTranscript,
  dayWindowFromLabelVN,
  dayWindowVNAt,
  isBotSummaryMessage,
  isoDateFromDayStartVN,
  type DayWindow,
} from "../summary.js";
import { draftPublicPost, scrubMemberNames } from "../fb-post.js";
import {
  FB_POST_LOCK_KEY,
  parseTopics,
  renderTopicImages,
  rescueFbStateToArchive,
} from "./daily-fb-post.js";

/**
 * Bù kho BẢN TIN CÔNG KHAI (daily_public_posts) cho các ngày quá khứ, từ
 * group_messages đã thu thập: soạn bản public bằng DeepSeek, sinh ảnh minh hoạ,
 * xuất ảnh WebP cho web. KHÔNG đăng Facebook — chỉ dựng kho để `sync-posts`
 * đẩy sang bahub.vn/ban-tin.
 *
 *   npm run backfill-fb-posts                            # bù mọi ngày còn thiếu
 *   npm run backfill-fb-posts -- --from 2026-07-16 --to 2026-07-31
 *   npm run backfill-fb-posts -- --max-days 5            # tối đa 5 ngày mỗi lần chạy
 *   npm run backfill-fb-posts -- --no-images             # chỉ soạn chữ, chưa tốn tiền sinh ảnh
 *   npm run backfill-fb-posts -- --force --day 2026-08-01  # soạn lại 1 ngày đã có
 *   DRY_RUN=1 npm run backfill-fb-posts                  # chỉ liệt kê ngày sẽ bù
 *
 * Ngày model kết luận không đủ nội dung đáng đăng vẫn được ghi kho (topics rỗng
 * + lý do) để lần chạy sau không gọi model lại cho ngày đó.
 */

const LOCK_STALE_MS = 6 * 60 * 60 * 1000;
/** Nghỉ giữa 2 ngày — backfill không vội, tránh dí rate limit của model lẫn dịch vụ ảnh. */
const DAY_GAP_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BackfillFbArgs {
  fromWindow: DayWindow | null;
  toWindow: DayWindow | null;
  maxDays: number;
  force: boolean;
  withImages: boolean;
}

/** 'YYYY-MM-DD' → khung ngày VN (null nếu không hợp lệ). */
function windowFromIso(iso: string): DayWindow | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  return dayWindowFromLabelVN(`${m[3]}/${m[2]}/${m[1]}`);
}

export function parseBackfillFbArgs(argv: string[]): BackfillFbArgs {
  const args: BackfillFbArgs = {
    fromWindow: null,
    toWindow: null,
    maxDays: Number.POSITIVE_INFINITY,
    force: false,
    withImages: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inlineValue] = (argv[i] ?? "").split("=", 2);
    // Cờ không nhận giá trị thì KHÔNG được nuốt tham số kế tiếp.
    const takesValue = flag === "--from" || flag === "--to" || flag === "--max-days" || flag === "--day";
    const value = inlineValue ?? (takesValue ? argv[i + 1] ?? "" : "");
    if (takesValue && inlineValue === undefined) i += 1;

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
      case "--day": {
        const w = windowFromIso(value);
        if (!w) throw new Error(`--day không hợp lệ: "${value}" (cần YYYY-MM-DD).`);
        args.fromWindow = w;
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
      case "--force":
        args.force = true;
        break;
      case "--no-images":
        args.withImages = false;
        break;
      default:
        throw new Error(
          `Tham số không hợp lệ: "${flag}". Hỗ trợ: --from, --to, --day, --max-days, --force, --no-images.`,
        );
    }
  }
  return args;
}

export async function runBackfillFbPosts(): Promise<void> {
  const args = parseBackfillFbArgs(process.argv.slice(3));
  if (!config.groupId) {
    throw new Error("GROUP_ID chưa cấu hình — không biết soạn bản tin cho nhóm nào.");
  }
  if (!config.deepseekApiKey) {
    throw new Error("Thiếu DEEPSEEK_API_KEY trong .env — backfill cần gọi model.");
  }

  const now = Date.now();
  if (!acquireLock(FB_POST_LOCK_KEY, now, LOCK_STALE_MS)) {
    console.log("[backfill-fb-posts] daily-fb-post/backfill khác đang chạy — bỏ qua.");
    return;
  }

  try {
    // Bản tin ĐÃ ĐĂNG THẬT lên Page có thể còn nằm trong bot_state (bản trước
    // khi có kho theo ngày). Đưa nó vào kho trước, kẻo backfill soạn lại ngày
    // đó ra văn bản khác và web lệch hẳn với bài trên Facebook.
    rescueFbStateToArchive();

    const earliest = getEarliestGroupMessageTs(config.groupId);
    if (earliest === null) {
      console.log("[backfill-fb-posts] group_messages trống — không có gì để bù.");
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
      `[backfill-fb-posts] Quét ${days.length} ngày (${days[0]?.label ?? "—"} → ${days[days.length - 1]?.label ?? "—"})` +
        (Number.isFinite(args.maxDays) ? `, tối đa ${args.maxDays} ngày mỗi lần chạy` : "") +
        (args.withImages ? ", có sinh ảnh." : ", KHÔNG sinh ảnh."),
    );

    let saved = 0;
    let skippedNoContent = 0;
    let skippedExisting = 0;
    let skippedEmpty = 0;
    let planned = 0;
    const failedDays: string[] = [];
    /** Ngày model lỡ nêu tên thành viên và đã bị chốt chặn sửa lại. */
    const scrubbedDays: string[] = [];
    let processedBefore = false;

    // Đọc danh bạ MỘT LẦN cho cả vòng lặp: 1.000+ dòng, không việc gì phải hỏi
    // DB lại cho từng ngày.
    const memberNames = listMemberDisplayNames();

    for (const day of days) {
      if (saved + skippedNoContent + planned >= args.maxDays) {
        console.log(`[backfill-fb-posts] Đã chạm --max-days=${args.maxDays} — dừng, chạy lại để bù tiếp.`);
        break;
      }

      const dayDate = isoDateFromDayStartVN(day.startTs);
      const existing = getPublicPostByDate(dayDate);
      if (existing && !args.force) {
        // Ngày đã có bản tin nhưng ảnh chưa được xuất ra web (mới bật nginx,
        // hoặc lần trước chạy --no-images) → chỉ dựng ảnh, không gọi lại model.
        const topics = parseTopics(existing.topics_json);
        const needImages = args.withImages && topics.length > 0 && topics.some((t) => !t.image_url);
        if (!needImages) {
          skippedExisting += 1;
          continue;
        }
        if (config.dryRun) {
          planned += 1;
          console.log(`[backfill-fb-posts] DRY-RUN ${day.label}: sẽ dựng ảnh cho ${topics.length} chủ đề đã soạn.`);
          continue;
        }
        try {
          if (processedBefore) await sleep(DAY_GAP_MS);
          processedBefore = true;
          const version = Date.now();
          const rendered = await renderTopicImages(topics, dayDate, day.label, version);
          savePublicPost({
            dayDate,
            dayLabel: day.label,
            dayStartTs: day.startTs,
            mainCaption: existing.main_caption,
            topicsJson: JSON.stringify(rendered.topics),
            model: existing.model,
            source: existing.source === "live" ? "live" : "backfill",
            // Mốc lúc GHI, không phải lúc bắt đầu dựng ảnh (mất vài phút):
            // updated_at cũ hơn con trỏ sync thì dòng này không bao giờ được đẩy.
            now: Date.now(),
          });
          saved += 1;
          console.log(`[backfill-fb-posts] ${day.label}: đã dựng ${rendered.photos.length} ảnh cho bản tin có sẵn.`);
        } catch (e) {
          failedDays.push(day.label);
          console.error(`[backfill-fb-posts] ${day.label}: LỖI dựng ảnh — ${String(e)}`);
        }
        continue;
      }

      const rawMessages = listGroupMessagesBetween(config.groupId, day.startTs, day.endTs);
      const messages = rawMessages.filter((m) => !isBotSummaryMessage(m.text));
      if (messages.length === 0) {
        skippedEmpty += 1;
        continue;
      }

      if (config.dryRun) {
        planned += 1;
        console.log(`[backfill-fb-posts] DRY-RUN ${day.label}: sẽ soạn bản tin từ ${messages.length} tin nhắn.`);
        continue;
      }

      try {
        if (processedBefore) await sleep(DAY_GAP_MS);
        processedBefore = true;

        const transcript = buildTranscript(messages);
        console.log(
          `[backfill-fb-posts] ${day.label}: ${transcript.totalMessages} tin / ${transcript.uniqueSenders} người ` +
            `(${transcript.text.length} ký tự) — gọi DeepSeek (${config.deepseekModel})...`,
        );
        const draft = await draftPublicPost(transcript.text, day.label);
        const scrub = await scrubMemberNames(draft, memberNames);
        const post = scrub.post;
        if (scrub.leaked.length > 0) {
          scrubbedDays.push(`${day.label} (${scrub.leaked.join(", ")})`);
        }

        if (post.topics.length === 0) {
          const reason = post.skip_reason || "Không có chủ đề nào đủ giá trị.";
          savePublicPost({
            dayDate,
            dayLabel: day.label,
            dayStartTs: day.startTs,
            mainCaption: "",
            topicsJson: "[]",
            skippedReason: reason,
            model: config.deepseekModel,
            source: "backfill",
            now: Date.now(),
          });
          skippedNoContent += 1;
          console.log(`[backfill-fb-posts] ${day.label}: không đăng — ${reason}`);
          continue;
        }

        // Lưu chữ trước, ảnh sau: sinh ảnh lâu và hay lỗi, mất ảnh còn chạy lại
        // được chứ mất bài đã gọi model là mất tiền.
        const version = Date.now();
        savePublicPost({
          dayDate,
          dayLabel: day.label,
          dayStartTs: day.startTs,
          mainCaption: post.main_caption,
          topicsJson: JSON.stringify(post.topics),
          model: config.deepseekModel,
          source: "backfill",
          now: version,
        });

        let topicsOut = post.topics;
        if (args.withImages) {
          const rendered = await renderTopicImages(post.topics, dayDate, day.label, version);
          topicsOut = rendered.topics;
          savePublicPost({
            dayDate,
            dayLabel: day.label,
            dayStartTs: day.startTs,
            mainCaption: post.main_caption,
            topicsJson: JSON.stringify(topicsOut),
            model: config.deepseekModel,
            source: "backfill",
            // Mốc MỚI chứ không dùng lại `version` của lần lưu chữ: sync chen
            // vào giữa hai lần lưu sẽ đứng đúng ở mốc đó, lần lưu sau mang cùng
            // mốc thì không bao giờ được đẩy — ngày đó lên web thiếu ảnh.
            now: Date.now(),
          });
        }

        saved += 1;
        console.log(`[backfill-fb-posts] ${day.label}: đã lưu ${topicsOut.length} chủ đề.`);
      } catch (e) {
        // Một ngày lỗi không được chặn các ngày còn lại — ghi nhận rồi đi tiếp.
        failedDays.push(day.label);
        console.error(`[backfill-fb-posts] ${day.label}: LỖI — ${String(e)}`);
        recordBotError({
          source: "backfill-fb-posts",
          code: "day_failed",
          message: `Backfill bản tin công khai ngày ${day.label} lỗi: ${String(e)}`,
          detail: e instanceof Error ? e.stack : null,
        });
      }
    }

    console.log(
      `[backfill-fb-posts] Xong: ${config.dryRun ? `${planned} ngày sẽ bù (dry-run)` : `${saved} ngày có bản tin`}, ` +
        `${skippedNoContent} ngày không đủ nội dung, ${skippedExisting} đã có sẵn, ${skippedEmpty} không có tin nhắn` +
        (failedDays.length > 0 ? `, LỖI ${failedDays.length} ngày: ${failedDays.join(", ")}.` : "."),
    );
    if (scrubbedDays.length > 0) {
      console.warn(
        `[backfill-fb-posts] ${scrubbedDays.length} ngày bị model nêu tên thành viên và đã được sửa: ` +
          scrubbedDays.join("; "),
      );
    }
    if (failedDays.length > 0) process.exitCode = 1;
  } finally {
    releaseLock(FB_POST_LOCK_KEY);
  }
}
