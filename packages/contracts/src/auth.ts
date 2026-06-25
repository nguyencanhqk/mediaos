import { z } from "zod";

/**
 * Auth DTO (G2-6) — nguồn sự thật cho api ↔ web. Login cần `companySlug` vì email chỉ unique theo
 * tenant (plan §3b): {companySlug,email} → resolve company → withTenant → tìm user.
 */

export const loginRequestSchema = z.object({
  companySlug: z.string().min(1).max(100),
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * FS-1a: refreshToken OPTIONAL — luồng SSO cookie đọc refresh token từ HttpOnly cookie (`mediaos_rt`),
 * KHÔNG gửi trong body. Luồng cũ (mobile / Bearer) vẫn gửi `refreshToken` trong body (tương thích ngược).
 */
export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

/**
 * FS-1a: phản hồi refresh ở chế độ COOKIE — refresh token mới nằm trong HttpOnly cookie (đã xoay/rotation),
 * KHÔNG trả trong body (giữ refresh token NGOÀI tầm với của JS — chống XSS đánh cắp). Body chỉ mang access
 * token (in-memory) + TTL. Luồng cũ (body refreshToken) vẫn trả `authTokensSchema` đầy đủ (tương thích ngược).
 */
export const authRefreshResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type AuthRefreshResponse = z.infer<typeof authRefreshResponseSchema>;

/** FS-1a: phản hồi logout — đăng xuất toàn cục (thu hồi cả họ refresh token + xoá cookie). */
export const logoutResponseSchema = z.object({ ok: z.literal(true) });
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;

/**
 * FS-1a: kiểm tra `?redirect` theo allowlist origin subdomain (chống open-redirect, rủi ro #11). `apps/auth`
 * (1b) gọi TRƯỚC khi điều hướng về app đích — server là nguồn allowlist duy nhất. `target` chỉ trả khi hợp lệ.
 */
export const redirectAllowedResponseSchema = z.object({
  allowed: z.boolean(),
  target: z.string().nullable(),
});
export type RedirectAllowedResponse = z.infer<typeof redirectAllowedResponseSchema>;

/**
 * FS-1a — HẰNG SỐ SSO cookie (CONTRACT cho `apps/auth` + `web-core`, chốt shape cho 1b).
 * - `REFRESH_COOKIE_NAME`: cookie HttpOnly chứa refresh token (JS KHÔNG đọc được).
 * - `CSRF_COOKIE_NAME`: cookie double-submit (JS ĐỌC được) — client phải echo qua header.
 * - `CSRF_HEADER_NAME`: header bắt buộc cho endpoint cookie-based (refresh/logout) — chống CSRF.
 */
export const REFRESH_COOKIE_NAME = "mediaos_rt" as const;
export const CSRF_COOKIE_NAME = "mediaos_csrf" as const;
export const CSRF_HEADER_NAME = "x-csrf-token" as const;

export const forgotPasswordRequestSchema = z.object({
  companySlug: z.string().min(1).max(100),
  email: z.string().email().max(255),
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/**
 * Đổi mật khẩu khi ĐÃ đăng nhập (self-service, Module 2a). `currentPassword` để re-auth (chống chiếm
 * phiên đổi pass); `newPassword` ≥ 8 ký tự (mirror reset). "Khác mật khẩu cũ" ép ở service (lỗi rõ ràng).
 */
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/** Cặp token trả về khi login/refresh. */
export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

/**
 * RBAC data_scope (BACKEND-03 §13 / DB-02 §12). Canonical, narrow→wide. Nguồn sự thật phía contract —
 * apps/api có `ROLE_DATA_SCOPES` (schema) PHẢI khớp mảng này (test đồng bộ ở apps/api). KHÔNG để contracts
 * import từ apps/api (đảo chiều phụ thuộc → vỡ dual ESM/CJS build).
 */
export const DATA_SCOPES = ["Own", "Team", "Department", "Company", "System"] as const;
export type DataScope = (typeof DATA_SCOPES)[number];

/**
 * DTO user công khai — TUYỆT ĐỐI không chứa password_hash (BẤT BIẾN #3).
 *
 * S2-AUTH-BE-1: bổ sung ADDITIVE bootstrap context (BACKEND-03 §15.2/§15.3) — `company`, `employee`, `roles`,
 * `scopes`, `modules`. Tất cả OPTIONAL/nullable để tương thích ngược (FE cũ strip field lạ; rollback = bỏ qua).
 * `capabilities`/`mustSetupTwoFactor` GIỮ nguyên (FE web-core đang dùng). `scopes` keyed Y HỆT `capabilities`.
 */
export const meResponseSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().nullable(),
  status: z.string(),
  /** Non-sensitive action:resourceType capabilities keyed for O(1) FE lookup. Wildcards included as-is. */
  capabilities: z.record(z.boolean()),
  /** true khi role ép 2FA (requires_two_factor) nhưng user CHƯA bật → FE buộc enroll (G16-1, AUTH-003). */
  mustSetupTwoFactor: z.boolean(),
  /** Company hiện tại (tenant của phiên). */
  company: z.object({ id: z.string().uuid(), name: z.string(), status: z.string() }).optional(),
  /**
   * Hồ sơ nhân sự liên kết user — null khi không có (operator/super-admin). KHÔNG bao giờ chứa base_salary
   * (nhạy cảm). full_name lấy từ users.full_name; departmentId = org_unit_id; employmentStatus = profile.status.
   */
  employee: z
    .object({
      id: z.string().uuid(),
      employeeCode: z.string().nullable(),
      fullName: z.string().nullable(),
      departmentId: z.string().uuid().nullable(),
      directManagerId: z.string().uuid().nullable(),
      employmentStatus: z.string(),
    })
    .nullable()
    .optional(),
  /** Role active (user_roles ⋈ roles, chưa xoá/hết hạn). roles không có cột `code` → `name` chính là code. */
  roles: z.array(z.object({ id: z.string().uuid(), name: z.string() })).optional(),
  /**
   * Union data_scope theo từng cặp ALLOW non-sensitive (BACKEND-03 §15.3 rule 6 — mảng hợp, KHÔNG scalar).
   * Key = "action:resourceType" (đồng bộ `capabilities`); cặp bị DENY-override KHÔNG xuất hiện. Đã dedupe.
   */
  scopes: z.record(z.array(z.enum(DATA_SCOPES))).optional(),
  /** Module user thấy ở Home/App-Switcher — TÁI DÙNG ModuleCatalogService.getMyApps() (KHÔNG re-implement). */
  modules: z.array(z.object({ code: z.string(), name: z.string() })).optional(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
