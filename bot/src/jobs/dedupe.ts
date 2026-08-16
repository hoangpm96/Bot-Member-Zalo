import { createHash } from "node:crypto";
import { NA } from "./extract.js";

/**
 * Chống trùng tin tuyển dụng.
 *
 * Đo trên group bahubvn: cùng một nhà tuyển dụng đăng lại gần như y hệt sau vài
 * ngày, có khi đăng hai lần cách nhau vài phút; cùng một JD lại xuất hiện ở cả
 * Facebook lẫn Zalo lẫn Telegram. Không chặn thì trang tuyển dụng thành bảng tin
 * lặp của vài HR chăm đăng.
 *
 * Cách nhận diện: chữ ký từ (bên tuyển + vị trí + lương + nơi làm). Chuẩn hoá
 * mạnh tay — bỏ dấu, bỏ ký tự trang trí, quy lương về con số — vì mỗi lần đăng
 * lại người ta hay đổi emoji, đổi cách viết hoa, thêm bớt vài chữ.
 */

/**
 * Vân tay của NGUYÊN VĂN một bài, để bắt bài copy nguyên si sang group khác.
 *
 * Đây là lưới đứng TRƯỚC model, khác hẳn chữ ký `jobFingerprint` phía sau (chữ
 * ký kia cần model bóc xong công ty/vị trí/lương mới tính được). Cùng một JD
 * được đăng ở group nhà và group bạn thì phần chữ thường giống hệt tới từng
 * dấu cách — chặn ở đây thì khỏi tốn một lượt gọi model chỉ để phát hiện điều
 * mà so chuỗi đã thấy.
 *
 * Bài quá ngắn KHÔNG có vân tay: "tuyển BA HN ib em" của hai người khác nhau,
 * hai vị trí khác nhau vẫn cho ra cùng một chuỗi chuẩn hoá — gộp là mất tin.
 */
const CONTENT_HASH_MIN_CHARS = 60;

export function contentHash(text: string): string {
  const norm = normalizeKey(text);
  if (norm.length < CONTENT_HASH_MIN_CHARS) return "";
  return createHash("sha1").update(norm).digest("hex").slice(0, 20);
}

/** Bỏ dấu tiếng Việt, hạ chữ thường, bỏ mọi thứ không phải chữ/số. */
export function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Lương về dạng so sánh được: chỉ giữ các con số theo thứ tự.
 * "Up to 35M gross", "35 triệu", "Upto 35M + LT13" đều ra "35" / "35 13".
 */
export function normalizeSalary(value: string): string {
  if (value === NA) return "";
  const numbers = value.match(/\d+/g);
  return numbers ? numbers.join(" ") : normalizeKey(value);
}

/**
 * Danh tính bên tuyển. Rất nhiều tin không nêu công ty (HR giấu tên khách hàng),
 * khi đó chính người đăng là mỏ neo — cùng một HR đăng lại cùng vị trí, cùng
 * mức lương thì gần như chắc chắn là một tin.
 */
function employerKey(company: string, author: string): string {
  if (company !== NA && company !== "") return `c:${normalizeKey(company)}`;
  return `a:${normalizeKey(author)}`;
}

/**
 * Tên vị trí về dạng so sánh được.
 *
 * Người đăng viết cùng một vị trí bằng đủ kiểu: "BA", "Business Analyst",
 * "IT BA", "ITBA", "Middle BA", "BA/PO", "PO/BA". Không quy về một mối thì mỗi
 * lần đăng lại là một card mới trên trang — đo trên dữ liệu thật thấy đúng vậy.
 */
const ROLE_ALIASES: Record<string, string> = {
  ba: "business analyst",
  itba: "it business analyst",
  po: "product owner",
  pm: "project manager",
  brse: "bridge system engineer",
};

/**
 * Cấp bậc bị gạt khỏi khoá vị trí: "BA" và "Middle BA" là cùng một vị trí viết
 * hai kiểu, không phải hai tin. Cấp bậc đã có cột `level` riêng và cột đó là
 * MỘT PHẦN của chữ ký, nên "Junior BA" vẫn không lẫn với "Senior BA".
 *
 * KHÔNG gạt "lead", "leader", "manager": đó là tên vị trí thật ("Tech Lead",
 * "Project Manager", "BA Leader"), gạt đi là gộp nhầm hai nghề khác nhau.
 */
const SENIORITY_WORDS = new Set([
  "intern",
  "internship",
  "fresher",
  "junior",
  "jr",
  "middle",
  "mid",
  "senior",
  "sr",
]);

/** Mở viết tắt ở mức TỪ, để "Middle BA" cũng ra "business analyst". */
function roleWords(part: string): string[] {
  // "it ba" là một cụm hai từ — ghép lại trước khi tra bảng, nếu không "ba"
  // được mở riêng và "it" thành một từ lạc lõng đứng trước.
  const merged = part.replace(/\bit ba\b/g, "itba");

  const words: string[] = [];
  for (const word of merged.split(" ")) {
    if (word === "" || SENIORITY_WORDS.has(word)) continue;
    words.push(...(ROLE_ALIASES[word] ?? word).split(" "));
  }
  return words;
}

export function normalizeRole(title: string): string {
  const parts = title
    .split(/[/,&+]|\bvà\b|\bhoặc\b/i)
    .map((part) => roleWords(normalizeKey(part)).join(" "))
    .filter((part) => part !== "");

  // Sắp xếp để "BA/PO" và "PO/BA" ra cùng một khoá.
  const role = [...new Set(parts)].sort().join("|");

  // Tiêu đề chỉ có mỗi chữ chỉ cấp bậc thì gạt xong không còn gì — lùi về
  // nguyên văn còn hơn để khoá rỗng gộp nhầm mọi tin của cùng một người đăng.
  return role || normalizeKey(title);
}

/**
 * Nơi làm việc về dạng so sánh được: chỉ giữ THÀNH PHỐ.
 *
 * Cùng một chỗ được viết là "Lê Văn Lương, HN", "Lê Văn Lương, Hà Nội",
 * "Cầu Giấy, Hà Nội"... Giữ nguyên chuỗi thì mỗi cách viết là một tin khác.
 * Chi tiết đường/quận vẫn hiển thị đầy đủ trên trang — chỗ này chỉ dùng để so.
 */
const CITY_PATTERNS: [RegExp, string][] = [
  [/\b(ha noi|hanoi|hn)\b/, "hanoi"],
  [/\b(ho chi minh|hochiminh|hcm|tphcm|tp hcm|sai gon|saigon|sg)\b/, "hcm"],
  [/\b(da nang|danang)\b/, "danang"],
  [/\b(hai phong|haiphong)\b/, "haiphong"],
  [/\b(can tho|cantho)\b/, "cantho"],
  [/\b(binh duong|binhduong)\b/, "binhduong"],
  [/\b(dong nai|dongnai)\b/, "dongnai"],
  [/\b(hue)\b/, "hue"],
  [/\b(nha trang|nhatrang)\b/, "nhatrang"],
];

export function normalizeLocation(location: string): string {
  if (location === NA) return "";
  const norm = normalizeKey(location);
  for (const [pattern, city] of CITY_PATTERNS) {
    if (pattern.test(norm)) return city;
  }
  return norm;
}

/** Các trường nhận dạng một tin, lấy thẳng từ kết quả bóc tách. */
export interface JobIdentity {
  company: string;
  title: string;
  level: string;
  salary: string;
  location: string;
  author: string;
}

/** Năm phần của chữ ký, đã chuẩn hoá. Rỗng = bài gốc không nêu. */
export interface JobKeys {
  employer: string;
  role: string;
  level: string;
  salary: string;
  location: string;
}

export function jobKeys(input: JobIdentity): JobKeys {
  return {
    employer: employerKey(input.company, input.author),
    role: normalizeRole(input.title),
    level: input.level === NA ? "" : normalizeKey(input.level),
    salary: normalizeSalary(input.salary),
    location: normalizeLocation(input.location),
  };
}

export function fingerprintOf(keys: JobKeys): string {
  const parts = [keys.employer, keys.role, keys.level, keys.salary, keys.location].join("|");
  // Băm để khoá UNIQUE trong SQLite gọn và không phụ thuộc độ dài nội dung.
  return createHash("sha1").update(parts).digest("hex").slice(0, 20);
}

export function jobFingerprint(input: JobIdentity): string {
  return fingerprintOf(jobKeys(input));
}

/** Một phần khớp khi hai bên bằng nhau, hoặc khi một bên không nêu gì. */
function loose(a: string, b: string): boolean {
  return a === b || a === "" || b === "";
}

/**
 * Lưới thứ hai của chống trùng: cùng một tin nhưng lần đăng lại lệch vài trường.
 *
 * Chữ ký băm chỉ khớp khi CẢ NĂM phần giống hệt, mà thực tế lần đăng lại hay
 * rơi rụng bớt — hôm trước ghi "Up to 35M, Cầu Giấy", hôm nay chỉ còn "Tuyển BA
 * Hà Nội, lương thoả thuận". Ở đây coi là một tin khi bên tuyển và vị trí trùng
 * nhau, còn các trường còn lại thì hoặc trùng, hoặc BỎ TRỐNG ở một bên.
 *
 * Cố ý KHÔNG nới thêm: hai trường cùng có giá trị mà khác nhau (35M với 25M,
 * Hà Nội với Đà Nẵng) là hai tin khác. Gộp nhầm thì mất hẳn một tin, còn sót
 * thì chỉ hơi lặp — đúng nếp đã chọn cho cả tính năng này.
 */
export function isSameJob(a: JobKeys, b: JobKeys): boolean {
  // Không có mỏ neo (bài giấu công ty lẫn tên người đăng, hoặc không rõ vị trí)
  // thì không đủ cơ sở để gộp.
  if (a.employer.length <= 2 || a.role === "") return false;
  if (a.employer !== b.employer || a.role !== b.role) return false;
  return loose(a.level, b.level) && loose(a.salary, b.salary) && loose(a.location, b.location);
}

export interface JobSourceRef {
  source: string;
  url: string | null;
  posted_at: number;
}

/**
 * Gộp nguồn khi gặp lại cùng một tin: giữ tối đa 5 nơi, mới nhất trước.
 * Cùng một nguồn + cùng link thì không nhân đôi.
 */
export function mergeSources(existing: JobSourceRef[], incoming: JobSourceRef): JobSourceRef[] {
  const already = existing.some(
    (ref) => ref.source === incoming.source && ref.url === incoming.url,
  );
  const merged = already ? existing : [incoming, ...existing];
  return merged.sort((a, b) => b.posted_at - a.posted_at).slice(0, 5);
}

export function parseSources(json: string): JobSourceRef[] {
  try {
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? (parsed as JobSourceRef[]) : [];
  } catch {
    return [];
  }
}
