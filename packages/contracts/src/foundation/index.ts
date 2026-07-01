/**
 * S1-FND-WIRE-1 — Foundation contracts (Zod = nguồn sự thật DTO cho /api/v1/foundation/*).
 *
 * Hiện có: company (current), module-catalog (my-apps) — endpoint MỚI chưa có contract.
 * CHƯA migrate: settings/audit/files/holidays DTO (đang dùng DTO cục bộ) — gộp vào S1-FND-WIRE-DRIFT-1
 * cùng việc chuẩn hoá envelope (meta={request_id,timestamp} + pagination block, API-01 §16.1).
 */
export * from "./company";
export * from "./module-catalog";
// S2-FND-BE-3 (L2) — retention-policy + file-access-log DTO (WHITELIST, KHÔNG secret). Append-only.
export * from "./retention";
export * from "./file-access-log";
