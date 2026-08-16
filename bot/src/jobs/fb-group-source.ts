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
/**
 * Ảnh đính kèm của bài.
 *
 * Phải bám đúng khoá `photo_image` chứ không phải mọi link ảnh trong khối:
 * cùng khối còn có `profile_picture` (avatar người đăng, 40×40). Lấy nhầm avatar
 * là mỗi bài lại tốn một lượt đọc chữ trên tấm ảnh chân dung.
 *
 * Bản Facebook trả cho trình thu thập nằm ở lookaside.fbsbx.com kèm `media_id` —
 * KHÔNG phải link scontent có chữ ký hết hạn sau vài giờ. Đo ngày 16/08/2026:
 * tải được bằng UA thường, không cookie, ra đúng ảnh gốc 1536×1024.
 */
const RE_PHOTO = /"photo_image":\{"uri":"((?:[^"\\]|\\.)*)"/g;

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

/** Link ảnh của một bài, đã bỏ trùng (Facebook nhắc lại cùng một ảnh vài lần trong khối). */
function photoUrls(chunk: string): string[] {
  const urls = new Set<string>();
  for (const m of chunk.matchAll(RE_PHOTO)) {
    const url = decodeJsonString(m[1]!);
    if (/^https:\/\//i.test(url)) urls.add(url);
  }
  return [...urls];
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
    if (!postId || !creation) continue;
    if (seen.has(postId)) continue;

    const message = firstMatch(chunk, RE_MESSAGE);
    const text = message ? decodeJsonString(message).trim() : "";
    const images = photoUrls(chunk);
    // Bài rỗng chữ mà CÓ ảnh vẫn được giữ: rất nhiều tin tuyển dụng là một tấm
    // poster quăng lên không kèm lời nào, chữ nằm hết trong ảnh và bước sau sẽ
    // đọc ra. Rỗng cả chữ lẫn ảnh thì mới thực sự không có gì để xử lý.
    if (!text && images.length === 0) continue;

    seen.add(postId);
    items.push({
      source: "facebook",
      sourceId: postId,
      author: decodeJsonString(firstMatch(chunk, RE_AUTHOR) ?? "").trim(),
      sourceUrl: `https://www.facebook.com/groups/${groupSlug}/posts/${postId}/`,
      text,
      postedAt: Number(creation) * 1000,
      imageUrls: images,
    });
  }

  return items;
}

/** Slug group nằm trong link bài. Dùng để biết một tin đã lưu đến từ group nào. */
export function groupSlugFromUrl(url: string | null): string {
  if (!url) return "";
  return /facebook\.com\/groups\/([^/]+)/i.exec(url)?.[1] ?? "";
}

/**
 * Thứ hạng ưu tiên của một group: 0 là cao nhất (group đứng đầu JOB_FB_GROUP_SLUG).
 *
 * Group không nằm trong danh sách khai báo đứng sau tất cả — có thể là tin cũ
 * còn trong kho từ hồi group đó còn được theo dõi.
 */
export function fbGroupRank(slug: string): number {
  const idx = config.jobFbGroupSlugs.indexOf(slug);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

/**
 * Lấy bài mới hơn `sinceTs` từ MỘT group Facebook.
 *
 * Bài ghim (thường là bài giới thiệu group từ nhiều năm trước) luôn xuất hiện
 * trong mọi lần lấy — lọc theo thời gian đăng là đủ để nó không lọt vào mỗi ngày.
 */
export async function fetchFbGroupJobs(
  groupSlug: string,
  sinceTs: number,
): Promise<RawJobItem[]> {
  if (!groupSlug) return [];

  const { html, via } = await fetchFbGroupHtml(groupSlug);
  const all = parseFbGroupHtml(html, groupSlug);

  if (all.length === 0) {
    // fb-fetch đã bảo đảm HTML có node Story, nên tới đây mà không ra bài nào
    // nghĩa là hình dạng JSON bên trong node đã đổi — lỗi parse, không phải bị
    // chặn. Ném lỗi để cron ghi bot_errors thay vì lặng lẽ coi như "hôm nay
    // không có tin".
    throw new Error(
      `Không bóc được bài nào từ group ${groupSlug} (HTML ${html.length} ký tự, ${via}) — ` +
        "nhiều khả năng Facebook đổi cấu trúc dữ liệu trong trang.",
    );
  }

  const fresh = all
    .filter((item) => item.postedAt > sinceTs)
    .sort((a, b) => a.postedAt - b.postedAt);

  console.log(
    `[daily-jobs] Group Facebook ${groupSlug}: ${all.length} bài, ${fresh.length} bài mới (${via}).`,
  );

  return fresh;
}
