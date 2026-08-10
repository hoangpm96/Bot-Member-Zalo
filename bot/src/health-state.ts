export const BOT_HEARTBEAT_STALE_MS = 10 * 60 * 1000;

export interface BotHealthState {
  heartbeatAt?: number;
  socketState?: string;
  pid?: number;
  totalEvents?: number;
  lastSocketError?: string | null;
}

export interface BotHealthAssessment {
  heartbeatAt: number;
  heartbeatStale: boolean;
  socketConnected: boolean;
  unhealthy: boolean;
}

/**
 * Trạng thái login Zalo, mirror từ login-status.json vào bot_state để health-check
 * (chạy ở process khác) phân biệt được "bot chờ quét QR" với "bot chết hẳn" —
 * bot_health khi đó là dữ liệu cũ của process trước (PID cũ, socket "connected" giả).
 */
export const LOGIN_STATE_KEY = "zalo_login_state";

export interface LoginStateSnapshot {
  state: string;
  updatedAt: number;
  pid: number | null;
}

export function parseLoginState(raw: string | null | undefined): LoginStateSnapshot | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as { state?: unknown; updatedAt?: unknown; pid?: unknown };
    if (typeof obj.state !== "string" || typeof obj.updatedAt !== "number") return null;
    return {
      state: obj.state,
      updatedAt: obj.updatedAt,
      pid: typeof obj.pid === "number" ? obj.pid : null,
    };
  } catch {
    return null;
  }
}

/**
 * Bot đang kẹt ở vòng đăng nhập QR? Chỉ tin bản ghi còn mới: khi chờ quét, bot xoay QR
 * ~100s nên updatedAt được ghi liên tục; bản ghi cũ nghĩa là process login cũng đã chết.
 */
export function isAwaitingQrLogin(
  login: LoginStateSnapshot | null,
  now: number,
  staleMs = BOT_HEARTBEAT_STALE_MS,
): boolean {
  if (!login) return false;
  if (login.state === "logged_in") return false;
  return now - login.updatedAt <= staleMs;
}

/**
 * Heartbeat chỉ chứng minh process còn sống. Listener realtime chỉ healthy khi cả
 * heartbeat còn mới VÀ WebSocket Zalo đang connected.
 */
export function assessBotHealth(
  health: BotHealthState | null,
  now: number,
  staleMs = BOT_HEARTBEAT_STALE_MS,
): BotHealthAssessment {
  const heartbeatAt = health?.heartbeatAt ?? 0;
  const heartbeatStale = heartbeatAt <= 0 || now - heartbeatAt > staleMs;
  const socketConnected = health?.socketState === "connected";
  return {
    heartbeatAt,
    heartbeatStale,
    socketConnected,
    unhealthy: heartbeatStale || !socketConnected,
  };
}
