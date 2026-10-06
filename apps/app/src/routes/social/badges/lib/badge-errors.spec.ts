/**
 * S16-SOCIAL-FE-3B (L4, ca F3) — bảng lỗi của màn Thiết lập huy hiệu, TỪNG lời gọi một bảng:
 * 049 (tạo) · 050 (sửa trong hộp thoại) · 051 / 050 `{isActive:true}` (ngừng dùng / bật lại ở hàng) · 056 (đọc).
 *
 * Mọi vế kỳ vọng VIẾT TAY (không suy từ bảng của mã nguồn). Lỗi dựng bằng `ADMIN_ERR` — đúng hình dạng
 * trên dây. `toStrictEqual` trên cả object ⇒ kết quả không có trường nào chở `message` của server.
 */
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { ApiError } from "@mediaos/web-core";
import { ADMIN_ERR } from "../../admin/admin-test-doubles";
import { ADMIN_ERROR_REASONS } from "../../admin/lib/admin-errors";
import { GuardedMutationTimeoutError } from "../../admin/lib/use-guarded-mutation";
import {
  describeBadgeReadError,
  describeCreateBadgeError,
  describeToggleBadgeError,
  describeUpdateBadgeError,
} from "./badge-errors";

/** Mọi thứ KHÔNG phải một lời từ chối 4xx của server: server có thể đã ghi. */
const NO_READABLE_ANSWER: readonly (readonly [string, () => unknown])[] = [
  ["500 có envelope", () => ADMIN_ERR.server()],
  ["502 của reverse proxy", () => new ApiError(502, "HTTP_ERROR", "Bad Gateway")],
  ["mất mạng", () => new TypeError("Failed to fetch")],
  ["hết hạn chờ 30 giây", () => new GuardedMutationTimeoutError()],
  ["2xx mà thân hỏng schema", () => new ZodError([])],
  ["thứ không phải Error", () => "boom"],
];

const UNKNOWN_4XX = (): ApiError => new ApiError(422, "SOME-NEW-CODE", "SOCIAL-ERR: mã chưa biết.");

describe("F3 — 049 tạo huy hiệu (`describeCreateBadgeError`)", () => {
  it("409 `KUDOS-BADGE-CODE-TAKEN` ⇒ `badgeCodeTaken`: GIỮ hộp thoại, lỗi gắn ô `code`, đọc lại danh sách, không mời thử lại", () => {
    expect(describeCreateBadgeError(ADMIN_ERR.badgeCodeTaken())).toStrictEqual({
      reason: "badgeCodeTaken",
      dialog: "keep",
      field: "code",
      invalidate: true,
      retryable: false,
    });
  });

  it("409 idempotency đang chạy ⇒ `busy` — KHÁC `badgeCodeTaken` dù cùng status 409; thử lại được", () => {
    expect(describeCreateBadgeError(ADMIN_ERR.idempotencyInProgress())).toStrictEqual({
      reason: "busy",
      dialog: "keep",
      field: null,
      invalidate: false,
      retryable: true,
    });
  });

  it("400 ⇒ `invalidRequest` (giữ, không thử lại) · 403 ⇒ `forbidden` (ĐÓNG, dải ở trang)", () => {
    expect(describeCreateBadgeError(ADMIN_ERR.badRequest())).toStrictEqual({
      reason: "invalidRequest",
      dialog: "keep",
      field: null,
      invalidate: false,
      retryable: false,
    });
    expect(describeCreateBadgeError(ADMIN_ERR.forbidden())).toStrictEqual({
      reason: "forbidden",
      dialog: "close",
      field: null,
      invalidate: false,
      retryable: false,
    });
  });

  it("4xx mã lạ ⇒ `generic`: server ĐÃ từ chối, chưa ghi ⇒ giữ + thử lại, không đọc lại danh sách", () => {
    expect(describeCreateBadgeError(UNKNOWN_4XX())).toStrictEqual({
      reason: "generic",
      dialog: "keep",
      field: null,
      invalidate: false,
      retryable: true,
    });
  });

  it("mã của lời gọi KHÁC không được hiểu ở đây: 404 `KUDOS-BADGE-NOT-FOUND` ở 049 ⇒ `generic`, không `badgeGone`", () => {
    expect(describeCreateBadgeError(ADMIN_ERR.badgeGone()).reason).toBe("generic");
  });

  it.each(NO_READABLE_ANSWER)(
    "%s ⇒ `outcomeUnknown`: giữ hộp thoại, BÁO trang đọc lại danh sách, thử lại được",
    (_name, make) => {
      expect(describeCreateBadgeError(make())).toStrictEqual({
        reason: "outcomeUnknown",
        dialog: "keep",
        field: null,
        invalidate: true,
        retryable: true,
      });
    },
  );
});

describe("F3 — 050 sửa huy hiệu trong hộp thoại (`describeUpdateBadgeError`)", () => {
  it("404 `KUDOS-BADGE-NOT-FOUND` ⇒ `badgeGone`: ĐÓNG hộp thoại + invalidate, không thử lại", () => {
    expect(describeUpdateBadgeError(ADMIN_ERR.badgeGone())).toStrictEqual({
      reason: "badgeGone",
      dialog: "close",
      field: null,
      invalidate: true,
      retryable: false,
    });
  });

  it("400 ⇒ `invalidRequest` · 403 ⇒ `forbidden` (đóng) · 4xx mã lạ ⇒ `generic` (giữ + thử lại)", () => {
    expect(describeUpdateBadgeError(ADMIN_ERR.badRequest())).toMatchObject({
      reason: "invalidRequest",
      dialog: "keep",
      retryable: false,
    });
    expect(describeUpdateBadgeError(ADMIN_ERR.forbidden())).toMatchObject({
      reason: "forbidden",
      dialog: "close",
      invalidate: false,
      retryable: false,
    });
    expect(describeUpdateBadgeError(UNKNOWN_4XX())).toMatchObject({
      reason: "generic",
      dialog: "keep",
      retryable: true,
    });
  });

  it("050 không có `code` trong body ⇒ 409 `CODE-TAKEN` không phải lỗi của lời gọi này: `generic`, không gắn ô nào", () => {
    expect(describeUpdateBadgeError(ADMIN_ERR.badgeCodeTaken())).toMatchObject({
      reason: "generic",
      field: null,
    });
  });

  it.each(NO_READABLE_ANSWER)("%s ⇒ `outcomeUnknown` + báo trang đọc lại", (_name, make) => {
    expect(describeUpdateBadgeError(make())).toStrictEqual({
      reason: "outcomeUnknown",
      dialog: "keep",
      field: null,
      invalidate: true,
      retryable: true,
    });
  });
});

describe("F3 — 051 «Ngừng dùng» / 050 «Bật lại» ở hàng (`describeToggleBadgeError`)", () => {
  it.each([
    ["404 huy hiệu không còn", ADMIN_ERR.badgeGone, "badgeGone", true, false],
    ["403", ADMIN_ERR.forbidden, "forbidden", false, false],
    ["400", ADMIN_ERR.badRequest, "invalidRequest", false, false],
    ["4xx mã lạ", UNKNOWN_4XX, "generic", false, true],
    ["500", ADMIN_ERR.server, "outcomeUnknown", true, true],
  ] as const)(
    "%s ⇒ `%s` (invalidate=%s, retryable=%s)",
    (_name, make, reason, invalidate, retryable) => {
      expect(describeToggleBadgeError(make())).toStrictEqual({ reason, invalidate, retryable });
    },
  );

  it("hết hạn chờ ⇒ `outcomeUnknown`: server có thể đã tắt / bật huy hiệu ⇒ đọc lại", () => {
    expect(describeToggleBadgeError(new GuardedMutationTimeoutError())).toStrictEqual({
      reason: "outcomeUnknown",
      invalidate: true,
      retryable: true,
    });
  });
});

describe("F3 — đọc 056 (`describeBadgeReadError`)", () => {
  it("403 (mọi mã) ⇒ `forbidden`, không thử lại · 400 ⇒ `invalidRequest`, không thử lại", () => {
    expect(describeBadgeReadError(ADMIN_ERR.forbidden())).toStrictEqual({
      reason: "forbidden",
      retryable: false,
    });
    expect(describeBadgeReadError(ADMIN_ERR.badRequest())).toStrictEqual({
      reason: "invalidRequest",
      retryable: false,
    });
  });

  it.each(NO_READABLE_ANSWER)(
    "%s ⇒ `loadFailed` + thử lại (KHÔNG `generic` / `outcomeUnknown` — đó là câu của một lượt GHI)",
    (_name, make) => {
      expect(describeBadgeReadError(make())).toStrictEqual({
        reason: "loadFailed",
        retryable: true,
      });
    },
  );

  it("404 mã huy hiệu ở lượt ĐỌC không có nghĩa «huy hiệu không còn» ⇒ `loadFailed`", () => {
    expect(describeBadgeReadError(ADMIN_ERR.badgeGone()).reason).toBe("loadFailed");
  });
});

describe("mọi reason trả ra thuộc tập đóng `ADMIN_ERROR_REASONS` (có câu ở i18n)", () => {
  it("`badgeCodeTaken` + `badgeGone` đã được khai trong tập đóng", () => {
    const reasons: readonly string[] = ADMIN_ERROR_REASONS;
    expect(reasons).toContain("badgeCodeTaken");
    expect(reasons).toContain("badgeGone");
    expect(reasons).toContain(describeCreateBadgeError(ADMIN_ERR.badgeCodeTaken()).reason);
    expect(reasons).toContain(describeUpdateBadgeError(ADMIN_ERR.badgeGone()).reason);
  });
});
