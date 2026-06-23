import Link from "next/link";
import { RotateCcw, Search } from "lucide-react";
import {
  PageHeader,
  Table,
  Th,
  Td,
  Badge,
  EmptyState,
  Card,
  CardTitle,
  Button,
  Input,
  Stat,
} from "@/components/ui";
import { fmtAgo, fmtDateTime } from "@/lib/utils";
import {
  dbExists,
  listMemberStatsFiltered,
  summarizeMemberStats,
  type MemberActivityFilter,
  type MemberFilters,
  type MemberRoleFilter,
  type MemberSort,
} from "@/lib/db";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const ROLE_OPTIONS: { value: MemberRoleFilter; label: string }[] = [
  { value: "all", label: "Tất cả vai trò" },
  { value: "member", label: "Thành viên thường" },
  { value: "admin", label: "Admin" },
  { value: "owner", label: "Owner" },
];

const ACTIVITY_OPTIONS: { value: MemberActivityFilter; label: string }[] = [
  { value: "all", label: "Tất cả tương tác" },
  { value: "zero", label: "0 tương tác" },
  { value: "never", label: "Chưa từng tương tác" },
  { value: "recent", label: "Có tương tác 30 ngày" },
  { value: "inactive30", label: "Im 30+ ngày" },
  { value: "inactive90", label: "Im 90+ ngày" },
  { value: "warned", label: "Đã cảnh báo" },
];

const SORT_OPTIONS: { value: MemberSort; label: string }[] = [
  { value: "risk", label: "Rủi ro bị kick" },
  { value: "interactions", label: "Tương tác nhiều nhất" },
  { value: "last", label: "Lâu không tương tác" },
  { value: "warnings", label: "Cảnh báo nhiều nhất" },
  { value: "name", label: "Tên A-Z" },
  { value: "joined", label: "Mới tham gia" },
];

const LIMIT_OPTIONS = [
  { value: "100", label: "100 dòng" },
  { value: "250", label: "250 dòng" },
  { value: "500", label: "500 dòng" },
  { value: "1000", label: "1000 dòng" },
];

function one(params: SearchParams | undefined, key: string): string {
  const value = params?.[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function parseFilters(params: SearchParams | undefined): MemberFilters {
  const role = one(params, "role");
  const activity = one(params, "activity");
  const sort = one(params, "sort");
  const rawLimit = Number(one(params, "limit") || 1000);
  const limit = [100, 250, 500, 1000].includes(rawLimit) ? rawLimit : 1000;

  return {
    q: one(params, "q"),
    role: ROLE_OPTIONS.some((o) => o.value === role) ? (role as MemberRoleFilter) : "all",
    activity: ACTIVITY_OPTIONS.some((o) => o.value === activity) ? (activity as MemberActivityFilter) : "all",
    sort: SORT_OPTIONS.some((o) => o.value === sort) ? (sort as MemberSort) : "risk",
    limit,
  };
}

export default async function MembersPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  if (!dbExists()) {
    return (
      <div>
        <PageHeader title="Thành viên" />
        <EmptyState>Chưa có dữ liệu. Chạy bot trước.</EmptyState>
      </div>
    );
  }

  const params = await searchParams;
  const filters = parseFilters(params);
  const members = listMemberStatsFiltered(filters);
  const summary = summarizeMemberStats(filters);

  return (
    <div>
      <PageHeader
        title="Thành viên"
        desc={`${summary.total} thành viên khớp bộ lọc — hiển thị ${members.length} dòng đầu tiên.`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat
          label="Khớp bộ lọc"
          value={summary.total}
          sub={`${summary.member} thường · ${summary.admin + summary.owner} miễn kick`}
        />
        <Stat
          label="0 tương tác"
          value={summary.zero_interactions}
          sub={`${summary.never_interacted} người chưa từng có log`}
        />
        <Stat
          label="Im 30+ ngày"
          value={summary.inactive_30d}
          sub={`${summary.inactive_90d} người im 90+ ngày`}
        />
        <Stat label="Đã cảnh báo" value={summary.warned} sub={`${summary.removable_candidates} ứng viên kỳ sau`} />
        <Stat label="Tổng tương tác" value={summary.total_interactions} sub="trong nhóm đang lọc" />
      </div>

      <Card className="mt-6">
        <CardTitle>Bộ lọc</CardTitle>
        <form
          action="/members"
          className="mt-4 grid gap-3 lg:grid-cols-[minmax(220px,1.4fr)_1fr_1fr_1fr_120px_auto_auto]"
        >
          <label className="relative block">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
            />
            <Input
              name="q"
              defaultValue={filters.q}
              placeholder="Tìm tên hoặc Zalo ID"
              className="pl-9"
              aria-label="Tìm tên hoặc Zalo ID"
            />
          </label>

          <Select name="role" defaultValue={filters.role} ariaLabel="Lọc vai trò" options={ROLE_OPTIONS} />
          <Select
            name="activity"
            defaultValue={filters.activity}
            ariaLabel="Lọc tương tác"
            options={ACTIVITY_OPTIONS}
          />
          <Select name="sort" defaultValue={filters.sort} ariaLabel="Sắp xếp" options={SORT_OPTIONS} />
          <Select
            name="limit"
            defaultValue={String(filters.limit ?? 1000)}
            ariaLabel="Số dòng hiển thị"
            options={LIMIT_OPTIONS}
          />

          <Button type="submit" className="gap-2">
            <Search size={16} />
            Lọc
          </Button>
          <Link
            href="/members"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
          >
            <RotateCcw size={16} />
            Reset
          </Link>
        </form>
      </Card>

      {members.length === 0 ? (
        <div className="mt-6">
          <EmptyState>Không có thành viên nào khớp bộ lọc hiện tại.</EmptyState>
        </div>
      ) : (
        <div className="mt-6">
          <Table>
            <thead>
              <tr>
                <Th className="w-12">#</Th>
                <Th>Tên</Th>
                <Th>Vai trò</Th>
                <Th className="text-right">Lượt tương tác</Th>
                <Th>Lần cuối</Th>
                <Th>Cảnh báo</Th>
                <Th>Thấy lần đầu</Th>
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
                  <Td>
                    {m.warning_count > 0 ? (
                      <span title={fmtDateTime(m.last_warned_at)}>
                        <Badge tone="warn">{m.warning_count}</Badge>
                      </span>
                    ) : (
                      <span className="text-[var(--color-muted)]">—</span>
                    )}
                  </Td>
                  <Td>
                    <span title={fmtDateTime(m.first_seen_at)} className="text-[var(--color-muted)]">
                      {fmtAgo(m.first_seen_at)}
                    </span>
                  </Td>
                  <Td className="font-mono text-xs text-[var(--color-muted)]">{m.zalo_user_id}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}

function Select({
  name,
  defaultValue,
  ariaLabel,
  options,
}: {
  name: string;
  defaultValue: string | undefined;
  ariaLabel: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      aria-label={ariaLabel}
      className="h-9 w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
