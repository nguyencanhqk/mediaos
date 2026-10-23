/**
 * S16-SOCIAL-DASH-1 — handler 2 widget DASH của module SOCIAL (SPEC-16 §17.3, mig 0592):
 *   • SOCIAL_ENGAGEMENT_WEEK (slug `social-engagement-week`) — «Tương tác tuần»: bài · bình luận · cảm
 *     xúc · thành viên hoạt động của TUẦN HIỆN TẠI trong phạm vi người xem. Nguồn
 *     `SocialStatsService.weeklyEngagementForWidget()` — CÙNG cổng, CÙNG câu với route 052.
 *   • SOCIAL_NEWS_UNACKED (slug `social-news-unacked`) — «Tin tức chưa đọc»: CHỈ `total` = số tin yêu
 *     cầu xác nhận mà CHÍNH người xem chưa xác nhận. Nguồn `SocialNewsService.list()` nhánh `countOnly`
 *     — CÙNG đường mã với huy hiệu của route 020 (API-19: «không cần route riêng»).
 *
 * Mỗi widget mượn ĐÚNG cặp của route nguồn (052 → `view:feed-report`, 020 → `view:feed`) — KHÔNG mượn
 * chéo cặp của widget anh em; xem DASH_WIDGET_GATE_PAIR.
 *
 * File RIÊNG (khuôn dashboard-widget-office/recruit/payroll.handlers.ts): registry vẫn là MỘT
 * (`DashboardWidgetHandlersService.buildRegistry` gọi sang đây) — tách file, KHÔNG tách registry.
 *
 * Cùng hợp đồng với các handler cũ: `gateAndResolve` (403 fail-closed + cache identity) LUÔN chạy trước
 * mọi lần serve; `fetch` chỉ gọi method ĐÃ-gate của module nguồn — KHÔNG import repository của SOCIAL,
 * KHÔNG raw-query `feed_*`, KHÔNG gọi `SocialAccessService.resolveActor` từ đây (census 2 tầng của
 * SOCIAL chỉ quét `src/social/**`, một lời gọi ở đây là vô hình với nó).
 *
 * ⚠️ BA ĐIỀU KHÁC các widget trước:
 *   1. KHÔNG CACHE: `DASH_WIDGET_TTL_SECONDS.SOCIAL = 0` (SOC-DEC-010) ⇒ `fetch` chạy mọi lượt xem. Identity
 *      vẫn khai per-user cho CẢ HAI widget, để nếu sau này TTL được nới thì số của người này không bao
 *      giờ được phục vụ cho người khác.
 *   2. CỔNG CHỒNG: nguồn SOCIAL cũng 403 khi thiếu cặp, và route 020 còn 403 khi grant hẹp hơn Company
 *      — nên gỡ cổng ở đây thì status vẫn 403, chỉ THÔNG ĐIỆP đổi. Cổng ở đây KHÔNG thừa: đường METADATA
 *      (/dashboard/me) không gọi service SOCIAL lần nào, và với `view:feed-report@Own|Team` nguồn không
 *      403 mà trả SỐ 0 (`statsScopeFilter` ⇒ `none`).
 *   3. LỖI KHÔNG THÀNH SỐ 0: không `try/catch`, không `?? 0`. `HttpException` của nguồn giữ nguyên status;
 *      lỗi khác do runner hạ thành `Degraded`.
 */
import { ForbiddenException, Injectable } from "@nestjs/common";
import type { DataScope } from "@mediaos/contracts";
import { PermissionService } from "../permission/permission.service";
import { DataScopeService } from "../permission/data-scope.service";
import { SocialStatsService } from "../social/social-stats.service";
import { SocialNewsService } from "../social/social-news.service";
import { ttlSecondsFor } from "./dashboard-widget-data.const";
import { meetsMinDataScope } from "./dashboard-widget-catalog.const";
import { gateWidgetOrThrow } from "./dashboard-widget-gate";
import type {
  WidgetCacheIdentity,
  WidgetFetchResult,
  WidgetHandlerContext,
} from "./dashboard-widget-data.types";

type SocialWidgetCode = "SOCIAL_ENGAGEMENT_WEEK" | "SOCIAL_NEWS_UNACKED";

@Injectable()
export class DashboardWidgetSocialHandlers {
  constructor(
    private readonly permission: PermissionService,
    private readonly dataScope: DataScopeService,
    // Nguồn của 2 widget — service ĐÃ-gate (tầng 2 của SOCIAL chạy bên trong), KHÔNG repository.
    private readonly stats: SocialStatsService,
    private readonly news: SocialNewsService,
  ) {}

  // ── SOCIAL_ENGAGEMENT_WEEK (SocialStatsService.weeklyEngagementForWidget — tuần hiện tại của 052) ──

  /**
   * Cặp `view:feed-report` + SÀN `Department`. Sau sàn, scope ∈ {Department, Company, System} và con số
   * CO THEO scope (quản lý chỉ thấy đơn vị mình) ⇒ payload phụ thuộc người xem ⇒ identity per-user,
   * `cacheScope` = scope đã resolve.
   */
  async gateEngagementWeek(ctx: WidgetHandlerContext): Promise<WidgetCacheIdentity> {
    const scope = await this.gateWithFloor(ctx, "SOCIAL_ENGAGEMENT_WEEK");
    return {
      shareScope: "user",
      cacheScope: scope,
      keyDiscriminator: null,
      scopeReferenceId: ctx.user.id,
      ttlSeconds: ttlSecondsFor(ctx.entry),
    };
  }

  /**
   * TÁI DÙNG `weeklyEngagementForWidget` — MỘT công thức, MỘT con số với hàng tuần hiện tại của
   * `GET /social/stats/engagement` (SOCIAL-API-052); nó tự `resolveActor("statsEngagement")` rồi co số
   * theo scope của người gọi.
   *
   * Payload liệt kê TƯỜNG MINH 5 khoá (không spread DTO nguồn): nguồn thêm trường thì widget không tự
   * chở theo. Chỉ số đếm — không tên người, không nội dung bài.
   *
   * `Empty` khi bài + bình luận + cảm xúc = 0. Gồm cả ca quản lý không thuộc / không đứng đầu đơn vị
   * nào (phạm vi rỗng ⇒ nguồn trả 0): chữ rỗng nói «trong phạm vi của bạn» nên vẫn đúng sự thật.
   */
  async fetchEngagementWeek(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const week = await this.stats.weeklyEngagementForWidget(ctx.user);
    if (week.posts + week.comments + week.reactions === 0) {
      return {
        status: "Empty",
        data: {},
        emptyState: { message: "Tuần này chưa có tương tác nào trong phạm vi của bạn" },
      };
    }
    return {
      status: "Active",
      data: {
        weekStart: week.weekStart,
        posts: week.posts,
        comments: week.comments,
        reactions: week.reactions,
        activeMembers: week.activeMembers,
      },
      emptyState: null,
    };
  }

  // ── SOCIAL_NEWS_UNACKED (SocialNewsService.list nhánh countOnly — huy hiệu của route 020) ─────────

  /**
   * Cặp `view:feed` + SÀN `Company` (khớp `companyFloor` của route 020). `cacheScope` là `Own` dù grant
   * ở @Company: con số đếm cho CHÍNH người gọi (tin trong tầm nhìn của họ mà họ chưa xác nhận) —
   * «Own» là tính chất của dữ liệu, không phải scope của grant.
   */
  async gateNewsUnacked(ctx: WidgetHandlerContext): Promise<WidgetCacheIdentity> {
    await this.gateWithFloor(ctx, "SOCIAL_NEWS_UNACKED");
    return {
      shareScope: "user",
      cacheScope: "Own",
      keyDiscriminator: null,
      scopeReferenceId: ctx.user.id,
      ttlSeconds: ttlSecondsFor(ctx.entry),
    };
  }

  /**
   * `countOnly: true` ⇒ nguồn KHÔNG nạp hàng tin nào, chỉ đếm trong SQL bằng CÙNG vị từ «thấy được» với
   * danh sách (`limit: 1` chỉ để thoả schema; nhánh `countOnly` không đọc nó).
   *
   * `unackedCount === null` nghĩa là «không hỏi», KHÔNG phải 0 (hợp đồng `feedNewsPageSchema`). Ở đây đã
   * hỏi, nên `null` là hợp đồng với nguồn vỡ ⇒ NÉM lỗi thường (runner hạ thành `Degraded`), không vẽ
   * số 0 giả. Chốt phủ cả lớp «không phải số nguyên ≥ 0» (`undefined` · `NaN` · số âm · số lẻ): hợp đồng vỡ
   * kiểu nào cũng NÉM. `total === 0` ⇒ `Empty` (đã xác nhận hết là trạng thái ĐẸP, không phải lỗi).
   */
  async fetchNewsUnacked(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const page = await this.news.list(ctx.user, { limit: 1, countOnly: true });
    const total = page.unackedCount;
    if (typeof total !== "number" || !Number.isInteger(total) || total < 0) {
      throw new Error(
        `DashboardWidgetSocialHandlers.fetchNewsUnacked: nguồn 020 không trả unackedCount hợp lệ dù đã hỏi countOnly (nhận ${String(total)})`,
      );
    }
    if (total === 0) {
      return {
        status: "Empty",
        data: {},
        emptyState: { message: "Bạn đã xác nhận hết các tin cần đọc" },
      };
    }
    return { status: "Active", data: { total }, emptyState: null };
  }

  /**
   * Gate dùng chung cho CẢ HAI widget: (1) cặp của route nguồn (403 «thiếu quyền <cặp>»); (2) SÀN scope
   * đọc từ CÙNG hằng `DASH_WIDGET_MIN_DATA_SCOPE` mà `DashboardWidgetRegistryService.filterByGatePair`
   * dùng cho đường METADATA (403 «… ở phạm vi đủ rộng»). Không literal scope nào ở đây: hai tầng lệch
   * hằng ⇒ deny-path xanh rỗng. MỘT hàm cho cả hai để không sinh thêm một bản sao gate dễ trôi.
   *
   * Trả scope đã resolve cho CHÍNH `gateAndResolve` dựng cache identity — KHÔNG chuyền sang `fetch`
   * (gate ⊥ fetch, xem dashboard-widget-gate.ts).
   */
  private async gateWithFloor(
    ctx: WidgetHandlerContext,
    widgetCode: SocialWidgetCode,
  ): Promise<DataScope> {
    const pair = await gateWidgetOrThrow(this.permission, ctx.user, widgetCode);
    const scope = await this.dataScope.resolveAndAssert(
      ctx.user.id,
      ctx.user.companyId,
      pair.action,
      pair.resourceType,
    );
    if (!meetsMinDataScope(widgetCode, scope)) {
      throw new ForbiddenException(
        `AUTH-ERR-FORBIDDEN: thiếu quyền ${pair.action}:${pair.resourceType} ở phạm vi đủ rộng`,
      );
    }
    return scope;
  }
}
