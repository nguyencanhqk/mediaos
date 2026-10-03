import { Logger, type OnModuleDestroy } from "@nestjs/common";
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { WS_NAMESPACE, type DataScope } from "@mediaos/contracts";
import { loadEnv } from "../config/env.schema";
import { TokenService } from "../auth/token.service";
import { DatabaseService } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import { ChatRoomsRepository } from "../chat/chat-rooms.repository";
import { SocialGroupRoomsReader } from "../social/social-group-rooms.reader";
import { RealtimeEmitterService } from "./realtime-emitter.service";
import { ChatPresenceService, PRESENCE_HEARTBEAT_MS } from "./chat-presence.service";
import {
  chatRoomName,
  chatUserRoomName,
  feedGroupRoomName,
  feedRoomName,
  feedUserRoomName,
  userRoomName,
} from "./rooms";

/** Cặp quyền đường ĐỌC của CHAT — CÙNG cặp mà `chat-rooms.controller.ts` bắt buộc cho mọi route đọc. */
const CHAT_READ_PAIR = { action: "view", resourceType: "chat-room" } as const;

/**
 * S16-SOCIAL-BE-1 — cặp quyền đường ĐỌC của SOCIAL, CÙNG cặp mà mọi route đọc bảng tin bắt buộc
 * (`SOCIAL_ROUTE_PAIRS.feedList`). Type-level (không `resourceId`) = cùng mức với `@RequirePermission`.
 * `is_sensitive = false` (mig 0578) ⇒ không cần `ctx` reauth.
 */
const FEED_READ_PAIR = { action: "view", resourceType: "feed" } as const;

/**
 * S16-SOCIAL-BE-2C · FULL gate lượt 1 (HIGH — security-reviewer + typescript-reviewer) — SÀN SCOPE của
 * cổng bảng tin WS: CÙNG vị từ với `SocialAccessService.isCompany` mà REST ép qua `companyFloor` ở MỌI
 * route SOCIAL (`resolveActor` ném 403 `AUTH-ERR-SCOPE-DENIED` khi scope hẹp hơn Company). Spec
 * `realtime.gateway.feed.spec.ts` GW2c so HÀNH VI cổng với `isCompany` trên MỌI scope (+ `null`) — hai bản
 * không trôi khỏi nhau được.
 *
 * Vì sao KHÔNG `can()`: `can()` đọc grant qua `getCompanyRoleGrants` — không SELECT `data_scope` — nên grant
 * `view:feed` ở scope NÀO cũng cho qua. Role-admin cho gán `view:feed@Department` (chỉ chặn `System`) ⇒ vai
 * đó bị REST 403 toàn bộ bảng tin/nhóm, nhưng WS cũ vẫn đưa socket vào `feed`, `feeduser` và MỌI room nhóm
 * kín mà người đó là thành viên — đúng lỗ HIGH-1 của FULL gate BE-1, nay mở rộng sang nội dung nhóm kín.
 * Không import `SocialAccessService`: gateway chỉ được chạm `social/**` qua module lá (S1).
 */
function meetsFeedScopeFloor(scope: DataScope | null): boolean {
  return scope === "Company" || scope === "System";
}

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
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly enabled = loadEnv().REALTIME_ENABLED === "true";
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly emitter: RealtimeEmitterService,
    // ── S7-CHAT-RT-1 (additive) ── join phòng chat SERVER-SIDE lúc handshake.
    private readonly permissions: PermissionService,
    private readonly chatRooms: ChatRoomsRepository,
    private readonly db: DatabaseService,
    // ── S8-CHAT-UX-RT-1 (additive) ── "đang online" theo vòng đời kết nối (CHAT-DEC-017).
    private readonly presence: ChatPresenceService,
    // ── S16-SOCIAL-BE-2C (additive, CUỐI — 3 spec dựng tay theo vị trí) ── liệt kê nhóm bảng tin của
    // user lúc connect. Tiêm DI, KHÔNG qua `this.db`: khối CHAT bên dưới đếm lượt `db.withTenant` (spec
    // `realtime.gateway.chat.spec.ts`), và một lượt của bảng tin chen vào sẽ làm ca đó đo sai bước.
    private readonly feedGroupRooms: SocialGroupRoomsReader,
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

    // S8-CHAT-UX-RT-1 — nhịp tim presence. Chỉ khởi động khi realtime BẬT (nhánh trên đã `return`), nên
    // các test dựng gateway trực tiếp mà không gọi `afterInit` sẽ không có timer nào để rò.
    // `.unref()`: một interval "sống" giữ tiến trình Node không thoát được — với suite vitest thì đó là
    // treo lúc teardown, với worker/CLI thì đó là process không bao giờ kết thúc.
    this.heartbeat = setInterval(() => {
      void this.presence.refreshLocal();
    }, PRESENCE_HEARTBEAT_MS);
    this.heartbeat.unref?.();

    this.logger.log(`Realtime gateway sẵn sàng (namespace /${WS_NAMESPACE})`);
  }

  /**
   * S7-CHAT-RT-1 — join phòng lúc handshake. Danh sách phòng đọc TỪ DB PHÍA SERVER; KHÔNG có đường nào
   * nhận `roomId` từ payload/handshake của client.
   *
   * Các bước, thứ tự có ý nghĩa:
   *   (0) join `userRoomName` — đích `notification:new`, phải sống kể cả khi CHAT bị từ chối;
   *   (0b) khối bảng tin RIÊNG (`joinFeedRooms` — S16-SOCIAL-BE-1/BE-2C): cổng `view:feed` @Company (sàn
   *       REST) → room công ty + room đánh dấu `feeduser` → room nhóm đọc từ DB + đọc lại; chạy XONG trước
   *       khối CHAT;
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

    // ── (0b) Khối bảng tin — S16-SOCIAL-BE-1 (cổng `view:feed`) + BE-2C (room nhóm) ──────────
    // ⚠️ KHỐI RIÊNG, ĐẶT TRƯỚC khối CHAT có chủ đích. Khối CHAT `return` sớm khi thiếu
    // `view:chat-room`; gộp cổng feed vào trong đó sẽ làm mọi người KHÔNG có quyền chat mất luôn bảng
    // tin — hai cặp quyền độc lập, hai quyết định độc lập.
    //
    // Fail-SOFT cho phiên: một trục trặc của bảng tin KHÔNG được ngắt phiên chat của mọi người. Ngoại
    // lệ DUY NHẤT (BE-2C, fail-CLOSED cho room nhóm): dọn room nhóm sau lỗi mà cũng lỗi ⇒ socket có thể
    // còn ở room nhóm dựa trên một lần đọc CHƯA được xác nhận lại ⇒ `joinFeedRooms` đã ngắt ⇒ dừng ở đây.
    if (!(await this.joinFeedRooms(client, user))) return;

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

      // ── (A2) Presence — S8-CHAT-UX-RT-1 ──────────────────────────────────────────
      // ĐẶT SAU cổng quyền (A) có chủ đích: người trượt cặp `view:chat-room` không xuất hiện trong
      // presence của bất kỳ ai — cổng quyền CHAT phủ cả kênh này, không riêng kênh tin nhắn.
      //
      // ⚠️ `.catch()` TẠI ĐÂY là bắt buộc, KHÔNG thừa dù `ChatPresenceService` đã tự nuốt lỗi bên trong.
      // Khối `try` này fail-LOUD (`disconnect(true)` ở `catch` dưới) vì "connected mà 0 phòng" là trạng
      // thái sống dối. Presence KHÔNG thuộc nhóm đó: "connected mà không ai thấy mình online" chỉ là
      // thiếu mỹ thuật. Để lỗi presence rơi vào `catch` chung nghĩa là một Valkey lỗi sẽ NGẮT phiên chat
      // của mọi người — biến một tính năng phụ thành điểm chết của cả module. Không dựa vào kỷ luật nội
      // bộ của service: hàng rào phải nằm ở chỗ hệ quả xảy ra.
      await this.presence
        .markOnline(user.companyId, user.id, client.id)
        .catch((err: unknown) => this.logPresenceFailure("markOnline", user.id, err));

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

  /**
   * Socket.IO tự rời mọi room khi disconnect — không có gì phải dọn ở tầng room.
   *
   * S8-CHAT-UX-RT-1 thêm gỡ presence. Đây CŨNG là đường mà việc thu hồi phiên đi qua:
   * `RealtimeEmitterService.severUserSessions` (tài khoản bị khoá/vô hiệu) gọi `disconnectSockets(true)`
   * ⇒ Socket.IO phát `disconnect` ⇒ hàm này chạy ⇒ người đó biến khỏi presence. Không cần móc riêng.
   *
   * ⚠️ Socket.IO **không await** hook này. Một promise reject thoát ra đây là `unhandledRejection` —
   * đủ để giết cả tiến trình test (memory `vitest-unhandled-rejection-after-teardown`). `markOffline` đã
   * tự bắt lỗi bên trong; `.catch()` ở đây là lớp bồi cho đúng tính chất "không await" đó.
   */
  handleDisconnect(client: Socket): void {
    const user = getUser(client);
    if (!user) return;
    this.logger.debug(`WS disconnect user=${user.id}`);
    void this.presence
      .markOffline(user.companyId, user.id, client.id)
      .catch((err: unknown) => this.logPresenceFailure("markOffline", user.id, err));
  }

  /**
   * Presence hỏng là chuyện MỸ THUẬT — nhưng im lặng ở đây nghĩa là cả tính năng "đang online" chết mà
   * không ai biết, và người dùng thì thấy đồng nghiệp offline vĩnh viễn. WARN, không ERROR: không có
   * nghiệp vụ nào sai vì việc này.
   */
  private logPresenceFailure(op: string, userId: string, err: unknown): void {
    this.logger.warn(`WS: ${op} thất bại — trạng thái "đang online" có thể sai`, {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  /**
   * Dọn nhịp tim presence. `OnModuleDestroy` là chỗ DUY NHẤT gỡ được timer này — thiếu nó, mỗi lần dựng
   * app trong test để lại một interval sống, và một tick sau teardown chạm vào Valkey/DB đã đóng.
   */
  onModuleDestroy(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  // ─── helpers ─────────────────────────────────────────────────────────────────

  /**
   * S16-SOCIAL-BE-1 + BE-2C — khối bảng tin của `handleConnection` (plan BE-2C §4.4). Trả `false` ⇔ đã
   * phải NGẮT socket ⇒ caller `return` (không chạy khối CHAT trên một socket đã ngắt).
   *
   * Thứ tự có ý nghĩa:
   *   1. Cổng `view:feed` **@Company** — `resolveStrongestScope` + `meetsFeedScopeFloor` (CÙNG sàn REST
   *      `companyFloor`; FULL gate lượt 1, HIGH). Đọc grant TƯƠI: ngoài request HTTP, memo ảnh chụp grant
   *      là passthrough ⇒ mỗi lần connect một lượt DB, KHÔNG qua cache Valkey 300 s của `can()`. NGOÀI mọi
   *      tx (hàm tự mở `withTenant`; lồng tx là treo IM LẶNG). Thiếu cặp, scope hẹp hơn Company, hay lỗi hạ
   *      tầng (hàm trả `null` — fail-closed) ⇒ dừng, fail-SOFT, KHÔNG tra nhóm: membership không thay được
   *      cặp quyền.
   *   2. Join `feedRoomName` rồi `feedUserRoomName` (room ĐÁNH DẤU) **TRƯỚC** khi đọc membership — đóng
   *      đua với `038` duyệt: hoặc `socketsJoin` sau-commit của `038` thấy socket đã ở room đánh dấu,
   *      hoặc lần đọc ở bước 3 (sau commit đó) thấy hàng `active`.
   *   3. Đọc nhóm (server tra DB — KHÔNG từ handshake) → GHI `joinedGroupRooms` TRƯỚC vòng join → join.
   *      Danh sách RỖNG ⇒ xong (bỏ bước 4 — không có room nào để rời; FULL gate lượt 1, database-reviewer:
   *      bớt một tx/connect cho đa số nhân viên không thuộc nhóm nào).
   *   4. Đọc LẠI → rời nhóm vừa biến mất (đua với `036/039`: lệnh leave sau-commit chạy lúc socket chưa
   *      join là no-op, rồi bước 3 đưa socket vào room vừa bị gỡ). Khuôn bước (C) của CHAT.
   *   5. Lỗi Ở BẤT KỲ bước nào ⇒ `error` + rời MỌI room nhóm đã join — owner ký Q-GWFAIL (a), bất biến 10.
   *      Lỗi ở bước 4 xảy ra SAU vòng join của bước 3: socket ĐÃ ở mọi room của lần đọc 1, kể cả room vừa
   *      bị `036/039` gỡ — log mà không dọn là fail-OPEN. Phiên + `feed` + `feeduser` vẫn sống (mất badge
   *      nhóm tới reconnect; lần `038/035/031` sau vẫn kéo vào được). `error` chứ không `warn` (FULL gate
   *      lượt 1, silent-failure-hunter): lỗi reader HỆ THỐNG (mất GRANT, RLS sửa hỏng) làm chết realtime
   *      nhóm của CẢ công ty — phải nhìn thấy được, không lẫn vào cảnh báo thường.
   *
   * Phần dư KHÔNG đóng (API-19 §7, plan R8): khe giữa join ở bước 3 và leave ở bước 4 — một bài commit
   * SAU `039` trong khe đó vẫn tới người vừa bị gỡ (cùng hình dạng phần dư bước (C) của CHAT).
   */
  private async joinFeedRooms(client: Socket, user: SocketUser): Promise<boolean> {
    const joinedGroupRooms: string[] = [];
    try {
      const scope = await this.permissions.resolveStrongestScope(
        user.id,
        user.companyId,
        FEED_READ_PAIR.action,
        FEED_READ_PAIR.resourceType,
      );
      if (!meetsFeedScopeFloor(scope)) {
        this.logger.debug(
          `WS: user=${user.id} thiếu view:feed @Company (scope=${scope ?? "∅"}) — không join room bảng tin`,
        );
        return true;
      }
      await client.join(feedRoomName(user.companyId));
      await client.join(feedUserRoomName(user.companyId, user.id));

      const groupIds = await this.feedGroupRooms.listActiveGroupIds(user.companyId, user.id);
      if (groupIds.length === 0) return true;
      joinedGroupRooms.push(...groupIds.map((g) => feedGroupRoomName(user.companyId, g)));
      await Promise.all(joinedGroupRooms.map((room) => client.join(room)));

      const fresh = new Set(await this.feedGroupRooms.listActiveGroupIds(user.companyId, user.id));
      await Promise.all(
        groupIds
          .filter((g) => !fresh.has(g))
          .map((g) => client.leave(feedGroupRoomName(user.companyId, g))),
      );
      return true;
    } catch (err) {
      this.logger.error(
        "WS: khối bảng tin lỗi lúc connect — rời mọi room nhóm vừa join, phiên vẫn sống",
        {
          userId: user.id,
          groupRooms: joinedGroupRooms.length,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      return this.leaveFeedGroupRooms(client, user, joinedGroupRooms);
    }
  }

  /**
   * Bước dọn của `joinFeedRooms` (fail-CLOSED cho room nhóm). `client.leave` là thao tác adapter CỤC BỘ,
   * đồng bộ, nên gần như không thể lỗi — nhưng NẾU lỗi thì socket có thể còn ở một room nhóm mà không ai
   * xác nhận được ⇒ `error` + `disconnect(true)` (client chắc chắn nhận và tự reconnect qua cổng lần nữa —
   * khuôn fail-LOUD của khối CHAT).
   */
  private async leaveFeedGroupRooms(
    client: Socket,
    user: SocketUser,
    rooms: readonly string[],
  ): Promise<boolean> {
    try {
      await Promise.all(rooms.map((room) => client.leave(room)));
      return true;
    } catch (err) {
      this.logger.error("WS: dọn room nhóm bảng tin THẤT BẠI — ngắt kết nối (fail-closed)", {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
      client.disconnect(true);
      return false;
    }
  }

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
