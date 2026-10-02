/**
 * S19-SEC-MAILCREDEXFIL-1 — `errorMessage` của "Kiểm tra kết nối" KHÔNG được mang byte của đầu bên kia.
 *
 * Đo trước WO (nodemailer 10.0.12, plan §2): route test trả nguyên `err.message`, mà nodemailer nối phản
 * hồi server vào đó ⇒ người giữ `configure-mail` trỏ test vào BẤT KỲ cổng TCP nào API với tới và đọc
 * được dòng đầu banner (phiên bản SSH, status HTTP, hostname/IP relay nội bộ), cả đường dẫn file của
 * OpenSSL khi lệch TLS. Spec này chạy `MailTransportService.test` với nodemailer THẬT tới các dịch vụ giả
 * trên 127.0.0.1 và khẳng định thông điệp trả về chỉ là một câu cố định theo loại lỗi.
 *
 * Ca hết-thời-gian (8 s mỗi lần) và DNS (cần mạng) đo ở `smtp-error-summary.spec.ts` bằng hình dạng lỗi
 * đã đo — không chạy qua dây ở đây.
 */
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeSmtpServer, type FakeSmtpServer } from "../../test/helpers/fake-smtp-server";
import { MailTransportService } from "./mail-transport.service";

const LOCALHOST = "127.0.0.1";
const USERNAME = "mailer@corp.example.test";
const PASSWORD = ["fixture", "smtp", "pw", "oracle"].join("-");
/** Chuỗi "bí mật nội bộ" mà dịch vụ giả để lộ trong banner — không ký tự nào được tới client. */
const INTERNAL_HOST = "internal-db-01.corp.local";

/** Thông điệp cố định theo loại lỗi (hợp đồng hiển thị cho admin — ghim chữ). */
const MSG = {
  auth: "Xác thực SMTP thất bại",
  refused: "Máy chủ từ chối kết nối — kiểm tra máy chủ và cổng.",
  tls: "Lỗi TLS/chứng chỉ — kiểm tra tuỳ chọn «Dùng TLS», cổng (465 dùng TLS, 587 dùng STARTTLS) và chứng chỉ máy chủ.",
  protocol: "Máy chủ không trả lời theo giao thức SMTP — kiểm tra cổng.",
  rejected554: "Máy chủ SMTP từ chối (mã 554).",
} as const;

/** Dịch vụ TCP giả: `onConnect` ghi banner/đáp lời theo kịch bản. */
function rawServer(onConnect: (socket: Socket) => void): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      socket.on("error", () => undefined);
      onConnect(socket);
    });
    server.listen(0, LOCALHOST, () => resolve(server));
  });
}

const portOf = (server: Server): number => (server.address() as AddressInfo).port;

const params = (port: number, secure = false) => ({
  host: LOCALHOST,
  port,
  username: USERNAME,
  secure,
  password: PASSWORD,
});

describe("MailTransportService.test — errorMessage chỉ từ trường máy-sinh (nodemailer thật)", () => {
  const servers: Server[] = [];
  let smtp: FakeSmtpServer | undefined;

  beforeEach(() => {
    // Log của service đã được khoá ở S19-OPS-AUDITHIGH-1; ở đây chỉ đo thứ trả cho CLIENT.
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
    await smtp?.close();
    smtp = undefined;
  });

  const track = (server: Server): Server => {
    servers.push(server);
    return server;
  };

  it.each([
    ["banner SSH", `SSH-2.0-OpenSSH_9.6p1 ${INTERNAL_HOST}\r\n`, MSG.protocol],
    ["banner HTTP", `HTTP/1.1 400 Bad Request\r\nServer: ${INTERNAL_HOST}\r\n\r\n`, MSG.protocol],
  ])("%s ⇒ thông điệp giao thức, KHÔNG lộ banner", async (_label, banner, expected) => {
    const server = track(await rawServer((socket) => socket.write(banner)));

    const res = await new MailTransportService().test(params(portOf(server)));

    expect(res.ok).toBe(false);
    expect(res.errorMessage).not.toContain(INTERNAL_HOST);
    expect(res.errorMessage).not.toContain("OpenSSH");
    expect(res.errorMessage).toBe(expected);
  });

  it("relay SMTP từ chối HELO kèm hostname nội bộ ⇒ chỉ còn mã 554", async () => {
    const server = track(
      await rawServer((socket) => {
        socket.write(`220 ${INTERNAL_HOST} ESMTP\r\n`);
        socket.on("data", () =>
          socket.write(`554 5.7.1 <unknown[10.0.3.7]>: rejected by ${INTERNAL_HOST}\r\n`),
        );
      }),
    );

    const res = await new MailTransportService().test(params(portOf(server)));

    expect(res.errorMessage).not.toContain(INTERNAL_HOST);
    expect(res.errorMessage).not.toContain("10.0.3.7");
    expect(res.errorMessage).toBe(MSG.rejected554);
  });

  it("AUTH bị từ chối, server echo username + hostname ⇒ câu xác thực chung", async () => {
    smtp = await startFakeSmtpServer({
      rejectAuth: true,
      echo: `for ${USERNAME} at ${INTERNAL_HOST}`,
    });

    const res = await new MailTransportService().test(params(smtp.port));

    expect(smtp.auths).toHaveLength(1);
    expect(res.errorMessage).not.toContain(USERNAME);
    expect(res.errorMessage).not.toContain(INTERNAL_HOST);
    expect(res.errorMessage).toBe(MSG.auth);
  });

  it("bật TLS tới server chữ rõ ⇒ câu TLS, KHÔNG lộ chuỗi lỗi/đường dẫn OpenSSL", async () => {
    smtp = await startFakeSmtpServer();

    const res = await new MailTransportService().test(params(smtp.port, true));

    expect(res.errorMessage).not.toMatch(/SSL routines|openssl|\.c:\d+/i);
    expect(res.errorMessage).toBe(MSG.tls);
  });

  it("cổng đóng ⇒ câu từ chối kết nối, KHÔNG lộ ip:cổng", async () => {
    const server = await rawServer(() => undefined);
    const port = portOf(server);
    await new Promise((done) => server.close(done));

    const res = await new MailTransportService().test(params(port));

    expect(res.errorMessage).not.toContain(`${LOCALHOST}:${port}`);
    expect(res.errorMessage).toBe(MSG.refused);
  });
});
