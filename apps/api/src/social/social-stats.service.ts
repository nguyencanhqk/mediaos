import { ForbiddenException, Injectable } from "@nestjs/common";
import {
  FEED_ENGAGEMENT_DEFAULT_WEEKS,
  snapToIsoWeeks,
  type FeedEngagementQueryDto,
  type FeedEngagementResponseDto,
  type FeedEngagementWeekDto,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { SocialAccessService } from "./social-access.service";
import { statsScopeFilter } from "./social-stats-scope";
import { buildEngagementWorkbook } from "./social-stats-xlsx";
import { SocialStatsRepository, type EngagementRange } from "./social-stats.repository";
import { SOCIAL_ERR, socialError } from "./social.errors";
import type { SocialActor, SocialRequestUser } from "./social.types";

/**
 * S16-SOCIAL-BE-3B — thống kê tương tác: `SOCIAL-API-052` (JSON) · `053` (XLSX + audit) · hàm cho `SOCIAL-WIDGET-001`.
 *
 * ── CỔNG ── `resolveActor` (tầng 2, cặp `view:feed-report`, `companyFloor:false`) chạy **NGOÀI** `withTenant`: nó tự mở
 * transaction đọc grant riêng. Phạm vi dữ liệu = `statsScopeFilter(routeScope, orgUnitIds)`, áp CÙNG kết quả cho metadata
 * và số liệu (plan D5).
 *
 * ── KHÔNG CACHE ── (SOC-DEC-010) — không lớp nhớ nào ở đây; controller gắn `Cache-Control: no-store`.
 */
@Injectable()
export class SocialStatsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: SocialAccessService,
    private readonly repo: SocialStatsRepository,
    private readonly audit: AuditService,
  ) {}

  /** `052` — `GET /social/stats/engagement`. */
  async engagement(
    user: SocialRequestUser,
    query: FeedEngagementQueryDto,
  ): Promise<FeedEngagementResponseDto> {
    const actor = await this.access.resolveActor(user, "statsEngagement");
    return this.db.withTenant(user.companyId, (tx) =>
      this.collectTx(tx, actor, query, FEED_ENGAGEMENT_DEFAULT_WEEKS),
    );
  }

  /**
   * `053` — XLSX từ CÙNG `collectTx` với `052`. Audit ĐÚNG MỘT hàng trong CÙNG transaction với câu thu thập (plan D8):
   * `objectType` mượn `feed_report` (giá trị CHECK sẵn có — thêm giá trị mới là migration ACCESS EXCLUSIVE trên
   * `audit_logs`), phân biệt bằng `entityType` riêng. `metadata` không chở số liệu, không tên người.
   * 403 đơn vị ngoài phạm vi ném TRƯỚC câu audit ⇒ 0 hàng audit.
   */
  async export(
    user: SocialRequestUser,
    query: FeedEngagementQueryDto,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const actor = await this.access.resolveActor(user, "statsExport");
    return this.db.withTenant(user.companyId, async (tx) => {
      const result = await this.collectTx(tx, actor, query, FEED_ENGAGEMENT_DEFAULT_WEEKS);
      // Dựng tệp TRƯỚC câu audit (FULL gate BE-3B, LOW): exceljs hỏng ⇒ tx rollback ⇒ không có hàng
      // audit «Success» cho một tệp chưa từng được giao.
      const file = await buildEngagementWorkbook(result);
      await this.audit.record(tx, {
        action: "social.stats.exported",
        objectType: "feed_report",
        actorUserId: user.id,
        moduleCode: "SOCIAL",
        entityType: "feed_engagement_stats",
        resultStatus: "Success",
        metadata: {
          from: result.range.from,
          to: result.range.to,
          orgUnitId: query.orgUnitId ?? null,
          rowCount: result.rows.length,
          format: "xlsx",
        },
      });
      return file;
    });
  }

  /**
   * `SOCIAL-WIDGET-001` «Tương tác tuần» — tổng của TUẦN HIỆN TẠI (theo TZ công ty) trong phạm vi người xem.
   *
   * CÙNG cổng + CÙNG sàn với `052` (`statsEngagement`) và CÙNG `collectTx`. Handler/catalog/slug DASH là việc của
   * `S16-SOCIAL-DASH-1` — xem notes WO đó: (a) DASH cache theo TTL mâu thuẫn SOC-DEC-010 «không cache»;
   * (b) `Own`/`Team` nhận số 0 chứ không 403 ⇒ DASH phải tự ẩn widget.
   */
  async weeklyEngagementForWidget(user: SocialRequestUser): Promise<FeedEngagementWeekDto> {
    const actor = await this.access.resolveActor(user, "statsEngagement");
    const result = await this.db.withTenant(user.companyId, (tx) =>
      this.collectTx(tx, actor, { orgUnitId: undefined }, 1),
    );
    const current = result.weekTotals[result.weekTotals.length - 1];
    if (!current) {
      throw new Error(
        "SocialStatsService.weeklyEngagementForWidget: khoảng 1 tuần không sinh hàng tổng nào",
      );
    }
    return current;
  }

  /**
   * Hàm thu thập DUY NHẤT của `052`/`053`/widget. Thứ tự: phạm vi → metadata → kiểm `orgUnitId` (D6, TRƯỚC mọi câu
   * số liệu và audit) → khoảng → số liệu.
   */
  async collectTx(
    tx: TenantTx,
    actor: SocialActor,
    query: FeedEngagementQueryDto,
    defaultWeeks: number,
  ): Promise<FeedEngagementResponseDto> {
    const filter = statsScopeFilter(actor.routeScope, actor.orgUnitIds);
    const units = await this.repo.unitsTx(tx, actor.companyId, filter);
    if (query.orgUnitId !== undefined && !units.some((u) => u.orgUnitId === query.orgUnitId)) {
      throw new ForbiddenException(socialError(SOCIAL_ERR.STATS_UNIT_OUT_OF_SCOPE));
    }
    const range = await this.resolveRangeTx(tx, actor.companyId, query, defaultWeeks);
    const { rows, weekTotals } = await this.repo.engagementTx(
      tx,
      actor.companyId,
      range,
      filter,
      query.orgUnitId,
    );
    return { range, units, rows, weekTotals };
  }

  private async resolveRangeTx(
    tx: TenantTx,
    companyId: string,
    query: FeedEngagementQueryDto,
    defaultWeeks: number,
  ): Promise<EngagementRange> {
    if (query.from !== undefined && query.to !== undefined) {
      // Schema đã nắn sẵn; nắn lại là phép đồng nhất, chỉ để lấy `weeks` từ CÙNG một hàm.
      const snapped = snapToIsoWeeks(query.from, query.to);
      if (snapped === null) {
        throw new Error("SocialStatsService: khoảng ngày đã qua schema mà không nắn được");
      }
      return snapped;
    }
    const range = await this.repo.defaultRangeTx(tx, companyId, defaultWeeks);
    if (range === null) {
      // Chỉ xảy ra khi công ty đã xoá mềm — actor đã qua xác thực nên đây là bất biến vỡ, không phải lỗi người dùng.
      throw new Error("SocialStatsService: không đọc được múi giờ công ty để tính khoảng mặc định");
    }
    return range;
  }
}
