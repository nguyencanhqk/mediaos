/**
 * S19-OPS-AUDITHIGH-1 — `describeSmtpError` là ALLOWLIST: trường máy-sinh khớp hình dạng thì giữ, lệch thì
 * `-`. Các ca "lệch" ở đây là lưới chống một bản nodemailer sau nhét lời văn server vào `code`/`command`
 * (FULL gate typescript-reviewer M1: không có chúng, nới regex thành `/.*\/` vẫn xanh toàn bộ).
 */
import { getSystemErrorMap } from "node:util";
import { describe, expect, it } from "vitest";
import { classifySmtpTestError, describeSmtpError, isProgrammerError } from "./smtp-error-summary";

/** Dựng lỗi kiểu nodemailer: Error + các trường mà `_formatError` gắn thêm. */
const smtpError = (fields: Record<string, unknown>, message = "boom"): Error =>
  Object.assign(new Error(message), fields);

/** errno của ECONNREFUSED theo libuv của nền tảng đang chạy (Windows -4078 · Linux -111). */
const errnoOf = (systemName: string): number | undefined =>
  [...getSystemErrorMap()].find(([, [name]]) => name === systemName)?.[0];
const ECONNREFUSED_ERRNO = errnoOf("ECONNREFUSED");

const LEAK = ["fixture", "invite", "token", "s19"].join("_");

describe("describeSmtpError — chỉ trường máy-sinh, đúng hình dạng", () => {
  it.each([
    [
      "535 ở AUTH",
      smtpError({ code: "EAUTH", responseCode: 535, command: "AUTH PLAIN" }),
      "name=Error code=EAUTH responseCode=535 command=AUTH PLAIN errno=- syscall=- tlsReason=-",
    ],
    [
      "cổng đóng (lỗi Node bị nodemailer ghi đè code)",
      smtpError({
        code: "ESOCKET",
        command: "CONN",
        errno: ECONNREFUSED_ERRNO,
        syscall: "connect",
      }),
      "name=Error code=ESOCKET responseCode=- command=CONN errno=ECONNREFUSED syscall=connect tlsReason=-",
    ],
    [
      "TLS lệch giao thức (OpenSSL reason)",
      smtpError({ code: "ESOCKET", command: "CONN", reason: "wrong version number" }),
      "name=Error code=ESOCKET responseCode=- command=CONN errno=- syscall=- tlsReason=wrong version number",
    ],
    [
      "code có chữ số (EOAUTH2)",
      smtpError({ code: "EOAUTH2", command: "AUTH XOAUTH2" }),
      "name=Error code=EOAUTH2 responseCode=- command=AUTH XOAUTH2 errno=- syscall=- tlsReason=-",
    ],
  ] as const)("%s", (_case, err, expected) => {
    expect(describeSmtpError(err)).toEqual(expected);
  });

  it("trường LỆCH hình dạng (lời văn server chen vào) ⇒ `-`, không một ký tự nào của nó lọt ra", () => {
    const err = smtpError({
      code: `EAUTH token=${LEAK}`,
      command: `RCPT TO <${LEAK}@x.test>`,
      responseCode: 5501,
      errno: 4078,
      syscall: `connect ${LEAK}`,
      reason: `Host: smtp.${LEAK}.test. is not in the cert's altnames`,
    });

    const out = describeSmtpError(err);

    expect(out).toBe("name=Error code=- responseCode=- command=- errno=- syscall=- tlsReason=-");
    expect(out).not.toContain(LEAK);
  });

  it("KHÔNG đọc message/response dù chúng chứa bí mật", () => {
    const err = smtpError(
      { code: "EMESSAGE", responseCode: 550, command: "DATA", response: `550 ${LEAK}` },
      `Message failed: 550 ${LEAK}`,
    );

    expect(describeSmtpError(err)).not.toContain(LEAK);
  });

  it.each([
    ["chuỗi", "boom"],
    ["null", null],
    ["undefined", undefined],
    ["số", 42],
  ])("giá trị ném KHÔNG phải Error (%s) ⇒ mọi trường `-`", (_case, thrown) => {
    expect(describeSmtpError(thrown)).toBe(
      "name=- code=- responseCode=- command=- errno=- syscall=- tlsReason=-",
    );
  });

  it("responseCode ngoài 200–599 hoặc không nguyên ⇒ `-`", () => {
    for (const responseCode of [199, 600, 535.5, "535"]) {
      expect(describeSmtpError(smtpError({ responseCode }))).toContain("responseCode=-");
    }
  });

  it("lỗi lập trình giữ `name` để không ra dòng log vô dụng", () => {
    expect(describeSmtpError(new TypeError("x is not a function"))).toMatch(/^name=TypeError /);
  });
});

describe("isProgrammerError", () => {
  it("TypeError/RangeError/ReferenceError ⇒ true; lỗi SMTP/giá trị thường ⇒ false", () => {
    expect(
      [new TypeError("a"), new RangeError("b"), new ReferenceError("c")].map(isProgrammerError),
    ).toEqual([true, true, true]);
    expect([smtpError({ code: "EAUTH" }), "boom", null].map(isProgrammerError)).toEqual([
      false,
      false,
      false,
    ]);
  });
});

/**
 * S19-SEC-MAILCREDEXFIL-1 — thông điệp trả cho admin ở "Kiểm tra kết nối". Hình dạng lỗi là ĐO THẬT
 * (nodemailer 10.0.12, `docs/plans/S19-SEC-MAILCREDEXFIL-1.md` §2) — kể cả hai ca không chạy được qua dây
 * trong spec (hết thời gian 8 s · DNS cần mạng). `message` mang chuỗi rò: không câu nào được chứa nó.
 */
describe("classifySmtpTestError — câu cố định theo loại lỗi, không byte nào của đầu bên kia", () => {
  it.each([
    [
      "AUTH 535",
      { code: "EAUTH", responseCode: 535, command: "AUTH PLAIN" },
      "Xác thực SMTP thất bại",
    ],
    [
      "hết thời gian (dịch vụ im lặng)",
      { code: "ETIMEDOUT", command: "CONN" },
      "Hết thời gian chờ máy chủ SMTP — kiểm tra máy chủ, cổng và tường lửa.",
    ],
    [
      "DNS không phân giải",
      { code: "EDNS", command: "CONN", errno: errnoOf("ENOTFOUND"), syscall: "getaddrinfo" },
      "Không phân giải được tên máy chủ SMTP.",
    ],
    [
      "cổng đóng",
      { code: "ESOCKET", command: "CONN", errno: ECONNREFUSED_ERRNO, syscall: "connect" },
      "Máy chủ từ chối kết nối — kiểm tra máy chủ và cổng.",
    ],
    [
      "mất kết nối giữa chừng",
      { code: "ESOCKET", command: "CONN", errno: errnoOf("ECONNRESET"), syscall: "read" },
      "Lỗi mạng khi kết nối tới máy chủ SMTP — kiểm tra mạng, máy chủ và cổng.",
    ],
    [
      "không có đường tới host",
      { code: "ESOCKET", command: "CONN", errno: errnoOf("EHOSTUNREACH"), syscall: "connect" },
      "Lỗi mạng khi kết nối tới máy chủ SMTP — kiểm tra mạng, máy chủ và cổng.",
    ],
    [
      // Đo: nodemailer ghi đè mã gốc (DEPTH_ZERO_SELF_SIGNED_CERT) thành ESOCKET, không reason/errno/syscall.
      "chứng chỉ tự ký (ESOCKET trần)",
      { code: "ESOCKET", command: "CONN" },
      "Lỗi TLS/chứng chỉ — kiểm tra tuỳ chọn «Dùng TLS», cổng (465 dùng TLS, 587 dùng STARTTLS) và chứng chỉ máy chủ.",
    ],
    [
      // Đo: reason chứa ':'/'.' (lệch hình dạng log) — phân loại chỉ xét CÓ reason, không đọc nội dung.
      "sai altname",
      { code: "ESOCKET", command: "CONN", reason: "IP: 127.0.0.1 is not in the cert's list: " },
      "Lỗi TLS/chứng chỉ — kiểm tra tuỳ chọn «Dùng TLS», cổng (465 dùng TLS, 587 dùng STARTTLS) và chứng chỉ máy chủ.",
    ],
    [
      "530 ở AUTH (phải STARTTLS trước)",
      { code: "EAUTH", responseCode: 530, command: "AUTH PLAIN" },
      "Máy chủ yêu cầu kết nối mã hoá trước khi đăng nhập — bật «Dùng TLS» hoặc dùng cổng hỗ trợ STARTTLS.",
    ],
    [
      "538 ở AUTH (cơ chế cần mã hoá)",
      { code: "EAUTH", responseCode: 538, command: "AUTH PLAIN" },
      "Máy chủ yêu cầu kết nối mã hoá trước khi đăng nhập — bật «Dùng TLS» hoặc dùng cổng hỗ trợ STARTTLS.",
    ],
    [
      "TLS lệch (OpenSSL reason)",
      { code: "ESOCKET", command: "CONN", reason: "wrong version number", library: "SSL routines" },
      "Lỗi TLS/chứng chỉ — kiểm tra tuỳ chọn «Dùng TLS», cổng (465 dùng TLS, 587 dùng STARTTLS) và chứng chỉ máy chủ.",
    ],
    [
      "relay từ chối HELO 554",
      { code: "EPROTOCOL", responseCode: 554, command: "HELO" },
      "Máy chủ SMTP từ chối (mã 554).",
    ],
    [
      "relay bận 421 ở lời chào",
      { code: "EPROTOCOL", responseCode: 421, command: "CONN" },
      "Máy chủ SMTP từ chối (mã 421).",
    ],
    [
      "banner không phải SMTP",
      { code: "EPROTOCOL", command: "CONN" },
      "Máy chủ không trả lời theo giao thức SMTP — kiểm tra cổng.",
    ],
    ["lỗi lạ không mã", {}, "Kiểm tra kết nối thất bại."],
  ])("%s", (_label, fields, expected) => {
    const out = classifySmtpTestError(smtpError(fields, `leak ${LEAK} internal-db-01:5432`));
    expect(out).toBe(expected);
    expect(out).not.toContain(LEAK);
  });

  it("responseCode ngoài dải SMTP / không phải số nguyên ⇒ KHÔNG in mã (không để trường lạ thành kênh rò)", () => {
    for (const responseCode of [99, 600, 554.5, "554 leak", Number.NaN]) {
      expect(classifySmtpTestError(smtpError({ code: "EPROTOCOL", responseCode }))).toBe(
        "Máy chủ không trả lời theo giao thức SMTP — kiểm tra cổng.",
      );
    }
  });

  it("thứ không phải Error (string/null/object trần) ⇒ câu chung, không ném", () => {
    for (const thrown of [`raw ${LEAK}`, null, undefined, { message: LEAK, code: "EAUTH" }]) {
      const out = classifySmtpTestError(thrown);
      expect(out).not.toContain(LEAK);
    }
    expect(classifySmtpTestError(`raw ${LEAK}`)).toBe("Kiểm tra kết nối thất bại.");
  });
});
