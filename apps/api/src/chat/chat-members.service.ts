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
import { toChatMemberDto, toChatRosterMemberDto } from "./chat.mapper";
import { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import { AvatarPresignService } from "../foundation/files/avatar-presign.service";
import { ChatPresenceReaderService } from "../realtime/chat-presence-reader.service";
import { ChatCallRoomExitService } from "./chat-call-room-exit.service";
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
    // S7-CHAT-RT-1 (additive) — emit SAU commit; KHÔNG gọi bên trong `withTenant`.
    private readonly realtime: RealtimeEmitterService,
    // S8-CHAT-UX-FE-3 (additive) — ký avatar người gửi theo LÔ (CHAT-DEC-019) + ảnh chụp "đang online".
    private readonly avatarPresign: AvatarPresignService,
    private readonly presence: ChatPresenceReaderService,
    // ⚠️ S7-CALL-RT-FIX-2 (additive) — **PHẢI Ở CUỐI**. Ba spec dựng service này bằng THỨ TỰ THAM SỐ
    // (`chat-realtime-after-commit.spec.ts`, `chat-roster.service.spec.ts`); chèn vào giữa làm chúng đỏ
    // với thông báo khó hiểu ở một file cách xa chỗ sửa.
    private readonly callExit: ChatCallRoomExitService,
  ) {}

  /**
   * CHAT-API-007a — **ROSTER** của phòng (S8-CHAT-UX-FE-3 · CHAT-DEC-019 · API-13 §5.1).
   *
   * Trả về thành viên đang hoạt động **VÀ người đã rời** (kèm `leftAt`), mỗi người kèm `avatarUrl` đã ký
   * và `isOnline`. Đây là nguồn DUY NHẤT để FE vẽ avatar + tên người gửi trong khung chat.
   *
   * ⚠️ **Ký MỘT LÔ cho cả phòng, không ký theo từng tin.** 50 tin = 50 lần ký + 50 hạn lệch nhau
   * (CHAT-DEC-019) — và mỗi lần ký còn là một lần ghi `file_access_logs` ở những đường có bật.
   *
   * Thứ tự các bước KHÔNG tuỳ tiện:
   *   1. `assertMember` — người ngoài phòng nhận **404** trước khi chạm bất cứ dữ liệu nào (CHAT-ERR-001
   *      giữ tính không-dò-được: không phân biệt "phòng không tồn tại" với "phòng không thuộc về bạn");
   *   2. đọc roster + ký avatar **TRONG** `tx` của caller (`resolveEmployeeAvatars` nhận `callerTx` đúng
   *      để tránh mở `withTenant` LỒNG NHAU — nested-tx treo trên PgBouncer transaction-mode);
   *   3. presence đọc **NGOÀI** `withTenant`: nó đi Valkey chứ không đi DB, giữ transaction mở trong lúc
   *      chờ I/O mạng của một hệ khác là cách chiếm kết nối pool vô cớ.
   */
  async listMembers(actor: ChatActor, roomId: string): Promise<ChatRoomMemberDto[]> {
    const { rows, avatarByEmployee } = await this.db.withTenant(actor.companyId, async (tx) => {
      await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
      const roster = await this.repo.listRosterMembers(tx, actor.companyId, roomId);
      // Nghĩa vụ caller đã thoả: `assertMember` ngay trên là điểm khẳng định membership. Avatar là
      // DIRECTORY-CLASS (cùng lớp mà HR read / org-chart / bảng công việc đang dùng): ai đọc được roster
      // thì thấy ảnh. Roster này VỐN ĐÃ trả `userName` (họ tên đầy đủ) cho mọi thành viên từ S7, nên thêm
      // ảnh KHÔNG mở rộng tập người được biết — không cặp quyền mới, không đường tải mới.
      const avatars = await this.avatarPresign.resolveEmployeeAvatars(
        actor.companyId,
        roster
          .filter((r): r is typeof r & { employeeId: string } => r.employeeId !== null)
          .map((r) => ({ employeeId: r.employeeId, avatarUrl: r.avatarRaw })),
        tx,
      );
      return { rows: roster, avatarByEmployee: avatars };
    });

    const onlineUserIds = new Set(
      await this.presence.getOnlineUserIds(
        actor.companyId,
        rows.map((r) => r.userId),
      ),
    );

    return rows.map((row) =>
      toChatRosterMemberDto(
        row,
        row.employeeId === null ? null : (avatarByEmployee.get(row.employeeId) ?? null),
        onlineUserIds.has(row.userId),
      ),
    );
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
    const added = await this.db.withTenant(actor.companyId, async (tx) => {
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

    // SAU commit. Người vừa được thêm CHƯA ở trong `chatRoomName` ⇒ phải nhắm thêm `chatUserRoomName`
    // của họ, nếu không họ chỉ biết mình được thêm sau lần reconnect kế tiếp.
    this.emitRoomEvent(actor, roomId, "member_added", [dto.userId], {
      userId: dto.userId,
      action: "join",
    });
    return added;
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
    const changed = await this.db.withTenant(actor.companyId, async (tx) => {
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

    // SAU commit. KHÔNG `syncRoomMembership`: đổi VAI TRÒ không đổi tư cách thành viên phòng — người đó
    // đã ở trong `chatRoomName` và phải ở nguyên đó.
    this.emitRoomEvent(actor, roomId, "member_role_changed", [targetUserId]);
    return changed;
  }

  /** CHAT-API-007d — bớt thành viên = SET `left_at` (DELETE đã REVOKE ở `0538`). */
  async removeMember(
    actor: ChatActor,
    roomId: string,
    targetUserId: string,
  ): Promise<{ removed: true }> {
    const result = await this.db.withTenant(actor.companyId, async (tx) => {
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

      // S7-CALL-RT-FIX-2 — TRONG tx: gỡ khỏi phòng phải đóng luôn phần tham gia cuộc gọi đang sống của
      // họ, nếu không họ VẪN nhận relay SDP/ICE (chiều rò). Cùng tx ⇒ rollback thì không có trạng thái
      // "đã đóng cuộc gọi nhưng vẫn là thành viên phòng".
      const closed = await this.callExit.closeCallParticipationOnRoomExit(
        tx,
        actor.companyId,
        roomId,
        targetUserId,
        actor.id,
        new Date(),
      );
      // Evict cũng TRONG tx (vế AN NINH — xem docblock `evictFromCallRoom`): đặt sau commit là để hở
      // đúng cửa sổ `media-state`/`screen-state` mà bản vá dựng ra để đóng.
      for (const { callId } of closed) {
        this.realtime.evictFromCallRoom(actor.companyId, callId, targetUserId);
      }
      return { removed: true as const, closedCallIds: closed.map((c) => c.callId) };
    });

    // SAU commit. Người bị gỡ nhận `chat:room{member_removed}` qua `chatUserRoomName` của họ (đích
    // `chatRoomName` không tới được nữa sau `socketsLeave`), rồi bị đá khỏi room chat NGAY — không đợi
    // reconnect. Đây là nửa NHẠY CẢM AN NINH của WO: sót nó là tin tiếp theo vẫn tới người vừa bị gỡ.
    this.emitRoomEvent(actor, roomId, "member_removed", [targetUserId], {
      userId: targetUserId,
      action: "leave",
    });
    // SAU commit — ngược chiều với `evictFromCallRoom` ở trên, CÓ CHỦ ĐÍCH: phát `peer-left` trước commit
    // rồi rollback là nói dối với người còn lại (họ phá `RTCPeerConnection` cho một người chưa hề rời).
    for (const callId of result.closedCallIds) {
      // 🔴 Evict LẦN HAI — đóng CỬA SỔ REJOIN. Vế trong-tx ở trên một mình là CHƯA ĐỦ: giữa lúc nó chạy
      // và lúc COMMIT, một tx khác (gateway xử `call:join`) đọc ở READ COMMITTED nên CHƯA thấy `left_at`
      // / `outcome` mới ⇒ join được chấp nhận và `socketsJoin` đưa socket nạn nhân TRỞ LẠI
      // `callRoomName`. Không có lần evict thứ hai thì kênh `media-state`/`screen-state` mở lại và ở
      // nguyên đó tới khi socket rớt — đúng chiều rò mà WO này dựng ra để đóng.
      // `socketsLeave` idempotent nên gọi thừa là vô hại. Chạy TRƯỚC `emitCallPeerLeft` để một socket
      // vừa lọt vào không kịp nhận thêm khung nào.
      //
      // ⚠️ KHÔNG bằng 0: một `call:join` đọc DB TRƯỚC commit nhưng chạy `socketsJoin` SAU lần evict này
      // thì vẫn lọt. Cửa sổ hẹp hơn hẳn (chỉ còn phần giao của hai thao tác realtime, thay vì cả đoạn
      // tx), nhưng đóng HẲN thì phải khoá hàng participant ở đường join — ngoài phạm vi WO này.
      this.realtime.evictFromCallRoom(actor.companyId, callId, targetUserId);
      this.realtime.emitCallPeerLeft(actor.companyId, callId, targetUserId);
    }
    return { removed: true };
  }

  // ─── nội bộ ──────────────────────────────────────────────────────────────────

  /** S7-CHAT-RT-1 — phát `chat:room` (+ ép join/leave nếu có). GỌI SAU KHI tx đã commit. */
  private emitRoomEvent(
    actor: ChatActor,
    roomId: string,
    action: "member_added" | "member_removed" | "member_role_changed",
    affectedUserIds: readonly string[],
    membership?: { userId: string; action: "join" | "leave" },
  ): void {
    // `room` để trống cho nhóm action về thành viên: siêu dữ liệu phòng không đổi, client tự refetch
    // danh sách thành viên nếu đang mở panel đó.
    this.realtime.emitChatRoom(actor.companyId, roomId, { roomId, action }, affectedUserIds);
    if (membership) {
      this.realtime.syncRoomMembership(
        actor.companyId,
        roomId,
        membership.userId,
        membership.action,
      );
    }
  }

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
