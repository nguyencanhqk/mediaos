# S12-RECRUIT-DB-1 — Micro-plan (🔴 RED · crown · FULL gate)

> **WO:** `harness/backlog.mjs` › `S12-RECRUIT-DB-1` · module RECRUIT · layer DB · zone **red**
> **Nguồn sự thật:** [DB-14](<../DB/DB-14 RECRUIT Database Design.md>) §6/§9 · [SPEC-12](<../SPEC/SPEC-12 RECRUIT.md>) §11/§12/§17/§18 · [permission-matrix §9f](../permission-matrix-spec.md)
> **Phụ thuộc:** ✅ `S12-RECRUIT-DOC-1` (SPEC-12 Approved · DB-14 · API-17 · §9f — plan-reviewer PASS 2 vòng 31/08/2026)
> **Lane migration NỐI TIẾP duy nhất của wave S12-RECRUIT.**

---

## 1. Phạm vi — làm gì / KHÔNG làm gì

**LÀM (bước A·B·C của DB-14 §9):**

| Migration                                      | Nội dung                                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `0559_s12recruitdb1_recruit_core.sql`          | 8 bảng MỚI + RLS ENABLE/FORCE + policy literal-GUC + 27 composite tenant FK + CHECK + 13 index + GRANT theo §6 + VERIFY fail-loud |
| `0560_s12recruitdb1_seed_role_perms_audit.sql` | role hệ thống `recruiter` · **16 cặp** quyền (7 sensitive) · **42 grant** §9f · UNION-ADD **4** `audit_logs.object_type`          |
| `0561_s12recruitdb1_noti_recruit.sql`          | nới CHECK `module_code`/`notification_type` trên **CẢ HAI** bảng · **4 event** `DedupeKey` · 4 template IN_APP/vi-VN              |

Cùng commit (parity/hot-file): `schema/recruit.ts` + `schema/index.ts` · `schema/audit.ts` (`AUDIT_OBJECT_TYPES` += 4) ·
`notification-event-catalog.const.ts` (`NotiModuleCode` += `RECRUIT`, `NotiType` += `Recruit`, 4 entry, pin 67→71 / 53→57) ·
`packages/contracts/src/recruit.ts` + `recruit.spec.ts` + barrel + `notification.ts` (`Recruit`) ·
`test/helpers/seed.ts` `cleanupTenants()` 8 bảng con→cha · `test/integration/rls-registry.ts` 8 case ·
`s12-recruit-db1-invariants.int-spec.ts` (mới) · bump pin `noti-seed-catalog-permissions` + `s5-noti-fix1-deeplink` (53→57 template).

**KHÔNG LÀM (ranh giới cứng):**

- ❌ **KHÔNG bật `modules.RECRUIT`** (`is_active` giữ `false`; hàng đã pre-seed từ `0435`). Bật ở `S12-RECRUIT-FE-1` theo khuôn `0556`/`0557`; pin `EXTENSION_INACTIVE_MODULES` của `migration-smoke` GIỮ `RECRUIT` ở WO này.
- ❌ **KHÔNG seed widget DASH** «phễu tuyển dụng» — thuộc `S12-RECRUIT-DASH-1` (DB-14 §9, plan-review M5): widget cần cả hàng catalog + cặp gác + **sàn scope** + slug FE, tách ra để wave ship BE/FE/QA trước.
- ❌ **KHÔNG seed `sequence_counters`** — convert dùng lại counter `employee_code` của HR (ensure-on-miss).
- ❌ **KHÔNG `db:generate`** — DDL viết tay (drizzle-kit sẽ DROP schema media/finance đang park). `schema/recruit.ts` là **PARITY-only**.
- ❌ **KHÔNG** thêm `recruiter` vào enumerate canonical (`DashCanonicalRole` / `NOTI_CANONICAL_ROLES` / pin `auth-seed-canonical-roles` giữ 4 role).
- ❌ **KHÔNG** DTO request/response RECRUIT (việc của `S12-RECRUIT-BE-1` theo API-17) — WO này chỉ **enum mirror CHECK**.

---

## 2. Bước A — `0559` DDL (8 bảng)

### 2.1 Thứ tự bắt buộc (bất biến #1 · CLAUDE §3)

`CREATE TABLE` → `ENABLE RLS` → `FORCE RLS` → `CREATE POLICY tenant_isolation` (USING **+** WITH CHECK) → composite FK → index → GRANT.
Policy tạo **TRƯỚC** mọi INSERT; migrator chạy 1 transaction ⇒ `RAISE EXCEPTION` = rollback sạch cả 8 bảng.

### 2.2 GRANT (allowlist — bất biến #2)

| Bảng                                                             | `mediaos_app`                                                                                               | Ghi chú                                        |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `job_openings` · `candidates` · `candidate_notes` · `interviews` | `SELECT, INSERT, UPDATE` (cấp bảng)                                                                         | KHÔNG DELETE (soft delete = UPDATE)            |
| `candidate_stage_events`                                         | **`SELECT, INSERT`**                                                                                        | **append-only tuyệt đối** — 0 UPDATE, 0 DELETE |
| `interview_participants`                                         | **`SELECT, INSERT`**                                                                                        | đổi người = huỷ lượt + tạo lượt mới            |
| `interview_feedbacks`                                            | `SELECT, INSERT` + `UPDATE (rating, comment, recommendation, updated_at)`                                   | cấp CỘT                                        |
| `offers`                                                         | `SELECT, INSERT` + `UPDATE (title, start_date, salary, note, status, responded_at, updated_at, updated_by)` | cấp CỘT                                        |

`mediaos_worker`: `SELECT` cấp bảng, **0** column-ACL, cả 8 bảng.
⚠️ KHÔNG phát GRANT bảng rồi thu hồi (`revoke-table-grant-wipes-column-grants`).
⚠️ `candidates` GRANT UPDATE **cấp bảng** là chấp nhận CÓ CHỦ ĐÍCH (DB-14 §6.2 / plan-review H6): `stage` + `employee_id` phải ghi được qua chính app role; bất biến giữ bằng service một-method + `uq_candidates_company_employee` + sổ append-only.

### 2.3 Composite tenant FK — **27** dòng (DƯƠNG đúng-bằng)

| Bảng                         | Cột → đích (`deltype`)                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `job_openings` (6)           | `org_unit_id`→org_units `a` · `position_id`→positions `a` · `recruiter_user_id`/`created_by`/`updated_by`/`deleted_by`→users `n` (SET NULL **liệt kê cột**) |
| `candidates` (5)             | `job_opening_id`→job_openings `a` · `employee_id`→employee_profiles `a` · `created_by`/`updated_by`/`deleted_by`→users `n`                                  |
| `candidate_stage_events` (2) | `candidate_id`→candidates `a` · **`acted_by`→users `a` (NO ACTION)** — bảng chỉ-INSERT, SET NULL sẽ ghi đè cột không có grant UPDATE (đính chính `0549`)    |
| `candidate_notes` (4)        | `candidate_id`→candidates `a` · `*_by`→users `n`                                                                                                            |
| `interviews` (3)             | `candidate_id`→candidates `a` · `created_by`/`updated_by`→users `n`                                                                                         |
| `interview_participants` (2) | `interview_id`→interviews `a` · `employee_id`→employee_profiles `a` — **0 FK users**                                                                        |
| `interview_feedbacks` (2)    | `interview_id`→interviews `a` · `interviewer_employee_id`→employee_profiles `a` — **0 FK users**                                                            |
| `offers` (3)                 | `candidate_id`→candidates `a` · `created_by`/`updated_by`→users `n`                                                                                         |

FK nội bộ = `NO ACTION` (kiểm cuối câu lệnh), **TUYỆT ĐỐI KHÔNG `RESTRICT`** (cascade từ `companies` xoá anh em theo thứ tự bất định ⇒ `cleanupTenants` chết hàng loạt).
`company_id` cả 8 bảng: `REFERENCES companies(id) ON DELETE CASCADE`, DEFAULT literal-GUC.

### 2.4 VERIFY fail-loud của `0559` (khuôn `0549` §7)

1. 8 bảng `relrowsecurity AND relforcerowsecurity` + policy `tenant_isolation` soi GUC ở **CẢ** `USING` lẫn `WITH CHECK`.
2. ACL bằng **`aclexplode`** (KHÔNG `information_schema.column_privileges`): app cấp bảng đúng-bằng kỳ vọng; column-UPDATE đúng-bằng allowlist (thiếu **hoặc** thừa đều đỏ); 0 column-ACL ngoài UPDATE; worker `{SELECT}` + 0 column-ACL. `candidate_stage_events`/`interview_participants` = `{INSERT, SELECT}`; **0 DELETE trên cả 8 bảng**.
3. Composite FK: `EXCEPT` hai chiều so **27 dòng** (bảng, cột, đích, deltype, setcols) + đếm thô `FK ≥ 2 cột = 27` (bịt điểm mù "FK lệch hình dạng rớt khỏi cả hai vế") + `0` FK một-cột tới bảng ≠ `companies`.
4. `UNIQUE (company_id, id)` hậu kiểm trên 3 bảng đích nội bộ (`job_openings`, `candidates`, `interviews`).
5. Predicate partial unique so **đúng chuỗi** `pg_get_expr(indpred)` (không `ILIKE '%WHERE%'`) cho `uq_candidates_company_employee` (`(employee_id IS NOT NULL)`) và `uq_offers_candidate_open`; + 2 index biểu-thức check-duplicate **cố ý KHÔNG partial theo `deleted_at`**; + index thường tồn tại theo tên.

### 2.5 Bẫy DDL đã nhận diện

- `chk_offers_responded_pair` buộc "vào terminal" là **MỘT** câu UPDATE (`status` + `responded_at` cùng lúc) — ghi vào comment migration cho WO BE.
- Hai index check-duplicate phải là **BIỂU THỨC** (`lower(email)` · `regexp_replace(phone,'[^0-9+]','','g')`) khớp từng ký tự với biểu thức service; **DoD:** `EXPLAIN` trên `LANE_DB` chứng minh planner đi qua chúng — không assert chay (`pg-planner-index-assert-trap`).
- `uq_candidates_company_employee` **KHÔNG** partial theo `deleted_at` (một nhân viên chỉ link đúng một ứng viên, kể cả hồ sơ xoá mềm).

---

## 3. Bước B — `0560` seed role · quyền · audit

- `modules.RECRUIT`: **chỉ verify TỒN TẠI**, guard **forward-compatible** — RAISE **chỉ khi** hàng không tồn tại, **KHÔNG** RAISE khi `is_active = true` (bài học `module-enable-guard-blocks-next-wo` 0550/0554; kẻo chính `S12-RECRUIT-FE-1` bật cờ xong là ca idempotency chạy lại file này ném P0001).
- Role `recruiter`: `id` cố định `…0014` (…0013 = `office-admin`) · `company_id NULL` · `is_system = true` · `requires_two_factor = false` **tường minh** · `ON CONFLICT DO NOTHING`.
- **16 cặp** `permissions` — **7 cặp `resource_type='candidate'` `is_sensitive = TRUE`**, 9 cặp còn lại `false`; `ON CONFLICT (action, resource_type) DO NOTHING`.
- **42 grant** per-(role, pair) §9f: `employee` 0 · `manager` 3 · `hr` 7 · `company-admin` 16 · `recruiter` 16. Đổi scope = `DELETE` đúng bộ scope SAI (per-pair, KHÔNG blanket) + `INSERT … ON CONFLICT (role_id, permission_id, effect) DO NOTHING` (unique KHÔNG gồm `data_scope`).
- **UNION-ADD 4** `object_type`: `job_opening` · `candidate` · `interview` · `offer` — **clone NGUYÊN khối `0545`** (neo 2 tầng `object_type = ANY(…)`, fail-closed, NO-LOSS + NO-GAIN). KHÔNG clone `0506`.
- Mọi câu đếm role **NEO** `company_id IS NULL AND deleted_at IS NULL`.
- Census grant phủ **4 hình dạng wildcard**: đếm theo `action IN (act,'*') AND resource_type IN (res,'*')` (`permission-grant-census-must-cover-four-wildcard-shapes`) — census exact-shape một mình mù trước hàng `*:*`.
- **Hai namespace CỐ Ý khác nhau**: `object_type` audit dùng **snake** (`job_opening`), resource cặp quyền dùng **dash** (`job-opening`).
- `super-admin` KHÔNG enumerate (verify 0 hàng system role tên đó).

---

## 4. Bước C — `0561` NOTI

- Nới CHECK trên **CẢ HAI** bảng: `notification_events` (`module_code += 'RECRUIT'`, `notification_type += 'Recruit'`) **VÀ** `notifications` (cùng hai CHECK, **GIỮ nhánh `IS NULL OR`**). Quên vế `notifications` = lỗi đã ship ở `0507`.
- **Baseline guard forward-compatible** (`noti-check-baseline-guard-must-be-forward-compatible`): chỉ ĐỎ khi re-stamp thật sự sắp chạy (CHECK chưa có `RECRUIT`/`Recruit`); module SAU nới thêm giá trị không làm file này đỏ khi replay.
- 4 event GLOBAL, `dedupe_strategy='DedupeKey'`, `dedupe_window_seconds = NULL` (mặc định `'None'` làm tầng dedupe biến mất — `0479`/`0507`/`0538:707`), `is_enabled=true`, `is_system_event=false`; priority Normal (016/018/019) · **High (017)**.
- `ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING` (bare ⇒ `42P10`).
- 4 template IN_APP/vi-VN, `target_url_template` **KHÔNG NULL** (pin `s5-noti-fix1-deeplink`), payload **không** email/phone/lương (bất biến #3) — `full_name` là projection DUY NHẤT được phép (SPEC-12 §18).
- PHẢI merge **TRƯỚC** khi `S12-RECRUIT-BE-1` đăng ký registrar outbox (`registerSource()` fail-loud lúc boot).

---

## 5. Hợp đồng Zod (`packages/contracts/src/recruit.ts`)

Mirror CHECK **HAI CHIỀU, ĐÚNG BẰNG** — 6 enum: candidate stage (6 giá trị) · job status (4) · interview status (3) · offer status (5) · stage-event action (2) · recommendation (3) + `RECRUIT_RATING_MIN/MAX`.
`recruitMoveStageTargetSchema` giữ **ĐỦ 6 giá trị** — cắt `Hired` «cho chặt» biến **RECRUIT-ERR-014** thành mã CHẾT (`equal-caps-at-zod-and-service-make-dead-error-code`); chặn `Hired` là việc của service.
Pin hai chiều ở `recruit.spec.ts` bằng **mảng literal chép từ SQL** (KHÔNG import từ drizzle/chính file — tautology).
Barrel: export prefix `recruit*`/`Recruit*`/`RECRUIT_*` — không đụng export park media (`contracts-barrel-collides-with-parked-media`, TS2308).

---

## 6. Test — `s12-recruit-db1-invariants.int-spec.ts`

Gate `hasDb` (KHÔNG gate `LANE_DB`). Mọi ca ÂM assert `err.code` **+** `err.constraint` đích danh và có **ĐỐI CHỨNG DƯƠNG trên cùng constraint** (ca âm neo theo tên vẫn xanh nếu index bị viết nhầm thành non-partial cùng tên). Mọi mutation trong tx ROLLBACK.

| Nhóm            | Ca                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. GRANT        | A1 `candidate_stage_events` KHÔNG UPDATE/DELETE (42501) + đối chứng INSERT/SELECT OK · A2 `interview_participants` KHÔNG UPDATE/DELETE · A3 column-UPDATE ngoài allowlist của `offers`/`interview_feedbacks` → 42501 (đối chứng cột trong allowlist OK) · A4 KHÔNG DELETE trên cả 8 bảng · A5 worker chỉ SELECT                                                         |
| B. composite FK | B1 `candidates.job_opening_id` chéo tenant → 23503 đích danh · B2 `interview_participants.employee_id` chéo tenant · B3 `candidate_stage_events.acted_by` chéo tenant · B4 `offers.candidate_id` chéo tenant (+ đối chứng cùng tenant OK)                                                                                                                               |
| C. unique       | C1 hai offer sống → 23505 `uq_offers_candidate_open`; đóng offer cũ (Withdrawn + responded_at) rồi tạo mới → OK · C2 hai candidate cùng `employee_id` → 23505 `uq_candidates_company_employee`, kể cả khi hàng đầu **đã xoá mềm** (chứng minh KHÔNG partial theo `deleted_at`) · C3 feedback lần 2 cùng (interview, interviewer) → 23505 · C4 participant trùng → 23505 |
| D. CHECK        | D1 `chk_offers_responded_pair` hai chiều · D2 `chk_cse_moved` (from = to) · D3 `chk_feedback_rating` biên 1/5 OK, 0/6 đỏ · D4 `chk_interviews_range` · D5 stage/status ngoài tập → 23514 đích danh                                                                                                                                                                      |
| E. RLS          | E1 không GUC ⇒ 0 hàng; GUC A không thấy hàng B (8 bảng qua `rls-registry`)                                                                                                                                                                                                                                                                                              |
| F. seed 0560    | F1 đúng **42** grant §9f (census **4 hình dạng wildcard**), `employee` 0 hàng, 7 cặp `candidate` `is_sensitive=true`, `recruiter` is_system + `requires_two_factor=false` + **KHÔNG** canonical · F2 CHECK audit chứa 4 giá trị mới **VÀ** canary cũ (`employee`/`user`) còn (NO-LOSS)                                                                                  |
| G. seed 0561    | G1 `notifications` nhận `module_code='RECRUIT'`/`notification_type='Recruit'` dưới app role; giá trị lạ → 23514 đích danh · G2 4 event global DedupeKey/enabled + 4 template có `target_url` + `variables_schema`                                                                                                                                                       |
| H. idempotency  | H1 chạy lại NGUYÊN `0560` + `0561` qua owner ⇒ 0 exception, count roles/permissions/role_permissions/events/templates KHÔNG đổi                                                                                                                                                                                                                                         |
| I. index        | I1 `EXPLAIN` hai truy vấn check-duplicate đi qua `idx_candidates_company_email_expr` / `idx_candidates_company_phone_norm` (DoD DB-14 §6.2 — có `ANALYZE` + `enable_seqscan=off` để planner không chọn seq-scan trên bảng rỗng)                                                                                                                                         |

---

## 7. Rủi ro & chốt chặn

| Rủi ro                                       | Chốt                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Quên `cleanupTenants` 8 bảng                 | `afterAll` đỏ hàng loạt (`drop-table-must-clean-test-teardown`) — thêm CÙNG commit, thứ tự con→cha, **trước** `DELETE FROM users` |
| `SET NULL` trần trên composite FK            | null luôn `company_id` (NOT NULL) — **PHẢI** `SET NULL (col)` liệt kê cột (`0535:682`)                                            |
| `SET NULL` trên bảng chỉ-INSERT              | RI action chạy tầng owner, ghi đè cột không grant UPDATE — `acted_by` dùng `NO ACTION`                                            |
| Guard module RAISE khi `is_active=true`      | chặn `S12-RECRUIT-FE-1` — guard chỉ kiểm TỒN TẠI                                                                                  |
| `dedupe_strategy` để `'None'`                | dedupeKey thành chuỗi trang trí — set `'DedupeKey'` ngay seed đầu                                                                 |
| Quên vế `notifications` khi nới CHECK        | mọi notification RECRUIT vỡ lúc INSERT — verify đếm đủ **4/4** CHECK                                                              |
| Cắt `Hired` khỏi Zod move-stage              | RECRUIT-ERR-014 thành mã chết — enum giữ đủ 6, có ca test                                                                         |
| Barrel `contracts/index.ts` đụng export park | TS2308 — prefix `recruit*`                                                                                                        |

---

## 8. Definition of Done

- [ ] 3 migration đánh số **nối tiếp head THẬT** lúc chạy (đọc `meta/_journal.json`), có mặt trong journal, `when` tăng đơn điệu.
- [ ] RLS + FORCE + policy TRƯỚC mọi dữ liệu; 27 composite FK verify DƯƠNG đúng-bằng; 0 FK một-cột ngoài `companies`.
- [ ] `candidate_stage_events` 0 quyền UPDATE/DELETE cho app role (verify trong migration **và** int-spec).
- [ ] 16 cặp / 7 sensitive / 42 grant verify fail-loud; census phủ 4 hình dạng wildcard.
- [ ] NOTI: 4/4 CHECK nới trên CẢ HAI bảng; 4 event `DedupeKey`; 4 template có `target_url_template`.
- [ ] Zod mirror CHECK hai chiều đúng bằng; `pnpm typecheck` + `pnpm lint` + `pnpm test` xanh.
- [ ] `bash harness/check.sh --lane-db` (deny-path chạy THẬT) trước khi mở PR.
- [ ] `harness/backlog.mjs` cập nhật; `docs/erd-current.md` ghi 8 bảng + sổ append-only mới.
