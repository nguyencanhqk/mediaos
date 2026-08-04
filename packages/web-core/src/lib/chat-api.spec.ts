/**
 * chat-api.spec.ts — ranh giới hợp đồng của `chatApi` (S7-CHAT-FE-1).
 *
 * Mock `apiFetch` ở ranh giới `./api-client` (cùng khuôn `me-api.spec.ts`) để kiểm path/method/body,
 * NHƯNG không dừng ở đó: mỗi ca còn chạy **chính schema đã truyền vào `apiFetch`** trên một payload
 * giống thật. Chỉ so URL thì một schema sai vẫn xanh — mà schema sai chính là lớp bug WO này phải chặn
 * (`ZodError` runtime dù HTTP 200).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { chatApi } from "./chat-api";
import * as apiClient from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn() };
});

interface FetchInit {
  method?: string;
  body?: string;
}

function lastCall(): [string, z.ZodType<unknown>, FetchInit | undefined] {
  const calls = vi.mocked(apiClient.apiFetch).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1] as never;
}

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const MSG_ID = "33333333-3333-4333-8333-333333333333";
const COMPANY_ID = "44444444-4444-4444-8444-444444444444";

const ROOM_PAYLOAD = {
  id: ROOM_ID,
  companyId: COMPANY_ID,
  refId: null,
  roomType: "group",
  name: "Phòng Kỹ thuật",
  roomCode: "ROOM-001",
  description: null,
  lastMessageAt: "2026-08-04T01:00:00.000Z",
  lastMessageSeq: 12,
  isArchived: false,
  unreadCount: 3,
  createdAt: "2026-08-01T00:00:00.000Z",
};

const MESSAGE_PAYLOAD = {
  id: MSG_ID,
  companyId: COMPANY_ID,
  roomId: ROOM_ID,
  senderId: USER_ID,
  senderName: "Nguyễn Văn A",
  body: "xin chào",
  messageType: "text",
  fileUrl: null,
  fileName: null,
  mentions: [],
  pinnedAt: null,
  pinnedBy: null,
  replyToMessageId: null,
  recalledAt: null,
  attachmentCount: 0,
  attachments: [],
  roomSeq: 12,
  createdAt: "2026-08-04T01:00:00.000Z",
};

describe("chatApi — path/method", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue(undefined as never);
  });

  it("listRooms() → GET /chat/rooms (không query khi không truyền filter)", async () => {
    await chatApi.listRooms();
    const [url, , init] = lastCall();
    expect(url).toBe("/chat/rooms");
    expect(init).toBeUndefined();
  });

  it("listRooms({type,archived:false}) → serialize `archived=false` (KHÔNG bị nuốt như giá trị rỗng)", async () => {
    await chatApi.listRooms({ type: "direct", archived: false });
    const [url] = lastCall();
    expect(url).toBe("/chat/rooms?type=direct&archived=false");
  });

  it("getMessages() KHÔNG gửi afterSeq/beforeSeq khi caller không truyền", async () => {
    await chatApi.getMessages(ROOM_ID);
    const [url] = lastCall();
    expect(url).toBe(`/chat/rooms/${ROOM_ID}/messages`);
  });

  it("getMessages({afterSeq}) → con trỏ vào query, KHÔNG offset", async () => {
    await chatApi.getMessages(ROOM_ID, { afterSeq: 12 });
    const [url] = lastCall();
    expect(url).toBe(`/chat/rooms/${ROOM_ID}/messages?afterSeq=12`);
    expect(url).not.toMatch(/offset/);
  });

  it("sendMessage() → POST kèm clientMessageId do CALLER cấp (api KHÔNG tự sinh khoá)", async () => {
    const clientMessageId = "55555555-5555-4555-8555-555555555555";
    await chatApi.sendMessage(ROOM_ID, { body: "hi", clientMessageId });
    const [url, , init] = lastCall();
    expect(url).toBe(`/chat/rooms/${ROOM_ID}/messages`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body ?? "{}")).toMatchObject({ clientMessageId });
  });

  it("unpinMessage() → DELETE /chat/messages/:id/pin (KHÔNG phải POST /unpin)", async () => {
    await chatApi.unpinMessage(MSG_ID);
    const [url, , init] = lastCall();
    expect(url).toBe(`/chat/messages/${MSG_ID}/pin`);
    expect(init?.method).toBe("DELETE");
  });

  it("removeMember() → DELETE /chat/rooms/:id/members/:userId", async () => {
    await chatApi.removeMember(ROOM_ID, USER_ID);
    const [url, , init] = lastCall();
    expect(url).toBe(`/chat/rooms/${ROOM_ID}/members/${USER_ID}`);
    expect(init?.method).toBe("DELETE");
  });

  it("markRead() → POST /chat/rooms/:id/read", async () => {
    await chatApi.markRead(ROOM_ID, { seq: 12 });
    const [url, , init] = lastCall();
    expect(url).toBe(`/chat/rooms/${ROOM_ID}/read`);
    expect(init?.method).toBe("POST");
  });
});

/**
 * Điểm danh TOÀN BỘ route — path + method của MỌI hàm, đối chiếu `ChatRoomsController` +
 * `ChatMessagesController`.
 *
 * Không phải bài tập lấp coverage: `chatApi` là bản MIRROR, nên công việc duy nhất của nó là gọi đúng
 * đường. Một chữ sai trong template string (`/leave` → `/left`, `POST` → `PATCH`) không làm typecheck
 * đỏ, không làm lint đỏ, và chỉ lộ ra ở runtime khi có UI bấm vào — tức ở WO khác, của người khác.
 */
describe("chatApi — census path + method của cả 20 route", () => {
  const CASES: Array<[string, () => Promise<unknown>, string, string | undefined]> = [
    ["listRooms", () => chatApi.listRooms(), "/chat/rooms", undefined],
    ["createRoom", () => chatApi.createRoom({ name: "N", roomType: "group", memberUserIds: [] }), "/chat/rooms", "POST"],
    ["openDirect", () => chatApi.openDirect({ peerUserId: USER_ID }), "/chat/rooms/direct", "POST"],
    ["getRoom", () => chatApi.getRoom(ROOM_ID), `/chat/rooms/${ROOM_ID}`, undefined],
    ["updateRoom", () => chatApi.updateRoom(ROOM_ID, { name: "N2" }), `/chat/rooms/${ROOM_ID}`, "PATCH"],
    ["archiveRoom", () => chatApi.archiveRoom(ROOM_ID), `/chat/rooms/${ROOM_ID}/archive`, "POST"],
    ["leaveRoom", () => chatApi.leaveRoom(ROOM_ID), `/chat/rooms/${ROOM_ID}/leave`, "POST"],
    ["listMembers", () => chatApi.listMembers(ROOM_ID), `/chat/rooms/${ROOM_ID}/members`, undefined],
    ["addMember", () => chatApi.addMember(ROOM_ID, { userId: USER_ID, role: "member" }), `/chat/rooms/${ROOM_ID}/members`, "POST"],
    ["updateMember", () => chatApi.updateMember(ROOM_ID, USER_ID, { role: "admin" }), `/chat/rooms/${ROOM_ID}/members/${USER_ID}`, "PATCH"],
    ["removeMember", () => chatApi.removeMember(ROOM_ID, USER_ID), `/chat/rooms/${ROOM_ID}/members/${USER_ID}`, "DELETE"],
    ["getMessages", () => chatApi.getMessages(ROOM_ID), `/chat/rooms/${ROOM_ID}/messages`, undefined],
    ["sendMessage", () => chatApi.sendMessage(ROOM_ID, { body: "x", clientMessageId: USER_ID }), `/chat/rooms/${ROOM_ID}/messages`, "POST"],
    ["getPinned", () => chatApi.getPinned(ROOM_ID), `/chat/rooms/${ROOM_ID}/pinned`, undefined],
    ["markRead", () => chatApi.markRead(ROOM_ID, { seq: 1 }), `/chat/rooms/${ROOM_ID}/read`, "POST"],
    ["getUnreadCount", () => chatApi.getUnreadCount(), "/chat/unread-count", undefined],
    ["recallMessage", () => chatApi.recallMessage(MSG_ID), `/chat/messages/${MSG_ID}/recall`, "POST"],
    ["pinMessage", () => chatApi.pinMessage(MSG_ID), `/chat/messages/${MSG_ID}/pin`, "POST"],
    ["unpinMessage", () => chatApi.unpinMessage(MSG_ID), `/chat/messages/${MSG_ID}/pin`, "DELETE"],
  ];

  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue(undefined as never);
  });

  it.each(CASES)("%s → %s", async (_name, call, expectedUrl, expectedMethod) => {
    await call();
    const [url, schema, init] = lastCall();
    expect(url).toBe(expectedUrl);
    expect(schema).toBeDefined();
    expect(init?.method).toBe(expectedMethod);
  });

  it("KHÔNG mirror CHAT-API-015 (/chat/search) và CHAT-API-017 (/files) — đó là phạm vi S7-CHAT-FE-4", () => {
    expect(chatApi).not.toHaveProperty("search");
    expect(chatApi).not.toHaveProperty("listRoomFiles");
  });

  it("KHÔNG mirror đường ĐỌC-VƯỢT (/chat/oversight/*) — màn quản trị là S7-CHAT-FE-5, có audit riêng", () => {
    for (const key of Object.keys(chatApi)) {
      expect(key.toLowerCase()).not.toContain("oversight");
    }
  });
});

describe("chatApi — schema truyền vào apiFetch phải parse ĐƯỢC payload thật", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue(undefined as never);
  });

  it("listRooms dùng MẢNG TRẦN — payload `{data,meta}` phải TRƯỢT (memory apifetch-drops-pagination-bare-array)", async () => {
    await chatApi.listRooms();
    const [, schema] = lastCall();
    expect(schema.safeParse([ROOM_PAYLOAD]).success).toBe(true);
    expect(schema.safeParse({ data: [ROOM_PAYLOAD], meta: { total: 1 } }).success).toBe(false);
  });

  it("leaveRoom parse bằng schema `{left:true}` — KHÔNG phải chatRoomSchema", async () => {
    await chatApi.leaveRoom(ROOM_ID);
    const [url, schema, init] = lastCall();
    expect(url).toBe(`/chat/rooms/${ROOM_ID}/leave`);
    expect(init?.method).toBe("POST");
    // Đây là ca hỏng đã biết trước: parse `{left:true}` bằng chatRoomSchema sẽ ăn ZodError dù HTTP 200.
    expect(schema.safeParse({ left: true }).success).toBe(true);
    expect(schema.safeParse(ROOM_PAYLOAD).success).toBe(false);
  });

  it("removeMember parse bằng schema `{removed:true}`; `false` phải TRƯỢT (hợp đồng đã trôi thì nổ ở biên)", async () => {
    await chatApi.removeMember(ROOM_ID, USER_ID);
    const [, schema] = lastCall();
    expect(schema.safeParse({ removed: true }).success).toBe(true);
    expect(schema.safeParse({ removed: false }).success).toBe(false);
  });

  it("getMessages chấp nhận tin ĐÃ THU HỒI (`body: null`) — thiếu .nullable() là TRẮNG TRANG dù HTTP 200", async () => {
    await chatApi.getMessages(ROOM_ID);
    const [, schema] = lastCall();
    const recalled = { ...MESSAGE_PAYLOAD, body: null, recalledAt: "2026-08-04T01:05:00.000Z" };
    expect(schema.safeParse([recalled]).success).toBe(true);
  });

  it("getMessages BẮT BUỘC `roomSeq` (con trỏ per-room) và từ chối tin thiếu nó", async () => {
    await chatApi.getMessages(ROOM_ID);
    const [, schema] = lastCall();
    const { roomSeq: _dropped, ...withoutRoomSeq } = MESSAGE_PAYLOAD;
    expect(schema.safeParse([withoutRoomSeq]).success).toBe(false);
  });

  it("listRooms chấp nhận phòng `direct` KHÔNG TÊN (`name: null`) — DM không có tên ở DB", async () => {
    await chatApi.listRooms();
    const [, schema] = lastCall();
    const dm = { ...ROOM_PAYLOAD, roomType: "direct", name: null };
    expect(schema.safeParse([dm]).success).toBe(true);
  });

  it("getRoom parse shape CHI TIẾT (có members + myRole), khác listRooms", async () => {
    await chatApi.getRoom(ROOM_ID);
    const [url, schema] = lastCall();
    expect(url).toBe(`/chat/rooms/${ROOM_ID}`);
    const detail = {
      ...ROOM_PAYLOAD,
      myRole: "admin",
      members: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          roomId: ROOM_ID,
          userId: USER_ID,
          role: "member",
          joinedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    };
    expect(schema.safeParse(detail).success).toBe(true);
    expect(schema.safeParse(ROOM_PAYLOAD).success).toBe(false); // thiếu myRole/members
  });
});
