import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getBotHealth, getPermissionCheckStatus, isBotHealthFresh } from "@/lib/db";
import { permissionCheckRequestPath } from "@/lib/login-status";
import { isOriginAllowed } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    latest: getPermissionCheckStatus(),
    pending: fs.existsSync(permissionCheckRequestPath()),
  });
}

export async function POST(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
  }

  const requestPath = permissionCheckRequestPath();
  const tempPath = `${requestPath}.${process.pid}.tmp`;
  const requestedAt = Date.now();
  try {
    if (!isBotHealthFresh(getBotHealth())) {
      return NextResponse.json({ error: "Bot heartbeat stale hoặc bot chưa chạy; không gửi check quyền." }, { status: 503 });
    }
    fs.mkdirSync(path.dirname(requestPath), { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify({ requestedAt, requestedBy: "dashboard" }, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tempPath, requestPath);
    return NextResponse.json({ ok: true, requestedAt, pending: true, latest: getPermissionCheckStatus() });
  } catch (e) {
    fs.rmSync(tempPath, { force: true });
    console.error("[api/permission-check]", e);
    return NextResponse.json({ error: "Không ghi được yêu cầu check quyền." }, { status: 500 });
  }
}
