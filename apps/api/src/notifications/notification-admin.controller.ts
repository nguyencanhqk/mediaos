import {
  Controller,
  Get,
  NotFoundException,
  Param,
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
import {
  NotificationDeliveryLogAdminQueryDto,
  NotificationEventAdminQueryDto,
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
const VIEW_NOTIFICATION_TEMPLATE = {
  action: "view",
  resourceType: "notification-template",
} as const;
const VIEW_NOTIFICATION_DELIVERY_LOG = {
  action: "view",
  resourceType: "notification-delivery-log",
} as const;

const TEMPLATE_NOT_FOUND_CODE = "NOTI-ERR-TEMPLATE-NOT-FOUND";

/**
 * S4-NOTI-BE-3 (L3-http, admin config — READ-ONLY vòng này) — GET /notifications/events (danh mục,
 * NOTI-API-301) · GET /notifications/templates/{id} (chi tiết, NOTI-API-303 thu hẹp) ·
 * GET /notifications/delivery-logs (NOTI-API-401). Data scope Company: mọi query qua `withTenant`
 * (BẤT BIẾN #1); `notification_events`/`notification_templates` là bảng nullable-tenant (company override
 * ∪ global) — repo tự merge "override thắng global" theo eventCode/id.
 *
 * ⚠️ KHÔNG có PATCH /events/{id} và PATCH /templates/{id} ở vòng này (bật/tắt event, sửa template): viết
 * company-override đòi GRANT INSERT,UPDATE mới trên `notification_events`/`notification_templates` cho
 * `mediaos_app` — hiện CHỈ có GRANT SELECT (migration 0479/0481/0482, comment "write company-override →
 * S4-NOTI-BE-3"). Đây là thay đổi GRANT (DDL) ⇒ cần 1 migration nối tiếp head; WO vòng này bị cấm tạo
 * migration ⇒ 2 route PATCH ĐẨY sang WO kế (xem báo cáo lane). Route "templates" LIST (NOTI-API-303 đầy
 * đủ) cũng ngoài phạm vi vòng này — chỉ chi tiết theo id như done_when yêu cầu.
 *
 * Thứ tự controller trong NotificationsModule.controllers PHẢI đứng TRƯỚC MyNotificationsController: route
 * tĩnh 1-segment "events"/"delivery-logs" sẽ bị `MyNotificationsController.@Get(':id')` (wildcard 1-segment)
 * nuốt nếu đăng ký sau (Express khớp theo THỨ TỰ đăng ký, không theo độ cụ thể — mirror cảnh báo trong
 * header MyNotificationsController).
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
