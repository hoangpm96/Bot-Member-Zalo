import type { JobSource, RawJobItem } from "./types.js";

/**
 * Gom tin nhắn rời thành cụm.
 *
 * Bài Facebook là một khối trọn vẹn, nhưng trong Zalo/Telegram người ta hay
 * nhắn rải: "Team mình cần tuyển BA" → "Lương 20-25tr" → "HN, inbox mình nhé".
 * Đưa từng tin cho AI thì mất sạch ngữ cảnh, nên phải ghép lại trước.
 *
 * Luật ghép: cùng NGƯỜI GỬI và cách tin trước không quá `gapMs`. Người khác
 * chen vào giữa KHÔNG cắt cụm — trong group đông, tin của người khác xen vào
 * giữa hai tin của cùng một nhà tuyển dụng là chuyện thường.
 */

export interface ClusterableMessage {
  /** Định danh người gửi trong phạm vi nguồn. */
  senderId: string;
  /** Tên hiển thị của người gửi. */
  author: string;
  /** Id của riêng tin này — id cụm lấy theo tin ĐẦU TIÊN. */
  messageId: string;
  text: string;
  ts: number;
  /** Link công khai tới tin gốc, nếu nguồn có. */
  url?: string | null;
}

export function clusterMessages(
  messages: ClusterableMessage[],
  source: JobSource,
  gapMs: number,
): RawJobItem[] {
  const sorted = [...messages]
    .filter((m) => m.text.trim() !== "")
    .sort((a, b) => a.ts - b.ts);

  // Cụm đang mở của từng người gửi. Đóng lại khi người đó im quá gapMs.
  const open = new Map<string, { item: RawJobItem; lastTs: number; parts: string[] }>();
  const done: RawJobItem[] = [];

  for (const msg of sorted) {
    const current = open.get(msg.senderId);

    if (current && msg.ts - current.lastTs <= gapMs) {
      current.parts.push(msg.text.trim());
      current.lastTs = msg.ts;
      continue;
    }

    if (current) done.push(finish(current));

    open.set(msg.senderId, {
      item: {
        source,
        sourceId: msg.messageId,
        author: msg.author.trim(),
        sourceUrl: msg.url ?? null,
        text: "",
        postedAt: msg.ts,
      },
      lastTs: msg.ts,
      parts: [msg.text.trim()],
    });
  }

  for (const current of open.values()) done.push(finish(current));

  return done.sort((a, b) => a.postedAt - b.postedAt);
}

function finish(current: { item: RawJobItem; parts: string[] }): RawJobItem {
  return { ...current.item, text: current.parts.join("\n") };
}
