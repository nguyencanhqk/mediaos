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
import { DatabaseService } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import { ChatRoomsRepository } from "../chat/chat-rooms.repository";
import { RealtimeEmitterService } from "./realtime-emitter.service";
import { chatRoomName, chatUserRoomName, userRoomName } from "./rooms";

/** Cặp quyền đường ĐỌC của CHAT — CÙNG cặp mà `chat-rooms.controller.ts` bắt buộc cho mọi route đọc. */
const CHAT_READ_PAIR = { action: "view", resourceType: "chat-room" } as const;

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
 * Phục vụ HAI đường server→client: NOTI (`notification:new` tới user-room) và CHAT (`S7-CHAT-RT-1`).
 * FE vẫn poll REST / bù `afterSeq` khi REALTIME_ENABLED=false.
 *
 * ⚠️ **KHÔNG có `@SubscribeMessage` nào và không được thêm** (CHAT-DEC-005 — WS một chiều). Cụm chat
 * hai-chiều cũ đã bị gỡ ở CLEAN-DECOUPLE-1; RT-1 thêm lại theo mô hình MỚI chứ không khôi phục bản cũ.
 * Client muốn ghi thì gọi REST. Hệ quả trực tiếp: server KHÔNG BAO GIỜ đọc `roomId` từ client để quyết
 * định join — nó tự tra DB (`listActiveRooms`).
 *
 * BẤT BIẾN:
 *  - Auth ở handshake (auth.token → TokenService) → socket.data.user. Mọi nơi đọc companyId/userId TỪ SOCKET
 *    (server-side) — KHÔNG bao giờ từ payload client.
 *  - Fail-closed: chưa auth → disconnect; REALTIME_ENABLED=false → từ chối mọi connection ở handshake.
 *  - Emit server→client luôn qua DTO `.parse()` (RealtimeEmitterService) — masking như REST.
 */
@WebSocketGateway({ namespace: WS_NAMESPACE })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly enabled = loadEnv().REALTIME_ENABLED === "true";

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly emitter: RealtimeEmitterService,
    // ── S7-CHAT-RT-1 (additive) ── join phòng chat SERVER-SIDE lúc handshake.
    private readonly permissions: PermissionService,
    private readonly chatRooms: ChatRoomsRepository,
    private readonly db: DatabaseService,
  ) {}

  afterInit(server: Server): void {
    if (!this.enabled) {
      this.logger.warn(
        "REALTIME_ENABLED=false — gateway từ chối mọi connection (FE poll REST fallback)",
      );
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

  /**
   * S7-CHAT-RT-1 — join phòng lúc handshake. Danh sách phòng đọc TỪ DB PHÍA SERVER; KHÔNG có đường nào
   * nhận `roomId` từ payload/handshake của client.
   *
   * Bốn bước, thứ tự có ý nghĩa:
   *   (0) join `userRoomName` — đích `notification:new`, phải sống kể cả khi CHAT bị từ chối;
   *   (A) cổng quyền `view:chat-room` — thiếu cặp thì DỪNG ở đây (fail-SOFT: không disconnect);
   *   (B) tra danh sách phòng + join, kèm `chatUserRoomName` đánh dấu "socket này đã qua cổng";
   *   (C) đọc LẠI danh sách và rời phòng nào vừa biến mất — tự vá đua với `removeMember`.
   *
   * (A)(B)(C) nằm TRONG CÙNG một `try`: bước (C) cũng chạm DB, để nó ngoài `try` thì một lỗi ở đúng
   * bước tự-vá lại thành exception không ai bắt trong callback async mà Socket.IO KHÔNG await.
   */
  async handleConnection(client: Socket): Promise<void> {
    // Auth đã xác thực ở middleware trong afterInit. REALTIME_ENABLED=false → middleware đã chặn.
    const user = getUser(client);
    if (!user) {
      // Phòng thủ: không nên xảy ra, nhưng fail-closed.
      client.disconnect(true);
      return;
    }
    // (0) Đích NOTI — join TRƯỚC mọi bước có thể thất bại, và KHÔNG phụ thuộc cặp quyền CHAT.
    await client.join(userRoomName(user.companyId, user.id));

    try {
      // ── (A) Cổng quyền đường đọc WS ──────────────────────────────────────────────
      // Membership KHÔNG thay được cặp quyền: phòng department/project có thành viên DẪN XUẤT, nên hàng
      // `chat_room_members` vẫn còn sau khi quyền CHAT của user bị thu hồi ở tầng permission (hai tầng
      // khác nhau — cùng lập luận đã ghi ở `chat-rooms.controller.ts`). Phải kiểm CẢ HAI.
      // Type-level (không truyền `resourceId`) = CÙNG MỨC với `@RequirePermission("view","chat-room")`
      // trên các route đọc REST. Cặp này `is_sensitive = false` (mig 0538) ⇒ không cần `ctx` reauth.
      const decision = await this.permissions.can({
        userId: user.id,
        companyId: user.companyId,
        ...CHAT_READ_PAIR,
      });
      if (!decision.allow) {
        // Fail-SOFT có chủ đích: thiếu quyền là quyết định NGHIỆP VỤ hợp lệ (giống 403 ở REST), không
        // phải sự cố. Đường NOTI ở bước (0) vẫn sống; chỉ không join phòng chat nào.
        this.logger.debug(
          `WS: user=${user.id} thiếu cặp view:chat-room — chỉ join user-room (NOTI)`,
        );
        return;
      }

      // Đánh dấu "socket này ĐÃ qua cổng quyền CHAT". `emitChatRoom` và `syncRoomMembership('join')` chỉ
      // nhắm vào room này, nên socket trượt cổng ở trên không bao giờ bị kéo vào phòng chat về sau.
      await client.join(chatUserRoomName(user.companyId, user.id));

      // ── (B) Tra danh sách phòng + join ───────────────────────────────────────────
      const rooms = await this.listActiveRooms(user);
      await Promise.all(rooms.map((roomId) => client.join(chatRoomName(user.companyId, roomId))));

      // ── (C) Đọc LẠI rồi rời phòng đã biến mất ────────────────────────────────────
      // Socket.IO KHÔNG await `handleConnection`. Nếu `removeMember` chạy đúng lúc socket đã ở trong
      // `userRoomName` (bước 0, xong sớm) nhưng CHƯA join phòng đó (vòng lặp B chưa tới), thì
      // `socketsLeave` của nó là no-op — rồi B mới join vào phòng vừa bị gỡ, và socket kẹt lại đó tới
      // khi disconnect. Đọc lại + rời phần chênh lệch đóng gần hết cửa sổ đua.
      const fresh = new Set(await this.listActiveRooms(user));
      await Promise.all(
        rooms
          .filter((roomId) => !fresh.has(roomId))
          .map((roomId) => client.leave(chatRoomName(user.companyId, roomId))),
      );
    } catch (err) {
      // FAIL LOUD, không fail-soft. "Connected mà 0 phòng" và "connected mà join đủ" là hai trạng thái
      // client KHÔNG phân biệt được — Socket.IO không phát sự kiện nào cho "handleConnection lỗi nhưng
      // vẫn connect". FE sẽ tin mình đang realtime, không bù `afterSeq`, và mất tin trong im lặng tới
      // khi người dùng tự F5. `disconnect` thì client CHẮC CHẮN nhận được và tự reconnect (backoff mặc
      // định của socket.io-client) ⇒ mất kết nối rõ ràng còn hơn sống dối.
      this.logger.error("WS: join phòng chat lúc connect thất bại — ngắt kết nối để FE thấy rõ", {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    // Socket.IO tự rời mọi room khi disconnect.
    const user = getUser(client);
    if (user) this.logger.debug(`WS disconnect user=${user.id}`);
  }

  // ─── helpers ─────────────────────────────────────────────────────────────────

  /**
   * Id các phòng đang hoạt động của user (không lưu trữ).
   *
   * Tái dùng `ChatRoomsRepository.listRoomsForUser` — bản LIỆT KÊ của CÙNG luật membership mà
   * `ChatAccessService.assertMember` dùng (đối chiếu cột-cho-cột: `company_id` khớp ·
   * `chat_rooms.deleted_at IS NULL` · `chat_room_members.user_id` · `left_at IS NULL`). KHÔNG viết lại
   * vị từ ở đây: một bản sao thứ hai của luật quyền là một bản sao sẽ trôi.
   *
   * Vì sao không gọi `assertMember` N lần: nó khẳng định MỘT phòng và ném 404 nếu sai — không có
   * `roomId` nào để truyền vào lúc connect, và N round-trip cho N phòng là lãng phí thuần.
   */
  private async listActiveRooms(user: SocketUser): Promise<string[]> {
    const rows = await this.db.withTenant(user.companyId, (tx) =>
      this.chatRooms.listRoomsForUser(tx, user.companyId, user.id, { archived: false }),
    );
    return rows.map((r) => r.id);
  }

  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth as { token?: unknown } | undefined;
    if (auth && typeof auth.token === "string" && auth.token.length > 0) return auth.token;
    const header = client.handshake.headers["authorization"];
    if (typeof header === "string" && header.startsWith("Bearer ")) return header.slice(7);
    return null;
  }
}
