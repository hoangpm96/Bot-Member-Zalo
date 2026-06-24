import { NextResponse } from "next/server";
import { DbNotReadyError } from "@/lib/db";
import { readModerationConfig, writeModerationConfig } from "@/lib/blacklist";

export const dynamic = "force-dynamic";

function handleDbError(e: unknown): NextResponse | never {
  if (e instanceof DbNotReadyError) {
    return NextResponse.json({ error: "Bot chưa chạy lần nào — chưa có cơ sở dữ liệu." }, { status: 503 });
  }
  throw e;
}

export async function GET() {
  try {
    return NextResponse.json(readModerationConfig());
  } catch (e) {
    return handleDbError(e);
  }
}

/** POST { enabled?, action?, words? } → ghi config kiểm duyệt từ khoá. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });
  }

  const { enabled, action, words } = (body ?? {}) as {
    enabled?: unknown;
    action?: unknown;
    words?: unknown;
  };

  try {
    const err = writeModerationConfig({ enabled, action, words });
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    return NextResponse.json({ ok: true, ...readModerationConfig() });
  } catch (e) {
    return handleDbError(e);
  }
}
