import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import type {
  ChatRoomDetailDto,
  ChatRoomDto,
  CreateChatRoomRequest,
  ListChatRoomsQuery,
  OpenDirectRoomRequest,
  UpdateChatRoomRequest,
} from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { DatabaseService, type TenantTx } from "../db/db.service";
import type { ChatRoomType } from "../db/schema/communication";
import { ChatAccessService } from "./chat-access.service";
import { ChatRoomCodeService } from "./chat-room-code.service";
import { ChatRoomsRepository, type ChatRoomRow } from "./chat-rooms.repository";
import { CHAT_AUDIT, CHAT_ERR, CHAT_MODULE_CODE } from "./chat.errors";
import {
  assertLeavable,
  assertManualEdit,
  assertNotArchived,
  buildDirectKey,
  unreadOf,
} from "./chat-room-rules";
import { toChatRoomDetailDto, toChatRoomDto } from "./chat.mapper";

export interface ChatActor {
  id: string;
  companyId: string;
}

/** `chat_rooms_direct_uq` (mig 0010) — partial unique (company_id, direct_key) WHERE direct_key IS NOT NULL. */
const DIRECT_UNIQUE_CONSTRAINT = "chat_rooms_direct_uq";
const PG_UNIQUE_VIOLATION = "23505";

function isDirectKeyConflict(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown };
  return e.code === PG_UNIQUE_VIOLATION && e.constraint === DIRECT_UNIQUE_CONSTRAINT;
}

/**
 * S7-CHAT-BE-1 — phòng chat (CHAT-API-001..006, 008). Thành viên ở `ChatMembersService`.
 *
 * MỌI đường nhận `roomId` đều đi qua `ChatAccessService.assertMember` — không ngoại lệ, không cờ.
 * Đường đọc-vượt của Super Admin (CHAT-DEC-004) là service + controller RIÊNG ở `S7-CHAT-BE-7`.
 */
@Injectable()
export class ChatRoomsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ChatRoomsRepository,
    private readonly access: ChatAccessService,
    private readonly roomCode: ChatRoomCodeService,
    private readonly audit: AuditService,
  ) {}

  /**
   * CHAT-API-001 — phòng của tôi. Tự-bound theo actor: truy vấn JOIN membership nên không có đường nào
   * nhận roomId từ client, và không cần `assertMember` (không có phòng nào để "vượt").
   *
   * `archived` mặc định **false**: danh sách chính chỉ hiện phòng đang dùng. FE muốn xem kho lưu trữ thì
   * gửi `archived=true`. KHÔNG có chế độ "cả hai" — trộn lẫn làm badge chưa đọc của phòng đã đóng nổi
   * lên đầu danh sách mỗi lần có đồng bộ.
   */
  async listRooms(actor: ChatActor, query: ListChatRoomsQuery): Promise<ChatRoomDto[]> {
    const rows = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.listRoomsForUser(tx, actor.companyId, actor.id, {
        roomType: query.type as ChatRoomType | undefined,
        archived: query.archived ?? false,
      }),
    );
    return rows.map((r) => toChatRoomDto(r));
  }

  /** CHAT-API-004 — chi tiết phòng + thành viên + vai trò của tôi. */
  async getRoom(actor: ChatActor, roomId: string): Promise<ChatRoomDetailDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
      const members = await this.repo.listActiveMembers(tx, actor.companyId, roomId);
      return toChatRoomDetailDto(
        acc.room,
        members,
        acc.membership.role,
        unreadOf(acc.room.lastMessageSeq, acc.membership.lastReadSeq),
      );
    });
  }

  /**
   * CHAT-API-002 — tạo phòng NHÓM. Người tạo tự động là `admin` (nếu không, phòng ra đời đã hỏng: không
   * ai thêm/bớt được thành viên).
   *
   * `roomType` bị Zod khoá `z.literal("group")`; check lại ở đây là defense-in-depth cho đường gọi
   * service từ job/bridge sau này (DTO chỉ gác biên HTTP).
   */
  async createGroup(actor: ChatActor, dto: CreateChatRoomRequest): Promise<ChatRoomDto> {
    if (dto.roomType !== "group") throw new UnprocessableEntityException(CHAT_ERR.CREATE_TYPE);

    // Phase 1 — cấp mã NGOÀI transaction nghiệp vụ: `nextCode` tự mở `withTenant` nên không lồng được.
    // Hệ quả chấp nhận: tx rollback ⇒ mã bị bỏ phí (lỗ số). Counter cần DUY NHẤT, không cần LIÊN TỤC.
    const roomCode = await this.roomCode.allocate(actor.companyId);

    return this.db.withTenant(actor.companyId, async (tx) => {
      const invitees = await this.resolveInvitees(tx, actor, dto.memberUserIds);

      const room = await this.repo.insertRoom(tx, {
        companyId: actor.companyId,
        roomType: "group",
        name: dto.name,
        description: dto.description ?? null,
        roomCode,
        directKey: null,
        createdBy: actor.id,
      });

      await this.repo.insertMember(tx, {
        companyId: actor.companyId,
        roomId: room.id,
        userId: actor.id,
        role: "admin",
        addedBy: actor.id,
      });
      for (const userId of invitees) {
        await this.repo.insertMember(tx, {
          companyId: actor.companyId,
          roomId: room.id,
          userId,
          role: "member",
          addedBy: actor.id,
        });
      }

      await this.audit.record(tx, {
        action: CHAT_AUDIT.ROOM_CREATED,
        objectType: "chat_room",
        objectId: room.id,
        actorUserId: actor.id,
        moduleCode: CHAT_MODULE_CODE,
        resultStatus: "Success",
        // Tên phòng là siêu dữ liệu quản trị, KHÔNG phải nội dung tin nhắn — được phép vào audit.
        newValues: { roomType: "group", name: dto.name, memberCount: invitees.length + 1 },
      });

      return toChatRoomDto(room, 0);
    });
  }

  /**
   * CHAT-API-003 — mở DM, IDEMPOTENT theo `direct_key` (2 userId sort tăng dần, join ':').
   *
   * Ba lớp chống trùng, theo thứ tự rẻ → chắc:
   *   (1) tra `direct_key` TRƯỚC khi cấp mã — mở lại DM cũ không đốt số counter;
   *   (2) tra LẠI trong transaction — bịt khe hở giữa (1) và INSERT;
   *   (3) bắt `23505` của ĐÚNG constraint `chat_rooms_direct_uq` rồi SELECT lại — hai request thật sự
   *       đồng thời thì một bên thua ở DB chứ không đẻ phòng thứ hai.
   * Bắt 23505 phải soi tên constraint: 23505 của constraint KHÁC mà nuốt thành "đã có phòng" là trả về
   * phòng sai trong im lặng.
   */
  async openDirect(actor: ChatActor, dto: OpenDirectRoomRequest): Promise<ChatRoomDto> {
    if (dto.peerUserId === actor.id) {
      throw new UnprocessableEntityException(CHAT_ERR.DIRECT_SELF);
    }
    const directKey = buildDirectKey(actor.id, dto.peerUserId);

    const existing = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.findRoomByDirectKey(tx, actor.companyId, directKey),
    );
    if (existing && !existing.deletedAt) return this.readOwnRoom(actor, existing.id);

    const roomCode = await this.roomCode.allocate(actor.companyId);

    const roomId = await this.db
      .withTenant(actor.companyId, async (tx) => {
        const usable = await this.repo.findUsableUserIds(tx, actor.companyId, [dto.peerUserId]);
        if (!usable.has(dto.peerUserId)) {
          throw new UnprocessableEntityException(CHAT_ERR.USER_INVALID);
        }

        const again = await this.repo.findRoomByDirectKey(tx, actor.companyId, directKey);
        if (again) return this.resurrectDirect(tx, actor, again);

        // KHÔNG bọc try/catch quanh INSERT ở ĐÂY: 23505 làm Postgres abort cả transaction, mọi câu lệnh
        // tiếp theo trong `tx` này đều trả 25P02. Phải để lỗi thoát ra ngoài `withTenant` (transaction
        // rollback xong) rồi mới SELECT lại — xem `.catch` bên dưới.
        const room = await this.repo.insertRoom(tx, {
          companyId: actor.companyId,
          roomType: "direct",
          // Phòng `direct` KHÔNG có tên (mig 0538 DROP NOT NULL) — client dựng từ tên 2 người.
          name: null,
          description: null,
          roomCode,
          directKey,
          createdBy: actor.id,
        });
        for (const userId of [actor.id, dto.peerUserId]) {
          await this.repo.insertMember(tx, {
            companyId: actor.companyId,
            roomId: room.id,
            userId,
            role: "member",
            addedBy: actor.id,
          });
        }
        await this.audit.record(tx, {
          action: CHAT_AUDIT.ROOM_DIRECT_OPENED,
          objectType: "chat_room",
          objectId: room.id,
          actorUserId: actor.id,
          moduleCode: CHAT_MODULE_CODE,
          resultStatus: "Success",
          newValues: { roomType: "direct", peerUserId: dto.peerUserId },
        });
        return room.id;
      })
      .catch(async (err: unknown) => {
        if (!isDirectKeyConflict(err)) throw err;
        const raced = await this.db.withTenant(actor.companyId, (tx) =>
          this.repo.findRoomByDirectKey(tx, actor.companyId, directKey),
        );
        if (!raced) throw err;
        return raced.id;
      });

    return this.readOwnRoom(actor, roomId);
  }

  /** CHAT-API-005 — đổi tên/mô tả. Chỉ phòng `group`, chỉ admin phòng, chỉ khi chưa lưu trữ. */
  async updateRoom(
    actor: ChatActor,
    roomId: string,
    dto: UpdateChatRoomRequest,
  ): Promise<ChatRoomDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      // THỨ TỰ: membership (404) → loại phòng (422) → vai trò admin (403) → lưu trữ (422). Loại phòng
      // đứng trước vai trò vì phòng `direct` không có admin nào — xếp sau thì đổi tên DM ra 403 thay vì
      // CHAT-ERR-012. Xem ghi chú đầy đủ ở `ChatMembersService.assertRoomAdminForWrite`.
      const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
      assertManualEdit(acc.room);
      this.access.requireRoomAdmin(acc);
      assertNotArchived(acc.room);

      const patch: { name?: string; description?: string | null } = {};
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.description !== undefined) patch.description = dto.description ?? null;

      const updated = await this.repo.updateRoom(tx, actor.companyId, roomId, patch, actor.id);
      await this.audit.record(tx, {
        action: CHAT_AUDIT.ROOM_UPDATED,
        objectType: "chat_room",
        objectId: roomId,
        actorUserId: actor.id,
        moduleCode: CHAT_MODULE_CODE,
        resultStatus: "Success",
        oldValues: { name: acc.room.name, description: acc.room.description },
        newValues: { name: updated.name, description: updated.description },
      });
      return toChatRoomDto(updated, unreadOf(updated.lastMessageSeq, acc.membership.lastReadSeq));
    });
  }

  /** CHAT-API-006 — lưu trữ phòng nhóm (sau đó CHỈ ĐỌC). */
  async archiveRoom(actor: ChatActor, roomId: string): Promise<ChatRoomDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
      assertManualEdit(acc.room);
      this.access.requireRoomAdmin(acc);
      if (acc.room.isArchived) {
        throw new UnprocessableEntityException(CHAT_ERR.ALREADY_ARCHIVED);
      }

      const updated = await this.repo.archiveRoom(tx, actor.companyId, roomId, actor.id);
      await this.audit.record(tx, {
        action: CHAT_AUDIT.ROOM_ARCHIVED,
        objectType: "chat_room",
        objectId: roomId,
        actorUserId: actor.id,
        moduleCode: CHAT_MODULE_CODE,
        resultStatus: "Success",
        oldValues: { isArchived: false },
        newValues: { isArchived: true },
      });
      return toChatRoomDto(updated, unreadOf(updated.lastMessageSeq, acc.membership.lastReadSeq));
    });
  }

  /**
   * CHAT-API-008 — tự rời phòng. Chỉ phòng `group` (CHAT-ERR-013).
   *
   * CỐ Ý cho phép rời phòng ĐÃ LƯU TRỮ (xem `assertNotArchived`): mọi đường ghi thành viên khác đã bị
   * khoá ở phòng lưu trữ, nên chặn nốt lối này là nhốt người dùng vĩnh viễn.
   *
   * Admin CUỐI CÙNG không rời được khi phòng còn người khác (CHAT-ERR-011) — phòng nhóm không admin thì
   * không ai thêm/bớt được nữa, không có đường sửa qua API. Là người cuối cùng thì rời tự do.
   */
  async leaveRoom(actor: ChatActor, roomId: string): Promise<{ left: true }> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
      assertLeavable(acc.room);

      const counts = await this.repo.countActiveMembers(tx, actor.companyId, roomId);
      if (acc.membership.role === "admin" && counts.admins === 1 && counts.total > 1) {
        throw new UnprocessableEntityException(CHAT_ERR.LAST_ADMIN);
      }

      await this.repo.setMemberLeft(tx, actor.companyId, acc.membership.id);
      await this.audit.record(tx, {
        action: CHAT_AUDIT.ROOM_LEFT,
        objectType: "chat_room",
        objectId: roomId,
        actorUserId: actor.id,
        moduleCode: CHAT_MODULE_CODE,
        resultStatus: "Success",
        newValues: { userId: actor.id },
      });
      return { left: true as const };
    });
  }

  // ─── nội bộ ──────────────────────────────────────────────────────────────────

  /** Đọc lại một phòng CỦA CHÍNH actor — vẫn đi qua `assertMember`, không có lối tắt. */
  private async readOwnRoom(actor: ChatActor, roomId: string): Promise<ChatRoomDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
      return toChatRoomDto(acc.room, unreadOf(acc.room.lastMessageSeq, acc.membership.lastReadSeq));
    });
  }

  /**
   * DM đã bị xoá mềm: bỏ tombstone thay vì tạo phòng thứ hai. `chat_rooms_direct_uq` phủ CẢ hàng đã xoá
   * mềm, nên không bỏ tombstone thì cặp người đó KHÔNG BAO GIỜ mở lại được DM — chỉ nhận 23505.
   * (v1 chưa có endpoint nào xoá mềm phòng; nhánh này là lưới cho `S7-CHAT-BE-5`/job dọn về sau.)
   */
  private async resurrectDirect(
    tx: TenantTx,
    actor: ChatActor,
    room: ChatRoomRow,
  ): Promise<string> {
    if (room.deletedAt) {
      await this.repo.restoreRoom(tx, actor.companyId, room.id);
    }
    for (const userId of [actor.id, ...this.peerOf(room, actor)]) {
      const existing = await this.repo.findMemberRow(tx, actor.companyId, room.id, userId);
      if (!existing) {
        await this.repo.insertMember(tx, {
          companyId: actor.companyId,
          roomId: room.id,
          userId,
          role: "member",
          addedBy: actor.id,
        });
      } else if (existing.leftAt) {
        await this.repo.reactivateMember(tx, actor.companyId, existing.id, existing.role);
      }
    }
    return room.id;
  }

  /** Người còn lại của một DM, suy từ `direct_key` — KHÔNG query thêm. */
  private peerOf(room: ChatRoomRow, actor: ChatActor): string[] {
    const parts = (room.directKey ?? "").split(":").filter((p) => p && p !== actor.id);
    return parts;
  }

  /**
   * Lọc danh sách mời của phòng nhóm: bỏ trùng, bỏ chính actor (đã là admin), và ép MỌI id còn lại phải
   * là tài khoản dùng được TRONG CÙNG tenant.
   *
   * Bỏ kiểm này là nhận userId của tenant khác: FK `user_id → users.id` là FK MỘT CỘT, mà kiểm tra FK
   * của Postgres BỎ QUA RLS theo thiết kế ⇒ hàng membership chéo tenant chèn LỌT.
   */
  private async resolveInvitees(
    tx: TenantTx,
    actor: ChatActor,
    memberUserIds: string[],
  ): Promise<string[]> {
    const wanted = [...new Set(memberUserIds)].filter((id) => id !== actor.id);
    if (wanted.length === 0) return [];
    const usable = await this.repo.findUsableUserIds(tx, actor.companyId, wanted);
    if (usable.size !== wanted.length) {
      throw new UnprocessableEntityException(CHAT_ERR.USER_INVALID);
    }
    return wanted;
  }
}
