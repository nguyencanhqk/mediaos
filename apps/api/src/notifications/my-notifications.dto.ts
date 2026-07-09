import { createZodDto } from "nestjs-zod";
import {
  markAllNotificationsReadRequestSchema,
  myNotificationDetailQuerySchema,
  myNotificationDropdownQuerySchema,
  myNotificationListQuerySchema,
} from "@mediaos/contracts";

/**
 * S4-NOTI-BE-1 — nestjs-zod DTO classes cho My-Notification API. `@UsePipes(ZodValidationPipe)` (bare, ở
 * controller) đọc metadata `createZodDto` gắn trên các class này để validate — mirror leave.dto.ts.
 */
export class MyNotificationListQueryDto extends createZodDto(myNotificationListQuerySchema) {}
export class MyNotificationDropdownQueryDto extends createZodDto(
  myNotificationDropdownQuerySchema,
) {}
export class MyNotificationDetailQueryDto extends createZodDto(myNotificationDetailQuerySchema) {}
export class MarkAllNotificationsReadDto extends createZodDto(
  markAllNotificationsReadRequestSchema,
) {}
