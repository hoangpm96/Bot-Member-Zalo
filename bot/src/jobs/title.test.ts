import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeJobTitle } from "./title.js";

// Tên vị trí model bóc ra thường chép nguyên chữ viết tắt của bài gốc: "BA",
// "BA/PO", "Business Analyst (BA) Tiếng Nhật". Các bài dưới đây khoá đúng những
// chỗ dễ vỡ khi mở viết tắt ra trước lúc ghi vào kho.

test("mở viết tắt vị trí thành tên đầy đủ", () => {
  assert.equal(normalizeJobTitle("BA"), "Business Analyst");
  assert.equal(normalizeJobTitle("PO"), "Product Owner");
  assert.equal(normalizeJobTitle("PM"), "Project Manager");
  assert.equal(normalizeJobTitle("BrSE"), "Bridge System Engineer");
});

test("IT BA viết kiểu nào cũng ra IT Business Analyst", () => {
  assert.equal(normalizeJobTitle("IT BA"), "IT Business Analyst");
  assert.equal(normalizeJobTitle("ITBA"), "IT Business Analyst");
  assert.equal(normalizeJobTitle("IT-BA"), "IT Business Analyst");
});

test("viết tắt nằm giữa tiêu đề vẫn được mở, phần còn lại giữ nguyên", () => {
  assert.equal(normalizeJobTitle("Middle BA"), "Middle Business Analyst");
  assert.equal(normalizeJobTitle("BA Fintech"), "Business Analyst Fintech");
  assert.equal(normalizeJobTitle("Senior BA - Banking"), "Senior Business Analyst - Banking");
});

test("hai vị trí ghép bằng gạch chéo được nới ra cho dễ đọc", () => {
  assert.equal(normalizeJobTitle("BA/PO"), "Business Analyst / Product Owner");
  assert.equal(normalizeJobTitle("PO/BA"), "Product Owner / Business Analyst");
});

test("ngoặc lặp lại chính nó thì bỏ, ngoặc mang thông tin thì giữ", () => {
  assert.equal(normalizeJobTitle("Business Analyst (BA) Tiếng Nhật"), "Business Analyst Tiếng Nhật");
  assert.equal(normalizeJobTitle("BA (Banking)"), "Business Analyst (Banking)");
});

test("không có viết tắt thì trả nguyên văn", () => {
  const vietnamese = "Nhân viên nghiệp vụ hệ thống phần mềm";
  assert.equal(normalizeJobTitle(vietnamese), vietnamese);
  assert.equal(normalizeJobTitle("Business Analyst"), "Business Analyst");
  // Tiếng Việt có từ "ba" là số đếm — khớp cả chữ thường là hỏng cả câu.
  assert.equal(normalizeJobTitle("Tuyển ba bạn thực tập"), "Tuyển ba bạn thực tập");
});

test("chạy lại trên tên đã chuẩn hoá không đổi gì thêm", () => {
  // Lệnh vá dữ liệu cũ chạy nhiều lần là chuyện bình thường, không được xê dịch.
  for (const raw of ["BA/PO", "Middle BA", "Business Analyst (BA) Tiếng Nhật", "ITBA"]) {
    const once = normalizeJobTitle(raw);
    assert.equal(normalizeJobTitle(once), once);
  }
});

test("tiêu đề rỗng hoặc N/A không bị nắn thành gì khác", () => {
  assert.equal(normalizeJobTitle(""), "");
  assert.equal(normalizeJobTitle("N/A"), "N/A");
});
