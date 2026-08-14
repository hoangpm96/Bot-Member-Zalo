import type { RawJobItem } from "./types.js";

/**
 * Đọc tin nhắn của GROUP TELEGRAM CÔNG KHAI qua Post Widget.
 *
 * Vì sao không dùng Bot API: `getUpdates` chỉ trả tin gửi SAU khi bot được add,
 * và chỉ giữ update chưa đọc trong 24 giờ — không đọc được lịch sử, mất mạng
 * một ngày là mất tin. Đọc lịch sử ở tầng MTProto thì phải dùng tài khoản người
 * dùng thật, kéo theo nhãn "unofficial client" hiện công khai trên profile.
 *
 * Widget là đường công khai chính chủ: thêm `?embed=1&mode=tme` vào link tin
 * nhắn là ra HTML có đủ nội dung, tác giả, thời gian, khối trả lời. Không đăng
 * nhập, không token, không tài khoản nào bị đặt vào rủi ro. Đo thực tế từ VPS:
 * 20 request liên tiếp trong 18 giây, không lần nào bị 429.
 *
 * Message id trong group là số nguyên tăng dần, nên duyệt theo dải id là lấy
 * được đúng khoảng thời gian mong muốn.
 */

/**
 * Tên tác giả có HAI dạng, tuỳ người đó có username công khai hay không:
 *   - có username: `<a class="..._author_name" href="https://t.me/tên">Đức Anh</a>`
 *   - không có:    `<span class="..._author_name"><span>Hoai Bui</span></span>`
 * Khối TRẢ LỜI cũng chứa một thẻ author_name (tên người được trả lời), nên chỉ
 * được dò trong phần header đứng TRƯỚC khối trả lời — dò cả trang là lấy nhầm.
 */
const RE_REPLY_BLOCK_START = /<a class="tgme_widget_message_reply/;
const RE_AUTHOR_LINK =
  /<a class="tgme_widget_message_author_name" href="https:\/\/t\.me\/([^"]+)"[^>]*>([\s\S]{0,300}?)<\/a>/;
const RE_AUTHOR_PLAIN = /<span class="tgme_widget_message_author_name"[^>]*>([\s\S]{0,300}?)<\/span>/;
const RE_TEXT = /js-message_text"[^>]*>([\s\S]*?)<\/div>/;
const RE_TIME = /<time[^>]*datetime="([^"]+)"/;
/** Khối trả lời: href trỏ tới tin được trả lời, hoặc tới ROOT của topic. */
const RE_REPLY = /<a class="tgme_widget_message_reply[^"]*" href="https:\/\/t\.me\/[^/]+\/(\d+)"/;
const RE_REPLY_TEXT = /js-message_reply_text"[^>]*>([\s\S]*?)<\/div>/;

/**
 * Tin nằm thẳng trong một forum topic mà không trả lời ai thì khối reply trỏ
 * vào service message tạo topic — Telegram hiển thị đúng chữ này.
 */
const TOPIC_ROOT_MARKER = "Service message";

export interface WidgetMessage {
  messageId: number;
  author: string;
  authorUsername: string | null;
  text: string;
  ts: number;
  /** Id topic khi xác định được ngay từ tin này. */
  topicRoot: number | null;
  /** Id tin được trả lời (khi không phải service message) — cần lần ngược để ra topic. */
  replyTo: number | null;
  url: string;
}

/** Gỡ thẻ HTML, trả lại ký tự thật, giữ xuống dòng của người viết. */
export function htmlToText(fragment: string): string {
  const withBreaks = fragment
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div)>/gi, "\n")
    // Emoji trong widget là <i class="emoji"><b>👍</b></i> — giữ lại ký tự bên trong.
    .replace(/<[^>]+>/g, "");

  const unescaped = withBreaks
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));

  return unescaped
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Bóc một trang widget. Trả null khi id không tồn tại hoặc tin đã bị xoá. */
export function parseWidgetHtml(
  html: string,
  groupSlug: string,
  messageId: number,
): WidgetMessage | null {
  const time = RE_TIME.exec(html);
  if (!time) return null;

  const ts = Date.parse(time[1]!);
  if (!Number.isFinite(ts)) return null;

  const replyStart = html.search(RE_REPLY_BLOCK_START);
  const header = replyStart === -1 ? html : html.slice(0, replyStart);
  const linked = RE_AUTHOR_LINK.exec(header);
  const plain = linked ? null : RE_AUTHOR_PLAIN.exec(header);

  const text = RE_TEXT.exec(html);

  const reply = RE_REPLY.exec(html);
  const replyText = RE_REPLY_TEXT.exec(html);
  const repliedId = reply ? Number(reply[1]) : null;
  const isTopicRoot = htmlToText(replyText?.[1] ?? "") === TOPIC_ROOT_MARKER;

  return {
    messageId,
    author: htmlToText(linked?.[2] ?? plain?.[1] ?? ""),
    authorUsername: linked ? linked[1]! : null,
    text: htmlToText(text?.[1] ?? ""),
    ts,
    topicRoot: isTopicRoot ? repliedId : null,
    replyTo: isTopicRoot ? null : repliedId,
    url: `https://t.me/${groupSlug}/${messageId}`,
  };
}

/**
 * Xác định topic của từng tin trong một lô đã tải.
 *
 * Tin trả lời người khác thì khối reply trỏ vào tin đó chứ không trỏ vào topic,
 * nên phải lần ngược chuỗi trả lời. Lần ngược NGAY TRONG BỘ NHỚ trên lô vừa
 * tải — tin cha gần như luôn nằm cùng lô, nên không tốn thêm request nào.
 */
export function resolveTopics(messages: WidgetMessage[]): Map<number, number | null> {
  const byId = new Map(messages.map((m) => [m.messageId, m]));
  const resolved = new Map<number, number | null>();

  function walk(id: number, seen: Set<number>): number | null {
    if (resolved.has(id)) return resolved.get(id)!;
    const message = byId.get(id);
    // Tin cha nằm ngoài lô (cũ hơn dải đang tải) — coi như không xác định được,
    // thà bỏ sót còn hơn gán bừa vào topic tuyển dụng.
    if (!message) return null;
    if (message.topicRoot !== null) return message.topicRoot;
    if (message.replyTo === null) return null;
    // Chuỗi trả lời vòng lại chính nó thì dừng, đừng lặp vô tận.
    if (seen.has(message.replyTo)) return null;
    seen.add(message.replyTo);
    return walk(message.replyTo, seen);
  }

  for (const message of messages) {
    resolved.set(message.messageId, walk(message.messageId, new Set([message.messageId])));
  }
  return resolved;
}

/** Lọc tin thuộc đúng một topic rồi quy về hình dạng chung của luồng tin tuyển dụng. */
export function toRawJobItems(
  messages: WidgetMessage[],
  topicId: number | null,
): RawJobItem[] {
  const topics = resolveTopics(messages);

  return messages
    .filter((m) => m.text !== "")
    .filter((m) => topicId === null || topics.get(m.messageId) === topicId)
    .map((m) => ({
      source: "telegram" as const,
      sourceId: String(m.messageId),
      author: m.author,
      sourceUrl: m.url,
      text: m.text,
      postedAt: m.ts,
    }));
}

export function widgetUrl(groupSlug: string, messageId: number): string {
  return `https://t.me/${groupSlug}/${messageId}?embed=1&mode=tme`;
}

/** Số lần thử lại khi lỗi mạng thoáng qua, và giãn cách giữa các lần. */
const FETCH_ATTEMPTS = 3;
const FETCH_RETRY_GAP_MS = [1_000, 4_000];

/**
 * Tải một tin. Trả null khi id không tồn tại — dùng để dò biên dải id.
 *
 * Có thử lại khi lỗi mạng: một lượt backfill là hàng nghìn request kéo dài nhiều
 * phút, gần như chắc chắn sẽ vấp vài lần ETIMEDOUT. Không thử lại thì một cú
 * chớp mạng giết cả lượt crawl — đã gặp đúng như vậy trên VPS.
 *
 * Hết lượt thử vẫn lỗi thì NÉM RA, để bên gọi tự quyết định (crawlRange đếm là
 * hỏng và không đẩy con trỏ qua chỗ đó, thay vì âm thầm coi như id trống).
 */
export async function fetchWidgetMessage(
  groupSlug: string,
  messageId: number,
): Promise<WidgetMessage | null> {
  let lastError: unknown;

  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(widgetUrl(groupSlug, messageId), {
        signal: AbortSignal.timeout(30_000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BahubJobBot/1.0; +https://bahub.vn)" },
      });
      // 404 = id không tồn tại (tin đã xoá hoặc chưa tới) — không phải lỗi.
      if (!res.ok) return null;
      return parseWidgetHtml(await res.text(), groupSlug, messageId);
    } catch (e) {
      lastError = e;
      const gap = FETCH_RETRY_GAP_MS[attempt];
      if (gap === undefined) break;
      await new Promise((resolve) => setTimeout(resolve, gap));
    }
  }
  throw lastError;
}
