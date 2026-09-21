import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  decodeFeedCursor,
  encodeFeedCursor,
  fingerprintFeedFilter,
  SOCIAL_CURSOR_FILTER_MISMATCH,
  SOCIAL_CURSOR_INVALID,
} from "./social-feed-cursor";

/**
 * S16-SOCIAL-BE-1 — con trỏ keyset. Hàm THUẦN, không DB.
 *
 * Ba lớp lỗi được đóng đinh ở đây, cả ba đều **im lặng** nếu hỏng (HTTP 200 + trang sai):
 *   1. vòng khứ hồi mất độ chính xác mili-giây;
 *   2. con trỏ của bộ lọc KHÁC được chấp nhận;
 *   3. con trỏ rác rơi về trang đầu thay vì 400.
 */

const FP = fingerprintFeedFilter(["feed", "active"]);
const ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

describe("social-feed-cursor — vòng khứ hồi", () => {
  it("giữ NGUYÊN mốc thời gian tới từng mili-giây", () => {
    const sortAt = new Date("2026-09-21T03:04:05.123Z");
    const round = decodeFeedCursor(encodeFeedCursor({ sortAt, id: ID }, FP), FP);
    expect(round.sortAt.toISOString()).toBe("2026-09-21T03:04:05.123Z");
    expect(round.id).toBe(ID);
  });

  it("mili-giây .000 KHÔNG bị rút gọn mất (bẫy ISO bỏ phần .000)", () => {
    const sortAt = new Date("2026-09-21T03:04:05.000Z");
    const round = decodeFeedCursor(encodeFeedCursor({ sortAt, id: ID }, FP), FP);
    expect(round.sortAt.getTime()).toBe(sortAt.getTime());
  });
});

describe("social-feed-cursor — dấu vân bộ lọc", () => {
  it("bộ lọc KHÁC ⇒ dấu vân KHÁC", () => {
    expect(fingerprintFeedFilter(["feed", "active"])).not.toBe(
      fingerprintFeedFilter(["feed", "latest"]),
    );
  });

  it("undefined và chuỗi rỗng ở CÁC TRƯỜNG KHÁC NHAU không đụng nhau", () => {
    // Nếu nối chuỗi không có dấu phân cách, ["a", undefined] và [undefined, "a"] sẽ trùng nhau.
    expect(fingerprintFeedFilter(["a", undefined])).not.toBe(
      fingerprintFeedFilter([undefined, "a"]),
    );
  });

  it("dấu vân ỔN ĐỊNH giữa hai lần gọi (không phụ thuộc thứ tự chạy/ngẫu nhiên)", () => {
    expect(fingerprintFeedFilter(["feed", "active", "tag"])).toBe(
      fingerprintFeedFilter(["feed", "active", "tag"]),
    );
  });

  it("con trỏ sinh ở bộ lọc A dùng với bộ lọc B ⇒ 400, KHÔNG im lặng trả trang sai", () => {
    const fpA = fingerprintFeedFilter(["feed", "active"]);
    const fpB = fingerprintFeedFilter(["feed", "latest"]);
    const raw = encodeFeedCursor({ sortAt: new Date("2026-09-21T00:00:00.000Z"), id: ID }, fpA);
    expect(() => decodeFeedCursor(raw, fpB)).toThrowError(BadRequestException);
    try {
      decodeFeedCursor(raw, fpB);
    } catch (e) {
      // Thông điệp RIÊNG cho "lệch bộ lọc" — phân biệt được với "con trỏ rác" khi đọc log.
      expect((e as BadRequestException).message).toBe(SOCIAL_CURSOR_FILTER_MISMATCH);
    }
  });
});

describe("social-feed-cursor — đầu vào hỏng đều ra 400", () => {
  const bad: Array<[string, string]> = [
    ["chuỗi rỗng", ""],
    ["không có vế fingerprint", Buffer.from("x|y", "utf8").toString("base64url")],
    ["fingerprint sai định dạng", `${Buffer.from("x|y", "utf8").toString("base64url")}.ZZZ`],
    ["chỉ có dấu chấm", "."],
  ];
  for (const [name, raw] of bad) {
    it(`${name} ⇒ BadRequest`, () => {
      expect(() => decodeFeedCursor(raw, FP)).toThrowError(BadRequestException);
    });
  }

  it("phần khoá hỏng (id không phải UUID) ⇒ 400 với thông điệp CON TRỎ RÁC", () => {
    const payload = Buffer.from("2026-09-21T00:00:00.000Z|not-a-uuid", "utf8").toString(
      "base64url",
    );
    try {
      decodeFeedCursor(`${payload}.${FP}`, FP);
      expect.unreachable("phải ném");
    } catch (e) {
      expect((e as BadRequestException).message).toBe(SOCIAL_CURSOR_INVALID);
    }
  });

  it("ISO thiếu mili-giây ⇒ 400 (vòng khứ hồi phải TRÙNG NGUYÊN VĂN)", () => {
    // `new Date("2026-09-21T00:00:00Z")` hợp lệ, nhưng `.toISOString()` trả về dạng có `.000` ⇒ lệch
    // với khoá đã `date_trunc` ở SQL. Chấp nhận nó là mở lại đúng lỗ sót-hàng.
    const payload = Buffer.from(`2026-09-21T00:00:00Z|${ID}`, "utf8").toString("base64url");
    expect(() => decodeFeedCursor(`${payload}.${FP}`, FP)).toThrowError(BadRequestException);
  });

  it("KHÔNG có nhánh tương thích cho con trỏ KHÔNG fingerprint", () => {
    // Hình dạng "cũ" (chỉ base64 khoá, không có `.fp`) phải bị TỪ CHỐI — một nhánh "thiếu thì bỏ qua
    // kiểm tra" chính là lỗ mà fingerprint bịt, và nó sẽ sống mãi vì không ai dám gỡ.
    const legacy = Buffer.from(`2026-09-21T00:00:00.000Z|${ID}`, "utf8").toString("base64url");
    expect(() => decodeFeedCursor(legacy, FP)).toThrowError(BadRequestException);
  });
});
