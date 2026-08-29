# DB-16: ROOM DATABASE DESIGN — QUẢN LÝ PHÒNG HỌP

> **Nguồn nghiệp vụ:** [SPEC-14 ROOM](<../SPEC/SPEC-14 ROOM.md>) · Quy ước chung: [DB-01](<DB-01 DATABASE DESIGN TỔNG QUAN.md>) §3.2/§7.11/§19b · AUTH nền: [DB-02](<DB-02 AUTH RBAC Database Design.md>) (`users`) · Foundation: [DB-08](<DB-08 Audit Files Settings Seeds Database Design.md>) (`audit_logs`, `system_jobs`)
>
> **Liên quan:** [API-15 ROOM API Design](<../API Design/API-15_ROOM_API_Design.md>) · [DB-09 §8.17 index](<DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 seed ROOM](<DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>) · [Ma trận phân quyền §9e](<../permission-matrix-spec.md>) · [DB-15 ASSET](<DB-15 ASSET Database Design.md>) (module anh em, khuôn migration) · [Chỉ mục tài liệu](<../README.md>)
>
> **Đánh số:** DB-13/DB-14 đã được IMPLEMENTATION-10 §13.2 đặt trước cho PAYROLL/RECRUIT ⇒ ASSET lấy **DB-15**, ROOM lấy **DB-16** (OFFICE-DEC-001, owner ký 28/08/2026).

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DB-16 |
| Tên tài liệu | ROOM Database Design — Quản lý phòng họp |
| Module | ROOM (SPEC-14) |
| Phiên bản | v1.0 — **Approved** cùng SPEC-14 (owner duyệt gói wave S11-OFFICE 28/08/2026; nhánh mở ROOM-DEC-001 chốt 29/08/2026 sau khi ĐO) |
| Ngày tạo / cập nhật | 29/08/2026 / 29/08/2026 |
| Head migration lúc viết | idx 215 / `0548_s10cleanworkflowcluster2_drop_workflow_approval_cluster`; ASSET (DB-15) dự kiến `0549–0551` ⇒ migration ROOM dự kiến **`0552+`** |
| Giai đoạn | Phase 3 · wave S11-OFFICE — hậu go-live |

> ⚠️ Số migration dưới đây là **dự kiến**. WO DB phải đọc `apps/api/migrations/meta/_journal.json` **tại thời điểm chạy** để lấy head thật; lane migration là lane **nối tiếp** duy nhất — `S11-ROOM-DB-1` chỉ chạy **sau khi `S11-ASSET-DB-1` merge** (`depends_on` đã khoá).

---

## 2. Mục đích tài liệu

Đặc tả tầng dữ liệu cho module ROOM: phòng họp, lượt đặt phòng có ràng buộc chống trùng ở DB, người tham dự. Khác ASSET (DB-15 — tạo mới từ số không) và khác CHAT (DB-12 — chỉ ALTER), ROOM là **ba việc trong một WO DB**: **tái dụng + ALTER** `meeting_rooms`, **tạo mới** `room_bookings` + `room_booking_attendees`, **DROP** 4 bảng di sản của hub G10 (`meetings` · `meeting_attendees` · `meeting_notes` · `meeting_tasks`) — theo ROOM-DEC-001. Quy tắc nghiệp vụ (mã lỗi, thứ tự kiểm, data scope) sống ở SPEC-14 — file này chỉ nói về dữ liệu.

---

## 3. Phạm vi thiết kế

### 3.0 Số đo di sản — 29/08/2026, DB `mediaos` (PROD + dev-online dùng chung), script `logs/measure-meeting-legacy.mjs` (chỉ SELECT, `default_transaction_read_only = on`)

| Đối tượng | Số đo | Ý nghĩa cho thiết kế |
| --- | --- | --- |
| `meeting_rooms` · `meetings` · `meeting_attendees` · `meeting_notes` · `meeting_tasks` | **0 / 0 / 0 / 0 / 0 hàng** (`total` lẫn `live`) | DROP/ALTER không cần migrate dữ liệu; tiền kiểm "0 hàng" ở bước B là **fail-loud**, không phải "cố gắng migrate" |
| Cột thật `meeting_rooms` | `id · company_id · name(text!) · location(text?) · capacity(int?) · is_virtual(bool!) · metadata(jsonb!) · created_by? · created_at! · deleted_at?` | khớp `schema/meeting.ts`; **thiếu** thiết bị · `requires_approval` · `is_active` · `updated_*` · `deleted_by`; `capacity` nullable ⇒ SET NOT NULL an toàn (0 hàng) |
| Cột thật `meetings` | `meeting_room_id uuid?` (SET NULL) · `status text!` CHECK `scheduled/cancelled/completed` · `organizer_id!` FK users **CASCADE** · `agenda jsonb!` · `metadata jsonb!` · `deleted_at?` | lệch SPEC-14 ở 5 điểm (SPEC-14 §3.4) ⇒ **thay**, không ALTER |
| Ràng buộc thật `meetings` | `meetings_no_room_overlap_excl` EXCLUDE gist `(meeting_room_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (meeting_room_id IS NOT NULL AND deleted_at IS NULL AND status <> 'cancelled')`; composite FK `0535` cho `meeting_room_id` (`SET NULL (col)`) và `organizer_id` (`CASCADE`); `UNIQUE (company_id, id)` | khuôn EXCLUDE **tái dùng nguyên dạng** cho `room_bookings` (thêm `company_id WITH =`, predicate `status = 'Confirmed'`) |
| RLS | cả 5 bảng `relrowsecurity = relforcerowsecurity = true` | `meeting_rooms` giữ policy có sẵn `meeting_rooms_tenant`; verify fail-loud |
| GRANT `mediaos_app` | `meeting_rooms`/`meetings`/`meeting_notes`: `INSERT, SELECT, UPDATE`; `meeting_attendees`: `+ DELETE`; `meeting_tasks`: `INSERT, SELECT, DELETE` | `meeting_rooms` đã đúng khuôn soft-delete (không DELETE) — giữ |
| 6 cặp permission `('view'\|'create'\|'update'\|'cancel','meeting')` · `('view'\|'manage','meeting_room')` | mỗi cặp **2 `role_permissions`** (12 hàng), `is_sensitive=false` | 0 guard/controller dùng ⇒ xoá grant + **xoá cứng** cặp ở bước B không mở cửa sổ 403 (`permissions` KHÔNG có `deleted_at` — `0005`; đo 29/08: 12 grant đều thuộc 2 role TENANT, 0 `object_permissions`) |
| `audit_logs` CHECK `object_type` | regex `'meeting…'` không bắt được vì CHECK dạng `= ANY('{…}'::text[])` (giá trị không quote riêng) ⇒ **chưa đo được** từng giá trị | bước C: UNION-ADD `room_booking` và **verify từng giá trị** `meeting_room` có mặt (thêm nếu thiếu) — clone khối `0506` |
| `notification_events`/`notifications` CHECK | `module_code`: `AUTH…CHAT` (chưa có `ASSET`/`ROOM`); `notification_type`: `System…Chat` | bước C nới **cả hai bảng** thêm `ROOM` / `Room` (sau ASSET đã thêm `ASSET`/`Asset` — re-stamp superset đo lại lúc chạy) |
| `modules` | hàng `ROOM` **đã tồn tại**, `is_active = false` | bước C chỉ **verify tồn tại, GIỮ `is_active = false`** (đính chính 29/08/2026 — tiền lệ ASSET `0550`/CHAT `0538`: bật khi chưa có endpoint = hứa suông; pin `migration-smoke` `EXTENSION_INACTIVE_MODULES` gồm `ROOM`); bật ở `S11-ROOM-FE-1` bằng UPDATE tường minh + gỡ pin cùng commit |
| `btree_gist` | extension 1.7 đã cài | bước A vẫn `CREATE EXTENSION IF NOT EXISTS` (lane DB mới) |
| Code | `grep -rln "meeting" apps/api --include=*.ts --include=*.mjs --include=*.sql` (trừ `migrations/`): **0** service/controller/guard; còn **4 điểm test/tooling** phải dọn cùng WO: `rls-registry.ts` (**4** entry `meetings` · `meeting_attendees` · `meeting_notes` · `meeting_tasks` — hai entry sau vẫn `INSERT INTO meetings` trong `seedRow`), `schema/index.ts`, **`apps/api/demo-seed-full.mjs:877-921 + 950-951`** (INSERT `meetings`/`meeting_attendees` + đếm, nằm **trong transaction trước `COMMIT`** ⇒ sau DROP toàn bộ demo-seed ROLLBACK), `AUDIT_OBJECT_TYPES`. 2 int-spec dùng chuỗi `'meeting_action'` là `task_type` của TASK — **không** liên quan, giữ | không có cửa sổ 403/500 khi DROP (0 guard sống); phần test/tooling dọn ở bước B |

### 3.1 Bảng TÁI DỤNG (ALTER)

| Bảng | Vai trò | Ghi chú |
| --- | --- | --- |
| `meeting_rooms` | Phòng họp | giữ tên (không đổi thành `rooms` — tránh đụng `chat_rooms`, giữ census `0535`); soft delete; **DROP `is_virtual`** |

### 3.2 Bảng MỚI

| Bảng | Vai trò | Ghi chú |
| --- | --- | --- |
| `room_bookings` | Lượt đặt phòng, FSM 2 trạng thái + EXCLUDE chống trùng | **sổ**: không DELETE, UPDATE cấp cột (huỷ) |
| `room_booking_attendees` | Người tham dự của lượt (cố định lúc đặt) | **sổ**: chỉ `SELECT, INSERT` |

### 3.3 Bảng DROP (contract — ROOM-DEC-001)

`meeting_tasks` → `meeting_notes` → `meeting_attendees` → `meetings` (thứ tự con→cha) + hàm trigger `meetings_set_updated_at()`. Tiền kiểm **0 hàng** fail-loud (§9 bước B).

### 3.4 Bảng dùng lại (không tạo mới)

`companies` · `users` (organizer · attendees · `*_by`; đã có `UNIQUE (company_id, id)` từ `0535`) · `employee_profiles` (chỉ JOIN tên/mã nhân viên khi đọc — không FK) · `roles`/`permissions`/`role_permissions` · `modules` · `audit_logs` · `notification_events`/`notification_templates`/`notifications` · `system_jobs`/`system_job_locks` (job nhắc lịch).

---

## 4. Nguyên tắc thiết kế

1. **RLS + FORCE theo `company_id`** trên cả 3 bảng — 2 bảng mới tạo policy literal-GUC mẫu `0479` **trước** mọi INSERT (bất biến #1); `meeting_rooms` giữ policy `0052`, verify fail-loud; đăng ký `rls-registry`.
2. **Composite tenant FK** `(company_id, x_id) REFERENCES t (company_id, id)` cho **mọi** FK chéo bảng nghiệp vụ (mẫu `0535`): `room_bookings.room_id → meeting_rooms`, `room_bookings.organizer_user_id → users`, `room_booking_attendees.booking_id → room_bookings`, `room_booking_attendees.user_id → users`. **Kể cả FK `*_by` (nullable) tới `users` cũng composite**: `(company_id, col) REFERENCES users (company_id, id) ON DELETE SET NULL (col)` — khuôn `0538:315-334` (CHAT: "6 cột FK mới, KHÔNG cái nào được để một cột"). Lý do: census `fk-tenant-census.ts` đếm **mọi** FK một-cột giữa hai bảng có `company_id` (không lọc nullable) ⇒ FK đơn cột mới làm `xtenant-fk-ratchet` assert (a) ĐỎ, và lớp T **không được ký waiver** (assert (e)); bản chất là lỗ KI-046 — FK Postgres bỏ qua RLS, `cancelled_by` trỏ được user tenant khác. `meeting_rooms.created_by` **đã** được `0535:340` phủ composite, không làm lại. Sàn `FK_SINGLE_COL_PAIRS_FLOOR` (`fk-tenant-verdicts.ts`) **PHẢI HẠ có đối chứng** (đính chính 29/08/2026 — Rev 1 ghi "không hạ" là sai): census chỉ đếm FK **một-cột**, DROP 4 bảng làm 8 cặp biến mất còn composite FK mới không tính vào ⇒ 423 → **415**; tương tự `W4_FK_BLOCKED_FLOOR` (`tenant-isolation.int-spec.ts`) 241 → **232** (8 rơi + 1 đổi nhóm: `meeting_rooms.created_by` bị unique `lower(name)` mới chặn trước FK trong ca W4). Hạ ĐÚNG số đo hai lane (`mediaos_roombase551` head 0551 vs `mediaos_roomdb1` head 0555), lý do văn bản tại chỗ. `PROVEN_WITH_CHECK_FLOOR` 133 giữ (đo 137).
   - **`company_id` của cả 3 bảng: `REFERENCES companies (id) ON DELETE CASCADE`** — teardown test `DELETE FROM companies` phải dọn được.
   - **Composite FK nội bộ: `ON DELETE NO ACTION`, TUYỆT ĐỐI KHÔNG `RESTRICT`** (lý do ở DB-15 §4.2 — `RESTRICT` kiểm ngay, nổ khi cascade từ `companies` theo thứ tự anh em bất định).
   - ⚠️ **`organizer_user_id` NOT NULL + composite FK → `users` `NO ACTION`**: `cleanupTenants()` có dòng `DELETE FROM users` **trước** `DELETE FROM companies` ⇒ WO DB **phải** thêm `room_booking_attendees` → `room_bookings` **trước dòng `DELETE FROM users`** (không phải chỉ "trước companies"). Thiếu là đỏ hàng loạt `afterAll`.
3. **Sổ không xoá**: `room_bookings` — app role `GRANT SELECT, INSERT` + `UPDATE` **cấp cột** (chỉ cột huỷ + `updated_*`); `room_booking_attendees` — `SELECT, INSERT` (bất biến #2). Lịch sử sử dụng phòng = chính hai bảng này; **không** `deleted_at` trên lượt đặt (huỷ là trạng thái).
4. **Chống trùng ở DB là chốt cuối**: `EXCLUDE USING gist` trên `(company_id, room_id, tstzrange(starts_at, ends_at, '[)')) WHERE status = 'Confirmed'` — service kiểm trước để trả 409 có nội dung; vi phạm EXCLUDE (`23P01`) map về cùng 409.
5. **FSM ép ở service, DB chỉ CHECK tập giá trị + CHECK cặp huỷ** (`Cancelled ⇔ cancelled_at IS NOT NULL`); `Completed` **dẫn xuất**, không cột.
6. **Hợp đồng Zod mirror CHECK hai chiều, đúng bằng** (`packages/contracts/src/room.ts`) — không chặt hơn, không lỏng hơn.
7. UUID PK `gen_random_uuid()`, timestamp UTC (`timestamptz`), soft delete `deleted_at` chỉ ở `meeting_rooms` — theo DB-01.
8. **Không dựng bảng mới song song bảng cũ** (KI-079): bước contract DROP 4 bảng di sản nằm **cùng WO** với bước expand; migration có tiền kiểm 0 hàng.

---

## 5. ERD cấp module

```text
meeting_rooms 1─n room_bookings  (room_id NOT NULL)                      EXCLUDE gist: (company_id, room_id, [starts_at, ends_at)) WHERE Confirmed
users         1─n room_bookings  (organizer_user_id NOT NULL; booked_by_user_id ?)
room_bookings 1─n room_booking_attendees n─1 users                       unique (booking_id, user_id); organizer KHÔNG nằm trong bảng này
```

---

## 6. Chi tiết bảng

### 6.1 Bảng `meeting_rooms` — TÁI DỤNG (cột sau ALTER)

| Cột | Kiểu | Bắt buộc | Nguồn | Ghi chú |
| --- | --- | --- | --- | --- |
| `id` | UUID | Có | 0052 | PK |
| `company_id` | UUID | Có | 0052 | FK `companies.id` CASCADE, RLS; `UNIQUE (company_id, id)` đã có (`meeting_rooms_company_id_id_uq`) |
| `name` | TEXT | Có | 0052 | unique theo company **không phân biệt hoa/thường** trên hàng còn sống |
| `location` | TEXT | Không | 0052 | |
| `capacity` | INTEGER | **Có** | 0052 → **SET NOT NULL** | CHECK > 0 (0 hàng ⇒ ALTER an toàn) |
| `equipment` | TEXT[] | Có | **mới** | default `'{}'`; mảng chuỗi tự do (`TV` · `Bảng trắng`…), tối đa 20 mục — kiểm ở service |
| `description` | TEXT | Không | **mới** | |
| `requires_approval` | BOOLEAN | Có | **mới** | default false; v1 `true` ⇒ từ chối đặt (SPEC-14 §3.3) |
| `is_active` | BOOLEAN | Có | **mới** | default true; `false` ⇒ ẩn khỏi form đặt/availability |
| `sort_order` | INTEGER | Có | **mới** | default 0 |
| `metadata` | JSONB | Có | 0052 | default `{}` (giữ) |
| `created_by` | UUID | Không | 0052 | FK `users` SET NULL (+ composite `0535` `SET NULL (created_by)`) |
| `created_at` | TIMESTAMPTZ | Có | 0052 | |
| `updated_at` | TIMESTAMPTZ | Có | **mới** | default now() (cập nhật ở service — không trigger) |
| `updated_by` | UUID | Không | **mới** | composite FK → `users (company_id, id)` `SET NULL (updated_by)` (§4.2) |
| `deleted_at` | TIMESTAMPTZ | Không | 0052 | soft delete |
| `deleted_by` | UUID | Không | **mới** | composite FK → `users (company_id, id)` `SET NULL (deleted_by)` (§4.2) |
| ~~`is_virtual`~~ | — | — | 0052 → **DROP** | ngoài phạm vi SPEC-14 (phòng ảo/link họp online); cột ghi-rồi-bỏ ⇒ gỡ. Tiền kiểm: 0 hàng **hoặc** mọi hàng `false`, khác ⇒ `RAISE` |

```sql
-- ALTER (bước A) — 0 hàng đo 29/08/2026; mọi ALTER vẫn viết idempotent (IF NOT EXISTS / DO-block) cho lane DB
ALTER TABLE meeting_rooms
  ADD COLUMN IF NOT EXISTS equipment         text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS description       text,
  ADD COLUMN IF NOT EXISTS requires_approval boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active         boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order        integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at        timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by        uuid,
  ADD COLUMN IF NOT EXISTS deleted_by        uuid;
-- FK *_by COMPOSITE (§4.2) — KHÔNG REFERENCES users (id) một cột (ratchet xtenant-fk đỏ + lỗ KI-046)
ALTER TABLE meeting_rooms ADD CONSTRAINT meeting_rooms_updated_by_tenant_fk FOREIGN KEY (company_id, updated_by) REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by);
ALTER TABLE meeting_rooms ADD CONSTRAINT meeting_rooms_deleted_by_tenant_fk FOREIGN KEY (company_id, deleted_by) REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
ALTER TABLE meeting_rooms ALTER COLUMN capacity SET NOT NULL;          -- tiền kiểm: 0 hàng NULL, khác ⇒ RAISE
-- DROP COLUMN bị scripts/check-migration-no-drop.sh quét ⇒ file 0552 PHẢI mang dòng
--   -- DESTRUCTIVE-APPROVED: ROOM-DEC-001 gỡ is_virtual ngoài phạm vi SPEC-14, 0 hàng đo 29/08/2026 (owner ký 28/08/2026)
ALTER TABLE meeting_rooms DROP COLUMN IF EXISTS is_virtual;           -- tiền kiểm: 0 hàng true, khác ⇒ RAISE
ALTER TABLE meeting_rooms ADD CONSTRAINT chk_meeting_rooms_capacity CHECK (capacity > 0);
CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_rooms_company_name_active ON meeting_rooms (company_id, lower(name)) WHERE deleted_at IS NULL;
DROP INDEX IF EXISTS meeting_rooms_active_idx;                        -- thay bằng index có is_active/sort_order
CREATE INDEX IF NOT EXISTS idx_meeting_rooms_company_active ON meeting_rooms (company_id, is_active, sort_order) WHERE deleted_at IS NULL;
-- meeting_rooms_company_idx (0052) GIỮ. RLS/policy/GRANT (SELECT, INSERT, UPDATE — không DELETE) GIỮ, verify fail-loud.
```

> `DROP COLUMN is_virtual` không kéo theo CHECK nào (0052 không có CHECK chạm cột này) — vẫn verify sau ALTER rằng `chk_meeting_rooms_capacity` tồn tại (bài học `drop-column-silently-drops-check`).

### 6.2 Bảng `room_bookings` — MỚI, sổ lượt đặt

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` CASCADE, RLS |
| `room_id` | UUID | **Có** | composite FK → `meeting_rooms (company_id, id)` NO ACTION — **NOT NULL** (khác `meetings.meeting_room_id`) |
| `title` | VARCHAR(255) | Có | |
| `description` | TEXT | Không | |
| `starts_at` | TIMESTAMPTZ | Có | |
| `ends_at` | TIMESTAMPTZ | Có | CHECK `> starts_at`; thời lượng 15′–8h kiểm ở service (SPEC-14 ROOM-ERR-002) — DB **không** CHECK thời lượng (hằng nghiệp vụ có thể đổi, tránh drift Zod↔CHECK) |
| `organizer_user_id` | UUID | Có | composite FK → `users (company_id, id)` NO ACTION — người chủ trì |
| `booked_by_user_id` | UUID | Không | composite FK → `users (company_id, id)` **`NO ACTION`** (đính chính 29/08/2026: cột KHÔNG nằm trong allowlist UPDATE — dấu vết đặt hộ là dữ liệu sổ; RI action `SET NULL` chạy ở tầng owner bỏ qua column-grant sẽ ghi đè nó — khuôn `0549` `*_by` sổ) — người thao tác (≠ organizer khi đặt hộ) |
| `status` | VARCHAR(20) | Có | `Confirmed` / `Cancelled`, default `Confirmed` (SPEC-01 §17.10) |
| `cancelled_at` | TIMESTAMPTZ | Không | |
| `cancelled_by` | UUID | Không | composite FK → `users (company_id, id)` `SET NULL (cancelled_by)` |
| `cancel_reason` | TEXT | Không | |
| `created_at` | TIMESTAMPTZ | Có | default now() |
| `updated_at` | TIMESTAMPTZ | Có | default now() |
| `updated_by` | UUID | Không | composite FK → `users (company_id, id)` `SET NULL (updated_by)` |

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- đã có từ 0052 trên DB thật; cần cho lane DB mới

ALTER TABLE room_bookings ADD CONSTRAINT chk_room_bookings_status CHECK (status IN ('Confirmed','Cancelled'));
ALTER TABLE room_bookings ADD CONSTRAINT chk_room_bookings_time_order CHECK (ends_at > starts_at);
-- Cancelled ⇔ cancelled_at NOT NULL (mirror hai chiều ở Zod); huỷ = MỘT câu UPDATE đặt status + cancelled_at cùng lúc
ALTER TABLE room_bookings ADD CONSTRAINT chk_room_bookings_cancel_pair CHECK (
  (status = 'Confirmed' AND cancelled_at IS NULL) OR
  (status = 'Cancelled' AND cancelled_at IS NOT NULL)
);
ALTER TABLE room_bookings ADD CONSTRAINT room_bookings_company_id_id_uq UNIQUE (company_id, id);
ALTER TABLE room_bookings ADD CONSTRAINT room_bookings_room_tenant_fk      FOREIGN KEY (company_id, room_id)           REFERENCES meeting_rooms (company_id, id) ON DELETE NO ACTION;
ALTER TABLE room_bookings ADD CONSTRAINT room_bookings_organizer_tenant_fk FOREIGN KEY (company_id, organizer_user_id) REFERENCES users (company_id, id)        ON DELETE NO ACTION;
-- *_by nullable: composite + SET NULL (col) — có danh sách cột, KHÔNG SET NULL trần (null luôn company_id)
ALTER TABLE room_bookings ADD CONSTRAINT room_bookings_booked_by_tenant_fk    FOREIGN KEY (company_id, booked_by_user_id) REFERENCES users (company_id, id) ON DELETE NO ACTION; -- KHÔNG trong allowlist UPDATE ⇒ NO ACTION
ALTER TABLE room_bookings ADD CONSTRAINT room_bookings_cancelled_by_tenant_fk FOREIGN KEY (company_id, cancelled_by)      REFERENCES users (company_id, id) ON DELETE SET NULL (cancelled_by);
ALTER TABLE room_bookings ADD CONSTRAINT room_bookings_updated_by_tenant_fk   FOREIGN KEY (company_id, updated_by)        REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by);

-- CHỐT CUỐI SPEC-14 §3.1: hai lượt Confirmed trên cùng phòng không giao nhau ([starts_at, ends_at) — kề nhau không tính là giao)
ALTER TABLE room_bookings ADD CONSTRAINT room_bookings_no_overlap_excl
  EXCLUDE USING gist (
    company_id WITH =,
    room_id    WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status = 'Confirmed');

CREATE INDEX idx_room_bookings_company_start ON room_bookings (company_id, starts_at);
CREATE INDEX idx_room_bookings_room_start    ON room_bookings (company_id, room_id, starts_at) WHERE status = 'Confirmed';
CREATE INDEX idx_room_bookings_organizer     ON room_bookings (company_id, organizer_user_id, starts_at DESC);
```

GRANT app role: `SELECT, INSERT` + `UPDATE (status, cancelled_at, cancelled_by, cancel_reason, updated_at, updated_by)`. **Không** `DELETE`. ⚠️ `chk_room_bookings_cancel_pair` buộc "huỷ" là **một câu UPDATE** đặt `status` + `cancelled_at` (+ `cancelled_by`, `cancel_reason`) cùng lúc, `WHERE company_id = $c AND id = $1 AND status = 'Confirmed' AND ends_at > now()` (bất biến #1: `company_id` ở mọi query, dù RLS đã đỡ) — tách câu là nổ CHECK giữa chừng; 0 hàng ⇒ đọc lại để chọn `kind` của ROOM-ERR-005.

> **Vì sao có `company_id WITH =` trong EXCLUDE dù `room_id` đã đủ định danh:** giữ quy ước DB-01 "mọi index dẫn đầu bằng `company_id`" và để GIST phục vụ luôn truy vấn kiểm-trước theo tenant; chi phí không đáng kể ở quy mô ≤ 50 phòng.

### 6.3 Bảng `room_booking_attendees` — MỚI, người tham dự

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | RLS |
| `booking_id` | UUID | Có | composite FK → `room_bookings (company_id, id)` NO ACTION |
| `user_id` | UUID | Có | composite FK → `users (company_id, id)` NO ACTION |
| `created_at` | TIMESTAMPTZ | Có | default now() |

```sql
ALTER TABLE room_booking_attendees ADD CONSTRAINT room_booking_attendees_booking_tenant_fk FOREIGN KEY (company_id, booking_id) REFERENCES room_bookings (company_id, id) ON DELETE NO ACTION;
ALTER TABLE room_booking_attendees ADD CONSTRAINT room_booking_attendees_user_tenant_fk    FOREIGN KEY (company_id, user_id)    REFERENCES users (company_id, id)         ON DELETE NO ACTION;
CREATE UNIQUE INDEX uq_room_booking_attendees_booking_user ON room_booking_attendees (company_id, booking_id, user_id);
CREATE INDEX idx_room_booking_attendees_user ON room_booking_attendees (company_id, user_id, booking_id);
```

GRANT app role: `SELECT, INSERT`. **Không** `UPDATE`, **không** `DELETE` (người tham dự cố định lúc đặt — SPEC-14 §5.2; Phase sau cho sửa lượt mới grant thêm). Organizer **không** chèn vào bảng này.

### 6.4 Bảng DROP — `meetings` · `meeting_attendees` · `meeting_notes` · `meeting_tasks`

Không có cột nào được mang sang (0 hàng). Bảng `meeting_tasks.task_id → tasks` là FK ngoài cụm — DROP TABLE gỡ FK theo, **không** đụng `tasks`. RLS policy rơi theo DROP. `meetings_set_updated_at()` chỉ còn trigger ở `meetings`/`meeting_notes` ⇒ `DROP FUNCTION IF EXISTS` sau khi DROP hai bảng.

---

## 7. Enum chuẩn (đồng bộ `packages/contracts/src/room.ts` — mirror CHECK HAI CHIỀU, ĐÚNG BẰNG)

| Nhóm | Giá trị | CHECK |
| --- | --- | --- |
| booking status (SPEC-01 §17.10) | `Confirmed` · `Cancelled` | `chk_room_bookings_status` |
| booking `isCompleted` (DTO) | boolean dẫn xuất `status = 'Confirmed' AND ends_at ≤ now()` | (chỉ DTO — **không** cột) |
| `status` filter (API) | `Confirmed` · `Cancelled` · `all` | (chỉ Zod) |
| `role` filter `/me/room-bookings` | `organizer` · `attendee` · `all` | (chỉ Zod) |
| `equipment` | mảng chuỗi tự do, 1–40 ký tự/mục, ≤ 20 mục | (chỉ Zod — DB không CHECK) |

---

## 8. Index theo use case

| Use case | Index dùng |
| --- | --- |
| Lịch mọi phòng trong `[from, to)` (`ROOM-API-009`) | `idx_room_bookings_company_start` |
| Lịch một phòng / lịch sử phòng (`ROOM-API-008`) · kiểm-trước trùng lịch | `idx_room_bookings_room_start` (partial `Confirmed`) · `room_bookings_no_overlap_excl` (GIST cũng phục vụ `&&`) |
| «Đặt phòng của tôi» (organizer) (`ROOM-API-013`) | `idx_room_bookings_organizer` |
| «Đặt phòng của tôi» (attendee) | `idx_room_booking_attendees_user` → JOIN `room_bookings` |
| Phòng trống (`ROOM-API-003`) | `idx_meeting_rooms_company_active` + `NOT EXISTS` qua `idx_room_bookings_room_start` |
| Job nhắc 15′ | `idx_room_bookings_company_start` (cửa sổ `(now, now+15′]`, lọc `status`) |
| Thống kê sử dụng (`ROOM-API-004`) | `idx_room_bookings_room_start` (`GROUP BY room_id`, `SUM(ends_at - starts_at)`) |
| Tên phòng trùng | `uq_meeting_rooms_company_name_active` |

> Cô lập tenant ép ở RLS + FORCE; mọi index dẫn đầu bằng `company_id`. «Của tôi» = `organizer_user_id = $u OR EXISTS (attendees…)` — dùng **EXISTS**, không JOIN attendees vào danh sách (một người vừa là organizer vừa… không thể, nhưng JOIN attendees vẫn nhân bản theo số người tham dự — `partial-unique-index-makes-join-duplicate`).

---

## 9. Seed & kế hoạch migration (`0552+` dự kiến, lane DB nối tiếp — chạy SAU `S11-ASSET-DB-1`)

| Bước | Nội dung | Ràng buộc thứ tự |
| --- | --- | --- |
| **A** (`0552`) — **expand** | `CREATE EXTENSION IF NOT EXISTS btree_gist` · ALTER `meeting_rooms` §6.1 (tiền kiểm `capacity IS NULL` = 0 và `is_virtual = true` = 0, khác ⇒ `RAISE EXCEPTION`) · CREATE `room_bookings` + `room_booking_attendees` (§6.2–6.3: `company_id … ON DELETE CASCADE`, composite FK `NO ACTION`, CHECK, EXCLUDE, index) · **ENABLE/FORCE RLS + policy literal-GUC** cho 2 bảng mới · GRANT: `room_bookings` = `SELECT, INSERT` + UPDATE **cấp cột** §6.2; `room_booking_attendees` = `SELECT, INSERT`; **`mediaos_worker` = `SELECT` trên cả 3 bảng** (job nhắc lịch đọc qua `dbw`; bổ sung 29/08/2026 — job vẫn phải quét trong `withTenant` từng company vì policy chỉ theo GUC) (**không** phát `GRANT UPDATE ON <table>` rồi grant cột; `REVOKE` cấp bảng về sau **xoá sạch** column-grant — `revoke-table-grant-wipes-column-grants`) · **VERIFY fail-loud** (khuôn `0506` bước 6): 3 bảng `relrowsecurity AND relforcerowsecurity` + có policy; app role 0 DELETE trên cả 3, 0 UPDATE trên attendees, tập cột UPDATE trên `room_bookings` **đúng bằng** allowlist; `chk_meeting_rooms_capacity` tồn tại sau DROP COLUMN · **cùng commit**: `schema/meeting.ts` → `schema/rooms.ts` (3 bảng, parity cột; RLS/grant/EXCLUDE/partial-index chỉ ở SQL) + `schema/index.ts`; `rls-registry.ts` thêm `room_bookings`/`room_booking_attendees` (seedRow: phòng + user + lượt); `cleanupTenants()` thêm `room_booking_attendees` → `room_bookings` **trước dòng `DELETE FROM users`** | RLS TRƯỚC mọi INSERT (bất biến #1); `fk-tenant-census` không được đỏ và sàn `FK_SINGLE_COL_PAIRS_FLOOR = 423` **không hạ** (mọi FK mới composite, §4.2); **`migration-no-drop` gate quét cả `DROP COLUMN`** (`scripts/check-migration-no-drop.sh` — regex `DROP TABLE\|DROP COLUMN\|TRUNCATE\|DROP SCHEMA`) ⇒ file `0552` **phải** mang dòng `-- DESTRUCTIVE-APPROVED: <lý do> (<người duyệt>)` viện dẫn ROOM-DEC-001 (owner ký 28/08/2026); `DROP INDEX` ngoài phạm vi quét |
| **B** (`0553`) — **contract** | **Tiền kiểm fail-loud**: `SELECT count(*)` trên `meetings` · `meeting_attendees` · `meeting_notes` · `meeting_tasks` — bất kỳ bảng nào > 0 ⇒ `RAISE EXCEPTION '[0553] meeting_* còn hàng — DỪNG, người quyết'` (đo 29/08/2026 = 0/0/0/0; **không** tự migrate dữ liệu) · `DROP TABLE IF EXISTS meeting_tasks, meeting_notes, meeting_attendees, meetings` (con→cha; `meeting_tasks.task_id → tasks` là FK ngoài cụm, rơi theo) · `DROP FUNCTION IF EXISTS meetings_set_updated_at()` · **quyền di sản**: `DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE resource_type IN ('meeting','meeting_room'))` (đo = 12 hàng — log số thật) → `DELETE FROM object_permissions …` (0) → **`DELETE FROM permissions WHERE resource_type IN ('meeting','meeting_room')`** (6 hàng — **hard-delete**, `permissions` KHÔNG có cột `deleted_at` (`0005`); đính chính 29/08/2026, khuôn `0548:109-121`); tiền kiểm `grep -rn "'meeting'\|'meeting_room'" apps/api/src` = 0 guard (đo 29/08 = 0) · **cùng commit**: `rls-registry.ts` **gỡ 4 entry** `meetings` · `meeting_attendees` · `meeting_notes` · `meeting_tasks` (**giữ** `meeting_rooms`; hai entry sau còn `INSERT INTO meetings` trong `seedRow` — để lại là `42P01`, `rls-tenant-isolation-tester` đỏ) · **gỡ khối MEETINGS + 2 dòng đếm khỏi `apps/api/demo-seed-full.mjs`** (`:877-921`, `:950-951` — nằm trong transaction trước `COMMIT`, không gỡ là demo-seed ROLLBACK toàn bộ; script được `mediaos.ps1`/`scripts/dev.sh` gọi) · `AUDIT_OBJECT_TYPES` (TS) gỡ `meeting`/`meeting_note` — CHECK DB **giữ nguyên** (union chỉ tăng, bất biến #2); an toàn vì assert parity là **một chiều `CHECK ⊇ TS`** + canary DB-only (`goal-db2-templates.int-spec.ts`) — **không** "dọn" CHECK | Khuôn `0548` (S10-CLEAN-WORKFLOWCLUSTER-2): file `0553` mang `-- DESTRUCTIVE-APPROVED: ROOM-DEC-001 DROP 4 bảng meeting_* (owner ký 28/08/2026)` cho `migration-no-drop`; contract trong **cùng WO** với expand là hợp lệ vì **0 code sống** ép cặp/đọc bảng (điều kiện của `migration-expand-contract-required` — cửa sổ 403 chỉ có khi guard đang chạy) |
| **C** (`0554`) — **seed** | `modules.ROOM`: chỉ **verify tồn tại + GIỮ `is_active=false`** (đính chính 29/08/2026 — không UPDATE; bật ở `S11-ROOM-FE-1` cùng lúc gỡ `ROOM` khỏi pin `migration-smoke` `EXTENSION_INACTIVE_MODULES`) · seed role hệ thống **`office-admin`** (`company_id NULL`, `is_system=true`, **`requires_two_factor=false` tường minh**, id cố định mới, `ON CONFLICT DO NOTHING` — tiền lệ `0019` `hr-manager`, DB-15 `asset-manager`) · **5 cặp** permission SPEC-14 §11 `is_sensitive=false` `ON CONFLICT (action, resource_type) DO NOTHING` · grant per-(role, pair) theo **§9e** (resolve role theo `name + company_id IS NULL + deleted_at IS NULL`, DELETE-wrong-scope + INSERT ON CONFLICT, verify fail-loud đếm đúng **22** hàng — mirror `0506`) · **UNION-ADD** `room_booking` vào CHECK `audit_logs.object_type` — **clone nguyên khối `0550` bước (5) (= `0545`, neo 2 tầng `object_type = ANY(…)`, fail-closed, NO-LOSS/NO-GAIN — KHÔNG clone `0506` bước 4, bản chưa neo tầng-1; đính chính 29/08/2026 từ plan-review S11-ASSET-DB-1)**, verify regex biên `~ '[,{'']room_booking['',}]'` **và** `~ '[,{'']meeting_room['',}]'` (nếu thiếu `meeting_room` thì thêm luôn trong cùng UNION) — KHÔNG tự viết parser mới (`audit-check-union-parse-anchor-trap`) + `AUDIT_OBJECT_TYPES` thêm `room_booking` · seed NOTI: 3 event `ROOM_BOOKING_CONFIRMED` · `ROOM_BOOKING_CANCELLED` · `ROOM_BOOKING_REMINDER` vào `notification-event-catalog.const.ts` (`module:'ROOM'`, `type:'Room'`, `isEnabled:true`, `isSystemEvent` false/false/**true**, priority Normal/High/High) + `NotiModuleCode`/`NotiType` unions + `notification_events` với **`dedupe_strategy = 'DedupeKey'`, `dedupe_window_seconds = NULL`** (mặc định `'None'` biến `dedupeKey` thành chuỗi trang trí — job nhắc phát lại mỗi nhịp; `0538:707`) · INSERT dùng đúng `ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING` (bare ON CONFLICT nổ `42P10` — `0538:721`) · template 3 event · **nới CHECK trên CẢ HAI bảng**: `notification_events` (`module_code += 'ROOM'`, `notification_type += 'Room'`) **VÀ** `notifications` (cùng hai CHECK, **giữ nhánh `IS NULL OR`**) — guard LIKE + re-stamp superset tường minh (`0507`/`0529`/`0538`), superset **đo lại lúc chạy** (ASSET vừa thêm `ASSET`/`Asset` ở `0551`) | PHẢI xong TRƯỚC khi `S11-ROOM-BE-1` đăng ký registrar outbox (`registerSource()` fail-loud lúc boot). Quên vế `notifications` = lỗi đã ship `0507`. `office-admin` **không** vào danh sách canonical (`DashCanonicalRole`/`NOTI_CANONICAL_ROLES`/pin `auth-seed-canonical-roles` giữ 4 role) |

Giá trị superset dự kiến để re-stamp (đo tại `0538` + ASSET `0551`, **xác minh lại lúc chạy**):

```text
module_code       : 'AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT','ASSET'  (+ 'ROOM')
notification_type : … 'Goal','Training','Chat','Asset' …                                                (+ 'Room')
```

Ma trận grant §9e (bước C) — **22 hàng**: `employee` 4 · `manager` 4 · `hr` 4 (`access`@Own · `view`@Company · `book`@Own · `cancel`@Own) · `company-admin` 5 · `office-admin` 5 (`access`@Own, 4 cặp còn lại @Company). Sai một hàng verify phải ĐỎ.

Số migration là **dự kiến** — nối tiếp head THẬT tại thời điểm chạy WO (sau ASSET).

---

## 10. Đối chiếu bất biến

| Bất biến | Áp dụng trong DB-16 |
| --- | --- |
| #1 `company_id` + RLS FORCE | cả 3 bảng (`meeting_rooms` policy `0052` giữ + verify; 2 bảng mới policy trước INSERT), composite tenant FK mọi FK chéo, `withTenant` ở repo; data scope Own/Company ép ở service |
| #2 append-only / soft delete | `room_bookings` **không DELETE**, UPDATE cấp cột huỷ; `room_booking_attendees` chỉ INSERT; `meeting_rooms` soft delete (không DELETE); CHECK `audit_logs.object_type` chỉ **tăng** (giữ `meeting`/`meeting_note` dù bảng đã DROP); DROP 4 bảng di sản chỉ khi **0 hàng** (tiền kiểm fail-loud) |
| #3 không secret | module không lưu secret; DTO không mang email/số điện thoại của user; payload NOTI/audit chỉ tiêu đề · phòng · khung giờ · tên |

---

## 11. Rủi ro dữ liệu đã nhận diện

| Rủi ro | Vì sao nguy hiểm | Chốt chặn |
| --- | --- | --- |
| Hai request đặt song song cùng khung lọt qua kiểm-trước | hai lượt `Confirmed` chồng nhau — phòng bị tranh | `room_bookings_no_overlap_excl` (EXCLUDE gist); int-spec 2 request song song; map `23P01` từ `cause` → 409 ROOM-ERR-001 |
| EXCLUDE tính cả lượt `Cancelled` | huỷ rồi không ai đặt lại được khung đó | predicate `WHERE status = 'Confirmed'` — test "lượt Cancelled không chặn" |
| `[starts_at, ends_at]` đóng hai đầu | 10:00–11:00 và 11:00–12:00 bị coi là trùng | `'[)'` nửa-mở; test kề nhau OK |
| `cleanupTenants` xoá `users` trước `room_bookings` | FK `NO ACTION` nổ ⇒ đỏ hàng loạt `afterAll` | §4.2: 2 bảng vào `cleanupTenants` **trước** `DELETE FROM users`, cùng commit |
| Composite FK `RESTRICT` / `SET NULL` trần | nổ khi cascade từ `companies` / SET NULL xoá luôn `company_id` | `NO ACTION` mọi FK nội bộ; `*_by` nullable vẫn là **composite** `SET NULL (col)` khi cột nằm trong allowlist UPDATE, `NO ACTION` khi không (§4.2/§6.2 — KHÔNG FK đơn cột) |
| DROP `meetings` khi có hàng thật xuất hiện sau ngày đo | mất dữ liệu thật trong im lặng | tiền kiểm 0 hàng `RAISE EXCEPTION`; không auto-migrate |
| Xoá grant cặp `meeting*` khi còn guard sống | cửa sổ 403 giữa migrate và restart (`migration-expand-contract-required`) | tiền kiểm grep = 0 (đo 29/08 = 0; module hub G10 đã gỡ ở de-media-fy); nếu > 0 ⇒ tách contract sang WO sau |
| `dedupe_strategy` để `'None'` | job nhắc phát lại mỗi nhịp (60s) trong 15′ | §9C: `'DedupeKey'` ngay trong seed đầu |
| `modules.ROOM` bật `is_active` quá sớm | module hiện trên app switcher khi chưa có endpoint (`ui-promises-backend-never-reads`) | §9C GIỮ false; `S11-ROOM-FE-1` bật + gỡ pin smoke cùng commit |
| Quên nới CHECK `notifications` | mọi notification ROOM vỡ khi INSERT | bước C làm cả hai bảng trong cùng migration, verify fail-loud |
| Thêm `office-admin` vào enumerate canonical | pin `auth-seed-canonical-roles` + `DashCanonicalRole` đỏ / grant lạc | §9C ghi rõ **không** canonical |
| `meeting_rooms.name` trùng khác hoa/thường | hai phòng «Mercury»/«mercury» | unique trên `lower(name)` partial còn sống |
| Vô hiệu/xoá phòng còn lịch tương lai | lịch mồ côi, người tham dự không biết | service ROOM-ERR-008 (đếm `Confirmed` với `ends_at > now()`); DROP không thể xảy ra vì không có DELETE grant |
