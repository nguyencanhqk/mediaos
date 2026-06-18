import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS_EVENTS } from "@mediaos/contracts";
import { RealtimeGateway } from "./realtime.gateway";
import { chatRoomName, userRoomName } from "./rooms";
import type { TokenService } from "../auth/token.service";
import type { ChatService } from "../chat/chat.service";
import type { RealtimeEmitterService } from "./realtime-emitter.service";

// ─── Fixtures ──────────────────────────────────────────────────────────────────
const ROOM_A = "11111111-1111-1111-1111-111111111111";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_A2 = "a2a2a2a2-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const COMPANY_A = "c0000000-0000-0000-0000-00000000000a";
const COMPANY_B = "c0000000-0000-0000-0000-00000000000b";

interface FakeSocket {
  data: { user?: { id: string; companyId: string } };
  rooms: Set<string>;
  join: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
  to: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  handshake: { auth: Record<string, unknown>; headers: Record<string, unknown> };
  /** Last broadcast operator returned by `to()` — exposes its emit spy for assertions. */
  lastBroadcastEmit: ReturnType<typeof vi.fn>;
}

function makeSocket(user?: { id: string; companyId: string }): FakeSocket {
  const rooms = new Set<string>();
  const lastBroadcastEmit = vi.fn();
  const socket: FakeSocket = {
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
    to: vi.fn(() => ({ emit: lastBroadcastEmit })),
    disconnect: vi.fn(),
    handshake: { auth: {}, headers: {} },
    lastBroadcastEmit,
  };
  return socket;
}

function makeDeps() {
  const tokens = { verifyAccessToken: vi.fn() } as unknown as TokenService;
  const chat = {
    canAccessRoom: vi.fn(),
    sendMessage: vi.fn(),
  } as unknown as ChatService;
  const emitter = {
    setServer: vi.fn(),
    emitChatMessage: vi.fn(),
    emitNotification: vi.fn(),
  } as unknown as RealtimeEmitterService;
  return { tokens, chat, emitter };
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
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);

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
      expect(emitter.setServer).not.toHaveBeenCalled();
    });

    it("enabled → registers auth middleware and wires the emitter server", () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const server = { use: vi.fn() };
      gw.afterInit(server as never);

      expect(server.use).toHaveBeenCalledTimes(1);
      expect(emitter.setServer).toHaveBeenCalledWith(server);
    });

    it("auth middleware: valid token (auth.token) → next() and attaches verified user to socket.data", () => {
      const { tokens, chat, emitter } = makeDeps();
      vi.mocked(tokens.verifyAccessToken).mockReturnValue({
        sub: USER_A,
        companyId: COMPANY_A,
        email: "a@demo.local",
        aud: "user",
      } as never);
      const gw = new RealtimeGateway(tokens, chat, emitter);

      let mw!: (c: unknown, n: (e?: Error) => void) => void;
      gw.afterInit({ use: (fn: never) => (mw = fn) } as never);

      const client = makeSocket();
      client.handshake.auth = { token: "good-token" };
      const next = vi.fn();
      mw(client, next);

      expect(tokens.verifyAccessToken).toHaveBeenCalledWith("good-token");
      expect(next).toHaveBeenCalledWith();
      expect(client.data.user).toEqual({ id: USER_A, companyId: COMPANY_A });
    });

    it("auth middleware: Bearer authorization header is accepted when auth.token is absent", () => {
      const { tokens, chat, emitter } = makeDeps();
      vi.mocked(tokens.verifyAccessToken).mockReturnValue({
        sub: USER_A,
        companyId: COMPANY_A,
        email: "a@demo.local",
        aud: "user",
      } as never);
      const gw = new RealtimeGateway(tokens, chat, emitter);
      let mw!: (c: unknown, n: (e?: Error) => void) => void;
      gw.afterInit({ use: (fn: never) => (mw = fn) } as never);

      const client = makeSocket();
      client.handshake.headers = { authorization: "Bearer hdr-token" };
      const next = vi.fn();
      mw(client, next);

      expect(tokens.verifyAccessToken).toHaveBeenCalledWith("hdr-token");
      expect(next).toHaveBeenCalledWith();
      expect(client.data.user).toEqual({ id: USER_A, companyId: COMPANY_A });
    });

    it("auth middleware: missing token → next(Error) and NO verify attempt", () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);
      let mw!: (c: unknown, n: (e?: Error) => void) => void;
      gw.afterInit({ use: (fn: never) => (mw = fn) } as never);

      const client = makeSocket();
      const next = vi.fn();
      mw(client, next);

      expect(tokens.verifyAccessToken).not.toHaveBeenCalled();
      expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
      expect((next.mock.calls[0][0] as Error).message).toBe("unauthorized");
      expect(client.data.user).toBeUndefined();
    });

    it("auth middleware: invalid/expired token → next(Error), user NOT attached", () => {
      const { tokens, chat, emitter } = makeDeps();
      vi.mocked(tokens.verifyAccessToken).mockImplementation(() => {
        throw new Error("jwt expired");
      });
      const gw = new RealtimeGateway(tokens, chat, emitter);
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
    it("connect: joins the user's own private room (co:{company}:user:{id})", () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const client = makeSocket({ id: USER_A, companyId: COMPANY_A });

      gw.handleConnection(asSocket(client));

      expect(client.join).toHaveBeenCalledWith(userRoomName(COMPANY_A, USER_A));
      expect(client.join).toHaveBeenCalledWith(`co:${COMPANY_A}:user:${USER_A}`);
    });

    it("connect: defensive fail-closed — no verified user → disconnect, never joins", () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const client = makeSocket();

      gw.handleConnection(asSocket(client));

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it("disconnect: never throws (Socket.IO auto-leaves rooms)", () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);
      expect(() => gw.handleDisconnect(asSocket(makeSocket({ id: USER_A, companyId: COMPANY_A })))).not.toThrow();
      expect(() => gw.handleDisconnect(asSocket(makeSocket()))).not.toThrow();
    });
  });

  // ─── chat:join / chat:leave ───────────────────────────────────────────────────
  describe("chat:join", () => {
    it("unauthenticated socket → deny", async () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const res = await gw.onJoin(asSocket(makeSocket()), { roomId: ROOM_A });
      expect(res).toEqual({ ok: false, error: "unauthenticated" });
      expect(chat.canAccessRoom).not.toHaveBeenCalled();
    });

    it("invalid payload (roomId not a uuid) → deny, no membership check", async () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const res = await gw.onJoin(asSocket(makeSocket({ id: USER_A, companyId: COMPANY_A })), {
        roomId: "not-a-uuid",
      });
      expect(res).toEqual({ ok: false, error: "invalid_payload" });
      expect(chat.canAccessRoom).not.toHaveBeenCalled();
    });

    it("non-member → forbidden (membership checked server-side via ChatService)", async () => {
      const { tokens, chat, emitter } = makeDeps();
      vi.mocked(chat.canAccessRoom).mockResolvedValue(false);
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const client = makeSocket({ id: USER_A, companyId: COMPANY_A });

      const res = await gw.onJoin(asSocket(client), { roomId: ROOM_A });

      expect(res).toEqual({ ok: false, error: "forbidden" });
      expect(chat.canAccessRoom).toHaveBeenCalledWith(COMPANY_A, ROOM_A, USER_A);
      expect(client.join).not.toHaveBeenCalled();
    });

    it("member → joins the company-scoped chat room (co:{company}:chat:{room})", async () => {
      const { tokens, chat, emitter } = makeDeps();
      vi.mocked(chat.canAccessRoom).mockResolvedValue(true);
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const client = makeSocket({ id: USER_A, companyId: COMPANY_A });

      const res = await gw.onJoin(asSocket(client), { roomId: ROOM_A });

      expect(res).toEqual({ ok: true });
      expect(client.join).toHaveBeenCalledWith(chatRoomName(COMPANY_A, ROOM_A));
    });

    it("membership check throws → deny('error') (no leak of internals)", async () => {
      const { tokens, chat, emitter } = makeDeps();
      vi.mocked(chat.canAccessRoom).mockRejectedValue(new Error("db down"));
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const client = makeSocket({ id: USER_A, companyId: COMPANY_A });

      const res = await gw.onJoin(asSocket(client), { roomId: ROOM_A });

      expect(res).toEqual({ ok: false, error: "error" });
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe("chat:leave", () => {
    it("leaves the company-scoped chat room", async () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const client = makeSocket({ id: USER_A, companyId: COMPANY_A });

      const res = await gw.onLeave(asSocket(client), { roomId: ROOM_A });

      expect(res).toEqual({ ok: true });
      expect(client.leave).toHaveBeenCalledWith(chatRoomName(COMPANY_A, ROOM_A));
    });

    it("invalid payload → deny", async () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const res = await gw.onLeave(asSocket(makeSocket({ id: USER_A, companyId: COMPANY_A })), {
        roomId: 123,
      });
      expect(res).toEqual({ ok: false, error: "invalid_payload" });
    });

    it("leaving a room the socket never joined is idempotent (ok) — leave is always tenant-scoped", async () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const client = makeSocket({ id: USER_A, companyId: COMPANY_A }); // rooms empty

      const res = await gw.onLeave(asSocket(client), { roomId: ROOM_A });

      expect(res).toEqual({ ok: true });
      // Always operates on the caller's own company-scoped room — no cross-tenant leave possible.
      expect(client.leave).toHaveBeenCalledWith(chatRoomName(COMPANY_A, ROOM_A));
    });

    it("unauthenticated socket → deny", async () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const res = await gw.onLeave(asSocket(makeSocket()), { roomId: ROOM_A });
      expect(res).toEqual({ ok: false, error: "unauthenticated" });
    });
  });

  // ─── chat:send ────────────────────────────────────────────────────────────────
  describe("chat:send", () => {
    it("success → returns the masked DTO from ChatService", async () => {
      const { tokens, chat, emitter } = makeDeps();
      const dto = { id: "msg-1", roomId: ROOM_A, body: "hi" };
      vi.mocked(chat.sendMessage).mockResolvedValue(dto as never);
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const client = makeSocket({ id: USER_A, companyId: COMPANY_A });

      const res = await gw.onSend(asSocket(client), { roomId: ROOM_A, body: "hi" });

      expect(res).toEqual({ ok: true, data: dto });
      expect(chat.sendMessage).toHaveBeenCalledWith(COMPANY_A, ROOM_A, USER_A, {
        body: "hi",
        mentions: undefined,
      });
    });

    it("unauthenticated → deny", async () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const res = await gw.onSend(asSocket(makeSocket()), { roomId: ROOM_A, body: "hi" });
      expect(res).toEqual({ ok: false, error: "unauthenticated" });
    });

    it("empty body → invalid_payload", async () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const res = await gw.onSend(asSocket(makeSocket({ id: USER_A, companyId: COMPANY_A })), {
        roomId: ROOM_A,
        body: "",
      });
      expect(res).toEqual({ ok: false, error: "invalid_payload" });
    });

    it("ForbiddenException from service → mapped to 'forbidden'", async () => {
      const { tokens, chat, emitter } = makeDeps();
      const err = new Error("Not a member of this room");
      err.name = "ForbiddenException";
      vi.mocked(chat.sendMessage).mockRejectedValue(err);
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const res = await gw.onSend(asSocket(makeSocket({ id: USER_A, companyId: COMPANY_A })), {
        roomId: ROOM_A,
        body: "hi",
      });
      expect(res).toEqual({ ok: false, error: "forbidden" });
    });

    it("unknown error from service → mapped to 'error' (no internal leak)", async () => {
      const { tokens, chat, emitter } = makeDeps();
      vi.mocked(chat.sendMessage).mockRejectedValue(new Error("boom secret detail"));
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const res = await gw.onSend(asSocket(makeSocket({ id: USER_A, companyId: COMPANY_A })), {
        roomId: ROOM_A,
        body: "hi",
      });
      expect(res).toEqual({ ok: false, error: "error" });
    });
  });

  // ─── chat:typing ──────────────────────────────────────────────────────────────
  describe("chat:typing", () => {
    it("not joined to the room → deny('not_joined') (no broadcast)", () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const client = makeSocket({ id: USER_A, companyId: COMPANY_A });
      // rooms intentionally empty
      const res = gw.onTyping(asSocket(client), { roomId: ROOM_A, isTyping: true });
      expect(res).toEqual({ ok: false, error: "not_joined" });
      expect(client.to).not.toHaveBeenCalled();
    });

    it("joined → broadcasts typing event to the room (excludes self) with server-derived userId", () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const client = makeSocket({ id: USER_A, companyId: COMPANY_A });
      const room = chatRoomName(COMPANY_A, ROOM_A);
      client.rooms.add(room);

      const res = gw.onTyping(asSocket(client), { roomId: ROOM_A, isTyping: true });

      expect(res).toEqual({ ok: true });
      expect(client.to).toHaveBeenCalledWith(room);
      expect(client.lastBroadcastEmit).toHaveBeenCalledWith(WS_EVENTS.CHAT_TYPING_EVENT, {
        roomId: ROOM_A,
        userId: USER_A,
        isTyping: true,
      });
    });
  });

  // ─── chat:presence:list — TENANT ISOLATION (invariant #1) ─────────────────────
  describe("chat:presence:list — cross-tenant isolation", () => {
    it("queries ONLY the caller's own company-scoped room (room prefix derived from socket, not payload)", async () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);

      // Company A and Company B each have a member in the SAME logical roomId.
      const socketsByRoom: Record<string, Array<{ data: { user?: { id: string } } }>> = {
        [chatRoomName(COMPANY_A, ROOM_A)]: [{ data: { user: { id: USER_A } } }],
        [chatRoomName(COMPANY_B, ROOM_A)]: [{ data: { user: { id: USER_B } } }],
      };
      const inSpy = vi.fn((room: string) => ({
        fetchSockets: () => Promise.resolve(socketsByRoom[room] ?? []),
      }));
      (gw as unknown as { server: { in: typeof inSpy } }).server = { in: inSpy };

      // Caller is a Company-B user who has joined roomId ROOM_A.
      const client = makeSocket({ id: USER_B, companyId: COMPANY_B });
      client.rooms.add(chatRoomName(COMPANY_B, ROOM_A));

      const res = await gw.onPresenceList(asSocket(client), { roomId: ROOM_A });

      // B sees ONLY B — A's presence in the same roomId is invisible across the tenant boundary.
      expect(res).toEqual({ ok: true, userIds: [USER_B] });
      expect(inSpy).toHaveBeenCalledWith(chatRoomName(COMPANY_B, ROOM_A));
      expect(inSpy).not.toHaveBeenCalledWith(chatRoomName(COMPANY_A, ROOM_A));
    });

    it("deduplicates userIds across a user's multiple devices/sockets", async () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const room = chatRoomName(COMPANY_A, ROOM_A);
      const inSpy = vi.fn((r: string) => ({
        fetchSockets: () =>
          Promise.resolve(
            r === room
              ? [
                  { data: { user: { id: USER_A } } },
                  { data: { user: { id: USER_A } } }, // same user, 2nd device
                  { data: { user: { id: USER_A2 } } },
                ]
              : [],
          ),
      }));
      (gw as unknown as { server: { in: typeof inSpy } }).server = { in: inSpy };
      const client = makeSocket({ id: USER_A, companyId: COMPANY_A });
      client.rooms.add(room);

      const res = await gw.onPresenceList(asSocket(client), { roomId: ROOM_A });

      expect(res.ok).toBe(true);
      expect(res.ok && res.userIds).toEqual([USER_A, USER_A2]);
    });

    it("not joined → deny('not_joined') without touching the server", async () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const inSpy = vi.fn();
      (gw as unknown as { server: { in: typeof inSpy } }).server = { in: inSpy };
      const client = makeSocket({ id: USER_A, companyId: COMPANY_A });

      const res = await gw.onPresenceList(asSocket(client), { roomId: ROOM_A });

      expect(res).toEqual({ ok: false, error: "not_joined" });
      expect(inSpy).not.toHaveBeenCalled();
    });

    it("unauthenticated → deny", async () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const res = await gw.onPresenceList(asSocket(makeSocket()), { roomId: ROOM_A });
      expect(res).toEqual({ ok: false, error: "unauthenticated" });
    });

    it("invalid payload → deny", async () => {
      const { tokens, chat, emitter } = makeDeps();
      const gw = new RealtimeGateway(tokens, chat, emitter);
      const res = await gw.onPresenceList(
        asSocket(makeSocket({ id: USER_A, companyId: COMPANY_A })),
        { roomId: "nope" },
      );
      expect(res).toEqual({ ok: false, error: "invalid_payload" });
    });
  });
});
