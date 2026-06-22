import { NextResponse } from "next/server";
import { writeConfig } from "@/lib/config";
import { DbNotReadyError } from "@/lib/db";
import { CONFIG_KEYS, type ConfigField } from "@/lib/config-meta";

export const dynamic = "force-dynamic";

/** POST { field, value } → ghi 1 config vào bot_state (đã validate). */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });
  }

  const { field, value } = (body ?? {}) as { field?: string; value?: unknown };
  if (!field || !(field in CONFIG_KEYS)) {
    return NextResponse.json({ error: "Trường cấu hình không hợp lệ" }, { status: 400 });
  }
  // Chỉ nhận number/chuỗi-số — chặn coercion lỏng (null/false/[]/"" → 0).
  if (typeof value !== "number" && typeof value !== "string") {
    return NextResponse.json({ error: "Giá trị phải là số" }, { status: 400 });
  }
  const num = Number(value);
  if (!Number.isFinite(num) || String(value).trim() === "") {
    return NextResponse.json({ error: "Giá trị phải là số" }, { status: 400 });
  }

  try {
    const err = writeConfig(field as ConfigField, num);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof DbNotReadyError) {
      return NextResponse.json({ error: "Bot chưa chạy lần nào — chưa có cơ sở dữ liệu." }, { status: 503 });
    }
    throw e;
  }
}
