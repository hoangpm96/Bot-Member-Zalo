import assert from "node:assert/strict";
import test from "node:test";
import { looksOutOfCredit } from "./fb-post.js";

test("nhận ra lỗi hết số dư để cảnh báo đúng cách nạp tiền", () => {
  for (const reason of [
    "HTTP 402: Payment Required",
    'HTTP 400: {"error":{"message":"Insufficient balance"}}',
    "quota exceeded for this month",
    "billing account is not active",
    "tài khoản hết tiền",
  ]) {
    assert.equal(looksOutOfCredit(reason), true, reason);
  }
});

test("không quy lỗi kỹ thuật thành hết tiền", () => {
  for (const reason of [
    "HTTP 500: internal server error",
    "The operation was aborted due to timeout",
    "chưa cấu hình FB_IMAGE_BASE_URL/FB_IMAGE_API_KEY/FB_IMAGE_MODEL",
    "response không có data",
    // 402 chỉ tính khi đứng riêng, không phải khi nằm trong một con số dài.
    "HTTP 500: request id 9402213 failed",
  ]) {
    assert.equal(looksOutOfCredit(reason), false, reason);
  }
});
