import { Card, CardTitle, EmptyState, PageHeader, RunStatusBadge, Stat } from "@/components/ui";
import { dbExists, getLatestPlanRun, listCleanupPlanItems } from "@/lib/db";
import { fmtDateTime } from "@/lib/utils";
import { CleanupPlanTable } from "./cleanup-plan-table";

export const dynamic = "force-dynamic";

export default function CleanupPlanPage() {
  if (!dbExists()) {
    return (
      <div>
        <PageHeader title="Duyệt DS" />
        <EmptyState>Chưa có dữ liệu. Chạy bot trước.</EmptyState>
      </div>
    );
  }

  const run = getLatestPlanRun();
  const items = run ? listCleanupPlanItems(run.id) : [];
  const planned = items.filter((item) => item.status === "planned" || item.status === "failed").length;
  const skipped = items.filter((item) => item.status === "skipped").length;

  return (
    <div>
      <PageHeader title="Duyệt DS" desc="Bỏ chọn từng người trước khi bấm Duyệt trên Telegram." />

      {!run ? (
        <EmptyState>Chưa có cleanup plan nào.</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Kỳ" value={`#${run.id}`} sub={fmtDateTime(run.started_at)} />
            <Stat label="Trạng thái" value={<RunStatusBadge status={run.status} />} sub={`${run.member_count ?? "—"} thành viên`} />
            <Stat label="Sẽ xoá" value={planned} sub="planned/failed" />
            <Stat label="Bỏ qua" value={skipped} sub="không execute" />
          </div>

          <Card className="mt-6">
            <CardTitle>Danh sách plan ({items.length})</CardTitle>
            <div className="mt-3">
              <CleanupPlanTable initialItems={items} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
