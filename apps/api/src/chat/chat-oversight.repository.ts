import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { auditLogs } from "../db/schema/audit";
import { chatMessages, chatRoomMembers, chatRooms } from "../db/schema/communication";
import type { ChatMessageType, ChatRoomType } from "../db/schema/communication";
import { users } from "../db/schema/users";
import type { ChatSearchCursor } from "./chat-search-cursor";
import { CHAT_AUDIT, CHAT_MODULE_CODE } from "./chat.errors";

export interface ChatOversightRoomRow {
  id: string;
  roomCode: string;
  name: string | null;
  roomType: ChatRoomType;
  description: string | null;
  isArchived: boolean;
  memberCount: number;
  lastMessageAt: Date | null;
  createdAt: Date;
}

export interface ChatOversightMessageRow {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string | null;
  body: string;
  messageType: ChatMessageType;
  mentions: string[];
  pinnedAt: Date | null;
  replyToMessageId: string | null;
  recalledAt: Date | null;
  attachmentCount: number;
  roomSeq: number;
  createdAt: Date;
}

export interface ChatOversightAuditRow {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  roomId: string | null;
  roomCode: string | null;
  roomName: string | null;
  resultStatus: string | null;
  metadata: unknown;
  createdAt: Date;
  /** `date_trunc('milliseconds', created_at)` — khoá sắp xếp VÀ nguồn dựng con trỏ. Xem `auditSortAtExpr`. */
  sortAt: Date;
}

/**
 * ⚠️ **`date_trunc('milliseconds', …)` KHÔNG phải làm đẹp** — `audit_logs.created_at` là `timestamptz`
 * (micro-giây) còn JS `Date` chỉ giữ mili-giây, nên so sánh con trỏ trên cột THÔ sẽ loại nhầm các hàng
 * cũ hơn nằm trong cùng một mili-giây ⇒ trang sau **sót dòng, HTTP 200, không lỗi**. Lý do đầy đủ ở jsdoc
 * `chat-search-cursor.ts`; bản sao DUY NHẤT của luật đó là cặp hàm encode/decode ở file kia, và đây là
 * vế SQL tương ứng.
 *
 * `audit_logs` là bảng append-only ghi rất dày (AUTH/HR/LEAVE dùng chung) ⇒ va chạm trong cùng
 * mili-giây ở đây KHẢ DĨ HƠN HẲN so với `chat_messages`, không phải rủi ro lý thuyết.
 */
function auditSortAtExpr(): SQL<Date> {
  return sql<Date>`date_trunc('milliseconds', ${auditLogs.createdAt})`;
}

/**
 * `.mapWith` là BẮT BUỘC ở vế SELECT: driver `pg` trả `timestamptz` dạng CHUỖI cho biểu thức tính toán
 * (không phải cột), nên thiếu bước này thì `sortAt.toISOString()` nổ **500 lúc chạy trong khi `tsc` hoàn
 * toàn im lặng** (kiểu khai là `Date`). Mirror `sortAtSelect()` của `chat-search.repository.ts`.
 */
function auditSortAtSelect(): SQL<Date> {
  return auditSortAtExpr().mapWith((v: unknown) => (v instanceof Date ? v : new Date(String(v))));
}

/**
 * Cột ra khỏi repo trên đường ĐỌC-VƯỢT. Liệt kê TƯỜNG MINH, không `select()` trần — cùng lý do với
 * `MESSAGE_COLUMNS` của `ChatMessagesRepository`, cộng thêm một lý do RIÊNG của đường này:
 *
 * ⚠️ **KHÔNG có `clientMessageId`, KHÔNG có `seq` (identity cấp BẢNG), KHÔNG có `searchVector`.** `seq`
 * lộ ra client cho phép suy lưu lượng tin TOÀN CÔNG TY giữa hai mốc (SPEC-15 §13.1) — và người gọi đường
 * này vốn đã đọc được nhiều hơn ai hết, nên đây đúng là chỗ KHÔNG được nới thêm một milimet nào.
 */
const OVERSIGHT_MESSAGE_COLUMNS = {
  id: chatMessages.id,
  roomId: chatMessages.roomId,
  senderId: chatMessages.senderId,
  senderName: users.fullName,
  body: chatMessages.body,
  messageType: chatMessages.messageType,
  mentions: chatMessages.mentions,
  pinnedAt: chatMessages.pinnedAt,
  replyToMessageId: chatMessages.replyToMessageId,
  recalledAt: chatMessages.recalledAt,
  attachmentCount: chatMessages.attachmentCount,
  roomSeq: chatMessages.roomSeq,
  createdAt: chatMessages.createdAt,
} as const;

/**
 * S7-CHAT-BE-7 🔒 — data-access của ĐƯỜNG ĐỌC-VƯỢT MEMBERSHIP (CHAT-DEC-004 · API-13 §5.3).
 *
 * ┌─ ĐỌC KỸ TRƯỚC KHI SỬA — FILE NÀY CỐ Ý KHÔNG CÓ VỊ TỪ MEMBERSHIP ─────────────────────────────────┐
 * │ Mọi repo khác của module bó theo membership của actor (trực tiếp, hoặc gián tiếp qua              │
 * │ `ChatAccessService`). File này **cố tình không**, và đó CHÍNH LÀ chức năng của nó. Bù lại, nó chỉ  │
 * │ được gọi từ `ChatOversightService` — nơi mỗi lời gọi kèm MỘT dòng `audit_logs` trong CÙNG          │
 * │ transaction. Repo này lọt vào bất kỳ service nào khác là một đường đọc toàn tenant KHÔNG DẤU VẾT.  │
 * │ Ca census `chat-oversight.census.spec.ts` đóng đinh: chỉ `chat-oversight.service.ts` import nó.    │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **KHÔNG import `chat-visibility.ts`** (API-13 §5.3 ràng buộc 8). Vị từ SPEC-15 §13.4
 * (`visible_from_seq`) đọc từ hàng `chat_room_members` của actor — người đọc-vượt KHÔNG CÓ hàng đó, nên
 * mượn vị từ ấy sẽ trả về **RỖNG** trên mọi phòng. Đó là hỏng-lặng-lẽ theo chiều ngược lại: nhìn giống
 * "phòng không có tin" chứ không giống lỗi quyền, nên không ai điều tra.
 *
 * `company_id` tường minh ở MỌI vế bên cạnh RLS (CLAUDE.md §2 mục 1) — RLS đã ép, nhưng đây là đường đọc
 * bỏ qua ranh giới dữ liệu của module, nên vế tenant là thứ CUỐI CÙNG còn lại.
 *
 * Repo CHỈ ĐỌC: không hàm nào ở đây INSERT/UPDATE/DELETE. Không có biến thể ghi dưới `/chat/oversight/`
 * (API-13 §5.3 ràng buộc 4).
 */
@Injectable()
export class ChatOversightRepository {
  /**
   * CHAT-API-018a — TRA phòng theo mã/tên/loại. Trả `limit + 1` hàng để service biết có bị cắt không.
   *
   * ⚠️ Khớp trên `room_code` và `name` — **KHÔNG** trên tên người tham gia. Phòng `direct` có
   * `name IS NULL` nên tra theo tên không bao giờ ra DM; muốn xem một DM thì phải biết `room_code` hoặc
   * `roomId` và gọi `018b`/`018c` ĐÍCH DANH, mỗi lần một dòng audit. Cho phép tìm theo tên người sẽ biến
   * một lời gọi thành đồ thị "ai nhắn riêng với ai" của cả công ty — rộng hơn hẳn ngoại lệ owner chốt.
   *
   * `memberCount` lấy bằng truy vấn THỨ HAI trên đúng trang vừa lấy (`countActiveMembersByRoom`) — xem
   * cảnh báo ở hàm đó trước khi "tối ưu" về một truy vấn con.
   *
   * Phòng đã xoá mềm KHÔNG hiện: `deleted_at` là quyết định đã có của tenant, đọc-vượt không phải thùng rác.
   */
  async searchRooms(
    tx: TenantTx,
    companyId: string,
    opts: { q: string; roomType?: ChatRoomType; limit: number },
  ): Promise<ChatOversightRoomRow[]> {
    const pattern = `%${escapeLikePattern(opts.q)}%`;
    const conds: SQL[] = [
      eq(chatRooms.companyId, companyId),
      isNull(chatRooms.deletedAt),
      // `ilike` của drizzle bind tham số (không nối chuỗi); ký tự đại diện của LIKE đã escape ở trên.
      or(ilike(chatRooms.roomCode, pattern), ilike(chatRooms.name, pattern)) as SQL,
    ];
    if (opts.roomType) conds.push(eq(chatRooms.roomType, opts.roomType));

    const rows = await tx
      .select({
        id: chatRooms.id,
        roomCode: chatRooms.roomCode,
        name: chatRooms.name,
        roomType: chatRooms.roomType,
        description: chatRooms.description,
        isArchived: chatRooms.isArchived,
        lastMessageAt: chatRooms.lastMessageAt,
        createdAt: chatRooms.createdAt,
      })
      .from(chatRooms)
      .where(and(...conds))
      .orderBy(sql`${chatRooms.lastMessageAt} desc nulls last`, desc(chatRooms.createdAt))
      .limit(opts.limit + 1);

    const counts = await this.countActiveMembersByRoom(
      tx,
      companyId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({
      ...r,
      roomType: r.roomType as ChatRoomType,
      memberCount: counts.get(r.id) ?? 0,
    }));
  }

  /**
   * CHAT-API-018b — MỘT phòng theo id, KHÔNG lọc membership của người gọi.
   *
   * `undefined` cho: phòng không tồn tại · phòng của tenant khác (RLS + vế `company_id`) · phòng đã xoá
   * mềm. Caller ném 404 với HẰNG `CHAT_ERR.ROOM_NOT_FOUND` — GIỐNG HỆT đường đọc thường, để `roomId`
   * không thành oracle dò trên chính đường quản trị.
   */
  async findRoom(
    tx: TenantTx,
    companyId: string,
    roomId: string,
  ): Promise<ChatOversightRoomRow | undefined> {
    const rows = await tx
      .select({
        id: chatRooms.id,
        roomCode: chatRooms.roomCode,
        name: chatRooms.name,
        roomType: chatRooms.roomType,
        description: chatRooms.description,
        isArchived: chatRooms.isArchived,
        lastMessageAt: chatRooms.lastMessageAt,
        createdAt: chatRooms.createdAt,
      })
      .from(chatRooms)
      .where(
        and(
          eq(chatRooms.companyId, companyId),
          eq(chatRooms.id, roomId),
          isNull(chatRooms.deletedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return undefined;
    const counts = await this.countActiveMembersByRoom(tx, companyId, [row.id]);
    return {
      ...row,
      roomType: row.roomType as ChatRoomType,
      memberCount: counts.get(row.id) ?? 0,
    };
  }

  /**
   * CHAT-API-018c — một trang tin theo CON TRỎ, **TOÀN DẢI `room_seq`** của phòng.
   *
   * Đây là điểm khác biệt cốt lõi so với `ChatMessagesRepository.listMessages`: không
   * `visibleFromSeqScalar`, không join `chat_room_members`. Xem khối cảnh báo ở jsdoc lớp.
   *
   * Trả LUÔN TĂNG DẦN theo `room_seq` (mirror đường thường): nhánh `beforeSeq`/mặc định quét DESC để lấy
   * đúng k tin gần con trỏ nhất rồi đảo lại — trả hai chiều khác nhau tuỳ tham số là bắt FE tự đoán chiều.
   */
  async listMessages(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    opts: { beforeSeq?: number; afterSeq?: number; limit: number },
  ): Promise<ChatOversightMessageRow[]> {
    const conds: SQL[] = [eq(chatMessages.companyId, companyId), eq(chatMessages.roomId, roomId)];
    if (opts.beforeSeq !== undefined) conds.push(lt(chatMessages.roomSeq, opts.beforeSeq));
    if (opts.afterSeq !== undefined) conds.push(gt(chatMessages.roomSeq, opts.afterSeq));

    const ascending = opts.afterSeq !== undefined;
    const rows = await tx
      .select(OVERSIGHT_MESSAGE_COLUMNS)
      .from(chatMessages)
      .leftJoin(
        users,
        and(eq(users.id, chatMessages.senderId), eq(users.companyId, chatMessages.companyId)),
      )
      .where(and(...conds))
      .orderBy(ascending ? asc(chatMessages.roomSeq) : desc(chatMessages.roomSeq))
      .limit(opts.limit);

    const mapped = rows.map((r) => ({ ...r, messageType: r.messageType as ChatMessageType }));
    return ascending ? mapped : mapped.reverse();
  }

  /**
   * CHAT-API-018b — thành viên ĐANG hoạt động của phòng.
   *
   * ⚠️ Vì sao KHÔNG tái dùng `ChatRoomsRepository.listActiveMembers` dù truy vấn gần giống: hàm kia phục
   * vụ đường đọc THƯỜNG và caller của nó luôn đứng sau `assertMember`. Nếu WO sau siết nó theo actor —
   * đúng thứ memory `reused-method-must-be-actor-scoped` cảnh báo — thì `018b` sẽ **trả rỗng trong im
   * lặng** cho mọi phòng, và không test nào của WO kia đỏ. Bản sao ở đây tự chịu trách nhiệm cho ngữ
   * cảnh "không có actor", nên nó không thể bị siết nhầm.
   */
  async listActiveMembers(
    tx: TenantTx,
    companyId: string,
    roomId: string,
  ): Promise<
    Array<{
      id: string;
      roomId: string;
      userId: string;
      userName: string | null;
      role: string;
      joinedAt: Date;
      lastReadSeq: number;
    }>
  > {
    return tx
      .select({
        id: chatRoomMembers.id,
        roomId: chatRoomMembers.roomId,
        userId: chatRoomMembers.userId,
        userName: users.fullName,
        role: chatRoomMembers.role,
        joinedAt: chatRoomMembers.joinedAt,
        lastReadSeq: chatRoomMembers.lastReadSeq,
      })
      .from(chatRoomMembers)
      .leftJoin(
        users,
        and(eq(users.id, chatRoomMembers.userId), eq(users.companyId, chatRoomMembers.companyId)),
      )
      .where(
        and(
          eq(chatRoomMembers.companyId, companyId),
          eq(chatRoomMembers.roomId, roomId),
          isNull(chatRoomMembers.leftAt),
        ),
      )
      .orderBy(asc(chatRoomMembers.joinedAt), asc(chatRoomMembers.id));
  }

  /**
   * CHAT-API-019 — nhật ký đọc-vượt.
   *
   * ⚠️ **BÓ CẢ `action` LẪN `module_code`** (API-13 §5.3). Bỏ một trong hai vế là biến MỘT cặp quyền của
   * CHAT thành **cổng đọc `audit_logs` toàn hệ thống** — bảng dùng chung đang phục vụ điều tra
   * AUTH/HR/LEAVE. Ca test bắt buộc: gieo dòng audit của module khác (cùng `action`) và dòng CHAT
   * (`action` khác) → cả hai KHÔNG được trả về.
   *
   * Ba vế này khớp đúng tiền tố của `idx_audit_logs_action` `(company_id, module_code, action,
   * created_at DESC)` — không assert EXPLAIN chọn index nào (memory `pg-planner-index-assert-trap`).
   *
   * Keyset `(sortAt DESC, id DESC)` — **con trỏ dùng LẠI codec của `chat-search-cursor.ts`**, không viết
   * codec thứ hai: luật "cắt về mili-giây ở CẢ khoá lẫn con trỏ" là thứ dễ hiện thực sai một cách im
   * lặng, nên nó chỉ được phép có MỘT bản. Trả `limit + 1` để service dựng `nextCursor`. Cấm offset: bảng
   * append-only tăng liên tục nên offset trôi giữa hai lần lật trang.
   */
  async listOversightAudit(
    tx: TenantTx,
    companyId: string,
    opts: { limit: number; cursor?: ChatSearchCursor },
  ): Promise<ChatOversightAuditRow[]> {
    const sortAt = auditSortAtExpr();
    const conds: SQL[] = [
      eq(auditLogs.companyId, companyId),
      eq(auditLogs.action, CHAT_AUDIT.OVERSIGHT_READ),
      eq(auditLogs.moduleCode, CHAT_MODULE_CODE),
    ];
    if (opts.cursor) {
      // Hàng "cũ hơn" theo ĐÚNG thứ tự sắp xếp `(sortAt DESC, id DESC)` — mirror `chat-search.repository`.
      conds.push(
        or(
          lt(sortAt, opts.cursor.sortAt),
          and(eq(sortAt, opts.cursor.sortAt), lt(auditLogs.id, opts.cursor.id)),
        ) as SQL,
      );
    }

    return (
      tx
        .select({
          id: auditLogs.id,
          actorUserId: auditLogs.actorUserId,
          actorName: users.fullName,
          roomId: auditLogs.objectId,
          roomCode: chatRooms.roomCode,
          roomName: chatRooms.name,
          resultStatus: auditLogs.resultStatus,
          metadata: auditLogs.metadata,
          createdAt: auditLogs.createdAt,
          sortAt: auditSortAtSelect(),
        })
        .from(auditLogs)
        .leftJoin(
          users,
          and(eq(users.id, auditLogs.actorUserId), eq(users.companyId, auditLogs.companyId)),
        )
        // Phòng có thể đã xoá mềm sau lần đọc-vượt — vẫn phải hiện tên trong nhật ký, nếu không thì "xoá
        // phòng" trở thành cách làm mờ chính dòng audit đã ghi lại việc đọc nó.
        .leftJoin(
          chatRooms,
          and(eq(chatRooms.id, auditLogs.objectId), eq(chatRooms.companyId, auditLogs.companyId)),
        )
        .where(and(...conds))
        .orderBy(desc(sortAt), desc(auditLogs.id))
        .limit(opts.limit + 1)
    );
  }

  /**
   * Số thành viên ĐANG hoạt động, theo LÔ `roomId` — truy vấn THỨ HAI trên đúng trang vừa lấy.
   *
   * ┌─ ⚠️ ĐỪNG "TỐI ƯU" VỀ MỘT TRUY VẤN CON TƯƠNG QUAN — ĐÃ THỬ, ĐÃ HỎNG LẶNG LẼ ─────────────────────┐
   * │ Bản đầu viết `sql`` (select count(*) from ${chatRoomMembers} where ${chatRoomMembers.roomId} =   │
   * │ ${chatRooms.id} …)``. Drizzle render cột trong `sql` template **KHÔNG kèm tên bảng**, nên SQL     │
   * │ sinh ra là:                                                                                       │
   * │     select count(*)::int from "chat_room_members" where "room_id" = "id" and "company_id" =       │
   * │     "company_id" and "left_at" is null                                                            │
   * │ Cả `"room_id"` lẫn `"id"` đều phân giải vào **chính `chat_room_members`** ⇒ truy vấn con TỰ THAM  │
   * │ CHIẾU thay vì tương quan với hàng phòng bên ngoài. Nó là SQL HỢP LỆ, chạy được, **luôn trả 0** —  │
   * │ không lỗi, không cảnh báo, `tsc` im lặng. Đo thật trên lane DB: `memberCount = 0` cho phòng có 2   │
   * │ thành viên (ca int-spec 24b bắt được).                                                            │
   * │ Cùng họ với `identity-projection-census-misses-alias`: định danh ngầm trong SQL sinh ra là điểm   │
   * │ mù. Hai truy vấn tường minh thì không có gì để phân giải nhầm.                                     │
   * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * `GROUP BY` ở truy vấn RIÊNG là an toàn — khác hẳn việc join-rồi-gom trong chính truy vấn tra phòng,
   * nơi gộp nhóm nhân bản hàng phòng theo số thành viên và làm `limit + 1` mất ý nghĩa "bị cắt".
   */
  private async countActiveMembersByRoom(
    tx: TenantTx,
    companyId: string,
    roomIds: readonly string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (roomIds.length === 0) return out;

    const rows = await tx
      .select({ roomId: chatRoomMembers.roomId, n: sql<number>`count(*)::int` })
      .from(chatRoomMembers)
      .where(
        and(
          eq(chatRoomMembers.companyId, companyId),
          // `inArray` của drizzle bind đúng kiểu mảng — KHÔNG nội suy `${arr}` vào `sql` tay
          // (memory `drizzle-array-bind-sql-param`: sinh câu lệnh sai, nổ 500 lúc chạy, typecheck mù).
          inArray(chatRoomMembers.roomId, [...roomIds]),
          isNull(chatRoomMembers.leftAt),
        ),
      )
      .groupBy(chatRoomMembers.roomId);

    for (const r of rows) out.set(r.roomId, Number(r.n));
    return out;
  }
}

/**
 * Vô hiệu hoá ký tự đại diện của `LIKE` trong chuỗi người dùng gõ.
 *
 * Không phải chống SQL-injection (drizzle đã bind tham số): `%` và `_` do người dùng nhập biến một truy
 * vấn "tra đích danh" thành `%%` — khớp MỌI phòng, tức đúng cái "liệt kê mọi phòng" mà API-13 §5.3 cấm,
 * và nó lọt qua cả trần `min(2)` (chuỗi `%%` dài 2 ký tự). Postgres nhận ESCAPE mặc định là `\`.
 */
function escapeLikePattern(raw: string): string {
  return raw.replace(/([\\%_])/g, "\\$1");
}
