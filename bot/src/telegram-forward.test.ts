import { test } from "node:test";
import assert from "node:assert/strict";
import { formatZaloForward } from "./telegram-forward.js";

test("format forward gồm nguồn, người gửi, text và media", () => {
  const result = formatZaloForward({
    senderId: "123",
    displayName: "Nguyễn An",
    text: "Chào nhóm",
    msgType: "chat.photo",
    media: { type: "image", count: 2, url: "https://example/a.jpg" },
    ts: new Date("2026-07-15T03:30:00.000Z").getTime(),
  });
  assert.equal(result, "<b>Nguyễn An:</b> Chào nhóm\n🖼️ 2 ảnh");
});

test("format forward dùng sender id và mô tả sticker khi thiếu text", () => {
  const result = formatZaloForward({
    senderId: "456",
    displayName: "",
    text: null,
    msgType: "chat.sticker",
    media: null,
    ts: 0,
  });
  assert.equal(result, "<b>456:</b> 🏷️ Sticker");
});

test("format forward escape HTML từ tên và nội dung Zalo", () => {
  const result = formatZaloForward({
    senderId: "789",
    displayName: "A <B>",
    text: "x < y & z > 0",
    msgType: "webchat",
    media: null,
    ts: 0,
  });
  assert.equal(result, "<b>A &lt;B&gt;:</b> x &lt; y &amp; z &gt; 0");
});
