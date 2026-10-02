import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeEmitterService } from "./realtime-emitter.service";
import { chatUserRoomName, feedGroupRoomName, feedUserRoomName, userRoomName } from "./rooms";

/**
 * S16-SOCIAL-BE-2C — room nhóm bảng tin ở tầng EMITTER (plan §5 W1 · N1).
 *
 * Assert theo BỘ CHỌN + ĐÍCH của room-op, KHÔNG theo «có gọi»: một spy suông xanh cả khi lệnh join quét
 * nhầm `userRoomName` — tức kéo socket TRƯỢT cổng `view:feed` vào room nhóm (D-OWNER-2, M2 a′).
 * Khuôn `realtime-emitter.chat.spec.ts` (`syncRoomMembership`).
 */

const COMPANY = "c0000000-0000-0000-0000-00000000000a";
const OTHER_COMPANY = "c0000000-0000-0000-0000-00000000000b";
const GROUP = "61000000-0000-4000-8000-000000000001";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeServer() {
  const emit = vi.fn();
  const socketsJoin = vi.fn();
  const socketsLeave = vi.fn();
  const toTargets: unknown[] = [];
  const inTargets: string[] = [];
  const server = {
    to: vi.fn((t: unknown) => {
      toTargets.push(t);
      return { emit };
    }),
    in: vi.fn((t: string) => {
      inTargets.push(t);
      return { socketsJoin, socketsLeave };
    }),
  };
  return { server, emit, socketsJoin, socketsLeave, toTargets, inTargets };
}

function makeEmitter() {
  const h = makeServer();
  const svc = new RealtimeEmitterService();
  svc.setServer(h.server as never);
  return { svc, ...h };
}

describe("RealtimeEmitterService — room nhóm bảng tin (S16-SOCIAL-BE-2C)", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  // ─── W1 — bộ chọn của join/leave ───────────────────────────────────────────────
  it("🔒 W1a syncFeedGroupMembership('join') quét FEED-USER-room — socket trượt view:feed không bị kéo vào nhóm", () => {
    const { svc, server, socketsJoin, socketsLeave, inTargets } = makeEmitter();

    svc.syncFeedGroupMembership(COMPANY, GROUP, USER, "join");

    // `userRoomName` chứa MỌI socket đã xác thực (đích NOTI) — kể cả socket đã trượt cổng `view:feed`.
    // `chatUserRoomName` là room đánh dấu của CỔNG KHÁC (`view:chat-room`): người có chat mà không có
    // feed sẽ bị kéo vào room nhóm nếu nhầm hai room đánh dấu.
    expect(server.in).not.toHaveBeenCalledWith(userRoomName(COMPANY, USER));
    expect(server.in).not.toHaveBeenCalledWith(chatUserRoomName(COMPANY, USER));
    expect(inTargets).toEqual([feedUserRoomName(COMPANY, USER)]);
    expect(socketsJoin).toHaveBeenCalledWith(feedGroupRoomName(COMPANY, GROUP));
    expect(socketsLeave).not.toHaveBeenCalled();
  });

  it("W1b syncFeedGroupMembership('leave') quét user-room (RỘNG HƠN) — rời nhầm là fail-safe, sót là rò", () => {
    const { svc, server, socketsJoin, socketsLeave } = makeEmitter();

    svc.syncFeedGroupMembership(COMPANY, GROUP, USER, "leave");

    expect(server.in).toHaveBeenCalledWith(userRoomName(COMPANY, USER));
    expect(server.in).not.toHaveBeenCalledWith(feedUserRoomName(COMPANY, USER));
    expect(socketsLeave).toHaveBeenCalledWith(feedGroupRoomName(COMPANY, GROUP));
    expect(socketsJoin).not.toHaveBeenCalled();
  });

  it("W1c chưa setServer (REALTIME_ENABLED=false / gateway chưa init) ⇒ no-op, KHÔNG ném", () => {
    const svc = new RealtimeEmitterService();
    expect(() => {
      svc.syncFeedGroupMembership(COMPANY, GROUP, USER, "join");
      svc.syncFeedGroupMembership(COMPANY, GROUP, USER, "leave");
    }).not.toThrow();
  });

  it("room-op NÉM ⇒ nuốt + warn, KHÔNG ném lên caller (caller có thể đang ở trong tx — Q-LEAVE)", () => {
    const { svc, server } = makeEmitter();
    server.in.mockImplementation(() => {
      throw new Error("adapter down");
    });

    expect(() => svc.syncFeedGroupMembership(COMPANY, GROUP, USER, "leave")).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  // ─── N1 — tên room ─────────────────────────────────────────────────────────────
  it("N1 tên room: tiền tố tenant · room đánh dấu feed KHÁC room đánh dấu chat và user-room", () => {
    expect(feedGroupRoomName(COMPANY, GROUP)).toBe(`co:${COMPANY}:feedgroup:${GROUP}`);
    expect(feedGroupRoomName(COMPANY, GROUP)).not.toBe(feedGroupRoomName(OTHER_COMPANY, GROUP));
    expect(feedUserRoomName(COMPANY, USER)).not.toBe(feedUserRoomName(OTHER_COMPANY, USER));
    const markers = new Set([
      feedUserRoomName(COMPANY, USER),
      userRoomName(COMPANY, USER),
      chatUserRoomName(COMPANY, USER),
    ]);
    expect(markers.size).toBe(3);
  });

  it("CHAT `syncRoomMembership` KHÔNG đổi hành vi sau khi rút lõi chung (D-OWNER-2 tái dùng cơ chế)", () => {
    // Lưới hồi quy đầy đủ ở `realtime-emitter.chat.spec.ts`; ca này chỉ chốt rằng lõi chung không làm
    // nhánh CHAT quét nhầm room đánh dấu của FEED.
    const { svc, server } = makeEmitter();
    svc.syncRoomMembership(COMPANY, GROUP, USER, "join");
    expect(server.in).not.toHaveBeenCalledWith(feedUserRoomName(COMPANY, USER));
  });
});
