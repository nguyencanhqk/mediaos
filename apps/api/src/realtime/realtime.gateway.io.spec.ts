import { createServer, type Server as HttpServer } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Server, type Namespace } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { WS_EVENTS, WS_NAMESPACE, type WsAck, type WsPresenceListAck } from "@mediaos/contracts";
import { RealtimeGateway } from "./realtime.gateway";
import { RealtimeEmitterService } from "./realtime-emitter.service";
import { chatRoomName } from "./rooms";
import type { TokenService } from "../auth/token.service";
import type { ChatService } from "../chat/chat.service";

/**
 * End-to-end socket.io proof of the gateway's load-bearing invariants over a REAL server+client:
 *  - handshake auth fail-closed (no/invalid token rejected before `connect`)
 *  - cross-tenant presence isolation (#1 invariant): company B never sees company A in the same roomId
 *  - reconnect re-joins cleanly, with no ghost sockets left in the room
 *
 * Token stub format: "<userId>::<companyId>" — decoded server-side; a token that does not split
 * into both parts throws, exercising the invalid-token path.
 */

const ROOM = "11111111-1111-1111-1111-111111111111";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const COMPANY_A = "c0000000-0000-0000-0000-00000000000a";
const COMPANY_B = "c0000000-0000-0000-0000-00000000000b";

const tokenFor = (userId: string, companyId: string) => `${userId}::${companyId}`;

function makeStubTokenService(): TokenService {
  return {
    verifyAccessToken: (token: string) => {
      const [sub, companyId] = token.split("::");
      if (!sub || !companyId) throw new Error("invalid token");
      return { sub, companyId, email: `${sub}@demo.local`, aud: "user" };
    },
  } as unknown as TokenService;
}

function makeStubChatService(): ChatService {
  return {
    canAccessRoom: () => Promise.resolve(true),
  } as unknown as ChatService;
}

describe("RealtimeGateway (socket.io integration)", () => {
  let httpServer: HttpServer;
  let io: Server;
  let port: number;
  const openClients: ClientSocket[] = [];

  beforeAll(async () => {
    process.env.REALTIME_ENABLED = "true";
    const gateway = new RealtimeGateway(
      makeStubTokenService(),
      makeStubChatService(),
      new RealtimeEmitterService(),
    );

    httpServer = createServer();
    io = new Server(httpServer);
    const ns: Namespace = io.of(`/${WS_NAMESPACE}`);

    // Install the handshake auth middleware + emitter wiring exactly as Nest would.
    gateway.afterInit(ns as never);
    // `@WebSocketServer()` is what populates `this.server` at runtime; supply it for presence queries.
    (gateway as unknown as { server: Namespace }).server = ns;

    ns.on("connection", (socket) => {
      gateway.handleConnection(socket);
      socket.on(WS_EVENTS.CHAT_JOIN, (payload, cb: (a: WsAck) => void) =>
        void gateway.onJoin(socket, payload).then(cb),
      );
      socket.on(WS_EVENTS.CHAT_LEAVE, (payload, cb: (a: WsAck) => void) =>
        void gateway.onLeave(socket, payload).then(cb),
      );
      socket.on(WS_EVENTS.CHAT_PRESENCE_LIST, (payload, cb: (a: WsPresenceListAck) => void) =>
        void gateway.onPresenceList(socket, payload).then(cb),
      );
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterEach(() => {
    while (openClients.length) openClients.pop()?.disconnect();
  });

  afterAll(async () => {
    await io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  function connect(token?: string): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const client = ioClient(`http://localhost:${port}/${WS_NAMESPACE}`, {
        auth: token ? { token } : {},
        transports: ["websocket"],
        reconnection: false,
        forceNew: true,
      });
      openClients.push(client);
      client.on("connect", () => resolve(client));
      client.on("connect_error", (err) => reject(err));
    });
  }

  const emitAck = <T>(client: ClientSocket, event: string, payload: unknown): Promise<T> =>
    new Promise((resolve) => client.emit(event, payload, (ack: T) => resolve(ack)));

  /** Raw server-side count of sockets currently in a company's chat room (not de-duped by user). */
  const roomSocketCount = async (companyId: string): Promise<number> =>
    (await io.of(`/${WS_NAMESPACE}`).in(chatRoomName(companyId, ROOM)).fetchSockets()).length;

  /** Poll until `predicate` holds — disconnect/cleanup is async server-side; avoids timing flakiness. */
  async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("waitFor timed out");
  }

  // ─── handshake auth ────────────────────────────────────────────────────────────
  it("rejects a connection with NO token at the handshake", async () => {
    await expect(connect()).rejects.toThrow(/unauthorized/);
  });

  it("rejects a connection with an INVALID token at the handshake", async () => {
    await expect(connect("garbage-no-separator")).rejects.toThrow(/unauthorized/);
  });

  it("accepts a valid token and lets the member join + list presence", async () => {
    const client = await connect(tokenFor(USER_A, COMPANY_A));
    const joinAck = await emitAck<WsAck>(client, WS_EVENTS.CHAT_JOIN, { roomId: ROOM });
    expect(joinAck).toEqual({ ok: true });

    const presence = await emitAck<WsPresenceListAck>(client, WS_EVENTS.CHAT_PRESENCE_LIST, {
      roomId: ROOM,
    });
    expect(presence.ok).toBe(true);
    expect(presence.userIds).toEqual([USER_A]);
  });

  // ─── cross-tenant isolation (#1 invariant) ──────────────────────────────────────
  it("company B NEVER sees company A in the same roomId (presence isolation)", async () => {
    const clientA = await connect(tokenFor(USER_A, COMPANY_A));
    const clientB = await connect(tokenFor(USER_B, COMPANY_B));

    await emitAck<WsAck>(clientA, WS_EVENTS.CHAT_JOIN, { roomId: ROOM });
    await emitAck<WsAck>(clientB, WS_EVENTS.CHAT_JOIN, { roomId: ROOM });

    const presenceA = await emitAck<WsPresenceListAck>(clientA, WS_EVENTS.CHAT_PRESENCE_LIST, {
      roomId: ROOM,
    });
    const presenceB = await emitAck<WsPresenceListAck>(clientB, WS_EVENTS.CHAT_PRESENCE_LIST, {
      roomId: ROOM,
    });

    expect(presenceA.userIds).toEqual([USER_A]);
    expect(presenceB.userIds).toEqual([USER_B]);
    expect(presenceA.userIds).not.toContain(USER_B);
    expect(presenceB.userIds).not.toContain(USER_A);
  });

  // ─── reconnect ──────────────────────────────────────────────────────────────────
  it("reconnect re-joins cleanly and leaves no ghost socket in the room", async () => {
    const first = await connect(tokenFor(USER_A, COMPANY_A));
    await emitAck<WsAck>(first, WS_EVENTS.CHAT_JOIN, { roomId: ROOM });
    await waitFor(async () => (await roomSocketCount(COMPANY_A)) === 1);

    first.disconnect();
    // PROVE the dead socket is actually removed server-side — not merely de-duped away later.
    await waitFor(async () => (await roomSocketCount(COMPANY_A)) === 0);

    // New connection (fresh socket) for the same user — must be able to re-join.
    const second = await connect(tokenFor(USER_A, COMPANY_A));
    const rejoin = await emitAck<WsAck>(second, WS_EVENTS.CHAT_JOIN, { roomId: ROOM });
    expect(rejoin).toEqual({ ok: true });

    // Raw socket count == 1 (independent of presence de-dup): exactly one live socket, no ghost.
    expect(await roomSocketCount(COMPANY_A)).toBe(1);

    const presence = await emitAck<WsPresenceListAck>(second, WS_EVENTS.CHAT_PRESENCE_LIST, {
      roomId: ROOM,
    });
    expect(presence.userIds).toEqual([USER_A]);
  });
});
