/**
 * CS-8 MailTransportService — unit specs (no network).
 *
 * 🔴 BẤT BIẾN #4 (plan §4): kết quả test KHÔNG echo credential. Các assertion lộ-credential ở đây
 * là tuyến phòng thủ chính — error string KHÔNG BAO GIỜ chứa username/password.
 */
import { describe, expect, it, vi } from "vitest";
import { sanitizeSmtpError } from "./mail-transport.service";

const USERNAME = "noreply@corp.example.com";
const PASSWORD = "sup3r-s3cret-smtp-pw";

describe("sanitizeSmtpError — KHÔNG để credential lọt vào message", () => {
  it("lỗi auth (EAUTH/535/invalid login) → message CHUNG, KHÔNG chi tiết", () => {
    for (const raw of [
      "Invalid login: 535 5.7.8 Authentication failed",
      `535-5.7.8 Username and password not accepted for ${USERNAME}`,
      "EAUTH: authentication failed",
    ]) {
      const out = sanitizeSmtpError(raw, USERNAME, PASSWORD);
      expect(out).toBe("Xác thực SMTP thất bại");
      expect(out).not.toContain(USERNAME);
      expect(out).not.toContain(PASSWORD);
    }
  });

  it("lỗi non-auth nhúng credential (vd URI) → credential bị thay bằng ***", () => {
    const raw = `connect ECONNREFUSED smtp://${USERNAME}:${PASSWORD}@smtp.host:587`;
    const out = sanitizeSmtpError(raw, USERNAME, PASSWORD);
    expect(out).not.toContain(USERNAME);
    expect(out).not.toContain(PASSWORD);
    expect(out).toContain("***");
  });

  it("lỗi mạng thuần (không credential) → giữ nguyên, vẫn không chứa credential", () => {
    const raw = "connect ETIMEDOUT 203.0.113.10:465";
    const out = sanitizeSmtpError(raw, USERNAME, PASSWORD);
    expect(out).toBe(raw);
    expect(out).not.toContain(PASSWORD);
  });

  it("password rỗng (vắng) → không crash, vẫn lọc username", () => {
    const raw = `host ${USERNAME} unreachable`;
    const out = sanitizeSmtpError(raw, USERNAME, "");
    expect(out).not.toContain(USERNAME);
  });
});

describe("MailTransportService.test — verify() chỉ handshake, kết quả sanitize", () => {
  it("verify OK → { ok: true }, KHÔNG gọi sendMail", async () => {
    const verify = vi.fn().mockResolvedValue(true);
    const sendMail = vi.fn();
    const close = vi.fn();
    vi.resetModules();
    vi.doMock("nodemailer", () => ({
      createTransport: vi.fn(() => ({ verify, sendMail, close })),
    }));
    const { MailTransportService } = await import("./mail-transport.service");
    const svc = new MailTransportService();
    const res = await svc.test({ host: "smtp.host", port: 587, username: USERNAME, secure: true, password: PASSWORD });
    expect(res).toEqual({ ok: true });
    expect(verify).toHaveBeenCalledOnce();
    expect(sendMail).not.toHaveBeenCalled();
    vi.doUnmock("nodemailer");
  });

  it("verify ném lỗi auth → { ok:false, errorMessage } sanitize (KHÔNG credential)", async () => {
    const verify = vi.fn().mockRejectedValue(new Error(`535 auth failed for ${USERNAME}:${PASSWORD}`));
    const close = vi.fn();
    vi.resetModules();
    vi.doMock("nodemailer", () => ({
      createTransport: vi.fn(() => ({ verify, sendMail: vi.fn(), close })),
    }));
    const { MailTransportService } = await import("./mail-transport.service");
    const svc = new MailTransportService();
    const res = await svc.test({ host: "smtp.host", port: 587, username: USERNAME, secure: true, password: PASSWORD });
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toBe("Xác thực SMTP thất bại");
    expect(res.errorMessage).not.toContain(USERNAME);
    expect(res.errorMessage).not.toContain(PASSWORD);
    expect(close).toHaveBeenCalled();
    vi.doUnmock("nodemailer");
  });
});
