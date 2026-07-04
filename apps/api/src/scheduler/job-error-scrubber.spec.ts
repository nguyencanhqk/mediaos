import { describe, expect, it } from "vitest";
import { scrubErrorMessage, scrubSecrets } from "./job-error-scrubber";

/**
 * RED (BẤT BIẾN #3) — job-error-scrubber che secret khỏi `error_message` TRƯỚC khi ghi system_job_runs.
 * error_message là chuỗi tự do (lỗi kết nối DB/HTTP mang credential) ⇒ scrub theo MẪU nhúng-trong-chuỗi.
 */
describe("scrubSecrets — che secret trong chuỗi tự do", () => {
  it("che value của password=... (giá trị bị redact, khoá còn để chẩn đoán)", () => {
    const out = scrubSecrets("connect failed password=abc123 host=db");
    expect(out).not.toContain("abc123");
    expect(out).toContain("password=***");
    expect(out).toContain("host=db"); // không phải secret → giữ nguyên
  });

  it("che token= / secret= / api_key= (mọi biến thể key)", () => {
    expect(scrubSecrets("token=eyJra")).not.toContain("eyJra");
    expect(scrubSecrets("secret=s3cr3t")).not.toContain("s3cr3t");
    expect(scrubSecrets("api_key=AKIA123")).not.toContain("AKIA123");
    expect(scrubSecrets("access_token: Bearer.zzz")).not.toContain("zzz");
  });

  it("che credential EMBEDDED trong URL (user:pass@host — không phải key=value)", () => {
    const out = scrubSecrets("ECONNREFUSED postgres://mediaos_worker:supersecret@db:5432/mediaos");
    expect(out).not.toContain("supersecret");
    expect(out).toContain("***");
    // Giữ scheme + user + host để còn chẩn đoán (chỉ che mật khẩu).
    expect(out).toContain("postgres://mediaos_worker");
    expect(out).toContain("@db:5432");
  });

  it("idempotent + không đụng chuỗi lành", () => {
    const clean = "timeout after 30000ms while listing companies";
    expect(scrubSecrets(clean)).toBe(clean);
    const once = scrubSecrets("password=abc");
    expect(scrubSecrets(once)).toBe(once); // chạy lại không đổi thêm
  });
});

describe("scrubErrorMessage — từ unknown error", () => {
  it("Error → message đã scrub", () => {
    const msg = scrubErrorMessage(new Error("connect failed password=abc123"));
    expect(msg).not.toBeNull();
    expect(msg).not.toContain("abc123");
    expect(msg).toContain("password=***");
  });

  it("non-Error → String() rồi scrub; null/undefined → null", () => {
    expect(scrubErrorMessage("token=leak")).not.toContain("leak");
    expect(scrubErrorMessage(null)).toBeNull();
    expect(scrubErrorMessage(undefined)).toBeNull();
  });
});
