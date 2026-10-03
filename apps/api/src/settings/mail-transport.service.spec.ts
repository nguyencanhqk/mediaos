/**
 * CS-8 MailTransportService — unit specs (no network; nodemailer mock).
 *
 * 🔴 BẤT BIẾN #4 (plan §4): kết quả test KHÔNG echo credential. Từ S19-SEC-MAILCREDEXFIL-1 `errorMessage`
 * là câu cố định theo loại lỗi (không còn "sanitize" lời văn server) — đo qua dây thật ở
 * `mail-transport.oracle.spec.ts`, bảng phân loại ở `smtp-error-summary.spec.ts`.
 */
import { describe, expect, it, vi } from "vitest";

const USERNAME = "noreply@corp.example.com";
const PASSWORD = "sup3r-s3cret-smtp-pw";

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
    const res = await svc.test({
      host: "smtp.host",
      port: 587,
      username: USERNAME,
      secure: true,
      password: PASSWORD,
    });
    expect(res).toEqual({ ok: true });
    expect(verify).toHaveBeenCalledOnce();
    expect(sendMail).not.toHaveBeenCalled();
    vi.doUnmock("nodemailer");
  });

  it("verify ném lỗi auth → { ok:false, errorMessage } câu chung (KHÔNG credential)", async () => {
    // Hình dạng lỗi auth THẬT của nodemailer (đo): code EAUTH + responseCode 535; message mang lời server.
    const authError = Object.assign(
      new Error(`Invalid login: 535 auth failed for ${USERNAME}:${PASSWORD}`),
      {
        code: "EAUTH",
        responseCode: 535,
        command: "AUTH PLAIN",
      },
    );
    const verify = vi.fn().mockRejectedValue(authError);
    const close = vi.fn();
    vi.resetModules();
    vi.doMock("nodemailer", () => ({
      createTransport: vi.fn(() => ({ verify, sendMail: vi.fn(), close })),
    }));
    const { MailTransportService } = await import("./mail-transport.service");
    const svc = new MailTransportService();
    const res = await svc.test({
      host: "smtp.host",
      port: 587,
      username: USERNAME,
      secure: true,
      password: PASSWORD,
    });
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toBe("Xác thực SMTP thất bại");
    expect(res.errorMessage).not.toContain(USERNAME);
    expect(res.errorMessage).not.toContain(PASSWORD);
    expect(close).toHaveBeenCalled();
    vi.doUnmock("nodemailer");
  });

  it("verify ném LỖI LẬP TRÌNH (TypeError) → câu 'lỗi nội bộ' riêng + logger.error kèm frame, KHÔNG gom thành lỗi SMTP", async () => {
    // FULL gate silent-failure M-1: nâng major nodemailer làm verify() ném TypeError ⇒ trước vá ra đúng câu chung
    // "Kiểm tra kết nối thất bại." + WARN không stack — bug server đọc y hệt SMTP hỏng.
    const bug = new TypeError("Cannot read properties of undefined (reading 'sock')");
    const verify = vi.fn().mockRejectedValue(bug);
    const close = vi.fn();
    vi.resetModules();
    vi.doMock("nodemailer", () => ({
      createTransport: vi.fn(() => ({ verify, sendMail: vi.fn(), close })),
    }));
    const { MailTransportService } = await import("./mail-transport.service");
    const svc = new MailTransportService();
    const logger = (svc as unknown as { logger: { error: () => void; warn: () => void } }).logger;
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    const res = await svc.test({ host: "smtp.host", port: 587, username: USERNAME, secure: true, password: PASSWORD });

    expect(res).toEqual({ ok: false, errorMessage: "Lỗi nội bộ khi kiểm tra kết nối — xem log máy chủ." });
    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    const [summary, frames] = error.mock.calls[0] as unknown as [string, string];
    expect(summary).toContain("name=TypeError");
    expect(frames).toMatch(/^\s+at /m);
    // stack frames KHÔNG lặp message (V8 đặt message ở dòng đầu stack).
    expect(frames).not.toContain("reading 'sock'");
    vi.doUnmock("nodemailer");
  });
});
