import { config } from "../config.js";
import { STORY_DELIM, fetchFbGroupHtml } from "./fb-fetch.js";
import type { RawJobItem } from "./types.js";

/**
 * Nguồn tin tuyển dụng từ GROUP FACEBOOK CÔNG KHAI (mặc định: bahub.vn).
 *
 * Vì sao không dùng Graph API: Meta đã gỡ Groups API khỏi mọi phiên bản từ
 * 22/04/2024 (cả publish_to_groups lẫn groups_access_member_info), không còn
 * đường chính thức nào để đọc feed group.
 *
 * Cách làm ở đây: gọi HTTP thường tới trang group. Group công khai nên KHÔNG
 * cần đăng nhập và mặc định KHÔNG có tài khoản nào bị đặt vào rủi ro. Điều kiện
 * duy nhất là User-Agent: Facebook chỉ trả bản server-render đầy đủ (~30 bài,
 * ~11 ngày) cho UA của bot công cụ tìm kiếm; UA trình duyệt chỉ được 2 bài và
 * phần còn lại nằm sau GraphQL phân trang. Đó là lý do JOB_FB_USER_AGENT mặc
 * định là UA crawler — đây là lựa chọn có ý thức của người vận hành, ghi ra env
 * để đổi được mà không phải sửa code.
 *
 * Việc chọn đường ra Internet (gọi thẳng / proxy / cookie) nằm ở fb-fetch.ts —
 * file này chỉ lo bóc nội dung.
 *
 * Nhịp gọi: 1 lần/ngày. Một lần lấy đã phủ ~11 ngày nên mất mạng vài hôm vẫn
 * bắt kịp, không cần gọi dày.
 */

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

/**
 * Lấy bài mới hơn `sinceTs` từ group Facebook.
 *
 * Bài ghim (thường là bài giới thiệu group từ nhiều năm trước) luôn xuất hiện
 * trong mọi lần lấy — lọc theo thời gian đăng là đủ để nó không lọt vào mỗi ngày.
 */
export async function fetchFbGroupJobs(sinceTs: number): Promise<RawJobItem[]> {
  if (!config.jobFbGroupSlug) return [];

  const { html, via } = await fetchFbGroupHtml(config.jobFbGroupSlug);
  const all = parseFbGroupHtml(html, config.jobFbGroupSlug);

  if (all.length === 0) {
    // fb-fetch đã bảo đảm HTML có node Story, nên tới đây mà không ra bài nào
    // nghĩa là hình dạng JSON bên trong node đã đổi — lỗi parse, không phải bị
    // chặn. Ném lỗi để cron ghi bot_errors thay vì lặng lẽ coi như "hôm nay
    // không có tin".
    throw new Error(
      `Không bóc được bài nào từ group ${config.jobFbGroupSlug} (HTML ${html.length} ký tự, ${via}) — ` +
        "nhiều khả năng Facebook đổi cấu trúc dữ liệu trong trang.",
    );
  }

  console.log(`[daily-jobs] Group Facebook: ${all.length} bài (${via}).`);

  return all
    .filter((item) => item.postedAt > sinceTs)
    .sort((a, b) => a.postedAt - b.postedAt);
}
