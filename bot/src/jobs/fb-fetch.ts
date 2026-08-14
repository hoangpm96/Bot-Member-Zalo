import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetch, ProxyAgent, type Dispatcher } from "undici";
import { config } from "../config.js";

/**
 * Lấy HTML trang group Facebook, đi lần lượt nhiều đường cho tới khi có bài.
 *
 * Vì sao cần nhiều đường: Facebook vẫn phục vụ group CÔNG KHAI cho khách chưa
 * đăng nhập, nhưng chỉ với IP chưa bị đánh dấu. IP nào bị đánh dấu thì mọi
 * request đều bị đá về /login và KHÔNG tự hồi (đo thực tế: sau 42 phút vẫn
 * chặn). IP trung tâm dữ liệu của VPS gần như chắc chắn nằm trong nhóm đó.
 *
 * Đo thực tế 14/08/2026 trên chính group bahub.vn: trong 60 proxy công cộng
 * miễn phí có 4 con đọc được đủ 29 bài trải 11 ngày — và một trong số đó nằm
 * trên ASN hosting, tức không phải chuyện "dân cư mới đọc được", chỉ là IP đó
 * chưa bị đánh dấu. Nên thang đường đi ở đây xếp theo giá tiền tăng dần chứ
 * không theo loại IP.
 *
 * Thứ tự: đường đã thành công lần trước → gọi thẳng → proxy trả phí → proxy
 * miễn phí xoay vòng. Nhịp chạy là 1 lần/ngày và một lần lấy phủ ~11 ngày bài,
 * nên kể cả phải dò vài chục proxy vẫn rẻ hơn nhiều so với bỏ lỡ một ngày.
 *
 * An toàn: URL là HTTPS nên proxy chỉ mở đường hầm CONNECT, không đọc hay sửa
 * được nội dung. Không gửi cookie qua proxy trừ khi người vận hành tự khai
 * JOB_FB_COOKIE.
 */

/** Mốc cắt chuỗi: mỗi bài trong feed là một node Story độc lập. */
export const STORY_DELIM = '{"node":{"__typename":"Story"';

/** Lỗi bị Facebook chặn — khác hẳn lỗi mạng, và TUYỆT ĐỐI không được thử lại cùng IP. */
export class FacebookBlockedError extends Error {}

/** `null` = gọi thẳng, chuỗi = URL proxy. */
type Route = string | null;

const GROUP_TIMEOUT_MS = 60_000;
/**
 * Proxy trả phí phải nhanh hơn: một endpoint residential không trả lời trong 30
 * giây thì cũng sẽ không kéo nổi trang 2 MB. Chờ lâu ở đây làm chậm cả thang
 * đường đi phía sau.
 */
const PAID_TIMEOUT_MS = 30_000;
/** Proxy miễn phí phần lớn là rác — chờ lâu chỉ tổ kéo dài lần chạy. */
const FREE_PROXY_TIMEOUT_MS = 20_000;
/** Dò proxy miễn phí theo lô song song, dừng ngay khi có con đọc được. */
const FREE_PROXY_BATCH = 8;

/**
 * Chuẩn hoá một dòng proxy về URL đầy đủ.
 *
 * Nhận cả hai kiểu hay gặp: URL sẵn (`http://user:pass@host:port`) và kiểu
 * Webshare xuất ra từ dashboard (`host:port:user:pass`). Nhận thêm `host:port`
 * trần cho danh sách miễn phí.
 */
export function parseProxyEntry(raw: string): string | null {
  const line = raw.trim();
  if (!line || line.startsWith("#")) return null;

  if (/^(https?|socks[45]):\/\//i.test(line)) return line;

  const parts = line.split(":");
  if (parts.length === 2) return `http://${parts[0]}:${parts[1]}`;
  if (parts.length === 4) {
    const [host, port, user, pass] = parts;
    return `http://${encodeURIComponent(user!)}:${encodeURIComponent(pass!)}@${host}:${port}`;
  }
  return null;
}

/** Bóc danh sách proxy từ một khối text (env hoặc file tải về). */
export function parseProxyList(raw: string): string[] {
  const seen = new Set<string>();
  for (const line of raw.split(/[\s,]+/)) {
    const url = parseProxyEntry(line);
    if (url) seen.add(url);
  }
  return [...seen];
}

/**
 * HTML có phải feed group thật không.
 *
 * Cần thiết vì proxy hỏng hay trả trang lỗi của chính nó với HTTP 200, và
 * Facebook cũng có thể trả 200 kèm trang đăng nhập. Chỉ đếm node Story mới
 * phân biệt được "lấy được bài" với "lấy được thứ gì đó".
 */
export function isGroupFeedHtml(html: string): boolean {
  return html.includes(STORY_DELIM);
}

/**
 * Xếp thứ tự đường đi. Đường thành công lần trước luôn đứng đầu: proxy tốt
 * hiếm, giữ được con nào thì lần sau đỡ phải dò lại từ đầu.
 *
 * Proxy trả phí được lặp lại `paidAttempts` lần vì loại residential xoay vòng
 * (IPRoyal, Decodo...) trả một IP thoát KHÁC nhau ở mỗi lần gọi — gọi lại cùng
 * endpoint tức là bốc IP mới, chứ không phải đâm đầu vào đúng bức tường cũ.
 * Lần bị chặn chỉ tốn một phản hồi 302 vài trăm byte nên thử lại gần như không
 * tốn băng thông đã mua. Lặp kiểu xen kẽ (a, b, a, b) để nếu khai nhiều nhà
 * cung cấp thì nhà nào cũng được thử sớm.
 */
export function buildRouteOrder(opts: {
  cached: Route | undefined;
  paid: string[];
  paidAttempts: number;
}): Route[] {
  const repeated: string[] = [];
  for (let round = 0; round < Math.max(1, opts.paidAttempts); round += 1) {
    repeated.push(...opts.paid);
  }

  const routes: Route[] = [null, ...repeated];
  if (opts.cached === undefined) return routes;

  // Chỉ gỡ MỘT lượt: các lượt lặp còn lại vẫn là cơ hội bốc IP mới, không phải thừa.
  const idx = routes.indexOf(opts.cached);
  if (idx >= 0) routes.splice(idx, 1);
  return [opts.cached, ...routes];
}

/** Nơi nhớ đường đi đã thành công. Mất file này chỉ tốn thêm một lần dò. */
function cachePath(): string {
  return path.join(config.sessionDir, "fb-proxy.json");
}

export function readCachedRoute(): Route | undefined {
  try {
    const file = cachePath();
    if (!existsSync(file)) return undefined;
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { route?: Route };
    return "route" in parsed ? (parsed.route ?? null) : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedRoute(route: Route): void {
  try {
    mkdirSync(config.sessionDir, { recursive: true });
    writeFileSync(cachePath(), JSON.stringify({ route, at: Date.now() }, null, 2));
  } catch (e) {
    // Không ghi được cache chỉ làm lần sau chậm hơn, không đáng để hỏng cả lần chạy.
    console.warn(`[daily-jobs] Không ghi được cache proxy: ${String(e)}`);
  }
}

function headers(): Record<string, string> {
  const base: Record<string, string> = {
    "User-Agent": config.jobFbUserAgent,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
  };
  if (config.jobFbCookie) base.Cookie = config.jobFbCookie;
  return base;
}

/** Một lần gọi qua đúng một đường. Ném FacebookBlockedError nếu bị chặn. */
async function fetchVia(url: string, route: Route, timeoutMs: number): Promise<string> {
  const dispatcher: Dispatcher | undefined = route ? new ProxyAgent(route) : undefined;
  try {
    const res = await fetch(url, {
      dispatcher,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: headers(),
    });

    // status 0 = undici đã lọc response chuyển hướng; vẫn là chuyển hướng.
    if (res.status === 0 || (res.status >= 300 && res.status < 400)) {
      const target = res.headers.get("location") ?? "";
      throw new FacebookBlockedError(
        /login/i.test(target) || target === ""
          ? "Facebook đá về trang đăng nhập."
          : `Facebook chuyển hướng sang ${target}.`,
      );
    }
    // 4xx ở đây cũng là Facebook chủ động từ chối, không phải trục trặc đường truyền.
    if (!res.ok) throw new FacebookBlockedError(`HTTP ${res.status}`);

    const html = await res.text();
    if (!isGroupFeedHtml(html)) {
      throw new FacebookBlockedError(`trả về ${html.length} ký tự nhưng không có bài nào`);
    }
    return html;
  } finally {
    await dispatcher?.close();
  }
}

/** Tải danh sách proxy miễn phí. Lỗi mạng ở bước này không được làm hỏng lần chạy. */
async function loadFreeProxies(): Promise<string[]> {
  try {
    const res = await fetch(config.jobFbFreeProxyUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = parseProxyList(await res.text());
    // Xáo trộn: danh sách công cộng ai cũng đọc từ trên xuống, đi theo thứ tự gốc
    // là chen nhau vào đúng những con đã quá tải.
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j]!, list[i]!];
    }
    return list.slice(0, config.jobFbFreeProxyMaxTries);
  } catch (e) {
    console.warn(`[daily-jobs] Không tải được danh sách proxy miễn phí: ${String(e)}`);
    return [];
  }
}

/**
 * Cookie còn sống không.
 *
 * Chỉ gọi khi mọi đường đều hỏng VÀ có khai cookie: tường đăng nhập do IP bẩn
 * và do cookie hết hạn nhìn giống hệt nhau ở trang group, nên phải hỏi một bề
 * mặt khác mới phân biệt được. `/me/` chuyển hướng về trang cá nhân khi cookie
 * còn sống, về /login khi đã chết.
 */
async function cookieLooksDead(route: Route): Promise<boolean> {
  const dispatcher: Dispatcher | undefined = route ? new ProxyAgent(route) : undefined;
  try {
    const res = await fetch("https://www.facebook.com/me/", {
      dispatcher,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
      headers: headers(),
    });
    return /login|checkpoint/i.test(res.headers.get("location") ?? "");
  } catch {
    // Không kiểm tra được thì đừng vu cho cookie — để thông báo chung.
    return false;
  } finally {
    await dispatcher?.close();
  }
}

function describe(route: Route): string {
  if (route === null) return "gọi thẳng";
  // Che user:pass — thông báo này đi vào log và Telegram.
  return `proxy ${route.replace(/\/\/[^@]*@/, "//")}`;
}

export interface FbFetchResult {
  html: string;
  /** Đường đã dùng, để log — đã che thông tin đăng nhập proxy. */
  via: string;
}

/**
 * Lấy HTML trang group, đi hết thang đường đi mới chịu thua.
 *
 * Chỉ ném lỗi khi KHÔNG đường nào lấy được bài. Lúc đó thông báo phải nói rõ
 * đã thử những gì, vì người vận hành đọc nó để quyết định mua proxy hay lấy
 * lại cookie.
 */
export async function fetchFbGroupHtml(groupSlug: string): Promise<FbFetchResult> {
  const url = `https://www.facebook.com/groups/${groupSlug}/`;
  const cached = readCachedRoute();
  const routes = buildRouteOrder({
    cached,
    paid: parseProxyList(config.jobFbProxies),
    paidAttempts: config.jobFbProxyAttempts,
  });
  const failures: string[] = [];
  let lastRoute: Route = null;
  /**
   * Đường chết ở tầng kết nối thì bỏ luôn các lượt lặp còn lại của nó.
   *
   * Thử lại chỉ có ý nghĩa khi Facebook chặn — lượt sau bốc IP thoát khác. Còn
   * khi chính endpoint proxy không bắt tay được (nhà cung cấp chặn IP máy chủ
   * này, sập, sai cổng) thì lượt sau cũng vậy: mỗi lượt ngồi chờ hết 30 giây,
   * ba lượt là mất một phút rưỡi trước khi kịp thử đường khác.
   */
  const dead = new Set<string>();

  for (const route of routes) {
    if (route !== null && dead.has(route)) continue;
    lastRoute = route;
    try {
      const html = await fetchVia(url, route, route === null ? GROUP_TIMEOUT_MS : PAID_TIMEOUT_MS);
      if (route !== cached) writeCachedRoute(route);
      return { html, via: describe(route) };
    } catch (e) {
      if (route !== null && !(e instanceof FacebookBlockedError)) dead.add(route);
      failures.push(`${describe(route)}: ${e instanceof Error ? e.message : String(e)}`);
      console.warn(`[daily-jobs] ${describe(route)} không lấy được group: ${String(e)}`);
    }
  }

  if (config.jobFbFreeProxyEnabled) {
    const free = await loadFreeProxies();
    console.log(`[daily-jobs] Dò ${free.length} proxy miễn phí để đọc group Facebook.`);

    for (let i = 0; i < free.length; i += FREE_PROXY_BATCH) {
      const batch = free.slice(i, i + FREE_PROXY_BATCH);
      const results = await Promise.allSettled(
        batch.map((p) =>
          fetchVia(url, p, FREE_PROXY_TIMEOUT_MS).then((html) => ({ html, route: p })),
        ),
      );
      const win = results.find((r) => r.status === "fulfilled");
      if (win && win.status === "fulfilled") {
        writeCachedRoute(win.value.route);
        return { html: win.value.html, via: describe(win.value.route) };
      }
    }
    failures.push(`${free.length} proxy miễn phí đều không đọc được`);
  }

  // Đường nào cũng hỏng: xoá cache để lần sau dò lại từ đầu thay vì bám con đã chết.
  if (cached !== undefined) writeCachedRoute(null);

  if (config.jobFbCookie && (await cookieLooksDead(lastRoute))) {
    throw new FacebookBlockedError(
      "JOB_FB_COOKIE đã hết hạn — Facebook không còn nhận phiên đăng nhập này. " +
        "Cần đăng nhập lại bằng trình duyệt rồi lấy cookie mới.",
    );
  }

  throw new FacebookBlockedError(
    `Không đường nào đọc được group ${groupSlug}. Đã thử: ${failures.join(" | ")}. ` +
      "Cần khai proxy trả phí ở JOB_FB_PROXIES (hoặc cookie ở JOB_FB_COOKIE).",
  );
}
