/**
 * Schema nghiệp vụ — BASELINE RỖNG ở G1.
 *
 * Bảng nghiệp vụ thêm từ G2-3 trở đi (companies, users, …). RÀNG BUỘC (CLAUDE.md §2):
 *  - Mọi bảng nghiệp vụ PHẢI có `company_id NOT NULL` + RLS policy (BẤT BIẾN #1).
 *  - Bảng audit/snapshot là append-only (BẤT BIẾN #2) — app role không UPDATE/DELETE.
 *
 * Đặt mỗi nhóm bảng vào một file riêng (companies.ts, users.ts, …) rồi re-export ở đây.
 */
export * from "./companies";
export * from "./users";
export * from "./audit";
export * from "./outbox";
export * from "./auth";
// S2-AUTH-DB-2 (DB-02 §7.6/§7.8/§7.9): user_sessions (in ./auth) + login_logs + user_security_events.
// login_logs/user_security_events APPEND-ONLY (app SELECT,INSERT only); login_logs company_id NULLABLE.
export * from "./auth-logs";
export * from "./permissions";
export * from "./org";
export * from "./positions";
export * from "./hr-master";
export * from "./employees";
export * from "./media";
export * from "./workflow";
export * from "./communication";
export * from "./hr";
// S3-ATT-DB-1 (DB-04 §7, mig 0452): ATT Core 7 bảng MỚI — shifts · shift_assignments · attendance_rules ·
// attendance_logs (APPEND-ONLY) · attendance_adjustment_items (APPEND-ONLY) · remote_work_requests ·
// remote_work_request_approvals (APPEND-ONLY). attendance_records/_adjustment_requests reconcile ở ./hr (ALTER-ADD).
export * from "./attendance";
// S3-LEAVE-DB-1 (DB-05 §7, mig 0453): LEAVE Core 4 bảng MỚI — leave_policies · leave_request_days +
// leave_balance_transactions (APPEND-ONLY ledger) · leave_request_approvals (APPEND-ONLY history).
// leave_types/leave_requests/leave_balances (mig 0062) reconcile ở ./hr (ALTER-ADD additive nullable).
export * from "./leave";
export * from "./finance";
// G8 approval (multi-level rules — approval_requests/_steps live in ./workflow)
export * from "./approval";
// G8-3 evaluation (template + criteria + results + scores)
export * from "./evaluation";
// G8-4 KPI (kpi_definitions mutable + kpi_results SNAPSHOT APPEND-ONLY)
export * from "./kpi";
// G12 payroll (salary profile — lương nhạy cảm, ADR-0010)
export * from "./payroll";
// G10-4 meeting (meeting_rooms + meetings + meeting_attendees)
export * from "./meeting";
// G16-1 2FA (user_totp envelope-encrypted secret + user_recovery_codes; AUTH-003)
export * from "./two-factor";
// G16-1b security alerting (append-only — repeated re-auth fail / cross-scope deny / anomalous login)
export * from "./security-alerts";
// G6-2 PR-B break-glass (emergency platform_account secret access — PARK cùng media, out-of-scope)
export * from "./break-glass";
// G15-2 device tokens (push notification registration)
export * from "./device-tokens";
// AC-5 API key / Personal Access Token (PAT) — per-tenant FORCE-RLS + append-only usages
export * from "./api-keys";
// AC-7 module-registry (catalog GLOBAL no-RLS — lớp module trên feature-flag, reuse company_feature_flags)
export * from "./module-registry";
// CS-8 Cấu hình mail server SMTP (per-tenant FORCE-RLS — 1 config / scope; SMTP password envelope-KMS)
export * from "./mail-config";
// CS-9 Bảo mật nâng cao (per-company security policy — per-tenant FORCE-RLS; enforce IP/giờ/2FA/email-domain)
export * from "./security-policy";
// CS-10 Đối tượng: Mời/Duyệt/Kích hoạt user (user_invites per-tenant FORCE-RLS; token_hash + password_hash)
export * from "./user-invites";
// FOUNDATION-DB-1 settings (DB-08 §8.3/8.4): system_settings GLOBAL no-RLS + company_settings per-tenant FORCE-RLS
export * from "./settings";
// FOUNDATION-DB-3 files (DB-08 §8.6/8.7/8.8): files + file_links (per-tenant FORCE-RLS, soft-delete) +
// file_access_logs (per-tenant FORCE-RLS, APPEND-ONLY — app role REVOKE UPDATE/DELETE)
export * from "./files";
// FOUNDATION-DB-4 sequences (DB-08 §8.9): sequence_counters — company_id NULLABLE (system sequence=NULL),
// RLS+FORCE policy nullable-tenant (USING own+global, WITH CHECK own) mẫu 0005 roles; mutable soft-delete.
export * from "./sequences";
// FOUNDATION-DB-4 holidays (DB-08 §8.10): public_holidays — company_id NULLABLE (global holiday=NULL),
// RLS+FORCE policy nullable-tenant; uq global/company tách theo company_id IS [NOT] NULL; mutable soft-delete.
export * from "./holidays";
// FOUNDATION-DB-5 retention (DB-08 §8.11): data_retention_policies — company_id NULLABLE (global default=NULL),
// RLS+FORCE policy nullable-tenant; mutable soft-delete; uq (company,module,entity) WHERE enabled & not-deleted.
export * from "./retention";
// FOUNDATION-DB-5 seed-tracking (DB-08 §8.2/8.12/8.13): modules (catalog CHUẨN spec — KHÔNG company_id,
// no-RLS, KHÁC system_modules SaaS) + seed_batches/seed_items (company_id NULLABLE, RLS+FORCE nullable-tenant,
// tracking mutable — KHÔNG DELETE, giữ lịch sử seed idempotent). Seed catalog+settings+permission ở 0435.
export * from "./seed-tracking";
// S2-FND-JOBS-1 (DB-08 §8.14/§8.15, mig 0475): system_job_runs (company_id NULLABLE, RLS+FORCE per-role
// app-tenant/worker-all — worker ghi nhật ký, app SELECT-only) + system_job_locks (KHÔNG company_id,
// no-RLS worker-infra mẫu processed_events). GRANT no-DELETE mọi role (release lock = UPDATE, không DELETE).
export * from "./system-jobs";
// S4-NOTI-DB-1 (DB-07 §7.1–7.4, mig 0479): NOTI Core 3 bảng MỚI — notification_events + notification_templates
// (company_id NULLABLE, RLS+FORCE nullable-tenant, app SELECT-only) + notification_delivery_logs (company_id
// NOT NULL, RLS+FORCE, APPEND-ONLY app SELECT,INSERT). notifications (mig 0010) ALTER-ADD additive ở ./communication.
export * from "./noti";
// S4-DASH-DB-1 (DB-07 §8.1–8.3, mig 0482): DASH Core 3 bảng MỚI — dashboard_widgets (company_id NULLABLE,
// RLS+FORCE nullable-tenant, app SELECT-only) + dashboard_widget_configs (company_id NOT NULL, RLS+FORCE
// literal-GUC, app SELECT-only, config-update=DASH-BE) + dashboard_widget_cache (company_id NOT NULL, RLS+FORCE
// literal-GUC, app SELECT,INSERT,UPDATE — runtime upsert + soft-delete invalidation, KHÔNG DELETE).
export * from "./dashboard";
// S4-TASK-BE-1 (DB-06 §7.12, mig 0478 §5): task_activity_logs typed model — APPEND-ONLY ledger project/task
// (company_id NOT NULL, RLS+FORCE, app GRANT SELECT,INSERT — KHÔNG UPDATE/DELETE, KHÔNG deleted_at). projects/
// project_members cột TitleCase MỚI additive reconcile ở ./media (ALTER-ADD 0478 §6/§7). KHÔNG db:generate.
export * from "./task-activity";
