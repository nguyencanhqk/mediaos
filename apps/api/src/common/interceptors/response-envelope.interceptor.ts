import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { type Observable, map } from "rxjs";

/**
 * Bọc mọi phản hồi thành công vào envelope chuẩn (packages/contracts: apiResponseSchema):
 *   { success: true, data, error: null }
 * Lỗi do AllExceptionsFilter bọc thành { success: false, data: null, error }.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data: unknown) => ({
        success: true,
        data: data ?? null,
        error: null,
      })),
    );
  }
}
