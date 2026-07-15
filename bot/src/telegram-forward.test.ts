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
  assert.match(result, /^💬 Zalo · Nguyễn An/m);
  assert.match(result, /Chào nhóm\n📎 Album 2 ảnh/);
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
  assert.match(result, /^💬 Zalo · 456/m);
  assert.match(result, /🏷️ Sticker$/);
});
