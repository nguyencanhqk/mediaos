import { describe, expect, it } from "vitest";
import {
  patchSequenceSchema,
  sequenceCounterViewSchema,
  sequenceListResponseSchema,
  sequencePreviewResponseSchema,
} from "./index";

/**
 * S2-FND-BE-2 — sequence contract test (QA-04). Kiểm: view WHITELIST an toàn (STRIP current_value +
 * companyId + field nội bộ), preview shape, patch .strict() chặn leo thang + ≥1 field, enum khớp CHECK.
 */
describe("S2-FND-BE-2 sequence contracts", () => {
  const safeRow = {
    id: "11111111-1111-1111-1111-111111111111",
    moduleCode: "HR",
    sequenceKey: "EMPLOYEE_CODE",
    scopeType: "Company" as const,
    scopeReferenceId: null,
    prefix: "EMP",
    suffix: null,
    datePattern: "yyyy",
    paddingLength: 4,
    incrementBy: 1,
    resetPolicy: "Yearly" as const,
    status: "Active" as const,
    lastGeneratedCode: "EMP2026-0010",
    lastResetAt: null,
    updatedAt: "2026-07-01T00:00:00.000Z",
  };

  describe("sequenceCounterViewSchema (WHITELIST — no current_value leak)", () => {
    it("parse giữ đúng field whitelist", () => {
      const parsed = sequenceCounterViewSchema.parse(safeRow);
      expect(parsed.id).toBe(safeRow.id);
      expect(parsed.sequenceKey).toBe("EMPLOYEE_CODE");
      expect(parsed.lastGeneratedCode).toBe("EMP2026-0010");
    });

    it("STRIP current_value/companyId/lockVersion (KHÔNG lộ giá trị runtime/nội bộ)", () => {
      const parsed = sequenceCounterViewSchema.parse({
        ...safeRow,
        currentValue: "9999",
        current_value: "9999",
        companyId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        lockVersion: 3,
        createdBy: "someone",
      });
      expect(parsed).not.toHaveProperty("currentValue");
      expect(parsed).not.toHaveProperty("current_value");
      expect(parsed).not.toHaveProperty("companyId");
      expect(parsed).not.toHaveProperty("lockVersion");
      expect(parsed).not.toHaveProperty("createdBy");
      expect(JSON.stringify(parsed)).not.toMatch(/current_value|9999/);
    });

    it("reject resetPolicy / status ngoài enum", () => {
      expect(() =>
        sequenceCounterViewSchema.parse({ ...safeRow, resetPolicy: "Hourly" }),
      ).toThrow();
      expect(() => sequenceCounterViewSchema.parse({ ...safeRow, status: "Deleted" })).toThrow();
    });

    it("list response = mảng row whitelist", () => {
      const parsed = sequenceListResponseSchema.parse([safeRow, safeRow]);
      expect(parsed).toHaveLength(2);
    });
  });

  describe("sequencePreviewResponseSchema", () => {
    it("parse value/code (value = giá trị kế tiếp, KHÔNG current_value)", () => {
      const parsed = sequencePreviewResponseSchema.parse({
        sequenceKey: "EMPLOYEE_CODE",
        value: 11,
        code: "EMP2026-0011",
        currentValue: 10,
      });
      expect(parsed.value).toBe(11);
      expect(parsed.code).toBe("EMP2026-0011");
      expect(parsed).not.toHaveProperty("currentValue");
    });
  });

  describe("patchSequenceSchema (.strict + ≥1 field)", () => {
    it("chấp nhận patch một phần field cấu hình", () => {
      const parsed = patchSequenceSchema.parse({ prefix: "EMPX", paddingLength: 6 });
      expect(parsed.prefix).toBe("EMPX");
      expect(parsed.paddingLength).toBe(6);
    });

    it("reject PATCH rỗng (chống audit no-op)", () => {
      expect(() => patchSequenceSchema.parse({})).toThrow();
    });

    it("reject field leo thang (currentValue/id/sequenceKey/companyId) — .strict()", () => {
      expect(() => patchSequenceSchema.parse({ currentValue: 0 })).toThrow();
      expect(() => patchSequenceSchema.parse({ id: "x", prefix: "P" })).toThrow();
      expect(() => patchSequenceSchema.parse({ sequenceKey: "X", prefix: "P" })).toThrow();
    });

    it("reject incrementBy < 1 / paddingLength âm", () => {
      expect(() => patchSequenceSchema.parse({ incrementBy: 0 })).toThrow();
      expect(() => patchSequenceSchema.parse({ paddingLength: -1 })).toThrow();
    });
  });
});
