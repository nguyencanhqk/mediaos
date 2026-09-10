import { describe, expect, it } from "vitest";
import {
  chatOversightRoomDetailSchema,
  chatOversightRoomSummarySchema,
  chatRoomDetailSchema,
  chatRoomLastMessageSchema,
  chatRoomPeerSchema,
  chatRoomSchema,
  listChatRoomFilesQuerySchema,
} from "./chat";
import { wsChatRoomEventSchema } from "./realtime";

/**
 * S17-CHAT-UX2-BE-1 — hợp đồng ba khoá DTO mới (CHAT-DEC-022/023/025 · SPEC-15 §15b · API-13 §5.1d).
 *
 * Ba nhóm ca, mỗi nhóm khoá một lỗ ĐÃ TỪNG mở ở wave trước:
 *   1. khoá mới KHÔNG được required — `/chat/rooms` có 7 consumer đang chạy;
 *   2. `peer.avatarUrl` KHÔNG được lọt ra payload WS — `.omit()` không với tới khoá LỒNG;
 *   3. `lastMessage`/`peer` KHÔNG được xuất hiện ở schema oversight.
 */

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const PEER_ID = "44444444-4444-4444-8444-444444444444";

/** Payload phòng đúng như server TRƯỚC WO này trả — không có khoá nào của S17. */
const legacyRoom = {
  id: ROOM_ID,
  companyId: COMPANY_ID,
  refId: null,
  roomType: "direct" as const,
  name: null,
  roomCode: "R-0001",
  description: null,
  lastMessageAt: "2026-09-09T03:00:00.000Z",
  lastMessageSeq: 7,
  isArchived: false,
  unreadCount: 2,
  createdAt: "2026-09-01T03:00:00.000Z",
  pinnedAt: null,
  mutedUntil: null,
  markedUnreadAt: null,
  avatarUrl: null,
};

describe("chatRoomSchema — 3 khoá S17 là bổ sung TƯƠNG THÍCH NGƯỢC", () => {
  it("parse payload CŨ (không có lastMessage/peer) vẫn qua", () => {
    // Ratchet chống lặp lại S7-SEC-ROLE2FA-UI-1: một khoá required mới ở đây làm 7 consumer đang chạy
    // ăn ZodError DÙ HTTP 200 — trắng trang, không phải "thiếu một dòng preview"
    // (memory `server-masking-needs-optional-fe-schema`).
    const parsed = chatRoomSchema.parse(legacyRoom);
    expect(parsed.lastMessage).toBeUndefined();
    expect(parsed.peer).toBeUndefined();
  });

  it("`null` tường minh cũng hợp lệ — phòng chưa có tin / phòng nhóm", () => {
    const parsed = chatRoomSchema.parse({ ...legacyRoom, lastMessage: null, peer: null });
    expect(parsed.lastMessage).toBeNull();
    expect(parsed.peer).toBeNull();
  });

  it("payload ĐẦY ĐỦ parse ra đúng hình dạng CHAT-DEC-022/023", () => {
    const parsed = chatRoomSchema.parse({
      ...legacyRoom,
      lastMessage: {
        senderId: USER_ID,
        senderName: "Đỗ Tiến Bắc",
        kind: "text",
        excerpt: "Cái này triển khai xong chưa?",
        attachmentCount: 2,
      },
      peer: { userId: PEER_ID, name: "Nguyễn An", avatarUrl: "https://x/y", isActive: true },
    });
    // `kind:'text'` THẮNG khi tin có cả chữ lẫn tệp, và `attachmentCount` VẪN > 0 trong cùng bản ghi:
    // hai trường KHÔNG loại trừ nhau (API-13 §5.1d(1)).
    expect(parsed.lastMessage).toMatchObject({ kind: "text", attachmentCount: 2 });
    expect(parsed.peer?.avatarUrl).toBe("https://x/y");
  });

  it("`chatRoomDetailSchema.createdByName` cũng KHÔNG required", () => {
    const detail = chatRoomDetailSchema.parse({ ...legacyRoom, members: [], myRole: "member" });
    expect(detail.createdByName).toBeUndefined();
  });

  it("`kind` của lastMessage bị khoá đúng 4 giá trị", () => {
    for (const kind of ["text", "file", "system", "recalled"]) {
      expect(() =>
        chatRoomLastMessageSchema.parse({
          senderId: USER_ID,
          senderName: null,
          kind,
          excerpt: null,
          attachmentCount: 0,
        }),
      ).not.toThrow();
    }
    expect(() =>
      chatRoomLastMessageSchema.parse({
        senderId: USER_ID,
        senderName: null,
        kind: "deleted",
        excerpt: null,
        attachmentCount: 0,
      }),
    ).toThrow();
  });
});

describe("wsChatRoomEventSchema — payload WS HẸP HƠN DTO REST", () => {
  const roomWithPeer = {
    ...legacyRoom,
    peer: { userId: PEER_ID, name: "Nguyễn An", avatarUrl: "https://signed/url", isActive: true },
    lastMessage: {
      senderId: USER_ID,
      senderName: "Nguyễn An",
      kind: "text" as const,
      excerpt: "xin chào",
      attachmentCount: 0,
    },
  };

  it("CA ÂM — `peer.avatarUrl` KHÔNG có mặt trong kết quả parse", () => {
    // `.omit()` của Zod KHÔNG với tới khoá LỒNG (không có cú pháp `.omit({'peer.avatarUrl': true})`).
    // Thêm khoá lồng mới vào `chatRoomSchema` mà quên `.extend()` bản đã strip ở schema WS ⇒ ca này ĐỎ.
    // Không có ca âm thì luật strip trôi ở wave sau (memory `ws-payload-narrower-than-rest-dto`).
    const parsed = wsChatRoomEventSchema.parse({
      roomId: ROOM_ID,
      action: "updated",
      room: roomWithPeer,
    });
    expect(parsed.room?.peer).toBeDefined();
    expect(parsed.room?.peer).not.toHaveProperty("avatarUrl");
    expect(Object.keys(parsed.room?.peer ?? {}).sort()).toEqual(["isActive", "name", "userId"]);
  });

  it("`lastMessage` ĐI QUA nguyên vẹn — đã che + đã cắt ở server, không phải URL ký", () => {
    const parsed = wsChatRoomEventSchema.parse({
      roomId: ROOM_ID,
      action: "updated",
      room: roomWithPeer,
    });
    expect(parsed.room?.lastMessage).toEqual(roomWithPeer.lastMessage);
  });

  it("4 khoá per-member + `avatarUrl` cấp phòng VẪN bị strip (ratchet S8 không bị nới)", () => {
    const parsed = wsChatRoomEventSchema.parse({
      roomId: ROOM_ID,
      action: "updated",
      room: { ...roomWithPeer, avatarUrl: "https://room/avatar" },
    });
    for (const key of ["unreadCount", "pinnedAt", "mutedUntil", "markedUnreadAt", "avatarUrl"]) {
      expect(parsed.room).not.toHaveProperty(key);
    }
  });
});

describe("ranh giới oversight — `lastMessage`/`peer` KHÔNG rò sang đường đọc-vượt", () => {
  // BLOCKING 2 của API-13 §5.1d(4): `chatOversightRoomSummarySchema` là schema ĐỘC LẬP có chủ ý. Một WO
  // sau "dọn trùng lặp" cho nó `.extend()` từ `chatRoomSchema` sẽ biến CẢ 018a LẪN 018b thành cổng xem
  // trước nội dung tin + đồ thị DM toàn công ty. Ca này làm việc đó thành ĐỎ tự động.
  for (const [name, schema] of [
    ["chatOversightRoomSummarySchema", chatOversightRoomSummarySchema],
    ["chatOversightRoomDetailSchema", chatOversightRoomDetailSchema],
  ] as const) {
    it(`${name} KHÔNG có khoá lastMessage/peer/directKey/unreadCount`, () => {
      const keys = Object.keys(schema.shape);
      for (const forbidden of ["lastMessage", "peer", "directKey", "unreadCount"]) {
        expect(keys, `${name} đã thừa hưởng khoá cấm '${forbidden}'`).not.toContain(forbidden);
      }
    });
  }
});

describe("listChatRoomFilesQuerySchema — tham số `kind` (SPEC-15 §15b)", () => {
  it("VẮNG MẶT ⇒ undefined, giữ nguyên hành vi CHAT-API-017 cũ (trả toàn bộ tệp)", () => {
    expect(listChatRoomFilesQuerySchema.parse({}).kind).toBeUndefined();
  });

  it("chấp nhận đúng `image` và `file`", () => {
    expect(listChatRoomFilesQuerySchema.parse({ kind: "image" }).kind).toBe("image");
    expect(listChatRoomFilesQuerySchema.parse({ kind: "file" }).kind).toBe("file");
  });

  it("giá trị lạ ⇒ ném (⇒ 400 VALIDATION-ERR-001 ở biên HTTP, KHÔNG 422)", () => {
    // 422 chỉ dành cho vi phạm rule NGHIỆP VỤ (API-01); sai tập giá trị là lỗi format.
    expect(() => listChatRoomFilesQuerySchema.parse({ kind: "video" })).toThrow();
    expect(() => listChatRoomFilesQuerySchema.parse({ kind: "" })).toThrow();
  });

  it("`chatRoomPeerSchema` KHÔNG mang khoá nào ngoài 4 khoá đã chốt", () => {
    // Khoá thứ 5 lọt vào đây là một quyết định phải giải trình: mọi khoá của `peer` đi thẳng ra danh
    // sách phòng của MỌI người có DM với người đó.
    expect(Object.keys(chatRoomPeerSchema.shape).sort()).toEqual([
      "avatarUrl",
      "isActive",
      "name",
      "userId",
    ]);
  });
});
