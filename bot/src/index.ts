import { runListener } from "./listener.js";
import { runExportMembers } from "./commands/export-members.js";
import { runListGroups } from "./commands/list-groups.js";
import { runCleanupWarn, runMonthlyCleanup, runTelegramPoll } from "./commands/monthly-cleanup.js";
import { runCheckPermissions } from "./commands/check-permissions.js";
import { runHealthCheck } from "./commands/health-check.js";
import { runImportInteractions } from "./commands/import-interactions.js";
import { runSyncMembers } from "./commands/sync-members.js";
import { runSyncVotes } from "./commands/sync-votes.js";
import { runSyncLeaderboard } from "./commands/sync-leaderboard.js";
import { runSyncPosts } from "./commands/sync-posts.js";
import { runTelegramTest } from "./commands/telegram-test.js";
import { runTelegramFindTopic, runTelegramForwardTest } from "./commands/telegram-forward.js";
import { runDailySummarySafe } from "./commands/daily-summary.js";
import { runDailyFbPostSafe } from "./commands/daily-fb-post.js";
import { runBackfillSummaries } from "./commands/backfill-summaries.js";
import { runBackfillFbPosts } from "./commands/backfill-fb-posts.js";
import { runDailyJobsSafe } from "./commands/daily-jobs.js";
import { runBackfillTelegramJobs } from "./commands/backfill-telegram-jobs.js";
import { runSyncJobs } from "./commands/sync-jobs.js";
import { runBackfillJobTitles } from "./commands/backfill-job-titles.js";
import { recordBotError } from "./db/index.js";

/**
 * Entrypoint. Chọn lệnh qua arg đầu tiên:
 *   start          → chạy listener keep-alive (tài khoản phụ). Ghi tương tác real-time.
 *   export-members → xuất danh sách member ra CSV để tra ID cho VIP list.
 *   import-interactions → import vote/manual interactions từ CSV/JSON.
 *   sync-members  → đồng bộ danh sách member hiện tại từ Zalo về DB.
 *   cleanup-warn   → cảnh báo group ngày 25 (dry-run mặc định).
 *   monthly-cleanup → lập kế hoạch/kick định kỳ (dry-run mặc định).
 *   telegram-poll  → xử lý Telegram approval/cancel/retry/timeout.
 *
 * Milestone 2 hiện có lõi xếp hạng + cảnh báo + kick dry-run/real qua CLI.
 */

const USAGE = `Bot-Member-Zalo

Cách dùng:
  npm run list-groups       # liệt kê group + ID (tài khoản co-admin) — lấy GROUP_ID cho .env
  npm start                 # chạy listener (tài khoản co-admin) — ghi tương tác liên tục
  npm run export-members    # xuất danh sách member ra CSV (tra ID cho VIP list)
  npm run import-interactions -- ./data/manual-votes.csv
  npm run sync-members      # đồng bộ member hiện tại từ Zalo → DB
  npm run check-permissions # kiểm tra quyền bot trong group (không kick/xoá thật)
  npm run health-check      # cron: báo Telegram nếu bot heartbeat stale
  npm run sync-votes        # đọc người đã vote trong poll group → ghi tương tác (cả vote cũ)
  npm run sync-leaderboard  # cron: đẩy bảng xếp hạng lên Supabase → hiện ở bahub.vn/leaderboard
  npm run sync-posts        # cron: đẩy kho bản tin công khai lên Supabase → hiện ở bahub.vn/ban-tin (--full: đẩy lại hết)
  npm run telegram-test     # gửi tin thử để kiểm TELEGRAM_BOT_TOKEN + CHAT_ID
  npm run telegram-find-topic # tìm chat ID + forum topic ID từ một message mới
  npm run telegram-forward-test # gửi thử vào đúng đích forward Zalo
  npm run cleanup-warn      # ngày 25: cảnh báo group (DRY_RUN=1 chỉ in)
  npm run monthly-cleanup   # mùng 3: lập danh sách/kick (DRY_RUN=1 chỉ in)
  npm run telegram-poll     # cron mỗi phút: duyệt/huỷ/retry/timeout qua Telegram
  npm run daily-summary     # cron 9:10 sáng: tóm tắt tin nhắn hôm qua (DeepSeek) → gửi các group/Telegram
  npm run daily-fb-post     # cron 8:00 sáng: bản tin public + ảnh AI → đăng Facebook Page, báo link Telegram
  npm run backfill-summaries # bù kho daily_summaries cho ngày quá khứ (--from/--to/--max-days, DRY_RUN=1 chỉ liệt kê)
  npm run backfill-fb-posts # bù kho bản tin công khai cho ngày quá khứ (--from/--to/--day/--max-days/--force/--no-images)
  npm run daily-jobs        # cron 7:30 sáng: gom tin tuyển dụng 3 nguồn → AI bóc tách → kho job_posts
  npm run backfill-telegram-jobs -- --days=30  # bù tin tuyển dụng Telegram cho N ngày quá khứ
  npm run sync-jobs         # cron: đẩy kho tin tuyển dụng lên Supabase → hiện ở bahub.vn/tuyen-dung (--full: đẩy lại hết)
  npm run backfill-job-titles # vá một lần: mở viết tắt tên vị trí trong kho cũ (--dry-run chỉ liệt kê)
`;

async function main(): Promise<void> {
  const cmd = process.argv[2];

  switch (cmd) {
    case "start":
      await runListener();
      break;
    case "list-groups":
      await runListGroups();
      break;
    case "export-members":
      runExportMembers();
      break;
    case "import-interactions":
      runImportInteractions(process.argv[3]);
      break;
    case "sync-members":
      await runSyncMembers();
      break;
    case "check-permissions":
      await runCheckPermissions();
      break;
    case "health-check":
      await runHealthCheck();
      break;
    case "sync-votes":
      await runSyncVotes();
      break;
    case "sync-leaderboard":
      await runSyncLeaderboard();
      break;
    case "sync-posts":
      await runSyncPosts(process.argv.slice(3));
      break;
    case "telegram-test":
      await runTelegramTest();
      break;
    case "telegram-find-topic":
      await runTelegramFindTopic();
      break;
    case "telegram-forward-test":
      await runTelegramForwardTest();
      break;
    case "cleanup-warn":
      await runCleanupWarn();
      break;
    case "monthly-cleanup":
      await runMonthlyCleanup();
      break;
    case "telegram-poll":
      await runTelegramPoll();
      break;
    case "daily-summary":
      await runDailySummarySafe();
      break;
    case "daily-fb-post":
      await runDailyFbPostSafe();
      break;
    case "backfill-summaries":
      await runBackfillSummaries();
      break;
    case "backfill-fb-posts":
      await runBackfillFbPosts();
      break;
    case "daily-jobs":
      await runDailyJobsSafe();
      break;
    case "backfill-telegram-jobs":
      await runBackfillTelegramJobs(process.argv.slice(3));
      break;
    case "sync-jobs":
      await runSyncJobs(process.argv.slice(3));
      break;
    case "backfill-job-titles":
      runBackfillJobTitles(process.argv.slice(3));
      break;
    default:
      console.log(USAGE);
      process.exitCode = cmd ? 1 : 0;
      if (cmd) console.error(`Lệnh không hợp lệ: "${cmd}"`);
  }
}

main().catch((e) => {
  try {
    recordBotError({
      source: "index",
      code: "fatal",
      message: String(e),
      detail: e instanceof Error ? e.stack : null,
    });
  } catch {
    // Nếu DB cũng lỗi, vẫn in fatal ra stderr.
  }
  console.error("[fatal]", e);
  process.exitCode = 1;
});
