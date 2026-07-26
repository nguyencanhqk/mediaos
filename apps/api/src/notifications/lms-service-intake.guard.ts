import { timingSafeEqual } from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import type { Request } from "express";

/**
 * Ngữ cảnh danh tính MÁY gắn lên request sau khi guard PASS. CỐ Ý **KHÔNG** đặt `req.user`: caller là một
 * service, không phải người dùng — giả vờ có user sẽ khiến mọi lớp phía sau (audit actor, PermissionGuard,
 * masking) đọc nhầm một danh tính không tồn tại. Chỉ mang đúng thứ cần: company_id ghim từ CẤU HÌNH MÁY CHỦ.
 */
export interface LmsServiceContext {
  readonly companyId: string;
}

export type LmsServiceRequest = Request & { lmsService?: LmsServiceContext };

/** Hạn mức cửa sổ cố định cho kênh máy. LMS đẩy sự kiện lẻ theo hành vi người dùng ⇒ 120/phút là rộng rãi. */
const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * S5-LMS-NOTI-1 (🔴 CROWN — trust boundary) — LmsServiceIntakeGuard: danh tính SERVICE-TO-SERVICE cho
 * `POST /internal/v1/notifications/lms-events`. Route đó `@Public()` (không có JWT người dùng nào để trình),
 * nên guard NÀY là toàn bộ hàng rào — mọi nhánh fail-CLOSED.
 *
 * Vì sao không dùng đường sẵn có (docs/plans/S5-LMS-NOTI-1.md §2):
 *   • Route intake cũ đòi CẢ JWT người dùng lẫn `x-internal-key` — LMS là service, không có JWT người dùng.
 *   • Đường PAT (`mok_`) đã bị GỠ khỏi APP_GUARD ở CLEAN-DECOUPLE-1 ⇒ ngõ cụt.
 *   • Cấp cho LMS một tài khoản-người + mật khẩu là credential mạnh hơn nhiều so với nhu cầu.
 *
 * BẤT BIẾN #1 — `company_id` đến từ env `LMS_COMPANY_ID` (server-side), TUYỆT ĐỐI không từ body/header
 *   client. Engine vẫn mở `withTenant(companyId)` ⇒ RLS FORCE ẩn recipient tenant khác (resolve 0 hàng).
 * BẤT BIẾN #3 — `LMS_NOTI_TOKEN` chỉ đọc từ env; KHÔNG log, KHÔNG vào message lỗi, KHÔNG vào audit.
 *
 * Env đọc TẠI MỖI REQUEST (không cache vào field) — mirror `InternalGuard`: đổi/thu hồi token chỉ cần đổi
 * env + restart, và test bật/tắt được từng biến để chứng minh nhánh fail-closed.
 */
@Injectable()
export class LmsServiceIntakeGuard implements CanActivate {
  private readonly logger = new Logger(LmsServiceIntakeGuard.name);

  /** Cửa sổ hiện tại (đếm trong-tiến-trình). PROD chạy 1 tiến trình API — xem plan §2 "Residual". */
  private windowStartedAt = 0;
  private windowCount = 0;

  canActivate(ctx: ExecutionContext): boolean {
    const expected = process.env["LMS_NOTI_TOKEN"];
    const companyId = process.env["LMS_COMPANY_ID"];

    // Thiếu bất kỳ nửa nào của cấu hình ⇒ kênh COI NHƯ TẮT (403), KHÔNG bao giờ fail-open. Nói rõ THIẾU CÁI
    // GÌ trong log server (tên biến không phải secret) để người vận hành không phải đoán.
    if (!expected || !companyId) {
      this.logger.warn(
        `Kênh LMS→NOTI chưa cấu hình (thiếu ${!expected ? "LMS_NOTI_TOKEN" : ""}${!expected && !companyId ? " + " : ""}${!companyId ? "LMS_COMPANY_ID" : ""}) — fail-closed 403`,
      );
      throw new ForbiddenException("Kênh thông báo LMS chưa được cấu hình");
    }

    const req = ctx.switchToHttp().getRequest<LmsServiceRequest>();
    if (!this.bearerMatches(req, expected)) {
      throw new ForbiddenException("Kênh thông báo LMS: token không hợp lệ hoặc thiếu");
    }

    // Rate-limit SAU khi token đã đúng: request sai token bị chặn ở trên rồi, không cho phép người lạ
    // đốt hạn mức của LMS (biến 403 thành 429 cho caller hợp lệ).
    this.consumeRateLimit();

    req.lmsService = { companyId };
    return true;
  }

  /**
   * So `Authorization: Bearer <token>` HẰNG-THỜI-GIAN (mirror apps/lms/lib/platform/auth/server-token.ts).
   * So độ dài TRƯỚC là bắt buộc: `timingSafeEqual` NÉM khi hai buffer khác độ dài. Tên scheme không phân
   * biệt hoa/thường (RFC 7235 §2.1); chỉ phần token mới so chính xác.
   */
  private bearerMatches(req: Request, expected: string): boolean {
    const header = req.headers["authorization"];
    if (typeof header !== "string") return false;
    const token = /^bearer /i.test(header) ? header.slice(7) : "";
    const a = Buffer.from(token, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Cửa sổ cố định: vượt hạn mức → 429 (KHÔNG im lặng bỏ event — caller phải biết mà retry). */
  private consumeRateLimit(): void {
    const now = Date.now();
    if (now - this.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
      this.windowStartedAt = now;
      this.windowCount = 0;
    }
    this.windowCount++;
    if (this.windowCount > RATE_LIMIT_MAX) {
      this.logger.warn(
        `Kênh LMS→NOTI vượt hạn mức ${RATE_LIMIT_MAX}/${RATE_LIMIT_WINDOW_MS / 1000}s — trả 429`,
      );
      throw new HttpException(
        "Kênh thông báo LMS: vượt hạn mức, thử lại sau",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
