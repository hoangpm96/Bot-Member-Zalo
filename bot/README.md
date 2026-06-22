# Bot-Member-Zalo — phần `bot/`

Bot quét tương tác group Zalo & dọn bớt thành viên ít hoạt động định kỳ.
Phần này là **`bot/`** — lõi chạy nền (TypeScript thuần, không Next.js). Web admin panel (`web/`, Next.js) thuộc P2, làm sau.

> ⚠️ Dùng **zca-js** — API Zalo **không chính thức**. Tài khoản chạy bot **có rủi ro bị khoá**. Bot dùng **DUY NHẤT 1 tài khoản phụ (co-admin)** cho mọi việc (đọc member, listener, kick). **KHÔNG bao giờ đụng tài khoản chính của bạn.**

## Milestone 1 làm gì

Thu thập dữ liệu (chưa kick — kick là Milestone 2):

- Đăng nhập Zalo qua QR, **lưu & tái dùng session** (không login lặp).
- Listener ghi tương tác real-time: **tin nhắn** + **thả reaction**. (Voting **không** bắt được qua listener — xem ghi chú dưới.)
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

**Đăng nhập = quét QR.** Bot không có giao diện. Lần đầu, lệnh sẽ **in mã QR thẳng ra terminal** (dạng ASCII) và **dừng chờ** — quét trực tiếp bằng app Zalo trên điện thoại (tài khoản co-admin), kể cả khi đang SSH vào VPS (không cần màn hình). Đồng thời cũng lưu một bản ảnh ở `data/qr.png` để dùng nếu thích. Quét xong, session lưu ở `data/session.json` (đã gitignore) để lần sau khỏi quét lại.

### Login một lần, chạy mãi trên VPS

Session **tái dùng được**: đã login ở đâu thì có thể mang file session sang nơi khác chạy mà không cần quét lại.

- Cách 1 (khuyến nghị cho VPS): SSH vào VPS, chạy lệnh → QR hiện ngay trong terminal → quét bằng điện thoại.
- Cách 2: login trên máy có màn hình rồi `scp data/session.json user@vps:đường-dẫn/bot/data/`. Bot trên VPS dùng session sẵn có, không cần QR.

QR chỉ xuất hiện lại khi session hết hạn.

## Vận hành trên VPS (rẻ)

- Giữ listener sống bằng **pm2**: `pm2 start npm --name zalo-bot -- start` (hoặc systemd service).
- SQLite local (`data/bot.db`) — 0đ, không cần DB server.
- Cron gợi ý:
  - `0 9 25 * * cd /path/to/bot && npm run cleanup-warn`
  - `0 9 3 * * cd /path/to/bot && npm run monthly-cleanup`
  - `* * * * * cd /path/to/bot && npm run telegram-poll`

## Ghi chú quan trọng (đã verify từ source zca-js)

- **Voting/bình chọn KHÔNG bắt được real-time** — `GroupEventType` của zca-js không có event poll/vote. P0 chỉ tính tin nhắn + reaction. (OQ-1)
- **Ngày join của thành viên cũ** thường **không lấy được** từ `getGroupInfo` (chỉ có `lastUpdateTime`, không phải ngày join). Luật "miễn người mới" chỉ áp chắc cho người join **sau** khi bot online. (OQ-2)
- **Không lấy được tương tác QUÁ KHỨ** với Zalo Community: `getGroupChatHistory` trả 404, `old_messages` không backfill sâu, không có API nào khác (đã verify + review độc lập). Dữ liệu chỉ tích luỹ từ lúc listener chạy. (OQ-5)

## An toàn

- `.env`, `data/` (session + db) **không bao giờ commit** (đã có trong `.gitignore` ở root).
- Listener không gọi gửi tin / kick — chỉ ghi tương tác. Kick chỉ xảy ra ở `monthly-cleanup` khi `DRY_RUN=0`.
- Mọi lời gọi Zalo đi qua `src/zalo/client.ts` (1 chỗ) — dễ kiểm soát + vá khi zca-js đổi.
