/**
 * B2(a) PAGINATION — unit spec (LANE b2). MIRROR attendance.pagination.spec.ts F6 pattern.
 *
 * RED-first: finance list query schemas (revenue/cost/allocation) phải có limit/offset với clamp
 * Zod-REJECT (KHÔNG silent-clamp): limit [1..100] default 50 · offset ≥0 default 0. Đồng nhất G9/G11.
 *
 * BẤT BIẾN unbounded-query: list KHÔNG còn không-LIMIT. Schema là cổng chặn đầu tiên (out-of-range → 400).
 * All DB I/O mocked — không cần Postgres.
 */

import { describe, expect, it } from "vitest";
import {
  listRevenueQuerySchema,
  listCostQuerySchema,
  listCostAllocationQuerySchema,
} from "@mediaos/contracts";

const schemas = [
  ["listRevenueQuerySchema", listRevenueQuerySchema],
  ["listCostQuerySchema", listCostQuerySchema],
  ["listCostAllocationQuerySchema", listCostAllocationQuerySchema],
] as const;

describe.each(schemas)(
  "%s — limit/offset clamp (REJECT out-of-range, default 50/0)",
  (_name, schema) => {
    it("default limit = 50 khi không truyền", () => {
      const r = schema.parse({});
      expect(r.limit).toBe(50);
    });

    it("default offset = 0 khi không truyền", () => {
      const r = schema.parse({});
      expect(r.offset).toBe(0);
    });

    it("REJECT limit=101 (vượt max 100) — KHÔNG silent-clamp", () => {
      expect(() => schema.parse({ limit: 101 })).toThrow();
    });

    it("REJECT limit=0 (dưới min 1)", () => {
      expect(() => schema.parse({ limit: 0 })).toThrow();
    });

    it("REJECT offset=-1 (dưới min 0)", () => {
      expect(() => schema.parse({ offset: -1 })).toThrow();
    });

    it("accept limit=100 (boundary max OK)", () => {
      const r = schema.parse({ limit: 100, offset: 0 });
      expect(r.limit).toBe(100);
    });

    it("accept limit=1 (boundary min OK)", () => {
      const r = schema.parse({ limit: 1, offset: 0 });
      expect(r.limit).toBe(1);
    });

    it("coerce chuỗi '20'/'5' → number 20/5 (query string từ HTTP)", () => {
      const r = schema.parse({ limit: "20", offset: "5" });
      expect(r.limit).toBe(20);
      expect(r.offset).toBe(5);
    });

    it("REJECT limit không nguyên (1.5)", () => {
      expect(() => schema.parse({ limit: 1.5 })).toThrow();
    });
  },
);
