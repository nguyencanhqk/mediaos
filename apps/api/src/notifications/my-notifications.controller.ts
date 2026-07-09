import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import {
  MY_NOTIFICATION_DROPDOWN_LIMIT_DEFAULT,
  MY_NOTIFICATION_DROPDOWN_LIMIT_MAX,
} from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { paginated, toPagination } from "../common/pagination";
import { notificationPair } from "./notification-permissions.const";
import { MyNotificationsService } from "./my-notifications.service";
import {
  MarkAllNotificationsReadDto,
  MyNotificationDetailQueryDto,
  MyNotificationDropdownQueryDto,
  MyNotificationListQueryDto,
} from "./my-notifications.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

const READ_NOTIFICATION = notificationPair("read");
const MARK_READ_NOTIFICATION = notificationPair("mark_read");
const MARK_ALL_READ_NOTIFICATION = notificationPair("mark_all_read");
const DELETE_NOTIFICATION = notificationPair("delete");

/**
 * S4-NOTI-BE-1 — My-Notification API (NOTI-API-001..004/101/103/106, API-07 §11–12). Own-scope TUYỆT ĐỐI:
 * MyNotificationsService khoá cứng recipient_user_id=current user + company_id=current company ở mọi
 * query (KHÔNG đọc data-scope Team/Company — thông báo LUÔN là dữ liệu cá nhân, SPEC-08 §16.5.1).
 *
 * `@Controller("notifications")` THỨ HAI — song song NotificationsController cũ (devices/preferences,
 * mirror AuthLogsViewerController @Controller('auth') cạnh AuthController). Route KHÔNG va: 4 route cũ
 * (list/unread-count/mark-read/read-all) đã gỡ khỏi NotificationsController (notifications.controller.ts).
 *
 * Thứ tự route TĨNH TRƯỚC `:id` bắt buộc (Nest khớp theo thứ tự khai báo method) — "dropdown"/"unread-count"
 * PHẢI đứng trước `detail(:id)` để không bị nuốt làm tham số id (mirror leave.controller.ts "types" trước
 * wildcard).
 */
@Controller("notifications")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class MyNotificationsController {
  constructor(private readonly service: MyNotificationsService) {}

  /** NOTI-API-001 — GET /notifications (list của tôi, phân trang + filter). */
  @Get()
  @RequirePermission(READ_NOTIFICATION.action, READ_NOTIFICATION.resourceType, {
    isSensitive: READ_NOTIFICATION.sensitive,
  })
  async list(@Req() req: AuthenticatedRequest, @Query() query: MyNotificationListQueryDto) {
    const { data, total } = await this.service.list(req.user.companyId, req.user.id, query);
    return paginated(data, toPagination(total, query.page, query.per_page));
  }

  /** NOTI-API-002 — GET /notifications/dropdown (header/badge — latest N). */
  @Get("dropdown")
  @RequirePermission(READ_NOTIFICATION.action, READ_NOTIFICATION.resourceType, {
    isSensitive: READ_NOTIFICATION.sensitive,
  })
  dropdown(@Req() req: AuthenticatedRequest, @Query() query: MyNotificationDropdownQueryDto) {
    const limit = Math.min(
      query.limit ?? MY_NOTIFICATION_DROPDOWN_LIMIT_DEFAULT,
      MY_NOTIFICATION_DROPDOWN_LIMIT_MAX,
    );
    return this.service.dropdown(
      req.user.companyId,
      req.user.id,
      limit,
      query.unread_only ?? false,
    );
  }

  /** NOTI-API-003 — GET /notifications/unread-count (partial index, không scan bảng). */
  @Get("unread-count")
  @RequirePermission(READ_NOTIFICATION.action, READ_NOTIFICATION.resourceType, {
    isSensitive: READ_NOTIFICATION.sensitive,
  })
  unreadCount(@Req() req: AuthenticatedRequest) {
    return this.service.unreadCount(req.user.companyId, req.user.id);
  }

  /** NOTI-API-004 — GET /notifications/:id (chi tiết; auto_mark_read=true → mark Read nếu đang Unread). */
  @Get(":id")
  @RequirePermission(READ_NOTIFICATION.action, READ_NOTIFICATION.resourceType, {
    isSensitive: READ_NOTIFICATION.sensitive,
  })
  detail(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Query() query: MyNotificationDetailQueryDto,
  ) {
    return this.service.detail(req.user.companyId, req.user.id, id, query.auto_mark_read ?? false);
  }

  /** NOTI-API-101 — POST /notifications/:id/mark-read (idempotent). */
  @Post(":id/mark-read")
  @HttpCode(200)
  @RequirePermission(MARK_READ_NOTIFICATION.action, MARK_READ_NOTIFICATION.resourceType, {
    isSensitive: MARK_READ_NOTIFICATION.sensitive,
  })
  markRead(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.service.markRead(req.user.companyId, req.user.id, id);
  }

  /** NOTI-API-103 — POST /notifications/mark-all-read (bulk, filter tùy chọn). */
  @Post("mark-all-read")
  @HttpCode(200)
  @RequirePermission(MARK_ALL_READ_NOTIFICATION.action, MARK_ALL_READ_NOTIFICATION.resourceType, {
    isSensitive: MARK_ALL_READ_NOTIFICATION.sensitive,
  })
  markAllRead(@Req() req: AuthenticatedRequest, @Body() body: MarkAllNotificationsReadDto) {
    return this.service.markAllRead(req.user.companyId, req.user.id, body);
  }

  /** NOTI-API-106 — DELETE /notifications/:id (soft-delete, BẤT BIẾN #2 — KHÔNG hard-delete). */
  @Delete(":id")
  @HttpCode(204)
  @RequirePermission(DELETE_NOTIFICATION.action, DELETE_NOTIFICATION.resourceType, {
    isSensitive: DELETE_NOTIFICATION.sensitive,
  })
  async remove(@Req() req: AuthenticatedRequest, @Param("id") id: string): Promise<void> {
    await this.service.remove(req.user.companyId, req.user.id, id);
  }
}
