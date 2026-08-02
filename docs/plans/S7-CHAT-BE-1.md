# Micro-plan — `S7-CHAT-BE-1` (🔴 red · crown · FULL gate)

> **WO:** `ChatAccessService` — điểm khẳng định membership DUY NHẤT + CHAT-API-001..008 (phòng & thành viên).
> **Nguồn sự thật:** [SPEC-15 §3.2 · §3.3 · §12 · §13](<../SPEC/SPEC-15 CHAT.md>) · [API-13 §5.1](<../API Design/API-13_CHAT_API_Design.md>) · [DB-12](<../DB/DB-12 CHAT Database Design.md>)
> **Nền:** mig `0538` (`S7-CHAT-DB-1`) đã land trên `wave/s7-chat`.
> **Nhánh:** commit lên `wave/s7-chat` (❗KHÔNG `master` — WAVE §4).

---

## 0. Đo thật trước khi thiết kế

| Thứ | Đo được 02/08/2026 | Nguồn |
| --- | --- | --- |
| Khuôn module gần nhất cùng hình dạng | `apps/api/src/goals/` — **có sẵn `goal-access.service.ts`** tách riêng lớp gate | đọc code |
| Guard | `PermissionGuard` **opt-in per-controller** (`@UseGuards` + `@RequirePermission`), pipeline toàn cục chỉ có `JwtAuthGuard` → `CompanyGuard` → `TwoFactorEnforcementGuard` | `goals.controller.ts:41-46` · `app.module.ts:103-105` |
| Tenant tx | `DatabaseService.withTenant(companyId, fn)` — **chốt DUY NHẤT** cho data-access nghiệp vụ | `db.service.ts:74` |
| Audit | `AuditService.record(tx, …)` — **phải gọi TRONG cùng tx nghiệp vụ**; `result_status ∈ {Success,Failure,Denied,Error}` có CHECK ở DB | `audit.service.ts:59-70` |
| **`nextCode` mở tx RIÊNG** | `SequenceService.nextCode()` tự gọi `withTenant` bên trong ⇒ **KHÔNG lồng được** vào tx nghiệp vụ | `sequence.service.ts:128,137` |
| Grant `sequence_counters` cho app role | **INSERT, SELECT, UPDATE** (RLS+FORCE bật) | đo trên PROD |
| Seeder master-data | chỉ chạy `reconcileAllCompanies()` **lúc boot**, gated `MASTER_DATA_SEED_ON_BOOT` | `master-data-seed-bootstrap.service.ts:35` |
| Route census | thêm route ⇒ **ĐỎ** `route-guard-coverage`; phải regen + ký phán quyết | memory `route-census-runtime-gate` |

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

**Chọn lazy-create**, vì đo được app role có `INSERT` trên `sequence_counters`:

```
try  nextCode({sequenceKey:'chat_room', scopeType:'Company'})
catch SequenceNotFoundError:
     INSERT counter theo CONTRACT KHOÁ của 0538
       (module_code='CHAT' · scope_type='Company' · reset_policy='Never' · prefix='ROOM-' · padding_length=4 · status='Active')
       ON CONFLICT DO NOTHING            ← race-safe qua partial unique uq_sequence_counters_company_key_scope_active
     retry nextCode MỘT lần; lần hai vẫn lỗi ⇒ ném lên (KHÔNG vòng lặp)
```

Giá trị contract **phải trùng literal với `0538`** — lệch là mã backfill và mã runtime khác hình dạng mà không ai báo. Pin bằng test.

> `task` (mig 0498) có **đúng lỗ này**, chưa vá — ngoài phạm vi WO, đã ghi nợ ở backlog.

### 1.5 Đếm chưa đọc — MỘT truy vấn, không N+1

`unread = GREATEST(0, room.last_message_seq - member.last_read_seq)`. Đó là lý do `0538` thêm `last_message_seq` lên `chat_rooms`. Danh sách phòng = **một** câu JOIN, cấm `COUNT(*)` per-room.

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

---

## 3. KHÔNG làm trong WO này

- ❌ Bất kỳ thứ gì thuộc `/chat/oversight/*` (đó là `S7-CHAT-BE-7`).
- ❌ Tin nhắn (BE-2) · tệp (BE-3) · tìm kiếm (BE-4) · phòng dẫn xuất tự động (BE-5) · NOTI (BE-6) · WS (RT-1).
- ❌ Bật `modules.CHAT` (`is_active` do WO cuối wave; pin `migration-smoke` đang giữ `false`).
- ❌ Thêm cặp quyền mới hay đụng seed — `0538` đã chốt 10 cặp.

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
| 12 | Company **chưa có counter** tạo phòng đầu | lazy-create thành công, mã đúng `ROOM-0001`, contract counter khớp `0538` |
| 13 | Mọi hành động quản trị | có đúng 1 hàng `audit_logs` `object_type='chat_room'`, **không** chứa nội dung tin |
| 14 | grep toàn `apps/api/src/chat/` | **0 chỗ** tự viết lại điều kiện membership ngoài `assertMember` |

Chạy: `bash scripts/lane-db-setup.sh chatbe1` → `export LANE_DB=mediaos_chatbe1` → `bash harness/check.sh --lane-db`. Đặt ở `apps/api/test/integration/**/*.int-spec.ts`. Drop lane khi xong.

---

## 5. Definition of Done

- [ ] `assertMember` là **đường duy nhất**; grep chứng minh 0 chỗ trùng lặp (ca test 14)
- [ ] 404/403 đúng bảng §1.2; ca 1 và ca 2 trả **phản hồi giống hệt nhau**
- [ ] 8 nhóm endpoint + 4 chặn nghiệp vụ; DM idempotent; danh sách phòng không N+1
- [ ] Lazy-create counter theo contract literal của `0538`
- [ ] Audit đủ hành động quản trị, **trong cùng tx** nghiệp vụ
- [ ] `@RequirePermission` + `@UseGuards(PermissionGuard)` per-controller, đúng cặp §11; khai `API_MODULE_TAGS`
- [ ] **Regen route census** (`ROUTE_CENSUS_WRITE=1`) + ký phán quyết — thêm ~11 route
- [ ] 14 ca RED-trước xanh trên `LANE_DB`, có bằng chứng RED trước GREEN
- [ ] `harness/check.sh --lane-db` xanh · FULL gate PASS · lane DB đã drop
