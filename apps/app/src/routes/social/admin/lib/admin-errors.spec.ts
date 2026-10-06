/**
 * S16-SOCIAL-FE-3 (L1) — `admin-errors`: tập reason ĐÓNG của cụm quản trị bảng tin + phép tra «mã lỗi
 * trên dây → reason» theo bảng của TỪNG lời gọi (plan D5).
 *
 * Bảng dùng ở đây là bảng MẪU chép đúng các dòng E1–E7 của plan §3 L2 và mục «Lỗi» của L3; bảng thật
 * của từng màn nằm ở `moderation/lib/*-errors.ts` (lát sau). `message` chép nguyên văn `social.errors.ts`.
 */
import { IDEMPOTENCY_ERROR_CODES, SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import { ApiError } from "@mediaos/web-core";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  ADMIN_ERROR_REASONS,
  adminErrorReason,
  isDefiniteRefusal,
  type AdminErrorReason,
  type AdminErrorTable,
} from "./admin-errors";

const C = SOCIAL_ERROR_CODES;

/** Viết tay có chủ ý — KHÔNG suy từ `ADMIN_ERROR_REASONS`. */
const expected = (reason: string): AdminErrorReason => reason as AdminErrorReason;

const RESOLVE_TABLE = {
  [C.REPORT_ALREADY_DECIDED]: expected("reportAlreadyDecided"),
  [C.REPORT_BUSY]: expected("reportBusy"),
  [C.REPORT_ACTION_DENIED]: expected("reportActionDenied"),
  [C.REPORT_ACTION_INVALID_FOR_TARGET]: expected("reportActionInvalid"),
  [C.REPORT_ACTION_TARGET_UNAVAILABLE]: expected("reportTargetUnavailable"),
  [C.REPORT_NOT_FOUND]: expected("reportGone"),
} satisfies AdminErrorTable;

const CREATE_TABLE = {
  [C.REPORT_DUPLICATE_OPEN]: expected("reportDuplicate"),
  [C.POST_NOT_FOUND]: expected("reportTargetGone"),
  [IDEMPOTENCY_ERROR_CODES.IN_PROGRESS]: expected("busy"),
} satisfies AdminErrorTable;

const UNHIDE_TABLE = { [C.POST_NOT_FOUND]: expected("postGone") } satisfies AdminErrorTable;

describe("ADMIN_ERROR_REASONS — tập đóng của PR-A (L2 + L3) + PR-B (L4 huy hiệu)", () => {
  it("đúng 17 reason, đúng tên (danh sách viết tay)", () => {
    expect([...ADMIN_ERROR_REASONS].sort()).toEqual(
      [
        "badgeCodeTaken",
        "badgeGone",
        "busy",
        "forbidden",
        "generic",
        "invalidRequest",
        "loadFailed",
        "outcomeUnknown",
        "postGone",
        "reportActionDenied",
        "reportActionInvalid",
        "reportAlreadyDecided",
        "reportBusy",
        "reportDuplicate",
        "reportGone",
        "reportTargetGone",
        "reportTargetUnavailable",
      ].sort(),
    );
    expect(new Set(ADMIN_ERROR_REASONS).size).toBe(17);
  });
});

describe("adminErrorReason — tra theo MÃ trước, status sau", () => {
  it.each([
    [
      409,
      C.REPORT_ALREADY_DECIDED,
      "SOCIAL-ERR-021: báo cáo này đã được xử lý.",
      "reportAlreadyDecided",
    ],
    [
      409,
      C.REPORT_BUSY,
      "SOCIAL-ERR: báo cáo này đang được người khác xử lý, vui lòng thử lại.",
      "reportBusy",
    ],
    [
      403,
      C.REPORT_ACTION_DENIED,
      "SOCIAL-ERR: bạn không có quyền thực hiện hành động kiểm duyệt này.",
      "reportActionDenied",
    ],
    [
      422,
      C.REPORT_ACTION_INVALID_FOR_TARGET,
      "SOCIAL-ERR: hành động này không áp dụng được cho loại nội dung bị báo cáo.",
      "reportActionInvalid",
    ],
    [
      422,
      C.REPORT_ACTION_TARGET_UNAVAILABLE,
      "SOCIAL-ERR: nội dung bị báo cáo không còn thao tác được; hãy xử lý báo cáo mà không kèm hành động.",
      "reportTargetUnavailable",
    ],
    [404, C.REPORT_NOT_FOUND, "SOCIAL-ERR-001: không tìm thấy báo cáo.", "reportGone"],
  ] as const)("029: %i %s ⇒ %s (dòng E của plan §3 L2)", (status, code, message, reason) => {
    expect(adminErrorReason(new ApiError(status, code, message), RESOLVE_TABLE)).toBe(reason);
  });

  it("hai mã 409 của 029 KHÔNG gộp: `REPORT-BUSY` (tạm, thử lại được) ≠ `021` (kết cục cuối)", () => {
    const busy = adminErrorReason(new ApiError(409, C.REPORT_BUSY, "x"), RESOLVE_TABLE);
    const decided = adminErrorReason(
      new ApiError(409, C.REPORT_ALREADY_DECIDED, "x"),
      RESOLVE_TABLE,
    );
    expect(busy).toBe("reportBusy");
    expect(decided).toBe("reportAlreadyDecided");
  });

  it("CÙNG mã `SOCIAL-ERR-001` ra reason KHÁC nhau theo bảng của lời gọi (029 · 006 · 027)", () => {
    const gone = () =>
      new ApiError(404, C.POST_NOT_FOUND, "SOCIAL-ERR-001: không tìm thấy bài viết.");
    expect(adminErrorReason(gone(), RESOLVE_TABLE)).toBe("reportGone");
    expect(adminErrorReason(gone(), UNHIDE_TABLE)).toBe("postGone");
    expect(adminErrorReason(gone(), CREATE_TABLE)).toBe("reportTargetGone");
  });

  it("027: trùng báo cáo đang mở và idempotency đang chạy là HAI reason — mã không phải SOCIAL vẫn tra được", () => {
    const duplicate = new ApiError(
      409,
      C.REPORT_DUPLICATE_OPEN,
      "SOCIAL-ERR: bạn đã báo cáo nội dung này và báo cáo đó đang chờ xử lý.",
    );
    const inProgress = new ApiError(409, IDEMPOTENCY_ERROR_CODES.IN_PROGRESS, "đang xử lý");
    expect(adminErrorReason(duplicate, CREATE_TABLE)).toBe("reportDuplicate");
    expect(adminErrorReason(inProgress, CREATE_TABLE)).toBe("busy");
  });

  it("mã có trong bảng THẮNG status: 403 `REPORT-ACTION-DENIED` không rơi về `forbidden`", () => {
    const denied = new ApiError(403, C.REPORT_ACTION_DENIED, "x");
    expect(adminErrorReason(denied, RESOLVE_TABLE)).toBe("reportActionDenied");
    // Cùng lỗi, bảng KHÔNG khai mã đó ⇒ về `forbidden` theo status.
    expect(adminErrorReason(denied, UNHIDE_TABLE)).toBe("forbidden");
  });

  it("403 không có trong bảng ⇒ `forbidden` — kể cả `SOCIAL-ERR-010` (E8) và `AUTH-ERR-FORBIDDEN` (E9)", () => {
    const moderationDenied = new ApiError(
      403,
      C.MODERATION_FIELD_DENIED,
      "SOCIAL-ERR-010: bạn không có quyền thay đổi trường kiểm duyệt này.",
    );
    const tier1 = new ApiError(403, "AUTH-ERR-FORBIDDEN", "Forbidden");
    expect(adminErrorReason(moderationDenied, {})).toBe("forbidden");
    expect(adminErrorReason(tier1, RESOLVE_TABLE)).toBe("forbidden");
  });

  it("400 ⇒ `invalidRequest`; 500 · lỗi mạng · ZodError ⇒ `generic` (E10 · E11)", () => {
    expect(adminErrorReason(new ApiError(400, "VALIDATION-ERR-001", "x"), RESOLVE_TABLE)).toBe(
      "invalidRequest",
    );
    expect(adminErrorReason(new ApiError(500, "INTERNAL", "boom"), RESOLVE_TABLE)).toBe("generic");
    expect(adminErrorReason(new TypeError("Failed to fetch"), RESOLVE_TABLE)).toBe("generic");
    expect(adminErrorReason(new ZodError([]), RESOLVE_TABLE)).toBe("generic");
    expect(adminErrorReason(undefined, RESOLVE_TABLE)).toBe("generic");
  });

  it("`isDefiniteRefusal`: CHỈ `ApiError` 4xx là lời từ chối xác định; 5xx (kể cả 502/503/504 `HTTP_ERROR` của proxy) · status 0 · không phải `ApiError` thì không", () => {
    for (const status of [400, 403, 404, 409, 422, 429, 499]) {
      expect(isDefiniteRefusal(new ApiError(status, "ANY", "x"))).toBe(true);
    }
    for (const status of [0, 399, 500, 502, 503, 504, 599]) {
      expect(isDefiniteRefusal(new ApiError(status, "HTTP_ERROR", "x"))).toBe(false);
    }
    for (const err of [new TypeError("Failed to fetch"), new ZodError([]), undefined, "boom"]) {
      expect(isDefiniteRefusal(err)).toBe(false);
    }
  });

  it("tra bằng `Object.hasOwn`: mã trùng tên thuộc tính của Object.prototype KHÔNG ra giá trị lạ", () => {
    for (const code of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const reason = adminErrorReason(new ApiError(409, code, "x"), RESOLVE_TABLE);
      expect(reason).toBe("generic");
    }
    // Đối chứng cùng khung: mã CÓ trong bảng vẫn tra ra (ca trên không xanh vì hàm luôn trả `generic`).
    expect(adminErrorReason(new ApiError(409, C.REPORT_BUSY, "x"), RESOLVE_TABLE)).toBe(
      "reportBusy",
    );
  });

  it("API CŨ (mã chung theo status, mã SOCIAL chỉ ở tiền tố `message`) vẫn tra ra đúng reason", () => {
    const legacy = new ApiError(
      409,
      "RESOURCE-ERR-CONFLICT",
      "SOCIAL-ERR-021: báo cáo này đã được xử lý.",
    );
    expect(adminErrorReason(legacy, RESOLVE_TABLE)).toBe("reportAlreadyDecided");
  });

  it("mọi kết quả đều thuộc tập đóng `ADMIN_ERROR_REASONS`", () => {
    const reasons: readonly string[] = ADMIN_ERROR_REASONS;
    const results = [
      adminErrorReason(new ApiError(409, C.REPORT_BUSY, "x"), RESOLVE_TABLE),
      adminErrorReason(new ApiError(403, "AUTH-ERR-FORBIDDEN", "x"), RESOLVE_TABLE),
      adminErrorReason(new ApiError(400, "VALIDATION-ERR-001", "x"), RESOLVE_TABLE),
      adminErrorReason(new ApiError(500, "INTERNAL", "x"), RESOLVE_TABLE),
    ];
    expect(results).toEqual(["reportBusy", "forbidden", "invalidRequest", "generic"]);
    for (const reason of results) expect(reasons).toContain(reason);
  });
});
