import fs from "node:fs";
import path from "node:path";
import { Zalo, LoginQRCallbackEventType } from "zca-js";
import qrcodeTerminal from "qrcode-terminal";
import { config } from "../config.js";

/**
 * Wrapper quanh zca-js. MỌI lời gọi Zalo đi qua đây — phần còn lại của code KHÔNG
 * import zca-js trực tiếp. Lý do: zca-js là API không chính thức, dễ vỡ; cô lập ở
 * 1 chỗ để dễ vá + để áp được các guard an toàn (throttle).
 *
 * Bot dùng DUY NHẤT 1 tài khoản phụ co-admin cho mọi thứ (list-groups, listener, kick).
 * Co-admin đủ quyền đọc member + kick member thường. KHÔNG bao giờ đụng tài khoản chính.
 */

interface SavedCredentials {
  cookie: unknown;
  imei: string;
  userAgent: string;
}

// zca-js api là any-shaped (lib không xuất type đầy đủ cho mọi method ta dùng).
// Cô lập `any` ở đây thay vì rải khắp code.
/* eslint-disable @typescript-eslint/no-explicit-any */
type ZaloApi = any;

function loadCredentials(): SavedCredentials | null {
  const p = config.sessionPath;
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as SavedCredentials;
  } catch {
    return null;
  }
}

function saveCredentials(creds: SavedCredentials): void {
  const p = config.sessionPath;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

/** Nghỉ giữa các call nặng — chống Zalo flag. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Chuẩn hoá timestamp từ Zalo về epoch MILLISECONDS.
 * zca-js trả ts dạng string; một số field Zalo là giây, một số là ms. Nếu giá trị
 * nhỏ hơn ngưỡng ~ năm 2001 tính theo ms (tức trông như "giây") → nhân 1000.
 * Trả null nếu không parse được.
 */
export function normalizeTs(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  // 1e12 ms ≈ 2001-09. Mốc epoch hợp lệ hiện tại > 1e12 ms. Nếu < 1e12 coi là giây.
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

type LoginState = "waiting_scan" | "scanned" | "logged_in" | "expired" | "declined";

/** Ghi trạng thái login + đường dẫn QR ra file để web panel hiển thị. */
function writeLoginStatus(state: LoginState, extra?: Record<string, unknown>): void {
  try {
    const p = path.join(config.sessionDir, "login-status.json");
    fs.mkdirSync(config.sessionDir, { recursive: true });
    fs.writeFileSync(
      p,
      JSON.stringify({ state, qr: "qr.png", updatedAt: Date.now(), ...extra }, null, 2),
      "utf8",
    );
  } catch {
    /* không chặn login nếu ghi status lỗi */
  }
}

/**
 * Đăng nhập, ƯU TIÊN tái dùng session đã lưu (KHÔNG login lặp — login dồn dập dễ bị
 * khoá tài khoản). Chỉ hiện QR khi chưa có session hoặc session hỏng.
 */
export async function login(): Promise<ZaloApi> {
  const zalo = new Zalo();
  const saved = loadCredentials();

  if (saved) {
    try {
      const api = await zalo.login({
        cookie: saved.cookie as any,
        imei: saved.imei,
        userAgent: saved.userAgent,
      });
      console.log("[zalo] Đăng nhập lại bằng session đã lưu.");
      writeLoginStatus("logged_in");
      return api;
    } catch (e) {
      console.warn(`[zalo] Session không dùng được, cần quét lại QR. (${String(e)})`);
    }
  }

  const qrPath = path.join(config.sessionDir, "qr.png");
  fs.mkdirSync(config.sessionDir, { recursive: true });
  console.log("[zalo] Đăng nhập — đang tạo mã QR...");

  // QUAN TRỌNG: khi truyền callback, zca-js KHÔNG tự lưu file QR — phải tự gọi
  // event.actions.saveToFile() ở event QRCodeGenerated, nếu không sẽ không có ảnh QR.
  const api = await zalo.loginQR({ qrPath }, (event: any) => {
    switch (event?.type) {
      case LoginQRCallbackEventType.QRCodeGenerated: {
        // 1) In QR thẳng ra terminal (ASCII) — quét trực tiếp trên SSH/VPS, không cần mở file.
        const code = event?.data?.code;
        if (code) {
          console.log("\n[zalo] 📱 QUÉT MÃ QR DƯỚI ĐÂY BẰNG APP ZALO (tài khoản co-admin):\n");
          qrcodeTerminal.generate(code, { small: true });
          console.log("");
        }
        // 2) Lưu ra file ảnh — cách quét ĐÁNG TIN nhất (QR terminal hay lỗi camera).
        //    Mở web panel trang /login để xem ảnh này cho dễ quét.
        const save = event?.actions?.saveToFile;
        if (typeof save === "function") {
          Promise.resolve(save(qrPath))
            .then(() => {
              console.log(`[zalo] 📷 QR ảnh: ${path.resolve(qrPath)} — hoặc mở web panel /login để quét.`);
              writeLoginStatus("waiting_scan");
            })
            .catch(() => {});
        } else {
          writeLoginStatus("waiting_scan");
        }
        break;
      }
      case LoginQRCallbackEventType.QRCodeScanned:
        console.log(`[zalo] ✅ Đã quét QR (${event?.data?.display_name ?? ""}). Đang hoàn tất...`);
        writeLoginStatus("scanned", { displayName: event?.data?.display_name ?? "" });
        break;
      case LoginQRCallbackEventType.QRCodeExpired:
        console.warn("[zalo] ⚠️  Mã QR hết hạn — đang tạo mã mới...");
        writeLoginStatus("expired");
        break;
      case LoginQRCallbackEventType.QRCodeDeclined:
        console.warn("[zalo] ❌ Đăng nhập bị từ chối trên điện thoại.");
        writeLoginStatus("declined");
        break;
      case LoginQRCallbackEventType.GotLoginInfo: {
        const data = event?.data;
        if (data?.cookie && data?.imei && data?.userAgent) {
          saveCredentials({
            cookie: data.cookie,
            imei: data.imei,
            userAgent: data.userAgent,
          });
          console.log("[zalo] 💾 Đã lưu session — lần sau khỏi quét lại.");
          writeLoginStatus("logged_in");
        }
        break;
      }
    }
  });
  return api;
}

// ---- Đọc thông tin group (dùng cho listener + cleanup sync member) ----

export interface GroupMemberLite {
  id: string;
  displayName: string;
  /** 'owner' | 'admin' | 'member' — suy từ creatorId/adminIds của group. */
  role: "owner" | "admin" | "member";
}

export interface GroupSnapshot {
  groupId: string;
  name: string;
  totalMember: number;
  members: GroupMemberLite[];
}

/** Suy role từ creatorId/adminIds của group. */
function roleOf(id: string, creatorId: string, adminIds: string[]): GroupMemberLite["role"] {
  if (id && id === creatorId) return "owner";
  if (id && adminIds.includes(id)) return "admin";
  return "member";
}

/**
 * Lấy snapshot thành viên group + phân loại role (owner/admin/member). READ-ONLY.
 *
 * Với nhóm/community lớn (đã verify trên group thật 998 người), getGroupInfo trả
 * `currentMems`/`memberIds` RỖNG nhưng có `memVerList` = ["<id>_<ver>", ...] đủ mọi
 * thành viên. Nên: tách id từ memVerList → getGroupMembersInfo theo lô (throttle) để
 * lấy tên. Role ghép từ creatorId + adminIds của getGroupInfo (profile không có role).
 * Fallback currentMems nếu phiên bản/nhóm nhỏ có sẵn.
 */
export async function getGroupSnapshot(
  api: ZaloApi,
  groupId: string,
  throttleMs = config.zaloThrottleMs,
): Promise<GroupSnapshot> {
  const info = await api.getGroupInfo(groupId);
  const g = info?.gridInfoMap?.[groupId] ?? info?.[groupId] ?? info;

  const creatorId: string = g?.creatorId ?? "";
  const adminIds: string[] = Array.isArray(g?.adminIds) ? g.adminIds : [];
  const name = String(g?.name ?? "");
  const totalMember = Number(g?.totalMember ?? 0);

  // Đường nhanh: nếu currentMems có sẵn (nhóm nhỏ) → dùng luôn.
  const currentMems: any[] = Array.isArray(g?.currentMems) ? g.currentMems : [];
  if (currentMems.length > 0) {
    const members = currentMems.map((m) => {
      const id = String(m?.id ?? "");
      return { id, displayName: String(m?.dName ?? m?.zaloName ?? ""), role: roleOf(id, creatorId, adminIds) };
    });
    return { groupId, name, totalMember: totalMember || members.length, members };
  }

  // Nhóm lớn: tách id từ memVerList ("<id>_<ver>") rồi lấy profile theo lô.
  const memVerList: string[] = Array.isArray(g?.memVerList) ? g.memVerList : [];
  const ids: string[] = memVerList
    .map((x) => String(x).split("_")[0] ?? "")
    .filter((id) => id !== "");
  if (ids.length === 0) {
    return { groupId, name, totalMember, members: [] };
  }

  const members: GroupMemberLite[] = [];
  const BATCH = 50;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    let resp: any;
    try {
      resp = await api.getGroupMembersInfo(batch);
    } catch (e) {
      console.warn(`[zalo] getGroupMembersInfo lỗi ở lô ${i / BATCH}: ${String(e)}`);
      continue;
    }
    const profiles = resp?.profiles ?? {};
    for (const id of batch) {
      const p = profiles[id];
      members.push({
        id,
        displayName: String(p?.displayName ?? p?.zaloName ?? ""),
        role: roleOf(id, creatorId, adminIds),
      });
    }
    if (i + BATCH < ids.length) await sleep(throttleMs);
  }

  return { groupId, name, totalMember: totalMember || members.length, members };
}

export interface GroupBrief {
  groupId: string;
  name: string;
  totalMember: number;
}

/**
 * Liệt kê các group tài khoản đang tham gia (READ-ONLY). Dùng để tra GROUP_ID lúc setup.
 * getAllGroups() chỉ trả về danh sách ID (gridVerMap), nên gọi tiếp getGroupInfo() cho
 * các ID đó để lấy tên + số thành viên.
 */
export async function listGroups(api: ZaloApi, throttleMs: number): Promise<GroupBrief[]> {
  const all = await api.getAllGroups();
  const ids: string[] = Object.keys(all?.gridVerMap ?? {});
  if (ids.length === 0) return [];

  const out: GroupBrief[] = [];
  // getGroupInfo nhận mảng ID; lấy theo lô nhỏ + throttle để tránh flag.
  const BATCH = 20;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    let info: any;
    try {
      info = await api.getGroupInfo(batch);
    } catch (e) {
      console.warn(`[list-groups] getGroupInfo lỗi ở lô ${i / BATCH}: ${String(e)}`);
      continue;
    }
    const map = info?.gridInfoMap ?? info ?? {};
    for (const id of batch) {
      const g = map?.[id];
      if (!g) continue;
      out.push({
        groupId: id,
        name: String(g?.name ?? "(không tên)"),
        totalMember: Number(g?.totalMember ?? 0),
      });
    }
    if (i + BATCH < ids.length) await sleep(throttleMs);
  }
  return out;
}

// Ghi chú: KHÔNG có hàm kéo lịch sử CHAT/REACTION quá khứ — getGroupChatHistory trả 404
// với Zalo Community, không có API nào khác (đã verify). Nhưng VOTE thì đọc được: poll lưu
// trạng thái trên server (xem fetchGroupPollVotes), nên lấy được cả voter cũ lẫn mới.

export interface PollVote {
  voterId: string;
  ts: number;
  pollId: number;
}

/**
 * Đọc danh sách người đã vote trong mọi poll đang có của group (READ-ONLY).
 * getListBoard(groupId) liệt kê board item (note/pinned/poll); item poll (boardType=3)
 * có data.options[].voters[] = ID người vote. Đọc được cả vote CŨ vì poll lưu trạng thái
 * trên server (khác chat/reaction).
 *
 * ⚠️ Giới hạn (verify khi chạy thật): poll ẩn danh (is_anonymous) → voters có thể rỗng;
 * poll đã hết hạn/xoá → không còn trong board; phân trang qua page/count.
 * ts dùng updated_time của poll (không có mốc vote từng người) — đủ cho "có tương tác".
 */
export async function fetchGroupPollVotes(
  api: ZaloApi,
  groupId: string,
  opts: { maxPages: number; throttleMs: number },
): Promise<PollVote[]> {
  const POLL_BOARD_TYPE = 3;
  const out: PollVote[] = [];
  let anonymousSkipped = 0;

  for (let page = 1; page <= opts.maxPages; page += 1) {
    let resp: any;
    try {
      resp = await api.getListBoard({ page, count: 20 }, groupId);
    } catch (e) {
      console.warn(`[votes] getListBoard lỗi ở trang ${page}: ${String(e)}`);
      break;
    }

    const items: any[] = resp?.items ?? [];
    if (items.length === 0) break;

    for (const it of items) {
      if (Number(it?.boardType) !== POLL_BOARD_TYPE) continue;
      const poll = it?.data;
      if (!poll) continue;
      if (poll?.is_anonymous) {
        anonymousSkipped += 1;
        continue;
      }
      const pollId = Number(poll?.poll_id ?? 0);
      const ts = normalizeTs(poll?.updated_time ?? poll?.created_time) ?? Date.now();
      const options: any[] = Array.isArray(poll?.options) ? poll.options : [];
      for (const op of options) {
        const voters: any[] = Array.isArray(op?.voters) ? op.voters : [];
        for (const v of voters) {
          const voterId = String(v ?? "");
          if (voterId) out.push({ voterId, ts, pollId });
        }
      }
    }

    if (items.length < 20) break; // trang cuối
    await sleep(opts.throttleMs);
  }

  if (anonymousSkipped > 0) {
    console.log(`[votes] Bỏ qua ${anonymousSkipped} poll ẩn danh (không đọc được voter).`);
  }
  return out;
}

// ---- Mutating group calls (co-admin) ----

/**
 * Gửi text message vào group. Chỉ dùng cho cảnh báo ngày 25 (tài khoản co-admin).
 * Shape sendMessage của zca-js đã đổi vài lần, nên wrapper thử 2 dạng phổ biến.
 */
export async function sendGroupText(api: ZaloApi, groupId: string, text: string): Promise<void> {
  if (typeof api.sendMessage !== "function") {
    throw new Error("zca-js runtime không có api.sendMessage");
  }

  try {
    await api.sendMessage({ msg: text }, groupId, 1);
    return;
  } catch {
    await api.sendMessage(text, groupId, 1);
  }
}

/**
 * Xoá 1 member khỏi group. zca-js bản đang cài không expose type definition cho method
 * này, nhưng các runtime/fork thường có một trong các tên dưới. Nếu không có, dừng rõ
 * để user không tưởng bot đã xoá thành công.
 */
export async function removeGroupMember(api: ZaloApi, groupId: string, memberId: string): Promise<void> {
  const candidates = [
    "removeUserFromGroup",
    "removeMemberFromGroup",
    "removeGroupMember",
    "kickMemberFromGroup",
  ];

  for (const name of candidates) {
    const fn = api?.[name];
    if (typeof fn !== "function") continue;
    try {
      await fn.call(api, memberId, groupId);
      return;
    } catch (firstError) {
      try {
        await fn.call(api, groupId, memberId);
        return;
      } catch {
        throw firstError;
      }
    }
  }

  throw new Error(
    "zca-js runtime không có method xoá member được hỗ trợ " +
      `(đã thử: ${candidates.join(", ")})`,
  );
}
