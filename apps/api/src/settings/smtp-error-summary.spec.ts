/**
 * S19-OPS-AUDITHIGH-1 — `describeSmtpError` là ALLOWLIST: trường máy-sinh khớp hình dạng thì giữ, lệch thì
 * `-`. Các ca "lệch" ở đây là lưới chống một bản nodemailer sau nhét lời văn server vào `code`/`command`
 * (FULL gate typescript-reviewer M1: không có chúng, nới regex thành `/.*\/` vẫn xanh toàn bộ).
 */
import { getSystemErrorMap } from "node:util";
import { describe, expect, it } from "vitest";
import { describeSmtpError, isProgrammerError } from "./smtp-error-summary";

/** Dựng lỗi kiểu nodemailer: Error + các trường mà `_formatError` gắn thêm. */
const smtpError = (fields: Record<string, unknown>, message = "boom"): Error =>
  Object.assign(new Error(message), fields);

/** errno của ECONNREFUSED theo libuv của nền tảng đang chạy (Windows -4078 · Linux -111). */
const ECONNREFUSED_ERRNO = [...getSystemErrorMap()].find(
  ([, [name]]) => name === "ECONNREFUSED",
)?.[0];

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
