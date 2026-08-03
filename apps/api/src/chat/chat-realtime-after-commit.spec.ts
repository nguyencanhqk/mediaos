import { describe, expect, it, vi } from "vitest";
import { ChatMembersService } from "./chat-members.service";
import { ChatMessagesService } from "./chat-messages.service";
import { ChatMessageModerationService } from "./chat-message-moderation.service";
import { ChatRoomsService } from "./chat-rooms.service";
import type { RealtimeEmitterService } from "../realtime/realtime-emitter.service";

/**
 * S7-CHAT-RT-1 — BẤT BIẾN "emit SAU COMMIT" (SPEC-15 · §1.7 micro-plan).
 *
 * ═══ Vì sao mock `withTenant` phải CHẠY XONG callback rồi mới ném ═══
 * Một mock ném NGAY mà không gọi callback sẽ làm test XANH GIẢ: thân tx không chạy thì dĩ nhiên chẳng
 * emit gì, kể cả với code đặt emit SAI CHỖ (bên trong tx). Ở đây mock mô phỏng đúng ca thật "thân
 * transaction chạy hết, COMMIT thất bại" (deferred constraint · serialization failure · rớt kết nối
 * đúng lúc commit). Khi đó:
 *   • emit đặt ĐÚNG (sau `await withTenant`) ⇒ không bao giờ chạy  → ca test XANH;
 *   • emit đặt SAI (trong thân tx)          ⇒ chạy trước khi ném  → ca test ĐỎ.
 * Đó là điều làm những ca dưới đây RED-provable thật sự.
 *
 * Mỗi ca đều có POSITIVE CONTROL đi kèm: cùng đường đó khi tx commit BÌNH THƯỜNG thì PHẢI emit. Không
 * có nó, "0 lần gọi emit" có thể chỉ vì stub dựng sai và method chết trước khi tới chỗ emit.
 */

const COMPANY = "c0000000-0000-0000-0000-00000000000a";
const ACTOR = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", companyId: COMPANY };
const TARGET = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ROOM = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "99999999-9999-4999-8999-999999999999";

/** Bộ đếm mọi lối phát sự kiện realtime — 5 method, không sót lối nào. */
function makeRealtime() {
  return {
    emitChatMessage: vi.fn(),
    emitChatMessageRecalled: vi.fn(),
    emitChatRead: vi.fn(),
    emitChatRoom: vi.fn(),
    syncRoomMembership: vi.fn(),
  };
}

const totalCalls = (rt: ReturnType<typeof makeRealtime>): number =>
  Object.values(rt).reduce((n, spy) => n + spy.mock.calls.length, 0);

/** `commitFails=true` ⇒ chạy HẾT thân tx rồi mới ném (mô phỏng COMMIT hỏng). */
function makeDb(commitFails: boolean) {
  return {
    withTenant: vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) => {
      const result = await fn({});
      if (commitFails) throw new Error("COMMIT thất bại (mô phỏng)");
      return result;
    }),
  };
}

const ROOM_ROW = {
  id: ROOM,
  companyId: COMPANY,
  refId: null,
  roomType: "group" as const,
  name: "Phòng A",
  roomCode: "ROOM-0001",
  description: null,
  lastMessageAt: null,
  lastMessageSeq: 5,
  isArchived: false,
  syncSource: "manual",
  deletedAt: null,
  directKey: null,
  createdAt: new Date(),
};

const MEMBERSHIP = { id: "m1", role: "admin" as const, lastReadSeq: 2, visibleFromSeq: null };
const ACCESS = { room: ROOM_ROW, membership: MEMBERSHIP };

const audit = () => ({ record: vi.fn() });
const access = () => ({
  assertMember: vi.fn(async () => ACCESS),
  requireRoomAdmin: vi.fn(),
  assertMessageAccess: vi.fn(async () => ({
    room: ROOM_ROW,
    membership: MEMBERSHIP,
    message: { id: MESSAGE, roomId: ROOM, senderId: ACTOR.id, recalledAt: null, pinnedAt: null },
  })),
});

// ─────────────────────────────────────────────────────────────────────────────────
describe("emit SAU COMMIT — ChatMembersService", () => {
  /** `memberExists=false` cho đường `addMember` (người chưa từng ở trong phòng). */
  function build(commitFails: boolean, memberExists = true) {
    const realtime = makeRealtime();
    const repo = {
      findUsableUserIds: vi.fn(async () => new Set([TARGET])),
      findMemberRow: vi.fn(async () =>
        memberExists ? { id: "row1", role: "member" as const, leftAt: null } : null,
      ),
      reactivateMember: vi.fn(),
      insertMember: vi.fn(),
      setMemberLeft: vi.fn(),
      setMemberRole: vi.fn(),
      countActiveMembers: vi.fn(async () => ({ admins: 2, total: 3 })),
      listActiveMembers: vi.fn(async () => [
        { userId: TARGET, role: "member", lastReadSeq: 0, joinedAt: new Date(), fullName: "B" },
      ]),
    };
    const svc = new ChatMembersService(
      makeDb(commitFails) as never,
      repo as never,
      access() as never,
      audit() as never,
      realtime as unknown as RealtimeEmitterService,
    );
    return { svc, realtime };
  }

  it("removeMember: COMMIT hỏng → KHÔNG emit gì (0/5 lối)", async () => {
    const { svc, realtime } = build(true);
    await expect(svc.removeMember(ACTOR, ROOM, TARGET)).rejects.toThrow(/COMMIT/);
    expect(totalCalls(realtime)).toBe(0);
  });

  it("removeMember: POSITIVE CONTROL — commit OK thì PHẢI emit + đá khỏi room", async () => {
    const { svc, realtime } = build(false);
    await svc.removeMember(ACTOR, ROOM, TARGET);
    expect(realtime.emitChatRoom).toHaveBeenCalledTimes(1);
    expect(realtime.syncRoomMembership).toHaveBeenCalledWith(COMPANY, ROOM, TARGET, "leave");
  });

  it("addMember: COMMIT hỏng → KHÔNG emit gì", async () => {
    const { svc, realtime } = build(true, false);
    await expect(
      svc.addMember(ACTOR, ROOM, { userId: TARGET, role: "member" } as never),
    ).rejects.toThrow(/COMMIT/);
    expect(totalCalls(realtime)).toBe(0);
  });

  it("addMember: POSITIVE CONTROL — commit OK thì phát `member_added` + kéo người mới vào room", async () => {
    const { svc, realtime } = build(false, false);
    await svc.addMember(ACTOR, ROOM, { userId: TARGET, role: "member" } as never);
    expect(realtime.emitChatRoom.mock.calls[0]?.[3]).toEqual([TARGET]);
    expect(realtime.syncRoomMembership).toHaveBeenCalledWith(COMPANY, ROOM, TARGET, "join");
  });

  it("updateMemberRole: đổi VAI TRÒ KHÔNG đụng tư cách thành viên — 0 socketsJoin/socketsLeave", async () => {
    const { svc, realtime } = build(false);
    await svc.updateMemberRole(ACTOR, ROOM, TARGET, { role: "admin" } as never);
    expect(realtime.emitChatRoom).toHaveBeenCalledTimes(1);
    expect(realtime.emitChatRoom.mock.calls[0]?.[2]).toEqual({
      roomId: ROOM,
      action: "member_role_changed",
    });
    expect(realtime.syncRoomMembership).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
describe("emit SAU COMMIT — ChatMessagesService.markRead", () => {
  function build(commitFails: boolean, nextSeq: number) {
    const realtime = makeRealtime();
    const repo = { advanceLastReadSeq: vi.fn(async () => nextSeq) };
    const svc = new ChatMessagesService(
      makeDb(commitFails) as never,
      access() as never,
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      realtime as unknown as RealtimeEmitterService,
    );
    return { svc, realtime };
  }

  it("COMMIT hỏng → KHÔNG emit chat:read", async () => {
    const { svc, realtime } = build(true, 5);
    await expect(svc.markRead(ACTOR, ROOM, { seq: 5 } as never)).rejects.toThrow(/COMMIT/);
    expect(totalCalls(realtime)).toBe(0);
  });

  it("POSITIVE CONTROL — con trỏ TIẾN (2→5) thì PHẢI emit chat:read", async () => {
    const { svc, realtime } = build(false, 5);
    await svc.markRead(ACTOR, ROOM, { seq: 5 } as never);
    expect(realtime.emitChatRead).toHaveBeenCalledWith(COMPANY, ROOM, {
      roomId: ROOM,
      userId: ACTOR.id,
      lastReadSeq: 5,
    });
  });

  it("con trỏ KHÔNG đổi (gửi seq nhỏ hơn — `advanceLastReadSeq` kẹp ở SQL) → 0 chat:read", async () => {
    // `MEMBERSHIP.lastReadSeq = 2`; repo trả lại đúng 2 ⇒ no-op ⇒ không phát sự kiện rỗng nghĩa.
    const { svc, realtime } = build(false, 2);
    const res = await svc.markRead(ACTOR, ROOM, { seq: 1 } as never);
    expect(realtime.emitChatRead).not.toHaveBeenCalled();
    // REST không đổi hành vi: vẫn trả kết quả bình thường…
    expect(res.lastReadSeq).toBe(2);
    // …và cờ nội bộ `changed` KHÔNG được lọt ra DTO.
    expect(res).not.toHaveProperty("changed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
describe("emit SAU COMMIT — ChatMessageModerationService.recall", () => {
  function build(commitFails: boolean, alreadyRecalled: boolean) {
    const realtime = makeRealtime();
    const acc = access();
    if (alreadyRecalled) {
      acc.assertMessageAccess = vi.fn(async () => ({
        room: ROOM_ROW,
        membership: MEMBERSHIP,
        message: {
          id: MESSAGE,
          roomId: ROOM,
          senderId: ACTOR.id,
          recalledAt: new Date(),
          pinnedAt: null,
        },
      })) as never;
    }
    const repo = {
      setRecalled: vi.fn(),
      findMessageForDto: vi.fn(async () => ({ id: MESSAGE, roomId: ROOM })),
    };
    const svc = new ChatMessageModerationService(
      makeDb(commitFails) as never,
      acc as never,
      repo as never,
      audit() as never,
      { decorateOne: vi.fn(async (_a: unknown, row: unknown) => row) } as never,
      realtime as unknown as RealtimeEmitterService,
    );
    return { svc, realtime };
  }

  it("COMMIT hỏng → KHÔNG emit chat:message-recalled", async () => {
    const { svc, realtime } = build(true, false);
    await expect(svc.recall(ACTOR, MESSAGE)).rejects.toThrow(/COMMIT/);
    expect(totalCalls(realtime)).toBe(0);
  });

  it("POSITIVE CONTROL — thu hồi thật thì phát đúng 1 lần, payload KHÔNG có `body`", async () => {
    const { svc, realtime } = build(false, false);
    await svc.recall(ACTOR, MESSAGE);
    expect(realtime.emitChatMessageRecalled).toHaveBeenCalledTimes(1);
    const payload = realtime.emitChatMessageRecalled.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["messageId", "recalledAt", "roomId"]);
  });

  it("thu hồi lần HAI (idempotent) → 0 sự kiện (không phát bản thứ hai)", async () => {
    const { svc, realtime } = build(false, true);
    await svc.recall(ACTOR, MESSAGE);
    expect(realtime.emitChatMessageRecalled).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
describe("emit SAU COMMIT — ChatRoomsService.createGroup", () => {
  function build(commitFails: boolean) {
    const realtime = makeRealtime();
    const repo = {
      findUsableUserIds: vi.fn(async (_tx: unknown, _c: string, ids: string[]) => new Set(ids)),
      insertRoom: vi.fn(async () => ROOM_ROW),
      insertMember: vi.fn(),
    };
    const svc = new ChatRoomsService(
      makeDb(commitFails) as never,
      repo as never,
      access() as never,
      { allocate: vi.fn(async () => "ROOM-0001") } as never,
      audit() as never,
      realtime as unknown as RealtimeEmitterService,
    );
    return { svc, realtime };
  }

  it("COMMIT hỏng → KHÔNG emit chat:room{created}", async () => {
    const { svc, realtime } = build(true);
    await expect(
      svc.createGroup(ACTOR, { roomType: "group", name: "A", memberUserIds: [TARGET] } as never),
    ).rejects.toThrow(/COMMIT/);
    expect(totalCalls(realtime)).toBe(0);
  });

  it("POSITIVE CONTROL — tạo nhóm thì phát `created` tới TOÀN BỘ thành viên khởi tạo", async () => {
    const { svc, realtime } = build(false);
    await svc.createGroup(ACTOR, {
      roomType: "group",
      name: "A",
      memberUserIds: [TARGET],
    } as never);

    expect(realtime.emitChatRoom).toHaveBeenCalledTimes(1);
    // `affectedUserIds` = actor + người được mời. Chỉ nhắm `chatRoomName` là bắn vào phòng RỖNG —
    // phòng vừa tạo chưa socket nào join.
    expect(realtime.emitChatRoom.mock.calls[0]?.[3]).toEqual([ACTOR.id, TARGET]);
    expect(realtime.syncRoomMembership).toHaveBeenCalledTimes(2);
  });
});
