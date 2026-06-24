import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import { type Observable, map } from "rxjs";

/**
 * Bọc mọi phản hồi thành công vào envelope chuẩn (packages/contracts: apiResponseSchema):
 *   { success:true, message:"OK", data, error:null, meta:{request_id,timestamp} }
 * Lỗi do AllExceptionsFilter bọc thành { success:false, message, data:null, error, meta }.
 *
 * `request_id` đọc từ `req.requestId` (do requestIdMiddleware gán) qua ExecutionContext —
 * KHÔNG dùng interceptor REQUEST-scope (tránh tạo lại interceptor mỗi request).
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const requestId = request?.requestId ?? "";
    return next.handle().pipe(
      map((data: unknown) => ({
        success: true,
        message: "OK",
        data: data ?? null,
        error: null,
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
        },
      })),
    );
  }
}
