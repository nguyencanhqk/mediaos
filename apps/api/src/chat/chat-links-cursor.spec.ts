import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  decodeChatRoomLinksCursor,
  encodeChatRoomLinksCursor,
  fingerprintChatRoom,
} from "./chat-links-cursor";
import { CHAT_ERR } from "./chat.errors";

/**
 * S17-CHAT-UX2-BE-2 🔒 — con trỏ của `CHAT-API-031` phải MANG dấu vân phòng.
 *
 * Vì sao đây là ca test chứ không phải một dòng comment: `room_seq` là per-room (mig `0539`), nên con
 * trỏ của phòng A dùng ở phòng B là **hợp cú pháp**. Không có vế đối chiếu, server trả 200 kèm một
 * trang cắt theo mốc của phòng khác — sai mà không có tín hiệu nào.
 */

const ROOM_A = "33333333-3333-4333-8333-333333333333";
const ROOM_B = "44444444-4444-4444-8444-444444444444";

describe("fingerprintChatRoom", () => {
  it("ổn định + phân biệt được hai phòng", () => {
    expect(fingerprintChatRoom(ROOM_A)).toBe(fingerprintChatRoom(ROOM_A));
    expect(fingerprintChatRoom(ROOM_A)).not.toBe(fingerprintChatRoom(ROOM_B));
  });

  it("đúng 16 hex — hình dạng con trỏ chỉ có MỘT", () => {
    expect(fingerprintChatRoom(ROOM_A)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("vòng khứ hồi", () => {
  it.each([
    [7, 0],
    [7, 3],
    [1, -1],
    [999999, -1],
  ])("roomSeq=%i linkIndex=%i giữ nguyên qua encode→decode", (roomSeq, linkIndex) => {
    const raw = encodeChatRoomLinksCursor({ roomSeq, linkIndex }, ROOM_A);
    expect(decodeChatRoomLinksCursor(raw, ROOM_A)).toEqual({ roomSeq, linkIndex });
  });

  it("con trỏ là opaque — không lộ `room_seq` dạng đọc được", () => {
    // Không phải cơ chế bảo mật (con trỏ chỉ chứa số người gọi đã thấy), mà để client KHÔNG tự chế
    // rồi phụ thuộc vào hình dạng nội bộ.
    expect(encodeChatRoomLinksCursor({ roomSeq: 42, linkIndex: 1 }, ROOM_A)).not.toContain("42");
  });
});

describe("[crown] đối chiếu vân — con trỏ của phòng KHÁC bị chặn", () => {
  it("dùng con trỏ phòng A ở phòng B ⇒ 400 CHAT-ERR-016 (thông điệp RIÊNG)", () => {
    const raw = encodeChatRoomLinksCursor({ roomSeq: 7, linkIndex: 0 }, ROOM_A);
    expect(() => decodeChatRoomLinksCursor(raw, ROOM_B)).toThrow(BadRequestException);
    try {
      decodeChatRoomLinksCursor(raw, ROOM_B);
    } catch (e) {
      expect((e as BadRequestException).message).toBe(CHAT_ERR.LINKS_CURSOR_ROOM_MISMATCH);
    }
  });

  it("con trỏ KHÔNG có vế vân (hình dạng cũ / tự chế) ⇒ 400, KHÔNG có nhánh 'bỏ qua kiểm tra'", () => {
    // Một nhánh "thiếu vân thì bỏ qua" chính là lỗ mà vân dựng ra để bịt, và nó sẽ sống mãi vì không
    // ai dám gỡ. `CHAT-API-031` là route MỚI ⇒ không có con trỏ cũ nào đang lưu hành.
    const keyOnly = Buffer.from("7|0", "utf8").toString("base64url");
    expect(() => decodeChatRoomLinksCursor(keyOnly, ROOM_A)).toThrow(BadRequestException);
  });

  it("vân sai định dạng (không phải 16 hex) ⇒ 400", () => {
    const key = Buffer.from("7|0", "utf8").toString("base64url");
    expect(() => decodeChatRoomLinksCursor(`${key}.khongphaihex`, ROOM_A)).toThrow(
      BadRequestException,
    );
  });
});

describe("phần khoá hỏng ⇒ 400, không đoán, không rơi về trang đầu", () => {
  const fp = fingerprintChatRoom(ROOM_A);
  const withFp = (payload: string): string =>
    `${Buffer.from(payload, "utf8").toString("base64url")}.${fp}`;

  it.each([
    ["thiếu vế phân tách", "70"],
    ["roomSeq không phải số", "abc|0"],
    ["roomSeq = 0 (room_seq liên tục từ 1)", "0|0"],
    ["roomSeq âm", "-3|0"],
    ["linkIndex không phải số", "7|xyz"],
    ["linkIndex < -1 (chỉ -1 là mốc 'trọn tin')", "7|-2"],
    ["rác đuôi kiểu parseInt nuốt được", "7abc|0"],
    ["số thực", "7.5|0"],
  ])("%s ⇒ 400", (_label, payload) => {
    expect(() => decodeChatRoomLinksCursor(withFp(payload), ROOM_A)).toThrow(BadRequestException);
  });

  it("chuỗi rỗng / chỉ có vân ⇒ 400", () => {
    expect(() => decodeChatRoomLinksCursor(`.${fp}`, ROOM_A)).toThrow(BadRequestException);
  });

  it("mã lỗi của khoá hỏng là LINKS_CURSOR_INVALID, KHÔNG phải mã của /chat/search", () => {
    // Hằng riêng cho mỗi trục con trỏ: dùng lại `SEARCH_CURSOR_INVALID` là chỉ sai chỗ cho người đi sửa.
    try {
      decodeChatRoomLinksCursor(withFp("abc|0"), ROOM_A);
      expect.unreachable("phải ném");
    } catch (e) {
      expect((e as BadRequestException).message).toBe(CHAT_ERR.LINKS_CURSOR_INVALID);
      expect((e as BadRequestException).message).not.toBe(CHAT_ERR.SEARCH_CURSOR_INVALID);
    }
  });
});
