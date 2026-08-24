import {
  confirmUploadInputSchema,
  linkFileInputSchema,
  uploadFileInputSchema,
} from "@mediaos/contracts";
import { createZodDto } from "nestjs-zod";

/**
 * S10-FND-BODYVALIDATE-1 (KI-068) — DTO suy ra TỪ contracts (Zod = nguồn sự thật), validate input Ở BIÊN.
 *
 * VÌ SAO FILE NÀY MỚI CÓ: xem docblock `api-keys/api-keys.dto.ts`. Ba route GHI của `foundation/files`
 * dính CÙNG cơ chế và đã được ĐO bằng HTTP thật ở `test/integration/files-http-validate.int-spec.ts`
 * (trước bản vá: 500 + `error.type='ZodError'` cho cả ba).
 */

/** POST /foundation/files/upload — metadata pha 1. */
export class UploadFileDto extends createZodDto(uploadFileInputSchema) {}

/**
 * POST /foundation/files/:id/confirm — body **RỖNG là HỢP LỆ** (`fileId` lấy từ route).
 * `confirmUploadInputSchema` chỉ có `checksumSha256` optional ⇒ `{}` parse được. Ca ALLOW ghim điều này;
 * đừng "siết cho chặt" bằng cách thêm field bắt buộc — sẽ phá hợp đồng client.
 */
export class ConfirmUploadDto extends createZodDto(confirmUploadInputSchema) {}

/**
 * POST /foundation/files/:id/links — ⚠️ ĐIỂM PHẢI NGHĨ, KHÔNG ĐƯỢC CHÉP (plan §6).
 *
 * `linkFileInputSchema` đòi `fileId` BẮT BUỘC, nhưng client hợp lệ **KHÔNG gửi `fileId` trong body**:
 * handler ép nó từ `:id` của route (chống nhầm/lừa fileId khác). Nếu DTO class validate body THÔ theo
 * schema đầy đủ thì mọi request hợp lệ sẽ ăn **400** — bản vá tự đẻ hồi quy.
 *
 * ⇒ DTO ở BIÊN bỏ `fileId` ra (`.omit`); handler vẫn `.parse()` schema ĐẦY ĐỦ sau khi ép `fileId` từ
 * route. Hai lớp có vai trò KHÁC nhau, không phải trùng lặp:
 *   - biên: bắt sai hợp đồng của phần client THỰC SỰ gửi → 400 đúng chuẩn;
 *   - handler: chốt bất biến "fileId của body = :id của route" → không lớp nào ở biên thay được.
 *
 * Ca `ALLOW đối chứng: POST files/:id/links KHÔNG có fileId trong body` là thứ canh chừng quyết định
 * này. Đừng xoá, đừng nới.
 */
export class LinkFileDto extends createZodDto(linkFileInputSchema.omit({ fileId: true })) {}
