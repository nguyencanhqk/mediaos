import { HttpStatus } from "@nestjs/common";
// S2-FND-CONTRACT-1 — reconcile drift: mã lỗi FOUNDATION sống ở @mediaos/contracts (nguồn sự thật DTO,
// CLAUDE.md §4). Re-export LẠI qua đây GIỮ Y NGUYÊN tên symbol để consumer cũ (nếu có) không phải đổi
// import; đồng thời mở catalog nghiệp vụ chung FOUNDATION_ERROR_CODES cho AllExceptionsFilter/tra cứu.
export { FOUNDATION_ERROR_CODES, FOUNDATION_FILE_ERROR_CODES } from "@mediaos/contracts";
export type { FoundationErrorCode, FoundationFileErrorCode } from "@mediaos/contracts";

/**
 * Mã lỗi nghiệp vụ chuẩn (API-01 §13.2 / SPEC-01 §9 `MODULE-ERR-XXX`).
 *
 * Dùng ở `AllExceptionsFilter` để trả `error.code` ổn định cho client (UI bắt theo code,
 * KHÔNG so khớp message). Đây là bộ lõi cho foundation; module nghiệp vụ bổ sung mã riêng
 * (vd `LEAVE-ERR-...`) trong domain của nó.
 */
export const ERROR_CODES = {
  AUTH_UNAUTHENTICATED: "AUTH-ERR-UNAUTHENTICATED",
  AUTH_FORBIDDEN: "AUTH-ERR-FORBIDDEN",
  VALIDATION: "VALIDATION-ERR-001",
  RESOURCE_NOT_FOUND: "RESOURCE-ERR-NOT-FOUND",
  RESOURCE_CONFLICT: "RESOURCE-ERR-CONFLICT",
  RATE_LIMITED: "SYSTEM-ERR-RATE-LIMIT",
  /** 4xx không khớp mã cụ thể nào — lỗi từ phía client (KHÔNG phải lỗi hệ thống). */
  REQUEST: "REQUEST-ERR-001",
  SYSTEM: "SYSTEM-ERR-001",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * FOUNDATION-FILE-* — mã lỗi domain `file_links` (S2-FND-DB-2-B, append-only bổ sung vào catalog chung ở
 * trên). Đăng KÝ SỚM ở đây theo yêu cầu WO; S2-FND-CONTRACT-1 sẽ RECONCILE toàn bộ catalog FOUNDATION-*
 * (Swagger + đầy đủ mã) sau — bổ sung này KHÔNG xung đột, KHÔNG đổi mã đã có.
 *
 * 2 mã phân biệt theo TÊN constraint DB vi phạm (23505) — KHÔNG gộp chung 1 mã cho 2 nguyên nhân khác nhau
 * (xem `FileService.link()`):
 *  - DUP_LINK: vi phạm `uq_file_links_entity_file_active` (6 cột, mig 0472) — file NÀY đã được gắn vào
 *    ĐÚNG entity này với ĐÚNG link_type này (còn active, deleted_at IS NULL).
 *  - DUP_PRIMARY: vi phạm `uq_file_links_primary_per_entity_type` (5 cột is_primary, mig 0433) — entity
 *    này ĐÃ có 1 file KHÁC được đánh dấu primary cho cùng link_type (không thể có 2 primary song song).
 */
export const FOUNDATION_FILE_ERROR_CODES = {
  DUP_LINK: "FOUNDATION-FILE-ERR-DUP-LINK",
  DUP_PRIMARY: "FOUNDATION-FILE-ERR-DUP-PRIMARY",
} as const;

export type FoundationFileErrorCode =
  (typeof FOUNDATION_FILE_ERROR_CODES)[keyof typeof FOUNDATION_FILE_ERROR_CODES];

/**
 * Map HTTP status → mã lỗi chuẩn. Fallback cho exception KHÔNG mang sẵn `code` hợp lệ trong payload.
 * 5xx luôn quy về `SYSTEM-ERR-001` (không lộ chi tiết nội bộ — security.md).
 */
export function httpStatusToCode(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return ERROR_CODES.AUTH_UNAUTHENTICATED;
    case HttpStatus.FORBIDDEN:
      return ERROR_CODES.AUTH_FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ERROR_CODES.RESOURCE_NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ERROR_CODES.RESOURCE_CONFLICT;
    case HttpStatus.UNPROCESSABLE_ENTITY:
    case HttpStatus.BAD_REQUEST:
      return ERROR_CODES.VALIDATION;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ERROR_CODES.RATE_LIMITED;
    default:
      // 5xx → mã hệ thống chung (không lộ chi tiết nội bộ). 4xx chưa map → lỗi client chung
      // (KHÔNG quy về SYSTEM để monitoring không nhãn-sai client-error thành lỗi server).
      return status >= HttpStatus.INTERNAL_SERVER_ERROR ? ERROR_CODES.SYSTEM : ERROR_CODES.REQUEST;
  }
}
