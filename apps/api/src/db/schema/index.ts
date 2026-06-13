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
// G8 approval (multi-level rules — approval_requests/_steps live in ./workflow)
export * from "./approval";
