import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ChatCallCooldownService } from "./chat-call-cooldown.service";
import { ChatCallsService } from "./chat-calls.service";
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
const CALL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/**
 * Bộ đếm mọi lối phát **SAU COMMIT** — 6 method, không sót lối nào.
 *
 * ⚠️ **`evictFromCallRoom` CỐ Ý KHÔNG ở đây** (S7-CALL-RT-FIX-2). Nó là lối duy nhất được gọi **TRONG
 * tx** — vế AN NINH, cùng lập luận với `severUserSessions`: đặt sau commit là để hở đúng cửa sổ mà bản
 * vá dựng ra để đóng. Đưa nó vào bộ đếm này sẽ làm ca "COMMIT hỏng ⇒ 0 lối" khẳng định điều NGƯỢC LẠI
 * với thiết kế. Nó được spy RIÊNG ở từng `build()`, và ca test đo đúng sự BẤT ĐỐI XỨNG đó.
 */
function makeRealtime() {
  return {
    emitChatMessage: vi.fn(),
    emitChatMessageRecalled: vi.fn(),
    emitChatRead: vi.fn(),
    emitChatRoom: vi.fn(),
    syncRoomMembership: vi.fn(),
    // S7-CALL-RT-FIX-2 — `call:peer-left` khi một người bị gỡ/tự rời khỏi PHÒNG giữa cuộc gọi.
    emitCallPeerLeft: vi.fn(),
  };
}

/**
 * Tập khoá được đếm là **do `makeRealtime()` định nghĩa**, không phải một danh sách gõ tay song song.
 * Nhờ vậy: thêm một lối phát vào `makeRealtime` là nó tự vào bộ đếm (không có lối nào lọt lưới), còn
 * khoá THÊM trên object mở rộng (`evictFromCallRoom`) thì bị bỏ qua đúng như thiết kế — thay vì
 * `Object.values(rt)` vốn trải phẳng cả khoá mở rộng vào bộ đếm.
 */
const EMIT_KEYS = Object.keys(makeRealtime());

const totalCalls = (rt: Record<string, unknown>): number =>
  EMIT_KEYS.reduce((n, key) => {
    const spy = rt[key] as { mock?: { calls: unknown[] } } | undefined;
    return n + (spy?.mock?.calls.length ?? 0);
  }, 0);

/** Stub exit-service: "có ĐÚNG một cuộc gọi vừa bị đóng" — trả rỗng thì POSITIVE CONTROL xanh RỖNG. */
const callExit = () => ({
  closeCallParticipationOnRoomExit: vi.fn(async () => [{ callId: CALL }]),
});

describe("ratchet của chính bộ đếm", () => {
  it("đếm ĐÚNG 6 lối phát sau-commit, và `evictFromCallRoom` KHÔNG nằm trong đó", () => {
    // Thêm/bớt lối phát mà không cập nhật bài này = ĐỎ có chủ đích: bất biến "emit SAU COMMIT" chỉ có
    // giá trị khi bộ đếm biết hết các lối.
    expect(EMIT_KEYS).toHaveLength(6);
    expect(EMIT_KEYS).not.toContain("evictFromCallRoom");
  });
});

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
    // `evictFromCallRoom` NGOÀI `makeRealtime()` — xem docblock của bộ đếm.
    const realtime = { ...makeRealtime(), evictFromCallRoom: vi.fn() };
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
      // S8-CHAT-UX-FE-3 — hai phụ thuộc CHỈ dùng ở đường ĐỌC roster (`listMembers`). Bài test này đo
      // đường GHI (thêm/bớt/đổi vai trò) nên chúng không được gọi; stub ném để nếu một ngày đường ghi
      // lỡ chạm vào chúng thì bài đỏ NGAY, thay vì im lặng ký một URL trong một transaction ghi.
      {
        resolveEmployeeAvatars: () => {
          throw new Error("đường GHI không được ký avatar");
        },
      } as never,
      {
        getOnlineUserIds: () => {
          throw new Error("đường GHI không được đọc presence");
        },
      } as never,
      callExit() as never,
    );
    return { svc, realtime };
  }

  it("removeMember: COMMIT hỏng → KHÔNG emit gì (0/6 lối)", async () => {
    const { svc, realtime } = build(true);
    await expect(svc.removeMember(ACTOR, ROOM, TARGET)).rejects.toThrow(/COMMIT/);
    expect(totalCalls(realtime)).toBe(0);
  });

  /**
   * 🔴 S7-CALL-RT-FIX-2 — BẤT ĐỐI XỨNG là thứ đáng đóng đinh, không phải "0 lối".
   *
   * `evictFromCallRoom` (kéo socket nạn nhân khỏi room cuộc gọi) là vế AN NINH và PHẢI chạy TRONG tx —
   * nên nó vẫn được gọi kể cả khi COMMIT hỏng sau đó (rollback ⇒ nạn nhân chỉ mất realtime tới lần
   * reconnect: chiều fail-safe). `emitCallPeerLeft` thì ngược lại: phát trước commit rồi rollback là NÓI
   * DỐI với người còn lại. Chuyển `evictFromCallRoom` ra sau commit làm ca này ĐỎ.
   */
  it("removeMember: COMMIT hỏng → 0/6 lối phát NHƯNG evictFromCallRoom VẪN chạy 1 lần (trong tx)", async () => {
    const { svc, realtime } = build(true);
    await expect(svc.removeMember(ACTOR, ROOM, TARGET)).rejects.toThrow(/COMMIT/);
    expect(totalCalls(realtime)).toBe(0);
    expect(realtime.evictFromCallRoom).toHaveBeenCalledTimes(1);
    expect(realtime.evictFromCallRoom).toHaveBeenCalledWith(COMPANY, CALL, TARGET);
  });

  it("removeMember: POSITIVE CONTROL — commit OK thì PHẢI emit + đá khỏi room", async () => {
    const { svc, realtime } = build(false);
    await svc.removeMember(ACTOR, ROOM, TARGET);
    expect(realtime.emitChatRoom).toHaveBeenCalledTimes(1);
    expect(realtime.syncRoomMembership).toHaveBeenCalledWith(COMPANY, ROOM, TARGET, "leave");
  });

  it("removeMember: POSITIVE CONTROL — commit OK thì phát `call:peer-left` đúng 1 lần", async () => {
    const { svc, realtime } = build(false);
    await svc.removeMember(ACTOR, ROOM, TARGET);
    expect(realtime.emitCallPeerLeft).toHaveBeenCalledTimes(1);
    expect(realtime.emitCallPeerLeft).toHaveBeenCalledWith(COMPANY, CALL, TARGET);
  });

  /**
   * 🔴 S7-CALL-RT-FIX-2 — CỬA SỔ REJOIN. `evictFromCallRoom` phải chạy **HAI** lần trên đường thành
   * công: một trong tx (đóng ngay, fail-safe nếu rollback) và một SAU commit.
   *
   * Vế thứ hai không phải phòng xa: giữa evict-trong-tx và COMMIT, một tx khác (gateway xử `call:join`)
   * đọc READ COMMITTED nên chưa thấy `left_at`/`outcome` mới ⇒ nó chấp nhận join và `socketsJoin` đưa
   * nạn nhân TRỞ LẠI `callRoomName`; không có lần evict thứ hai thì `media-state`/`screen-state` mở lại
   * tới khi socket rớt. Gỡ lần evict sau-commit làm ca này ĐỎ (2 → 1) — đó là toàn bộ lý do nó tồn tại.
   *
   * Cặp với ca "COMMIT hỏng → 1 lần" ở trên: chính CẶP SỐ (1 khi hỏng, 2 khi OK) mới đóng đinh được cả
   * hai vế. Một mình `toHaveBeenCalled()` thì dời evict đi đâu cũng xanh.
   */
  it("removeMember: POSITIVE CONTROL — commit OK thì evictFromCallRoom chạy ĐÚNG 2 lần (trong tx + sau commit)", async () => {
    const { svc, realtime } = build(false);
    await svc.removeMember(ACTOR, ROOM, TARGET);
    expect(realtime.evictFromCallRoom).toHaveBeenCalledTimes(2);
    expect(realtime.evictFromCallRoom).toHaveBeenNthCalledWith(1, COMPANY, CALL, TARGET);
    expect(realtime.evictFromCallRoom).toHaveBeenNthCalledWith(2, COMPANY, CALL, TARGET);
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
    const realtime = { ...makeRealtime(), evictFromCallRoom: vi.fn() };
    const repo = {
      findUsableUserIds: vi.fn(async (_tx: unknown, _c: string, ids: string[]) => new Set(ids)),
      insertRoom: vi.fn(async () => ROOM_ROW),
      insertMember: vi.fn(),
      // S7-CALL-RT-FIX-2 — cần cho `leaveRoom` (describe dưới dùng lại `build` này).
      // `admins: 2` ⇒ không chạm luật admin CUỐI CÙNG (CHAT-ERR-011).
      countActiveMembers: vi.fn(async () => ({ admins: 2, total: 3 })),
      setMemberLeft: vi.fn(),
    };
    const svc = new ChatRoomsService(
      makeDb(commitFails) as never,
      repo as never,
      access() as never,
      { allocate: vi.fn(async () => "ROOM-0001") } as never,
      audit() as never,
      realtime as unknown as RealtimeEmitterService,
      // S8-CHAT-UX-BE-2 — `ChatRoomAvatarPresignService`. Các đường trong file này (createGroup /
      // updateRoom / archive…) KHÔNG ký avatar (chỉ `listRooms`/`getRoom` ký), nên stub trả map RỖNG
      // là đủ VÀ đúng: nếu một ngày chúng bắt đầu ký, ca test thấy `avatarUrl: null` — không phải URL giả.
      { resolveRoomAvatars: vi.fn(async () => new Map<string, string>()) } as never,
      callExit() as never,
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

  /**
   * 🔴 S7-CALL-RT-FIX-2 — cửa vào THỨ HAI của cùng một lỗ.
   *
   * `leaveRoom` (rời TỰ NGUYỆN) và `removeMember` (bị gỡ) đi qua cùng `setMemberLeft`, nên vá một cửa
   * là vá được một nửa. `describe` này trước đây KHÔNG có ca `leaveRoom` nào — đó chính là lý do nửa
   * còn lại của lỗ có thể land mà không ai thấy.
   */
  it("leaveRoom: COMMIT hỏng → 0/6 lối phát NHƯNG evictFromCallRoom VẪN chạy 1 lần (trong tx)", async () => {
    const { svc, realtime } = build(true);
    await expect(svc.leaveRoom(ACTOR, ROOM)).rejects.toThrow(/COMMIT/);
    expect(totalCalls(realtime)).toBe(0);
    // SỐ LẦN, không chỉ đối số: thiếu nó thì dời vế sau-commit lên trước commit vẫn xanh ở ca này.
    expect(realtime.evictFromCallRoom).toHaveBeenCalledTimes(1);
    expect(realtime.evictFromCallRoom).toHaveBeenCalledWith(COMPANY, CALL, ACTOR.id);
  });

  it("leaveRoom: POSITIVE CONTROL — commit OK thì phát `call:peer-left` đúng 1 lần cho CHÍNH actor", async () => {
    const { svc, realtime } = build(false);
    await svc.leaveRoom(ACTOR, ROOM);
    expect(realtime.emitCallPeerLeft).toHaveBeenCalledTimes(1);
    // Người bị đóng ở cửa này là CHÍNH actor (khác `removeMember`, nơi đó là người thứ ba).
    expect(realtime.emitCallPeerLeft).toHaveBeenCalledWith(COMPANY, CALL, ACTOR.id);
  });

  /** Cửa sổ REJOIN ở cửa vào THỨ HAI — lập luận đầy đủ ở ca cùng tên của `ChatMembersService`. */
  it("leaveRoom: POSITIVE CONTROL — commit OK thì evictFromCallRoom chạy ĐÚNG 2 lần (trong tx + sau commit)", async () => {
    const { svc, realtime } = build(false);
    await svc.leaveRoom(ACTOR, ROOM);
    expect(realtime.evictFromCallRoom).toHaveBeenCalledTimes(2);
    expect(realtime.evictFromCallRoom).toHaveBeenNthCalledWith(1, COMPANY, CALL, ACTOR.id);
    expect(realtime.evictFromCallRoom).toHaveBeenNthCalledWith(2, COMPANY, CALL, ACTOR.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
/**
 * S7-CALL-RT-1 — vòng đời CUỘC GỌI. `S7-CALL-BE-1` cố ý để trống đường phát (luật 4 cũ của
 * `ChatCallsService`); WO này gắn nó, nên bất biến "emit SAU COMMIT" phải phủ luôn 6 lối mới.
 *
 * ⚠️ Ca cuối cùng ĐẾM SỐ LỐI. Không phải để làm đẹp: một lối phát mới cắm vào giữa transaction là đúng
 * lớp lỗi mà cả file này tồn tại để chặn, và nó KHÔNG hiện ra ở bất kỳ ca hành vi nào khác (mỗi ca chỉ
 * đo đường của chính nó).
 */
describe("emit SAU COMMIT — ChatCallsService (S7-CALL-RT-1)", () => {
  const CALL_ROW = {
    id: CALL,
    companyId: COMPANY,
    roomId: ROOM,
    initiatorUserId: ACTOR.id,
    kind: "audio" as const,
    status: "ringing" as const,
    startedAt: new Date("2026-08-10T10:00:00.000Z"),
    acceptedAt: null,
    endedAt: null,
  };

  /** `expiredRows` mô phỏng bước dọn-trước-khi-mời tìm thấy một cuộc gọi treo. */
  function build(commitFails: boolean, expiredRows: { id: string }[] = []) {
    const realtime = { emitChatCall: vi.fn() };
    const repo = {
      activeMemberIds: vi.fn(async () => [ACTOR.id, TARGET]),
      insertCall: vi.fn(async () => CALL_ROW),
      insertParticipants: vi.fn(),
      listParticipants: vi.fn(async () => [
        {
          userId: ACTOR.id,
          invitedAt: CALL_ROW.startedAt,
          joinedAt: null,
          leftAt: null,
          outcome: null,
        },
        {
          userId: TARGET,
          invitedAt: CALL_ROW.startedAt,
          joinedAt: null,
          leftAt: null,
          outcome: null,
        },
      ]),
      expireStaleRinging: vi.fn(async () =>
        expiredRows.map((r) => ({
          id: r.id,
          roomId: ROOM,
          kind: "audio" as const,
          initiatorUserId: TARGET,
          startedAt: CALL_ROW.startedAt,
        })),
      ),
      transition: vi.fn(async () => ({
        ...CALL_ROW,
        status: "ended" as const,
        endedAt: new Date(),
      })),
      setParticipantOutcome: vi.fn(async () => true),
      closeOpenParticipants: vi.fn(async () => 0),
      findParticipant: vi.fn(async () => ({
        userId: ACTOR.id,
        invitedAt: CALL_ROW.startedAt,
        joinedAt: null,
        leftAt: null,
        outcome: null,
      })),
    };
    const callAccess = {
      assertMember: vi.fn(async () => ACCESS),
      assertCallAccess: vi.fn(async () => ({ ...ACCESS, call: CALL_ROW })),
    };
    const svc = new ChatCallsService(
      makeDb(commitFails) as never,
      repo as never,
      callAccess as never,
      audit() as never,
      // Cooldown thật nhưng luôn cho qua trong ca này (ngưỡng mặc định 10/phút, ca chỉ gọi 1-2 lần).
      new ChatCallCooldownService() as never,
      realtime as unknown as RealtimeEmitterService,
    );
    return { svc, realtime };
  }

  it("invite: COMMIT hỏng → KHÔNG emit chat:call", async () => {
    const { svc, realtime } = build(true);
    await expect(svc.invite(ACTOR, ROOM, { kind: "audio" })).rejects.toThrow(/COMMIT/);
    expect(realtime.emitChatCall).not.toHaveBeenCalled();
  });

  it("invite: POSITIVE CONTROL — commit OK thì phát `ringing` tới ĐÚNG người tham gia", async () => {
    const { svc, realtime } = build(false);
    await svc.invite(ACTOR, ROOM, { kind: "audio" });

    expect(realtime.emitChatCall).toHaveBeenCalledTimes(1);
    const [companyId, targets, payload] = realtime.emitChatCall.mock.calls[0] ?? [];
    expect(companyId).toBe(COMPANY);
    // Đích là bảng participants, KHÔNG phải danh sách thành viên phòng.
    expect(targets).toEqual([ACTOR.id, TARGET]);
    expect(payload).toMatchObject({ callId: CALL, roomId: ROOM, action: "ringing" });
    // Payload KHÔNG mang `participants[]` (per-user: outcome/joinedAt của người khác).
    expect(Object.keys(payload as object).sort()).toEqual([
      "action",
      "callId",
      "initiatorUserId",
      "kind",
      "roomId",
      "startedAt",
      "status",
    ]);
  });

  it("invite: cuộc gọi CŨ bị bước dọn đánh nhỡ cũng phải được BÁO (nếu không, máy kia còn đổ chuông)", async () => {
    const { svc, realtime } = build(false, [{ id: "11111111-1111-4111-8111-111111111111" }]);
    await svc.invite(ACTOR, ROOM, { kind: "audio" });

    expect(realtime.emitChatCall).toHaveBeenCalledTimes(2);
    expect(realtime.emitChatCall.mock.calls[0]?.[2]).toMatchObject({ action: "missed" });
    expect(realtime.emitChatCall.mock.calls[1]?.[2]).toMatchObject({ action: "ringing" });
  });

  it("hangup: COMMIT hỏng → KHÔNG emit; commit OK → đúng 1 sự kiện `ended`", async () => {
    const failed = build(true);
    await expect(failed.svc.hangup(ACTOR, CALL)).rejects.toThrow(/COMMIT/);
    expect(failed.realtime.emitChatCall).not.toHaveBeenCalled();

    const ok = build(false);
    await ok.svc.hangup(ACTOR, CALL);
    expect(ok.realtime.emitChatCall).toHaveBeenCalledTimes(1);
    expect(ok.realtime.emitChatCall.mock.calls[0]?.[2]).toMatchObject({ action: "ended" });
  });

  it("ĐẾM LỐI PHÁT: đúng 2 call site trong service (`lifecycleTx` dùng chung cho 4 route) + 1 ở job", () => {
    // Ratchet cấu trúc — ca hành vi ở trên không thấy được một lối phát thứ ba cắm vào giữa transaction.
    const src = readFileSync(join(__dirname, "chat-calls.service.ts"), "utf8").replace(
      /\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm,
      "$1",
    );
    // 2 → 3 ở S10-CHAT-CALLSWEEP-1 (KI-063): lối thứ BA là `emitAutoEnded`, cho job gặt cuộc gọi
    // `active` mồ côi. Con số này chỉ được nâng KÈM một helper mới có tên — nâng trần để "cho qua" một
    // `emitChatCall` rải giữa thân transaction là gỡ đúng thứ ratchet này canh.
    expect(src.match(/this\.realtime\.emitChatCall\(/g) ?? []).toHaveLength(3);
    // Và cả ba nằm trong ba helper, không rải trong thân transaction.
    expect(src).toMatch(/private emitLifecycle\(/);
    expect(src).toMatch(/emitExpired\(/);
    expect(src).toMatch(/emitAutoEnded\(/);

    const job = readFileSync(join(__dirname, "chat-call-ringing-timeout.job-handler.ts"), "utf8");
    expect(job.match(/this\.calls\.emitExpired\(/g) ?? []).toHaveLength(1);

    // Job gặt: đúng MỘT lối phát, và nó nằm NGOÀI `withTenant` — phát trong tx là phát một sự thật có
    // thể bị rollback (đúng luật 4 của `ChatCallsService`).
    const sweep = readFileSync(
      join(__dirname, "chat-call-stale-active-sweep.job-handler.ts"),
      "utf8",
    );
    expect(sweep.match(/this\.calls\.emitAutoEnded\(/g) ?? []).toHaveLength(1);
    expect(sweep.indexOf("emitAutoEnded(")).toBeGreaterThan(sweep.indexOf("withTenant("));

    // Cùng vế cho job ring-timeout — nó vốn thiếu, và "hai job đối xứng" không thể chỉ đúng một nửa.
    expect(job.indexOf("emitExpired(")).toBeGreaterThan(job.indexOf("withTenant("));
  });

  it("ĐỐI XỨNG HAI JOB (KI-075): cả hai TIÊU THỤ số đếm emit hỏng, không job nào bỏ tín hiệu", () => {
    // S10-CHAT-CALLSWEEP-1 hoãn KI-075 với đúng lý do "vá một mình job mới sẽ làm hai job lệch chuẩn
    // nhau". Ratchet này là thứ biến việc tái diễn đó thành ĐỎ: sau khi `emitExpired`/`emitAutoEnded`
    // nuốt lỗi per-item, giá trị trả về là tín hiệu DUY NHẤT còn lại (`JobRunResult.failed` +
    // `metadata.emitFailed`) — một job bỏ nó đi là mất chuông trở thành im lặng tuyệt đối.
    const job = readFileSync(join(__dirname, "chat-call-ringing-timeout.job-handler.ts"), "utf8");
    const sweep = readFileSync(
      join(__dirname, "chat-call-stale-active-sweep.job-handler.ts"),
      "utf8",
    );

    expect(job).toMatch(/const emitFailed = this\.calls\.emitExpired\(/);
    expect(sweep).toMatch(/const emitFailed = this\.calls\.emitAutoEnded\(/);

    // Và tiêu thụ THẬT vào kết quả — gán rồi bỏ đó thì `failed` vẫn là hằng 0.
    for (const src of [job, sweep]) {
      expect(src).toMatch(/failed: emitFailed/);
      expect(src).toMatch(/emitFailed > 0 \? \{ emitFailed \} : \{\}/);
    }

    // Helper phải KHAI kiểu trả về `number` — đổi ngược về `void` làm hai dòng trên không compile,
    // nhưng ratchet nói thẳng ra thì người sửa biết mình đang tháo cái gì.
    const svc = readFileSync(join(__dirname, "chat-calls.service.ts"), "utf8");
    expect(svc).toMatch(
      /emitExpired\(companyId: string, expiries: readonly ChatCallExpiry\[\]\): number/,
    );
    expect(svc).toMatch(
      /emitAutoEnded\(companyId: string, expiries: readonly ChatCallExpiry\[\]\): number/,
    );
  });
});
