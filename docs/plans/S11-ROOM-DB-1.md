# Micro-plan — `S11-ROOM-DB-1` (🔴 red · crown · FULL gate · lane migration NỐI TIẾP, SAU ASSET-DB-1)

> **WO:** Schema + migration ROOM theo DB-16 + ROOM-DEC-001: **ALTER** `meeting_rooms` (gỡ `is_virtual`) · **tạo** `room_bookings` + `room_booking_attendees` (EXCLUDE gist) · **DROP** 4 bảng `meeting_*` (tiền kiểm 0 hàng) + dọn 6 cặp quyền di sản · seed role `office-admin` / 5 cặp / 22 grant / audit / NOTI (CHECK cả hai bảng).
> **Nguồn sự thật:** [DB-16 §3.0 · §4 · §6 · §7 · §9](<../DB/DB-16 ROOM Database Design.md>) · [SPEC-14 §11 · §16 · §17 · §18](<../SPEC/SPEC-14 ROOM.md>) · [ma trận §9e](<../permission-matrix-spec.md>) · khuôn thi công = [S11-ASSET-DB-1](S11-ASSET-DB-1.md) (`0549`–`0551`) + DROP = `0548`.
> **Nhánh:** `wo/s11-room-db-1` → PR vào `master`. Vùng 🔴 ⇒ **người chốt merge**, KHÔNG nhãn auto-merge.
> **Lane DB:** `bash scripts/lane-db-setup.sh roomdb1` → `export LANE_DB=mediaos_roomdb1`. Đối chứng hạ sàn ratchet: lane **`mediaos_roombase551`** (head 0551, KHÔNG có 0552+).
> **Rev 1** (29/08/2026) — plan-review **1 vòng hẹp** rồi vá là dừng (`red-zone-wo-cost-profile` · `plan-review-rounds-inject-new-holes`).

---

## 0. Hiện trạng ĐO THẬT (29/08/2026 — `logs/measure-meeting-legacy.mjs` + `logs/measure-room-extra.mjs`, chỉ SELECT trên DB `mediaos`; lane đo lại trước khi chạy)

| Thứ | Giá trị đo được | Hệ quả |
| --- | --- | --- |
| Head migration | **idx 218 · `0551_s11assetdb1_noti_asset` · when `1717587340000`** | WO này = **`0552`** (idx 219, when …341000) · **`0553`** (220, …342000) · **`0554`** (221, …343000) · **`0555`** (222, …344000) |
| 5 bảng `meeting_*` | **0 / 0 / 0 / 0 / 0 hàng** | DROP/ALTER không migrate dữ liệu; tiền kiểm fail-loud |
| `meeting_rooms` thật | cột `id·company_id·name(text)·location·capacity(int?)·is_virtual·metadata·created_by·created_at·deleted_at`; **0 CHECK**; index `meeting_rooms_company_idx` · `meeting_rooms_active_idx` · `meeting_rooms_company_id_id_uq`; policy **`meeting_rooms_tenant` chỉ USING, `polwithcheck` NULL** (PG dùng USING làm check ngầm — `rls-coverage-assert` (b) đã chấp nhận); FK `created_by` có CẢ `meeting_rooms_created_by_fkey` (1 cột, 0052) lẫn `meeting_rooms_created_by_company_fk` (composite `SET NULL (created_by)`, 0535); GRANT app `INSERT,SELECT,UPDATE`, **worker 0** | giữ policy/FK/GRANT app; verify chấp nhận `polwithcheck IS NULL`; **thêm** `GRANT SELECT … TO mediaos_worker` (job nhắc lịch đọc qua `dbw` — §1) |
| 6 cặp `('view'\|'create'\|'update'\|'cancel','meeting')` · `('view'\|'manage','meeting_room')` | 12 `role_permissions` — **cả 12 thuộc 2 role TENANT** («QUẢN LÝ CẤP CAO», «SA»), 0 role hệ thống; **0 `object_permissions`**; 0 guard trong `src/` | xoá 12 grant + 6 cặp không có cửa sổ 403 |
| **`permissions` KHÔNG có `deleted_at`** (`0005:56-62`: `id·action·resource_type·is_sensitive`) | DB-16 §9B "UPDATE permissions SET deleted_at" **không chạy được** | bước B = **hard-DELETE** `role_permissions` → `object_permissions` → `permissions` (khuôn `0548:109-121`); đính chính DB-16/SPEC-14/§9e |
| FK trên 4 bảng DROP | **8 cặp FK một-cột tenant→tenant** rơi theo (`meetings.meeting_room_id/organizer_id` · `meeting_attendees.meeting_id/user_id` · `meeting_notes.meeting_id/author_user_id` · `meeting_tasks.meeting_id/task_id`) + 8 composite 0535 | census `xtenant-fk-ratchet` giảm 8 ⇒ **sàn `FK_SINGLE_COL_PAIRS_FLOOR` 423 → dự kiến 415**, hạ có ĐỐI CHỨNG hai lane (khuôn 0548, `fk-tenant-verdicts.ts:69-84`). DB-16 §4.2 "sàn không hạ" **sai** — đính chính |
| Trigger/hàm | `meetings_updated_at_trg` + `meeting_notes_updated_at_trg` → `meetings_set_updated_at()` (2 hộ); 0 view phụ thuộc | `DROP FUNCTION IF EXISTS` sau DROP TABLE |
| `audit_logs_object_type_chk` | 107 giá trị, ĐÃ có `meeting` · `meeting_room` · `meeting_note`; chưa có `room_booking` | UNION-ADD `room_booking` (clone `0550` bước 5 = `0545`); TS gỡ `meeting`/`meeting_note`, CHECK giữ |
| CHECK NOTI (DB `mediaos` chưa áp 0551) | `…'CHAT'` / `…'Chat'`; lane sau 0551 = `+ASSET/+Asset` | 0555 baseline guard đòi **có** `ASSET`/`Asset` (chuỗi sau 0551), re-stamp superset `+ROOM/+Room` ×4 |
| `modules.ROOM` | tồn tại từ `0435:298`, `is_active=false`; pin `migration-smoke.int-spec.ts:90-97` `EXTENSION_INACTIVE_MODULES` **gồm `ROOM`** | **GIỮ inactive** (tiền lệ ASSET `0550` D1) — bàn giao máy-đọc-được cho `S11-ROOM-FE-1` |
| Role hệ thống | `…0001` … `…0011` hr · `…0012` asset-manager · `…00f0` platform-admin — **`…0013` trống** | `office-admin` = `00000000-0000-0000-0000-000000000013` |
| Pin NOTI | `NOTI_EVENT_COUNT` 64 · enabled 50 (`noti-seed-catalog-permissions.int-spec.ts:94-96`) · template global 50 (`s5-noti-fix1-deeplink.int-spec.ts:167-168`) | bump **67 / 53 / 53** |
| Code còn chạm `meeting_*` | `schema/meeting.ts` · `schema/index.ts:44-45` · `AUDIT_OBJECT_TYPES` · `rls-registry.ts:1916-2015` (5 entry) · `demo-seed-full.mjs:876-921 + 950-951` · **`packages/contracts/src/meeting.ts` + `index.ts:127`** (DTO park, **0 consumer** — census DB-16 §3.0 chỉ quét `apps/api` nên sót) | dọn cùng WO (§1) |
| `btree_gist` | 1.7 đã cài | vẫn `CREATE EXTENSION IF NOT EXISTS` |
| `meeting_rooms_active_idx` (0052) | định nghĩa thật: `CREATE INDEX … ON meeting_rooms (company_id) WHERE deleted_at IS NULL` — **không** chạm `is_virtual` (plan-reviewer M7) | `DROP INDEX IF EXISTS` là DROP thật, không phải no-op sau DROP COLUMN; thay bằng `idx_meeting_rooms_company_active` |
| Sàn `tenant-isolation` (đo A/B) | đối chứng `roombase551`: **412 cặp thử · W4 241 · PROVEN 139/148**; lane `roomdb1` sau 0555: **404 · W4 232 · PROVEN 137/146** | −8 cặp thử = 8 FK một-cột rơi theo DROP; W4 **−9** = 8 rơi + **1 đổi nhóm**: `meeting_rooms.created_by → users` giờ bị `23505/uq_meeting_rooms_company_name_active` (W4 chèn BẢN SAO hàng seed cùng tên phòng — unique `lower(name)` mới nổ trước FK), cùng lớp `teams_company_name_active_uq` ⇒ hạ W4 241 → **232**; PROVEN 137 ≥ 133 giữ sàn |
| Postgres | Docker `mediaos-postgres` healthy | lane dựng được |

---

## 1. Quyết định chốt / điểm LỆCH DB-16 có chủ đích (đính chính doc trong cùng PR)

- **D1 `modules.ROOM` giữ `is_active=false`** (DB-16 §3.0/§9C + SPEC-14 §16 + DB-10:636 ghi "UPDATE true") — pin smoke `EXTENSION_INACTIVE_MODULES` gồm `ROOM`; bật khi chưa có endpoint = `ui-promises-backend-never-reads`. 0554 chỉ verify hàng tồn tại + inactive. `S11-ROOM-FE-1` `done_when` += "UPDATE `is_active=true` tường minh + gỡ `ROOM` khỏi pin smoke CÙNG commit".
- **D2 Quyền di sản: hard-DELETE** (không có cột `deleted_at`): `DELETE FROM role_permissions` → `object_permissions` → `permissions WHERE resource_type IN ('meeting','meeting_room')` — mirror `0548`. Log số thật (12/0/6). `auth-seed-canonical-roles` §F chỉ đo `foundation-%`/`channel`/`project`/`content`/`platform-account` — không chạm.
- **D3 Hạ sàn có ĐỐI CHỨNG hai lane — BA con số, không chỉ một** (plan-reviewer B1): DROP 4 bảng + gỡ 4 entry registry làm tụt (1) `FK_SINGLE_COL_PAIRS_FLOOR` (`fk-tenant-verdicts.ts:87`, census một-cột) − 8 cặp; (2) `W4_FK_BLOCKED_FLOOR` (`tenant-isolation.int-spec.ts:270`, cặp census có src+tgt trong registry được composite FK chứng minh) − 8 cặp (cả 8 đều có src/tgt trong registry và được 0535 phủ); (3) `PROVEN_WITH_CHECK_FLOOR` (`:223`, số bảng registry chứng minh WITH CHECK ở W3) − 4 + 2 bảng mới. **Đo trên lane đối chứng `mediaos_roombase551` (head 0551) TRƯỚC khi migrate:** FK **423** · W4 **241** · PROVEN **139/148** (29/08/2026). Kỳ vọng sau 0555 trên `mediaos_roomdb1`: FK **415** · W4 **233** · PROVEN **137** (≥ sàn 133 — đệm 6 do ASSET +6 bảng ⇒ KHÔNG hạ sàn này). Hạ (1) và (2) ĐÚNG số đo, 0 biên, lý do văn bản tại chỗ (khuôn 0548 — mỗi chênh lệch giải thích được từng cặp). Composite FK mới (10) không tính vào census một-cột.
- **D4 `GRANT SELECT` cho `mediaos_worker`** trên `meeting_rooms` · `room_bookings` · `room_booking_attendees` (DB-16 không nêu): job `ROOM_BOOKING_REMINDER` (SPEC-14 §13.5) chạy `@SystemJobHandler` qua `dbw` = worker pool (tiền lệ ASSET `0549` worker SELECT ×6). Verify worker đúng `{SELECT}`, 0 column-ACL.
- **D5 Policy `meeting_rooms_tenant` giữ nguyên (USING-only)** — không DROP/CREATE lại (đổi policy đang chạy trên PROD không thuộc WO nền dữ liệu; `rls-coverage-assert` (b) chấp nhận USING làm check ngầm). Verify: `polqual` chứa GUC **và** (`polwithcheck IS NULL OR` chứa GUC).
- **D6 `meeting_rooms.created_by`**: giữ cả FK một cột (0052) lẫn composite (0535) — census coi là "covered"; verify (3b) kỳ vọng **đúng 1** FK một-cột ngoài `companies` trên `meeting_rooms` (tên `meeting_rooms_created_by_fkey`), **0** trên 2 bảng mới.
- **D7 Dọn `packages/contracts/src/meeting.ts`** (+ dòng `export * from "./meeting"` ở barrel): DTO park cho bảng bị DROP, 0 consumer (grep `apps/*/src packages/*/src`), chứa `meetingRoomSchema` với `isVirtual` (cột đã gỡ) — để lại là drift + chiếm tên. Ghi rõ trong PR (`review-gate-blind-to-deletions`). Kiểm `packages/contracts/src/index.spec.ts` không pin export meeting.
- **D8 `AUDIT_OBJECT_TYPES`** gỡ `meeting`/`meeting_note`, thêm `room_booking`, giữ `meeting_room`; CHECK DB chỉ TĂNG (bất biến #2).
- **D9 `*_by` nullable trên `room_bookings`** (sổ) — chia theo allowlist (plan-reviewer B2 sửa tiền đề sai của Rev 1): `cancelled_by`/`updated_by` **nằm trong** allowlist UPDATE (§2.2) ⇒ `SET NULL (col)` theo DB-16 §6.2 (RI action không ghi đè cột cố ý không grant). **`booked_by_user_id` KHÔNG nằm trong allowlist** (dấu vết đặt hộ — bất biến #2) ⇒ **`NO ACTION`** (khuôn 0549 `*_by` sổ: RI action chạy ở tầng owner, bỏ qua column-grant). `organizer_user_id` NOT NULL ⇒ NO ACTION. `room_booking_attendees.user_id` NO ACTION (sổ không UPDATE). Đính chính DB-16 §6.2 (`booked_by`) + **§11 dòng "`*_by` nullable dùng FK đơn cột SET NULL"** (mâu thuẫn §4.2 — plan-reviewer M4).
- ❌ Không `db:generate` (SQL viết tay, `schema/rooms.ts` PARITY). ❌ Không seed dữ liệu phòng. ❌ Không thêm `office-admin` vào `DashCanonicalRole`/`NOTI_CANONICAL_ROLES`/`NotiRoleSlug`/pin canonical; không grant `(read,dashboard)`/cặp ME — role cộng thêm (như `asset-manager`). ❌ Không entry `notification-dedupe.const.ts`. ❌ Không code NestJS/route/`API_MODULE_TAGS` (BE-1). ❌ Không sửa `PERMISSION_CODE_TO_PAIR` FE (FE-1). ❌ Contracts chỉ enum/hằng (`room.ts`), không DTO. ❌ Không `RESTRICT`; không `SET NULL` trần trên FK composite. ❌ Không CHECK thời lượng 15′–8h ở DB (DB-16 §6.2).

---

## 2. Migration `0552` — EXPAND (DB-16 §9 bước A) — mang dòng `-- DESTRUCTIVE-APPROVED: ROOM-DEC-001 gỡ cột is_virtual ngoài phạm vi SPEC-14, 0 hàng đo 29/08/2026 (owner ký 28/08/2026)`

Thứ tự: **(0) tiền kiểm** → **(1) ALTER `meeting_rooms`** → **(2) `room_bookings`** → **(3) `room_booking_attendees`** → **(4) VERIFY** → `-- Down`.

### 2.0 Tiền kiểm (DO-block, `RAISE EXCEPTION`, `set_config('lock_timeout','5s',true)`)
- `server_version_num >= 150000`; `CREATE EXTENSION IF NOT EXISTS btree_gist` (câu riêng, trước DO).
- `meeting_rooms` tồn tại; UNIQUE `(company_id,id)` trên `users` **và** `meeting_rooms` (đếm = 1, không tự tạo); `room_bookings`/`room_booking_attendees` chưa tồn tại.
- `count(*) FROM meeting_rooms WHERE capacity IS NULL` = 0; nếu cột `is_virtual` còn: `count(*) WHERE is_virtual` = 0 — khác ⇒ THROW "DỪNG, người quyết".

### 2.1 ALTER `meeting_rooms` (DB-16 §6.1, idempotent)
`ADD COLUMN IF NOT EXISTS` ×8 (`equipment text[] NOT NULL DEFAULT '{}'` · `description text` · `requires_approval boolean NOT NULL DEFAULT false` · `is_active boolean NOT NULL DEFAULT true` · `sort_order integer NOT NULL DEFAULT 0` · `updated_at timestamptz NOT NULL DEFAULT now()` · `updated_by uuid` · `deleted_by uuid`) → 2 composite FK `meeting_rooms_updated_by_tenant_fk` / `meeting_rooms_deleted_by_tenant_fk` → `users (company_id,id) ON DELETE SET NULL (col)` (guard `IF NOT EXISTS` theo `conname`) → `ALTER COLUMN capacity SET NOT NULL` → `DROP COLUMN IF EXISTS is_virtual` → `ADD CONSTRAINT chk_meeting_rooms_capacity CHECK (capacity > 0)` (guard) → `CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_rooms_company_name_active ON (company_id, lower(name)) WHERE deleted_at IS NULL` → `DROP INDEX IF EXISTS meeting_rooms_active_idx` → `CREATE INDEX IF NOT EXISTS idx_meeting_rooms_company_active (company_id, is_active, sort_order) WHERE deleted_at IS NULL` → `GRANT SELECT ON meeting_rooms TO mediaos_worker` (D4). Giữ `meeting_rooms_company_idx`, policy, GRANT app.

### 2.2 `room_bookings` (DB-16 §6.2) · `room_booking_attendees` (§6.3)
Cột **đúng DB-16**, `company_id NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid REFERENCES companies(id) ON DELETE CASCADE`; CHECK inline `chk_room_bookings_status IN ('Confirmed','Cancelled')` · `chk_room_bookings_time_order (ends_at > starts_at)` · `chk_room_bookings_cancel_pair` nguyên văn; `room_bookings_company_id_id_uq UNIQUE (company_id,id)`. RLS ENABLE + FORCE + `DROP/CREATE POLICY tenant_isolation` (USING + WITH CHECK literal-GUC, nguyên văn `0549`) **trước** FK/index. Composite FK (tên theo DB-16): `room_bookings_room_tenant_fk` (a) · `_organizer_tenant_fk` (a) · `_booked_by_tenant_fk` (**a** — D9) · `_cancelled_by_tenant_fk` (n `SET NULL (cancelled_by)`) · `_updated_by_tenant_fk` (n); `room_booking_attendees_booking_tenant_fk` (a) · `_user_tenant_fk` (a). EXCLUDE `room_bookings_no_overlap_excl USING gist (company_id WITH =, room_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status = 'Confirmed')`. Index: `idx_room_bookings_company_start (company_id, starts_at)` · `idx_room_bookings_room_start (company_id, room_id, starts_at) WHERE status = 'Confirmed'` · `idx_room_bookings_organizer (company_id, organizer_user_id, starts_at DESC)` · `uq_room_booking_attendees_booking_user (company_id, booking_id, user_id)` UNIQUE · `idx_room_booking_attendees_user (company_id, user_id, booking_id)`.

**GRANT (bất biến #2):** `room_bookings`: app `SELECT, INSERT` + `UPDATE (status, cancelled_at, cancelled_by, cancel_reason, updated_at, updated_by)` cấp cột — **không** `GRANT UPDATE ON` cấp bảng, **không** DELETE; worker `SELECT`. `room_booking_attendees`: app `SELECT, INSERT` (0 UPDATE/DELETE); worker `SELECT`.

### 2.3 VERIFY fail-loud (một DO-block, vế DƯƠNG đúng-bằng)
1. RLS 3 bảng `relrowsecurity AND relforcerowsecurity`; policy 2 bảng mới `tenant_isolation` USING+WITH CHECK chứa GUC; `meeting_rooms_tenant` USING chứa GUC và (`polwithcheck IS NULL OR` chứa GUC) (D5).
2. ACL `aclexplode`: app `meeting_rooms` = `{INSERT,SELECT,UPDATE}` **và column-ACL UPDATE = RỖNG** (bảng mutable — plan-reviewer M6) · `room_bookings` = `{INSERT,SELECT}` + column-UPDATE **đúng bằng** 6 cột §2.2 · `room_booking_attendees` = `{INSERT,SELECT}`, 0 column-ACL; app 0 column-ACL ngoài UPDATE trên cả 3; worker `{SELECT}` ×3, 0 column-ACL.
3. Composite FK DƯƠNG đúng-bằng **10 dòng** `(tbl,col,tgt,del,setcols)`: `meeting_rooms` created_by/updated_by/deleted_by → users n `{col}` · `room_bookings` room_id → meeting_rooms a · organizer_user_id → users a · booked_by_user_id/cancelled_by/updated_by → users n `{col}` · `room_booking_attendees` booking_id → room_bookings a · user_id → users a. (3a') FK ≥2 cột trên 3 bảng = 10. (3b) FK một-cột ngoài `companies`: `meeting_rooms` = **1** (`meeting_rooms_created_by_fkey`), 2 bảng mới = 0.
4. UNIQUE `(company_id,id)` trên `meeting_rooms` + `room_bookings`.
5. Cột: `meeting_rooms.is_virtual` không còn (`pg_attribute` `attisdropped` không tính); `capacity` `attnotnull`; 8 cột mới có mặt; `chk_meeting_rooms_capacity` tồn tại sau DROP COLUMN (`drop-column-silently-drops-check`); 3 CHECK `room_bookings` tồn tại.
6. Index `pg_get_expr(indpred)` đúng chuỗi: `uq_meeting_rooms_company_name_active` = `(deleted_at IS NULL)` · `uq_room_booking_attendees_booking_user` NULL · `idx_room_bookings_room_start` = `((status)::text = 'Confirmed'::text)`; EXCLUDE `room_bookings_no_overlap_excl` `contype='x'`, def chứa `gist` và `'Confirmed'`; `idx_meeting_rooms_company_active` + 2 index thường tồn tại; `meeting_rooms_active_idx` KHÔNG còn. Chuỗi kỳ vọng chép từ lane (comment).

### 2.4 Cùng commit với `0552`
- `schema/meeting.ts` **xoá** → `schema/rooms.ts` (`meetingRooms` sau ALTER · `roomBookings` · `roomBookingAttendees`, parity cột; `.references()` một cột chỉ để suy kiểu); `schema/index.ts:44-45` → `export * from "./rooms"` (khối additive, comment ROOM).
- `test/helpers/seed.ts` `cleanupTenants()`: `room_booking_attendees` → `room_bookings` ngay SAU khối ASSET (trước `chat_call_participants`, trước `DELETE FROM users`).
- `rls-registry.ts`: sửa seedRow `meeting_rooms` (thêm `capacity`); **gỡ 4 entry** `meetings`/`meeting_attendees`/`meeting_notes`/`meeting_tasks`; thêm `room_bookings` + `room_booking_attendees` — **mỗi seedRow lượt tạo PHÒNG RIÊNG + `ends_at = starts_at + 1h`** (plan-reviewer M5: random điểm bắt đầu trên phòng dùng chung là an-toàn-giả; phòng riêng ⇒ EXCLUDE không bao giờ đụng giữa hai lần seed/tenant). Không `skipNoContext`.

---

## 3. Migration `0553` — CONTRACT (DB-16 §9 bước B) — mang dòng `-- DESTRUCTIVE-APPROVED: ROOM-DEC-001 DROP 4 bảng meeting_* — 0 hàng đo 29/08/2026, 0 code sống (owner ký 28/08/2026)`

1. Tiền kiểm DO-block: với mỗi bảng trong 4 còn tồn tại (`to_regclass`), `EXECUTE format('SELECT count(*) FROM %I')` > 0 ⇒ `RAISE EXCEPTION '[0553] % con % hang — DUNG, nguoi quyet'` (không auto-migrate). `meeting_rooms` phải tồn tại + `room_bookings` phải tồn tại (0552 đã áp).
2. `DROP TABLE IF EXISTS meeting_tasks, meeting_notes, meeting_attendees, meetings;` — **một câu, KHÔNG CASCADE** (phụ thuộc ngoài danh sách phải làm migration ĐỎ — khuôn 0548). `meeting_tasks.task_id → tasks` là FK từ bảng bị DROP, rơi theo, `tasks` không đụng.
3. `DROP FUNCTION IF EXISTS meetings_set_updated_at();` (2 hộ trigger đã rơi cùng bảng).
4. Quyền di sản (D2): DO-block `DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE resource_type IN ('meeting','meeting_room'))` → `object_permissions` → `permissions`; `GET DIAGNOSTICS` + `RAISE NOTICE` số thật.
5. VERIFY: `to_regclass` NULL ×4 · `to_regproc('meetings_set_updated_at')` NULL · 0 hàng `permissions` resource_type meeting/meeting_room · `meeting_rooms` còn + RLS+FORCE · `tasks` còn nguyên (đếm CHECK `task_type` vẫn chứa `meeting_action` — string của TASK, KHÔNG liên quan).
6. Cùng commit: `AUDIT_OBJECT_TYPES` gỡ `meeting`/`meeting_note` (D8); `demo-seed-full.mjs` gỡ khối MEETINGS + 2 dòng đếm; `packages/contracts/src/meeting.ts` + barrel (D7); `docs/erd-current.md`.
7. `-- Down`: không tái tạo (0 hàng; DDL tham khảo ở `0052`/`0053`).

---

## 4. Migration `0554` — SEED role · 5 cặp · 22 grant · audit (DB-16 §9 bước C, mirror `0550`)

1. `modules.ROOM`: verify `count = 1` (deleted_at IS NULL) ⇒ else THROW; `RAISE NOTICE` giữ inactive (D1).
2. Role `office-admin`: `INSERT INTO roles (id, company_id, name, description, is_system, requires_two_factor) VALUES ('00000000-0000-0000-0000-000000000013', NULL, 'office-admin', 'Office Admin: quản trị phòng họp — CRUD phòng, đặt hộ, huỷ mọi lượt (SPEC-01 §10.9)', true, false) ON CONFLICT DO NOTHING`.
3. 5 cặp `is_sensitive=false`: `('access','room')` · `('view','room')` · `('book','room')` · `('cancel','room-booking')` · `('manage','room')` — `ON CONFLICT (action, resource_type) DO NOTHING`.
4. Grant per-(role,pair) clone khối DO `0550` bước 4 — nghi thức bắt buộc vì `role_permissions` UNIQUE `(role_id, permission_id, effect)` **không gồm `data_scope`** và app không có GRANT UPDATE: resolve role theo `name + company_id IS NULL + deleted_at IS NULL` (THROW nếu thiếu) → **`DELETE … WHERE data_scope <> g[4]` (xoá đúng bộ scope SAI, per-pair, KHÔNG blanket) → `INSERT … ON CONFLICT (role_id, permission_id, effect) DO NOTHING`** (plan-reviewer H2) — **22 hàng**: `employee`/`manager`/`hr` mỗi role `access@Own · view@Company · book@Own · cancel@Own`; `company-admin`/`office-admin` mỗi role `access@Own · view@Company · book@Company · cancel@Company · manage@Company`.
5. Audit CHECK UNION-ADD `v_new = ['room_booking','meeting_room']` — clone NGUYÊN khối `0550` bước 5 (= `0545`, neo 2 tầng, NO-LOSS/NO-GAIN, idempotent skip khi đủ). `AUDIT_OBJECT_TYPES` += `room_booking` cùng commit.
6. VERIFY (mọi câu đếm role neo `company_id IS NULL AND deleted_at IS NULL`): (a) 5 cặp `is_sensitive=false`; (b1) tổng ALLOW 5 role trên resource `room`/`room-booking` = **22**; (b2) `employee`/`manager`/`hr` **0** hàng `manage`; (b3) từng (role, act, scope) đúng 20 tổ hợp — `view`=Company ×5, `access`=Own ×5, `book`/`cancel` = Own cho 3 role, Company cho 2 role; (b4) `company-admin` và `office-admin` mỗi role đúng 5 hàng, 4 hàng Company ngoài `access`; (c) role `…0013` `is_system=true`, `requires_two_factor=false`, đúng 1 hàng; (d) CHECK audit chứa `room_booking` **và** `meeting_room` (regex biên); (e) module ROOM tồn tại `is_active=false`; (f) `super-admin` không có trong `roles WHERE company_id IS NULL`; (g) 0 hàng `permissions` di sản (`meeting`/`meeting_room`) — chốt 0553 không bị "seed lại".
7. `-- Down (manual)`: xoá 22 grant + 5 cặp + role `…0013`; audit CHECK không down.

---

## 5. Migration `0555` — NOTI 3 event + template + nới CHECK (mirror `0551`)

1. Baseline guard: 4 CHECK phải chứa `'ASSET'`/`'Asset'` (chuỗi sau 0551) và không có giá trị ngoài superset `{…,'CHAT','ASSET','ROOM'}` / `{…,'Chat','Asset','Room'}` — thiếu/thừa ⇒ THROW.
2. Nới CHECK **cả hai bảng** (guard `LIKE '%''ROOM''%'`/`'%''Room''%'` rồi DROP+ADD re-stamp superset tường minh; `notifications` giữ `IS NULL OR`).
3. 3 event GLOBAL (`module_code='ROOM'`, `notification_type='Room'`, `default_channels '["IN_APP"]'`, `is_enabled=true`, **`dedupe_strategy='DedupeKey'`, `dedupe_window_seconds NULL`**, `recipient_rule_config NULL`): `ROOM_BOOKING_CONFIRMED` 'Đặt phòng họp được xác nhận' **Normal** system=false · `ROOM_BOOKING_CANCELLED` 'Lịch phòng họp bị huỷ' **High** false · `ROOM_BOOKING_REMINDER` 'Nhắc lịch họp 15 phút' **High** **system=true** (không loại actor — `notification-recipient-resolver.service.ts:50`). `ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING`.
4. 3 template GLOBAL `IN_APP/vi-VN/Active/is_default`, `template_code = <EVENT>__IN_APP__vi-VN`, **`ON CONFLICT (template_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING`** (khuôn `0551:198`; bare ⇒ `42P10`; thiếu ⇒ H1 nổ `23505` — plan-reviewer H1), payload CHỈ tiêu đề · tên phòng · khung giờ · tên người tổ chức/thao tác · deep-link (SPEC-14 §17 — KHÔNG danh sách người tham dự, KHÔNG email):
   - `ROOM_BOOKING_CONFIRMED`: title `Đặt phòng {room_name} · {time_range}` · body `{organizer_name} đã đặt phòng {room_name} cho «{title}» ({time_range}).` · short `Đặt phòng {room_name} {time_range}` · url `/me/room-bookings?focus={booking_id}` · vars `{"organizer_name":"string","room_name":"string","title":"string","time_range":"string","booking_id":"uuid"}`
   - `ROOM_BOOKING_CANCELLED`: title `Huỷ lịch phòng {room_name} · {time_range}` · body `{actor_name} đã huỷ lượt «{title}» tại {room_name} ({time_range}).` · short `Huỷ {room_name} {time_range}` · url như trên · vars `{"actor_name":"string","room_name":"string","title":"string","time_range":"string","booking_id":"uuid"}`
   - `ROOM_BOOKING_REMINDER`: title `Sắp họp: {title} tại {room_name}` · body `Lượt «{title}» tại {room_name} bắt đầu lúc {starts_at_local} (15 phút nữa).` · short `15′ nữa: {title} · {room_name}` · url như trên · vars `{"title":"string","room_name":"string","starts_at_local":"string","booking_id":"uuid"}`
5. VERIFY bằng catalog: 4 CHECK chứa `ROOM`/`Room`; 3 event đúng thuộc tính (enabled · DedupeKey · Room · priority Normal/High/High · `is_system_event` false/false/true); 3 template có `target_url_template` + `variables_schema`.
6. Cùng commit: `notification-event-catalog.const.ts` (`NotiModuleCode` += `"ROOM"`, `NotiType` += `"Room"`, 3 entry, comment 67/53) · `packages/contracts/src/notification.ts` `notificationTypeEnumSchema` += `"Room"` · `schema/noti.ts` parity 2 CHECK · pin `noti-seed-catalog-permissions` 64/50 → **67/53** · `s5-noti-fix1-deeplink` 50 → **53** (`+ 0555 (3 ROOM)`).

---

## 6. Hợp đồng Zod — `packages/contracts/src/room.ts` (DB-16 §7, mirror CHECK HAI CHIỀU, ĐÚNG BẰNG)

`roomBookingStatusSchema = z.enum(["Confirmed","Cancelled"])` (= `chk_room_bookings_status`) · `roomBookingStatusFilterSchema = z.enum(["Confirmed","Cancelled","all"])` (chỉ Zod) · `myRoomBookingRoleFilterSchema = z.enum(["organizer","attendee","all"])` (chỉ Zod) · `ROOM_EQUIPMENT_MAX_ITEMS = 20` · `ROOM_EQUIPMENT_ITEM_MAX_LEN = 40` · `roomEquipmentSchema = z.array(z.string().trim().min(1).max(40)).max(20)` (DB không CHECK). Barrel `export * from "./room"` (thay dòng `./meeting`). Unit spec `room.spec.ts`: `.options` bằng mảng literal chép từ 0552; equipment 21 mục / mục 41 ký tự bị từ chối, 20 mục OK.

---

## 7. Test-first (RED) — `apps/api/test/integration/s11-room-db1-invariants.int-spec.ts` (gate `hasDb`, mirror `s11-asset-db1-invariants`; mọi ca ÂM assert `code` + `constraint` đích danh + ĐỐI CHỨNG DƯƠNG; mutation trong tx ROLLBACK)

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| A1 | app `DELETE` `room_bookings` / `room_booking_attendees` / `meeting_rooms` | `42501` ×3; đối chứng INSERT lượt + attendee OK; soft-delete phòng qua UPDATE `deleted_at` OK |
| A2 | app `UPDATE` cột ngoài allowlist `room_bookings` (`title`, `starts_at`, `room_id`, `organizer_user_id`) ⇒ `42501`; `UPDATE room_booking_attendees SET user_id=user_id` ⇒ `42501`; đối chứng huỷ = MỘT câu UPDATE 4 cột `status/cancelled_at/cancelled_by/cancel_reason` OK | đúng |
| A3 | worker INSERT/UPDATE/DELETE 3 bảng ⇒ `42501`; SELECT OK | đúng |
| B1–B4 | tenant A INSERT `room_bookings` với `room_id` của B ⇒ `23503 room_bookings_room_tenant_fk`; `organizer_user_id` của B ⇒ `_organizer_tenant_fk`; `booked_by_user_id` của B ⇒ `_booked_by_tenant_fk`; attendee `user_id` của B ⇒ `room_booking_attendees_user_tenant_fk`; `booking_id` của B ⇒ `_booking_tenant_fk`; `meeting_rooms.updated_by` user B ⇒ `meeting_rooms_updated_by_tenant_fk`; đối chứng cùng tenant OK | đúng |
| C1 | 2 lượt `Confirmed` chồng giờ cùng phòng ⇒ `23P01 room_bookings_no_overlap_excl` (**đo trên LANE_DB — done_when**) | đúng |
| C2 | kề nhau `[10,11)` + `[11,12)` OK; chồng ở phòng KHÁC OK; lượt 1 huỷ (1 câu UPDATE) rồi lượt chồng OK (predicate `Confirmed`); race: 2 INSERT **song song** trên 2 connection ⇒ đúng 1 OK + 1 `23P01` | đúng |
| D1 | `ends_at <= starts_at` ⇒ `23514 chk_room_bookings_time_order`; `status='Done'` ⇒ `chk_room_bookings_status`; `Cancelled` thiếu `cancelled_at` / `Confirmed` có `cancelled_at` ⇒ `chk_room_bookings_cancel_pair`; UPDATE 2 câu tách (status trước) ⇒ `23514` — đối chứng 1 câu OK | đúng |
| D2 | `meeting_rooms` `capacity=0` ⇒ `23514 chk_meeting_rooms_capacity`; `capacity NULL` ⇒ `23502`; tên trùng khác hoa/thường trên hàng sống ⇒ `23505 uq_meeting_rooms_company_name_active`; soft-delete rồi tạo lại cùng tên OK; `is_virtual` INSERT ⇒ `42703` | đúng |
| D3 | 2 attendee trùng user cùng lượt ⇒ `23505 uq_room_booking_attendees_booking_user` | đúng |
| E1 | không GUC ⇒ SELECT `room_bookings` = 0 hàng (smoke; lưới đầy đủ ở `tenant-isolation`) | 0 |
| F1 | 22 grant đúng ma trận §9e (JOIN neo `company_id IS NULL`); `employee` KHÔNG `manage`; `hr` `cancel`=Own; `office-admin` `is_system`, `requires_two_factor=false`, id `…0013`, `not.toContain` trong `DASH_CANONICAL_ROLES`/`NOTI_CANONICAL_ROLES` | đúng |
| F2 | 6 cặp `meeting`/`meeting_room` = 0 hàng `permissions`; 4 bảng `to_regclass` NULL; `meetings_set_updated_at` không còn; `meeting_rooms` còn | đúng |
| F3 | CHECK audit chứa `room_booking` + `meeting_room` **và** canary `'employee'`, `'user'` (NO-LOSS) | true |
| G1 | INSERT `notifications` `module_code='ROOM'`, `notification_type='Room'` dưới app role OK; `'XXX'` ⇒ `23514 chk_notifications_module_code`; `'Xxx'` ⇒ `chk_notifications_notification_type` | đúng |
| G2 | 3 event global `DedupeKey`, `is_system_event` = false/false/true; 3 template có url + variables_schema | đúng |
| H1 | chạy lại NGUYÊN `0554` + `0555` qua owner ⇒ 0 exception, count roles/perms/grants/events/templates/audit_def không đổi | đúng |

Thêm 2 case `rls-registry.ts` (lưới `tenant-isolation` + `rls-guards` + `rls-coverage-assert` tự phủ). `rls-tenant-isolation-tester` agent chạy sau khi xanh.

---

## 8. Thứ tự thi công & lệnh verify

1. `bash scripts/lane-db-setup.sh roombase551` (head 0551, ĐỐI CHỨNG — dựng TRƯỚC khi thêm file/journal) → đo census FK một-cột (SQL của `fk-tenant-census.ts` qua `docker exec psql`) **và chạy `tenant-isolation` trên lane đối chứng** để lấy 3 con số nền (FK 423 · W4 241 · PROVEN 139). Rồi `bash scripts/lane-db-setup.sh roomdb1`. (`global-setup.ts` KHÔNG migrate — chỉ kiểm con dấu lane — nên journal mới không làm bẩn lane đối chứng.)
2. RED: int-spec §7 + `room.spec.ts` + registry + `cleanupTenants` → đỏ vì thiếu bảng.
3. `0552` → journal idx 219 → migrate lane ⇒ A–E xanh · `0553` (220) ⇒ F2 · `0554` (221) ⇒ F1/F3 · `0555` (222) ⇒ G + pin NOTI.
4. Code parity + dọn di sản: `schema/rooms.ts` (+ xoá `meeting.ts`) · `index.ts` · `audit.ts` · `noti.ts` · catalog const · contracts (`room.ts` + `notification.ts` + `index.ts` − `meeting.ts`) · `demo-seed-full.mjs` · registry · seed.ts.
5. Đo ratchet trên `mediaos_roomdb1` (kỳ vọng 415) — chênh lệch với đối chứng phải = 8 cặp §0 ⇒ hạ `FK_SINGLE_COL_PAIRS_FLOOR` kèm lý do (D3).
6. Docs: `erd-current.md` (A4 ROOM → A1; §9 sổ không DELETE += `room_bookings`/`room_booking_attendees`; `meeting.ts` → `rooms.ts`) · đính chính **DB-16** (§3.0 `modules`, §4.2 sàn ratchet + FK `*_by` sổ SET NULL lý do, §9B hard-delete, §9C `is_active` giữ false + worker GRANT) · **SPEC-14 §16** · **DB-10:636** · **§9e** ("xoá mềm" → xoá). Bảng nhật ký plan-review §9 + kết quả §10 vào file này.
7. `harness/backlog.mjs`: `paths` WO += `packages/contracts/src/room*.ts` · `packages/contracts/src/notification.ts` · `packages/contracts/src/index.ts` · `packages/contracts/src/index.spec.ts` · `packages/contracts/src/meeting.ts` · `apps/api/test/foundation/**` (đã có) · `docs/DB/DB-16*.md` · `docs/DB/DB-10*.md` · `docs/SPEC/SPEC-14*.md` · `docs/permission-matrix-spec.md` · `docs/plans/S11-ROOM-DB-1.md` · `harness/backlog.mjs`; `done_when` sửa "xoá mềm 6 cặp" → "xoá 6 cặp"; `S11-ROOM-FE-1` += done_when bật `is_active` + gỡ pin smoke; `S11-ROOM-BE-1` note += "worker đã có SELECT 3 bảng (0552) nhưng `room_bookings` chỉ có policy tenant theo GUC + FORCE — job `ROOM_BOOKING_REMINDER` PHẢI quét **trong `withTenant` từng company** (không scan trần như `system_job_runs` có policy `*_worker_all`) — plan-reviewer H3; huỷ = 1 câu UPDATE 4 cột + `updated_*`; `booked_by_user_id` NO ACTION, KHÔNG nằm trong allowlist UPDATE".
8. Verify: `export LANE_DB=mediaos_roomdb1` → đích danh `s11-room-db1-invariants` · `s11-asset-db1-invariants` · `tenant-isolation` · `rls-guards` · `rls-coverage-assert` · `xtenant-fk-ratchet` · `catalog-fk-tenant-guard` · `noti-seed-catalog-permissions` · `s5-noti-fix1-deeplink` · `migration-smoke` · `auth-seed-canonical-roles` · `role-system-immutable` · `dash-seed2-manager-hr-grant` · `goal-db-seed` · `s7-chat-db1-invariants` · contracts `room.spec`/`index.spec` → `bash scripts/check-migration-no-drop.sh` → `bash harness/check.sh --all` với `LANE_DB`.
9. FULL gate: `security-reviewer` + `database-reviewer` + `silent-failure-hunter` trên diff; `rls-tenant-isolation-tester` trên lane. Vá CRITICAL/HIGH. PR → người chốt (không auto-merge).

---

## 9. Rủi ro còn lại & cách chặn

| Rủi ro | Chặn |
| --- | --- |
| Hàng `meeting_*` xuất hiện sau ngày đo (PROD) | 0553 tiền kiểm `count(*)` fail-loud, không auto-migrate |
| `capacity` NULL / `is_virtual=true` trên PROD | 0552 tiền kiểm fail-loud |
| Ratchet FK đỏ vì census tụt 8 | D3: đo 2 lane, hạ sàn đúng số đo, lý do văn bản |
| `cleanupTenants` thiếu ⇒ `23503` afterAll hàng loạt | §2.4 cùng commit; thứ tự attendees → bookings TRƯỚC `users` |
| rls-registry `meeting_rooms` seedRow thiếu `capacity` ⇒ `23502` hàng loạt | §2.4 sửa seedRow |
| EXCLUDE tính lượt Cancelled / kề nhau bị coi trùng | predicate `Confirmed` + `'[)'`; C2 |
| CHECK NOTI trên PROD chưa có ASSET lúc 0555 chạy | migrator áp tuần tự 0551 → 0555 trong cùng lượt; baseline guard THROW nếu thiếu (đọc log) |
| Quên vế `notifications` (lỗi 0507) | 0555 làm cả 2 bảng, verify 4 CHECK |
| `office-admin` lọt canonical / dashboard | F1 + grep `'office-admin'` trong `src/` = 0 ngoài migration/doc |
| Migrator 1 tx: verify "thử INSERT" không rollback được | chỉ verify bằng catalog; hành vi thật ở int-spec §7 |
| Journal `when` đơn điệu | 1717587341000 / …342000 / …343000 / …344000 |
| PL/pgSQL cắt điều kiện `IF … THEN` ở chữ `THEN` ĐẦU TIÊN — `CASE WHEN … THEN` lồng trong IF ⇒ `syntax error at end of input` (chỉ nổ lúc chạy) | Tính needle vào biến TRƯỚC `IF` (0551/0555 khối A); kiểm bằng chạy khối DO standalone qua psql trên lane |
| Baseline guard NOTI "không giá trị ngoài superset" RAISE vô điều kiện ⇒ H1 của module TRƯỚC (replay 0551) đỏ ngay khi module SAU seed | Guard chỉ RAISE khi re-stamp thật sự sắp chạy (CHECK chưa có mã của chính file); vá cả `0551` (chưa lên PROD, hash không được migrator đối chiếu) lẫn `0555` |

---

## 10. Nhật ký plan-review (vòng 1 hẹp → Rev 2, 29/08/2026)

| # | Vấn đề | Vá ở |
| --- | --- | --- |
| B1 | Chỉ hạ 1 sàn; `W4_FK_BLOCKED_FLOOR`/`PROVEN_WITH_CHECK_FLOOR` (tenant-isolation, đệm 0) cũng tụt | D3: đo A/B ba con số, hạ W4 241→232 (8 rơi + 1 đổi nhóm), PROVEN giữ 133 (137 ≥ 133) |
| B2 | D9 viện dẫn sai: `booked_by_user_id` KHÔNG trong allowlist ⇒ SET NULL ghi đè cột sổ | `room_bookings_booked_by_tenant_fk` = NO ACTION; verify (3) sửa dòng; D9 viết lại |
| H1 | §5.4 thiếu `ON CONFLICT (template_code) WHERE …` | §5.4 (0555 đã có sẵn) |
| H2 | §4.4 chưa nêu nghi thức DELETE-wrong-scope + INSERT ON CONFLICT | §4.4 (0554 đã có sẵn) |
| H3 | worker SELECT không quét xuyên tenant — job phải chạy trong `withTenant` | note `S11-ROOM-BE-1` |
| M4 | DB-16 §11 "`*_by` nullable dùng FK đơn cột" mâu thuẫn §4.2 | đính chính DB-16 §11 |
| M5 | seedRow `room_bookings` random điểm bắt đầu trên phòng chung = an-toàn-giả | mỗi seedRow tạo phòng riêng + 1h |
| M6 | verify (2) thiếu vế column-ACL UPDATE `meeting_rooms` = rỗng | 0552 verify (2b) so đúng bằng NULL-allowlist |
| M7 | chưa đo định nghĩa `meeting_rooms_active_idx` | §0: `(company_id) WHERE deleted_at IS NULL`, không chạm `is_virtual` |
| — | chạy `tenant-isolation` trên lane đối chứng trước; `paths` += `index.spec.ts`; H1 không replay 0552/0553 (ghi lý do) | §8.1 · §7 · §7 bảng H1 |

Điểm reviewer xác nhận ĐÚNG giữ nguyên: D2 hard-DELETE (permissions không có `deleted_at`, FK role_permissions/object_permissions CASCADE), D7 gỡ `contracts/meeting.ts` (0 consumer, chứa `isVirtual`), vị trí `cleanupTenants`, clone audit `0550`/`0545`, sửa seedRow `meeting_rooms` thêm `capacity`, DROP không CASCADE + `DESTRUCTIVE-APPROVED`.

---

## 11. Kết quả thi công (29/08/2026)

| Mục | Kết quả |
| --- | --- |
| Migration | `0552` (ALTER `meeting_rooms` + 2 bảng mới, 10 composite FK verify DƯƠNG, EXCLUDE gist, GRANT cấp cột, worker SELECT) · `0553` (DROP 4 bảng không CASCADE, DROP FUNCTION, hard-DELETE 12/0/6 quyền di sản) · `0554` (role `office-admin` …0013, 5 cặp, 22 grant, audit CHECK += `room_booking`) · `0555` (4 CHECK NOTI += ROOM/Room, 3 event DedupeKey, 3 template) — journal idx 219–222, áp sạch trên lane `mediaos_roomdb1` (lần 1 verify (3) bắt đúng lỗi expected `booked_by` = n sau khi đổi NO ACTION — rollback sạch, sửa rồi áp lại) |
| Lỗi bắt được lúc chạy | (1) verify (3) 0552 lệch 1 dòng như trên; (2) D1 test: `'Completed'` vi phạm cả `chk_room_bookings_status` lẫn `cancel_pair`, PG báo cái nào cũng được ⇒ ca test chấp nhận cả hai + pin ĐỊNH NGHĨA CHECK từ catalog; (3) H1 ASSET đỏ vì baseline guard 0551 RAISE vô điều kiện khi thấy `ROOM` ⇒ vá guard 0551 + 0555 (chỉ RAISE khi re-stamp sắp chạy); (4) bản vá đầu dùng `CASE … THEN` trong điều kiện `IF` ⇒ PL/pgSQL cắt ở THEN đầu tiên — tính needle trước IF |
| Sàn ratchet | `FK_SINGLE_COL_PAIRS_FLOOR` 423 → **415** · `W4_FK_BLOCKED_FLOOR` 241 → **232** (A/B hai lane, lý do văn bản tại chỗ) · `PROVEN_WITH_CHECK_FLOOR` 133 giữ (đo 137) |
| FULL gate (29/08) | `database-reviewer` PASS (0 finding, 2 LOW thông tin) · `silent-failure-hunter` PASS (1 MEDIUM: B4 thiếu ca ALLOW → đã thêm) · `security-reviewer` PASS (3 MEDIUM đã vá: ca `created_by` 23503 tên duy nhất ở B4, header 0552, parity `rooms.ts` booked_by; LOW: 0553 fail-loud số quyền xoá → đã thêm) · `rls-tenant-isolation-tester` PASS cô lập (30 ca thật; X2 chứng minh EXCLUDE không làm oracle chéo tenant; worker không GUC = 0 hàng). **Nợ ngoài WO** ghi vào backlog BE-1: oracle tên constraint qua `meeting_rooms_created_by_fkey` (0052, cân nhắc DROP ở WO dọn) · `workerPool` fallback superuser khi thiếu `DATABASE_WORKER_URL` · cấm vá job bằng policy `TO mediaos_worker USING (true)` · vá `0551` không tới môi trường ĐÃ áp 0551 (PROD chưa áp — an toàn). |
| Test | `s11-room-db1-invariants` **21/21** (sau vá — B4 thêm 4 assert trong cùng ca) (A1–A3 · B1–B4 · C1–C3 kể cả race COMMIT thật · D1–D3 · E1 · F1–F3 · G1–G2 · H1) · 15 cổng foundation trên lane (tenant-isolation · rls-guards · rls-coverage-assert · xtenant-fk-ratchet · catalog-fk-tenant-guard · noti-seed-catalog · s5-noti-fix1-deeplink · migration-smoke · auth-seed-canonical-roles · role-system-immutable · dash-seed2 · goal-db-seed · s7-chat-db1 · s11-asset-db1 · s11-room-db1) xanh sau vá · contracts `room.spec` + `index.spec` xanh · typecheck api + eslint xanh · `check-migration-no-drop.sh` OK (4 file duyệt tường minh) |
