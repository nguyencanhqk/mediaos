import { createApiKeyRequestSchema } from "@mediaos/contracts";
import { createZodDto } from "nestjs-zod";

/**
 * S10-FND-BODYVALIDATE-1 (KI-068) — DTO suy ra TỪ contracts (Zod = nguồn sự thật), validate input Ở BIÊN.
 *
 * VÌ SAO FILE NÀY MỚI CÓ. Trước đây `api-keys.controller.ts` khai `@Body() dto: CreateApiKeyRequest` —
 * đó là **TYPE** (`z.infer`), bị xoá lúc chạy ⇒ metatype là `Object` ⇒ `ZodValidationPipe` (kể cả bản
 * `@UsePipes` CẤP CLASS) KHÔNG có schema để chiếu ⇒ body vào thẳng handler, handler tự `.parse()` ném
 * `ZodError` THÔ ⇒ `AllExceptionsFilter` không hiểu ⇒ **500 thay vì 400**.
 *
 * `createZodDto` trả về một CLASS THẬT ⇒ metatype tồn tại lúc chạy ⇒ pipe chiếu được. Đây là khuôn
 * chung của cây (233 class `createZodDto`); `api-keys` và `foundation/files` là hai module DUY NHẤT
 * từng thiếu file `*.dto.ts` — không phải ngoại lệ có chủ ý, chỉ là bỏ sót.
 */
export class CreateApiKeyDto extends createZodDto(createApiKeyRequestSchema) {}
