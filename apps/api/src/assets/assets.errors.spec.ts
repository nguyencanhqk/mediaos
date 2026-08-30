import { ConflictException, HttpException, UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { assetDetails, mapAssetPgError, pgErrorOf } from "./assets.errors";

/** Mô phỏng `DrizzleQueryError` bọc lỗi pg ở `cause` (1–3 tầng). */
function wrapped(pg: { code: string; constraint?: string }, depth: number): unknown {
  let err: unknown = Object.assign(new Error("pg"), pg);
  for (let i = 0; i < depth; i += 1) {
    err = Object.assign(new Error(`drizzle-${i}`), { cause: err });
  }
  return err;
}

function bodyOf(e: HttpException | null): {
  code: string;
  details?: Array<{ field: string; message: string }>;
} {
  if (!e) throw new Error("expected HttpException");
  return e.getResponse() as { code: string; details?: Array<{ field: string; message: string }> };
}

describe("assets.errors — pgErrorOf bóc lỗi khỏi vỏ drizzle", () => {
  it("đọc code/constraint ở cause tầng 1..3", () => {
    for (const depth of [0, 1, 2, 3]) {
      const e = pgErrorOf(
        wrapped({ code: "23505", constraint: "uq_asset_assignments_active" }, depth),
      );
      expect(e?.code).toBe("23505");
      expect(e?.constraint).toBe("uq_asset_assignments_active");
    }
  });

  it("không có mã pg ở bất kỳ tầng ⇒ null; chuỗi cause tự tham chiếu KHÔNG treo", () => {
    expect(pgErrorOf(new Error("plain"))).toBeNull();
    const loop: { cause?: unknown } = new Error("loop");
    loop.cause = loop;
    expect(pgErrorOf(loop)).toBeNull();
  });
});

/**
 * PHỦ ĐỦ 12/12 nhánh của `mapAssetPgError` (gate T2): tên constraint chép từ migration 0549 — sai một tên là
 * `null` ⇒ 500 trên PROD mà unit vẫn xanh. `kind` assert VÔ ĐIỀU KIỆN (null = không có kind).
 */
describe("assets.errors — mapAssetPgError neo theo TÊN constraint (23505)", () => {
  const cases: Array<[string, string, string | null]> = [
    ["uq_asset_assignments_active", "ASSET-ERR-001", "active-assignment-exists"],
    ["uq_asset_maintenances_open", "ASSET-ERR-004", null],
    ["uq_asset_inventories_open", "ASSET-ERR-006", null],
    ["uq_asset_inventory_items_inventory_asset", "ASSET-ERR-006", "snapshot-duplicate"],
    ["uq_assets_company_serial_active", "ASSET-ERR-011", "serial-taken"],
    ["uq_assets_company_code_active", "ASSET-ERR-011", "code-taken"],
    ["uq_asset_categories_company_code_active", "ASSET-ERR-010", "code-taken"],
    ["uq_asset_categories_company_prefix", "ASSET-ERR-010", "prefix-taken"],
  ];

  it.each(cases)("23505 %s ⇒ 409 %s", (constraint, code, kind) => {
    const mapped = mapAssetPgError(wrapped({ code: "23505", constraint }, 2), {
      serialNumber: "SN-1",
      code: "LAPTOP",
      codePrefix: "LT",
    });
    expect(mapped).toBeInstanceOf(ConflictException);
    const body = bodyOf(mapped);
    expect(body.code).toBe(code);
    expect(body.details?.find((d) => d.field === "kind")?.message ?? null).toBe(kind);
  });
});

describe("assets.errors — CHECK/overflow (23514 · 22003) — lưới thứ hai", () => {
  it("chk_asset_inventory_items_expected ⇒ 409 ASSET-ERR-INVENTORY-SNAPSHOT-INVALID", () => {
    const mapped = mapAssetPgError(
      wrapped({ code: "23514", constraint: "chk_asset_inventory_items_expected" }, 1),
    );
    expect(mapped?.getStatus()).toBe(409);
    expect(bodyOf(mapped).code).toBe("ASSET-ERR-INVENTORY-SNAPSHOT-INVALID");
  });

  it("chk_assets_warranty ⇒ 422 ASSET-ERR-014 (ngày)", () => {
    const mapped = mapAssetPgError(
      wrapped({ code: "23514", constraint: "chk_assets_warranty" }, 1),
    );
    expect(mapped).toBeInstanceOf(UnprocessableEntityException);
    expect(bodyOf(mapped).code).toBe("ASSET-ERR-014");
    expect(bodyOf(mapped).details?.find((d) => d.field === "kind")?.message).toBe(
      "warranty-before-purchase",
    );
  });

  it.each(["chk_assets_price", "chk_asset_maintenances_cost", "chk_asset_categories_interval"])(
    "23514 %s ⇒ 422 VALIDATION-ERR-001 (số, KHÔNG mượn mã ngày)",
    (constraint) => {
      const mapped = mapAssetPgError(wrapped({ code: "23514", constraint }, 1));
      expect(mapped).toBeInstanceOf(UnprocessableEntityException);
      expect(bodyOf(mapped).code).toBe("VALIDATION-ERR-001");
      expect(bodyOf(mapped).details?.[0]?.message).toBe(constraint);
    },
  );

  it("22003 numeric overflow ⇒ 422 VALIDATION-ERR-001", () => {
    const mapped = mapAssetPgError(wrapped({ code: "22003" }, 1));
    expect(mapped?.getStatus()).toBe(422);
    expect(bodyOf(mapped).code).toBe("VALIDATION-ERR-001");
  });

  it("KHÔNG map constraint lạ cùng mã (23505 ống nước FK · 23514 *_pair · 23503) ⇒ null để caller ném nguyên bản", () => {
    expect(
      mapAssetPgError(wrapped({ code: "23505", constraint: "assets_company_id_id_uq" }, 1)),
    ).toBeNull();
    expect(
      mapAssetPgError(
        wrapped({ code: "23514", constraint: "chk_asset_assignments_return_pair" }, 1),
      ),
    ).toBeNull();
    expect(
      mapAssetPgError(wrapped({ code: "23503", constraint: "assets_category_fk" }, 1)),
    ).toBeNull();
    expect(mapAssetPgError(new Error("not pg"))).toBeNull();
  });
});

describe("assets.errors — assetDetails hình dạng ErrorDetail[]", () => {
  it("kind + cặp phụ, bỏ null/undefined", () => {
    const d = assetDetails("prefix-taken", { categoryId: "abc", deleted: true, none: null });
    expect(d).toEqual([
      { field: "kind", message: "prefix-taken", rule: "asset" },
      { field: "categoryId", message: "abc", rule: "asset" },
      { field: "deleted", message: "true", rule: "asset" },
    ]);
  });
});
