import { createServer, type Server as HttpServer } from "node:http";
import { Logger } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Server, type Namespace } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { WS_NAMESPACE } from "@mediaos/contracts";
import { RealtimeEmitterService } from "./realtime-emitter.service";
import { feedGroupRoomName, userRoomName } from "./rooms";

/**
 * S16-SOCIAL-BE-2C · FULL gate lượt 1 (MEDIUM — security-reviewer + silent-failure-hunter) — lệnh `leave`
 * khỏi room nhóm KHÔNG được phụ thuộc vào việc thông điệp pub/sub tới nơi.
 *
 * ┌─ VÌ SAO CẦN socket.io THẬT ────────────────────────────────────────────────────────────────────┐
 * │ `@socket.io/redis-adapter` 8.3.0: `delSockets`/`addSockets` KHÔNG cờ `local` CHỈ publish          │
 * │ REMOTE_LEAVE/REMOTE_JOIN; node giữ socket (kể cả chính node phát) chỉ áp lệnh khi NHẬN LẠI qua     │
 * │ kết nối SUBSCRIBE. Pub/sub là at-most-once ⇒ sub rớt đúng lúc `039` ⇒ cả hai lần leave MẤT VĨNH   │
 * │ VIỄN, trong khi broadcast thì phát CỤC BỘ, ĐỒNG BỘ ⇒ người bị mời ra tiếp tục nhận bài nhóm kín.  │
 * │ Local chạy adapter in-memory (room-op đồng bộ) nên int-spec KHÔNG thấy được lớp lỗi này.         │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Spec vá adapter in-memory của namespace để NUỐT mọi room-op KHÔNG cờ `local` — mô phỏng đúng nhánh
 * publish-không-ai-nhận của redis-adapter — và giữ nguyên nhánh `local` (= `super.delSockets`, đồng bộ).
 * Ca ⚓ chứng minh mô phỏng THẬT SỰ nuốt (không có nó, ca 🔒 xanh-rỗng trên adapter thường).
 */

const COMPANY = "c0000000-0000-0000-0000-00000000000a";
/** Có chữ hex (a–f) — để ca chữ HOA đổi được chuỗi. */
const GROUP = "6b1f0c2e-9d3a-4e5f-8a7b-c0d1e2f3a4b5";

type DelSockets = Namespace["adapter"]["delSockets"];
type AddSockets = Namespace["adapter"]["addSockets"];

describe("syncFeedGroupMembership('leave') dưới adapter MẤT thông điệp toàn cụm (S16-SOCIAL-BE-2C)", () => {
  let httpServer: HttpServer;
  let io: Server;
  let nsp: Namespace;
  let port = 0;
  /** Room-op toàn cụm bị NUỐT (mỗi phần tử = danh sách room đích của một lệnh). */
  const dropped: string[][] = [];
  const open: ClientSocket[] = [];

  beforeAll(async () => {
    httpServer = createServer();
    io = new Server(httpServer);
    nsp = io.of(`/${WS_NAMESPACE}`);

    const adapter = nsp.adapter;
    const realDel: DelSockets = adapter.delSockets.bind(adapter);
    const realAdd: AddSockets = adapter.addSockets.bind(adapter);
    adapter.delSockets = ((opts, rooms) => {
      if (opts.flags?.local) return realDel(opts, rooms);
      dropped.push([...rooms]);
    }) as DelSockets;
    adapter.addSockets = ((opts, rooms) => {
      if (opts.flags?.local) return realAdd(opts, rooms);
      dropped.push([...rooms]);
    }) as AddSockets;

    // Server tự join room theo `auth.u` — đúng hai room mà gateway thật join cho thành viên nhóm.
    nsp.on("connection", (socket) => {
      const u = String((socket.handshake.auth as { u?: unknown }).u);
      socket.join([userRoomName(COMPANY, u), feedGroupRoomName(COMPANY, GROUP)]);
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

  const inGroupRoom = async (client: ClientSocket): Promise<boolean> =>
    (await nsp.local.in(feedGroupRoomName(COMPANY, GROUP)).fetchSockets()).some(
      (s) => s.id === client.id,
    );

  /** Nối + chờ tới khi server ĐÃ đưa socket vào room nhóm (poll — không `sleep` cố định). */
  async function connectMember(userId: string): Promise<ClientSocket> {
    const client = ioClient(`http://127.0.0.1:${port}/${WS_NAMESPACE}`, {
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
    while (!(await inGroupRoom(client))) {
      if (Date.now() - start > 3000) throw new Error("hết giờ chờ socket vào room nhóm");
      await new Promise((r) => setTimeout(r, 20));
    }
    return client;
  }

  function emitter(): RealtimeEmitterService {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const svc = new RealtimeEmitterService();
    svc.setServer(nsp as never);
    return svc;
  }

  it("⚓ mô phỏng THẬT SỰ nuốt: lệnh leave toàn cụm (không `local`) KHÔNG làm socket rời room", async () => {
    const u = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
    const client = await connectMember(u);
    const before = dropped.length;

    nsp.in(userRoomName(COMPANY, u)).socketsLeave(feedGroupRoomName(COMPANY, GROUP));

    expect(dropped.length).toBe(before + 1);
    expect(await inGroupRoom(client)).toBe(true);
  });

  it("🔒 leave khỏi room nhóm VẪN có hiệu lực khi lệnh toàn cụm bị mất — vế CỤC BỘ áp đồng bộ", async () => {
    const u = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
    const client = await connectMember(u);
    const before = dropped.length;

    emitter().syncFeedGroupMembership(COMPANY, GROUP, u, "leave");

    expect(await inGroupRoom(client)).toBe(false);
    // Vế toàn cụm VẪN được phát (cho node khác) — ở đây nó là thông điệp bị mất.
    expect(dropped.length).toBe(before + 1);
  });

  it("🔒 id CHỮ HOA (như route trả nguyên văn) + lệnh toàn cụm bị mất ⇒ socket VẪN rời room nhóm", async () => {
    const u = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";
    const client = await connectMember(u);

    emitter().syncFeedGroupMembership(
      COMPANY.toUpperCase(),
      GROUP.toUpperCase(),
      u.toUpperCase(),
      "leave",
    );

    expect(await inGroupRoom(client)).toBe(false);
  });
});
