import { NextResponse } from "next/server";
import { dbExists, listMemberEvents, type MemberEventFilters } from "@/lib/db";

export const dynamic = "force-dynamic";

function parseDateMs(value: string | null, endOfDay = false): number | null {
  if (!value) return null;
  const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+07:00`);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  if (!dbExists()) return NextResponse.json({ error: "Bot chưa tạo DB." }, { status: 503 });
  const url = new URL(request.url);
  const filters: MemberEventFilters = {
    eventType: url.searchParams.get("eventType") ?? "all",
    source: url.searchParams.get("source") ?? "all",
    from: parseDateMs(url.searchParams.get("from")),
    to: parseDateMs(url.searchParams.get("to"), true),
    limit: 5000,
  };
  const rows = listMemberEvents(filters).slice().reverse();
  const lines = [["ts", "event_type", "source", "display_name", "zalo_user_id", "role", "note"].join(",")];
  for (const row of rows) {
    lines.push(
      [
        new Date(row.ts).toISOString(),
        row.event_type,
        row.source,
        csvCell(row.display_name),
        row.zalo_user_id,
        row.role ?? "",
        csvCell(row.note ?? ""),
      ].join(","),
    );
  }
  const filename = `member-events-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse("\uFEFF" + lines.join("\n") + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
