import type { Logger } from "@nestjs/common";
import type { Namespace, Server } from "socket.io";
import {
  callRoomName,
  callUserRoomName,
  chatRoomName,
  chatUserRoomName,
  feedGroupRoomName,
  feedUserRoomName,
  userRoomName,
} from "./rooms";

/** Ngữ cảnh log của một room-op: `label` thành tiền tố thông điệp, phần còn lại thành chi tiết. */
type RoomOpLogCtx = { label: string } & Record<string, string>;

/**
 * Cách room-op với tới hai namespace — GETTER đọc lúc gọi, KHÔNG phải bản sao. `setServer`/`setCallServer`
 * của `RealtimeEmitterService` vẫn là nguồn DUY NHẤT; giữ bản sao ở đây là để hai nơi trôi khỏi nhau
 * (gateway init sau khi lớp này được dựng ⇒ room-op thấy `null` mãi mãi, mọi `leave` thành no-op câm).
 */
export interface RealtimeNamespaces {
  /** Namespace `/ws` (NOTI + CHAT + bảng tin) — `null` khi gateway chưa init / REALTIME_ENABLED=false. */
  server(): Server | null;
  /** Namespace `/ws-call` (tín hiệu cuộc gọi) — `null` khi gateway `/ws-call` chưa init. */
  callServer(): Namespace | null;
}

/**
 * S17-CHAT-EMITTERSPLIT-1 — ROOM-OP của realtime (ép socket vào/ra room), tách khỏi
 * `realtime-emitter.service.ts` để file đó còn dư địa dưới trần 800 dòng. KHÔNG đổi hành vi: cùng bộ chọn,
 * cùng thứ tự vế cục bộ → lệnh toàn cụm, cùng thông điệp log (logger truyền vào là logger của
 * `RealtimeEmitterService` ⇒ context log giữ nguyên).
 *
 * Room-op **không phát payload nào** — lớp này không có `.emit(` (ratchet `realtime-room-ops.structure.spec.ts`).
 * Cổng phát duy nhất vẫn là `RealtimeEmitterService`; caller ngoài `realtime/**` gọi room-op qua các method
 * ủy quyền cùng tên trên service đó (chữ ký không đổi), KHÔNG import lớp này.
 *
 * Hợp đồng chung của mọi room-op: no-op khi namespace đích chưa có (riêng `evictFromCallRoom` kêu `error`),
 * KHÔNG BAO GIỜ ném lên caller (caller có thể đang ở trong transaction — ném = rollback một thao tác đã đúng).
 */
export class RealtimeRoomOps {
  constructor(
    private readonly namespaces: RealtimeNamespaces,
    private readonly logger: Logger,
  ) {}

  /**
   * Ép socket của MỘT user vào/ra phòng chat NGAY khi tư cách thành viên đổi — không đợi kết nối lại.
   * Không phát payload nào (không phải sự kiện, là thao tác room-ops).
   *
   * Hai nhánh CỐ Ý dùng bộ chọn KHÁC nhau, bất đối xứng có chủ đích:
   *   • `join`  → quét `chatUserRoomName` — CHỈ socket đã qua cổng quyền `view:chat-room`. Quét rộng hơn
   *     là để lần đổi thành viên kế tiếp kéo cả socket từng bị cổng quyền từ chối vào phòng.
   *   • `leave` → quét `userRoomName` (RỘNG HƠN, mọi socket đã xác thực của user). Rời nhầm chỉ làm mất
   *     realtime tới lần reconnect (fail-safe); sót lại một socket là RÒ TIN.
   *
   * Xuyên instance nhờ `@socket.io/redis-adapter` (`addSockets`/`delSockets` implement thật) — chỉ đúng
   * khi adapter Valkey đã gắn (`S7-CHAT-RT-0`); ở chế độ in-memory chỉ đúng trong tiến trình này.
   *
   * S17-CHAT-RTROOMOPS-1 (D-2): `leave` áp CỤC BỘ, đồng bộ (`leaveLocally`) TRƯỚC lệnh toàn cụm — dưới
   * adapter Valkey lệnh toàn cụm chỉ là publish at-most-once, có thể MẤT. `join` không có vế cục bộ (join
   * mất = fail-closed). Id route chữ HOA được chuẩn hoá ở builder `rooms.ts` (D-1), không ở đây.
   */
  syncRoomMembership(
    companyId: string,
    roomId: string,
    userId: string,
    action: "join" | "leave",
  ): void {
    const rooms = {
      join: chatUserRoomName(companyId, userId),
      leave: userRoomName(companyId, userId),
      target: chatRoomName(companyId, roomId),
    };
    const logCtx = { label: "syncRoomMembership", roomId, userId };
    if (action === "leave")
      this.leaveLocally(this.namespaces.server(), rooms.leave, rooms.target, logCtx);
    this.syncSocketRoom(rooms, action, logCtx);
  }

  /**
   * S16-SOCIAL-BE-2C (D-OWNER-2) — ép socket của MỘT user vào/ra room của MỘT nhóm bảng tin
   * (`feedGroupRoomName`) ngay khi membership đổi (`031`/`035`/`036`/`038`/`039`). Room-ops, không phát
   * payload nào. CÙNG cơ chế với `syncRoomMembership` (lõi `syncSocketRoom`), khác đúng bộ ba room:
   *   • `join`  → quét `feedUserRoomName` — CHỈ socket đã qua cổng `view:feed` lúc connect. **KHÔNG BAO
   *     GIỜ `userRoomName`**: room đó chứa cả socket đã TRƯỢT cổng ⇒ lần duyệt kế tiếp kéo họ vào room
   *     nhóm (đo thật — plan M2 a′). Cũng KHÔNG `chatUserRoomName`: đó là dấu của cổng `view:chat-room`.
   *   • `leave` → quét `userRoomName` (RỘNG HƠN): rời nhầm là fail-safe, sót là rò.
   *
   * ⚠️ Thời điểm gọi do caller quyết (`social-groups.service.ts`): `join` CHỈ SAU commit; `leave` gọi CẢ
   * TRONG tx lẫn SAU commit (owner ký Q-LEAVE (a)) — ngoại lệ có chủ đích của luật «gọi sau commit» ở
   * docblock `RealtimeEmitterService`, cùng lập luận `evictFromCallRoom`.
   *
   * ┌─ FULL gate lượt 1 — HAI lớp vá ở ĐÚNG cửa này (mọi room-op của room nhóm đều đi qua đây) ───────┐
   * │ (1) CHỮ THƯỜNG (database-reviewer HIGH). `groupId`/`userId` của `035/036/038/039` tới từ ROUTE:  │
   * │     `ParseUUIDPipe` nhận chữ HOA và trả NGUYÊN VĂN. Postgres so uuid không phân biệt hoa thường ⇒ │
   * │     lời ghi DB vẫn thành công, nhưng tên room là CHUỖI và room của gateway dựng từ DB/JWT (luôn  │
   * │     thường) ⇒ leave chữ HOA khớp 0 socket ⇒ người bị gỡ Ở LẠI room nhóm kín (fail-OPEN); join     │
   * │     chữ HOA vào room ma (fail-closed). Khuôn `audiencePairKey` (`social-mentions.ts`).          │
   * │ (2) `leave` CỤC BỘ TRƯỚC (security-reviewer + silent-failure-hunter MEDIUM). Dưới adapter Valkey │
   * │     (redis-adapter 8.3.0) `socketsLeave` không cờ `local` CHỈ publish REMOTE_LEAVE; chính node   │
   * │     giữ socket chỉ áp khi NHẬN LẠI qua kết nối SUBSCRIBE. Pub/sub là at-most-once: kết nối sub   │
   * │     rớt (vượt `client-output-buffer-limit pubsub`, Valkey khởi động lại) ⇒ lệnh MẤT VĨNH VIỄN —   │
   * │     không phải trễ «≈ RTT» như bản đầu ghi — trong khi broadcast vẫn phát CỤC BỘ, ĐỒNG BỘ ⇒      │
   * │     người bị mời ra nhận bài nhóm kín tới khi disconnect. `server.local…socketsLeave` áp ĐỒNG BỘ │
   * │     trên node này, không qua pub/sub ⇒ không mất được; lệnh toàn cụm phía sau vẫn chạy cho node  │
   * │     khác. Phần dư (API-19 §7.3 (c)): đa-instance + sub rớt ⇒ socket ở node KHÁC còn ở room.      │
   * │     `join` KHÔNG có vế cục bộ: join mất chỉ là thiếu badge (fail-closed).                       │
   * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
   * S17-CHAT-RTROOMOPS-1: lớp (1) nay đóng ở builder `rooms.ts` cho MỌI room — `toLowerCase` dưới đây thừa,
   * vô hại (dọn trong một WO SOCIAL); lớp (2) dùng chung `leaveLocally` với `syncRoomMembership`/evict.
   */
  syncFeedGroupMembership(
    companyId: string,
    groupId: string,
    userId: string,
    action: "join" | "leave",
  ): void {
    const [c, g, u] = [companyId.toLowerCase(), groupId.toLowerCase(), userId.toLowerCase()];
    const rooms = {
      join: feedUserRoomName(c, u),
      leave: userRoomName(c, u),
      target: feedGroupRoomName(c, g),
    };
    const logCtx = { label: "syncFeedGroupMembership", groupId: g, userId: u };
    if (action === "leave")
      this.leaveLocally(this.namespaces.server(), rooms.leave, rooms.target, logCtx);
    this.syncSocketRoom(rooms, action, logCtx);
  }

  /**
   * S7-CALL-RT-FIX-2 (B4 vế AN NINH) — kéo mọi socket `/ws-call` của một người RA KHỎI room chung của
   * một cuộc gọi. Room-ops, KHÔNG phát payload nào.
   *
   * ⚠️ **GỌI HAI LẦN mỗi thao tác rời phòng: một TRONG TRANSACTION của caller, một SAU COMMIT.** Đây là
   * ngoại lệ của luật "mọi method của `RealtimeEmitterService` gọi sau commit" — và là ngoại lệ ở CẢ HAI
   * đầu, nên đừng "gọn hoá" xuống một lần:
   *
   *  • **trong tx** — cùng lập luận với `severUserSessions` (`realtime-emitter.service.ts`): đặt SAU commit
   *    thì để hở đúng cửa sổ `media-state`/`screen-state` mà bản vá dựng ra để đóng. Rollback sau khi đã
   *    evict là chiều FAIL-SAFE (suy giảm UX), còn sót một socket là RÒ.
   *  • **sau commit** — đóng CỬA SỔ REJOIN: trong khe giữa lần evict thứ nhất và COMMIT, gateway xử một
   *    `call:join` ở tx khác đọc READ COMMITTED nên CHƯA thấy `left_at`/`outcome` mới ⇒ nó chấp nhận
   *    join và `socketsJoin` đưa socket đó TRỞ LẠI room chung. Không có lần thứ hai thì kênh mở lại tới
   *    khi socket rớt. Room-ops idempotent nên lần thừa vô hại.
   *
   * Cặp số (1 lần khi commit hỏng · 2 lần khi commit OK) được đóng đinh ở
   * `chat-realtime-after-commit.spec.ts` — dời một trong hai vế đi là ĐỎ.
   *
   * ⚠️ Phần dư CHƯA đóng: một `call:join` đọc DB trước commit nhưng chạy `socketsJoin` sau lần evict thứ
   * hai thì vẫn lọt. Đóng hẳn phải khoá hàng participant ở đường join — ngoài phạm vi S7-CALL-RT-FIX-2.
   *
   * ┌─ VÌ SAO KHÔNG ĐỦ NẾU CHỈ ĐÓNG `chat_call_participants` ────────────────────────────────────────┐
   * │ Đóng participant làm người bị gỡ rơi khỏi `activeUserIds` ⇒ `assertPeer` chặn được SDP/ICE (ba  │
   * │ sự kiện đi qua `callUserRoomName` của người NHẬN). Nhưng `call:media-state` và                  │
   * │ `call:screen-state` **broadcast thẳng vào `callRoomName`** và KHÔNG đi qua `assertPeer` — socket│
   * │ họ vẫn còn trong room chung ⇒ họ tiếp tục biết bên kia bật/tắt mic, cam, và đang chia sẻ màn    │
   * │ hình hay không. Ít hơn IP nội bộ, nhưng vẫn là "đã bị gỡ khỏi phòng mà vẫn theo dõi cuộc gọi    │
   * │ theo thời gian thực".                                                                          │
   * └────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠️ **Hậu quả rollback ĐẦY ĐỦ** (ghi ra để `S7-CALL-QA-2` biết mà đo): rời `callRoomName` mất KHÔNG
   * CHỈ chỉ báo mic/cam mà mất cả `call:peer-left`. Nếu tx rollback, nạn nhân vẫn là thành viên hợp lệ
   * nhưng UI của họ sẽ **treo một peer ma khi bên kia gác máy**, và FE không có lệnh `call:join` lần hai
   * để tự sửa.
   *
   * ⚠️ `callServer === null` (REALTIME_ENABLED=false / gateway chưa init) **KHÔNG được im lặng.** Khuôn
   * `?.` câm của `severUserSessions` không áp được: đây là vế AN NINH, và trạng thái hậu quả là *"DB nói
   * đã rời, socket VẪN trong `callRoomName`"* = RÒ, không phải suy biến chấp nhận được. `logger.error`
   * theo đúng precedent `emitChatCall`.
   *
   * ⚠️ `try/catch` CHỈ phủ nhánh ném ĐỒNG BỘ. `socketsLeave` với adapter Valkey publish trong một promise
   * nội bộ; reject ở đó KHÔNG rơi vào `catch` mà thành `unhandledRejection`. Rủi ro này ĐÃ CÓ SẴN ở
   * `severUserSessions` — ghi ra để không ai đọc khối dưới thành "đã bọc kín". Lệnh MẤT trên đường pub/sub
   * có lưới là vế CỤC BỘ đứng trước (S17-CHAT-RTROOMOPS-1 D-2); socket ở node KHÁC vẫn chỉ nhận qua pub/sub.
   */
  evictFromCallRoom(companyId: string, callId: string, userId: string): void {
    const callServer = this.namespaces.callServer();
    if (!callServer) {
      this.logger.error(
        `evictFromCallRoom BỎ QUA — gateway /ws-call chưa sẵn sàng; socket của người vừa rời phòng có ` +
          `thể VẪN nhận media-state/screen-state của cuộc gọi (callId=${callId} userId=${userId})`,
      );
      return;
    }
    const selector = callUserRoomName(companyId, userId);
    const target = callRoomName(companyId, callId);
    this.leaveLocally(callServer, selector, target, {
      label: "evictFromCallRoom",
      callId,
      userId,
    });
    try {
      callServer.in(selector).socketsLeave(target);
    } catch (err) {
      // KHÔNG throw lên caller: ném ở đây sẽ ROLLBACK cả thao tác gỡ thành viên — lấy một sự cố realtime
      // đổi lấy một thao tác quản trị thất bại là sai chiều đánh đổi. Nhưng phải KÊU: im lặng nghĩa là
      // một người đã bị gỡ khỏi phòng vẫn đang theo dõi cuộc gọi.
      this.logger.error(
        `evictFromCallRoom THẤT BẠI (callId=${callId} userId=${userId}) — socket có thể còn trong room ` +
          `cuộc gọi: ` +
          (err instanceof Error ? err.message : String(err)),
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  /**
   * Vế AN NINH của mọi room-op `leave` (room nhóm bảng tin · phòng chat · room cuộc gọi): rời room TRÊN NODE
   * NÀY, đồng bộ, không qua pub/sub (`.local` = cờ `local` ⇒ redis-adapter gọi thẳng `super.delSockets`).
   * `nsp` là namespace ĐÍCH (`/ws` hoặc `/ws-call` — hai không gian room tách biệt). try/catch RIÊNG — vế
   * này ném KHÔNG được bỏ qua lệnh toàn cụm phía sau (cùng lý do hai khối riêng của `severUserSessions`),
   * và log `error`: sót lại một socket là RÒ, không phải suy giảm UX.
   */
  private leaveLocally(
    nsp: Server | Namespace | null,
    selector: string,
    target: string,
    logCtx: RoomOpLogCtx,
  ): void {
    if (!nsp) return;
    try {
      nsp.local.in(selector).socketsLeave(target);
    } catch (err) {
      const { label, ...ctx } = logCtx;
      this.logger.error(`${label} leave CỤC BỘ thất bại — socket có thể còn ở room đích`, {
        ...ctx,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * LÕI chung của hai lệnh đồng bộ membership (tái dùng cơ chế — D-OWNER-2). Bộ chọn `join` và `leave`
   * do CALLER truyền, có chủ đích BẤT ĐỐI XỨNG (xem docblock `syncRoomMembership`): join quét room đánh
   * dấu HẸP của cổng tương ứng, leave quét `userRoomName` RỘNG. No-op khi chưa có server; KHÔNG BAO GIỜ
   * ném lên caller (caller có thể đang ở trong transaction — ném = rollback một thao tác đã đúng).
   *
   * ⚠️ `try/catch` CHỈ phủ nhánh ném ĐỒNG BỘ (FULL gate lượt 1, silent-failure-hunter — chép cảnh báo của
   * `evictFromCallRoom`). Với adapter Valkey, lệnh không cờ `local` là một `publish` không ai await: reject
   * KHÔNG rơi vào `catch` (thành `unhandledRejection`), và thông điệp MẤT trên đường pub/sub thì không để lại
   * dòng log nào. «Không thấy `failed` trong log» KHÔNG có nghĩa room-op đã áp — lưới cho lệnh mất là vế
   * cục bộ của caller (`leaveLocally`), không phải log này.
   */
  private syncSocketRoom(
    rooms: { join: string; leave: string; target: string },
    action: "join" | "leave",
    logCtx: RoomOpLogCtx,
  ): void {
    const server = this.namespaces.server();
    if (!server) return;
    try {
      if (action === "join") {
        server.in(rooms.join).socketsJoin(rooms.target);
      } else {
        server.in(rooms.leave).socketsLeave(rooms.target);
      }
    } catch (err) {
      const { label, ...ctx } = logCtx;
      const detail = { ...ctx, action, error: err instanceof Error ? err.message : String(err) };
      // `leave` hỏng ⇒ socket ở node KHÁC có thể còn ở room đích (rò) ⇒ `error`; `join` hỏng = fail-closed.
      if (action === "leave")
        this.logger.error(`${label} failed — leave toàn cụm không áp`, detail);
      else this.logger.warn(`${label} failed`, detail);
    }
  }
}
