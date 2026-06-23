# Bot-Member-Zalo — phần `bot/`

Bot quét tương tác group Zalo & dọn bớt thành viên ít hoạt động định kỳ.
Phần này là **`bot/`** — lõi chạy nền (TypeScript thuần, không Next.js). Web admin panel (`web/`, Next.js) thuộc P2, làm sau.

> ⚠️ Dùng **zca-js** — API Zalo **không chính thức**. Tài khoản chạy bot **có rủi ro bị khoá**. Bot dùng **DUY NHẤT 1 tài khoản phụ (co-admin)** cho mọi việc (đọc member, listener, kick). **KHÔNG bao giờ đụng tài khoản chính của bạn.**

## Milestone 1 làm gì

Thu thập dữ liệu (chưa kick — kick là Milestone 2):

- Đăng nhập Zalo qua QR, **lưu & tái dùng session** (không login lặp).
- Listener ghi tương tác real-time: **tin nhắn** + **thả reaction**. (Voting **không** bắt được qua listener — xem ghi chú dưới.)
- Listener lưu nội dung **text message trong group** vào DB để export/tổng hợp blog sau này. Không lưu ảnh/audio/file/sticker. Self-message cũng được lưu và tính tương tác.
- Theo dõi thành viên join/leave; phân loại owner / admin / member.
- **Giai đoạn làm nóng 30 ngày** trước khi được phép kick (Zalo Community **không cho lấy tương tác quá khứ** — dữ liệu chỉ tích luỹ từ lúc listener chạy).
- `export-members`: xuất danh sách member ra CSV để tra ID cho VIP list.

## Milestone 2 đã có gì

- `cleanup-warn`: sync member rồi cảnh báo ngày 25. Mặc định `DRY_RUN=1` chỉ in nội dung, không gửi vào group.
- `monthly-cleanup`: sync member, kiểm tra warmup/kỳ đầu, lọc owner/admin/VIP/người mới, xếp hạng ít tương tác nhất, áp ân hạn 0 tương tác lần đầu, rồi lập kế hoạch xoá.
- Khi `DRY_RUN=1`, command chỉ ghi `scan_runs` và in danh sách.
- Khi `DRY_RUN=0` và có `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`, command gửi danh sách qua Telegram để admin bấm Duyệt/Huỷ.
- `telegram-poll`: xử lý nút Duyệt/Huỷ, timeout tự động sau 48h (tính từ lúc gửi duyệt), và `/retry` nếu kick lỗi giữa chừng.
- **Bắt buộc có Telegram mới kick:** nếu chưa cấu hình `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`, `monthly-cleanup` chỉ lập danh sách rồi dừng (KHÔNG kick — phải qua bước duyệt).
- **Khóa chống kick chồng:** chỉ 1 tiến trình kick chạy cho 1 kỳ dù `telegram-poll` cron mỗi phút.

## Cài đặt

```bash
cd bot
npm install
cp .env.example .env   # rồi điền giá trị (xem chú thích trong file)
```

Yêu cầu: Node >= 20.

## Các lệnh

Tất cả lệnh chạy bằng **1 tài khoản phụ co-admin** (quét QR 1 lần, dùng chung session).

| Lệnh | Mô tả |
|------|-------|
| `npm run list-groups` | Liệt kê group đang tham gia + ID. Dùng để lấy `GROUP_ID` cho `.env`. Chỉ đọc. |
| `npm start` | Chạy listener keep-alive — ghi tương tác liên tục. Lệnh chính chạy 24/7. |
| `npm run export-members` | Xuất `data/members-export.csv` (tra ID cho VIP list). Chỉ đọc DB. |
| `npm run import-interactions -- ./data/manual-votes.csv` | Import vote/manual interaction cũ từ CSV/JSON vào DB. |
| `npm run cleanup-warn` | Cảnh báo ngày 25. Gửi group chỉ khi `DRY_RUN=0` và `SEND_GROUP_WARNINGS=1`. |
| `npm run monthly-cleanup` | Mùng 3: lập danh sách. Gửi Telegram approval nếu đã cấu hình. |
| `npm run telegram-poll` | Cron mỗi phút để nhận Duyệt/Huỷ, auto-timeout, `/retry`. |
| `npm run install-cron` | Cài cron tự động cho warning, monthly cleanup, Telegram polling trên VPS. |
| `npm run setup-vps` | Setup VPS một lần: install, typecheck, PM2 listener, cron jobs. |
| `npm run typecheck` | `tsc --noEmit`. |

### Quy trình setup lần đầu (theo thứ tự)

```bash
npm install
cp .env.example .env

npm run list-groups     # quét QR (acc co-admin) → in danh sách group + ID
# → copy GROUP_ID nhóm cần quản lý dán vào .env

npm start               # chạy listener (cùng acc) → bắt đầu thu thập + đếm 30 ngày làm nóng
```

### Import vote/poll cũ

Nếu bạn lấy được danh sách người đã vote từ Zalo theo cách thủ công hoặc tool khác, import vào DB để tính như tương tác:

```bash
npm run import-interactions -- ./data/manual-votes.csv
```

CSV tối thiểu:

```csv
zalo_user_id,type,ts,display_name,note
123456789,vote,2026-06-23T10:00:00+07:00,Nguyen Van A,poll tháng 6
```

`type` có thể là `vote` hoặc `manual`. Nếu bỏ `type`, bot mặc định là `vote`. JSON cũng được, miễn là file là mảng object có các field tương tự.

### Vận hành cleanup định kỳ

```bash
# Ngày 25, kiểm tra nội dung cảnh báo trước
DRY_RUN=1 npm run cleanup-warn

# Nếu muốn gửi thật vào group
DRY_RUN=0 SEND_GROUP_WARNINGS=1 npm run cleanup-warn

# Mùng 3, lập danh sách review trước, không kick
DRY_RUN=1 npm run monthly-cleanup
```

Kick **bắt buộc qua Telegram approval** (an toàn). Điền `TELEGRAM_BOT_TOKEN` và `TELEGRAM_CHAT_ID`, rồi:

```bash
DRY_RUN=0 npm run monthly-cleanup   # lập danh sách + gửi nút Duyệt/Huỷ qua Telegram
npm run telegram-poll               # chạy bằng cron mỗi phút để nhận Duyệt/Huỷ/timeout/retry
```

Nếu `DRY_RUN=0` mà CHƯA cấu hình Telegram, bot chỉ lập danh sách rồi dừng (không kick).

Khi kick lỗi giữa chừng, bot gửi Telegram kèm `E-cleanup-001`; sau khi xử lý nguyên nhân, reply `/retry` trong chat admin.

File VIP list mặc định ở `data/vip-list.json`, dạng:

```json
[
  { "id": "123456789", "note": "VIP" }
]
```

**Đăng nhập = quét QR.** Trên VPS, chạy `npm run setup-vps`, mở dashboard `/login`
rồi bấm **Bắt đầu đăng nhập**. Bot tạo QR, web hiển thị ảnh từ
`data/qr.png`; quét xong, session lưu ở `data/session.json` (đã gitignore) để lần
sau khỏi quét lại. Khi cần đổi tài khoản hoặc session hỏng, bấm **Đăng nhập lại**
trên cùng trang; không cần tự xóa các file session.

### Login một lần, chạy mãi trên VPS

Session **tái dùng được**: đã login ở đâu thì có thể mang file session sang nơi khác chạy mà không cần quét lại.

- Cách 1 (khuyến nghị cho VPS): `npm run setup-vps` → mở `/login` → bấm
  **Bắt đầu đăng nhập** và quét QR.
- Cách 2: login trên máy có màn hình rồi `scp data/session.json user@vps:đường-dẫn/bot/data/`. Bot trên VPS dùng session sẵn có, không cần QR.

QR xuất hiện khi chưa có session, session hết hạn, hoặc bạn chủ động bấm **Đăng
nhập lại** trên dashboard.

## Vận hành trên VPS (rẻ)

Checklist đầy đủ nằm ở [`VPS_SETUP.md`](./VPS_SETUP.md).

Setup một lần trên VPS, sau đó bot tự chạy theo lịch:

```bash
cd /path/to/Bot-Member-Zalo/bot

# Lần đầu: start bot + web, sau đó login tại /login
npm run setup-vps

# Sau khi login và điền GROUP_ID/các biến môi trường, chạy lại cùng lệnh
npm run setup-vps
pm2 startup   # copy chạy tiếp command sudo mà pm2 in ra
```

Chỉ cần SSH setup các lệnh trên một lần. Sau đó luồng tự động là:

1. Listener ghi tương tác liên tục.
2. Cron `sync-votes` đồng bộ voter trong poll mỗi 6 giờ (backup cho sync trong listener).
3. Ngày 25, cron chạy `cleanup-warn` và gửi cảnh báo vào group.
4. Ngày 3, cron chạy `monthly-cleanup` và gửi danh sách qua Telegram.
5. Bạn bấm Duyệt/Huỷ trên điện thoại.
6. Cron `telegram-poll` tự nhận callback trong tối đa khoảng 1 phút rồi xoá hoặc huỷ.

Log cron nằm ở:

- `data/telegram-poll.log`
- `data/sync-votes.log`
- `data/cleanup-warn.log`
- `data/monthly-cleanup.log`

SQLite local (`data/bot.db`) — 0đ, không cần DB server.

## Lưu và export tin nhắn text

Bot lưu text message live từ group target vào bảng `group_messages`.

- Chỉ lưu text message.
- Không lưu ảnh, audio, file, sticker.
- Có lưu self-message của tài khoản bot để dùng làm dữ liệu tổng hợp.
- Self-message cũng được ghi interaction và tính điểm tương tác cleanup.

Export nằm trên dashboard web: mở `/messages`, lọc theo ngày/từ khoá/người gửi rồi bấm `CSV`.

## Ghi chú quan trọng (đã verify từ source zca-js)

- **Voting:** không bắt được real-time qua listener, NHƯNG đọc được qua poll API (`getListBoard` → `options[].voters[]`) — cả vote cũ lẫn mới. Lệnh `sync-votes` (listener tự gọi mỗi 6h) ghi vote vào DB. Poll **ẩn danh** không đọc được voter. (OQ-1 resolved)
- **Ngày join của thành viên cũ** thường **không lấy được** từ `getGroupInfo` (chỉ có `lastUpdateTime`, không phải ngày join). Luật "miễn người mới" chỉ áp chắc cho người join **sau** khi bot online. (OQ-2)
- **Không lấy được tương tác QUÁ KHỨ** với Zalo Community: `getGroupChatHistory` trả 404, `old_messages` không backfill sâu, không có API nào khác (đã verify + review độc lập). Dữ liệu chỉ tích luỹ từ lúc listener chạy. (OQ-5)

## An toàn

- `.env`, `data/` (session + db) **không bao giờ commit** (đã có trong `.gitignore` ở root).
- Listener không gọi gửi tin / kick — chỉ ghi tương tác. Kick chỉ xảy ra ở `monthly-cleanup` khi `DRY_RUN=0`.
- Mọi lời gọi Zalo đi qua `src/zalo/client.ts` (1 chỗ) — dễ kiểm soát + vá khi zca-js đổi.
