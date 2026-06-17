import { describe, it, expect } from "vitest";
import { parseRedirectAllowlist, validateRedirect } from "./redirect.util";

/**
 * FS-1a — chống open-redirect (rủi ro #11). Deny-path là TRỌNG TÂM: mọi origin ngoài allowlist, scheme nguy
 * hiểm, relative, malformed → null. KHÔNG cần DB.
 */
describe("redirect.util — parseRedirectAllowlist", () => {
  it("parse chuỗi phẩy → mảng origin chuẩn hoá (bỏ path/trailing slash)", () => {
    const a = parseRedirectAllowlist("https://studio.localhost/, https://people.localhost");
    expect(a).toEqual(["https://studio.localhost", "https://people.localhost"]);
  });

  it("bỏ entry rỗng + sai định dạng (fail-closed)", () => {
    expect(parseRedirectAllowlist("")).toEqual([]);
    expect(parseRedirectAllowlist(" , not-a-url , https://ok.localhost")).toEqual([
      "https://ok.localhost",
    ]);
  });

  it("giữ port trong origin (so khớp đúng cổng)", () => {
    expect(parseRedirectAllowlist("https://studio.localhost:5273")).toEqual([
      "https://studio.localhost:5273",
    ]);
  });
});

describe("redirect.util — validateRedirect (DENY-PATH)", () => {
  const allow = parseRedirectAllowlist("https://studio.localhost,https://people.localhost");

  it("origin ngoài allowlist → null", () => {
    expect(validateRedirect("https://evil.com/phish", allow)).toBeNull();
  });

  it("substring/suffix trick (studio.localhost.evil.com) → null (so khớp origin EXACT)", () => {
    expect(validateRedirect("https://studio.localhost.evil.com", allow)).toBeNull();
  });

  it("userinfo bypass (evil.com@studio.localhost) → null (origin lọt nhưng nhúng userinfo)", () => {
    expect(validateRedirect("https://evil.com@studio.localhost/steal", allow)).toBeNull();
    expect(validateRedirect("https://user:pass@studio.localhost", allow)).toBeNull();
  });

  it("scheme nguy hiểm javascript:/data:/file: → null", () => {
    expect(validateRedirect("javascript:alert(1)", allow)).toBeNull();
    expect(validateRedirect("data:text/html,<script>", allow)).toBeNull();
    expect(validateRedirect("file:///etc/passwd", allow)).toBeNull();
  });

  it("relative / protocol-relative / malformed → null", () => {
    expect(validateRedirect("/dashboard", allow)).toBeNull();
    expect(validateRedirect("//evil.com", allow)).toBeNull();
    expect(validateRedirect("http://", allow)).toBeNull();
    expect(validateRedirect("", allow)).toBeNull();
    expect(validateRedirect(undefined, allow)).toBeNull();
    expect(validateRedirect(null, allow)).toBeNull();
  });

  it("allowlist RỖNG → mọi target null (fail-closed)", () => {
    expect(validateRedirect("https://studio.localhost", [])).toBeNull();
  });

  it("sai cổng → null (origin gồm port)", () => {
    const a = parseRedirectAllowlist("https://studio.localhost:5273");
    expect(validateRedirect("https://studio.localhost:9999/x", a)).toBeNull();
  });

  it("sai scheme (http vs https allowlist) → null", () => {
    expect(validateRedirect("http://studio.localhost", allow)).toBeNull();
  });
});

describe("redirect.util — validateRedirect (HAPPY-PATH)", () => {
  const allow = parseRedirectAllowlist("https://studio.localhost,https://people.localhost");

  it("origin trong allowlist → trả URL (giữ path/query)", () => {
    expect(validateRedirect("https://studio.localhost/tasks?x=1", allow)).toBe(
      "https://studio.localhost/tasks?x=1",
    );
  });

  it("origin allowlist nhưng chỉ root → trả URL chuẩn hoá", () => {
    expect(validateRedirect("https://people.localhost", allow)).toBe("https://people.localhost/");
  });
});
