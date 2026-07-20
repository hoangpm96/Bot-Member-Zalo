import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Clock3, MessageCircle, Trophy } from "lucide-react";
import { dbExists, listLeaderboard, type LeaderboardPeriod } from "@/lib/db";
import { fmtAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bảng xếp hạng tương tác",
  description: "Top 50 thành viên tương tác nhiều nhất trong cộng đồng.",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
  },
};

type SearchParams = Record<string, string | string[] | undefined>;

const PERIODS: { value: LeaderboardPeriod; label: string; description: string }[] = [
  { value: "7d", label: "7 ngày", description: "7 ngày gần nhất" },
  { value: "30d", label: "30 ngày", description: "30 ngày gần nhất" },
  { value: "all", label: "Toàn thời gian", description: "Từ khi bot bắt đầu ghi nhận" },
];

function readPeriod(params: SearchParams | undefined): LeaderboardPeriod {
  const raw = params?.period;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "7d" || value === "30d" || value === "all" ? value : "7d";
}

function rankStyle(rank: number): string {
  if (rank === 1) return "border-amber-400/40 bg-amber-400/10 text-amber-300";
  if (rank === 2) return "border-slate-300/30 bg-slate-300/10 text-slate-200";
  if (rank === 3) return "border-orange-500/30 bg-orange-500/10 text-orange-300";
  return "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)]";
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const period = readPeriod(params);
  const activePeriod = PERIODS.find((item) => item.value === period) ?? PERIODS[0];
  const rows = dbExists() ? listLeaderboard(period, 50) : [];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(79,140,255,0.16),_transparent_38%),var(--color-bg)]">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-primary)_16%,transparent)] text-[var(--color-primary)]">
            <Trophy size={28} />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
            Bảng xếp hạng tương tác
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--color-muted)] sm:text-base">
            Top 50 thành viên hoạt động tích cực nhất trong cộng đồng.
          </p>
        </header>

        <nav className="mx-auto mt-7 grid max-w-xl grid-cols-3 gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5">
          {PERIODS.map((item) => {
            const active = item.value === period;
            return (
              <Link
                key={item.value}
                href={`?period=${item.value}`}
                className={`rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors ${
                  active
                    ? "bg-[var(--color-primary)] text-white"
                    : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-8 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_94%,transparent)] shadow-2xl shadow-black/20">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-4 sm:px-6">
            <div>
              <h2 className="font-semibold">Top 50 · {activePeriod.label}</h2>
              <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                {activePeriod.description}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
              <BarChart3 size={15} />
              Cập nhật theo dữ liệu mới nhất
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <MessageCircle className="mx-auto text-[var(--color-muted)]" size={34} />
              <p className="mt-3 font-medium">Chưa có tương tác trong khoảng thời gian này</p>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                Bảng xếp hạng sẽ tự xuất hiện khi bot ghi nhận dữ liệu mới.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {rows.map((row) => (
                <div
                  key={`${row.rank}-${row.display_name}`}
                  className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.025] sm:grid-cols-[52px_minmax(0,1fr)_minmax(230px,auto)_90px] sm:px-6"
                >
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-bold ${rankStyle(row.rank)}`}
                  >
                    {row.rank}
                  </div>

                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {row.display_name || "Thành viên ẩn danh"}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
                      <Clock3 size={12} />
                      Tương tác {fmtAgo(row.last_interaction)}
                    </div>
                  </div>

                  <div className="hidden items-center justify-end gap-4 text-xs text-[var(--color-muted)] sm:flex">
                    <span title="Tin nhắn">{row.message_count} tin</span>
                    <span title="Reaction">{row.reaction_count} reaction</span>
                    <span title="Bình chọn">{row.vote_count} vote</span>
                    {row.other_count > 0 ? <span title="Tương tác khác">{row.other_count} khác</span> : null}
                  </div>

                  <div className="text-right">
                    <div className="text-lg font-bold tabular-nums text-[var(--color-primary)]">
                      {row.interaction_count}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                      tương tác
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="mt-5 text-center text-xs leading-5 text-[var(--color-muted)]">
          Điểm tương tác có trọng số: 1 tin nhắn/ảnh/video = 10 điểm, 1 lượt bình chọn = 3 điểm, 1 reaction = 1 điểm.
          <br />
          “Toàn thời gian” được tính từ lúc hệ thống bắt đầu thu thập dữ liệu.
        </footer>
      </div>
    </div>
  );
}
