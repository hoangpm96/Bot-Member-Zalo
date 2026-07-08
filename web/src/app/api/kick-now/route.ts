import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { DbNotReadyError, getBotHealth, getState, isBotHealthFresh } from "@/lib/db";
import { kickNowRequestPath } from "@/lib/login-status";
import { isOriginAllowed } from "@/lib/http";

export const dynamic = "force-dynamic";

interface KickNowResult {
  requestId: string;
  zaloUserId: string;
  ok: boolean;
  error?: string;
  blocked?: boolean;
  blockError?: string | null;
  finishedAt: number;
}

function handleDbError(e: unknown): NextResponse | never {
  if (e instanceof DbNotReadyError) {
    return NextResponse.json({ error: "Bot chưa chạy lần nào — chưa có cơ sở dữ liệu." }, { status: 503 });
  }
  throw e;
}

/** GET ?requestId=... → poll kết quả kick nhanh (bot xử lý bất đồng bộ qua listener). */
export async function GET(request: Request) {
  try {
    const requestId = new URL(request.url).searchParams.get("requestId");
    if (!requestId) {
      return NextResponse.json({ error: "Thiếu requestId" }, { status: 400 });
    }
    const raw = getState("kick_now_result");
    if (!raw) return NextResponse.json({ pending: true });
    let result: KickNowResult | null = null;
    try {
      result = JSON.parse(raw) as KickNowResult;
    } catch {
      result = null;
    }
    if (!result || result.requestId !== requestId) {
      return NextResponse.json({ pending: true });
    }
    return NextResponse.json({ pending: false, result });
  } catch (e) {
    return handleDbError(e);
  }
}

/** POST { zaloUserId, displayName, block } → ghi yêu cầu kick 1 người NGAY, không qua duyệt Telegram. */
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
  const { zaloUserId, displayName, block } = (body ?? {}) as {
    zaloUserId?: unknown;
    displayName?: unknown;
    block?: unknown;
  };
  const id = typeof zaloUserId === "string" ? zaloUserId.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "Thiếu zaloUserId" }, { status: 400 });
  }

  try {
    if (!isBotHealthFresh(getBotHealth())) {
      return NextResponse.json({ error: "Bot heartbeat stale hoặc bot chưa chạy; không gửi được yêu cầu kick." }, { status: 503 });
    }
  } catch (e) {
    return handleDbError(e);
  }

  const requestPath = kickNowRequestPath();
  const dir = path.dirname(requestPath);
  const tempPath = `${requestPath}.${process.pid}.tmp`;
  const requestId = randomUUID();
  const requestedAt = Date.now();

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      tempPath,
      JSON.stringify({
        requestId,
        zaloUserId: id,
        displayName: typeof displayName === "string" ? displayName : "",
        block: block === true,
        requestedAt,
        requestedBy: "dashboard",
      }, null, 2),
      { encoding: "utf8", mode: 0o600 },
    );
    // linkSync thay vì renameSync: tạo hardlink CHỈ THÀNH CÔNG nếu requestPath chưa tồn tại
    // (atomic create-only, không TOCTOU như existsSync-rồi-write). Nếu đã có request khác
    // chưa được bot tiêu thụ (poll mỗi 1s), lỗi EEXIST → báo "đang bận" thay vì ghi đè
    // làm mất âm thầm request trước (người bấm request đó sẽ chờ tới hạn timeout vô ích).
    try {
      fs.linkSync(tempPath, requestPath);
    } catch (linkErr) {
      if ((linkErr as NodeJS.ErrnoException).code === "EEXIST") {
        return NextResponse.json(
          { error: "Đang có yêu cầu kick khác chờ bot xử lý. Đợi vài giây rồi thử lại." },
          { status: 409 },
        );
      }
      throw linkErr;
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
    return NextResponse.json({ ok: true, requestId, requestedAt });
  } catch (e) {
    fs.rmSync(tempPath, { force: true });
    console.error("[api/kick-now]", e);
    return NextResponse.json(
      { error: "Không ghi được yêu cầu kick. Kiểm tra quyền thư mục SESSION_DIR." },
      { status: 500 },
    );
  }
}
