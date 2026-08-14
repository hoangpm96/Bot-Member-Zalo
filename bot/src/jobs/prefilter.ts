import type { RawJobItem } from "./types.js";

/**
 * Cổng lọc RẺ đứng trước AI, chỉ áp cho nguồn Zalo và Telegram.
 *
 * Hai nguồn đó là nhóm chat thường: mỗi ngày sinh hàng chục cụm chào hỏi, hỏi
 * đáp, đùa vui. Đưa hết cho model thì vừa tốn tiền vừa gây hại thật — hàng đợi
 * xử lý theo thứ tự cũ trước, nên chit-chat sẽ CHEN TRƯỚC tin tuyển dụng thật
 * của Facebook và đẩy chúng sang ngày hôm sau.
 *
 * Bài Facebook KHÔNG qua cổng này: group đó gần như toàn tin tuyển dụng, lọc
 * thêm chỉ tạo rủi ro bỏ sót mà không tiết kiệm được gì.
 *
 * Cổng cố ý ĐỂ LỌT NHIỀU: nhiệm vụ của nó chỉ là gạt chuyện phiếm rõ ràng, còn
 * phân biệt "nhà tuyển dụng đăng tin" với "ứng viên tìm việc" vẫn là việc của
 * AI. Thà cho qua mười tin thừa còn hơn chặn nhầm một tin thật.
 */

/**
 * Dấu hiệu một cụm tin CÓ THỂ là tuyển dụng. Gom cả tiếng Việt lẫn tiếng Anh và
 * tiếng lóng tuyển dụng hay gặp trong nhóm nghề (yoe, exp, gross, upto, ib).
 */
const SIGNALS = [
  // Hành động tuyển
  "tuyen", "tuyen dung", "hiring", "recruit", "chieu mo", "can nguoi", "can tuyen",
  "dang tuyen", "tim ung vien", "ung tuyen", "apply", "onboard", "phong van",
  // Mô tả công việc
  "jd", "job", "vi tri", "vacancy", "opening", "headcount", "job description",
  // Đãi ngộ
  "luong", "salary", "gross", "net", "offer", "upto", "up to", "thu nhap",
  "muc luong", "trieu", "package", "benefit",
  // Kinh nghiệm / cấp bậc
  "yoe", "exp", "kinh nghiem", "fresher", "intern", "thuc tap", "junior",
  "middle", "senior", "leader",
  // Hình thức
  "onsite", "remote", "hybrid", "full time", "fulltime", "part time", "contractor",
  // Cách liên hệ hay dùng trong tin tuyển dụng
  "gui cv", "nhan cv", "ib em", "ib minh", "inbox em", "inbox minh",
];

/** Bỏ dấu + hạ chữ thường để so khớp không phụ thuộc cách gõ. */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

/** Cụm quá ngắn không thể là tin tuyển dụng ("ok bác", "hóng"). */
const MIN_LENGTH = 25;

export function looksLikeJobPost(text: string): boolean {
  if (text.trim().length < MIN_LENGTH) return false;
  const folded = ` ${fold(text)} `;
  return SIGNALS.some((signal) => folded.includes(` ${signal} `));
}

/**
 * Lọc các cụm trước khi lưu vào job_raw. Nguồn Facebook đi thẳng, Zalo và
 * Telegram phải qua cổng.
 */
export function prefilterJobItems(items: RawJobItem[]): RawJobItem[] {
  return items.filter((item) => item.source === "facebook" || looksLikeJobPost(item.text));
}
