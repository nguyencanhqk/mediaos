import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import { SocialAccessService } from "./social-access.service";
import { SocialKudosRepository } from "./social-kudos.repository";
import type { SocialRequestUser } from "./social.types";

/**
 * S16-SOCIAL-BE-2B-2 — `SOCIAL-API-047` (vinh danh) · `048` (catalog huy hiệu ĐANG BẬT).
 *
 * Hai route ĐỌC, cả hai gác `view:feed` ở tầng 1. Vế phân quyền thật của `047` nằm ở tầng 2 và nằm
 * TRONG SQL: `visiblePostCondition` — vinh danh thừa hưởng phạm vi BÀI CHA. `048` không JOIN bài nào
 * (catalog là dữ liệu cấu hình cấp công ty).
 *
 * Ba route CRUD catalog (`049..051`, cặp `manage:feed-kudos`) thuộc **BE-3**.
 */
@Injectable()
export class SocialKudosService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: SocialAccessService,
    private readonly repo: SocialKudosRepository,
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
}
