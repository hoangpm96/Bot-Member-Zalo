# Bot Member Zalo

Bot tự vận hành cho Zalo group/community: thu thập tương tác, lưu tin nhắn text,
xếp hạng thành viên ít hoạt động và thực hiện cleanup sau khi admin duyệt qua
Telegram.

> Dự án dùng `zca-js`, một API Zalo không chính thức. Tài khoản có thể bị giới
> hạn hoặc khóa. Chỉ nên dùng tài khoản phụ có quyền co-admin, tự đánh giá rủi ro
> và tuân thủ điều khoản của Zalo.

## Tính năng

- Đăng nhập Zalo bằng QR ngay trên dashboard.
- Listener 24/7 cho message, reaction, sự kiện thành viên và sync snapshot member định kỳ.
- Dashboard có nút sync member ngay, trạng thái sync gần nhất, trang ứng viên và audit sự kiện thành viên.
- Dashboard có Bot health, check quyền bot, duyệt từng item trong cleanup plan và lưu plan nháp.
- Dashboard có trang lỗi gần đây và schema version; cron `health-check` gửi Telegram khi heartbeat stale.
- Ghi metadata ảnh/video theo user/thời điểm/số lượng; không lưu file, URL hay nội dung media.
- Lưu text message, gồm cả self-message; không lưu ảnh, audio hay file.
- Đồng bộ lượt vote từ poll khi Zalo cho phép đọc voter.
- Giai đoạn warmup trước khi cleanup để tránh đánh giá thiếu dữ liệu.
- Loại trừ owner, admin, VIP và các trường hợp được bảo vệ.
- Gửi danh sách cleanup qua Telegram để Duyệt/Hủy.
- Tùy chọn sao chép message Zalo live sang đúng Telegram forum topic/channel.
- Dashboard xem thành viên, tương tác, lịch sử, tin nhắn và cấu hình.
- PM2 và cron setup tự động cho VPS.

## Kiến trúc

```text
Bot-Member-Zalo/
├── bot/   TypeScript worker, SQLite, Zalo listener, Telegram, cron
└── web/   Next.js dashboard, đọc chung dữ liệu trong bot/data
```

Bot và web cần chạy trên cùng máy hoặc dùng chung persistent volume.

## Yêu cầu

- Node.js 20 trở lên
- npm
- PM2 cho production
- Tài khoản Zalo phụ đang là co-admin của group
- Telegram bot và chat ID nếu dùng cleanup approval

## Chạy local

```bash
git clone <repository-url>
cd Bot-Member-Zalo/bot
cp .env.example .env
npm install

cd ../web
npm install
npm run dev
```

Chạy bot ở terminal khác:

```bash
cd bot
npm run dev
```

Mở `http://localhost:3000/login`, bấm **Bắt đầu đăng nhập** và quét QR.

## Deploy VPS

Clone nguyên repository, giữ cả `bot/` và `web/`:

```bash
git clone <repository-url>
cd Bot-Member-Zalo/bot
npm run setup-vps
```

Sau đó:

1. Mở dashboard `/login` và đăng nhập Zalo.
2. Chạy `npm run list-groups` một lần để lấy `GROUP_ID`.
3. Điền `bot/.env`.
4. Chạy lại `npm run setup-vps`.
5. Chạy `pm2 startup` một lần nếu VPS chưa cấu hình PM2 startup.

Dashboard chạy ở `WEB_PORT` (mặc định `5831` trong `.env.example`; để trống = `3000`).
Đổi sang port trống khác trong `bot/.env` nếu cần, và sửa cấu hình Nginx proxy cho khớp.

Checklist đầy đủ: [bot/VPS_SETUP.md](bot/VPS_SETUP.md).
Cách hoạt động của từng luồng (kèm ASCII diagram): [DOCUMENTATION.md](DOCUMENTATION.md).

## An toàn

- Giữ `DRY_RUN=1` trong lần chạy thử đầu tiên.
- Cleanup thật bắt buộc qua Telegram approval.
- Không public dashboard trực tiếp; đặt sau HTTPS và authentication/VPN.
- Không commit `.env`, `bot/data/`, session, SQLite database hoặc log.
- Backup định kỳ `bot/.env` và `bot/data/`.

Trước khi public fork hoặc báo lỗi bảo mật, xem [SECURITY.md](SECURITY.md).

## Kiểm tra

```bash
cd bot && npm test && npm run typecheck && npm run build
cd ../web && npm run typecheck && npm run build
```

## CI/CD production

Repo pin Node `20.20.2` bằng `.nvmrc`. CI chạy bot test/typecheck/build và web
typecheck/build trước khi deploy. Deploy VPS giữ runtime data cố định ở
`/var/lib/bot-member-zalo`, còn code release nằm dưới
`/var/www/Bot-Member-Zalo-releases` và symlink current là
`/var/www/Bot-Member-Zalo-current`.

Yêu cầu GitHub Actions secrets:

- `PROD_SSH_HOST`
- `PROD_SSH_PORT`
- `PROD_SSH_USER`
- `PROD_SSH_KEY`

## Tài liệu

- [Bot commands và nghiệp vụ](bot/README.md)
- [VPS setup](bot/VPS_SETUP.md)
- [Web dashboard](web/README.md)

## License

[MIT](LICENSE)
