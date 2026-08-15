/**
 * Chuẩn hoá TÊN VỊ TRÍ trước khi ghi vào kho.
 *
 * Người đăng viết cùng một vị trí bằng đủ kiểu viết tắt — "BA", "IT BA", "ITBA",
 * "PO", "Middle BA" — và model bóc ra sao thì để nguyên vậy. Trang tuyển dụng
 * đầy chữ viết tắt trông như chục nghề khác nhau, và người lướt nhanh không nhận
 * ra hai tin cùng một vị trí.
 *
 * Đây là NGOẠI LỆ có cân nhắc của luật "bot bóc tách chứ không viết lại": chỉ
 * đụng vào trường `title` (tên vị trí, vốn đã là chữ của model chứ không phải
 * của người đăng), và chỉ mở viết tắt thành tên đầy đủ. Mô tả, lương, yêu cầu —
 * những chỗ sai một chữ là mất uy tín — không ai chạm vào.
 *
 * Cùng bộ luật với `normalizeJobTitle` bên repo bahub-blog
 * (`src/lib/job-post-format.ts`), nơi web vẫn giữ một lớp chuẩn hoá lúc hiển thị
 * cho những tin đã nằm sẵn trong bảng từ trước. Sửa bên này thì sửa cả bên đó.
 *
 * KHÁC với `normalizeRole` trong dedupe.ts: ở đó là khoá để SO SÁNH (bỏ dấu,
 * chữ thường, gạt cấp bậc); ở đây là chữ ĐỂ ĐỌC, giữ nguyên phần còn lại của
 * tiêu đề.
 */

/**
 * Viết tắt → tên đầy đủ.
 *
 * CHỈ khớp chữ IN HOA: trong tiếng Việt "ba" là số đếm ("tuyển ba bạn"), khớp
 * cả chữ thường là biến câu tiếng Việt thành tên nghề. BrSE thì khớp cả hoa lẫn
 * thường vì không có từ tiếng Việt nào trùng.
 *
 * "IT BA" đứng đầu để bắt luôn biến thể viết liền "ITBA" — `\bBA\b` không khớp
 * bên trong "ITBA" vì thiếu ranh giới từ.
 */
const TITLE_ALIASES: [RegExp, string][] = [
  [/\bIT[\s._-]?BA\b/g, "IT Business Analyst"],
  [/\bBA\b/g, "Business Analyst"],
  [/\bPO\b/g, "Product Owner"],
  [/\bPM\b/g, "Project Manager"],
  [/\bBrSE\b/gi, "Bridge System Engineer"],
];

/**
 * "Business Analyst (Business Analyst)" → "Business Analyst".
 *
 * Rất nhiều tin ghi "Business Analyst (BA)" cho chắc; mở viết tắt ra xong thì
 * thành cái ngoặc lặp lại chính nó. Chỉ bỏ khi phần trong ngoặc trùng đúng đoạn
 * chữ ngay trước nó — "(Banking)", "(Tiếng Nhật)" vẫn giữ nguyên.
 */
function dropEchoedParens(title: string): string {
  return title.replace(
    /([^\s(][^()]*?)\s*[(（]\s*([^()]+?)\s*[)）]/g,
    (whole: string, before: string, inside: string) =>
      before.trim().toLowerCase().endsWith(inside.trim().toLowerCase()) ? before : whole,
  );
}

/** Tên vị trí như trang sẽ hiện: "BA/PO" → "Business Analyst / Product Owner". */
export function normalizeJobTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed === "" || trimmed === "N/A") return trimmed;

  let out = trimmed;
  let expanded = false;
  for (const [pattern, full] of TITLE_ALIASES) {
    const next = out.replace(pattern, full);
    if (next !== out) expanded = true;
    out = next;
  }
  // Không có viết tắt nào thì trả nguyên văn: tiêu đề tiếng Việt ("Nhân viên
  // nghiệp vụ hệ thống") không có lý do gì để bị nắn lại.
  if (!expanded) return trimmed;

  // Hai tên đầy đủ dính vào một dấu gạch chéo ("Business Analyst/Product Owner")
  // rất khó đọc. Chỉ nới dấu ở tiêu đề vừa mở viết tắt.
  return dropEchoedParens(out)
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
}
