import { fetchWidgetMessage, toRawJobItems, type WidgetMessage } from "./telegram-widget.js";
import type { RawJobItem } from "./types.js";

/**
 * Duyệt dải message id của group Telegram công khai.
 *
 * Message id trong group là số nguyên tăng dần và gần như liền mạch (đo trên
 * @businessanalystvietnam: 592/592 và 301/302 id liên tiếp đều có tin), nên
 * "lấy tin trong N ngày" quy về "tìm id ứng với mốc thời gian rồi duyệt tới id
 * mới nhất".
 *
 * Tin tuyển dụng trong group này rất thưa — đo ngày 11/08/2026: 2 tin thuộc
 * topic tuyển dụng trên tổng 301 tin, còn lại 97% là topic mirror Zalo do chính
 * bot mình forward sang. Nghĩa là phải tải hết rồi lọc theo topic; không có
 * đường tắt nào rẻ hơn.
 */

/** Số request chạy song song. Đo từ VPS: 20 request/18 giây, không lần nào bị 429. */
const CONCURRENCY = 6;
/** Gặp bấy nhiêu id trống liên tiếp thì coi như đã tới cuối group. */
const MISS_STREAK_END = 30;

/** Chạy `worker` trên `items` với số luồng cố định, giữ nguyên thứ tự đầu vào. */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await worker(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return out;
}

/**
 * Tìm message id ĐẦU TIÊN có thời gian >= `targetTs`, bằng chia đôi.
 *
 * Id trống (tin đã xoá) làm hỏng phép chia đôi thuần, nên mỗi lần dò sẽ trượt
 * lên vài id cho tới khi gặp tin thật.
 */
export async function findIdAtTime(
  groupSlug: string,
  targetTs: number,
  bounds: { low: number; high: number },
): Promise<number> {
  let low = bounds.low;
  let high = bounds.high;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const probeId = await firstExistingFrom(groupSlug, middle);

    // Cả vùng đó trống — thu hẹp về nửa dưới thay vì kẹt vòng lặp.
    if (probeId === null) {
      high = middle;
      continue;
    }

    const message = await probe(groupSlug, probeId);
    if (!message) {
      high = middle;
      continue;
    }

    if (message.ts < targetTs) low = message.messageId + 1;
    else high = message.messageId;
  }
  return low;
}

/**
 * Tải một id cho các bước DÒ BIÊN: lỗi mạng dai dẳng coi như id trống.
 *
 * Ở bước dò, phân biệt "lỗi" với "trống" không giúp gì mà chỉ làm hỏng cả lượt
 * chạy. Riêng bước duyệt thật (crawlRange) thì phải phân biệt, vì ở đó bỏ sót
 * một id là mất tin.
 */
async function probe(groupSlug: string, id: number): Promise<WidgetMessage | null> {
  try {
    return await fetchWidgetMessage(groupSlug, id);
  } catch {
    return null;
  }
}

/**
 * Có tin nào trong [id, id + MISS_STREAK_END) không — trả về id thật gần nhất.
 *
 * Cần cửa sổ chứ không hỏi từng id vì tin bị xoá để lại lỗ trống; hỏi đúng một
 * id rồi kết luận "hết group" là sai.
 */
async function firstExistingFrom(groupSlug: string, id: number): Promise<number | null> {
  const window = Array.from({ length: MISS_STREAK_END }, (_, i) => id + i);
  const found = await mapPool(window, CONCURRENCY, (id) => probe(groupSlug, id));
  const hit = found.findIndex((message) => message !== null);
  return hit === -1 ? null : window[hit]!;
}

/**
 * Id lớn nhất hiện có, tính từ `fromId` trở lên.
 *
 * Dò TĂNG GẤP ĐÔI rồi chia đôi, KHÔNG quét tuyến tính: group có gần 37.000 tin,
 * quét từng id sẽ tốn hàng chục nghìn request và mất hàng giờ. Cách này chỉ tốn
 * cỡ log₂(N) cửa sổ dò.
 */
export async function findLatestId(groupSlug: string, fromId: number): Promise<number> {
  const start = Math.max(1, fromId);

  // Giai đoạn 1: nhân đôi bước cho tới khi vượt quá tin cuối cùng.
  let low = start;
  let step = 1024;
  let high = start + step;
  while ((await firstExistingFrom(groupSlug, high)) !== null) {
    low = high;
    step *= 2;
    high = low + step;
  }

  // Giai đoạn 2: chia đôi khoảng (low, high] để tìm biên.
  while (low + MISS_STREAK_END < high) {
    const middle = Math.floor((low + high) / 2);
    if ((await firstExistingFrom(groupSlug, middle)) !== null) low = middle;
    else high = middle;
  }

  // Giai đoạn 3: quét nốt phần đuôi ngắn để lấy đúng id cuối cùng.
  const tail = Array.from({ length: MISS_STREAK_END * 2 }, (_, i) => low + i);
  const found = await mapPool(tail, CONCURRENCY, (id) => probe(groupSlug, id));
  for (let i = found.length - 1; i >= 0; i -= 1) {
    if (found[i]) return tail[i]!;
  }
  return low;
}

export interface CrawlResult {
  items: RawJobItem[];
  /**
   * Id lớn nhất ĐÃ DUYỆT TRỌN VẸN — lưu lại để lần sau đi tiếp.
   *
   * Nếu giữa dải có id tải hỏng, con trỏ chỉ dừng NGAY TRƯỚC id hỏng đầu tiên
   * chứ không nhảy tới cuối: nhảy qua nghĩa là bỏ luôn khoảng đó vĩnh viễn.
   */
  lastId: number;
  scanned: number;
  /** Số id tải hỏng sau khi đã thử lại — dữ liệu của lượt này chưa đầy đủ. */
  failed: number;
}

/**
 * Duyệt [fromId, toId] rồi lọc lấy tin thuộc `topicId`.
 *
 * `topicId` null = lấy mọi topic. Truyền id topic thì chỉ giữ tin của topic đó,
 * kể cả tin trả lời trong topic (lần ngược chuỗi trả lời ngay trong bộ nhớ).
 */
export async function crawlRange(input: {
  groupSlug: string;
  fromId: number;
  toId: number;
  topicId: number | null;
  onProgress?: (done: number, total: number) => void;
}): Promise<CrawlResult> {
  const ids: number[] = [];
  for (let id = input.fromId; id <= input.toId; id += 1) ids.push(id);

  const messages: WidgetMessage[] = [];
  let done = 0;
  let failed = 0;
  let firstFailedId: number | null = null;

  await mapPool(ids, CONCURRENCY, async (id) => {
    try {
      const message = await fetchWidgetMessage(input.groupSlug, id);
      if (message) messages.push(message);
    } catch {
      // Một id hỏng KHÔNG được giết cả lượt crawl: backfill là hàng nghìn
      // request kéo dài nhiều phút, vấp vài lỗi mạng là chuyện bình thường.
      failed += 1;
      if (firstFailedId === null || id < firstFailedId) firstFailedId = id;
    }
    done += 1;
    if (done % 200 === 0) input.onProgress?.(done, ids.length);
  });

  return {
    items: toRawJobItems(messages, input.topicId),
    lastId: firstFailedId === null ? input.toId : firstFailedId - 1,
    scanned: messages.length,
    failed,
  };
}
