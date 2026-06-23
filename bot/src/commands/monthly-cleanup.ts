import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { runtimeConfig } from "../runtime-config.js";
import {
  acquireLock,
  countActiveMembers,
  createScanRun,
  finishScanRun,
  getBotState,
  getLatestScanRunByStatus,
  getMemberStats,
  getScanRun,
  hasCleanupWarning,
  listCleanupPlanItems,
  markCleanupPlanItem,
  markCleanupPlanItemsForRun,
  markMemberLeft,
  recordRemoval,
  releaseLock,
  saveCleanupPlanItems,
  setBotState,
  upsertCleanupWarning,
  upsertMember,
  type MemberStats,
  type ScanRunRow,
} from "../db/index.js";
import { login, getGroupSnapshot, removeGroupMember, sendGroupText, sleep } from "../zalo/client.js";
import {
  answerCallbackQuery,
  pollTelegramUpdates,
  sendApprovalMessage,
  sendTelegramText,
} from "../telegram.js";
import {
  ensureWarmupStarted,
  isFirstCycleSkipped,
  isWarmupComplete,
  markFirstCycleSkipped,
  warmupDaysRemaining,
} from "../warmup.js";

/**
 * Milestone 2 — cleanup theo kỳ.
 *
 * Lệnh này cố tình chạy được bằng CLI/cron trước khi có Telegram approval:
 *   - `monthly-cleanup` tính danh sách và kick nếu DRY_RUN=0.
 *   - Khi DRY_RUN=1 chỉ in danh sách + ghi scan_run, không gọi remove.
 *
 * Rule ranking: interaction_count ASC, last_interaction ASC (NULL = chưa từng tương tác,
 * đứng trước). 0 tương tác lần đầu lọt top-kick được ghi ân hạn, chưa xoá kỳ đó.
 */

interface CleanupCandidate extends MemberStats {
  reason: string;
}

interface VipEntry {
  id: string;
  note?: string;
}

function fmtTs(ts: number | null): string {
  return ts ? new Date(ts).toISOString() : "chưa có";
}

function isTelegramEnabled(): boolean {
  return config.telegramBotToken !== "" && config.telegramChatId !== "";
}

function cycleStartMs(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
}

function loadVipIds(): Set<string> {
  const p = config.vipListPath;
  if (!fs.existsSync(p)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "[]\n", "utf8");
    return new Set();
  }
  // Catch lỗi đọc/parse (vd web đang ghi dở, JSON hỏng) → coi như VIP rỗng + cảnh báo,
  // KHÔNG crash cả kỳ cleanup. An toàn: thà bỏ sót VIP còn hơn dừng giữa chừng.
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.warn(`[monthly-cleanup] Không đọc được VIP list (${String(e)}) — coi như rỗng kỳ này.`);
    return new Set();
  }
  const entries: VipEntry[] = Array.isArray(raw)
    ? raw.map((x) => (typeof x === "string" ? { id: x } : (x as VipEntry)))
    : [];
  const ids = entries.map((x) => String(x.id ?? "").trim()).filter(Boolean);
  if (ids.length > 100) {
    throw new Error(`VIP list vượt giới hạn 100 người (${ids.length}) ở ${p}`);
  }
  return new Set(ids);
}

function buildCandidates(stats: MemberStats[], vipIds: Set<string>, now: number): CleanupCandidate[] {
  const startOfCycle = cycleStartMs(now);
  const out: CleanupCandidate[] = [];

  for (const s of stats) {
    if (s.role !== "member") continue;
    if (vipIds.has(s.zalo_user_id)) continue;
    if (s.first_seen_at >= startOfCycle || (s.joined_at !== null && s.joined_at >= startOfCycle)) {
      continue;
    }
    out.push({
      ...s,
      reason:
        s.interaction_count === 0
          ? "0 tương tác"
          : `${s.interaction_count} tương tác, lần cuối ${fmtTs(s.last_interaction)}`,
    });
  }

  return out;
}

async function syncGroupMembers(now: number): Promise<number> {
  if (!config.groupId) {
    throw new Error("Chưa có GROUP_ID trong .env");
  }

  const api = await login();
  const snap = await getGroupSnapshot(api, config.groupId);
  const activeIds = new Set(snap.members.map((m) => m.id));

  for (const m of snap.members) {
    if (!m.id) continue;
    upsertMember({ zaloUserId: m.id, displayName: m.displayName, role: m.role, now });
  }

  for (const s of getMemberStats()) {
    if (!activeIds.has(s.zalo_user_id)) markMemberLeft(s.zalo_user_id, now);
  }

  return snap.totalMember || activeIds.size;
}

export async function runCleanupWarn(): Promise<void> {
  const now = Date.now();
  const memberCount = await syncGroupMembers(now);
  const runId = createScanRun({
    startedAt: now,
    status: "warned",
    targetCount: runtimeConfig.targetMemberCount,
    memberCount,
    plannedKicks: 0,
    actualKicks: 0,
    note: "monthly warning",
  });

  if (memberCount <= runtimeConfig.targetMemberCount) {
    finishScanRun({
      id: runId,
      finishedAt: Date.now(),
      status: "skipped",
      memberCount,
      plannedKicks: 0,
      actualKicks: 0,
      note: `Nhóm đang có ${memberCount} thành viên (<= ${runtimeConfig.targetMemberCount}), bỏ cảnh báo.`,
    });
    console.log(`[cleanup-warn] Nhóm có ${memberCount} thành viên, không gửi cảnh báo.`);
    return;
  }

  const text =
    "📢 Còn khoảng 9 ngày nữa nhóm sẽ dọn bớt thành viên ít hoạt động. " +
    "Hãy nhắn tin hoặc thả reaction để được ghi nhận là đang hoạt động nhé!";

  if (config.dryRun || !config.sendGroupWarnings) {
    finishScanRun({
      id: runId,
      finishedAt: Date.now(),
      status: "done",
      memberCount,
      plannedKicks: 0,
      actualKicks: 0,
      note: "Dry-run hoặc SEND_GROUP_WARNINGS=0, chưa gửi group warning.",
    });
    console.log(`[cleanup-warn] DRY-RUN: sẽ gửi cảnh báo group:\n${text}`);
    return;
  }

  const api = await login();
  await sendGroupText(api, config.groupId, text);
  finishScanRun({
    id: runId,
    finishedAt: Date.now(),
    status: "done",
    memberCount,
    plannedKicks: 0,
    actualKicks: 0,
    note: "Đã gửi group warning.",
  });
  console.log("[cleanup-warn] Đã gửi cảnh báo vào group.");
}

export async function runMonthlyCleanup(): Promise<void> {
  const now = Date.now();
  ensureWarmupStarted(now);

  const memberCount = await syncGroupMembers(now);
  const runId = createScanRun({
    startedAt: now,
    status: "collecting",
    targetCount: runtimeConfig.targetMemberCount,
    memberCount,
    plannedKicks: 0,
    actualKicks: 0,
  });

  if (!isWarmupComplete(now)) {
    const note = `Bot đang thu thập dữ liệu, còn ${warmupDaysRemaining(now)} ngày.`;
    finishScanRun({ id: runId, finishedAt: Date.now(), status: "skipped", memberCount, note });
    console.log(`[monthly-cleanup] ${note}`);
    await maybeSendTelegram(`⏳ ${note}`);
    return;
  }

  if (!isFirstCycleSkipped()) {
    markFirstCycleSkipped(now);
    const note = "Kỳ đầu tiên sau warmup: bỏ qua kick, chỉ ghi nhận dữ liệu.";
    finishScanRun({ id: runId, finishedAt: Date.now(), status: "skipped", memberCount, note });
    console.log(`[monthly-cleanup] ${note}`);
    await maybeSendTelegram(`ℹ️ ${note}`);
    return;
  }

  if (memberCount <= runtimeConfig.targetMemberCount) {
    const note = `Nhóm đang có ${memberCount} thành viên (<= ${runtimeConfig.targetMemberCount}), không cần dọn.`;
    finishScanRun({ id: runId, finishedAt: Date.now(), status: "skipped", memberCount, note });
    console.log(`[monthly-cleanup] ${note}`);
    await maybeSendTelegram(`ℹ️ ${note}`);
    return;
  }

  const vipIds = loadVipIds();
  const candidates = buildCandidates(getMemberStats(), vipIds, now);
  const needToRemove = Math.min(memberCount - runtimeConfig.targetMemberCount, runtimeConfig.maxKicksPerRun);
  const top = candidates.slice(0, needToRemove);
  const grace: CleanupCandidate[] = [];
  const plan: CleanupCandidate[] = [];

  for (const c of top) {
    if (c.interaction_count === 0 && !hasCleanupWarning(c.zalo_user_id)) {
      upsertCleanupWarning({ zaloUserId: c.zalo_user_id, scanRunId: runId, now });
      grace.push(c);
      continue;
    }
    plan.push(c);
  }

  finishScanRun({
    id: runId,
    finishedAt: Date.now(),
    status: config.dryRun || !isTelegramEnabled() ? "planned" : "pending_approval",
    memberCount,
    plannedKicks: plan.length,
    actualKicks: 0,
    note: `${grace.length} member được ân hạn; ${plan.length} member trong kế hoạch xoá.`,
  });
  saveCleanupPlanItems({
    scanRunId: runId,
    now,
    items: plan.map((c, idx) => ({
      zaloUserId: c.zalo_user_id,
      displayName: c.display_name,
      interactionCount: c.interaction_count,
      lastInteraction: c.last_interaction,
      rank: idx + 1,
    })),
  });

  console.log(
    `[monthly-cleanup] Group=${memberCount}, target=${runtimeConfig.targetMemberCount}, ` +
      `cần=${needToRemove}, ân hạn=${grace.length}, sẽ xoá=${plan.length}, VIP=${vipIds.size}.`,
  );
  printList("Ân hạn kỳ này", grace);
  printList(config.dryRun ? "DRY-RUN danh sách sẽ xoá" : "Danh sách xoá", plan);

  if (config.dryRun || plan.length === 0) {
    console.log("[monthly-cleanup] DRY_RUN=1 hoặc không có ai để xoá, dừng trước khi gọi Zalo remove.");
    return;
  }

  if (!isTelegramEnabled()) {
    // BẮT BUỘC có Telegram mới kick: không có duyệt thì KHÔNG kick (an toàn, khớp brainstorm).
    // Giữ status 'planned' để sau khi cấu hình Telegram + chạy lại sẽ gửi duyệt.
    console.warn(
      "[monthly-cleanup] ⚠️ Chưa cấu hình Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID). " +
        "KHÔNG kick khi chưa có bước duyệt. Đã lập danh sách (status=planned); cấu hình Telegram rồi chạy lại.",
    );
    return;
  }

  await sendApprovalMessage({
    scanRunId: runId,
    text: buildApprovalText(runId, memberCount, plan, grace.length),
  });
  // Mốc gửi duyệt — timeout 48h tính TỪ ĐÂY (không phải lúc tạo scan run).
  setBotState(approvalSentKey(runId), String(Date.now()), Date.now());
  console.log("[monthly-cleanup] Đã gửi danh sách duyệt qua Telegram, chờ approve/cancel/timeout.");
}

export async function runTelegramPoll(): Promise<void> {
  if (!isTelegramEnabled()) {
    console.error(
      "[telegram-poll] Chưa cấu hình Telegram. Điền TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID vào .env.",
    );
    process.exitCode = 1;
    return;
  }

  const now = Date.now();
  const updates = await pollTelegramUpdates(now);
  console.log(`[telegram-poll] Đã kết nối Telegram OK. Nhận ${updates.length} update mới.`);

  for (const u of updates) {
    if (u.callbackData?.startsWith("cleanup:")) {
      const [, action, idRaw] = u.callbackData.split(":");
      const scanRunId = Number(idRaw);
      if (!Number.isInteger(scanRunId)) continue;

      if (action === "cancel") {
        const run = getScanRun(scanRunId);
        if (!run || run.status !== "pending_approval") {
          if (u.callbackQueryId) await answerCallbackQuery(u.callbackQueryId, "Kỳ này không còn chờ duyệt.");
          continue;
        }
        markCleanupPlanItemsForRun({
          scanRunId,
          fromStatus: "planned",
          toStatus: "skipped",
          error: "Admin huỷ qua Telegram.",
          now: Date.now(),
        });
        finishScanRun({
          id: scanRunId,
          finishedAt: Date.now(),
          status: "cancelled",
          actualKicks: 0,
          note: "Admin huỷ qua Telegram.",
        });
        if (u.callbackQueryId) await answerCallbackQuery(u.callbackQueryId, "Đã huỷ kỳ dọn dẹp.");
        await sendTelegramText(`🚫 Đã huỷ kỳ dọn dẹp #${scanRunId}. Không có thành viên nào bị xoá.`);
      }

      if (action === "approve") {
        const run = getScanRun(scanRunId);
        if (!run || run.status !== "pending_approval") {
          if (u.callbackQueryId) await answerCallbackQuery(u.callbackQueryId, "Kỳ này không còn chờ duyệt.");
          continue;
        }
        if (u.callbackQueryId) await answerCallbackQuery(u.callbackQueryId, "Đã duyệt, bắt đầu xử lý.");
        await executeScanRun(scanRunId, "telegram-approve");
      }
    }

    if (u.messageText?.trim() === "/retry") {
      // CHỈ retry kỳ 'failed' (KHÔNG đụng 'kicking' đang chạy — tránh kick chồng).
      const failed = getLatestScanRunByStatus(["failed"]);
      if (!failed) {
        await sendTelegramText("ℹ️ Không có kỳ dọn dẹp lỗi để retry.");
        continue;
      }
      await sendTelegramText(`🔁 Retry kỳ dọn dẹp #${failed.id}.`);
      await executeScanRun(failed.id, "telegram-retry");
    }
  }

  const pending = getLatestScanRunByStatus(["pending_approval"]);
  if (pending && isApprovalTimedOut(pending, now)) {
    await sendTelegramText(
      `⏰ Kỳ dọn dẹp #${pending.id} quá ${runtimeConfig.approvalTimeoutHours}h chưa phản hồi, tự động tiến hành.`,
    );
    await executeScanRun(pending.id, "telegram-timeout");
  } else if (pending) {
    console.log(`[telegram-poll] Kỳ #${pending.id} đang chờ duyệt (chưa tới hạn timeout).`);
  } else {
    console.log("[telegram-poll] Không có kỳ nào chờ duyệt. Xong.");
  }
}

/** Khóa chống 2 tiến trình kick chạy chồng (telegram-poll cron mỗi phút). */
const KICK_LOCK_KEY = "cleanup_kick_lock";
/** Lock cũ hơn mức này (ms) coi như process trước đã chết → cho phép chiếm lại.
 *  Phải > thời gian 1 batch kick: 50 người × 2 phút = 100 phút → đặt 3 giờ cho an toàn. */
const KICK_LOCK_STALE_MS = 3 * 60 * 60 * 1000;

async function executeScanRun(scanRunId: number, reason: string): Promise<void> {
  const run = getScanRun(scanRunId);
  // CHỈ chạy từ trạng thái chưa-kick. Bỏ 'kicking' khỏi danh sách: một kỳ đang kick
  // KHÔNG được phép execute lại (chống kick chồng). 'failed' để cho /retry.
  if (!run || !["pending_approval", "planned", "failed"].includes(run.status)) {
    console.log(`[monthly-cleanup] Kỳ #${scanRunId} status='${run?.status}' — không execute (đang chạy hoặc đã xong).`);
    return;
  }

  // Khóa: nếu đã có tiến trình kick khác đang chạy → bỏ qua lần này (cron sẽ thử lại sau).
  if (!acquireLock(KICK_LOCK_KEY, Date.now(), KICK_LOCK_STALE_MS)) {
    console.log("[monthly-cleanup] Đang có tiến trình kick khác chạy — bỏ qua lần này (chống kick chồng).");
    return;
  }

  try {
    const rows = listCleanupPlanItems(scanRunId).filter((x) => x.status !== "removed");
    if (rows.length === 0) {
      finishScanRun({
        id: scanRunId,
        finishedAt: Date.now(),
        status: "done",
        actualKicks: 0,
        note: `Không còn plan item để xoá (${reason}).`,
      });
      await maybeSendTelegram("✅ Không còn thành viên nào cần xoá.");
      return;
    }

    finishScanRun({
      id: scanRunId,
      finishedAt: Date.now(),
      status: "kicking",
      plannedKicks: rows.length,
      note: `Bắt đầu kick (${reason}).`,
    });

    const api = await login();
    let actual = 0;
    const removedNames: string[] = [];
    try {
      for (const c of rows) {
        await removeGroupMember(api, config.groupId, c.zalo_user_id);
        const removedAt = Date.now();
        recordRemoval({
          scanRunId,
          zaloUserId: c.zalo_user_id,
          displayName: c.display_name,
          interactionCount: c.interaction_count,
          lastInteraction: c.last_interaction,
          removedAt,
        });
        markMemberLeft(c.zalo_user_id, removedAt);
        markCleanupPlanItem({ id: c.id, status: "removed", now: removedAt });
        actual += 1;
        removedNames.push(`${c.display_name || c.zalo_user_id} (${c.interaction_count})`);
        console.log(`[monthly-cleanup] Đã xoá ${actual}/${rows.length}: ${c.display_name} (${c.zalo_user_id})`);
        // Giữ lock "tươi" trong lúc kick dài để không bị coi là stale.
        setBotState(KICK_LOCK_KEY, String(Date.now()), Date.now());
        if (actual < rows.length) await sleep(runtimeConfig.kickThrottleMs);
      }
    } catch (e) {
      const failed = rows[actual];
      if (failed) {
        markCleanupPlanItem({ id: failed.id, status: "failed", error: String(e), now: Date.now() });
      }
      const note = `E-cleanup-001: đã xoá ${actual}/${rows.length}, lỗi: ${String(e)}`;
      finishScanRun({
        id: scanRunId,
        finishedAt: Date.now(),
        status: "failed",
        memberCount: countActiveMembers(),
        plannedKicks: rows.length,
        actualKicks: actual,
        note,
      });
      await maybeSendTelegram(`❌ ${note}\nReply /retry để tiếp tục.`);
      throw new Error(note);
    }

    finishScanRun({
      id: scanRunId,
      finishedAt: Date.now(),
      status: "done",
      memberCount: countActiveMembers(),
      plannedKicks: rows.length,
      actualKicks: actual,
      note: `Đã xoá ${actual} thành viên.`,
    });
    console.log(`[monthly-cleanup] Hoàn tất. Đã xoá ${actual} thành viên.`);
    await maybeSendTelegram(
      `✅ Đã xoá ${actual} thành viên. Nhóm hiện còn ${countActiveMembers()} thành viên.\n` +
        removedNames.slice(0, 30).map((x, i) => `${i + 1}. ${x}`).join("\n"),
    );
  } finally {
    releaseLock(KICK_LOCK_KEY);
  }
}

function printList(title: string, rows: CleanupCandidate[]): void {
  console.log(`[monthly-cleanup] ${title}: ${rows.length}`);
  for (const [idx, r] of rows.slice(0, 50).entries()) {
    console.log(
      `  ${idx + 1}. ${r.zalo_user_id} "${r.display_name}" ` +
        `count=${r.interaction_count} last=${fmtTs(r.last_interaction)} (${r.reason})`,
    );
  }
  if (rows.length > 50) {
    console.log(`  ... còn ${rows.length - 50} dòng`);
  }
}

function buildApprovalText(
  scanRunId: number,
  memberCount: number,
  plan: CleanupCandidate[],
  graceCount: number,
): string {
  const rows = plan
    .slice(0, 40)
    .map(
      (x, i) =>
        `${i + 1}. ${x.display_name || x.zalo_user_id} | tương tác=${x.interaction_count} | ` +
        `lần cuối=${fmtTs(x.last_interaction)}`,
    )
    .join("\n");
  return (
    `📋 Kỳ dọn dẹp #${scanRunId}: dự kiến xoá ${plan.length} thành viên ít hoạt động nhất ` +
    `để đưa nhóm về ${runtimeConfig.targetMemberCount}.\n` +
    `Hiện có: ${memberCount}. Ân hạn kỳ này: ${graceCount}.\n` +
    `Bấm Duyệt để tiến hành, Huỷ để bỏ qua. Không phản hồi trong ` +
    `${runtimeConfig.approvalTimeoutHours}h sẽ tự động tiến hành.\n\n${rows}`
  );
}

/** Key lưu mốc gửi duyệt Telegram theo run (để tính timeout từ lúc gửi, không phải lúc tạo run). */
function approvalSentKey(scanRunId: number): string {
  return `approval_sent_at:${scanRunId}`;
}

function isApprovalTimedOut(run: ScanRunRow, now: number): boolean {
  const timeoutMs = runtimeConfig.approvalTimeoutHours * 60 * 60 * 1000;
  const sentRaw = getBotState(approvalSentKey(run.id));
  // Mốc bắt đầu đếm timeout = lúc gửi duyệt; fallback started_at nếu thiếu (an toàn).
  const baseline = sentRaw && Number.isFinite(Number(sentRaw)) ? Number(sentRaw) : run.started_at;
  return now - baseline >= timeoutMs;
}

async function maybeSendTelegram(text: string): Promise<void> {
  if (!isTelegramEnabled()) return;
  await sendTelegramText(text);
}
