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
