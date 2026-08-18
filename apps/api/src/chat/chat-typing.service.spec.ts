import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatTypingService, TYPING_THROTTLE_SEC } from "./chat-typing.service";
import type { ChatAccessService } from "./chat-access.service";
import type { DatabaseService } from "../db/db.service";
import type { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import type { ValkeyService } from "../permission/valkey.service";
import { CHAT_ERR } from "./chat.errors";
import { chatKey } from "../common/valkey/valkey-key";

/**
 * S8-CHAT-UX-RT-1 — CHAT-API-023 "đang gõ" (CHAT-DEC-017).
 *
 * Ba bất biến được đóng đinh ở đây: **0 ghi** (đường đi chỉ có `assertMember`, không repository ghi nào
 * được inject), **payload không nội dung**, và **tiết lưu**.
 */

const CO = "11111111-1111-4111-8111-111111111111";
const ROOM = "33333333-3333-4333-8333-333333333333";
const USER = "22222222-2222-4222-8222-222222222222";
const ACTOR = { id: USER, companyId: CO };

function makeService(
  over: { isArchived?: boolean; setNx?: (typeof vi)["fn"] extends never ? never : unknown } = {},
) {
  const assertMember = vi.fn(async () => ({
    room: { id: ROOM, roomType: "group", isArchived: over.isArchived ?? false },
    membership: { role: "member" },
  }));
  const access = { assertMember } as unknown as ChatAccessService;

  const db = {
    withTenant: vi.fn(async (_c: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  } as unknown as DatabaseService;

  const emitChatTyping = vi.fn();
  const emitter = { emitChatTyping } as unknown as RealtimeEmitterService;

  // Mặc định: Valkey BẬT và mọi ping là "đầu tiên trong cửa sổ" ⇒ không tiết lưu. Ca tiết lưu tự ghi đè.
  const setNx = vi.fn(async () => true);
  const valkey = { setNx } as unknown as ValkeyService;

  const svc = new ChatTypingService(db, access, emitter, valkey);
  return { svc, assertMember, emitChatTyping, setNx, db };
}

describe("ChatTypingService — membership là cổng, 404 không phải 403", () => {
  it("không phải thành viên ⇒ NÉM CHAT-ERR-001 (404), KHÔNG emit", async () => {
    const { svc, assertMember, emitChatTyping } = makeService();
    assertMember.mockRejectedValue(new NotFoundException(CHAT_ERR.ROOM_NOT_FOUND) as never);

    await expect(svc.ping(ACTOR, ROOM)).rejects.toBeInstanceOf(NotFoundException);
    expect(emitChatTyping).not.toHaveBeenCalled();
  });

  it("membership khẳng định TRONG withTenant — không có đường đọc nào ngoài phạm vi tenant", async () => {
    const { svc, assertMember, db } = makeService();

    await svc.ping(ACTOR, ROOM);

    expect(db.withTenant).toHaveBeenCalledWith(CO, expect.any(Function));
    expect(assertMember).toHaveBeenCalledWith(expect.anything(), CO, ROOM, USER);
  });
});

describe("CHAT-API-023 — payload và 0-ghi", () => {
  it("phát ĐÚNG {roomId, userId} — không nội dung đang gõ, không cờ trạng thái", async () => {
    const { svc, emitChatTyping } = makeService();

    await svc.ping(ACTOR, ROOM);

    expect(emitChatTyping).toHaveBeenCalledTimes(1);
    expect(emitChatTyping).toHaveBeenCalledWith(CO, ROOM, { roomId: ROOM, userId: USER });
    // Đóng đinh HÌNH DẠNG, không chỉ giá trị: một khoá thứ ba lọt vào là hồi quy im lặng.
    const payload = emitChatTyping.mock.calls[0][2] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["roomId", "userId"]);
  });

  it("userId lấy TỪ ACTOR đã xác thực, không từ tham số client kiểm soát", async () => {
    const { svc, emitChatTyping } = makeService();

    await svc.ping({ id: USER, companyId: CO }, ROOM);

    expect((emitChatTyping.mock.calls[0][2] as { userId: string }).userId).toBe(USER);
  });
});

describe("CHAT-API-023 — tiết lưu server", () => {
  it("hai ping trong cùng cửa sổ ⇒ ĐÚNG MỘT emit", async () => {
    const { svc, emitChatTyping, setNx } = makeService();
    // `setNx`: lần đầu giữ được khoá (true), lần sau trượt (false) — đúng ngữ nghĩa SET NX EX.
    setNx.mockResolvedValueOnce(true as never).mockResolvedValueOnce(false as never);

    await svc.ping(ACTOR, ROOM);
    await svc.ping(ACTOR, ROOM);

    expect(emitChatTyping).toHaveBeenCalledTimes(1);
  });

  it("khoá tiết lưu tách theo (công ty, phòng, người) và mang TTL", async () => {
    const { svc, setNx } = makeService();

    await svc.ping(ACTOR, ROOM);

    expect(setNx).toHaveBeenCalledWith(
      chatKey("typing", `co:${CO}:room:${ROOM}:user:${USER}`),
      "1",
      TYPING_THROTTLE_SEC,
    );
  });

  it("Valkey tắt (null) ⇒ fallback in-memory VẪN tiết lưu, không phát tràn", async () => {
    const { svc, emitChatTyping, setNx } = makeService();
    setNx.mockResolvedValue(null as never);

    await svc.ping(ACTOR, ROOM);
    await svc.ping(ACTOR, ROOM);
    await svc.ping(ACTOR, ROOM);

    expect(emitChatTyping).toHaveBeenCalledTimes(1);
  });

  it("fallback tách theo phòng — gõ ở phòng khác KHÔNG bị nuốt", async () => {
    const { svc, emitChatTyping, setNx } = makeService();
    setNx.mockResolvedValue(null as never);
    const otherRoom = "44444444-4444-4444-8444-444444444444";

    await svc.ping(ACTOR, ROOM);
    await svc.ping(ACTOR, otherRoom);

    expect(emitChatTyping).toHaveBeenCalledTimes(2);
  });
});

describe("CHAT-API-023 — phòng đã lưu trữ", () => {
  it("phòng lưu trữ ⇒ KHÔNG emit nhưng KHÔNG ném (vẫn 204)", async () => {
    const { svc, emitChatTyping } = makeService({ isArchived: true });

    await expect(svc.ping(ACTOR, ROOM)).resolves.toBeUndefined();
    expect(emitChatTyping).not.toHaveBeenCalled();
  });
});

describe("CHAT-API-023 — trả void ⇒ controller 204 cho mọi nhánh thành công", () => {
  let svc: ChatTypingService;

  beforeEach(() => {
    svc = makeService().svc;
  });

  it("nhánh phát bình thường trả undefined", async () => {
    await expect(svc.ping(ACTOR, ROOM)).resolves.toBeUndefined();
  });
});
