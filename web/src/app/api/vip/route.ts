import { NextResponse } from "next/server";
import { readVip, writeVip, type VipEntry } from "@/lib/vip";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ entries: readVip() });
}

/** POST { entries: [{id, note?}] } → ghi lại toàn bộ VIP list. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });
  }
  const entries = (body as { entries?: unknown })?.entries;
  if (!Array.isArray(entries)) {
    return NextResponse.json({ error: "Thiếu danh sách entries" }, { status: 400 });
  }
  const err = writeVip(entries as VipEntry[]);
  if (err) {
    return NextResponse.json({ error: err }, { status: 400 });
  }
  return NextResponse.json({ ok: true, entries: readVip() });
}
