/**
 * S19-SEC-MAILAADBIND-1 — `smtpSecretContext`: ngữ cảnh mã hoá envelope mật khẩu SMTP (unit, không DB).
 *
 * Bất biến B1: envelope mở được KHI VÀ CHỈ KHI bộ năm `(id, host, port, username, secure)` của hàng đang đọc
 * GIỐNG HỆT bộ năm lúc mã hoá. Helper là NƠI DUY NHẤT dựng ngữ cảnh đó (B2); các ca dưới ghim hình dạng của
 * nó: bộ năm JSON (host/username không validate ⇒ KHÔNG ký tự phân cách tự chọn), kiểu có nghĩa, CHỈ 4
 * trường đích (không from_* / cột envelope / id của nguồn), luôn mở đầu bằng `[` (không bao giờ trùng recordId
 * UUID trần của TOTP/reset — tách miền).
 */
import { describe, expect, it } from "vitest";
import {
  assertPersistedAsBound,
  MailDestinationNotPersistedError,
  smtpSecretContext,
  type MailDestination,
  type PersistedMailDestination,
} from "./mail-destination";

const COMPANY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ID = "11111111-1111-4111-8111-111111111111";
const DEST: MailDestination = {
  host: "smtp.example.test",
  port: 587,
  username: "mailer@example.test",
  secure: false,
};

/** Ghép bằng ký tự phân cách tự chọn — cách KHÔNG được dùng; đối chứng rằng cặp va chạm dưới là THẬT. */
const pipeJoin = (id: string, d: MailDestination): string =>
  [id, d.host, d.port, d.username, d.secure].join("|");

/** Giả JSON bằng cách ghép nháy — cũng KHÔNG được dùng (chèn `","` vào host/username dời được biên phần tử). */
const quoteJoin = (id: string, d: MailDestination): string =>
  `["${[id, d.host, d.port, d.username, d.secure].join('","')}"]`;

const hasRawControlChar = (s: string): boolean =>
  Array.from(s).some((ch) => ch.charCodeAt(0) < 0x20);

describe("smtpSecretContext — ngữ cảnh mã hoá gắn (id, host, port, username, secure)", () => {
  it("mẫu ⇒ recordId = bộ năm JSON LITERAL · purpose smtp_password · companyId chuyển nguyên", () => {
    expect(smtpSecretContext(COMPANY, ID, DEST)).toEqual({
      companyId: COMPANY,
      recordId:
        '["11111111-1111-4111-8111-111111111111","smtp.example.test",587,"mailer@example.test",false]',
      purpose: "smtp_password",
    });
  });

  it.each([
    ["id", "11111111-1111-4111-8111-111111111112", DEST],
    ["host", ID, { ...DEST, host: "smtp.example.test." }],
    ["port", ID, { ...DEST, port: 588 }],
    ["username", ID, { ...DEST, username: "Mailer@example.test" }],
    ["secure", ID, { ...DEST, secure: true }],
  ] as const)("đổi MỘT trường (%s) ⇒ recordId khác", (_field, id, dest) => {
    expect(smtpSecretContext(COMPANY, id, dest).recordId).not.toBe(
      smtpSecretContext(COMPANY, ID, DEST).recordId,
    );
  });

  it("cặp va chạm của join('|') (host/username không validate) ⇒ hai ngữ cảnh KHÁC nhau", () => {
    const a: MailDestination = {
      host: "evil.test|25|victim",
      port: 26,
      username: "x",
      secure: false,
    };
    const b: MailDestination = {
      host: "evil.test",
      port: 25,
      username: "victim|26|x",
      secure: false,
    };
    // Đối chứng: dưới ký tự phân cách tự chọn hai bộ này là MỘT chuỗi (thiếu dòng này thì ca xanh-rỗng được).
    expect(pipeJoin(ID, a)).toBe(pipeJoin(ID, b));

    expect(smtpSecretContext(COMPANY, ID, a).recordId).not.toBe(
      smtpSecretContext(COMPANY, ID, b).recordId,
    );
  });

  it('chèn `","` vào host/username (giả biên phần tử) ⇒ hai ngữ cảnh KHÁC nhau', () => {
    const a: MailDestination = { host: 'h","587","u', port: 587, username: "v", secure: false };
    const b: MailDestination = { host: "h", port: 587, username: 'u","587","v', secure: false };
    expect(quoteJoin(ID, a)).toBe(quoteJoin(ID, b));

    expect(smtpSecretContext(COMPANY, ID, a).recordId).not.toBe(
      smtpSecretContext(COMPANY, ID, b).recordId,
    );
  });

  it("host/username chứa NUL · xuống dòng · ký tự điều khiển ⇒ recordId KHÔNG có ký tự điều khiển thô (buildAad phân cách bằng NUL)", () => {
    const dest: MailDestination = {
      ...DEST,
      host: `a${String.fromCharCode(0)}b\nc\r`,
      username: `u${String.fromCharCode(0x1f)}v`,
    };
    // Đối chứng: chính đầu vào CÓ ký tự điều khiển thô.
    expect(hasRawControlChar(dest.host) && hasRawControlChar(dest.username)).toBe(true);

    const { recordId } = smtpSecretContext(COMPANY, ID, dest);

    expect(hasRawControlChar(recordId)).toBe(false);
    expect(JSON.parse(recordId)).toEqual([ID, dest.host, dest.port, dest.username, dest.secure]);
  });

  it("nguồn là HÀNG đủ cột (id khác · envelope · from_* · mốc thời gian) ⇒ y hệt nguồn chỉ có 4 trường đích", () => {
    const fullRow = {
      id: "22222222-2222-4222-8222-222222222222",
      companyId: COMPANY,
      scope: "default",
      ...DEST,
      fromName: "Phòng Nhân sự",
      fromEmail: "noreply@example.test",
      secretCiphertext: Buffer.from("aa", "hex"),
      encryptedDek: Buffer.from("bb", "hex"),
      dekKeyVersion: 1,
      kmsKeyId: "local-dev-kek",
      ivNonce: Buffer.alloc(12),
      authTag: Buffer.alloc(16),
      encAlgo: "AES-256-GCM",
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
      updatedAt: new Date("2026-10-02T00:00:00.000Z"),
    };

    expect(smtpSecretContext(COMPANY, ID, fullRow)).toEqual(smtpSecretContext(COMPANY, ID, DEST));
  });

  it("luôn mở đầu bằng `[` — không bao giờ trùng recordId UUID trần của TOTP/reset (tách miền)", () => {
    expect(smtpSecretContext(COMPANY, ID, DEST).recordId.startsWith("[")).toBe(true);
  });
});

/**
 * B4 (owner D4) + FULL gate lượt 1: bộ PG THẬT SỰ lưu (`RETURNING`) phải bằng bộ đã gắn vào ngữ cảnh mã hoá —
 * companyId + id + 4 trường đích. Phân loại lỗi theo AI gây ra: đầu vào người dùng làm lệch được CHỈ host/
 * username (chuỗi tự do — surrogate lẻ ⇒ PG lưu U+FFFD) ⇒ lỗi miền 400 mang TÊN trường; companyId/id/port/secure
 * lệch thì không đầu vào nào gây ra được (uuid app-gen · số nguyên/boolean đã qua Zod) ⇒ lỗi lập trình/hệ thống
 * (500 + stack ở filter), KHÔNG gói thành 400 «ký tự không hợp lệ».
 */
describe("assertPersistedAsBound — B4: bộ PG lưu = bộ đã gắn vào ngữ cảnh mã hoá", () => {
  const BOUND = { companyId: COMPANY, recordId: ID };
  const persisted = (over: Partial<PersistedMailDestination> = {}): PersistedMailDestination => ({
    id: ID,
    companyId: COMPANY,
    ...DEST,
    ...over,
  });
  const thrownBy = (act: () => void): unknown => {
    try {
      act();
    } catch (err) {
      return err;
    }
    return undefined;
  };
  const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);
  const OTHER_ID = "11111111-1111-4111-8111-111111111112";

  it("đối chứng dương: companyId + id + 4 trường đích khớp ⇒ không ném", () => {
    expect(thrownBy(() => assertPersistedAsBound(persisted(), BOUND, DEST))).toBeUndefined();
  });

  it("companyId đã gắn là chữ HOA (PG lưu company_id chữ thường) ⇒ lỗi LẬP TRÌNH (500), không phải lỗi miền 400; message không mang giá trị", () => {
    const upper = COMPANY.toUpperCase();
    expect(upper, "tiền điều kiện: hai dạng phải khác nhau").not.toBe(COMPANY);

    const err = thrownBy(() =>
      assertPersistedAsBound(persisted(), { ...BOUND, companyId: upper }, DEST),
    );

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(MailDestinationNotPersistedError);
    expect((err as Error).message).toMatch(/companyId/);
    expect((err as Error).message.toLowerCase()).not.toContain(COMPANY);
  });

  it("id đã gắn KHÁC id PG lưu ⇒ lỗi LẬP TRÌNH (500), không phải lỗi miền 400", () => {
    const err = thrownBy(() =>
      assertPersistedAsBound(persisted(), { ...BOUND, recordId: OTHER_ID }, DEST),
    );

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(MailDestinationNotPersistedError);
    expect((err as Error).message).toMatch(/recordId/);
  });

  it.each([
    ["port", { port: 588 }, "588"],
    ["secure", { secure: true }, "true"],
    ["port", { host: "smtp.other.test", port: 588 }, "smtp.other.test"],
  ] as const)(
    "PG lưu %s KHÁC giá trị đã gắn (đầu vào đã qua Zod không làm lệch được) ⇒ lỗi hệ thống (500) nêu TÊN trường, KHÔNG 400 «ký tự không hợp lệ»",
    (field, drift, value) => {
      const err = thrownBy(() => assertPersistedAsBound(persisted(drift), BOUND, DEST));

      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(MailDestinationNotPersistedError);
      expect((err as Error).message).toContain(field);
      expect((err as Error).message).not.toContain(value);
    },
  );

  it.each([
    ["host", { host: `a${REPLACEMENT_CHAR}b.test` }, ["host"]],
    ["username", { username: `mailer${REPLACEMENT_CHAR}@example.test` }, ["username"]],
    ["host + username", { host: "h.test", username: "u@h.test" }, ["host", "username"]],
  ] as const)(
    "PG lưu %s KHÁC giá trị đã gắn (surrogate lẻ ⇒ U+FFFD) ⇒ MailDestinationNotPersistedError mang TÊN trường, không giá trị",
    (_label, drift, fields) => {
      const err = thrownBy(() => assertPersistedAsBound(persisted(drift), BOUND, DEST));

      expect(err).toBeInstanceOf(MailDestinationNotPersistedError);
      expect((err as MailDestinationNotPersistedError).changedFields).toEqual(fields);
      for (const value of Object.values(drift)) {
        expect((err as Error).message).not.toContain(String(value));
      }
    },
  );
});
