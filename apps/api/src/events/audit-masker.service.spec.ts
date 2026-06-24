import { describe, expect, it } from "vitest";
import { AuditMaskerService } from "./audit-masker.service";

/**
 * RED #1 (BE-3, BẤT BIẾN #3) — AuditMaskerService.mask() phải:
 *   - mask 8 khóa nhạy cảm (password/password_hash/token/secret/secret_ref/identity_number/
 *     bank_account/storage_path/signed_url) → value thành "***", GIỮ key.
 *   - match case-insensitive cả snake_case lẫn camelCase.
 *   - đệ quy qua nested object + array (KHÔNG bỏ sót lớp sâu).
 *   - IMMUTABLE: trả object MỚI, KHÔNG mutate input nghiệp vụ.
 *   - KHÔNG vỡ cấu trúc diff (key non-secret giữ nguyên value).
 *   - an toàn với null/undefined/primitive/Date.
 *
 * GHI CHÚ: mọi value bên dưới là placeholder vô hại (KHÔNG phải secret thật) — chỉ để khẳng định
 * masker thay VALUE bất kể nội dung. Dùng "PLACEHOLDER_*" để không trip guard-secrets.
 */
describe("AuditMaskerService.mask (bất biến #3)", () => {
  const masker = new AuditMaskerService();
  const MASK = "***";
  const SAMPLE = "PLACEHOLDER_VALUE";

  it("mask khóa snake_case nhạy cảm → '***', giữ key", () => {
    const out = masker.mask({ password: SAMPLE, password_hash: SAMPLE, email: "a@b.c" }) as Record<
      string,
      unknown
    >;
    expect(out["password"]).toBe(MASK);
    expect(out["password_hash"]).toBe(MASK);
    expect(out["email"]).toBe("a@b.c");
  });

  it("mask khóa camelCase nhạy cảm (passwordHash/secretRef/identityNumber/bankAccount/storagePath/signedUrl)", () => {
    const out = masker.mask({
      passwordHash: SAMPLE,
      secretRef: SAMPLE,
      identityNumber: SAMPLE,
      bankAccount: SAMPLE,
      storagePath: SAMPLE,
      signedUrl: SAMPLE,
      keep: "ok",
    }) as Record<string, unknown>;
    expect(out["passwordHash"]).toBe(MASK);
    expect(out["secretRef"]).toBe(MASK);
    expect(out["identityNumber"]).toBe(MASK);
    expect(out["bankAccount"]).toBe(MASK);
    expect(out["storagePath"]).toBe(MASK);
    expect(out["signedUrl"]).toBe(MASK);
    expect(out["keep"]).toBe("ok");
  });

  it("mask biến thể GHÉP theo stem (access_token/refreshToken/api_secret/clientSecret/secretKey/tokenHash) — chống D-i-D gap", () => {
    const out = masker.mask({
      access_token: SAMPLE,
      refreshToken: SAMPLE,
      api_secret: SAMPLE,
      clientSecret: SAMPLE,
      secretKey: SAMPLE,
      tokenHash: SAMPLE,
      email: "a@b.c",
      keep: "ok",
    }) as Record<string, unknown>;
    expect(out["access_token"]).toBe(MASK);
    expect(out["refreshToken"]).toBe(MASK);
    expect(out["api_secret"]).toBe(MASK);
    expect(out["clientSecret"]).toBe(MASK);
    expect(out["secretKey"]).toBe(MASK);
    expect(out["tokenHash"]).toBe(MASK);
    expect(out["email"]).toBe("a@b.c");
    expect(out["keep"]).toBe("ok");
  });

  it("mask token + secret (snake/single)", () => {
    const out = masker.mask({ token: SAMPLE, secret: SAMPLE, secret_ref: SAMPLE, name: "keep" }) as Record<
      string,
      unknown
    >;
    expect(out["token"]).toBe(MASK);
    expect(out["secret"]).toBe(MASK);
    expect(out["secret_ref"]).toBe(MASK);
    expect(out["name"]).toBe("keep");
  });

  it("match case-insensitive (PASSWORD / Token / Secret)", () => {
    const out = masker.mask({ PASSWORD: SAMPLE, Token: SAMPLE, Secret: SAMPLE, Name: "keep" }) as Record<
      string,
      unknown
    >;
    expect(out["PASSWORD"]).toBe(MASK);
    expect(out["Token"]).toBe(MASK);
    expect(out["Secret"]).toBe(MASK);
    expect(out["Name"]).toBe("keep");
  });

  it("đệ quy nested object", () => {
    const out = masker.mask({
      level1: { token: SAMPLE, inner: { secret: SAMPLE, ok: 1 } },
      ok: true,
    }) as Record<string, Record<string, Record<string, unknown>>>;
    expect(out["level1"]["token"]).toBe(MASK);
    expect(out["level1"]["inner"]["secret"]).toBe(MASK);
    expect(out["level1"]["inner"]["ok"]).toBe(1);
    expect((out as unknown as Record<string, unknown>)["ok"]).toBe(true);
  });

  it("đệ quy qua array of object", () => {
    const out = masker.mask({
      items: [
        { token: SAMPLE, id: "a" },
        { token: SAMPLE, id: "b" },
      ],
    }) as { items: Array<Record<string, unknown>> };
    expect(out.items[0]["token"]).toBe(MASK);
    expect(out.items[0]["id"]).toBe("a");
    expect(out.items[1]["token"]).toBe(MASK);
    expect(out.items[1]["id"]).toBe("b");
  });

  it("IMMUTABLE — KHÔNG mutate input gốc", () => {
    const input = { password: SAMPLE, nested: { token: SAMPLE } };
    const snapshot = JSON.parse(JSON.stringify(input));
    masker.mask(input);
    expect(input).toEqual(snapshot);
    expect(input.password).toBe(SAMPLE);
    expect(input.nested.token).toBe(SAMPLE);
  });

  it("null / undefined / primitive passthrough", () => {
    expect(masker.mask(null)).toBeNull();
    expect(masker.mask(undefined)).toBeUndefined();
    expect(masker.mask(42)).toBe(42);
    expect(masker.mask("plain")).toBe("plain");
    expect(masker.mask(true)).toBe(true);
  });

  it("KHÔNG đệ quy phá Date (giữ nguyên instance value)", () => {
    const d = new Date("2026-06-22T00:00:00.000Z");
    const out = masker.mask({ when: d, token: SAMPLE }) as Record<string, unknown>;
    expect(out["token"]).toBe(MASK);
    expect(out["when"]).toBeInstanceOf(Date);
    expect((out["when"] as Date).toISOString()).toBe("2026-06-22T00:00:00.000Z");
  });
});
