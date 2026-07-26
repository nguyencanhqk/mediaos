import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe, createZodDto } from "nestjs-zod";
import { internalEventIntakeSchema, type IntakeSummary } from "@mediaos/contracts";
import { Public } from "../permission/public.decorator";
import { LMS_SERVICE_EVENT_CODES } from "../foundation/seed/notification-event-catalog.const";
import { NotificationEngineService } from "./notification-engine.service";
import { LmsServiceIntakeGuard, type LmsServiceRequest } from "./lms-service-intake.guard";

/** DTO HTTP — DÙNG LẠI y nguyên `internalEventIntakeSchema` (không có `company_id`, đúng chủ đích). */
export class LmsEventIntakeRequestDto extends createZodDto(internalEventIntakeSchema) {}

/** Body nêu company_id (dù đúng hay sai) → 400. Máy KHÔNG được nêu ý kiến về tenant. */
const COMPANY_IN_BODY_CODE = "NOTI-ERR-COMPANY-IN-BODY";
/** eventCode ngoài allowlist LMS → 403 (khác 404 "không tồn tại": mã có thể tồn tại nhưng không thuộc LMS). */
const EVENT_NOT_ALLOWED_CODE = "NOTI-ERR-EVENT-NOT-ALLOWED";
/** Thiếu `dedupeKey` → 400: caller MÁY phải tự chịu trách nhiệm idempotency (xem `assertDedupeKey`). */
const DEDUPE_KEY_REQUIRED_CODE = "NOTI-ERR-DEDUPE-KEY-REQUIRED";
/** Quá nhiều người nhận trong 1 request → 400 (xem `assertRecipientCount`). */
const TOO_MANY_RECIPIENTS_CODE = "NOTI-ERR-TOO-MANY-RECIPIENTS";

/**
 * Trần người nhận CHO RIÊNG kênh máy. Sự kiện học tập là chuyện của MỘT người học (ghi danh của bạn được
 * duyệt, bài thi của bạn được chấm) ⇒ thực tế luôn là 1. `internalEventRecipientSchema` KHÔNG chặn độ dài
 * mảng, mà engine thì lặp per-recipient (SAVEPOINT + INSERT notification + INSERT delivery_log + audit)
 * TRONG MỘT transaction — nên một mảng khổng lồ từ khoá bị lộ là đòn khuếch đại rẻ tiền. 20 là rộng rãi
 * so với nhu cầu thật mà vẫn chặn được kiểu lạm dụng đó.
 */
const MAX_RECIPIENTS_PER_REQUEST = 20;

/**
 * S5-LMS-NOTI-1 (🔴 CROWN) — `POST /internal/v1/notifications/lms-events`: đường intake cho MỘT caller
 * MÁY ở NGOÀI tiến trình api (LMS/fmc-app). Song song, KHÔNG thay thế
 * `InternalNotificationsController` (route JWT + x-internal-key vẫn nguyên vẹn cho caller trong-tiến-trình).
 *
 * TRUST BOUNDARY (docs/plans/S5-LMS-NOTI-1.md §2):
 *  - `@Public()` — CỐ Ý: không có JWT người dùng nào để trình. Đổi lại, `LmsServiceIntakeGuard` là hàng rào
 *    DUY NHẤT và fail-closed ở mọi nhánh (thiếu env · sai token · vượt hạn mức).
 *  - `company_id` lấy từ `req.lmsService.companyId` (env LMS_COMPANY_ID, server-side) — BẤT BIẾN #1. Body
 *    mang `company_id` → 400 NGAY, kể cả khi giá trị TRÙNG: chấp nhận nó sẽ dạy caller thói quen tự khai
 *    tenant, và ngày nào đó một caller khác sẽ khai sai.
 *  - Allowlist eventCode suy từ `NOTI_EVENT_CATALOG` (module 'LMS' + enabled) — least privilege: khoá LMS
 *    bị lộ vẫn KHÔNG mint được mã `LEAVE_` · `HR_` · `AUTH_`.
 *  - `actorUserId` do LMS gửi được GIỮ: engine cần nó để loại actor khỏi recipient (người tự duyệt không
 *    tự nhận thông báo). Nó chỉ ảnh hưởng exclusion + audit attribution, không mở rộng phạm vi dữ liệu.
 *
 * FIRE-AND-FORGET giống route cũ: event disabled / 0 recipient / dedupe hit → 200 + summary. Nhánh loud từ
 * engine: eventCode không tồn tại (404), target_url ngoài (422), payload nhạy cảm (400).
 */
@Controller("internal/v1/notifications")
@Public()
@UseGuards(LmsServiceIntakeGuard)
@UsePipes(ZodValidationPipe)
export class LmsNotificationsController {
  constructor(private readonly engine: NotificationEngineService) {}

  @Post("lms-events")
  @HttpCode(200)
  async intake(
    @Req() req: LmsServiceRequest,
    @Body() dto: LmsEventIntakeRequestDto,
  ): Promise<IntakeSummary> {
    // Guard đã gắn; nếu thiếu thì có ai đó tháo guard khỏi controller ⇒ fail-closed, KHÔNG đoán tenant.
    const companyId = req.lmsService?.companyId;
    if (!companyId) {
      throw new ForbiddenException("Kênh thông báo LMS: thiếu ngữ cảnh công ty");
    }

    this.assertNoCompanyInBody(req);
    this.assertEventAllowed(dto.eventCode);
    this.assertDedupeKey(dto.dedupeKey);
    this.assertRecipientCount(dto.recipient);

    return this.engine.intake(companyId, dto);
  }

  /**
   * Zod strip key lạ khỏi `dto` (schema không `.strict()`), nên `company_id` client gửi CHỈ còn trên
   * `req.body` thô — kiểm ở đây. KHÔNG echo giá trị client vào message.
   */
  private assertNoCompanyInBody(req: LmsServiceRequest): void {
    const rawBody = (req.body ?? {}) as Record<string, unknown>;
    if (rawBody["company_id"] !== undefined || rawBody["companyId"] !== undefined) {
      throw new BadRequestException({
        code: COMPANY_IN_BODY_CODE,
        message: "company_id ghim từ cấu hình máy chủ — không được truyền trong body",
      });
    }
  }

  /** Ngoài allowlist → 403 TRƯỚC khi chạm DB. Echo eventCode an toàn (giá trị do caller gửi, không phải secret). */
  private assertEventAllowed(eventCode: string): void {
    if (!LMS_SERVICE_EVENT_CODES.has(eventCode)) {
      throw new ForbiddenException({
        code: EVENT_NOT_ALLOWED_CODE,
        message: `Kênh thông báo LMS không được phép đẩy sự kiện: ${eventCode}`,
      });
    }
  }

  /**
   * `dedupeKey` BẮT BUỘC trên kênh máy (schema chung để optional vì caller in-process có strategy khác).
   * 4 event LMS seed `dedupe_strategy='DedupeKey'` (mig 0529) ⇒ THIẾU khoá thì engine tính ra `null` và
   * dedupe TẮT IM LẶNG: mỗi lần LMS retry (mạng chập, double-submit) lại đẻ thêm một thông báo mà không ai
   * thấy gì sai. Chặn ở đây để "quên gửi khoá" là lỗi ỒN ÀO 400, không phải hỏng thầm lặng.
   */
  private assertDedupeKey(dedupeKey: string | undefined): void {
    if (!dedupeKey) {
      throw new BadRequestException({
        code: DEDUPE_KEY_REQUIRED_CODE,
        message:
          "dedupeKey bắt buộc trên kênh máy — cần khoá ổn định để retry không tạo thông báo trùng",
      });
    }
  }

  /** Trần người nhận (xem `MAX_RECIPIENTS_PER_REQUEST`) — đếm CẢ hai mode vì engine resolve cả hai. */
  private assertRecipientCount(recipient: { userIds: string[]; employeeIds: string[] }): void {
    const total = recipient.userIds.length + recipient.employeeIds.length;
    if (total > MAX_RECIPIENTS_PER_REQUEST) {
      throw new BadRequestException({
        code: TOO_MANY_RECIPIENTS_CODE,
        message: `Kênh thông báo LMS: tối đa ${MAX_RECIPIENTS_PER_REQUEST} người nhận mỗi lần gọi (nhận ${total})`,
      });
    }
  }
}
