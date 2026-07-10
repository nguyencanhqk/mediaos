import { createZodDto } from "nestjs-zod";
import {
  notificationDeliveryLogAdminQuerySchema,
  notificationEventAdminQuerySchema,
} from "@mediaos/contracts";

/**
 * S4-NOTI-BE-3 — nestjs-zod DTO classes cho Notification ADMIN config (read-only, xem
 * notification-admin.controller.ts). `@UsePipes(ZodValidationPipe)` (bare, ở controller) đọc metadata
 * `createZodDto` gắn trên các class này — mirror my-notifications.dto.ts.
 */
export class NotificationEventAdminQueryDto extends createZodDto(
  notificationEventAdminQuerySchema,
) {}
export class NotificationDeliveryLogAdminQueryDto extends createZodDto(
  notificationDeliveryLogAdminQuerySchema,
) {}
