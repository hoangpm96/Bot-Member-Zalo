import { NextResponse } from "next/server";
import { setCleanupPlanItemStatus } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) {
        return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });
  }

  const { id, status } = (body ?? {}) as { id?: unknown; status?: unknown };
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return NextResponse.json({ error: "ID item không hợp lệ" }, { status: 400 });
  }
  if (status !== "planned" && status !== "skipped") {
    return NextResponse.json({ error: "Status không hợp lệ" }, { status: 400 });
  }

  setCleanupPlanItemStatus({ id: itemId, status });
  return NextResponse.json({ ok: true });
}
