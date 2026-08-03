import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { chatRoomMembers, chatRooms } from "../db/schema/communication";
import type { ChatMemberRole, ChatRoomType } from "../db/schema/communication";
import { users } from "../db/schema/users";
import { unreadSeqExpr } from "./chat-visibility";

export interface ChatRoomListRow {
  id: string;
  companyId: string;
  refId: string | null;
  roomType: ChatRoomType;
  name: string | null;
  roomCode: string;
  description: string | null;
  lastMessageAt: Date | null;
  lastMessageSeq: number | null;
  isArchived: boolean;
  createdAt: Date;
  unreadCount: number;
}

export interface ChatMemberListRow {
  id: string;
  roomId: string;
  userId: string;
  userName: string | null;
  role: ChatMemberRole;
  joinedAt: Date;
  lastReadSeq: number;
}

/**
 * Hàng phòng dùng NỘI BỘ backend. Chứa cả cột KHÔNG được ra ngoài (`directKey` = quan hệ ai-nhắn-với-ai,
 * `deletedAt`) — chỉ `chat.mapper.ts` mới quyết định cột nào lên DTO, bằng cách liệt kê TƯỜNG MINH.
 */
export interface ChatRoomRow {
  id: string;
  companyId: string;
  refId: string | null;
  roomType: ChatRoomType;
  name: string | null;
  roomCode: string;
  description: string | null;
  directKey: string | null;
  lastMessageAt: Date | null;
  lastMessageSeq: number | null;
  isArchived: boolean;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface ChatMemberRow {
  id: string;
  roomId: string;
  userId: string;
  role: ChatMemberRole;
  joinedAt: Date;
  leftAt: Date | null;
}

/**
 * S7-CHAT-BE-5 — hình dạng INSERT phòng, **union theo `roomType`** (micro-plan §3.9).
 *
 * Ba cột neo (`direct_key`, `org_unit_id`, `ref_id`) bị `chk_chat_rooms_type_anchor` (mig `0538:116`)
 * ràng buộc CHÉO với `room_type`, và `sync_source` bị `chk_chat_rooms_sync_source` (`0538:124`) ràng buộc
 * chéo lần nữa. Nhận chúng làm 4 tham số optional rời rạc (hình dạng cũ) thì TypeScript **không bắt được
 * tổ hợp sai** — caller phải tự nhớ hai CHECK đó, và sai thì ra `23514` lúc chạy. Union này khiến
 * compiler ép đúng bộ neo cho từng loại, và `sync_source` KHÔNG còn là tham số: nó được SUY ra bên trong
 * (`roomAnchors`), nên không có đường nào truyền giá trị lệch vào.
 *
 * `createdBy: string | null` CHỈ ở hai nhánh dẫn xuất: job đối soát tạo phòng khi không có người dùng
 * nào đứng sau (cột DB vốn nullable — `communication.ts:171`). `direct`/`group` do người tạo qua API nên
 * giữ `string` bắt buộc — nới đúng nhánh cần nới.
 */
export type InsertRoomValues =
  | {
      companyId: string;
      roomType: "direct";
      directKey: string;
      name: null;
      description: string | null;
      roomCode: string;
      createdBy: string;
    }
  | {
      companyId: string;
      roomType: "group";
      directKey: null;
      name: string;
      description: string | null;
      roomCode: string;
      createdBy: string;
    }
  | {
      companyId: string;
      roomType: "department";
      orgUnitId: string;
      name: string;
      description: string | null;
      roomCode: string;
      createdBy: string | null;
    }
  | {
      companyId: string;
      roomType: "project";
      refId: string;
      name: string;
      description: string | null;
      roomCode: string;
      createdBy: string | null;
    };

/**
 * Bộ neo + `sync_source` + `synced_at` suy TỪ `roomType` — nơi DUY NHẤT biết luật của hai CHECK chéo.
 *
 * `syncedAt` chỉ set cho phòng dẫn xuất và chỉ ở thời điểm TẠO: nó là mốc "phòng này sinh ra từ đồng bộ
 * lúc nào", KHÔNG phải "lần đối soát thành viên gần nhất" (cập nhật mỗi nhịp diff sẽ là write-amplify
 * vô ích trên bảng nóng — micro-plan §3.10).
 */
function roomAnchors(values: InsertRoomValues) {
  switch (values.roomType) {
    case "direct":
      return {
        directKey: values.directKey,
        orgUnitId: null,
        refId: null,
        syncSource: "manual",
        syncedAt: null,
      };
    case "group":
      return {
        directKey: null,
        orgUnitId: null,
        refId: null,
        syncSource: "manual",
        syncedAt: null,
      };
    case "department":
      return {
        directKey: null,
        orgUnitId: values.orgUnitId,
        refId: null,
        syncSource: "department",
        syncedAt: new Date(),
      };
    case "project":
      return {
        directKey: null,
        orgUnitId: null,
        refId: values.refId,
        syncSource: "project",
        syncedAt: new Date(),
      };
  }
}

const ROOM_COLUMNS = {
  id: chatRooms.id,
  companyId: chatRooms.companyId,
  refId: chatRooms.refId,
  roomType: chatRooms.roomType,
  name: chatRooms.name,
  roomCode: chatRooms.roomCode,
  description: chatRooms.description,
  directKey: chatRooms.directKey,
  lastMessageAt: chatRooms.lastMessageAt,
  lastMessageSeq: chatRooms.lastMessageSeq,
  isArchived: chatRooms.isArchived,
  createdAt: chatRooms.createdAt,
  deletedAt: chatRooms.deletedAt,
} as const;

/**
 * S7-CHAT-BE-1 — data-access phòng & thành viên.
 *
 * MỌI hàm nhận `tx` (KHÔNG tự mở `withTenant`): service quyết định ranh giới transaction để thay đổi
 * nghiệp vụ và dòng audit cùng commit/rollback. Mọi vị từ đều có `company_id` tường minh bên cạnh RLS.
 *
 * ⚠️ QUYỀN GHI Ở DB — đọc trước khi thêm câu UPDATE nào (mig `0010`/`0050`/`0538`):
 *   • `chat_rooms`        : UPDATE cấp bảng CÓ · **DELETE đã REVOKE** ⇒ `delete()` = 42501 lúc chạy.
 *   • `chat_room_members` : UPDATE chỉ ĐÚNG 6 cột — `role`, `last_read_at`, `last_read_seq`,
 *     `muted_until`, `left_at`, `visible_from_seq`. **`joined_at` và `added_by` KHÔNG được cấp** ⇒
 *     "vào lại phòng thì làm mới joined_at" là 42501, không phải lựa chọn thiết kế. DELETE cũng đã REVOKE
 *     (rời phòng = `left_at`, giữ hàng — SPEC-15 §13.3).
 * TypeScript và unit test đều MÙ với hai ràng buộc trên; chỉ int-spec trên DB thật bắt được.
 */
@Injectable()
export class ChatRoomsRepository {
  /**
   * CHAT-API-001 — phòng của actor + số chưa đọc, trong ĐÚNG MỘT truy vấn (cấm N+1).
   *
   * `unread = GREATEST(0, COALESCE(r.last_message_seq,0) - m.last_read_seq)`, cả hai vế trong hệ
   * `room_seq` PER-ROOM (mig `0539`). KHÔNG dùng `chat_messages.seq`: đó là identity cấp BẢNG, phép trừ
   * trên nó cho ra tổng số tin TOÀN HỆ THỐNG giữa hai mốc (đo thật: 51 thay vì 1) và làm lộ lưu lượng
   * của phòng mình không thuộc.
   *
   * `COALESCE` không phải trang trí: `last_message_seq` là NULL ở phòng chưa có tin nào (`0538` không
   * đặt DEFAULT) ⇒ thiếu nó thì `unreadCount` ra null và FE ăn ZodError dù HTTP 200.
   * `GREATEST(0, …)` chặn số âm khi con trỏ đã đọc vượt (dữ liệu lệch do đồng bộ) — badge âm là bug hiển thị.
   *
   * Công thức lấy từ `unreadSeqExpr()` — DÙNG CHUNG với `unreadTotals` (CHAT-API-016), và đó là nơi vị
   * từ SPEC-15 §13.4 sống trong phép trừ (sàn `visible_from_seq − 1`). Trước GATE-2 công thức bị chép
   * tay ở cả hai file, và bản ở đây là bản KHÔNG có sàn.
   */
  async listRoomsForUser(
    tx: TenantTx,
    companyId: string,
    userId: string,
    filters: { roomType?: ChatRoomType; archived: boolean },
  ): Promise<ChatRoomListRow[]> {
    const conds: SQL[] = [
      eq(chatRooms.companyId, companyId),
      isNull(chatRooms.deletedAt),
      eq(chatRoomMembers.userId, userId),
      isNull(chatRoomMembers.leftAt),
      eq(chatRooms.isArchived, filters.archived),
    ];
    if (filters.roomType) conds.push(eq(chatRooms.roomType, filters.roomType));

    const rows = await tx
      .select({
        id: chatRooms.id,
        companyId: chatRooms.companyId,
        refId: chatRooms.refId,
        roomType: chatRooms.roomType,
        name: chatRooms.name,
        roomCode: chatRooms.roomCode,
        description: chatRooms.description,
        lastMessageAt: chatRooms.lastMessageAt,
        lastMessageSeq: chatRooms.lastMessageSeq,
        isArchived: chatRooms.isArchived,
        createdAt: chatRooms.createdAt,
        unreadCount: sql<number>`${unreadSeqExpr()}::int`,
      })
      .from(chatRooms)
      .innerJoin(
        chatRoomMembers,
        and(
          eq(chatRoomMembers.roomId, chatRooms.id),
          eq(chatRoomMembers.companyId, chatRooms.companyId),
        ),
      )
      .where(and(...conds))
      // NULLS LAST: phòng chưa có tin nào (last_message_at NULL) xuống cuối, không chiếm đầu danh sách.
      .orderBy(sql`${chatRooms.lastMessageAt} desc nulls last`, desc(chatRooms.createdAt));

    return rows.map((r) => ({ ...r, roomType: r.roomType as ChatRoomType }));
  }

  /** Phòng theo id — KHÔNG lọc membership. CHỈ dùng sau khi `assertMember` đã chạy, hoặc cho dedup DM. */
  async findRoomById(
    tx: TenantTx,
    companyId: string,
    roomId: string,
  ): Promise<ChatRoomRow | undefined> {
    const rows = await tx
      .select(ROOM_COLUMNS)
      .from(chatRooms)
      .where(and(eq(chatRooms.companyId, companyId), eq(chatRooms.id, roomId)))
      .limit(1);
    return rows[0] ? { ...rows[0], roomType: rows[0].roomType as ChatRoomType } : undefined;
  }

  /**
   * Dedup DM. CỐ Ý **không** lọc `deleted_at`: partial-unique `chat_rooms_direct_uq` phủ cả hàng đã xoá
   * mềm, nên bỏ qua hàng tombstone ở đây là đi thẳng vào `23505` mà không có nhánh xử lý.
   */
  async findRoomByDirectKey(
    tx: TenantTx,
    companyId: string,
    directKey: string,
  ): Promise<ChatRoomRow | undefined> {
    const rows = await tx
      .select(ROOM_COLUMNS)
      .from(chatRooms)
      .where(and(eq(chatRooms.companyId, companyId), eq(chatRooms.directKey, directKey)))
      .limit(1);
    return rows[0] ? { ...rows[0], roomType: rows[0].roomType as ChatRoomType } : undefined;
  }

  /**
   * S7-CHAT-BE-5 — phòng theo `org_unit_id` (phòng ban). Mirror `findRoomByDirectKey`: **không** lọc
   * `deleted_at`, vì partial-unique `chat_rooms_org_unit_uq` phủ cả hàng tombstone ⇒ bỏ qua hàng đã xoá
   * mềm ở đây là đi thẳng vào `23505` mà không có nhánh xử lý.
   */
  async findRoomByOrgUnitId(
    tx: TenantTx,
    companyId: string,
    orgUnitId: string,
  ): Promise<ChatRoomRow | undefined> {
    const rows = await tx
      .select(ROOM_COLUMNS)
      .from(chatRooms)
      .where(and(eq(chatRooms.companyId, companyId), eq(chatRooms.orgUnitId, orgUnitId)))
      .limit(1);
    return rows[0] ? { ...rows[0], roomType: rows[0].roomType as ChatRoomType } : undefined;
  }

  /** S7-CHAT-BE-5 — phòng theo `ref_id` (dự án). Cùng lý do không lọc `deleted_at` như trên. */
  async findRoomByRefId(
    tx: TenantTx,
    companyId: string,
    refId: string,
  ): Promise<ChatRoomRow | undefined> {
    const rows = await tx
      .select(ROOM_COLUMNS)
      .from(chatRooms)
      .where(and(eq(chatRooms.companyId, companyId), eq(chatRooms.refId, refId)))
      .limit(1);
    return rows[0] ? { ...rows[0], roomType: rows[0].roomType as ChatRoomType } : undefined;
  }

  async insertRoom(tx: TenantTx, values: InsertRoomValues): Promise<ChatRoomRow> {
    const anchors = roomAnchors(values);
    const rows = await tx
      .insert(chatRooms)
      .values({
        companyId: values.companyId,
        roomType: values.roomType,
        name: values.name,
        description: values.description,
        roomCode: values.roomCode,
        createdBy: values.createdBy,
        ...anchors,
      })
      .returning(ROOM_COLUMNS);
    return { ...rows[0], roomType: rows[0].roomType as ChatRoomType };
  }

  /** Bỏ tombstone của phòng DM (xem `openDirect` ở service). `chat_rooms` có UPDATE cấp bảng. */
  async restoreRoom(tx: TenantTx, companyId: string, roomId: string): Promise<void> {
    await tx
      .update(chatRooms)
      .set({ deletedAt: null, deletedBy: null })
      .where(and(eq(chatRooms.companyId, companyId), eq(chatRooms.id, roomId)));
  }

  async updateRoom(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    patch: { name?: string; description?: string | null },
    actorUserId: string,
  ): Promise<ChatRoomRow> {
    const rows = await tx
      .update(chatRooms)
      .set({ ...patch, updatedAt: new Date(), updatedBy: actorUserId })
      .where(and(eq(chatRooms.companyId, companyId), eq(chatRooms.id, roomId)))
      .returning(ROOM_COLUMNS);
    return { ...rows[0], roomType: rows[0].roomType as ChatRoomType };
  }

  /**
   * `actorUserId: string | null` — S7-CHAT-BE-5 nới ĐÚNG cho đường máy (job đóng phòng của dự án đã
   * kết thúc, không có người nào đứng sau). Cột `archived_by` vốn nullable ở DB (`communication.ts:185`);
   * chữ ký cũ hẹp hơn cột thật, không phải ràng buộc nghiệp vụ.
   */
  async archiveRoom(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    actorUserId: string | null,
  ): Promise<ChatRoomRow> {
    const now = new Date();
    const rows = await tx
      .update(chatRooms)
      .set({ isArchived: true, archivedAt: now, archivedBy: actorUserId, updatedAt: now })
      .where(and(eq(chatRooms.companyId, companyId), eq(chatRooms.id, roomId)))
      .returning(ROOM_COLUMNS);
    return { ...rows[0], roomType: rows[0].roomType as ChatRoomType };
  }

  // ─── thành viên ──────────────────────────────────────────────────────────────

  /** CHAT-API-007a — thành viên ĐANG hoạt động + `lastReadSeq` (dựng "đã xem bởi", SPEC-15 §13.2). */
  async listActiveMembers(
    tx: TenantTx,
    companyId: string,
    roomId: string,
  ): Promise<ChatMemberListRow[]> {
    const rows = await tx
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
      .orderBy(chatRoomMembers.joinedAt);
    return rows.map((r) => ({ ...r, role: r.role as ChatMemberRole }));
  }

  /** Hàng membership KỂ CẢ đã rời — cần để "vào lại" tái dùng đúng hàng cũ (unique room_id,user_id). */
  async findMemberRow(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    userId: string,
  ): Promise<ChatMemberRow | undefined> {
    const rows = await tx
      .select({
        id: chatRoomMembers.id,
        roomId: chatRoomMembers.roomId,
        userId: chatRoomMembers.userId,
        role: chatRoomMembers.role,
        joinedAt: chatRoomMembers.joinedAt,
        leftAt: chatRoomMembers.leftAt,
      })
      .from(chatRoomMembers)
      .where(
        and(
          eq(chatRoomMembers.companyId, companyId),
          eq(chatRoomMembers.roomId, roomId),
          eq(chatRoomMembers.userId, userId),
        ),
      )
      .limit(1);
    return rows[0] ? { ...rows[0], role: rows[0].role as ChatMemberRole } : undefined;
  }

  /** `addedBy: string | null` — cùng lý do như `archiveRoom`: cột nullable, đường máy không có actor. */
  async insertMember(
    tx: TenantTx,
    values: {
      companyId: string;
      roomId: string;
      userId: string;
      role: ChatMemberRole;
      addedBy: string | null;
    },
  ): Promise<void> {
    await tx.insert(chatRoomMembers).values(values);
  }

  /**
   * Vào lại phòng = tái dùng ĐÚNG hàng cũ (`left_at = NULL`), KHÔNG insert hàng thứ hai (23505 trên
   * unique `(room_id, user_id)`).
   *
   * ⚠️ KHÔNG đụng `joined_at`/`added_by` — hai cột đó ngoài tập 6 cột UPDATE-được ⇒ 42501 lúc chạy.
   * Giữ `joined_at` cũ cũng ĐÚNG ngữ nghĩa SPEC-15 §13.3 (mốc "từng ở đây").
   */
  async reactivateMember(
    tx: TenantTx,
    companyId: string,
    memberRowId: string,
    role: ChatMemberRole,
  ): Promise<void> {
    await tx
      .update(chatRoomMembers)
      .set({ leftAt: null, role })
      .where(and(eq(chatRoomMembers.companyId, companyId), eq(chatRoomMembers.id, memberRowId)));
  }

  async setMemberRole(
    tx: TenantTx,
    companyId: string,
    memberRowId: string,
    role: ChatMemberRole,
  ): Promise<void> {
    await tx
      .update(chatRoomMembers)
      .set({ role })
      .where(and(eq(chatRoomMembers.companyId, companyId), eq(chatRoomMembers.id, memberRowId)));
  }

  /** Rời/bị bớt = SET `left_at`. DELETE đã bị REVOKE ở `0538` ⇒ viết `delete()` là 42501. */
  async setMemberLeft(tx: TenantTx, companyId: string, memberRowId: string): Promise<void> {
    await tx
      .update(chatRoomMembers)
      .set({ leftAt: new Date() })
      .where(and(eq(chatRoomMembers.companyId, companyId), eq(chatRoomMembers.id, memberRowId)));
  }

  /** Đếm thành viên hoạt động theo vai trò — nền của luật "không bỏ admin cuối" (CHAT-ERR-011). */
  async countActiveMembers(
    tx: TenantTx,
    companyId: string,
    roomId: string,
  ): Promise<{ total: number; admins: number }> {
    const rows = await tx
      .select({
        total: sql<number>`count(*)::int`,
        admins: sql<number>`count(*) filter (where ${chatRoomMembers.role} = 'admin')::int`,
      })
      .from(chatRoomMembers)
      .where(
        and(
          eq(chatRoomMembers.companyId, companyId),
          eq(chatRoomMembers.roomId, roomId),
          isNull(chatRoomMembers.leftAt),
        ),
      );
    return rows[0] ?? { total: 0, admins: 0 };
  }

  // ─── kiểm tra người dùng ─────────────────────────────────────────────────────

  /**
   * Lọc ra các userId THỰC SỰ dùng được: cùng tenant, chưa xoá mềm, `status='active'`.
   *
   * Vì sao phải kiểm ở app dù đã có RLS + FK: FK `chat_room_members.user_id → users.id` là FK MỘT CỘT và
   * kiểm tra FK của Postgres BỎ QUA RLS theo thiết kế ⇒ nó KHÔNG chặn được userId của tenant khác. Và
   * không ràng buộc nào của DB biết `status`/`deleted_at`.
   */
  async findUsableUserIds(
    tx: TenantTx,
    companyId: string,
    userIds: string[],
  ): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.companyId, companyId),
          // sql.param cho mảng: `${arr}` trần sinh bind sai kiểu ⇒ 500 lúc chạy (memory
          // drizzle-array-bind-sql-param). inArray của drizzle đã bind đúng, giữ nguyên.
          inArray(users.id, userIds),
          isNull(users.deletedAt),
          eq(users.status, "active"),
        ),
      );
    return new Set(rows.map((r) => r.id));
  }
}
