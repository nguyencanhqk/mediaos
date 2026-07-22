/**
 * S1-FND-WIRE-1 / S2-FND-CONTRACT-1 — Foundation contracts (Zod = nguồn sự thật DTO cho
 * /api/v1/foundation/*). company (current + PATCH allow-list), module-catalog (my-apps), settings
 * (public/resolve/company-setting/system-setting), holidays (CRUD + list), retention, sequences, seeds.
 *
 * audit/files DTO còn dùng DTO cục bộ ở apps/api (files có FOUNDATION_FILE_ERROR_CODES riêng ở files.ts) —
 * NGOÀI phạm vi migrate đợt này (S2-FND-CONTRACT-1 scope = settings/holidays/company-patch), không phải nợ mới.
 */
export * from "./company";
export * from "./module-catalog";
// S2-FND-CONTRACT-1 — settings + holidays DTO migrate vào contracts (nguồn sự thật DTO, CLAUDE §4).
// TÊN export RIÊNG (settings foundation ≠ root settings.ts G5/CS-5) → không vỡ barrel. Append-only.
export * from "./settings";
export * from "./holidays";
// S2-FND-CONTRACT-1 — catalog FOUNDATION-ERR-* (company/setting/audit/module/holiday/retention). Append-only.
export * from "./error-codes";
// S2-FND-BE-3 (L2) — retention-policy + file-access-log DTO (WHITELIST, KHÔNG secret). Append-only.
export * from "./retention";
export * from "./file-access-log";
// S2-FND-BE-2 — sequence-counter + seed-run status DTO (WHITELIST, KHÔNG secret/current_value). Append-only.
export * from "./sequences";
export * from "./seeds";
// S5-FND-JOBS-OBS-1 — System Jobs observability DTO (READ-ONLY, WHITELIST, KHÔNG metadata). Append-only.
export * from "./system-jobs";
// S5-BRAND-BE-1 — thương hiệu công ty (logo + favicon) qua wrapper presign trên FileService. Append-only.
export * from "./branding";
