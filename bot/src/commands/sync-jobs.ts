import { getBotState, listJobPostsForSync, setBotState, type JobPostRow } from "../db/index.js";
import { parseSources } from "../jobs/dedupe.js";

/**
 * Đẩy kho TIN TUYỂN DỤNG (job_posts) lên Supabase của bahub.vn — bảng
 * public.bahub_job_posts — để trang bahub.vn/tuyen-dung hiển thị. Cùng mô hình
 * sync-posts / sync-leaderboard: bot đẩy một chiều, blog chỉ đọc, VPS chết thì
 * trang chỉ cũ đi chứ không vỡ.
 *
 * KHÔNG đẩy cờ hiển thị của web: payload cố tình không có is_published cho tin
 * bình thường... trừ hai trường hợp bot mới là bên nắm sự thật:
 *  - tin hết hạn (bot vừa gỡ trong expireJobPosts);
 *  - tin bị AI gắn cờ nghi lừa đảo (chưa bao giờ được hiện).
 * Ngoài hai cái đó, ngày quản trị viên đã ẩn tay bên bahub.vn sẽ KHÔNG bị lần
 * sync sau bật lại.
 *
 * Chạy tăng dần theo con trỏ (updated_at, id) lưu ở bot_state; `--full` bỏ qua
 * con trỏ và đẩy lại toàn bộ kho.
 */

const TABLE = "bahub_job_posts";
const STATE_KEY = "job_posts_sync_cursor";
/** Mỗi tin ~1-2KB chữ nên 50 tin ≈ 100KB, an toàn cho một request REST. */
const BATCH_SIZE = 50;
/** Trần mỗi lần chạy, chặn vòng lặp vô hạn nếu con trỏ không tiến được. */
const MAX_BATCHES = 40;

interface Cursor {
  updatedAt: number;
  id: number;
}

const ZERO_CURSOR: Cursor = { updatedAt: 0, id: 0 };

function readCursor(): Cursor {
  const raw = getBotState(STATE_KEY);
  if (!raw) return ZERO_CURSOR;
  try {
    const parsed = JSON.parse(raw) as Partial<Cursor>;
    return {
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
      id: typeof parsed.id === "number" ? parsed.id : 0,
    };
  } catch {
    return ZERO_CURSOR; // State hỏng → đẩy lại từ đầu (upsert nên vô hại).
  }
}

function parseSkills(json: string): string[] {
  try {
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function toJobPayload(row: JobPostRow, nowIso: string): Record<string, unknown> {
  return {
    fingerprint: row.fingerprint,
    title: row.title,
    company: row.company,
    level: row.level,
    location: row.location,
    work_mode: row.work_mode,
    salary: row.salary,
    employment_type: row.employment_type,
    years_exp: row.years_exp,
    skills: parseSkills(row.skills_json),
    deadline: row.deadline,
    contact: row.contact,
    summary: row.summary,
    description: row.description,
    source: row.source,
    source_url: row.source_url,
    // Tên người đăng ở group nghề nghiệp công khai — cần để người tìm việc biết
    // liên hệ ai. Nguồn Zalo là group kín nên không có link bài gốc, chỉ có tên.
    author: row.author,
    sources: parseSources(row.sources_json),
    posted_at: new Date(row.posted_at).toISOString(),
    last_seen_at: new Date(row.last_seen_at).toISOString(),
    repost_count: row.repost_count,
    expires_at: new Date(row.expires_at).toISOString(),
    risk_level: row.risk_level,
    model: row.model,
    synced_at: nowIso,
    updated_at: nowIso,
    // Chỉ áp đặt cờ hiển thị khi bot là bên nắm sự thật (hết hạn / nghi ngờ).
    ...(row.is_published === 0 && (row.expires_at <= Date.now() || row.risk_level !== "ok")
      ? { is_published: false }
      : {}),
  };
}

async function upsertBatch(
  supabaseUrl: string,
  serviceKey: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${TABLE}?on_conflict=fingerprint`, {
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

export async function runSyncJobs(argv: string[] = []): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env — cần cả hai để sync tin tuyển dụng.",
    );
  }

  const full = argv.includes("--full");
  let cursor = full ? ZERO_CURSOR : readCursor();
  let pushed = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const rows = listJobPostsForSync(cursor, BATCH_SIZE);
    if (rows.length === 0) break;

    const nowIso = new Date().toISOString();
    await upsertBatch(supabaseUrl, serviceKey, rows.map((row) => toJobPayload(row, nowIso)));

    // Ghi con trỏ NGAY sau khi đẩy xong lô: chạy đứt giữa chừng thì lần sau
    // tiếp tục từ đây thay vì đẩy lại từ đầu.
    const last = rows[rows.length - 1]!;
    cursor = { updatedAt: last.updated_at, id: last.id };
    setBotState(STATE_KEY, JSON.stringify(cursor), Date.now());
    pushed += rows.length;

    if (rows.length < BATCH_SIZE) break;
  }

  console.log(
    pushed === 0
      ? `[sync-jobs] Không có tin tuyển dụng mới để đẩy (con trỏ ${cursor.updatedAt}/${cursor.id}).`
      : `[sync-jobs] Đã đẩy ${pushed} tin lên ${TABLE}${full ? " (chạy full)" : ""}.`,
  );
}
