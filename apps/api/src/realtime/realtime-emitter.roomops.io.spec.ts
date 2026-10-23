import { createServer, type Server as HttpServer } from "node:http";
import { Logger } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Server, type Namespace } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { WS_CALL_NAMESPACE, WS_NAMESPACE } from "@mediaos/contracts";
import { RealtimeEmitterService } from "./realtime-emitter.service";
import { callRoomName, callUserRoomName, chatRoomName, userRoomName } from "./rooms";

/**
 * S17-CHAT-RTROOMOPS-1 — room-op CHAT/CALL (`syncRoomMembership('leave')` · `evictFromCallRoom`) KHÔNG
 * được phụ thuộc vào việc thông điệp pub/sub tới nơi.
 *
 * `@socket.io/redis-adapter` 8.3.0: `delSockets` KHÔNG cờ `local` CHỈ publish; node giữ socket (kể cả chính
 * node phát) chỉ áp lệnh khi NHẬN LẠI qua kết nối SUBSCRIBE — at-most-once. Local/CI-không-Valkey chạy
 * adapter in-memory (room-op đồng bộ) nên int-spec không thấy được lớp lỗi này. Spec vá adapter in-memory
 * của CẢ HAI namespace để NUỐT mọi room-op không-`local` (mô phỏng nhánh publish-không-ai-nhận) và giữ
 * nguyên nhánh `local` (= `super.delSockets`, đồng bộ). Ca ⚓ chứng minh mô phỏng THẬT SỰ nuốt.
 *
 * Khối vá adapter chép từ `realtime-emitter.feed.io.spec.ts` (nợ N4: gom helper khi có ca thứ ba).
 */

/** Mọi hằng có chữ hex (a–f) — để ca chữ HOA đổi được chuỗi. */
const COMPANY = "c0000000-0000-4000-8000-00000000000a";
const ROOM = "6b1f0c2e-9d3a-4e5f-8a7b-c0d1e2f3a4b5";
const CALL = "7c2e1d3f-8e4b-4f6a-9b8c-d1e2f3a4b5c6";

type DelSockets = Namespace["adapter"]["delSockets"];
type AddSockets = Namespace["adapter"]["addSockets"];

describe("room-op CHAT/CALL dưới adapter MẤT thông điệp toàn cụm (S17-CHAT-RTROOMOPS-1)", () => {
  let httpServer: HttpServer;
  let io: Server;
  let ws: Namespace;
  let call: Namespace;
  let port = 0;
  /** Room-op toàn cụm bị NUỐT, theo namespace (mỗi phần tử = danh sách room đích của một lệnh). */
  const dropped: Record<"ws" | "call", string[][]> = { ws: [], call: [] };
  const open: ClientSocket[] = [];

  function swallowClusterRoomOps(nsp: Namespace, sink: string[][]): void {
    const adapter = nsp.adapter;
    const realDel: DelSockets = adapter.delSockets.bind(adapter);
    const realAdd: AddSockets = adapter.addSockets.bind(adapter);
    adapter.delSockets = ((opts, rooms) => {
      if (opts.flags?.local) return realDel(opts, rooms);
      sink.push([...rooms]);
    }) as DelSockets;
    adapter.addSockets = ((opts, rooms) => {
      if (opts.flags?.local) return realAdd(opts, rooms);
      sink.push([...rooms]);
    }) as AddSockets;
  }

  beforeAll(async () => {
    httpServer = createServer();
    io = new Server(httpServer);
    ws = io.of(`/${WS_NAMESPACE}`);
    call = io.of(`/${WS_CALL_NAMESPACE}`);
    swallowClusterRoomOps(ws, dropped.ws);
    swallowClusterRoomOps(call, dropped.call);

    // Server tự join room theo `auth.u` — đúng các room mà gateway thật join (id từ JWT/DB, chữ thường).
    ws.on("connection", (socket) => {
      const u = String((socket.handshake.auth as { u?: unknown }).u);
      socket.join([userRoomName(COMPANY, u), chatRoomName(COMPANY, ROOM)]);
    });
    call.on("connection", (socket) => {
      const u = String((socket.handshake.auth as { u?: unknown }).u);
      socket.join([callUserRoomName(COMPANY, u), callRoomName(COMPANY, CALL)]);
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
    while (open.length) open.pop()?.disconnect();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  const inRoom = async (nsp: Namespace, room: string, client: ClientSocket): Promise<boolean> =>
    (await nsp.local.in(room).fetchSockets()).some((s) => s.id === client.id);
  const inChatRoom = (c: ClientSocket) => inRoom(ws, chatRoomName(COMPANY, ROOM), c);
  const inCallRoom = (c: ClientSocket) => inRoom(call, callRoomName(COMPANY, CALL), c);

  /** Nối + chờ tới khi server ĐÃ đưa socket vào room đích (poll — không `sleep` cố định). */
  async function connect(
    nspName: string,
    userId: string,
    ready: (c: ClientSocket) => Promise<boolean>,
  ): Promise<ClientSocket> {
    const client = ioClient(`http://127.0.0.1:${port}/${nspName}`, {
      auth: { u: userId },
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    });
    open.push(client);
    await new Promise<void>((resolve, reject) => {
      client.on("connect", () => resolve());
      client.on("connect_error", reject);
    });
    const start = Date.now();
    while (!(await ready(client))) {
      if (Date.now() - start > 3000) throw new Error(`hết giờ chờ socket ${userId} vào room`);
      await new Promise((r) => setTimeout(r, 20));
    }
    return client;
  }
  const connectChat = (u: string) => connect(WS_NAMESPACE, u, inChatRoom);
  const connectCall = (u: string) => connect(WS_CALL_NAMESPACE, u, inCallRoom);

  function emitter(): RealtimeEmitterService {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const svc = new RealtimeEmitterService();
    svc.setServer(ws as never);
    svc.setCallServer(call);
    return svc;
  }

  it("⚓ I-⚓1 `/ws`: lệnh leave toàn cụm (không `local`) bị NUỐT — socket VẪN ở phòng chat", async () => {
    const u = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
    const client = await connectChat(u);
    const before = dropped.ws.length;

    ws.in(userRoomName(COMPANY, u)).socketsLeave(chatRoomName(COMPANY, ROOM));

    expect(dropped.ws.length).toBe(before + 1);
    expect(await inChatRoom(client)).toBe(true);
  });

  it("⚓ I-⚓2 `/ws-call`: lệnh leave toàn cụm (không `local`) bị NUỐT — socket VẪN ở room cuộc gọi", async () => {
    const u = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
    const client = await connectCall(u);
    const before = dropped.call.length;

    call.in(callUserRoomName(COMPANY, u)).socketsLeave(callRoomName(COMPANY, CALL));

    expect(dropped.call.length).toBe(before + 1);
    expect(await inCallRoom(client)).toBe(true);
  });

  it("🔒 I-1 syncRoomMembership('leave') khi lệnh toàn cụm bị mất ⇒ socket VẪN rời phòng chat (vế CỤC BỘ)", async () => {
    const u = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";
    const client = await connectChat(u);
    const before = dropped.ws.length;

    emitter().syncRoomMembership(COMPANY, ROOM, u, "leave");

    expect(await inChatRoom(client), "người bị gỡ PHẢI rời phòng chat").toBe(false);
    // Vế toàn cụm VẪN được phát (cho node khác) — ở đây nó là thông điệp bị mất.
    expect(dropped.ws.length).toBe(before + 1);
  });

  it("🔒 I-2 evictFromCallRoom khi lệnh toàn cụm bị mất ⇒ socket VẪN rời room cuộc gọi (vế CỤC BỘ)", async () => {
    const u = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04";
    const client = await connectCall(u);
    const before = dropped.call.length;

    emitter().evictFromCallRoom(COMPANY, CALL, u);

    expect(await inCallRoom(client), "người bị gỡ PHẢI rời room cuộc gọi").toBe(false);
    expect(dropped.call.length).toBe(before + 1);
  });

  it("🔒 I-3 id CHỮ HOA (route/khung client trả nguyên văn) + lệnh toàn cụm bị mất ⇒ VẪN rời cả hai room", async () => {
    const u = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05";
    const chat = await connectChat(u);
    const callSock = await connectCall(u);
    const svc = emitter();

    svc.syncRoomMembership(COMPANY.toUpperCase(), ROOM.toUpperCase(), u.toUpperCase(), "leave");
    svc.evictFromCallRoom(COMPANY.toUpperCase(), CALL.toUpperCase(), u.toUpperCase());

    expect(await inChatRoom(chat), "phòng chat").toBe(false);
    expect(await inCallRoom(callSock), "room cuộc gọi").toBe(false);
  });

  // Đối chứng dương «người bị gỡ rời room» là I-1/I-2 (cùng lệnh); ca này chỉ đo độ HẸP của bộ chọn — vế
  // cục bộ quét nhầm cả room đích (thay vì user-room/calluser của người bị gỡ) thì ca này ĐỎ.
  it("I-A ALLOW: socket của người KHÁC trong cùng room KHÔNG bị kéo ra (bộ chọn đúng người)", async () => {
    const victim = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06";
    const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb06";
    await connectChat(victim);
    const otherChat = await connectChat(other);
    await connectCall(victim);
    const otherCall = await connectCall(other);
    const svc = emitter();

    svc.syncRoomMembership(COMPANY, ROOM, victim, "leave");
    svc.evictFromCallRoom(COMPANY, CALL, victim);

    expect(await inChatRoom(otherChat), "người khác VẪN ở phòng chat").toBe(true);
    expect(await inCallRoom(otherCall), "người khác VẪN ở room cuộc gọi").toBe(true);
  });
});
