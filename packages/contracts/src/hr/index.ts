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
