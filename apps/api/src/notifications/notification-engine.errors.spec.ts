/**
 * S4-NOTI-BE-2 (unit) — assertPayloadSafe / assertInternalTargetUrl / 3 lớp lỗi engine (logic thuần, rẻ-tiền).
 * Bổ sung theo yêu cầu QA vòng nghiệm thu (coverage ≥80% dedupe/renderer/errors, testing.md unit+integration).
 */
import { describe, expect, it } from "vitest";
import { BadRequestException, HttpException, HttpStatus, NotFoundException } from "@nestjs/common";
import {
  assertInternalTargetUrl,
  assertPayloadSafe,
  EventNotFoundError,
  NOTI_ENGINE_ERR,
  TargetUnavailableError,
  TemplateVariableInvalidError,
} from "./notification-engine.errors";

/** Bọc `wrapCount` lớp `{ wrap: ... }` quanh leaf — leaf được scan ở scanPayload-depth = wrapCount. */
function nestedSensitive(
  wrapCount: number,
  leaf: Record<string, unknown>,
): Record<string, unknown> {
  let obj: Record<string, unknown> = leaf;
  for (let i = 0; i < wrapCount; i++) {
    obj = { wrap: obj };
  }
  return obj;
}

function getCode(err: unknown): unknown {
  const response = (err as HttpException).getResponse();
  return (response as { code?: unknown }).code;
}

// ─── assertPayloadSafe ───────────────────────────────────────────────────────

describe("assertPayloadSafe", () => {
  it("khóa nhạy cảm TOP-LEVEL → throw TemplateVariableInvalidError (.code = NOTI-ERR-TEMPLATE-VARIABLE-INVALID)", () => {
    expect(() => assertPayloadSafe({ password: "changeme" })).toThrow(TemplateVariableInvalidError);
    try {
      assertPayloadSafe({ token: "abc" });
      expect.unreachable("phải throw");
    } catch (err) {
      expect(getCode(err)).toBe(NOTI_ENGINE_ERR.TEMPLATE_VARIABLE_INVALID);
    }
  });

  it("khóa nhạy cảm LỒNG NHAU (nested object) → vẫn throw", () => {
    expect(() => assertPayloadSafe({ actor: { profile: { salary: 1_000_000 } } })).toThrow(
      TemplateVariableInvalidError,
    );
  });

  it("khớp KHÔNG phân biệt hoa/thường (PASSWORD, Salary, ...)", () => {
    expect(() => assertPayloadSafe({ PASSWORD: "x" })).toThrow(TemplateVariableInvalidError);
    expect(() => assertPayloadSafe({ Salary: 100 })).toThrow(TemplateVariableInvalidError);
    expect(() => assertPayloadSafe({ nested: { Bank_Account: "123" } })).toThrow(
      TemplateVariableInvalidError,
    );
  });

  it("chuỗi payload > 2000 ký tự → throw TemplateVariableInvalidError", () => {
    const longString = "a".repeat(2001);
    expect(() => assertPayloadSafe({ note: longString })).toThrow(TemplateVariableInvalidError);
  });

  it("chuỗi payload đúng 2000 ký tự (biên) → KHÔNG throw", () => {
    const exact = "a".repeat(2000);
    expect(() => assertPayloadSafe({ note: exact })).not.toThrow();
  });

  it("depth <= 4 (leaf ở wrapCount=4) → VẪN quét được → throw", () => {
    const payload = nestedSensitive(4, { password: "x" });
    expect(() => assertPayloadSafe(payload)).toThrow(TemplateVariableInvalidError);
  });

  it("depth > 4 (leaf ở wrapCount=5) → DỪNG QUÉT → KHÔNG throw (biên chính xác)", () => {
    const payload = nestedSensitive(5, { password: "x" });
    expect(() => assertPayloadSafe(payload)).not.toThrow();
  });

  it("payload an toàn (không key nhạy cảm, chuỗi ngắn) → KHÔNG throw", () => {
    expect(() =>
      assertPayloadSafe({ task_code: "T-1", actor_name: "Alice", count: 3, nested: { ok: true } }),
    ).not.toThrow();
  });

  it("payload chứa array lồng object nhạy cảm → vẫn throw (quét cả mảng)", () => {
    expect(() => assertPayloadSafe({ items: [{ ok: true }, { token: "x" }] })).toThrow(
      TemplateVariableInvalidError,
    );
  });

  it("payload chứa array TOÀN item an toàn → quét hết mảng, KHÔNG throw", () => {
    expect(() =>
      assertPayloadSafe({ items: [{ ok: true }, { also_ok: 1 }, "plain-string"] }),
    ).not.toThrow();
  });
});

// ─── assertInternalTargetUrl ─────────────────────────────────────────────────

describe("assertInternalTargetUrl", () => {
  it("'/path?x=1' → route nội bộ hợp lệ, KHÔNG throw", () => {
    expect(() => assertInternalTargetUrl("/path?x=1")).not.toThrow();
  });

  it("'//evil' (protocol-relative) → throw TargetUnavailableError", () => {
    expect(() => assertInternalTargetUrl("//evil")).toThrow(TargetUnavailableError);
  });

  it("'https://evil.com' (absolute URL) → throw TargetUnavailableError", () => {
    expect(() => assertInternalTargetUrl("https://evil.com")).toThrow(TargetUnavailableError);
  });

  it("'javascript:alert(1)' (dangerous scheme) → throw TargetUnavailableError", () => {
    expect(() => assertInternalTargetUrl("javascript:alert(1)")).toThrow(TargetUnavailableError);
  });

  it("chứa backslash → throw TargetUnavailableError", () => {
    expect(() => assertInternalTargetUrl("/evil\\path")).toThrow(TargetUnavailableError);
  });

  it("target hợp lệ throw có .code = NOTI-ERR-TARGET-UNAVAILABLE và status 422", () => {
    try {
      assertInternalTargetUrl("https://evil.com");
      expect.unreachable("phải throw");
    } catch (err) {
      expect(getCode(err)).toBe(NOTI_ENGINE_ERR.TARGET_UNAVAILABLE);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    }
  });
});

// ─── 3 lớp lỗi mang đúng .code + status ──────────────────────────────────────

describe("Notification engine error classes — code + HTTP status", () => {
  it("EventNotFoundError → NotFoundException, status 404, code NOTI-ERR-EVENT-NOT-FOUND", () => {
    const err = new EventNotFoundError("EVT_UNKNOWN");
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(getCode(err)).toBe(NOTI_ENGINE_ERR.EVENT_NOT_FOUND);
  });

  it("TargetUnavailableError → status 422, code NOTI-ERR-TARGET-UNAVAILABLE, KHÔNG echo URL vào message", () => {
    const err = new TargetUnavailableError();
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(getCode(err)).toBe(NOTI_ENGINE_ERR.TARGET_UNAVAILABLE);
  });

  it("TemplateVariableInvalidError → BadRequestException, status 400, code NOTI-ERR-TEMPLATE-VARIABLE-INVALID", () => {
    const err = new TemplateVariableInvalidError("payload chứa khóa nhạy cảm bị cấm: password");
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(getCode(err)).toBe(NOTI_ENGINE_ERR.TEMPLATE_VARIABLE_INVALID);
  });
});
