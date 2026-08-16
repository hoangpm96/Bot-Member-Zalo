import { readFileSync } from "node:fs";
import { config } from "../config.js";
import {
  clearGroupMediaLocalPath,
  listGroupMediaOcrBetween,
  listGroupMediaPendingOcr,
  saveGroupMediaOcr,
} from "../db/index.js";
import { removeMediaFile } from "../zalo-media.js";
import { ocrImage } from "./ocr.js";

/**
 * Đọc chữ trong ảnh anh em gửi vào group Zalo.
 *
 * Ảnh đã được listener tải sẵn về đĩa lúc nhận tin (xem zalo-media.ts) — ở đây
 * chỉ đọc file, ghi chữ vào kho rồi xoá file. Đọc một lần, hai nơi dùng: bản
 * tóm tắt hằng ngày và luồng tin tuyển dụng.
 *
 * Đọc xong là XOÁ ảnh: kho lưu lâu dài chỉ giữ chữ. Ảnh của thành viên nằm lại
 * trên đĩa máy chủ càng lâu càng khó biện minh, mà chữ mới là thứ hai luồng kia
 * cần.
 */

export interface ZaloOcrResult {
  scanned: number;
  withText: number;
}

/**
 * Đọc các ảnh chưa đọc trong một khoảng thời gian của group.
 *
 * Trần số ảnh là bắt buộc chứ không phải phòng xa: nhóm đông người có hôm cả
 * trăm ảnh, mà mỗi ảnh tốn vài giây CPU. Vượt trần thì phần còn lại để lần chạy
 * sau — ảnh cũ chưa đọc vẫn nằm nguyên đó.
 */
export async function ocrZaloImages(input: {
  threadId: string;
  startTs: number;
  endTs: number;
  now: number;
}): Promise<ZaloOcrResult> {
  if (!config.jobOcrEnabled || !input.threadId) return { scanned: 0, withText: 0 };

  const pending = listGroupMediaPendingOcr(
    input.threadId,
    input.startTs,
    input.endTs,
    config.jobOcrMaxImages,
  );
  if (pending.length === 0) return { scanned: 0, withText: 0 };

  let withText = 0;
  for (const row of pending) {
    let text = "";
    try {
      text = await ocrImage(readFileSync(row.local_path));
    } catch (e) {
      // File biến mất (đã dọn) hoặc hỏng: vẫn đánh dấu đã đọc để lần sau không
      // đâm đầu vào đúng dòng này nữa.
      console.warn(`[ocr] bỏ qua ảnh ${row.local_path}: ${String(e)}`);
    }

    saveGroupMediaOcr(row.id, text, input.now);
    if (text) withText += 1;

    removeMediaFile(row.local_path);
    clearGroupMediaLocalPath(row.id);
  }

  console.log(`[ocr] Đọc ${pending.length} ảnh Zalo, ${withText} ảnh có chữ.`);
  return { scanned: pending.length, withText };
}

/** Một dòng "tin nhắn" dựng từ chữ trong ảnh, để trộn vào dòng thời gian của group. */
export interface ImageTextMessage {
  zalo_user_id: string;
  display_name: string;
  ts: number;
  text: string;
}

/**
 * Chữ đã đọc từ ảnh, gói lại thành tin nhắn để trộn vào dòng thời gian.
 *
 * Có tiền tố "[ảnh]" vì người đọc bản tóm tắt cần biết câu này đến từ một tấm
 * ảnh chứ không phải ai đó gõ ra — chữ đọc máy có lỗi chính tả, và biết nguồn
 * gốc thì mấy chỗ sai chính tả kia không bị hiểu thành người ta viết sai.
 */
export function imageTextMessages(
  threadId: string,
  startTs: number,
  endTs: number,
): ImageTextMessage[] {
  if (!threadId) return [];
  return listGroupMediaOcrBetween(threadId, startTs, endTs).map((row) => ({
    zalo_user_id: row.zalo_user_id,
    display_name: row.display_name,
    ts: row.ts,
    text: `[ảnh] ${row.ocr_text}`,
  }));
}
