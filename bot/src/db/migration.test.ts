import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";

/**
 * DB ĐANG CHẠY phải mở được sau khi code thêm cột mới.
 *
 * Đây là bài kiểm tái hiện đúng sự cố ngày 16/08/2026: index của một cột vừa
 * thêm được đặt trong schema.sql, mà file đó chạy TRƯỚC bước thêm cột. Bảng cũ
 * chưa có cột nên câu CREATE INDEX gãy ngay trong getDb() — cửa vào của mọi
 * lệnh — và listener chết theo, giữa lúc đang chạy thật.
 *
 * Cách dựng: tạo sẵn bảng job_raw theo hình dạng CŨ. schema.sql dùng
 * CREATE TABLE IF NOT EXISTS nên sẽ bỏ qua bảng này, đúng như trên máy chủ.
 */
test("DB cũ thiếu cột vẫn mở được sau khi thêm cột mới", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bot-db-migration-"));
  const dbPath = path.join(dir, "old.db");

  try {
    const old = new Database(dbPath);
    old.exec(`
      CREATE TABLE job_raw (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        source       TEXT NOT NULL,
        source_id    TEXT NOT NULL,
        author       TEXT NOT NULL DEFAULT '',
        source_url   TEXT,
        text         TEXT NOT NULL,
        posted_at    INTEGER NOT NULL,
        processed_at INTEGER,
        is_job       INTEGER,
        created_at   INTEGER NOT NULL,
        UNIQUE (source, source_id)
      );
      INSERT INTO job_raw (source, source_id, author, source_url, text, posted_at, created_at)
      VALUES ('facebook', '1', 'Ai đó', NULL, 'Tuyển Business Analyst', 1000, 1000);
    `);
    old.close();

    process.env.SQLITE_DB_PATH = dbPath;
    const db = await import("./index.js");

    // Chạm vào DB: nếu migration sai thứ tự thì chính dòng này ném SqliteError.
    assert.equal(db.getLatestJobRawPostedAt("facebook"), 1000);

    // Cột mới phải có mặt, và dữ liệu cũ không mất.
    const check = new Database(dbPath, { readonly: true });
    const columns = (check.prepare("PRAGMA table_info(job_raw)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    assert.ok(columns.includes("text_hash"), "thiếu cột text_hash");
    assert.ok(columns.includes("image_urls"), "thiếu cột image_urls");
    assert.ok(columns.includes("ocr_text"), "thiếu cột ocr_text");

    const indexes = (check.prepare("PRAGMA index_list(job_raw)").all() as { name: string }[]).map(
      (i) => i.name,
    );
    assert.ok(indexes.includes("idx_job_raw_text_hash"), "thiếu index cho vân tay nội dung");
    check.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
