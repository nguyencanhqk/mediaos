import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeGateway } from "./realtime.gateway";
import { userRoomName } from "./rooms";
import type { TokenService } from "../auth/token.service";
import type { RealtimeEmitterService } from "./realtime-emitter.service";
import type { PermissionService } from "../permission/permission.service";
import type { ChatRoomsRepository } from "../chat/chat-rooms.repository";
import type { DatabaseService } from "../db/db.service";

// CLEAN-DECOUPLE-1 (de-media-fy): cụm chat = out-of-scope đã gỡ khỏi gateway. Spec này còn phủ
// BẤT BIẾN auth-at-handshake (afterInit middleware) + lifecycle connect/disconnect (join user-room cho NOTI).

// ─── Fixtures ──────────────────────────────────────────────────────────────────
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_A = "c0000000-0000-0000-0000-00000000000a";

interface FakeSocket {
  data: { user?: { id: string; companyId: string } };
  rooms: Set<string>;
  join: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  handshake: { auth: Record<string, unknown>; headers: Record<string, unknown> };
}

function makeSocket(user?: { id: string; companyId: string }): FakeSocket {
  const rooms = new Set<string>();
  return {
    data: user ? { user } : {},
    rooms,
    join: vi.fn((room: string) => {
      rooms.add(room);
      return Promise.resolve();
    }),
    leave: vi.fn((room: string) => {
      rooms.delete(room);
      return Promise.resolve();
    }),
    disconnect: vi.fn(),
    handshake: { auth: {}, headers: {} },
  };
}

function makeDeps() {
  const tokens = { verifyAccessToken: vi.fn() } as unknown as TokenService;
  const emitter = {
    setServer: vi.fn(),
    emitNotification: vi.fn(),
  } as unknown as RealtimeEmitterService;
  // ── S7-CHAT-RT-1 ── 3 phụ thuộc mới của constructor. Mặc định "đường thông": có cặp quyền, 0 phòng —
  // các ca CŨ của spec này chỉ kiểm auth-handshake + join user-room nên KHÔNG được đổi hành vi.
  // Ca của RT-1 tự override từng cái khi cần.
  const permissions = {
    can: vi.fn(async () => ({ allow: true, reason: "ok", auditRequired: false })),
  } as unknown as PermissionService;
  const listRoomsForUser = vi.fn(async () => [] as { id: string }[]);
  const chatRooms = { listRoomsForUser } as unknown as ChatRoomsRepository;
  const db = {
    withTenant: vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({} as unknown),
    ),
  } as unknown as DatabaseService;
  return { tokens, emitter, permissions, chatRooms, db, listRoomsForUser };
}

/** Dựng gateway với bộ phụ thuộc đầy đủ — 1 chỗ duy nhất phải sửa khi constructor đổi. */
function makeGateway(d: ReturnType<typeof makeDeps>): RealtimeGateway {
  return new RealtimeGateway(d.tokens, d.emitter, d.permissions, d.chatRooms, d.db);
}

/** Cast a fake to the real Socket type the handlers expect (we only exercise the touched surface). */
const asSocket = (s: FakeSocket): never => s as never;

describe("RealtimeGateway", () => {
  beforeEach(() => {
    process.env.REALTIME_ENABLED = "true";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.REALTIME_ENABLED;
  });

  // ─── Lifecycle: handshake auth (afterInit middleware) ─────────────────────────
  describe("afterInit — handshake auth middleware (fail-closed)", () => {
    it("REALTIME_ENABLED=false → installs a middleware that rejects EVERY connection", () => {
      process.env.REALTIME_ENABLED = "false";
      const deps = makeDeps();
      const gw = makeGateway(deps);

      const middlewares: Array<(c: unknown, n: (e?: Error) => void) => void> = [];
      const server = { use: vi.fn((fn) => middlewares.push(fn)) };
      gw.afterInit(server as never);

      expect(middlewares).toHaveLength(1);
      const next = vi.fn();
      middlewares[0]({}, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
      expect((next.mock.calls[0][0] as Error).message).toBe("realtime_disabled");
      // Disabled gateway never wires the emitter (no events will flow).
      expect(deps.emitter.setServer).not.toHaveBeenCalled();
    });

    it("enabled → registers auth middleware and wires the emitter server", () => {
      const deps = makeDeps();
      const gw = makeGateway(deps);
      const server = { use: vi.fn() };
      gw.afterInit(server as never);

      expect(server.use).toHaveBeenCalledTimes(1);
      expect(deps.emitter.setServer).toHaveBeenCalledWith(server);
    });

    it("auth middleware: valid token (auth.token) → next() and attaches verified user to socket.data", () => {
      const deps = makeDeps();
      vi.mocked(deps.tokens.verifyAccessToken).mockReturnValue({
        sub: USER_A,
        companyId: COMPANY_A,
        email: "a@demo.local",
        aud: "user",
      } as never);
      const gw = makeGateway(deps);

      let mw!: (c: unknown, n: (e?: Error) => void) => void;
      gw.afterInit({ use: (fn: never) => (mw = fn) } as never);

      const client = makeSocket();
      client.handshake.auth = { token: "good-token" };
      const next = vi.fn();
      mw(client, next);

      expect(deps.tokens.verifyAccessToken).toHaveBeenCalledWith("good-token");
      expect(next).toHaveBeenCalledWith();
      expect(client.data.user).toEqual({ id: USER_A, companyId: COMPANY_A });
    });

    it("auth middleware: Bearer authorization header is accepted when auth.token is absent", () => {
      const deps = makeDeps();
      vi.mocked(deps.tokens.verifyAccessToken).mockReturnValue({
        sub: USER_A,
        companyId: COMPANY_A,
        email: "a@demo.local",
        aud: "user",
      } as never);
      const gw = makeGateway(deps);
      let mw!: (c: unknown, n: (e?: Error) => void) => void;
      gw.afterInit({ use: (fn: never) => (mw = fn) } as never);

      const client = makeSocket();
      client.handshake.headers = { authorization: "Bearer hdr-token" };
      const next = vi.fn();
      mw(client, next);

      expect(deps.tokens.verifyAccessToken).toHaveBeenCalledWith("hdr-token");
      expect(next).toHaveBeenCalledWith();
      expect(client.data.user).toEqual({ id: USER_A, companyId: COMPANY_A });
    });

    it("auth middleware: missing token → next(Error) and NO verify attempt", () => {
      const deps = makeDeps();
      const gw = makeGateway(deps);
      let mw!: (c: unknown, n: (e?: Error) => void) => void;
      gw.afterInit({ use: (fn: never) => (mw = fn) } as never);

      const client = makeSocket();
      const next = vi.fn();
      mw(client, next);

      expect(deps.tokens.verifyAccessToken).not.toHaveBeenCalled();
      expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
      expect((next.mock.calls[0][0] as Error).message).toBe("unauthorized");
      expect(client.data.user).toBeUndefined();
    });

    it("auth middleware: invalid/expired token → next(Error), user NOT attached", () => {
      const deps = makeDeps();
      vi.mocked(deps.tokens.verifyAccessToken).mockImplementation(() => {
        throw new Error("jwt expired");
      });
      const gw = makeGateway(deps);
      let mw!: (c: unknown, n: (e?: Error) => void) => void;
      gw.afterInit({ use: (fn: never) => (mw = fn) } as never);

      const client = makeSocket();
      client.handshake.auth = { token: "bad-token" };
      const next = vi.fn();
      mw(client, next);

      expect((next.mock.calls[0][0] as Error).message).toBe("unauthorized");
      expect(client.data.user).toBeUndefined();
    });
  });

  // ─── Lifecycle: connect / disconnect ──────────────────────────────────────────
  describe("handleConnection / handleDisconnect", () => {
    it("connect: joins the user's own private room (co:{company}:user:{id}) — đích notification:new", async () => {
      const deps = makeDeps();
      const gw = makeGateway(deps);
      const client = makeSocket({ id: USER_A, companyId: COMPANY_A });

      await gw.handleConnection(asSocket(client));

      expect(client.join).toHaveBeenCalledWith(userRoomName(COMPANY_A, USER_A));
      expect(client.join).toHaveBeenCalledWith(`co:${COMPANY_A}:user:${USER_A}`);
    });

    it("connect: defensive fail-closed — no verified user → disconnect, never joins", async () => {
      const deps = makeDeps();
      const gw = makeGateway(deps);
      const client = makeSocket();

      await gw.handleConnection(asSocket(client));

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it("disconnect: never throws (Socket.IO auto-leaves rooms)", () => {
      const deps = makeDeps();
      const gw = makeGateway(deps);
      expect(() =>
        gw.handleDisconnect(asSocket(makeSocket({ id: USER_A, companyId: COMPANY_A }))),
      ).not.toThrow();
      expect(() => gw.handleDisconnect(asSocket(makeSocket()))).not.toThrow();
    });
  });
});
