# MVP WORK BREAKDOWN — Hệ thống QLDN (de-media-fy)

> **TỰ SINH** từ gap-analysis (workflow `gap-analysis-mvp`, 2026-06-21): 12 agent đọc spec/docs ↔ code thật.
> Dữ liệu máy-đọc đầy đủ: `docs/plans/mvp-work-orders.json` (141 WO). File này là VIEW người-đọc; hàng đợi vận hành = `harness/backlog.mjs`.
> Nguồn chuẩn sản phẩm = `docs/spec/` + `docs/{BACKEND,FRONTEND,API Design,DB,QA}/`. Khi mâu thuẫn → spec thắng.

## 1. Tóm tắt điều hành

- **Tổng: 141 Work Order** trên 12 nhóm module.
- Zone: 🔴 81 đỏ · 🟡 39 vàng · 🟢 21 xanh. (đỏ ⇒ phần lớn cần người + FULL gate.)
- Layer: db 24 · be 61 · fe 35 · qa 16 · integration 5.
- Effort: M 51 · L 73 · XL 17 (XL = phải chia nhỏ thêm khi vào sprint).

**Phát hiện cốt lõi:** code nền G1–G16 (RLS·permission·audit·outbox) vững, nhưng **9/12 module `wrong-shape`** — build theo hướng media cũ, lệch spec MVP. AUTH `substantial` (gần đủ), LEAVE & QA `partial`. Đây là một đợt **build lại theo spec**, không phải vá nhỏ.

## 2. Thứ tự triển khai (critical path)

Theo dependency IMPLEMENTATION-01 §10: **FOUNDATION → AUTH → HR → ATT/LEAVE → TASK/NOTI/DASH → FE → INTEGRATION → QA/Release**. FOUNDATION mở khóa tất cả (audit-shape·settings·files·sequence·holidays). FE-CORE (vỏ apps/app + permission shape) hội tụ TRƯỚC module-FE.

| Wave | Sprint | codeState | #WO |
| --- | --- | --- | ---: |
| FOUNDATION | S1 | wrong-shape | 15 |
| AUTH | S2 | substantial | 6 |
| HR | S2 | wrong-shape | 14 |
| ATT | S3 | wrong-shape | 16 |
| LEAVE | S3 | partial | 13 |
| TASK | S4 | wrong-shape | 13 |
| NOTI | S4 | wrong-shape | 11 |
| DASH | S4 | wrong-shape | 11 |
| FE-CORE | - | wrong-shape | 8 |
| FE-MODULES | - | wrong-shape | 15 |
| INTEGRATION | S5 | none | 9 |
| QA-RELEASE | - | partial | 10 |

## 3. Phân rã theo module

### FOUNDATION — `wrong-shape` (15 WO)

> Hạ tầng nền G1–G16 ĐÃ có (RLS+FORCE, permission engine 4-tier, outbox, audit append-only, S3/MinIO presign, bảng companies) nhưng phần lớn Foundation theo DB-08/BACKEND-04/11 CHƯA tồn tại hoặc LỆCH SHAPE so với spec. Cụ thể: audit_logs đang là shape cũ (object_type/before/after) thay vì DB-08 (module_code/action/sensitivity_level/result_status/changed_fields/old_values/new_values) + thiếu API audit-list admin; settings chỉ là PATCH cột trên companies (không có bảng system_settings/company_settings key-value + precedence + /settings/public); KHÔNG có bảng files/file_links/file_access_logs (chỉ presign S3 ephemeral, task-attachment inline) + thiếu FilePolicy resolver/download-qua-backend/access-log; KHÔNG có sequence_counters (chưa có nextCode row-lock), public_holidays (chỉ check weekday từ workingDaysJson), data_retention_policies, seed_batches/seed_items; modules là system_modules (bundle feature-flag SaaS) chứ không phải catalog modules + my-apps/favorite/recent. Permission dùng model (action,resource) — Foundation phải seed theo model này, KHÔNG dùng chuỗi FOUNDATION.x.y. Rủi ro bất biến: audit shape mới phải GIỮ append-only (REVOKE UPDATE/DELETE) + masking trước insert (BẤT BIẾN #2/#3); mọi bảng mới phải RLS+FORCE trước backfill company_id; file download phải fail-closed qua permission + access-log, không lộ storage_path/signed_url. Migration head idx 113 (0430) → foundation migration bắt đầu 0431; backlog HIỆN CHƯA có Work Order Foundation nào (chỉ auth/account/console/app-shell).

| ID | Z | Eff | Layer | Depends | Title |
| --- | :-: | :-: | --- | --- | --- |
| `FOUNDATION-DB-1` | 🔴 | M | db | — | Migration system_settings + company_settings (RLS+FORCE) theo DB-08 §8.3/8.4 |
| `FOUNDATION-DB-2` | 🔴 | M | db | — | Migration audit_logs nâng cấp về DB-08 shape (giữ append-only) hoặc bảng audit chuẩn |
| `FOUNDATION-DB-3` | 🔴 | L | db | — | Migration files + file_links + file_access_logs (RLS+FORCE, polymorphic có kiểm soát) theo DB-08 §8.6-8.8 |
| `FOUNDATION-DB-4` | 🔴 | M | db | — | Migration sequence_counters + public_holidays (RLS+FORCE, company_id nullable cho global) theo DB-08 §8.9-8.10 |
| `FOUNDATION-DB-5` | 🔴 | L | db | FOUNDATION-DB-1 | Migration data_retention_policies + seed_batches + seed_items + seed modules catalog/permission/system_settings (idempotent) |
| `FOUNDATION-BE-1` | 🔴 | M | be | FOUNDATION-DB-1, FOUNDATION-BE-3 | SettingService: precedence company→system→default + /settings/public (lọc is_public, mask is_sensitive) + admin update có audit |
| `FOUNDATION-BE-2` | 🔴 | M | be | FOUNDATION-DB-4 | SequenceService.nextCode transaction + FOR UPDATE row lock + preview (không tăng) + ensureCounter |
| `FOUNDATION-BE-3` | 🔴 | L | be | FOUNDATION-DB-2 | AuditService v2 (DB-08 shape) + AuditMaskerService + audit-list/detail API theo permission+scope |
| `FOUNDATION-BE-4` | 🔴 | XL | be | FOUNDATION-DB-3, FOUNDATION-BE-3, FOUNDATION-BE-5 | FileService: upload metadata + StorageAdapter port + link/unlink + download-qua-backend + file_access_log |
| `FOUNDATION-BE-5` | 🔴 | M | be | FOUNDATION-DB-3 | FilePolicyService + FileOwnerPermissionResolver registry (deny-by-default, dispatch theo module_code/entity_type) |
| `FOUNDATION-BE-6` | 🟢 | M | be | FOUNDATION-DB-4 | HolidayService: CRUD public_holidays + isWorkingDay (global+company override) + getHolidaysInRange + internal contract cho ATT/LEAVE |
| `FOUNDATION-BE-7` | 🟡 | M | be | FOUNDATION-DB-5, FOUNDATION-BE-3 | CompanyService /company/current (GET/PATCH có audit) + ModuleCatalogService my-apps (lọc theo permission+module active+setting) |
| `FOUNDATION-BE-8` | 🟡 | L | be | FOUNDATION-DB-5 | SeedTrackingService idempotent + RetentionService CRUD + cleanup job skeleton (dry-run, không xóa thật) |
| `FOUNDATION-BE-9` | 🟢 | M | be | FOUNDATION-BE-1, FOUNDATION-BE-3, FOUNDATION-BE-4, FOUNDATION-BE-6, FOUNDATION-BE-7 | FoundationModule + foundation contracts (Zod DTO) + wire vào app.module.ts (additive) |
| `FOUNDATION-QA-1` | 🔴 | L | qa | FOUNDATION-BE-1, FOUNDATION-BE-2, FOUNDATION-BE-3, FOUNDATION-BE-4, FOUNDATION-BE-6, FOUNDATION-BE-7, FOUNDATION-BE-8 | QA hardening Foundation: permission/scope + file security + sequence concurrency + audit masking + public settings leak |

### AUTH — `substantial` (6 WO)

> Backend AUTH đã land dày và đúng hướng spec: login/refresh/logout/me/forgot/reset/change-password + 2FA + token-family + rate-limit + replay-guard (auth.controller.ts), admin user list/detail/update/suspend/reactivate/soft-delete có permission guard + isSensitive + audit (admin-users, mig 0430), user-invites (invite/approve/reject/activation), permission engine 4-tier (assign-role/revoke-role/grant-object + GET /org/roles), audit-read (tenant self + operator), security-policy. FE có apps/auth (login+2FA) và apps/console (users-page, permissions-page với assign/revoke/object dialog, activity-log, account, two-factor, security-policy). THIẾU/LỆCH so spec: (1) Role CRUD + permission-catalog list + role→permission editor (AUTH-FUNC-012/013) hoàn toàn chưa có — chỉ list role + gán role-user; (2) users.status drift AU-5 — schema là text tự do default 'active', CHECK chỉ ('active'|'suspended') lowercase, KHÔNG khớp DB-02 6 trạng thái PascalCase, thiếu Pending Activation/Inactive/Locked và luồng Lock/Unlock (AUTH-FUNC-010/011, code mới chỉ suspend/reactivate); (3) thiếu bảng login_logs (DB-02 §704) cho AUTH-FUNC-017 + 'last login' ở hồ sơ; (4) FE quên/đặt-lại mật khẩu (AUTH-SCREEN-002/003) chưa có route dù backend sẵn; (5) màn hồ sơ cá nhân (AUTH-SCREEN-005) chưa có nhà ở (chờ apps/app). Rủi ro bất biến: WO trạng thái user CHẠM auth/login allow-list → ĐỎ, phải giữ fail-closed (chỉ Active cấp token) và migration RLS-an-toàn; KHÔNG hard-delete.

| ID | Z | Eff | Layer | Depends | Title |
| --- | :-: | :-: | --- | --- | --- |
| `AUTH-DB-1` | 🔴 | M | db | — | Đồng bộ users.status với DB-02 (6 trạng thái PascalCase) + bảng login_logs |
| `AUTH-BE-1` | 🔴 | M | be | AUTH-DB-1 | Login deny-path đủ trạng thái + ghi login_logs + Lock/Unlock user (AUTH-FUNC-010/011) |
| `AUTH-BE-2` | 🔴 | L | be | — | Role CRUD + permission-catalog list + gán permission cho role (AUTH-FUNC-012/013) |
| `AUTH-FE-1` | 🟢 | M | fe | — | FE quên mật khẩu + đặt lại mật khẩu trong apps/auth (AUTH-SCREEN-002/003) |
| `AUTH-FE-2` | 🟡 | M | fe | AUTH-BE-2 | FE quản trị Role/Permission: list role, editor role + gán permission (AUTH-SCREEN-010/011/012) |
| `AUTH-QA-1` | 🔴 | M | qa | AUTH-BE-1, AUTH-BE-2 | QA deny-path AUTH: trạng thái login + Role/Permission RBAC + reset token |

### HR — `wrong-shape` (14 WO)

> Code thật hiện CÓ: org_units/teams + positions (CRUD qua PermissionGuard, RLS, audit) và một bảng employee_profiles "media-era" gắn trên users (employees CRUD + import CSV + mask base_salary + employee_manager_relations). NHƯNG shape LỆCH spec nặng: SPEC-03/DB-03 yêu cầu bảng employees giàu trường hồ sơ nhân sự (full_name/date_of_birth/gender/identity_*/contact/emergency/employment_status enum Probation/Official/Resigned/Terminated...) + 11 bảng phụ (job_levels, contract_types, employee_contracts, employee_status_histories, employee_files, profile_change_requests + items, employee_code_configs, sequence_counters) — TẤT CẢ đang THIẾU. THIẾU hẳn các luồng đỏ: change-status có status history, link/unlink user↔AUTH, field-level masking theo HR.EMPLOYEE.VIEW_SENSITIVE (hiện chỉ mask salary), FSM yêu cầu cập nhật hồ sơ cá nhân (Employee self-service có duyệt), sinh employee_code theo config + sequence khóa, audit-log view, export, org-chart/subordinates. Catalog quyền chỉ có resource employee/org_unit/position — thiếu toàn bộ mã HR.* mới (VIEW_SENSITIVE, CHANGE_STATUS, FILE_*, PROFILE_CHANGE_REQUEST.*, EMPLOYEE_CODE*.*, CONTRACT.*, MASTER_DATA.MANAGE). API prefix lệch (/employees, /org thay vì /hr/*). FE phân mảnh ở apps/people (employees/departments/positions/teams media-era), CHƯA có apps/app hợp nhất và thiếu Hồ sơ của tôi, hợp đồng, file, profile-change-request, cấu hình mã. Rủi ro bất biến: profile-change-request + change-status + sinh mã là FSM/race-sensitive (đỏ); migration phải RLS+FORCE trước backfill; audit object_types append-only; employees đổi shape phải giữ liên kết user_id cho AUTH/ATT/LEAVE đang phụ thuộc. Migration head hiện tại = 0430.

| ID | Z | Eff | Layer | Depends | Title |
| --- | :-: | :-: | --- | --- | --- |
| `HR-DB-1` | 🔴 | L | db | — | Master-data + employees core: bảng job_levels/contract_types + mở rộng/đổi shape employees theo DB-03 (RLS+FORCE) |
| `HR-DB-2` | 🔴 | L | db | HR-DB-1 | Bảng contract/file/status-history + sequence_counters + employee_code_configs (RLS+FORCE, append-only status history) |
| `HR-DB-3` | 🔴 | M | db | HR-DB-1 | Bảng profile_change_requests + items (FSM self-service) RLS+FORCE |
| `HR-DB-4` | 🔴 | M | db | HR-DB-1, HR-DB-2, HR-DB-3 | Permission catalog HR.* + audit object_types union (append-only seed) |
| `HR-BE-1` | 🔴 | XL | be | HR-DB-1, HR-DB-4 | Đổi shape contracts + service employees theo SPEC: detail/list/create/update với field-level masking VIEW_SENSITIVE |
| `HR-BE-2` | 🔴 | L | be | HR-BE-1, HR-DB-2 | Change-status + status history + link/unlink user (AUTH) + resign khóa tài khoản |
| `HR-BE-3` | 🔴 | L | be | HR-BE-1, HR-DB-2 | Employee-code config + preview + sinh mã khóa sequence + lock/unlock override |
| `HR-BE-4` | 🔴 | XL | be | HR-BE-1, HR-DB-3 | Profile change request FSM: self-service tạo/hủy + admin duyệt/từ chối áp dữ liệu vào hồ sơ |
| `HR-BE-5` | 🟡 | L | be | HR-BE-1, HR-DB-2, HR-DB-4 | Employee contracts CRUD + set-primary + contract types/job levels master-data + org-chart/subordinates + export |
| `HR-BE-6` | 🟡 | M | be | HR-BE-1, HR-DB-2 | Employee file upload/link + signed download-url qua FILE_* permission |
| `HR-FE-1` | 🟡 | XL | fe | HR-BE-1 | apps/app shell hợp nhất + module HR: danh sách/chi tiết/thêm/sửa nhân viên + departments/positions qua PermissionGate |
| `HR-FE-2` | 🟡 | L | fe | HR-BE-4, HR-FE-1 | Hồ sơ của tôi + Yêu cầu cập nhật hồ sơ (self-service) + màn admin duyệt/từ chối |
| `HR-FE-3` | 🟢 | L | fe | HR-BE-3, HR-BE-5, HR-BE-6, HR-FE-1 | FE hợp đồng/tài liệu/cấu hình mã + master-data + org-chart cơ bản |
| `HR-QA-1` | 🔴 | L | qa | HR-BE-2, HR-BE-3, HR-BE-4, HR-BE-5, HR-BE-6 | QA deny-path + FSM + masking + race mã nhân viên cho HR |

### ATT — `wrong-shape` (16 WO)

> Code ATT hiện tại là bản G11/G12 mỏng (build theo hướng payroll-feed cũ) lệch CHUẨN SPEC-04/DB-04/API-04. DB chỉ có 4 bảng (work_schedules, attendance_records keyed user_id, attendance_adjustment_requests qua Task Hub, attendance_periods) vs 9 bảng spec (thiếu shifts, shift_assignments, attendance_rules, attendance_logs, attendance_adjustment_items, remote_work_requests, remote_work_request_approvals); attendance_records key sai (user_id thay vì employee_id), thiếu ~25 cột (department/position snapshot, attendance_source, work_mode, applied_rule_id, required/working/missing minutes, leave/remote linkage, calc_snapshot), enum status chỉ 7 trạng thái vs 16 spec. Permission dùng shape generic (action,resource='attendance') thay vì catalog granular ATT.RESOURCE.ACTION; API ~14 endpoint vs ~40 spec (thiếu team/company records, detail+logs, manual-adjust, recalculate, export, remote-work, shift CRUD, shift-assignment, rule CRUD, audit-log, internal jobs). Tích hợp LEAVE event-driven, remote/auto-attendance, mask GPS/IP/device (VIEW_SENSITIVE) đều chưa có; FE chưa có màn ATT nào (ATT-SCREEN-001…019). RỦI RO BẤT BIẾN: re-key attendance_records sang employee_id + đổi status enum là migration nặng — phải RLS+FORCE trước backfill, append-only audit object_types; FSM duyệt điều chỉnh/remote là vùng đỏ crown-jewel.

| ID | Z | Eff | Layer | Depends | Title |
| --- | :-: | :-: | --- | --- | --- |
| `ATT-DB-1` | 🔴 | XL | db | — | Migration band ATT: 5 bảng danh mục/rule + re-shape attendance_records sang employee_id (RLS+FORCE trước backfill) |
| `ATT-DB-2` | 🔴 | L | db | ATT-DB-1 | Migration band ATT phần 2: adjustment FSM native + items + remote_work_requests + approvals (RLS+FORCE) |
| `ATT-DB-3` | 🔴 | M | db | ATT-DB-2 | Seed permission catalog ATT granular ATT.RESOURCE.ACTION (ON CONFLICT DO NOTHING) |
| `ATT-BE-1` | 🟡 | L | be | ATT-DB-1 | Rule resolution engine: shift assignment + attendance_rule theo thứ tự ưu tiên (Employee→Dept→Company→System) |
| `ATT-BE-2` | 🔴 | L | be | ATT-BE-1, ATT-DB-3 | Re-shape check-in/check-out/today theo employee_id + attendance_logs + rule engine + mã lỗi ATT-ERR |
| `ATT-BE-3` | 🔴 | L | be | ATT-BE-2 | Bảng công team/company + chi tiết record + logs + recalculate + manual-adjust trực tiếp (mask GPS/IP/device) |
| `ATT-BE-4` | 🔴 | L | be | ATT-BE-3, ATT-DB-2 | FSM duyệt điều chỉnh công native (create/approve/reject/cancel) + apply items + tính lại record |
| `ATT-BE-5` | 🔴 | L | be | ATT-BE-4 | Remote/Business-trip work request: CRUD + FSM duyệt + sinh attendance record AUTO/REMOTE |
| `ATT-BE-6` | 🟡 | L | be | ATT-BE-1, ATT-DB-3 | Shift + Shift Assignment + Attendance Rule CRUD + effective-rule |
| `ATT-BE-7` | 🔴 | M | be | ATT-BE-2 | Tích hợp LEAVE event-driven: ghi/cập nhật record Leave + chặn check-in khi nghỉ Approved |
| `ATT-BE-8` | 🟡 | M | be | ATT-BE-5, ATT-BE-7 | Internal jobs: auto-attendance, missing-checkout, auto-checkout (BullMQ + service token) |
| `ATT-BE-9` | 🟡 | M | be | ATT-BE-3 | Export bảng công + audit-log view ATT (permission riêng, mask theo VIEW_SENSITIVE) |
| `ATT-FE-1` | 🟢 | L | fe | ATT-BE-2, ATT-BE-3, APP-MERGE-1 | FE Chấm công hôm nay + bảng công cá nhân + chi tiết ngày công (apps/app) |
| `ATT-FE-2` | 🟡 | L | fe | ATT-FE-1, ATT-BE-4 | FE bảng công team/company + duyệt điều chỉnh công + điều chỉnh trực tiếp |
| `ATT-FE-3` | 🟢 | L | fe | ATT-FE-2, ATT-BE-5, ATT-BE-6 | FE tạo/gửi điều chỉnh + remote/công tác + quản lý ca/gán ca/rule |
| `ATT-QA-1` | 🔴 | L | qa | ATT-BE-4, ATT-BE-5, ATT-BE-7 | QA deny-path + workflow phê duyệt ATT (permission scope, FSM điều chỉnh/remote, mask sensitive, isolation) |

### LEAVE — `partial` (13 WO)

> Code G11-2 ở apps/api/src/leave/ ĐÃ có nền tốt và đúng bất biến: leave_types CRUD, leave_balances (used/remaining generated, trừ phép race-safe lúc duyệt), leave_requests create→approve/reject/cancel qua Task Hub (task_type='hr'), team calendar tháng, audit+outbox+withTenant(RLS) đầy đủ. NHƯNG lệch/thiếu lớn so với spec: (1) permission dùng 4 verb thô ('read'/'create'/'approve'/'manage','leave') thay vì ~30 mã LEAVE.RESOURCE.ACTION + data_scope của API-05 §6.3; (2) thiếu vòng đời Draft→Submit, PATCH draft, DELETE draft, và Revoke (Approved→Revoked) — DB CHECK status chỉ có pending/approved/rejected/cancelled; (3) thiếu hẳn duration_type/half_day/hourly (schema chỉ full-day theo ngày); (4) thiếu hẳn các bảng leave_policies, leave_balance_transactions (ledger append-only DB-05 §4.6/§7.4), leave_request_days, leave_request_approvals; (5) thiếu đồng bộ LEAVE→ATT (LEAVE-FUNC-018: outbox phát leave.approved nhưng KHÔNG ai consume để tạo bản ghi công Leave/chặn check-in); (6) thiếu adjust/initialize balance có reason+transaction, files, export, calendar theo scope; (7) FE LEAVE chưa tồn tại ở bất kỳ app nào và shell apps/app chưa dựng (APP-MERGE-1 todo). Rủi ro bất biến: ledger balance append-only & FSM phê duyệt (revoke/refund) là crown-jewel — phải fail-closed, migration RLS+FORCE trước backfill, audit cho mọi biến động phép.

| ID | Z | Eff | Layer | Depends | Title |
| --- | :-: | :-: | --- | --- | --- |
| `LEAVE-DB-1` | 🔴 | L | db | — | Mở rộng schema LEAVE theo DB-05: thêm leave_policies, leave_balance_transactions (ledger append-only), leave_request_days, leave_request_approvals + cột duration_type/half_day_session/start_time/end_time + status draft/revoked |
| `LEAVE-DB-2` | 🔴 | M | db | LEAVE-DB-1 | Seed catalog permission LEAVE granular theo API-05 §6.3 (LEAVE.RESOURCE.ACTION) + map role mặc định + data_scope |
| `LEAVE-BE-1` | 🔴 | L | be | LEAVE-DB-2 | Refactor guard LEAVE sang permission granular + data_scope (Own/Team/Department/Company) thay 4 verb thô; cập nhật @RequirePermission từng route theo API-05 §12 |
| `LEAVE-BE-2` | 🔴 | XL | be | LEAVE-DB-1, LEAVE-BE-1 | Vòng đời Draft→Submit + Update/Delete draft + Revoke (Approved→Revoked) với FSM transition fail-closed + hoàn phép REFUND qua ledger |
| `LEAVE-BE-3` | 🟢 | L | be | LEAVE-DB-1 | duration_type (FullDay/HalfDay/Hourly/MultipleDays) + half_day_session/giờ nghỉ vào tính số ngày + validate theo leave_type (allow_half_day/allow_hourly/require_reason/require_attachment) |
| `LEAVE-BE-4` | 🟡 | L | be | LEAVE-DB-1, LEAVE-DB-2 | leave_policies CRUD + resolve policy theo phạm vi (Employee→Department→Company→default) áp dụng khi tạo/duyệt đơn |
| `LEAVE-BE-5` | 🔴 | L | be | LEAVE-DB-1, LEAVE-BE-1 | Balance ledger: adjust (Add/Subtract/Set) + initialize + transaction-view; mọi biến động used/total qua leave_balance_transactions append-only |
| `LEAVE-BE-6` | 🟡 | M | be | LEAVE-BE-1, LEAVE-BE-3 | Calendar theo scope (Own/Team/Department/Company) + Calculate/Validate preview + Export (requests/calendar/balances) |
| `LEAVE-BE-7` | 🔴 | L | integration | LEAVE-BE-2, LEAVE-BE-3 | Đồng bộ LEAVE→ATT: consumer event leave.approved/cancelled/revoked tạo/cập nhật attendance record (status Leave / giảm required minutes / chặn check-in) |
| `LEAVE-BE-8` | 🟡 | M | be | LEAVE-DB-1, LEAVE-BE-1 | Leave request files (link/list/signed-url/unlink) — file chứng minh đơn nghỉ là dữ liệu riêng tư |
| `LEAVE-FE-1` | 🟢 | L | fe | APP-MERGE-1, LEAVE-BE-2, LEAVE-BE-3 | FE self-service nhân viên: tổng quan phép, tạo/sửa nháp/gửi đơn, danh sách + chi tiết đơn của tôi, hủy đơn, lịch nghỉ của tôi |
| `LEAVE-FE-2` | 🟡 | L | fe | LEAVE-FE-1, LEAVE-BE-4, LEAVE-BE-5, LEAVE-BE-6 | FE quản trị HR/Manager: đơn chờ duyệt + duyệt/từ chối/thu hồi, tất cả đơn, lịch nghỉ team/công ty, quản lý loại nghỉ & chính sách, số dư phép & điều chỉnh |
| `LEAVE-QA-1` | 🔴 | M | qa | LEAVE-BE-2, LEAVE-BE-5, LEAVE-BE-7 | QA E2E luồng LEAVE crown-jewel: deny-path permission/scope, FSM transition, trừ/hoàn phép ledger, đồng bộ ATT |

### TASK — `wrong-shape` (13 WO)

> Có NHIỀU code task/project nhưng build theo hướng MEDIA/workflow-DAG cũ, LỆCH SPEC-06. Bảng `tasks` (workflow.ts) là hub phẳng: 1 `assignee_user_id` (không multi-assignee/watcher), FSM media `not_started/in_progress/waiting_review/revision/approved/completed` thay vì spec Todo/In Progress/In Review/Done/Cancelled; THIẾU hẳn task_assignees, task_watchers, task_checklists(+items), task_activity_logs, task_comment_mentions, project_files, task_files. `projects`/`project_members` nằm ở media.ts mang field media (project_channels/teams, content_production type, budget, org_unit) và controller project CRUD ở media/ (không dưới /api/v1/tasks/projects, không có vai trò dự án Owner/Manager/Member/Viewer dùng cho data-scope). Permission là cặp thô (action,resource) — thiếu ~15 quyền granular SPEC §8.2 (CLOSE/ARCHIVE/MANAGE_MEMBER/UPDATE_STATUS/UPDATE_PRIORITY/UPDATE_DEADLINE/WATCH/VIEW_KANBAN/EXPORT/AUDIT_LOG.VIEW…) và CHƯA enforce data-scope Own/Team/Department/Project. Endpoint thiếu: My Tasks nhóm, overdue, Kanban move theo project_state, checklist, watcher, activity-log, report, export. FE chưa có apps/app hợp nhất (APP-MERGE-1 todo); rủi ro bất biến nằm ở migration project-role/scope (RLS+FORCE trước backfill) + FSM trạng thái task (vùng đỏ) + audit append-only object_types. Backlog KHÔNG có WO TASK MVP riêng (chỉ APP-MERGE-1 FE + TRIM-1 trim) → toàn bộ WO dưới đây là MỚI.

| ID | Z | Eff | Layer | Depends | Title |
| --- | :-: | :-: | --- | --- | --- |
| `TASK-DB-1` | 🔴 | L | db | — | Migration: bảng quan hệ TASK còn thiếu (task_assignees, task_watchers, task_checklists+items, task_activity_logs, task_comment_mentions, project_files, task_files) + RLS+FORCE |
| `TASK-DB-2` | 🔴 | M | db | TASK-DB-1 | Migration: chuẩn hóa FSM trạng thái task spec (Todo/In Progress/In Review/Done/Cancelled) song song FSM media legacy + map dữ liệu cũ |
| `TASK-DB-3` | 🔴 | M | db | TASK-DB-1 | Seed permission granular TASK theo SPEC-06 §8.2 + data-scope (Own/Team/Department/Project) ON CONFLICT DO NOTHING |
| `TASK-BE-1` | 🔴 | L | be | TASK-DB-3 | Project domain API dưới /api/v1/tasks/projects (CRUD + close/archive/soft-delete) tách khỏi media projects, dùng vai trò dự án Owner/Manager/Member/Viewer |
| `TASK-BE-2` | 🔴 | M | be | TASK-BE-1 | Project member API (thêm/đổi vai trò/xóa) + ràng buộc access data-scope Project theo membership |
| `TASK-BE-3` | 🔴 | XL | be | TASK-DB-2, TASK-DB-3 | Task core spec-shape: multi-assignee + watcher + status/priority/deadline ops + data-scope enforcement (refactor task hub hiện tại) |
| `TASK-BE-4` | 🟡 | L | be | TASK-BE-3 | My Tasks + Task quá hạn + Kanban board move + report tiến độ + export |
| `TASK-BE-5` | 🟡 | L | be | TASK-BE-3 | Comment (+mention NOTI) · checklist+items · file đính kèm project/task qua FOUNDATION files |
| `TASK-BE-6` | 🔴 | M | be | TASK-BE-3, TASK-BE-5 | Activity log view (TASK.AUDIT_LOG.VIEW) + emit NOTI events theo SPEC-06 §3.7 (assigned/updated/comment/due-soon/overdue/member/status) |
| `TASK-FE-1` | 🟢 | L | fe | TASK-BE-2 | FE màn hình Project (list/create-edit/detail tabs/members) trong apps/app theo PermissionGate + mask server-side |
| `TASK-FE-2` | 🟢 | XL | fe | TASK-BE-4, TASK-FE-1 | FE Task list/detail/create-edit + Việc của tôi + Task quá hạn + Kanban kéo-thả |
| `TASK-FE-3` | 🟢 | M | fe | TASK-BE-4, TASK-BE-6, TASK-FE-1 | FE Báo cáo tiến độ dự án + Lịch sử hoạt động (charts Recharts/Tremor) |
| `TASK-QA-1` | 🔴 | L | qa | TASK-BE-4, TASK-BE-5, TASK-BE-6 | QA permission/data-scope/FSM/deny-path coverage cho TASK ≥80% |

### NOTI — `wrong-shape` (11 WO)

> Code NOTI hiện có được build dưới hướng media cũ (G4/G10/G15) và LỆCH SHAPE so với spec MVP: bảng `notifications` chỉ có id/company_id/user_id/type(text)/ref_id/ref_type/body/is_read/created_at (RLS+FORCE OK, append-only UPDATE is_read), trong khi SPEC-08/DB-07 yêu cầu title/short_content/content/priority(enum)/status(enum 5 trạng thái Unread/Read/Hidden/Archived/Deleted)/source_module/event_code/target_*/payload/dedupe_key/batch_key/read_at/deleted_at + 3 bảng catalog `notification_events`,`notification_templates`,`notification_delivery_logs`. NotificationType enum sai (chat/meeting media thay vì System/Account/HR/Attendance/Leave/Task/Project/Approval/Reminder/Warning/Error). Controller KHÔNG có một `@RequirePermission` nào và KHÔNG có permission NOTI nào được seed (NOTI.NOTIFICATION/EVENT/TEMPLATE/CHANNEL/LOG.* vắng toàn bộ) — đây là rủi ro vùng đỏ (data-scope Own + authz). Endpoint thiếu phần lớn: dropdown, detail, open-target, mark-unread, hide/archive/soft-delete, admin/system notifications, events/templates/channels config, delivery-logs+retry, internal event/send/reminder/cleanup jobs. FE chưa có apps/app shell và toàn bộ màn NOTI-SCREEN-001..010. Migration head = 0430. Có sẵn nền outbox/audit/permission-guard để dùng lại; preference/device-token giữ được.

| ID | Z | Eff | Layer | Depends | Title |
| --- | :-: | :-: | --- | --- | --- |
| `NOTI-DB-1` | 🔴 | L | db | — | Migration: mở rộng notifications + 3 bảng catalog (events/templates/delivery_logs) theo DB-07 — RLS+FORCE trước backfill |
| `NOTI-DB-2` | 🔴 | M | db | NOTI-DB-1 | Seed permission NOTI + audit object_types (append-only UNION) theo SPEC-08 §8 / API-07 §6.3 |
| `NOTI-BE-1` | 🟢 | M | be | NOTI-DB-1 | Đồng bộ contracts NotificationType + DTO theo spec (type enum nghiệp vụ, priority/status/target/payload) |
| `NOTI-BE-2` | 🔴 | L | be | NOTI-DB-1, NOTI-DB-2, NOTI-BE-1 | Repository/Service in-app notification đầy đủ: list+filter, dropdown, detail, unread-count, mark-read/unread, mark-all, hide, archive, soft-delete (data-scope Own) |
| `NOTI-BE-3` | 🔴 | XL | be | NOTI-BE-2 | Notification creation engine: resolve recipient + template render + dedupe + delivery-log + event consumer nội bộ |
| `NOTI-BE-4` | 🔴 | XL | be | NOTI-BE-3 | Admin/config API: system-notifications create/send, events config, templates CRUD/preview, channels config, delivery-logs + retry (audit log) |
| `NOTI-BE-5` | 🔴 | L | be | NOTI-BE-3 | Reminder/cleanup jobs: nhắc hạn/quá hạn (task/leave/contract) + expire theo retention, chống spam qua dedupe |
| `NOTI-INT-1` | 🟡 | L | integration | NOTI-BE-3 | Tích hợp phát event NOTI từ các module nguồn (AUTH/HR/ATT/LEAVE/TASK) qua creation engine |
| `NOTI-FE-1` | 🟡 | L | fe | NOTI-BE-2 | FE: Notification dropdown/header badge + trang danh sách + chi tiết (NOTI-SCREEN-001/002/003) trong apps/app |
| `NOTI-FE-2` | 🟡 | L | fe | NOTI-BE-4, NOTI-FE-1 | FE Admin: quản lý loại event/template/kênh + log gửi + tạo thông báo hệ thống (NOTI-SCREEN-005..009) |
| `NOTI-QA-1` | 🔴 | M | qa | NOTI-BE-2, NOTI-BE-3, NOTI-BE-4 | QA: deny-path authz + data-scope Own + dedupe + idempotency + soft-delete cho NOTI |

### DASH — `wrong-shape` (11 WO)

> apps/api/src/dashboard/ ĐÃ có code nhưng theo hướng media cũ, lệch spec: endpoint /summary /report /mv-stats /alerts /refresh với masking finance_report + filter channelId/projectId (media) + MV refresh — KHÔNG khớp kiến trúc SPEC-07/API-08 (4 dashboard-type Employee/Manager/HR/Admin, 22 widget endpoint riêng, /me /types /summary resolver, config CRUD DASH-API-201..208, cache). Permission chỉ có read:dashboard + manage:dashboard; THIẾU toàn bộ ~30 quyền DASH.* (4 dashboard-type + 22 widget + CONFIG/CACHE/AUDIT_LOG). 5 bảng DB-07 (dashboard_widgets, dashboard_widget_configs, dashboard_widget_cache, dashboard_cache_invalidations, dashboard_user_widget_states) KHÔNG tồn tại trong schema. Phải build mới phần lớn theo spec; /summary cũ chỉ tái dùng được như nguồn data, không phải shape. Rủi ro bất biến: widget data phải áp data-scope TRƯỚC aggregate/limit (rò team/company), cache MV/widget không honor RLS phải tự ép company_id, mv-stats/alerts/report media là out-of-scope cần park không phát triển tiếp.

| ID | Z | Eff | Layer | Depends | Title |
| --- | :-: | :-: | --- | --- | --- |
| `DASH-DB-1` | 🔴 | L | db | — | Migration tạo 4 bảng DASH lõi (dashboard_widgets, dashboard_widget_configs, dashboard_widget_cache, dashboard_cache_invalidations) + RLS+FORCE trước backfill, theo DB-07 §8 |
| `DASH-DB-2` | 🔴 | L | db | DASH-DB-1 | Migration seed catalog dashboard_widgets (22 widget MVP) + ~30 quyền DASH.* + role_permissions mặc định theo API-08 §6.3/§7.4 (ON CONFLICT DO NOTHING) |
| `DASH-BE-1` | 🔴 | XL | be | DASH-DB-2 | Widget registry + dashboard resolver + permission/data-scope guard core: GET /me /types /widgets /summary (DASH-API-001..003,008) |
| `DASH-BE-2` | 🔴 | L | be | DASH-BE-1 | 4 endpoint dashboard-type GET /employee /manager /hr /admin (DASH-API-004..007) lắp ráp widget theo config + data-scope |
| `DASH-BE-3` | 🟡 | XL | be | DASH-BE-2 | 22 widget data endpoint GET /widgets/{slug} (DASH-API-101..122) — data-source service đọc HR/ATT/LEAVE/TASK/NOTI/AUTH/FOUNDATION đã mask + scope |
| `DASH-BE-4` | 🔴 | L | be | DASH-BE-1 | Dashboard config CRUD cho Admin widget settings (DASH-API-201..208) + audit log khi đổi cấu hình |
| `DASH-BE-5` | 🔴 | L | be | DASH-BE-3 | Dashboard cache layer (Valkey/dashboard_widget_cache) + internal invalidation endpoints (DASH-INT-001..004) gắn outbox event nguồn |
| `DASH-BE-6` | 🟡 | M | be | DASH-BE-2 | Park/dọn endpoint media cũ trong dashboard module (mv-stats channelId, alerts channel-risk, report finance_report, refresh MV) — không thuộc spec MVP |
| `DASH-FE-1` | 🟡 | XL | fe | DASH-BE-2, APP-MERGE-1 | Dashboard shell + 4 role-dashboard (Employee/Manager/HR/Admin) + dropdown đổi type + widget grid trong apps/app (DASH-SCREEN-001..005) |
| `DASH-FE-2` | 🟢 | L | fe | DASH-FE-1, DASH-BE-3, DASH-BE-4 | 22 widget component + quick-action navigation (DASH-WIDGET-001..) + màn cấu hình widget settings (DASH-SCREEN-006) |
| `DASH-QA-1` | 🔴 | L | qa | DASH-BE-3, DASH-BE-4, DASH-BE-5 | QA tổng hợp DASH: permission/data-scope deny-path matrix + cache isolation + degraded fallback theo ma trận SPEC-07 §9 |

### FE-CORE — `wrong-shape` (8 WO)

> Spec (FRONTEND-01/03/04/05) yêu cầu một SPA hợp nhất `apps/app` (Vite+React19+TanStack Router) với HomePortal + AppSwitcher + ModuleWorkspaceLayout, các registry route/app/sidebar/action, permission framework theo chuẩn `MODULE.RESOURCE.ACTION` + `DataScope[]` (createPermissionChecker, evaluateRouteAccess/RouteGuard, PermissionGate hide/disable/mask/forbidden), API client có request-metadata headers + typed error + error→UI mapper, và query-key factory. CODE THẬT: `apps/app/` CHƯA tồn tại; packages/web-core có hạ tầng tốt nhưng LỆCH SHAPE — `useCan(action,resourceType)` chạy trên `capabilities: Record<string,boolean>` (ABAC action:resourceType), KHÔNG có DataScope, KHÔNG có createPermissionChecker, và `meResponseSchema` chỉ trả `capabilities` (THIẾU roles/permissions-with-scopes/company/modules). `packages/ui` AppShell là 1-tầng (1 topbar + 1 sidebar theo category cứng), KHÔNG có HomePortal/AppSwitcher/ModuleWorkspace; nav.ts không lọc theo permission/scope. api-client thiếu X-Request-Id/X-Client/Idempotency + typed error subclasses + error mapper + query layer. Rủi ro bất biến: shape permission FE lệch hợp đồng spec → mọi module sau (HR/ATT/LEAVE...) sẽ guard sai scope; FE-CORE phải hội tụ shape `permissions+scopes` từ /auth/me TRƯỚC. Backlog APP-MERGE-1 (todo) là umbrella thô chưa phân rã; PERM-UI-1 (todo, đỏ) chạm engine + hợp đồng useCan/PermissionGate.

| ID | Z | Eff | Layer | Depends | Title |
| --- | :-: | :-: | --- | --- | --- |
| `FE-CORE-BE-1` | 🔴 | L | be | — | Mở rộng /auth/me + meResponseSchema trả permissions(scopes)+roles+company+modules (đủ payload bootstrap) |
| `FE-CORE-FE-1` | 🔴 | L | fe | FE-CORE-BE-1 | Permission framework chuẩn spec: DataScope + createPermissionChecker + usePermission (MODULE.RESOURCE.ACTION + scope hierarchy) |
| `FE-CORE-FE-2` | 🟡 | M | fe | — | API client nâng cấp: request-metadata headers + typed error subclasses + error→UI mapper |
| `FE-CORE-FE-3` | 🟢 | L | fe | FE-CORE-FE-1, FE-CORE-FE-2 | Scaffold apps/app (Vite+React19+TanStack Router SPA) + QueryProvider/query-key factory + providers + session bootstrap guard |
| `FE-CORE-FE-4` | 🟢 | M | fe | FE-CORE-FE-1, FE-CORE-FE-3 | Registry layer: route/app/sidebar/action registry + metadata types + filter theo permission/scope/module-status |
| `FE-CORE-FE-5` | 🔴 | M | fe | FE-CORE-FE-4 | RouteGuard + evaluateRouteAccess + redirect/return-url + error states (401/403/404/module-disabled/feature-off) |
| `FE-CORE-FE-6` | 🟢 | L | fe | FE-CORE-FE-4, FE-CORE-FE-5 | Layout 2-tầng: HomePortalLayout + AppSwitcher overlay + ModuleWorkspaceLayout (GlobalTopbar/ModuleSidebar/MainContentShell/Breadcrumb/PageHeader) |
| `FE-CORE-QA-1` | 🔴 | M | qa | FE-CORE-FE-5, FE-CORE-FE-6 | QA FE-CORE: e2e route-guard + permission/scope deny-path + bootstrap/refresh/logout flow |

### FE-MODULES — `wrong-shape` (15 WO)

> CÓ nhiều FE thật nhưng phân mảnh trong app cũ chưa gom theo spec: apps/people (HR org/employees + ATT + LEAVE + payroll-Phase2), apps/projects (TASK kiểu Linear-clone), apps/studio (dashboard+tasks lẫn media/kpi/workflow hướng cũ). Spec FRONTEND-07..12 BẮT BUỘC mọi module chạy trong ModuleWorkspaceLayout của vỏ HỢP NHẤT apps/app — nhưng apps/app CHƯA tồn tại và ModuleWorkspaceLayout cũng CHƯA có (packages/ui chỉ có app-shell/app-sidebar/page-header). web-core đã có use-can/PermissionGate/notification-api/users-api dùng lại được. Backend lệch spec ở 2 chỗ: (a) module dashboard hiện là media-era (report/mv-stats/alerts/summary) THIẾU API per-role /dashboard/me|types|:type|widgets|configs mà FRONTEND-07 cần; (b) employees chỉ CRUD+import, THIẾU profile-change-request (FSM self-service duyệt), employee-code-config, contract/file/user-link mà FRONTEND-08 §5.1 yêu cầu. LEAVE/ATT/TASK/NOTI backend đủ shape cho FE core. Rủi ro bất biến: lịch nghỉ/lý do nghỉ + GPS/IP/photo ATT + field HR nhạy cảm PHẢI mask ở server (FE chỉ hide/disable); deep-link NOTI/quick-action DASH KHÔNG được mở thẳng detail nghiệp vụ mà phải để module gốc re-check permission/scope.

| ID | Z | Eff | Layer | Depends | Title |
| --- | :-: | :-: | --- | --- | --- |
| `FE-MODULES-FE-0` | 🟢 | L | fe | PERM-UI-1, CONSOLE-1 | Dựng vỏ apps/app hợp nhất + ModuleWorkspaceLayout (topbar + sidebar registry theo module) làm nền cho 6 module FE |
| `FE-MODULES-FE-1` | 🟡 | L | fe | FE-MODULES-FE-0 | HR FE trong apps/app: employee list/detail/form + my-profile + department/position/job-level/contract-type (port từ apps/people, bỏ payroll) |
| `FE-MODULES-BE-1` | 🔴 | XL | be | — | HR backend: profile-change-request (FSM self-service duyệt/từ chối) + employee-code-config + employee contract/file/user-link API + contracts Zod |
| `FE-MODULES-DB-1` | 🔴 | M | db | — | Migration HR: bảng employee_profile_change_requests + employee_code_config + employee_contracts/files/user_links (RLS+FORCE trước backfill company_id, append object_types) |
| `FE-MODULES-FE-2` | 🔴 | M | fe | FE-MODULES-FE-1, FE-MODULES-BE-1 | HR self-service FE: my-profile gửi yêu cầu cập nhật + HR/Admin xem/duyệt/từ chối profile-change-request |
| `FE-MODULES-FE-3` | 🟡 | L | fe | FE-MODULES-FE-0, FE-MODULES-FE-1 | ATT FE trong apps/app: today check-in/out + bảng công + chi tiết ngày công + remote/shift/rule (port từ apps/people, server-time + mask GPS/IP/photo) |
| `FE-MODULES-FE-4` | 🔴 | M | fe | FE-MODULES-FE-3 | ATT adjustment + remote approval FSM FE: tạo/duyệt/từ chối/hủy yêu cầu điều chỉnh công & remote (deny-path RED trước) |
| `FE-MODULES-FE-5` | 🟡 | L | fe | FE-MODULES-FE-0, FE-MODULES-FE-1 | LEAVE FE trong apps/app: balance + my-requests + create (preview ngày) + detail + calendar + types/policies (port từ apps/people) |
| `FE-MODULES-FE-6` | 🔴 | M | fe | FE-MODULES-FE-5 | LEAVE approval FSM FE: pending approvals + approve/reject (bắt buộc lý do) + balance adjustment (deny-path RED trước) |
| `FE-MODULES-FE-7` | 🟢 | XL | fe | FE-MODULES-FE-0, FE-MODULES-FE-1 | TASK FE trong apps/app: my-tasks + task list/detail + create/edit + kanban + comment/checklist/file + project list/detail (port từ apps/projects, bỏ media/workflow studio) |
| `FE-MODULES-FE-8` | 🟢 | M | fe | FE-MODULES-FE-0 | NOTI FE: topbar badge + dropdown + my-list/detail + mark-read/read-all + deep-link điều hướng module gốc re-check quyền |
| `FE-MODULES-BE-2` | 🟡 | L | be | — | DASH backend: API per-role /dashboard/me/types/:type/widgets/:id/configs thay shape media-era (report/mv-stats/summary) + contracts |
| `FE-MODULES-FE-9` | 🟡 | L | fe | FE-MODULES-FE-0, FE-MODULES-BE-2, FE-MODULES-FE-3, FE-MODULES-FE-5, FE-MODULES-FE-7, FE-MODULES-FE-8 | DASH FE trong apps/app: dashboard theo role (employee/manager/hr/admin) + widget grid + quick action điều hướng module gốc |
| `FE-MODULES-FE-10` | 🟡 | M | integration | FE-MODULES-FE-1, FE-MODULES-FE-3, FE-MODULES-FE-5, FE-MODULES-FE-7, FE-MODULES-FE-8, FE-MODULES-FE-9 | Dọn FE cũ: gỡ/park apps/people·apps/projects·apps/studio·apps/web sau khi 6 module đã port vào apps/app (chống trùng vỏ) |
| `FE-MODULES-QA-1` | 🔴 | L | qa | FE-MODULES-FE-2, FE-MODULES-FE-4, FE-MODULES-FE-6, FE-MODULES-FE-9 | QA E2E P0 cross-module: deny-path permission + mask + deep-link NOTI→module re-check + approval FSM (LEAVE/ATT) trên apps/app |

### INTEGRATION — `none` (9 WO)

> EPIC-10 ở đây KHÔNG phải tích hợp bên-thứ-ba mà là LỚP HỢP ĐỒNG API (BACKEND-12: OpenAPI/Swagger + endpoint/permission matrix + contract test) cộng với bộ kiểm thử ngang QA-05 (permission · data-scope · cross-tenant · field-level). Code nền có sẵn substrate tốt: 223 @RequirePermission trên 40 controller (ATT/LEAVE/NOTI/DASH/storage đều tồn tại), envelope thành công {success,data,error,meta?} + AllExceptionsFilter, ZodValidationPipe. NHƯNG lớp contract gần như TRỐNG: 0 @nestjs/swagger, 0 OpenAPI gen, không operationId/x-required-permission/x-data-scope, không endpoint-matrix/permission-endpoint-matrix artifact, không contract test, không OpenAPI lint/diff CI, không Idempotency-Key HTTP layer, và CHƯA có suite QA-05 (helper loginAs/apiAs, tag @scope-*/@tenant-isolation/@field-level, cross-tenant 2-company, field-level masking). Hai lệch chuẩn quan trọng: (1) envelope hiện là {success,data,error,meta} còn BACKEND-12 §12 yêu cầu {success,message,data,meta:{request_id,timestamp},pagination} + ValidationError.details theo field; (2) @RequirePermission dùng cặp (action,resourceType) thay vì mã MODULE.RESOURCE.ACTION như API-10, và không phơi data_scope ở tầng HTTP/OpenAPI. Rủi ro bất biến: chưa có test cross-tenant/field-level → không bằng chứng RLS+masking giữ vững khi gọi API trực tiếp (bypass FE) — đây là exit-criteria release MVP của QA-05.

| ID | Z | Eff | Layer | Depends | Title |
| --- | :-: | :-: | --- | --- | --- |
| `INTEGRATION-BE-1` | 🟡 | M | be | — | Chuẩn hoá shared schema envelope theo BACKEND-12 §12 (message + meta.request_id/timestamp + pagination + ValidationError.details) |
| `INTEGRATION-BE-2` | 🔴 | L | be | INTEGRATION-BE-1 | Decorator metadata hợp đồng: x-required-permission/x-data-scope/x-audit/x-idempotency + operationId/tag — sinh từ @RequirePermission sẵn có |
| `INTEGRATION-BE-3` | 🟡 | L | be | INTEGRATION-BE-2 | OpenAPI/Swagger generation: public + internal, Swagger UI theo môi trường, export JSON/YAML |
| `INTEGRATION-BE-4` | 🔴 | M | be | INTEGRATION-BE-1, INTEGRATION-BE-2 | Idempotency-Key contract layer cho mutation quan trọng (header guard + conflict 409) |
| `INTEGRATION-QA-1` | 🔴 | L | qa | INTEGRATION-BE-1 | QA-05 harness nền: 2-company fixtures + helper (loginAs/apiAs/expectForbidden/expectNoCrossTenantData/expectMaskedFields) + test tag |
| `INTEGRATION-QA-2` | 🔴 | XL | qa | INTEGRATION-QA-1 | QA-05 suite deny-path + data-scope + cross-tenant cho ATT/LEAVE/NOTI/DASH (Own/Team/Company + isolation) |
| `INTEGRATION-QA-3` | 🔴 | L | qa | INTEGRATION-QA-1 | QA-05 field-level masking suite: HR.EMPLOYEE.VIEW_SENSITIVE + auth secret + file storage_path + audit raw-diff |
| `INTEGRATION-BE-5` | 🟡 | M | be | INTEGRATION-BE-3 | Contract test + endpoint/permission-endpoint matrix export + OpenAPI lint/diff trong CI |
| `INTEGRATION-FE-1` | 🟢 | M | fe | INTEGRATION-BE-3, INTEGRATION-BE-1 | Frontend integration: codegen TypeScript types từ OpenAPI + đồng bộ api-client/mock theo contract chuẩn |

### QA-RELEASE — `partial` (10 WO)

> Backend nền G1-G16 đã có hạ tầng test ĐÁNG KỂ: 112 file spec (unit guard/permission/auth/attendance.logic/leave.logic mạnh), bộ integration RLS/tenant-isolation đầy đủ (rls-coverage-assert · tenant-isolation · force-before-backfill-order · pgbouncer), CI gate thật trong ci.yml/api.yml (lint→typecheck→migrate-real-PG→setup-roles→PgBouncer→test). Endpoint MVP đã tồn tại (attendance check-in/out/today/approve, leave approve/reject/balances). NHƯNG QA-RELEASE theo spec còn THIẾU cốt lõi: (a) KHÔNG có seed MVP deterministic + test migrate-from-empty/seed-idempotent (BE13-MIG-001..003, QA-01§10) — seed.ts chỉ là helper test ad-hoc; (b) KHÔNG có E2E cross-module (LEAVE→ATT→NOTI→DASH, TASK→NOTI→DASH, HR-profile-change) — release-blocker P0 theo QA-03 §22-23 + BE13-INT-004..010; (c) KHÔNG có permission/data-scope matrix hợp nhất (Own/Team/Dept/Company/System × actor) theo BE13§15 — deny-path rải rác chưa gom; (d) KHÔNG có Playwright/web E2E (chặn bởi apps/app chưa dựng — APP-MERGE-1 todo); (e) KHÔNG có perf/EXPLAIN-ANALYZE gate cho 12 endpoint P0 (BE13§18.2); (f) KHÔNG có smoke-after-deploy + Go/No-Go automation (BE13§24/30). Rủi ro bất biến: suite test hiện trộn module hướng cũ (finance/payroll/media/kpi) — QA scope phải ghim lại 7 module MVP + FOUNDATION, nếu không sẽ đo nhầm và che gap MVP thật.

| ID | Z | Eff | Layer | Depends | Title |
| --- | :-: | :-: | --- | --- | --- |
| `QA-RELEASE-DB-1` | 🔴 | L | db | — | Seed MVP deterministic + idempotent cho QA/UAT (modules·roles·permission matrix·leave/att/noti defaults·bootstrap admin) |
| `QA-RELEASE-QA-1` | 🔴 | M | qa | QA-RELEASE-DB-1 | Test migrate-from-empty + seed-idempotency + schema-no-drift làm CI gate |
| `QA-RELEASE-QA-2` | 🔴 | L | qa | QA-RELEASE-DB-1 | Permission/data-scope matrix test hợp nhất (actor × scope Own/Team/Dept/Company/System) cho 7 module MVP |
| `QA-RELEASE-QA-3` | 🔴 | L | integration | QA-RELEASE-DB-1, QA-RELEASE-QA-2 | E2E backend cross-module: LEAVE approve → ATT sync → NOTI → DASH (+ revoke recalculate) |
| `QA-RELEASE-QA-4` | 🟡 | L | integration | QA-RELEASE-DB-1, QA-RELEASE-QA-2 | E2E backend cross-module: TASK assign/mention → NOTI → DASH + HR profile-change → approve → apply/NOTI/audit |
| `QA-RELEASE-BE-1` | 🟡 | L | be | QA-RELEASE-DB-1 | API response/error contract test gate (envelope success/error · status code · idempotency · no-leak field) cho endpoint MVP |
| `QA-RELEASE-QA-5` | 🟢 | M | qa | — | Ghim QA scope về 7 module MVP + FOUNDATION: tách/loại suite hướng cũ (finance/payroll/media/kpi/chat/meeting) khỏi gate release |
| `QA-RELEASE-BE-2` | 🟡 | L | be | QA-RELEASE-DB-1 | Performance/EXPLAIN-ANALYZE harness cho 12 endpoint P0 + N+1 guard (chống seq-scan, thiếu company_id filter) |
| `QA-RELEASE-BE-3` | 🟡 | M | be | QA-RELEASE-DB-1, QA-RELEASE-BE-1 | Smoke-test-after-deploy script + Go/No-Go release gate (health·auth/me·MVP list endpoints·audit check) |
| `QA-RELEASE-FE-1` | 🟡 | XL | fe | APP-MERGE-1, QA-RELEASE-DB-1, QA-RELEASE-QA-3 | Web E2E (Playwright) bộ smoke+critical P0 trên apps/app: login→home→check-in→leave submit/approve→notification→deep-link forbidden |

## 4. Cổng ĐỎ — không auto-loop

Mọi WO 🔴 chạm permission/RLS/secret/audit/auth/migration/FSM phê duyệt ⇒ **người mở lane + FULL gate** (security-reviewer + database-reviewer + silent-failure-hunter), deny-path RED trước. Auto-loop chỉ tự chạy 🟢/🟡.

## 5. Cách dùng

1. Lấy WO chi tiết (paths·done_when·refs) từ `docs/plans/mvp-work-orders.json`.
2. Promote từng WAVE vào `harness/backlog.mjs` khi tới lượt (giữ hàng đợi vận hành gọn, tuần tự).
3. Wave 1 (FOUNDATION) đã seed vào backlog.mjs.
