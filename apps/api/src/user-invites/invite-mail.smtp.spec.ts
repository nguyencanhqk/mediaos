/**
 * S19-OPS-AUDITHIGH-1 — nodemailer THẬT trên dây SMTP thật (server giả trong tiến trình).
 *
 * VÌ SAO: trước WO này mọi spec gửi mail mock toàn phần `nodemailer` ⇒ nâng MAJOR 9→10 không có ca nào
 * đỏ được dù thư viện vỡ. File này đo đúng hai call-site của `apps/api` qua thư viện thật:
 *   - `InviteMailService.sendActivationEmail` — `sendMail`, mang TOKEN kích hoạt tài khoản trong link;
 *   - `MailTransportService.test` — `verify()`, mang mật khẩu SMTP plaintext.
 * Cộng một ca chạy CODE SERVICE trên ENTRY CJS: vitest nạp nodemailer theo điều kiện `import` còn
 * `nest build` (module: commonjs) nạp `require` — với 10.x đó là HAI FILE KHÁC NHAU, và 10.0.0→10.0.10
 * lệch đúng entry CJS (sửa ở 10.0.11).
 *
 * BẤT BIẾN #3 (no secret in log): nodemailer NỐI phản hồi server vào `err.message`; các ca từ chối dưới
 * đây cho server ECHO token/username/link và khẳng định log của service không chứa chúng.
 */
import { createRequire } from "node:module";
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeMimeParts,
  decodeSubject,
  startFakeSmtpServer,
  type FakeSmtpOptions,
  type FakeSmtpServer,
} from "../../test/helpers/fake-smtp-server";
import type { SecretEncryptionService } from "../crypto/secret-encryption.service";
import type { CompanyMailConfig } from "../db/schema/mail-config";
import type { MailConfigRepository } from "../settings/mail-config.repository";
import { MailTransportService } from "../settings/mail-transport.service";
import { InviteMailService } from "./invite-mail.service";

// Fixture giống-secret GHÉP CHUỖI (CLAUDE.md §5 — gitleaks `generic-api-key` quét full-history).
const SMTP_PASSWORD = ["fixture", "smtp", "password", "s19"].join("-");
// Token thật là base64url (`user-invite-token.util.ts`) ⇒ fixture cùng bảng chữ.
const INVITE_TOKEN = ["fixture", "invite", "token", "s19"].join("_");
const SMTP_USERNAME = "mailer@corp.example.test";
const FROM_EMAIL = "noreply@corp.example.test";
const INVITEE_EMAIL = "nhanvien.moi@corp.example.test";
const COMPANY_NAME = "Acme Việt Nam";
const COMPANY_SLUG = "acme";
const ACTIVATION_BASE = "https://app.example.test/activate";
const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const LOCALHOST = "127.0.0.1";
/** Rớt kết nối phải settle xa dưới timeout socket 10s của service — không phải chờ hết timeout. */
const SETTLE_BUDGET_MS = 3000;

const EXPECTED_LINK = `${ACTIVATION_BASE}?${new URLSearchParams({ company: COMPANY_SLUG, token: INVITE_TOKEN })}`;
/** Blob AUTH PLAIN mà client gửi lên dây — cũng là credential, không được vào log (server giả echo nó). */
const AUTH_PLAIN_BLOB = Buffer.from(`\0${SMTP_USERNAME}\0${SMTP_PASSWORD}`).toString("base64");

const SEND_PARAMS = {
  companyId: COMPANY_ID,
  companySlug: COMPANY_SLUG,
  companyName: COMPANY_NAME,
  email: INVITEE_EMAIL,
  fullName: "Nguyễn Văn A",
  token: INVITE_TOKEN,
};

/** Server giả echo MỌI bí mật vào phản hồi từ chối — log không được chứa cái nào. */
const ECHO_ALL_SECRETS = `blocked ${EXPECTED_LINK} for ${SMTP_USERNAME} token=${INVITE_TOKEN} auth=${AUTH_PLAIN_BLOB}`;

/** Hàng config tối thiểu mà InviteMailService đọc — cột envelope bỏ trống vì `decryptSecret` bị thay. */
function mailConfigRow(port: number): CompanyMailConfig {
  return {
    id: "00000000-0000-4000-8000-0000000000aa",
    companyId: COMPANY_ID,
    scope: "default",
    host: LOCALHOST,
    port,
    username: SMTP_USERNAME,
    secure: false,
    fromName: "Phòng Nhân sự",
    fromEmail: FROM_EMAIL,
  } satisfies Partial<CompanyMailConfig> as CompanyMailConfig;
}

function inviteService(Service: typeof InviteMailService, port: number): InviteMailService {
  const repo = { findByScope: vi.fn(async () => mailConfigRow(port)) };
  const secrets = { decryptSecret: vi.fn(async () => SMTP_PASSWORD) };
  return new Service(
    repo as unknown as MailConfigRepository,
    secrets as unknown as SecretEncryptionService,
  );
}

const verifyParams = (port: number) => ({
  host: LOCALHOST,
  port,
  username: SMTP_USERNAME,
  secure: false,
  password: SMTP_PASSWORD,
});

describe("nodemailer THẬT qua SMTP — S19-OPS-AUDITHIGH-1", () => {
  let smtp: FakeSmtpServer | undefined;
  let logged: string[];

  const start = async (options?: FakeSmtpOptions): Promise<FakeSmtpServer> => {
    smtp = await startFakeSmtpServer(options);
    return smtp;
  };
  const logText = (): string => logged.join("\n");

  beforeEach(() => {
    vi.stubEnv("INVITE_ACTIVATION_URL", ACTIVATION_BASE);
    logged = [];
    for (const method of ["log", "warn", "error", "debug", "verbose"] as const) {
      vi.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
    }
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await smtp?.close();
    smtp = undefined;
  });

  it("tự-kiểm server giả: KHÔNG quảng bá AUTH ⇒ nodemailer bỏ qua đăng nhập mà vẫn 'thành công'", async () => {
    // Chứng minh assert `auths` ở các ca dưới KHÔNG xanh-rỗng: không có nó, mutant "bỏ auth" vẫn sống.
    const server = await start({ advertiseAuth: false });

    const res = await new MailTransportService().test(verifyParams(server.port));

    expect(res).toEqual({ ok: true });
    expect(server.auths).toEqual([]);
  });

  describe("InviteMailService.sendActivationEmail", () => {
    it("gửi thật: AUTH bằng mật khẩu đã giải mã · phong bì đúng · thân thư mang link kích hoạt", async () => {
      const server = await start();

      const res = await inviteService(InviteMailService, server.port).sendActivationEmail(
        SEND_PARAMS,
      );

      expect(res).toEqual({ sent: true });
      expect(server.auths).toEqual([
        expect.objectContaining({ username: SMTP_USERNAME, password: SMTP_PASSWORD }),
      ]);
      expect(server.messages).toHaveLength(1);
      const [msg] = server.messages;
      expect(msg.mailFrom).toBe(FROM_EMAIL);
      expect(msg.rcptTo).toEqual([INVITEE_EMAIL]);
      expect(decodeSubject(msg.raw)).toBe(`[${COMPANY_NAME}] Lời mời kích hoạt tài khoản`);

      const parts = decodeMimeParts(msg.raw);
      const plain = parts.find((p) => p.contentType === "text/plain")?.text;
      const html = parts.find((p) => p.contentType === "text/html")?.text;
      expect(plain).toContain("Xin chào Nguyễn Văn A,");
      expect(plain).toContain(EXPECTED_LINK);
      expect(html).toContain(`href="${EXPECTED_LINK.replace(/&/g, "&amp;")}"`);
    });

    it.each([
      ["AUTH (535)", { rejectAuth: true }, "code=EAUTH responseCode=535 command=AUTH PLAIN"],
      ["RCPT (550)", { rejectRcpt: true }, "code=EENVELOPE responseCode=550 command=RCPT TO"],
      ["DATA (550)", { rejectData: true }, "code=EMESSAGE responseCode=550 command=DATA"],
    ] as const)(
      "server từ chối %s và ECHO token/username/link ⇒ {sent:false}, log chẩn đoán được nhưng KHÔNG chứa bí mật",
      async (_stage, rejection, diagnostic) => {
        const server = await start({
          ...rejection,
          echo: ECHO_ALL_SECRETS,
        });

        const res = await inviteService(InviteMailService, server.port).sendActivationEmail(
          SEND_PARAMS,
        );

        expect(res).toEqual({ sent: false, reason: "send_failed" });
        expect(server.messages).toHaveLength(0);
        expect(logText()).toContain(
          `Gửi email mời tới ${LOCALHOST} thất bại (name=Error ${diagnostic} errno=- syscall=- tlsReason=-)`,
        );
        for (const secret of [
          INVITE_TOKEN,
          EXPECTED_LINK,
          SMTP_USERNAME,
          SMTP_PASSWORD,
          AUTH_PLAIN_BLOB,
        ]) {
          expect(logText()).not.toContain(secret);
        }
      },
    );

    it("cổng ĐÃ ĐÓNG ⇒ {sent:false} (không treo), log nêu đúng ECONNREFUSED", async () => {
      const server = await start();
      const { port } = server;
      await server.close();
      smtp = undefined;

      const res = await inviteService(InviteMailService, port).sendActivationEmail(SEND_PARAMS);

      expect(res).toEqual({ sent: false, reason: "send_failed" });
      expect(logText()).toContain(
        `Gửi email mời tới ${LOCALHOST} thất bại (name=Error code=ESOCKET responseCode=- command=CONN errno=ECONNREFUSED syscall=connect tlsReason=-)`,
      );
    });

    it("lỗi LẬP TRÌNH trong `try` ⇒ {sent:false}, log `error` chỉ kèm frame stack — KHÔNG kèm message (có thể mang dữ liệu)", async () => {
      const server = await start();
      // `buildBodyHtml` → `escapeHtml(fullName)` gọi `.replace` TRONG `try` ⇒ TypeError mang bí mật trong message.
      const poisonedName = {
        toString: () => "A",
        replace: () => {
          throw new TypeError(`boom ${INVITE_TOKEN}`);
        },
      } as unknown as string;

      const res = await inviteService(InviteMailService, server.port).sendActivationEmail({
        ...SEND_PARAMS,
        fullName: poisonedName,
      });

      expect(res).toEqual({ sent: false, reason: "send_failed" });
      expect(vi.mocked(Logger.prototype.error)).toHaveBeenCalledTimes(1);
      expect(logText()).toContain(`Gửi email mời tới ${LOCALHOST} thất bại (name=TypeError code=-`);
      expect(logText()).toMatch(/^\s+at /m);
      expect(logText()).not.toContain(INVITE_TOKEN);
    });

    it("rớt kết nối ở lệnh DATA ⇒ {sent:false} settle nhanh (10.0.12: settle mọi lần gửi khi lỗi kết nối)", async () => {
      const server = await start({ dropAfterData: true });
      const startedAt = Date.now();

      const res = await inviteService(InviteMailService, server.port).sendActivationEmail(
        SEND_PARAMS,
      );

      expect(res).toEqual({ sent: false, reason: "send_failed" });
      expect(Date.now() - startedAt).toBeLessThan(SETTLE_BUDGET_MS);
      expect(server.messages).toHaveLength(0);
      expect(logText()).toContain(`Gửi email mời tới ${LOCALHOST} thất bại (name=Error code=E`);
    });

    it("ENTRY CJS: code service chạy trên đúng object `require('nodemailer')` mà PROD nạp", async () => {
      const server = await start();
      const requireFromHere = createRequire(__filename);
      const cjs = requireFromHere("nodemailer") as typeof import("nodemailer");
      const createTransport = vi.spyOn(cjs, "createTransport");
      // BẮT BUỘC: không reset thì `import()` trả module đã cache (gắn nodemailer ESM ở import tĩnh đầu
      // file) ⇒ ca này chạy ESM mà vẫn xanh — spy bên dưới là chốt bắt đúng ca đó.
      vi.resetModules();
      vi.doMock("nodemailer", () => cjs);
      try {
        const { InviteMailService: CjsInviteMailService } = await import("./invite-mail.service");
        const res = await inviteService(CjsInviteMailService, server.port).sendActivationEmail(
          SEND_PARAMS,
        );
        expect(res).toEqual({ sent: true });
      } finally {
        vi.doUnmock("nodemailer");
      }

      expect(createTransport).toHaveBeenCalledTimes(1);
      // 10.x: dist/cjs/nodemailer.js (entry `require` của exports map) · 9.x: lib/nodemailer.js.
      expect(requireFromHere.resolve("nodemailer")).toMatch(
        /[\\/](dist[\\/]cjs|lib)[\\/]nodemailer\.js$/,
      );
      expect(server.auths).toHaveLength(1);
      expect(server.messages.map((m) => m.rcptTo)).toEqual([[INVITEE_EMAIL]]);
    });
  });

  describe("MailTransportService.test (verify — chỉ bắt tay)", () => {
    it("server nhận AUTH ⇒ {ok:true}, KHÔNG có MAIL/RCPT/DATA nào", async () => {
      const server = await start();

      const res = await new MailTransportService().test(verifyParams(server.port));

      expect(res).toEqual({ ok: true });
      expect(server.auths).toEqual([
        expect.objectContaining({ username: SMTP_USERNAME, password: SMTP_PASSWORD }),
      ]);
      expect(server.commands.filter((c) => /^(MAIL|RCPT|DATA)\b/i.test(c))).toEqual([]);
      expect(server.messages).toHaveLength(0);
    });

    it("535 kèm echo username ⇒ thông điệp CHUNG đã sanitize, không lộ user/mật khẩu (kể cả trong log)", async () => {
      const server = await start({ rejectAuth: true, echo: ECHO_ALL_SECRETS });

      const res = await new MailTransportService().test(verifyParams(server.port));

      expect(res).toEqual({ ok: false, errorMessage: "Xác thực SMTP thất bại" });
      expect(server.auths).toHaveLength(1);
      // Dương TRƯỚC: chứng minh spy bắt được log (không có nó, các `not.toContain` dưới xanh-rỗng).
      expect(logText()).toContain(
        "SMTP verify thất bại (name=Error code=EAUTH responseCode=535 command=AUTH PLAIN errno=- syscall=- tlsReason=-)",
      );
      for (const secret of [SMTP_USERNAME, SMTP_PASSWORD, AUTH_PLAIN_BLOB]) {
        expect(logText()).not.toContain(secret);
      }
    });
  });
});
