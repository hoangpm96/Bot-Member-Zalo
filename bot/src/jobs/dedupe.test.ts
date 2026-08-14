import assert from "node:assert/strict";
import { test } from "node:test";
import {
  jobFingerprint,
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
