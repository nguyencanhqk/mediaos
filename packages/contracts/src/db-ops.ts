import { z } from "zod";
import { DB_BROWSER_ALLOWLIST, type DbBrowserTable } from "./db-ops-allowlist";

/**
 * AC-9 db-ops (operator-only, platform-admin, CHỈ-ĐỌC) DTOs — nguồn sự thật contract api ↔ admin.
 *
 * 4 năng lực (operator-scoped, break-glass-gated):
 *   P1 Migration status viewer — đọc __drizzle_migrations (global) + đối chiếu _journal.json (read-only).
 *   P2 Data browser TENANT-SCOPED — operator chọn 1 target tenant + 1 bảng allowlist + filter → đọc rows
 *      của target qua withTenant(target) (RLS company_id=current ÉP). Default-DENY: bảng/cột ngoài
 *      allowlist → 400. Pagination BẮT BUỘC + ROW CAP [1..MAX].
 *   P3 Break-glass SoD grant — request → approve (≥2 approver KHÁC NHAU) → active → revoke (TTL). Gate P2/P4.
 *   P4 Export job (scaffold; worker DEFER) — create/list/status, break-glass-active gate + audit.
 *
 * BẤT BIẾN #3 (không secret/PII): data-browser KHÔNG bao giờ trả secret/PII. Allowlist default-DENY loại
 *   TRỪ tuyệt đối secret_ciphertext/payslips/salary/*_totp/webhook-secret/encryption_keys/token_hash/
 *   break_glass*.reason/db_ops*.reason (xem db-ops-allowlist.ts). Cột ngoài allowlist → reject 400.
 */

// ── Row caps (§8.3 NFR — chống unbounded read / DoS) ──────────────────────────────────────────────
/** Trần số dòng 1 trang data-browser / grant / export listing. */
export const DB_BROWSER_MAX_ROWS = 100 as const;
export const DB_BROWSER_DEFAULT_ROWS = 50 as const;

/** SoD break-glass ngưỡng tối thiểu 2 người duyệt khác nhau (mirror G6-2). */
export const DB_OPS_MIN_APPROVALS = 2 as const;
/** TTL break-glass [5 phút .. 24 giờ]. */
export const DB_OPS_MIN_TTL_SECONDS = 300 as const;
export const DB_OPS_MAX_TTL_SECONDS = 86400 as const;

const allowedTablesTuple = Object.keys(DB_BROWSER_ALLOWLIST) as [
  DbBrowserTable,
  ...DbBrowserTable[],
];

/**
 * 1 điều kiện lọc data-browser: cột (PHẢI thuộc allowlist của bảng — validate sâu hơn ở server vì
 * Zod tĩnh không biết cột nào hợp lệ cho bảng nào) + giá trị string (so sánh `=` đơn giản, không inject).
 */
export const dbBrowserFilterSchema = z
  .object({
    column: z.string().min(1).max(64),
    value: z.string().max(512),
  })
  .strict();
export type DbBrowserFilter = z.infer<typeof dbBrowserFilterSchema>;

/**
 * Query data-browser. table PHẢI ∈ allowlist (enum) ⇒ unknown table → reject. cols optional (vắng = toàn
 * bộ cột allowlist của bảng); nếu khai → server vẫn ép subset allowlist (defense-in-depth). targetCompanyId
 * uuid (bảng tenant-scoped). limit kẹp [1..MAX] (reject ngoài dải), offset >= 0. `.strict()` reject key lạ.
 */
export const dbBrowserQuerySchema = z
  .object({
    targetCompanyId: z.string().uuid(),
    table: z.enum(allowedTablesTuple),
    cols: z.array(z.string().min(1).max(64)).max(64).optional(),
    filters: z.array(dbBrowserFilterSchema).max(16).optional(),
    limit: z.coerce.number().int().min(1).max(DB_BROWSER_MAX_ROWS).default(DB_BROWSER_DEFAULT_ROWS),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type DbBrowserQuery = z.infer<typeof dbBrowserQuerySchema>;

/** Response data-browser: rows (object cột→giá trị, ĐÃ project allowlist) + meta row-capped. */
export const dbBrowserResultSchema = z.object({
  table: z.string(),
  targetCompanyId: z.string().uuid(),
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
  meta: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  }),
});
export type DbBrowserResult = z.infer<typeof dbBrowserResultSchema>;

// ── All-tenant data browser (WAVE 3 C1 — ADR-0021 Tầng 3) ──────────────────────────────────────────
/**
 * Query ALL-TENANT data browser. KHÁC dbBrowserQuerySchema: KHÔNG targetCompanyId (quét XUYÊN MỌI tenant
 * qua role DB read-only `mediaos_readonly`, ADR-0021). table PHẢI ∈ allowlist (enum); cols optional (vắng =
 * toàn bộ cột allowlist — server ÉP thêm company_id để định danh tenant mỗi row). filters/limit/offset như
 * tenant-scoped. `.strict()` reject key lạ (gồm targetCompanyId — buộc dùng /browse cho tenant-scoped).
 *
 * Gate (server): @RequirePermission('read','db-all-tenant') + step-up sentinel PLATFORM_DB_OPS_SCOPE +
 * break-glass grant ALL-TENANT (target_tenant_id IS NULL) — grant tenant-scoped KHÔNG đủ.
 */
export const dbAllTenantBrowseQuerySchema = z
  .object({
    table: z.enum(allowedTablesTuple),
    cols: z.array(z.string().min(1).max(64)).max(64).optional(),
    filters: z.array(dbBrowserFilterSchema).max(16).optional(),
    limit: z.coerce.number().int().min(1).max(DB_BROWSER_MAX_ROWS).default(DB_BROWSER_DEFAULT_ROWS),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type DbAllTenantBrowseQuery = z.infer<typeof dbAllTenantBrowseQuerySchema>;

/**
 * Response all-tenant data browser: rows project cột allowlist + company_id (định danh tenant). KHÔNG
 * targetCompanyId (cross-tenant). meta row-capped như tenant-scoped.
 */
export const dbAllTenantBrowseResultSchema = z.object({
  table: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
  meta: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  }),
});
export type DbAllTenantBrowseResult = z.infer<typeof dbAllTenantBrowseResultSchema>;

// ── Break-glass grant DTO ─────────────────────────────────────────────────────────────────────────
export const dbOpsGrantStatusSchema = z.enum(["pending", "active", "revoked"]);
export type DbOpsGrantStatus = z.infer<typeof dbOpsGrantStatusSchema>;

/** DTO 1 grant break-glass db-ops. KHÔNG company_id (global, operator-scoped). targetTenantId nullable = all. */
export const dbOpsGrantDtoSchema = z.object({
  id: z.string().uuid(),
  requesterUserId: z.string().uuid(),
  targetTenantId: z.string().uuid().nullable(),
  reason: z.string(),
  requiredApprovals: z.number().int().positive(),
  approvalCount: z.number().int().nonnegative(),
  status: dbOpsGrantStatusSchema,
  expiresAt: z.string().datetime(),
  activatedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type DbOpsGrantDto = z.infer<typeof dbOpsGrantDtoSchema>;

/** Request input cho 1 grant break-glass db-ops. targetTenantId optional (vắng = all-tenant). */
export const dbOpsGrantRequestSchema = z
  .object({
    targetTenantId: z.string().uuid().nullable().optional(),
    reason: z.string().min(1).max(1000),
    ttlSeconds: z.coerce
      .number()
      .int()
      .min(DB_OPS_MIN_TTL_SECONDS)
      .max(DB_OPS_MAX_TTL_SECONDS),
  })
  .strict();
export type DbOpsGrantRequest = z.infer<typeof dbOpsGrantRequestSchema>;

// ── Export job DTO (scaffold; worker DEFER) ─────────────────────────────────────────────────────────
export const dbExportJobStatusSchema = z.enum([
  "queued",
  "running",
  "done",
  "failed",
  "expired",
]);
export type DbExportJobStatus = z.infer<typeof dbExportJobStatusSchema>;

export const dbExportJobDtoSchema = z.object({
  id: z.string().uuid(),
  requesterUserId: z.string().uuid(),
  targetTenantId: z.string().uuid(),
  tableName: z.string(),
  filter: z.unknown().nullable(),
  status: dbExportJobStatusSchema,
  rowCount: z.number().int().nonnegative().nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type DbExportJobDto = z.infer<typeof dbExportJobDtoSchema>;

export const dbExportJobCreateSchema = z
  .object({
    targetCompanyId: z.string().uuid(),
    table: z.enum(allowedTablesTuple),
    filters: z.array(dbBrowserFilterSchema).max(16).optional(),
  })
  .strict();
export type DbExportJobCreate = z.infer<typeof dbExportJobCreateSchema>;

// ── Migration status DTO (P1) ───────────────────────────────────────────────────────────────────────
/** 1 migration: tag + when (journal) + applied (có trong __drizzle_migrations chưa). */
export const migrationEntrySchema = z.object({
  idx: z.number().int().nonnegative(),
  tag: z.string(),
  when: z.number().int().nonnegative(),
  applied: z.boolean(),
  appliedAt: z.string().datetime().nullable(),
});
export type MigrationEntry = z.infer<typeof migrationEntrySchema>;

/** Trạng thái migration tổng: danh sách + đếm applied/pending. READ-ONLY (KHÔNG chạy migration). */
export const migrationStatusDtoSchema = z.object({
  entries: z.array(migrationEntrySchema),
  appliedCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
});
export type MigrationStatusDto = z.infer<typeof migrationStatusDtoSchema>;
