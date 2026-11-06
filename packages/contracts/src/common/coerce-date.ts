import { z } from "zod";

/**
 * S19-OPS-ZOD4-1 — C3a: thay `z.coerce.date()` (zod 3). Lý do: nestjs-zod 5 sinh OpenAPI bằng
 * `toJSONSchema()`; `z.coerce.date()` / `z.date()` KHÔNG biểu diễn được trong JSON Schema ⇒ NÉM
 * "Date cannot be represented in JSON Schema" lúc dựng tài liệu. Codec dưới đây có phía vào là
 * `string | number` (biểu diễn được) và phía ra là `Date`.
 *
 * Hành vi so với `z.coerce.date()` (đã đo 06/11/2026, zod 4.6.7):
 *   - chuỗi ngày / ISO / epoch-ms: kết quả Y HỆT (`new Date(v)`).
 *   - chuỗi rác `"nope"`, `""`: lỗi `invalid_type` expected `date` — như coerce.
 *   - KHÁC (cố ý, ghim ở `coerce-date.spec.ts`): `null` ⇒ `invalid_union` (coerce ra 1970-01-01);
 *     đối tượng `Date` truyền vào parse ⇒ `invalid_union` (coerce nhận). Mọi nơi dùng là ranh giới JSON/query
 *     (luôn là chuỗi) nên không ảnh hưởng; ai cần parse đối tượng Date phải `.toISOString()` trước.
 *   - CHỈ dùng ở phía INPUT hoặc chỗ không đi qua `toJSONSchema(io:"output")` (phía ra của codec vẫn là
 *     `z.date()` nên io "output" vẫn ném) — xem plan §10.5.
 */
export const coerceDate = () =>
  z.codec(z.union([z.string(), z.number()]), z.date(), {
    decode: (v) => new Date(v),
    encode: (d) => d.toISOString(),
  });
