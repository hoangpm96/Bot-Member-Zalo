import { PageHeader, Table, Th, Td, Badge, EmptyState } from "@/components/ui";
import { fmtAgo, fmtDateTime } from "@/lib/utils";
import { dbExists, listMemberStats } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function MembersPage() {
  if (!dbExists()) {
    return (
      <div>
        <PageHeader title="Thành viên" />
        <EmptyState>Chưa có dữ liệu. Chạy bot trước.</EmptyState>
      </div>
    );
  }

  const members = listMemberStats(2000);

  return (
    <div>
      <PageHeader
        title="Thành viên"
        desc={`${members.length} thành viên đang hoạt động — sắp theo ít tương tác nhất (đầu danh sách dễ bị kick nhất).`}
      />
      <Table>
        <thead>
          <tr>
            <Th className="w-12">#</Th>
            <Th>Tên</Th>
            <Th>Vai trò</Th>
            <Th className="text-right">Lượt tương tác</Th>
            <Th>Lần cuối</Th>
            <Th>ID</Th>
          </tr>
        </thead>
        <tbody>
          {members.map((m, i) => (
            <tr key={m.zalo_user_id}>
              <Td className="text-[var(--color-muted)]">{i + 1}</Td>
              <Td className="font-medium">{m.display_name || "(không tên)"}</Td>
              <Td>
                {m.role === "owner" ? (
                  <Badge tone="danger">owner</Badge>
                ) : m.role === "admin" ? (
                  <Badge tone="warn">admin</Badge>
                ) : (
                  <Badge tone="muted">thành viên</Badge>
                )}
              </Td>
              <Td className="text-right">
                {m.interaction_count === 0 ? (
                  <Badge tone="danger">0</Badge>
                ) : (
                  <span>{m.interaction_count}</span>
                )}
              </Td>
              <Td>
                <span title={fmtDateTime(m.last_interaction)} className="text-[var(--color-muted)]">
                  {fmtAgo(m.last_interaction)}
                </span>
              </Td>
              <Td className="font-mono text-xs text-[var(--color-muted)]">{m.zalo_user_id}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
