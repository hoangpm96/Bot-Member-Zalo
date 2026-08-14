import { config } from "../config.js";
import type { RawJobItem } from "./types.js";

/**
 * Nguồn tin tuyển dụng từ GROUP FACEBOOK CÔNG KHAI (mặc định: bahub.vn).
 *
 * Vì sao không dùng Graph API: Meta đã gỡ Groups API khỏi mọi phiên bản từ
 * 22/04/2024 (cả publish_to_groups lẫn groups_access_member_info), không còn
 * đường chính thức nào để đọc feed group.
 *
 * Cách làm ở đây: gọi HTTP thường tới trang group. Group công khai nên KHÔNG
 * cần đăng nhập, KHÔNG cần cookie, KHÔNG tài khoản nào bị đặt vào rủi ro. Điều
 * kiện duy nhất là User-Agent: Facebook chỉ trả bản server-render đầy đủ (~30
 * bài, ~11 ngày) cho UA của bot công cụ tìm kiếm; UA trình duyệt chỉ được 2 bài
 * và phần còn lại nằm sau GraphQL phân trang. Đó là lý do JOB_FB_USER_AGENT mặc
 * định là UA crawler — đây là lựa chọn có ý thức của người vận hành, ghi ra env
 * để đổi được mà không phải sửa code.
 *
 * Nhịp gọi: 1 lần/ngày. Một lần lấy đã phủ ~11 ngày nên mất mạng vài hôm vẫn
 * bắt kịp, không cần gọi dày.
 */

/** Mốc cắt chuỗi: mỗi bài trong feed là một node Story độc lập. */
const STORY_DELIM = '{"node":{"__typename":"Story"';

const RE_POST_ID = /"post_id":"(\d+)"/;
const RE_CREATION = /"creation_time":(\d{10})/;
const RE_AUTHOR = /"owning_profile":\{"__typename":"User","name":"((?:[^"\\]|\\.)*)"/;
const RE_MESSAGE = /"message":\{"text":"((?:[^"\\]|\\.)*)"/;

/** Chuỗi trong HTML là JSON đã escape (ọ, \n...) — trả lại ký tự thật. */
function decodeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

function firstMatch(chunk: string, re: RegExp): string | null {
  const m = re.exec(chunk);
  return m ? m[1]! : null;
}

/**
 * Bóc danh sách bài từ HTML trang group.
 *
 * Tách hàm riêng khỏi phần fetch để test được bằng fixture: cấu trúc HTML của
 * Facebook là thứ dễ đổi nhất trong cả tính năng này, có test thì lúc gãy sẽ
 * biết ngay là gãy ở đâu.
 */
export function parseFbGroupHtml(html: string, groupSlug: string): RawJobItem[] {
  const chunks = html.split(STORY_DELIM).slice(1);
  const items: RawJobItem[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const postId = firstMatch(chunk, RE_POST_ID);
    const creation = firstMatch(chunk, RE_CREATION);
    const message = firstMatch(chunk, RE_MESSAGE);
    if (!postId || !creation || !message) continue;
    if (seen.has(postId)) continue;

    const text = decodeJsonString(message).trim();
    if (!text) continue;

    seen.add(postId);
    items.push({
      source: "facebook",
      sourceId: postId,
      author: decodeJsonString(firstMatch(chunk, RE_AUTHOR) ?? "").trim(),
      sourceUrl: `https://www.facebook.com/groups/${groupSlug}/posts/${postId}/`,
      text,
      postedAt: Number(creation) * 1000,
    });
  }

  return items;
}

/** Số lần thử và giãn cách khi bị Facebook chặn tạm. Chạy 1 lần/ngày nên chờ vài phút là rẻ. */
const FETCH_ATTEMPTS = 3;
const FETCH_RETRY_GAP_MS = [2 * 60_000, 10 * 60_000];

/**
 * Tải HTML trang group. Tách riêng để test parse không cần mạng.
 *
 * `redirect: "manual"` là cố ý. Khi bị chặn tạm (gọi quá dày từ một IP),
 * Facebook trả 302 về /login — mà fetch mặc định ĐI THEO redirect và trả về
 * trang đăng nhập 400KB với HTTP 200. Nuốt cái đó thì lỗi "bị chặn" hoá thành
 * "hôm nay group không có bài nào", sai hoàn toàn về bản chất.
 */
async function fetchOnce(groupSlug: string): Promise<string> {
  const res = await fetch(`https://www.facebook.com/groups/${groupSlug}/`, {
    signal: AbortSignal.timeout(60_000),
    redirect: "manual",
    headers: {
      "User-Agent": config.jobFbUserAgent,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    },
  });

  if (res.status >= 300 && res.status < 400) {
    const target = res.headers.get("location") ?? "";
    throw new Error(
      /login/i.test(target)
        ? "Facebook đá về trang đăng nhập — IP đang bị chặn tạm vì gọi quá dày. " +
          "Giảm nhịp gọi hoặc đổi JOB_FB_USER_AGENT."
        : `Facebook chuyển hướng sang ${target || "(không rõ)"}.`,
    );
  }
  if (!res.ok) throw new Error(`Tải group Facebook lỗi: HTTP ${res.status}`);

  return res.text();
}

export async function fetchFbGroupHtml(groupSlug: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await fetchOnce(groupSlug);
    } catch (e) {
      lastError = e;
      const gap = FETCH_RETRY_GAP_MS[attempt];
      if (gap === undefined) break;
      console.warn(
        `[daily-jobs] Tải group Facebook lỗi (lần ${attempt + 1}/${FETCH_ATTEMPTS}): ${String(e)} ` +
          `— thử lại sau ${Math.round(gap / 60_000)} phút.`,
      );
      await new Promise((resolve) => setTimeout(resolve, gap));
    }
  }
  throw lastError;
}

/**
 * Lấy bài mới hơn `sinceTs` từ group Facebook.
 *
 * Bài ghim (thường là bài giới thiệu group từ nhiều năm trước) luôn xuất hiện
 * trong mọi lần lấy — lọc theo thời gian đăng là đủ để nó không lọt vào mỗi ngày.
 */
export async function fetchFbGroupJobs(sinceTs: number): Promise<RawJobItem[]> {
  if (!config.jobFbGroupSlug) return [];

  const html = await fetchFbGroupHtml(config.jobFbGroupSlug);
  const all = parseFbGroupHtml(html, config.jobFbGroupSlug);

  if (all.length === 0) {
    // Lấy được HTML mà không bóc ra bài nào = Facebook đổi cấu trúc hoặc chặn.
    // Ném lỗi để cron ghi bot_errors thay vì lặng lẽ coi như "hôm nay không có tin".
    throw new Error(
      `Không bóc được bài nào từ group ${config.jobFbGroupSlug} (HTML ${html.length} ký tự) — ` +
        "nhiều khả năng Facebook đổi cấu trúc trang hoặc chặn User-Agent đang dùng.",
    );
  }

  return all
    .filter((item) => item.postedAt > sinceTs)
    .sort((a, b) => a.postedAt - b.postedAt);
}
