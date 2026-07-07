import { getBotState, recordBotError, setBotState, deleteBotState } from "../db/index.js";
import { sendTelegramText } from "../telegram.js";

const HEALTH_KEY = "bot_health";
const ALERT_KEY = "bot_health_alert_active";
const STALE_MS = 10 * 60 * 1000;

interface BotHealthState {
  heartbeatAt?: number;
  socketState?: string;
  pid?: number;
  totalEvents?: number;
  lastSocketError?: string | null;
}

function readHealth(): BotHealthState | null {
  const raw = getBotState(HEALTH_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BotHealthState;
  } catch {
    return null;
  }
}

export async function runHealthCheck(): Promise<void> {
  const now = Date.now();
  const health = readHealth();
  const heartbeatAt = health?.heartbeatAt ?? 0;
  const stale = heartbeatAt <= 0 || now - heartbeatAt > STALE_MS;
  const alertActive = getBotState(ALERT_KEY) === "1";

  if (stale && !alertActive) {
    const ageMin = heartbeatAt > 0 ? Math.round((now - heartbeatAt) / 60000) : "unknown";
    const text =
      `⚠️ Zalo bot heartbeat stale (${ageMin} phút).\n` +
      `Socket: ${health?.socketState ?? "unknown"}\n` +
      `PID: ${health?.pid ?? "unknown"}\n` +
      `Lỗi socket: ${health?.lastSocketError ?? "-"}`;
    try {
      await sendTelegramText(text);
      setBotState(ALERT_KEY, "1", now);
    } catch (e) {
      recordBotError({
        source: "health-check",
        code: "telegram_alert_failed",
        message: String(e),
        detail: e instanceof Error ? e.stack : null,
        now,
      });
      throw e;
    }
    console.warn(`[health-check] stale heartbeat, alert sent. age=${ageMin}m`);
    return;
  }

  if (!stale && alertActive) {
    try {
      await sendTelegramText(
        `✅ Zalo bot heartbeat đã hồi phục.\nSocket: ${health?.socketState ?? "unknown"}\nEvents: ${health?.totalEvents ?? 0}`,
      );
    } catch (e) {
      recordBotError({
        source: "health-check",
        code: "telegram_recovery_failed",
        message: String(e),
        detail: e instanceof Error ? e.stack : null,
        now,
      });
      throw e;
    }
    deleteBotState(ALERT_KEY);
    console.log("[health-check] heartbeat recovered, recovery alert sent.");
    return;
  }

  console.log(
    `[health-check] heartbeat=${heartbeatAt ? new Date(heartbeatAt).toISOString() : "missing"}, ` +
      `stale=${stale}, alertActive=${alertActive}.`,
  );
}
