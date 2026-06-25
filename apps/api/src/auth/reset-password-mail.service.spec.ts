import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger } from "@nestjs/common";
import { ResetPasswordMailService } from "./reset-password-mail.service";

/**
 * S2-AUTH-BE-4 — BẤT BIẾN #3 no-secret-log: ResetPasswordMailService.sendResetEmail({token,...}) KHÔNG BAO
 * GIỜ đưa plaintext token (hay URL nhúng token) vào BẤT KỲ lệnh log nào (logger.* / console.*). Token CHỈ
 * tồn tại trong RAM để nhúng vào nội dung email mock — KHÔNG được rò ra log/diagnostic.
 *
 * Khi chưa cấu hình RESET_PASSWORD_URL ⇒ mock no-op trả {sent:false, reason}; vẫn KHÔNG log token.
 */
describe("ResetPasswordMailService — no-secret-log (BẤT BIẾN #3)", () => {
  const TOKEN = "company-id.SUPER-SECRET-RESET-TOKEN-abc123";

  /** Thu MỌI tham số đưa vào logger.* + console.* để khẳng định token không lọt. */
  let logged: unknown[];
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];

  beforeEach(() => {
    logged = [];
    const sink = (...args: unknown[]) => {
      logged.push(...args);
    };
    for (const method of ["log", "warn", "error", "debug", "verbose"] as const) {
      spies.push(vi.spyOn(Logger.prototype, method).mockImplementation(sink as never));
    }
    for (const method of ["log", "warn", "error", "debug", "info"] as const) {
      spies.push(vi.spyOn(console, method).mockImplementation(sink as never));
    }
  });

  afterEach(() => {
    for (const s of spies) s.mockRestore();
    spies.length = 0;
  });

  function serialized(): string {
    return logged
      .map((a) => {
        if (typeof a === "string") return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join("");
  }

  it("KHÔNG log plaintext token khi mock no-op (RESET_PASSWORD_URL chưa cấu hình)", async () => {
    const prev = process.env.RESET_PASSWORD_URL;
    delete process.env.RESET_PASSWORD_URL;
    try {
      const svc = new ResetPasswordMailService();
      const result = await svc.sendResetEmail({
        companyId: "00000000-0000-0000-0000-000000000001",
        email: "victim@example.com",
        token: TOKEN,
      });
      expect(result.sent).toBe(false);
      const out = serialized();
      expect(out).not.toContain(TOKEN);
      // Cũng không được rò mảnh entropy của token (phần sau dấu chấm scoped).
      expect(out).not.toContain("SUPER-SECRET-RESET-TOKEN-abc123");
    } finally {
      if (prev === undefined) delete process.env.RESET_PASSWORD_URL;
      else process.env.RESET_PASSWORD_URL = prev;
    }
  });

  it("KHÔNG log plaintext token khi có RESET_PASSWORD_URL (link nhúng token KHÔNG vào log)", async () => {
    const prev = process.env.RESET_PASSWORD_URL;
    process.env.RESET_PASSWORD_URL = "https://auth.localhost/reset";
    try {
      const svc = new ResetPasswordMailService();
      await svc.sendResetEmail({
        companyId: "00000000-0000-0000-0000-000000000001",
        email: "victim@example.com",
        token: TOKEN,
      });
      const out = serialized();
      expect(out).not.toContain(TOKEN);
      expect(out).not.toContain("SUPER-SECRET-RESET-TOKEN-abc123");
    } finally {
      if (prev === undefined) delete process.env.RESET_PASSWORD_URL;
      else process.env.RESET_PASSWORD_URL = prev;
    }
  });
});
