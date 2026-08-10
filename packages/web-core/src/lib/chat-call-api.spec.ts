/**
 * chat-call-api.spec.ts — ranh giới hợp đồng của `chatCallApi` (S7-CALL-FE-1).
 *
 * ⚠️ Bài quan trọng nhất ở đây là **LANDMINE của hàng rào R4**: vòng đời cuộc gọi phải đi REST. Mỗi ca
 * đóng đinh đúng path + method mà `chat-calls.controller.ts` khai; ai chuyển một mốc sang emit WS (đúng
 * cách bản LMS làm) thì ca tương ứng đỏ ngay, thay vì trôi vào PROD thành đường ghi thứ hai cho cùng
 * một FSM.
 *
 * Cùng khuôn `chat-api.spec.ts`: mock `apiFetch` ở ranh giới `./api-client`, và chạy **chính schema đã
 * truyền vào** trên payload giống thật — chỉ so URL thì một schema sai vẫn xanh, mà schema sai là lớp
 * bug sinh `ZodError` runtime dù HTTP 200.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { chatCallApi } from "./chat-call-api";
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
const CALL_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "22222222-2222-4222-8222-222222222222";

/** Hình dạng server TRẢ THẬT — dùng để chạy schema, không phải để kiểm chính nó. */
const CALL_PAYLOAD = {
  id: CALL_ID,
  roomId: ROOM_ID,
  initiatorUserId: USER_ID,
  kind: "video",
  status: "ringing",
  startedAt: "2026-08-10T10:00:00.000Z",
  acceptedAt: null,
  endedAt: null,
};

beforeEach(() => {
  vi.mocked(apiClient.apiFetch).mockReset();
  vi.mocked(apiClient.apiFetch).mockResolvedValue(CALL_PAYLOAD as never);
});

describe("vòng đời cuộc gọi đi REST — hàng rào R4 (CHAT-API-026..028)", () => {
  it("mời: POST /chat/rooms/:id/calls kèm {kind}", async () => {
    await chatCallApi.createCall(ROOM_ID, "video");
    const [path, schema, init] = lastCall();
    expect(path).toBe(`/chat/rooms/${ROOM_ID}/calls`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({ kind: "video" });
    expect(schema.parse(CALL_PAYLOAD)).toMatchObject({ id: CALL_ID, status: "ringing" });
  });

  it.each([
    ["acceptCall", "accept"],
    ["rejectCall", "reject"],
    ["cancelCall", "cancel"],
    ["hangupCall", "hangup"],
  ] as const)("%s: POST /chat/calls/:id/%s, KHÔNG có thân", async (method, segment) => {
    await chatCallApi[method](CALL_ID);
    const [path, , init] = lastCall();
    expect(path).toBe(`/chat/calls/${CALL_ID}/${segment}`);
    expect(init?.method).toBe("POST");
    // Bốn route này không nhận tham số nào — gửi thân thừa là mời `ValidationPipe` từ chối.
    expect(init?.body).toBeUndefined();
  });

  it("`hangup` và `cancel` là HAI đường KHÁC NHAU", async () => {
    // FSM một chiều ở BE: gọi `hangup` khi cuộc gọi còn `ringing` trả 422 (CHAT-ERR-029) và cuộc gọi
    // kẹt đổ chuông tới khi job đánh nhỡ. Gộp hai đường ở FE là tạo đúng lỗi đó.
    await chatCallApi.cancelCall(CALL_ID);
    const cancelPath = lastCall()[0];
    await chatCallApi.hangupCall(CALL_ID);
    expect(lastCall()[0]).not.toBe(cancelPath);
  });
});

describe("ice-config (CHAT-API-029)", () => {
  it("GET /chat/calls/ice-config — không method, schema nhận iceServers", async () => {
    const payload = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: ["turn:turn.example.com:3478"], username: "u", credential: "c" },
      ],
    };
    vi.mocked(apiClient.apiFetch).mockResolvedValue(payload as never);

    await chatCallApi.getIceConfig();
    const [path, schema, init] = lastCall();
    expect(path).toBe("/chat/calls/ice-config");
    expect(init).toBeUndefined();
    expect(schema.parse(payload)).toEqual(payload);
  });
});
