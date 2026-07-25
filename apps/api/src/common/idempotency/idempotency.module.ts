import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ValkeyService } from "../../permission/valkey.service";
import { IdempotencyStore } from "./idempotency-store.service";
import { IdempotencyInterceptor } from "./idempotency.interceptor";

/**
 * S5-BE-CONTRACT-1 (WS-D §13.2) — nối `IdempotencyInterceptor` vào chuỗi toàn cục.
 *
 * TỰ CUNG CẤP `ValkeyService` thay vì import `PermissionModule`: module này là LÁ (không phụ thuộc
 * nghiệp vụ), giữ nguyên như vậy để việc thêm nó vào AppModule KHÔNG tạo rủi ro vòng phụ thuộc —
 * DI hỏng ở AppModule sẽ làm ĐỎ DÂY CHUYỀN toàn bộ int-spec (bài học @SystemJobHandler). Giá phải trả
 * là một kết nối Valkey lazy thứ hai; `IdempotencyStore` nhận @Optional nên thiếu Valkey vẫn chạy
 * (fallback bộ nhớ).
 */
@Module({
  providers: [
    ValkeyService,
    IdempotencyStore,
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [IdempotencyStore],
})
export class IdempotencyModule {}
