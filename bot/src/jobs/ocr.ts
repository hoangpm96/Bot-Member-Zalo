import { mkdirSync } from "node:fs";
import sharp from "sharp";
import { createWorker, type Worker } from "tesseract.js";
import { fetch } from "undici";
import { config } from "../config.js";

/**
 * Đọc chữ trong ảnh tuyển dụng bằng Tesseract chạy ngay trên máy.
 *
 * Vì sao cần: rất nhiều tin tuyển dụng là một tấm poster — bên Facebook có bài
 * không có lấy một chữ caption, bên Zalo anh em quăng thẳng ảnh JD vào nhóm.
 * Không đọc được ảnh thì những tin đó biến mất khỏi trang.
 *
 * Vì sao Tesseract chứ không phải model đọc ảnh: DeepSeek đang dùng không nhận
 * ảnh, mà thêm một nhà cung cấp nữa chỉ để đọc vài tấm ảnh mỗi ngày thì đắt cả
 * tiền lẫn công vận hành. Tesseract chạy tại chỗ, không thêm khoá API, không
 * thêm hoá đơn.
 *
 * MỘT LẦN GỌI LÀ BA LƯỢT ĐỌC, và đây là phần quan trọng nhất của file này —
 * đo thật trên poster JD ngày 16/08/2026:
 *   - Lượt toàn ảnh (PSM 3) đọc sạch phần thân: mô tả, yêu cầu, email, điện
 *     thoại. NHƯNG mất trắng dòng tiêu đề "BUSINESS ANALYST" cỡ lớn.
 *   - Lượt cắt dải ngang (PSM 6) đọc được đúng dòng tiêu đề đó, độ tin cậy 90.
 *     Chữ quá lớn so với phần còn lại của trang thì Tesseract bỏ qua khi nhìn
 *     cả trang, cắt nhỏ lại thì nó thấy.
 *   - Lượt đảo màu bắt chữ SÁNG trên nền TỐI (dải liên hệ cuối poster) — hai
 *     lượt trên đều mù với loại chữ này.
 * Tiêu đề vị trí và tên công ty chính là hai trường xương sống của chữ ký chống
 * trùng, nên bỏ lượt hai là tin từ ảnh sẽ vào kho với tiêu đề rỗng và bị loại.
 *
 * Kết quả gộp lại là văn bản LỘN XỘN và có lỗi chính tả (mất dấu chấm trong
 * "vtsi.vn", vài ký tự trang trí thành chữ cái). Đó là lý do prompt bóc tách
 * được báo trước "chữ này đọc từ ảnh" — xem jobs/extract.ts.
 */

/** Ảnh to hơn mức này bị thu nhỏ: thêm điểm ảnh gần như không thêm chữ đọc được, chỉ thêm giây. */
const MAX_WIDTH = 1600;
/** Số dải ngang ở lượt hai. 3 dải là đủ để chữ tiêu đề lọt vào một dải trọn vẹn. */
const BAND_COUNT = 3;
/** Dải chồng lên nhau 15% để dòng chữ nằm đúng chỗ cắt không bị mất một nửa. */
const BAND_OVERLAP = 0.15;
/** Trần ký tự trả về cho một ảnh — chặn poster dày chữ thổi phồng prompt gửi model. */
const MAX_TEXT_CHARS = 4000;
/** Ảnh nặng hơn mức này gần như chắc chắn không phải poster JD. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;

let workerPromise: Promise<Worker> | null = null;

/**
 * Một worker dùng chung cho cả lần chạy.
 *
 * Khởi tạo tốn 1-2 giây và lần đầu còn phải tải bộ dữ liệu tiếng Việt (~15 MB)
 * — dựng lại cho từng ảnh là tự nhân số giây đó lên. Bộ dữ liệu được cache vào
 * SESSION_DIR nên chỉ tải một lần trong đời máy chủ.
 */
async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    // Tesseract ghi bộ dữ liệu vào thư mục này ngay lần đầu, và nó KHÔNG tự tạo
    // thư mục — máy chủ mới dựng sẽ gãy ở đúng dòng ghi file đó.
    mkdirSync(config.ocrCacheDir, { recursive: true });
    workerPromise = createWorker(["vie", "eng"], 1, {
      cachePath: config.ocrCacheDir,
      // Tesseract in ra stderr khá nhiều dòng vô hại ("Estimating resolution as
      // 164"); log cron đã đủ dày rồi.
      logger: () => {},
      errorHandler: (e) => console.warn(`[ocr] ${String(e)}`),
    });
  }
  return workerPromise;
}

/** Trả worker về hệ thống. Gọi ở cuối lệnh cron, nếu không tiến trình không thoát. */
export async function closeOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise.catch(() => null);
  workerPromise = null;
  await worker?.terminate().catch(() => {});
}

/** Bỏ dòng rác và dòng lặp giữa các lượt đọc, giữ nguyên thứ tự xuất hiện. */
export function mergeOcrLines(chunks: string[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const chunk of chunks) {
    for (const raw of chunk.split("\n")) {
      const line = raw.replace(/\s+/g, " ").trim();
      // Dòng 1-2 ký tự gần như luôn là mảnh vỡ của icon hoặc đường kẻ.
      if (line.length < 3) continue;
      // Dòng không có lấy một chữ cái/chữ số là rác hình vẽ.
      if (!/[\p{L}\p{N}]/u.test(line)) continue;
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
  }

  const text = lines.join("\n");
  return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}…` : text;
}

/** Đọc chữ trong MỘT ảnh. Ảnh hỏng hoặc Tesseract lỗi thì trả chuỗi rỗng, không ném. */
export async function ocrImage(buffer: Buffer): Promise<string> {
  try {
    const worker = await getWorker();
    const meta = await sharp(buffer).metadata();
    const width = Math.min(meta.width ?? MAX_WIDTH, MAX_WIDTH);
    const base = sharp(buffer).resize({ width, withoutEnlargement: true });
    const height = Math.round(((meta.height ?? width) * width) / (meta.width ?? width));

    const chunks: string[] = [];

    // Lượt 1 — toàn trang, để Tesseract tự chia khối. Đây là lượt lấy được phần thân.
    await worker.setParameters({ tessedit_pageseg_mode: "3" as never });
    const full = await base.clone().grayscale().normalise().png().toBuffer();
    chunks.push((await worker.recognize(full)).data.text);

    // Lượt 2 — cắt dải ngang, coi mỗi dải là một khối chữ. Đây là lượt cứu tiêu đề cỡ lớn.
    await worker.setParameters({ tessedit_pageseg_mode: "6" as never });
    const bandHeight = Math.round(height / BAND_COUNT);
    const overlap = Math.round(bandHeight * BAND_OVERLAP);
    for (let i = 0; i < BAND_COUNT; i += 1) {
      const top = Math.max(0, i * bandHeight - overlap);
      const bandH = Math.min(height - top, bandHeight + 2 * overlap);
      if (bandH < 20) continue;
      const band = await base
        .clone()
        .extract({ left: 0, top, width, height: bandH })
        .grayscale()
        .normalise()
        .png()
        .toBuffer();
      chunks.push((await worker.recognize(band)).data.text);
    }

    // Lượt 3 — đảo màu, để chữ sáng trên nền tối thành chữ tối trên nền sáng.
    const negated = await base.clone().grayscale().negate().normalise().png().toBuffer();
    chunks.push((await worker.recognize(negated)).data.text);

    return mergeOcrLines(chunks);
  } catch (e) {
    // Một ảnh đọc hỏng không được phép làm đổ cả lần chạy cron.
    console.warn(`[ocr] không đọc được ảnh: ${String(e)}`);
    return "";
  }
}

/** Tải một ảnh về bộ nhớ. Trả null khi không phải ảnh, quá nặng, hoặc mạng hỏng. */
export async function downloadImage(
  url: string,
  headers: Record<string, string> = {},
): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const type = res.headers.get("content-type") ?? "";
    if (type && !/^image\//i.test(type)) throw new Error(`content-type ${type}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) throw new Error("ảnh rỗng");
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error(`ảnh ${buffer.length} byte, quá nặng`);
    return buffer;
  } catch (e) {
    console.warn(`[ocr] không tải được ảnh ${url}: ${String(e)}`);
    return null;
  }
}
