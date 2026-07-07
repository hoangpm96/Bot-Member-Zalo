import { config } from "../config.js";
import { syncGroupMembers } from "../member-sync.js";
import { login } from "../zalo/client.js";

/** sync-members — đọc snapshot member hiện tại từ Zalo rồi cập nhật bảng members. */
export async function runSyncMembers(): Promise<void> {
  if (!config.groupId) {
    console.error("[sync-members] Chưa có GROUP_ID trong .env.");
    process.exitCode = 1;
    return;
  }

  const api = await login();
  const result = await syncGroupMembers(api, Date.now(), { requestedBy: "cli" });
  console.log(
    `[sync-members] Group="${result.groupName}" member=${result.memberCount}; ` +
      `snapshot=${result.snapshotCount}, upsert=${result.upserted}, inactive=${result.markedLeft}.`,
  );
}
