import { runListener } from "./listener.js";
import { runExportMembers } from "./commands/export-members.js";
import { runListGroups } from "./commands/list-groups.js";
import { runCleanupWarn, runMonthlyCleanup, runTelegramPoll } from "./commands/monthly-cleanup.js";
import { runImportInteractions } from "./commands/import-interactions.js";
import { runSyncVotes } from "./commands/sync-votes.js";
import { runTelegramTest } from "./commands/telegram-test.js";

/**
 * Entrypoint. Chọn lệnh qua arg đầu tiên:
 *   start          → chạy listener keep-alive (tài khoản phụ). Ghi tương tác real-time.
 *   export-members → xuất danh sách member ra CSV để tra ID cho VIP list.
 *   import-interactions → import vote/manual interactions từ CSV/JSON.
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
  npm run sync-votes        # đọc người đã vote trong poll group → ghi tương tác (cả vote cũ)
  npm run telegram-test     # gửi tin thử để kiểm TELEGRAM_BOT_TOKEN + CHAT_ID
  npm run cleanup-warn      # ngày 25: cảnh báo group (DRY_RUN=1 chỉ in)
  npm run monthly-cleanup   # mùng 3: lập danh sách/kick (DRY_RUN=1 chỉ in)
  npm run telegram-poll     # cron mỗi phút: duyệt/huỷ/retry/timeout qua Telegram
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
    case "sync-votes":
      await runSyncVotes();
      break;
    case "telegram-test":
      await runTelegramTest();
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
    default:
      console.log(USAGE);
      process.exitCode = cmd ? 1 : 0;
      if (cmd) console.error(`Lệnh không hợp lệ: "${cmd}"`);
  }
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exitCode = 1;
});
