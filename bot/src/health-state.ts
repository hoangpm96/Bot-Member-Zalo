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
