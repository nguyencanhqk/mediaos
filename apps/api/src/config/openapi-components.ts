import type { SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import { ERROR_CODES } from "../common/errors/error-codes";

/**
 * S5-BE-CONTRACT-1 (WS-D §13.2) — Component OpenAPI dùng lại cho ENVELOPE chuẩn API-01 §11/§12.
 *
 * Nguồn sự thật của hình dạng envelope là Zod ở `packages/contracts` (`apiResponseSchema`,
 * `apiErrorSchema`, `responseMetaSchema`, `paginationSchema`) — các schema dưới đây là bản DỊCH
 * sang JSON-Schema cho tài liệu, và `openapi-components.spec.ts` khẳng định 2 bên KHÔNG lệch field
 * (parse mẫu dựng từ chính component qua Zod thật) ⇒ đổi contracts mà quên doc sẽ ĐỎ.
 *
 * BẤT BIẾN #3: đây là schema KHUNG (không có field nghiệp vụ) ⇒ không thể lộ dữ liệu nhạy cảm.
 * Phần `data` cố ý để mở (`nullable`, không ràng buộc) vì response body theo từng endpoint CHƯA được
 * tài liệu hoá — xem ghi chú "DEFERRED" ở `openapi-enrich.ts`.
 */

/** Tên component (dùng cho `$ref`) — export để test/enrich tham chiếu, tránh chuỗi ma. */
export const COMPONENT_NAMES = {
  errorEnvelope: "ApiErrorEnvelope",
  successEnvelope: "ApiSuccessEnvelope",
  errorDetail: "ApiErrorDetail",
  errorBody: "ApiErrorBody",
  responseMeta: "ApiResponseMeta",
  pagination: "ApiPagination",
} as const;

const refTo = (name: string): SchemaObject =>
  ({ $ref: `#/components/schemas/${name}` }) as SchemaObject;

/** `errorDetailSchema` — lỗi field-level (validation). */
const errorDetailSchema: SchemaObject = {
  type: "object",
  description: "Lỗi ở cấp field (validation) — map thẳng vào form phía client.",
  required: ["field", "message"],
  properties: {
    field: { type: "string", description: "Đường dẫn field (vd `email`, `items.0.qty`)." },
    message: { type: "string", description: "Thông điệp hiển thị được cho người dùng." },
    rule: { type: "string", description: "Mã rule Zod vi phạm (vd `invalid_type`)." },
  },
};

/** `responseMetaSchema` — meta truy vết đính kèm MỌI response. */
const responseMetaSchema: SchemaObject = {
  type: "object",
  description: "Meta truy vết — có ở MỌI response (thành công lẫn lỗi).",
  required: ["request_id", "timestamp"],
  properties: {
    request_id: {
      type: "string",
      description:
        "Định danh request, echo lại từ header `X-Request-Id` của client (rỗng nếu client không gửi). Dùng để đối chiếu log server.",
    },
    timestamp: {
      type: "string",
      format: "date-time",
      description: "Thời điểm server trả (ISO-8601).",
    },
  },
};

/** `paginationSchema` — API-01 §16.1, khối RIÊNG ở cấp đỉnh (KHÔNG nằm trong `meta`). */
const paginationSchema: SchemaObject = {
  type: "object",
  description:
    "Khối phân trang — CHỈ có ở endpoint dạng danh sách phân trang, nằm ở CẤP ĐỈNH envelope (sibling của `data`), KHÔNG nằm trong `meta`.",
  required: ["page", "per_page", "total", "total_pages", "has_next", "has_prev"],
  properties: {
    page: { type: "integer", minimum: 1, description: "Trang hiện tại (1-based)." },
    per_page: { type: "integer", minimum: 1, description: "Số bản ghi mỗi trang." },
    total: { type: "integer", minimum: 0, description: "Tổng số bản ghi khớp bộ lọc." },
    total_pages: { type: "integer", minimum: 0, description: "Tổng số trang." },
    has_next: { type: "boolean" },
    has_prev: { type: "boolean" },
  },
};

/** `apiErrorSchema` — khối `error` của envelope lỗi. */
const apiErrorSchema: SchemaObject = {
  type: "object",
  required: ["code", "message"],
  properties: {
    code: {
      type: "string",
      description:
        "Mã lỗi ổn định theo SPEC-01 §9 (`MODULE-ERR-XXX`). Client PHẢI bắt theo mã này, KHÔNG so khớp `message`.",
      example: ERROR_CODES.VALIDATION,
    },
    message: {
      type: "string",
      description: "Thông điệp hiển thị được (4xx). 5xx luôn là thông điệp chung.",
    },
    type: {
      type: "string",
      description:
        "Tên class exception phía server (vd `ZodValidationException`, `ForbiddenException`).",
    },
    details: {
      type: "array",
      nullable: true,
      description: "Lỗi field-level — chỉ có với lỗi validation, `null` khi không áp dụng.",
      items: refTo(COMPONENT_NAMES.errorDetail),
    },
  },
};

/** Envelope LỖI — `AllExceptionsFilter` bọc MỌI lỗi thành hình dạng này. */
const errorEnvelopeSchema: SchemaObject = {
  type: "object",
  description: "Envelope lỗi chuẩn (API-01 §12) — mọi phản hồi 4xx/5xx đều có hình dạng này.",
  required: ["success", "message", "data", "error", "meta"],
  properties: {
    success: { type: "boolean", enum: [false], description: "Luôn `false` ở nhánh lỗi." },
    message: { type: "string" },
    data: { type: "object", nullable: true, description: "Luôn `null` ở nhánh lỗi." },
    error: refTo(COMPONENT_NAMES.errorBody),
    meta: refTo(COMPONENT_NAMES.responseMeta),
  },
};

/** Envelope THÀNH CÔNG — `ResponseEnvelopeInterceptor` bọc mọi 2xx thành hình dạng này. */
const successEnvelopeSchema: SchemaObject = {
  type: "object",
  description:
    "Envelope thành công chuẩn (API-01 §11). `data` là payload riêng của từng endpoint — hình dạng chi tiết chưa được tài liệu hoá ở bản này (xem mô tả đầu tài liệu).",
  required: ["success", "message", "data", "error", "meta"],
  properties: {
    success: { type: "boolean", enum: [true] },
    message: { type: "string", example: "OK" },
    data: { nullable: true, description: "Payload của endpoint (`null` khi không có nội dung)." },
    error: { type: "object", nullable: true, description: "Luôn `null` ở nhánh thành công." },
    meta: refTo(COMPONENT_NAMES.responseMeta),
    pagination: refTo(COMPONENT_NAMES.pagination),
  },
};

/**
 * Bộ component envelope thêm vào `components.schemas`. Tên `ApiErrorBody` là khối `error` bên trong
 * envelope lỗi (tách riêng để `$ref` gọn và test đối chiếu được với `apiErrorSchema` của contracts).
 */
export function envelopeComponents(): Record<string, SchemaObject> {
  return {
    [COMPONENT_NAMES.errorDetail]: errorDetailSchema,
    [COMPONENT_NAMES.responseMeta]: responseMetaSchema,
    [COMPONENT_NAMES.pagination]: paginationSchema,
    [COMPONENT_NAMES.errorBody]: apiErrorSchema,
    [COMPONENT_NAMES.errorEnvelope]: errorEnvelopeSchema,
    [COMPONENT_NAMES.successEnvelope]: successEnvelopeSchema,
  };
}

/** Một phản hồi lỗi chuẩn hoá được gắn tự động cho operation. */
export interface StandardErrorResponse {
  status: string;
  description: string;
}

/**
 * Catalog lỗi CHUẨN gắn tự động (xem `openapi-enrich.ts` để biết điều kiện gắn từng mã).
 *
 * CHỦ Ý KHÔNG gắn đại trà 409/422/429: gắn mã mà endpoint KHÔNG bao giờ trả là tài liệu SAI (client
 * sẽ code nhánh chết). 409/422/429 phát sinh theo rule nghiệp vụ của từng endpoint và được mô tả ở
 * catalog mã lỗi trong phần mô tả tài liệu + `docs/spec/` — nguồn sự thật nghiệp vụ.
 */
export const STANDARD_ERROR_RESPONSES = {
  badRequest: {
    status: "400",
    description: `Dữ liệu vào không hợp lệ (Zod) — \`error.code = ${ERROR_CODES.VALIDATION}\`, \`error.details[]\` chứa lỗi từng field.`,
  },
  unauthorized: {
    status: "401",
    description: `Chưa xác thực hoặc access token hết hạn — \`error.code = ${ERROR_CODES.AUTH_UNAUTHENTICATED}\`. Client làm mới token qua \`POST /auth/refresh\` rồi thử lại ĐÚNG 1 lần.`,
  },
  forbidden: {
    status: "403",
    description: `Thiếu quyền hoặc ngoài phạm vi dữ liệu (data scope) — \`error.code = ${ERROR_CODES.AUTH_FORBIDDEN}\`. Body KHÔNG chứa dữ liệu nghiệp vụ.`,
  },
  notFound: {
    status: "404",
    description: `Không tìm thấy tài nguyên trong phạm vi công ty/quyền của người gọi — \`error.code = ${ERROR_CODES.RESOURCE_NOT_FOUND}\`.`,
  },
  serverError: {
    status: "500",
    description: `Lỗi hệ thống — \`error.code = ${ERROR_CODES.SYSTEM}\`, thông điệp chung (KHÔNG lộ chi tiết nội bộ). Đối chiếu log server bằng \`meta.request_id\`.`,
  },
} as const satisfies Record<string, StandardErrorResponse>;
