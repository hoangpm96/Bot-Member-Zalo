/**
 * Dò tên thành viên lọt vào bản tin CÔNG KHAI.
 *
 * Prompt đã cấm nêu tên, nhưng model vẫn có ngày lỡ tay — mà bản tin này đăng
 * Facebook và lên bahub.vn, nên cần một lớp chặn máy móc đứng sau lời dặn.
 * File này thuần hàm (không I/O, không gọi model) để test được.
 *
 * LUẬT DÒ — chỉ nhận tên từ HAI CHỮ trở lên:
 * danh bạ group có cả những tên một chữ như "Linh", "Quỳnh", "Anh". Dò tên một
 * chữ sẽ bắt nhầm chính chữ thường trong câu ("linh hoạt", "anh em") và biến
 * bản tin thành một mớ "bạn A" — bắt hụt vài trường hợp còn hơn bôi đen cả bài.
 */

export interface NamePattern {
  /** Tên như trong danh bạ (giữ nguyên dấu, dùng để in ra log/cảnh báo). */
  name: string;
  regex: RegExp;
}

/** Bỏ khoảng trắng thừa, gộp mọi loại space về một dấu cách. */
function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Ranh giới từ tự viết: \b của JS coi chữ có dấu tiếng Việt là ranh giới, nên
 * "Hà" trong "Hàn" sẽ khớp. Lookaround theo \p{L}\p{N} mới đúng.
 */
function wordBoundaryRegex(phrase: string): RegExp {
  const inner = escapeRegExp(phrase).replace(/ /g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${inner}(?![\\p{L}\\p{N}])`, "giu");
}

/** Tên đủ đặc trưng để dò: ít nhất 2 chữ và 6 ký tự. */
function isDistinctive(phrase: string): boolean {
  return phrase.split(" ").length >= 2 && phrase.replace(/\s/g, "").length >= 5;
}

/**
 * Danh bạ → danh sách mẫu dò.
 *
 * Mỗi tên sinh tối đa 2 mẫu: cả tên ("Bùi Thị Thanh Phương") và hai chữ cuối
 * ("Thanh Phương") — người trong nhóm gọi nhau bằng hai chữ cuối là chuyện
 * thường, model chép lại y như thế. Mẫu dài đứng trước để thay thế không cắt
 * cụt tên dài thành mảnh.
 */
export function buildNamePatterns(displayNames: string[]): NamePattern[] {
  const seen = new Set<string>();
  const phrases: string[] = [];

  for (const raw of displayNames) {
    const name = normalizeName(raw ?? "");
    if (!name) continue;

    const words = name.split(" ");
    const candidates = [name];
    if (words.length >= 3) candidates.push(words.slice(-2).join(" "));

    for (const candidate of candidates) {
      if (!isDistinctive(candidate)) continue;
      const key = candidate.toLocaleLowerCase("vi-VN");
      if (seen.has(key)) continue;
      seen.add(key);
      phrases.push(candidate);
    }
  }

  return phrases
    .sort((a, b) => b.length - a.length)
    .map((name) => ({ name, regex: wordBoundaryRegex(name) }));
}

/** Các tên trong danh bạ xuất hiện trong đoạn văn bản (không trùng lặp). */
export function findLeakedNames(text: string, patterns: NamePattern[]): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const pattern of patterns) {
    // regex có cờ /g nên phải reset lastIndex trước mỗi lần dùng lại.
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(text)) found.push(pattern.name);
  }
  return found;
}

/** Nhãn chung chung thay cho tên thật: người thứ nhất, thứ hai... */
export function genericLabel(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26));
  return `bạn ${letter}`;
}

/**
 * Thay cứng mọi tên trong danh sách bằng nhãn chung chung.
 *
 * Đây là lưới cuối: chỉ dùng khi bảo model viết lại rồi mà tên vẫn còn. Câu
 * văn có thể hơi gượng, nhưng bản tin công khai thà gượng còn hơn nêu tên
 * người ta. Cùng một tên luôn nhận cùng một nhãn trong cả bài để người đọc
 * còn theo được mạch.
 */
export function maskNames(text: string, names: string[]): string {
  let out = text;
  names.forEach((name, index) => {
    out = out.replace(wordBoundaryRegex(name), genericLabel(index));
  });
  return out;
}
