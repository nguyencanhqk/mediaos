import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import { type Observable, map } from "rxjs";
import { isPaginated } from "../pagination";

/**
 * Bọc mọi phản hồi thành công vào envelope chuẩn (packages/contracts: apiResponseSchema):
 *   { success:true, message:"OK", data, error:null, meta:{request_id,timestamp} }
 * Lỗi do AllExceptionsFilter bọc thành { success:false, message, data:null, error, meta }.
 *
 * Phân trang (API-01 §16.1): handler trả `paginated(data, pagination)` (tagged) → HOIST `pagination` lên
 * cấp ĐỈNH (sibling của data/meta), KHÔNG nhét vào `meta`. Tag bằng Symbol nên endpoint thường KHÔNG bị
 * ảnh hưởng (additive). `data` lấy từ result.data; mọi response khác wrap như cũ.
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
      map((result: unknown) => {
        const meta = { request_id: requestId, timestamp: new Date().toISOString() };
        if (isPaginated(result)) {
          return {
            success: true,
            message: "OK",
            data: result.data ?? null,
            error: null,
            meta,
            pagination: result.pagination,
          };
        }
        return { success: true, message: "OK", data: result ?? null, error: null, meta };
      }),
    );
  }
}
