import { describe, expect, it } from "vitest";
import { classifyBrandingRef, resolveProfileLogoWrite } from "./company-logo-ref";

const ID = "3f2b8c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const OTHER = "aaaaaaaa-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

describe("classifyBrandingRef", () => {
  it.each([
    [null, "", "write"],
    [ID, "   ", "write"],
    [null, "https://x.test/logo.png", "write"],
    [null, "HTTP://x.test/logo.png", "write"],
    [ID, ID, "keep"],
    [ID, ID.toUpperCase(), "keep"],
    [null, ID, "reject"],
    [ID, OTHER, "reject"],
    [null, "ftp://x.test/a", "reject"],
    [null, "chuoi-la", "reject"],
  ] as const)("hiện có %j, mới %j ⇒ %s", (current, next, expected) => {
    expect(classifyBrandingRef(current, next)).toBe(expected);
  });
});

describe("resolveProfileLogoWrite", () => {
  it("không gửi ⇒ không ghi", () => {
    expect(resolveProfileLogoWrite(ID, undefined)).toEqual({ write: false });
  });
  it("null ⇒ ghi null", () => {
    expect(resolveProfileLogoWrite(ID, null)).toEqual({ write: true, value: null });
  });
  it("http(s) ⇒ ghi nguyên chuỗi", () => {
    expect(resolveProfileLogoWrite(null, "https://x.test/a.png")).toEqual({
      write: true,
      value: "https://x.test/a.png",
    });
  });
  it("trùng giá trị hiện có (kể cả chữ HOA) ⇒ không ghi, giữ chuỗi cũ", () => {
    expect(resolveProfileLogoWrite(ID, ID.toUpperCase())).toEqual({ write: false });
  });
  it("mã khác ⇒ ném mã LOGO-REF", () => {
    expect(() => resolveProfileLogoWrite(ID, OTHER)).toThrow();
    try {
      resolveProfileLogoWrite(null, OTHER);
    } catch (e) {
      expect(JSON.stringify((e as { getResponse(): unknown }).getResponse())).toContain(
        "FOUNDATION-BRAND-ERR-LOGO-REF",
      );
    }
  });
});
