import { Badge, Card, CardTitle, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { dbExists, listBotErrors, listSchemaMigrations } from "@/lib/db";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function ErrorsPage() {
  if (!dbExists()) {
    return (
      <div>
        <PageHeader title="Lỗi" />
        <EmptyState>Chưa có dữ liệu. Chạy bot trước.</EmptyState>
      </div>
    );
  }

  const errors = listBotErrors(200);
  const migrations = listSchemaMigrations(20);

  return (
    <div>
      <PageHeader title="Lỗi" desc="Lỗi vận hành gần đây và version schema đã apply." />

      <Card className="mb-6">
        <CardTitle>Schema migrations</CardTitle>
        {migrations.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">DB chưa ghi schema version.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {migrations.map((migration) => (
              <div
                key={migration.version}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] bg-[var(--color-surface-2)] px-3 py-2 text-sm"
              >
                <span className="font-mono text-xs text-[var(--color-text)]">{migration.version}</span>
                <span className="text-[var(--color-muted)]">{fmtDateTime(migration.applied_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Lỗi gần đây ({errors.length})</CardTitle>
        {errors.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">Chưa có lỗi nào được ghi.</p>
        ) : (
          <div className="mt-3">
            <Table>
              <thead>
                <tr>
                  <Th>Thời gian</Th>
                  <Th>Nguồn</Th>
                  <Th>Code</Th>
                  <Th>Lỗi</Th>
                  <Th>Chi tiết</Th>
                </tr>
              </thead>
              <tbody>
                {errors.map((error) => (
                  <tr key={error.id}>
                    <Td className="text-[var(--color-muted)]">{fmtDateTime(error.created_at)}</Td>
                    <Td>
                      <Badge tone="warn">{error.source}</Badge>
                    </Td>
                    <Td className="font-mono text-xs text-[var(--color-muted)]">{error.code || "—"}</Td>
                    <Td className="max-w-md truncate" title={error.message}>
                      {error.message}
                    </Td>
                    <Td className="max-w-md truncate text-[var(--color-muted)]" title={error.detail ?? ""}>
                      {error.detail || "—"}
                    </Td>
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
