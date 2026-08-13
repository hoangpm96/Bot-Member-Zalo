import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, NotebookText, Search, X } from "lucide-react";
import { PageHeader, EmptyState, Card, CardTitle, Button, Input, Badge } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import {
  dbExists,
  getDailySummaryByDate,
  listDailySummaries,
  listDailySummaryDays,
  type DailySummaryDayRow,
} from "@/lib/db";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function one(params: SearchParams | undefined, key: string): string {
  const value = params?.[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/** Trích đoạn quanh vị trí khớp từ khoá — cho danh sách kết quả tìm kiếm. */
function snippetAround(text: string, q: string, radius = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const idx = flat.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return flat.slice(0, radius * 2) + (flat.length > radius * 2 ? "…" : "");
  const start = Math.max(0, idx - radius);
  const end = Math.min(flat.length, idx + q.length + radius);
  return (start > 0 ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "");
}

function dayHref(dayDate: string, q?: string): string {
  const qs = new URLSearchParams({ day: dayDate });
  if (q) qs.set("q", q);
  return `/summaries?${qs.toString()}`;
}

function dayStats(day: DailySummaryDayRow): string {
  const parts: string[] = [];
  if (day.total_messages !== null) parts.push(`${day.total_messages} tin`);
  if (day.unique_senders) parts.push(`${day.unique_senders} người`);
  return parts.join(" · ");
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
  const q = one(params, "q").trim();
  const dayParam = one(params, "day");

  const days = listDailySummaryDays();
  if (days.length === 0) {
    return (
      <div>
        <PageHeader title="Tóm tắt ngày" />
        <EmptyState>
          Chưa có bản tóm tắt nào trong kho. Bản tin sẽ được lưu tự động mỗi sáng khi cron daily-summary chạy;
          quá khứ bù bằng lệnh backfill-summaries trên server.
        </EmptyState>
      </div>
    );
  }

  const selectedDate =
    /^\d{4}-\d{2}-\d{2}$/.test(dayParam) && days.some((d) => d.day_date === dayParam)
      ? dayParam
      : days[0].day_date;
  const selected = getDailySummaryByDate(selectedDate);
  const selectedIdx = days.findIndex((d) => d.day_date === selectedDate);
  // days sắp mới → cũ: "hôm trước" nằm SAU trong mảng, "hôm sau" nằm TRƯỚC.
  const olderDay = selectedIdx >= 0 ? days[selectedIdx + 1] : undefined;
  const newerDay = selectedIdx > 0 ? days[selectedIdx - 1] : undefined;

  const searchResults = q ? listDailySummaries({ q, limit: 60 }) : [];
  const topSenders = selected ? parseJsonArray(selected.top_senders_json) : [];
  const totalMessages = days.reduce((sum, d) => sum + (d.total_messages ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Tóm tắt ngày"
        desc={`Kho lưu ${days.length} ngày (${days[days.length - 1].day_label} → ${days[0].day_label}) · ${totalMessages} tin nhắn đã tóm tắt.`}
      />

      {/* Thanh điều hướng ngày + tìm kiếm: dạng cột trên mobile, 1 hàng trên desktop. */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <form action="/summaries" className="flex min-w-0 flex-1 items-center gap-2">
            {q ? <input type="hidden" name="q" value={q} /> : null}
            <Link
              href={olderDay ? dayHref(olderDay.day_date, q) : "#"}
              aria-disabled={!olderDay}
              aria-label="Ngày trước đó"
              className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] border border-[var(--color-border)] ${
                olderDay
                  ? "text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
                  : "pointer-events-none text-[var(--color-muted)] opacity-40"
              }`}
            >
              <ChevronLeft size={16} />
            </Link>
            <select
              name="day"
              defaultValue={selectedDate}
              aria-label="Chọn ngày"
              className="h-9 min-w-0 flex-1 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            >
              {days.map((d) => (
                <option key={d.day_date} value={d.day_date}>
                  {d.day_label}
                  {dayStats(d) ? ` — ${dayStats(d)}` : ""}
                </option>
              ))}
            </select>
            <Button type="submit" className="shrink-0 px-3">
              Xem
            </Button>
            <Link
              href={newerDay ? dayHref(newerDay.day_date, q) : "#"}
              aria-disabled={!newerDay}
              aria-label="Ngày kế tiếp"
              className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] border border-[var(--color-border)] ${
                newerDay
                  ? "text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
                  : "pointer-events-none text-[var(--color-muted)] opacity-40"
              }`}
            >
              <ChevronRight size={16} />
            </Link>
          </form>

          <form action="/summaries" className="flex min-w-0 flex-1 items-center gap-2">
            <input type="hidden" name="day" value={selectedDate} />
            <label className="relative block min-w-0 flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
              />
              <Input name="q" defaultValue={q} placeholder="Tìm trong mọi bản tóm tắt" className="pl-9" />
            </label>
            <Button type="submit" variant="ghost" className="shrink-0 px-3" aria-label="Tìm">
              <Search size={16} />
            </Button>
            {q ? (
              <Link
                href={dayHref(selectedDate)}
                aria-label="Xoá tìm kiếm"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
              >
                <X size={16} />
              </Link>
            ) : null}
          </form>
        </div>
      </Card>

      {q ? (
        <Card className="mt-4 p-4">
          <CardTitle>
            Kết quả tìm “{q}” — {searchResults.length} ngày khớp
          </CardTitle>
          {searchResults.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-muted)]">Không ngày nào chứa từ khoá này.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {searchResults.map((r) => (
                <Link
                  key={r.day_date}
                  href={dayHref(r.day_date, q)}
                  className={`rounded-[var(--radius)] border px-3 py-2 text-sm transition-colors hover:bg-[var(--color-surface-2)] ${
                    r.day_date === selectedDate
                      ? "border-[var(--color-primary)]"
                      : "border-[var(--color-border)]"
                  }`}
                >
                  <span className="font-medium text-[var(--color-text)]">{r.day_label}</span>
                  {r.total_messages !== null ? (
                    <span className="ml-2 text-xs text-[var(--color-muted)]">{r.total_messages} tin</span>
                  ) : null}
                  <p className="mt-1 break-words text-xs leading-5 text-[var(--color-muted)]">
                    {snippetAround(r.summary_text, q)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Danh sách ngày: chỉ desktop — mobile đã có dropdown + nút chuyển ngày. */}
        <Card className="hidden self-start p-2 lg:block">
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            {days.map((d) => (
              <Link
                key={d.day_date}
                href={dayHref(d.day_date, q)}
                className={`flex items-baseline justify-between gap-2 rounded-[var(--radius)] px-3 py-2 text-sm transition-colors hover:bg-[var(--color-surface-2)] ${
                  d.day_date === selectedDate
                    ? "bg-[var(--color-surface-2)] font-semibold text-[var(--color-text)]"
                    : "text-[var(--color-muted)]"
                }`}
              >
                <span>{d.day_label}</span>
                <span className="shrink-0 text-xs">{dayStats(d)}</span>
              </Link>
            ))}
          </div>
        </Card>

        {/* Chi tiết ngày được chọn. */}
        <div className="min-w-0">
          {!selected ? (
            <EmptyState>Không đọc được bản tóm tắt của ngày này.</EmptyState>
          ) : (
            <Card className="p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <NotebookText size={16} className="text-[var(--color-muted)]" />
                <h2 className="text-base font-semibold text-[var(--color-text)]">{selected.day_label}</h2>
                {selected.total_messages !== null ? (
                  <Badge tone="ok">{selected.total_messages} tin nhắn</Badge>
                ) : null}
                {selected.unique_senders ? <Badge tone="ok">{selected.unique_senders} người</Badge> : null}
                {selected.images ? <Badge tone="warn">{selected.images} ảnh</Badge> : null}
                {selected.videos ? <Badge tone="warn">{selected.videos} video</Badge> : null}
                {selected.source !== "live" ? <Badge tone="muted">backfill</Badge> : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted)]">
                <span>lưu lúc {fmtDateTime(selected.created_at)}</span>
                {selected.model ? <span className="font-mono">{selected.model}</span> : null}
              </div>
              {topSenders.length > 0 ? (
                <p className="mt-2 text-xs text-[var(--color-muted)]">🔥 Sôi nổi nhất: {topSenders.join(", ")}</p>
              ) : null}

              <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--color-text)]">
                {selected.summary_text}
              </p>

              <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-4">
                <ExportLink
                  href={`/api/summaries/export?format=md&from=${selected.day_date}&to=${selected.day_date}`}
                  label="MD ngày này"
                />
                <ExportLink href="/api/summaries/export?format=md" label="MD tất cả" />
                <ExportLink href="/api/summaries/export?format=json" label="JSON tất cả" />
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ExportLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] px-3 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
    >
      <Download size={15} />
      {label}
    </a>
  );
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
