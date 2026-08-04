/**
 * chat-oversight-api.spec.ts — ranh giới hợp đồng của `chatOversightApi` (S7-CHAT-FE-5 🔒).
 *
 * File RIÊNG (không nối vào `chat-api.spec.ts`) vì đây là bề mặt rủi ro riêng: đường đọc phòng mà người
 * gọi KHÔNG là thành viên. Mỗi ca dưới đây neo một vế của bảng ràng buộc API-13 §5.3 — mất vế nào cũng
 * là mở lỗ đọc, và tất cả đều là thứ `tsc` không thấy được.
 *
 * Cùng khuôn `chat-api.spec.ts`: mock `apiFetch` ở ranh giới `./api-client` để đọc path/method, RỒI chạy
 * chính schema đã truyền vào trên payload giống thật (chỉ so URL thì schema sai vẫn xanh).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { chatApi, chatOversightApi } from "./chat-api";
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
const FILE_ID = "88888888-8888-4888-8888-888888888888";

const ROOM_SUMMARY = {
  id: ROOM_ID,
  roomCode: "ROOM-001",
  name: "Phòng Kỹ thuật",
  roomType: "group",
  isArchived: false,
  memberCount: 7,
  lastMessageAt: "2026-08-04T01:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const MESSAGE = {
  id: MSG_ID,
  roomId: ROOM_ID,
  senderId: USER_ID,
  senderName: "Nguyễn Văn A",
  body: "xin chào",
  messageType: "text",
  mentions: [],
  pinnedAt: null,
  replyToMessageId: null,
  recalledAt: null,
  attachmentCount: 0,
  attachments: [],
  roomSeq: 12,
  createdAt: "2026-08-04T01:00:00.000Z",
};

const AUDIT_ENTRY = {
  id: "77777777-7777-4777-8777-777777777777",
  actorUserId: USER_ID,
  actorName: "Nguyễn Văn A",
  roomId: ROOM_ID,
  roomCode: "ROOM-001",
  roomName: "Phòng Kỹ thuật",
  resultStatus: "Success",
  endpoint: "018b",
  criteria: { q: "ky thuat" },
  createdAt: "2026-08-04T01:00:00.000Z",
};

describe("chatOversightApi — bề mặt: 4 route, TẤT CẢ là GET", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue(undefined as never);
  });

  const CASES: Array<[string, () => Promise<unknown>, string]> = [
    [
      "searchRooms",
      () => chatOversightApi.searchRooms({ q: "ky thuat", limit: 20 }),
      "/chat/oversight/rooms?q=ky+thuat&limit=20",
    ],
    ["getRoom", () => chatOversightApi.getRoom(ROOM_ID), `/chat/oversight/rooms/${ROOM_ID}`],
    [
      "listMessages",
      () => chatOversightApi.listMessages(ROOM_ID, { limit: 50 }),
      `/chat/oversight/rooms/${ROOM_ID}/messages?limit=50`,
    ],
    [
      "listAudit",
      () => chatOversightApi.listAudit({ limit: 50 }),
      "/chat/oversight/audit?limit=50",
    ],
  ];

  it.each(CASES)("%s → GET %s", async (_name, call, expectedUrl) => {
    await call();
    const [url, , init] = lastCall();
    expect(url).toBe(expectedUrl);
    // Ràng buộc 4 (API-13 §5.3): không POST/PATCH/DELETE nào dưới /chat/oversight/. Một hàm GHI lọt vào
    // client là bước đầu của việc nó lọt vào controller.
    expect(init?.method).toBeUndefined();
  });

  it("đúng 4 hàm — và TUYỆT ĐỐI không có `search`", () => {
    // `/chat/oversight/search` KHÔNG TỒN TẠI (ràng buộc 5, không phải thiếu sót): tìm kiếm giữ nguyên
    // vị từ membership cho MỌI role, kể cả Super Admin. Thêm vào là mở lại CHAT-DEC-004 với owner.
    expect(Object.keys(chatOversightApi).sort()).toEqual([
      "getRoom",
      "listAudit",
      "listMessages",
      "searchRooms",
    ]);
  });

  it("`chatApi` KHÔNG mọc thêm đường đọc-vượt — tách đối tượng là ranh giới review", () => {
    expect(Object.keys(chatApi).some((k) => k.toLowerCase().includes("oversight"))).toBe(false);
  });
});

describe("chatOversightApi — schema: 018c MẢNG TRẦN vs 019 OBJECT keyset", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue(undefined as never);
  });

  it("searchRooms parse `{data,truncated}`; mảng trần TRƯỢT và thiếu `truncated` cũng TRƯỢT", async () => {
    await chatOversightApi.searchRooms({ q: "abc", limit: 20 });
    const [, schema] = lastCall();
    expect(schema.safeParse({ data: [ROOM_SUMMARY], truncated: false }).success).toBe(true);
    expect(schema.safeParse([ROOM_SUMMARY]).success).toBe(false);
    // Mất cờ `truncated` thì UI đọc một trang bị cắt thành "đã trả hết" — sai về PHẠM VI, im lặng.
    expect(schema.safeParse({ data: [ROOM_SUMMARY] }).success).toBe(false);
  });

  it("018a: phòng `direct` không tên vẫn parse được, và KHÔNG mang members/directKey", async () => {
    await chatOversightApi.searchRooms({ q: "abc", limit: 20 });
    const [, schema] = lastCall();
    const dm = { ...ROOM_SUMMARY, roomType: "direct", name: null };
    const parsed = schema.safeParse({ data: [dm], truncated: false });
    expect(parsed.success).toBe(true);
    // Vế giữ cho một lời gọi 018a không xuất được đồ thị "ai nhắn riêng với ai" của cả công ty.
    const row = (parsed as unknown as { data: { data: Record<string, unknown>[] } }).data.data[0];
    expect(row).not.toHaveProperty("members");
    expect(row).not.toHaveProperty("directKey");
  });

  it("getRoom KHÔNG có `myRole` — không có dữ liệu nào để FE bật nút quản trị", async () => {
    await chatOversightApi.getRoom(ROOM_ID);
    const [, schema] = lastCall();
    const detail = {
      ...ROOM_SUMMARY,
      description: null,
      myRole: "admin", // kể cả khi server (hoặc một mock) gửi thừa, schema phải LỘT nó đi
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
    const parsed = schema.safeParse(detail);
    expect(parsed.success).toBe(true);
    expect((parsed as unknown as { data: Record<string, unknown> }).data).not.toHaveProperty(
      "myRole",
    );
  });

  it("listMessages dùng MẢNG TRẦN; payload keyset `{data,nextCursor}` TRƯỢT", async () => {
    await chatOversightApi.listMessages(ROOM_ID);
    const [, schema] = lastCall();
    expect(schema.safeParse([MESSAGE]).success).toBe(true);
    expect(schema.safeParse({ data: [MESSAGE], nextCursor: null }).success).toBe(false);
  });

  it("018c: đính kèm KHÔNG mang URL — khoá đọc tệp không rời server qua đường này", async () => {
    await chatOversightApi.listMessages(ROOM_ID);
    const [, schema] = lastCall();
    const withFile = [
      {
        ...MESSAGE,
        attachmentCount: 1,
        attachments: [
          {
            fileId: FILE_ID,
            name: "bao-cao.pdf",
            mimeType: "application/pdf",
            sizeBytes: 12345,
            isImage: false,
            // Ngay cả khi payload có URL (schema gốc trôi, hoặc server bị sửa), schema oversight phải
            // LỘT nó đi: đó là toàn bộ lý do khối contract này khai LẠI thay vì `.omit()`.
            url: "https://storage.example/bao-cao.pdf?sig=x",
            thumbnailUrl: "https://storage.example/thumb.png?sig=x",
          },
        ],
      },
    ];
    const parsed = schema.safeParse(withFile);
    expect(parsed.success).toBe(true);
    const attachment = (parsed as unknown as { data: { attachments: Record<string, unknown>[] }[] })
      .data[0].attachments[0];
    expect(attachment).not.toHaveProperty("url");
    expect(attachment).not.toHaveProperty("thumbnailUrl");
  });

  it("018c giữ masking: tin đã thu hồi vẫn `body: null` ở đường đọc-vượt", async () => {
    await chatOversightApi.listMessages(ROOM_ID);
    const [, schema] = lastCall();
    const recalled = { ...MESSAGE, body: null, recalledAt: "2026-08-04T01:05:00.000Z" };
    expect(schema.safeParse([recalled]).success).toBe(true);
  });

  it("listAudit parse OBJECT keyset; mảng trần TRƯỢT", async () => {
    await chatOversightApi.listAudit();
    const [, schema] = lastCall();
    expect(schema.safeParse({ data: [AUDIT_ENTRY], nextCursor: null }).success).toBe(true);
    expect(schema.safeParse([AUDIT_ENTRY]).success).toBe(false);
  });

  it("listAudit nhận ĐỦ 5 `resultStatus` — gộp Failure/Error vào Denied là audit nói SAI loại sự kiện", async () => {
    await chatOversightApi.listAudit();
    const [, schema] = lastCall();
    for (const resultStatus of ["Success", "Failure", "Denied", "Error", "Unknown"]) {
      expect(
        schema.safeParse({ data: [{ ...AUDIT_ENTRY, resultStatus }], nextCursor: null }).success,
      ).toBe(true);
    }
    expect(
      schema.safeParse({ data: [{ ...AUDIT_ENTRY, resultStatus: "Whatever" }], nextCursor: null })
        .success,
    ).toBe(false);
  });

  it("listAudit chấp nhận dòng KHÔNG có phòng đích (018a, và Denied không mang `:id`)", async () => {
    await chatOversightApi.listAudit();
    const [, schema] = lastCall();
    const noRoom = {
      ...AUDIT_ENTRY,
      roomId: null,
      roomCode: null,
      roomName: null,
      endpoint: "018a",
      resultStatus: "Denied",
      criteria: null,
    };
    expect(schema.safeParse({ data: [noRoom], nextCursor: "opaque-cursor" }).success).toBe(true);
  });
});
