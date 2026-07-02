/**
 * S2-FE-AUTH-6 — Hằng dùng chung cho 2 màn self-service Account còn thiếu:
 *   /account/setup-2fa (ép enroll 2FA khi mustSetupTwoFactor, AUTH-003) ·
 *   /account/profile (đọc — user + employee + roles từ /auth/me, KHÔNG gọi API mới).
 *
 * Đặt riêng file constants (mirror pattern PCR_ME_PATH/LEAVE_PATHS) để router.tsx + ProtectedShell
 * (redirect-guard) dùng CHUNG một nguồn — tránh path string trôi giữa 2 nơi.
 */
export const ACCOUNT_SETUP_2FA_PATH = "/account/setup-2fa";
export const ACCOUNT_PROFILE_PATH = "/account/profile";
