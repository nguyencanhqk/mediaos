import { Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import {
  chatCallParticipants,
  chatCalls,
  chatRoomMembers,
  type ChatCall,
  type ChatCallKind,
  type ChatCallOutcome,
  type ChatCallStatus,
} from "../db/schema/communication";

/** Một hàng người tham gia, đúng hình dạng `chatCallParticipantSchema` cần để dựng DTO. */
export interface ChatCallParticipantRow {
  userId: string;
  invitedAt: Date;
  joinedAt: Date | null;
  leftAt: Date | null;
  outcome: ChatCallOutcome | null;
}

/**
 * Ảnh chụp một cuộc gọi vừa bị đánh nhỡ — ĐỦ để dựng payload `chat:call{missed}` mà không phải đọc lại.
 * (S7-CALL-RT-1: người được gọi phải biết cuộc gọi đã chết, nếu không máy họ đổ chuông cho một cuộc gọi
 * không còn tồn tại.)
 */
export interface ChatCallExpiredRow {
  id: string;
  roomId: string;
  kind: ChatCallKind;
  initiatorUserId: string;
  startedAt: Date;
}

/** Trạng thái "cuộc gọi còn sống" — ĐÚNG tập của partial unique index `chat_calls_one_live_per_room_uq`. */
export const CHAT_CALL_LIVE_STATUSES = ["ringing", "active"] as const;

/**
 * S7-CALL-RT-FIX-2 — **MỘT bản sao duy nhất** của vị từ "hàng participant còn CHƯA NGÃ NGŨ".
 *
 * `outcome IS NULL` (đang đổ chuông) **HOẶC** `'accepted'` (đang nói chuyện). Bốn kết cục còn lại
 * (`rejected`/`cancelled`/`missed`/`left`) là HẤP THỤ.
 *
 * ⚠️ Trước bản vá này, cùng một vị từ được viết tay ở BA chỗ: `WHERE` của `setParticipantOutcome`,
 * bộ lọc `activeUserIds` ở `ChatCallSignalService` (JS), và — nếu không rút ra — cả
 * `findOpenParticipantCallsInRoom` dưới đây. Ba bản sao là ba đường trôi độc lập: nới một chỗ mà quên
 * hai chỗ kia thì "còn trong cuộc gọi" mang hai nghĩa khác nhau tuỳ đường đi tới, và không test nào
 * bắt được vì mỗi đường vẫn tự nhất quán với chính nó.
 *
 * Có phiên bản JS thuần (`isActiveCallOutcome`) cho các bộ lọc trong bộ nhớ — cùng một luật, hai biểu
 * diễn, và đó là lý do chúng nằm CẠNH NHAU ở đây thay vì mỗi cái một file.
 */
export const activeParticipantOutcomeSql = () =>
  or(isNull(chatCallParticipants.outcome), eq(chatCallParticipants.outcome, "accepted"));

/** Vế JS của `activeParticipantOutcomeSql` — dùng khi hàng đã ở trong bộ nhớ. */
export const isActiveCallOutcome = (outcome: ChatCallOutcome | null): boolean =>
  outcome === null || outcome === "accepted";

/**
 * S7-CALL-BE-1 — data-access `chat_calls` + `chat_call_participants` (mig `0546`).
 *
 * ⚠️ QUYỀN GHI Ở DB — đọc trước khi thêm câu lệnh nào (khối C + VERIFY (4) của `0546` pin bằng `=`):
 *   • `chat_calls`: `SELECT, INSERT` cấp bảng + **column-GRANT `UPDATE (status, accepted_at, ended_at)`**.
 *     KHÔNG có DELETE, KHÔNG có UPDATE cấp bảng. `.set()` chạm bất kỳ cột nào khác (kể cả `room_id`,
 *     `started_at`) là **`42501` lúc chạy** — TypeScript mù hoàn toàn với quyền cột.
 *   • `chat_call_participants`: `SELECT, INSERT` + column-GRANT `UPDATE (joined_at, left_at, outcome)`.
 *   • Lịch sử cuộc gọi là **append-only** (BẤT BIẾN #2): không có đường xoá, và không được thêm.
 *
 * ⚠️ TUYỆT ĐỐI KHÔNG chữa quyền bằng `REVOKE UPDATE ON chat_calls` ở migration sau: Postgres cuốn theo
 * MỌI column-GRANT của chính bảng đó, để lại bảng KHÔNG CỘT NÀO ghi được, VĨNH VIỄN (memory
 * `revoke-table-grant-wipes-column-grants`).
 *
 * MỌI hàm nhận `tx` và mang `company_id` tường minh bên cạnh RLS (CLAUDE.md §2 mục 1).
 */
@Injectable()
export class ChatCallsRepository {
  /**
   * Người CÓ THỂ được mời vào cuộc gọi của phòng = thành viên đang hoạt động.
   *
   * Đọc TẠI CHỖ GHI (trong cùng tx với `INSERT`), không nhận danh sách từ caller: danh sách truyền vào là
   * một ảnh chụp có thể đã cũ, và ở đây nó quyết định **ai đổ chuông** — tức ai được phép vào relay
   * `/ws-call` sau này (RT-1 kiểm tư cách tham gia theo chính bảng participants).
   */
  async activeMemberIds(tx: TenantTx, companyId: string, roomId: string): Promise<string[]> {
    const rows = await tx
      .select({ userId: chatRoomMembers.userId })
      .from(chatRoomMembers)
      .where(
        and(
          eq(chatRoomMembers.companyId, companyId),
          eq(chatRoomMembers.roomId, roomId),
          isNull(chatRoomMembers.leftAt),
        ),
      );
    return rows.map((r) => r.userId);
  }

  /**
   * Tạo cuộc gọi ở trạng thái `ringing`.
   *
   * KHÔNG truyền `companyId`: cột có DEFAULT theo GUC `app.current_company_id` (mig `0546` khối A), tức
   * `withTenant` đã đặt đúng tenant. Truyền tay là mở đường ghi lệch tenant nếu caller cầm nhầm biến.
   *
   * ⚠️ Ném `23505` trên `chat_calls_one_live_per_room_uq` khi phòng đã có cuộc gọi sống — **đó là đường
   * 409 duy nhất đúng**. Caller phải phân biệt theo TÊN constraint (`isLiveCallConflict`), không nuốt mọi
   * 23505: bảng còn `chat_calls_company_id_id_uq` và nuốt bừa sẽ giấu một lỗi hoàn toàn khác.
   */
  async insertCall(
    tx: TenantTx,
    roomId: string,
    initiatorUserId: string,
    kind: ChatCallKind,
  ): Promise<ChatCall> {
    const rows = await tx.insert(chatCalls).values({ roomId, initiatorUserId, kind }).returning();
    return rows[0];
  }

  /**
   * Seed người tham gia — MỘT câu `INSERT` cho cả lô.
   *
   * `joinedUserId` (người khởi tạo) vào cuộc gọi ngay: họ không cần "nhận" lời mời của chính mình. Những
   * người còn lại để `joined_at = NULL`, `outcome = NULL` = "đang đổ chuông, chưa ngã ngũ".
   *
   * `onConflictDoNothing` trên `chat_call_participants_uq`: cuộc gọi vừa tạo nên xung đột chỉ xảy ra nếu
   * `userIds` có phần tử lặp — im lặng bỏ qua đúng hơn là 500.
   */
  async insertParticipants(
    tx: TenantTx,
    callId: string,
    userIds: readonly string[],
    joinedUserId: string,
    now: Date,
  ): Promise<void> {
    if (userIds.length === 0) return;
    await tx
      .insert(chatCallParticipants)
      .values(
        userIds.map((userId) => ({
          callId,
          userId,
          joinedAt: userId === joinedUserId ? now : null,
        })),
      )
      .onConflictDoNothing();
  }

  /**
   * Chuyển trạng thái cuộc gọi — **vị từ trạng thái nằm TRONG `WHERE`, không ở JS**.
   *
   * ⚠️ Đây là chỗ dễ viết sai nhất của WO. Đọc `status` rồi `if` rồi `UPDATE` là đọc-rồi-ghi: hai người
   * bấm "kết thúc" và "từ chối" cùng lúc đều thấy `ringing`, cả hai đều ghi, và cái sau **lùi im lặng**
   * kết quả của cái trước (memory `clamp-must-be-sql-not-js`). Đặt `fromStatuses` vào `WHERE` làm DB
   * quyết ai thắng; kẻ thua nhận `null` ⇒ caller trả 422.
   *
   * Chỉ `.set()` ba cột ĐƯỢC column-GRANT. `ended_at` bắt buộc cho mọi trạng thái kết thúc
   * (`chat_calls_ended_at_chk`), `accepted_at` bắt buộc cho `active` (`chat_calls_accepted_at_chk`) —
   * truyền thiếu là `23514`, không phải hàng ghi sai im lặng.
   *
   * @returns hàng SAU khi đổi, hoặc `null` nếu 0 hàng khớp (trạng thái đã đổi bởi ai đó khác).
   */
  async transition(
    tx: TenantTx,
    companyId: string,
    callId: string,
    fromStatuses: readonly ChatCallStatus[],
    to: { status: ChatCallStatus; acceptedAtIfNull?: Date; endedAt?: Date },
  ): Promise<ChatCall | null> {
    const rows = await tx
      .update(chatCalls)
      .set({
        status: to.status,
        // ⚠️ `COALESCE` chứ không phải gán thẳng: hai người nhận máy cùng lúc thì người sau KHÔNG được
        // dời `accepted_at` của người trước. Vế "giữ giá trị cũ nếu đã có" phải nằm trong SQL — tính ở JS
        // là đọc-rồi-ghi, đúng lớp `clamp-must-be-sql-not-js`.
        ...(to.acceptedAtIfNull !== undefined
          ? { acceptedAt: sql`COALESCE(${chatCalls.acceptedAt}, ${to.acceptedAtIfNull})` }
          : {}),
        ...(to.endedAt !== undefined ? { endedAt: to.endedAt } : {}),
      })
      .where(
        and(
          eq(chatCalls.companyId, companyId),
          eq(chatCalls.id, callId),
          inArray(chatCalls.status, [...fromStatuses]),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Ghi kết cục của MỘT người tham gia. Chỉ chạm 3 cột được column-GRANT.
   *
   * ⚠️ **VÁ S7-CALL-BE-FIX-1 (HIGH-1).** `WHERE` cho qua khi `outcome IS NULL` **HOẶC** `outcome = 'accepted'`
   * — KHÔNG chỉ `IS NULL` như bản gốc. Lý do: `'accepted'` KHÔNG phải một kết cục NGÃ NGŨ, nó là "đang
   * TRONG cuộc gọi" — người vừa nhận máy còn phải đi tiếp tới `'left'` khi họ tự gác máy. Bản gốc chặn
   * đúng transition đó: actor gọi `hangup` sau khi CHÍNH HỌ đã `accept` thì `outcome` của họ đã là
   * `'accepted'` (không còn `NULL`) ⇒ `WHERE` khớp **0 hàng**, `left_at` KHÔNG BAO GIỜ được ghi, và
   * `closeOpenParticipants` sau đó quét mọi hàng `outcome IS NULL` gồm cả người KHỞI TẠO (đang thật sự
   * `active`) rồi gắn `missed` — người vừa nói chuyện 5 phút bị ghi "cuộc gọi nhỡ". Bốn kết cục còn lại
   * (`rejected`/`cancelled`/`missed`/`left`) VẪN là hấp thụ — không state nào trong service từng ghi thêm
   * sau khi actor đã có một trong bốn giá trị đó, và `WHERE` vẫn khoá đường ghi đè chúng.
   *
   * DB không có trigger cho bảng này (chỉ `chat_calls` có), nên vế `WHERE` này là lớp duy nhất — thiếu
   * nó, một `hangup` trễ sẽ viết đè `rejected` thành `left` và lịch sử cuộc gọi nói sai.
   */
  async setParticipantOutcome(
    tx: TenantTx,
    companyId: string,
    callId: string,
    userId: string,
    outcome: ChatCallOutcome,
    stamps: { joinedAt?: Date; leftAt?: Date } = {},
  ): Promise<boolean> {
    const rows = await tx
      .update(chatCallParticipants)
      .set({
        outcome,
        ...(stamps.joinedAt !== undefined ? { joinedAt: stamps.joinedAt } : {}),
        ...(stamps.leftAt !== undefined ? { leftAt: stamps.leftAt } : {}),
      })
      .where(
        and(
          eq(chatCallParticipants.companyId, companyId),
          eq(chatCallParticipants.callId, callId),
          eq(chatCallParticipants.userId, userId),
          activeParticipantOutcomeSql(),
        ),
      )
      .returning({ id: chatCallParticipants.id });
    return rows.length > 0;
  }

  /**
   * Đóng sổ những người CHƯA ngã ngũ khi cuộc gọi kết thúc (người không kịp bấm gì).
   *
   * ⚠️ **VÁ S7-CALL-BE-FIX-1.** `except` giờ là tham số THẬT (bản gốc chỉ có ở docblock — chữ ký không hề
   * nhận nó, và việc "giữ nguyên hàng của actor" chỉ đúng NHỜ actor đã được `setParticipantOutcome` ghi
   * TRƯỚC lệnh gọi này trong cùng tx — một ràng buộc THỨ TỰ ngầm, không phải một ràng buộc SQL. Truyền
   * `except` tường minh làm bất biến đó độc lập với thứ tự gọi: kể cả nếu `closeOthers` một ngày nào đó bị
   * gọi TRƯỚC `setParticipantOutcome` (refactor sai), actor vẫn không bị chính lời gọi này quét nhầm.
   *
   * `exceptUserId` optional — job hết hạn (`expireStaleRinging`) không có "actor" nào để loại trừ.
   *
   * ⚠️ **`promoteJoinedTo` (HIGH-1) — CHỈ dành cho `hangup` trên cuộc gọi ĐÃ `active`.** Khi cuộc gọi đã
   * từng nối máy, hàng NÀO đã có `joined_at` (đúng nghĩa "đang ở trong cuộc gọi", không chỉ "được mời")
   * PHẢI đổi thành `promoteJoinedTo` (`'left'`), KHÔNG phải `outcome` nền — nếu không người khởi tạo
   * (luôn có `joined_at` từ lúc mời, xem `insertParticipants`) bị gắn `missed` dù họ đang thật sự nói
   * chuyện. Hàng CHƯA có `joined_at` (được mời nhưng chưa từng bấm gì — v.d. `uNoCallPair` trong phòng
   * ≥3 người) vẫn nhận `outcome` nền như cũ.
   *
   * ⚠️ TUYỆT ĐỐI KHÔNG truyền `promoteJoinedTo` cho `reject`/`cancel`: hai đường đó chỉ chạy khi cuộc gọi
   * CÒN `ringing` (chưa ai từng `active`) — người khởi tạo tuy có `joined_at` (họ tự "vào" cuộc gọi của
   * chính mình ngay lúc mời) nhưng KHÔNG có cuộc trò chuyện nào từng diễn ra, nên vẫn phải là `missed`/
   * `cancelled`, mirror đúng triết lý của job hết hạn ("mọi người còn treo đều là nhỡ — kể cả người khởi
   * tạo"). Trộn nhầm ở đây sẽ làm CA 10 (test đã có) đỏ.
   *
   * `promoteAt` đi kèm `promoteJoinedTo`: hàng được nâng lên `'left'` cũng cần `left_at` — thiếu nó thì
   * một hàng `outcome='left'` mãi mãi `left_at IS NULL`, tự nó là một sự KHÔNG NHẤT QUÁN mới cho người đọc
   * sổ audit sau này.
   */
  async closeOpenParticipants(
    tx: TenantTx,
    companyId: string,
    callId: string,
    outcome: ChatCallOutcome,
    exceptUserId?: string,
    promoteJoinedTo?: ChatCallOutcome,
    promoteAt?: Date,
  ): Promise<number> {
    const rows = await tx
      .update(chatCallParticipants)
      .set({
        outcome: promoteJoinedTo
          ? sql`CASE WHEN ${chatCallParticipants.joinedAt} IS NOT NULL THEN ${promoteJoinedTo} ELSE ${outcome} END`
          : outcome,
        ...(promoteJoinedTo && promoteAt
          ? {
              leftAt: sql`CASE WHEN ${chatCallParticipants.joinedAt} IS NOT NULL THEN ${promoteAt} ELSE ${chatCallParticipants.leftAt} END`,
            }
          : {}),
      })
      .where(
        and(
          eq(chatCallParticipants.companyId, companyId),
          eq(chatCallParticipants.callId, callId),
          isNull(chatCallParticipants.outcome),
          ...(exceptUserId ? [ne(chatCallParticipants.userId, exceptUserId)] : []),
        ),
      )
      .returning({ id: chatCallParticipants.id });
    return rows.length;
  }

  /**
   * Hàng người-tham-gia của actor — `null` = **không được mời**.
   *
   * ⚠️ Đây là vế thứ HAI của quyền, không thừa: `assertCallAccess` chỉ chứng minh actor là thành viên
   * PHÒNG. Một người vào phòng SAU khi cuộc gọi bắt đầu là thành viên hợp lệ nhưng KHÔNG có mặt trong
   * cuộc gọi — thiếu vế này họ gác máy được cuộc gọi của người khác.
   */
  async findParticipant(
    tx: TenantTx,
    companyId: string,
    callId: string,
    userId: string,
  ): Promise<ChatCallParticipantRow | null> {
    const rows = await tx
      .select({
        userId: chatCallParticipants.userId,
        invitedAt: chatCallParticipants.invitedAt,
        joinedAt: chatCallParticipants.joinedAt,
        leftAt: chatCallParticipants.leftAt,
        outcome: chatCallParticipants.outcome,
      })
      .from(chatCallParticipants)
      .where(
        and(
          eq(chatCallParticipants.companyId, companyId),
          eq(chatCallParticipants.callId, callId),
          eq(chatCallParticipants.userId, userId),
        ),
      )
      .limit(1);

    const r = rows[0];
    if (!r) return null;
    return {
      userId: r.userId,
      invitedAt: r.invitedAt,
      joinedAt: r.joinedAt,
      leftAt: r.leftAt,
      outcome: (r.outcome as ChatCallOutcome | null) ?? null,
    };
  }

  /**
   * S7-CALL-RT-FIX-2 (B1) — các cuộc gọi **CÒN SỐNG** của một PHÒNG mà `userId` còn hàng participant
   * **chưa ngã ngũ**. Phép ĐỌC, không ghi.
   *
   * Dùng bởi ĐÚNG một đường: đóng phần tham gia của người vừa rời/bị gỡ khỏi phòng
   * (`ChatCallRoomExitService`). Trước bản vá, gỡ một người khỏi phòng KHÔNG chạm
   * `chat_call_participants` ⇒ họ vẫn nằm trong `activeUserIds` của người còn lại ⇒ gateway vẫn relay
   * SDP/ICE **tới** họ (chiều RÒ).
   *
   * ⚠️ **`companyId` ở CẢ HAI vế của JOIN** (bất biến #1). RLS đã bó mỗi bảng theo tenant, nhưng điều
   * kiện JOIN thiếu `company_id` là một tích Descartes trong phạm vi đã bó — đúng nghĩa vẫn sai, và sai
   * theo kiểu chỉ lộ ra khi có ≥2 công ty.
   *
   * ⚠️ **Vế `c.status IN CHAT_CALL_LIVE_STATUSES` là hàng rào, không phải tối ưu.** Thiếu nó, thao tác
   * gỡ thành viên sẽ đóng lại hàng của những cuộc gọi đã KẾT THÚC từ lâu — ghi đè lịch sử (và sinh một
   * dòng audit cho mỗi cuộc gọi cũ). Đóng đinh bởi ca "gỡ người sau khi cuộc gọi đã kết thúc ⇒ 0 hàng
   * audit" (§5.4 đột biến `i`).
   *
   * ⚠️ **PHẢI trả CẢ `joinedAt` LẪN `acceptedAt`** — kết cục ở bước sau là vị từ **KÉP**, không phải
   * một vế. `joinedAt` một mình là SAI: `insertParticipants` đặt `joined_at = now` cho **người khởi tạo
   * ngay lúc MỜI** (chưa ai nhấc máy), nên một cuộc gọi còn `ringing` đã có sẵn một hàng `joined_at`
   * khác NULL. Lấy đó làm "đã vào rồi rời" là đóng dấu `'left'` lên người chưa hề nói chuyện với ai —
   * ghi sai VĨNH VIỄN (kết cục hấp thụ + bảng không có DELETE).
   *
   * `acceptedAt` là vế "cuộc gọi có TỪNG nối máy không", CÙNG vị từ mà `hangup` dùng
   * (`chat-calls.service.ts`: `wasConnected = call.acceptedAt !== null`) và cùng luật mà docblock
   * `closeOpenParticipants` viết ra cho `reject`/`cancel`. Ba đường phải nói cùng một thứ.
   *
   * `SELECT` trần (KHÔNG `FOR UPDATE`): đường này và `hangup` chỉ giao nhau ở MỘT tài nguyên
   * (`chat_call_participants`) nên là CHỜ, không phải ôm chéo. Hệ quả: hàng có thể bị đóng bởi một tx
   * khác giữa `SELECT` và `UPDATE` — xử lý ở `ChatCallRoomExitService` bằng giá trị trả về của
   * `setParticipantOutcome`, không phải bằng khoá.
   */
  async findOpenParticipantCallsInRoom(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    userId: string,
  ): Promise<{ callId: string; joinedAt: Date | null; acceptedAt: Date | null }[]> {
    const rows = await tx
      .select({
        callId: chatCallParticipants.callId,
        joinedAt: chatCallParticipants.joinedAt,
        // Cột của `chat_calls` — JOIN đã có sẵn nên vế này tốn 0 đồng.
        acceptedAt: chatCalls.acceptedAt,
      })
      .from(chatCallParticipants)
      .innerJoin(
        chatCalls,
        and(
          eq(chatCalls.id, chatCallParticipants.callId),
          eq(chatCalls.companyId, chatCallParticipants.companyId),
        ),
      )
      .where(
        and(
          eq(chatCallParticipants.companyId, companyId),
          eq(chatCalls.roomId, roomId),
          inArray(chatCalls.status, [...CHAT_CALL_LIVE_STATUSES]),
          eq(chatCallParticipants.userId, userId),
          activeParticipantOutcomeSql(),
        ),
      )
      // Thứ tự ỔN ĐỊNH: danh sách này lái thứ tự phát `peer-left` và thứ tự hàng audit — không có
      // `orderBy` thì hai lần chạy cùng dữ liệu cho hai thứ tự khác nhau, và ca test thành xác suất.
      .orderBy(chatCallParticipants.callId);

    return rows.map((r) => ({
      callId: r.callId,
      joinedAt: r.joinedAt,
      acceptedAt: r.acceptedAt,
    }));
  }

  /** Người tham gia của một cuộc gọi, thứ tự ỔN ĐỊNH theo lúc được mời (DTO không nhảy chỗ giữa các lần đọc). */
  async listParticipants(
    tx: TenantTx,
    companyId: string,
    callId: string,
  ): Promise<ChatCallParticipantRow[]> {
    const rows = await tx
      .select({
        userId: chatCallParticipants.userId,
        invitedAt: chatCallParticipants.invitedAt,
        joinedAt: chatCallParticipants.joinedAt,
        leftAt: chatCallParticipants.leftAt,
        outcome: chatCallParticipants.outcome,
      })
      .from(chatCallParticipants)
      .where(
        and(eq(chatCallParticipants.companyId, companyId), eq(chatCallParticipants.callId, callId)),
      )
      .orderBy(chatCallParticipants.invitedAt, chatCallParticipants.userId);

    return rows.map((r) => ({
      userId: r.userId,
      invitedAt: r.invitedAt,
      joinedAt: r.joinedAt,
      leftAt: r.leftAt,
      outcome: (r.outcome as ChatCallOutcome | null) ?? null,
    }));
  }

  /**
   * `ringing` quá hạn → `missed`. **MỘT bản sao duy nhất của vị từ hết hạn**, dùng bởi CẢ HAI đường:
   * job theo nhịp và bước dọn-trước-khi-mời của `CHAT-API-026` (xem plan D3).
   *
   * `roomId` tuỳ chọn: đường mời chỉ dọn phòng của chính nó (không đụng tenant rộng trong một request của
   * người dùng); job dọn toàn tenant.
   *
   * Idempotent theo cấu trúc: sau khi chạy, các hàng đó không còn `status='ringing'` nên lần chạy kế tiếp
   * khớp 0 hàng. `ended_at` bắt buộc — thiếu là `23514` (`chat_calls_ended_at_chk`).
   *
   * @returns id các cuộc gọi vừa bị đánh nhỡ (rỗng = không có gì quá hạn).
   */
  async expireStaleRinging(
    tx: TenantTx,
    companyId: string,
    cutoff: Date,
    now: Date,
    roomId?: string,
  ): Promise<ChatCallExpiredRow[]> {
    const expired = await tx
      .update(chatCalls)
      .set({ status: "missed", endedAt: now })
      .where(
        and(
          eq(chatCalls.companyId, companyId),
          eq(chatCalls.status, "ringing"),
          lt(chatCalls.startedAt, cutoff),
          ...(roomId ? [eq(chatCalls.roomId, roomId)] : []),
        ),
      )
      // ⚠️ S7-CALL-RT-1 mở rộng `returning` từ `{id, roomId}` sang cả `kind`/`initiatorUserId`/
      // `startedAt`: người được gọi phải được BÁO khi cuộc gọi bị đánh nhỡ, và payload `chat:call` cần
      // đúng các trường đó. Đọc lại bằng một `SELECT` sau `UPDATE` là chấp nhận một cửa sổ mà hàng có
      // thể đã đổi tiếp — `RETURNING` cho ảnh chụp ĐÚNG lúc ghi.
      .returning({
        id: chatCalls.id,
        roomId: chatCalls.roomId,
        kind: chatCalls.kind,
        initiatorUserId: chatCalls.initiatorUserId,
        startedAt: chatCalls.startedAt,
      });

    if (expired.length === 0) return [];

    // Mọi người còn treo đều là "nhỡ" — kể cả người khởi tạo: không ai bấm gì và cuộc gọi tự tắt.
    await tx
      .update(chatCallParticipants)
      .set({ outcome: "missed" })
      .where(
        and(
          eq(chatCallParticipants.companyId, companyId),
          inArray(
            chatCallParticipants.callId,
            expired.map((e) => e.id),
          ),
          isNull(chatCallParticipants.outcome),
        ),
      );

    return expired;
  }

  /**
   * S10-CHAT-CALLSWEEP-1 (KI-063) — gặt cuộc gọi **`active` mồ côi** → `ended`.
   *
   * ┌─ VÌ SAO HÀM NÀY TỒN TẠI ────────────────────────────────────────────────────────────────────────┐
   * │ `expireStaleRinging` chỉ quét `ringing`. Một hàng `active` KHÔNG có đường nào rời khỏi tập        │
   * │ `('ringing','active')` của partial unique `chat_calls_one_live_per_room_uq` ngoài hành động của   │
   * │ người còn sống trong phòng. Gỡ cả hai người khỏi phòng ⇒ họ hết `hangup` nổi (404) và             │
   * │ `ChatCallRoomExitService` cố ý KHÔNG chạm `chat_calls` (hàng rào R4 `DECISIONS-07`) ⇒ hàng đó     │
   * │ khoá phòng **VĨNH VIỄN**: mọi lời mời sau đó 409 `CHAT-ERR-028`, không đường sửa qua API.         │
   * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠️ **`ended`, KHÔNG phải `missed`.** `active` kéo theo `accepted_at IS NOT NULL`
   * (`chat_calls_accepted_at_chk`) — cuộc gọi ĐÃ được nhận. `missed` sẽ nói "không ai bắt máy" về một
   * cuộc gọi có người đã nói chuyện; đó đúng lớp lỗi mà docblock `CALL_MISSED` tách khỏi `CALL_ENDED`.
   *
   * `reason` quyết định vị từ, và HAI vị từ là hai câu hỏi khác nhau (plan §2) — gọi RIÊNG từng nhánh
   * chứ không `OR` chung, vì dòng audit phải trả lời được "gặt vì nhánh nào":
   *   • `"max_duration"` — trần thọ tuyệt đối. Lưới an toàn cho hình dạng KHÔNG đoán trước, ví dụ nhánh
   *     `!ok` của `closeCallParticipationOnRoomExit` để lại một hàng participant "còn treo" vĩnh viễn ⇒
   *     vị từ mồ côi không bao giờ khớp và lỗ chỉ đổi hình dạng.
   *   • `"orphan"` — KHÔNG còn hàng participant nào chưa ngã ngũ. Bốn kết cục `left/missed/rejected/
   *     cancelled` là HẤP THỤ (`WHERE` của `setParticipantOutcome`) ⇒ trạng thái này KHÔNG có đường quay
   *     lại, cuộc gọi đã kết thúc thật.
   *
   * Idempotent theo cấu trúc: hàng vừa đổi không còn `status='active'` ⇒ lần chạy kế tiếp khớp 0 hàng.
   * Gọi `"max_duration"` TRƯỚC `"orphan"` cũng vì thế — một hàng thoả cả hai chỉ bị gặt MỘT lần, và được
   * quy cho nguyên nhân mạnh hơn.
   */
  async expireStaleActive(
    tx: TenantTx,
    companyId: string,
    cutoff: Date,
    now: Date,
    reason: "orphan" | "max_duration",
    roomId?: string,
  ): Promise<ChatCallExpiredRow[]> {
    const expired = await tx
      .update(chatCalls)
      .set({ status: "ended", endedAt: now })
      .where(
        and(
          eq(chatCalls.companyId, companyId),
          eq(chatCalls.status, "active"),
          lt(chatCalls.startedAt, cutoff),
          ...(reason === "orphan" ? [noLiveParticipantSql()] : []),
          ...(roomId ? [eq(chatCalls.roomId, roomId)] : []),
        ),
      )
      .returning({
        id: chatCalls.id,
        roomId: chatCalls.roomId,
        kind: chatCalls.kind,
        initiatorUserId: chatCalls.initiatorUserId,
        startedAt: chatCalls.startedAt,
      });

    return expired;
  }
}

/**
 * "Cuộc gọi này KHÔNG còn ai ở trong" — vị từ tương quan dùng bởi nhánh `orphan` của `expireStaleActive`.
 *
 * ⚠️ **Viết bằng `sql` thô với TÊN BẢNG ĐẦY ĐỦ, cố ý — đây là chỗ hỏng theo kiểu tệ nhất nếu làm tắt.**
 * Drizzle render cột trong `sql``` KHÔNG kèm tên bảng (memory `drizzle-sql-template-renders-columns-unqualified`).
 * Dựng subquery tương quan bằng `${chatCalls.id}` sẽ ra một `id` trần, và bên trong `SELECT ... FROM
 * chat_call_participants` thì `id` đó resolve về **bảng bên trong** ⇒ tương quan đứt ⇒ `NOT EXISTS` LUÔN
 * đúng ⇒ job gặt **MỌI cuộc gọi `active`, kể cả cuộc đang nói chuyện**. Hỏng đó trông y hệt thành công
 * (job chạy, phòng mở khoá, không lỗi nào) — nên nó được pin bằng ca test đọc CHUỖI SQL sinh ra, không
 * chỉ bằng hành vi.
 *
 * Vế "chưa ngã ngũ" KHÔNG viết lại ở đây: nó lấy từ `activeParticipantOutcomeSql()` — bản sao DUY NHẤT.
 * Cột `outcome` trần resolve đúng về `chat_call_participants` vì `chat_calls` không có cột cùng tên.
 */
export const noLiveParticipantSql = () =>
  sql`NOT EXISTS (
    SELECT 1 FROM chat_call_participants
    WHERE chat_call_participants.company_id = chat_calls.company_id
      AND chat_call_participants.call_id = chat_calls.id
      AND ${activeParticipantOutcomeSql()}
  )`;

/**
 * Xung đột "phòng đã có cuộc gọi sống" — neo theo **TÊN CONSTRAINT**, không theo mã `23505` trần.
 *
 * `chat_calls` còn `chat_calls_company_id_id_uq` (ống nước cho FK composite) và `chat_call_participants`
 * còn `chat_call_participants_uq`. Nuốt mọi `23505` thành 409 "phòng đang có cuộc gọi" là báo sai nguyên
 * nhân cho một lỗi hoàn toàn khác — và làm nó biến mất khỏi log điều tra.
 */
export function isLiveCallConflict(err: unknown): boolean {
  const e = pgErrorOf(err);
  return e?.code === "23505" && e?.constraint === "chat_calls_one_live_per_room_uq";
}

/**
 * Bóc lỗi Postgres THẬT ra khỏi vỏ của drizzle.
 *
 * ⚠️ **Đây là chỗ đã hỏng thật một lần, và hỏng theo kiểu tệ nhất.** `drizzle-orm` bọc lỗi driver trong
 * `DrizzleQueryError`, nên `err.code` ở lớp ngoài là **`undefined`** — mã `23505`/`23514` nằm ở
 * `err.cause`. Kiểm `(err as any).code` trên lớp ngoài luôn cho `false` ⇒ hai lời mời đồng thời trả
 * **500 "Lỗi hệ thống"** thay vì **409 CHAT-ERR-028**, và hỏng CHỈ dưới điều kiện đua — mọi thao tác
 * tuần tự vẫn xanh. Chỉ ca test bắn song song mới lộ ra.
 *
 * Đi theo chuỗi `cause` có cận trên (không `while(true)`): chuỗi lỗi tự tham chiếu sẽ treo vòng lặp.
 */
function pgErrorOf(err: unknown): { code?: unknown; constraint?: unknown } | null {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur; depth += 1) {
    const e = cur as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof e.code === "string") return e;
    cur = e.cause;
  }
  return null;
}

/**
 * Vi phạm FSM một chiều của `chat_calls` — TRIGGER `chat_calls_forbid_revive_trg` ném `23514` (mig `0546`
 * khối A3). Service ĐÃ chặn ở `WHERE` của `transition()`; hàm này chỉ để một hàng thua cuộc đua không nổ
 * **500**. Nếu nó được kích hoạt thường xuyên thì vị từ ở service đang sai — không được coi đây là đường
 * bình thường.
 *
 * ⚠️ **VÁ S7-CALL-BE-FIX-1 (MEDIUM-1).** Bản gốc nuốt MỌI `23514` trên bảng này thành 422 —
 * `chat_calls_kind_chk` · `_status_chk` · `_accepted_at_chk` · `_ended_at_chk` · `_ringing_clean_chk` đều
 * là `check_violation` với **cùng mã**. Một transition tương lai quên `ended_at` sẽ bị hàm này dịch nhầm
 * thành "sai pha" (422 CALL_NOT_ACTIONABLE) và biến mất khỏi log điều tra thay vì nổ 500.
 *
 * Phân biệt bằng `constraint`: trigger RAISE ở đây dùng `USING ERRCODE = '23514'` **không kèm
 * `USING CONSTRAINT`**, nên Postgres KHÔNG gắn tên constraint cho lỗi loại này (`err.constraint` rỗng).
 * Một CHECK constraint vi phạm THẬT (Postgres tự phát hiện, không qua RAISE tay) LUÔN có `err.constraint`
 * = đúng tên ràng buộc. Xác minh bằng trigger + CHECK THẬT trong int-spec (không suy đoán hành vi PG) —
 * ca "ràng buộc DB" của `chat-s7-call-be1-lifecycle.int-spec.ts` khẳng định cả hai vế bằng SQL trực tiếp.
 */
export function isCallStateViolation(err: unknown): boolean {
  const e = pgErrorOf(err);
  if (e?.code !== "23514") return false;
  return e.constraint == null;
}
