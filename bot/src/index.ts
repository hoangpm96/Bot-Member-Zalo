import { runListener } from "./listener.js";
import { runInitSeed } from "./commands/init-seed.js";
import { runExportMembers } from "./commands/export-members.js";
import { runListGroups } from "./commands/list-groups.js";

/**
 * Entrypoint. Chọn lệnh qua arg đầu tiên:
 *   start          → chạy listener keep-alive (tài khoản phụ). Ghi tương tác real-time.
 *   init-seed      → khởi tạo DB lần đầu bằng tài khoản chính (CHỈ ĐỌC).
 *   export-members → xuất danh sách member ra CSV để tra ID cho VIP list.
 *
 * Milestone 2 sẽ thêm: monthly-cleanup (xếp hạng + cảnh báo + duyệt Telegram + kick).
 */

const USAGE = `Bot-Member-Zalo (Milestone 1)

Cách dùng:
  npm run list-groups       # liệt kê group + ID (đăng nhập acc chính) — lấy GROUP_ID cho .env
  npm start                 # chạy listener (tài khoản phụ) — ghi tương tác liên tục
  npm run init-seed         # khởi tạo DB bằng tài khoản chính (CHỈ ĐỌC, 1 lần lúc setup)
  npm run export-members    # xuất danh sách member ra CSV (tra ID cho VIP list)
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
    case "init-seed":
      await runInitSeed();
      break;
    case "export-members":
      runExportMembers();
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
