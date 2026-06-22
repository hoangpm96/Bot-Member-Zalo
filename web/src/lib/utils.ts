import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format epoch ms → chuỗi ngày giờ VN dễ đọc. */
export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

/** Format "x ngày trước" gọn. */
export function fmtAgo(ts: number | null | undefined): string {
  if (!ts) return "chưa có";
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return "hôm nay";
  if (days === 1) return "hôm qua";
  return `${days} ngày trước`;
}
