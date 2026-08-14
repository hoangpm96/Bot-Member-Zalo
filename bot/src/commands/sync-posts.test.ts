import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Test lệnh sync-posts trên một SQLite tạm + fetch giả.
 * Chạy: npm test (node --import tsx --test).
 *
 * SQLITE_DB_PATH phải được set TRƯỚC khi import config/db (config đọc env lúc
 * import), nên phần import ở đây là dynamic import sau khi gán env.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-sync-posts-"));
process.env.SQLITE_DB_PATH = path.join(tmpDir, "test.db");
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";

const { savePublicPost, setPublicPostFbId, getDb } = await import("../db/index.js");
const { runSyncPosts } = await import("./sync-posts.js");

interface CapturedRequest {
  url: string;
  rows: Record<string, unknown>[];
}

/** Thay fetch bằng bản ghi lại request; trả về danh sách request đã bắt được. */
function stubFetch(status = 200): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    captured.push({
      url: String(input),
      rows: JSON.parse(String(init?.body ?? "[]")) as Record<string, unknown>[],
    });
    return new Response(status === 200 ? "" : "boom", { status });
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  }) as any;
  return captured;
}

function seedDay(dayDate: string, updatedAt: number, caption = "Hook mở bài"): void {
  savePublicPost({
    dayDate,
    dayLabel: dayDate.split("-").reverse().join("/"),
    dayStartTs: Date.parse(`${dayDate}T00:00:00+07:00`),
    mainCaption: caption,
    topicsJson: JSON.stringify([
      {
        title: "Ước lượng effort",
        caption: "Nội dung chủ đề 1",
        image_prompt: "two people at a whiteboard",
        image_file: `${dayDate}-topic-1.png`,
        image_url: `https://bot.bahub.vn/bt/${dayDate}/topic-1.webp?v=${updatedAt}`,
      },
    ]),
    model: "deepseek-v4-flash",
    source: "live",
    now: updatedAt,
  });
}

/** Ngày model kết luận không đủ nội dung đáng đăng. */
function seedSkippedDay(dayDate: string, updatedAt: number): void {
  savePublicPost({
    dayDate,
    dayLabel: dayDate.split("-").reverse().join("/"),
    dayStartTs: Date.parse(`${dayDate}T00:00:00+07:00`),
    mainCaption: "",
    topicsJson: "[]",
    skippedReason: "Cả ngày chỉ có chào hỏi và hẹn cà phê.",
    model: "deepseek-v4-flash",
    source: "backfill",
    now: updatedAt,
  });
}

function resetStore(): void {
  const db = getDb();
  db.prepare("DELETE FROM daily_public_posts").run();
  db.prepare("DELETE FROM bot_state").run();
}

test("đẩy toàn bộ kho khi chưa có con trỏ, đúng payload", async () => {
  resetStore();
  seedDay("2026-08-10", 1_000);
  seedDay("2026-08-11", 2_000);
  setPublicPostFbId("2026-08-11", "1234_5678", 2_000);
  const captured = stubFetch();

  await runSyncPosts();

  assert.equal(captured.length, 1);
  assert.match(captured[0]!.url, /\/rest\/v1\/zalo_bulletin_posts\?on_conflict=day_date$/);
  assert.deepEqual(
    captured[0]!.rows.map((r) => r.day_date),
    ["2026-08-10", "2026-08-11"],
  );

  const row = captured[0]!.rows[1]!;
  assert.equal(row.day_label, "11/08/2026");
  assert.equal(row.main_caption, "Hook mở bài");
  assert.equal(row.topic_count, 1);
  assert.equal(row.fb_post_id, "1234_5678");
  assert.equal(row.fb_url, "https://www.facebook.com/1234_5678");
  assert.equal(row.model, "deepseek-v4-flash");
  assert.equal(typeof row.synced_at, "string");

  const topics = row.topics as Record<string, unknown>[];
  assert.equal(topics.length, 1);
  assert.equal(topics[0]!.title, "Ước lượng effort");
  assert.match(String(topics[0]!.image_url), /^https:\/\/bot\.bahub\.vn\/bt\//);
});

test("KHÔNG gửi cột is_published, không gửi prompt ảnh hay đường dẫn file trên VPS", async () => {
  resetStore();
  seedDay("2026-08-10", 1_000);
  const captured = stubFetch();

  await runSyncPosts();

  const row = captured[0]!.rows[0]!;
  const keys = Object.keys(row);
  assert.ok(!keys.includes("is_published"), `payload không được có is_published: ${keys}`);
  for (const forbidden of ["summary_text", "top_senders", "zalo_user_id", "topics_json"]) {
    assert.ok(!keys.includes(forbidden), `payload không được có ${forbidden}`);
  }

  // Chủ đề chỉ mang thứ web cần hiển thị.
  const topicKeys = Object.keys((row.topics as Record<string, unknown>[])[0]!);
  assert.deepEqual(topicKeys.sort(), ["caption", "image_url", "title"]);
});

test("ngày không đủ nội dung vẫn được đẩy với topic_count = 0 để web gỡ xuống", async () => {
  resetStore();
  seedSkippedDay("2026-08-09", 1_000);
  const captured = stubFetch();

  await runSyncPosts();

  const row = captured[0]!.rows[0]!;
  assert.equal(row.topic_count, 0);
  assert.deepEqual(row.topics, []);
  assert.equal(row.skipped_reason, "Cả ngày chỉ có chào hỏi và hẹn cà phê.");
  assert.equal(row.fb_url, null);
});

test("chạy lại khi không có gì mới thì không gọi Supabase", async () => {
  resetStore();
  seedDay("2026-08-10", 1_000);
  stubFetch();
  await runSyncPosts();

  const second = stubFetch();
  await runSyncPosts();
  assert.equal(second.length, 0);
});

test("ngày cũ được soạn lại (updated_at mới) thì được đẩy lại", async () => {
  resetStore();
  seedDay("2026-08-10", 1_000);
  stubFetch();
  await runSyncPosts();

  seedDay("2026-08-10", 5_000, "Hook mới sau khi soạn lại");
  const second = stubFetch();
  await runSyncPosts();

  assert.equal(second.length, 1);
  assert.equal(second[0]!.rows.length, 1);
  assert.equal(second[0]!.rows[0]!.main_caption, "Hook mới sau khi soạn lại");
});

test("--full bỏ qua con trỏ và đẩy lại toàn bộ", async () => {
  resetStore();
  seedDay("2026-08-10", 1_000);
  seedDay("2026-08-11", 2_000);
  stubFetch();
  await runSyncPosts();

  const second = stubFetch();
  await runSyncPosts(["--full"]);
  assert.equal(second[0]!.rows.length, 2);
});

test("nhiều ngày trùng updated_at vượt kích thước lô vẫn không sót ngày nào", async () => {
  resetStore();
  // Backfill chạy vòng lặp nhanh có thể ghi nhiều ngày trong cùng mili-giây.
  const expected: string[] = [];
  for (let i = 1; i <= 30; i += 1) {
    const dayDate = `2026-07-${String(i).padStart(2, "0")}`;
    seedDay(dayDate, 7_000);
    expected.push(dayDate);
  }
  const captured = stubFetch();

  await runSyncPosts();

  const pushed = captured.flatMap((req) => req.rows.map((r) => String(r.day_date))).sort();
  assert.deepEqual(pushed, expected.sort());
});

test("Supabase lỗi thì ném lỗi và KHÔNG tiến con trỏ", async () => {
  resetStore();
  seedDay("2026-08-10", 1_000);
  stubFetch(500);

  await assert.rejects(() => runSyncPosts(), /HTTP 500/);

  const retry = stubFetch();
  await runSyncPosts();
  assert.equal(retry.length, 1, "lần chạy sau phải đẩy lại ngày bị lỗi");
});

test("thiếu biến môi trường Supabase thì báo lỗi rõ ràng", async () => {
  resetStore();
  const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    await assert.rejects(() => runSyncPosts(), /SUPABASE_SERVICE_ROLE_KEY/);
  } finally {
    process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
  }
});
