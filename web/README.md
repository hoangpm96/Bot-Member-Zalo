# Bot-Member-Zalo — Web Admin Panel (`web/`)

Bảng điều khiển cho bot (Next.js App Router + Tailwind + TypeScript). **Đọc chung file SQLite của bot** — không có server/API riêng, không gọi Zalo.

> ⚠️ **Bảo mật:** panel quản trị chưa có lớp xác thực người dùng riêng. Chỉ chạy
> ở localhost hoặc đặt sau authentication/VPN. Không mở trực tiếp ra Internet.

## Làm được gì

- **Tổng quan:** số thành viên, mục tiêu, còn mấy ngày làm nóng, các kỳ dọn gần nhất.
- **Thành viên:** danh sách + lượt tương tác + lần cuối, sắp ít tương tác nhất lên đầu (dễ bị kick nhất).
- **Lịch sử dọn:** các kỳ quét (`scan_runs`) + ai đã bị xoá (`removals`).
- **Cấu hình:** chỉnh số đích / làm nóng / trần kick / throttle / timeout duyệt + quản lý **VIP list**.
  Giá trị lưu vào DB; **bot ưu tiên đọc DB** rồi mới fallback `.env` (chỉnh xong bot dùng ở kỳ kế tiếp, không cần restart).
- **Đăng nhập:** tạo QR, kiểm tra trạng thái và yêu cầu bot đăng nhập lại.
- **Tin nhắn:** tìm kiếm và export CSV các text message đã lưu.
- **VIP:** tìm thành viên theo tên hoặc Zalo ID rồi thêm vào danh sách trắng.
- **Leaderboard public:** `/leaderboard` hiển thị Top 50 theo 7 ngày, 30 ngày hoặc
  toàn thời gian; chỉ công khai tên và số liệu tương tác tổng hợp, không lộ Zalo ID.

Panel **chỉ đọc dữ liệu + chỉnh cấu hình/VIP**. Mọi thao tác Zalo (kick, cảnh báo) vẫn do `bot/` thực hiện.

## Cài & chạy

```bash
cd web
npm install
npm run dev      # http://localhost:3000
# hoặc production:
npm run build && npm start
```

Yêu cầu: bot đã chạy ít nhất 1 lần để có `bot/data/bot.db`. Nếu DB ở chỗ khác, đặt env:

```bash
WEB_DB_PATH=/đường-dẫn/bot.db
WEB_VIP_PATH=/đường-dẫn/vip-list.json   # mặc định ../bot/data/vip-list.json
```

## Kiến trúc

- `src/lib/db.ts` — mở chung `bot.db` (better-sqlite3), hàm đọc member/removals/runs/sync/events + get/setState.
- `src/lib/config-meta.ts` — metadata config **client-safe** (dùng chung client form + server).
- `src/lib/config.ts` — đọc/ghi config vào `bot_state` (server-only).
- `src/lib/vip.ts` — đọc/ghi `vip-list.json`.
- `src/app/*` — dashboard health/sync/permission, members, candidates + draft plan, cleanup-plan per item, events filter/export, messages/media, errors/schema, history, settings, login + API routes.

## Chưa làm

- Authentication/phân quyền dashboard.
- Cập nhật dữ liệu realtime; các trang nghiệp vụ hiện đọc lại khi refresh.

## Public leaderboard

Khuyến nghị dùng hai subdomain:

- `bot.bahub.vn`: toàn bộ admin, bắt buộc Basic Auth.
- `leaderboard.bahub.vn`: public leaderboard ngay tại `/`, không proxy API hoặc trang admin.

Đặt trong `bot/.env`:

```env
PUBLIC_ORIGIN=https://bot.bahub.vn
PUBLIC_LEADERBOARD_HOST=leaderboard.bahub.vn
```

Mẫu Nginx đầy đủ nằm tại `deploy/nginx-bahub.conf.example`. Middleware của web
cũng áp dụng allowlist theo host để tạo lớp chặn thứ hai nếu Nginx cấu hình nhầm.
Leaderboard không trả Zalo ID hay nội dung tin nhắn và được đánh dấu `noindex`.
