import { Logger, UseFilters } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Namespace, Socket } from "socket.io";
import type { ZodType } from "zod";
import {
  CHAT_CALL_OUTBOUND_EVENTS,
  WS_CALL_NAMESPACE,
  chatCallIceCandidateSchema,
  chatCallJoinSchema,
  chatCallLeaveSchema,
  chatCallMediaStateSchema,
  chatCallPeerSchema,
  chatCallPingSchema,
  chatCallPongSchema,
  chatCallRelayIceCandidateSchema,
  chatCallRelayMediaStateSchema,
  chatCallRelayScreenStateSchema,
  chatCallRelaySdpSchema,
  chatCallScreenStateSchema,
  chatCallSdpSchema,
  type ChatCallOutboundEvent,
  type ChatCallPongPayload,
} from "@mediaos/contracts";
import { loadEnv } from "../config/env.schema";
import { TokenService } from "../auth/token.service";
import { SecurityEventWriter } from "../auth/security-event-writer.service";
import { DatabaseService } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import {
  CHAT_CALL_CONNECT_MAX_PER_MIN,
  CHAT_CALL_VIOLATION_MAX_PER_MIN,
  buildSignalViolationPayload,
  chargeFrame,
  classifyMissingParticipant,
  isInboundCallEvent,
  newFrameBudget,
  type FrameBudget,
  type SignalDenyReason,
} from "../chat/chat-call-signal-deny";
import {
  CHAT_CALL_COOLDOWN_SCOPE,
  ChatCallCooldownService,
} from "../chat/chat-call-cooldown.service";
import { ChatCallSignalService, type ChatCallSignalAccess } from "../chat/chat-call-signal.service";
import { RealtimeEmitterService } from "./realtime-emitter.service";
import { CallSignallingExceptionFilter } from "./call-signalling.filter";
import { callRoomName, callUserRoomName } from "./rooms";

/** Cặp quyền cổng module của CALL — CÙNG cặp mà `chat-calls.controller.ts` bắt buộc cho mọi route. */
const CALL_PAIR = { action: "call", resourceType: "chat-room" } as const;

/**
 * Ảnh chụp cặp quyền có tuổi thọ tối đa 60 s.
 *
 * ⚠️ Đây là cache CÓ CHỦ ĐÍCH và nó KHÔNG mâu thuẫn với luật "mỗi khung kiểm lại từ DB": luật đó nói về
 * **tư cách tham gia cuộc gọi** (vẫn đọc DB mỗi khung, không cache). Còn cặp quyền: kiểm mỗi khung là
 * thêm một round-trip nữa cho mỗi ICE candidate, kiểm một lần duy nhất lúc handshake là để cửa sổ thu
 * hồi quyền **VÔ HẠN** (Socket.IO không tái xác thực kết nối đang mở). 60 s là mức chốt được ghi ra.
 */
const PERMISSION_SNAPSHOT_TTL_MS = 60_000;

interface CallSocketUser {
  id: string;
  companyId: string;
}

/**
 * Trạng thái server-side của một socket `/ws-call`. **Không có gì ở đây tới từ payload client** — tất cả
 * do handshake hoặc chính gateway đặt.
 */
interface CallSocketState {
  user: CallSocketUser;
  /** `exp` của access-token (giây, epoch) — ghim lúc handshake, xem `assertFresh`. */
  tokenExpSec: number;
  permissionCheckedAtMs: number;
  budget: FrameBudget;
  /** ĐÃ ghi một hàng `user_security_events` cho kết nối này chưa (trần 1 hàng/kết nối). */
  violated: boolean;
  /** `callId` mà socket này đã `call:join` — dùng để báo `peer-left` khi rớt. */
  joinedCallId: string | null;
}

const stateOf = (client: Socket): CallSocketState | undefined =>
  (client.data as { state?: CallSocketState }).state;

/**
 * CallSignallingGateway (`S7-CALL-RT-1`) — namespace `/ws-call`, **ngoại lệ DUY NHẤT** của `CHAT-DEC-005`.
 *
 * ┌─ ĐỌC TRƯỚC KHI SỬA FILE NÀY ────────────────────────────────────────────────────────────────────┐
 * │ Đây là chỗ DUY NHẤT trong toàn hệ mà client được GHI lên WebSocket. Owner ký `DECISIONS-07`      │
 * │ (08/08/2026) để đổi lấy đúng 4 hàng rào; ba trong số đó sống trong file này:                     │
 * │   R1 — namespace RIÊNG. `/ws` (CHAT+NOTI) giữ nguyên 0 `@SubscribeMessage`, có ratchet đóng đinh.│
 * │   R2 — allowlist ĐÓNG đúng 8 sự kiện. Ngoài danh sách ⇒ `user_security_events` + NGẮT.           │
 * │   R3 — SDP/ICE chỉ RELAY: không parse cấu trúc, không đọc, **không ghi DB**, không lên DTO nào.  │
 * │        Ngày nào ta lưu SDP thì ngoại lệ `CHAT-DEC-020` HẾT HIỆU LỰC — không phải "cần sửa doc".  │
 * │ R4 (vòng đời cuộc gọi đi REST) sống ở `chat-calls.controller.ts`; file này KHÔNG ghi `chat_calls`│
 * │ một dòng nào, và không được thêm.                                                               │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * BẤT BIẾN của file:
 *  - `companyId`/`userId` LUÔN lấy từ `socket.data` (đặt lúc handshake), **không bao giờ** từ payload.
 *  - MỖI khung kiểm lại tư cách tham gia cuộc gọi **từ DB** — việc socket đang ở trong room KHÔNG phải
 *    chứng chỉ (memory `ws-permission-gate-needs-its-own-room`).
 *  - Đúng **một** call site `.emit(` (helper `relay`), luôn `.parse()` trước — masking là cấu trúc, không
 *    phải kỷ luật. Ratchet `chat-realtime-structure.spec.ts` đếm cả hai điều này.
 *  - 7/8 handler trả `undefined`. Giá trị trả về của handler đi thẳng vào `ack` mà **client tự bật được**
 *    (`@nestjs/platform-socket.io` lấy `ack` từ đối số cuối của khung client gửi) ⇒ nó là một đường emit
 *    KHÔNG qua masking. Chỉ `call:ping` trả dữ liệu, và dữ liệu đó đã `.parse()`.
 */
@UseFilters(CallSignallingExceptionFilter)
@WebSocketGateway({ namespace: WS_CALL_NAMESPACE })
export class CallSignallingGateway {
  private readonly logger = new Logger(CallSignallingGateway.name);
  private readonly enabled = loadEnv().REALTIME_ENABLED === "true";

  @WebSocketServer()
  private server!: Namespace;

  constructor(
    private readonly tokens: TokenService,
    private readonly permissions: PermissionService,
    private readonly signal: ChatCallSignalService,
    private readonly cooldown: ChatCallCooldownService,
    private readonly securityEvents: SecurityEventWriter,
    private readonly db: DatabaseService,
    private readonly emitter: RealtimeEmitterService,
  ) {}

  /**
   * Toàn bộ việc dựng phiên nằm trong **middleware handshake**, không ở `handleConnection`.
   *
   * ⚠️ Lý do là một cuộc đua thật: `@nestjs/websockets/web-sockets-controller.js` gọi
   * `connection.next(args)` (tức `handleConnection`, **KHÔNG await**) rồi **dòng ngay sau** đã
   * `subscribeMessages`. Nếu `join(callUserRoomName)` nằm trong `handleConnection`, có cửa sổ socket đã
   * connected + đã bind handler nhưng CHƯA ở room đích ⇒ `call:sdp-offer` của bên kia relay vào room
   * rỗng và **mất im lặng**. WebRTC không gửi lại offer ⇒ cuộc gọi không bao giờ nối, không lỗi nào hiện
   * ra, và ca test chỉ FLAKY chứ không đỏ ổn định. Trong middleware thì `connect` chưa gửi về client, nên
   * không có cửa sổ nào (cùng lập luận đã dùng ở `realtime.gateway.ts`).
   *
   * ⚠️ **KHÔNG gọi `emitter.setServer(...)`** — đó là namespace `/ws`. Ghi đè bằng `/ws-call` sẽ làm
   * `notification:new` + toàn bộ cụm CHAT bắn vào một namespace không ai ở trong, hỏng IM LẶNG toàn hệ.
   * `setCallServer` là setter RIÊNG, chỉ để `severUserSessions` với tới được kênh này.
   */
  afterInit(server: Namespace): void {
    if (!this.enabled) {
      this.logger.warn("REALTIME_ENABLED=false — /ws-call từ chối mọi kết nối (KHÔNG gọi được)");
      server.use((_socket, next) => next(new Error("realtime_disabled")));
      return;
    }

    server.use((client, next) => {
      void this.handshake(client)
        .then((err) => next(err))
        .catch((err: unknown) => {
          // Fail-CLOSED: một lỗi hạ tầng ở cổng vào KHÔNG được biến thành "cho qua".
          this.logger.error(
            "/ws-call handshake lỗi — từ chối: " +
              (err instanceof Error ? err.message : String(err)),
          );
          next(new Error("unauthorized"));
        });
    });

    this.emitter.setCallServer(server);
    this.logger.log(`Call signalling gateway sẵn sàng (namespace /${WS_CALL_NAMESPACE})`);
  }

  /**
   * @returns `Error` = từ chối handshake, `undefined` = cho qua.
   *
   * Fail-CLOSED ở cả hai cổng — khác `/ws` (fail-SOFT cho cặp `view:chat-room`) và khác có chủ đích:
   * `/ws` phục vụ HAI đường (NOTI vẫn sống khi trượt cổng CHAT), còn `/ws-call` có ĐÚNG một mục đích.
   * Giữ một kết nối chỉ để từ chối từng khung là dựng sẵn một bề mặt dò cửa.
   */
  private async handshake(client: Socket): Promise<Error | undefined> {
    const token = this.extractToken(client);
    if (!token) {
      this.logger.debug("/ws-call handshake thiếu token → từ chối");
      return new Error("unauthorized");
    }

    let user: CallSocketUser;
    let expSec: number;
    try {
      const claims = this.tokens.verifyAccessToken(token);
      // Fail-CLOSED trên token KHÔNG có `exp`: `jwt.verify` cho qua một token vô hạn, và ở kênh này
      // "vô hạn" nghĩa là một phiên signalling không bao giờ phải xác thực lại. `signAccessToken` LUÔN
      // đặt `expiresIn`, nên trường hợp này chỉ xảy ra với token dựng tay.
      if (typeof claims.exp !== "number") {
        this.logger.debug("/ws-call handshake: token không có `exp` → từ chối (fail-closed)");
        return new Error("unauthorized");
      }
      user = { id: claims.sub, companyId: claims.companyId };
      expSec = claims.exp;
    } catch {
      // Breadcrumb ngang với `/ws` (`realtime.gateway.ts`): thiếu nó thì "vì sao không nối được
      // /ws-call" không có dấu vết nào, trong khi cùng câu hỏi ở `/ws` thì có.
      this.logger.debug("/ws-call handshake token không hợp lệ/hết hạn → từ chối");
      return new Error("unauthorized");
    }

    // Trần số HANDSHAKE theo người: mỗi lần bắt tay tốn một `permissions.can()` (đọc DB), nên "ngắt khi
    // vi phạm" một mình không đủ — kẻ dò chỉ cần nối lại vòng lặp.
    const connectKey = ChatCallCooldownService.key(
      CHAT_CALL_COOLDOWN_SCOPE.SIGNALLING_CONNECT,
      user.companyId,
      user.id,
    );
    if (!(await this.cooldown.allow(connectKey, CHAT_CALL_CONNECT_MAX_PER_MIN, 60))) {
      this.logger.warn(`/ws-call: vượt trần bắt tay — từ chối. userId=${user.id}`);
      return new Error("too_many_connections");
    }

    // Cổng quyền mức TYPE (không `resourceId`) — CÙNG mức với `@RequirePermission('call','chat-room')`
    // ở REST. Ranh giới dữ liệu (ai gọi được với ai) là MEMBERSHIP, và nó được kiểm ở từng khung.
    const decision = await this.permissions.can({
      userId: user.id,
      companyId: user.companyId,
      ...CALL_PAIR,
    });
    if (!decision.allow) return new Error("forbidden");

    const state: CallSocketState = {
      user,
      tokenExpSec: expSec,
      permissionCheckedAtMs: Date.now(),
      budget: newFrameBudget(Date.now()),
      violated: false,
      joinedCallId: null,
    };
    (client.data as { state?: CallSocketState }).state = state;

    // ⚠️ Dòng ĐẦU TIÊN của `onAny` phải là compare-and-set ĐỒNG BỘ, xem `screenFrame`.
    client.onAny((event: string) => this.screenFrame(client, event));

    await client.join(callUserRoomName(user.companyId, user.id));
    return undefined;
  }

  /**
   * Cưỡng chế allowlist (**R2**) — chạy TRƯỚC mọi handler, cho MỌI khung.
   *
   * ⚠️ Vì sao phải có `onAny` chứ không dựa vào "không có handler thì thôi": một khung `call:evil` không
   * khớp handler nào sẽ bị Socket.IO **bỏ qua im lặng** — không ngắt, không ghi, và người dò cửa được thử
   * vô hạn lần miễn phí. R2 đòi ngược lại.
   *
   * ⚠️ Vì sao KHÔNG dùng `socket.use()` (middleware gói tin) cho việc này dù nó "đúng chỗ" hơn:
   * `next(err)` của nó đi qua `_onerror` → `emitReserved('error', …)`, mà Socket không có listener
   * `'error'` ⇒ EventEmitter ném ⇒ **SẬP TIẾN TRÌNH**. Ratchet cấm `socket.use(` chính vì thế.
   *
   * ⚠️ **HÀM NÀY PHẢI ĐỒNG BỘ Ở PHẦN QUYẾT ĐỊNH.** `socket.io/dist/socket.js#onevent` gọi mọi listener
   * `onAny` **đồng bộ** rồi mới `dispatch`. Client nhồi 50 khung vi phạm trong một lượt đọc ⇒ 50 lần hàm
   * này chạy hết TRƯỚC khi `await` đầu tiên của việc ghi resolve. Nếu cờ `violated` đặt sau `await` thì
   * kết quả là 50 hàng append-only từ MỘT kết nối. Compare-and-set trước, ghi sau.
   */
  private screenFrame(client: Socket, event: string): void {
    const state = stateOf(client);
    if (!state || state.violated) return;
    if (isInboundCallEvent(event)) return;

    state.violated = true;
    // ⚠️ `.catch` BẮT BUỘC: `onAny` không được await, nên một promise reject thoát ra đây là
    // `unhandledRejection` — đủ để giết cả tiến trình (memory `vitest-unhandled-rejection-after-teardown`).
    // `punish` đã tự bắt lỗi bên trong; đây là lớp bồi cho đúng tính chất "không ai await".
    void this.punish(client, state, event, "not_allowlisted").catch((err: unknown) =>
      this.logger.error(
        `/ws-call: punish() ném ngoài dự kiến: ` +
          (err instanceof Error ? err.message : String(err)),
      ),
    );
  }

  // ─── 8 handler — allowlist ĐÓNG (DECISIONS-07 §4) ─────────────────────────────

  /**
   * ⚠️ MỌI handler dưới đây trả `undefined` (trừ `call:ping`). Xem docblock của lớp: giá trị trả về là
   * một đường emit không qua masking mà CLIENT tự bật được bằng cách gắn ack.
   */
  @SubscribeMessage("call:join")
  async onJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<undefined> {
    const ctx = await this.accept(client, "call:join", chatCallJoinSchema, body);
    if (!ctx) return undefined;

    const { state, payload, access } = ctx;
    state.joinedCallId = access.callId;
    await client.join(callRoomName(state.user.companyId, payload.callId));
    this.relay(
      client,
      callRoomName(state.user.companyId, payload.callId),
      CHAT_CALL_OUTBOUND_EVENTS.PEER_JOINED,
      chatCallPeerSchema,
      { callId: payload.callId, userId: state.user.id },
    );
    return undefined;
  }

  @SubscribeMessage("call:leave")
  async onLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<undefined> {
    const ctx = await this.accept(client, "call:leave", chatCallLeaveSchema, body);
    if (!ctx) return undefined;

    const { state, payload } = ctx;
    // Phát TRƯỚC khi rời room: `client.to(room)` sau khi đã `leave` là bắn vào một room mình không còn ở
    // trong — Socket.IO vẫn gửi, nhưng thứ tự này làm ý định đọc được từ code.
    this.relay(
      client,
      callRoomName(state.user.companyId, payload.callId),
      CHAT_CALL_OUTBOUND_EVENTS.PEER_LEFT,
      chatCallPeerSchema,
      { callId: payload.callId, userId: state.user.id },
    );
    await client.leave(callRoomName(state.user.companyId, payload.callId));
    state.joinedCallId = null;
    return undefined;
  }

  @SubscribeMessage("call:sdp-offer")
  async onSdpOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<undefined> {
    return this.relaySdp(client, "call:sdp-offer", body, CHAT_CALL_OUTBOUND_EVENTS.SDP_OFFER);
  }

  @SubscribeMessage("call:sdp-answer")
  async onSdpAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<undefined> {
    return this.relaySdp(client, "call:sdp-answer", body, CHAT_CALL_OUTBOUND_EVENTS.SDP_ANSWER);
  }

  @SubscribeMessage("call:ice-candidate")
  async onIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<undefined> {
    const ctx = await this.accept(client, "call:ice-candidate", chatCallIceCandidateSchema, body);
    if (!ctx) return undefined;
    if (!(await this.assertPeer(client, ctx, ctx.payload.toUserId, "call:ice-candidate")))
      return undefined;

    this.relay(
      null,
      callUserRoomName(ctx.state.user.companyId, ctx.payload.toUserId),
      CHAT_CALL_OUTBOUND_EVENTS.ICE_CANDIDATE,
      chatCallRelayIceCandidateSchema,
      {
        callId: ctx.payload.callId,
        // `fromUserId` do SERVER gán — payload client KHÔNG có khoá này, và nếu có thì `.parse()` strip.
        fromUserId: ctx.state.user.id,
        candidate: ctx.payload.candidate,
      },
    );
    return undefined;
  }

  @SubscribeMessage("call:media-state")
  async onMediaState(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<undefined> {
    const ctx = await this.accept(client, "call:media-state", chatCallMediaStateSchema, body);
    if (!ctx) return undefined;

    this.relay(
      client,
      callRoomName(ctx.state.user.companyId, ctx.payload.callId),
      CHAT_CALL_OUTBOUND_EVENTS.MEDIA_STATE,
      chatCallRelayMediaStateSchema,
      {
        callId: ctx.payload.callId,
        userId: ctx.state.user.id,
        micOn: ctx.payload.micOn,
        camOn: ctx.payload.camOn,
      },
    );
    return undefined;
  }

  @SubscribeMessage("call:screen-state")
  async onScreenState(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<undefined> {
    const ctx = await this.accept(client, "call:screen-state", chatCallScreenStateSchema, body);
    if (!ctx) return undefined;

    this.relay(
      client,
      callRoomName(ctx.state.user.companyId, ctx.payload.callId),
      CHAT_CALL_OUTBOUND_EVENTS.SCREEN_STATE,
      chatCallRelayScreenStateSchema,
      {
        callId: ctx.payload.callId,
        userId: ctx.state.user.id,
        sharing: ctx.payload.sharing,
      },
    );
    return undefined;
  }

  /**
   * `call:ping` — phát hiện rớt, phía FE. Server chỉ xác nhận "phiên của bạn còn hợp lệ" và **không ghi
   * gì**: không DB, không presence, không đếm.
   *
   * Đây là handler DUY NHẤT trả dữ liệu, và nó đi qua `ack` — kênh mà client tự bật. Vì thế payload phải
   * `.parse()` như mọi đường phát khác, và chỉ mang `callId` (xem `chatCallPongSchema`).
   */
  @SubscribeMessage("call:ping")
  async onPing(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<{ event: ChatCallOutboundEvent; data: ChatCallPongPayload } | undefined> {
    const ctx = await this.accept(client, "call:ping", chatCallPingSchema, body);
    if (!ctx) return undefined;
    return {
      event: CHAT_CALL_OUTBOUND_EVENTS.PONG,
      data: chatCallPongSchema.parse({ callId: ctx.payload.callId }),
    };
  }

  /**
   * Socket rớt ⇒ báo `peer-left` cho phiên signalling nó đang tham gia.
   *
   * ⚠️ **IDEMPOTENT và KHÔNG ra quyết định an ninh nào.** Client thô gửi được một khung tên `disconnect`
   * (Socket.IO không lọc tên dành riêng ở chiều vào), nên hook này có thể chạy trong khi socket VẪN sống.
   * Hệ quả bị bó lại vì `onAny` xếp `disconnect` ngoài allowlist ⇒ ngắt thật ngay sau đó. Nhưng vì thế
   * tuyệt đối không được đặt ở đây bất kỳ việc gì thuộc về hạn mức/kiểm quyền.
   */
  handleDisconnect(client: Socket): void {
    const state = stateOf(client);
    if (!state?.joinedCallId) return;
    const callId = state.joinedCallId;
    state.joinedCallId = null;
    this.relay(
      null,
      callRoomName(state.user.companyId, callId),
      CHAT_CALL_OUTBOUND_EVENTS.PEER_LEFT,
      chatCallPeerSchema,
      { callId, userId: state.user.id },
    );
  }

  // ─── đường chung ─────────────────────────────────────────────────────────────

  /**
   * Cổng dùng chung của cả 8 handler. Trả `null` = **không xử lý khung này** (đã ghi/ngắt nếu cần).
   *
   * Thứ tự các bước có ý nghĩa, không đổi được:
   *  1. **trần khung** — trước MỌI truy vấn, nếu không lớp "bỏ im lặng" ở bước 5 trở thành bộ khuếch đại
   *     DoS lên DB (Nest gửi handler qua `mergeMap` concurrency vô hạn);
   *  2. **hạn token** — thuần CPU, và là vế duy nhất bó được một socket mở vô thời hạn;
   *  3. **cặp quyền** (ảnh chụp ≤60 s) — Socket.IO không tái xác thực kết nối đang mở;
   *  4. **Zod ở biên** — sai/vượt trần ⇒ lớp A (dò cửa giao thức);
   *  5. **tư cách tham gia, ĐỌC TỪ DB** — không tin room, không cache.
   */
  private async accept<T>(
    client: Socket,
    event: string,
    schema: ZodType<T>,
    body: unknown,
  ): Promise<{ state: CallSocketState; payload: T; access: ChatCallSignalAccess } | null> {
    const state = stateOf(client);
    if (!state) {
      // KHÔNG thể xảy ra: middleware đặt `state` TRƯỚC `next()`, mà handler chỉ chạy sau đó. Nếu nó xảy
      // ra thì đó là bug wiring — và không được phép trông giống hệt một khung bị chặn bình thường.
      this.logger.error(
        `/ws-call: khung tới mà socket KHÔNG có state (bug wiring) socket=${client.id}`,
      );
      client.disconnect(true);
      return null;
    }
    if (state.violated) return null;

    // (1) trần khung
    const charged = chargeFrame(state.budget, Date.now());
    state.budget = charged.budget;
    if (charged.verdict !== "ok") {
      if (charged.verdict === "disconnect") {
        this.logger.warn(
          `/ws-call: vượt trần khung CỨNG — ngắt. userId=${state.user.id} socket=${client.id}`,
        );
        client.disconnect(true);
      }
      // "drop": KHÔNG ghi security event — đây là bó băng thông, không phải cáo buộc dò cửa. NHƯNG
      // phải để lại dấu vết: không có dòng này thì "hệ thống đang bó băng thông" và "cuộc gọi hỏng"
      // trông giống hệt nhau (cả hai đều 0 log) khi có khiếu nại "tôi không gọi được".
      else {
        this.logger.debug(
          `/ws-call: bỏ khung ${event} vì vượt trần mềm (userId=${state.user.id} socket=${client.id})`,
        );
      }
      return null;
    }

    // (2) hạn token
    if (Date.now() >= state.tokenExpSec * 1000) {
      this.logger.debug(`/ws-call: token hết hạn — ngắt. userId=${state.user.id}`);
      client.disconnect(true);
      return null;
    }

    // (3) cặp quyền — ảnh chụp có tuổi thọ
    if (Date.now() - state.permissionCheckedAtMs > PERMISSION_SNAPSHOT_TTL_MS) {
      const decision = await this.permissions.can({
        userId: state.user.id,
        companyId: state.user.companyId,
        ...CALL_PAIR,
      });
      if (!decision.allow) {
        this.logger.debug(`/ws-call: cặp quyền đã bị thu hồi — ngắt. userId=${state.user.id}`);
        client.disconnect(true);
        return null;
      }
      state.permissionCheckedAtMs = Date.now();
    }

    // (4) Zod ở biên. `sdp`/`candidate` chỉ bị kiểm KIỂU + TRẦN ĐỘ DÀI — không parse cấu trúc (R3).
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      // Phân biệt "vượt trần" với "sai hình dạng" CHỈ để forensic đọc được; cả hai cùng một xử lý.
      const reason: SignalDenyReason = parsed.error.issues.some((i) => i.code === "too_big")
        ? "too_long"
        : "schema";
      await this.deny(client, state, event, reason);
      return null;
    }

    // (5) tư cách tham gia — ĐỌC TỪ DB, mỗi khung
    const access = await this.signal.resolveSignalAccess(
      state.user.companyId,
      (parsed.data as { callId: string }).callId,
      state.user.id,
    );

    if (!access || !access.actorIsParticipant) {
      // `null` = cuộc gọi không tồn tại · tenant khác · phòng đã xoá · actor không thuộc phòng — BỐN lý
      // do một xử lý, giống hệt 404 hằng của `assertCallAccess`. Không nói cho client biết lý do nào.
      //
      // ⚠️ Vị từ ở đây là `actorIsParticipant` (CÓ HÀNG, bất kể kết cục), KHÔNG phải `actorIsActive`.
      // Dùng `actorIsActive` là xếp NGƯỜI VỪA GÁC MÁY (outcome đã thành `'left'`) vào nhóm dò cửa — một
      // ICE candidate còn trên đường bay sẽ ngắt kết nối họ và ghi một hàng an ninh sai. Bộ int-spec
      // (CA 9) bắt đúng ca đó; đừng "gọn hoá" hai vị từ này thành một.
      //
      // Ranh giới vì thế ĐỒNG NHẤT cho người ngoài: chưa từng được mời ⇒ luôn lớp B, dù cuộc gọi còn
      // sống hay đã kết thúc — không có oracle "cuộc gọi này còn sống không" ở đây.
      if (classifyMissingParticipant(event) === "probe") {
        await this.deny(client, state, event, "not_participant");
      } else {
        // Lớp C của nhánh "chưa từng được mời" (join/leave/ping/media/screen). Im lặng với CLIENT là
        // đúng, im lặng với NGƯỜI VẬN HÀNH thì không: đây là một trong hai lý do khiến FE "bấm gọi mà
        // không thấy gì", và nó phải tra được khi bật debug.
        this.logger.debug(
          `/ws-call: bỏ ${event} — không có hàng participant (userId=${state.user.id})`,
        );
      }
      return null;
    }

    if (!access.isLive || !access.actorIsActive) {
      // Lớp C: actor ĐÚNG là người của cuộc gọi này, chỉ là cuộc gọi (hoặc phần tham gia của họ) đã kết
      // thúc. Chuyện xảy ra ở MỌI cuộc gọi ⇒ bỏ im lặng, KHÔNG ghi, KHÔNG ngắt.
      return null;
    }

    return { state, payload: parsed.data, access };
  }

  /** Peer nhận relay phải cũng đang trong cuộc gọi — nếu không, đây là cố relay ra NGOÀI cuộc gọi. */
  private async assertPeer(
    client: Socket,
    ctx: { state: CallSocketState; access: ChatCallSignalAccess },
    toUserId: string,
    event: string,
  ): Promise<boolean> {
    if (ctx.access.activeUserIds.includes(toUserId)) return true;
    // Cùng phép phân biệt như ở trục người GỬI: peer ĐÃ từng trong cuộc gọi nhưng vừa rời ⇒ đua vòng
    // đời (lớp C, im lặng). Chưa từng được mời ⇒ đang cố relay RA NGOÀI cuộc gọi (lớp B).
    if (ctx.access.participantUserIds.includes(toUserId)) return false;
    await this.deny(client, ctx.state, event, "not_participant");
    return false;
  }

  private async relaySdp(
    client: Socket,
    event: "call:sdp-offer" | "call:sdp-answer",
    body: unknown,
    outbound: ChatCallOutboundEvent,
  ): Promise<undefined> {
    const ctx = await this.accept(client, event, chatCallSdpSchema, body);
    if (!ctx) return undefined;
    if (!(await this.assertPeer(client, ctx, ctx.payload.toUserId, event))) return undefined;

    this.relay(
      null,
      callUserRoomName(ctx.state.user.companyId, ctx.payload.toUserId),
      outbound,
      chatCallRelaySdpSchema,
      { callId: ctx.payload.callId, fromUserId: ctx.state.user.id, sdp: ctx.payload.sdp },
    );
    return undefined;
  }

  /**
   * ĐƯỜNG PHÁT DUY NHẤT của gateway — mọi sự kiện chiều ra đi qua đây, và đây là chỗ duy nhất có
   * `.emit(`. `.parse()` ngay tại call site làm "quên masking" thành chuyện không thể xảy ra: Zod strip
   * mọi khoá thừa (kể cả `fromUserId` giả mạo nếu ai đó lỡ chuyển thẳng payload client vào).
   *
   * `from` ≠ null ⇒ phát cho room TRỪ chính người gửi (`socket.to(room)`); `null` ⇒ cả room.
   */
  private relay<T>(
    from: Socket | null,
    target: string,
    event: ChatCallOutboundEvent,
    schema: ZodType<T>,
    payload: unknown,
  ): void {
    try {
      (from ?? this.server).to(target).emit(event, schema.parse(payload));
    } catch (err) {
      // KHÔNG ném lên handler: một lỗi phát không được biến thành `exception` cho client (xem filter).
      // Nhưng phải KÊU — im lặng ở đây là một cuộc gọi không bao giờ nối mà không ai biết vì sao.
      // `target` là tên room (`co:{co}:call:{callId}` / `co:{co}:calluser:{userId}`) — KHÔNG chứa
      // SDP/candidate nên an toàn để log theo R3, và là thứ DUY NHẤT tra được "cuộc gọi nào mất khung".
      this.logger.error(
        `/ws-call: relay ${event} → ${target} thất bại: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  /**
   * Lớp A/B: ghi `user_security_events` (nếu còn hạn mức) rồi NGẮT.
   *
   * ⚠️ Cờ `violated` là **trần 1 hàng/kết nối**; hạn mức theo NGƯỜI là lớp thứ hai. Vượt hạn mức ⇒ **vẫn
   * ngắt** nhưng **không ghi**: hàng rào chống bơm không được tự trở thành đường bơm vào một bảng
   * append-only không có job dọn (cùng lập luận `S7-CALL-BE-1` §5c mục 4).
   */
  private async deny(
    client: Socket,
    state: CallSocketState,
    event: string,
    reason: SignalDenyReason,
  ): Promise<void> {
    if (state.violated) return;
    state.violated = true;
    await this.punish(client, state, event, reason);
  }

  private async punish(
    client: Socket,
    state: CallSocketState,
    event: string,
    reason: SignalDenyReason,
  ): Promise<void> {
    const key = ChatCallCooldownService.key(
      CHAT_CALL_COOLDOWN_SCOPE.SIGNALLING_VIOLATION,
      state.user.companyId,
      state.user.id,
    );
    try {
      if (await this.cooldown.allow(key, CHAT_CALL_VIOLATION_MAX_PER_MIN, 60)) {
        await this.db.withTenant(state.user.companyId, (tx) =>
          this.securityEvents.record(tx, {
            eventType: "CALL_SIGNALLING_VIOLATION",
            userId: state.user.id,
            actorUserId: state.user.id,
            payload: buildSignalViolationPayload(event, reason),
          }),
        );
      } else {
        this.logger.warn(
          `/ws-call: vượt trần ghi sự kiện an ninh — chỉ ngắt. userId=${state.user.id}`,
        );
      }
    } catch (err) {
      // Ghi hỏng KHÔNG được cản việc ngắt: ngắt là hàng rào, ghi là dấu vết. Nhưng lỗi phải LOUD —
      // "im lặng" ở đây nghĩa là timeline bảo mật thiếu dòng mà không ai biết.
      this.logger.error(
        `/ws-call: ghi user_security_events thất bại (userId=${state.user.id}): ` +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      // try/catch RIÊNG, mirror `call-signalling.filter.ts`: một exception ném ra TỪ `finally` sẽ làm
      // chính promise này reject — và call site duy nhất không-await (`screenFrame`) sẽ biến nó thành
      // `unhandledRejection`. Ngắt là hàng rào; nó không được phép tự trở thành sự cố.
      try {
        client.disconnect(true);
      } catch (err) {
        this.logger.error(
          `/ws-call: ngắt kết nối THẤT BẠI sau vi phạm — phiên có thể còn sống (userId=${state.user.id}): ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }
  }

  /**
   * ⚠️ Bản rút token RIÊNG, cố ý KHÔNG refactor dùng chung với `realtime.gateway.ts`: ca ratchet
   * `.handshake.*` có positive control `accesses.length > 0` **đo trên chính file gateway**; rút hàm sang
   * file thứ ba làm positive control đó rỗng ⇒ tripwire chết im lặng. Cả hai bản bị gác bởi CÙNG một ca
   * test, nên đây không phải bản sao sẽ trôi. Việc verify token thì vẫn dùng chung `TokenService`.
   */
  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth as { token?: unknown } | undefined;
    if (auth && typeof auth.token === "string" && auth.token.length > 0) return auth.token;
    const header = client.handshake.headers["authorization"];
    if (typeof header === "string" && header.startsWith("Bearer ")) return header.slice(7);
    return null;
  }
}
