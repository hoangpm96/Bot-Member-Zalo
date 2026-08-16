import assert from "node:assert/strict";
import { test } from "node:test";

// Thứ hạng ưu tiên group đọc từ env lúc nạp config, nên phải khai TRƯỚC khi
// import module — bahubvn đứng đầu chính là điều các test dưới đây kiểm.
process.env.JOB_FB_GROUP_SLUG = "bahubvn,vieclambusinessanalyst";

const { descriptionFor, shouldPromoteSource } = await import("./daily-jobs.js");

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

const BAHUB = "https://www.facebook.com/groups/bahubvn/posts/1/";
const VLBA = "https://www.facebook.com/groups/vieclambusinessanalyst/posts/2/";

/**
 * Tin đăng ở group bạn trước, group nhà sau. Không đổi link chính thì trang
 * bahub.vn dẫn người đọc sang group của người khác chỉ vì hôm đó bên kia đăng
 * sớm hơn nửa ngày.
 */
test("tin trùng: link chính chuyển về group đứng đầu danh sách", () => {
  assert.equal(
    shouldPromoteSource(
      { source: "facebook", source_url: VLBA },
      { source: "facebook", sourceUrl: BAHUB },
    ),
    true,
  );
});

test("group hạng thấp không cướp được link chính của group nhà", () => {
  assert.equal(
    shouldPromoteSource(
      { source: "facebook", source_url: BAHUB },
      { source: "facebook", sourceUrl: VLBA },
    ),
    false,
  );
});

test("cùng một group thì không có gì để đổi", () => {
  assert.equal(
    shouldPromoteSource(
      { source: "facebook", source_url: BAHUB },
      { source: "facebook", sourceUrl: BAHUB },
    ),
    false,
  );
});

/**
 * Tin Zalo không có link công khai để trỏ tới, và đổi qua đổi lại giữa các loại
 * nguồn thì link trên trang nhảy loạn theo từng ngày.
 */
test("nguồn ngoài Facebook không tham gia đổi link chính", () => {
  assert.equal(
    shouldPromoteSource(
      { source: "facebook", source_url: VLBA },
      { source: "zalo", sourceUrl: null },
    ),
    false,
  );
  assert.equal(
    shouldPromoteSource(
      { source: "zalo", source_url: null },
      { source: "facebook", sourceUrl: BAHUB },
    ),
    false,
  );
});
