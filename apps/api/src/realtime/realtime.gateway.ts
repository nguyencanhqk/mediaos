import { Logger } from "@nestjs/common";
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import {
  WS_EVENTS,
  WS_NAMESPACE,
  wsChatJoinSchema,
  wsChatLeaveSchema,
  wsChatPresenceListSchema,
  wsChatSendSchema,
  wsChatTypingSchema,
  wsChatTypingEventSchema,
  type WsAck,
  type WsChatSendAck,
  type WsPresenceListAck,
} from "@mediaos/contracts";
import { loadEnv } from "../config/env.schema";
import { TokenService } from "../auth/token.service";
import { ChatService } from "../chat/chat.service";
import { RealtimeEmitterService } from "./realtime-emitter.service";
import { chatRoomName, userRoomName } from "./rooms";

/** Người dùng đã verify ở handshake — gắn vào socket.data (server-side, KHÔNG đọc từ payload client). */
interface SocketUser {
  id: string;
  companyId: string;
}

function getUser(client: Socket): SocketUser | undefined {
  return (client.data as { user?: SocketUser }).user;
}

const deny = (error: string): WsAck => ({ ok: false, error });
const ok = (): WsAck => ({ ok: true });

/**
 * RealtimeGateway (G10-1) — namespace `/ws`, Socket.IO.
 *
 * BẤT BIẾN:
 *  - Auth ở handshake (auth.token → TokenService) → socket.data.user. MỌI handler đọc companyId/userId
 *    TỪ SOCKET (server-side) — KHÔNG bao giờ từ payload client (contracts không có field đó).
 *  - Mọi handler fail-closed: chưa auth (socket.data.user undefined) → deny, KHÔNG nhờ guard (global guard
 *    bỏ qua non-http context). Membership check qua ChatService TRƯỚC khi join/broadcast.
 *  - Emit server→client luôn qua DTO `.parse()` (RealtimeEmitterService / parse inline) — masking như REST.
 *  - REALTIME_ENABLED=false → từ chối mọi connection (FE còn poll REST).
 */
@WebSocketGateway({ namespace: WS_NAMESPACE })
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly enabled = loadEnv().REALTIME_ENABLED === "true";

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly chat: ChatService,
    private readonly emitter: RealtimeEmitterService,
  ) {}

  afterInit(server: Server): void {
    if (!this.enabled) {
      this.logger.warn("REALTIME_ENABLED=false — gateway từ chối mọi connection (FE poll REST fallback)");
      // Middleware từ chối ở handshake level → client KHÔNG bao giờ nhận sự kiện `connect`.
      server.use((_socket, next) => next(new Error("realtime_disabled")));
      return;
    }
    // Auth middleware — chạy TRƯỚC khi Socket.IO emit `connect` về client (fail-closed tại handshake).
    // Dùng middleware thay vì handleConnection+disconnect(true) để tránh race:
    // disconnect(true) gọi sau khi `connect` đã được gửi → client thấy connect rồi mới thấy disconnect.
    server.use((client, next) => {
      const token = this.extractToken(client);
      if (!token) {
        this.logger.debug("WS handshake thiếu token → từ chối");
        return next(new Error("unauthorized"));
      }
      try {
        const claims = this.tokens.verifyAccessToken(token);
        const user: SocketUser = { id: claims.sub, companyId: claims.companyId };
        (client.data as { user?: SocketUser }).user = user;
        next();
      } catch {
        this.logger.debug("WS handshake token không hợp lệ/hết hạn → từ chối");
        next(new Error("unauthorized"));
      }
    });
    this.emitter.setServer(server);
    this.logger.log(`Realtime gateway sẵn sàng (namespace /${WS_NAMESPACE})`);
  }

  handleConnection(client: Socket): void {
    // Auth đã xác thực ở middleware trong afterInit → chỉ join user room ở đây.
    // Nếu REALTIME_ENABLED=false middleware đã chặn → không bao giờ vào đây.
    const user = getUser(client);
    if (!user) {
      // Phòng thủ: không nên xảy ra, nhưng fail-closed.
      client.disconnect(true);
      return;
    }
    void client.join(userRoomName(user.companyId, user.id));
  }

  handleDisconnect(client: Socket): void {
    // Socket.IO tự rời mọi room khi disconnect. Presence tính on-demand (chat:presence:list).
    const user = getUser(client);
    if (user) this.logger.debug(`WS disconnect user=${user.id}`);
  }

  // ─── chat:join ─────────────────────────────────────────────────────────────
  @SubscribeMessage(WS_EVENTS.CHAT_JOIN)
  async onJoin(client: Socket, payload: unknown): Promise<WsAck> {
    const user = getUser(client);
    if (!user) return deny("unauthenticated");
    const parsed = wsChatJoinSchema.safeParse(payload);
    if (!parsed.success) return deny("invalid_payload");

    try {
      const allowed = await this.chat.canAccessRoom(user.companyId, parsed.data.roomId, user.id);
      if (!allowed) return deny("forbidden");
      await client.join(chatRoomName(user.companyId, parsed.data.roomId));
      return ok();
    } catch (err) {
      this.logger.warn("chat:join error", { error: err instanceof Error ? err.message : String(err) });
      return deny("error");
    }
  }

  // ─── chat:leave ────────────────────────────────────────────────────────────
  @SubscribeMessage(WS_EVENTS.CHAT_LEAVE)
  async onLeave(client: Socket, payload: unknown): Promise<WsAck> {
    const user = getUser(client);
    if (!user) return deny("unauthenticated");
    const parsed = wsChatLeaveSchema.safeParse(payload);
    if (!parsed.success) return deny("invalid_payload");
    await client.leave(chatRoomName(user.companyId, parsed.data.roomId));
    return ok();
  }

  // ─── chat:send ─────────────────────────────────────────────────────────────
  @SubscribeMessage(WS_EVENTS.CHAT_SEND)
  async onSend(client: Socket, payload: unknown): Promise<WsChatSendAck> {
    const user = getUser(client);
    if (!user) return { ok: false, error: "unauthenticated" };
    const parsed = wsChatSendSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, error: "invalid_payload" };

    try {
      // ChatService kiểm membership, insert, emit chat:message tới room, tạo mention notification.
      const message = await this.chat.sendMessage(user.companyId, parsed.data.roomId, user.id, {
        body: parsed.data.body,
        mentions: parsed.data.mentions,
      });
      return { ok: true, data: message };
    } catch (err) {
      return { ok: false, error: this.mapError(err) };
    }
  }

  // ─── chat:typing (chỉ broadcast nếu socket đã join room) ─────────────────────
  @SubscribeMessage(WS_EVENTS.CHAT_TYPING)
  onTyping(client: Socket, payload: unknown): WsAck {
    const user = getUser(client);
    if (!user) return deny("unauthenticated");
    const parsed = wsChatTypingSchema.safeParse(payload);
    if (!parsed.success) return deny("invalid_payload");

    const room = chatRoomName(user.companyId, parsed.data.roomId);
    if (!client.rooms.has(room)) return deny("not_joined");

    const event = wsChatTypingEventSchema.parse({
      roomId: parsed.data.roomId,
      userId: user.id,
      isTyping: parsed.data.isTyping,
    });
    client.to(room).emit(WS_EVENTS.CHAT_TYPING_EVENT, event);
    return ok();
  }

  // ─── chat:presence:list ──────────────────────────────────────────────────────
  @SubscribeMessage(WS_EVENTS.CHAT_PRESENCE_LIST)
  async onPresenceList(client: Socket, payload: unknown): Promise<WsPresenceListAck> {
    const user = getUser(client);
    if (!user) return { ok: false, error: "unauthenticated" };
    const parsed = wsChatPresenceListSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, error: "invalid_payload" };

    const room = chatRoomName(user.companyId, parsed.data.roomId);
    if (!client.rooms.has(room)) return { ok: false, error: "not_joined" };

    const sockets = await this.server.in(room).fetchSockets();
    const userIds = [
      ...new Set(
        sockets
          .map((s) => (s.data as { user?: SocketUser }).user?.id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    return { ok: true, userIds };
  }

  // ─── helpers ─────────────────────────────────────────────────────────────────

  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth as { token?: unknown } | undefined;
    if (auth && typeof auth.token === "string" && auth.token.length > 0) return auth.token;
    const header = client.handshake.headers["authorization"];
    if (typeof header === "string" && header.startsWith("Bearer ")) return header.slice(7);
    return null;
  }

  /** Map exception → mã lỗi ngắn (KHÔNG leak chi tiết nội bộ ra client). */
  private mapError(err: unknown): string {
    const name = err instanceof Error ? err.name : "";
    if (name === "ForbiddenException") return "forbidden";
    if (name === "NotFoundException") return "not_found";
    return "error";
  }
}
