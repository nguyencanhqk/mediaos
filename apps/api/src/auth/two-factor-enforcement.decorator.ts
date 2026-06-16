import { SetMetadata } from "@nestjs/common";

export const ALLOW_WITHOUT_TWO_FACTOR = "ALLOW_WITHOUT_TWO_FACTOR";

/**
 * Đánh dấu route/controller được phép truy cập DÙ user bị ép 2FA mà CHƯA enroll (G16-1b). Dành cho chính
 * các route phục vụ thiết lập 2FA (enroll/enable/status) + me/logout — nếu chặn cả các route này thì user
 * bị ép 2FA sẽ KHÔNG có đường nào enroll (deadlock). TwoFactorEnforcementGuard bỏ qua các route này.
 */
export const AllowWithoutTwoFactor = () => SetMetadata(ALLOW_WITHOUT_TWO_FACTOR, true);
