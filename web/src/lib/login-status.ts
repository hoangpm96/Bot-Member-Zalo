import path from "node:path";
import fs from "node:fs";

/**
 * Đọc trạng thái đăng nhập Zalo do bot ghi ra (qr.png + login-status.json).
 * Server-only — KHÔNG import better-sqlite3/db ở đây (tránh kéo node module nặng
 * vào route chỉ phục vụ ảnh + JSON nhỏ).
 *
 * Thư mục data: env WEB_QR_DIR, default ../bot/data (web và bot cùng repo,
 * tương tự cách db.ts resolve ../bot/data/bot.db).
 */

const QR_DIR =
  process.env.WEB_QR_DIR?.trim() ||
  path.resolve(process.cwd(), "..", "bot", "data");

const STATUS_PATH = path.join(QR_DIR, "login-status.json");
const QR_IMAGE_PATH = path.join(QR_DIR, "qr.png");
const RELOGIN_REQUEST_PATH = path.join(QR_DIR, "relogin-request.json");
const MEMBER_SYNC_REQUEST_PATH = path.join(QR_DIR, "member-sync-request.json");
const PERMISSION_CHECK_REQUEST_PATH = path.join(QR_DIR, "permission-check-request.json");
const KICK_NOW_REQUEST_PATH = path.join(QR_DIR, "kick-now-request.json");

export type LoginState =
  | "ready"
  | "waiting_scan"
  | "scanned"
  | "logged_in"
  | "expired"
  | "declined"
  | "unknown";

export interface LoginStatus {
  state: LoginState;
  updatedAt: number | null;
  displayName: string | null;
}

const KNOWN_STATES: LoginState[] = [
  "ready",
  "waiting_scan",
  "scanned",
  "logged_in",
  "expired",
  "declined",
];

/**
 * Đọc login-status.json. File không tồn tại / hỏng → state "unknown".
 * Bot ghi { state, qr, updatedAt, displayName? } — ta chỉ lấy phần web cần,
 * bỏ qua `qr` (ảnh phục vụ riêng qua /api/qr/image).
 */
export function readLoginStatus(): LoginStatus {
  let raw: string;
  try {
    raw = fs.readFileSync(STATUS_PATH, "utf8");
  } catch {
    return { state: "unknown", updatedAt: null, displayName: null };
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { state: "unknown", updatedAt: null, displayName: null };
  }

  const obj = (data ?? {}) as {
    state?: unknown;
    updatedAt?: unknown;
    displayName?: unknown;
  };

  const state =
    typeof obj.state === "string" && (KNOWN_STATES as string[]).includes(obj.state)
      ? (obj.state as LoginState)
      : "unknown";
  const updatedAt = typeof obj.updatedAt === "number" ? obj.updatedAt : null;
  const displayName = typeof obj.displayName === "string" ? obj.displayName : null;

  return { state, updatedAt, displayName };
}

/** Đường dẫn file ảnh QR (cho route image đọc trực tiếp). */
export function qrImagePath(): string {
  return QR_IMAGE_PATH;
}

/** Ảnh QR có tồn tại không. */
export function qrImageExists(): boolean {
  return fs.existsSync(QR_IMAGE_PATH);
}

/** Đường dẫn marker để dashboard yêu cầu bot tự xoá session và login lại. */
export function reloginRequestPath(): string {
  return RELOGIN_REQUEST_PATH;
}

/** Đường dẫn marker để dashboard yêu cầu bot sync member ngay. */
export function memberSyncRequestPath(): string {
  return MEMBER_SYNC_REQUEST_PATH;
}

/** Đường dẫn marker để dashboard yêu cầu bot kiểm tra quyền group. */
export function permissionCheckRequestPath(): string {
  return PERMISSION_CHECK_REQUEST_PATH;
}

/** Đường dẫn marker để dashboard yêu cầu bot kick 1 người ngay (không qua duyệt Telegram). */
export function kickNowRequestPath(): string {
  return KICK_NOW_REQUEST_PATH;
}
