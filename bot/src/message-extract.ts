/**
 * Rút nội dung từ payload message của zca-js để ghi vào DB.
 *
 * zca-js định nghĩa content: string | TAttachmentContent | TOtherContent.
 * - Text thuần → content là string.
 * - Link/recommend (chat.link, chat.recommended) → content là object { title, description, href, ... }.
 * - Ảnh/video (chat.photo, chat.video.msg) → content cũng là object (có href/thumb) + msgType đặc thù.
 *
 * Tách khỏi listener.ts để test độc lập, không kéo theo env/config lúc load.
 */

export function parseObjectMaybe(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function positiveInt(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.trunc(n));
}

export function extractMediaSummary(payload: any): { type: "image" | "video"; count: number } | null {
  const data = payload?.data ?? {};
  const msgType = String(data?.msgType ?? "").toLowerCase();
  const content = parseObjectMaybe(data?.content);
  const params = parseObjectMaybe(content?.params);
  const contentType = String(content?.type ?? params?.type ?? "").toLowerCase();
  const rawCount =
    positiveInt(content?.childnumber) ??
    positiveInt(content?.childNumber) ??
    positiveInt(params?.childnumber) ??
    positiveInt(params?.childNumber) ??
    positiveInt(params?.count);

  if (msgType.includes("video") || contentType.includes("video")) {
    return { type: "video", count: rawCount ?? 1 };
  }
  if (
    msgType.includes("photo") ||
    msgType.includes("image") ||
    contentType.includes("photo") ||
    contentType.includes("image")
  ) {
    return { type: "image", count: rawCount ?? 1 };
  }
  return null;
}

/** URL media tạm do Zalo trả về; Telegram có thể dùng URL này để tải ảnh/video. */
export function extractMediaUrl(payload: any): string | null {
  if (extractMediaSummary(payload) === null) return null;
  const content = parseObjectMaybe(payload?.data?.content);
  const params = parseObjectMaybe(content?.params);
  const candidates = [
    content?.href,
    content?.hdUrl,
    content?.url,
    params?.href,
    params?.hdUrl,
    params?.url,
    content?.thumb,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const value = candidate.trim();
    if (/^https?:\/\//i.test(value)) return value;
  }
  return null;
}

export function extractText(payload: any): string | null {
  const content = payload?.data?.content;
  if (typeof content === "string") {
    const text = content.trim();
    return text ? text : null;
  }
  // content là object TAttachmentContent { title, description, href, thumb, ... }.
  // - Link/recommend: rút title + description + href (URL là nội dung chính).
  // - Ảnh/video có CAPTION: caption nằm ở title/description; href là URL ảnh (KHÔNG lấy,
  //   tránh ghi link ảnh thành text và double-count với group_media_events). Media đã được
  //   extractMediaSummary xử lý riêng; ở đây chỉ vớt thêm caption nếu có.
  const obj = parseObjectMaybe(content);
  if (obj) {
    const isMedia = extractMediaSummary(payload) != null;
    // Với media chỉ lấy caption (title/description); với link lấy cả href.
    const fields = isMedia ? [obj.title, obj.description] : [obj.title, obj.description, obj.href];
    const parts = fields
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .map((v) => v.trim());
    if (parts.length > 0) {
      // Khử trùng lặp (title trùng description, v.v.) rồi nối cho gọn.
      return [...new Set(parts)].join(" — ");
    }
  }
  return null;
}
