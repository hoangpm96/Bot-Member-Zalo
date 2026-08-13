import {
  getBotState,
  listDailySummariesForSync,
  setBotState,
  type DailySummarySyncRow,
} from "../db/index.js";

/**
 * Đẩy kho bản tin tóm tắt hằng ngày (daily_summaries) lên Supabase của
 * bahub.vn — bảng public.zalo_daily_summaries — để trang bahub.vn/ban-tin hiển
 * thị. Cùng mô hình với sync-leaderboard: bot đẩy một chiều, blog chỉ đọc.
 *
 * RIÊNG TƯ: chỉ đẩy summary_text + số liệu tổng hợp + tên hiển thị top sender
 * (đã qua sanitizeDisplayName lúc tóm tắt). TUYỆT ĐỐI không đẩy zalo_user_id,
 * transcript hay parts_json.
 *
 * KHÔNG ghi đè cờ hiển thị: payload cố tình không có cột is_published, nên
 * PostgREST upsert chỉ set các cột có trong payload — ngày admin đã ẩn bên
 * bahub.vn sẽ KHÔNG bị lần sync sau bật lại.
 *
 * Chạy tăng dần theo con trỏ (created_at, day_date) lưu ở bot_state; ngày cũ
 * được backfill/tóm tắt lại sẽ có created_at mới nên tự động được đẩy lại.
 * `sync-summaries --full` bỏ qua con trỏ và đẩy lại toàn bộ kho.
 */

const TABLE = "zalo_daily_summaries";
const STATE_KEY = "summaries_sync_cursor";
/** Số ngày mỗi request REST — bản tin ~8KB nên 25 ngày ≈ 200KB, an toàn. */
const BATCH_SIZE = 25;
/** Trần mỗi lần chạy, chặn vòng lặp vô hạn nếu con trỏ không tiến được. */
const MAX_BATCHES = 40;

interface Cursor {
  createdAt: number;
  dayDate: string;
}

const ZERO_CURSOR: Cursor = { createdAt: 0, dayDate: "" };

function readCursor(): Cursor {
  const raw = getBotState(STATE_KEY);
  if (!raw) return ZERO_CURSOR;
  try {
    const parsed = JSON.parse(raw) as Partial<Cursor>;
    return {
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : 0,
      dayDate: typeof parsed.dayDate === "string" ? parsed.dayDate : "",
    };
  } catch {
    return ZERO_CURSOR; // State hỏng → đẩy lại từ đầu (upsert nên vô hại).
  }
}

function writeCursor(cursor: Cursor): void {
  setBotState(STATE_KEY, JSON.stringify(cursor), Date.now());
}

function parseTopSenders(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function toPayload(row: DailySummarySyncRow, nowIso: string): Record<string, unknown> {
  return {
    day_date: row.day_date,
    day_label: row.day_label,
    summary_text: row.summary_text,
    total_messages: row.total_messages,
    included_messages: row.included_messages,
    unique_senders: row.unique_senders,
    images: row.images,
    videos: row.videos,
    top_senders: parseTopSenders(row.top_senders_json),
    model: row.model,
    source: row.source,
    synced_at: nowIso,
    updated_at: nowIso,
  };
}

async function upsertBatch(
  supabaseUrl: string,
  serviceKey: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${TABLE}?on_conflict=day_date`, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Supabase upsert thất bại: HTTP ${res.status} ${detail}`.trim());
  }
}

export async function runSyncSummaries(argv: string[] = []): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env — cần cả hai để sync bản tin lên bahub.vn.",
    );
  }

  const full = argv.includes("--full");
  let cursor = full ? ZERO_CURSOR : readCursor();
  let pushed = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const rows = listDailySummariesForSync(cursor, BATCH_SIZE);
    if (rows.length === 0) break;

    const nowIso = new Date().toISOString();
    await upsertBatch(
      supabaseUrl,
      serviceKey,
      rows.map((row) => toPayload(row, nowIso)),
    );

    // Ghi con trỏ NGAY sau khi đẩy xong lô: chạy đứt giữa chừng thì lần sau
    // tiếp tục từ đây thay vì đẩy lại từ đầu.
    const last = rows[rows.length - 1]!;
    cursor = { createdAt: last.created_at, dayDate: last.day_date };
    writeCursor(cursor);
    pushed += rows.length;

    if (rows.length < BATCH_SIZE) break;
  }

  console.log(
    pushed === 0
      ? `[sync-summaries] Không có bản tin mới để đẩy (con trỏ ${cursor.createdAt}/${cursor.dayDate || "-"}).`
      : `[sync-summaries] Đã đẩy ${pushed} ngày lên ${TABLE}${full ? " (chạy full)" : ""}.`,
  );
}
