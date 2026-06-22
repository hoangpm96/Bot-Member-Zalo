import { NextResponse } from "next/server";
import { writeConfig } from "@/lib/config";
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
  const num = Number(value);
  const err = writeConfig(field as ConfigField, num);
  if (err) {
    return NextResponse.json({ error: err }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
