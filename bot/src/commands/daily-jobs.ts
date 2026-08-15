import { config } from "../config.js";
import {
  acquireLock,
  expireJobPosts,
  getJobPostByFingerprint,
  insertJobPost,
  listActiveJobPosts,
  listPendingJobRaw,
  markJobPostReposted,
  markJobRawProcessed,
  recordBotError,
  releaseLock,
  type JobPostRow,
  type JobRawRow,
} from "../db/index.js";
import { sendTelegramText } from "../telegram.js";
import { collectRawJobs } from "../jobs/collect.js";
import {
  fingerprintOf,
  isSameJob,
  jobKeys,
  mergeSources,
  normalizeLocation,
  parseSources,
  type JobKeys,
} from "../jobs/dedupe.js";
import { extractJob, type ExtractedJob } from "../jobs/extract.js";

/**
 * Cron hằng ngày: gom tin từ group Facebook công khai + topic Telegram + group
 * Zalo, cho AI lọc và bóc tách, rồi ghi vào kho job_posts để lệnh `sync-jobs`
 * đẩy sang bahub.vn/tuyen-dung.
 *
 * Đăng TỰ ĐỘNG theo yêu cầu vận hành: không có bước duyệt tay. Ngoại lệ duy
 * nhất là tin bị AI gắn cờ nghi lừa đảo — vào kho nhưng ẩn, chờ quản trị viên
 * xem. Ngày không có tin nào đạt thì im lặng, không đăng gì.
 *
 * Không có nguồn nào được cấu hình = tính năng TẮT (no-op), khớp .env.example.
 */

const LOCK_KEY = "daily_jobs_lock";
const LOCK_STALE_MS = 2 * 60 * 60 * 1000;

export interface DailyJobsReport {
  collected: Record<string, number>;
  processed: number;
  created: number;
  reposted: number;
  rejected: number;
  suspect: number;
  expired: number;
  errors: { source: string; message: string }[];
}

function anySourceConfigured(): boolean {
  return Boolean(
    config.jobFbGroupSlug ||
      config.jobTelegramGroupSlug ||
      (config.jobZaloEnabled && config.groupId),
  );
}

async function notifyBestEffort(text: string): Promise<void> {
  if (!config.telegramBotToken || !config.telegramChatId) return;
  try {
    await sendTelegramText(text);
  } catch {
    // Telegram lỗi nốt thì đành chịu — đã có bot_errors + log cron.
  }
}

/**
 * Nội dung hiển thị ra trang công khai.
 *
 * Facebook: NGUYÊN VĂN bài gốc. Đó là bài đăng công khai, người đăng chủ động
 * viết để tuyển người, và trang có link về bản gốc để đối chiếu.
 *
 * Zalo/Telegram: bản đã dọn. Nội dung gốc ở đây là chat nhóm — lẫn tán gẫu,
 * bình luận cá nhân về công ty, câu đối đáp giữa mọi người. Đăng nguyên văn
 * chat của nhóm kín lên trang có index SEO là chuyện khác hẳn với đăng lại một
 * bài vốn đã công khai. Không dọn được thì lùi về tóm tắt, cuối cùng mới là
 * nguyên văn.
 */
export function descriptionFor(
  raw: Pick<JobRawRow, "source" | "text">,
  job: Pick<ExtractedJob, "clean_description" | "summary">,
): string {
  if (raw.source === "facebook") return raw.text;
  return job.clean_description || job.summary || raw.text;
}

/**
 * Tin CÒN HẠN nào là cùng một tin với mẩu đang xử lý.
 *
 * Chạy sau khi tra chữ ký băm không thấy gì. Đây là chỗ bắt được "hôm kia đăng,
 * hôm nay đăng lại" khi lần đăng lại lệch vài chữ — chữ ký băm đòi cả năm phần
 * giống hệt, còn ở đây trường nào một bên bỏ trống thì bỏ qua.
 *
 * Chỉ so với tin còn hạn: một tin đã chết 30 ngày trước không được phép nuốt
 * lượt đăng mới, vì đợt tuyển đó rõ ràng đã là chuyện khác.
 */
function findNearDuplicate(keys: JobKeys, now: number): JobPostRow | undefined {
  return listActiveJobPosts(now).find((row) =>
    isSameJob(
      keys,
      jobKeys({
        company: row.company,
        title: row.title,
        level: row.level,
        salary: row.salary,
        location: row.location,
        author: row.author,
      }),
    ),
  );
}

/** Đưa một mẩu thô qua AI rồi ghi vào kho. Trả về việc đã làm với nó. */
async function processRaw(
  raw: JobRawRow,
  now: number,
): Promise<"created" | "reposted" | "rejected" | "suspect"> {
  const job = await extractJob({ text: raw.text, author: raw.author });

  if (!job.is_job) {
    markJobRawProcessed(raw.id, false, now);
    return "rejected";
  }

  const keys = jobKeys({
    company: job.company,
    title: job.title,
    level: job.level,
    salary: job.salary,
    location: job.location,
    author: raw.author,
  });
  const fingerprint = fingerprintOf(keys);

  const sourceRef = { source: raw.source, url: raw.source_url, posted_at: raw.posted_at };
  const expiresAt = raw.posted_at + config.jobExpireDays * 24 * 60 * 60 * 1000;
  const existing = getJobPostByFingerprint(fingerprint) ?? findNearDuplicate(keys, now);

  if (existing) {
    // Đăng lại: gia hạn và ghi nhận thêm nơi xuất hiện. KHÔNG ghi đè nội dung —
    // bản đầu tiên thường đầy đủ hơn bản đăng lại cho có.
    //
    // Cập nhật theo chữ ký của DÒNG ĐÃ CÓ, không phải chữ ký vừa tính: tin bắt
    // được bằng lưới gần trùng mang chữ ký khác, ghi theo chữ ký mới là đẻ ra
    // đúng cái dòng thứ hai vừa tránh được.
    markJobPostReposted({
      fingerprint: existing.fingerprint,
      sourcesJson: JSON.stringify(mergeSources(parseSources(existing.sources_json), sourceRef)),
      lastSeenAt: Math.max(existing.last_seen_at, raw.posted_at),
      expiresAt: Math.max(existing.expires_at, expiresAt),
      now,
    });
    markJobRawProcessed(raw.id, true, now);
    return "reposted";
  }

  insertJobPost({
    fingerprint,
    title: job.title,
    company: job.company,
    level: job.level,
    location: job.location,
    city: normalizeLocation(job.location),
    workMode: job.work_mode,
    salary: job.salary,
    employmentType: job.employment_type,
    yearsExp: job.years_exp,
    skillsJson: JSON.stringify(job.skills),
    deadline: job.deadline,
    contact: job.contact,
    summary: job.summary,
    description: descriptionFor(raw, job),
    source: raw.source,
    sourceId: raw.source_id,
    sourceUrl: raw.source_url,
    author: raw.author,
    sourcesJson: JSON.stringify([sourceRef]),
    postedAt: raw.posted_at,
    expiresAt,
    riskLevel: job.risk_level,
    riskReason: job.risk_level === "ok" ? null : job.risk_reason || "Có dấu hiệu đáng ngờ.",
    model: config.deepseekModel,
    now,
  });
  markJobRawProcessed(raw.id, true, now);
  return job.risk_level === "ok" ? "created" : "suspect";
}

export async function runDailyJobs(): Promise<DailyJobsReport | null> {
  if (!anySourceConfigured()) {
    console.log("[daily-jobs] Chưa cấu hình nguồn nào (JOB_FB_GROUP_SLUG/JOB_TELEGRAM_GROUP_SLUG) — bỏ qua.");
    return null;
  }
  if (!config.deepseekApiKey) {
    throw new Error("Thiếu DEEPSEEK_API_KEY — không lọc/bóc tách được tin tuyển dụng.");
  }

  const now = Date.now();
  if (!acquireLock(LOCK_KEY, now, LOCK_STALE_MS)) {
    console.log("[daily-jobs] Đang có tiến trình daily-jobs khác chạy — bỏ qua.");
    return null;
  }

  try {
    const collected = await collectRawJobs(now);
    for (const err of collected.errors) {
      console.warn(`[daily-jobs] Nguồn ${err.source} lỗi: ${err.message}`);
      recordBotError({
        source: "daily-jobs",
        code: `source_${err.source}_failed`,
        message: err.message,
      });
    }
    console.log(
      `[daily-jobs] Thu về: Facebook ${collected.bySource.facebook}, ` +
        `Telegram ${collected.bySource.telegram}, Zalo ${collected.bySource.zalo} mẩu mới.`,
    );

    const pending = listPendingJobRaw(config.jobMaxItemsPerRun);
    const report: DailyJobsReport = {
      collected: collected.bySource,
      processed: 0,
      created: 0,
      reposted: 0,
      rejected: 0,
      suspect: 0,
      expired: 0,
      errors: [...collected.errors],
    };

    for (const raw of pending) {
      try {
        const outcome = await processRaw(raw, Date.now());
        report[outcome] += 1;
        report.processed += 1;
      } catch (e) {
        // Một mẩu lỗi không được làm hỏng cả lần chạy. KHÔNG đánh dấu đã xử lý
        // để lần sau thử lại — trừ khi model trả rác thì lần sau cũng vậy, nên
        // vẫn có trần jobMaxItemsPerRun chặn vòng lặp tốn tiền.
        console.warn(`[daily-jobs] Bóc tách mẩu #${raw.id} lỗi: ${String(e)}`);
        report.errors.push({ source: `raw#${raw.id}`, message: String(e) });
      }
    }

    report.expired = expireJobPosts(Date.now());

    const pendingLeft = listPendingJobRaw(config.jobMaxItemsPerRun + 1).length;
    if (pendingLeft > config.jobMaxItemsPerRun) {
      console.log(
        `[daily-jobs] Còn ${pendingLeft} mẩu chờ xử lý — vượt trần ${config.jobMaxItemsPerRun}/lần, ` +
          "phần còn lại sẽ chạy ở lần sau.",
      );
    }

    console.log(
      `[daily-jobs] Xong: ${report.created} tin mới, ${report.reposted} tin đăng lại, ` +
        `${report.rejected} mẩu không phải tuyển dụng, ${report.suspect} tin nghi ngờ (đang ẩn), ` +
        `${report.expired} tin hết hạn được gỡ.`,
    );

    if (!config.dryRun) await notifyIfNeeded(report);
    return report;
  } finally {
    releaseLock(LOCK_KEY);
  }
}

/**
 * Chỉ nhắn khi có chuyện đáng để mắt tới. Ngày bình thường im lặng — báo cáo
 * "hôm nay 0 tin" mỗi sáng chỉ làm quản trị viên quen tay bỏ qua thông báo.
 */
async function notifyIfNeeded(report: DailyJobsReport): Promise<void> {
  const lines: string[] = [];
  if (report.suspect > 0) {
    lines.push(
      `⚠️ ${report.suspect} tin tuyển dụng có dấu hiệu đáng ngờ đang ẩn, chờ anh xem ở trang quản trị.`,
    );
  }
  if (report.errors.length > 0) {
    const detail = report.errors
      .slice(0, 3)
      .map((e) => `${e.source}: ${e.message.slice(0, 140)}`)
      .join("\n");
    lines.push(`⚠️ Lấy tin tuyển dụng gặp ${report.errors.length} lỗi:\n${detail}`);
  }
  if (lines.length === 0) return;

  await notifyBestEffort(
    `${lines.join("\n\n")}\n\n(Hôm nay: ${report.created} tin mới, ${report.reposted} tin đăng lại.)`,
  );
}

/** Bọc lỗi: ghi bot_errors trước khi ném lên để cron thấy exit code khác 0. */
export async function runDailyJobsSafe(): Promise<void> {
  try {
    await runDailyJobs();
  } catch (e) {
    recordBotError({
      source: "daily-jobs",
      code: "daily_jobs_failed",
      message: String(e),
      detail: e instanceof Error ? e.stack : null,
    });
    throw e;
  }
}

