import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  decodeOversightAuditCursor,
  encodeOversightAuditCursor,
  fingerprintAuditFilter,
} from "./chat-oversight-audit-cursor";
import type { ChatOversightAuditFilter } from "./chat-oversight-audit-filter";
import { encodeChatSearchCursor } from "./chat-search-cursor";
import { CHAT_ERR } from "./chat.errors";

/**
 * S7-CHAT-BE-9 🔒 — con trỏ của CHAT-API-019 phải MANG dấu vân bộ lọc.
 *
 * Ca sống-còn của file này là `[crown] con trỏ của bộ lọc KHÁC ⇒ 400`: không có nó, server trả 200 kèm
 * một trang cắt theo tập kết quả khác — sai một cách im lặng, trên đúng màn hình dùng để đếm bằng chứng.
 */
const KEYSET = {
  sortAt: new Date("2026-08-04T03:00:00.123Z"),
  id: "77777777-7777-4777-8777-777777777777",
};
const ACTOR_A = "22222222-2222-4222-8222-222222222222";
const ACTOR_B = "99999999-9999-4999-8999-999999999999";

const NO_FILTER: ChatOversightAuditFilter = {};
const FILTER_A: ChatOversightAuditFilter = { actorUserId: ACTOR_A };
const FILTER_B: ChatOversightAuditFilter = { actorUserId: ACTOR_B };

function expectChatError(fn: () => unknown, message: string): void {
  expect(fn).toThrow(BadRequestException);
  try {
    fn();
  } catch (err) {
    expect((err as BadRequestException).message).toBe(message);
  }
}

describe("fingerprintAuditFilter", () => {
  it("ổn định giữa các lần gọi (con trỏ trang trước còn dùng được ở trang sau)", () => {
    expect(fingerprintAuditFilter(FILTER_A)).toBe(fingerprintAuditFilter(FILTER_A));
  });

  it("hai bộ lọc khác nhau ⇒ dấu vân khác nhau", () => {
    expect(fingerprintAuditFilter(FILTER_A)).not.toBe(fingerprintAuditFilter(FILTER_B));
    expect(fingerprintAuditFilter(NO_FILTER)).not.toBe(fingerprintAuditFilter(FILTER_A));
  });

  it("[crown] dấu vân tính trên INSTANT — đổi TZ công ty giữa hai trang làm con trỏ hết hiệu lực", () => {
    // Cùng ngày `2026-08-04` nhưng quy đổi ở hai TZ ⇒ hai cửa sổ khác nhau ⇒ phải là hai dấu vân.
    const vn = fingerprintAuditFilter({ fromInstant: new Date("2026-08-03T17:00:00.000Z") });
    const utc = fingerprintAuditFilter({ fromInstant: new Date("2026-08-04T00:00:00.000Z") });
    expect(vn).not.toBe(utc);
  });

  it("không nhầm giữa `from` và `to` (phân tách trường, không nối trần)", () => {
    const at = new Date("2026-08-04T00:00:00.000Z");
    expect(fingerprintAuditFilter({ fromInstant: at })).not.toBe(
      fingerprintAuditFilter({ toInstantExclusive: at }),
    );
  });
});

describe("encode/decodeOversightAuditCursor", () => {
  it("vòng khứ hồi giữ nguyên `(sortAt, id)` khi bộ lọc không đổi", () => {
    const raw = encodeOversightAuditCursor(KEYSET, FILTER_A);
    const back = decodeOversightAuditCursor(raw, FILTER_A);
    expect(back.id).toBe(KEYSET.id);
    expect(back.sortAt.toISOString()).toBe(KEYSET.sortAt.toISOString());
  });

  it("có vế fingerprint NGAY CẢ khi không lọc gì — hình dạng con trỏ chỉ có MỘT", () => {
    const raw = encodeOversightAuditCursor(KEYSET, NO_FILTER);
    expect(raw).toContain(".");
    expect(decodeOversightAuditCursor(raw, NO_FILTER).id).toBe(KEYSET.id);
  });

  it("[crown] con trỏ sinh ở bộ lọc A dùng lại với bộ lọc B ⇒ 400, KHÔNG trả sai trang", () => {
    const raw = encodeOversightAuditCursor(KEYSET, FILTER_A);
    expectChatError(
      () => decodeOversightAuditCursor(raw, FILTER_B),
      CHAT_ERR.OVERSIGHT_CURSOR_FILTER_MISMATCH,
    );
  });

  it("[crown] con trỏ KHÔNG có fingerprint (hình dạng cũ / tự chế) ⇒ 400, không có nhánh 'bỏ qua kiểm tra'", () => {
    const legacy = encodeChatSearchCursor(KEYSET);
    expectChatError(
      () => decodeOversightAuditCursor(legacy, NO_FILTER),
      CHAT_ERR.SEARCH_CURSOR_INVALID,
    );
  });

  it("fingerprint sai định dạng (không phải 16 hex) ⇒ 400", () => {
    const raw = `${encodeChatSearchCursor(KEYSET)}.khong-phai-hex`;
    expectChatError(
      () => decodeOversightAuditCursor(raw, NO_FILTER),
      CHAT_ERR.SEARCH_CURSOR_INVALID,
    );
  });

  it("phần khoá hỏng nhưng fingerprint đúng ⇒ vẫn 400 (codec dùng chung vẫn validate)", () => {
    const raw = `khong-phai-base64-hop-le.${fingerprintAuditFilter(NO_FILTER)}`;
    expectChatError(
      () => decodeOversightAuditCursor(raw, NO_FILTER),
      CHAT_ERR.SEARCH_CURSOR_INVALID,
    );
  });

  it("chuỗi rác không có dấu phân tách ⇒ 400", () => {
    expectChatError(
      () => decodeOversightAuditCursor("rac-khong-hop-le", NO_FILTER),
      CHAT_ERR.SEARCH_CURSOR_INVALID,
    );
  });

  it("chuỗi rỗng và chuỗi bắt đầu bằng dấu phân tách ⇒ 400 (không rơi vào nhánh 'khoá rỗng')", () => {
    expectChatError(
      () => decodeOversightAuditCursor("", NO_FILTER),
      CHAT_ERR.SEARCH_CURSOR_INVALID,
    );
    expectChatError(
      () => decodeOversightAuditCursor(`.${fingerprintAuditFilter(NO_FILTER)}`, NO_FILTER),
      CHAT_ERR.SEARCH_CURSOR_INVALID,
    );
  });
});
