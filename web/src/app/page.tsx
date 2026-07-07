import { LayoutDashboard } from "lucide-react";
import fs from "node:fs";
import { Stat, PageHeader, Card, CardTitle, EmptyState, RunStatusBadge } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import {
  dbExists,
  countActiveMembers,
  countByRole,
  countInteractions,
  listScanRuns,
  getState,
  getLatestMemberSyncRun,
  getBotHealth,
  getPermissionCheckStatus,
  isBotHealthFresh,
} from "@/lib/db";
import { readConfig } from "@/lib/config";
import { CONFIG_DEFAULTS } from "@/lib/config-meta";
import { memberSyncRequestPath, permissionCheckRequestPath } from "@/lib/login-status";
import { SyncMembersCard } from "./sync-members-card";
import { BotHealthCard } from "./bot-health-card";
import { PermissionCheckCard } from "./permission-check-card";

export const dynamic = "force-dynamic";

const WARMUP_KEY = "warmup_started_at";

function warmupInfo(warmupDays: number): { collected: number; remaining: number; startedAt: number | null } {
  const raw = getState(WARMUP_KEY);
  if (!raw) return { collected: 0, remaining: warmupDays, startedAt: null };
  const startedAt = Number(raw);
  const collected = Math.floor((Date.now() - startedAt) / 86400000);
  return { collected, remaining: Math.max(0, warmupDays - collected), startedAt };
}

export default function DashboardPage() {
  if (!dbExists()) {
    return (
      <div>
        <PageHeader title="Tổng quan" desc="Bảng điều khiển bot dọn thành viên group Zalo" />
        <EmptyState>
          Chưa tìm thấy dữ liệu bot. Hãy chạy bot (<code>npm start</code> trong thư mục <code>bot/</code>)
          ít nhất một lần để tạo cơ sở dữ liệu.
        </EmptyState>
      </div>
    );
  }

  const total = countActiveMembers();
  const roles = countByRole();
  const interactions = countInteractions();
  const cfg = readConfig();
  const target = cfg.targetMemberCount ?? CONFIG_DEFAULTS.targetMemberCount;
  const warmupDays = cfg.warmupDays ?? CONFIG_DEFAULTS.warmupDays;
  const warmup = warmupInfo(warmupDays);
  const overTarget = Math.max(0, total - target);
  const runs = listScanRuns(5);
  const latestSync = getLatestMemberSyncRun() ?? null;
  const syncPending = fs.existsSync(memberSyncRequestPath());
  const health = getBotHealth();
  const botFresh = isBotHealthFresh(health);
  const permission = getPermissionCheckStatus();
  const permissionPending = fs.existsSync(permissionCheckRequestPath());

  return (
    <div>
      <PageHeader title="Tổng quan" desc="Bảng điều khiển bot dọn thành viên group Zalo" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Thành viên đang có" value={total} sub={`${roles.member} thường · ${roles.admin} admin · ${roles.owner} owner`} />
        <Stat label="Mục tiêu giữ lại" value={target} sub={overTarget > 0 ? `vượt ${overTarget} người` : "đang ở/ dưới mục tiêu"} />
        <Stat
          label="Giai đoạn làm nóng"
          value={warmup.remaining > 0 ? `còn ${warmup.remaining} ngày` : "đã xong"}
          sub={warmup.startedAt ? `đã thu thập ${warmup.collected}/${warmupDays} ngày` : "chưa bắt đầu (bot chưa chạy)"}
        />
        <Stat label="Tổng lượt tương tác đã ghi" value={interactions} sub="chat + reaction + vote" />
      </div>

      <div className="mt-8">
        <SyncMembersCard initialLatest={latestSync} initialPending={syncPending} botReady={botFresh} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <BotHealthCard health={health} />
        <PermissionCheckCard initialLatest={permission} initialPending={permissionPending} botReady={botFresh} />
      </div>

      <div className="mt-8">
        <Card>
          <CardTitle>Các kỳ dọn gần nhất</CardTitle>
          {runs.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-muted)]">Chưa có kỳ dọn nào.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {runs.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-[var(--radius)] bg-[var(--color-surface-2)] px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[var(--color-muted)]">#{r.id}</span>
                    <RunStatusBadge status={r.status} />
                    <span className="text-[var(--color-muted)]">{fmtDateTime(r.started_at)}</span>
                  </div>
                  <div className="text-[var(--color-muted)]">
                    {r.actual_kicks ?? 0} kick / {r.member_count ?? "—"} thành viên
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6 flex items-center gap-2 text-xs text-[var(--color-muted)]">
        <LayoutDashboard size={14} />
        Panel chỉ đọc dữ liệu + chỉnh cấu hình. Mọi thao tác Zalo (kick, cảnh báo) do bot thực hiện.
      </div>
    </div>
  );
}
