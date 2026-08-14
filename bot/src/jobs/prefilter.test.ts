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

/**
 * Tin thật lấy nguyên văn từ topic tuyển dụng Telegram của nhóm.
 *
 * Bản đầu của cổng lọc chặn nhầm cái thứ nhất: nó viết tắt "kn" thay vì "kinh
 * nghiệm" và nói "tìm 1 bạn" thay vì "tuyển", nên không trúng từ khoá nào. Giữ
 * nguyên văn ở đây để lần sau ai siết danh sách tín hiệu thì test đỏ ngay, thay
 * vì phải phát hiện bằng mắt khi trang tuyển dụng trống trơn.
 */
test("tin ngắn viết kiểu nói chuyện vẫn phải lọt qua cổng", () => {
  assert.equal(
    looksLikeJobPost(
      "Mình tìm 1 bạn BA từ 3-4 năm kn, tiếng Anh đọc hiểu. Có kn về mảng mobile app " +
        "hoặc high traffic. Làm việc ở Đống Đa, HN.",
    ),
    true,
  );
  assert.equal(
    looksLikeJobPost(
      "🚀 [TUYỂN DỤNG GẤP] BUSINESS ANALYST_ CẦU GIẤY HÀ NỘI Team chúng mình đang tìm " +
        "kiếm 3 Business Analyst để đồng hành cùng các dự án mới trong năm 2026.",
    ),
    true,
  );
  assert.equal(
    looksLikeJobPost("hiện bên mình đang tuyển BA Fintech từ 2 năm kn & tiếng anh tốt"),
    true,
  );
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
