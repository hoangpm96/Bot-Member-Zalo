import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTranscript,
  composeSummaryMessages,
  previousDayWindowVN,
  sanitizeDisplayName,
  topSenders,
  truncateSafe,
  MAX_SUMMARY_PARTS,
  SUMMARY_MAX_CHARS,
} from "./summary.js";
import type { GroupMessageRow } from "./db/index.js";

/** true nếu chuỗi chứa lone surrogate (emoji bị xẻ đôi). */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function msg(overrides: Partial<GroupMessageRow>): GroupMessageRow {
  return {
    zalo_user_id: "u1",
    display_name: "An",
    text: "xin chào",
    ts: Date.UTC(2026, 7, 10, 3, 0, 0), // 10:00 giờ VN
    ...overrides,
  };
}

test("previousDayWindowVN: chạy 7:30 sáng VN → khung trọn ngày hôm trước theo giờ VN", () => {
  // 2026-08-11 07:30 VN = 2026-08-11T00:30:00Z
  const now = Date.UTC(2026, 7, 11, 0, 30, 0);
  const w = previousDayWindowVN(now);
  assert.equal(w.label, "10/08/2026");
  // 00:00 VN ngày 10/08 = 17:00Z ngày 09/08
  assert.equal(w.startTs, Date.UTC(2026, 7, 9, 17, 0, 0));
  assert.equal(w.endTs, Date.UTC(2026, 7, 10, 17, 0, 0));
});

test("previousDayWindowVN: gần nửa đêm VN vẫn ra đúng ngày hôm trước", () => {
  // 2026-08-11 23:59 VN = 2026-08-11T16:59:00Z
  const now = Date.UTC(2026, 7, 11, 16, 59, 0);
  const w = previousDayWindowVN(now);
  assert.equal(w.label, "10/08/2026");
});

test("truncateSafe: không cắt giữa surrogate pair (emoji)", () => {
  const text = `abc${"📊".repeat(10)}`;
  for (let max = 4; max < text.length; max += 1) {
    const cut = truncateSafe(text, max);
    assert.ok(cut.length <= max, `max=${max} ra ${cut.length}`);
    // Chuỗi hợp lệ không chứa lone surrogate (không xẻ đôi emoji).
    assert.ok(!hasLoneSurrogate(cut), `max=${max} xẻ đôi emoji: ${JSON.stringify(cut)}`);
  }
  assert.equal(truncateSafe("ngắn", 100), "ngắn");
});

test("sanitizeDisplayName: ép 1 dòng, chặn độ dài, fallback khi rỗng", () => {
  assert.equal(sanitizeDisplayName("  An\nNguyễn  ", "u1"), "An Nguyễn");
  assert.equal(sanitizeDisplayName("", "u1"), "u1");
  const long = sanitizeDisplayName("THÔNG BÁO: chuyển khoản gấp vào STK 0123456789 ngay (admin)", "u1");
  assert.ok(long.length <= 40);
  assert.ok(long.endsWith("…"));
});

test("buildTranscript: định dạng dòng HH:MM giờ VN kèm tên", () => {
  const t = buildTranscript([msg({ text: "hello\nworld" })]);
  assert.equal(t.text, "10:00 | An: hello world");
  assert.equal(t.totalMessages, 1);
  assert.equal(t.includedMessages, 1);
  assert.equal(t.uniqueSenders, 1);
});

test("buildTranscript: vượt trần ký tự thì giữ tin MỚI NHẤT", () => {
  const messages = [
    msg({ text: "cũ".repeat(30), ts: Date.UTC(2026, 7, 10, 1, 0, 0) }),
    msg({ text: "giữa".repeat(30), ts: Date.UTC(2026, 7, 10, 2, 0, 0) }),
    msg({ text: "mới".repeat(30), ts: Date.UTC(2026, 7, 10, 3, 0, 0) }),
  ];
  const t = buildTranscript(messages, 150);
  assert.equal(t.totalMessages, 3);
  assert.ok(t.includedMessages < 3);
  assert.ok(t.text.includes("mới"));
  assert.ok(!t.text.includes("cũ"));
});

test("buildTranscript: 1 tin duy nhất dài hơn trần vẫn giữ lại (cắt gọn), không trả rỗng", () => {
  const t = buildTranscript([msg({ text: "dài".repeat(100) })], 80);
  assert.equal(t.includedMessages, 1);
  assert.ok(t.text.length > 0);
  assert.ok(t.text.length <= 80);
});

test("buildTranscript: tin quá dài trong transcript bị cắt còn 500 ký tự", () => {
  const t = buildTranscript([msg({ text: "x".repeat(2000) })]);
  assert.ok(t.text.length < 600);
  assert.ok(t.text.endsWith("…"));
});

test("topSenders: đếm theo người, sắp giảm dần, tên được sanitize", () => {
  const messages = [
    msg({ zalo_user_id: "a", display_name: "An" }),
    msg({ zalo_user_id: "b", display_name: "Bình\nXấu".repeat(20) }),
    msg({ zalo_user_id: "b", display_name: "Bình" }),
  ];
  const top = topSenders(messages, 2);
  assert.equal(top[0], "Bình (2)");
  assert.equal(top[1], "An (1)");
});

test("composeSummaryMessages: nội dung ngắn → 1 tin, không đánh số phần", () => {
  const parts = composeSummaryMessages({
    dayLabel: "10/08/2026",
    summary: "- Chủ đề A\n- Chủ đề B",
    totalMessages: 500,
    includedMessages: 300,
    uniqueSenders: 42,
    images: 7,
    videos: 0,
    topSenders: ["Bình (30)"],
  });
  assert.equal(parts.length, 1);
  const text = parts[0] ?? "";
  assert.ok(text.startsWith("📋 Tóm tắt nhóm ngày 10/08/2026"));
  assert.ok(!text.includes("(1/"));
  assert.ok(text.includes("500 tin nhắn"));
  assert.ok(text.includes("7 ảnh"));
  assert.ok(!text.includes("video"));
  assert.ok(text.includes("300/500"));
  assert.ok(text.includes("Bình (30)"));
});

test("composeSummaryMessages: nội dung dài → chia nhiều tin đánh số, không mất ý, footer ở tin cuối", () => {
  // 40 gạch đầu dòng ~190 ký tự → ~7.6K ký tự, phải chia 3 tin.
  const bullets = Array.from({ length: 40 }, (_, i) => `- Chủ đề ${i + 1}: ${"nội dung ".repeat(20)}`);
  const parts = composeSummaryMessages({
    dayLabel: "10/08/2026",
    summary: bullets.join("\n"),
    totalMessages: 800,
    includedMessages: 800,
    uniqueSenders: 50,
    images: 3,
    videos: 1,
    topSenders: ["An (99)"],
  });
  assert.ok(parts.length >= 2 && parts.length <= MAX_SUMMARY_PARTS, `ra ${parts.length} tin`);
  for (const [i, p] of parts.entries()) {
    assert.ok(p.length <= SUMMARY_MAX_CHARS, `tin ${i + 1} dài ${p.length}`);
    assert.ok(p.includes(`(${i + 1}/${parts.length})`), `tin ${i + 1} thiếu đánh số`);
  }
  const joined = parts.join("\n");
  for (const b of ["Chủ đề 1:", "Chủ đề 20:", "Chủ đề 40:"]) {
    assert.ok(joined.includes(b), `mất ý "${b}"`);
  }
  // Footer thống kê chỉ nằm ở tin cuối.
  assert.ok(parts[parts.length - 1]?.includes("📊 800 tin nhắn"));
  assert.ok(parts[parts.length - 1]?.includes("🔥 Sôi nổi nhất: An (99)"));
  assert.ok(!parts[0]?.includes("📊 800 tin nhắn"));
});

test("composeSummaryMessages: dài quá sức chứa 3 tin → cắt gọn nhưng footer luôn còn", () => {
  const bullets = Array.from({ length: 200 }, (_, i) => `- Ý ${i + 1}: ${"x".repeat(180)} 📊`);
  const parts = composeSummaryMessages({
    dayLabel: "10/08/2026",
    summary: bullets.join("\n"),
    totalMessages: 10,
    includedMessages: 10,
    uniqueSenders: 3,
    images: 2,
    videos: 1,
    topSenders: ["An (5)"],
  });
  assert.equal(parts.length, MAX_SUMMARY_PARTS);
  for (const p of parts) {
    assert.ok(p.length <= SUMMARY_MAX_CHARS, `tin dài ${p.length}`);
    assert.ok(!hasLoneSurrogate(p), "xẻ đôi emoji khi chia tin");
  }
  const last = parts[parts.length - 1] ?? "";
  assert.ok(last.includes("📊 10 tin nhắn"));
  assert.ok(last.includes("2 ảnh"));
  assert.ok(last.includes("1 video"));
});

test("composeSummaryMessages: trần số tin tuỳ chỉnh (maxParts) được tôn trọng", () => {
  // 80 ý × ~190 ký tự ≈ 15K — vượt sức chứa 3 tin (~8.9K) nhưng lọt 9 tin (~26K).
  const bullets = Array.from({ length: 80 }, (_, i) => `- Ý ${i + 1}: ${"x".repeat(180)}`);
  const input = {
    dayLabel: "10/08/2026",
    summary: bullets.join("\n"),
    totalMessages: 10,
    includedMessages: 10,
    uniqueSenders: 3,
    images: 0,
    videos: 0,
    topSenders: [],
  };
  // Hạ xuống 2 → đúng 2 tin, footer vẫn còn.
  const two = composeSummaryMessages(input, 2);
  assert.equal(two.length, 2);
  assert.ok(two[1]?.includes("📊 10 tin nhắn"));
  // Nâng lên 9 → đủ chỗ chứa hết, không bị cắt ý cuối.
  const nine = composeSummaryMessages(input, 9);
  assert.ok(nine.length > MAX_SUMMARY_PARTS && nine.length <= 9, `ra ${nine.length} tin`);
  assert.ok(nine.join("\n").includes("Ý 80:"));
  for (const p of nine) assert.ok(p.length <= SUMMARY_MAX_CHARS);
});
