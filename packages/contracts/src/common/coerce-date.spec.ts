import { describe, expect, it } from "vitest";
import { z } from "zod";
import { coerceDate } from "./coerce-date";

/** S19-OPS-ZOD4-1 — C3a: ghim hành vi `coerceDate()` so với `z.coerce.date()` của zod 3. */
describe("coerceDate", () => {
  it.each(["2026-01-01", "2026-01-01T00:00:00.000Z", "2026-08-04T17:00:00+07:00"])(
    "nhận chuỗi %s",
    (v) => {
      const r = coerceDate().safeParse(v);
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.getTime()).toBe(new Date(v).getTime());
    },
  );

  it("nhận epoch-ms", () => {
    const r = coerceDate().safeParse(1767225600000);
    expect(r.success && r.data.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it.each(["nope", ""])("từ chối chuỗi rác %j với invalid_type/date", (v) => {
    const r = coerceDate().safeParse(v);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.code).toBe("invalid_type");
      expect((r.error.issues[0] as { expected?: string }).expected).toBe("date");
    }
  });

  it("KHÁC coerce: null bị từ chối (coerce ra 1970)", () => {
    expect(coerceDate().safeParse(null).success).toBe(false);
  });

  it("KHÁC coerce: đối tượng Date bị từ chối ở parse", () => {
    expect(coerceDate().safeParse(new Date()).success).toBe(false);
  });

  it("nullable/optional hoạt động", () => {
    expect(coerceDate().nullable().safeParse(null).success).toBe(true);
    expect(coerceDate().optional().safeParse(undefined).success).toBe(true);
  });

  it("phía vào sinh được JSON Schema, phía ra vẫn ném (ghi nhận hạn chế)", () => {
    expect(z.toJSONSchema(coerceDate(), { io: "input" })).toMatchObject({ type: ["string", "number"] });
    expect(() => z.toJSONSchema(coerceDate(), { io: "output" })).toThrow();
  });
});
