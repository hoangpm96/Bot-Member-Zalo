import { test } from "node:test";
import assert from "node:assert/strict";
import { compileBlacklist, findBlacklistedWord } from "./moderation.js";

/**
 * Test matcher: nguyên từ + không phân biệt hoa/thường + GIỮ DẤU tiếng Việt.
 * Chạy: node --test (qua tsx) — xem package.json script "test".
 */

test("khớp nguyên từ, không phân biệt hoa/thường", () => {
  const c = compileBlacklist(["lừa đảo", "spam"]);
  assert.equal(findBlacklistedWord("đây là tin LỪA ĐẢO nhé", c), "lừa đảo");
  assert.equal(findBlacklistedWord("Spam Spam", c), "spam");
  assert.equal(findBlacklistedWord("tin nhắn bình thường", c), null);
});

test("KHÔNG khớp khi là substring của từ khác (nguyên từ)", () => {
  const c = compileBlacklist(["cam"]);
  // "cam" nằm trong "camera"/"amsterdam" → không được tính.
  assert.equal(findBlacklistedWord("mua camera mới", c), null);
  assert.equal(findBlacklistedWord("tôi ăn cam", c), "cam");
});

test("GIỮ DẤU: 'cấm' khác 'cam'", () => {
  const c = compileBlacklist(["cấm"]);
  assert.equal(findBlacklistedWord("hàng cấm bán ở đây", c), "cấm");
  assert.equal(findBlacklistedWord("ăn cam ngọt", c), null);
});

test("dấu câu quanh từ vẫn coi là ranh giới từ", () => {
  const c = compileBlacklist(["bậy"]);
  assert.equal(findBlacklistedWord("nói (bậy) thế!", c), "bậy");
  assert.equal(findBlacklistedWord("bậy.", c), "bậy");
});

test("cụm nhiều từ chỉ khớp khi xuất hiện đầy đủ", () => {
  const c = compileBlacklist(["mua bán súng"]);
  assert.equal(findBlacklistedWord("ai muốn mua bán súng không", c), "mua bán súng");
  assert.equal(findBlacklistedWord("mua bán đồ cũ", c), null);
});

test("danh sách rỗng / text rỗng → null", () => {
  assert.equal(findBlacklistedWord("bất kỳ", compileBlacklist([])), null);
  assert.equal(findBlacklistedWord("", compileBlacklist(["x"])), null);
});

test("chuẩn hoá NFC/NFD: khớp dù từ khoá và text khác dạng Unicode", () => {
  // "cấm" dạng NFD (c + a + dấu mũ tổ hợp + dấu nặng tổ hợp) phải khớp keyword NFC, và ngược lại.
  const nfd = "cấm".normalize("NFD");
  const nfc = "cấm".normalize("NFC");
  assert.notEqual(nfd, nfc); // chắc chắn 2 dạng khác bytes
  const cFromNfd = compileBlacklist([nfd]);
  assert.equal(findBlacklistedWord(`hàng ${nfc} nhé`, cFromNfd), nfd);
  const cFromNfc = compileBlacklist([nfc]);
  assert.equal(findBlacklistedWord(`hàng ${nfd} nhé`, cFromNfc), nfc);
});

test("ký tự regex trong từ khoá được escape (không vỡ)", () => {
  const c = compileBlacklist(["a.b", "c+d"]);
  assert.equal(findBlacklistedWord("axb", c), null); // '.' không phải wildcard
  assert.equal(findBlacklistedWord("a.b", c), "a.b");
  assert.equal(findBlacklistedWord("c+d", c), "c+d");
});
