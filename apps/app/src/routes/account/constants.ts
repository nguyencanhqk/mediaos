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

/**
 * Cùng TwoFactorSetupPage được mount THÊM trong ME workspace (route "me.security.2fa") để nút "Bật 2FA"
 * ở /me/account không đá user ra khỏi ME. Route SHELL /account/setup-2fa GIỮ NGUYÊN — nó vẫn là đích
 * điều hướng của guard ép enroll AUTH-003.
 */
export const ME_SETUP_2FA_PATH = "/me/security/2fa";

/**
 * Allow-list của guard ép enroll (ProtectedShell): user có `mustSetupTwoFactor` bị điều hướng về màn
 * enroll TRỪ KHI đã đứng ở MỘT TRONG các path enroll. Phải liệt kê CẢ HAI mount của cùng một trang —
 * nếu chỉ loại trừ path shell, user bị ép enroll mà mở /me/security/2fa sẽ bị đá ngược liên tục.
 * Đây CHỈ là UX; cổng chặn thật là TwoFactorEnforcementGuard ở server.
 */
export const SETUP_2FA_PATHS: readonly string[] = [ACCOUNT_SETUP_2FA_PATH, ME_SETUP_2FA_PATH];
