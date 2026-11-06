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
import { retryAfterHeaderValue } from "./retry-after";
import { extractZodIssues, zodIssuesToDetails } from "./zod-issue-rule";

/** Trần bóc lồng (ZodValidationException gói ZodValidationException…) — chống vòng lạ. */
const MAX_UNWRAP = 4;

/**
 * S19-OPS-ZOD4-1 — vá FULL gate (plan §10.8). nestjs-zod 5.5.0 `validate()` (mà `ZodValidationPipe.transform` gọi)
 * là `try { schema.parse(v) } catch (e) { throw new ZodValidationException(e) }` ⇒ MỌI lỗi ném từ transform/refine
 * (ForbiddenException, TypeError…) thành 400 không details. nestjs-zod 4.3.1 cho lỗi không-phải-ZodError đi xuyên.
 * Ở đây khôi phục hành vi đó: không có issues mà lỗi gói bên trong là `Error` (kể cả HttpException) ⇒ trả về lỗi
 * đó để filter xử lý như chính nó (HttpException ⇒ đúng status/code; Error khác ⇒ 500 + log stack). Có issues,
 * hoặc bên trong không phải Error ⇒ giữ ZodValidationException (400).
 */
export function unwrapZodWrapped(exception: unknown): unknown {
  let current = exception;
  for (let i = 0; i < MAX_UNWRAP; i++) {
    if (!(current instanceof ZodValidationException)) return current;
    const inner = current.getZodError();
    if (extractZodIssues(inner) !== null || !(inner instanceof Error)) return current;
    current = inner;
  }
  return current;
}

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

    // Bóc lỗi mà nestjs-zod 5 gói nhầm thành ZodValidationException (xem `unwrapZodWrapped`). Từ đây mọi
    // nhánh (status, code, log stack) làm việc trên lỗi THẬT — TypeError ra 500 kèm stack của chính nó.
    const effective = unwrapZodWrapped(exception);
    const { status, code, message, type, details } = this.resolve(effective);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Server-side ONLY. Chỉ log method + PATH (đã bỏ query-string) + status + code + req-id.
      // Headers (Authorization/Cookie/CSRF) KHÔNG đi vào log.
      const path = (request?.url ?? "").split("?")[0];
      this.logger.error(
        `${request?.method ?? "-"} ${path} -> ${status} [${code}] req=${requestId || "-"}${
          effective === exception ? "" : " (ném từ transform/refine của schema zod)"
        }`,
        effective instanceof Error ? effective.stack : String(effective),
      );
    }

    // ⟲ S18-AUTH-RETRYAFTER-1 — `Retry-After` PHẢI đặt ở ĐÂY, trên chính `response` sắp ghi.
    // KHÔNG dùng `@Header('Retry-After')` ở controller: decorator đó dán nhãn cho phản hồi THÀNH CÔNG;
    // đường ném đi qua filter này nên header sẽ không bao giờ tới (memory nest-header-decorator-mislabels-errors).
    // Giá trị suy TỪ `details` đã lọc ở trên ⇒ body và header không thể lệch nhau. Header chỉ thuộc về
    // 429; mọi status khác mang detail y hệt vẫn KHÔNG được đặt header.
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      const retryAfter = retryAfterHeaderValue(details);
      if (retryAfter !== null) response.setHeader("Retry-After", retryAfter);
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
      // nestjs-zod 5: getZodError() trả `unknown` ⇒ thu hẹp theo HÌNH DẠNG (issues là mảng), không instanceof.
      // Không có issues (và bên trong KHÔNG phải Error — Error đã được `unwrapZodWrapped` bóc ra ở catch())
      // ⇒ 400 không details.
      const details = zodIssuesToDetails(exception.getZodError());
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
      // VALIDATE HÌNH DẠNG Ở RUNTIME, KHÔNG ép kiểu mù. Đây là filter @Catch() TOÀN CỤC: một caller
      // tương lai lỡ nhét `err` đã bắt, một hàng DB, hay body request vào `details` sẽ tuồn nguyên
      // vật ra client trên KHẮP repo. Chỉ cho qua đúng {field, message, rule} dạng chuỗi; phần tử
      // không đúng hình dạng bị LOẠI (không nuốt cả mảng — vẫn trả những phần tử hợp lệ).
      const rawDetails =
        status < HttpStatus.INTERNAL_SERVER_ERROR &&
        typeof payload === "object" &&
        payload !== null &&
        "details" in payload
          ? (payload as { details: unknown }).details
          : null;
      const payloadDetails: ErrorDetail[] | null = Array.isArray(rawDetails)
        ? rawDetails.filter(
            (d): d is ErrorDetail =>
              typeof d === "object" &&
              d !== null &&
              typeof (d as ErrorDetail).field === "string" &&
              typeof (d as ErrorDetail).message === "string" &&
              typeof (d as ErrorDetail).rule === "string",
          )
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
