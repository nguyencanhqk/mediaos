/**
 * S12-RECRUIT-FE-1 — neo cách bóc `error.details` của RECRUIT (khuôn `asset-errors.spec.ts`).
 *
 * Ca giá trị nhất: ĐỐI CHỨNG hình dạng — `details` viết như OBJECT `{kind:"..."}` (hình hay bị code
 * nhầm) phải trả `kind===null`, không âm thầm chấp nhận cả hai hình.
 */
import { describe, it, expect } from "vitest";
import { ApiError } from "@mediaos/web-core";
import { IDEMPOTENCY_ERROR_CODES } from "@mediaos/contracts";
import {
  parseRecruitError,
  recruitErrorI18nKey,
  isRecruitStateConflict,
  shouldRotateIdempotencyKey,
  RECRUIT_ERROR_KINDS,
} from "./recruit-errors";
import recruitVi from "@/i18n/locales/vi/recruit";

function apiError(
  code: string,
  status: number,
  details?: unknown,
  message = "loi tu server",
): ApiError {
  return new ApiError({ status, code, message, details });
}

/** `recruitDetails()` của BE: mọi giá trị đi qua `String(value)`, kèm `rule: "recruit"`. */
function details(kind: string, extra: Record<string, string | boolean | number> = {}) {
  return [
    { field: "kind", message: kind, rule: "recruit" },
    ...Object.entries(extra).map(([field, v]) => ({ field, message: String(v), rule: "recruit" })),
  ];
}

describe("recruit-errors — parseRecruitError hình dạng details", () => {
  it("mảng ErrorDetail ⇒ bóc được kind", () => {
    const info = parseRecruitError(
      apiError("RECRUIT-ERR-001", 409, details("invalid-stage-transition")),
    );
    expect(info.kind).toBe("invalid-stage-transition");
    expect(info.code).toBe("RECRUIT-ERR-001");
    expect(info.status).toBe(409);
  });

  it("ĐỐI CHỨNG: details viết như OBJECT ⇒ kind = null", () => {
    const info = parseRecruitError(
      apiError("RECRUIT-ERR-001", 409, { kind: "invalid-stage-transition" }),
    );
    expect(info.kind).toBeNull();
    expect(recruitErrorI18nKey(info)).toBe("errors.generic");
  });

  it("details vắng / null / chuỗi ⇒ kind null, KHÔNG ném", () => {
    expect(parseRecruitError(apiError("X", 500)).kind).toBeNull();
    expect(parseRecruitError(apiError("X", 500, null)).kind).toBeNull();
    expect(parseRecruitError(apiError("X", 500, "hỏng")).kind).toBeNull();
  });

  it("phần tử rác trong mảng bị bỏ qua, phần tử hợp lệ vẫn đọc được", () => {
    const info = parseRecruitError(
      apiError("RECRUIT-ERR-009", 422, [
        null,
        "rác",
        { field: 42, message: "x" },
        { field: "kind", message: "org-unit-invalid", rule: "recruit" },
      ]),
    );
    expect(info.kind).toBe("org-unit-invalid");
  });

  it("lỗi không phải ApiError ⇒ trả khung rỗng, không ném", () => {
    const info = parseRecruitError(new Error("mạng hỏng"));
    expect(info).toMatchObject({ code: null, status: null, kind: null, message: "mạng hỏng" });
    expect(recruitErrorI18nKey(info)).toBe("errors.generic");
  });

  it("giữ mọi field phụ để phía gọi nội suy thông điệp", () => {
    const info = parseRecruitError(
      apiError("RECRUIT-ERR-015", 422, details("export-too-large", { total: 12000, max: 10000 })),
    );
    expect(info.fields.get("total")).toBe("12000");
    expect(info.fields.get("max")).toBe("10000");
  });
});

describe("recruit-errors — recruitErrorI18nKey", () => {
  it("MỌI kind BE phát ra đều có khoá i18n RIÊNG (không rơi về generic)", () => {
    for (const kind of RECRUIT_ERROR_KINDS) {
      const info = parseRecruitError(apiError("RECRUIT-ERR-XXX", 409, details(kind)));
      expect(recruitErrorI18nKey(info), `kind ${kind} rơi về generic`).not.toBe("errors.generic");
    }
  });

  it("MỌI khoá trả ra đều TỒN TẠI trong namespace recruit (chống khoá chết hiện raw)", () => {
    const errs = recruitVi.errors as Record<string, string>;
    for (const kind of RECRUIT_ERROR_KINDS) {
      const info = parseRecruitError(apiError("RECRUIT-ERR-XXX", 409, details(kind)));
      const leaf = recruitErrorI18nKey(info).replace(/^errors\./, "");
      expect(errs[leaf], `thiếu recruit:errors.${leaf}`).toBeTruthy();
    }
  });

  it("mã idempotency lấy từ CONTRACTS (chuỗi thật REQUEST-ERR-IDEMPOTENCY-*)", () => {
    expect(IDEMPOTENCY_ERROR_CODES.KEY_REUSED).toBe("REQUEST-ERR-IDEMPOTENCY-KEY-REUSED");
    const reused = parseRecruitError(apiError(IDEMPOTENCY_ERROR_CODES.KEY_REUSED, 409));
    expect(recruitErrorI18nKey(reused)).toBe("errors.idempotencyKeyReused");
    const inflight = parseRecruitError(apiError(IDEMPOTENCY_ERROR_CODES.IN_PROGRESS, 409));
    expect(recruitErrorI18nKey(inflight)).toBe("errors.idempotencyInProgress");
  });

  it("mã lạ không kind ⇒ generic", () => {
    expect(recruitErrorI18nKey(parseRecruitError(apiError("WAT-001", 500)))).toBe("errors.generic");
  });
});

describe("recruit-errors — isRecruitStateConflict", () => {
  it.each([
    "invalid-stage-transition",
    "hired-via-convert-only",
    "job-closed",
    "offer-open-exists",
    "already-converted",
    "not-draft",
    "not-scheduled",
  ])("%s ⇒ tranh chấp trạng thái, phải tải lại chi tiết", (kind) => {
    expect(
      isRecruitStateConflict(parseRecruitError(apiError("RECRUIT-ERR-X", 409, details(kind)))),
    ).toBe(true);
  });

  it.each([
    "org-unit-invalid",
    "position-invalid",
    "recruiter-invalid",
    "employee-inactive",
    "invalid-start-date",
  ])("%s ⇒ KHÔNG tranh chấp: sửa ngay trong form, tải lại là mất cái vừa gõ", (kind) => {
    expect(
      isRecruitStateConflict(parseRecruitError(apiError("RECRUIT-ERR-X", 422, details(kind)))),
    ).toBe(false);
  });

  it("không kind ⇒ không coi là tranh chấp (fail-safe khác ASSET: RECRUIT luôn kèm kind)", () => {
    expect(isRecruitStateConflict(parseRecruitError(apiError("RECRUIT-ERR-001", 409)))).toBe(false);
  });
});

describe("recruit-errors — vòng đời Idempotency-Key", () => {
  it("KEY_REUSED ⇒ PHẢI sinh khoá mới", () => {
    expect(
      shouldRotateIdempotencyKey(
        parseRecruitError(apiError(IDEMPOTENCY_ERROR_CODES.KEY_REUSED, 409)),
      ),
    ).toBe(true);
  });

  it("IN_PROGRESS ⇒ GIỮ NGUYÊN khoá", () => {
    expect(
      shouldRotateIdempotencyKey(
        parseRecruitError(apiError(IDEMPOTENCY_ERROR_CODES.IN_PROGRESS, 409)),
      ),
    ).toBe(false);
  });

  it("lỗi nghiệp vụ thường ⇒ giữ khoá (retry cùng ý định)", () => {
    expect(
      shouldRotateIdempotencyKey(
        parseRecruitError(apiError("RECRUIT-ERR-006", 409, details("offer-open-exists"))),
      ),
    ).toBe(false);
  });
});
