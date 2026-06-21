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
export * from "./permissions";
export * from "./org";
export * from "./positions";
export * from "./employees";
export * from "./media";
export * from "./workflow";
export * from "./communication";
export * from "./hr";
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
