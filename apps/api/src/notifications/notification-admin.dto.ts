import { createZodDto } from "nestjs-zod";
import {
  notificationDeliveryLogAdminQuerySchema,
  notificationEventAdminPatchSchema,
  notificationEventAdminQuerySchema,
  notificationTemplateAdminPatchSchema,
} from "@mediaos/contracts";

/**
 * S4-NOTI-BE-3/BE-4 — nestjs-zod DTO classes cho Notification ADMIN config (xem
 * notification-admin.controller.ts). `@UsePipes(ZodValidationPipe)` (bare, ở controller) đọc metadata
 * `createZodDto` gắn trên các class này — mirror my-notifications.dto.ts.
 */
export class NotificationEventAdminQueryDto extends createZodDto(
  notificationEventAdminQuerySchema,
) {}
export class NotificationDeliveryLogAdminQueryDto extends createZodDto(
  notificationDeliveryLogAdminQuerySchema,
) {}
// BE-4 (write): body PATCH events/{id} + templates/{id}.
export class NotificationEventAdminPatchDto extends createZodDto(
  notificationEventAdminPatchSchema,
) {}
export class NotificationTemplateAdminPatchDto extends createZodDto(
  notificationTemplateAdminPatchSchema,
) {}
