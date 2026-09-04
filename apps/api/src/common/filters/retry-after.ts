import { HttpException, HttpStatus } from "@nestjs/common";
import type { ErrorDetail } from "@mediaos/contracts";

/**
 * ⟲ S18-AUTH-RETRYAFTER-1 — HỢP ĐỒNG 429 duy nhất: body `error.details[0].retryAfterSec` + header
 * `Retry-After`.
 *
 * VÌ SAO ĐẶT CẠNH `all-exceptions.filter.ts`: đây là HAI NỬA của cùng một hợp đồng — nửa SINH `details`
 * (service gọi `tooManyRequests`) và nửa DỊCH `details` → header (filter gọi `retryAfterHeaderValue`).
 * Tách sang `common/errors/` sẽ để nửa header mồ côi ở một file khác, và không nửa nào đọc được nửa kia
 * khi đổi.
 *
 * VÌ SAO HEADER SUY *TỪ* `details` chứ không truyền song song: một nguồn ⇒ body và header không thể
 * lệch nhau. Ai bỏ `details` mà quên header thì header tự biến mất theo.
 *
 * ⚠️ Header này KHÔNG tới được trình duyệt: `main.ts` gọi `enableCors()` mà KHÔNG khai `exposedHeaders`,
 * và `Retry-After` không nằm trong 7 header CORS-safelisted ⇒ `fetch` cross-origin của `apps/auth` không
 * thấy nó. Header phục vụ hạ tầng (proxy/cloudflared/`curl`); ĐƯỜNG TẢI THẬT CHO FE LÀ BODY.
 */

/** Tên field trong `ErrorDetail` — FE (`retryAfterSecFromError`) khớp đúng chuỗi này. */
export const RETRY_AFTER_FIELD = "retryAfterSec";

/** `rule` phân biệt detail này với detail của lỗi khác. FE khớp CẢ `field` LẪN `rule`. */
export const RETRY_AFTER_RULE = "retry-after";

/** Câu chữ 429 — GIỮ NGUYÊN từ trước WO này để `message` của envelope không đổi một ký tự. */
export const TOO_MANY_REQUESTS_MESSAGE = "Quá nhiều lần thử. Vui lòng thử lại sau.";

/**
 * Trần giây chấp nhận (1 ngày). RFC 9110 §10.2.3 chỉ cho delta-seconds nguyên không âm; `0` nghĩa là
 * "thử ngay" trong khi ta đang ném 429 nên cũng bị loại.
 *
 * ⚠️ NỢ ĐÃ BIẾT (R7): `LOGIN_LOCKOUT_SEC` KHÔNG có `.max()` ở `env.schema.ts`. Ops đặt khoá > 86400s
 * thì `retryAfterSec` bị loại câm và FE rơi về chuỗi cũ TRONG KHI KHOÁ LÀ THẬT. Chấp nhận vì fail-safe
 * đúng chiều (mất tiện ích hiển thị, không mất control) — ghi ở đây để người sau không mất một buổi truy.
 */
export const RETRY_AFTER_MAX_SEC = 86_400;

/** Số giây hợp lệ theo RFC 9110 §10.2.3 + trần nội bộ; ngược lại `null`. */
function validSec(sec: number): number | null {
  return Number.isInteger(sec) && sec > 0 && sec <= RETRY_AFTER_MAX_SEC ? sec : null;
}

/**
 * 429 chuẩn. `retryAfterSec === null` (Valkey rớt / hết TTL giữa chừng) hoặc số ngoài dải ⇒ KHÔNG khai
 * `details` — FE rơi về chuỗi cũ, KHÔNG hiện "0 giây", KHÔNG ném.
 *
 * BA RÀNG BUỘC CỨNG — mỗi cái là một hợp đồng câm nếu phá:
 *  1. TRẢ `new HttpException(...)` TRỰC TIẾP, không phải lớp con. Envelope lấy `type: exception.name`
 *     (`all-exceptions.filter.ts:124`); một lớp con sẽ đổi `type` của API mà không ai thấy.
 *  2. Payload KHÔNG có khoá `code`. `payloadCode` thắng `httpStatusToCode` (`filter:88-92`) ⇒ khai
 *     `code` sẽ đẩy 429 ra khỏi `SYSTEM-ERR-RATE-LIMIT`.
 *  3. Payload LUÔN có `message: string`. Nest `initMessage()` chỉ lấy `message` khi payload là object
 *     có field đó; payload `{}` cho `exception.message` = tên lớp.
 */
export function tooManyRequests(retryAfterSec: number | null): HttpException {
  const sec = retryAfterSec === null ? null : validSec(retryAfterSec);
  const payload =
    sec === null
      ? { message: TOO_MANY_REQUESTS_MESSAGE }
      : {
          message: TOO_MANY_REQUESTS_MESSAGE,
          details: [
            { field: RETRY_AFTER_FIELD, message: String(sec), rule: RETRY_AFTER_RULE },
          ] satisfies ErrorDetail[],
        };
  return new HttpException(payload, HttpStatus.TOO_MANY_REQUESTS);
}

/**
 * Bóc số giây hợp lệ ra khỏi `details` để đặt header `Retry-After`. `null` ⇒ KHÔNG đặt header.
 * Khớp CẢ `field` LẪN `rule` để không nhận nhầm detail của lỗi khác cùng ném kèm.
 */
export function retryAfterHeaderValue(details: ErrorDetail[] | null): string | null {
  if (details === null) return null;
  const hit = details.find((d) => d.field === RETRY_AFTER_FIELD && d.rule === RETRY_AFTER_RULE);
  if (hit === undefined) return null;
  // `/^\d+$/` TRƯỚC parseInt: `parseInt` nuốt hậu tố ("9 00" → 9, "1.5" → 1) ⇒ header sẽ nói dối.
  if (!/^\d+$/.test(hit.message)) return null;
  const sec = validSec(Number.parseInt(hit.message, 10));
  return sec === null ? null : String(sec);
}
