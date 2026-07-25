import {
  apiErrorSchema,
  apiResponseSchema,
  errorDetailSchema,
  paginationSchema,
  responseMetaSchema,
} from "@mediaos/contracts";
import type { SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { COMPONENT_NAMES, envelopeComponents } from "./openapi-components";

/**
 * S5-BE-CONTRACT-1 — CHỐNG TRÔI giữa envelope tài liệu (JSON-Schema) và envelope hợp đồng (Zod ở
 * `packages/contracts`, nguồn sự thật DTO — CLAUDE.md §4).
 *
 * Không so khớp kiểu/format (hai hệ diễn đạt khác nhau) mà so khớp TẬP TÊN FIELD: đây chính là thứ FE
 * đọc và là thứ trôi trong thực tế (thêm field ở contracts, quên cập nhật tài liệu). Thêm/bớt field ở
 * một bên mà quên bên kia ⇒ ĐỎ ở đây.
 */

const components = envelopeComponents();

/** Tên property khai trong một component JSON-Schema. */
function propNames(component: SchemaObject | undefined): string[] {
  return Object.keys(component?.properties ?? {}).sort();
}

/** Tên field của một Zod object schema. */
function zodKeys(schema: z.ZodObject<z.ZodRawShape>): string[] {
  return Object.keys(schema.shape).sort();
}

describe("openapi-components — khớp contracts Zod (API-01 §11/§12/§16.1)", () => {
  it.each([
    [COMPONENT_NAMES.errorDetail, errorDetailSchema],
    [COMPONENT_NAMES.responseMeta, responseMetaSchema],
    [COMPONENT_NAMES.pagination, paginationSchema],
    [COMPONENT_NAMES.errorBody, apiErrorSchema],
  ])("component %s có ĐÚNG tập field của schema Zod tương ứng", (name, schema) => {
    expect(propNames(components[name])).toEqual(zodKeys(schema as z.ZodObject<z.ZodRawShape>));
  });

  it("envelope thành công + envelope lỗi khớp field của apiResponseSchema", () => {
    // `apiResponseSchema(z.unknown())` = envelope chung; cả 2 nhánh success/error dùng chung tập field.
    const expected = zodKeys(apiResponseSchema(z.unknown()) as z.ZodObject<z.ZodRawShape>);
    expect(propNames(components[COMPONENT_NAMES.successEnvelope])).toEqual(expected);
    // Nhánh lỗi KHÔNG có `pagination` (chỉ response danh sách thành công mới có).
    expect(propNames(components[COMPONENT_NAMES.errorEnvelope])).toEqual(
      expected.filter((k) => k !== "pagination"),
    );
  });

  it("mọi $ref nội bộ trỏ tới component CÓ THẬT (không ref gãy trong Swagger UI)", () => {
    const names = new Set(Object.keys(components));
    const broken: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node === null || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if (typeof obj.$ref === "string") {
        const target = obj.$ref.split("/").pop() ?? "";
        if (!names.has(target)) broken.push(obj.$ref);
      }
      Object.values(obj).forEach(walk);
    };
    walk(components);
    expect(broken).toEqual([]);
  });

  it("envelope lỗi tự mô tả đúng nhánh lỗi: success=false, data=null", () => {
    const errorEnvelope = components[COMPONENT_NAMES.errorEnvelope];
    expect((errorEnvelope.properties?.success as SchemaObject).enum).toEqual([false]);
    expect((errorEnvelope.properties?.data as SchemaObject).nullable).toBe(true);
    expect(errorEnvelope.required).toContain("error");
  });

  it("BẤT BIẾN #3: component envelope là schema KHUNG — KHÔNG chứa field nghiệp vụ/nhạy cảm", () => {
    const all = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node === null || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if (obj.properties && typeof obj.properties === "object") {
        Object.keys(obj.properties as Record<string, unknown>).forEach((k) => all.add(k.toLowerCase()));
      }
      Object.values(obj).forEach(walk);
    };
    walk(components);
    for (const forbidden of ["password", "passwordhash", "salary", "secretref", "token"]) {
      expect(all, `component envelope KHÔNG được có field '${forbidden}'`).not.toContain(forbidden);
    }
  });
});
