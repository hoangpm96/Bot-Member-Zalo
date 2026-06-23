import Link from "next/link";
import { Download, MessageSquare, RotateCcw, Search } from "lucide-react";
import { PageHeader, EmptyState, Card, CardTitle, Button, Input, Stat, Badge } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { dbExists, countGroupMessages, listGroupMessages, type MessageFilters } from "@/lib/db";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const SELF_OPTIONS = [
  { value: "all", label: "Tất cả" },
  { value: "member", label: "Member gửi" },
  { value: "self", label: "Bot/self gửi" },
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

function parseDateMs(value: string, endOfDay = false): number | null {
  if (!value) return null;
  const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+07:00`);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function parseFilters(params: SearchParams | undefined): MessageFilters & { fromRaw: string; toRaw: string } {
  const rawLimit = Number(one(params, "limit") || 100);
  const limit = [100, 250, 500, 1000].includes(rawLimit) ? rawLimit : 100;
  const self = one(params, "self");
  const fromRaw = one(params, "from");
  const toRaw = one(params, "to");

  return {
    q: one(params, "q"),
    from: parseDateMs(fromRaw),
    to: parseDateMs(toRaw, true),
    self: self === "self" || self === "member" ? self : "all",
    limit,
    fromRaw,
    toRaw,
  };
}

function exportHref(params: SearchParams | undefined): string {
  const qs = new URLSearchParams();
  for (const key of ["q", "from", "to", "self", "limit"]) {
    const v = one(params, key);
    if (v) qs.set(key, v);
  }
  return `/api/messages/export${qs.toString() ? `?${qs.toString()}` : ""}`;
}

export default async function MessagesPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  if (!dbExists()) {
    return (
      <div>
        <PageHeader title="Tin nhắn" />
        <EmptyState>Chưa có dữ liệu. Chạy bot trước.</EmptyState>
      </div>
    );
  }

  const params = await searchParams;
  const filters = parseFilters(params);
  const messages = listGroupMessages(filters);
  const total = countGroupMessages(filters);

  return (
    <div>
      <PageHeader
        title="Tin nhắn"
        desc="Text message đã lưu từ group để export và tổng hợp nội dung sau này."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="Tin nhắn khớp bộ lọc" value={total} sub={`hiển thị ${messages.length} dòng mới nhất`} />
        <Stat label="Self trong trang" value={messages.filter((m) => m.is_self).length} sub="tin do tài khoản bot gửi" />
        <Stat label="Nguồn" value="listener" sub="chỉ lưu text message trong group" />
      </div>

      <Card className="mt-6">
        <CardTitle>Bộ lọc</CardTitle>
        <form
          action="/messages"
          className="mt-4 grid gap-3 lg:grid-cols-[minmax(220px,1.5fr)_150px_150px_150px_120px_auto_auto_auto]"
        >
          <label className="relative block">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
            />
            <Input name="q" defaultValue={filters.q} placeholder="Tìm nội dung, tên hoặc ID" className="pl-9" />
          </label>
          <Input name="from" type="date" defaultValue={filters.fromRaw} aria-label="Từ ngày" />
          <Input name="to" type="date" defaultValue={filters.toRaw} aria-label="Đến ngày" />
          <Select name="self" defaultValue={filters.self ?? "all"} ariaLabel="Người gửi" options={SELF_OPTIONS} />
          <Select name="limit" defaultValue={String(filters.limit ?? 100)} ariaLabel="Số dòng" options={LIMIT_OPTIONS} />

          <Button type="submit" className="gap-2">
            <Search size={16} />
            Lọc
          </Button>
          <Link
            href="/messages"
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

      {messages.length === 0 ? (
        <div className="mt-6">
          <EmptyState>Chưa có tin nhắn text nào khớp bộ lọc. Tin mới sẽ xuất hiện sau khi listener restart với bản code mới.</EmptyState>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {messages.map((m) => (
            <Card key={m.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
                <MessageSquare size={14} />
                <span className="font-medium text-[var(--color-text)]">{m.display_name || "(không tên)"}</span>
                <span>{fmtDateTime(m.ts)}</span>
                {m.is_self ? <Badge tone="warn">self</Badge> : null}
                <span className="font-mono">{m.zalo_user_id}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--color-text)]">{m.text}</p>
            </Card>
          ))}
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
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
