import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { chatRoomMembers, chatRooms } from "../db/schema/communication";
import type { ChatMemberRole, ChatRoomType } from "../db/schema/communication";
// S8-CHAT-UX-FE-3 — chỉ để lấy ỨNG VIÊN ảnh đại diện cho roster (`employee_profiles.avatar_url` thô).
// CHAT không đọc gì khác của HR ở đây và không được phép: mọi trường hồ sơ khác đi qua module HR với
// cặp quyền của nó.
import { employeeProfiles } from "../db/schema/employees";
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
  // ── S8-CHAT-UX-BE-1 — tuỳ chọn PER-USER, lấy từ CHÍNH hàng membership đã join sẵn ──
  // Không thêm truy vấn nào: `listRoomsForUser` vốn đã innerJoin `chat_room_members` của actor.
  pinnedAt: Date | null;
  mutedUntil: Date | null;
  markedUnreadAt: Date | null;
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
 * S8-CHAT-UX-FE-3 — một hàng của **ROSTER** (CHAT-API-007a · CHAT-DEC-019). Khác `ChatMemberListRow` ở
 * ba cột, và cả ba đều có lý do:
 *
 *  - `leftAt` — roster GỒM CẢ người đã rời (thiếu họ thì tin cũ mất avatar lẫn tên);
 *  - `employeeId` — khoá của `AvatarPresignService` (nó làm việc theo NHÂN VIÊN, không theo user);
 *  - `avatarRaw` — giá trị **THÔ** của `employee_profiles.avatar_url`.
 *
 * ⚠️ Hậu tố `Raw` CỐ Ý (mirror `TaskCoreRow.assigneeAvatarRaw`): cột đó ĐA-NGƯỜI-GHI (yêu-cầu-đổi-hồ-sơ
 * ghi verbatim, có thể bị đầu độc trỏ tệp bất kỳ trong tenant) nên **KHÔNG được vào DTO**. Nó chỉ là ứng
 * viên; `resolveEmployeeAvatars` mới là nơi xác minh cặp `(employeeId, fileId)` rồi ký. Đặt tên trùng
 * `avatarUrl` ở đây là mời gọi đúng cái lỗi đó.
 */
export interface ChatRosterRow extends ChatMemberListRow {
  leftAt: Date | null;
  employeeId: string | null;
  avatarRaw: string | null;
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

/**
 * S8-CHAT-UX-BE-1 — `classid` cho `pg_advisory_xact_lock(classid, objid)` của luồng GHIM HỘI THOẠI.
 *
 * Không gian khoá advisory là TOÀN CỤC trong một database (không tenant, không schema) ⇒ đặt hằng có
 * tên thay vì `hashtext('chuỗi nào đó')` tại chỗ, để module sau không va phải. Khuôn + lý do đầy đủ:
 * `task-file.service.ts:47` (`ADVISORY_CLASS_TASK_COVER = 0x5401`, đã qua FULL gate ở S5-TASK-COVER-1).
 */
const ADVISORY_CLASS_CHAT_ROOM_PIN = 0x5801;

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
 *   • `chat_rooms`        : UPDATE **chỉ ĐÚNG 11 cột** — `name`, `description`, `is_archived`,
 *     `archived_at`, `archived_by`, `last_message_at`, `last_message_seq`, `updated_at`, `updated_by`,
 *     `deleted_at`, `deleted_by` (`0540` khối A gỡ vế CẤP BẢNG rồi cấp lại theo cột). **DELETE đã
 *     REVOKE** ⇒ `delete()` = 42501 lúc chạy. ⚠️ Dòng này TRƯỚC 2026-08-05 ghi "UPDATE cấp bảng CÓ" —
 *     đúng tới `0538`, CHẾT từ `0540`; đo lại bằng `has_table_privilege('mediaos_app','chat_rooms',
 *     'UPDATE')` = `f` (FULL gate S7-CHAT-CLEAN-1).
 *   • `chat_room_members` : UPDATE chỉ ĐÚNG **7 cột** — `last_read_at`, `last_read_seq`, `left_at`,
 *     `marked_unread_at`, `muted_until`, `pinned_at`, `role`. **`joined_at` và `added_by` KHÔNG được
 *     cấp** ⇒ "vào lại phòng thì làm mới joined_at" là 42501, không phải lựa chọn thiết kế. DELETE cũng
 *     đã REVOKE (rời phòng = `left_at`, giữ hàng — SPEC-15 §13.3).
 *     ⚠️ Dòng này TRƯỚC 2026-08-06 ghi "6 cột … `visible_from_seq`" — **SAI theo hướng nguy hiểm**: nó
 *     mời người đọc viết một câu UPDATE ra `42501` lúc chạy. Đo lại bằng `aclexplode` trên DB thật
 *     (khuôn mà chính khối VERIFY của `0543` mục (E)(1) dùng để pin): tập cột KHÔNG có
 *     `visible_from_seq`, và có thêm `marked_unread_at`/`pinned_at` từ `0543`. Bài học
 *     `grant-in-old-migration-is-not-current-state` — GRANT trong migration cũ không phải hiện trạng.
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
        // S8-CHAT-UX-BE-1 — ba cột của hàng membership ĐANG join, không phải của phòng: hai người
        // trong cùng một phòng nhận ba giá trị KHÁC NHAU, đó là toàn bộ ý nghĩa "per-user".
        pinnedAt: chatRoomMembers.pinnedAt,
        mutedUntil: chatRoomMembers.mutedUntil,
        markedUnreadAt: chatRoomMembers.markedUnreadAt,
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

  /**
   * S8-CHAT-UX-RT-1 — id những người có chung **ít nhất một phòng `direct`** đang hoạt động với `userId`.
   *
   * Đây là tập người nhận `chat:presence` (API-13 §7). Phạm vi hẹp có chủ đích: presence là dữ liệu hiện
   * diện của một con người, chỉ những người đã có kênh 1-1 với họ mới thấy — KHÔNG fan-out ra mọi phòng
   * nhóm (một phòng phòng-ban vài trăm người sẽ biến presence thành bảng chấm công thời gian thực mà
   * SPEC-15 không cấp phép, và CHAT-FUNC-021 chỉ vẽ nó ở phòng `direct` + danh sách thành viên).
   *
   * `company_id` khớp ở CẢ BA vế (`chat_rooms` · membership của actor · membership của peer) — thiếu vế
   * nào là mở đường ghép thành viên tenant khác qua một `room_id` đoán được (memory
   * `new-fk-column-needs-composite-tenant-fk`). RLS vẫn là hàng rào cuối, nhưng vị từ ở đây phải tự đúng.
   *
   * Lọc `left_at IS NULL` ở CẢ HAI vế: người đã rời DM không còn được nhận trạng thái của người kia nữa.
   */
  async listDirectPeerUserIds(tx: TenantTx, companyId: string, userId: string): Promise<string[]> {
    const peer = alias(chatRoomMembers, "peer_member");
    const rows = await tx
      .selectDistinct({ userId: peer.userId })
      .from(chatRooms)
      .innerJoin(
        chatRoomMembers,
        and(
          eq(chatRoomMembers.roomId, chatRooms.id),
          eq(chatRoomMembers.companyId, chatRooms.companyId),
          eq(chatRoomMembers.userId, userId),
          isNull(chatRoomMembers.leftAt),
        ),
      )
      .innerJoin(
        peer,
        and(
          eq(peer.roomId, chatRooms.id),
          eq(peer.companyId, chatRooms.companyId),
          isNull(peer.leftAt),
          ne(peer.userId, userId),
        ),
      )
      .where(
        and(
          eq(chatRooms.companyId, companyId),
          isNull(chatRooms.deletedAt),
          eq(chatRooms.roomType, "direct"),
        ),
      );

    return rows.map((r) => r.userId);
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

  /**
   * S8-CHAT-UX-FE-3 — **ROSTER** của một phòng (CHAT-API-007a · CHAT-DEC-019): thành viên đang hoạt động
   * **VÀ người đã rời** (kèm `leftAt`), thêm ứng viên ảnh đại diện.
   *
   * ⚠️ Đây là hàm DUY NHẤT của repo cố ý KHÔNG lọc `left_at IS NULL`. Mọi vị từ membership khác (cổng
   * quyền, danh sách phòng, `assertMember`) vẫn đòi `left_at IS NULL` — xem `chat-access.service.ts` §85.
   * Roster là đường ĐỌC-ĐỂ-VẼ, không phải đường quyết định quyền: nó chạy SAU `assertMember` của người
   * gọi, và không hàm nào ở đây suy ra membership từ kết quả của nó.
   *
   * `leftJoin` `employee_profiles` theo `(company_id, user_id)` — unique index
   * `employee_profiles_company_user_uq` đảm bảo tối đa một hàng, nên join này KHÔNG nhân bản thành viên.
   * User chưa có hồ sơ nhân viên ⇒ `employeeId = null` ⇒ không có ứng viên ảnh ⇒ chữ cái đầu.
   */
  async listRosterMembers(
    tx: TenantTx,
    companyId: string,
    roomId: string,
  ): Promise<ChatRosterRow[]> {
    const rows = await tx
      .select({
        id: chatRoomMembers.id,
        roomId: chatRoomMembers.roomId,
        userId: chatRoomMembers.userId,
        userName: users.fullName,
        role: chatRoomMembers.role,
        joinedAt: chatRoomMembers.joinedAt,
        lastReadSeq: chatRoomMembers.lastReadSeq,
        leftAt: chatRoomMembers.leftAt,
        employeeId: employeeProfiles.id,
        avatarRaw: employeeProfiles.avatarUrl,
      })
      .from(chatRoomMembers)
      .leftJoin(
        users,
        and(eq(users.id, chatRoomMembers.userId), eq(users.companyId, chatRoomMembers.companyId)),
      )
      .leftJoin(
        employeeProfiles,
        and(
          eq(employeeProfiles.userId, chatRoomMembers.userId),
          eq(employeeProfiles.companyId, chatRoomMembers.companyId),
          // ⚠️ `isNull(deletedAt)` là BẮT BUỘC, không phải vệ sinh. Unique index
          // `employee_profiles_company_user_active_uq` là **PARTIAL** (`WHERE deleted_at IS NULL`), nên
          // một user từng có hồ sơ bị xoá mềm rồi lập lại sẽ có ≥2 hàng khớp ⇒ join NHÂN BẢN thành viên
          // đó trong roster. Triệu chứng ở UI là một người xuất hiện hai lần trong danh sách và hai
          // `<li>` cùng `key` (memory `duplicate-sibling-key-leaks-dom-node`).
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .where(and(eq(chatRoomMembers.companyId, companyId), eq(chatRoomMembers.roomId, roomId)))
      // Người ĐANG ở trong phòng lên trước (roster cũng là danh sách người đọc được), rồi tới thứ tự vào
      // phòng. Không sắp thì thứ tự do planner quyết ⇒ danh sách nhảy lung tung giữa hai lần tải.
      .orderBy(chatRoomMembers.leftAt, chatRoomMembers.joinedAt);
    return rows.map((r) => ({ ...r, role: r.role as ChatMemberRole }));
  }

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

  // ─── S8-CHAT-UX-BE-1: tuỳ chọn per-phòng của CHÍNH actor ─────────────────────
  //
  // Cả ba cột dưới đây (`pinned_at`, `muted_until`, `marked_unread_at`) NẰM TRONG tập 7 cột được
  // `GRANT UPDATE` (mig `0543` khối (E)(1) pin bằng `=`). Thêm cột thứ tư vào các câu `.set()` này mà
  // không có `GRANT UPDATE (cột)` là `42501` LÚC CHẠY — TypeScript và unit test đều mù với nó.
  //
  // MỌI hàm nhận `memberRowId` chứ không `(roomId, userId)`: id đó chỉ có được từ `assertMember`, nên
  // không có đường nào gọi tới đây mà chưa qua điểm khẳng định membership. Vế `company_id` vẫn viết
  // tường minh bên cạnh RLS (CLAUDE.md §2).

  /**
   * Tuần-tự-hoá các thao tác GHIM **của cùng một người** trong phạm vi transaction hiện tại.
   *
   * ┌─ VÌ SAO CẦN KHOÁ, KHI ĐÃ CÓ `countPinnedRooms` NGAY TRƯỚC ĐÓ ─────────────────────────────────┐
   * │ Đếm-rồi-ghi là đường đua kinh điển: hai request song song cùng đọc 9, cùng ghi ⇒ 11.           │
   * │ Và một subquery `count(*) < 10` NHÉT VÀO CHÍNH CÂU UPDATE **cũng không cứu được**: hai          │
   * │ transaction ghi HAI HÀNG KHÁC NHAU nên không đụng khoá hàng nào của nhau, dưới READ COMMITTED   │
   * │ cả hai đều thấy đúng ảnh chụp 9 và cả hai đều ghi. `SELECT … FOR UPDATE` trên tập hàng đang     │
   * │ ghim cũng không đủ: hàng mà bên kia vừa ghim KHÔNG nằm trong tập mình đã chọn để khoá.          │
   * └───────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * `xact`-level (KHÔNG phải session-level) là **bắt buộc** trên PgBouncer transaction-mode: khoá
   * session-level sẽ ở lại trên một kết nối gộp và rò sang request khác. Khoá tự nhả lúc commit/rollback.
   *
   * Khoá theo `companyId:userId` chứ không riêng `userId`: không gian khoá advisory là TOÀN CỤC trong
   * một database (không có RLS, không có tenant) — ghép tenant vào khoá cho đúng ngữ nghĩa "hàng đợi
   * của một người trong một công ty".
   */
  async lockUserPrefs(tx: TenantTx, companyId: string, userId: string): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${ADVISORY_CLASS_CHAT_ROOM_PIN}, hashtext(${companyId}::text || ':' || ${userId}::text))`,
    );
  }

  /**
   * Số hội thoại actor ĐANG ghim. `left_at IS NULL`: phòng đã rời không chiếm suất — nếu không, người
   * dùng mất dần suất ghim mà không có cách nào lấy lại (dòng ghim đó không còn hiện trên UI để bỏ).
   *
   * ⚠️ KHÔNG lọc `chat_rooms.deleted_at`: hàm chỉ đọc `chat_room_members`, thêm JOIN vào đây là đổi ý
   * nghĩa của trần theo một thứ actor không nhìn thấy. Phòng xoá mềm là ca hiếm và tự khỏi khi bỏ ghim.
   */
  async countPinnedRooms(tx: TenantTx, companyId: string, userId: string): Promise<number> {
    const rows = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(chatRoomMembers)
      .where(
        and(
          eq(chatRoomMembers.companyId, companyId),
          eq(chatRoomMembers.userId, userId),
          isNull(chatRoomMembers.leftAt),
          isNotNull(chatRoomMembers.pinnedAt),
        ),
      );
    return rows[0]?.n ?? 0;
  }

  /** Ghim (`pinnedAt = now`) / bỏ ghim (`null`). Trả mốc SAU khi ghi để service khỏi đọc lại. */
  async setRoomPinned(
    tx: TenantTx,
    companyId: string,
    memberRowId: string,
    pinnedAt: Date | null,
  ): Promise<Date | null> {
    const rows = await tx
      .update(chatRoomMembers)
      .set({ pinnedAt })
      .where(and(eq(chatRoomMembers.companyId, companyId), eq(chatRoomMembers.id, memberRowId)))
      .returning({ pinnedAt: chatRoomMembers.pinnedAt });
    return rows[0]?.pinnedAt ?? null;
  }

  /** Tắt thông báo tới `mutedUntil`, hoặc bật lại (`null`). */
  async setRoomMuted(
    tx: TenantTx,
    companyId: string,
    memberRowId: string,
    mutedUntil: Date | null,
  ): Promise<Date | null> {
    const rows = await tx
      .update(chatRoomMembers)
      .set({ mutedUntil })
      .where(and(eq(chatRoomMembers.companyId, companyId), eq(chatRoomMembers.id, memberRowId)))
      .returning({ mutedUntil: chatRoomMembers.mutedUntil });
    return rows[0]?.mutedUntil ?? null;
  }

  /**
   * Đánh dấu chưa đọc thủ công.
   *
   * ⚠️ CHỈ ghi `marked_unread_at`. TUYỆT ĐỐI KHÔNG kèm `lastReadSeq` vào câu `.set()` này: con trỏ đọc
   * là CHỈ-TIẾN (SPEC-15 §13.2 · CHAT-ERR-018) và lùi nó để làm một tính năng tiện sẽ phá phép trừ
   * `unreadSeqExpr()` cùng mọi thứ dựng trên nó (badge header, chat:read, "đã xem bởi").
   */
  async setRoomMarkedUnread(
    tx: TenantTx,
    companyId: string,
    memberRowId: string,
    markedUnreadAt: Date | null,
  ): Promise<Date | null> {
    const rows = await tx
      .update(chatRoomMembers)
      .set({ markedUnreadAt })
      .where(and(eq(chatRoomMembers.companyId, companyId), eq(chatRoomMembers.id, memberRowId)))
      .returning({ markedUnreadAt: chatRoomMembers.markedUnreadAt });
    return rows[0]?.markedUnreadAt ?? null;
  }

  // ─── kiểm tra người dùng ─────────────────────────────────────────────────────

  /**
   * Lọc ra các userId THỰC SỰ dùng được: cùng tenant, chưa xoá mềm, `status='active'`.
   *
   * ┌─ VÌ SAO VẪN KIỂM Ở APP DÙ ĐÃ CÓ RLS + FK (đính chính 2026-08-04, S7-CHAT-CLEAN-2) ────────────────┐
   * │ Bản đầu ghi lý do là "FK `chat_room_members.user_id → users.id` là FK MỘT CỘT nên không chặn được  │
   * │ userId của tenant khác". Lý do đó **ĐÃ CHẾT** từ mig `0535` (S6-SEC-XTENANTFK-1). Đo trên DB:      │
   * │     chat_room_members_user_id_company_fk                                                           │
   * │       FOREIGN KEY (company_id, user_id) REFERENCES users(company_id, id) ON DELETE RESTRICT        │
   * │ cả hai cột NOT NULL ⇒ MATCH SIMPLE không có lối lách; ghi chéo tenant bị chặn ở tầng DB (hành vi   │
   * │ 23503 ghim ở `s7-chat-db1-invariants.int-spec.ts` mục C).                                          │
   * │                                                                                                     │
   * │ HÀM VẪN CẦN, vì hai lý do CÒN SỐNG:                                                                 │
   * │  1. Không ràng buộc nào của DB biết `status`/`deleted_at` — user đã nghỉ việc hay bị khoá vẫn thoả  │
   * │     FK, vẫn được gán vào phòng.                                                                     │
   * │  2. Composite FK chặn bằng cách NÉM 23503 = HTTP 500, sau khi tx đã làm việc. Caller               │
   * │     (`chat-members.service.ts:64` · `chat-rooms.service.ts:226,491`) cần biết TRƯỚC để trả          │
   * │     `CHAT-ERR-003 USER_INVALID` (422) — lỗi nghiệp vụ đọc được, thay vì một 500 vô nghĩa với client.│
   * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
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
