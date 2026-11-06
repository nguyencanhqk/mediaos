import { z } from "zod";

/** Thông điệp cho ngày rác (mã issue vẫn `invalid_type`/expected `date` ⇒ `invalid_date` trên dây). */
const INVALID_DATE_MESSAGE = "Invalid date";

/**
 * S19-OPS-ZOD4-1 — C3a: thay `z.coerce.date()` (zod 3). Lý do: nestjs-zod 5 sinh OpenAPI bằng
 * `toJSONSchema()`; `z.coerce.date()` / `z.date()` KHÔNG biểu diễn được trong JSON Schema ⇒ NÉM
 * "Date cannot be represented in JSON Schema" lúc dựng tài liệu. Codec dưới đây có phía vào là
 * `string | number` (biểu diễn được) và phía ra là `Date`.
 *
 * Hành vi so với `z.coerce.date()` (đã đo 06/11/2026, zod 4.6.7):
 *   - chuỗi ngày / ISO / epoch-ms: kết quả Y HỆT (`new Date(v)`).
 *   - chuỗi rác `"nope"`, `""`: lỗi `invalid_type` expected `date` — như coerce (filter alias về `invalid_date`).
 *     Thông điệp đặt tường minh "Invalid date" (mặc định v4 là "expected date, received Date" — gây hiểu nhầm vì
 *     codec đã đổi chuỗi thành Date không hợp lệ).
 *   - KHÁC (cố ý, ghim ở `coerce-date.spec.ts`): `null` ⇒ `invalid_union` (coerce ra 1970-01-01);
 *     đối tượng `Date` truyền vào parse ⇒ `invalid_union` (coerce nhận). Mọi nơi dùng là ranh giới JSON/query
 *     (luôn là chuỗi) nên không ảnh hưởng; ai cần parse đối tượng Date phải `.toISOString()` trước.
 *   - CHỈ dùng ở phía INPUT hoặc chỗ không đi qua `toJSONSchema(io:"output")` (phía ra của codec vẫn là
 *     `z.date()` nên io "output" vẫn ném) — xem plan §10.5.
 *   - (i) KHÔNG dùng schema chứa coerceDate để parse HÀNG DB: cột timestamp ra đối tượng `Date` ⇒ bị từ chối
 *     (`invalid_union`). Schema đọc/serialize hàng DB dùng `z.date()` hoặc chuỗi ISO.
 *   - (ii) `.meta({ anyOf: undefined })` dựa vào cách zod gộp meta vào JSON Schema — phụ thuộc zod ghim CHÍNH XÁC
 *     4.6.7. Nâng zod ⇒ ca boot swagger `created_from` (`apps/api/test/foundation/swagger-boot-zod4.e2e-spec.ts`)
 *     và ca JSON Schema trong `coerce-date.spec.ts` canh giữ.
 */
export const coerceDate = () =>
  z
    .codec(z.union([z.string(), z.number()]), z.date({ error: INVALID_DATE_MESSAGE }), {
      decode: (v) => new Date(v),
      encode: (d) => d.toISOString(),
    })
    // Tài liệu OpenAPI: nestjs-zod/swagger làm hỏng `type: ["string","number"]` (ra `{items:{type:"string"}}` —
    // tham số ngày mất kiểu). Khai tường minh là chuỗi ngày-giờ như bản zod 3; `anyOf: undefined` gỡ nhánh union
    // do toJSONSchema tự sinh. Runtime vẫn nhận cả epoch-ms (ghim ở coerce-date.spec.ts).
    .meta({ type: "string", format: "date-time", anyOf: undefined });
