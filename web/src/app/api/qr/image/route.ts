import { NextResponse } from "next/server";
import fs from "node:fs";
import { qrImagePath } from "@/lib/login-status";

export const dynamic = "force-dynamic";

/** GET → ảnh qr.png (binary). Không có file → 404. */
export async function GET() {
  const file = qrImagePath();
  let buf: Buffer;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return new NextResponse("Chưa có mã QR", { status: 404 });
  }

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": "no-store",
    },
  });
}
