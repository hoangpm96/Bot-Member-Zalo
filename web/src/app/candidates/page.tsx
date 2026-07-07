import { Badge, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { buildOverTargetCandidatePlan, dbExists, getLatestCleanupDraftComparison } from "@/lib/db";
import { readConfig } from "@/lib/config";
import { CONFIG_DEFAULTS } from "@/lib/config-meta";
import { readVip } from "@/lib/vip";
import { fmtAgo, fmtDateTime } from "@/lib/utils";
import { SaveDraftButton } from "./save-draft-button";

export const dynamic = "force-dynamic";

export default function CandidatesPage() {
  if (!dbExists()) {
    return (
      <div>
        <PageHeader title="Ứng viên" />
        <EmptyState>Chưa có dữ liệu. Chạy bot trước.</EmptyState>
      </div>
    );
  }

  const cfg = readConfig();
  const target = cfg.targetMemberCount ?? CONFIG_DEFAULTS.targetMemberCount;
  const maxKicks = cfg.maxKicksPerRun ?? CONFIG_DEFAULTS.maxKicksPerRun;
  const vipIds = readVip().map((entry) => entry.id);
  const plan = buildOverTargetCandidatePlan({ target, maxKicks, vipIds });
  const latestDraft = getLatestCleanupDraftComparison();

  return (
    <div>
      <PageHeader
        title="Ứng viên"
        desc={`Xếp hạng thành viên thường, không VIP, không phải người mới trong tháng hiện tại.`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Thành viên active" value={plan.total} sub={`target ${plan.target}`} />
        <Stat label="Vượt target" value={plan.overTarget} sub={plan.overTarget > 0 ? "cần xử lý" : "không vượt"} />
        <Stat label="Trần kỳ này" value={plan.maxKicks} sub={`${plan.needToReview} người trong phạm vi`} />
        <Stat label="Có thể xoá" value={plan.removableCount} sub={`${plan.graceCount} người sẽ ân hạn`} />
        <Stat label="Đủ điều kiện" value={plan.eligibleCount} sub={`${vipIds.length} VIP được loại trừ`} />
      </div>

      <div className="mt-6 flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <SaveDraftButton />
        {latestDraft ? (
          <p className="text-sm text-[var(--color-muted)]">
            Plan nháp gần nhất #{latestDraft.plan.id} lúc {fmtDateTime(latestDraft.plan.created_at)}:
            {" "}
            {latestDraft.stillActive} còn active, {latestDraft.noLongerActive} đã rời/không active,
            {" "}
            {latestDraft.interactedMore} đã có thêm tương tác.
          </p>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">Chưa có plan nháp nào.</p>
        )}
      </div>

      {plan.candidates.length === 0 ? (
        <div className="mt-6">
          <EmptyState>Nhóm hiện không vượt target hoặc chưa có ứng viên trong phạm vi cần xử lý.</EmptyState>
        </div>
      ) : (
        <div className="mt-6">
          <Table>
            <thead>
              <tr>
                <Th className="w-12">#</Th>
                <Th>Tên</Th>
                <Th>Dự kiến</Th>
                <Th className="text-right">Tương tác</Th>
                <Th>Lần cuối</Th>
                <Th>Cảnh báo</Th>
                <Th>Lý do</Th>
                <Th>ID</Th>
              </tr>
            </thead>
            <tbody>
              {plan.candidates.map((candidate) => (
                <tr key={candidate.zalo_user_id}>
                  <Td className="text-[var(--color-muted)]">{candidate.rank}</Td>
                  <Td className="font-medium">{candidate.display_name || "(không tên)"}</Td>
                  <Td>
                    {candidate.action === "grace" ? (
                      <Badge tone="warn">ân hạn</Badge>
                    ) : (
                      <Badge tone="danger">xoá</Badge>
                    )}
                  </Td>
                  <Td className="text-right">{candidate.interaction_count}</Td>
                  <Td>
                    <span title={fmtDateTime(candidate.last_interaction)} className="text-[var(--color-muted)]">
                      {fmtAgo(candidate.last_interaction)}
                    </span>
                  </Td>
                  <Td>
                    {candidate.warning_count > 0 ? (
                      <span title={fmtDateTime(candidate.last_warned_at)}>
                        <Badge tone="warn">{candidate.warning_count}</Badge>
                      </span>
                    ) : (
                      <span className="text-[var(--color-muted)]">—</span>
                    )}
                  </Td>
                  <Td className="text-[var(--color-muted)]">{candidate.reason}</Td>
                  <Td className="font-mono text-xs text-[var(--color-muted)]">{candidate.zalo_user_id}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
