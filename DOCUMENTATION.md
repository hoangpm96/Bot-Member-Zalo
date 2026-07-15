# Tài liệu kỹ thuật — Bot Member Zalo

Tài liệu này mô tả **cách toàn bộ hệ thống hoạt động**: các thành phần, các luồng
chính và cách dữ liệu chạy qua từng bước. Để cài đặt trên VPS, xem
[`bot/VPS_SETUP.md`](bot/VPS_SETUP.md). Để biết tổng quan tính năng, xem
[`README.md`](README.md).

> Toàn bộ thời gian trong DB là **epoch milliseconds** (INTEGER). Tài khoản Zalo
> dùng là **tài khoản phụ co-admin** — không bao giờ đụng tài khoản chính.

---

## 1. Tổng quan kiến trúc

Hệ thống gồm 2 process chạy song song trên cùng một máy (do PM2 quản lý), giao
tiếp **gián tiếp** qua hệ thống file dùng chung trong `bot/data/`:

```text
                         ┌───────────────────────────────────────────┐
                         │                  VPS                       │
                         │                                            │
   Admin (browser) ──────┼──▶ ┌─────────────────┐                     │
                         │    │  zalo-web        │  (Next.js, PM2)     │
                         │    │  Port = WEB_PORT │                     │
                         │    └────────┬─────────┘                     │
                         │             │ đọc/ghi FILE                  │
                         │             ▼                               │
                         │    ┌──────────────────────────────┐        │
                         │    │        bot/data/  (dùng chung)│        │
                         │    │  • bot.db        (SQLite)     │        │
                         │    │  • session.json  (cookie/imei)│        │
                         │    │  • qr.png        (ảnh QR)     │        │
                         │    │  • login-status.json          │        │
                         │    │  • relogin-request.json       │        │
                         │    │  • vip-list.json              │        │
                         │    └──────────────────────────────┘        │
                         │             ▲                               │
                         │             │ đọc/ghi FILE                  │
                         │    ┌────────┴─────────┐                     │
                         │    │  zalo-bot        │  (Node worker, PM2) │
   Zalo servers ◀────────┼───▶│  listener 24/7   │                     │
                         │    └────────┬─────────┘                     │
                         │             │                               │
   Telegram (admin) ◀────┼─────────────┘  (gửi danh sách / nhận duyệt) │
                         │                                            │
                         │    cron ──▶ telegram-poll / cleanup / votes │
                         └────────────────────────────────────────────┘
```

**Điểm mấu chốt:** web và bot **không gọi API trực tiếp** lẫn nhau. Chúng phối hợp
bằng cách đọc/ghi các file trong `bot/data/` (DB, marker, ảnh QR). Đây là lý do
cả hai **phải chạy trên cùng máy / cùng volume**.

### Vai trò từng process

| Process    | Là gì                 | Làm gì                                                            |
|------------|-----------------------|------------------------------------------------------------------|
| `zalo-bot` | Node worker (`node dist/index.js start` → `runListener`) | Đăng nhập Zalo, lắng nghe message/reaction/event 24/7, ghi DB |
| `zalo-web` | Next.js (`next start`)| Dashboard: login QR, xem member/tin nhắn/lịch sử, sửa cấu hình + VIP |
| cron jobs  | crontab gọi `npm run …`| Định kỳ: telegram-poll, sync-votes, cảnh báo, lập danh sách dọn |

---

## 2. Vòng đời tổng (theo thời gian)

```text
  Ngày 0          Trong WARMUP_DAYS (mặc định 30)      Sau warmup, hằng tháng
    │                        │                                  │
    ▼                        ▼                                  ▼
┌─────────┐   ┌────────────────────────────┐   ┌───────────────────────────────┐
│ Login QR│──▶│ Listener thu thập tương tác │──▶│ Kỳ đầu sau warmup: BỎ QUA kick │
│ (1 lần) │   │ (message/reaction/vote)     │   │ (chỉ ghi nhận, an toàn)        │
└─────────┘   └────────────────────────────┘   └───────────────┬───────────────┘
                                                                │
                                                                ▼
                                         ┌──────────────────────────────────────┐
                                         │ Mỗi tháng:                            │
                                         │  • ngày 25, 09:00 → cảnh báo group    │
                                         │  • ngày 3,  09:00 → lập danh sách dọn  │
                                         │       → gửi Telegram duyệt             │
                                         │       → admin Duyệt/Huỷ (hoặc timeout) │
                                         │       → kick về TARGET_MEMBER_COUNT    │
                                         └──────────────────────────────────────┘
```

Cơ chế an toàn theo tầng:

1. **Warmup** (`WARMUP_DAYS`): trong giai đoạn này `monthly-cleanup` luôn skip —
   chưa đủ dữ liệu để đánh giá ai ít hoạt động.
2. **Bỏ qua kỳ đầu**: kỳ cleanup *đầu tiên* sau khi warmup xong vẫn không kick,
   chỉ đánh dấu `first_cycle_skipped`.
3. **Ân hạn 0 tương tác**: ai có **0 tương tác** lần đầu lọt diện xoá thì được ghi
   `cleanup_warnings`, kỳ đó **không bị xoá** — phải tiếp tục 0 tương tác kỳ sau.
4. **DRY_RUN**: khi `=1`, mọi thứ chạy nhưng **không gọi Zalo remove**.
5. **Telegram approval**: kể cả `DRY_RUN=0`, không có Telegram thì **không kick**.

---

## 3. Luồng đăng nhập Zalo (QR qua dashboard)

Web không tự đăng nhập Zalo — nó **ra hiệu** cho bot bằng file marker; bot mới là
process giữ socket Zalo và tạo QR.

```text
 Admin                zalo-web                 bot/data/                 zalo-bot                Zalo
   │                     │                         │                        │                     │
   │  mở /login          │                         │                        │                     │
   │────────────────────▶│  GET /api/qr            │                        │                     │
   │                     │  đọc login-status.json ─┼───────────────────────▶│ (đang chờ marker)   │
   │  bấm "Đăng nhập lại"│                         │                        │                     │
   │────────────────────▶│  POST /api/qr/relogin   │                        │                     │
   │                     │  ghi relogin-request.json───────▶ (file)         │                     │
   │                     │                         │   consumeReloginRequest()                     │
   │                     │                         │◀──── xoá marker + session cũ ─────│           │
   │                     │                         │                        │ login() / loginQR() │
   │                     │                         │                        │────────────────────▶│
   │                     │                         │     ghi qr.png +        │◀──── QR code ───────│
   │                     │                         │     login-status.json ──│                     │
   │   poll /api/qr ─────▶│  thấy state=waiting_scan│                        │                     │
   │   hiện ảnh QR ◀──────│  /api/qr/image đọc qr.png                        │                     │
   │                     │                         │                        │                     │
   │  quét QR bằng app    │                         │   state=scanned ───────│ QRCodeScanned       │
   │  xác nhận trên phone │                         │   state=logged_in ─────│ GotLoginInfo        │
   │                     │                         │   ghi session.json ◀────│ (lưu cookie/imei)   │
   │  thấy "đã đăng nhập" ◀│  poll thấy logged_in   │                        │ listener.start()    │
```

Các trạng thái login (`login-status.json` → `state`):
`ready → waiting_scan → scanned → logged_in`, cùng nhánh lỗi `expired` /
`declined`. Web chỉ **đọc** các trạng thái này; bot là bên duy nhất **ghi** chúng.

Vì sao tách qua file marker:

- Web process **không bao giờ chạm vào secret Zalo** (cookie/imei) — chỉ bot dọn
  và lưu session. Web chỉ ghi `relogin-request.json` (không chứa secret).
- Tránh hai socket Zalo song song: bot thấy marker → `process.exit(0)` → PM2
  restart → process mới tạo QR. Luôn chỉ một socket sống.

`POST /api/qr/relogin` chờ tối đa 15s để bot phản hồi; nếu bot/PM2 chưa chạy thì
trả lỗi 503 rõ ràng thay vì báo thành công giả.

---

## 4. Luồng thu thập tương tác (listener 24/7)

`zalo-bot` chạy `runListener()` liên tục. Mỗi event Zalo → ghi vào SQLite.

```text
        Zalo WebSocket events                      Xử lý                       Bảng DB
   ┌──────────────────────────┐
   │ message                  │──▶ record(msg,"message") ──▶ logInteraction ──▶ interactions
   │                          │        │                                       (type='message')
   │                          │        └─ nếu có text ─────▶ saveGroupMessage ─▶ group_messages
   │                          │        └─ nếu ảnh/video ───▶ saveGroupMedia ───▶ group_media_events
   │                          │        └─ upsertMember ─────────────────────────▶ members
   ├──────────────────────────┤
   │ reaction                 │──▶ record(rc,"reaction") ──▶ logInteraction ───▶ interactions
   │                          │                                                 (type='reaction')
   ├──────────────────────────┤
   │ group_event: join        │──▶ upsertMember(joinedAt) ────────────────────▶ members
   │ group_event: leave/      │──▶ markMemberLeft ────────────────────────────▶ members
   │   remove/block           │                                                 (is_active=0)
   └──────────────────────────┘

   Định kỳ trong listener:
   • startup + mỗi LISTENER_MEMBER_SYNC_INTERVAL_MS → syncGroupMembers()
     (sửa lệch khi admin xoá tay hoặc WebSocket rớt group_event)
     └─ ghi member_sync_runs + member_events để dashboard/audit đọc lại
   • heartbeat → ghi bot_health vào bot_state để dashboard biết process/socket còn sống
   • dashboard request → check-permissions không phá huỷ, lưu permission_check vào bot_state
   • mỗi 6h  → syncVotesOnce() → fetchGroupPollVotes ─▶ logInteraction(type='vote')
   • heartbeat (LISTENER_HEARTBEAT_MS) → log socket còn sống

   Kiểm duyệt từ khoá cấm (nếu bật trong /settings):
   • message có text ─▶ moderateMessage() ─▶ tìm từ cấm (nguyên từ, không phân biệt
     hoa/thường, giữ dấu) ─▶ xoá tin (deleteMessage, onlyMe=false)
     └─ action=delete_and_ban ─▶ removeUserFromGroup + addGroupBlockedMember (chặn vào lại)
     └─ miễn trừ owner/admin + VIP; tôn trọng DRY_RUN; báo Telegram; ghi moderation_actions
```

Lọc & dedupe:

- Chỉ ghi tương tác cho thread = `GROUP_ID` (`isTargetThread`). Bỏ DM / group khác.
- Bảng `interactions` có UNIQUE `(zalo_user_id, ts, type, source)` → ghi trùng cùng
  event là no-op.
- `group_messages` UNIQUE `(thread_id, message_id)` → không lưu trùng tin nhắn.

**Giới hạn đã verify (không phải bug):**

- **Không lấy được tương tác quá khứ.** `getGroupChatHistory` trả 404 với Zalo
  Community; `old_messages`/`old_reactions` của zca-js chỉ là batch offline-sync,
  không backfill sâu. ⇒ Dữ liệu chỉ tích luỹ **từ lúc listener chạy** → bắt buộc
  có giai đoạn warmup.
- **Vote không đến qua event.** `GroupEventType` không có poll/vote. ⇒ phải **chủ
  động đọc** poll mỗi 6h (`fetchGroupPollVotes`). Bù lại đọc được cả voter cũ vì
  poll lưu trạng thái trên server. Poll ẩn danh thì không đọc được voter.

**Kiểm duyệt từ khoá (delete + ban):**

- Xoá tin của người khác và kick/chặn cần bot là **admin/co-admin** của nhóm. Thiếu
  quyền → Zalo trả lỗi (xoá đã xong vẫn giữ, chỉ báo lỗi bước kick — không undo được).
- "Ban" = `removeUserFromGroup` (kick) **+** `addGroupBlockedMember` (thêm vào blocked
  list của nhóm = "chặn người này tham gia lại"). Đây là 2 bước riêng; chặn lỗi không
  huỷ việc đã kick.
- Khớp **nguyên từ**, không phân biệt hoa/thường, **giữ dấu** tiếng Việt (`moderation.ts`,
  có unit test). Cụm nhiều từ khớp khi xuất hiện đầy đủ.

---

## 5. Luồng cảnh báo group (ngày 25)

```text
  cron 09:00 ngày 25  ──▶  npm run cleanup-warn  (DRY_RUN=0 SEND_GROUP_WARNINGS=1)
                                   │
                                   ▼
                     syncGroupMembers() — đồng bộ member từ Zalo về DB
                                   │
                   ┌───────────────┴───────────────┐
       member_count <= TARGET?                member_count > TARGET?
                   │                               │
                   ▼                               ▼
          scan_run = "skipped"        gửi text vào group (co-admin):
          (không cảnh báo)            "📢 Còn ~9 ngày nữa nhóm sẽ dọn bớt
                                       thành viên ít hoạt động…"
                                                   │
                                                   ▼
                                       scan_run = "done"
```

Nếu `DRY_RUN=1` **hoặc** `SEND_GROUP_WARNINGS=0` → chỉ in ra, không gửi thật.
Cron do `install-cron` cài đã override sẵn `DRY_RUN=0 SEND_GROUP_WARNINGS=1` cho
riêng job này, nên `.env` vẫn có thể để `DRY_RUN=1` an toàn cho thao tác tay.

---

## 6. Luồng dọn dẹp + duyệt Telegram (ngày 3)

Đây là luồng phức tạp nhất, chia 2 pha: **lập danh sách** (ngày 3) và **thực thi
sau khi duyệt** (telegram-poll mỗi phút).

### 6.1. Lập danh sách — `monthly-cleanup`

```text
 cron 09:00 ngày 3 ──▶ npm run monthly-cleanup (DRY_RUN=0)
        │
        ▼
 syncGroupMembers()  ─ đồng bộ member hiện tại từ Zalo
        │
        ▼
 ┌──────────────── các cửa kiểm tra (gate), gặp cái nào thoả thì SKIP ──────────────┐
 │  • chưa hết warmup?                      → scan_run "skipped"                     │
 │  • chưa bỏ qua kỳ đầu (first cycle)?     → đánh dấu + "skipped"                   │
 │  • member_count <= TARGET?               → "skipped"                              │
 └───────────────────────────────────────────────┬───────────────────────────────────┘
                                                  ▼
                                buildCandidates() — xếp hạng ứng viên:
                                  loại: role != member, VIP, người mới trong kỳ này
                                  sort: interaction_count ASC, last_interaction ASC
                                        (chưa từng tương tác đứng trước)
                                                  │
                                  needToRemove = min(member_count - TARGET,
                                                     MAX_KICKS_PER_RUN)
                                                  │
                                top = candidates[0 .. needToRemove]
                                                  │
                          ┌───────────────────────┴───────────────────────┐
                  0 tương tác & chưa cảnh báo?                 còn lại
                          │                                       │
                          ▼                                       ▼
                  → cleanup_warnings (ÂN HẠN)            → cleanup_plan_items (PLAN)
                    kỳ này KHÔNG xoá
                                                  │
                          ┌───────────────────────┴───────────────────────┐
              DRY_RUN=1 hoặc plan rỗng?            DRY_RUN=0 & có Telegram?
                          │                                       │
                          ▼                                       ▼
                  in danh sách, DỪNG          sendApprovalMessage(Telegram)
                  scan_run="planned"          scan_run="pending_approval"
                                              lưu mốc approval_sent_at (đếm timeout từ đây)
```

Nếu `DRY_RUN=0` nhưng **chưa cấu hình Telegram** → vẫn lập danh sách (`planned`)
nhưng **không kick**. Bắt buộc có bước duyệt mới được xoá.

### 6.2. Thực thi sau duyệt — `telegram-poll` (cron mỗi phút)

```text
 cron mỗi phút ──▶ npm run telegram-poll ──▶ pollTelegramUpdates()
        │
        ├─ callback "cleanup:approve:<runId>" ──▶ executeScanRun(runId, "telegram-approve")
        ├─ callback "cleanup:cancel:<runId>"  ──▶ scan_run="cancelled", plan items="skipped"
        ├─ message  "/retry"                  ──▶ executeScanRun(<run failed>, "telegram-retry")
        │
        └─ có run "pending_approval" quá APPROVAL_TIMEOUT_HOURS (mặc định 48h)?
                       │
                       ▼
              executeScanRun(runId, "telegram-timeout")   ← tự động tiến hành
```

`executeScanRun()` — vòng kick thật:

```text
 executeScanRun(runId)
   │
   ├─ run.status ∈ {pending_approval, planned, failed}?  ── không → bỏ qua
   │                                                          (đang 'kicking'/đã 'done')
   ├─ acquireLock(KICK_LOCK)  ── lock bị chiếm? → bỏ qua lần này (chống kick CHỒNG)
   │                              (cron mỗi phút có thể gọi đè lên nhau)
   ▼
   scan_run = "kicking"
   for mỗi member trong plan (status != removed):
        removeGroupMember(co-admin)  ──▶ Zalo
        recordRemoval + markMemberLeft + plan item="removed"
        refresh lock (giữ "tươi")
        sleep(KICK_THROTTLE_MS)        ← mặc định 2 phút/người, chống flag
   │
   ├─ lỗi giữa chừng? → plan item="failed", scan_run="failed"
   │                    Telegram: "❌ … Reply /retry để tiếp tục"
   ▼
   scan_run = "done"
   Telegram: "✅ Đã xoá N thành viên. Nhóm còn M."
   finally: releaseLock(KICK_LOCK)
```

Vì sao có lock: cron `telegram-poll` chạy **mỗi phút**, mà một batch kick có thể
kéo dài (50 người × 2 phút ≈ 100 phút). Lock một-statement-atomic đảm bảo chỉ một
tiến trình kick chạy, các lần cron khác bỏ qua. Lock cũ quá `KICK_LOCK_STALE_MS`
(3h) mới coi là chết và cho chiếm lại.

---

## 7. Quy tắc xếp hạng & loại trừ

Khi lập danh sách dọn, một member bị coi là **ứng viên** nếu **không** rơi vào
các trường hợp loại trừ:

```text
   LOẠI TRỪ (không bao giờ bị xoá tự động)        ĐƯỢC ÂN HẠN (hoãn 1 kỳ)
   ─────────────────────────────────────          ───────────────────────────
   • role = owner / admin                          • 0 tương tác & lần đầu lọt
   • nằm trong VIP list (vip-list.json)              diện xoá → ghi cảnh báo,
   • người mới trong kỳ hiện tại                      kỳ sau vẫn 0 mới bị xoá
     (first_seen_at hoặc joined_at >= đầu tháng)
```

Thứ tự xếp hạng ứng viên (ai bị xoá trước):

1. `interaction_count` tăng dần (ít tương tác nhất trước).
2. `last_interaction` tăng dần (lâu chưa tương tác nhất trước; NULL = chưa từng,
   đứng đầu).

Số lượng xoá mỗi kỳ = `min(member_count - TARGET_MEMBER_COUNT, MAX_KICKS_PER_RUN)`.

---

## 8. Lược đồ dữ liệu (SQLite)

File: `bot/data/bot.db`. Schema idempotent (`CREATE IF NOT EXISTS`), chạy mỗi lần
khởi động. Đầy đủ cột xem [`bot/src/db/schema.sql`](bot/src/db/schema.sql).

```text
  schema_migrations ───▶ version schema đã apply trên DB production
  bot_errors ──────────▶ lỗi vận hành append-only để dashboard /errors đọc

  members ──────────────┐ (zalo_user_id PK)
   • role, is_active     │
   • first_seen_at       │   1 ─── N
   • joined_at, left_at  ├──────────────▶ interactions
                         │                 (type: message|reaction|vote|manual)
                         │                 UNIQUE(user, ts, type, source)
                         ├──────────────▶ group_messages (text only)
                         │                 UNIQUE(thread_id, message_id)
                         ├──────────────▶ group_media_events (image/video metadata only)
                         ├──────────────▶ member_events (join/leave/remove/reactivate)
                         └──────────────▶ cleanup_warnings (ân hạn 0-tương-tác)

  member_sync_runs ──────▶ lịch sử các lần đồng bộ member từ Zalo

  scan_runs ────────────┐ (1 kỳ quét/dọn)
   • status: collecting │   1 ─── N
     | warned | planned ├──────────────▶ cleanup_plan_items (plan xoá, bền qua restart)
     | pending_approval │                 status: planned|removed|skipped|failed
     | kicking | done   └──────────────▶ removals (ai đã bị xoá thật)
     | cancelled
     | skipped | failed

  cleanup_draft_plans ──▶ plan nháp lưu từ dashboard /candidates để so sánh trước cleanup

  moderation_actions (append-only): mỗi lần xoá tin/ban vì dính từ khoá cấm
   • matched_word, text, action (delete_only|delete_and_ban)
   • dry_run, deleted, kicked, blocked, error

  bot_state (key-value): warmup_started_at, first_cycle_skipped,
                         approval_sent_at:<run>, cleanup_kick_lock,
                         cfg:* (target/warmup/throttle…),
                         cfg:moderation_enabled, cfg:moderation_action,
                         cfg:blacklist_words (JSON), …
```

Vì sao plan lưu bền (`cleanup_plan_items`): approval/timeout/retry có thể xảy ra
**sau khi process restart** (cron là process mới mỗi lần). Danh sách phải nằm
trong DB chứ không phải bộ nhớ, nếu không sẽ mất sau restart.

---

## 9. Dashboard web

| Trang        | Đọc gì                                  | Ghi gì                          |
|--------------|------------------------------------------|---------------------------------|
| `/login`     | `login-status.json`, `qr.png`           | `relogin-request.json` (marker) |
| `/members`   | bảng `members` + thống kê tương tác     | —                               |
| `/messages`  | bảng `group_messages` (+ export)        | —                               |
| `/history`   | `scan_runs`, `removals`                 | —                               |
| `/settings`  | cấu hình runtime + `vip-list.json` + lọc từ khoá | cấu hình + VIP + blacklist |

Web đọc DB qua `WEB_DB_PATH`, QR/marker qua `WEB_QR_DIR`, VIP qua `WEB_VIP_PATH` —
PM2 đặt sẵn các biến này trỏ tuyệt đối vào `bot/data/` (xem
[`bot/ecosystem.config.cjs`](bot/ecosystem.config.cjs)), nên web đọc đúng dữ liệu
runtime dù `next build` ở thư mục khác.

Sửa VIP list trên `/settings` có hiệu lực ngay ở kỳ cleanup kế tiếp vì
`monthly-cleanup` đọc `vip-list.json` mỗi lần chạy (nếu file hỏng → coi như rỗng
kỳ đó để không crash cả kỳ).

---

## 10. Cấu hình & cron

`.env` (file thật là `bot/.env`, PM2 đọc nó — `.env.example` chỉ là mẫu). Các
biến quan trọng:

| Biến                    | Ý nghĩa                                                |
|-------------------------|--------------------------------------------------------|
| `GROUP_ID`              | Group Zalo cần quản lý (lấy bằng `npm run list-groups`)|
| `TARGET_MEMBER_COUNT`   | Số member muốn giữ lại sau mỗi kỳ                      |
| `WARMUP_DAYS`           | Số ngày chỉ quan sát, chưa kick                        |
| `DRY_RUN`               | `1` = không gọi Zalo remove / không gửi cảnh báo thật  |
| `MAX_KICKS_PER_RUN`     | Trần số người xoá một kỳ                               |
| `KICK_THROTTLE_MS`      | Nghỉ giữa mỗi lần kick (chống flag)                    |
| `ZALO_THROTTLE_MS`      | Nghỉ giữa các call Zalo nặng                           |
| `VIP_LIST_PATH`         | File JSON danh sách trắng                              |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Bắt buộc để bật bước duyệt + kick    |
| `TELEGRAM_FORWARD_ENABLED` | `1` = sao chép message Zalo live sang Telegram          |
| `TELEGRAM_FORWARD_BOT_TOKEN` | Token bot riêng cho forward, tách khỏi bot notification |
| `TELEGRAM_FORWARD_CHAT_ID` | Supergroup/channel riêng nhận message forward           |
| `TELEGRAM_FORWARD_TOPIC_ID`| `message_thread_id` của forum topic; trống nếu chat thường/channel |
| `APPROVAL_TIMEOUT_HOURS`| Không phản hồi sau N giờ thì tự tiến hành (mặc định 48)|
| `WEB_PORT`              | Port dashboard (PM2 đọc; để trống = 3000)              |

Cron (`npm run install-cron`, timezone `Asia/Ho_Chi_Minh`):

```text
  * * * * *      telegram-poll     # mỗi phút: duyệt/huỷ/retry/timeout
  */5 * * * *    health-check      # mỗi 5 phút: báo Telegram nếu bot heartbeat stale
  17 */6 * * *   sync-votes        # mỗi 6h: backup đọc voter trong poll
  0 9 25 * *     cleanup-warn      # ngày 25: cảnh báo group (DRY_RUN=0 SEND_GROUP_WARNINGS=1)
  0 9 3 * *      monthly-cleanup   # ngày 3: lập danh sách + gửi Telegram duyệt (DRY_RUN=0)
```

---

## 11. Lệnh CLI (chạy trong `bot/`)

| Lệnh                          | Tác dụng                                              |
|-------------------------------|-------------------------------------------------------|
| `npm run dev`                 | Chạy listener local từ TypeScript                     |
| `npm run build && npm start`  | Build và chạy listener từ `dist/` (PM2 production)    |
| `npm run list-groups`         | Liệt kê group + ID để điền `GROUP_ID`                 |
| `npm run export-members`      | Xuất danh sách member ra CSV (tra ID cho VIP)         |
| `npm run import-interactions` | Import vote/manual interaction từ CSV/JSON            |
| `npm run sync-members`        | Đồng bộ member hiện tại từ Zalo về DB                 |
| `npm run check-permissions`   | Kiểm tra role/quyền bot, không kick/xoá thật          |
| `npm run health-check`        | Báo Telegram nếu bot heartbeat stale/hồi phục         |
| `npm run sync-votes`          | Đọc voter trong poll → ghi tương tác                  |
| `npm run telegram-test`       | Gửi tin thử để kiểm Telegram token + chat id          |
| `npm run telegram-find-topic` | Tìm chat ID và topic ID từ một message Telegram mới   |
| `npm run telegram-forward-test` | Gửi thử vào đích forward đã cấu hình                |
| `npm run cleanup-warn`        | Cảnh báo group (DRY_RUN=1 chỉ in)                     |
| `npm run monthly-cleanup`     | Lập danh sách / kick (DRY_RUN=1 chỉ in)               |
| `npm run telegram-poll`       | Xử lý duyệt/huỷ/retry/timeout Telegram                |
| `npm run setup-vps`           | Cài, build, start PM2, cài cron (one-shot)            |
| `npm run install-cron`        | (Cài/cập nhật riêng) các cron job                     |
| `npm run validate-env`        | Kiểm `.env` đủ biến trước khi setup                   |

---

## 12. Bảo mật & lưu ý vận hành

- `zca-js` là **API Zalo không chính thức** → tài khoản có thể bị giới hạn/khoá.
  Chỉ dùng tài khoản phụ co-admin, throttle mọi call (`*_THROTTLE_MS`).
- **Không commit** `.env`, `session.json`, `qr.png`, `bot.db` — chứa secret /
  dữ liệu thành viên.
- Web chỉ nên expose qua Nginx/Caddy + HTTPS (xem `VPS_SETUP.md` mục 3b), không
  mở thẳng `WEB_PORT` ra Internet nếu tránh được.
- Sau reboot: chạy `pm2 startup` một lần (và lệnh sudo nó in ra) để PM2 tự bật
  lại `zalo-bot` + `zalo-web`.
```
