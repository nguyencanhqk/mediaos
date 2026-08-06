import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSealed, openSecret, resetKekCache, sealSecret, type SecretLocation } from "./secret-box";

/**
 * Bo test cho secret-box. Trong tam KHONG phai "ma hoa roi giai ma ra dung chuoi cu" (dieu do
 * gan nhu khong the sai) ma la CAC DUONG TU CHOI: gia tri chua ma hoa phai NEM LOI chu khong
 * duoc tra ve nguyen van, va token cua dong nay khong duoc mo bang danh tinh cua dong khac.
 */

const AT: SecretLocation = { table: "accounts", column: "user_token", rowKey: "fb-user-1" };

// Khong viet literal giong-secret (rule gitleaks generic-api-key) — ghep chuoi.
const FAKE_TOKEN = ["EAAG", "test", "page", "token", "0123456789"].join("-");

let kekPath: string;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "fbpost-kek-"));
  kekPath = join(dir, "kek.bin");
  writeFileSync(kekPath, randomBytes(32));
  process.env.SOCIAL_KEK_PATH = kekPath;
  resetKekCache();
});

afterEach(() => {
  delete process.env.SOCIAL_KEK_PATH;
  resetKekCache();
});

describe("sealSecret / openSecret", () => {
  it("mo lai dung gia tri ban dau", () => {
    const sealed = sealSecret(FAKE_TOKEN, AT);
    expect(openSecret(sealed, AT)).toBe(FAKE_TOKEN);
  });

  it("chuoi da bao mat KHONG chua ban ro", () => {
    const sealed = sealSecret(FAKE_TOKEN, AT);
    expect(sealed).not.toContain(FAKE_TOKEN);
    expect(sealed.startsWith("v1.")).toBe(true);
  });

  it("hai lan bao mat cung gia tri cho hai chuoi KHAC nhau (IV moi moi lan)", () => {
    expect(sealSecret(FAKE_TOKEN, AT)).not.toBe(sealSecret(FAKE_TOKEN, AT));
  });

  it("chuoi rong di qua nguyen ven — 'chua cau hinh' khong phai bi mat", () => {
    expect(sealSecret("", AT)).toBe("");
    expect(openSecret("", AT)).toBe("");
  });
});

describe("fail-closed", () => {
  it("gia tri CHUA bao mat thi NEM LOI, khong tra ve nguyen van", () => {
    // Day la ca quan trong nhat cua ca file: neu openSecret tra ve `FAKE_TOKEN` o day thi mot
    // CSDL chua migrate se chay "binh thuong" voi token nam tho — hong im lang.
    expect(() => openSecret(FAKE_TOKEN, AT)).toThrow(/chua duoc bao mat/);
  });

  it("khong the mo token cua dong nay bang danh tinh cua dong khac", () => {
    const sealed = sealSecret(FAKE_TOKEN, AT);
    const otherRow: SecretLocation = { ...AT, rowKey: "fb-user-2" };
    expect(() => openSecret(sealed, otherRow)).toThrow(/khong giai ma duoc/);
  });

  it("khong the mo token cua cot nay bang danh tinh cot khac", () => {
    const sealed = sealSecret(FAKE_TOKEN, AT);
    const otherColumn: SecretLocation = { ...AT, column: "app_secret" };
    expect(() => openSecret(sealed, otherColumn)).toThrow(/khong giai ma duoc/);
  });

  it("sua mot byte ciphertext thi bi tu choi", () => {
    const sealed = sealSecret(FAKE_TOKEN, AT);
    const parts = sealed.split(".");
    const bytes = Buffer.from(parts[3], "base64url");
    bytes[0] = bytes[0] ^ 0xff;
    parts[3] = bytes.toString("base64url");
    expect(() => openSecret(parts.join("."), AT)).toThrow(/khong giai ma duoc/);
  });

  it("loi giai ma KHONG lo chi tiet crypto hay ban ro", () => {
    const sealed = sealSecret(FAKE_TOKEN, AT);
    try {
      openSecret(sealed, { ...AT, rowKey: "khac" });
      expect.unreachable("dang le phai nem loi");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(FAKE_TOKEN);
      expect(message).not.toMatch(/auth tag|unable to authenticate/i);
    }
  });

  it("KEK khac thi khong mo duoc", () => {
    const sealed = sealSecret(FAKE_TOKEN, AT);
    const otherDir = mkdtempSync(join(tmpdir(), "fbpost-kek-other-"));
    const otherPath = join(otherDir, "kek.bin");
    writeFileSync(otherPath, randomBytes(32));
    process.env.SOCIAL_KEK_PATH = otherPath;
    resetKekCache();
    expect(() => openSecret(sealed, AT)).toThrow(/khong giai ma duoc/);
  });

  it("thieu file KEK thi bao loi ro rang, khong im lang", () => {
    process.env.SOCIAL_KEK_PATH = join(tmpdir(), "khong-ton-tai", "kek.bin");
    resetKekCache();
    expect(() => sealSecret(FAKE_TOKEN, AT)).toThrow(/khong doc duoc file KEK/);
  });

  it("KEK sai do dai thi bao loi, khong am tham dung khoa yeu", () => {
    const dir = mkdtempSync(join(tmpdir(), "fbpost-kek-short-"));
    const shortPath = join(dir, "kek.bin");
    writeFileSync(shortPath, randomBytes(16));
    process.env.SOCIAL_KEK_PATH = shortPath;
    resetKekCache();
    expect(() => sealSecret(FAKE_TOKEN, AT)).toThrow(/phai dung 32 byte/);
  });
});

describe("isSealed", () => {
  it("phan biet duoc gia tri da bao mat voi du lieu cu", () => {
    expect(isSealed(sealSecret(FAKE_TOKEN, AT))).toBe(true);
    expect(isSealed(FAKE_TOKEN)).toBe(false);
    expect(isSealed("")).toBe(false);
    // Chuoi vo tinh bat dau bang "v1." nhung khong du 4 phan → khong phai dang bao mat.
    expect(isSealed("v1.chi-co-hai-phan")).toBe(false);
  });
});
