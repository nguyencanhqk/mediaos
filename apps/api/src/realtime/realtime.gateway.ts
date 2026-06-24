import { Logger } from "@nestjs/common";
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { WS_NAMESPACE } from "@mediaos/contracts";
import { loadEnv } from "../config/env.schema";
import { TokenService } from "../auth/token.service";
import { RealtimeEmitterService } from "./realtime-emitter.service";
import { userRoomName } from "./rooms";

/** Người dùng đã verify ở handshake — gắn vào socket.data (server-side, KHÔNG đọc từ payload client). */
interface SocketUser {
  id: string;
  companyId: string;
}

function getUser(client: Socket): SocketUser | undefined {
  return (client.data as { user?: SocketUser }).user;
}

/**
 * RealtimeGateway (G10-1) — namespace `/ws`, Socket.IO.
 *
 * Phạm vi sau CLEAN-DECOUPLE-1 (de-media-fy): cụm chat = out-of-scope đã gỡ. Gateway giờ CHỈ phục vụ
 * đường NOTI server→client (push) — không còn `@SubscribeMessage` chat. Tin đẩy đi qua RealtimeEmitterService
 * (notification:new tới user-room). FE vẫn poll REST khi REALTIME_ENABLED=false.
 *
 * BẤT BIẾN:
 *  - Auth ở handshake (auth.token → TokenService) → socket.data.user. Mọi nơi đọc companyId/userId TỪ SOCKET
 *    (server-side) — KHÔNG bao giờ từ payload client.
 *  - Fail-closed: chưa auth → disconnect; REALTIME_ENABLED=false → từ chối mọi connection ở handshake.
 *  - Emit server→client luôn qua DTO `.parse()` (RealtimeEmitterService) — masking như REST.
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
    // Auth đã xác thực ở middleware trong afterInit → chỉ join user room ở đây (đích notification:new).
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
    // Socket.IO tự rời mọi room khi disconnect.
    const user = getUser(client);
    if (user) this.logger.debug(`WS disconnect user=${user.id}`);
  }

  // ─── helpers ─────────────────────────────────────────────────────────────────

  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth as { token?: unknown } | undefined;
    if (auth && typeof auth.token === "string" && auth.token.length > 0) return auth.token;
    const header = client.handshake.headers["authorization"];
    if (typeof header === "string" && header.startsWith("Bearer ")) return header.slice(7);
    return null;
  }
}
