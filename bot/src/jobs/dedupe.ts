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
 * "BA/PO", "PO/BA". Không quy về một mối thì mỗi lần đăng lại là một card mới
 * trên trang — đo trên dữ liệu thật thấy đúng như vậy.
 */
const ROLE_ALIASES: Record<string, string> = {
  ba: "business analyst",
  po: "product owner",
  pm: "project manager",
  brse: "bridge system engineer",
  "ba leader": "business analyst leader",
};

export function normalizeRole(title: string): string {
  const parts = title
    .split(/[/,&+]|\bvà\b|\bhoặc\b/i)
    .map((part) => normalizeKey(part))
    .filter((part) => part !== "")
    .map((part) => ROLE_ALIASES[part] ?? part);

  // Sắp xếp để "BA/PO" và "PO/BA" ra cùng một khoá.
  return [...new Set(parts)].sort().join("|");
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

export function jobFingerprint(input: {
  company: string;
  title: string;
  salary: string;
  location: string;
  author: string;
}): string {
  const parts = [
    employerKey(input.company, input.author),
    normalizeRole(input.title),
    normalizeSalary(input.salary),
    normalizeLocation(input.location),
  ].join("|");

  // Băm để khoá UNIQUE trong SQLite gọn và không phụ thuộc độ dài nội dung.
  return createHash("sha1").update(parts).digest("hex").slice(0, 20);
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
