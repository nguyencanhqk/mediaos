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
// G6-2 PR-B break-glass (emergency platform_account secret access — grant + SoD 2-người approval, mig 0200)
export * from "./break-glass";
// G16-3 SaaS scaffold (subscription plan catalog + per-company subscription/feature-flag/usage)
export * from "./saas";
// G16-3 template clone (workspace_templates catalog + per-company dashboard_configs)
export * from "./templates";
// G15-2 device tokens (push notification registration)
export * from "./device-tokens";
// AC-5 API key / Personal Access Token (PAT) — per-tenant FORCE-RLS + append-only usages
export * from "./api-keys";
// AC-7 module-registry (catalog GLOBAL no-RLS — lớp module trên feature-flag, reuse company_feature_flags)
export * from "./module-registry";
// AC-4 UI config (branding / navigation / i18n overrides — per-tenant FORCE-RLS, tenant self-service)
export * from "./ui-config";
// AC-6 Webhooks (endpoint + subscription + delivery log — per-tenant FORCE-RLS; HMAC secret envelope-KMS)
export * from "./webhooks";
// AC-9 db-ops (3 bảng GLOBAL no-RLS operator-scoped — break-glass grant/approval + export job; mig 0345)
export * from "./db-ops";
// CS-8 Cấu hình mail server SMTP (per-tenant FORCE-RLS — 1 config / scope; SMTP password envelope-KMS)
export * from "./mail-config";
