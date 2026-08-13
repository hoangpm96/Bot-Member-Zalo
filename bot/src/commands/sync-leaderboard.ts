import { listLeaderboard, type LeaderboardPeriod } from "../db/index.js";

/**
 * Đẩy bảng xếp hạng tương tác lên Supabase của bahub.vn (site_settings, key
 * "zalo_leaderboard") để trang bahub.vn/leaderboard hiển thị — thay cho
 * subdomain leaderboard.bahub.vn cũ. Chạy qua cron (xem scripts/install-cron.sh).
 *
 * Chỉ đẩy display_name + số liệu tổng hợp — tuyệt đối không đẩy zalo_user_id.
 */

const PERIODS: LeaderboardPeriod[] = ["7d", "30d", "all"];
const SETTING_KEY = "zalo_leaderboard";
const TOP_N = 50;

export async function runSyncLeaderboard(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env — cần cả hai để sync leaderboard lên bahub.vn.",
    );
  }

  const periods = {
    "7d": listLeaderboard("7d", TOP_N),
    "30d": listLeaderboard("30d", TOP_N),
    all: listLeaderboard("all", TOP_N),
  };
  const now = new Date().toISOString();
  const value = { periods, syncedAt: now };

  const res = await fetch(`${supabaseUrl}/rest/v1/site_settings?on_conflict=key`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([{ key: SETTING_KEY, value, updated_at: now }]),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Supabase upsert thất bại: HTTP ${res.status} ${detail}`.trim());
  }

  const counts = PERIODS.map((p) => `${p}=${periods[p].length}`).join(", ");
  console.log(`[sync-leaderboard] Đã đẩy top ${TOP_N} lên site_settings.${SETTING_KEY} (${counts}).`);
}
