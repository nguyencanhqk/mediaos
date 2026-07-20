import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { ErrorDetail } from "@mediaos/contracts";
import type { Request, Response } from "express";
import { ZodValidationException } from "nestjs-zod";
import { ERROR_CODES, httpStatusToCode } from "../errors/error-codes";

interface ResolvedError {
  status: number;
  code: string;
  message: string;
  type: string;
  details: ErrorDetail[] | null;
}

/**
 * Bọc MỌI lỗi thành envelope chuẩn (API-01 §12):
 *   { success:false, message, data:null, error:{code,type,details}, meta:{request_id,timestamp} }
 *
 * BẤT BIẾN #3 (no-secret-plaintext):
 *  - KHÔNG log header (Authorization/Cookie/CSRF không bao giờ đi vào log) và STRIP query-string
 *    khỏi URL khi log (token có thể nằm ở `?token=...`).
 *  - 5xx KHÔNG lộ stack/chi tiết nội bộ ra client (chỉ log server-side).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request?.requestId ?? "";

    const { status, code, message, type, details } = this.resolve(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Server-side ONLY. Chỉ log method + PATH (đã bỏ query-string) + status + code + req-id.
      // Headers (Authorization/Cookie/CSRF) KHÔNG đi vào log.
      const path = (request?.url ?? "").split("?")[0];
      this.logger.error(
        `${request?.method ?? "-"} ${path} -> ${status} [${code}] req=${requestId || "-"}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      success: false,
      message,
      data: null,
      error: { code, message, type, details },
      meta: { request_id: requestId, timestamp: new Date().toISOString() },
    });
  }

  /** Phân giải exception → status + mã lỗi chuẩn + details (nếu validation). */
  private resolve(exception: unknown): ResolvedError {
    // 1) Validation (Zod) — PHẢI bắt TRƯỚC nhánh HttpException: ZodValidationException extends
    //    BadRequestException (status 400) nên sẽ bị map generic nếu không branch riêng ở đây.
    if (exception instanceof ZodValidationException) {
      const details: ErrorDetail[] = exception.getZodError().issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
        rule: issue.code,
      }));
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ERROR_CODES.VALIDATION,
        message: "Dữ liệu không hợp lệ",
        type: exception.name,
        details,
      };
    }

    // 2) HttpException — status + code (ưu tiên code trong payload nếu hợp lệ).
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      // AN TOÀN: `payload.code` CHỈ được tin vì mọi caller đặt nó bằng HẰNG SỐ phía server
      // (vd ACCESS_RESTRICTED_CODE, TWO_FACTOR_SETUP_REQUIRED). TUYỆT ĐỐI không nội suy dữ liệu
      // request vào `code`/`message` của HttpException — sẽ lộ ra client.
      const payloadCode =
        typeof payload === "object" && payload !== null && "code" in payload
          ? String((payload as { code: unknown }).code)
          : null;
      const code = payloadCode ?? httpStatusToCode(status);
      // 5xx: KHÔNG lộ message chi tiết ra client. 4xx: message hiển thị cho client (UI) →
      // caller KHÔNG được nhét secret/internal-id vào message của lỗi 4xx.
      const message =
        status >= HttpStatus.INTERNAL_SERVER_ERROR ? "Lỗi hệ thống" : exception.message;
      // `details` OPT-IN, KHÔNG mặc định: chỉ đi ra client khi caller đặt TƯỜNG MINH `details` trong
      // payload VÀ lỗi là 4xx. Trước đây hard-code null ⇒ mọi payload cấu trúc bị nuốt câm (phát hiện
      // khi int-spec của S5-TASK-SUBTASK-1 assert `blocked[]` của 403 xoá-lan không bao giờ tới nơi).
      // RÀNG BUỘC CHO CALLER (giống ràng buộc đã ghi cho `code`/`message` ở trên): chỉ đặt vào `details`
      // dữ liệu mà actor ĐÃ có quyền đọc — filter KHÔNG lọc quyền hộ. 5xx thì bỏ qua hoàn toàn để
      // không rò nội tại; payload không khai `details` thì giữ nguyên hành vi cũ (null).
      const payloadDetails =
        status < HttpStatus.INTERNAL_SERVER_ERROR &&
        typeof payload === "object" &&
        payload !== null &&
        "details" in payload
          ? ((payload as { details: unknown }).details as ErrorDetail[] | null)
          : null;
      return { status, code, message, type: exception.name, details: payloadDetails };
    }

    // 3) Lỗi không xác định → 500 generic (không lộ chi tiết).
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.SYSTEM,
      message: "Lỗi hệ thống",
      type: exception instanceof Error ? exception.name : "UnknownError",
      details: null,
    };
  }
}
