import assert from "node:assert/strict";
import { test } from "node:test";
import { NA, normalizeExtracted } from "./extract.js";

test("thiếu trường nào thì thành N/A, không để trống", () => {
  const job = normalizeExtracted({ is_job: true, title: "Business Analyst", risk_level: "ok" });

  assert.equal(job.title, "Business Analyst");
  assert.equal(job.company, NA);
  assert.equal(job.salary, NA);
  assert.equal(job.location, NA);
  assert.equal(job.deadline, NA);
  assert.equal(job.contact, NA);
  assert.deepEqual(job.skills, []);
});

test("model trả 'không có' hay chuỗi rỗng cũng quy về N/A", () => {
  const job = normalizeExtracted({
    is_job: true,
    title: "BA",
    company: "  ",
    salary: "không có",
    location: "Unknown",
    risk_level: "ok",
  });

  assert.equal(job.company, NA);
  assert.equal(job.salary, NA);
  assert.equal(job.location, NA);
});

test("skills lọc rác và cắt còn tối đa 8", () => {
  const job = normalizeExtracted({
    is_job: true,
    title: "BA",
    risk_level: "ok",
    skills: ["SQL", "", 42, "banking", "BPMN", "a", "b", "c", "d", "e", "f"],
  });

  assert.equal(job.skills.length, 8);
  assert.deepEqual(job.skills.slice(0, 3), ["SQL", "banking", "BPMN"]);
});

test("risk_level lạ được coi là đáng ngờ chứ không mặc định cho qua", () => {
  assert.equal(normalizeExtracted({ is_job: true, title: "BA" }).risk_level, "suspect");
  assert.equal(normalizeExtracted({ is_job: true, title: "BA", risk_level: "hmm" }).risk_level, "suspect");
  assert.equal(normalizeExtracted({ is_job: true, title: "BA", risk_level: "ok" }).risk_level, "ok");
});

test("không phải tin tuyển dụng thì is_job=false và giữ lý do", () => {
  const job = normalizeExtracted({
    is_job: false,
    reject_reason: "Ứng viên tự giới thiệu tìm việc.",
    risk_level: "ok",
  });

  assert.equal(job.is_job, false);
  assert.equal(job.reject_reason, "Ứng viên tự giới thiệu tìm việc.");
});
