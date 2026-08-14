import {
  getBotState,
  listPublicPostsForSync,
  setBotState,
  type PublicPostRow,
} from "../db/index.js";
import { parseTopics } from "./daily-fb-post.js";

/**
 * Đẩy kho BẢN TIN CÔNG KHAI (daily_public_posts) lên Supabase của bahub.vn —
 * bảng public.zalo_bulletin_posts — để trang bahub.vn/ban-tin hiển thị dạng
 * card, đúng nội dung đã đăng Facebook Page. Cùng mô hình sync-leaderboard:
 * bot đẩy một chiều, blog chỉ đọc.
 *
 * RIÊNG TƯ: đây là bản ĐÃ LƯỢC tên thành viên và chuyện nội bộ ngay từ lúc
 * soạn (draftPublicPost). Bản tóm tắt nội bộ đầy đủ (daily_summaries) KHÔNG
 * BAO GIỜ rời khỏi VPS — đó là lý do bảng zalo_daily_summaries bên Supabase đã
 * bị gỡ bỏ.
 *
 * Cũng không đẩy image_prompt (chi tiết kỹ thuật) và image_file (đường dẫn nội
 * bộ trên VPS) — web chỉ cần title, caption, image_url.
 *
 * KHÔNG ghi đè cờ hiển thị: payload cố tình không có cột is_published, nên
 * PostgREST upsert chỉ set các cột có trong payload — ngày admin đã ẩn bên
 * bahub.vn sẽ KHÔNG bị lần sync sau bật lại.
 *
 * Chạy tăng dần theo con trỏ (updated_at, day_date) lưu ở bot_state; ngày soạn
 * lại có updated_at mới nên tự động được đẩy lại. `sync-posts --full` bỏ qua
 * con trỏ và đẩy lại toàn bộ kho.
 */

const TABLE = "zalo_bulletin_posts";
const STATE_KEY = "public_posts_sync_cursor";
/** Số ngày mỗi request REST — mỗi ngày ~4KB chữ nên 25 ngày ≈ 100KB, an toàn. */
const BATCH_SIZE = 25;
/** Trần mỗi lần chạy, chặn vòng lặp vô hạn nếu con trỏ không tiến được. */
const MAX_BATCHES = 40;

interface Cursor {
  updatedAt: number;
  dayDate: string;
}

const ZERO_CURSOR: Cursor = { updatedAt: 0, dayDate: "" };

function readCursor(): Cursor {
  const raw = getBotState(STATE_KEY);
  if (!raw) return ZERO_CURSOR;
  try {
    const parsed = JSON.parse(raw) as Partial<Cursor>;
    return {
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
      dayDate: typeof parsed.dayDate === "string" ? parsed.dayDate : "",
    };
  } catch {
    return ZERO_CURSOR; // State hỏng → đẩy lại từ đầu (upsert nên vô hại).
  }
}

function writeCursor(cursor: Cursor): void {
  setBotState(STATE_KEY, JSON.stringify(cursor), Date.now());
}

export function toPostPayload(row: PublicPostRow, nowIso: string): Record<string, unknown> {
  const topics = parseTopics(row.topics_json).map((topic) => ({
    title: topic.title,
    caption: topic.caption,
    image_url: topic.image_url ?? null,
  }));

  return {
    day_date: row.day_date,
    day_label: row.day_label,
    main_caption: row.main_caption,
    topics,
    // Cột riêng để web lọc/sắp xếp mà không phải mở JSON ra đếm.
    topic_count: topics.length,
    skipped_reason: row.skipped_reason,
    fb_post_id: row.fb_post_id,
    fb_url: row.fb_post_id ? `https://www.facebook.com/${row.fb_post_id}` : null,
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

export async function runSyncPosts(argv: string[] = []): Promise<void> {
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
  let withTopics = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const rows = listPublicPostsForSync(cursor, BATCH_SIZE);
    if (rows.length === 0) break;

    const nowIso = new Date().toISOString();
    const payloads = rows.map((row) => toPostPayload(row, nowIso));
    await upsertBatch(supabaseUrl, serviceKey, payloads);

    // Ghi con trỏ NGAY sau khi đẩy xong lô: chạy đứt giữa chừng thì lần sau
    // tiếp tục từ đây thay vì đẩy lại từ đầu.
    const last = rows[rows.length - 1]!;
    cursor = { updatedAt: last.updated_at, dayDate: last.day_date };
    writeCursor(cursor);
    pushed += rows.length;
    withTopics += payloads.filter((p) => (p.topic_count as number) > 0).length;

    if (rows.length < BATCH_SIZE) break;
  }

  console.log(
    pushed === 0
      ? `[sync-posts] Không có bản tin mới để đẩy (con trỏ ${cursor.updatedAt}/${cursor.dayDate || "-"}).`
      : `[sync-posts] Đã đẩy ${pushed} ngày (${withTopics} ngày có bài) lên ${TABLE}${full ? " (chạy full)" : ""}.`,
  );
}
