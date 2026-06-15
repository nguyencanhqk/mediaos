import { describe, expect, it } from "vitest";
// 🔴 RED-first (CLAUDE §6): import từ @mediaos/contracts khi crypto.ts CHƯA re-export ở index → ĐỎ
//    đúng lý do (module export thiếu) trước khi build contracts.
import {
  encryptionKeyPurposeEnum,
  encryptionKeySchema,
  encryptionKeyStatusEnum,
  provisionKeyVersionInputSchema,
  provisionKeyVersionResultSchema,
} from "./index";

/**
 * P6 — G6-2 PR-A crypto contracts. Kiểm:
 *   - encryptionKeySchema parse hợp lệ + reject thiếu purpose/key_version.
 *   - provisionKeyVersionInputSchema parse hợp lệ + reject purpose ngoài enum.
 *   - KHÔNG export field secret / key material (registry view chỉ mang kms_key_id = Vault path).
 */
describe("G6-2 PR-A crypto contracts", () => {
  describe("encryptionKeySchema", () => {
    const valid = {
      keyVersion: 1,
      kmsKeyId: "local-dev-kek",
      purpose: "platform_account",
      status: "active",
    } as const;

    it("parse hợp lệ 1 hàng registry", () => {
      expect(encryptionKeySchema.parse(valid)).toEqual(valid);
    });

    it("REJECT khi thiếu purpose", () => {
      const { purpose: _omit, ...bad } = valid;
      expect(() => encryptionKeySchema.parse(bad)).toThrow();
    });

    it("REJECT khi thiếu key_version", () => {
      const { keyVersion: _omit, ...bad } = valid;
      expect(() => encryptionKeySchema.parse(bad)).toThrow();
    });

    it("REJECT key_version không dương (0 / âm)", () => {
      expect(() => encryptionKeySchema.parse({ ...valid, keyVersion: 0 })).toThrow();
      expect(() => encryptionKeySchema.parse({ ...valid, keyVersion: -1 })).toThrow();
    });

    it("REJECT status ngoài enum", () => {
      expect(() => encryptionKeySchema.parse({ ...valid, status: "deleted" })).toThrow();
    });

    it("KHÔNG có field secret/key/dek/material trong shape", () => {
      const keys = Object.keys(encryptionKeySchema.shape);
      for (const forbidden of ["secret", "key", "dek", "material", "ciphertext", "plaintext"]) {
        expect(keys).not.toContain(forbidden);
      }
    });
  });

  describe("provisionKeyVersionInputSchema", () => {
    it("parse hợp lệ purpose='platform_account'", () => {
      expect(provisionKeyVersionInputSchema.parse({ purpose: "platform_account" })).toEqual({
        purpose: "platform_account",
      });
    });

    it("REJECT khi thiếu purpose", () => {
      expect(() => provisionKeyVersionInputSchema.parse({})).toThrow();
    });

    it("REJECT purpose ngoài enum (vd 'totp_secret' chưa vào registry)", () => {
      expect(() => provisionKeyVersionInputSchema.parse({ purpose: "totp_secret" })).toThrow();
    });
  });

  describe("enums + result", () => {
    it("purpose enum = platform_account | auth_reset_token", () => {
      expect(encryptionKeyPurposeEnum.options).toEqual(["platform_account", "auth_reset_token"]);
    });

    it("status enum = active | retiring | revoked", () => {
      expect(encryptionKeyStatusEnum.options).toEqual(["active", "retiring", "revoked"]);
    });

    it("provisionKeyVersionResultSchema cho retiredKeyVersion null (lần provision đầu)", () => {
      const parsed = provisionKeyVersionResultSchema.parse({
        purpose: "platform_account",
        newKeyVersion: 2,
        retiredKeyVersion: null,
      });
      expect(parsed.retiredKeyVersion).toBeNull();
    });
  });
});
