/**
 * S11-OFFICE-DASH-1 — handler 2 widget DASH của wave OFFICE (SPEC-13 AS-10 · SPEC-14 RM-08, mig 0558):
 *   • ROOM_TODAY    (slug `room-today`)    — «Lịch họp hôm nay» của CHÍNH người xem.
 *   • ASSET_SUMMARY (slug `asset-summary`) — «Thống kê tài sản» theo trạng thái/loại trong scope người xem.
 *
 * VÌ SAO file RIÊNG (không nối tiếp vào `dashboard-widget-handlers.service.ts` như các đợt trước): file đó
 * đã 782 dòng, thêm 2 handler nữa là vượt trần 800 dòng của CLAUDE.md §5. Registry vẫn là MỘT
 * (`DashboardWidgetHandlersService.buildRegistry` gọi sang đây) — tách file, KHÔNG tách registry.
 *
 * Cùng hợp đồng với các handler cũ: `gateAndResolve` (403 fail-closed + resolve cache identity) LUÔN chạy
 * trước mọi lần serve kể cả cache hit; `fetch` chỉ chạy khi cache miss/refresh. Mỗi handler CHỈ gọi method
 * ĐÃ-scope của module nguồn — KHÔNG raw-query bảng `assets`/`room_bookings`, KHÔNG thêm method ở module gốc.
 */
import { ForbiddenException, Injectable } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import { DataScopeService } from "../permission/data-scope.service";
import { AssetsService } from "../assets/assets.service";
import { RoomBookingsService } from "../rooms/room-bookings.service";
import { localDateOf } from "../common/tz.util";
import { resolveCompanyTz } from "./dashboard-company-tz.util";
import { gatePairFor, ttlSecondsFor, DASH_WIDGET_LIST_CAP } from "./dashboard-widget-data.const";
import { meetsMinDataScope } from "./dashboard-widget-catalog.const";
import { DASH_ERR } from "./dashboard-resolver.errors";
import type { EnginePair } from "./dashboard-widget-catalog.const";
import type {
  WidgetCacheIdentity,
  WidgetFetchResult,
  WidgetHandlerContext,
  WidgetRequestUser,
} from "./dashboard-widget-data.types";

@Injectable()
export class DashboardWidgetOfficeHandlers {
  constructor(
    private readonly db: DatabaseService,
    private readonly permission: PermissionService,
    private readonly dataScope: DataScopeService,
    private readonly assets: AssetsService,
    private readonly roomBookings: RoomBookingsService,
  ) {}

  // ── gate helper (mirror DashboardWidgetHandlersService.gateOrThrow) ──────────────────────────────

  /**
   * Gate bằng cặp của MODULE NGUỒN. KHÔNG truyền isSensitive — engine tự ép effectivelySensitive = input OR
   * grant.isSensitive, nên wildcard KHÔNG lọt qua cặp nhạy cảm. Deny ⇒ 403 fail-closed (runner KHÔNG nuốt
   * ForbiddenException thành Degraded).
   */
  private async gateOrThrow(user: WidgetRequestUser, widgetCode: string): Promise<EnginePair> {
    const pair = gatePairFor(widgetCode);
    if (!pair) {
      throw new ForbiddenException(`${DASH_ERR.VALIDATION}: widget thiếu cặp gate (${widgetCode})`);
    }
    const decision = await this.permission.can({
      userId: user.id,
      companyId: user.companyId,
      action: pair.action,
      resourceType: pair.resourceType,
    });
    if (!decision.allow) {
      throw new ForbiddenException(
        `AUTH-ERR-FORBIDDEN: thiếu quyền ${pair.action}:${pair.resourceType}`,
      );
    }
    return pair;
  }

  // ── ROOM_TODAY (RoomBookingsService.listMine — self-locked organizer/attendee = caller) ──────────

  /**
   * `listMine` tự `resolveViewActor('view','room')` RỒI tự khoá organizer/attendee = caller ⇒ dữ liệu
   * viewer-dependent tuyệt đối ⇒ cache per-user Own. Gate LẠI ở đây cho nhất quán với mọi handler khác
   * (mirror PENDING_LEAVE/GOAL_PROGRESS) — không dựa vào việc method nguồn tự gate.
   */
  async gateRoomToday(ctx: WidgetHandlerContext): Promise<WidgetCacheIdentity> {
    await this.gateOrThrow(ctx.user, "ROOM_TODAY");
    return {
      shareScope: "user",
      cacheScope: "Own",
      keyDiscriminator: null,
      scopeReferenceId: ctx.user.id,
      ttlSeconds: ttlSecondsFor(ctx.entry),
    };
  }

  /**
   * "Hôm nay" theo múi giờ CÔNG TY, KHÔNG theo đồng hồ trình duyệt (SPEC-14 §83) — cùng `resolveCompanyTz` +
   * `localDateOf` mà ATTENDANCE_TODAY dùng. `listMine` nhận `date` (loại trừ lẫn nhau với `from`/`to`) và tự
   * dựng biên ngày theo tz công ty ở tầng ROOM ⇒ MỘT định nghĩa "hôm nay", KHÔNG tính lại biên ở đây.
   *
   * `includeCancelled: false` — widget là "lịch họp hôm nay"; lượt đã huỷ không còn là lịch (người xem vẫn
   * thấy chúng ở màn «Đặt phòng của tôi»).
   */
  async fetchRoomToday(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const tz = await resolveCompanyTz(this.db, ctx.user.companyId);
    const today = localDateOf(new Date(), tz);
    const rows = await this.roomBookings.listMine(ctx.user, {
      date: today,
      role: "all",
      includeCancelled: false,
    });
    const now = Date.now();
    // Sắp theo giờ bắt đầu tăng dần rồi cắt — widget "liếc nhanh" (DASH_WIDGET_LIST_CAP), không phân trang.
    const sorted = [...rows].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const items = sorted.slice(0, DASH_WIDGET_LIST_CAP).map((b) => ({
      id: b.id,
      title: b.title,
      roomName: b.room.name,
      roomLocation: b.room.location,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      myRole: b.myRole,
      status: b.status,
      isCompleted: b.isCompleted,
      // KHÔNG đưa `attendees[].displayName` vào payload: tên người đã bị RoomPeopleRepository mask theo
      // scope NGƯỜI XEM ⇒ nằm trong hàng cache là rò chéo người xem. Chỉ SỐ LƯỢNG (non-PII).
      attendeeCount: b.attendees.length,
    }));
    const upcoming = sorted.filter((b) => new Date(b.startsAt).getTime() > now).length;
    return {
      status: sorted.length === 0 ? "Empty" : "Active",
      data: { date: today, items, summary: { total: sorted.length, upcoming } },
      emptyState: sorted.length === 0 ? { message: "Hôm nay bạn không có lịch họp" } : null,
    };
  }

  // ── ASSET_SUMMARY (AssetsService.summary — đúng công thức GET /assets/summary, ASSET-API-024) ─────

  /**
   * Gate HAI vế: (1) cặp `view:asset` (403 fail-closed) — nhưng CẢ 4 role canonical đều CÓ cặp này; (2) SÀN
   * scope `Department` (`DASH_WIDGET_MIN_DATA_SCOPE`) ⇒ nhân viên thường (`view:asset@Own`, mig 0550:319)
   * nhận 403, đúng SPEC-13 §482, trong khi Asset Manager (`@Company`) vẫn thấy dù dùng chung dashboard type
   * 'Employee'. Registry đã loại widget khỏi METADATA bằng CÙNG hằng đó, nên đường bình thường không bao giờ
   * chạm 403 này — nó gác đường gọi THẲNG slug và trường hợp widget bị bật tay qua `dashboard_widget_configs`
   * (memory `read-path-gate-pair-must-match-download-pair`).
   */
  async gateAssetSummary(ctx: WidgetHandlerContext): Promise<WidgetCacheIdentity> {
    const pair = await this.gateOrThrow(ctx.user, "ASSET_SUMMARY");
    const scope = await this.dataScope.resolveAndAssert(
      ctx.user.id,
      ctx.user.companyId,
      pair.action,
      pair.resourceType,
    );
    if (!meetsMinDataScope("ASSET_SUMMARY", scope)) {
      throw new ForbiddenException(
        `AUTH-ERR-FORBIDDEN: thiếu quyền ${pair.action}:${pair.resourceType} ở phạm vi đủ rộng`,
      );
    }
    // Company/System ⇒ aggregate toàn tenant, viewer-independent ⇒ chia sẻ company-wide. An toàn vì payload
    // chỉ là ĐẾM (byStatus/byCategory/maintenanceDueSoon) — KHÔNG trường tài chính mask-theo-người-xem
    // (`purchasePrice`/`supplier`, SPEC-13 §18). Department ⇒ per-user (viewer-dependent).
    const companyWide = scope === "Company" || scope === "System";
    return {
      shareScope: companyWide ? "company" : "user",
      cacheScope: companyWide ? "Company" : scope,
      keyDiscriminator: null,
      scopeReferenceId: companyWide ? null : ctx.user.id,
      ttlSeconds: ttlSecondsFor(ctx.entry),
    };
  }

  /**
   * TÁI DÙNG `AssetsService.summary` — MỘT công thức, MỘT con số với `GET /assets/summary`; nó tự
   * `resolveActorScope` và đẩy vị từ scope thẳng vào WHERE, nên số ở widget luôn nằm trong scope người xem
   * (memory `reused-method-must-be-actor-scoped`).
   */
  async fetchAssetSummary(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const summary = await this.assets.summary(ctx.user, {});
    const total = Object.values(summary.byStatus).reduce<number>((sum, n) => sum + (n ?? 0), 0);
    // `byCategory` dài theo số loại — cắt theo tổng giảm dần để bound payload. `summary.total` vẫn là tổng
    // ĐẦY ĐỦ (tổng của byStatus), KHÔNG phải tổng của phần đã cắt.
    const byCategory = [...summary.byCategory]
      .sort((a, b) => b.total - a.total)
      .slice(0, DASH_WIDGET_LIST_CAP);
    return {
      status: total === 0 ? "Empty" : "Active",
      data: {
        summary: { total, maintenanceDueSoon: summary.maintenanceDueSoon },
        byStatus: summary.byStatus,
        byCategory,
      },
      emptyState: total === 0 ? { message: "Chưa có tài sản trong phạm vi của bạn" } : null,
    };
  }
}
