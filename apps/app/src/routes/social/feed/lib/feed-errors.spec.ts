/**
 * S16-SOCIAL-FEMODERRMSG-1 — `postActionErrorReason`: bảng mã → lý do của bốn đường ghi trên BÀI.
 *
 * Ca đối chứng (`null`) KHÔNG phải trang trí: mỗi mã ở đó là một lỗi THẬT mà `005`/`006` trả được, và
 * câu forbidden/generic sẵn có đã nói đúng — gắn lý do «bài không còn» cho chúng là nói sai.
 */
import { describe, expect, it } from "vitest";
import { SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import { ApiError } from "@mediaos/web-core";
import { POST_ERR } from "../social-test-doubles";
import { postActionErrorReason } from "./feed-errors";

describe("postActionErrorReason", () => {
  it("API MỚI — 404 `SOCIAL-ERR-001` ⇒ «postGone»", () => {
    expect(postActionErrorReason(POST_ERR.gone())).toBe("postGone");
  });

  it("API CŨ — mã chung + tiền tố `SOCIAL-ERR-001:` ở `message` ⇒ VẪN «postGone»", () => {
    expect(postActionErrorReason(POST_ERR.goneLegacy())).toBe("postGone");
  });

  it.each([
    { name: "403 `SOCIAL-ERR-010` (thiếu cặp theo trường)", err: POST_ERR.fieldDenied() },
    {
      name: "403 `SOCIAL-ERR-003` (xoá bài người khác)",
      err: new ApiError(403, SOCIAL_ERROR_CODES.NOT_CONTENT_OWNER, "SOCIAL-ERR-003: chỉ tác giả…"),
    },
    {
      name: "403 tầng 1 `AUTH-ERR-FORBIDDEN` (không mang mã SOCIAL)",
      err: new ApiError(403, "AUTH-ERR-FORBIDDEN", "Permission denied: manage:feed-post"),
    },
    {
      name: "422 `PIN-NEWS-ONLY` (không chạm được từ menu — vẫn rơi về câu chung nếu lọt)",
      err: new ApiError(
        422,
        SOCIAL_ERROR_CODES.PIN_NEWS_ONLY,
        "SOCIAL-ERR: chỉ ghim được bài tin tức.",
      ),
    },
    {
      name: "404 KHÔNG mang mã SOCIAL (vd route lạ)",
      err: new ApiError(404, "RESOURCE-ERR-NOT-FOUND", "không tìm thấy"),
    },
    { name: "500", err: POST_ERR.server() },
    { name: "Error thường (mạng)", err: new Error("Failed to fetch") },
    { name: "không phải Error", err: "SOCIAL-ERR-001: chuỗi trần" },
  ])("đối chứng — $name ⇒ null", ({ err }) => {
    expect(postActionErrorReason(err)).toBeNull();
  });
});
