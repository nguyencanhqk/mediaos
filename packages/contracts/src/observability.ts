import { z } from "zod";

/**
 * AC-8 Observability (audit viewer + queue monitor) DTOs — nguồn sự thật contract api ↔ admin.
 *
 * Hai tầng đọc CHỈ-ĐỌC:
 *   - TENANT self: company-admin xem audit_logs CỦA tenant mình (qua withTenant(JWT.companyId), RLS ép).
 *   - OPERATOR cross-tenant: platform-admin xem audit_logs + event queue của MỌI tenant (qua GUC HẸP
 *     app.platform_audit_read, SELECT-only) — mọi lần đọc ghi 1 operator-action audit row.
 *
 * BẤT BIẾN #3 (không secret/PII): before/after JSON của audit CÓ THỂ chứa payload nhạy cảm
 *   (salary_profile/payslip/api_key/break_glass/platform_account…) → REDACT phía server trong DTO
 *   (audit-redact.helper). DTO này KHÔNG bao giờ trả nguyên before/after thô của object_type nhạy cảm.
 *
 * §8.3 NFR: list endpoint BẮT BUỘC pagination + ROW CAP. limit kẹp [1..MAX_AUDIT_PAGE_LIMIT].
 */

/** Trần số dòng 1 trang audit/queue listing (§8.3 — chống unbounded read / DoS). */
export const MAX_AUDIT_PAGE_LIMIT = 100 as const;
export const DEFAULT_AUDIT_PAGE_LIMIT = 50 as const;

/**
 * Query lọc audit list. Tất cả filter optional; limit kẹp [1..MAX] (reject ngoài dải qua z), offset>=0.
 * Refine: dateFrom <= dateTo (chống dải đảo ngược). companyId CHỈ có nghĩa ở đường operator (lọc 1 tenant).
 */
export const auditLogQuerySchema = z
  .object({
    action: z.string().min(1).max(128).optional(),
    objectType: z.string().min(1).max(64).optional(),
    objectId: z.string().uuid().optional(),
    actorUserId: z.string().uuid().optional(),
    /** Chỉ operator: lọc theo 1 tenant cụ thể (bỏ trống = mọi tenant). */
    companyId: z.string().uuid().optional(),
    // ── DB-08 §8.5 filters (v2, additive — đều optional) ──
    moduleCode: z.string().min(1).max(50).optional(),
    entityType: z.string().min(1).max(100).optional(),
    entityId: z.string().uuid().optional(),
    actorType: z.string().min(1).max(50).optional(),
    requestId: z.string().min(1).max(100).optional(),
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_AUDIT_PAGE_LIMIT)
      .default(DEFAULT_AUDIT_PAGE_LIMIT),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    (q) => !q.dateFrom || !q.dateTo || new Date(q.dateFrom).getTime() <= new Date(q.dateTo).getTime(),
    { message: "dateFrom phải <= dateTo.", path: ["dateFrom"] },
  );
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

/**
 * DTO 1 dòng audit cho viewer. before/after ĐÃ redact (mask-by-server) → kiểu unknown nullable
 * (object_type nhạy cảm → null/{redacted:true}). KHÔNG kèm IP/user-agent thô cho viewer thường? — IP/UA
 * là forensic metadata công khai cho admin nên giữ; secret/PII chỉ ở before/after nên redact ở đó.
 */
export const auditLogDtoSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  actorUserId: z.string().uuid().nullable(),
  action: z.string(),
  objectType: z.string(),
  objectId: z.string().uuid().nullable(),
  /** Đã redact với object_type nhạy cảm (null hoặc {redacted:true}). */
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  // ── DB-08 §8.5 (v2, additive). Hàng legacy = null. oldValues/newValues ĐÃ redact phía server. ──
  moduleCode: z.string().nullable(),
  entityType: z.string().nullable(),
  entityId: z.string().uuid().nullable(),
  actorType: z.string().nullable(),
  /** Đã redact với field nhạy cảm (mask-by-server). */
  oldValues: z.unknown().nullable(),
  newValues: z.unknown().nullable(),
  /** Chỉ TÊN field đổi — không bao giờ chứa value (an toàn bất biến #3). */
  changedFields: z.array(z.string()).nullable(),
  sensitivityLevel: z.string().nullable(),
  resultStatus: z.string().nullable(),
  requestId: z.string().nullable(),
  correlationId: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AuditLogDto = z.infer<typeof auditLogDtoSchema>;

/** Response list audit: data + meta (total/limit/offset). */
export const auditLogListResponseSchema = z.object({
  data: z.array(auditLogDtoSchema),
  meta: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  }),
});
export type AuditLogListResponse = z.infer<typeof auditLogListResponseSchema>;

/** 1 cặp (status → count) cho outbox aggregate. */
export const outboxStatusCountSchema = z.object({
  status: z.string(),
  count: z.number().int().nonnegative(),
});
export type OutboxStatusCount = z.infer<typeof outboxStatusCountSchema>;

/** 1 dòng dead-letter cho viewer (KHÔNG payload thô — chỉ metadata forensic + error đã cắt). */
export const deadLetterRowSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  eventId: z.string().uuid(),
  consumerName: z.string(),
  eventType: z.string(),
  error: z.string(),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});
export type DeadLetterRow = z.infer<typeof deadLetterRowSchema>;

/**
 * Response queue monitor (operator cross-tenant). Đếm outbox theo status + dead-letter (unresolved/total)
 * + 1 trang dead-letter rows (row-capped). companyId optional = lọc 1 tenant.
 */
export const queueStatusResponseSchema = z.object({
  outbox: z.object({
    counts: z.array(outboxStatusCountSchema),
    total: z.number().int().nonnegative(),
  }),
  deadLetter: z.object({
    unresolved: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    rows: z.array(deadLetterRowSchema),
  }),
});
export type QueueStatusResponse = z.infer<typeof queueStatusResponseSchema>;
