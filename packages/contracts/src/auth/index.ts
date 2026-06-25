/**
 * S2-AUTH-BE-3 — auth admin contracts (Zod = nguồn sự thật DTO cho /auth/users · /auth/roles ·
 * /auth/permissions). Subdir RIÊNG (additive) — TÊN export tách biệt khỏi flat users.ts (AdminUser*)
 * để KHÔNG trùng ở barrel re-export (src/index.ts append `export * from "./auth/index"`).
 */
export * from "./user-admin";
export * from "./role-permission-list";
