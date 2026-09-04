/**
 * error-mapper.ts — Map ApiError → UI behavior (FRONTEND-04 §22, §23).
 *
 * Mọi lỗi API được map thành `ErrorUiMapping` mô tả UI phải làm gì:
 * toast lỗi, hiện form error, hiện trang 403, redirect login, v.v.
 *
 * KHÔNG import React — chạy được cả trong test node và React component.
 */

import { ApiError } from "./api-client";
import type { ApiValidationDetail } from "./api-types";

// ── UI behavior constants ─────────────────────────────────────────────────────

export type ErrorUiBehavior =
  | "NONE"
  | "TOAST_ERROR"
  | "TOAST_WARNING"
  | "FORM_ERRORS"
  | "FORBIDDEN_PAGE"
  | "NOT_FOUND_PAGE"
  | "INLINE_ALERT"
  | "ERROR_STATE"
  | "MAINTENANCE_STATE"
  | "REDIRECT_LOGIN";

export interface ErrorUiMapping {
  behavior: ErrorUiBehavior;
  title?: string;
  message: string;
  canRetry?: boolean;
  requestId?: string;
}

// ── Core mapper ───────────────────────────────────────────────────────────────

/**
 * Map bất kỳ lỗi nào (ApiError hoặc unknown) sang ErrorUiMapping (FRONTEND-04 §22.2).
 *
 * Caller dùng `mapping.behavior` để quyết định hiện toast/page state/redirect.
 * ApiError.kind là ApiErrorKind (typed) — không cần cast sau khi ApiError có .kind.
 */
export function mapApiErrorToUi(error: unknown): ErrorUiMapping {
  if (!(error instanceof ApiError)) {
    return {
      behavior: "TOAST_ERROR",
      message: "Có lỗi không xác định. Vui lòng thử lại.",
    };
  }

  const base = {
    message: error.message,
    requestId: error.requestId,
  };

  switch (error.kind) {
    case "UNAUTHENTICATED":
    case "TOKEN_EXPIRED":
      return {
        ...base,
        behavior: "REDIRECT_LOGIN",
        message: "Phiên đăng nhập đã hết hạn.",
      };
    case "FORBIDDEN":
    case "SCOPE_DENIED":
      return {
        ...base,
        behavior: "FORBIDDEN_PAGE",
        title: "Không có quyền truy cập",
      };
    case "VALIDATION":
      return { ...base, behavior: "FORM_ERRORS" };
    case "NOT_FOUND":
      return {
        ...base,
        behavior: "NOT_FOUND_PAGE",
        title: "Không tìm thấy dữ liệu",
      };
    case "CONFLICT":
      return { ...base, behavior: "INLINE_ALERT", canRetry: true };
    case "BUSINESS_RULE":
      return { ...base, behavior: "TOAST_WARNING" };
    case "NETWORK":
      return { ...base, behavior: "ERROR_STATE", canRetry: true };
    case "MAINTENANCE":
      return { ...base, behavior: "MAINTENANCE_STATE", canRetry: true };
    case "RATE_LIMIT":
      return { ...base, behavior: "TOAST_WARNING", canRetry: true };
    case "SERVER":
    case "UNKNOWN":
    default:
      return { ...base, behavior: "ERROR_STATE", canRetry: true };
  }
}

// ── Validation detail helpers ─────────────────────────────────────────────────

/**
 * Type guard: kiểm tra `details` có phải mảng ApiValidationDetail không.
 * Narrow unknown → ErrorDetail[] an toàn (KHÔNG dùng `as`).
 * Dùng trước khi xử lý form errors (FRONTEND-04 §23.1).
 */
export function isValidationDetails(details: unknown): details is ApiValidationDetail[] {
  return (
    Array.isArray(details) &&
    details.every(
      (item) => typeof item === "object" && item !== null && "field" in item && "message" in item,
    )
  );
}

/**
 * Lấy `details` từ ApiError nếu là validation details.
 * Trả `null` nếu error không phải VALIDATION hoặc details không đúng format.
 */
export function extractValidationDetails(error: unknown): ApiValidationDetail[] | null {
  if (!(error instanceof ApiError)) return null;
  if (!isValidationDetails(error.details)) return null;
  return error.details;
}

// ── Lỗi mang `kind` (bản CHUNG cho asset/payroll/recruit/room) ────────────────

/**
 * Thông tin đã bóc từ một lỗi API mang `kind` nghiệp vụ.
 *
 * Trước S14-FE-DEBT-1 mỗi module RECRUIT/ASSET/ROOM/PAYROLL tự khai một interface y hệt
 * (`RecruitErrorInfo`, `AssetErrorInfo`, …) kèm một bản `readDetailFields` byte-identical.
 * Bốn bản đó nay là alias của bản này.
 */
export interface KindErrorInfo {
  /** Mã lỗi envelope (`error.code`) — `ASSET-ERR-008`, `VALIDATION-ERR-001`… `null` nếu không phải ApiError. */
  readonly code: string | null;
  readonly status: number | null;
  /** `details[].field === "kind"` → `.message`. `null` khi backend không gửi kind. */
  readonly kind: string | null;
  /** Thông điệp thô từ server — dùng làm fallback cuối. */
  readonly message: string;
  /** Mọi cặp `field → message` của `details`, để phía gọi đọc tham số phụ (`capacity`, `count`…). */
  readonly fields: ReadonlyMap<string, string>;
}

/**
 * Đọc `details` (unknown) thành bảng `field → message`.
 *
 * `details` là **MẢNG** `ErrorDetail{field,message,rule}` — KHÔNG phải object `{kind:…}`. Đọc nhầm
 * thành object trả `undefined` và nuốt lỗi trong im lặng; đó là lý do hàm này tồn tại thay vì
 * `details?.kind`. Nằm trên đường xử lý lỗi nên **không bao giờ ném**: hình sai ⇒ bảng rỗng.
 * Field trùng thì phần tử ĐẦU thắng.
 */
export function readDetailFields(details: unknown): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(details)) return out;
  for (const d of details) {
    if (typeof d !== "object" || d === null) continue;
    const field = (d as { field?: unknown }).field;
    const message = (d as { message?: unknown }).message;
    if (typeof field === "string" && typeof message === "string" && !out.has(field)) {
      out.set(field, message);
    }
  }
  return out;
}

/**
 * Bóc `code`/`status`/`kind`/`message`/`fields` từ một lỗi bất kỳ.
 *
 * Không phải `ApiError` (lỗi mạng, lỗi lập trình) ⇒ code/status/kind = `null`, giữ `message` nếu là
 * `Error`, ngược lại chuỗi rỗng. Phía gọi tự map `kind` → khoá i18n của namespace mình.
 */
export function parseKindError(error: unknown): KindErrorInfo {
  if (!(error instanceof ApiError)) {
    return {
      code: null,
      status: null,
      kind: null,
      message: error instanceof Error ? error.message : "",
      fields: new Map(),
    };
  }
  const fields = readDetailFields(error.details);
  return {
    code: error.code,
    status: error.status,
    kind: fields.get("kind") ?? null,
    message: error.message,
    fields,
  };
}

// ── Toast helper ──────────────────────────────────────────────────────────────

/**
 * Giao diện toast tối giản — tránh hard dependency vào thư viện toast cụ thể.
 * App inject bằng `configureToast(toast)` khi khởi động.
 */
export interface ToastFn {
  error: (message: string) => void;
  warning: (message: string) => void;
}

let _toast: ToastFn | null = null;

/** App gọi 1 lần khi khởi động để inject toast library (vd: sonner). */
export function configureToast(toast: ToastFn): void {
  _toast = toast;
}

/**
 * Hiện toast lỗi dựa trên ErrorUiMapping (FRONTEND-04 §22.3).
 *
 * Nếu chưa `configureToast`, fallback sang `console.error` để không crash.
 * Hành vi:
 * - TOAST_WARNING → warning toast (business rule, rate limit)
 * - TOAST_ERROR / ERROR_STATE / INLINE_ALERT → error toast
 * - Các behavior khác (FORBIDDEN_PAGE, REDIRECT_LOGIN, v.v.) → không hiện toast (caller xử lý)
 */
export function showApiErrorToast(error: unknown): void {
  const mapping = mapApiErrorToUi(error);

  const warn = () => {
    if (_toast) {
      _toast.warning(mapping.message);
    } else {
      console.warn("[api]", mapping.message);
    }
  };

  const err = () => {
    if (_toast) {
      _toast.error(mapping.message);
    } else {
      console.error("[api]", mapping.message);
    }
  };

  if (mapping.behavior === "TOAST_WARNING") {
    warn();
    return;
  }

  if (["TOAST_ERROR", "ERROR_STATE", "INLINE_ALERT"].includes(mapping.behavior)) {
    err();
  }
}
