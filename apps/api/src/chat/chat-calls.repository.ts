import { Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
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

/** Trạng thái "cuộc gọi còn sống" — ĐÚNG tập của partial unique index `chat_calls_one_live_per_room_uq`. */
export const CHAT_CALL_LIVE_STATUSES = ["ringing", "active"] as const;

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
   * `outcome IS NULL` trong `WHERE` giữ tính **một chiều** ở tầng hàng người-tham-gia: đã ngã ngũ rồi thì
   * không ghi đè. DB không có trigger cho bảng này (chỉ `chat_calls` có), nên vế này là lớp duy nhất —
   * thiếu nó, một `hangup` trễ sẽ viết đè `rejected` thành `left` và lịch sử cuộc gọi nói sai.
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
          isNull(chatCallParticipants.outcome),
        ),
      )
      .returning({ id: chatCallParticipants.id });
    return rows.length > 0;
  }

  /**
   * Đóng sổ những người CHƯA ngã ngũ khi cuộc gọi kết thúc (người không kịp bấm gì).
   *
   * `except` giữ nguyên hàng của chính người vừa thao tác — hàng đó đã được `setParticipantOutcome` ghi
   * đúng kết cục riêng (`rejected`/`cancelled`/`left`) ngay trước đó trong cùng tx.
   */
  async closeOpenParticipants(
    tx: TenantTx,
    companyId: string,
    callId: string,
    outcome: ChatCallOutcome,
  ): Promise<number> {
    const rows = await tx
      .update(chatCallParticipants)
      .set({ outcome })
      .where(
        and(
          eq(chatCallParticipants.companyId, companyId),
          eq(chatCallParticipants.callId, callId),
          isNull(chatCallParticipants.outcome),
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
  ): Promise<string[]> {
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
      .returning({ id: chatCalls.id, roomId: chatCalls.roomId });

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

    return expired.map((e) => e.id);
  }

  /**
   * Số cuộc gọi `ringing` quá hạn của TOÀN tenant — dùng để job biết có việc hay không mà không phải mở
   * đường ghi. Đọc rẻ nhờ `chat_calls_status_started_idx (company_id, status, started_at)`.
   */
  async countStaleRinging(tx: TenantTx, companyId: string, cutoff: Date): Promise<number> {
    const rows = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(chatCalls)
      .where(
        and(
          eq(chatCalls.companyId, companyId),
          eq(chatCalls.status, "ringing"),
          lt(chatCalls.startedAt, cutoff),
        ),
      );
    return rows[0]?.n ?? 0;
  }
}

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
 * Vi phạm CHECK/trigger của `chat_calls` — lưới cuối cho FSM một chiều
 * (`chat_calls_forbid_revive_trg` ném `23514`, mig `0546` khối A3).
 *
 * Service ĐÃ chặn ở `WHERE` của `transition()`; hàm này chỉ để một hàng thua cuộc đua không nổ **500**.
 * Nếu nó được kích hoạt thường xuyên thì vị từ ở service đang sai — không được coi đây là đường bình thường.
 */
export function isCallStateViolation(err: unknown): boolean {
  return pgErrorOf(err)?.code === "23514";
}
