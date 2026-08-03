# Micro-plan — `S7-CHAT-BE-1` (🔴 red · crown · FULL gate) — **rev 2 (02/08/2026)**

> **WO:** `ChatAccessService` — điểm khẳng định membership DUY NHẤT + CHAT-API-001..008 (phòng & thành viên).
> **Nguồn sự thật:** [SPEC-15 §3.2 · §3.3 · §12 · §13](<../SPEC/SPEC-15 CHAT.md>) · [API-13 §5.1](<../API Design/API-13_CHAT_API_Design.md>) · [DB-12](<../DB/DB-12 CHAT Database Design.md>)
> **Nền:** mig `0538` (`S7-CHAT-DB-1`) **và `0539` (`S7-CHAT-DB-2`)** đã land trên `wave/s7-chat` (`4c5c2da6`).
> **Nhánh:** commit lên `wave/s7-chat` (❗KHÔNG `master` — WAVE §4).
>
> **rev 2 vá gì:** (a) nền giờ có `0539` ⇒ mọi con số hướng-client là `room_seq` **per-room**, không phải `seq` toàn cục; (b) bổ sung 5 dòng ĐO THẬT mà rev 1 thiếu — tập cột UPDATE-được của `chat_room_members`, `modules.CHAT` không có guard runtime, `API_MODULE_TAGS` chưa có mục CHAT, contracts còn thiếu DTO, contract counter pin thiếu 2 trường; (c) ghi nợ tường minh `chatMessageSchema.seq` còn lộ.

---

## 0. Đo thật trước khi thiết kế

| Thứ | Đo được 02/08/2026 | Nguồn |
| --- | --- | --- |
| Khuôn module gần nhất cùng hình dạng | `apps/api/src/goals/` — **có sẵn `goal-access.service.ts`** tách riêng lớp gate | đọc code |
| Guard | `PermissionGuard` **opt-in per-controller** (`@UseGuards` + `@RequirePermission`), pipeline toàn cục chỉ có `JwtAuthGuard` → `CompanyGuard` → `TwoFactorEnforcementGuard` | `goals.controller.ts:41-46` · `app.module.ts:103-105` |
| Tenant tx | `DatabaseService.withTenant(companyId, fn)` — **chốt DUY NHẤT** cho data-access nghiệp vụ | `db.service.ts:74` |
| Audit | `AuditService.record(tx, …)` — **phải gọi TRONG cùng tx nghiệp vụ**; `result_status ∈ {Success,Failure,Denied,Error}` có CHECK ở DB; `object_type` `'chat_room'`/`'chat_message'` **đã có** trong union TS | `audit.service.ts:59-70` · `db/schema/audit.ts:137-138` |
| **`nextCode` mở tx RIÊNG** | `SequenceService.nextCode()` tự gọi `withTenant` bên trong ⇒ **KHÔNG lồng được** vào tx nghiệp vụ | `sequence.service.ts:128,137` |
| Grant `sequence_counters` cho app role | **SELECT, INSERT, UPDATE** (RLS+FORCE bật) ⇒ lazy-create §1.4 khả thi | `0434:126` |
| Seeder master-data | chỉ chạy `reconcileAllCompanies()` **lúc boot**, gated `MASTER_DATA_SEED_ON_BOOT` | `master-data-seed-bootstrap.service.ts:35` |
| Route census | thêm route ⇒ **ĐỎ** `route-guard-coverage`; phải regen + ký phán quyết | memory `route-census-runtime-gate` |
| **🆕 Tập cột UPDATE-được của `chat_room_members`** | ĐÚNG **6**: `role`, `last_read_at` (`0050:64`) + `last_read_seq`, `muted_until`, `left_at`, `visible_from_seq` (`0538:258`). **`joined_at` và `added_by` KHÔNG được cấp** — chạm vào là `42501` lúc chạy, không phải lúc typecheck | `0050:64` · `0538:250-258` |
| **🆕 `chat_rooms` quyền ghi** | UPDATE **cấp bảng** còn nguyên (`0010:72`) ⇒ rename/archive/soft-delete chạy được; **DELETE đã REVOKE** (`0538:266`) ⇒ mọi `delete()` là 42501 | `0010:72` · `0538:264-266` |
| **🆕 `modules.CHAT` `is_active=false` KHÔNG chặn route** | Không có `ModuleGuard`/vị từ `is_active` nào trong đường quyền runtime (grep `apps/api/src`: 0 hit) ⇒ int-spec chạy được **mà không cần bật module**; `is_active` chỉ lái danh sách app FE | grep `is_active` trong `permission.service.ts` = 0 · `0538:384-400` |
| **🆕 `API_MODULE_TAGS` CHƯA có mục CHAT** | 0 hit `chat` trong `config/openapi-modules.ts` ⇒ thêm route `/chat/**` mà không khai mục là rơi vào `UNCLASSIFIED_PREFIX` ⇒ **ĐỎ** `openapi-modules.spec` + `openapi-contract.e2e-spec` | `config/openapi-modules.ts:38` · `openapi-modules.spec.ts:56` |
| **🆕 `packages/contracts/src/chat.ts` mới phủ ~40% WO** | Có: `chatRoomSchema` · `createChatRoomSchema` · `openDirectRoomSchema` · `addChatMemberSchema` · `chatRoomMemberSchema`. **Thiếu:** update room · patch member role · room detail (kèm `myRole`/members) · query lọc danh sách phòng · phản hồi leave | đọc file |
| **🆕 Cặp quyền đã seed** | 9 cặp `chat-room`/`chat-member`/`chat-message` + `('view','chat-oversight')` (`is_sensitive=true`), cộng `('access','chat')` = **10** | `0538:408-419` |

---

## 1. Lựa chọn thiết kế — chốt ở đây, không để người thi công tự quyết

### 1.1 `ChatAccessService.assertMember` — chữ ký cố định, KHÔNG có cửa sau

```ts
assertMember(tx: TenantTx, companyId: string, roomId: string, actorUserId: string): Promise<ChatRoomMembership>
```

- **KHÔNG tham số/cờ nào bỏ qua membership.** Đường đọc-vượt (CHAT-DEC-004) là service+controller **RIÊNG** ở `S7-CHAT-BE-7`. Giữ được tính chất "đọc code là chứng minh được" cho đường đọc thường — nhét một `if (isOversight)` vào đây là mất vĩnh viễn (API-13 §5.3 ràng buộc 1).
- Bên trong gồm **đủ ba** điều kiện: `chat_room_members.left_at IS NULL` · `chat_rooms.deleted_at IS NULL` · `company_id` khớp (RLS đã ép, vẫn viết tường minh — defense-in-depth).
- Trả về membership (gồm `role`) để caller kiểm `role='admin'` **mà không truy vấn lần hai**.

### 1.2 404-vs-403 — NGƯỢC quy ước của GOAL, đừng copy nguyên khối

| Tình huống | Mã | Vì sao |
| --- | --- | --- |
| Không phải thành viên · phòng không tồn tại · phòng tenant khác · phòng đã xoá mềm | **404** | 403 xác nhận phòng CÓ tồn tại ⇒ thành oracle dò (CHAT-ERR-001) |
| **Đã là thành viên** nhưng thiếu quyền/vai trò (vd không phải admin phòng) | **403** | Không lộ gì thêm — actor đã biết phòng tồn tại |

⚠️ `goals` dùng quy ước **ngược** (trong tenant mà ngoài phạm vi → 403, SPEC-10 §20.2). Copy nhầm sang CHAT là mở oracle. Ca test phải chứng minh **404 giống hệt nhau** cho `roomId` tồn-tại-nhưng-không-thuộc và `roomId` không-tồn-tại.

### 1.3 Sinh `room_code` — tx riêng, TRƯỚC tx nghiệp vụ

`nextCode` tự mở `withTenant` ⇒ gọi **trước** khi vào tx tạo phòng (mirror `task-code.util.ts`: "tx RIÊNG, KHÔNG cần business tx"). Hệ quả chấp nhận: tx nghiệp vụ rollback thì mã đã cấp bị **bỏ phí** (lỗ số) — đúng như TASK, không phải khuyết tật mới.

### 1.4 Trả nợ counter (done_when #8) — **CHỌN: lazy-create trong service**

Mig `0538` chỉ seed counter cho company **tồn tại lúc migrate**; không seeder runtime nào cấp cho company mới (`sequence_counters` không có trong `master-data-seeder.registry`), và registry cũng chỉ chạy **lúc boot** ⇒ dù đăng ký seeder vẫn còn cửa sổ "company tạo giữa hai lần restart".

**Chọn lazy-create**, vì đo được app role có `SELECT, INSERT, UPDATE` trên `sequence_counters` (`0434:126`):

```text
try  nextCode({sequenceKey:'chat_room', scopeType:'Company'})
catch SequenceNotFoundError:            ← lớp lỗi export ở sequence.types.ts:101, KHÔNG bắt bằng chuỗi message
     INSERT counter theo CONTRACT KHOÁ của 0538 — ĐỦ 9 TRƯỜNG:
       module_code='CHAT' · sequence_key='chat_room' · scope_type='Company'
       prefix='ROOM-' · padding_length=4 · reset_policy='Never'
       increment_by=1 · current_value=0 · status='Active'
       ON CONFLICT DO NOTHING            ← race-safe qua partial unique uq_sequence_counters_company_key_scope_active (0434:109)
     retry nextCode MỘT lần; lần hai vẫn lỗi ⇒ ném lên (KHÔNG vòng lặp)
```

Giá trị contract **phải trùng literal với `0538:157-165`** — lệch là mã backfill và mã runtime khác hình dạng mà không ai báo. Pin bằng test (ca 12).

⚠️ `increment_by=1` + `current_value=0` là **hai trường rev 1 bỏ sót**. Bỏ trống chúng thì `nextCode` = `current_value + increment_by` dựa vào DEFAULT của cột, mà DEFAULT không phải chỗ hợp đồng được ghi — mã đầu tiên có thể ra `ROOM-0002` hoặc `ROOM-0000` tuỳ DEFAULT, và test ca 12 sẽ pin **nhầm** hình dạng.

> `task` (mig 0498) có **đúng lỗ này**, chưa vá — ngoài phạm vi WO, đã ghi nợ ở backlog.

### 1.5 Đếm chưa đọc — MỘT truy vấn, không N+1, hệ `room_seq`

`unread = GREATEST(0, room.last_message_seq − member.last_read_seq)` — **CẢ HAI vế trong hệ `room_seq` per-room** (mig `0539`), KHÔNG phải `chat_messages.seq` toàn cục. Đó là lý do `0538` thêm `last_message_seq` lên `chat_rooms` và `0539` sửa lại ngữ nghĩa của nó. Danh sách phòng = **một** câu JOIN, cấm `COUNT(*)` per-room.

`GREATEST(0, …)` không phải trang trí: `last_message_seq` là **NULL** ở phòng chưa có tin nào (`0538` không đặt DEFAULT 0), nên phép trừ phải `COALESCE(last_message_seq, 0)` trước — thiếu là `unread` ra `null` và ZodError ở FE dù HTTP 200 (lớp `server-masking-needs-optional-fe-schema`).

### 1.6 Mở DM idempotent

`direct_key` = 2 `userId` **sort tăng dần, join ':'**. Gọi lần hai trả **đúng phòng cũ, HTTP 200** (không 201, không tạo bản sao). Race hai request đồng thời ⇒ dựa `chat_rooms_direct_uq` (partial unique, có sẵn từ 0010): bắt `23505` → SELECT lại trả phòng đã có.

---

## 2. Phạm vi — 8 nhóm endpoint (API-13 §5.1)

| Mã | Route | Cặp quyền | assertMember | Audit |
| --- | --- | --- | --- | --- |
| 001 | `GET /chat/rooms` | `view:chat-room` | tự-bound theo actor | — |
| 002 | `POST /chat/rooms` | `create:chat-room` | — | ✅ |
| 003 | `POST /chat/rooms/direct` | `create:chat-room` | — | ✅ (lần tạo đầu) |
| 004 | `GET /chat/rooms/:id` | `view:chat-room` | ✅ | — |
| 005 | `PATCH /chat/rooms/:id` | `update:chat-room` | ✅ + `role='admin'` | ✅ |
| 006 | `POST /chat/rooms/:id/archive` | `archive:chat-room` | ✅ + `role='admin'` | ✅ |
| 007a-d | `GET/POST/PATCH/DELETE /chat/rooms/:id/members[/:userId]` | `view:chat-room` / `manage:chat-member` | ✅ (+admin cho ghi) | ✅ |
| 008 | `POST /chat/rooms/:id/leave` | `view:chat-room` | ✅ | ✅ |

**Chặn nghiệp vụ:** thao tác thành viên thủ công trên phòng **dẫn xuất** `department`/`project` → CHAT-ERR-012 · rời `direct`/`department`/`project` → CHAT-ERR-013 · bớt **admin cuối cùng** của phòng nhóm → CHAT-ERR-011 · chỉ tạo được phòng `group` qua API-002 (`direct` đi 003, dẫn xuất do hệ thống).

**Rời phòng = `SET left_at`, KHÔNG DELETE hàng** — `0538` đã REVOKE DELETE nên viết sai là 42501 lúc chạy. Vào lại phòng ⇒ **tái dùng đúng hàng cũ** (`left_at = NULL`), insert hàng thứ hai sẽ dính `23505` trên unique `(room_id, user_id)`.

⚠️ **Vào lại KHÔNG được đụng `joined_at`/`added_by`** — hai cột đó KHÔNG nằm trong tập 6 cột UPDATE-được (§0). `UPDATE … SET left_at = NULL, joined_at = now()` là `42501` lúc chạy, mà typecheck và unit test đều **mù** với nó. Giữ nguyên `joined_at` cũ cũng đúng ngữ nghĩa SPEC-15 §13.3 ("từng ở đây"). Cùng lý do: đổi vai trò khi thêm lại thì `SET role = $1` được (cột `role` CÓ trong tập 6), `SET added_by = $2` thì không.

### 2.1 DTO còn thiếu ở `packages/contracts/src/chat.ts` (đo ở §0)

Bổ sung **additive**, không sửa cái đang có ngoài phần ghi chú:

| Schema mới | Dùng cho |
| --- | --- |
| `listChatRoomsQuerySchema` | CHAT-API-001 — lọc `type?`, `archived?` |
| `updateChatRoomSchema` | CHAT-API-005 — `name?`/`description?`, ít nhất một trường |
| `chatRoomDetailSchema` | CHAT-API-004 — phòng + `members[]` + `myRole` |
| `updateChatMemberSchema` | CHAT-API-007c — `role` |
| `chatRoomMemberSchema` **mở rộng** | CHAT-API-007a cần `lastReadSeq` + `userName` để dựng "đã xem bởi" (API-13 §5.1) — thêm field **optional**, không đổi field cũ |

---

## 3. KHÔNG làm trong WO này

- ❌ Bất kỳ thứ gì thuộc `/chat/oversight/*` (đó là `S7-CHAT-BE-7`).
- ❌ Tin nhắn (BE-2) · tệp (BE-3) · tìm kiếm (BE-4) · phòng dẫn xuất tự động (BE-5) · NOTI (BE-6) · WS (RT-1).
- ❌ Bật `modules.CHAT` (`is_active` do WO cuối wave; pin `migration-smoke` đang giữ `false`). Đo được ở §0: **không cần bật** để int-spec chạy.
- ❌ Thêm cặp quyền mới hay đụng seed — `0538` đã chốt 10 cặp.

### 3.1 🔻 NỢ chuyển sang `S7-CHAT-BE-2` — `chatMessageSchema.seq` còn lộ `seq` toàn cục

`S7-CHAT-DB-2` chốt "DTO/contracts KHÔNG trả `seq`", nhưng `4c5c2da6` chỉ sửa `chatRoomSchema`; `chatMessageSchema` (`packages/contracts/src/chat.ts:63-64`) **vẫn** khai `seq` kèm comment cũ "thứ tự tổng trong room" — đúng câu `0539` đã bác.

WO này **không dựng endpoint nào trả tin nhắn**, nên chưa rò gì ra client. Nhưng để BE-2 không xây tiếp lên chỗ sai: **rev 2 chốt — BE-1 chỉ sửa COMMENT thành cảnh báo tường minh, GIỮ NGUYÊN field**. Bỏ field là quyết định hình dạng DTO tin nhắn, thuộc BE-2; sửa comment là chặn người đọc kế tiếp tin vào câu sai.

---

## 4. Test RED-trước

⚠️ **CHỦ THỂ KHÔNG ĐƯỢC LÀ SUPER ADMIN.** Role `SA` giữ toàn bộ catalog (đo: 379/379, sau `0538` là 389/389 nhờ khối F′) ⇒ dùng SA thì mọi ca deny-path **lọt**. Dùng: (a) role thường, (b) role **có** `view:chat-room` nhưng **không** có `view:chat-oversight`.

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| 1 | Không phải thành viên đọc `GET /rooms/:id` | **404** |
| 2 | `roomId` **không tồn tại** | **404 GIỐNG HỆT ca 1** (thân + mã) |
| 3 | `roomId` của **tenant khác** | 404 |
| 4 | Người đã `left_at` đọc phòng cũ | 404 |
| 5 | Thành viên **không phải admin** gọi PATCH/archive/thêm-bớt thành viên | **403** (đã là thành viên ⇒ không giấu) |
| 6 | Thao tác thành viên trên phòng `department` | CHAT-ERR-012 |
| 7 | Rời phòng `direct` | CHAT-ERR-013 |
| 8 | Bớt admin cuối cùng | CHAT-ERR-011 |
| 9 | `POST /rooms/direct` hai lần | **cùng roomId**, HTTP 200, đúng 1 hàng |
| 10 | Rời rồi vào lại phòng nhóm | tái dùng hàng cũ, **không** 23505 |
| 11 | Danh sách phòng có ≥3 phòng | **1 truy vấn** (đếm query), unread đúng phép trừ |
| 12 | Company **chưa có counter** tạo phòng đầu | lazy-create thành công, mã đúng `ROOM-0001`, contract counter khớp **đủ 9 trường** của `0538` |
| 13 | Mọi hành động quản trị | có đúng 1 hàng `audit_logs` `object_type='chat_room'`, **không** chứa nội dung tin |
| 14 | grep toàn `apps/api/src/chat/` | **0 chỗ** tự viết lại điều kiện membership ngoài `assertMember` |
| 15 🆕 | Phòng **chưa có tin nào** (`last_message_seq IS NULL`) trong danh sách | `unreadCount = 0`, **không** `null` (§1.5) |
| 16 🆕 | Rời phòng nhóm rồi được thêm lại | `joined_at` **giữ nguyên**, không 42501 (§2) |

Chạy: `bash scripts/lane-db-setup.sh chatbe1` → `export LANE_DB=mediaos_chatbe1` → `bash harness/check.sh --lane-db`. Đặt ở `apps/api/test/integration/**/*.int-spec.ts`. Drop lane khi xong.

⚠️ **Nạp env trước khi gọi vitest tay** (memory `lane-db-run-needs-explicit-urls`): `LANE_DB` một mình là chưa đủ — thiếu `APP_DB_PASSWORD` thì vitest.config chặn ngay, mà `DATABASE_URL` tường minh trong `.env` lại THẮNG `LANE_DB` ⇒ chạm DB được bảo vệ. Chuỗi đúng:

```bash
set -a && . ./.env && set +a
unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL PGBOUNCER_URL
export LANE_DB=mediaos_chatbe1
```

### 4.1 Bằng chứng RED (bắt buộc — vá tạm, chạy, hoàn nguyên)

| Vá tạm | Ca ĐỎ kỳ vọng |
| --- | --- |
| `assertMember` ném `ForbiddenException` thay `NotFoundException` (= copy quy ước của `goals`) | ca 1+2 · 3 · 3b · 5b — **5 ca** |
| bỏ `isNull(chatRoomMembers.leftAt)` khỏi `assertMember` | ca 4 |
| bỏ `COALESCE`/`GREATEST` khỏi công thức đếm chưa đọc (cả bản SQL lẫn bản JS) | ca đếm chưa đọc |

---

## 5. Definition of Done

- [x] `assertMember` là **đường duy nhất**; grep chứng minh 0 chỗ trùng lặp (ca test 14)
- [x] 404/403 đúng bảng §1.2; ca 1 và ca 2 trả **phản hồi giống hệt nhau**
- [x] 8 nhóm endpoint + 4 chặn nghiệp vụ; DM idempotent; danh sách phòng không N+1
- [x] Lazy-create counter theo contract literal **đủ 9 trường** của `0538`
- [x] Audit đủ hành động quản trị, **trong cùng tx** nghiệp vụ
- [x] `@RequirePermission` + `@UseGuards(PermissionGuard)` per-controller, đúng cặp §11
- [x] **`API_MODULE_TAGS` thêm mục `CHAT`** (`segments: ["chat"]`) — thiếu là ĐỎ `openapi-modules.spec` + `openapi-contract.e2e-spec`, KHÔNG phải chỉ mất nhãn đẹp
- [x] DTO bổ sung ở `packages/contracts/src/chat.ts` (§2.1) — additive
- [x] Comment cảnh báo `chatMessageSchema.seq` (§3.1); **không** bỏ field
- [x] **Regen route census** (`ROUTE_CENSUS_WRITE=1`) + ký phán quyết — thêm ~11 route
- [x] **16** ca RED-trước xanh trên `LANE_DB`, có bằng chứng RED trước GREEN
- [x] Không đường ghi nào chạm `joined_at`/`added_by` của `chat_room_members`, hay `DELETE` trên `chat_rooms`/`chat_room_members` (§0 — 42501 runtime, typecheck mù)
- [x] `harness/check.sh --lane-db=chatbe1` **XANH ✅** — 465/465 file api chạy thật (không phải xanh-do-skip), + app/auth/console/contracts/ui/web-core; secret-literals · lint · typecheck · migration-no-drop đều xanh
- [ ] FULL gate (security-reviewer + silent-failure-hunter) — **CHƯA chạy**, chờ chốt (phiên này không spawn sub-agent)
- [x] lane DB `mediaos_chatbe1` drop sau khi xong
