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
