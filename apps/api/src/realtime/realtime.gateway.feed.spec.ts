import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeGateway } from "./realtime.gateway";
import {
  chatRoomName,
  chatUserRoomName,
  feedGroupRoomName,
  feedRoomName,
  feedUserRoomName,
  userRoomName,
} from "./rooms";
import type { TokenService } from "../auth/token.service";
import type { RealtimeEmitterService } from "./realtime-emitter.service";
import type { PermissionService } from "../permission/permission.service";
import type { ChatRoomsRepository } from "../chat/chat-rooms.repository";
import type { DatabaseService } from "../db/db.service";

/**
 * S16-SOCIAL-BE-2C — khối bảng tin của `handleConnection`: cổng `view:feed` · room ĐÁNH DẤU
 * `feeduser` · join room nhóm từ DB phía server · đọc LẠI tự vá · dọn room nhóm khi lỗi (plan §4.4,
 * §5 GW1–GW6, bất biến 10).
 *
 * UNIT có chủ ý (không DB, không socket.io thật): hai cửa sổ đua (connect↔`038` duyệt, connect↔`036/039`
 * gỡ) được khoá TẤT ĐỊNH bằng THỨ TỰ (GW3) + kịch bản đọc lại (GW4) + lỗi ở lần đọc lại (GW5b) — thứ mà
 * một int-spec chỉ bắt được khi trúng giờ.
 */

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY = "c0000000-0000-0000-0000-00000000000a";
const G1 = "61000000-0000-4000-8000-000000000001";
const G2 = "62000000-0000-4000-8000-000000000002";
const ROOM_1 = "11111111-1111-4111-8111-111111111111";

/** Một lượt đọc của reader: danh sách nhóm, hoặc một lỗi để NÉM. */
type Read = string[] | Error;

function makeSocket(opts: { leaveThrowsFor?: (room: string) => boolean } = {}) {
  const joined: string[] = [];
  const left: string[] = [];
  /** Chuỗi sự kiện có thứ tự — GW3 đo «feeduser join TRƯỚC lần đọc nhóm đầu tiên». */
  const seq: string[] = [];
  return {
    id: "sock-1",
    data: { user: { id: USER, companyId: COMPANY } },
    joined,
    left,
    seq,
    join: vi.fn(async (room: string) => {
      seq.push(`join:${room}`);
      joined.push(room);
    }),
    leave: vi.fn(async (room: string) => {
      if (opts.leaveThrowsFor?.(room)) throw new Error(`leave ${room} thất bại (mô phỏng)`);
      seq.push(`leave:${room}`);
      left.push(room);
    }),
    disconnect: vi.fn(),
    handshake: { auth: {}, headers: {} },
  };
}

function makeGateway(over: { feedAllow?: boolean; chatAllow?: boolean; reads?: Read[] }) {
  const reads = over.reads ?? [[]];
  let call = 0;
  let socketSeq: string[] | null = null;
  const listActiveGroupIds = vi.fn(async (_companyId: string, _userId: string) => {
    socketSeq?.push("read");
    const r = reads[Math.min(call, reads.length - 1)] ?? [];
    call += 1;
    if (r instanceof Error) throw r;
    return r;
  });
  const permissions = {
    can: vi.fn(async (q: { resourceType: string }) => ({
      allow: q.resourceType === "feed" ? (over.feedAllow ?? true) : (over.chatAllow ?? true),
      reason: "ok",
      auditRequired: false,
    })),
  } as unknown as PermissionService;
  const listRoomsForUser = vi.fn(async () => [{ id: ROOM_1 }]);
  const db = {
    withTenant: vi.fn(async (_c: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  } as unknown as DatabaseService;
  const presence = {
    markOnline: vi.fn(async () => {}),
    markOffline: vi.fn(async () => {}),
    refreshLocal: vi.fn(async () => {}),
  };

  const gw = new RealtimeGateway(
    { verifyAccessToken: vi.fn() } as unknown as TokenService,
    { setServer: vi.fn() } as unknown as RealtimeEmitterService,
    permissions,
    { listRoomsForUser } as unknown as ChatRoomsRepository,
    db,
    presence as never,
    // S16-SOCIAL-BE-2C — tham số MỚI ở CUỐI (plan M12): reader liệt kê nhóm, tiêm DI, KHÔNG qua `this.db`
    // (M11: bộ đếm `withTenant` của spec CHAT không được lệch).
    { listActiveGroupIds } as never,
  );
  const connect = async (client: ReturnType<typeof makeSocket>) => {
    socketSeq = client.seq;
    await gw.handleConnection(client as never);
  };
  return { gw, connect, permissions, listActiveGroupIds, listRoomsForUser };
}

const groupRooms = (rooms: readonly string[]) => rooms.filter((r) => r.includes(":feedgroup:"));

describe("RealtimeGateway.handleConnection — khối bảng tin (S16-SOCIAL-BE-2C)", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    process.env.REALTIME_ENABLED = "true";
    vi.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
    warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    error = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.REALTIME_ENABLED;
  });

  it("GW1 có view:feed ⇒ join feed + feeduser + MỌI room nhóm đọc từ DB; reader nhận ĐÚNG (company, user) của socket", async () => {
    const { connect, listActiveGroupIds } = makeGateway({ reads: [[G1, G2]] });
    const client = makeSocket();

    await connect(client);

    expect(client.joined).toEqual(
      expect.arrayContaining([
        userRoomName(COMPANY, USER),
        feedRoomName(COMPANY),
        feedUserRoomName(COMPANY, USER),
        feedGroupRoomName(COMPANY, G1),
        feedGroupRoomName(COMPANY, G2),
      ]),
    );
    // companyId/userId lấy TỪ `socket.data.user` (server-side) — không từ handshake.
    for (const args of listActiveGroupIds.mock.calls) expect(args).toEqual([COMPANY, USER]);
    expect(client.left).toEqual([]);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it("🔒 GW2 THIẾU view:feed (chat vẫn cho) ⇒ 0 room bảng tin nào, reader KHÔNG được gọi; NOTI + CHAT sống", async () => {
    const { connect, listActiveGroupIds } = makeGateway({ feedAllow: false, reads: [[G1]] });
    const client = makeSocket();

    await connect(client);

    // Neo dương: phiên sống tới hết khối CHAT (nếu không, «0 room feed» có thể chỉ vì chết sớm).
    expect(client.joined).toContain(userRoomName(COMPANY, USER));
    expect(client.joined).toContain(chatUserRoomName(COMPANY, USER));
    expect(client.joined).not.toContain(feedRoomName(COMPANY));
    expect(client.joined).not.toContain(feedUserRoomName(COMPANY, USER));
    expect(groupRooms(client.joined)).toEqual([]);
    // Không tra nhóm cho người đã bị cổng chặn — membership KHÔNG thay được cặp quyền.
    expect(listActiveGroupIds).not.toHaveBeenCalled();
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it("GW3 room đánh dấu `feeduser` được join TRƯỚC lần đọc nhóm đầu tiên (đóng đua với `038` duyệt)", async () => {
    // Hoặc `socketsJoin` sau-commit của `038` thấy socket đã ở `feeduser`, hoặc lần đọc của gateway (sau
    // commit) thấy hàng `active` — không có khe nào mà cả hai cùng trượt.
    const { connect } = makeGateway({ reads: [[G1]] });
    const client = makeSocket();

    await connect(client);

    const marker = `join:${feedUserRoomName(COMPANY, USER)}`;
    expect(client.seq).toContain(marker);
    expect(client.seq).toContain("read");
    expect(client.seq.indexOf(marker)).toBeLessThan(client.seq.indexOf("read"));
  });

  it("GW4 tự vá: nhóm biến mất giữa hai lần đọc ⇒ RỜI đúng room đó, giữ room còn hợp lệ", async () => {
    // Đua connect ↔ `036/039`: lệnh leave sau-commit chạy lúc socket CHƯA join room nhóm (no-op), rồi
    // vòng join của gateway mới đưa socket vào room vừa bị gỡ.
    const { connect } = makeGateway({ reads: [[G1, G2], [G2]] });
    const client = makeSocket();

    await connect(client);

    expect(client.left).toEqual([feedGroupRoomName(COMPANY, G1)]);
    expect(client.joined).toContain(feedGroupRoomName(COMPANY, G2));
    expect(client.left).not.toContain(feedGroupRoomName(COMPANY, G2));
  });

  it("GW5a lần đọc ĐẦU ném ⇒ feed + feeduser vẫn ở, 0 room nhóm; warn (không error), KHÔNG ngắt; CHAT vẫn join", async () => {
    const { connect } = makeGateway({ reads: [new Error("DB down")] });
    const client = makeSocket();

    await connect(client);

    expect(client.joined).toContain(feedUserRoomName(COMPANY, USER));
    expect(client.joined).toContain(feedRoomName(COMPANY));
    expect(groupRooms(client.joined)).toEqual([]);
    expect(client.left).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(client.disconnect).not.toHaveBeenCalled();
    // Neo: một trục trặc bảng tin KHÔNG được ngắt phiên chat (Q-GWFAIL).
    expect(client.joined).toContain(chatUserRoomName(COMPANY, USER));
    expect(client.joined).toContain(chatRoomName(COMPANY, ROOM_1));
  });

  it("🔒 GW5b lần đọc LẠI ném (sau vòng join) ⇒ RỜI MỌI room nhóm vừa join — fail-CLOSED; phiên + feeduser sống", async () => {
    // Đúng cửa sổ BLOCKER plan-review F1: socket ĐÃ ở mọi room của lần đọc 1 (kể cả room vừa bị
    // `036/039` gỡ — thứ mà lần đọc lại sinh ra để vá). Chỉ `warn` mà không dọn = fail-OPEN.
    const { connect } = makeGateway({ reads: [[G1, G2], new Error("DB down giữa chừng")] });
    const client = makeSocket();

    await connect(client);

    expect(client.left).toEqual(
      expect.arrayContaining([feedGroupRoomName(COMPANY, G1), feedGroupRoomName(COMPANY, G2)]),
    );
    expect(client.left).not.toContain(feedUserRoomName(COMPANY, USER));
    expect(client.left).not.toContain(feedRoomName(COMPANY));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.joined).toContain(chatUserRoomName(COMPANY, USER));
  });

  it("GW5d dọn room nhóm CŨNG lỗi ⇒ error + disconnect(true), KHÔNG chạy khối CHAT trên socket đã ngắt", async () => {
    const { connect, permissions, listRoomsForUser } = makeGateway({
      reads: [[G1, G2], new Error("DB down giữa chừng")],
    });
    const client = makeSocket({ leaveThrowsFor: (room) => room.includes(":feedgroup:") });

    await connect(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(error).toHaveBeenCalledTimes(1);
    // Khối CHAT không chạy: `can` đúng MỘT lần (cổng feed), không tra phòng chat.
    expect(permissions.can).toHaveBeenCalledTimes(1);
    expect(listRoomsForUser).not.toHaveBeenCalled();
  });

  it("GW6 có view:feed nhưng THIẾU view:chat-room ⇒ room nhóm VẪN join (khối feed đứng TRƯỚC `return` của CHAT)", async () => {
    const { connect } = makeGateway({ chatAllow: false, reads: [[G1]] });
    const client = makeSocket();

    await connect(client);

    expect(client.joined).toContain(feedGroupRoomName(COMPANY, G1));
    expect(client.joined).toContain(feedUserRoomName(COMPANY, USER));
    expect(client.joined).not.toContain(chatUserRoomName(COMPANY, USER));
    expect(client.disconnect).not.toHaveBeenCalled();
  });
});
