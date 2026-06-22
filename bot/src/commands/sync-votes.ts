import { config } from "../config.js";
import { login, fetchGroupPollVotes } from "../zalo/client.js";
import { getMember, logInteraction } from "../db/index.js";

/**
 * sync-votes — đọc danh sách người đã vote trong các poll đang có của group rồi ghi vào
 * interactions (type='vote', source='poll'). Đọc được cả vote CŨ lẫn mới (poll lưu trạng
 * thái server). Chạy thủ công, qua cron, hoặc được listener gọi định kỳ.
 *
 * READ-ONLY với Zalo (getListBoard + đọc voters). Dedupe lo trùng khi chạy lại.
 * Chỉ ghi vote cho member còn trong DB (bỏ qua người lạ / đã rời).
 */
export async function runSyncVotes(): Promise<number> {
  if (!config.groupId) {
    console.error("[sync-votes] Chưa có GROUP_ID trong .env.");
    process.exitCode = 1;
    return 0;
  }

  const api = await login();
  const votes = await fetchGroupPollVotes(api, config.groupId, {
    maxPages: 50,
    throttleMs: config.zaloThrottleMs,
  });

  let written = 0;
  let skippedUnknown = 0;
  for (const v of votes) {
    if (!getMember(v.voterId)) {
      skippedUnknown += 1;
      continue;
    }
    logInteraction({ zaloUserId: v.voterId, type: "vote", ts: v.ts, source: "poll" });
    written += 1;
  }

  console.log(
    `[sync-votes] Đọc ${votes.length} lượt vote từ poll; ghi ${written} (bỏ ${skippedUnknown} người không có trong DB).`,
  );
  return written;
}
