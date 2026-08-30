/**
 * S11-ASSET-FE-1 — neo cách bóc `error.details` của ASSET.
 *
 * Ca có giá trị nhất là ca ĐỐI CHỨNG hình dạng: `details` viết như OBJECT (`{kind: "..."}`) — hình mà
 * bảng SPEC-13 §12 gợi ý và là cái người ta hay code theo — phải trả `kind === null`, tức rơi về thông
 * điệp chung. Nếu parser "rộng lượng" chấp nhận cả hai hình thì nó che mất drift thật giữa FE và
 * `AllExceptionsFilter`, và ta mất luôn tín hiệu khi BE đổi hình.
 *
 * Danh sách `kind` neo ở đây ĐO TỪ CODE BE (`grep assetDetails("`), KHÔNG chép bảng spec.
 */
import { describe, it, expect } from "vitest";
import { ApiError } from "@mediaos/web-core";
import { IDEMPOTENCY_ERROR_CODES } from "@mediaos/contracts";
import {
  parseAssetError,
  assetErrorI18nKey,
  isAssetStateConflict,
  shouldRotateIdempotencyKey,
  readPrefixTakenHolder,
  ASSET_ERROR_KINDS,
} from "./asset-errors";
import assetsVi from "@/i18n/locales/vi/assets";

/** Dựng ApiError giống hệt cái `parseApiError` của api-client sinh ra từ envelope lỗi. */
function apiError(
  code: string,
  status: number,
  details?: unknown,
  message = "loi tu server",
): ApiError {
  return new ApiError({ status, code, message, details });
}

/** `assetDetails()` của BE: mọi giá trị đi qua `String(value)`, kèm `rule: "asset"`. */
function details(kind: string, extra: Record<string, string | boolean | number> = {}) {
  return [
    { field: "kind", message: kind, rule: "asset" },
    ...Object.entries(extra).map(([field, v]) => ({
      field,
      message: String(v),
      rule: "asset",
    })),
  ];
}

describe("asset-errors — parseAssetError hình dạng details", () => {
  it("mảng ErrorDetail ⇒ bóc được kind", () => {
    const info = parseAssetError(apiError("ASSET-ERR-010", 409, details("prefix-taken")));
    expect(info.kind).toBe("prefix-taken");
    expect(info.code).toBe("ASSET-ERR-010");
    expect(info.status).toBe(409);
  });

  it("ĐỐI CHỨNG: details viết như OBJECT ⇒ kind = null (không âm thầm chấp nhận hình sai)", () => {
    const info = parseAssetError(apiError("ASSET-ERR-010", 409, { kind: "prefix-taken" }));
    expect(info.kind).toBeNull();
    expect(assetErrorI18nKey(info)).toBe("errors.generic");
  });

  it("details vắng / null / chuỗi ⇒ kind null, KHÔNG ném", () => {
    expect(parseAssetError(apiError("X", 500)).kind).toBeNull();
    expect(parseAssetError(apiError("X", 500, null)).kind).toBeNull();
    expect(parseAssetError(apiError("X", 500, "hỏng")).kind).toBeNull();
  });

  it("phần tử rác trong mảng bị bỏ qua, phần tử hợp lệ vẫn đọc được", () => {
    const info = parseAssetError(
      apiError("ASSET-ERR-002", 422, [
        null,
        "rác",
        { field: 42, message: "x" },
        { field: "kind", message: "employee-inactive", rule: "asset" },
      ]),
    );
    expect(info.kind).toBe("employee-inactive");
  });

  it("lỗi không phải ApiError ⇒ trả khung rỗng, không ném", () => {
    const info = parseAssetError(new Error("mạng hỏng"));
    expect(info).toMatchObject({ code: null, status: null, kind: null, message: "mạng hỏng" });
    expect(assetErrorI18nKey(info)).toBe("errors.generic");
  });

  it("giữ mọi field phụ để phía gọi nội suy thông điệp", () => {
    const info = parseAssetError(
      apiError("ASSET-ERR-010", 409, details("has-assets", { count: 7 })),
    );
    expect(info.fields.get("count")).toBe("7");
  });
});

describe("asset-errors — readPrefixTakenHolder (đường DUY NHẤT dùng lại tiền tố)", () => {
  it("prefix-taken bởi loại ĐÃ XOÁ ⇒ gợi ý khôi phục", () => {
    const info = parseAssetError(
      apiError("ASSET-ERR-010", 409, details("prefix-taken", { categoryId: "c1", deleted: true })),
    );
    expect(readPrefixTakenHolder(info)).toEqual({ categoryId: "c1", deleted: true });
  });

  it('deleted="false" ⇒ deleted false — KHÔNG Boolean("false") (chuỗi "false" là truthy)', () => {
    const info = parseAssetError(
      apiError("ASSET-ERR-010", 409, details("prefix-taken", { categoryId: "c1", deleted: false })),
    );
    expect(readPrefixTakenHolder(info)).toEqual({ categoryId: "c1", deleted: false });
  });

  it("kind khác ⇒ null", () => {
    const info = parseAssetError(apiError("ASSET-ERR-010", 409, details("code-taken")));
    expect(readPrefixTakenHolder(info)).toBeNull();
  });
});

describe("asset-errors — assetErrorI18nKey", () => {
  it("MỌI kind BE phát ra đều có khoá i18n RIÊNG (không rơi về generic)", () => {
    for (const kind of ASSET_ERROR_KINDS) {
      const info = parseAssetError(apiError("ASSET-ERR-XXX", 409, details(kind)));
      expect(assetErrorI18nKey(info), `kind ${kind} rơi về generic`).not.toBe("errors.generic");
    }
  });

  it("MỌI khoá trả ra đều TỒN TẠI trong namespace assets (chống khoá chết hiện raw)", () => {
    const errs = assetsVi.errors as Record<string, string>;
    for (const kind of ASSET_ERROR_KINDS) {
      const info = parseAssetError(apiError("ASSET-ERR-XXX", 409, details(kind)));
      const leaf = assetErrorI18nKey(info).replace(/^errors\./, "");
      expect(errs[leaf], `thiếu assets:errors.${leaf}`).toBeTruthy();
    }
  });

  it("kind ĐI TRƯỚC code khi có cả hai", () => {
    const info = parseAssetError(apiError("ASSET-ERR-015", 409, details("has-history")));
    expect(assetErrorI18nKey(info)).toBe("errors.hasHistory");
  });

  it("không kind ⇒ tra theo code (ASSET-ERR-001 mang from/to/action, KHÔNG mang kind)", () => {
    const info = parseAssetError(
      apiError("ASSET-ERR-001", 409, [
        { field: "from", message: "Assigned", rule: "asset-fsm" },
        { field: "to", message: "Disposed", rule: "asset-fsm" },
        { field: "action", message: "dispose", rule: "asset-fsm" },
      ]),
    );
    expect(info.kind).toBeNull();
    expect(assetErrorI18nKey(info)).toBe("errors.fsm");
    // Thông điệp nội suy được từ details, không phải câu chữ cứng.
    expect(info.fields.get("from")).toBe("Assigned");
    expect(info.fields.get("action")).toBe("dispose");
  });

  it("mã idempotency lấy từ CONTRACTS (chuỗi thật REQUEST-ERR-IDEMPOTENCY-*)", () => {
    expect(IDEMPOTENCY_ERROR_CODES.KEY_REUSED).toBe("REQUEST-ERR-IDEMPOTENCY-KEY-REUSED");
    const reused = parseAssetError(apiError(IDEMPOTENCY_ERROR_CODES.KEY_REUSED, 409));
    expect(assetErrorI18nKey(reused)).toBe("errors.idempotencyKeyReused");
    const inflight = parseAssetError(apiError(IDEMPOTENCY_ERROR_CODES.IN_PROGRESS, 409));
    expect(assetErrorI18nKey(inflight)).toBe("errors.idempotencyInProgress");
  });

  it("mã lạ ⇒ generic", () => {
    expect(assetErrorI18nKey(parseAssetError(apiError("WAT-001", 500)))).toBe("errors.generic");
  });
});

describe("asset-errors — isAssetStateConflict (tải lại chi tiết vs giữ form)", () => {
  it.each(["stale", "not-in-stock", "already-closed", "open-exists", "active-assignment"])(
    "%s ⇒ tranh chấp trạng thái, phải tải lại chi tiết",
    (kind) => {
      expect(isAssetStateConflict(parseAssetError(apiError("ASSET-ERR-X", 409, details(kind))))).toBe(
        true,
      );
    },
  );

  it.each(["code-taken", "prefix-taken", "serial-taken", "purchase-in-future"])(
    "%s ⇒ KHÔNG tranh chấp: người dùng sửa ngay trong form, tải lại là làm mất cái vừa gõ",
    (kind) => {
      expect(isAssetStateConflict(parseAssetError(apiError("ASSET-ERR-X", 409, details(kind))))).toBe(
        false,
      );
    },
  );

  it("ASSET-ERR-001 không kèm details vẫn coi là tranh chấp (fail-safe)", () => {
    expect(isAssetStateConflict(parseAssetError(apiError("ASSET-ERR-001", 409)))).toBe(true);
  });
});

describe("asset-errors — vòng đời Idempotency-Key", () => {
  it("KEY_REUSED ⇒ PHẢI sinh khoá mới (ý định mới cần khoá mới)", () => {
    expect(
      shouldRotateIdempotencyKey(parseAssetError(apiError(IDEMPOTENCY_ERROR_CODES.KEY_REUSED, 409))),
    ).toBe(true);
  });

  it("IN_PROGRESS ⇒ GIỮ NGUYÊN khoá (đổi khoá lúc đó tạo bản ghi THỨ HAI)", () => {
    expect(
      shouldRotateIdempotencyKey(parseAssetError(apiError(IDEMPOTENCY_ERROR_CODES.IN_PROGRESS, 409))),
    ).toBe(false);
  });

  it("lỗi nghiệp vụ thường ⇒ giữ khoá (retry cùng ý định)", () => {
    expect(
      shouldRotateIdempotencyKey(parseAssetError(apiError("ASSET-ERR-002", 422, details("employee-inactive")))),
    ).toBe(false);
  });
});
