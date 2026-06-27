import { describe, expect, it } from "vitest";
import { computeChecksum, SeedChecksumSecretError } from "./seed-checksum.util";

/**
 * FOUNDATION-BE-8 — computeChecksum: SHA-256 ổn định trên payload đã chuẩn-hoá (sort key). BẤT BIẾN #3:
 * checksum KHÔNG được chứa secret — payload mang field nhạy cảm ⇒ throw (fail-closed, KHÔNG nuốt).
 */
describe("computeChecksum", () => {
  it("trả về hex SHA-256 (64 ký tự) — khớp cột checksum varchar(128)", () => {
    const cs = computeChecksum({ name: "AUTH", sort: 1 });
    expect(cs).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ổn định bất kể thứ tự key (sort-key canonical)", () => {
    const a = computeChecksum({ name: "AUTH", sort: 1, active: true });
    const b = computeChecksum({ active: true, sort: 1, name: "AUTH" });
    expect(a).toBe(b);
  });

  it("payload khác giá trị ⇒ checksum khác", () => {
    const a = computeChecksum({ name: "AUTH", sort: 1 });
    const b = computeChecksum({ name: "AUTH", sort: 2 });
    expect(a).not.toBe(b);
  });

  it("payload null/undefined ⇒ checksum xác định, KHÔNG throw", () => {
    expect(computeChecksum(null)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeChecksum(undefined)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeChecksum(null)).toBe(computeChecksum(undefined));
  });

  it("ổn định với nested object (deep sort-key)", () => {
    const a = computeChecksum({ meta: { z: 1, a: 2 }, code: "X" });
    const b = computeChecksum({ code: "X", meta: { a: 2, z: 1 } });
    expect(a).toBe(b);
  });

  it("BẤT BIẾN #3: field secret/hash trong payload ⇒ throw (KHÔNG hash secret)", () => {
    for (const key of [
      "password",
      "passwordHash",
      "token",
      "secret",
      "apiKey",
      "envelope",
      "kms",
    ]) {
      expect(() => computeChecksum({ name: "X", [key]: "leak" })).toThrow(
        SeedChecksumSecretError,
      );
    }
  });

  it("BẤT BIẾN #3: field nhạy cảm nằm SÂU trong nested ⇒ vẫn throw", () => {
    expect(() => computeChecksum({ outer: { inner: { token: "leak" } } })).toThrow(
      SeedChecksumSecretError,
    );
  });

  it("phát hiện không phân biệt hoa/thường (Password, API_KEY...)", () => {
    expect(() => computeChecksum({ Password: "x" })).toThrow(SeedChecksumSecretError);
    expect(() => computeChecksum({ API_KEY: "x" })).toThrow(SeedChecksumSecretError);
  });
});
