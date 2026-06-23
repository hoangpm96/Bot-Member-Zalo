import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { reloginRequestPath } from "@/lib/login-status";

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

  if ((body as { confirm?: unknown })?.confirm !== "RELOGIN") {
    return NextResponse.json({ error: "Thiếu xác nhận đăng nhập lại" }, { status: 400 });
  }

  const requestPath = reloginRequestPath();
  const dir = path.dirname(requestPath);
  const tempPath = `${requestPath}.${process.pid}.tmp`;

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify({ requestedAt: Date.now() }), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tempPath, requestPath);
  } catch (e) {
    fs.rmSync(tempPath, { force: true });
    console.error("[api/qr/relogin]", e);
    return NextResponse.json(
      { error: "Không ghi được yêu cầu. Kiểm tra quyền thư mục SESSION_DIR." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
