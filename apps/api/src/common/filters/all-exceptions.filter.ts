import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

/**
 * Bọc MỌI lỗi thành envelope { success:false, data:null, error:{ code, message } }.
 * Bảo mật (security.md): lỗi 5xx KHÔNG lộ chi tiết nội bộ ra client — chỉ log phía server.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let code = "INTERNAL_ERROR";
    let message = "Internal server error";
    if (isHttp) {
      const payload = exception.getResponse();
      message = exception.message;
      if (typeof payload === "object" && payload !== null && "code" in payload) {
        code = String((payload as { code: unknown }).code);
      } else {
        code = exception.name.replace(/Exception$/, "").toUpperCase() || "HTTP_ERROR";
      }
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      success: false,
      data: null,
      error: { code, message },
    });
  }
}
