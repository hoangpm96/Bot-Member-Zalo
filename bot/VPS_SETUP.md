# VPS setup checklist

Mục tiêu: SSH setup một lần, sau đó bot tự chạy.

## 1. Setup và mở dashboard

```bash
cd /path/to/Bot-Member-Zalo/bot
npm run setup-vps
```

Nếu chưa có `.env`, script tự tạo từ `.env.example`. Script luôn cài dependency,
build và start cả `zalo-bot` lẫn `zalo-web` bằng PM2.

Mở:

```text
http://<VPS-IP>:5831/login
```

Bấm **Bắt đầu đăng nhập**, quét QR bằng tài khoản Zalo phụ/co-admin rồi xác nhận
trên điện thoại. Không cần xóa file hoặc chạy `list-groups` để tạo QR.

Khi chưa login, bot đứng chờ và không mở listener. Sau khi login:

- Có `GROUP_ID`: bot bắt đầu listener.
- Chưa có `GROUP_ID`: bot giữ trạng thái tạm ngưng, không restart liên tục.

Sau khi đăng nhập thành công, lấy `GROUP_ID` một lần:

```bash
npm run list-groups
```

Lệnh này tái dùng session vừa đăng nhập nên không yêu cầu quét QR lại.

Bot và web phải chạy trên cùng VPS, cùng user. PM2 đã đặt `WEB_QR_DIR` thành đường
dẫn tuyệt đối tới `bot/data`, nên web vẫn đọc được QR tạo sau lúc `next build`.

Về sau nếu session hỏng hoặc muốn đổi tài khoản, mở `/login` và bấm **Đăng nhập
lại**. Bot tự dọn session cũ, PM2 restart listener và tạo QR mới.

## 2. Cấu hình `.env` đầy đủ

```bash
nano .env
```

Bắt buộc có:

```env
GROUP_ID=...
TARGET_MEMBER_COUNT=965
SQLITE_DB_PATH=./data/bot.db
SESSION_DIR=./data
WARMUP_DAYS=30
ZALO_SELF_LISTEN=1
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
WEB_PORT=5831
```

`WEB_PORT` mặc định là `3000` nếu để trống; ở đây chốt `5831` để tránh đụng app
khác trên VPS. Nếu đổi sang số khác thì nhớ sửa cả `.env` lẫn cấu hình
Nginx/Caddy proxy bên dưới cho khớp.

`DRY_RUN` có thể để `1` trong `.env` để thao tác tay an toàn. Cron do `npm run install-cron` cài sẽ override:

- `DRY_RUN=0 SEND_GROUP_WARNINGS=1` cho job cảnh báo ngày 25.
- `DRY_RUN=0` cho job lập danh sách ngày 3.

Kiểm tra env trước khi setup:

```bash
npm run validate-env
```

## 3. Áp dụng cấu hình và cài cron

```bash
npm run setup-vps
pm2 startup
```

Lần chạy đầu, nếu `.env` chưa đủ thì `setup-vps` vẫn start bot/web nhưng bỏ qua
cron. Sau khi điền đủ cấu hình, chạy lại cùng lệnh; script restart bot để nhận
`GROUP_ID` và tự cài cron.

Lệnh `pm2 startup` sẽ in ra một command có `sudo ...`; copy chạy đúng command đó để listener tự bật lại sau reboot.

Kiểm tra:

```bash
pm2 status
pm2 logs zalo-bot
pm2 logs zalo-web
```

## 3b. (Tuỳ chọn) Nginx reverse proxy + domain

Bước này chỉ cần khi muốn mở dashboard qua domain (vd `https://bot.example.com`)
thay vì `http://<VPS-IP>:5831`. Bot/web vẫn chạy bình thường nếu bỏ qua.

Web chỉ lắng nghe `127.0.0.1:5831` (PM2 đặt `PORT=WEB_PORT`). Nginx nhận request
ngoài rồi proxy vào đúng port đó:

```nginx
# /etc/nginx/sites-available/bot-zalo
server {
    listen 80;
    server_name bot.example.com;

    location / {
        proxy_pass         http://127.0.0.1:5831;   # khớp WEB_PORT trong .env
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/bot-zalo /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
# HTTPS (khuyến nghị): sudo certbot --nginx -d bot.example.com
```

Đổi `WEB_PORT` sang số khác thì sửa luôn `proxy_pass` cho khớp, rồi reload nginx.

## 4. Cài cron tự động riêng lẻ nếu cần

```bash
npm run install-cron -- --print   # xem trước block cron, chưa cài
npm run install-cron
```

Script này cài 4 job:

- Mỗi phút: `telegram-poll` nhận nút Duyệt/Huỷ, `/retry`, timeout.
- Mỗi 6 giờ: `sync-votes` đồng bộ voter trong poll, idempotent backup cho listener.
- 09:00 ngày 25 hằng tháng: gửi cảnh báo group.
- 09:00 ngày 3 hằng tháng: lập danh sách và gửi Telegram approval.

Cron dùng timezone `Asia/Ho_Chi_Minh`.

Kiểm tra:

```bash
crontab -l
tail -f data/telegram-poll.log
tail -f data/sync-votes.log
```

## 5. Test Telegram

```bash
npm run telegram-test
npm run telegram-poll
```

Khi `monthly-cleanup` gửi danh sách, bạn chỉ cần bấm Duyệt/Huỷ trên Telegram. Cron `telegram-poll` sẽ tự nhận callback trong tối đa khoảng 1 phút.

## 6. Log cần xem

```bash
pm2 logs zalo-bot
pm2 logs zalo-web
tail -f data/telegram-poll.log
tail -f data/cleanup-warn.log
tail -f data/monthly-cleanup.log
```

## 7. Update code trên VPS

```bash
git pull
npm install
npm rebuild better-sqlite3
npm --prefix ../web install
npm --prefix ../web run build
pm2 startOrReload ecosystem.config.cjs
npm run install-cron
```

Chạy lại `npm run install-cron` sau update là an toàn; script tự thay block cron cũ, không nhân đôi job.
