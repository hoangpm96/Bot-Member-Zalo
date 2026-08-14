import assert from "node:assert/strict";
import { test } from "node:test";
import { descriptionFor } from "./daily-jobs.js";

const CHAT = "có kèo BA onsite VCB, lương 50tr\nkhông check payslip, vừa mồm là quất\nvắt cực khô";
const CLEAN = "Vị trí BA làm onsite tại ngân hàng VCB, dự án 2 năm, lương khoảng 50 triệu.";

test("bài Facebook giữ nguyên văn", () => {
  assert.equal(
    descriptionFor({ source: "facebook", text: CHAT }, { clean_description: CLEAN, summary: "x" }),
    CHAT,
  );
});

test("chat Zalo dùng bản đã dọn, không đăng nguyên văn", () => {
  const out = descriptionFor(
    { source: "zalo", text: CHAT },
    { clean_description: CLEAN, summary: "x" },
  );
  assert.equal(out, CLEAN);
  assert.ok(!out.includes("vừa mồm là quất"));
});

test("không dọn được thì lùi về tóm tắt", () => {
  assert.equal(
    descriptionFor({ source: "telegram", text: CHAT }, { clean_description: "", summary: "Tóm tắt" }),
    "Tóm tắt",
  );
});

test("không có gì cả thì mới dùng nguyên văn", () => {
  assert.equal(
    descriptionFor({ source: "zalo", text: CHAT }, { clean_description: "", summary: "" }),
    CHAT,
  );
});
