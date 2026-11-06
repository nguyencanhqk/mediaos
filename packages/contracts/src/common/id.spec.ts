import { describe, expect, it } from "vitest";
import { idSchema, idSchemaWith } from "../index";

/**
 * S19-OPS-ZOD4-1 — C1.2 (§4.2): `idSchema` PHẢI nhận id canonical đang sống trong DB (không chuẩn RFC: nibble
 * version/variant = 0) và từ chối rác. Mutant `idSchema → z.uuid()` (zod 4, chặt RFC) phải làm đỏ ca dương.
 */
const CANONICAL = [
  "00000000-0000-0000-0000-000000000010",
  "00000000-0000-0000-0000-000000000011",
  "00000000-0000-0000-0000-000000000001",
  "00000000-0000-0000-0000-0000000000a1",
  "11111111-1111-1111-1111-111111111111",
  "00000000-0000-0000-0000-0000000000A1",
];
const JUNK = [
  "",
  " ",
  "not-a-uuid",
  "123",
  "00000000-0000-0000-0000-00000000001",
  "00000000-0000-0000-0000-0000000000010",
  "00000000000000000000000000000010",
  "g0000000-0000-0000-0000-000000000010",
  "00000000-0000-0000-0000-000000000010 ",
  "'; DROP TABLE x; --",
];

describe("idSchema — id canonical", () => {
  it.each(CANONICAL)("nhận %s", (id) => {
    expect(idSchema.safeParse(id).success).toBe(true);
  });

  it.each(JUNK)("từ chối %j", (bad) => {
    expect(idSchema.safeParse(bad).success).toBe(false);
  });

  it("từ chối giá trị không phải chuỗi", () => {
    for (const v of [null, undefined, 10, {}, []])
      expect(idSchema.safeParse(v).success).toBe(false);
  });

  it("idSchemaWith: cùng tập nhận/từ chối, thông điệp tự đặt đi vào issue", () => {
    const s = idSchemaWith("khoa.i18n.id");
    for (const id of CANONICAL) expect(s.safeParse(id).success).toBe(true);
    const res = s.safeParse("rac");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.message).toBe("khoa.i18n.id");
  });
});
