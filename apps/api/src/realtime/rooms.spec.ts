import { describe, expect, it } from "vitest";
import {
  callRoomName,
  callUserRoomName,
  chatRoomName,
  chatUserRoomName,
  feedGroupRoomName,
  feedRoomName,
  feedUserRoomName,
  userRoomName,
} from "./rooms";

/**
 * S17-CHAT-RTROOMOPS-1 · B-1 — mọi tên room là CHUẨN TẮC (chữ thường) ngay tại builder.
 *
 * Bất biến: tên room là CHUỖI, còn id là uuid. Postgres so uuid không phân biệt hoa thường, `ParseUUIDPipe`
 * và Zod `uuid()` nhận chữ HOA và trả nguyên văn ⇒ cùng một thực thể có thể tới builder dưới hai dạng. Join
 * (id từ DB/JWT, chữ thường), leave và emit (id từ route/body/khung client) chỉ gặp nhau khi builder ra
 * CÙNG một chuỗi cho cả hai dạng.
 *
 * Bảng đo TỪNG tham số riêng rẽ (chỉ `companyId` · chỉ id · cả hai): chuẩn hoá một nửa (vd quên
 * `companyId`) vẫn để room lệch dạng — một ca «cả hai chữ HOA» không phân biệt được hai hiện thực đó.
 */

/** Mọi hằng có chữ hex a–f ⇒ `.toUpperCase()` ĐỔI chuỗi (ca chữ HOA không xanh-rỗng). */
const COMPANY = "c0000000-0000-4000-8000-00000000000a";
const OTHER_COMPANY = "c0000000-0000-4000-8000-00000000000b";
const ID = "6b1f0c2e-9d3a-4e5f-8a7b-c0d1e2f3a4b5";

type Builder2 = (companyId: string, id: string) => string;

/** [tên, builder, đoạn giữa của tên room] — chuỗi kỳ vọng viết TAY, không suy từ builder. */
const TWO_ARG: readonly [string, Builder2, string][] = [
  ["userRoomName", userRoomName, "user"],
  ["chatRoomName", chatRoomName, "chatroom"],
  ["chatUserRoomName", chatUserRoomName, "chatuser"],
  ["callUserRoomName", callUserRoomName, "calluser"],
  ["callRoomName", callRoomName, "call"],
  ["feedUserRoomName", feedUserRoomName, "feeduser"],
  ["feedGroupRoomName", feedGroupRoomName, "feedgroup"],
];

const up = (s: string): string => s.toUpperCase();

describe("rooms.ts — tên room chuẩn tắc ở builder (S17-CHAT-RTROOMOPS-1 · B-1)", () => {
  it("⚓ hằng của bảng thật sự đổi khi viết HOA (chống xanh-rỗng)", () => {
    for (const s of [COMPANY, OTHER_COMPANY, ID]) expect(up(s)).not.toBe(s);
  });

  describe.each(TWO_ARG)("%s", (_name, build, segment) => {
    const canonical = `co:${COMPANY}:${segment}:${ID}`;

    it("đầu vào đã chữ thường ⇒ ra NGUYÊN VĂN (đường JWT/DB không đổi hành vi)", () => {
      expect(build(COMPANY, ID)).toBe(canonical);
    });

    it("🔒 chỉ `companyId` chữ HOA ⇒ cùng tên room chuẩn tắc", () => {
      expect(build(up(COMPANY), ID)).toBe(canonical);
    });

    it("🔒 chỉ id chữ HOA ⇒ cùng tên room chuẩn tắc", () => {
      expect(build(COMPANY, up(ID))).toBe(canonical);
    });

    it("🔒 cả hai chữ HOA ⇒ cùng tên room chuẩn tắc", () => {
      expect(build(up(COMPANY), up(ID))).toBe(canonical);
    });

    it("tiền tố tenant giữ nguyên · hai công ty KHÔNG BAO GIỜ chung tên room", () => {
      expect(build(up(COMPANY), ID).startsWith(`co:${COMPANY}:`)).toBe(true);
      expect(build(COMPANY, ID)).not.toBe(build(OTHER_COMPANY, ID));
      expect(build(up(COMPANY), up(ID))).not.toBe(build(up(OTHER_COMPANY), up(ID)));
    });
  });

  describe("feedRoomName (chỉ `companyId`)", () => {
    it("chữ thường ⇒ nguyên văn · chữ HOA ⇒ cùng tên room chuẩn tắc · tenant tách", () => {
      expect(feedRoomName(COMPANY)).toBe(`co:${COMPANY}:feed`);
      expect(feedRoomName(up(COMPANY))).toBe(`co:${COMPANY}:feed`);
      expect(feedRoomName(COMPANY)).not.toBe(feedRoomName(OTHER_COMPANY));
    });
  });

  it("hàm TOÀN PHẦN: caller JS vi phạm kiểu (id vắng) KHÔNG làm builder ném — caller có thể đang ở trong tx", () => {
    // Builder được tính NGOÀI `try` ở `syncRoomMembership`/`evictFromCallRoom`; ném ở đây là rollback thao tác
    // gỡ thành viên đã đúng. Chuỗi ra y hệt template literal trước khi chuẩn hoá.
    expect(() => chatRoomName(COMPANY, undefined as never)).not.toThrow();
    expect(callUserRoomName(COMPANY, undefined as never)).toBe(`co:${COMPANY}:calluser:undefined`);
  });

  it("các room khác loại của CÙNG một id không bao giờ trùng tên (chuẩn hoá không làm sập không gian tên)", () => {
    const names = new Set([
      ...TWO_ARG.map(([, build]) => build(up(COMPANY), up(ID))),
      feedRoomName(up(COMPANY)),
    ]);
    expect(names.size).toBe(TWO_ARG.length + 1);
  });
});
