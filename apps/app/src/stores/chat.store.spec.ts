/**
 * chat.store.spec.ts — store CHAT (S7-CHAT-FE-1 §1.7).
 *
 * Colocated trong `src/**` CÓ CHỦ ĐÍCH: `apps/app/vitest.config.ts` chỉ `include: ["src/**\/*.spec.{ts,tsx}"]`
 * — đặt spec ở `apps/app/test/` là KHÔNG CHẠY, tức xanh-giả (memory `vitest-unit-specs-must-be-colocated`).
 *
 * Schema THẬT import từ `@mediaos/contracts`, KHÔNG dựng bản sao — bản sao yếu hơn bản thật (mất kiểm
 * enum `action`) và đóng đinh một hợp đồng không ai dùng. Ca đối chứng "nếu thiếu `.nullable()` thì sao"
 * dùng schema CLONE cục bộ, tuyệt đối KHÔNG tạm sửa file nguồn dùng chung với WO khác.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "@mediaos/web-core";
import {
  chatMessageSchema,
  wsChatMessageEventSchema,
  wsChatMessageRecalledEventSchema,
  wsChatRoomEventSchema,
  type ChatMessageDto,
  type ChatRoomDto,
} from "@mediaos/contracts";
import {
  CHAT_POLL_INTERVAL_MS,
  MAX_MESSAGES_PER_ROOM,
  attachmentUrl,
  createClientMessageId,
  useChatStore,
  type StoredChatMessage,
} from "./chat.store";

const getMessages = vi.fn<(roomId: string, q?: unknown) => Promise<ChatMessageDto[]>>();
vi.mock("@mediaos/web-core", async (importOriginal) => {
  // Giữ module THẬT (cần `ApiError` để dựng lỗi đúng kiểu mà `apiFetch` ném) — chỉ stub tầng mạng.
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    chatApi: { getMessages: (roomId: string, q?: unknown) => getMessages(roomId, q) },
  };
});

const ROOM_A = "11111111-1111-4111-8111-111111111111";
const ROOM_B = "22222222-2222-4222-8222-222222222222";
const ROOM_C = "33333333-3333-4333-8333-333333333333";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COMPANY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function room(id: string, over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id,
    companyId: COMPANY,
    refId: null,
    roomType: "group",
    name: `Phòng ${id.slice(0, 4)}`,
    roomCode: `RC-${id.slice(0, 4)}`,
    description: null,
    lastMessageAt: "2026-08-04T01:00:00.000Z",
    lastMessageSeq: 10,
    isArchived: false,
    unreadCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

/**
 * id PHẢI là UUID hợp lệ: các ca "pin hợp đồng" ở cuối file chạy `chatMessageSchema` THẬT trên chính
 * fixture này. Dùng chuỗi tuỳ ý (`msg-11`) thì chúng đỏ vì lý do KHÔNG liên quan tới điều đang kiểm.
 */
function messageId(seq: number): string {
  return `${String(seq).padStart(8, "0")}-1111-4111-8111-111111111111`;
}

function message(seq: number, over: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return {
    id: messageId(seq),
    companyId: COMPANY,
    roomId: ROOM_A,
    senderId: OTHER,
    senderName: "Người khác",
    body: `tin ${seq}`,
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
    roomSeq: seq,
    createdAt: `2026-08-04T01:${String(seq).padStart(2, "0")}:00.000Z`,
    ...over,
  };
}

/**
 * Biến thể "đến từ WS": cùng một tin nhưng `attachments` KHÔNG mang URL ký. `message()` giữ nguyên kiểu
 * `ChatMessageDto` (DTO REST) — trộn hai hình dạng vào một fixture là mất đúng cái phân biệt đang test.
 */
function storedMessage(seq: number, over: Partial<StoredChatMessage> = {}): StoredChatMessage {
  return { ...message(seq), ...over };
}

const s = () => useChatStore.getState();

beforeEach(() => {
  getMessages.mockReset();
  getMessages.mockResolvedValue([]);
  useChatStore.getState().resetChatStore();
  useChatStore.getState().setMyUserId(ME);
});

afterEach(() => {
  useChatStore.getState().resetChatStore();
  vi.useRealTimers();
});

// ── thứ tự phòng ──────────────────────────────────────────────────────────────

describe("hydrateRooms + roomOrder", () => {
  it("sắp theo lastMessageAt GIẢM DẦN; phòng chưa có tin xếp CUỐI, không NaN chen giữa", () => {
    s().hydrateRooms([
      room(ROOM_A, { lastMessageAt: "2026-08-01T00:00:00.000Z" }),
      room(ROOM_B, { lastMessageAt: null }),
      room(ROOM_C, { lastMessageAt: "2026-08-04T00:00:00.000Z" }),
    ]);
    expect(s().roomOrder).toEqual([ROOM_C, ROOM_A, ROOM_B]);
  });

  it("REST là nguồn ĐẦY ĐỦ: hydrate lại ghi đè unreadCount bằng số của SERVER", () => {
    s().hydrateRooms([room(ROOM_A, { unreadCount: 7 })]);
    expect(s().roomsById[ROOM_A].unreadCount).toBe(7);
    s().hydrateRooms([room(ROOM_A, { unreadCount: 0 })]);
    expect(s().roomsById[ROOM_A].unreadCount).toBe(0);
  });
});

// ── tin nhắn ──────────────────────────────────────────────────────────────────

describe("applyIncomingMessage", () => {
  beforeEach(() => s().hydrateRooms([room(ROOM_A)]));

  it("dedupe theo id — nhận cùng một tin 2 lần chỉ giữ 1 bản ghi", () => {
    const m = message(11);
    s().applyIncomingMessage(m);
    s().applyIncomingMessage(m);
    expect(s().messagesByRoom[ROOM_A]).toHaveLength(1);
  });

  it("giữ thứ tự TĂNG theo roomSeq kể cả khi tin tới lệch thứ tự", () => {
    s().applyIncomingMessage(message(13));
    s().applyIncomingMessage(message(11));
    s().applyIncomingMessage(message(12));
    expect(s().messagesByRoom[ROOM_A].map((m) => m.roomSeq)).toEqual([11, 12, 13]);
  });

  it(`trần ${MAX_MESSAGES_PER_ROOM} tin/phòng — evict tin CŨ NHẤT, giữ tin MỚI NHẤT`, () => {
    for (let seq = 1; seq <= MAX_MESSAGES_PER_ROOM + 5; seq += 1) {
      s().applyIncomingMessage(message(seq));
    }
    const list = s().messagesByRoom[ROOM_A];
    expect(list).toHaveLength(MAX_MESSAGES_PER_ROOM);
    expect(list[0].roomSeq).toBe(6); // 5 tin đầu bị đẩy ra
    expect(list[list.length - 1].roomSeq).toBe(MAX_MESSAGES_PER_ROOM + 5);
  });

  it("tin của NGƯỜI KHÁC tăng badge; tin của CHÍNH MÌNH thì không", () => {
    s().applyIncomingMessage(message(11, { senderId: OTHER }));
    expect(s().roomsById[ROOM_A].unreadCount).toBe(1);
    s().applyIncomingMessage(message(12, { senderId: ME }));
    expect(s().roomsById[ROOM_A].unreadCount).toBe(1);
  });

  it("đẩy phòng lên đầu danh sách (lastMessageAt/lastMessageSeq đi theo tin mới)", () => {
    s().hydrateRooms([
      room(ROOM_A, { lastMessageAt: "2026-08-01T00:00:00.000Z" }),
      room(ROOM_B, { lastMessageAt: "2026-08-04T00:00:00.000Z" }),
    ]);
    expect(s().roomOrder[0]).toBe(ROOM_B);
    s().applyIncomingMessage(message(11, { createdAt: "2026-08-05T00:00:00.000Z" }));
    expect(s().roomOrder[0]).toBe(ROOM_A);
    expect(s().roomsById[ROOM_A].lastMessageSeq).toBe(11);
  });

  it("nhận payload WS THẬT (không mang url đính kèm) mà không phải ép kiểu", () => {
    const wsPayload = wsChatMessageEventSchema.parse({
      ...message(11),
      attachmentCount: 1,
      attachments: [
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          fileId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          name: "bao-cao.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          isImage: false,
        },
      ],
    });
    s().applyIncomingMessage(wsPayload);
    const stored = s().messagesByRoom[ROOM_A][0];
    // `undefined` = CHƯA BIẾT (phải hỏi REST), KHÁC `null` = server từ chối ký.
    expect(attachmentUrl(stored.attachments[0])).toBeUndefined();
  });

  it("đính kèm từ REST giữ nguyên URL ký (`null` = bị từ chối, phân biệt được với chưa-biết)", () => {
    s().applyIncomingMessage(
      message(11, {
        attachmentCount: 1,
        attachments: [
          {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            fileId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            name: "anh.png",
            mimeType: "image/png",
            sizeBytes: 10,
            isImage: true,
            url: null,
            thumbnailUrl: null,
          },
        ],
      }),
    );
    expect(attachmentUrl(s().messagesByRoom[ROOM_A][0].attachments[0])).toBeNull();
  });
});

// ── vá sau LIGHT gate: 4 lỗ reviewer chỉ ra, đã kiểm chứng bằng code BE thật ──

describe("syncRoomList — vắng mặt trong payload là tín hiệu 'mình đã bị bớt khỏi phòng'", () => {
  it("gỡ phòng KHÔNG còn trong danh sách server trả về", () => {
    s().hydrateRooms([room(ROOM_A), room(ROOM_B)]);
    s().syncRoomList([room(ROOM_B)], false);
    expect(s().roomsById[ROOM_A]).toBeUndefined();
    expect(s().roomsById[ROOM_B]).toBeDefined();
    expect(s().roomOrder).toEqual([ROOM_B]);
  });

  it("gỡ kèm DỪNG lưới bù — không để interval nện 404 mỗi 10 giây cho phòng đã rời", () => {
    vi.useFakeTimers();
    s().hydrateRooms([room(ROOM_A)]);
    s().subscribeToRoom(ROOM_A);
    s().setConnectionStatus("disconnected");
    s().syncRoomList([], false);
    expect(s().subscribedRoomIds[ROOM_A]).toBeUndefined();
    getMessages.mockClear();
    vi.advanceTimersByTime(CHAT_POLL_INTERVAL_MS * 3);
    expect(getMessages).not.toHaveBeenCalled();
  });

  it("KHÔNG đụng phòng ĐÃ LƯU TRỮ — `listRooms()` ép `archived:false` nên chúng vốn không có trong payload", () => {
    // Đây là cái bẫy của chính bản vá: gỡ mù theo payload sẽ xoá sạch phòng lưu trữ mà mình VẪN thuộc.
    s().hydrateRooms([room(ROOM_A, { isArchived: true }), room(ROOM_B, { isArchived: false })]);
    s().syncRoomList([], false);
    expect(s().roomsById[ROOM_A]).toBeDefined(); // rổ archived — ngoài phạm vi truy vấn
    expect(s().roomsById[ROOM_B]).toBeUndefined(); // rổ đã truy vấn, vắng mặt ⇒ gỡ
  });
});

describe("mergeServerRoom — ảnh chụp REST CŨ không được đè trạng thái WS mới hơn", () => {
  it("giữ badge/con trỏ của store khi payload server cũ hơn (lost-update lúc reconnect)", () => {
    s().hydrateRooms([room(ROOM_A, { lastMessageSeq: 10, unreadCount: 0 })]);
    s().applyIncomingMessage(message(11, { senderId: OTHER })); // WS: tin mới, badge 1
    expect(s().roomsById[ROOM_A].unreadCount).toBe(1);

    // Response `GET /chat/rooms` phát đi TRƯỚC tin đó mới về tới nơi.
    s().hydrateRooms([room(ROOM_A, { lastMessageSeq: 10, unreadCount: 0, name: "Tên server" })]);
    expect(s().roomsById[ROOM_A].unreadCount).toBe(1); // badge KHÔNG bị xoá
    expect(s().roomsById[ROOM_A].lastMessageSeq).toBe(11);
    expect(s().roomsById[ROOM_A].name).toBe("Tên server"); // siêu dữ liệu vẫn lấy của server
  });

  it("payload server MỚI hơn thì thắng (đọc ở thiết bị khác ⇒ badge phải về 0)", () => {
    s().hydrateRooms([room(ROOM_A, { lastMessageSeq: 10, unreadCount: 5 })]);
    s().hydrateRooms([room(ROOM_A, { lastMessageSeq: 12, unreadCount: 0 })]);
    expect(s().roomsById[ROOM_A].unreadCount).toBe(0);
  });
});

describe("applyIncomingMessage — tin CŨ không được thổi phồng badge", () => {
  it("nạp cả trang tin đã đọc (lưới bù không có afterSeq) KHÔNG làm badge nhảy", () => {
    // pollRoomMessages bỏ `afterSeq` khi phòng chưa có tin trong bộ nhớ ⇒ server trả TRANG MỚI NHẤT 50
    // tin. Không có chốt roomSeq thì badge nhảy lên ~50 cho phòng thật ra 0 chưa đọc.
    s().hydrateRooms([room(ROOM_A, { lastMessageSeq: 10, unreadCount: 0 })]);
    for (let seq = 1; seq <= 10; seq += 1) {
      s().applyIncomingMessage(message(seq, { senderId: OTHER }));
    }
    expect(s().roomsById[ROOM_A].unreadCount).toBe(0);
    expect(s().roomsById[ROOM_A].lastMessageSeq).toBe(10); // con trỏ KHÔNG lùi
    expect(s().messagesByRoom[ROOM_A]).toHaveLength(10); // tin vẫn được CHÈN bình thường
  });

  it("tin thật sự MỚI vẫn tăng badge như thường", () => {
    s().hydrateRooms([room(ROOM_A, { lastMessageSeq: 10, unreadCount: 0 })]);
    s().applyIncomingMessage(message(11, { senderId: OTHER }));
    expect(s().roomsById[ROOM_A].unreadCount).toBe(1);
    expect(s().roomsById[ROOM_A].lastMessageSeq).toBe(11);
  });
});

describe("trùng id = NÂNG CẤP đính kèm, không phải no-op", () => {
  const WS_ATTACHMENT = {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    fileId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    name: "bao-cao.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    isImage: false,
  };
  const REST_ATTACHMENT = {
    ...WS_ATTACHMENT,
    url: "https://storage/signed",
    thumbnailUrl: null,
  };

  beforeEach(() => s().hydrateRooms([room(ROOM_A, { lastMessageSeq: 0 })]));

  it("echo WS (không URL) về TRƯỚC, response POST (có URL) về SAU → URL ký được nạp", () => {
    // Không có nâng cấp thì dedupe-theo-id vứt bản REST, và `attachmentUrl` mãi `undefined` — trong khi
    // lưới bù chỉ xin `afterSeq` (tin MỚI HƠN) nên KHÔNG có đường nào lấy lại URL. Đính kèm của chính
    // mình vừa gửi vĩnh viễn không tải được.
    s().applyIncomingMessage(storedMessage(11, { attachmentCount: 1, attachments: [WS_ATTACHMENT] }));
    expect(attachmentUrl(s().messagesByRoom[ROOM_A][0].attachments[0])).toBeUndefined();

    s().applyIncomingMessage(message(11, { attachmentCount: 1, attachments: [REST_ATTACHMENT] }));
    expect(s().messagesByRoom[ROOM_A]).toHaveLength(1); // vẫn KHÔNG nhân bản
    expect(attachmentUrl(s().messagesByRoom[ROOM_A][0].attachments[0])).toBe(
      "https://storage/signed",
    );
  });

  it("bản REST tới trước, echo WS tới sau KHÔNG được hạ cấp mất URL", () => {
    s().applyIncomingMessage(message(11, { attachmentCount: 1, attachments: [REST_ATTACHMENT] }));
    s().applyIncomingMessage(storedMessage(11, { attachmentCount: 1, attachments: [WS_ATTACHMENT] }));
    expect(attachmentUrl(s().messagesByRoom[ROOM_A][0].attachments[0])).toBe(
      "https://storage/signed",
    );
  });

  it("tin ĐÃ THU HỒI không bị phục hồi đính kèm (masking §13.6 không được nới)", () => {
    s().applyIncomingMessage(storedMessage(11, { attachmentCount: 1, attachments: [WS_ATTACHMENT] }));
    s().applyMessageRecalled({
      messageId: messageId(11),
      roomId: ROOM_A,
      recalledAt: "2026-08-04T02:00:00.000Z",
    });
    s().applyIncomingMessage(message(11, { attachmentCount: 1, attachments: [REST_ATTACHMENT] }));
    expect(s().messagesByRoom[ROOM_A][0].attachments).toEqual([]);
    expect(s().messagesByRoom[ROOM_A][0].body).toBeNull();
  });
});

describe("pollRoomMessages — 404 là 'mình không còn trong phòng', không phải lỗi tạm", () => {
  it("404 ⇒ dọn phòng + dừng interval, KHÔNG thử lại vô hạn", async () => {
    vi.useFakeTimers();
    s().hydrateRooms([room(ROOM_A)]);
    s().subscribeToRoom(ROOM_A);
    s().setConnectionStatus("disconnected");
    getMessages.mockRejectedValue(new ApiError(404, "CHAT-ERR-001", "not a member"));

    vi.advanceTimersByTime(CHAT_POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(0);

    expect(s().roomsById[ROOM_A]).toBeUndefined();
    expect(s().subscribedRoomIds[ROOM_A]).toBeUndefined();
    getMessages.mockClear();
    vi.advanceTimersByTime(CHAT_POLL_INTERVAL_MS * 3);
    expect(getMessages).not.toHaveBeenCalled();
  });

  it("lỗi 5xx ⇒ GIỮ phòng và tiếp tục thử lại (khác hẳn 404)", async () => {
    vi.useFakeTimers();
    s().hydrateRooms([room(ROOM_A)]);
    s().subscribeToRoom(ROOM_A);
    s().setConnectionStatus("disconnected");
    getMessages.mockRejectedValue(new ApiError(500, "INTERNAL", "boom"));

    vi.advanceTimersByTime(CHAT_POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(s().roomsById[ROOM_A]).toBeDefined();
    vi.advanceTimersByTime(CHAT_POLL_INTERVAL_MS);
    expect(getMessages).toHaveBeenCalledTimes(2);
  });
});

describe("resetChatStore trả về trạng thái SẠCH, không dùng chung tham chiếu", () => {
  it("hai lần reset cho hai object khác nhau (INITIAL_STATE dùng chung là bẫy ngầm)", () => {
    s().hydrateRooms([room(ROOM_A)]);
    s().resetChatStore();
    const first = s().roomsById;
    s().hydrateRooms([room(ROOM_B)]);
    s().resetChatStore();
    expect(s().roomsById).not.toBe(first);
    expect(Object.keys(s().roomsById)).toHaveLength(0);
  });
});

describe("applyMessageRecalled", () => {
  it("xoá nội dung + đính kèm, đặt recalledAt (payload KHÔNG mang body, kể cả null)", () => {
    s().hydrateRooms([room(ROOM_A)]);
    s().applyIncomingMessage(message(11, { attachmentCount: 1 }));
    const id = s().messagesByRoom[ROOM_A][0].id;
    // Đi qua schema THẬT (§4 ca 14) chứ không object literal: literal vẫn xanh kể cả khi hợp đồng RT-1
    // đổi hình dạng, tức test mất hết sức phân biệt đúng lúc cần nhất.
    s().applyMessageRecalled(
      wsChatMessageRecalledEventSchema.parse({
        messageId: id,
        roomId: ROOM_A,
        recalledAt: "2026-08-04T02:00:00.000Z",
      }),
    );
    const m = s().messagesByRoom[ROOM_A][0];
    expect(m.body).toBeNull();
    expect(m.recalledAt).toBe("2026-08-04T02:00:00.000Z");
    expect(m.attachments).toEqual([]);
    expect(m.attachmentCount).toBe(1); // số liệu lịch sử — KHÔNG bị viết lại
  });

  it("tin không có trong cache → store không đổi tham chiếu (không re-render vô ích)", () => {
    s().hydrateRooms([room(ROOM_A)]);
    const before = s().messagesByRoom;
    s().applyMessageRecalled({
      messageId: "msg-lạ",
      roomId: ROOM_A,
      recalledAt: "2026-08-04T02:00:00.000Z",
    });
    expect(s().messagesByRoom).toBe(before);
  });
});

describe("applyReadEvent", () => {
  beforeEach(() => s().hydrateRooms([room(ROOM_A, { lastMessageSeq: 10, unreadCount: 5 })]));

  it("con trỏ CỦA MÌNH (đọc ở thiết bị khác) → badge tính lại = lastMessageSeq − lastReadSeq", () => {
    s().applyReadEvent({ roomId: ROOM_A, userId: ME, lastReadSeq: 8 });
    expect(s().roomsById[ROOM_A].unreadCount).toBe(2);
  });

  it("con trỏ vượt lastMessageSeq → kẹp về 0, KHÔNG âm", () => {
    s().applyReadEvent({ roomId: ROOM_A, userId: ME, lastReadSeq: 999 });
    expect(s().roomsById[ROOM_A].unreadCount).toBe(0);
  });

  it("con trỏ của NGƯỜI KHÁC → no-op (dữ liệu 'đã xem bởi' là việc của FE-2)", () => {
    s().applyReadEvent({ roomId: ROOM_A, userId: OTHER, lastReadSeq: 10 });
    expect(s().roomsById[ROOM_A].unreadCount).toBe(5);
  });

  it("chưa biết myUserId → no-op, KHÔNG đoán là mình", () => {
    s().setMyUserId(null);
    s().applyReadEvent({ roomId: ROOM_A, userId: ME, lastReadSeq: 10 });
    expect(s().roomsById[ROOM_A].unreadCount).toBe(5);
  });
});

// ── gửi lạc quan ──────────────────────────────────────────────────────────────

describe("gửi lạc quan (§R3.4 — pending CHỈ do response POST của chính nó giải quyết)", () => {
  const CID_A = "aaaa1111-1111-4111-8111-111111111111";
  const CID_B = "bbbb2222-2222-4222-8222-222222222222";

  beforeEach(() => s().hydrateRooms([room(ROOM_A)]));

  it("createClientMessageId() sinh giá trị KHÁC nhau và là UUID hợp lệ cho sendMessageSchema", () => {
    const a = createClientMessageId();
    const b = createClientMessageId();
    expect(a).not.toBe(b);
    expect(z.string().uuid().safeParse(a).success).toBe(true);
  });

  it("WS echo về TRƯỚC response POST → đúng 1 bản ghi, pending xoá sau khi POST resolve", () => {
    const sent = message(11, { senderId: ME });
    s().applyOptimisticSend(CID_A, ROOM_A, "tin 11");
    s().applyIncomingMessage(sent); // echo WS
    expect(s().pendingByClientId[CID_A]?.status).toBe("sending"); // WS KHÔNG đụng pending
    s().resolvePendingSend(CID_A, sent); // response POST
    expect(s().messagesByRoom[ROOM_A]).toHaveLength(1);
    expect(s().pendingByClientId[CID_A]).toBeUndefined();
  });

  it("response POST về TRƯỚC, WS echo tới muộn → vẫn đúng 1 bản ghi (dedupe theo id)", () => {
    const sent = message(11, { senderId: ME });
    s().applyOptimisticSend(CID_A, ROOM_A, "tin 11");
    s().resolvePendingSend(CID_A, sent);
    s().applyIncomingMessage(sent);
    expect(s().messagesByRoom[ROOM_A]).toHaveLength(1);
    expect(s().pendingByClientId[CID_A]).toBeUndefined();
  });

  it("gửi lỗi → status 'failed', entry GIỮ LẠI; gửi lại dùng CÙNG id không tạo entry thứ hai", () => {
    s().applyOptimisticSend(CID_A, ROOM_A, "tin lỗi");
    s().resolvePendingSend(CID_A, null);
    expect(s().pendingByClientId[CID_A].status).toBe("failed");
    s().applyOptimisticSend(CID_A, ROOM_A, "tin lỗi");
    expect(Object.keys(s().pendingByClientId)).toHaveLength(1);
    expect(s().pendingByClientId[CID_A].status).toBe("sending");
  });

  it("KỊCH BẢN NUỐT TIN của FIFO: gửi A rồi B, echo của B về trước khi A xong → A vẫn báo LỖI", () => {
    // Đây là lý do tồn tại của §R3.4. Với quy tắc FIFO cũ, echo của B sẽ được gán cho pending A ⇒ A
    // mang id của B ⇒ khi POST của A hỏng thì UI vẫn coi A "đã gửi xong" và tin A biến mất KHÔNG DẤU VẾT.
    s().applyOptimisticSend(CID_A, ROOM_A, "tin A");
    s().applyOptimisticSend(CID_B, ROOM_A, "tin B");
    const bReal = message(12, { senderId: ME });
    s().applyIncomingMessage(bReal); // echo WS của B về trước

    s().resolvePendingSend(CID_B, bReal); // POST của B thành công
    s().resolvePendingSend(CID_A, null); // POST của A HỎNG

    expect(s().pendingByClientId[CID_B]).toBeUndefined();
    expect(s().pendingByClientId[CID_A]).toBeDefined();
    expect(s().pendingByClientId[CID_A].status).toBe("failed");
    expect(s().pendingByClientId[CID_A].body).toBe("tin A"); // nội dung người dùng gõ CÒN NGUYÊN
  });
});

// ── sự kiện chat:room ─────────────────────────────────────────────────────────

describe("applyRoomEvent (§R3.1 — hỏi server, KHÔNG đoán)", () => {
  it("action 'updated' KHÔNG BAO GIỜ ghi đè unreadCount (payload cố ý .omit khoá này)", () => {
    s().hydrateRooms([room(ROOM_A, { unreadCount: 5 })]);
    const event = wsChatRoomEventSchema.parse({
      roomId: ROOM_A,
      action: "updated",
      room: { ...room(ROOM_A, { name: "Tên mới" }), unreadCount: undefined },
    });
    const effect = s().applyRoomEvent(event);
    expect(effect).toEqual({ kind: "none" });
    expect(s().roomsById[ROOM_A].name).toBe("Tên mới");
    expect(s().roomsById[ROOM_A].unreadCount).toBe(5);
  });

  it("'updated' THIẾU các khoá optional → GIỮ giá trị đang có, KHÔNG ghi undefined đè lên", () => {
    // Đổi TÊN phòng không được làm mất mô tả, cờ lưu trữ và mốc tin cuối — mất `lastMessageAt` là phòng
    // rơi thẳng xuống cuối danh sách, người dùng đọc thành "phòng chết".
    s().hydrateRooms([
      room(ROOM_A, {
        description: "mô tả cũ",
        isArchived: false,
        lastMessageAt: "2026-08-04T01:00:00.000Z",
        lastMessageSeq: 10,
      }),
    ]);
    const event = wsChatRoomEventSchema.parse({
      roomId: ROOM_A,
      action: "updated",
      room: {
        id: ROOM_A,
        companyId: COMPANY,
        refId: null,
        roomType: "group",
        name: "Tên mới",
        roomCode: "RC-0001",
        createdAt: "2026-08-01T00:00:00.000Z",
        // description / isArchived / lastMessageAt / lastMessageSeq CỐ Ý vắng mặt
      },
    });
    s().applyRoomEvent(event);
    const r = s().roomsById[ROOM_A];
    expect(r.name).toBe("Tên mới");
    expect(r.description).toBe("mô tả cũ");
    expect(r.isArchived).toBe(false);
    expect(r.lastMessageAt).toBe("2026-08-04T01:00:00.000Z");
    expect(r.lastMessageSeq).toBe(10);
    expect(s().roomOrder[0]).toBe(ROOM_A);
  });

  it("'archived' CÓ mang isArchived → vẫn cập nhật được (allowlist không phải là khoá cứng)", () => {
    s().hydrateRooms([room(ROOM_A, { isArchived: false })]);
    const event = wsChatRoomEventSchema.parse({
      roomId: ROOM_A,
      action: "archived",
      room: { ...room(ROOM_A, { isArchived: true }), unreadCount: undefined },
    });
    s().applyRoomEvent(event);
    expect(s().roomsById[ROOM_A].isArchived).toBe(true);
  });

  it("'created' có room → chèn với unreadCount 0; gọi lại lần hai là idempotent", () => {
    const event = wsChatRoomEventSchema.parse({
      roomId: ROOM_B,
      action: "created",
      room: { ...room(ROOM_B), unreadCount: undefined },
    });
    s().applyRoomEvent(event);
    expect(s().roomsById[ROOM_B].unreadCount).toBe(0);
    s().hydrateRooms([room(ROOM_B, { unreadCount: 3 })]);
    expect(s().applyRoomEvent(event)).toEqual({ kind: "none" });
    expect(s().roomsById[ROOM_B].unreadCount).toBe(3); // KHÔNG bị 'created' lặp reset về 0
  });

  it("'created' THIẾU room (lệch hợp đồng) → fail-soft bằng refetch cả danh sách, không đoán", () => {
    const event = wsChatRoomEventSchema.parse({ roomId: ROOM_B, action: "created" });
    expect(s().applyRoomEvent(event)).toEqual({ kind: "refetch-rooms" });
  });

  it("'member_added' phòng CHƯA có → refetch-room (có thể mình vừa được thêm)", () => {
    const event = wsChatRoomEventSchema.parse({ roomId: ROOM_B, action: "member_added" });
    expect(s().applyRoomEvent(event)).toEqual({ kind: "refetch-room", roomId: ROOM_B });
  });

  it("'member_added' phòng ĐÃ có → no-op (người khác vào phòng mình đang ở)", () => {
    s().hydrateRooms([room(ROOM_A)]);
    const event = wsChatRoomEventSchema.parse({ roomId: ROOM_A, action: "member_added" });
    expect(s().applyRoomEvent(event)).toEqual({ kind: "none" });
  });

  it("'member_removed' phòng ĐÃ có → refetch-room; KHÔNG tự xoá (có thể là người khác bị gỡ)", () => {
    s().hydrateRooms([room(ROOM_A)]);
    const event = wsChatRoomEventSchema.parse({ roomId: ROOM_A, action: "member_removed" });
    expect(s().applyRoomEvent(event)).toEqual({ kind: "refetch-room", roomId: ROOM_A });
    expect(s().roomsById[ROOM_A]).toBeDefined(); // vẫn còn — chờ câu trả lời của server
  });

  it("'member_removed' phòng KHÔNG giữ → no-op (không có gì để gỡ, không gọi API thừa)", () => {
    const event = wsChatRoomEventSchema.parse({ roomId: ROOM_B, action: "member_removed" });
    expect(s().applyRoomEvent(event)).toEqual({ kind: "none" });
  });

  it("'member_role_changed' → no-op", () => {
    s().hydrateRooms([room(ROOM_A)]);
    const event = wsChatRoomEventSchema.parse({ roomId: ROOM_A, action: "member_role_changed" });
    expect(s().applyRoomEvent(event)).toEqual({ kind: "none" });
  });
});

describe("removeRoomForSelf", () => {
  it("dọn phòng + tin + thứ tự + DỪNG interval bù (không gọi API cho phòng đã rời)", () => {
    vi.useFakeTimers();
    s().hydrateRooms([room(ROOM_A), room(ROOM_B)]);
    s().applyIncomingMessage(message(11));
    s().subscribeToRoom(ROOM_A);
    s().setConnectionStatus("disconnected");

    vi.advanceTimersByTime(CHAT_POLL_INTERVAL_MS);
    expect(getMessages).toHaveBeenCalledTimes(1);

    s().removeRoomForSelf(ROOM_A);
    expect(s().roomsById[ROOM_A]).toBeUndefined();
    expect(s().messagesByRoom[ROOM_A]).toBeUndefined();
    expect(s().roomOrder).not.toContain(ROOM_A);
    expect(s().subscribedRoomIds[ROOM_A]).toBeUndefined();

    getMessages.mockClear();
    vi.advanceTimersByTime(CHAT_POLL_INTERVAL_MS * 3);
    expect(getMessages).not.toHaveBeenCalled(); // interval đã clear — không rò 404 mỗi 10 giây
  });
});

// ── lưới bù tin ───────────────────────────────────────────────────────────────

describe("subscribeToRoom / lưới bù afterSeq", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    s().hydrateRooms([room(ROOM_A)]);
  });

  it.each(["disconnected", "polling-fallback", "connecting"] as const)(
    "trạng thái '%s' → bù mỗi 10 giây bằng con trỏ afterSeq",
    (status) => {
      s().applyIncomingMessage(message(11));
      s().subscribeToRoom(ROOM_A);
      s().setConnectionStatus(status);

      vi.advanceTimersByTime(CHAT_POLL_INTERVAL_MS);
      expect(getMessages).toHaveBeenCalledWith(ROOM_A, { afterSeq: 11 });
      vi.advanceTimersByTime(CHAT_POLL_INTERVAL_MS);
      expect(getMessages).toHaveBeenCalledTimes(2);
    },
  );

  it("đang 'connected' → KHÔNG bù (WS đang chở tin, bù nữa là gọi thừa)", () => {
    s().subscribeToRoom(ROOM_A);
    s().setConnectionStatus("connected");
    vi.advanceTimersByTime(CHAT_POLL_INTERVAL_MS * 5);
    expect(getMessages).not.toHaveBeenCalled();
  });

  it("mất kết nối GIỮA CHỪNG → lưới tự kích hoạt, không cần subscribe lại", () => {
    s().subscribeToRoom(ROOM_A);
    s().setConnectionStatus("connected");
    vi.advanceTimersByTime(CHAT_POLL_INTERVAL_MS * 2);
    expect(getMessages).not.toHaveBeenCalled();

    s().setConnectionStatus("disconnected");
    vi.advanceTimersByTime(CHAT_POLL_INTERVAL_MS);
    expect(getMessages).toHaveBeenCalledTimes(1);
  });

  it("phòng CHƯA có tin → KHÔNG gửi afterSeq (afterSeq phải .positive(), 0 là 400)", () => {
    s().subscribeToRoom(ROOM_A);
    s().setConnectionStatus("disconnected");
    vi.advanceTimersByTime(CHAT_POLL_INTERVAL_MS);
    expect(getMessages).toHaveBeenCalledWith(ROOM_A, {});
  });

  it("unsubscribeFromRoom dừng bù và không rò interval", () => {
    s().subscribeToRoom(ROOM_A);
    s().setConnectionStatus("disconnected");
    vi.advanceTimersByTime(CHAT_POLL_INTERVAL_MS);
    expect(getMessages).toHaveBeenCalledTimes(1);

    s().unsubscribeFromRoom(ROOM_A);
    expect(s().subscribedRoomIds[ROOM_A]).toBeUndefined();
    vi.advanceTimersByTime(CHAT_POLL_INTERVAL_MS * 5);
    expect(getMessages).toHaveBeenCalledTimes(1);
  });

  it("subscribe hai lần cùng phòng KHÔNG tạo interval thứ hai (một nhịp = một lần gọi)", () => {
    s().subscribeToRoom(ROOM_A);
    s().subscribeToRoom(ROOM_A);
    s().setConnectionStatus("disconnected");
    vi.advanceTimersByTime(CHAT_POLL_INTERVAL_MS);
    expect(getMessages).toHaveBeenCalledTimes(1);
  });

  it("một lần bù LỖI không làm sập nhịp sau, và KHÔNG đổi connectionStatus", async () => {
    getMessages.mockRejectedValueOnce(new Error("mạng chập"));
    s().subscribeToRoom(ROOM_A);
    s().setConnectionStatus("disconnected");

    vi.advanceTimersByTime(CHAT_POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(s().connectionStatus).toBe("disconnected");

    vi.advanceTimersByTime(CHAT_POLL_INTERVAL_MS);
    expect(getMessages).toHaveBeenCalledTimes(2);
  });
});

// ── pin schema THẬT (không sửa file nguồn) ────────────────────────────────────

describe("pin hợp đồng chatMessageSchema", () => {
  it("chấp nhận tin đã thu hồi `body: null`", () => {
    expect(chatMessageSchema.safeParse({ ...message(11), body: null }).success).toBe(true);
  });

  it("ĐỐI CHỨNG (schema CLONE cục bộ, KHÔNG đụng chat.ts): thiếu .nullable() thì `body: null` TRƯỢT", () => {
    const cloneWithoutNullable = z.object({
      body: z.string(),
      roomSeq: z.number().int().positive(),
    });
    expect(cloneWithoutNullable.safeParse({ body: null, roomSeq: 11 }).success).toBe(false);
    expect(cloneWithoutNullable.safeParse({ body: "ok", roomSeq: 11 }).success).toBe(true);
  });

  it("`roomSeq` BẮT BUỘC — thiếu là trượt (con trỏ per-room, không được optional)", () => {
    const { roomSeq: _dropped, ...withoutRoomSeq } = message(11);
    expect(chatMessageSchema.safeParse(withoutRoomSeq).success).toBe(false);
  });

  it("`seq` cấp bảng KHÔNG BAO GIỜ ra khỏi server — schema strip nếu server lỡ gửi", () => {
    const parsed = chatMessageSchema.parse({ ...message(11), seq: 987654 });
    expect(parsed).not.toHaveProperty("seq");
  });

  it("`action` của chat:room là ENUM ĐÓNG — chuỗi lạ phải trượt", () => {
    expect(wsChatRoomEventSchema.safeParse({ roomId: ROOM_A, action: "nuked" }).success).toBe(
      false,
    );
  });
});
