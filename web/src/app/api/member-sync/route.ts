import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { DbNotReadyError, getBotHealth, getLatestMemberSyncRun, isBotHealthFresh } from "@/lib/db";
import { memberSyncRequestPath } from "@/lib/login-status";
import { isOriginAllowed } from "@/lib/http";

export const dynamic = "force-dynamic";

function handleDbError(e: unknown): NextResponse | never {
  if (e instanceof DbNotReadyError) {
    return NextResponse.json({ error: "Bot chưa chạy lần nào — chưa có cơ sở dữ liệu." }, { status: 503 });
  }
  throw e;
}

export async function GET() {
  try {
    return NextResponse.json({
      latest: getLatestMemberSyncRun() ?? null,
      pending: fs.existsSync(memberSyncRequestPath()),
    });
  } catch (e) {
    return handleDbError(e);
  }
}

export async function POST(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
  }

  const requestPath = memberSyncRequestPath();
  const dir = path.dirname(requestPath);
  const tempPath = `${requestPath}.${process.pid}.tmp`;
  const requestedAt = Date.now();

  try {
    if (!isBotHealthFresh(getBotHealth())) {
      return NextResponse.json({ error: "Bot heartbeat stale hoặc bot chưa chạy; không gửi yêu cầu sync." }, { status: 503 });
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify({ requestedAt, requestedBy: "dashboard" }, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tempPath, requestPath);
    return NextResponse.json({
      ok: true,
      requestedAt,
      latest: getLatestMemberSyncRun() ?? null,
      pending: true,
    });
  } catch (e) {
    fs.rmSync(tempPath, { force: true });
    console.error("[api/member-sync]", e);
    return NextResponse.json(
      { error: "Không ghi được yêu cầu sync. Kiểm tra quyền thư mục SESSION_DIR." },
      { status: 500 },
    );
  }
}
