import { getBotState, recordBotError, setBotState, deleteBotState } from "../db/index.js";
import { sendTelegramText } from "../telegram.js";
import {
  assessBotHealth,
  parseLoginState,
  isAwaitingQrLogin,
  LOGIN_STATE_KEY,
  type BotHealthState,
} from "../health-state.js";

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
  const login = parseLoginState(getBotState(LOGIN_STATE_KEY));
  const awaitingQr = isAwaitingQrLogin(login, now);
  // Phân loại alert để khi tình trạng chuyển generic → cần-QR thì bắn lại tin mới
  // (giá trị "1" cũ trước đây tương đương "generic").
  const alertKind = awaitingQr ? "qr" : "generic";
  const prevAlertRaw = getBotState(ALERT_KEY);
  const prevAlert = prevAlertRaw === "1" ? "generic" : prevAlertRaw;
  const alertActive = prevAlert === alertKind;

  if (unhealthy && !alertActive) {
    const ageMin = heartbeatAt > 0 ? Math.round((now - heartbeatAt) / 60000) : "unknown";
    const text = awaitingQr
      ? `⚠️ Zalo bot CHƯA ĐĂNG NHẬP — session hỏng, cần quét QR lại.\n` +
        `Trạng thái login: ${login?.state}\n` +
        `PID: ${login?.pid ?? "unknown"}\n` +
        `Mở web panel /login và quét bằng tài khoản co-admin.`
      : `⚠️ Zalo bot realtime không healthy.\n` +
        `Heartbeat stale: ${heartbeatStale ? `có (${ageMin} phút)` : "không"}\n` +
        `Socket: ${health?.socketState ?? "unknown"}\n` +
        `PID: ${health?.pid ?? "unknown"}\n` +
        `Lỗi socket: ${health?.lastSocketError ?? "-"}`;
    try {
      await sendTelegramText(text);
      setBotState(ALERT_KEY, alertKind, now);
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
      `[health-check] unhealthy, alert sent (${alertKind}). heartbeatStale=${heartbeatStale}, ` +
        `socketConnected=${socketConnected}, awaitingQr=${awaitingQr}, age=${ageMin}m`,
    );
    return;
  }

  if (!unhealthy && prevAlert) {
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
