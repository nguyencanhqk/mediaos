import type { INestApplication } from "@nestjs/common";
import type { Namespace } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { WS_CALL_NAMESPACE, WS_EVENTS, WS_NAMESPACE } from "@mediaos/contracts";
import { CallSignallingGateway } from "../../src/realtime/call-signalling.gateway";
import { callRoomName } from "../../src/realtime/rooms";
import { pollUntil } from "./social-group-rooms-fixture";

/**
 * S17-CHAT-RTROOMOPS-1 — fixture socket cho int-spec room-op CHAT/CALL (`chat-rtroomops-1.int-spec.ts`):
 * nối `/ws` và `/ws-call` bằng client thật, ghi sự kiện, `call:join`, lấy namespace `/ws-call` của CHÍNH
 * gateway, đo membership PHÍA SERVER.
 *
 * Khuôn đo tất định của `social-group-rooms-fixture.ts` (BE-2C): membership đọc bằng
 * `nsp.local.in(room).fetchSockets()` · membership dương = POLL · «nhận 0 sự kiện» chỉ khẳng định SAU một
 * NEO DƯƠNG trên chính socket đó (sự kiện phát sau, cùng kết nối ⇒ cùng thứ tự).
 *
 * ⚠️ File này KHÔNG dựng request HTTP nào (tạo phòng / mời gọi / gỡ thành viên ở trong spec): census
 * `S18-QA-SUPERTESTLISTEN-1` phân tích TỪNG FILE spec và dựa vào tiền đề «không helper dùng chung nào
 * dựng request» (`sharedRequestHelpers`).
 */

/** Cặp quyền đủ để đọc phòng (vào `/ws`), quản lý thành viên, gửi tin và GỌI (vào `/ws-call`). */
export const CALL_FULL_PAIRS = [
  "view:chat-room",
  "create:chat-room",
  "manage:chat-member",
  "send:chat-message",
  "call:chat-room",
] as const;

/** Một socket client + mọi sự kiện (trong `names`) nó nhận, theo thứ tự tới. */
export interface WsRecorder {
  socket: ClientSocket;
  events: { name: string; payload: Record<string, unknown> }[];
}

/** Namespace `/ws-call` của CHÍNH `CallSignallingGateway` (cùng mẹo `gatewayNamespace` của `/ws`). */
export function callNamespace(app: INestApplication): Namespace {
  return (app.get(CallSignallingGateway) as unknown as { server: Namespace }).server;
}

/** Socket `rec` có đang ở room `room` không — đọc PHÍA SERVER, chỉ adapter cục bộ. */
export async function inRoom(nsp: Namespace, room: string, rec: WsRecorder): Promise<boolean> {
  const sockets = await nsp.local.in(room).fetchSockets();
  return sockets.some((s) => s.id === rec.socket.id);
}

async function connectRecorder(
  port: number,
  nspName: string,
  token: string,
  names: readonly string[],
  open: ClientSocket[],
): Promise<WsRecorder> {
  const socket = ioClient(`http://127.0.0.1:${port}/${nspName}`, {
    auth: { token },
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
  });
  open.push(socket);
  const events: WsRecorder["events"] = [];
  for (const name of names) {
    socket.on(name, (payload: Record<string, unknown>) => events.push({ name, payload }));
  }
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", reject);
  });
  return { socket, events };
}

/**
 * Nối `/ws` + chờ tới khi server ĐÃ đưa socket vào phòng chat `room` (gateway join phòng từ danh sách
 * đọc DB SAU `chatuser` ⇒ readiness phải là chính room đó, không phải `chatuser`).
 */
export async function connectChatReady(
  port: number,
  nsp: Namespace,
  token: string,
  room: string,
  open: ClientSocket[],
): Promise<WsRecorder> {
  const rec = await connectRecorder(
    port,
    WS_NAMESPACE,
    token,
    [WS_EVENTS.CHAT_MESSAGE, WS_EVENTS.CHAT_ROOM],
    open,
  );
  await pollUntil(() => inRoom(nsp, room, rec), `socket vào phòng chat ${room}`);
  return rec;
}

/** Nối `/ws-call` (handshake đã join `calluser` TRƯỚC `next()`). */
export function connectCallSocket(
  port: number,
  token: string,
  open: ClientSocket[],
): Promise<WsRecorder> {
  return connectRecorder(
    port,
    WS_CALL_NAMESPACE,
    token,
    ["call:peer-joined", "call:peer-left", "call:media-state"],
    open,
  );
}

/**
 * `call:join` rồi chờ tới khi socket ở room cuộc gọi CHUẨN TẮC. Gateway không ack `call:join` nên thứ quan
 * sát được là membership phía server.
 */
export async function joinCallReady(
  callNsp: Namespace,
  rec: WsRecorder,
  companyId: string,
  callId: string,
): Promise<void> {
  rec.socket.emit("call:join", { callId });
  await pollUntil(
    () => inRoom(callNsp, callRoomName(companyId, callId), rec),
    `socket vào room cuộc gọi ${callId}`,
  );
}

/** Số sự kiện `name` có `payload[key] === value` mà socket đã nhận. */
export const countEvents = (rec: WsRecorder, name: string, key: string, value: unknown): number =>
  rec.events.filter((e) => e.name === name && e.payload[key] === value).length;

/** Chờ tới khi socket nhận ≥ 1 sự kiện khớp; hết giờ ⇒ NÉM (không bao giờ xanh im lặng). */
export async function waitForEvent(
  rec: WsRecorder,
  name: string,
  key: string,
  value: unknown,
): Promise<void> {
  await pollUntil(
    async () => countEvents(rec, name, key, value) > 0,
    `sự kiện ${name} có ${key}=${String(value)}`,
  );
}
