import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe, createZodDto } from "nestjs-zod";
import type { Request } from "express";
import { internalEventIntakeSchema, type IntakeSummary } from "@mediaos/contracts";
import { InternalGuard } from "../permission/guards/internal.guard";
import { NotificationEngineService } from "./notification-engine.service";

/**
 * DTO HTTP cho `POST /internal/v1/notifications/events`. `internalEventIntakeSchema` CỐ Ý KHÔNG có
 * `company_id` (contracts/notification.ts) — company_id lấy TỪ TOKEN, không từ body. Zod strip mọi key lạ
 * (schema không `.strict()`), nên nếu client vẫn nhét `company_id`/`companyId` thì nó bị loại khỏi `dto`
 * NHƯNG vẫn còn trên `req.body` thô ⇒ controller kiểm mismatch ở đó (assertBodyCompanyMatchesToken).
 */
export class EventIntakeRequestDto extends createZodDto(internalEventIntakeSchema) {}

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * 400 khi body mang company_id khác token. Mã cục bộ (không thuộc NOTI_ENGINE_ERR — engine chỉ quản 3 mã
 * loud của pipeline). Trust-boundary controller-level: cross-tenant spoof qua body bị chặn TRƯỚC khi vào
 * engine. `.code` được AllExceptionsFilter surface (payload {code,message}).
 */
const COMPANY_MISMATCH_CODE = "NOTI-ERR-COMPANY-MISMATCH";

/**
 * S4-NOTI-BE-2 (L3-http) — POST /internal/v1/notifications/events: đường HTTP nội bộ cho engine intake
 * (job/service khác đẩy 1 event nghiệp vụ đã chuẩn hoá → notifications IN_APP + delivery_log). Mẫu duyệt:
 * attendance/attendance-internal.controller.ts.
 *
 * TRUST BOUNDARY (CROWN — docs/plans/S4-NOTI-BE-2.md §3):
 *  - KHÔNG `@Public()`. `JwtAuthGuard` là APP_GUARD toàn cục (app.module.ts) ⇒ thiếu Bearer → 401 TRƯỚC khi
 *    tới InternalGuard. `CompanyGuard` (toàn cục) nạp `req.user.companyId`.
 *  - `InternalGuard` (controller-level) đòi `x-internal-key` khớp `INTERNAL_API_KEY` (env) — thiếu/sai/env
 *    unset → 403 (fail-closed). Defense-in-depth: cần CẢ JWT hợp lệ VÀ internal key.
 *  - company_id spoof-proof: engine chạy `withTenant(req.user.companyId)` (BẤT BIẾN #1), KHÔNG lấy từ body;
 *    body mang company_id khác token → 400. RLS FORCE khiến recipient company khác vô hình (resolve 0 row).
 *
 * FIRE-AND-FORGET: event disabled / 0 recipient / dedupe hit → 200 + summary (KHÔNG ném lỗi). Chỉ 3 nhánh
 * loud từ engine: eventCode không tồn tại (404), target_url ngoài (422), payload nhạy cảm (400).
 *
 * OUT OF SCOPE (đẩy S4-NOTI-BE-3): `POST /internal/v1/notifications/send` (direct-send single-shot,
 * `internalDirectSendSchema`) + 2 mã treo 422 NOTI-ERR-EVENT-DISABLED / 409 NOTI-ERR-DEDUPE-CONFLICT
 * (SPEC-08 §19) — chúng thuộc `/send`, KHÔNG có deny-path ở BE-2 (docs/plans/S4-NOTI-BE-2.md §6.4).
 */
@Controller("internal/v1/notifications")
@UseGuards(InternalGuard)
@UsePipes(ZodValidationPipe)
export class InternalNotificationsController {
  constructor(private readonly engine: NotificationEngineService) {}

  @Post("events")
  @HttpCode(200)
  async intake(
    @Req() req: AuthenticatedRequest,
    @Body() dto: EventIntakeRequestDto,
  ): Promise<IntakeSummary> {
    this.assertBodyCompanyMatchesToken(req);
    // company_id TỪ TOKEN (không từ body) — engine tự mở withTenant(companyId).
    return this.engine.intake(req.user.companyId, dto);
  }

  /**
   * Nếu client gửi kèm `company_id`/`companyId` trong body và KHÁC token → 400 (cross-tenant spoof). Đọc
   * `req.body` THÔ (Zod đã strip khỏi `dto` nên chỉ còn ở đây). Không echo giá trị client vào message.
   */
  private assertBodyCompanyMatchesToken(req: AuthenticatedRequest): void {
    const rawBody = (req.body ?? {}) as Record<string, unknown>;
    const bodyCompanyId = rawBody["company_id"] ?? rawBody["companyId"];
    if (bodyCompanyId !== undefined && bodyCompanyId !== req.user.companyId) {
      throw new BadRequestException({
        code: COMPANY_MISMATCH_CODE,
        message: "company_id lấy từ token, không được truyền trong body",
      });
    }
  }
}
