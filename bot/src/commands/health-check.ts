import { getBotState, recordBotError, setBotState, deleteBotState } from "../db/index.js";
import { sendTelegramText } from "../telegram.js";
import { assessBotHealth, type BotHealthState } from "../health-state.js";

const HEALTH_KEY = "bot_health";
const ALERT_KEY = "bot_health_alert_active";

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
  const assessment = assessBotHealth(health, now);
  const { heartbeatAt, heartbeatStale, socketConnected, unhealthy } = assessment;
  const alertActive = getBotState(ALERT_KEY) === "1";

  if (unhealthy && !alertActive) {
    const ageMin = heartbeatAt > 0 ? Math.round((now - heartbeatAt) / 60000) : "unknown";
    const text =
      `⚠️ Zalo bot realtime không healthy.\n` +
      `Heartbeat stale: ${heartbeatStale ? `có (${ageMin} phút)` : "không"}\n` +
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
    console.warn(
      `[health-check] unhealthy, alert sent. heartbeatStale=${heartbeatStale}, ` +
        `socketConnected=${socketConnected}, age=${ageMin}m`,
    );
    return;
  }

  if (!unhealthy && alertActive) {
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
      `heartbeatStale=${heartbeatStale}, socketConnected=${socketConnected}, ` +
      `alertActive=${alertActive}.`,
  );
}
