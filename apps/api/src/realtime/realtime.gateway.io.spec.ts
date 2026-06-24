import { createServer, type Server as HttpServer } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Server, type Namespace } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { WS_NAMESPACE } from "@mediaos/contracts";
import { RealtimeGateway } from "./realtime.gateway";
import { RealtimeEmitterService } from "./realtime-emitter.service";
import { userRoomName } from "./rooms";
import type { TokenService } from "../auth/token.service";

/**
 * End-to-end socket.io proof of the gateway's load-bearing invariants over a REAL server+client,
 * SAU CLEAN-DECOUPLE-1 (cụm chat đã gỡ — gateway chỉ còn auth-handshake + join user-room cho NOTI):
 *  - handshake auth fail-closed (no/invalid token rejected before `connect`)
 *  - mỗi user join ĐÚNG room riêng `co:{company}:user:{id}` (đích notification:new) — tenant-prefixed
 *  - reconnect re-joins cleanly, no ghost socket left in the user room
 *
 * Token stub format: "<userId>::<companyId>" — decoded server-side; a token that does not split
 * into both parts throws, exercising the invalid-token path.
 */

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

describe("RealtimeGateway (socket.io integration)", () => {
  let httpServer: HttpServer;
  let io: Server;
  let port: number;
  const openClients: ClientSocket[] = [];

  beforeAll(async () => {
    process.env.REALTIME_ENABLED = "true";
    const gateway = new RealtimeGateway(makeStubTokenService(), new RealtimeEmitterService());

    httpServer = createServer();
    io = new Server(httpServer);
    const ns: Namespace = io.of(`/${WS_NAMESPACE}`);

    // Install the handshake auth middleware + emitter wiring exactly as Nest would.
    gateway.afterInit(ns as never);
    // `@WebSocketServer()` is what populates `this.server` at runtime; supply it for parity.
    (gateway as unknown as { server: Namespace }).server = ns;

    ns.on("connection", (socket) => {
      gateway.handleConnection(socket);
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

  /** Raw server-side count of sockets currently in a user's private room (NOTI target). */
  const userRoomSocketCount = async (companyId: string, userId: string): Promise<number> =>
    (await io.of(`/${WS_NAMESPACE}`).in(userRoomName(companyId, userId)).fetchSockets()).length;

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

  it("accepts a valid token and joins the user's own private room", async () => {
    await connect(tokenFor(USER_A, COMPANY_A));
    await waitFor(async () => (await userRoomSocketCount(COMPANY_A, USER_A)) === 1);
    expect(await userRoomSocketCount(COMPANY_A, USER_A)).toBe(1);
  });

  // ─── tenant-prefixed user-room isolation (#1 invariant) ─────────────────────────
  it("each user joins ONLY their own tenant-prefixed room (A↔B never share a room)", async () => {
    await connect(tokenFor(USER_A, COMPANY_A));
    await connect(tokenFor(USER_B, COMPANY_B));

    await waitFor(async () => (await userRoomSocketCount(COMPANY_A, USER_A)) === 1);
    await waitFor(async () => (await userRoomSocketCount(COMPANY_B, USER_B)) === 1);

    // Cross-tenant room never contains the other tenant's socket.
    expect(await userRoomSocketCount(COMPANY_A, USER_B)).toBe(0);
    expect(await userRoomSocketCount(COMPANY_B, USER_A)).toBe(0);
  });

  // ─── reconnect ──────────────────────────────────────────────────────────────────
  it("reconnect re-joins cleanly and leaves no ghost socket in the user room", async () => {
    const first = await connect(tokenFor(USER_A, COMPANY_A));
    await waitFor(async () => (await userRoomSocketCount(COMPANY_A, USER_A)) === 1);

    first.disconnect();
    // PROVE the dead socket is actually removed server-side — not merely de-duped away later.
    await waitFor(async () => (await userRoomSocketCount(COMPANY_A, USER_A)) === 0);

    // New connection (fresh socket) for the same user — must re-join its room, exactly one live socket.
    await connect(tokenFor(USER_A, COMPANY_A));
    await waitFor(async () => (await userRoomSocketCount(COMPANY_A, USER_A)) === 1);
    expect(await userRoomSocketCount(COMPANY_A, USER_A)).toBe(1);
  });
});
