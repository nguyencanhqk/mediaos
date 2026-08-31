# DB-14: RECRUIT DATABASE DESIGN — TUYỂN DỤNG

> **Nguồn nghiệp vụ:** [SPEC-12 RECRUIT](<../SPEC/SPEC-12 RECRUIT.md>) · Quy ước chung: [DB-01](<DB-01 DATABASE DESIGN TỔNG QUAN.md>) §3.2/§7.12 · HR nền: [DB-03](<DB-03_HR Database Design.md>) (`employees`/`org_units`/`positions`) · Foundation: [DB-08](<DB-08 Audit Files Settings Seeds Database Design.md>) (`audit_logs`, Files/`file_access_logs`)
>
> **Liên quan:** [API-17 RECRUIT API Design](<../API Design/API-17_RECRUIT_API_Design.md>) · [DB-09 §8.18 index](<DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 seed RECRUIT](<DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>) · [Ma trận phân quyền §9f](<../permission-matrix-spec.md>) · [Chỉ mục tài liệu](<../README.md>)
>
> **Đánh số (REC-DEC-001):** RECRUIT lấy đúng **DB-14** mà IMPLEMENTATION-10 §13.2 giữ chỗ (OFFICE-DEC-001 đã tôn trọng khi ASSET/ROOM nhảy DB-15/16). API lấy **API-17** (API-16 đã bị PERMISSION AUDIT REPORT chiếm).

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DB-14 |
| Tên tài liệu | RECRUIT Database Design — Tuyển dụng |
| Module | RECRUIT (SPEC-12) |
| Phiên bản | v1.0 — **Approved** cùng SPEC-12 (owner duyệt gói wave S12-RECRUIT 31/08/2026) |
| Ngày tạo / cập nhật | 31/08/2026 / 31/08/2026 |
| Head migration lúc viết | idx 225 / `0558_s11officedash1_widgets_asset_room` ⇒ migration RECRUIT dự kiến **`0559+`** |
| Giai đoạn | Phase 2 «HR nâng cao» · wave S12-RECRUIT — hậu go-live |

> ⚠️ Số migration dưới đây là **dự kiến**. WO DB phải đọc `apps/api/migrations/meta/_journal.json` **tại thời điểm chạy** (bẫy `migration-not-in-journal-is-silently-skipped`); lane migration là lane **nối tiếp** duy nhất của wave.

---

## 2. Mục đích tài liệu

Đặc tả tầng dữ liệu cho module RECRUIT: vị trí tuyển dụng, ứng viên (PII nhạy cảm), sổ lịch sử stage append-only, ghi chú, phỏng vấn (+người tham gia), feedback per-interviewer, offer. Giống ASSET (DB-15), RECRUIT **tạo mới 8 bảng từ số không**: đo 31/08/2026 không có bảng tuyển dụng nào trong DB (quét `candidates/vacanc/applicant/job_opening` = chỉ 2 giá trị enum trong `finance.ts`/`media.ts` đã park). Quy tắc nghiệp vụ (mã lỗi, ma trận FSM, masking) sống ở SPEC-12 — file này chỉ nói về dữ liệu.

---

## 3. Phạm vi thiết kế

### 3.1 Bảng MỚI

| Bảng | Vai trò | Ghi chú |
| --- | --- | --- |
| `job_openings` | Vị trí tuyển, FSM 4 trạng thái | soft delete (v1 không có endpoint xoá) |
| `candidates` | Ứng viên — PII mask ở server | soft delete (REC-DEC-007); `employee_id` UNIQUE partial |
| `candidate_stage_events` | Lịch sử chuyển stage | **append-only**: chỉ SELECT + INSERT |
| `candidate_notes` | Ghi chú nội bộ | soft delete, sửa/xoá của mình |
| `interviews` | Lượt phỏng vấn, FSM 3 trạng thái | không DELETE |
| `interview_participants` | Interviewer của lượt | **chỉ INSERT** — cố định lúc xếp lịch |
| `interview_feedbacks` | Đánh giá per-interviewer | không DELETE; unique (interview, interviewer) |
| `offers` | Offer, FSM 5 trạng thái; `salary` mask | không DELETE; partial unique 1 offer sống/ứng viên |

### 3.2 Bảng SỬA

_(không có)_ — không ALTER bảng nghiệp vụ nào. Chỉ **UNION-ADD** CHECK trên `audit_logs.object_type` và nới CHECK `module_code`/`notification_type` trên `notification_events` + `notifications` (§9).

### 3.3 Bảng dùng lại (không tạo mới)

`companies` · `users` (recruiter phụ trách, `*_by`) · `employees` (thiết kế DB-03 — **code thật là `employee_profiles`**, erd-current A2; interviewer + link convert) · `org_units`/`positions` (vị trí tuyển trỏ về) · `roles`/`permissions`/`role_permissions` · `modules` (hàng RECRUIT **đã pre-seed inactive** từ `0435`) · `audit_logs` · `sequence_counters` (**dùng lại counter `employee_code` của HR khi convert — KHÔNG counter mới**) · `notification_events`/`notification_templates`/`notifications` · `files`/`file_links`/`file_access_logs` (CV, `entity_type='candidate'`).

---

## 4. Nguyên tắc thiết kế

1. **RLS + FORCE theo `company_id`** trên cả 8 bảng, policy literal-GUC mẫu `0479`/`0549`; tạo policy **trước** mọi INSERT (bất biến #1); đăng ký `rls-registry`.
2. **Composite tenant FK** `(company_id, x_id) REFERENCES t (company_id, id)` cho **mọi** FK chéo bảng nghiệp vụ (mẫu `0535`/`0549`; bảng đích cần `UNIQUE (company_id, id)`).
   - `company_id` của cả 8 bảng: `REFERENCES companies (id) ON DELETE CASCADE` — teardown `DELETE FROM companies` dọn được.
   - **FK về `users` — danh sách ĐÓNG (plan-review M6, verify đúng-bằng ở §9A đếm theo danh sách này):** 5 bảng mutable có cột FK `users` = `job_openings` (`recruiter_user_id` + `created_by`/`updated_by`/`deleted_by`) · `candidates` (`*_by`) · `candidate_notes` (`*_by`) · `interviews` (`created_by`/`updated_by`) · `offers` (`created_by`/`updated_by`) — dùng `SET NULL (col)` (liệt kê cột — khuôn `0535:682`). Bảng chỉ-INSERT: `candidate_stage_events.acted_by` dùng **`NO ACTION`** (RI action chạy ở tầng owner, `SET NULL` sẽ ghi đè cột không có grant UPDATE — đính chính `0549` của ASSET, bất biến #2). **`interview_participants` và `interview_feedbacks` KHÔNG có cột FK `users` nào** (participants chỉ có `employee_id`; feedbacks chỉ có `interviewer_employee_id`).
   - **Composite FK nội bộ: `ON DELETE NO ACTION` (kiểm cuối câu lệnh), TUYỆT ĐỐI KHÔNG `RESTRICT`** — cascade từ `companies` xoá các bảng anh em theo thứ tự bất định (bài học `cleanupTenants` đỏ hàng loạt, DB-15 §4.2).
3. **Append-only**: `candidate_stage_events` — app role `GRANT SELECT, INSERT`, **không UPDATE/DELETE** (bất biến #2). `interview_participants` chỉ INSERT. Không bảng RECRUIT nào có DELETE cho app role.
4. **FSM ép ở service, DB chỉ CHECK tập giá trị** + UNIQUE/partial unique làm chốt cuối (double-convert · 1 offer sống · 1 feedback/interviewer).
5. **Stage hiện tại là cột, lịch sử là sổ** — mỗi move = UPDATE `candidates.stage` + INSERT event **cùng transaction**; không trigger đồng bộ (trigger đóng băng là bẫy `frozen-table-triggers-break-db-init`).
6. **Hợp đồng Zod mirror CHECK hai chiều, đúng bằng** (`packages/contracts/src/recruit.ts`) — không chặt hơn, không lỏng hơn; export prefix `recruit*` để không đụng barrel park (`contracts-barrel-collides-with-parked-media`).
7. UUID PK `gen_random_uuid()`, timestamptz UTC, soft delete `deleted_at` ở `job_openings`/`candidates`/`candidate_notes` — theo DB-01.
8. **Email/phone ứng viên KHÔNG unique** — trùng là cảnh báo mềm (SPEC-12 §12); chỉ index phục vụ check-duplicate.

---

## 5. ERD cấp module

```text
org_units/positions (HR) 1─n job_openings ─n─0..1 users (recruiter_user_id)
job_openings   1─n candidates ─0..1─1 employees (employee_id — UNIQUE partial, link convert)
candidates     1─n candidate_stage_events (append-only)
candidates     1─n candidate_notes
candidates     1─n interviews 1─n interview_participants n─1 employees
interviews     1─n interview_feedbacks (unique per interview × interviewer_employee_id)
candidates     1─n offers                  partial unique: 1 offer Draft/Sent mỗi ứng viên
```

---

## 6. Chi tiết bảng

### 6.1 Bảng `job_openings`

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` CASCADE, RLS |
| `title` | VARCHAR(255) | Có | |
| `description` | TEXT | Không | |
| `org_unit_id` | UUID | Có | composite FK → `org_units (company_id, id)` NO ACTION |
| `position_id` | UUID | Không | composite FK → `positions (company_id, id)` NO ACTION |
| `headcount` | INTEGER | Có | CHECK > 0, default 1 |
| `recruiter_user_id` | UUID | Không | composite FK → `users (company_id, id)` `SET NULL (recruiter_user_id)`; đổi ⇒ NOTI-EVENT-016 |
| `status` | VARCHAR(20) | Có | `Draft`/`Open`/`Paused`/`Closed` (SPEC-01 §17.12), default `Draft` |
| `created_at/by` `updated_at/by` `deleted_at/by` | | | chuẩn chung, soft delete |

```sql
ALTER TABLE job_openings ADD CONSTRAINT chk_job_openings_status    CHECK (status IN ('Draft','Open','Paused','Closed'));
ALTER TABLE job_openings ADD CONSTRAINT chk_job_openings_headcount CHECK (headcount > 0);
ALTER TABLE job_openings ADD CONSTRAINT job_openings_company_id_id_uq UNIQUE (company_id, id);
CREATE INDEX idx_job_openings_company_status ON job_openings (company_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_job_openings_company_org    ON job_openings (company_id, org_unit_id) WHERE deleted_at IS NULL;
```

GRANT app role: `SELECT, INSERT, UPDATE`. **Không** `DELETE` (soft delete; v1 chưa có endpoint xoá).

### 6.2 Bảng `candidates`

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | CASCADE, RLS |
| `job_opening_id` | UUID | Có | composite FK → `job_openings` NO ACTION; vị trí Closed chặn thêm/chuyển vào (service — RECRUIT-ERR-005) |
| `full_name` | VARCHAR(255) | Có | |
| `email` | VARCHAR(255) | Không | **PII — mask ở server** (SPEC-12 §18); KHÔNG unique (§4.8) |
| `phone` | VARCHAR(30) | Không | **PII — mask ở server**; KHÔNG unique |
| `source` | VARCHAR(120) | Không | text tự do (TopCV, giới thiệu…) |
| `note` | TEXT | Không | |
| `stage` | VARCHAR(20) | Có | `New`/`Screening`/`Interview`/`Offer`/`Hired`/`Rejected` (SPEC-01 §17.11), default `New`; FSM ở service |
| `employee_id` | UUID | Không | composite FK → `employees (company_id, id)` NO ACTION (code: `employee_profiles`); **UNIQUE partial** — chốt cuối double-convert (SPEC-12 §3.5) |
| `created_at/by` `updated_at/by` `deleted_at/by` | | | chuẩn chung, soft delete (REC-DEC-007) |

```sql
ALTER TABLE candidates ADD CONSTRAINT chk_candidates_stage CHECK (stage IN ('New','Screening','Interview','Offer','Hired','Rejected'));
ALTER TABLE candidates ADD CONSTRAINT candidates_company_id_id_uq UNIQUE (company_id, id);
-- CHỐT CUỐI REC-DEC-005: một nhân viên chỉ link về đúng một ứng viên (kể cả hồ sơ đã xoá mềm — không partial theo deleted_at)
CREATE UNIQUE INDEX uq_candidates_company_employee ON candidates (company_id, employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX idx_candidates_company_stage_job ON candidates (company_id, stage, job_opening_id) WHERE deleted_at IS NULL;
-- Check-duplicate: KHÔNG partial theo deleted_at (cảnh báo tính cả hồ sơ đã xoá mềm — plan-review H4);
-- index đúng BIỂU THỨC mà service so sánh (email hạ chữ · phone chuẩn hoá bỏ mọi ký tự ngoài số/+)
CREATE INDEX idx_candidates_company_email_expr ON candidates (company_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX idx_candidates_company_phone_norm ON candidates (company_id, regexp_replace(phone, '[^0-9+]', '', 'g')) WHERE phone IS NOT NULL;
```

> Check-duplicate (RECRUIT-API-008) so **đúng biểu thức của index**: `lower(email) = lower($1)` và `regexp_replace(phone, '[^0-9+]', '', 'g') = <phone đã chuẩn hoá cùng công thức>` — service dùng CÙNG biểu thức, khác một ký tự là planner bỏ index. Hai index **cố ý không partial theo `deleted_at`** vì cảnh báo trùng tính cả hồ sơ đã xoá mềm (FE hiện «hồ sơ cũ»); vế `IS NOT NULL` vẫn dùng được (strictness của `=` chứng minh được NOT NULL). **DoD cho WO DB/QA:** xác nhận bằng `EXPLAIN` trên `LANE_DB` rằng hai truy vấn duplicate thật sự đi qua hai index này — không assert chay (`pg-planner-index-assert-trap`).
>
> **Ghi chú M9 (cột ghi-không-bao-giờ có chủ đích):** `deleted_at/by` của `candidates` và `job_openings` ở v1 **không có đường ghi** (không endpoint xoá — SPEC-12 §5.2); giữ cột theo chuẩn §16.2 và cho PARK-RECRUIT-001 mở đường xoá sau — KHÔNG áp luật `write-only-column-means-delete-not-wire-up` ở đây. Riêng `candidate_notes.deleted_at` CÓ đường ghi (RECRUIT-API-017).

GRANT app role: `SELECT, INSERT, UPDATE` **cấp bảng** — chấp nhận CÓ CHỦ ĐÍCH (plan-review H6): `stage` và `employee_id` PHẢI ghi được bởi app role (move-stage/convert là đường ghi hợp lệ đi qua cùng role), column-grant không phân biệt được «đường đi» nên không mua thêm an toàn; bất biến được bảo vệ bằng service (một method `moveStage`/`convert` duy nhất) + UNIQUE `uq_candidates_company_employee` + sổ `candidate_stage_events` append-only. **Không** `DELETE`.

### 6.3 Bảng `candidate_stage_events` — sổ append-only

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | CASCADE, RLS |
| `candidate_id` | UUID | Có | composite FK → `candidates` NO ACTION |
| `from_stage` | VARCHAR(20) | Có | CHECK cùng tập 6 giá trị |
| `to_stage` | VARCHAR(20) | Có | CHECK cùng tập; CHECK `from_stage <> to_stage` |
| `action` | VARCHAR(10) | Có | `move` / `convert` — hàng convert là `Offer → Hired` |
| `reason` | TEXT | Có | bắt buộc (SPEC-12 §13.1) |
| `acted_by` | UUID | Không | FK `users` **NO ACTION** (bảng chỉ-INSERT — §4.2) |
| `acted_at` | TIMESTAMPTZ | Có | default now() |
| `created_at` | TIMESTAMPTZ | Có | |

```sql
ALTER TABLE candidate_stage_events ADD CONSTRAINT chk_cse_from   CHECK (from_stage IN ('New','Screening','Interview','Offer','Hired','Rejected'));
ALTER TABLE candidate_stage_events ADD CONSTRAINT chk_cse_to     CHECK (to_stage   IN ('New','Screening','Interview','Offer','Hired','Rejected'));
ALTER TABLE candidate_stage_events ADD CONSTRAINT chk_cse_moved  CHECK (from_stage <> to_stage);
ALTER TABLE candidate_stage_events ADD CONSTRAINT chk_cse_action CHECK (action IN ('move','convert'));
CREATE INDEX idx_cse_company_candidate_time ON candidate_stage_events (company_id, candidate_id, acted_at DESC);
```

GRANT app role: **`SELECT, INSERT` — KHÔNG UPDATE, KHÔNG DELETE** (bất biến #2; migration verify fail-loud 0 quyền UPDATE/DELETE).

### 6.4 Bảng `candidate_notes`

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` / `company_id` / `candidate_id` | UUID | Có | chuẩn; composite FK → `candidates` NO ACTION |
| `body` | TEXT | Có | |
| `created_at/by` `updated_at/by` `deleted_at/by` | | | sửa/xoá mềm **của mình** (service so `created_by`) |

```sql
CREATE INDEX idx_candidate_notes_company_candidate ON candidate_notes (company_id, candidate_id, created_at DESC) WHERE deleted_at IS NULL;
```

GRANT app role: `SELECT, INSERT, UPDATE`. **Không** `DELETE`.

### 6.5 Bảng `interviews`

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` / `company_id` | UUID | Có | CASCADE, RLS |
| `candidate_id` | UUID | Có | composite FK → `candidates` NO ACTION |
| `round` | INTEGER | Có | CHECK > 0, default 1 |
| `starts_at` / `ends_at` | TIMESTAMPTZ | Có / Có | CHECK `ends_at > starts_at` (service kiểm trước — RECRUIT-ERR-013) |
| `location` | VARCHAR(500) | Không | text/link tự do (REC-DEC-006) |
| `note` | TEXT | Không | |
| `status` | VARCHAR(20) | Có | `Scheduled`/`Completed`/`Cancelled` (SPEC-01 §17.13), default `Scheduled` |
| `created_at/by` `updated_at/by` | | | không soft delete — huỷ = `Cancelled` |

```sql
ALTER TABLE interviews ADD CONSTRAINT chk_interviews_status CHECK (status IN ('Scheduled','Completed','Cancelled'));
ALTER TABLE interviews ADD CONSTRAINT chk_interviews_range  CHECK (ends_at > starts_at);
ALTER TABLE interviews ADD CONSTRAINT chk_interviews_round  CHECK (round > 0);
ALTER TABLE interviews ADD CONSTRAINT interviews_company_id_id_uq UNIQUE (company_id, id);
CREATE INDEX idx_interviews_company_candidate ON interviews (company_id, candidate_id, starts_at DESC);
CREATE INDEX idx_interviews_company_start     ON interviews (company_id, starts_at);
```

GRANT app role: `SELECT, INSERT, UPDATE`. **Không** `DELETE`.

### 6.6 Bảng `interview_participants` — chỉ INSERT

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` / `company_id` | UUID | Có | CASCADE, RLS |
| `interview_id` | UUID | Có | composite FK → `interviews` NO ACTION |
| `employee_id` | UUID | Có | composite FK → `employees` NO ACTION — chân own-scope + NOTI-EVENT-017 |
| `created_at` | TIMESTAMPTZ | Có | |

```sql
CREATE UNIQUE INDEX uq_interview_participants ON interview_participants (company_id, interview_id, employee_id);
CREATE INDEX idx_interview_participants_employee ON interview_participants (company_id, employee_id);
```

GRANT app role: **`SELECT, INSERT`** — đổi người = huỷ lượt + tạo lượt mới (SPEC-12 §3.6).

### 6.7 Bảng `interview_feedbacks`

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` / `company_id` | UUID | Có | CASCADE, RLS |
| `interview_id` | UUID | Có | composite FK → `interviews` NO ACTION |
| `interviewer_employee_id` | UUID | Có | composite FK → `employees` NO ACTION; own-scope (service so employee của caller) |
| `rating` | SMALLINT | Có | CHECK 1..5 |
| `comment` | TEXT | Không | |
| `recommendation` | VARCHAR(20) | Có | `Hire` / `No Hire` / `Consider` |
| `created_at` `updated_at` | | | |

```sql
ALTER TABLE interview_feedbacks ADD CONSTRAINT chk_feedback_rating CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE interview_feedbacks ADD CONSTRAINT chk_feedback_reco   CHECK (recommendation IN ('Hire','No Hire','Consider'));
-- CHỐT CUỐI RECRUIT-ERR-012: mỗi interviewer một feedback/lượt
CREATE UNIQUE INDEX uq_interview_feedbacks ON interview_feedbacks (company_id, interview_id, interviewer_employee_id);
```

GRANT app role: `SELECT, INSERT` + `UPDATE (rating, comment, recommendation, updated_at)`. **Không** `DELETE`.

### 6.8 Bảng `offers`

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` / `company_id` | UUID | Có | CASCADE, RLS |
| `candidate_id` | UUID | Có | composite FK → `candidates` NO ACTION |
| `title` | VARCHAR(255) | Không | chức danh trên offer (mặc định lấy theo vị trí tuyển ở FE) |
| `start_date` | DATE | Có | ngày nhận việc dự kiến; map sang ngày vào làm khi convert |
| `salary` | NUMERIC(18,2) | Có | CHECK ≥ 0; **chỉ trả cho `('manage','offer')`** (SPEC-12 §18) — vắng khoá với người khác |
| `note` | TEXT | Không | |
| `status` | VARCHAR(20) | Có | `Draft`/`Sent`/`Accepted`/`Declined`/`Withdrawn` (SPEC-01 §17.14), default `Draft` |
| `responded_at` | TIMESTAMPTZ | Không | ghi khi vào terminal |
| `created_at/by` `updated_at/by` | | | |

```sql
ALTER TABLE offers ADD CONSTRAINT chk_offers_status CHECK (status IN ('Draft','Sent','Accepted','Declined','Withdrawn'));
ALTER TABLE offers ADD CONSTRAINT chk_offers_salary CHECK (salary >= 0);
-- Terminal ⇒ phải có responded_at; Draft/Sent ⇒ NULL (mirror hai chiều ở Zod)
ALTER TABLE offers ADD CONSTRAINT chk_offers_responded_pair CHECK (
  (status IN ('Draft','Sent') AND responded_at IS NULL) OR
  (status IN ('Accepted','Declined','Withdrawn') AND responded_at IS NOT NULL)
);
-- CHỐT CUỐI RECRUIT-ERR-006: một ứng viên một offer đang sống
CREATE UNIQUE INDEX uq_offers_candidate_open ON offers (company_id, candidate_id) WHERE status IN ('Draft','Sent');
CREATE INDEX idx_offers_company_candidate_time ON offers (company_id, candidate_id, created_at DESC);
```

GRANT app role: `SELECT, INSERT` + `UPDATE (title, start_date, salary, note, status, responded_at, updated_at, updated_by)`. **Không** `DELETE`. ⚠️ `chk_offers_responded_pair` buộc "đổi trạng thái sang terminal" là **một câu UPDATE** đặt `status` + `responded_at` cùng lúc.

---

## 7. Enum chuẩn (đồng bộ `packages/contracts/src/recruit.ts` — mirror CHECK HAI CHIỀU, ĐÚNG BẰNG)

| Nhóm | Giá trị | CHECK |
| --- | --- | --- |
| candidate stage (SPEC-01 §17.11) | `New` · `Screening` · `Interview` · `Offer` · `Hired` · `Rejected` | `chk_candidates_stage`, `chk_cse_from/to` |
| job opening status (SPEC-01 §17.12) | `Draft` · `Open` · `Paused` · `Closed` | `chk_job_openings_status` |
| interview status (SPEC-01 §17.13) | `Scheduled` · `Completed` · `Cancelled` | `chk_interviews_status` |
| offer status (SPEC-01 §17.14) | `Draft` · `Sent` · `Accepted` · `Declined` · `Withdrawn` | `chk_offers_status` |
| stage-event action | `move` · `convert` | `chk_cse_action` |
| recommendation | `Hire` · `No Hire` · `Consider` | `chk_feedback_reco` |
| rating | 1..5 | `chk_feedback_rating` |
| move-stage `toStage` (API) | **ĐỦ 6 giá trị — Zod KHÔNG cắt `Hired`** (plan-review B2): chặn `Hired` là việc của service với mã **RECRUIT-ERR-014** (409) — cắt ở Zod là 014 thành mã CHẾT (`equal-caps-at-zod-and-service-make-dead-error-code`) | (Zod = enum contracts, đúng bằng CHECK) |

---

## 8. Index theo use case

| Use case | Index dùng |
| --- | --- |
| Danh sách vị trí lọc trạng thái/phòng ban (`RECRUIT-API-001`) | `idx_job_openings_company_status` · `idx_job_openings_company_org` |
| Kanban/danh sách ứng viên theo stage + vị trí (`RECRUIT-API-006`) · phễu (`009`) | `idx_candidates_company_stage_job` (`GROUP BY stage`) |
| Check-duplicate email/phone (`RECRUIT-API-008`) | `idx_candidates_company_email_expr` (`lower(email)`) · `idx_candidates_company_phone_norm` (phone chuẩn hoá) — không partial theo `deleted_at` |
| Timeline ứng viên (`RECRUIT-API-014`) | `idx_cse_company_candidate_time` |
| Ghi chú (`RECRUIT-API-015`) | `idx_candidate_notes_company_candidate` |
| Lịch phỏng vấn theo ứng viên / theo khung thời gian (`RECRUIT-API-018`) | `idx_interviews_company_candidate` · `idx_interviews_company_start` |
| «Lượt của tôi» (view@Own — `EXISTS` participant) | `idx_interview_participants_employee` |
| Offer của ứng viên · offer đang sống | `idx_offers_company_candidate_time` · `uq_offers_candidate_open` |
| Link convert 1-1 | `uq_candidates_company_employee` |

> Cô lập tenant ép ở RLS + FORCE; mọi index dẫn đầu bằng `company_id`. Own-scope interview ép bằng **`EXISTS`** trên `interview_participants` (không JOIN — một lượt nhiều interviewer ⇒ JOIN nhân bản hàng, hỏng pagination — `partial-unique-index-makes-join-duplicate`).

---

## 9. Seed & kế hoạch migration (`0559+` dự kiến, lane DB nối tiếp)

| Bước | Nội dung | Ràng buộc thứ tự |
| --- | --- | --- |
| **A** (`0559`) | Tạo 8 bảng (`company_id … ON DELETE CASCADE`; composite FK nội bộ `NO ACTION`; FK `users` theo §4.2) + `UNIQUE (company_id, id)` ở bảng đích + CHECK + index §6 · **ENABLE/FORCE RLS + policy literal-GUC cả 8 bảng** · GRANT theo §6 (**`candidate_stage_events` = SELECT, INSERT duy nhất; `interview_participants` = SELECT, INSERT**; các bảng khác không DELETE; UPDATE cấp cột ở `interview_feedbacks`/`offers` — không phát GRANT bảng rồi thu hồi: `revoke-table-grant-wipes-column-grants`) · đăng ký `rls-registry` · **VERIFY fail-loud** (khuôn `0549`): 8 bảng `relrowsecurity AND relforcerowsecurity` + policy; app role **0 quyền UPDATE/DELETE** trên `candidate_stage_events`, 0 DELETE toàn bộ 8 bảng; tập cột UPDATE so bằng `aclexplode` (KHÔNG `information_schema.column_privileges`); verify **DƯƠNG đúng-bằng** số composite FK qua `pg_constraint`; predicate partial unique so đúng chuỗi `pg_get_expr(indpred)` · **cùng commit**: thêm 8 bảng vào `apps/api/test/helpers/seed.ts` `cleanupTenants()` thứ tự con→cha (`interview_feedbacks` → `interview_participants` → `interviews` → `offers` → `candidate_notes` → `candidate_stage_events` → `candidates` → `job_openings`) và **trước dòng `DELETE FROM users`** | RLS TRƯỚC mọi INSERT (bất biến #1); `fk-tenant-census`/`xtenant-fk-ratchet` không đỏ; drizzle schema `apps/api/src/db/schema/recruit.ts` parity. Thiếu `cleanupTenants` = đỏ hàng loạt `afterAll` |
| **B** (`0560`) | **Module `RECRUIT`: hàng ĐÃ TỒN TẠI từ `0435` (`is_active=false`, sort_order 9)** ⇒ chỉ **verify tồn tại và GIỮ `is_active=false`**; guard viết **forward-compatible**: chỉ RAISE khi hàng **không tồn tại**, KHÔNG RAISE khi `is_active=true` — kẻo chính `S12-RECRUIT-FE-1` bật cờ xong là migration này đỏ khi chạy lại trên DB mới (bài học `module-enable-guard-blocks-next-wo` 0550/0554, plan-review H1). Pin `migration-smoke` `EXTENSION_INACTIVE_MODULES` giữ `RECRUIT`; bật ở `S12-RECRUIT-FE-1` bằng UPDATE tường minh + gỡ pin cùng commit — khuôn `0556`/`0557` · seed role hệ thống **`recruiter`** (`company_id NULL`, `is_system=true`, **`requires_two_factor=false` tường minh**, id cố định mới, `ON CONFLICT DO NOTHING` — tiền lệ `asset-manager`/`office-admin`) · **16 cặp** permission SPEC-12 §11 — **7 cặp resource `candidate` `is_sensitive=TRUE`**, 9 cặp còn lại false — `ON CONFLICT (action, resource_type) DO NOTHING` · grant per-(role, pair) theo ma trận **§9f** (DELETE-wrong-scope + INSERT ON CONFLICT, verify fail-loud đếm đúng **42** hàng; census grant phủ **bốn hình dạng wildcard** — `permission-grant-census-must-cover-four-wildcard-shapes`) · **UNION-ADD 4 giá trị** `job_opening` · `candidate` · `interview` · `offer` vào CHECK `audit_logs.object_type` — **clone nguyên khối `0545`** (neo 2 tầng, fail-closed, NO-LOSS/NO-GAIN — KHÔNG clone `0506`; bẫy `audit-check-union-parse-anchor-trap`) + `AUDIT_OBJECT_TYPES` cùng commit; **bản đồ hành động → object_type là danh sách ĐÓNG ở SPEC-12 §12** (ghi chú/feedback/export gom về aggregate — KHÔNG có `candidate_note`/`interview_feedback` riêng; ghi ngoài bản đồ = CHECK violation 500, plan-review H3). **Ghi nhận cho audit:** `recruiter` giữ 7 cặp sensitive @Company với `requires_two_factor=false` (tiền lệ `hr`/`asset-manager` — chốt có chủ đích, đổi ở AUTH nếu chính sách 2FA mở rộng). **Đặt tên hai namespace CỐ Ý khác nhau** (plan-review LOW): `object_type` audit dùng snake (`job_opening`) theo họ giá trị có sẵn trong CHECK, resource cặp quyền dùng dash (`job-opening`) theo quy ước engine — census/grep phải quét CẢ HAI. **Nghiệm thu thêm (plan-review M8):** sau seed, `SuperAdminBootstrapService` giải được đúng 7 cặp sensitive mới (wildcard `*:*` không thoả cổng sensitive — tiền lệ `leave-audit.service`) | `super-admin` KHÔNG enumerate (bootstrap). `recruiter` **không** vào enumerate canonical (`DashCanonicalRole`/`NOTI_CANONICAL_ROLES`/pin `auth-seed-canonical-roles` giữ 4 role). Cặp sensitive ⇒ WO BE khai **allowlist capability BACKEND** trước khi FE render màn quản trị |
| **C** (`0561`) | Seed NOTI: 4 event `RECRUIT_JOB_ASSIGNED` · `RECRUIT_INTERVIEW_SCHEDULED` · `RECRUIT_STAGE_CHANGED` · `RECRUIT_CANDIDATE_HIRED` vào `notification-event-catalog.const.ts` (`module:'RECRUIT'`, `type:'Recruit'`, `isEnabled:true`) + `notification_events` với **`dedupe_strategy='DedupeKey'`, `dedupe_window_seconds=NULL`** cả 4 (mặc định `'None'` làm tầng dedupe biến mất — `0538:707`) · INSERT dùng `ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING` (bare ⇒ `42P10`) · template · **nới CHECK trên CẢ HAI bảng**: `notification_events` (`module_code += 'RECRUIT'`, `notification_type += 'Recruit'`) **VÀ** `notifications` (cùng hai CHECK, giữ nhánh `IS NULL OR`) — guard LIKE + re-stamp superset tường minh khuôn `0507`/`0529`/`0538`/`0551`/`0555`, **baseline guard forward-compatible** (không RAISE khi module SAU đã nới thêm — `noti-check-baseline-guard-must-be-forward-compatible`) | PHẢI merge TRƯỚC khi `S12-RECRUIT-BE-1` đăng ký registrar outbox (`registerSource()` fail-loud lúc boot). Quên vế `notifications` = lỗi đã ship `0507` |

Giá trị superset hiện hành để re-stamp (đo tại `0555`, **xác minh lại lúc chạy**):

```text
module_code       : 'AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT','ASSET','ROOM'  (+ 'RECRUIT')
notification_type : … 'Goal','Training','Chat','Asset','Room' …                                                  (+ 'Recruit')
```

Ma trận grant §9f (bước B) — **42 hàng**: `employee` 0 · `manager` 3 (`access`@Own · `view:interview`@Own · `feedback:interview`@Own) · `hr` 7 (`access`@Own · `view` job-opening/candidate/interview/offer @Company · `convert:candidate`@Company · `feedback:interview`@Own) · `company-admin` 16 · `recruiter` 16 (`access`@Own · `feedback`@Own · 14 cặp @Company). Sai một hàng verify phải ĐỎ.

**KHÔNG seed `sequence_counters`**: convert dùng lại counter `employee_code` của HR (ensure-on-miss); RECRUIT không có mã tự sinh riêng ở v1.

**KHÔNG có bước D cho widget DASH** (plan-review M5): toàn bộ seed widget «phễu tuyển dụng» (hàng catalog + cặp gác + **sàn scope** `DASH_WIDGET_MIN_DATA_SCOPE` + slug FE `DashboardWidgetGrid`) thuộc **`S12-RECRUIT-DASH-1`** với migration riêng theo khuôn `0558` — cố ý tách khỏi WO DB để wave có thể ship BE/FE/QA trước khi chốt widget (memories `dash-widget-gate-needs-scope-floor` · `fe-widget-slug-map-is-unchecked-runtime-gate`).

Số migration là **dự kiến** — nối tiếp head THẬT tại thời điểm chạy WO.

---

## 10. Đối chiếu bất biến

| Bất biến | Áp dụng trong DB-14 |
| --- | --- |
| #1 `company_id` + RLS FORCE | cả 8 bảng, policy trước INSERT, composite tenant FK mọi FK chéo, `withTenant` ở repo; own-scope interview ép ở service |
| #2 append-only / soft delete | `candidate_stage_events` **append-only tuyệt đối** (0 UPDATE/DELETE — bổ sung danh sách ledger ở erd-current §9 khi build); `interview_participants` chỉ INSERT; không bảng nào có DELETE; `job_openings`/`candidates`/`candidate_notes` soft delete |
| #3 không secret / PII | module không lưu secret; **PII ứng viên + lương offer mask ở server** (7 cặp sensitive); payload NOTI/audit không email/phone/lương; CV private + `file_access_logs` |

---

## 11. Rủi ro dữ liệu đã nhận diện

| Rủi ro | Vì sao nguy hiểm | Chốt chặn |
| --- | --- | --- |
| 2 convert song song lọt qua service | một ứng viên hai hồ sơ nhân viên / một nhân viên hai nguồn | `uq_candidates_company_employee` + `SELECT … FOR UPDATE` hàng candidate; int-spec race; map `23505` → 008 (bóc từ `cause`) |
| 2 offer song song | hai offer sống cùng lúc, kết quả mâu thuẫn | `uq_offers_candidate_open`; map → 006 |
| Stage cột và sổ lệch nhau | timeline nói dối | UPDATE + INSERT event cùng transaction (một service method duy nhất `moveStage`); không có đường UPDATE stage nào khác |
| `dedupe_strategy` để `'None'` | dedupeKey thành chuỗi trang trí | §9C: `'DedupeKey'` ngay seed đầu |
| Quên nới CHECK `notifications` | mọi notification RECRUIT vỡ khi INSERT | bước C làm cả hai bảng cùng migration, verify fail-loud |
| Baseline guard NOTI RAISE vô điều kiện | module SAU nới CHECK làm test module TRƯỚC đỏ | guard forward-compatible (đã có tiền lệ H1) |
| `SET NULL` trên FK composite / trên bảng chỉ-INSERT | SET NULL cả `company_id` (nổ NOT NULL) / ghi đè cột không grant | §4.2: `SET NULL (col)` chỉ ở bảng mutable; bảng chỉ-INSERT dùng `NO ACTION` |
| Thêm `recruiter` vào enumerate canonical | pin `auth-seed-canonical-roles`/`DashCanonicalRole` đỏ | §9B ghi rõ **không** canonical |
| Email/phone unique "cho sạch" | chặn ứng viên nộp lại sau 6 tháng — sai nghiệp vụ (cảnh báo mềm là DEC) | §4.8: không unique, chỉ index |
| Cắt `Hired` khỏi Zod move-stage «cho chặt» | mã 014 thành mã CHẾT — request không bao giờ tới service (`equal-caps-at-zod-and-service-make-dead-error-code`) | §7 dòng cuối (plan-review B2): Zod đủ 6 giá trị, service chặn `Hired` bằng 014; census mã lỗi phải thấy 014 ≥ 1 ca |
| Quên `cleanupTenants` 8 bảng | 364-test-đỏ kiểu `drop-table-must-clean-test-teardown` | §9A cùng commit, thứ tự con→cha, trước `DELETE FROM users` |
