import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * S4-INT-2 — DTO cho `POST /internal/v1/dashboard/cache/invalidate`. Zod local (KHÔNG @mediaos/contracts —
 * lane này KHÔNG chạm packages/contracts, mirror `tasks.dto.ts` pageQuerySchema cho DTO nội bộ/không FE-facing).
 *
 * `company_id` CỐ Ý KHÔNG có field — company lấy từ token (mirror `internalEventIntakeSchema` NOTI), controller
 * tự mở `withTenant(req.user.companyId)`. `userIds` optional: có ⇒ chỉ invalidate cache của đúng user đó (+
 * cache company-shared, user_id IS NULL) — KHÔNG đụng cache user khác ngoài phạm vi event; rỗng/vắng ⇒
 * invalidate TOÀN BỘ cache active của (các) widget liên quan trong company (fallback an toàn khi caller không
 * biết chính xác user bị ảnh hưởng, vd job quét TASK_OVERDUE nhiều assignee).
 */
export const dashboardCacheInvalidateRequestSchema = z.object({
  eventCode: z.string().trim().min(1).max(100),
  userIds: z.array(z.string().uuid()).max(500).optional(),
});

export class DashboardCacheInvalidateRequestDto extends createZodDto(
  dashboardCacheInvalidateRequestSchema,
) {}
