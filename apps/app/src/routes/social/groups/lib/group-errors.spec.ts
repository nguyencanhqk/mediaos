/**
 * Ca E1 (plan FE-2B D3 + §8 M7) · E2 (S16-SOCIAL-GROUPERR-1 D14). HAI hình dạng trên dây, cả hai THẬT:
 *  - **API MỚI** (từ GROUPERR-1): `code` = `SOCIAL_ERROR_CODES[K]`, `message` giữ nguyên tiền tố cũ.
 *  - **API CŨ** (PROD chưa redeploy — FE auto-deploy trước, owner ký O4): `code` là mã CHUNG theo status,
 *    mã SOCIAL chỉ ở tiền tố `message`. Nhánh LEGACY-PREFIX giữ nguyên hành vi hôm trước cho hình dạng này.
 * Chuỗi `message` chép nguyên văn `social.errors.ts`.
 */
import { SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { ApiError } from "@mediaos/web-core";
import {
  groupErrorReason,
  isForbiddenError,
  isStaleStateError,
  socialErrorCode,
  type GroupAction,
} from "./group-errors";

const conflict = (message: string, code = "RESOURCE-ERR-CONFLICT") => new ApiError(409, code, message);
const notFound = (message: string) => new ApiError(404, "RESOURCE-ERR-NOT-FOUND", message);

// social.errors.ts:158 · :161 · :171-172 · :181 · :191 · :203 · :214
const ERR_012 = "SOCIAL-ERR-012: không tìm thấy nhóm.";
const ERR_013_EXISTS = "SOCIAL-ERR-013: bạn đã tham gia hoặc đã gửi yêu cầu vào nhóm này.";
const ERR_013_STATE =
  "SOCIAL-ERR-013: thao tác không khớp trạng thái của thành viên này (chờ duyệt cần duyệt/từ chối, đang hoạt động mới đổi được vai trò).";
const ERR_014 = "SOCIAL-ERR-014: bạn không có quyền thực hiện thao tác này trong nhóm.";
const ERR_015 = "SOCIAL-ERR-015: nhóm phải còn ít nhất một chủ nhóm đang hoạt động.";
const NAME_TAKEN = "SOCIAL-ERR: tên nhóm này đã được dùng trong công ty.";
const MEMBER_GONE = "SOCIAL-ERR: người này không phải thành viên của nhóm.";

/** Hình dạng API MỚI: mã SOCIAL ở `code`, thông điệp y hệt bản cũ. */
const wire = (status: number, code: string, message: string) => new ApiError(status, code, message);
const C = SOCIAL_ERROR_CODES;

describe("socialErrorCode", () => {
  it("API MỚI: trả thẳng `code` khi là mã SOCIAL — kể cả sentinel không số", () => {
    expect(socialErrorCode(wire(409, C.GROUP_LAST_OWNER, ERR_015))).toBe("SOCIAL-ERR-015");
    expect(socialErrorCode(wire(409, C.GROUP_NAME_TAKEN, NAME_TAKEN))).toBe(
      "SOCIAL-ERR-GROUP-NAME-TAKEN",
    );
  });

  it("LEGACY-PREFIX (API cũ): đọc tiền tố có số; KHÔNG đọc tiền tố không số; null với lỗi không phải ApiError", () => {
    expect(socialErrorCode(conflict(ERR_015))).toBe("SOCIAL-ERR-015");
    expect(socialErrorCode(notFound(ERR_012))).toBe("SOCIAL-ERR-012");
    expect(socialErrorCode(conflict(NAME_TAKEN))).toBeNull();
    expect(socialErrorCode(new Error(ERR_015))).toBeNull();
    expect(socialErrorCode(new ZodError([]))).toBeNull();
  });
});

describe("groupErrorReason — API MỚI: đọc `error.code` (GROUPERR-1 D14)", () => {
  it.each<[GroupAction, ApiError, string | null]>([
    ["leave", wire(409, C.GROUP_LAST_OWNER, ERR_015), "lastOwner"],
    ["role", wire(409, C.GROUP_LAST_OWNER, ERR_015), "lastOwner"],
    ["remove", wire(409, C.GROUP_LAST_OWNER, ERR_015), "lastOwner"],
    ["role", wire(409, C.GROUP_MEMBER_STATE_MISMATCH, ERR_013_STATE), "stateChanged"],
    ["decide", wire(409, C.GROUP_MEMBER_STATE_MISMATCH, ERR_013_STATE), "stateChanged"],
    ["join", wire(409, C.GROUP_MEMBERSHIP_EXISTS, ERR_013_EXISTS), "alreadyMember"],
    ["join", wire(404, C.GROUP_NOT_FOUND, ERR_012), "groupGone"],
    ["post", wire(404, C.GROUP_NOT_FOUND, ERR_012), "groupGone"],
    ["delete", wire(404, C.GROUP_NOT_FOUND, ERR_012), "groupGone"],
    ["create", wire(409, C.GROUP_NAME_TAKEN, NAME_TAKEN), "nameTaken"],
    ["update", wire(409, C.GROUP_NAME_TAKEN, NAME_TAKEN), "nameTaken"],
    ["remove", wire(404, C.GROUP_MEMBER_NOT_FOUND, MEMBER_GONE), "stateChanged"],
    ["decide", wire(404, C.GROUP_MEMBER_NOT_FOUND, MEMBER_GONE), "stateChanged"],
    ["leave", wire(404, C.GROUP_MEMBER_NOT_FOUND, MEMBER_GONE), "stateChanged"],
    ["update", wire(403, C.GROUP_ROLE_REQUIRED, ERR_014), null],
  ])("%s + %s ⇒ %s", (action, err, reason) => {
    expect(groupErrorReason(action, err)).toBe(reason);
  });

  it("mã SOCIAL THẮNG tiền tố message: code 013 + message giả tiền tố 015 ⇒ theo code", () => {
    expect(groupErrorReason("role", wire(409, C.GROUP_MEMBER_STATE_MISMATCH, ERR_015))).toBe(
      "stateChanged",
    );
  });

  it("mã KHÔNG phải SOCIAL và KHÔNG phải mã chung của API cũ ⇒ null — heuristic status CHỈ cho hình dạng API cũ", () => {
    expect(groupErrorReason("create", new ApiError(409, "OTHER-ERR-CONFLICT", "x"))).toBeNull();
    expect(groupErrorReason("leave", new ApiError(404, "OTHER-ERR-NOT-FOUND", "x"))).toBeNull();
  });

  it("mã SOCIAL KHÔNG liên quan nhóm ⇒ null, KHÔNG rơi xuống heuristic status (vd 409 bình chọn ở create)", () => {
    expect(groupErrorReason("create", wire(409, C.POLL_CLOSED, "SOCIAL-ERR-016: x"))).toBeNull();
    expect(groupErrorReason("leave", wire(404, C.POST_NOT_FOUND, "SOCIAL-ERR-001: x"))).toBeNull();
  });
});

describe("groupErrorReason — LEGACY-PREFIX (API cũ): 409 của 038 là 013 HOẶC 015, status một mình không đủ", () => {
  it.each<[GroupAction, ApiError, string | null]>([
    ["leave", conflict(ERR_015), "lastOwner"],
    ["role", conflict(ERR_015), "lastOwner"],
    ["remove", conflict(ERR_015), "lastOwner"],
    ["role", conflict(ERR_013_STATE), "stateChanged"],
    ["decide", conflict(ERR_013_STATE), "stateChanged"],
    ["join", conflict(ERR_013_EXISTS), "alreadyMember"],
    ["join", notFound(ERR_012), "groupGone"],
    ["post", notFound(ERR_012), "groupGone"],
    ["delete", notFound(ERR_012), "groupGone"],
    ["create", conflict(NAME_TAKEN), "nameTaken"],
    ["update", conflict(NAME_TAKEN), "nameTaken"],
    ["remove", notFound(MEMBER_GONE), "stateChanged"],
    ["decide", notFound(MEMBER_GONE), "stateChanged"],
    ["leave", notFound(MEMBER_GONE), "stateChanged"],
  ])("%s + %s ⇒ %s", (action, err, reason) => {
    expect(groupErrorReason(action, err)).toBe(reason);
  });

  it("409 của interceptor idempotency ở create KHÔNG bị đọc thành tên trùng", () => {
    const err = conflict("đang xử lý", "REQUEST-ERR-IDEMPOTENCY-IN-PROGRESS");
    expect(groupErrorReason("create", err)).toBeNull();
  });

  it("không có lý do cụ thể ⇒ null (banner forbidden/generic lo): 403 · 500 · ZodError · Error", () => {
    expect(groupErrorReason("update", new ApiError(403, "AUTH-ERR-FORBIDDEN", ERR_014))).toBeNull();
    expect(groupErrorReason("leave", new ApiError(500, "INTERNAL", "boom"))).toBeNull();
    expect(groupErrorReason("leave", new ZodError([]))).toBeNull();
    expect(groupErrorReason("leave", new Error(ERR_015))).toBeNull();
    // 404 không số ở create/join KHÔNG phải «người đó không còn hàng».
    expect(groupErrorReason("join", notFound("x"))).toBeNull();
  });
});

describe("isForbiddenError / isStaleStateError", () => {
  it("403 là forbidden; 403/404/409 là «trạng thái đã cũ»; 500/Zod thì không", () => {
    const forbidden = new ApiError(403, "AUTH-ERR-FORBIDDEN", ERR_014);
    expect(isForbiddenError(forbidden)).toBe(true);
    expect(isForbiddenError(conflict(ERR_015))).toBe(false);
    expect([forbidden, notFound(ERR_012), conflict(ERR_015)].map(isStaleStateError)).toEqual([
      true,
      true,
      true,
    ]);
    expect(isStaleStateError(new ApiError(500, "INTERNAL", "x"))).toBe(false);
    expect(isStaleStateError(new ZodError([]))).toBe(false);
  });
});
