import { SetMetadata } from "@nestjs/common";

export const IDEMPOTENT = "IDEMPOTENT";

/**
 * S5-BE-CONTRACT-1 (WS-D §13.2) — đánh dấu route CHẤP NHẬN `Idempotency-Key`.
 *
 * OPT-IN, KHÔNG global: chỉ mutation "tạo/duyệt" mới cần chống trùng. Áp đại trà lên mọi POST sẽ nuốt
 * cả những lời gọi CỐ Ý lặp (vd gửi lại thông báo) và bơm bộ nhớ cache vô ích.
 *
 * NGỮ NGHĨA: route có decorator này nhưng client KHÔNG gửi header → chạy bình thường (KHÔNG bắt buộc,
 * để không phá client cũ). Có header → xem `IdempotencyInterceptor`.
 */
export const Idempotent = (): MethodDecorator & ClassDecorator => SetMetadata(IDEMPOTENT, true);
