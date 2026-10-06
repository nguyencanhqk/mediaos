/**
 * S16-SOCIAL-FE-3 (L3, ca P3 — tầng hàm) — lỗi của lời gọi GỬI báo cáo (`SOCIAL-API-027`): mỗi nhánh một
 * ca `new ApiError(status, code, message)` ⇒ đúng `reason` VÀ đúng cờ «thử lại được».
 *
 * `message` chép nguyên văn `apps/api/src/social/social.errors.ts` (qua `ADMIN_ERR`). Mọi vế kỳ vọng viết
 * tay — không suy từ bảng của file sản phẩm.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@mediaos/web-core";
import { ZodError } from "zod";
import { ADMIN_ERR } from "../../admin/admin-test-doubles";
import { ADMIN_ERROR_REASONS } from "../../admin/lib/admin-errors";
import { CREATE_REPORT_ERROR_TABLE, describeCreateReportError } from "./report-create-errors";

describe("027 — gửi báo cáo: mã → reason + có thử lại được không", () => {
  it("409 `SOCIAL-ERR-REPORT-DUPLICATE-OPEN` ⇒ `reportDuplicate`, KHÔNG thử lại (gửi lại vẫn trùng)", () => {
    expect(describeCreateReportError(ADMIN_ERR.reportDuplicate())).toStrictEqual({
      reason: "reportDuplicate",
      retryable: false,
    });
  });

  it("409 `REQUEST-ERR-IDEMPOTENCY-IN-PROGRESS` ⇒ `busy`, thử lại được (lượt trước còn đang chạy)", () => {
    expect(describeCreateReportError(ADMIN_ERR.idempotencyInProgress())).toStrictEqual({
      reason: "busy",
      retryable: true,
    });
  });

  it("hai mã 409 của 027 KHÔNG gộp: trùng báo cáo là kết cục, idempotency đang chạy là tạm thời", () => {
    const duplicate = describeCreateReportError(
      new ApiError(409, "SOCIAL-ERR-REPORT-DUPLICATE-OPEN", "x"),
    );
    const busy = describeCreateReportError(
      new ApiError(409, "REQUEST-ERR-IDEMPOTENCY-IN-PROGRESS", "x"),
    );
    expect([duplicate.reason, duplicate.retryable]).toEqual(["reportDuplicate", false]);
    expect([busy.reason, busy.retryable]).toEqual(["busy", true]);
  });

  it("409 mã LẠ ⇒ `generic` — không đoán thành «trùng» hay «đang xử lý» theo status", () => {
    expect(
      describeCreateReportError(new ApiError(409, "RESOURCE-ERR-CONFLICT", "x")),
    ).toStrictEqual({ reason: "generic", retryable: true });
  });

  it("404 `SOCIAL-ERR-001` ⇒ `reportTargetGone` (ở lời gọi NÀY: nội dung muốn báo cáo không còn)", () => {
    expect(describeCreateReportError(ADMIN_ERR.postGone())).toStrictEqual({
      reason: "reportTargetGone",
      retryable: false,
    });
  });

  it("404 hình dạng API CŨ (mã chung, mã SOCIAL chỉ ở tiền tố `message`) ⇒ vẫn `reportTargetGone`", () => {
    const legacy = new ApiError(
      404,
      "RESOURCE-ERR-NOT-FOUND",
      "SOCIAL-ERR-001: không tìm thấy bình luận.",
    );
    expect(describeCreateReportError(legacy).reason).toBe("reportTargetGone");
  });

  it("403 (mọi mã) ⇒ `forbidden`, KHÔNG thử lại", () => {
    expect(describeCreateReportError(ADMIN_ERR.forbidden())).toStrictEqual({
      reason: "forbidden",
      retryable: false,
    });
    expect(describeCreateReportError(ADMIN_ERR.moderationDenied()).reason).toBe("forbidden");
  });

  it("400 ⇒ `invalidRequest`, KHÔNG thử lại (gửi lại nguyên yêu cầu vẫn 400)", () => {
    expect(describeCreateReportError(ADMIN_ERR.badRequest())).toStrictEqual({
      reason: "invalidRequest",
      retryable: false,
    });
  });

  it("500 · lỗi mạng · ZodError ⇒ `generic`, thử lại được", () => {
    const expected = { reason: "generic", retryable: true };
    expect(describeCreateReportError(ADMIN_ERR.server())).toStrictEqual(expected);
    expect(describeCreateReportError(new TypeError("Failed to fetch"))).toStrictEqual(expected);
    expect(describeCreateReportError(new ZodError([]))).toStrictEqual(expected);
  });

  it("mã của lời gọi KHÁC không lọt vào đây: 409 `SOCIAL-ERR-021` (của 029) ⇒ `generic`", () => {
    expect(describeCreateReportError(ADMIN_ERR.reportAlreadyDecided()).reason).toBe("generic");
  });
});

describe("Bảng mã của 027", () => {
  it("khai ĐÚNG ba mã, mỗi mã một reason thuộc tập đóng", () => {
    expect(CREATE_REPORT_ERROR_TABLE).toStrictEqual({
      "SOCIAL-ERR-REPORT-DUPLICATE-OPEN": "reportDuplicate",
      "SOCIAL-ERR-001": "reportTargetGone",
      "REQUEST-ERR-IDEMPOTENCY-IN-PROGRESS": "busy",
    });
    const reasons: readonly string[] = ADMIN_ERROR_REASONS;
    for (const reason of Object.values(CREATE_REPORT_ERROR_TABLE)) {
      expect(reasons).toContain(reason);
    }
  });
});
