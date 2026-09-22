import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { sql } from "drizzle-orm";
import type {
  CreateFeedGroupDto,
  DecideFeedGroupMemberDto,
  FeedGroupDto,
  FeedGroupMemberMutationDto,
  FeedGroupMemberPageDto,
  FeedGroupPageDto,
  ListFeedGroupMembersQueryDto,
  ListFeedGroupsQueryDto,
  UpdateFeedGroupDto,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { SocialAccessService } from "./social-access.service";
import { bumpGroupMemberCount, groupMemberCountDelta } from "./social-counters";
import { SocialGroupAccessService } from "./social-group-access.service";
import {
  SocialGroupMembersRepository,
  type FeedGroupMemberRow,
} from "./social-group-members.repository";
import { SocialGroupsRepository, type FeedGroupRow } from "./social-groups.repository";
import {
  SOCIAL_EVENT_GROUP_JOIN_DECIDED,
  type SocialGroupJoinDecidedPayload,
} from "./social-noti.payload";
import { SOCIAL_CONSTRAINT, SOCIAL_ERR, isUniqueViolationOf } from "./social.errors";
import type { FeedGroupRole, SocialActor, SocialRequestUser } from "./social.types";

/**
 * S16-SOCIAL-BE-2A — `SOCIAL-API-030..039` (nhóm + thành viên nhóm).
 *
 * Khuôn chung của module (`social-reports.service.ts`), theo ĐÚNG thứ tự này ở mọi route ghi:
 *   1. `access.resolveActor(user, routeKey)` — guard tầng 2, **TRƯỚC** khi mở tx (mỗi lượt hỏi engine
 *      quyền tự mở `withTenant` riêng; hỏi trong tx ghi là lồng transaction ⇒ treo IM LẶNG).
 *   2. `withTenant` → cổng NHÓM (`assertGroupVisibleTx` 404 → `assertGroupRoleTx` 403) → **neo
 *      `lockGroupRowTx`** nếu thao tác có thể lấy đi owner → ghi → bộ đếm → audit → outbox.
 *
 * ┌─ 🔴 BA LUẬT KHÔNG ĐƯỢC ĐỔI THỨ TỰ ────────────────────────────────────────────────────────────┐
 * │ (a) **404 TRƯỚC 403**: hỏi "có thấy nhóm này không" trước "có vai trò không". Ngược lại thì một │
 * │     người ngoài dò được sự tồn tại của nhóm kín qua sự khác nhau giữa 403 và 404.              │
 * │ (b) **`lockGroupRowTx` TRƯỚC mọi câu đếm owner** (D6-ii/C3). Đọc `COUNT` rồi ghi mà không khoá  │
 * │     hàng cha là TOCTOU: hai thao tác đồng thời xoá HAI hàng khác nhau, không đụng khoá nào, và  │
 * │     nhóm rơi về 0 owner — khoá vĩnh viễn. Ca G5d đo đúng chỗ này.                               │
 * │ (c) **Bộ đếm suy từ CHUYỂN TRẠNG THÁI HÀNG THẬT** (`groupMemberCountDelta`), không từ tên       │
 * │     route: mọi lời gọi `bumpGroupMemberCount` ở file này lấy `before`/`after` từ giá trị DB vừa │
 * │     trả về, không từ giả định của người viết route.                                             │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
@Injectable()
export class SocialGroupsService {
  private readonly logger = new Logger(SocialGroupsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly access: SocialAccessService,
    private readonly groupAccess: SocialGroupAccessService,
    private readonly groups: SocialGroupsRepository,
    private readonly members: SocialGroupMembersRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** `030` — `GET /social/groups`. Phạm vi nhìn thấy ép TRONG SQL (xem `listGroups`). */
  async list(user: SocialRequestUser, query: ListFeedGroupsQueryDto): Promise<FeedGroupPageDto> {
    const actor = await this.access.resolveActor(user, "groupsList");
    const { rows, total } = await this.db.withTenant(actor.companyId, (tx) =>
      this.groups.listGroups(tx, actor, query),
    );
    return { data: rows.map(toFeedGroupDto), page: query.page, limit: query.limit, total };
  }

  /**
   * `031` — `POST /social/groups`. Nhóm + hàng `owner`/`active` + `member_count` trong CÙNG tx.
   *
   * 🔴 Vế `+1` của `member_count` nằm ở ĐÂY, không phải ở `035`: nhóm mới đã có MỘT hàng `active`
   * (người tạo). Bỏ nó là bất biến §13.6 vỡ ngay thao tác đầu tiên của vòng đời nhóm.
   */
  async create(user: SocialRequestUser, dto: CreateFeedGroupDto): Promise<FeedGroupDto> {
    const actor = await this.access.resolveActor(user, "groupCreate");

    return this.db.withTenant(actor.companyId, async (tx) => {
      let created: { id: string };
      try {
        created = await this.groups.createGroupTx(tx, actor.companyId, actor.actorUserId, dto);
      } catch (err) {
        // W1 — khớp theo TÊN CONSTRAINT, KHÔNG `23505` trần: `feed_groups` còn
        // `feed_groups_company_id_id_uq` (ống nước FK composite) cũng ném `23505`.
        if (isUniqueViolationOf(err, SOCIAL_CONSTRAINT.GROUP_NAME_UQ)) {
          throw new ConflictException(SOCIAL_ERR.GROUP_NAME_TAKEN);
        }
        throw err;
      }

      await this.members.insertMemberTx(
        tx,
        actor.companyId,
        created.id,
        actor.actorUserId,
        "owner",
        "active",
      );
      await bumpGroupMemberCount(
        tx,
        actor.companyId,
        created.id,
        groupMemberCountDelta(null, "active"),
      );
      // Cùng lý lẽ với `034` ở trên: vòng đời nhóm (sinh · diệt) vào sổ append-only, không phụ
      // thuộc việc actor có đi qua nhánh `manage:feed-group` hay không.
      await this.recordGroupAudit(tx, actor, "social.group.created", created.id, {
        visibility: dto.visibility,
      });
      return this.readGroupDto(tx, actor, created.id);
    });
  }

  /** `032` — `GET /social/groups/{id}`. Nhóm kín + không phải thành viên ⇒ 404 `ERR-012`. */
  async get(user: SocialRequestUser, groupId: string): Promise<FeedGroupDto> {
    const actor = await this.access.resolveActor(user, "groupGet");
    return this.db.withTenant(actor.companyId, async (tx) => {
      await this.groupAccess.assertGroupVisibleTx(tx, actor, groupId);
      return this.readGroupDto(tx, actor, groupId);
    });
  }

  /** `033` — `PATCH /social/groups/{id}`. Vai `owner|admin`, hoặc `manage:feed-group` (+ audit). */
  async update(
    user: SocialRequestUser,
    groupId: string,
    dto: UpdateFeedGroupDto,
  ): Promise<FeedGroupDto> {
    const actor = await this.access.resolveActor(user, "groupUpdate");

    return this.db.withTenant(actor.companyId, async (tx) => {
      await this.groupAccess.assertGroupVisibleTx(tx, actor, groupId);
      const { viaManage } = await this.groupAccess.assertGroupRoleTx(tx, actor, groupId, [
        "owner",
        "admin",
      ]);

      let updated: boolean;
      try {
        updated = await this.groups.updateGroupTx(
          tx,
          actor.companyId,
          groupId,
          actor.actorUserId,
          dto,
        );
      } catch (err) {
        if (isUniqueViolationOf(err, SOCIAL_CONSTRAINT.GROUP_NAME_UQ)) {
          throw new ConflictException(SOCIAL_ERR.GROUP_NAME_TAKEN);
        }
        throw err;
      }
      // 0 hàng ⇒ nhóm vừa bị xoá mềm giữa hai câu. Nói 404, KHÔNG trả về một DTO "đã cập nhật".
      if (!updated) throw new NotFoundException(SOCIAL_ERR.GROUP_NOT_FOUND);

      if (viaManage) {
        await this.recordGroupAudit(tx, actor, "social.group.updated", groupId, {
          // Chỉ TÊN TRƯỜNG đổi — không nội dung (API-19 §8). Đủ để trả lời "ai sửa gì, lúc nào".
          fields: Object.keys(dto).sort(),
          viaManage: true,
        });
      }
      return this.readGroupDto(tx, actor, groupId);
    });
  }

  /**
   * `034` — `DELETE /social/groups/{id}`, xoá MỀM.
   *
   * 🔴 `allowedRoles = ['owner']` MỘT MÌNH (API-19 dòng 102): `admin` nhóm KHÔNG xoá được nhóm.
   * Và route này **KHÔNG** chịu bất biến đếm owner (H7/D6-i) — đọc theo nghĩa đen "sau thao tác nhóm
   * phải còn ≥1 owner" thì xoá nhóm luôn 409, tức một route bất khả thi.
   */
  async remove(user: SocialRequestUser, groupId: string): Promise<{ deleted: true }> {
    const actor = await this.access.resolveActor(user, "groupDelete");

    await this.db.withTenant(actor.companyId, async (tx) => {
      await this.groupAccess.assertGroupVisibleTx(tx, actor, groupId);
      const { viaManage } = await this.groupAccess.assertGroupRoleTx(tx, actor, groupId, ["owner"]);

      const deleted = await this.groups.softDeleteGroupTx(
        tx,
        actor.companyId,
        groupId,
        actor.actorUserId,
      );
      if (!deleted) throw new NotFoundException(SOCIAL_ERR.GROUP_NOT_FOUND);

      // 🔴 Audit LUÔN, không chỉ nhánh `viaManage` (FULL gate 22/09, `security-reviewer` MEDIUM-2).
      // Khuôn "chỉ ghi sổ khi thao tác lên nội dung NGƯỜI KHÁC" mượn từ BE-1, nơi đối tượng là BÀI
      // của chính actor. Nhóm KHÔNG phải nội dung riêng của owner: sau `034`, D13 làm mọi bài trong
      // nhóm biến khỏi feed VÀ khỏi đường tải tệp của TẤT CẢ thành viên. Vết duy nhất còn lại là
      // `feed_groups.deleted_by` — một cột UPDATE được, không phải sổ append-only.
      await this.recordGroupAudit(tx, actor, "social.group.deleted", groupId, { viaManage });
    });
    return { deleted: true };
  }

  /**
   * `035` — `POST /social/groups/{id}/join`. `public` ⇒ `active` ngay; `private` ⇒ `pending`.
   *
   * Cổng là `findLiveGroupTx` (nhóm còn sống), KHÔNG phải cổng ĐỌC — xem docblock của hàm đó: gác
   * bằng cổng đọc làm nhánh `pending` thành code chết.
   */
  async join(user: SocialRequestUser, groupId: string): Promise<FeedGroupDto> {
    const actor = await this.access.resolveActor(user, "groupJoin");

    return this.db.withTenant(actor.companyId, async (tx) => {
      const group = await this.groups.findLiveGroupTx(tx, actor.companyId, groupId);
      if (!group) throw new NotFoundException(SOCIAL_ERR.GROUP_NOT_FOUND);

      // 🔴 THỨ TỰ KHOÁ (FULL gate 22/09, `security-reviewer` LOW-4). Không phải vì bất biến owner —
      // `035` không chạm nó — mà để mọi đường chạm cặp (`feed_groups`, `feed_group_members`) khoá
      // hàng CHA trước, CÙNG một kiểu khoá. Không có neo này, `035` đi đường NÂNG CẤP khoá:
      // `insertMemberTx` lấy `FOR KEY SHARE` trên hàng nhóm (kiểm RI của FK), rồi
      // `bumpGroupMemberCount` đòi khoá GHI trên chính hàng đó. Một `036`/`038`/`039` song song đang
      // xếp hàng chờ `FOR UPDATE` ở giữa hai câu ấy ⇒ chu trình chờ ⇒ deadlock 40P01 ⇒ 500 cho cả
      // hai. Lấy khoá GHI ngay từ đầu thì hai giao dịch chỉ nối đuôi nhau.
      await this.groupAccess.lockGroupRowTx(tx, actor.companyId, groupId);

      const status = group.visibility === "public" ? "active" : "pending";
      try {
        await this.members.insertMemberTx(
          tx,
          actor.companyId,
          groupId,
          actor.actorUserId,
          "member",
          status,
        );
      } catch (err) {
        // H6 — theo TÊN CONSTRAINT (`feed_group_members_pk`), không `23505` trần.
        if (isUniqueViolationOf(err, SOCIAL_CONSTRAINT.GROUP_MEMBER_PK)) {
          throw new ConflictException(SOCIAL_ERR.GROUP_MEMBERSHIP_EXISTS);
        }
        throw err;
      }
      await bumpGroupMemberCount(tx, actor.companyId, groupId, groupMemberCountDelta(null, status));
      return this.readGroupDto(tx, actor, groupId);
    });
  }

  /**
   * `036` — `POST /social/groups/{id}/leave`. Cũng là đường HUỶ một yêu cầu `pending` của chính mình
   * (delta `0` — hàng `pending` chưa từng được đếm).
   */
  async leave(user: SocialRequestUser, groupId: string): Promise<{ left: true }> {
    const actor = await this.access.resolveActor(user, "groupLeave");

    await this.db.withTenant(actor.companyId, async (tx) => {
      const group = await this.groups.findLiveGroupTx(tx, actor.companyId, groupId);
      if (!group) throw new NotFoundException(SOCIAL_ERR.GROUP_NOT_FOUND);

      // (b) — neo TRƯỚC câu đếm owner.
      await this.groupAccess.lockGroupRowTx(tx, actor.companyId, groupId);
      const mine = await this.groupAccess.getMembershipTx(
        tx,
        actor.companyId,
        groupId,
        actor.actorUserId,
      );
      if (!mine) throw new NotFoundException(SOCIAL_ERR.GROUP_MEMBER_NOT_FOUND);
      if (mine.role === "owner" && mine.status === "active") {
        await this.groupAccess.assertOwnerRemainsTx(
          tx,
          actor.companyId,
          groupId,
          actor.actorUserId,
        );
      }

      const removed = await this.members.deleteMemberTx(
        tx,
        actor.companyId,
        groupId,
        actor.actorUserId,
      );
      if (!removed) throw new NotFoundException(SOCIAL_ERR.GROUP_MEMBER_NOT_FOUND);
      await bumpGroupMemberCount(
        tx,
        actor.companyId,
        groupId,
        groupMemberCountDelta(removed.status, null),
      );
    });
    return { left: true };
  }

  /**
   * `037` — `GET /social/groups/{id}/members`.
   *
   * Hai cổng chồng nhau có chủ ý: `assertGroupVisibleTx` (nhóm kín + người ngoài ⇒ **404**, không lộ
   * nhóm tồn tại) rồi `assertGroupRoleTx` với CẢ BA vai (nhóm mở + người ngoài ⇒ **403** — nhóm đã
   * công khai nên 403 không lộ thêm gì, nhưng danh bạ thành viên thì không công khai).
   */
  async listMembers(
    user: SocialRequestUser,
    groupId: string,
    query: ListFeedGroupMembersQueryDto,
  ): Promise<FeedGroupMemberPageDto> {
    const actor = await this.access.resolveActor(user, "groupMembersList");

    const { rows, total } = await this.db.withTenant(actor.companyId, async (tx) => {
      await this.groupAccess.assertGroupVisibleTx(tx, actor, groupId);
      await this.groupAccess.assertGroupRoleTx(tx, actor, groupId, ["owner", "admin", "member"]);
      return this.members.listMembersTx(tx, actor.companyId, groupId, query);
    });
    return { data: rows.map(toFeedGroupMemberDto), page: query.page, limit: query.limit, total };
  }

  /**
   * `038` — `PATCH /social/groups/{id}/members/{uid}`: duyệt · từ chối · đổi vai trò.
   *
   * 🔴 **M-d/G16 — dạng body phải KHỚP TRẠNG THÁI HÀNG, kiểm ở SERVICE.** `{role:'admin'}` trên một
   * hàng `pending` sẽ chạm `chk_feed_group_members_pending_role` ⇒ `23514` ⇒ **500** cho một thao tác
   * quản trị bình thường. Trả 409 `ERR-013` TRƯỚC khi chạm DB.
   *
   * 🔴 **D12 — chỉ `owner` (hoặc `manage:feed-group`) được CẤP vai `owner`.** `admin` đổi được vai
   * trò nhưng không tự nâng mình lên `owner`; nếu nâng được thì cổng owner-only của `034` chỉ còn là
   * hai bước bấm, tức một cổng trang trí.
   */
  async decideMember(
    user: SocialRequestUser,
    groupId: string,
    targetUserId: string,
    dto: DecideFeedGroupMemberDto,
  ): Promise<FeedGroupMemberMutationDto> {
    const actor = await this.access.resolveActor(user, "groupMemberDecide");

    return this.db.withTenant(actor.companyId, async (tx) => {
      const group = await this.groupAccess.assertGroupVisibleTx(tx, actor, groupId);
      const decideRoles: readonly FeedGroupRole[] = ["owner", "admin"];
      const { viaManage } = await this.groupAccess.assertGroupRoleTx(
        tx,
        actor,
        groupId,
        decideRoles,
      );
      await this.groupAccess.lockGroupRowTx(tx, actor.companyId, groupId);

      // 🔴 TOCTOU CỦA CHÍNH ACTOR — `security-reviewer` và `silent-failure-hunter` HỘI TỤ ĐỘC LẬP
      // (FULL gate 22/09). `assertGroupRoleTx` ở trên đọc vai của actor TRƯỚC khi khoá hàng CHA.
      // Dưới READ COMMITTED, một `038`/`039` song song hạ vai (hoặc mời ra) chính actor ĐÚNG trong
      // khoảng giữa hai câu đó vẫn để actor đi tiếp với vai CŨ ⇒ người VỪA mất quyền vẫn phong được
      // `owner` cho người khác (D12 thủng), và người đó xoá được nhóm qua cổng owner-only của `034`.
      // `target` đã đọc lại sau khoá ngay từ bản đầu — vế bỏ sót là chính actor. Đọc lại SAU khoá
      // thì mọi đường đổi vai trò đã bị serialize qua đúng một hàng `feed_groups`.
      const mine = await this.groupAccess.getMembershipTx(
        tx,
        actor.companyId,
        groupId,
        actor.actorUserId,
      );
      if (!viaManage && !(mine?.status === "active" && decideRoles.includes(mine.role))) {
        throw new ForbiddenException(SOCIAL_ERR.GROUP_ROLE_REQUIRED);
      }

      const target = await this.groupAccess.getMembershipTx(
        tx,
        actor.companyId,
        groupId,
        targetUserId,
      );
      if (!target) throw new NotFoundException(SOCIAL_ERR.GROUP_MEMBER_NOT_FOUND);

      if ("decision" in dto) {
        if (target.status !== "pending") {
          throw new ConflictException(SOCIAL_ERR.GROUP_MEMBER_STATE_MISMATCH);
        }
        const result: FeedGroupMemberMutationDto =
          dto.decision === "approve"
            ? await this.approveMember(tx, actor, groupId, targetUserId, target.role)
            : await this.rejectMember(tx, actor, groupId, targetUserId);

        await this.recordGroupAudit(tx, actor, `social.group_member.${dto.decision}`, groupId, {
          targetUserId,
          viaManage,
        });
        await this.enqueueJoinDecidedNoti(tx, actor.companyId, {
          groupId,
          groupName: group.name,
          decision: dto.decision,
          recipientUserId: targetUserId,
        });
        return result;
      }

      // ── Nhánh ĐỔI VAI TRÒ ──
      if (target.status !== "active") {
        throw new ConflictException(SOCIAL_ERR.GROUP_MEMBER_STATE_MISMATCH);
      }
      const actorIsOwner = mine?.status === "active" && mine.role === "owner";
      if (dto.role === "owner" && !actorIsOwner && !viaManage) {
        throw new ForbiddenException(SOCIAL_ERR.GROUP_ROLE_REQUIRED);
      }
      // Hạ vai một owner ⇒ đường MẤT OWNER thứ hai (D6-ii). Neo `FOR UPDATE` đã giữ ở trên.
      if (target.role === "owner" && dto.role !== "owner") {
        await this.groupAccess.assertOwnerRemainsTx(tx, actor.companyId, groupId, targetUserId);
      }

      const changed = await this.members.setRoleTx(
        tx,
        actor.companyId,
        groupId,
        targetUserId,
        dto.role,
      );
      // Hàng vừa đổi trạng thái/biến mất giữa hai câu (dù đã khoá hàng CHA, hàng thành viên vẫn có
      // thể bị xoá bởi chính người đó qua `036`). KHÔNG coi là thành công rỗng.
      if (!changed) throw new ConflictException(SOCIAL_ERR.GROUP_MEMBER_STATE_MISMATCH);
      // delta = 0 (active → active): CỐ Ý không gọi `bumpGroupMemberCount`.

      await this.recordGroupAudit(tx, actor, "social.group_member.role_changed", groupId, {
        targetUserId,
        from: target.role,
        to: dto.role,
        viaManage,
      });
      return { userId: targetUserId, role: dto.role, status: "active" };
    });
  }

  /** `039` — `DELETE …/members/{uid}` (mời ra). Audit LUÔN: thao tác lên người khác. */
  async removeMember(
    user: SocialRequestUser,
    groupId: string,
    targetUserId: string,
  ): Promise<{ deleted: true }> {
    const actor = await this.access.resolveActor(user, "groupMemberRemove");

    await this.db.withTenant(actor.companyId, async (tx) => {
      await this.groupAccess.assertGroupVisibleTx(tx, actor, groupId);
      const { viaManage } = await this.groupAccess.assertGroupRoleTx(tx, actor, groupId, [
        "owner",
        "admin",
      ]);
      await this.groupAccess.lockGroupRowTx(tx, actor.companyId, groupId);

      const target = await this.groupAccess.getMembershipTx(
        tx,
        actor.companyId,
        groupId,
        targetUserId,
      );
      if (!target) throw new NotFoundException(SOCIAL_ERR.GROUP_MEMBER_NOT_FOUND);
      if (target.role === "owner" && target.status === "active") {
        await this.groupAccess.assertOwnerRemainsTx(tx, actor.companyId, groupId, targetUserId);
      }

      const removed = await this.members.deleteMemberTx(tx, actor.companyId, groupId, targetUserId);
      if (!removed) throw new NotFoundException(SOCIAL_ERR.GROUP_MEMBER_NOT_FOUND);
      await bumpGroupMemberCount(
        tx,
        actor.companyId,
        groupId,
        groupMemberCountDelta(removed.status, null),
      );

      await this.recordGroupAudit(tx, actor, "social.group_member.removed", groupId, {
        targetUserId,
        role: removed.role,
        status: removed.status,
        viaManage,
      });
    });
    return { deleted: true };
  }

  // ─────────────────────────────── nội bộ ───────────────────────────────

  /** `pending → active` (+1). `approveTx` mang vế `status='pending'` trong `WHERE` (xem repo). */
  private async approveMember(
    tx: TenantTx,
    actor: SocialActor,
    groupId: string,
    targetUserId: string,
    role: FeedGroupRole,
  ): Promise<FeedGroupMemberMutationDto> {
    const approved = await this.members.approveTx(tx, actor.companyId, groupId, targetUserId);
    if (!approved) throw new ConflictException(SOCIAL_ERR.GROUP_MEMBER_STATE_MISMATCH);
    await bumpGroupMemberCount(
      tx,
      actor.companyId,
      groupId,
      groupMemberCountDelta("pending", "active"),
    );
    return { userId: targetUserId, role, status: "active" };
  }

  /** Từ chối = xoá CỨNG hàng `pending` (DB-17 §4.9). Delta `0` — hàng đó chưa từng được đếm. */
  private async rejectMember(
    tx: TenantTx,
    actor: SocialActor,
    groupId: string,
    targetUserId: string,
  ): Promise<FeedGroupMemberMutationDto> {
    const removed = await this.members.deleteMemberTx(tx, actor.companyId, groupId, targetUserId);
    if (!removed) throw new ConflictException(SOCIAL_ERR.GROUP_MEMBER_STATE_MISMATCH);
    await bumpGroupMemberCount(
      tx,
      actor.companyId,
      groupId,
      groupMemberCountDelta(removed.status, null),
    );
    return { userId: targetUserId, role: null, status: null };
  }

  /** Đọc lại nhóm sau khi ghi — trong CÙNG tx, nên không thể "vừa ghi xong đã mất". */
  private async readGroupDto(
    tx: TenantTx,
    actor: SocialActor,
    groupId: string,
  ): Promise<FeedGroupDto> {
    const row = await this.groups.getGroupTx(tx, actor.companyId, actor.actorUserId, groupId);
    if (!row) throw new NotFoundException(SOCIAL_ERR.GROUP_NOT_FOUND);
    return toFeedGroupDto(row);
  }

  /** Một dòng `audit_logs` cho `object_type='feed_group'` (CHECK `0579`). */
  private async recordGroupAudit(
    tx: TenantTx,
    actor: SocialActor,
    action: string,
    groupId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(tx, {
      action,
      objectType: "feed_group",
      objectId: groupId,
      actorUserId: actor.actorUserId,
      moduleCode: "SOCIAL",
      entityType: "feed_group",
      entityId: groupId,
      resultStatus: "Success",
      metadata: { groupId, ...metadata },
    });
  }

  /**
   * `NOTI-034` — outbox trong CÙNG tx với quyết định.
   *
   * 🔴 **D7 ở đây, không chỉ ở `037`:** người vừa nghỉ việc còn nguyên hàng `feed_group_members`,
   * nên "có hàng" KHÔNG đủ để kết luận "còn nhận thông báo được". Không có người nhận ⇒ **KHÔNG
   * enqueue** (một event với `recipientUserIds: []` sẽ làm registrar ném ở `requireUserIds`, biến
   * một ca bình thường thành dead-letter), và log DEBUG chứ không WARN: đây là trạng thái hợp lệ,
   * không phải sự cố cấu hình như NOTI-036.
   */
  private async enqueueJoinDecidedNoti(
    tx: TenantTx,
    companyId: string,
    ev: {
      groupId: string;
      groupName: string;
      decision: "approve" | "reject";
      recipientUserId: string;
    },
  ): Promise<void> {
    const active = await this.isActiveRecipient(tx, companyId, ev.recipientUserId);
    if (!active) {
      this.logger.debug(
        `NOTI-034: bỏ qua người nhận ${ev.recipientUserId} (không còn là nhân sự đang hoạt động) — nhóm ${ev.groupId}.`,
      );
      return;
    }

    const payload: SocialGroupJoinDecidedPayload = {
      group_id: ev.groupId,
      group_name: ev.groupName,
      decision_label: DECISION_LABEL[ev.decision],
      recipientUserIds: [ev.recipientUserId],
    };
    await this.outbox.enqueue(tx, { eventType: SOCIAL_EVENT_GROUP_JOIN_DECIDED, payload });
  }

  /** Vị từ D7 cho MỘT người — cùng hai vế với `listMembersTx` (một luật, hai chỗ dùng). */
  private async isActiveRecipient(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = await tx.execute<{ ok: number }>(sql`
      SELECT 1 AS ok
        FROM users u
        JOIN employee_profiles ep
          ON ep.company_id = u.company_id AND ep.user_id = u.id
         AND ep.status = 'active' AND ep.deleted_at IS NULL
       WHERE u.company_id = ${companyId} AND u.id = ${userId}
         AND u.deleted_at IS NULL AND u.status = 'active'
       LIMIT 1
    `);
    return rows.rows.length > 0;
  }
}

/**
 * Nhãn ĐÓNG cho biến template `{decision_label}` của `0581`.
 *
 * `Record` trên union ⇒ thêm một nhánh quyết định mà quên nhãn là ĐỎ lúc BIÊN DỊCH, không phải một
 * `{decision_label}` nguyên văn nằm trong tiêu đề thông báo lúc chạy.
 */
const DECISION_LABEL: Record<"approve" | "reject", string> = {
  approve: "duyệt",
  reject: "từ chối",
};

function toFeedGroupDto(row: FeedGroupRow): FeedGroupDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    memberCount: row.memberCount,
    myRole: row.myRole,
    myStatus: (row.myStatus as "active" | "pending" | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toFeedGroupMemberDto(row: FeedGroupMemberRow) {
  return {
    userId: row.userId,
    employeeId: row.employeeId,
    fullName: row.fullName,
    avatarUrl: row.avatarUrl,
    role: row.role,
    status: row.status,
    joinedAt: row.joinedAt ? row.joinedAt.toISOString() : null,
  };
}
