import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildNamePatterns,
  findLeakedNames,
  genericLabel,
  maskNames,
} from "./name-scrub.js";

// Danh bạ thật của group có đủ kiểu: tên một chữ, hai chữ, họ tên đầy đủ.
const DANH_BA = [
  "Linh",
  "Quỳnh",
  "Anh",
  "Hoàng Phan",
  "Thu Thảo",
  "Bùi Thị Thanh Phương",
  "  Tạ   Minh  ",
];

test("chỉ dò tên từ hai chữ trở lên", () => {
  const patterns = buildNamePatterns(DANH_BA).map((p) => p.name);

  assert.ok(patterns.includes("Hoàng Phan"));
  assert.ok(patterns.includes("Bùi Thị Thanh Phương"));
  for (const single of ["Linh", "Quỳnh", "Anh"]) {
    assert.ok(!patterns.includes(single), `tên một chữ "${single}" không được dò`);
  }
});

test("tên dài sinh thêm mẫu hai chữ cuối, và mẫu dài đứng trước", () => {
  const patterns = buildNamePatterns(["Bùi Thị Thanh Phương"]).map((p) => p.name);
  assert.deepEqual(patterns, ["Bùi Thị Thanh Phương", "Thanh Phương"]);
});

test("khoảng trắng thừa trong danh bạ không sinh mẫu rác", () => {
  assert.deepEqual(
    buildNamePatterns(["  Tạ   Minh  ", "", "   "]).map((p) => p.name),
    ["Tạ Minh"],
  );
});

test("bắt được tên trong câu, không phân biệt hoa thường", () => {
  const patterns = buildNamePatterns(DANH_BA);
  const text = "Mình và hoàng phan của 5 năm trước khác xa nhau.";
  assert.deepEqual(findLeakedNames(text, patterns), ["Hoàng Phan"]);
});

test("gọi bằng hai chữ cuối vẫn bị bắt", () => {
  const patterns = buildNamePatterns(["Bùi Thị Thanh Phương"]);
  assert.deepEqual(
    findLeakedNames("Chị Thanh Phương chia sẻ cách ước lượng effort.", patterns),
    ["Thanh Phương"],
  );
});

test("KHÔNG bắt nhầm khi tên chỉ là một phần của chữ khác", () => {
  const patterns = buildNamePatterns(["Tạ Minh", "Thu Thảo"]);
  // "Tạ Minhh" và "Thu Thảongon" không phải tên — \b của JS coi chữ có dấu là
  // ranh giới nên chỗ này từng bắt nhầm.
  assert.deepEqual(findLeakedNames("Tạ Minhh và Thu Thảongon", patterns), []);
});

test("chữ thường trùng âm với tên một chữ không bị đụng tới", () => {
  const patterns = buildNamePatterns(DANH_BA);
  const text = "Cần linh hoạt, anh em trong nhóm ai cũng bận.";
  assert.deepEqual(findLeakedNames(text, patterns), []);
});

test("gọi findLeakedNames nhiều lần cho cùng kết quả (không kẹt lastIndex)", () => {
  const patterns = buildNamePatterns(["Hoàng Phan"]);
  const text = "Hoàng Phan nói vậy.";
  assert.deepEqual(findLeakedNames(text, patterns), ["Hoàng Phan"]);
  assert.deepEqual(findLeakedNames(text, patterns), ["Hoàng Phan"]);
});

test("maskNames thay mọi lần xuất hiện, mỗi tên một nhãn cố định", () => {
  const text = "Hoàng Phan nói A, còn Thu Thảo nói B. Hoàng Phan chốt lại.";
  const masked = maskNames(text, ["Hoàng Phan", "Thu Thảo"]);

  assert.equal(masked, "bạn A nói A, còn bạn B nói B. bạn A chốt lại.");
  assert.ok(!masked.includes("Hoàng Phan"));
  assert.ok(!masked.includes("Thu Thảo"));
});

test("nhãn chung chung chạy theo bảng chữ cái", () => {
  assert.equal(genericLabel(0), "bạn A");
  assert.equal(genericLabel(2), "bạn C");
});
