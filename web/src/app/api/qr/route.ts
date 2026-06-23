import { NextResponse } from "next/server";
import { readLoginStatus, qrImageExists } from "@/lib/login-status";

export const dynamic = "force-dynamic";

/** GET → trạng thái đăng nhập Zalo hiện tại (cho trang /login poll). */
export async function GET() {
  const status = readLoginStatus();
  return NextResponse.json({
    state: status.state,
    updatedAt: status.updatedAt,
    displayName: status.displayName,
    hasQr: qrImageExists(),
  });
}
