import { PageHeader, Table, Th, Td, Card, CardTitle, EmptyState, RunStatusBadge } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { dbExists, listRemovals, listScanRuns } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function HistoryPage() {
  if (!dbExists()) {
    return (
      <div>
        <PageHeader title="Lịch sử dọn" />
        <EmptyState>Chưa có dữ liệu. Chạy bot trước.</EmptyState>
      </div>
    );
  }

  const removals = listRemovals(500);
  const runs = listScanRuns(100);

  return (
    <div>
      <PageHeader title="Lịch sử dọn" desc="Các kỳ quét và những thành viên đã bị xoá." />

      <Card className="mb-8">
        <CardTitle>Các kỳ dọn ({runs.length})</CardTitle>
        {runs.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">Chưa có kỳ nào.</p>
        ) : (
          <div className="mt-3">
            <Table>
              <thead>
                <tr>
                  <Th className="w-12">#</Th>
                  <Th>Trạng thái</Th>
                  <Th>Bắt đầu</Th>
                  <Th className="text-right">Đã kick</Th>
                  <Th>Ghi chú</Th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <Td className="text-[var(--color-muted)]">{r.id}</Td>
                    <Td>
                      <RunStatusBadge status={r.status} />
                    </Td>
                    <Td className="text-[var(--color-muted)]">{fmtDateTime(r.started_at)}</Td>
                    <Td className="text-right">{r.actual_kicks ?? 0}</Td>
                    <Td className="max-w-md truncate text-[var(--color-muted)]" title={r.note ?? ""}>
                      {r.note ?? "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Thành viên đã bị xoá ({removals.length})</CardTitle>
        {removals.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">Chưa xoá ai.</p>
        ) : (
          <div className="mt-3">
            <Table>
              <thead>
                <tr>
                  <Th>Tên</Th>
                  <Th className="text-right">Tương tác lúc xoá</Th>
                  <Th>Thời điểm xoá</Th>
                  <Th>Kỳ</Th>
                  <Th>ID</Th>
                </tr>
              </thead>
              <tbody>
                {removals.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium">{r.display_name || "(không tên)"}</Td>
                    <Td className="text-right">{r.interaction_count}</Td>
                    <Td className="text-[var(--color-muted)]">{fmtDateTime(r.removed_at)}</Td>
                    <Td className="text-[var(--color-muted)]">#{r.scan_run_id ?? "—"}</Td>
                    <Td className="font-mono text-xs text-[var(--color-muted)]">{r.zalo_user_id}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
