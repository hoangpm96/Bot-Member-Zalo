/**
 * Kiểu dùng chung cho luồng tin tuyển dụng (docs/tuyen-dung/).
 *
 * Ba nguồn (Facebook group công khai, topic Telegram, group Zalo) đều quy về
 * cùng một hình dạng RawJobItem trước khi đưa qua AI — nhờ vậy tầng bóc tách,
 * chống trùng và đăng bài không cần biết tin đến từ đâu.
 */

export type JobSource = "facebook" | "telegram" | "zalo";

/** Một mẩu nội dung thô đã gom xong, sẵn sàng đưa cho AI đọc. */
export interface RawJobItem {
  source: JobSource;
  /** Khoá chống lặp trong phạm vi một nguồn: post id, message id, hoặc id cụm. */
  sourceId: string;
  /** Tên người đăng như hiển thị ở nguồn. Rỗng khi nguồn không cho biết. */
  author: string;
  /** Link công khai tới bài gốc. null với nguồn kín (group Zalo). */
  sourceUrl: string | null;
  /** Nội dung đầy đủ, đã ghép nếu là cụm nhiều tin. */
  text: string;
  /** Thời điểm đăng (epoch ms). Cụm nhiều tin lấy mốc tin đầu tiên. */
  postedAt: number;
  /**
   * Ảnh đính kèm, để bước xử lý đọc chữ trong ảnh khi phần chữ quá ít.
   *
   * Facebook: link ảnh công khai, đọc lúc nào cũng được. Zalo: đường dẫn file
   * đã tải sẵn về đĩa — link gốc của Zalo là link tạm, không sống nổi tới lúc
   * cron chạy.
   */
  imageUrls?: string[];
}
