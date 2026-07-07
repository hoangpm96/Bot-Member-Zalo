import { test } from "node:test";
import assert from "node:assert/strict";
import { extractText, extractMediaSummary } from "./message-extract.js";

/**
 * Test rút text/media từ payload zca-js. Chạy: npm test.
 * Bối cảnh bug 7/7/2026: tin chứa link không ghi vào /messages vì content là object.
 */

const msg = (data: Record<string, unknown>) => ({ data });

test("text thuần: rút đúng, trim khoảng trắng", () => {
  assert.equal(extractText(msg({ content: "  chào cả nhà  " })), "chào cả nhà");
  assert.equal(extractText(msg({ content: "   " })), null);
  assert.equal(extractText(msg({ content: "" })), null);
});

test("link (chat.link): ghép title — description — href", () => {
  const payload = msg({
    msgType: "chat.link",
    content: {
      title: "Bài viết hay",
      description: "Mô tả ngắn",
      href: "https://example.com/abc",
      thumb: "https://example.com/t.jpg",
    },
  });
  assert.equal(extractText(payload), "Bài viết hay — Mô tả ngắn — https://example.com/abc");
});

test("link: khử trùng lặp khi title trùng description", () => {
  const payload = msg({
    msgType: "chat.link",
    content: { title: "Zalo", description: "Zalo", href: "https://zalo.me" },
  });
  assert.equal(extractText(payload), "Zalo — https://zalo.me");
});

test("link chỉ có href", () => {
  const payload = msg({ msgType: "chat.link", content: { href: "https://x.vn" } });
  assert.equal(extractText(payload), "https://x.vn");
});

test("recommend (chat.recommended): cũng rút được", () => {
  const payload = msg({
    msgType: "chat.recommended",
    content: { title: "Danh thiếp", description: "0900", href: "" },
  });
  assert.equal(extractText(payload), "Danh thiếp — 0900");
});

test("ảnh (chat.photo): KHÔNG rút text (đi vào media event, tránh double-count)", () => {
  const payload = msg({
    msgType: "chat.photo",
    content: { href: "https://photo-cdn/abc.jpg", thumb: "https://photo-cdn/t.jpg", title: "" },
  });
  assert.equal(extractText(payload), null);
  const media = extractMediaSummary(payload);
  assert.deepEqual(media, { type: "image", count: 1 });
});

test("video (chat.video.msg): media, không rút text", () => {
  const payload = msg({ msgType: "chat.video.msg", content: { href: "https://v/abc.mp4" } });
  assert.equal(extractText(payload), null);
  assert.deepEqual(extractMediaSummary(payload), { type: "video", count: 1 });
});

test("ảnh nhiều tấm: đếm childnumber", () => {
  const payload = msg({ msgType: "chat.photo", content: { childnumber: 3, href: "x" } });
  assert.deepEqual(extractMediaSummary(payload), { type: "image", count: 3 });
});

test("content object rỗng/không nhận diện: null cả hai", () => {
  const payload = msg({ msgType: "chat.sticker", content: { catId: 1 } });
  assert.equal(extractText(payload), null);
  assert.equal(extractMediaSummary(payload), null);
});
