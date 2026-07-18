import { z } from "zod";
import { auditLogDtoSchema, type AuditLogDto, type AuditLogQuery } from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * HR Audit Logs API client — S2-FE-HR-6.
 *
 * TÁI DÙNG endpoint chung GET /foundation/audit-logs (apps/api/src/foundation/audit/audit.controller.ts,
 * AuditQueryService) — KHÔNG dựng endpoint mới. Gate: view:audit-log (cặp seed THẬT mig 0340,
 * is_sensitive=true, grant company-admin). Lọc theo module HR qua `moduleCode=HR` (DB-08 §8.5 filter,
 * packages/contracts/src/observability.ts). before/after/oldValues/newValues ĐÃ redact phía server
 * (BẤT BIẾN #3) — client CHỈ render field DTO trả về, KHÔNG tự suy field bị ẩn.
 *
 * HÌNH DẠNG RESPONSE (sửa 2026-07-18): controller trả `paginated(rows, pagination)` — interceptor HOIST
 * `pagination` lên top-level envelope, nhưng `apiFetch`/`unwrapEnvelope` CHỈ trích `.data` (MẢNG TRẦN),
 * pagination bị bỏ (cùng hạn chế với contracts-api / my-notification-api / notification-admin-api /
 * me-api). Vì vậy validator PHẢI là `z.array(auditLogDtoSchema)` — truyền schema hình
 * `{data, meta:{total,limit,offset}}` sẽ ném ZodError "Expected object, received array" NGAY CẢ KHI
 * HTTP 200 (bug đã gặp: màn /hr/audit-logs luôn hiện "Không thể tải lịch sử"). Không có `total` ⇒
 * caller phân trang bằng heuristic `items.length === limit ⇒ còn trang sau`.
 *
 * ⚠️ `auditLogListResponseSchema` trong contracts mô tả hình dạng TRƯỚC PR #16 (ea8fb25c, chuyển sang
 * pagination top-level API-01 §16.1) — KHÔNG endpoint nào trả hình đó nữa. ĐỪNG dùng lại làm validator.
 */

const HR_MODULE_CODE = "HR" as const;

/** Mảng trần — xem ghi chú hình dạng response ở trên. */
const hrAuditLogListSchema = z.array(auditLogDtoSchema);

export type HrAuditLogQuery = Omit<Partial<AuditLogQuery>, "moduleCode">;

export const hrAuditApi = {
  /** GET /foundation/audit-logs?moduleCode=HR — lịch sử thay đổi HR (mảng trần, KHÔNG có total). */
  listHrAuditLogs: (query: HrAuditLogQuery = {}): Promise<AuditLogDto[]> => {
    const qs = buildQueryString({ ...query, moduleCode: HR_MODULE_CODE });
    return apiFetch(`/foundation/audit-logs${qs}`, hrAuditLogListSchema);
  },
};
