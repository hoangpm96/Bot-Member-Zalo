import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikeJobPost, prefilterJobItems } from "./prefilter.js";
import type { RawJobItem } from "./types.js";

test("cho qua tin tuyển dụng viết kiểu nói", () => {
  assert.ok(looksLikeJobPost("Team mình đang cần tuyển 1 bạn BA fresher, ai quan tâm ib mình nhé"));
  assert.ok(looksLikeJobPost("[Cầu Giấy, HN] Em tìm #BA min 4 exp, offer upto 35M gross"));
  assert.ok(looksLikeJobPost("Bên mình đang có 2 headcount Product Owner, làm onsite Hà Nội"));
  assert.ok(looksLikeJobPost("Có bạn nào muốn apply vị trí này không, lương 20-25 triệu"));
});

test("cho qua cả khi gõ không dấu", () => {
  assert.ok(looksLikeJobPost("Ben minh dang tuyen BA co kinh nghiem 2 nam, luong thoa thuan"));
});

test("gạt chuyện phiếm trong nhóm", () => {
  assert.equal(looksLikeJobPost("ok bác"), false);
  assert.equal(looksLikeJobPost("Chào cả nhà, chúc mọi người buổi sáng tốt lành nhé"), false);
  assert.equal(
    looksLikeJobPost("Cho mình hỏi tài liệu BPMN nào dễ đọc cho người mới bắt đầu với ạ"),
    false,
  );
  assert.equal(looksLikeJobPost("Hôm nay trời đẹp quá mọi người ơi, cuối tuần vui vẻ"), false);
});

test("cụm quá ngắn bị gạt dù có từ khoá", () => {
  assert.equal(looksLikeJobPost("tuyển"), false);
  assert.equal(looksLikeJobPost("job"), false);
});

function item(source: RawJobItem["source"], text: string): RawJobItem {
  return { source, sourceId: "1", author: "A", sourceUrl: null, text, postedAt: 0 };
}

test("bài Facebook đi thẳng, không qua cổng lọc", () => {
  const chitchat = "Chào cả nhà, chúc mọi người buổi sáng tốt lành nhé";
  assert.equal(prefilterJobItems([item("facebook", chitchat)]).length, 1);
  assert.equal(prefilterJobItems([item("zalo", chitchat)]).length, 0);
});

test("Zalo và Telegram chỉ giữ cụm có dấu hiệu tuyển dụng", () => {
  const items = [
    item("zalo", "Chào cả nhà, chúc mọi người buổi sáng tốt lành nhé"),
    item("zalo", "Bên mình cần tuyển BA 2 năm kinh nghiệm, lương up to 25M"),
    item("telegram", "hóng ạ"),
  ];
  assert.equal(prefilterJobItems(items).length, 1);
});
