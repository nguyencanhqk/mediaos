# G10 — Communication: Chat realtime · Notification Center · Meeting — Kế hoạch thực thi

> Lane: `feat/g10-comms` (worktree riêng, chạy song song G7/G9/G11/G13). Dải migration **0050–0059**.
> Nền tảng đã có (G4-6, migration `0010`): `chat_rooms`, `chat_room_members`, `chat_messages` (append-only),
> `notifications` + module REST `src/chat/*`, `src/notifications/*`, contracts `chat.ts`/`notification.ts`,
> FE `ProjectChatPage` (poll 5s) + `NotificationBell` (poll 30s). G10 **mở rộng**, không viết lại.

## Quyết định kiến trúc chốt trước

1. **Không tạo bảng `chat_members`/`messages` mới** — TASKS.md liệt kê tên đó nhưng `0010` đã tạo
   `chat_room_members`/`chat_messages` cùng chức năng. Tạo bảng trùng chức năng = phá DRY + RLS registry đã đăng ký
   bảng cũ. → Mở rộng bảng hiện có bằng `ALTER TABLE`.
2. **WS masking = parse qua Zod contracts trước khi emit.** Mọi payload server→client đi qua
   `packages/contracts` schema (`.parse()` strip mọi field thừa) — cùng DTO layer như REST. CẤM `io.emit` row DB.
3. **Append-only giữ nguyên cho `chat_messages`**: ghim tin dùng **column-level GRANT UPDATE (pinned_at, pinned_by)**
   — body/sender bất biến, app role không có UPDATE cột khác.
4. **Audit CHECK `object_type`**: mở rộng trong `0050` bằng **DO-block union** — đọc danh sách hiện tại từ
   `pg_get_constraintdef` (regexp các giá trị trong quote), union với type mới của G10, rồi rebuild constraint.
   → An toàn với MỌI thứ tự áp migration (G7 0032-0037 / G9 0040-0049 cũng mở CHECK này trên cùng DB dev dùng
   chung): không bao giờ xoá type lane khác đã thêm. Khác pattern 0011/0014/0020 (full-list) — chủ đích, vì các
   lane chạy song song.
5. **Task sau họp = bảng `tasks` chung** (`task_type='meeting_action'` — CHECK 0008 đã cho phép,
   `content_item_id` nullable). `meeting_tasks` CHỈ là bảng liên kết meeting↔task. Không đụng `project_id`
   (chờ G9 land — để TODO).
6. **Socket.IO chung port HTTP API** (3100), namespace `/ws`, Valkey adapter (`@socket.io/redis-adapter` +
   ioredis đã có). VALKEY_URL vắng → fail-soft về in-memory adapter (single instance dev), log WARN — cùng triết lý
   ValkeyService. Room naming: `co:{companyId}:chat:{roomId}`, `co:{companyId}:user:{userId}` (ADR-0013).
7. **WS auth**: handshake `auth.token` → `TokenService.verifyAccessToken` (cùng secret/claims như REST guard);
   fail → disconnect. `socket.data.user = {id, companyId}`. Mọi handler đọc companyId TỪ SOCKET (server-side),
   không bao giờ từ payload client.

## Môi trường DB riêng cho lane (chống nhiễm cross-lane)

- **KHÔNG áp migration G10 vào DB dev dùng chung `mediaos`.** Lý do: (a) drizzle migrator chỉ áp entry có
  `when` > max `created_at` đã áp — DB chung đã có `when=1717500045000` (G7 0032-0037); nếu G10 áp `when` 0050+
  vào DB chung thì khi G9 (0040s) áp sau sẽ bị **skip im lặng**; (b) DB chung đã nhiễm bảng G7 làm fail
  rls-guards introspection của worktree này.
- → Tạo database **`mediaos_g10`** trên cùng Postgres container (roles cluster-wide đã có, migration 0001
  idempotent DO-guard). Áp 0000–0031 + 0050+ vào đó.
- `vitest.config.ts`: đổi 3 URL hardcode thành `process.env.TEST_DATABASE_URL ?? <default cũ>` (default giữ
  nguyên `mediaos` — backward compatible, không phá lane khác khi merge). Lane này set env trỏ `mediaos_g10`.
- `db:migrate` chạy với `DATABASE_DIRECT_URL` override per-command (không sửa `.env` dùng chung).
- **Journal `when` cho G10**: `0050=1717500050000`, `0051=1717500051000`, `0052=1717500052000` (monotonic, khớp
  dải file). MERGE NOTE trong handoff: khi merge về master, renumber journal + thứ tự áp trên DB chung PHẢI
  G9 trước G10; trước khi áp kiểm `SELECT max(created_at) FROM drizzle.__drizzle_migrations`.
- Baseline test trên DB chung (ghi nhận 2026-06-12): 341 pass / 5 fail / 172 skip — fail toàn bộ do nhiễm
  cross-lane (rls-guards introspection thấy bảng G7; reset-token/secret-rotation/tenant-isolation/auth/
  workflow-lifecycle). Sau khi chuyển `mediaos_g10` phải đo lại baseline; kỳ vọng xanh — mọi fail mới = của G10.

## G10-1 — Chat realtime (FULL gate, 🛠️ TDD: RED trước)

### Migration `0050_g10_chat_realtime.sql`
- `chat_rooms`: mở CHECK `room_type` → `('project','direct','group','channel','department')`; thêm cột
  `channel_id` (FK channels, SET NULL), `org_unit_id` (FK org_units, SET NULL), `direct_key` text,
  `created_by` (FK users). Unique partial idx: `(company_id, channel_id)`, `(company_id, org_unit_id)`,
  `(company_id, direct_key)` — idempotent auto-room + dedup DM 1-1 (`direct_key` = 2 userId sort + join).
- `chat_room_members`: thêm `role` ('member','admin') default 'member', `last_read_at` timestamptz;
  GRANT UPDATE (role, last_read_at) cho app role.
- `chat_messages`: thêm `message_type` ('text','file') default 'text', `file_url`, `file_name`,
  `mentions` jsonb default '[]', `pinned_at`, `pinned_by` (FK users), `seq` bigint GENERATED ALWAYS AS IDENTITY;
  idx `(room_id, seq)`; partial idx pinned. **GRANT UPDATE (pinned_at, pinned_by)** — chỉ ghim được, không sửa body.
- `audit_logs`: mở CHECK thêm `chat_room`, `chat_message`, `notification`, `notification_rule`,
  `notification_preference`, `meeting`, `meeting_room` (kèm MERGE NOTE union với G7/G9).
- Đồng bộ Drizzle schema `communication.ts` + `audit.ts` (AUDIT_OBJECT_TYPES) cùng commit.

### Backend
- Deps mới (api): `socket.io`, `@nestjs/websockets`, `@nestjs/platform-socket.io`, `@socket.io/redis-adapter`;
  devDep `socket.io-client` (test). Web: `socket.io-client`.
- **Vá guard global cho WS context (BLOCKER reviewer #2)**: `JwtAuthGuard` + `CompanyGuard` đang gọi
  `ctx.switchToHttp().getRequest()` vô điều kiện — với WS execution context sẽ crash/undefined. Sửa cả 2 guard:
  `if (ctx.getType() !== 'http') return true;` (WS tự auth ở handshake + mọi handler check `socket.data.user`
  fail-closed). Kèm unit test: handler khi socket chưa auth → từ chối, KHÔNG pass nhờ guard crash bị nuốt.
- `src/realtime/` module mới:
  - `valkey-io.adapter.ts` — IoAdapter + Valkey pub/sub (fail-soft), đăng ký ở `main.ts`. Env kill-switch
    `REALTIME_ENABLED` (default true) — tắt được gateway khi sự cố, FE còn poll fallback.
  - `rooms.ts` — helper tên room `co:{companyId}:…` (cấm string-concat rải rác).
  - `realtime.gateway.ts` — namespace `/ws`: auth handshake; `chat:join/leave` (check membership qua ChatService
    trước khi join); `chat:send` (Zod validate → ChatService.sendMessage → emit DTO đã parse); `chat:typing`
    (chỉ broadcast nếu socket đã join room đó); `chat:presence:list` (ack danh sách userId online trong room).
  - `realtime-emitter.service.ts` — cổng emit cho module khác (NotificationsService dùng để đẩy
    `notification:new` vào `co:{companyId}:user:{userId}`); mọi method nhận DTO ĐÃ parse qua contracts.
- Mở rộng `ChatService`/`ChatRepository`: sendMessage trả row join senderName (DTO parity REST/WS);
  mention → tạo notification `mentioned` (best-effort sau commit) + emit; pin/unpin (UPDATE 2 cột + audit
  `ChatMessagePinned`); direct room idempotent (`POST /chat/direct`); member add/remove
  (`POST/DELETE /chat/rooms/:id/members`, admin/owner check + audit `ChatRoomMemberAdded/Removed`).
- Contracts: mở rộng `chatMessageSchema` (messageType, fileUrl, fileName, mentions, pinnedAt, pinnedBy, seq),
  `sendMessageSchema` (file/mentions), thêm `realtime.ts` (tên event + payload schema client→server,
  server→client). FE/BE dùng chung.

### Test (realtime-test-harness — viết RED trước)
- `test/realtime/realtime-harness.ts`: boot AppModule qua `Test.createTestingModule` + `app.listen(0)`,
  seed 2 tenant (direct pool — pattern `workflow-lifecycle.e2e-spec.ts`), mint JWT thật qua TokenService,
  connect `socket.io-client`. Auto-skip khi thiếu DATABASE_URL (pattern `hasDb`).
- `test/realtime/realtime-chat.e2e-spec.ts` — các case bắt buộc (lỗ hổng GX):
  1. **Lifecycle**: token hợp lệ → connect OK; không token/token rác → bị từ chối.
  2. **Cross-tenant deny**: user công ty B `chat:join` room công ty A → lỗi + KHÔNG nhận message/presence của A
     (kể cả khi đoán đúng roomId).
  3. **Membership deny**: user cùng công ty nhưng không phải member → join bị từ chối.
  4. **Masking**: payload `chat:message` đúng EXACT key-set của `chatMessageSchema` (không lộ field thừa).
  5. **Ordering**: N message liên tiếp → nhận đúng thứ tự, `seq` tăng nghiêm ngặt.
  6. **Reconnect**: disconnect → reconnect cùng token → rejoin + nhận message mới; lịch sử lấy qua REST.
- Unit spec (mock): gateway auth fail-path, join deny-path, emitter chỉ nhận DTO parse được.
- RLS int-test: bảng mới (notification_rules/preferences, meetings…) thêm vào `rls-registry.ts`.

## G10-2 — Auto group chat (LIGHT)
- `ChatService.ensureChannelRoom` / `ensureOrgUnitRoom` (idempotent nhờ unique idx, pattern `ensureProjectRoom`).
- Gọi tại điểm tạo channel (media module) + tạo org_unit (org module); thêm member khi thêm thành viên
  project/channel (tìm call-site tương ứng; nếu không có event hook thì gọi trực tiếp như pattern hiện tại).
- Test: ensure 2 lần → 1 room; member add idempotent (`onConflictDoNothing`).

## G10-3 — Notification Center (LIGHT)
### Migration `0051_g10_notification_rules.sql`
- `notification_rules`: id, company_id, `notification_type` text, `name`, `is_mandatory` bool default false,
  `is_enabled` bool default true, `created_at/updated_at`, `deleted_at`. Unique (company_id, notification_type)
  WHERE deleted_at IS NULL. RLS+FORCE, grants SELECT/INSERT/UPDATE (soft-delete qua deleted_at).
- `notification_preferences`: id, company_id, user_id, `notification_type`, `is_enabled` bool;
  unique (company_id, user_id, notification_type). RLS+FORCE, grants SELECT/INSERT/UPDATE.
- Seed permission `('manage','notification')` nếu catalog chưa có (theo pattern 0019/0027) — dùng cho admin rules.
### Logic
- `NotificationsService.create` → check rule+preference: **mandatory (rule.is_mandatory) → LUÔN gửi, không
  preference nào tắt được (server-side enforce)**; rule disabled → skip; preference user tắt (và không mandatory)
  → skip. Mặc định (không rule/pref) → gửi. Sau insert → emit `notification:new` qua RealtimeEmitter.
- REST: GET/PUT `/notification-preferences` (user tự quản — server từ chối tắt type mandatory);
  GET/POST/PATCH `/notification-rules` (@RequirePermission('manage','notification') + PermissionGuard). Audit
  rule change (`NotificationRuleUpdated`).
- Contracts: mở rộng `notificationTypeSchema` (+`meeting_invited`, `meeting_action_assigned`, `chat_message`),
  schemas rules/preferences.
- FE: trang Notification Center (list + filter + mark read + tab Preferences — toggle disable với type mandatory
  bị khoá kèm chú thích); NotificationBell nâng cấp subscribe WS (giữ poll làm fallback).

## G10-4 — Meeting (LIGHT)
### Migration `0052_g10_meetings.sql`
- `meeting_rooms`: catalog phòng họp (name, location, capacity, is_active, deleted_at). RLS+FORCE.
- `meetings`: meeting_room_id (FK nullable), title, agenda, starts_at, ends_at (CHECK ends>starts),
  organizer_user_id, status ('scheduled','completed','cancelled'), deleted_at. RLS+FORCE.
  (KHÔNG project_id — TODO chờ G9.)
- `meeting_attendees`: meeting_id, user_id, role ('organizer','required','optional'),
  rsvp ('invited','accepted','declined'); unique (meeting_id, user_id). RLS+FORCE.
- `meeting_notes` (biên bản): meeting_id, author_user_id, body; UPDATE được (audit kèm), KHÔNG DELETE grant.
- `meeting_tasks`: **CHỈ liên kết** meeting_id + task_id, unique cặp. RLS+FORCE.
### Logic
- `src/meetings/` module: CRUD meeting (organizer sửa/hủy; attendee xem), check trùng phòng họp (overlap query),
  invite → notification `meeting_invited` + WS; notes CRUD-nhẹ; **action item**: insert vào `tasks`
  (`task_type='meeting_action'`, title/assignee/due_date) + link `meeting_tasks` + notification `task_assigned`
  + audit `MeetingActionTaskCreated`. Tất cả trong cùng `withTenant` tx (audit cùng commit).
- FE: trang Meetings (list theo ngày + dialog tạo + detail: attendees/RSVP/notes/action items → link sang Tasks).
- Test: service spec (mock) cho deny-path (không phải organizer không sửa được), action-task tạo đúng
  `task_type`; RLS int-test các bảng mới; overlap phòng họp.

## Thứ tự + gate
1. G10-1 RED tests → 0050 → schema/contracts → gateway+service → GREEN → **FULL gate**
   (`ecc:security-reviewer` + `ecc:silent-failure-hunter` + kiểm masking) → commit `feat(g10-1)`.
2. G10-2 → LIGHT gate → commit `feat(g10-2)`.
3. G10-3 (0051) → LIGHT gate → commit `feat(g10-3)`.
4. G10-4 (0052) → LIGHT gate → commit `feat(g10-4)`.
5. Cập nhật TASKS.md (tick + hash) + handoff `docs/plans/G10-progress-handoff.md`.

## Rủi ro & né
- **Audit CHECK xung đột cross-lane** → MERGE NOTE trong SQL + handoff.
- **PgBouncer**: WS handler chỉ dùng `withTenant` (pool thường); adapter Valkey dùng ioredis riêng,
  KHÔNG đụng directPool.
- **Emit row thẳng** → emitter chỉ nhận output `.parse()` của contracts schema (type-enforced).
- **Token expiry trên WS**: connection sống có thể vượt TTL token (15m) — chấp nhận cho MVP (room đã join là
  membership-checked tại join); ghi nhận trong handoff như known-limitation (disconnect định kỳ là follow-up).
- **Valkey vắng**: adapter fail-soft in-memory (dev) — prod multi-instance PHẢI có VALKEY_URL (ghi handoff).
