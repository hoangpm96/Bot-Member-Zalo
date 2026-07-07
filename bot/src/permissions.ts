import { config } from "./config.js";
import { getGroupSnapshot } from "./zalo/client.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PermissionCheckResult {
  checkedAt: number;
  groupId: string;
  groupName: string;
  ownId: string;
  role: "owner" | "admin" | "member" | "unknown";
  canReadMembers: boolean;
  hasKickMethod: boolean;
  hasDeleteMessageMethod: boolean;
  hasBlockMethod: boolean;
  likelyCanKick: boolean;
  likelyCanDeleteMessages: boolean;
  likelyCanBlockMembers: boolean;
  issues: string[];
}

export async function checkBotPermissions(api: any, now = Date.now()): Promise<PermissionCheckResult> {
  if (!config.groupId) throw new Error("Chưa có GROUP_ID trong .env");

  const ownId = typeof api.getOwnId === "function" ? String(api.getOwnId()) : "";
  const snap = await getGroupSnapshot(api, config.groupId);
  const own = snap.members.find((member) => member.id === ownId);
  const role = own?.role ?? "unknown";
  const canManage = role === "owner" || role === "admin";
  const hasKickMethod =
    typeof api.removeUserFromGroup === "function" ||
    typeof api.removeMemberFromGroup === "function" ||
    typeof api.removeGroupMember === "function";
  const hasDeleteMessageMethod = typeof api.deleteMessage === "function";
  const hasBlockMethod = typeof api.addGroupBlockedMember === "function";
  const issues: string[] = [];

  if (!ownId) issues.push("Không đọc được ownId của tài khoản bot.");
  if (!own) issues.push("Không tìm thấy tài khoản bot trong snapshot member.");
  if (!snap.members.length) issues.push("Không đọc được danh sách member.");
  if (!canManage) issues.push(`Bot role=${role}; cần owner/admin để kick/xoá tin ổn định.`);
  if (!hasKickMethod) issues.push("Runtime zca-js không có method kick member.");
  if (!hasDeleteMessageMethod) issues.push("Runtime zca-js không có method xoá message.");
  if (!hasBlockMethod) issues.push("Runtime zca-js không có method chặn vào lại.");

  return {
    checkedAt: now,
    groupId: snap.groupId,
    groupName: snap.name,
    ownId,
    role,
    canReadMembers: snap.members.length > 0,
    hasKickMethod,
    hasDeleteMessageMethod,
    hasBlockMethod,
    likelyCanKick: canManage && hasKickMethod,
    likelyCanDeleteMessages: canManage && hasDeleteMessageMethod,
    likelyCanBlockMembers: canManage && hasBlockMethod,
    issues,
  };
}
