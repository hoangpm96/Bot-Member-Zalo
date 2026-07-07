import Link from "next/link";
import { Download, RotateCcw, Search } from "lucide-react";
import { Badge, Button, Card, CardTitle, EmptyState, Input, PageHeader, Table, Td, Th } from "@/components/ui";
import { countMemberEvents, dbExists, listMemberEvents, type MemberEventFilters } from "@/lib/db";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const EVENT_LABELS: Record<string, string> = {
  joined: "tham gia",
  left: "rời nhóm",
  removed: "bị xoá",
  blocked: "bị chặn",
  reactivated: "active lại",
};

const EVENT_TONES: Record<string, "ok" | "warn" | "danger" | "muted"> = {
  joined: "ok",
  reactivated: "ok",
  left: "muted",
  removed: "danger",
  blocked: "danger",
};

type SearchParams = Record<string, string | string[] | undefined>;

const EVENT_OPTIONS = [
  { value: "all", label: "Tất cả sự kiện" },
  { value: "joined", label: "Tham gia" },
  { value: "left", label: "Rời nhóm" },
  { value: "removed", label: "Bị xoá" },
  { value: "blocked", label: "Bị chặn" },
  { value: "reactivated", label: "Active lại" },
];

const SOURCE_OPTIONS = [
  { value: "all", label: "Tất cả nguồn" },
  { value: "listener", label: "Listener" },
  { value: "snapshot_sync", label: "Snapshot sync" },
  { value: "bot_cleanup", label: "Cleanup" },
  { value: "moderation", label: "Moderation" },
];

function one(params: SearchParams | undefined, key: string): string {
  const value = params?.[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function parseDateMs(value: string, endOfDay = false): number | null {
  if (!value) return null;
  const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+07:00`);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function parseFilters(params: SearchParams | undefined): MemberEventFilters & { fromRaw: string; toRaw: string } {
  const eventType = one(params, "eventType") || "all";
  const source = one(params, "source") || "all";
  const fromRaw = one(params, "from");
  const toRaw = one(params, "to");
  return {
    eventType: EVENT_OPTIONS.some((o) => o.value === eventType) ? eventType : "all",
    source: SOURCE_OPTIONS.some((o) => o.value === source) ? source : "all",
    from: parseDateMs(fromRaw),
    to: parseDateMs(toRaw, true),
    limit: 300,
    fromRaw,
    toRaw,
  };
}

function exportHref(params: SearchParams | undefined): string {
  const qs = new URLSearchParams();
  for (const key of ["eventType", "source", "from", "to"]) {
    const v = one(params, key);
    if (v) qs.set(key, v);
  }
  return `/api/member-events/export${qs.toString() ? `?${qs.toString()}` : ""}`;
}

export default async function MemberEventsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  if (!dbExists()) {
    return (
      <div>
        <PageHeader title="Sự kiện TV" />
        <EmptyState>Chưa có dữ liệu. Chạy bot trước.</EmptyState>
      </div>
    );
  }

  const params = await searchParams;
  const filters = parseFilters(params);
  const events = listMemberEvents(filters);
  const total = countMemberEvents(filters);

  return (
    <div>
      <PageHeader title="Sự kiện TV" desc={`Có ${total} sự kiện khớp bộ lọc, hiển thị ${events.length} dòng mới nhất.`} />

      <Card className="mb-6">
        <CardTitle>Bộ lọc</CardTitle>
        <form action="/events" className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_150px_150px_auto_auto_auto]">
          <Select name="eventType" defaultValue={filters.eventType ?? "all"} ariaLabel="Loại sự kiện" options={EVENT_OPTIONS} />
          <Select name="source" defaultValue={filters.source ?? "all"} ariaLabel="Nguồn" options={SOURCE_OPTIONS} />
          <Input name="from" type="date" defaultValue={filters.fromRaw} aria-label="Từ ngày" />
          <Input name="to" type="date" defaultValue={filters.toRaw} aria-label="Đến ngày" />
          <Button type="submit" className="gap-2">
            <Search size={16} />
            Lọc
          </Button>
          <Link
            href="/events"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
          >
            <RotateCcw size={16} />
            Reset
          </Link>
          <a
            href={exportHref(params)}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--color-primary)] px-4 text-sm font-medium text-white hover:opacity-90"
          >
            <Download size={16} />
            CSV
          </a>
        </form>
      </Card>

      {events.length === 0 ? (
        <EmptyState>Chưa có sự kiện thành viên nào.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Thời gian</Th>
              <Th>Sự kiện</Th>
              <Th>Tên</Th>
              <Th>Nguồn</Th>
              <Th>Ghi chú</Th>
              <Th>ID</Th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <Td className="text-[var(--color-muted)]">{fmtDateTime(event.ts)}</Td>
                <Td>
                  <Badge tone={EVENT_TONES[event.event_type] ?? "default"}>
                    {EVENT_LABELS[event.event_type] ?? event.event_type}
                  </Badge>
                </Td>
                <Td className="font-medium">{event.display_name || "(không tên)"}</Td>
                <Td className="text-[var(--color-muted)]">{event.source}</Td>
                <Td className="max-w-sm truncate text-[var(--color-muted)]" title={event.note ?? ""}>
                  {event.note || "—"}
                </Td>
                <Td className="font-mono text-xs text-[var(--color-muted)]">{event.zalo_user_id}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
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
  defaultValue: string;
  ariaLabel: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      aria-label={ariaLabel}
      className="h-9 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
