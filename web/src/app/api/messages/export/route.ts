import { NextResponse } from "next/server";
import { dbExists, listGroupMessages, type MessageFilters } from "@/lib/db";

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
  if (!dbExists()) {
    return NextResponse.json({ error: "Bot chưa tạo DB." }, { status: 503 });
  }

  const url = new URL(request.url);
  const self = url.searchParams.get("self");
  const rawLimit = Number(url.searchParams.get("limit") || 5000);
  const filters: MessageFilters = {
    q: url.searchParams.get("q") ?? "",
    from: parseDateMs(url.searchParams.get("from")),
    to: parseDateMs(url.searchParams.get("to"), true),
    self: self === "self" || self === "member" ? self : "all",
    limit: Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 5000) : 5000,
  };

  const rows = listGroupMessages(filters).slice().reverse();
  const header = ["ts", "display_name", "zalo_user_id", "is_self", "text"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        new Date(r.ts).toISOString(),
        csvCell(r.display_name),
        csvCell(r.zalo_user_id),
        r.is_self ? "1" : "0",
        csvCell(r.text),
      ].join(","),
    );
  }

  const filename = `zalo-messages-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse("\uFEFF" + lines.join("\n") + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
