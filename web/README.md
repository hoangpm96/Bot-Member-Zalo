# Bot-Member-Zalo — Web Admin Panel (`web/`)

Bảng điều khiển cho bot (Next.js App Router + Tailwind + TypeScript). **Đọc chung file SQLite của bot** — không có server/API riêng, không gọi Zalo.

> ⚠️ **Bảo mật:** panel này CHƯA có đăng nhập. Chỉ chạy ở **localhost** hoặc sau tường lửa/VPN. **KHÔNG mở ra internet trần** — ai vào được cũng chỉnh được cấu hình kick.

## Làm được gì

- **Tổng quan:** số thành viên, mục tiêu, còn mấy ngày làm nóng, các kỳ dọn gần nhất.
- **Thành viên:** danh sách + lượt tương tác + lần cuối, sắp ít tương tác nhất lên đầu (dễ bị kick nhất).
- **Lịch sử dọn:** các kỳ quét (`scan_runs`) + ai đã bị xoá (`removals`).
- **Cấu hình:** chỉnh số đích / làm nóng / trần kick / throttle / timeout duyệt + quản lý **VIP list**.
  Giá trị lưu vào DB; **bot ưu tiên đọc DB** rồi mới fallback `.env` (chỉnh xong bot dùng ở kỳ kế tiếp, không cần restart).

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

- `src/lib/db.ts` — mở chung `bot.db` (better-sqlite3), hàm đọc member/removals/runs + get/setState.
- `src/lib/config-meta.ts` — metadata config **client-safe** (dùng chung client form + server).
- `src/lib/config.ts` — đọc/ghi config vào `bot_state` (server-only).
- `src/lib/vip.ts` — đọc/ghi `vip-list.json`.
- `src/app/*` — 4 trang + 2 API route (`/api/config`, `/api/vip`).

## Chưa làm (để sau)

- Đăng nhập / phân quyền panel.
- Chọn VIP bằng cách tìm tên (hiện gõ ID — copy từ trang Thành viên).
- Cập nhật realtime (hiện refresh trang để thấy dữ liệu mới).
