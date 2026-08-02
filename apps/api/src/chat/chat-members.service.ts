import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import type {
  AddChatMemberRequest,
  ChatRoomMemberDto,
  UpdateChatMemberRequest,
} from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { ChatAccessService, type ChatRoomAccess } from "./chat-access.service";
import { ChatRoomsRepository } from "./chat-rooms.repository";
import { CHAT_AUDIT, CHAT_ERR, CHAT_MODULE_CODE } from "./chat.errors";
import { assertManualMembership, assertNotArchived } from "./chat-room-rules";
import { toChatMemberDto } from "./chat.mapper";
import type { ChatActor } from "./chat-rooms.service";

/**
 * S7-CHAT-BE-1 — thành viên phòng (CHAT-API-007a..d).
 *
 * MỌI method đi qua `ChatAccessService.assertMember` TRƯỚC mọi thứ khác — kể cả method chỉ ĐỌC. Không
 * method nào nhận `roomId` mà bỏ qua bước đó.
 *
 * Ba luật nghiệp vụ được ép ở đây (SPEC-15 §12):
 *   • CHAT-ERR-012 — thao tác thành viên thủ công CHỈ ở phòng `group`;
 *   • CHAT-ERR-011 — không bỏ/hạ cấp admin CUỐI CÙNG khi phòng còn người khác;
 *   • CHAT-ERR-005 — phòng đã lưu trữ thì chỉ đọc.
 */
@Injectable()
export class ChatMembersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ChatRoomsRepository,
    private readonly access: ChatAccessService,
    private readonly audit: AuditService,
  ) {}

  /** CHAT-API-007a — thành viên đang hoạt động + `lastReadSeq` (dựng "đã xem bởi"). */
  async listMembers(actor: ChatActor, roomId: string): Promise<ChatRoomMemberDto[]> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
      const rows = await this.repo.listActiveMembers(tx, actor.companyId, roomId);
      return rows.map(toChatMemberDto);
    });
  }

  /**
   * CHAT-API-007b — thêm thành viên.
   *
   * Người đã RỜI phòng thì tái dùng ĐÚNG hàng cũ (`left_at = NULL`) — unique `(room_id, user_id)` còn
   * nguyên nên INSERT hàng thứ hai là `23505`. `joined_at` GIỮ NGUYÊN: cột đó ngoài tập 6 cột
   * UPDATE-được của `chat_room_members` (42501 lúc chạy), và giữ nguyên cũng đúng ngữ nghĩa "từng ở đây"
   * của SPEC-15 §13.3.
   */
  async addMember(
    actor: ChatActor,
    roomId: string,
    dto: AddChatMemberRequest,
  ): Promise<ChatRoomMemberDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      await this.assertRoomAdminForWrite(tx, actor, roomId);

      const usable = await this.repo.findUsableUserIds(tx, actor.companyId, [dto.userId]);
      if (!usable.has(dto.userId)) {
        throw new UnprocessableEntityException(CHAT_ERR.USER_INVALID);
      }

      const existing = await this.repo.findMemberRow(tx, actor.companyId, roomId, dto.userId);
      if (existing && !existing.leftAt) {
        throw new UnprocessableEntityException(CHAT_ERR.MEMBER_EXISTS);
      }
      if (existing) {
        await this.repo.reactivateMember(tx, actor.companyId, existing.id, dto.role);
      } else {
        await this.repo.insertMember(tx, {
          companyId: actor.companyId,
          roomId,
          userId: dto.userId,
          role: dto.role,
          addedBy: actor.id,
        });
      }

      await this.audit.record(tx, {
        action: CHAT_AUDIT.MEMBER_ADDED,
        objectType: "chat_room",
        objectId: roomId,
        actorUserId: actor.id,
        moduleCode: CHAT_MODULE_CODE,
        resultStatus: "Success",
        newValues: { userId: dto.userId, role: dto.role, rejoined: Boolean(existing) },
      });

      return this.readMemberDto(tx, actor, roomId, dto.userId);
    });
  }

  /**
   * CHAT-API-007c — phong/hạ vai trò.
   *
   * Hạ chính admin CUỐI CÙNG xuống `member` bị chặn bằng CÙNG luật với việc bớt họ ra (CHAT-ERR-011):
   * hai đường khác nhau dẫn tới cùng một phòng nhóm không còn ai quản trị được.
   */
  async updateMemberRole(
    actor: ChatActor,
    roomId: string,
    targetUserId: string,
    dto: UpdateChatMemberRequest,
  ): Promise<ChatRoomMemberDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      await this.assertRoomAdminForWrite(tx, actor, roomId);

      const target = await this.repo.findMemberRow(tx, actor.companyId, roomId, targetUserId);
      // 422 (không phải 404) là ĐÚNG ở đây và KHÔNG rò gì: người gọi đã qua `assertMember` + là admin
      // phòng, nên họ đọc được danh sách thành viên bằng CHAT-API-007a. Không có sự tồn tại nào để dò.
      if (!target || target.leftAt) throw new UnprocessableEntityException(CHAT_ERR.USER_INVALID);

      if (target.role === "admin" && dto.role !== "admin") {
        await this.assertNotLastAdmin(tx, actor, roomId);
      }

      await this.repo.setMemberRole(tx, actor.companyId, target.id, dto.role);
      await this.audit.record(tx, {
        action: CHAT_AUDIT.MEMBER_ROLE_CHANGED,
        objectType: "chat_room",
        objectId: roomId,
        actorUserId: actor.id,
        moduleCode: CHAT_MODULE_CODE,
        resultStatus: "Success",
        oldValues: { userId: targetUserId, role: target.role },
        newValues: { userId: targetUserId, role: dto.role },
      });

      return this.readMemberDto(tx, actor, roomId, targetUserId);
    });
  }

  /** CHAT-API-007d — bớt thành viên = SET `left_at` (DELETE đã REVOKE ở `0538`). */
  async removeMember(
    actor: ChatActor,
    roomId: string,
    targetUserId: string,
  ): Promise<{ removed: true }> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      await this.assertRoomAdminForWrite(tx, actor, roomId);

      const target = await this.repo.findMemberRow(tx, actor.companyId, roomId, targetUserId);
      if (!target || target.leftAt) throw new UnprocessableEntityException(CHAT_ERR.USER_INVALID);

      if (target.role === "admin") {
        await this.assertNotLastAdmin(tx, actor, roomId);
      }

      await this.repo.setMemberLeft(tx, actor.companyId, target.id);
      await this.audit.record(tx, {
        action: CHAT_AUDIT.MEMBER_REMOVED,
        objectType: "chat_room",
        objectId: roomId,
        actorUserId: actor.id,
        moduleCode: CHAT_MODULE_CODE,
        resultStatus: "Success",
        oldValues: { userId: targetUserId, role: target.role },
      });
      return { removed: true as const };
    });
  }

  // ─── nội bộ ──────────────────────────────────────────────────────────────────

  /**
   * Cổng chung của 3 đường GHI thành viên. THỨ TỰ CỐ ĐỊNH, mỗi bước có lý do riêng:
   *
   *   1. `assertMember`          → 404  — phải ĐỨNG ĐẦU. Kiểm bất cứ thứ gì trước nó là trả lời câu hỏi
   *                                      "phòng này có tồn tại / thuộc loại nào" cho người ngoài phòng,
   *                                      đúng oracle mà CHAT-ERR-001 dựng 404 để chặn.
   *   2. `assertManualMembership`→ 422  — CHAT-ERR-012. ĐỨNG TRƯỚC bước vai trò: phòng `direct` KHÔNG có
   *                                      thành viên nào mang vai trò `admin`, nên xếp sau thì mọi thao
   *                                      tác trên DM đều ra 403 "bạn không phải quản trị phòng" — câu trả
   *                                      lời SAI về mặt nghiệp vụ (không ai làm admin DM được cả) và giấu
   *                                      mất mã lỗi mà SPEC-15 §12 chỉ định.
   *   3. `requireRoomAdmin`      → 403  — actor đã là thành viên nên không giấu gì thêm.
   *   4. `assertNotArchived`     → 422  — CHAT-ERR-005, phòng lưu trữ chỉ đọc.
   */
  private async assertRoomAdminForWrite(
    tx: TenantTx,
    actor: ChatActor,
    roomId: string,
  ): Promise<ChatRoomAccess> {
    const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
    assertManualMembership(acc.room);
    this.access.requireRoomAdmin(acc);
    assertNotArchived(acc.room);
    return acc;
  }

  /** CHAT-ERR-011 — phòng còn người khác thì phải còn ít nhất một admin. */
  private async assertNotLastAdmin(tx: TenantTx, actor: ChatActor, roomId: string): Promise<void> {
    const counts = await this.repo.countActiveMembers(tx, actor.companyId, roomId);
    if (counts.admins === 1 && counts.total > 1) {
      throw new UnprocessableEntityException(CHAT_ERR.LAST_ADMIN);
    }
  }

  /** Đọc lại hàng vừa ghi để trả DTO đầy đủ (tên hiển thị + `lastReadSeq`) — trong CÙNG tx. */
  private async readMemberDto(
    tx: TenantTx,
    actor: ChatActor,
    roomId: string,
    userId: string,
  ): Promise<ChatRoomMemberDto> {
    const rows = await this.repo.listActiveMembers(tx, actor.companyId, roomId);
    const row = rows.find((r) => r.userId === userId);
    if (!row) throw new UnprocessableEntityException(CHAT_ERR.USER_INVALID);
    return toChatMemberDto(row);
  }
}
