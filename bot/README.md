# Bot-Member-Zalo — phần `bot/` (Milestone 1)

Bot quét tương tác group Zalo & dọn bớt thành viên ít hoạt động định kỳ.
Phần này là **`bot/`** — lõi chạy nền (TypeScript thuần, không Next.js). Web admin panel (`web/`, Next.js) thuộc P2, làm sau.

> ⚠️ Dùng **zca-js** — API Zalo **không chính thức**. Tài khoản chạy bot **có rủi ro bị khoá**. Dùng **tài khoản phụ (co-admin)** để vận hành; tài khoản chính chỉ dùng 1 lần lúc khởi tạo (chỉ đọc).

## Milestone 1 làm gì

Thu thập dữ liệu (chưa kick — kick là Milestone 2):

- Đăng nhập Zalo qua QR, **lưu & tái dùng session** (không login lặp).
- Listener ghi tương tác real-time: **tin nhắn** + **thả reaction**. (Voting **không** bắt được qua listener — xem ghi chú dưới.)
- Theo dõi thành viên join/leave; phân loại owner / admin / member.
- **Giai đoạn làm nóng 30 ngày** trước khi được phép kick.
- `init-seed`: khởi tạo DB bằng tài khoản chính (chỉ đọc) — seed lịch sử chat quá khứ.
- `export-members`: xuất danh sách member ra CSV để tra ID cho VIP list.

## Cài đặt

```bash
cd bot
npm install
cp .env.example .env   # rồi điền giá trị (xem chú thích trong file)
```

Yêu cầu: Node >= 20.

## Các lệnh

| Lệnh | Tài khoản | Mô tả |
|------|-----------|-------|
| `npm run list-groups` | **chính** (owner) | Liệt kê group đang tham gia + ID. Dùng để lấy `GROUP_ID` cho `.env`. Chỉ đọc. |
| `npm start` | **phụ** (operator) | Chạy listener keep-alive — ghi tương tác liên tục. Lệnh chính chạy 24/7. |
| `npm run init-seed` | **chính** (owner) | Khởi tạo DB lần đầu: đọc member + seed lịch sử chat. **CHỈ ĐỌC**, không gửi/không kick. Chạy 1 lần. |
| `npm run export-members` | — | Xuất `data/members-export.csv` (tra ID cho VIP list). Chỉ đọc DB. |
| `npm run typecheck` | — | `tsc --noEmit`. |

### Quy trình setup lần đầu (theo thứ tự)

```bash
npm install
cp .env.example .env

npm run list-groups     # quét QR (acc chính) → in danh sách group + ID
# → copy GROUP_ID nhóm cần quản lý dán vào .env

npm run init-seed       # quét QR (acc chính) → đọc member + seed lịch sử chat vào DB
npm start               # chạy listener (acc phụ) → bắt đầu thu thập + đếm 30 ngày làm nóng
```

**Đăng nhập = quét QR.** Bot không có giao diện. Lần đầu mỗi tài khoản, lệnh sẽ **in mã QR thẳng ra terminal** (dạng ASCII) và **dừng chờ** — quét trực tiếp bằng app Zalo trên điện thoại, kể cả khi đang SSH vào VPS (không cần màn hình). Đồng thời cũng lưu một bản ảnh ở `data/qr-{owner,operator}.png` để dùng nếu thích. Quét xong, session lưu ở `data/session-*.json` (đã gitignore) để lần sau khỏi quét lại.

### Login một lần, chạy mãi trên VPS

Session **tái dùng được**: đã login ở đâu thì có thể mang file session sang nơi khác chạy mà không cần quét lại.

- Cách 1 (khuyến nghị cho VPS): SSH vào VPS, chạy lệnh → QR hiện ngay trong terminal → quét bằng điện thoại.
- Cách 2: login trên máy có màn hình rồi `scp data/session-*.json user@vps:đường-dẫn/bot/data/`. Bot trên VPS dùng session sẵn có, không cần QR.

QR chỉ xuất hiện lại khi session hết hạn.

## Vận hành trên VPS (rẻ)

- Giữ listener sống bằng **pm2**: `pm2 start npm --name zalo-bot -- start` (hoặc systemd service).
- SQLite local (`data/bot.db`) — 0đ, không cần DB server.
- Milestone 2 sẽ thêm cron cho job dọn dẹp định kỳ.

## Ghi chú quan trọng (đã verify từ source zca-js)

- **Voting/bình chọn KHÔNG bắt được real-time** — `GroupEventType` của zca-js không có event poll/vote. P0 chỉ tính tin nhắn + reaction. (OQ-1)
- **Ngày join của thành viên cũ** thường **không lấy được** từ `getGroupInfo` (chỉ có `lastUpdateTime`, không phải ngày join). Luật "miễn người mới" chỉ áp chắc cho người join **sau** khi bot online. (OQ-2)
- **`init-seed` chỉ seed được CHAT**, không có reaction/vote quá khứ. Cơ chế phân trang `getGroupChatHistory` cần verify trên group thật. (OQ-5)

## An toàn

- `.env`, `data/` (session + db) **không bao giờ commit** (đã có trong `.gitignore` ở root).
- `init-seed` được code chặn cứng ở chế độ chỉ-đọc — không có đường dẫn nào gọi gửi tin / kick.
- Mọi lời gọi Zalo đi qua `src/zalo/client.ts` (1 chỗ) — dễ kiểm soát + vá khi zca-js đổi.
