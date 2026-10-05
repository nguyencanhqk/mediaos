/**
 * S16-SOCIAL-FE-3 (L2, ca E1–E11 — tầng hàm) — lỗi của màn Kiểm duyệt: mỗi dòng của bảng lỗi plan §3 L2
 * một ca `new ApiError(status, code, message)` ⇒ đúng `reason` VÀ đúng «hành vi».
 *
 * `message` chép nguyên văn `apps/api/src/social/social.errors.ts` (qua `ADMIN_ERR`). Mọi vế kỳ vọng viết
 * tay — không suy từ bảng của file sản phẩm.
 */
import { describe, expect, it } from "vitest";
import { SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import { ApiError } from "@mediaos/web-core";
import { ZodError } from "zod";
import { ADMIN_ERR } from "../../admin/admin-test-doubles";
import { ADMIN_ERROR_REASONS } from "../../admin/lib/admin-errors";
import {
  MODERATION_READ_ERROR_TABLE,
  RESOLVE_REPORT_ERROR_TABLE,
  UNHIDE_POST_ERROR_TABLE,
  describeModerationReadError,
  describeResolveReportError,
  describeUnhidePostError,
} from "./moderation-errors";

const C = SOCIAL_ERROR_CODES;

describe("029 — kết thúc báo cáo (E1–E6)", () => {
  it("E1 · 409 `SOCIAL-ERR-021` ⇒ `reportAlreadyDecided`: ĐÓNG hộp thoại · invalidate · không thử lại", () => {
    expect(describeResolveReportError(ADMIN_ERR.reportAlreadyDecided())).toStrictEqual({
      reason: "reportAlreadyDecided",
      dialog: "close",
      resetAction: false,
      invalidate: true,
      retryable: false,
    });
  });

  it("E2 · 409 `SOCIAL-ERR-REPORT-BUSY` ⇒ `reportBusy`: GIỮ hộp thoại · bấm lại được · không invalidate", () => {
    expect(describeResolveReportError(ADMIN_ERR.reportBusy())).toStrictEqual({
      reason: "reportBusy",
      dialog: "keep",
      resetAction: false,
      invalidate: false,
      retryable: true,
    });
  });

  it("E1 ≠ E2: hai mã 409 của 029 KHÔNG gộp (kết cục cuối ≠ tạm thời)", () => {
    const decided = describeResolveReportError(new ApiError(409, C.REPORT_ALREADY_DECIDED, "x"));
    const busy = describeResolveReportError(new ApiError(409, C.REPORT_BUSY, "x"));
    expect([decided.reason, decided.dialog, decided.retryable]).toEqual([
      "reportAlreadyDecided",
      "close",
      false,
    ]);
    expect([busy.reason, busy.dialog, busy.retryable]).toEqual(["reportBusy", "keep", true]);
  });

  it("E3 · 403 `SOCIAL-ERR-REPORT-ACTION-DENIED` ⇒ `reportActionDenied`: GIỮ · đưa hành động về «không»", () => {
    expect(describeResolveReportError(ADMIN_ERR.reportActionDenied())).toStrictEqual({
      reason: "reportActionDenied",
      dialog: "keep",
      resetAction: true,
      invalidate: false,
      retryable: false,
    });
  });

  it("E4 · 422 `…ACTION-INVALID-FOR-TARGET` ⇒ `reportActionInvalid`: GIỮ · KHÔNG tự đổi hành động", () => {
    expect(describeResolveReportError(ADMIN_ERR.reportActionInvalid())).toStrictEqual({
      reason: "reportActionInvalid",
      dialog: "keep",
      resetAction: false,
      invalidate: false,
      retryable: false,
    });
  });

  it("E5 · 422 `…ACTION-TARGET-UNAVAILABLE` ⇒ `reportTargetUnavailable`: GIỮ · về «không»", () => {
    expect(describeResolveReportError(ADMIN_ERR.reportTargetUnavailable())).toStrictEqual({
      reason: "reportTargetUnavailable",
      dialog: "keep",
      resetAction: true,
      invalidate: false,
      retryable: false,
    });
  });

  it("E6 · 404 `SOCIAL-ERR-001` ⇒ `reportGone`: ĐÓNG · invalidate", () => {
    expect(describeResolveReportError(ADMIN_ERR.reportGone())).toStrictEqual({
      reason: "reportGone",
      dialog: "close",
      resetAction: false,
      invalidate: true,
      retryable: false,
    });
  });
});

describe("006 — hiện lại bài đang ẩn (E7)", () => {
  it("E7 · 404 `SOCIAL-ERR-001` ⇒ `postGone`: invalidate danh sách bài ẩn · không thử lại", () => {
    expect(describeUnhidePostError(ADMIN_ERR.postGone())).toStrictEqual({
      reason: "postGone",
      invalidate: true,
      retryable: false,
    });
  });

  it("CÙNG 404 `SOCIAL-ERR-001`: ở 029 là «báo cáo không còn», ở 006 là «bài không còn»", () => {
    const gone = () => new ApiError(404, "SOCIAL-ERR-001", "SOCIAL-ERR-001: không tìm thấy.");
    expect(describeResolveReportError(gone()).reason).toBe("reportGone");
    expect(describeUnhidePostError(gone()).reason).toBe("postGone");
  });

  it("mã của 029 KHÔNG có nghĩa ở 006: 409 `REPORT-BUSY` ⇒ `generic`, 403 `REPORT-ACTION-DENIED` ⇒ `forbidden`", () => {
    expect(describeUnhidePostError(ADMIN_ERR.reportBusy()).reason).toBe("generic");
    expect(describeUnhidePostError(ADMIN_ERR.reportActionDenied()).reason).toBe("forbidden");
  });
});

describe("đọc 028/001 (E8)", () => {
  it("E8 · 028 trả 403 `AUTH-ERR-FORBIDDEN` ⇒ `forbidden`, KHÔNG thử lại", () => {
    expect(describeModerationReadError(ADMIN_ERR.forbidden())).toStrictEqual({
      reason: "forbidden",
      retryable: false,
    });
  });

  it("E8 · 001 trả 403 `SOCIAL-ERR-010` ⇒ vẫn `forbidden` (mọi mã 403), không mang chữ của server", () => {
    const err = ADMIN_ERR.moderationDenied();
    expect(err.code).toBe("SOCIAL-ERR-010");
    const outcome = describeModerationReadError(err);
    expect(outcome).toStrictEqual({ reason: "forbidden", retryable: false });
    expect(JSON.stringify(outcome)).not.toContain("kiểm duyệt");
  });

  it("E8 · 403 với mã BẤT KỲ (kể cả mã của 029/006) ⇒ `forbidden` ở đường đọc", () => {
    for (const code of [C.REPORT_ACTION_DENIED, C.NEWS_MANAGE_REQUIRED, "ANYTHING-ELSE"]) {
      expect(describeModerationReadError(new ApiError(403, code, "x")).reason).toBe("forbidden");
    }
  });

  it("404 ở đường đọc KHÔNG phải «bài/báo cáo không còn» ⇒ `generic` + thử lại được", () => {
    expect(describeModerationReadError(ADMIN_ERR.postGone())).toStrictEqual({
      reason: "generic",
      retryable: true,
    });
  });
});

describe("lỗi chung (E9–E11)", () => {
  it("E9 · 029 trả 403 `AUTH-ERR-FORBIDDEN` ⇒ `forbidden`: ĐÓNG hộp thoại · KHÔNG thử lại", () => {
    expect(describeResolveReportError(ADMIN_ERR.forbidden())).toStrictEqual({
      reason: "forbidden",
      dialog: "close",
      resetAction: false,
      invalidate: false,
      retryable: false,
    });
  });

  it("E9 · 029 trả 403 `SOCIAL-ERR-010` ⇒ cũng `forbidden` (không phải `reportActionDenied`)", () => {
    const outcome = describeResolveReportError(ADMIN_ERR.moderationDenied());
    expect([outcome.reason, outcome.dialog, outcome.resetAction]).toEqual([
      "forbidden",
      "close",
      false,
    ]);
  });

  it("E9 · 006 trả 403 ⇒ `forbidden`: KHÔNG thử lại", () => {
    expect(describeUnhidePostError(ADMIN_ERR.forbidden())).toStrictEqual({
      reason: "forbidden",
      invalidate: false,
      retryable: false,
    });
  });

  it("E10 · 400 ⇒ `invalidRequest` ở CẢ ba lời gọi; 029 giữ hộp thoại, không thử lại", () => {
    expect(describeResolveReportError(ADMIN_ERR.badRequest())).toStrictEqual({
      reason: "invalidRequest",
      dialog: "keep",
      resetAction: false,
      invalidate: false,
      retryable: false,
    });
    expect(describeUnhidePostError(ADMIN_ERR.badRequest())).toStrictEqual({
      reason: "invalidRequest",
      invalidate: false,
      retryable: false,
    });
    expect(describeModerationReadError(ADMIN_ERR.badRequest())).toStrictEqual({
      reason: "invalidRequest",
      retryable: false,
    });
  });

  it("E11 · 500 ⇒ `generic` + «Thử lại» ở CẢ ba lời gọi; 029 giữ hộp thoại", () => {
    expect(describeResolveReportError(ADMIN_ERR.server())).toStrictEqual({
      reason: "generic",
      dialog: "keep",
      resetAction: false,
      invalidate: false,
      retryable: true,
    });
    expect(describeUnhidePostError(ADMIN_ERR.server())).toStrictEqual({
      reason: "generic",
      invalidate: false,
      retryable: true,
    });
    expect(describeModerationReadError(ADMIN_ERR.server())).toStrictEqual({
      reason: "generic",
      retryable: true,
    });
  });

  it("E11 · lỗi mạng · ZodError · không phải Error ⇒ `generic` + thử lại được", () => {
    for (const err of [new TypeError("Failed to fetch"), new ZodError([]), undefined, "boom"]) {
      expect(describeResolveReportError(err)).toMatchObject({
        reason: "generic",
        dialog: "keep",
        retryable: true,
      });
      expect(describeUnhidePostError(err)).toMatchObject({ reason: "generic", retryable: true });
      expect(describeModerationReadError(err)).toMatchObject({
        reason: "generic",
        retryable: true,
      });
    }
  });
});

describe("hình dạng API CŨ — mã SOCIAL chỉ nằm ở tiền tố `message`", () => {
  it("029: 409 `RESOURCE-ERR-CONFLICT` + «SOCIAL-ERR-021: …» ⇒ `reportAlreadyDecided`, đóng + invalidate", () => {
    const legacy = new ApiError(
      409,
      "RESOURCE-ERR-CONFLICT",
      "SOCIAL-ERR-021: báo cáo này đã được xử lý.",
    );
    expect(describeResolveReportError(legacy)).toStrictEqual({
      reason: "reportAlreadyDecided",
      dialog: "close",
      resetAction: false,
      invalidate: true,
      retryable: false,
    });
  });

  it("404 `RESOURCE-ERR-NOT-FOUND` + «SOCIAL-ERR-001: …» ⇒ `reportGone` ở 029, `postGone` ở 006", () => {
    const legacy = () =>
      new ApiError(404, "RESOURCE-ERR-NOT-FOUND", "SOCIAL-ERR-001: không tìm thấy bài viết.");
    expect(describeResolveReportError(legacy()).reason).toBe("reportGone");
    expect(describeUnhidePostError(legacy())).toStrictEqual({
      reason: "postGone",
      invalidate: true,
      retryable: false,
    });
  });

  it("403 `AUTH-ERR-FORBIDDEN` + «SOCIAL-ERR-010: …» (đọc 001) ⇒ `forbidden`", () => {
    const legacy = new ApiError(
      403,
      "AUTH-ERR-FORBIDDEN",
      "SOCIAL-ERR-010: bạn không có quyền thay đổi trường kiểm duyệt này.",
    );
    expect(describeModerationReadError(legacy)).toStrictEqual({
      reason: "forbidden",
      retryable: false,
    });
  });
});

describe("bảng mã theo TỪNG lời gọi", () => {
  it("029 khai đúng 6 mã (viết tay)", () => {
    expect(RESOLVE_REPORT_ERROR_TABLE).toEqual({
      "SOCIAL-ERR-021": "reportAlreadyDecided",
      "SOCIAL-ERR-REPORT-BUSY": "reportBusy",
      "SOCIAL-ERR-REPORT-ACTION-DENIED": "reportActionDenied",
      "SOCIAL-ERR-REPORT-ACTION-INVALID-FOR-TARGET": "reportActionInvalid",
      "SOCIAL-ERR-REPORT-ACTION-TARGET-UNAVAILABLE": "reportTargetUnavailable",
      "SOCIAL-ERR-001": "reportGone",
    });
  });

  it("006 khai đúng 1 mã; đường đọc KHÔNG khai mã nào (chỉ phân xử theo status)", () => {
    expect(UNHIDE_POST_ERROR_TABLE).toEqual({ "SOCIAL-ERR-001": "postGone" });
    expect(MODERATION_READ_ERROR_TABLE).toEqual({});
    // Ghim cùng lúc để ca không xanh trên ba bảng rỗng.
    expect(Object.keys(RESOLVE_REPORT_ERROR_TABLE)).toHaveLength(6);
  });

  it("mọi reason trả ra thuộc tập đóng `ADMIN_ERROR_REASONS` (có câu ở `admin.error.*`)", () => {
    const known: readonly string[] = ADMIN_ERROR_REASONS;
    const errors = Object.values(ADMIN_ERR).map((make) => make());
    const reasons = errors.flatMap((err) => [
      describeResolveReportError(err).reason,
      describeUnhidePostError(err).reason,
      describeModerationReadError(err).reason,
    ]);
    for (const reason of reasons) expect(known).toContain(reason);
    // Đường đọc chỉ ra ba reason chung — không bao giờ ra reason riêng của 029/006/027.
    expect([...new Set(errors.map((e) => describeModerationReadError(e).reason))].sort()).toEqual([
      "forbidden",
      "generic",
      "invalidRequest",
    ]);
  });
});
