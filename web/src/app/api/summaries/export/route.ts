import { NextResponse } from "next/server";
import { dbExists, listDailySummaries, type DailySummaryFilters } from "@/lib/db";

export const dynamic = "force-dynamic";

function parseDateMs(value: string | null, endOfDay = false): number | null {
  if (!value) return null;
  const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+07:00`);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Export kho tóm tắt hằng ngày làm nguyên liệu viết blog/phân tích.
 * format=md (mặc định): mỗi ngày một section "## dd/mm/yyyy" + text tóm tắt.
 * format=json: đầy đủ metadata (thống kê, top senders, parts đã gửi, model).
 */
export async function GET(request: Request) {
  if (!dbExists()) {
    return NextResponse.json({ error: "Bot chưa tạo DB." }, { status: 503 });
  }

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") || 1000);
  const filters: DailySummaryFilters = {
    q: url.searchParams.get("q") ?? "",
    from: parseDateMs(url.searchParams.get("from")),
    to: parseDateMs(url.searchParams.get("to"), true),
    limit: Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 1000,
  };

  // Export theo thứ tự thời gian tăng dần — đọc liền mạch như nhật ký nhóm.
  const rows = listDailySummaries(filters).slice().reverse();
  const stamp = new Date().toISOString().slice(0, 10);

  if (url.searchParams.get("format") === "json") {
    const data = rows.map((r) => ({
      dayDate: r.day_date,
      dayLabel: r.day_label,
      dayStartTs: r.day_start_ts,
      threadId: r.thread_id,
      summaryText: r.summary_text,
      parts: parseJsonArray(r.parts_json),
      totalMessages: r.total_messages,
      includedMessages: r.included_messages,
      uniqueSenders: r.unique_senders,
      images: r.images,
      videos: r.videos,
      topSenders: parseJsonArray(r.top_senders_json),
      model: r.model,
      transcriptChars: r.transcript_chars,
      source: r.source,
      createdAt: r.created_at,
    }));
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="zalo-daily-summaries-${stamp}.json"`,
        "cache-control": "no-store",
      },
    });
  }

  const sections = rows.map((r) => {
    const statsParts: string[] = [];
    if (r.total_messages !== null) statsParts.push(`${r.total_messages} tin nhắn`);
    if (r.unique_senders) statsParts.push(`${r.unique_senders} người tham gia`);
    if (r.images) statsParts.push(`${r.images} ảnh`);
    if (r.videos) statsParts.push(`${r.videos} video`);
    const topSenders = parseJsonArray(r.top_senders_json);
    const metaLines = [
      statsParts.length ? `> 📊 ${statsParts.join(" · ")}` : null,
      topSenders.length ? `> 🔥 Sôi nổi nhất: ${topSenders.join(", ")}` : null,
    ].filter(Boolean);
    return [`## ${r.day_label}`, ...(metaLines.length ? [metaLines.join("\n")] : []), r.summary_text].join("\n\n");
  });

  const md = `# Tóm tắt nhóm Zalo hằng ngày\n\n${sections.join("\n\n---\n\n")}\n`;
  return new NextResponse(md, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="zalo-daily-summaries-${stamp}.md"`,
      "cache-control": "no-store",
    },
  });
}
