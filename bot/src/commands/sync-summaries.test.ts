import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Test lệnh sync-summaries trên một SQLite tạm + fetch giả.
 * Chạy: npm test (node --import tsx --test).
 *
 * SQLITE_DB_PATH phải được set TRƯỚC khi import config/db (config đọc env lúc
 * import), nên phần import ở đây là dynamic import sau khi gán env.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-sync-summaries-"));
process.env.SQLITE_DB_PATH = path.join(tmpDir, "test.db");
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";

const { saveDailySummary, getDb } = await import("../db/index.js");
const { runSyncSummaries } = await import("./sync-summaries.js");

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

function seedDay(dayDate: string, createdAt: number, summaryText = "📢 THÔNG BÁO\n- có tin"): void {
  saveDailySummary({
    dayDate,
    dayLabel: dayDate.split("-").reverse().join("/"),
    dayStartTs: Date.parse(`${dayDate}T00:00:00+07:00`),
    threadId: "thread-1",
    summaryText,
    parts: ["phần 1"],
    totalMessages: 85,
    includedMessages: 80,
    uniqueSenders: 14,
    images: 4,
    videos: 0,
    topSenders: ["Lucas (27)", "Võ Phương (18)"],
    model: "deepseek-v4-flash",
    transcriptChars: 1234,
    source: "live",
    now: createdAt,
  });
}

function resetStore(): void {
  const db = getDb();
  db.prepare("DELETE FROM daily_summaries").run();
  db.prepare("DELETE FROM bot_state").run();
}

test("đẩy toàn bộ kho khi chưa có con trỏ, đúng payload", async () => {
  resetStore();
  seedDay("2026-08-10", 1_000);
  seedDay("2026-08-11", 2_000);
  const captured = stubFetch();

  await runSyncSummaries();

  assert.equal(captured.length, 1);
  assert.match(captured[0]!.url, /\/rest\/v1\/zalo_daily_summaries\?on_conflict=day_date$/);
  assert.deepEqual(
    captured[0]!.rows.map((r) => r.day_date),
    ["2026-08-10", "2026-08-11"],
  );

  const row = captured[0]!.rows[1]!;
  assert.equal(row.day_label, "11/08/2026");
  assert.equal(row.total_messages, 85);
  assert.equal(row.unique_senders, 14);
  assert.deepEqual(row.top_senders, ["Lucas (27)", "Võ Phương (18)"]);
  assert.equal(row.model, "deepseek-v4-flash");
  assert.equal(typeof row.synced_at, "string");
});

test("KHÔNG gửi cột is_published (không bật lại ngày admin đã ẩn) và không gửi dữ liệu nhạy cảm", async () => {
  resetStore();
  seedDay("2026-08-10", 1_000);
  const captured = stubFetch();

  await runSyncSummaries();

  const keys = Object.keys(captured[0]!.rows[0]!);
  assert.ok(!keys.includes("is_published"), `payload không được có is_published: ${keys}`);
  for (const forbidden of ["zalo_user_id", "parts_json", "parts", "transcript_chars", "thread_id"]) {
    assert.ok(!keys.includes(forbidden), `payload không được có ${forbidden}`);
  }
});

test("chạy lại khi không có gì mới thì không gọi Supabase", async () => {
  resetStore();
  seedDay("2026-08-10", 1_000);
  stubFetch();
  await runSyncSummaries();

  const second = stubFetch();
  await runSyncSummaries();
  assert.equal(second.length, 0);
});

test("ngày cũ được tóm tắt lại (created_at mới) thì được đẩy lại", async () => {
  resetStore();
  seedDay("2026-08-10", 1_000);
  stubFetch();
  await runSyncSummaries();

  seedDay("2026-08-10", 5_000, "📢 THÔNG BÁO\n- bản sửa");
  const second = stubFetch();
  await runSyncSummaries();

  assert.equal(second.length, 1);
  assert.equal(second[0]!.rows.length, 1);
  assert.equal(second[0]!.rows[0]!.summary_text, "📢 THÔNG BÁO\n- bản sửa");
});

test("--full bỏ qua con trỏ và đẩy lại toàn bộ", async () => {
  resetStore();
  seedDay("2026-08-10", 1_000);
  seedDay("2026-08-11", 2_000);
  stubFetch();
  await runSyncSummaries();

  const second = stubFetch();
  await runSyncSummaries(["--full"]);
  assert.equal(second[0]!.rows.length, 2);
});

test("nhiều ngày trùng created_at vượt kích thước lô vẫn không sót ngày nào", async () => {
  resetStore();
  // Backfill chạy vòng lặp nhanh có thể ghi nhiều ngày trong cùng mili-giây.
  const expected: string[] = [];
  for (let i = 1; i <= 30; i += 1) {
    const dayDate = `2026-07-${String(i).padStart(2, "0")}`;
    seedDay(dayDate, 7_000);
    expected.push(dayDate);
  }
  const captured = stubFetch();

  await runSyncSummaries();

  const pushed = captured.flatMap((req) => req.rows.map((r) => String(r.day_date))).sort();
  assert.deepEqual(pushed, expected.sort());
});

test("Supabase lỗi thì ném lỗi và KHÔNG tiến con trỏ", async () => {
  resetStore();
  seedDay("2026-08-10", 1_000);
  stubFetch(500);

  await assert.rejects(() => runSyncSummaries(), /HTTP 500/);

  const retry = stubFetch();
  await runSyncSummaries();
  assert.equal(retry.length, 1, "lần chạy sau phải đẩy lại ngày bị lỗi");
});

test("thiếu biến môi trường Supabase thì báo lỗi rõ ràng", async () => {
  resetStore();
  const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    await assert.rejects(() => runSyncSummaries(), /SUPABASE_SERVICE_ROLE_KEY/);
  } finally {
    process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
  }
});
