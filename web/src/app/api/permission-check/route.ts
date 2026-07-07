import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getPermissionCheckStatus } from "@/lib/db";
import { permissionCheckRequestPath } from "@/lib/login-status";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    latest: getPermissionCheckStatus(),
    pending: fs.existsSync(permissionCheckRequestPath()),
  });
}

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

  const requestPath = permissionCheckRequestPath();
  const tempPath = `${requestPath}.${process.pid}.tmp`;
  const requestedAt = Date.now();
  try {
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
