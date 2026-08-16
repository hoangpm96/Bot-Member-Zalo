import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { downloadImage } from "./jobs/ocr.js";

/**
 * Giữ lại ảnh gửi vào group Zalo để đọc chữ trong đó về sau.
 *
 * VÌ SAO PHẢI TẢI NGAY LÚC NHẬN TIN: link ảnh Zalo trả về trong sự kiện là link
 * TẠM. Bản tóm tắt và tin tuyển dụng đều chạy theo cron mỗi ngày một lần, tới
 * lúc đó mới đi tải thì phần lớn link đã chết — và ảnh JD anh em quăng vào nhóm
 * là thứ mất đi thì không lấy lại được.
 *
 * Ảnh chỉ là bản nháp trung gian: đọc chữ xong là xoá. Kho lưu lâu dài vẫn chỉ
 * có chữ, không có ảnh.
 */

/** Ảnh Zalo nặng hơn mức này gần như chắc chắn không phải ảnh JD cần đọc. */
const MAX_BYTES = 12 * 1024 * 1024;

function ensureDir(): string {
  mkdirSync(config.zaloMediaDir, { recursive: true });
  return config.zaloMediaDir;
}

/** Tên file an toàn: id của Zalo có thể chứa ký tự không dùng được trên đĩa. */
export function mediaFileName(threadId: string, messageId: string): string {
  const safe = `${threadId}-${messageId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
  return `${safe}.img`;
}

/**
 * Tải một ảnh về đĩa, trả về đường dẫn đã lưu (chuỗi rỗng nếu không tải được).
 *
 * Nuốt mọi lỗi: đây là việc chạy kèm trong luồng nhận tin real-time, hỏng một
 * tấm ảnh không được phép ảnh hưởng tới việc ghi nhận tương tác của thành viên.
 */
export async function saveZaloImage(input: {
  url: string;
  threadId: string;
  messageId: string;
}): Promise<string> {
  if (!config.jobOcrEnabled) return "";
  try {
    const buffer = await downloadImage(input.url);
    if (!buffer || buffer.length > MAX_BYTES) return "";

    const file = path.join(ensureDir(), mediaFileName(input.threadId, input.messageId));
    writeFileSync(file, buffer);
    return file;
  } catch (e) {
    console.warn(`[zalo-media] không lưu được ảnh: ${String(e)}`);
    return "";
  }
}

/** Xoá một file ảnh đã dùng xong. Không có file thì coi như xong việc. */
export function removeMediaFile(file: string): void {
  try {
    if (file && existsSync(file)) unlinkSync(file);
  } catch (e) {
    console.warn(`[zalo-media] không xoá được ${file}: ${String(e)}`);
  }
}

/**
 * Dọn ảnh cũ còn sót trên đĩa.
 *
 * Lưới an toàn cho các đường rơi: tin bị thu hồi nên không bao giờ được đọc,
 * cron tóm tắt tắt vài hôm, hoặc dòng DB bị xoá mà file thì không. Không có nó
 * thì thư mục ảnh chỉ có phình ra.
 */
export function cleanupOldMedia(now: number): number {
  const dir = config.zaloMediaDir;
  if (!existsSync(dir)) return 0;

  const cutoff = now - config.zaloMediaKeepDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    try {
      if (statSync(file).mtimeMs >= cutoff) continue;
      unlinkSync(file);
      removed += 1;
    } catch {
      // File biến mất giữa chừng hoặc không đọc được thuộc tính — bỏ qua.
    }
  }
  return removed;
}
