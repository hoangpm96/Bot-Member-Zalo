import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fingerprintOf,
  isSameJob,
  jobFingerprint,
  jobKeys,
  mergeSources,
  normalizeKey,
  normalizeLocation,
  normalizeRole,
  normalizeSalary,
} from "./dedupe.js";

test("chuẩn hoá bỏ dấu và ký tự trang trí", () => {
  assert.equal(normalizeKey("Business Analyst — Ngân hàng 🏦"), "business analyst ngan hang");
  assert.equal(normalizeKey("Cầu Giấy, Hà Nội"), "cau giay ha noi");
  assert.equal(normalizeKey("Đà Nẵng"), "da nang");
});

test("lương quy về con số nên đổi cách viết vẫn khớp", () => {
  assert.equal(normalizeSalary("Up to 35M gross"), "35");
  assert.equal(normalizeSalary("upto 35M GROSS ✨"), "35");
  assert.equal(normalizeSalary("30-36M gross"), "30 36");
  assert.equal(normalizeSalary("N/A"), "");
});

const BASE = {
  company: "N/A",
  title: "Business Analyst",
  level: "Senior",
  salary: "Up to 35M gross",
  location: "Lê Văn Lương, Hà Nội",
  author: "Trần Bảo Thoa",
};

test("cùng HR đăng lại với emoji và cách viết khác vẫn ra cùng chữ ký", () => {
  const again = {
    ...BASE,
    title: "business analyst",
    salary: "🥰 upto 35M Gross",
    location: "Lê Văn Lương, HÀ NỘI",
  };
  assert.equal(jobFingerprint(BASE), jobFingerprint(again));
});

test("khác vị trí hoặc khác lương thì là tin khác", () => {
  assert.notEqual(jobFingerprint(BASE), jobFingerprint({ ...BASE, title: "Product Owner" }));
  assert.notEqual(jobFingerprint(BASE), jobFingerprint({ ...BASE, salary: "Up to 25M gross" }));
});

test("có tên công ty thì lấy công ty làm mỏ neo, không phụ thuộc người đăng", () => {
  const a = { ...BASE, company: "CFC Technology", author: "HR A" };
  const b = { ...BASE, company: "cfc technology", author: "HR B" };
  assert.equal(jobFingerprint(a), jobFingerprint(b));
});

test("không có tên công ty thì hai HR khác nhau là hai tin", () => {
  const a = { ...BASE, author: "HR A" };
  const b = { ...BASE, author: "HR B" };
  assert.notEqual(jobFingerprint(a), jobFingerprint(b));
});

test("viết tắt vị trí quy về cùng một khoá", () => {
  assert.equal(normalizeRole("BA"), normalizeRole("Business Analyst"));
  assert.equal(normalizeRole("PO"), normalizeRole("Product Owner"));
  // Thứ tự trong tiêu đề ghép không được tạo ra hai tin khác nhau.
  assert.equal(normalizeRole("BA/PO"), normalizeRole("PO/BA"));
  assert.equal(normalizeRole("BA/PO"), "business analyst|product owner");
  assert.notEqual(normalizeRole("BA"), normalizeRole("PO"));
});

test("viết tắt nằm giữa tiêu đề cũng được mở, không chỉ khi đứng một mình", () => {
  assert.equal(normalizeRole("BA Fintech"), "business analyst fintech");
  assert.equal(normalizeRole("BA Leader"), "business analyst leader");
  // "IT BA" là một cụm, không phải chữ "IT" đứng cạnh chữ "BA".
  assert.equal(normalizeRole("IT BA"), normalizeRole("ITBA"));
  assert.equal(normalizeRole("IT BA"), "it business analyst");
  assert.notEqual(normalizeRole("IT BA"), normalizeRole("BA"));
});

test("cấp bậc trong tiêu đề không đẻ ra tin mới, nhưng cột level thì có", () => {
  // "BA" và "Middle BA" là một vị trí viết hai kiểu.
  assert.equal(normalizeRole("Middle BA"), normalizeRole("Business Analyst"));
  assert.equal(normalizeRole("Junior-Middle Business Analyst"), "business analyst");
  assert.equal(jobFingerprint(BASE), jobFingerprint({ ...BASE, title: "Senior BA" }));
  // ...còn cấp bậc bóc ra được thì vẫn tách hai đợt tuyển khác nhau.
  assert.notEqual(jobFingerprint(BASE), jobFingerprint({ ...BASE, level: "Junior" }));
  // Lead/Manager là tên vị trí thật, không phải chữ chỉ cấp bậc để gạt đi.
  assert.notEqual(normalizeRole("BA Leader"), normalizeRole("BA"));
});

test("đăng lại rơi rụng bớt thông tin vẫn là một tin", () => {
  const dayOne = jobKeys(BASE);
  // Hôm nay đăng lại: viết tắt vị trí, quên mức lương, ghi mỗi "Hà Nội".
  const dayThree = jobKeys({
    ...BASE,
    title: "Senior BA",
    level: "N/A",
    salary: "N/A",
    location: "Hà Nội",
  });

  assert.notEqual(fingerprintOf(dayOne), fingerprintOf(dayThree));
  assert.ok(isSameJob(dayOne, dayThree));
});

test("trường nào cả hai bên đều nêu mà khác nhau thì là hai tin", () => {
  const base = jobKeys(BASE);
  assert.ok(!isSameJob(base, jobKeys({ ...BASE, salary: "Up to 25M gross" })));
  assert.ok(!isSameJob(base, jobKeys({ ...BASE, location: "Đà Nẵng" })));
  assert.ok(!isSameJob(base, jobKeys({ ...BASE, level: "Junior" })));
  assert.ok(!isSameJob(base, jobKeys({ ...BASE, title: "Product Owner" })));
  assert.ok(!isSameJob(base, jobKeys({ ...BASE, author: "HR khác" })));
});

test("không có mỏ neo nào thì không được gộp", () => {
  // Bài giấu cả tên công ty lẫn tên người đăng: chỉ còn vị trí, không đủ để nói
  // hai tin là một.
  const anon = jobKeys({ ...BASE, company: "N/A", author: "" });
  assert.ok(!isSameJob(anon, anon));
});

test("nơi làm việc quy về thành phố, bỏ chi tiết đường/quận", () => {
  assert.equal(normalizeLocation("Lê Văn Lương, HN"), "hanoi");
  assert.equal(normalizeLocation("Cầu Giấy, Hà Nội"), "hanoi");
  assert.equal(normalizeLocation("Phường Thủ Thiêm, TP. Hồ Chí Minh"), "hcm");
  assert.equal(normalizeLocation("Quận 1, HCM"), "hcm");
  assert.equal(normalizeLocation("222-224 Ngũ Hành Sơn, Đà Nẵng"), "danang");
  assert.notEqual(normalizeLocation("Hà Nội"), normalizeLocation("Đà Nẵng"));
  assert.equal(normalizeLocation("N/A"), "");
});

test("cùng tin viết 'HN' và 'Hà Nội' là MỘT tin", () => {
  const a = { ...BASE, title: "BA/PO", location: "Lê Văn Lương, HN" };
  const b = { ...BASE, title: "PO/BA", location: "Lê Văn Lương, Hà Nội" };
  assert.equal(jobFingerprint(a), jobFingerprint(b));
});

test("gộp nguồn: mới nhất trước, không nhân đôi cùng một link", () => {
  const fb = { source: "facebook", url: "https://fb.com/1", posted_at: 100 };
  const tg = { source: "telegram", url: "https://t.me/c/1/2", posted_at: 200 };

  assert.deepEqual(mergeSources([fb], tg), [tg, fb]);
  assert.deepEqual(mergeSources([fb], fb), [fb]);
});
