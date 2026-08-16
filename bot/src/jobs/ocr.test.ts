import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeOcrLines } from "./ocr.js";

/**
 * Ba lượt đọc trên cùng một tấm ảnh nhìn thấy phần lớn cùng một thứ — gộp thô
 * là bản tin gửi cho model dài gấp ba mà không thêm thông tin nào.
 */
test("gộp ba lượt đọc, bỏ dòng đã thấy", () => {
  const merged = mergeOcrLines([
    "BUSINESS ANALYST\nThu nhập: Negotiable",
    "BUSINESS ANALYST\nHà Nội",
    "Thu nhập: Negotiable",
  ]);
  assert.equal(merged, "BUSINESS ANALYST\nThu nhập: Negotiable\nHà Nội");
});

test("bỏ mảnh vỡ của icon và đường kẻ", () => {
  const merged = mergeOcrLines(["|\n—\n. .\nTuyển Business Analyst\n(*&^"]);
  assert.equal(merged, "Tuyển Business Analyst");
});

/**
 * Lượt đọc toàn trang và lượt đọc theo dải cắt cùng một dòng ra hai kiểu khoảng
 * trắng khác nhau. Không chuẩn hoá thì "khử trùng" không khử được gì.
 */
test("coi khác nhau về khoảng trắng là cùng một dòng", () => {
  const merged = mergeOcrLines(["Mức lương:  20-27  triệu", "Mức lương: 20-27 triệu"]);
  assert.equal(merged, "Mức lương: 20-27 triệu");
});

test("giữ nguyên thứ tự xuất hiện, không sắp xếp lại", () => {
  const merged = mergeOcrLines(["Ứng tuyển ngay", "VTS tuyển dụng"]);
  assert.equal(merged, "Ứng tuyển ngay\nVTS tuyển dụng");
});
