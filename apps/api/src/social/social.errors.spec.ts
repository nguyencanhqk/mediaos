import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { SOCIAL_ERROR_CODES, isSocialErrorCode } from "@mediaos/contracts";
import { describe, expect, it } from "vitest";
import { SOCIAL_ERR, socialError } from "./social.errors";

/**
 * S16-SOCIAL-GROUPERR-1 — hợp đồng «mã lỗi SOCIAL lên `error.code`» (plan §3 U1–U7).
 *
 * Ghim hai thứ mà census 2 tầng KHÔNG đo: (a) mỗi hằng `SOCIAL_ERR` có ĐÚNG một mã ở contracts và mã
 * khớp tiền tố thông điệp; (b) `socialError()` đưa mã vào payload theo cách `AllExceptionsFilter` đọc.
 */

const keys = Object.keys(SOCIAL_ERR) as Array<keyof typeof SOCIAL_ERR>;
const NUMBERED_PREFIX = /^(SOCIAL-ERR-\d{3}): /;
const SENTINEL_CODE = /^SOCIAL-ERR-[A-Z]+(-[A-Z]+)+$/;

describe("S16-SOCIAL-GROUPERR-1 · mã lỗi SOCIAL", () => {
  it("U1 — tập khoá SOCIAL_ERR ≡ tập khoá SOCIAL_ERROR_CODES (hai chiều)", () => {
    expect([...keys].sort()).toEqual(Object.keys(SOCIAL_ERROR_CODES).sort());
    expect(keys.length, "neo dương: bảng không rỗng").toBeGreaterThan(50);
  });

  it("U2 — thông điệp đôi một KHÁC nhau (điều kiện để tra mã theo thông điệp)", () => {
    const messages = keys.map((k) => SOCIAL_ERR[k]);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it.each(keys.map((k) => [k] as const))("U3/U4 — %s: tiền tố thông điệp khớp loại mã", (key) => {
    const message = SOCIAL_ERR[key];
    const code = SOCIAL_ERROR_CODES[key];
    const numbered = NUMBERED_PREFIX.exec(message);
    if (numbered) {
      // U3 — khoá có số: tiền tố message CHÍNH LÀ mã (FE cũ đọc tiền tố vẫn đúng khi BE lên trước).
      expect(code).toBe(numbered[1]);
      return;
    }
    // U4 — khoá sentinel: message KHÔNG mang số (không nói dối mã), mã là sentinel có tên.
    expect(message.startsWith("SOCIAL-ERR: "), `${key}: message phải bắt đầu "SOCIAL-ERR: "`).toBe(
      true,
    );
    expect(code).toMatch(SENTINEL_CODE);
    expect(code).not.toMatch(/SOCIAL-ERR-\d{3}/);
  });

  it("U5 — mã có số ∈ catalog SPEC-16 §12 (001..022), KHÔNG số nào ngoài catalog", () => {
    const numbered = Object.values(SOCIAL_ERROR_CODES).filter((c) => /^SOCIAL-ERR-\d{3}$/.test(c));
    for (const c of numbered) {
      const n = Number(c.slice(-3));
      expect(n >= 1 && n <= 22, `${c} nằm ngoài SPEC-16 §12`).toBe(true);
    }
    expect(new Set(numbered).size, "đủ 22 mã của §12").toBe(22);
  });

  it.each(keys.map((k) => [k] as const))(
    "U6 — socialError(SOCIAL_ERR.%s) trả đúng {code, message}",
    (key) => {
      const body = socialError(SOCIAL_ERR[key]);
      expect(body).toEqual({ code: SOCIAL_ERROR_CODES[key], message: SOCIAL_ERR[key] });
      expect(isSocialErrorCode(body.code)).toBe(true);
    },
  );

  it("U6b — mỗi lời gọi trả object MỚI (không chia sẻ tham chiếu giữa các lần ném)", () => {
    const a = socialError(SOCIAL_ERR.GROUP_NOT_FOUND);
    const b = socialError(SOCIAL_ERR.GROUP_NOT_FOUND);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("U6c — chuỗi ngoài bảng (chỉ tới được khi ép kiểu) ⇒ ném Error, KHÔNG rơi về mã chung im lặng", () => {
    expect(() => socialError("SOCIAL-ERR: không có trong bảng" as never)).toThrow(Error);
  });

  it.each([
    [NotFoundException, SOCIAL_ERR.GROUP_NOT_FOUND, "SOCIAL-ERR-012"],
    [ForbiddenException, SOCIAL_ERR.GROUP_ROLE_REQUIRED, "SOCIAL-ERR-014"],
    [ConflictException, SOCIAL_ERR.GROUP_NAME_TAKEN, "SOCIAL-ERR-GROUP-NAME-TAKEN"],
    [UnprocessableEntityException, SOCIAL_ERR.REPLY_DEPTH, "SOCIAL-ERR-005"],
  ] as const)(
    "U7 — new %o(socialError(...)) ⇒ getResponse().code + .message là thứ filter đọc",
    (Ex, message, code) => {
      const e = new Ex(socialError(message));
      // Neo hành vi NestJS 11.1.24: object response đi nguyên vẹn; `.message` lấy từ `response.message`.
      expect(e.message).toBe(message);
      expect(e.getResponse()).toMatchObject({ code, message });
    },
  );
});
