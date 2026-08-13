import Link from "next/link";
import { Download, NotebookText, RotateCcw, Search } from "lucide-react";
import { PageHeader, EmptyState, Card, CardTitle, Button, Input, Stat, Badge } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import {
  dbExists,
  countDailySummaries,
  listDailySummaries,
  type DailySummaryFilters,
} from "@/lib/db";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const LIMIT_OPTIONS = [
  { value: "30", label: "30 ngày" },
  { value: "90", label: "90 ngày" },
  { value: "365", label: "365 ngày" },
  { value: "1000", label: "1000 ngày" },
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

function parseFilters(params: SearchParams | undefined): DailySummaryFilters & { fromRaw: string; toRaw: string } {
  const rawLimit = Number(one(params, "limit") || 30);
  const limit = [30, 90, 365, 1000].includes(rawLimit) ? rawLimit : 30;
  const fromRaw = one(params, "from");
  const toRaw = one(params, "to");
  return {
    q: one(params, "q"),
    from: parseDateMs(fromRaw),
    to: parseDateMs(toRaw, true),
    limit,
    fromRaw,
    toRaw,
  };
}

function exportHref(params: SearchParams | undefined, format: "md" | "json"): string {
  const qs = new URLSearchParams();
  for (const key of ["q", "from", "to", "limit"]) {
    const v = one(params, key);
    if (v) qs.set(key, v);
  }
  qs.set("format", format);
  return `/api/summaries/export?${qs.toString()}`;
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export default async function SummariesPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  if (!dbExists()) {
    return (
      <div>
        <PageHeader title="Tóm tắt ngày" />
        <EmptyState>Chưa có dữ liệu. Chạy bot trước.</EmptyState>
      </div>
    );
  }

  const params = await searchParams;
  const filters = parseFilters(params);
  const summaries = listDailySummaries(filters);
  const total = countDailySummaries(filters);
  const totalMessages = summaries.reduce((sum, s) => sum + (s.total_messages ?? 0), 0);
  const latest = summaries[0];

  return (
    <div>
      <PageHeader
        title="Tóm tắt ngày"
        desc="Kho lưu vĩnh viễn bản tóm tắt hằng ngày của bot — nguyên liệu tổng hợp, phân tích, viết blog."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Bản tóm tắt khớp bộ lọc" value={total} sub={`hiển thị ${summaries.length} ngày mới nhất`} />
        <Stat label="Tin nhắn đã tóm tắt" value={totalMessages} sub="tổng của các ngày đang hiển thị" />
        <Stat label="Ngày mới nhất" value={latest ? latest.day_label : "—"} sub={latest ? `lưu lúc ${fmtDateTime(latest.created_at)}` : "chưa có bản nào"} />
        <Stat
          label="Ký tự tóm tắt"
          value={summaries.reduce((sum, s) => sum + s.summary_text.length, 0)}
          sub="tổng của các ngày đang hiển thị"
        />
      </div>

      <Card className="mt-6">
        <CardTitle>Bộ lọc & export</CardTitle>
        <form
          action="/summaries"
          className="mt-4 grid gap-3 lg:grid-cols-[minmax(220px,1.5fr)_150px_150px_120px_auto_auto_auto_auto]"
        >
          <label className="relative block">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
            />
            <Input name="q" defaultValue={filters.q} placeholder="Tìm trong nội dung tóm tắt" className="pl-9" />
          </label>
          <Input name="from" type="date" defaultValue={filters.fromRaw} aria-label="Từ ngày" />
          <Input name="to" type="date" defaultValue={filters.toRaw} aria-label="Đến ngày" />
          <Select name="limit" defaultValue={String(filters.limit ?? 30)} ariaLabel="Số ngày" options={LIMIT_OPTIONS} />

          <Button type="submit" className="gap-2">
            <Search size={16} />
            Lọc
          </Button>
          <Link
            href="/summaries"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
          >
            <RotateCcw size={16} />
            Reset
          </Link>
          <a
            href={exportHref(params, "md")}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--color-primary)] px-4 text-sm font-medium text-white hover:opacity-90"
          >
            <Download size={16} />
            Markdown
          </a>
          <a
            href={exportHref(params, "json")}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
          >
            <Download size={16} />
            JSON
          </a>
        </form>
      </Card>

      {summaries.length === 0 ? (
        <div className="mt-6">
          <EmptyState>
            Chưa có bản tóm tắt nào trong kho. Bản tin sẽ được lưu tự động mỗi sáng khi cron daily-summary chạy
            (bản đang nằm trong bot_state cũng sẽ được cứu vào kho ở lần chạy kế tiếp).
          </EmptyState>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {summaries.map((s) => {
            const topSenders = parseJsonArray(s.top_senders_json);
            return (
              <Card key={s.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
                  <NotebookText size={14} />
                  <span className="text-sm font-semibold text-[var(--color-text)]">{s.day_label}</span>
                  {s.total_messages !== null ? <Badge tone="ok">{s.total_messages} tin nhắn</Badge> : null}
                  {s.unique_senders ? <Badge tone="ok">{s.unique_senders} người</Badge> : null}
                  {s.images ? <Badge tone="warn">{s.images} ảnh</Badge> : null}
                  {s.videos ? <Badge tone="warn">{s.videos} video</Badge> : null}
                  {s.model ? <span className="font-mono">{s.model}</span> : null}
                  {s.source !== "live" ? <Badge tone="warn">backfill</Badge> : null}
                  <span>lưu lúc {fmtDateTime(s.created_at)}</span>
                </div>
                {topSenders.length > 0 ? (
                  <p className="mt-2 text-xs text-[var(--color-muted)]">🔥 Sôi nổi nhất: {topSenders.join(", ")}</p>
                ) : null}
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--color-text)]">{s.summary_text}</p>
              </Card>
            );
          })}
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
