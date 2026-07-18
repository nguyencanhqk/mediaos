/**
 * S2-HR-BE-1 — HR read-core contracts barrel (own subdir, additive).
 * Re-exported from packages/contracts/src/index.ts via `export * from "./hr"`.
 */
export * from "./employee-read";
// S2-HR-BE-2 (additive): HR write-core DTOs (create/update/change-status/link-user).
export * from "./employee-write";
export * from "./lookups";
// S2-HR-BE-3 (additive): HR master data CRUD + department CRUD contracts.
export * from "./master-data";
// S2-HR-BE-4: profile change request DTOs (SPEC-03 §14.18/14.19/14.20).
export * from "./profile-change-request";
// S2-HR-BE-7 (additive): employee-code CONFIG admin DTOs (API-03 §10.10 HR-API-901/902/903).
export * from "./employee-code-config";
// S2-HR-BE-6 (additive): employee contracts (hợp đồng lao động) DTOs (DB-03 §7.7).
export * from "./contracts";
// S2-HR-EMPFILE-1 (additive): employee file (hồ sơ đính kèm) DTOs (API-03 HR-API-801..805 / DB-08 §8.7).
export * from "./employee-file";
// HR-PROFILE-UI-2 (additive): employee directory CSV export DTOs (export:employee, SPEC-03/API-10).
export * from "./employee-export";
// S5-HR-IMPORT-BE-1 (additive): bulk employee import DTOs — row schema (by-NAME, UNLINKED/never-provision,
// no salary/PII) + IMPORT_COLUMN_ORDER (parser+template SoT) + dry-run report + apply result. NOT the
// media-era legacy importEmployeeRowSchema in ../employees.ts. Gate import:employee (mig 0496).
export * from "./employee-import";
// S5-HR-ORGCHART-BE-1 (additive): org-chart cây nhân sự theo direct_manager_id, node directory-class,
// scoped (Option A). Response { roots, warnings.cyclesDetected }.
export * from "./org-chart";
