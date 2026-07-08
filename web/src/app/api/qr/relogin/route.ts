import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  qrImageExists,
  readLoginStatus,
  reloginRequestPath,
} from "@/lib/login-status";
import { isOriginAllowed } from "@/lib/http";

export const dynamic = "force-dynamic";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
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
  const requestedAt = Date.now();

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify({ requestedAt }), {
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

  // Chờ bot consume marker và tạo QR. Đây là một POST hữu hạn, không poll GET liên
  // tục từ browser. Nếu bot/PM2 chưa chạy, trả lỗi rõ thay vì báo thành công giả.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await sleep(500);
    const status = readLoginStatus();
    if (
      status.updatedAt !== null &&
      status.updatedAt >= requestedAt &&
      (status.state === "waiting_scan" ||
        status.state === "scanned" ||
        status.state === "logged_in")
    ) {
      return NextResponse.json({
        ok: true,
        status: {
          ...status,
          hasQr: qrImageExists(),
        },
      });
    }
  }

  return NextResponse.json(
    {
      error:
        "Bot chưa phản hồi. Hãy restart process zalo-bot một lần để nạp code mới; trên VPS dùng PM2, không cần chạy login bằng terminal.",
    },
    { status: 503 },
  );
}
