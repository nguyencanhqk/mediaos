import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateKudosBadgeDto,
  KudosBadgeAdminDto,
  KudosBadgeAdminPageDto,
  UpdateKudosBadgeDto,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { SocialAccessService } from "./social-access.service";
import {
  createBadgeTx,
  deactivateBadgeTx,
  findBadgeTx,
  listBadgesAdminTx,
  SocialKudosRepository,
  updateBadgeTx,
  type KudosBadgeAdminRow,
  type KudosBadgePatch,
} from "./social-kudos.repository";
import { SOCIAL_CONSTRAINT, SOCIAL_ERR, isUniqueViolationOf, socialError } from "./social.errors";
import type { SocialActor, SocialRequestUser } from "./social.types";

/** Trường `050` sửa được — thứ tự cố định để `changes` của audit ổn định. */
const BADGE_PATCH_FIELDS = ["name", "description", "icon", "position", "isActive"] as const;

function toBadgeAdminDto(r: KudosBadgeAdminRow): KudosBadgeAdminDto {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    icon: r.icon,
    position: r.position,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * Tách PATCH thành (a) các trường THẬT SỰ đổi so với hàng hiện tại và (b) `{from, to}` cho audit.
 * Trường vắng (`undefined`) = không đụng; `null` ở `description`/`icon` = xoá giá trị (đổi thật nếu cũ
 * khác `null`). Trả object MỚI, không sửa `dto`/`current`.
 */
function diffBadge(current: KudosBadgeAdminRow, dto: UpdateKudosBadgeDto) {
  const changed = BADGE_PATCH_FIELDS.filter(
    (key) => dto[key] !== undefined && dto[key] !== current[key],
  );
  const patch: KudosBadgePatch = Object.fromEntries(changed.map((k) => [k, dto[k]]));
  // `description` là chữ tự do (≤1000) ⇒ audit chỉ ghi CỜ đổi, không chép văn bản (API-19 §8 «id +
  // trường đổi»; FULL gate security LOW). Các trường còn lại ngắn, có cấu trúc ⇒ giữ `{from, to}`.
  const changes = Object.fromEntries(
    changed.map((k) => [k, k === "description" ? { changed: true } : { from: current[k], to: dto[k] }]),
  ) as Record<string, unknown>;
  return { patch, changes, isNoop: changed.length === 0 };
}

/**
 * S16-SOCIAL-BE-2B-2 — `SOCIAL-API-047` (vinh danh) · `048` (catalog huy hiệu ĐANG BẬT).
 *
 * Hai route ĐỌC, cả hai gác `view:feed` ở tầng 1. Vế phân quyền thật của `047` nằm ở tầng 2 và nằm
 * TRONG SQL: `visiblePostCondition` — vinh danh thừa hưởng phạm vi BÀI CHA. `048` không JOIN bài nào
 * (catalog là dữ liệu cấu hình cấp công ty).
 *
 * **S16-SOCIAL-BE-3A** — CRUD catalog `049` (tạo) · `050` (sửa/bật lại) · `051` (tắt) + đọc quản trị
 * `056` (CẢ huy hiệu đã tắt, SOC-DEC-012). Cả bốn cặp `manage:feed-kudos` (sàn Company). Catalog là
 * dữ liệu cấp CÔNG TY: không vị từ hàng nào ngoài `company_id`. Audit `feed_kudos_badge` ghi CÙNG tx
 * với thay đổi, CHỈ khi có thay đổi thật (lượt lặp / không-đổi ⇒ 200, không audit).
 *
 * ⚠️ Huy hiệu HỆ THỐNG (5 mã seed `0582`) KHÔNG được đối xử riêng (D11): tắt qua `051`, bật lại qua
 * `050 {isActive:true}`. Tắt KHÔNG ảnh hưởng vinh danh cũ (D13 — `047` LEFT JOIN); chỉ chặn chọn mới
 * (ERR-022, `assertActiveBadgeTx`).
 */
@Injectable()
export class SocialKudosService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: SocialAccessService,
    private readonly repo: SocialKudosRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * `047` — `GET /social/kudos`. Envelope OFFSET `{data, page, limit, total}` (API-19 §6.4).
   *
   * MỘT tx cho cả hai câu (danh sách + người nhận): `recipientsOfTx` lọc theo đúng tập `kudosId` mà
   * câu thứ nhất VỪA đọc được, nên hai câu phải ở cùng ảnh chụp — tách tx thì một bài bị xoá mềm giữa
   * hai câu cho ra một dòng vinh danh KHÔNG có người nhận nào.
   *
   * 🔴 DTO người nhận chở ĐÚNG `{employeeId, fullName, avatarUrl, isFormerEmployee}` — **không
   * `userId`** (ca `K-7`). `isFormerEmployee` nói rõ người đó đã nghỉ (owner ký S6): đường ghi CHO
   * PHÉP vinh danh người đã nghỉ, nên đường đọc phải nói ra trạng thái thay vì để người xem tự đoán.
   */
  async list(user: SocialRequestUser, query: { month?: string; page: number; limit: number }) {
    const actor = await this.access.resolveActor(user, "kudosList");
    const { page, limit } = query;

    const { rows, total, recipients } = await this.db.withTenant(actor.companyId, async (tx) => {
      const listed = await this.repo.listKudosTx(tx, actor, {
        month: query.month,
        limit,
        offset: (page - 1) * limit,
      });
      const recips = await this.repo.recipientsOfTx(
        tx,
        actor.companyId,
        listed.rows.map((r) => r.kudosId),
      );
      return { ...listed, recipients: recips };
    });

    // Gom theo `kudosId` ở tầng service, KHÔNG bằng một câu SQL thứ ba với `json_agg`: giữ SQL đơn
    // giản và giữ luật "cột tường minh" (DB-17 §11 R6) — `json_agg` trên một hàng JOIN rất dễ kéo
    // theo cột không ai duyệt, và ở đây cột không được kéo theo chính là `users.id`.
    const byKudos = new Map<string, typeof recipients>();
    for (const r of recipients) {
      const list = byKudos.get(r.kudosId);
      if (list) list.push(r);
      else byKudos.set(r.kudosId, [r]);
    }

    return {
      data: rows.map((r) => ({
        kudosId: r.kudosId,
        postId: r.postId,
        message: r.message,
        isOfficial: r.isOfficial,
        badge: r.badgeId
          ? { id: r.badgeId, code: r.badgeCode, name: r.badgeName, icon: r.badgeIcon }
          : null,
        createdAt: r.createdAt.toISOString(),
        recipients: (byKudos.get(r.kudosId) ?? []).map((p) => ({
          employeeId: p.employeeId,
          fullName: p.fullName,
          avatarUrl: p.avatarUrl,
          isFormerEmployee: p.isFormerEmployee,
        })),
      })),
      page,
      limit,
      total,
    };
  }

  /** `048` — `GET /social/kudos-badges`. Chỉ `is_active = true`; envelope OFFSET. */
  async listBadges(user: SocialRequestUser, query: { page: number; limit: number }) {
    const actor = await this.access.resolveActor(user, "kudosBadgeList");
    const { page, limit } = query;

    const { rows, total } = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.listBadgesTx(tx, actor.companyId, { limit, offset: (page - 1) * limit }),
    );

    return { data: rows, page, limit, total };
  }

  /**
   * `049` — `POST /social/kudos-badges`. Trùng `code` (kể cả huy hiệu ĐÃ TẮT hay mã hệ thống) ⇒ 409.
   * Khớp theo TÊN constraint, KHÔNG `23505` trần (bảng còn UNIQUE `(company_id, id)` cho FK tổ hợp).
   */
  async createBadge(
    user: SocialRequestUser,
    dto: CreateKudosBadgeDto,
  ): Promise<KudosBadgeAdminDto> {
    const actor = await this.access.resolveActor(user, "kudosBadgeCreate");
    return this.db.withTenant(actor.companyId, async (tx) => {
      let row: KudosBadgeAdminRow;
      try {
        row = await createBadgeTx(tx, actor.companyId, actor.actorUserId, dto);
      } catch (err) {
        if (isUniqueViolationOf(err, SOCIAL_CONSTRAINT.KUDOS_BADGE_CODE_UQ)) {
          throw new ConflictException(socialError(SOCIAL_ERR.KUDOS_BADGE_CODE_TAKEN));
        }
        throw err;
      }
      await this.recordBadgeAudit(tx, actor, "social.kudos_badge.create", row.id, {
        code: row.code,
        name: row.name,
        // Chữ tự do ⇒ chỉ ghi CÓ/KHÔNG (xem `diffBadge`).
        hasDescription: row.description != null,
        icon: row.icon,
        position: row.position,
      });
      return toBadgeAdminDto(row);
    });
  }

  /**
   * `050` — `PATCH /social/kudos-badges/{id}`. Khoá hàng (`FOR UPDATE`) → tính trường THẬT SỰ đổi →
   * UPDATE + audit `changes = {field: {from, to}}` CHỈ của trường đổi.
   *
   * Quyết định: PATCH hợp lệ nhưng KHÔNG đổi gì (gửi lại đúng giá trị hiện tại) ⇒ **200 trả trạng thái
   * hiện tại, KHÔNG UPDATE, KHÔNG audit** — cùng ngữ nghĩa lượt `051` lặp: sổ append-only chỉ ghi khi
   * dữ liệu đổi thật, và `updated_at` không nhảy vô cớ.
   */
  async updateBadge(
    user: SocialRequestUser,
    badgeId: string,
    dto: UpdateKudosBadgeDto,
  ): Promise<KudosBadgeAdminDto> {
    const actor = await this.access.resolveActor(user, "kudosBadgeUpdate");
    return this.db.withTenant(actor.companyId, async (tx) => {
      const current = await findBadgeTx(tx, actor.companyId, badgeId, { forUpdate: true });
      if (!current) throw new NotFoundException(socialError(SOCIAL_ERR.KUDOS_BADGE_NOT_FOUND));

      const { patch, changes, isNoop } = diffBadge(current, dto);
      if (isNoop) return toBadgeAdminDto(current);

      const row = await updateBadgeTx(tx, actor.companyId, badgeId, actor.actorUserId, patch);
      // Hàng đã khoá `FOR UPDATE` và bảng không có DELETE ⇒ nhánh này không tới được hôm nay. Ném thay
      // vì trả `current`: một vị từ thêm vào UPDATE về sau không được biến thành 200 câm.
      if (!row) throw new NotFoundException(socialError(SOCIAL_ERR.KUDOS_BADGE_NOT_FOUND));
      await this.recordBadgeAudit(tx, actor, "social.kudos_badge.update", badgeId, {
        code: row.code,
        changes,
      });
      return toBadgeAdminDto(row);
    });
  }

  /**
   * `051` — `DELETE /social/kudos-badges/{id}` = TẮT (D10). `UPDATE … WHERE is_active = true`: lượt lặp
   * khớp 0 hàng ⇒ đọc lại trong CÙNG tenant — có ⇒ 200 trả DTO (đã tắt sẵn), KHÔNG audit; không có
   * (hoặc thuộc công ty khác — một mã cho mọi lý do) ⇒ 404 `KUDOS_BADGE_NOT_FOUND`.
   */
  async deactivateBadge(user: SocialRequestUser, badgeId: string): Promise<KudosBadgeAdminDto> {
    const actor = await this.access.resolveActor(user, "kudosBadgeDelete");
    return this.db.withTenant(actor.companyId, async (tx) => {
      const row = await deactivateBadgeTx(tx, actor.companyId, badgeId, actor.actorUserId);
      if (!row) {
        const existing = await findBadgeTx(tx, actor.companyId, badgeId);
        if (!existing) throw new NotFoundException(socialError(SOCIAL_ERR.KUDOS_BADGE_NOT_FOUND));
        return toBadgeAdminDto(existing);
      }
      await this.recordBadgeAudit(tx, actor, "social.kudos_badge.deactivate", badgeId, {
        code: row.code,
        changes: { isActive: { from: true, to: false } },
      });
      return toBadgeAdminDto(row);
    });
  }

  /** `056` — `GET /social/kudos-badges/manage`. CẢ huy hiệu đã tắt, kèm `isActive`; OFFSET. */
  async listBadgesAdmin(
    user: SocialRequestUser,
    query: { page: number; limit: number },
  ): Promise<KudosBadgeAdminPageDto> {
    const actor = await this.access.resolveActor(user, "kudosBadgeAdminList");
    const { page, limit } = query;
    const { rows, total } = await this.db.withTenant(actor.companyId, (tx) =>
      listBadgesAdminTx(tx, actor.companyId, { limit, offset: (page - 1) * limit }),
    );
    return { data: rows.map(toBadgeAdminDto), page, limit, total };
  }

  /** Một dòng `audit_logs` `object_type='feed_kudos_badge'` (CHECK `0583`). Payload = id + trường đổi. */
  private async recordBadgeAudit(
    tx: TenantTx,
    actor: SocialActor,
    action: string,
    badgeId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(tx, {
      action,
      objectType: "feed_kudos_badge",
      objectId: badgeId,
      actorUserId: actor.actorUserId,
      moduleCode: "SOCIAL",
      entityType: "feed_kudos_badge",
      entityId: badgeId,
      resultStatus: "Success",
      metadata: { badgeId, ...metadata },
    });
  }
}
