import fs from "node:fs";
import path from "node:path";
import { Zalo, LoginQRCallbackEventType } from "zca-js";
import qrcodeTerminal from "qrcode-terminal";
import { config } from "../config.js";

/**
 * Wrapper quanh zca-js. MỌI lời gọi Zalo đi qua đây — phần còn lại của code KHÔNG
 * import zca-js trực tiếp. Lý do: zca-js là API không chính thức, dễ vỡ; cô lập ở
 * 1 chỗ để dễ vá + để áp được các guard an toàn (read-only, throttle).
 *
 * Hai loại session tách bạch, lưu file riêng:
 *   - 'operator' (tài khoản phụ co-admin): vận hành, listener. Dùng cho `start`.
 *   - 'owner' (tài khoản chính): CHỈ init-seed, READ-ONLY. Không bao giờ kick/gửi.
 */

export type SessionKind = "operator" | "owner";

interface SavedCredentials {
  cookie: unknown;
  imei: string;
  userAgent: string;
}

// zca-js api là any-shaped (lib không xuất type đầy đủ cho mọi method ta dùng).
// Cô lập `any` ở đây thay vì rải khắp code.
/* eslint-disable @typescript-eslint/no-explicit-any */
type ZaloApi = any;

function sessionPathFor(kind: SessionKind): string {
  return kind === "owner" ? config.ownerSessionPath : config.operatorSessionPath;
}

function loadCredentials(kind: SessionKind): SavedCredentials | null {
  const p = sessionPathFor(kind);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as SavedCredentials;
  } catch {
    return null;
  }
}

function saveCredentials(kind: SessionKind, creds: SavedCredentials): void {
  const p = sessionPathFor(kind);
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

/**
 * Đăng nhập, ƯU TIÊN tái dùng session đã lưu (KHÔNG login lặp — login dồn dập dễ bị
 * khoá tài khoản). Chỉ hiện QR khi chưa có session hoặc session hỏng.
 */
export async function login(kind: SessionKind): Promise<ZaloApi> {
  const zalo = new Zalo();
  const saved = loadCredentials(kind);

  if (saved) {
    try {
      const api = await zalo.login({
        cookie: saved.cookie as any,
        imei: saved.imei,
        userAgent: saved.userAgent,
      });
      console.log(`[zalo] Đăng nhập lại bằng session đã lưu (${kind}).`);
      return api;
    } catch (e) {
      console.warn(`[zalo] Session ${kind} không dùng được, cần quét lại QR. (${String(e)})`);
    }
  }

  const qrPath = path.join(config.sessionDir, `qr-${kind}.png`);
  fs.mkdirSync(config.sessionDir, { recursive: true });
  console.log(`[zalo] Đăng nhập (${kind}) — đang tạo mã QR...`);

  // QUAN TRỌNG: khi truyền callback, zca-js KHÔNG tự lưu file QR — phải tự gọi
  // event.actions.saveToFile() ở event QRCodeGenerated, nếu không sẽ không có ảnh QR.
  const api = await zalo.loginQR({ qrPath }, (event: any) => {
    switch (event?.type) {
      case LoginQRCallbackEventType.QRCodeGenerated: {
        // 1) In QR thẳng ra terminal (ASCII) — quét trực tiếp trên SSH/VPS, không cần mở file.
        const code = event?.data?.code;
        if (code) {
          console.log(`\n[zalo] 📱 QUÉT MÃ QR DƯỚI ĐÂY BẰNG APP ZALO (tài khoản ${kind}):\n`);
          qrcodeTerminal.generate(code, { small: true });
          console.log("");
        }
        // 2) Đồng thời lưu ra file ảnh (tiện khi chạy trên máy có màn hình).
        const save = event?.actions?.saveToFile;
        if (typeof save === "function") {
          Promise.resolve(save(qrPath))
            .then(() => console.log(`[zalo] (Hoặc mở ảnh QR: ${path.resolve(qrPath)})\n`))
            .catch(() => {});
        }
        break;
      }
      case LoginQRCallbackEventType.QRCodeScanned:
        console.log(`[zalo] ✅ Đã quét QR (${event?.data?.display_name ?? ""}). Đang hoàn tất...`);
        break;
      case LoginQRCallbackEventType.QRCodeExpired:
        console.warn("[zalo] ⚠️  Mã QR hết hạn — đang tạo mã mới...");
        break;
      case LoginQRCallbackEventType.QRCodeDeclined:
        console.warn("[zalo] ❌ Đăng nhập bị từ chối trên điện thoại.");
        break;
      case LoginQRCallbackEventType.GotLoginInfo: {
        const data = event?.data;
        if (data?.cookie && data?.imei && data?.userAgent) {
          saveCredentials(kind, {
            cookie: data.cookie,
            imei: data.imei,
            userAgent: data.userAgent,
          });
          console.log(`[zalo] 💾 Đã lưu session (${kind}) — lần sau khỏi quét lại.`);
        }
        break;
      }
    }
  });
  return api;
}

// ---- Đọc thông tin group (dùng cho cả listener setup + init-seed) ----

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

/**
 * Lấy snapshot thành viên group + phân loại role (owner/admin/member).
 * READ-ONLY. Dùng getGroupInfo (có currentMems + creatorId + adminIds).
 */
export async function getGroupSnapshot(api: ZaloApi, groupId: string): Promise<GroupSnapshot> {
  const info = await api.getGroupInfo(groupId);
  // getGroupInfo trả gridInfoMap[groupId] hoặc trực tiếp tuỳ phiên bản — xử lý cả 2.
  const g = info?.gridInfoMap?.[groupId] ?? info?.[groupId] ?? info;

  const creatorId: string = g?.creatorId ?? "";
  const adminIds: string[] = Array.isArray(g?.adminIds) ? g.adminIds : [];
  const currentMems: any[] = Array.isArray(g?.currentMems) ? g.currentMems : [];

  const members: GroupMemberLite[] = currentMems.map((m) => {
    const id = String(m?.id ?? "");
    let role: GroupMemberLite["role"] = "member";
    if (id && id === creatorId) role = "owner";
    else if (id && adminIds.includes(id)) role = "admin";
    return {
      id,
      displayName: String(m?.dName ?? m?.zaloName ?? ""),
      role,
    };
  });

  return {
    groupId,
    name: String(g?.name ?? ""),
    totalMember: Number(g?.totalMember ?? members.length),
    members,
  };
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

/**
 * Kéo lịch sử chat group (READ-ONLY) cho init-seed.
 * Trả về mảng {senderId, ts} đã chuẩn hoá (ts = epoch ms). Lọc theo sinceTs nếu có.
 *
 * ⚠️ zca-js `getGroupChatHistory(groupId, count)` CHỈ nhận 2 tham số (không có cursor
 * phân trang qua API public — đã verify từ .d.ts). Nên ta kéo 1 batch lớn = maxPages*50
 * tin gần nhất, KHÔNG phân trang về quá khứ sâu hơn. Đây là giới hạn của lib (OQ-5):
 * seed chỉ lấy được phần chat GẦN ĐÂY, không phải toàn bộ lịch sử. Giai đoạn làm nóng
 * vẫn là phương án chính. Code phòng thủ: shape lạ → trả rỗng, KHÔNG crash.
 */
export async function fetchChatHistory(
  api: ZaloApi,
  groupId: string,
  opts: { maxPages: number; sinceTs: number | null; throttleMs: number },
): Promise<{ senderId: string; ts: number }[]> {
  const out: { senderId: string; ts: number }[] = [];
  // Trần số tin = maxPages * 50 (giữ ý nghĩa "trần an toàn" của SEED_MAX_PAGES),
  // chặn trên ở mức hợp lý để 1 call không quá nặng cho acc chính.
  const count = Math.min(opts.maxPages * 50, 5000);

  let resp: any;
  try {
    resp = await api.getGroupChatHistory(groupId, count);
  } catch (e) {
    console.warn(`[seed] getGroupChatHistory lỗi, bỏ qua seed: ${String(e)}`);
    return out;
  }

  const msgs: any[] = resp?.groupMsgs ?? [];
  for (const m of msgs) {
    const senderId = String(m?.data?.uidFrom ?? m?.uidFrom ?? "");
    const ts = normalizeTs(m?.data?.ts ?? m?.ts);
    if (!senderId || ts === null) continue;
    if (opts.sinceTs !== null && ts < opts.sinceTs) continue;
    out.push({ senderId, ts });
  }

  return out;
}
