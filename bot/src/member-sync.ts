import { config } from "./config.js";
import {
  createMemberSyncRun,
  finishMemberSyncRun,
  getMember,
  getMemberStats,
  markMemberLeft,
  recordMemberEvent,
  upsertMember,
  type MemberEventSource,
} from "./db/index.js";
import { getGroupSnapshot } from "./zalo/client.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface GroupMemberSyncResult {
  runId: number;
  groupId: string;
  groupName: string;
  memberCount: number;
  snapshotCount: number;
  upserted: number;
  markedLeft: number;
}

export interface GroupMemberSyncOptions {
  requestedBy?: string;
  eventSource?: MemberEventSource;
}

/**
 * Đồng bộ trạng thái member hiện tại từ Zalo về DB.
 *
 * Chỉ đánh dấu member rời nhóm khi snapshot lấy được có vẻ đầy đủ. Nếu Zalo trả
 * danh sách rỗng/thiếu so với totalMember, ném lỗi để tránh làm inactive nhầm cả nhóm.
 */
export async function syncGroupMembers(
  api: any,
  now = Date.now(),
  options: GroupMemberSyncOptions = {},
): Promise<GroupMemberSyncResult> {
  if (!config.groupId) {
    throw new Error("Chưa có GROUP_ID trong .env");
  }

  const requestedBy = options.requestedBy ?? "system";
  const eventSource = options.eventSource ?? "snapshot_sync";
  const runId = createMemberSyncRun({ requestedBy, startedAt: now });

  try {
    const snap = await getGroupSnapshot(api, config.groupId);
    const reportedCount = Number.isFinite(snap.totalMember) ? snap.totalMember : 0;
    const snapshotCount = snap.members.length;

    if (reportedCount > 0 && snapshotCount === 0) {
      throw new Error(
        `Zalo trả snapshot member rỗng trong khi totalMember=${reportedCount}; bỏ qua sync để tránh lệch DB.`,
      );
    }
    if (reportedCount > 0 && snapshotCount < reportedCount) {
      throw new Error(
        `Zalo trả snapshot member chưa đủ (${snapshotCount}/${reportedCount}); bỏ qua đánh dấu rời nhóm.`,
      );
    }

    const activeIds = new Set<string>();
    for (const m of snap.members) {
      if (!m.id) continue;
      activeIds.add(m.id);
      const before = getMember(m.id);
      upsertMember({ zaloUserId: m.id, displayName: m.displayName, role: m.role, now });
      if (!before) {
        recordMemberEvent({
          zaloUserId: m.id,
          displayName: m.displayName,
          role: m.role,
          eventType: "joined",
          source: eventSource,
          syncRunId: runId,
          ts: now,
          note: "Phát hiện qua snapshot sync.",
        });
      } else if (before.is_active === 0) {
        recordMemberEvent({
          zaloUserId: m.id,
          displayName: m.displayName || before.display_name,
          role: m.role,
          eventType: "reactivated",
          source: eventSource,
          syncRunId: runId,
          ts: now,
          note: "Member xuất hiện lại trong snapshot sync.",
        });
      }
    }

    let markedLeft = 0;
    for (const s of getMemberStats()) {
      if (activeIds.has(s.zalo_user_id)) continue;
      markMemberLeft(s.zalo_user_id, now);
      recordMemberEvent({
        zaloUserId: s.zalo_user_id,
        displayName: s.display_name,
        role: s.role,
        eventType: "left",
        source: eventSource,
        syncRunId: runId,
        ts: now,
        note: "Không còn trong snapshot Zalo.",
      });
      markedLeft += 1;
    }

    const result = {
      runId,
      groupId: snap.groupId,
      groupName: snap.name,
      memberCount: reportedCount || activeIds.size,
      snapshotCount,
      upserted: activeIds.size,
      markedLeft,
    };
    finishMemberSyncRun({
      id: runId,
      finishedAt: Date.now(),
      status: "done",
      groupId: result.groupId,
      groupName: result.groupName,
      memberCount: result.memberCount,
      snapshotCount: result.snapshotCount,
      upserted: result.upserted,
      markedLeft: result.markedLeft,
    });
    return result;
  } catch (e) {
    finishMemberSyncRun({
      id: runId,
      finishedAt: Date.now(),
      status: "failed",
      error: String(e),
    });
    throw e;
  }
}
