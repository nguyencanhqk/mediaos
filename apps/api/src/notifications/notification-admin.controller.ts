import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { paginated, toPagination } from "../common/pagination";
import { DatabaseService } from "../db/db.service";
import { NotificationEventRepository } from "./notification-event.repository";
import { NotificationTemplateRepository } from "./notification-template.repository";
import { NotificationDeliveryLogRepository } from "./notification-delivery-log.repository";
import { NotificationAdminService } from "./notification-admin.service";
import {
  NotificationDeliveryLogAdminQueryDto,
  NotificationEventAdminPatchDto,
  NotificationEventAdminQueryDto,
  NotificationTemplateAdminPatchDto,
} from "./notification-admin.dto";
import {
  toDeliveryLogAdminItem,
  toEventAdminItem,
  toTemplateAdminItem,
} from "./notification-admin.mapper";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/** Cặp quyền config NOTI (S4-NOTI-BE-2 catalog, is_sensitive=true — PIN THẬT, KHÔNG tự bịa tuple). */
const VIEW_NOTIFICATION_CONFIG = { action: "view", resourceType: "notification-config" } as const;
const UPDATE_NOTIFICATION_CONFIG = {
  action: "update",
  resourceType: "notification-config",
} as const;
const VIEW_NOTIFICATION_TEMPLATE = {
  action: "view",
  resourceType: "notification-template",
} as const;
const UPDATE_NOTIFICATION_TEMPLATE = {
  action: "update",
  resourceType: "notification-template",
} as const;
const VIEW_NOTIFICATION_DELIVERY_LOG = {
  action: "view",
  resourceType: "notification-delivery-log",
} as const;

const TEMPLATE_NOT_FOUND_CODE = "NOTI-ERR-TEMPLATE-NOT-FOUND";

/**
 * S4-NOTI-BE-3/BE-4 (L3-http, admin config) — READ + WRITE:
 *   • READ (BE-3): GET /notifications/events (NOTI-API-301) · GET /notifications/templates/{id}
 *     (NOTI-API-303 thu hẹp) · GET /notifications/delivery-logs (NOTI-API-401).
 *   • WRITE (BE-4): PATCH /notifications/events/{id} (bật/tắt = company-override) · PATCH
 *     /notifications/templates/{id} (sửa nội dung = company-override). GRANT INSERT,UPDATE mở ở mig 0487.
 * Data scope Company: mọi query qua `withTenant` (BẤT BIẾN #1); `notification_events`/`notification_templates`
 * là bảng nullable-tenant (company override ∪ global) — repo merge "override thắng global" theo eventCode/id.
 * WRITE luôn tạo/hiệu-chỉnh hàng COMPANY-OVERRIDE (company_id=GUC), KHÔNG UPDATE hàng global (0479 WITH
 * CHECK company_id=GUC chặn cứng). Business logic ở NotificationAdminService (CLAUDE.md §5).
 *
 * Thứ tự controller trong NotificationsModule.controllers PHẢI đứng TRƯỚC MyNotificationsController: route
 * tĩnh 1-segment "events"/"delivery-logs" sẽ bị `MyNotificationsController.@Get(':id')` (wildcard 1-segment)
 * nuốt nếu đăng ký sau (Express khớp theo THỨ TỰ đăng ký, không theo độ cụ thể — mirror cảnh báo trong
 * header MyNotificationsController). 2 route PATCH (events/:id · templates/:id) là 2-segment, KHÔNG va PATCH
 * nào của MyNotificationsController (chỉ có @Delete(':id') / @Post — không @Patch).
 */
@Controller("notifications")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class NotificationAdminController {
  constructor(
    private readonly db: DatabaseService,
    private readonly eventRepo: NotificationEventRepository,
    private readonly templateRepo: NotificationTemplateRepository,
    private readonly deliveryLogRepo: NotificationDeliveryLogRepository,
    private readonly adminService: NotificationAdminService,
  ) {}

  /** NOTI-API-301 — GET /notifications/events (company override ∪ global, phân trang in-memory — catalog nhỏ). */
  @Get("events")
  @RequirePermission(VIEW_NOTIFICATION_CONFIG.action, VIEW_NOTIFICATION_CONFIG.resourceType, {
    isSensitive: true,
  })
  async listEvents(
    @Req() req: AuthenticatedRequest,
    @Query() query: NotificationEventAdminQueryDto,
  ) {
    const companyId = req.user.companyId;
    const all = await this.db.withTenant(companyId, (tx) =>
      this.eventRepo.listCatalog(tx, companyId, {
        moduleCode: query.module_code,
        eventCode: query.event_code,
        enabled: query.enabled,
        search: query.search,
      }),
    );
    const total = all.length;
    const start = (query.page - 1) * query.per_page;
    const pageRows = all.slice(start, start + query.per_page);
    return paginated(
      pageRows.map(toEventAdminItem),
      toPagination(total, query.page, query.per_page),
    );
  }

  /**
   * NOTI-API-302 (BE-4) — PATCH /notifications/events/{id} (bật/tắt event = ghi company-override).
   * @RequirePermission update:notification-config (is_sensitive=true). KHÔNG UPDATE hàng global.
   */
  @Patch("events/:id")
  @RequirePermission(UPDATE_NOTIFICATION_CONFIG.action, UPDATE_NOTIFICATION_CONFIG.resourceType, {
    isSensitive: true,
  })
  async patchEvent(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: NotificationEventAdminPatchDto,
  ) {
    const override = await this.adminService.toggleEvent(
      req.user.companyId,
      req.user.id,
      id,
      body.is_enabled,
    );
    return toEventAdminItem(override);
  }

  /** NOTI-API-303 (thu hẹp) — GET /notifications/templates/{id} (chi tiết, company override ∪ global). */
  @Get("templates/:id")
  @RequirePermission(VIEW_NOTIFICATION_TEMPLATE.action, VIEW_NOTIFICATION_TEMPLATE.resourceType, {
    isSensitive: true,
  })
  async getTemplate(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const companyId = req.user.companyId;
    const row = await this.db.withTenant(companyId, (tx) =>
      this.templateRepo.findByIdForCompany(tx, companyId, id),
    );
    if (!row) {
      throw new NotFoundException({
        code: TEMPLATE_NOT_FOUND_CODE,
        message: "Notification template không tồn tại hoặc ngoài phạm vi công ty.",
      });
    }
    return toTemplateAdminItem(row);
  }

  /**
   * NOTI-API-304 (BE-4) — PATCH /notifications/templates/{id} (sửa nội dung = ghi company-override).
   * @RequirePermission update:notification-template (is_sensitive=true). Biến template nhạy cảm → 422
   * (service assertTemplateVariablesSafe TRƯỚC khi chạm DB). KHÔNG UPDATE hàng global.
   */
  @Patch("templates/:id")
  @RequirePermission(
    UPDATE_NOTIFICATION_TEMPLATE.action,
    UPDATE_NOTIFICATION_TEMPLATE.resourceType,
    {
      isSensitive: true,
    },
  )
  async patchTemplate(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: NotificationTemplateAdminPatchDto,
  ) {
    const override = await this.adminService.patchTemplate(
      req.user.companyId,
      req.user.id,
      id,
      body,
    );
    return toTemplateAdminItem(override);
  }

  /** NOTI-API-401 — GET /notifications/delivery-logs (literal company scope, append-only nguồn — CHỈ ĐỌC). */
  @Get("delivery-logs")
  @RequirePermission(
    VIEW_NOTIFICATION_DELIVERY_LOG.action,
    VIEW_NOTIFICATION_DELIVERY_LOG.resourceType,
    { isSensitive: true },
  )
  async listDeliveryLogs(
    @Req() req: AuthenticatedRequest,
    @Query() query: NotificationDeliveryLogAdminQueryDto,
  ) {
    const companyId = req.user.companyId;
    const filter = {
      notificationId: query.notification_id,
      recipientUserId: query.recipient_user_id,
      channel: query.channel,
      deliveryStatus: query.delivery_status,
      createdFrom: query.created_from,
      createdTo: query.created_to,
    };
    const limit = query.per_page;
    const offset = (query.page - 1) * query.per_page;
    const [rows, total] = await this.db.withTenant(companyId, async (tx) => {
      const list = await this.deliveryLogRepo.list(tx, companyId, filter, limit, offset);
      const count = await this.deliveryLogRepo.count(tx, companyId, filter);
      return [list, count] as const;
    });
    return paginated(
      rows.map(toDeliveryLogAdminItem),
      toPagination(total, query.page, query.per_page),
    );
  }
}
