import { listAllJobPosts, updateJobPostTitle } from "../db/index.js";
import { normalizeJobTitle } from "../jobs/title.js";

/**
 * Vá một lần cho kho cũ: mở viết tắt trong tên vị trí của những tin đã nằm sẵn
 * trong `job_posts` ("BA" → "Business Analyst", "BA/PO" → "Business Analyst /
 * Product Owner").
 *
 * Tin mới đã được chuẩn hoá ngay lúc bóc tách (xem `jobs/title.ts`), lệnh này
 * chỉ để những tin ghi trước đó không phải chờ hết hạn mới hết viết tắt.
 *
 * Chỉ đụng vào cột `title`. Sửa xong thì `updated_at` nhích lên, nên lần
 * `sync-jobs` kế tiếp tự đẩy tên mới sang Supabase — không cần `--full`.
 *
 * Chạy lại nhiều lần vô hại: tên đã chuẩn hoá thì lần sau không còn gì để đổi.
 *
 *   npm run backfill-job-titles -- --dry-run   # chỉ liệt kê
 *   npm run backfill-job-titles                # sửa thật
 */
export function runBackfillJobTitles(argv: string[] = []): void {
  const dryRun = argv.includes("--dry-run") || process.env.DRY_RUN === "1";
  const now = Date.now();

  const changes = listAllJobPosts().flatMap((row) => {
    const title = normalizeJobTitle(row.title);
    return title === row.title ? [] : [{ id: row.id, from: row.title, to: title }];
  });

  if (changes.length === 0) {
    console.log("[backfill-job-titles] Không có tên vị trí nào cần mở viết tắt.");
    return;
  }

  for (const change of changes) {
    console.log(`  #${change.id}  ${change.from}  →  ${change.to}`);
    if (!dryRun) updateJobPostTitle(change.id, change.to, now);
  }

  console.log(
    dryRun
      ? `[backfill-job-titles] ${changes.length} tin SẼ được sửa (đang --dry-run, chưa ghi gì).`
      : `[backfill-job-titles] Đã sửa ${changes.length} tin. Chạy \`npm run sync-jobs\` để đẩy lên bahub.vn.`,
  );
}
