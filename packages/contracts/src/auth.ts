import { z } from "zod";
import { apiResponseSchema } from "./index";

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
  /**
   * non-sensitive + allowlisted sensitive view-caps (action:resourceType) keyed for O(1) FE lookup.
   * Wildcards included as-is. Sensitive caps are EXCLUDED by default; only a curated allowlist (e.g.
   * 'view:audit-log') is surfaced as a UI hint — enforcement stays per-resource (PermissionGuard/can()).
   */
  capabilities: z.record(z.boolean()),
  /** true khi role ép 2FA (requires_two_factor) nhưng user CHƯA bật → FE buộc enroll (G16-1, AUTH-003). */
  mustSetupTwoFactor: z.boolean(),
  /**
   * S2-FND-SEED-3 — true khi tài khoản bị ép đổi mật khẩu lần đầu (users.must_change_password, mig 0469).
   * Super-admin bootstrap upsert đặt = true; change-password thành công clear cờ (cùng tx) ⇒ /auth/me trả
   * false. FE dùng làm cờ TƯ VẤN để điều hướng ép đổi (enforcement thật là follow-up FE, KHÔNG phải cổng
   * BE per-request).
   *
   * `.optional()` — ADDITIVE Y HỆT các field bổ sung khác của schema này (`company`/`employee`/`roles`/
   * `scopes`/`modules`, S2-AUTH-BE-1): fixture FE có TRƯỚC field này (meResponseSchema.parse không truyền
   * mustChangePassword) vẫn parse hợp lệ ⇒ KHÔNG phá contract S2-AUTH-BE-1. BE LUÔN populate (Lane C) nên
   * field vẫn hiện diện thực tế; optional chỉ nới ràng buộc parse, không đổi hành vi server.
   */
  mustChangePassword: z.boolean().optional(),
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

/* ───────────────────────────────────────────────────────────────────────────
 * S2-AUTH-BE-5 — Login-log + Security-event VIEWER DTOs (nguồn sự thật cho
 * AUTH-API-401 GET /auth/login-logs + AUTH-API-402 GET /auth/security-events).
 *
 * NGUỒN SỰ THẬT contract: API-02 §13 (AUTH-API-401/402) + DB schema auth-logs.ts
 *   (login_logs · user_security_events — append-only, mig 0443, RLS+FORCE).
 *
 * BẤT BIẾN #3 (KHÔNG secret plaintext): các DTO này CHỈ phơi field forensic an toàn
 *   (status/severity/ip/user_agent/reason). Cột jsonb `metadata` (login_logs) và
 *   `payload` (user_security_events) CÓ THỂ chứa token/secret theo ngữ cảnh →
 *   TUYỆT ĐỐI KHÔNG đưa vào list-item DTO. (Nếu spec sau cần phơi metadata đã-mask
 *   thì thêm field `metadata: z.unknown().nullable()` ĐÃ qua AuditMaskerService —
 *   KHÔNG phơi thô.) KHÔNG có password_hash/secret_ref/normalized_email.
 *
 * Quy ước field = snake_case theo API-02 (data + query + pagination). `status` của
 *   login-log dùng CHỮ THƯỜNG success|failed|blocked — khớp DB (auth-logs.ts: cột
 *   login_status lowercase) + task; ví dụ "SUCCESS" trong API-02 là minh hoạ cũ.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Cặp quyền CANONICAL gate cho cả 2 endpoint (seed mig 0340 — is_sensitive=true, grant
 * company-admin). BE @RequirePermission PHẢI khớp cặp ENGINE THỰC NÀY, KHÔNG theo mã FE
 * "AUTH.AUDIT_LOG.VIEW" (bài học drift S1-FND-MODULE: BE gate trên cặp seed, không theo tên FE).
 */
export const AUTH_AUDIT_LOG_RESOURCE_TYPE = "audit-log" as const;
export const AUTH_AUDIT_LOG = {
  RESOURCE: AUTH_AUDIT_LOG_RESOURCE_TYPE,
  VIEW: { action: "view", resource: AUTH_AUDIT_LOG_RESOURCE_TYPE },
} as const;

/** Trần/mặc định số dòng 1 trang (chống unbounded read — DoS). per_page kẹp [1..MAX]. */
export const AUTH_LOG_PAGE_SIZE_MAX = 100 as const;
export const AUTH_LOG_PAGE_SIZE_DEFAULT = 20 as const;

/** Trạng thái 1 lần đăng nhập (lowercase — khớp DB login_logs.login_status). */
export const LOGIN_LOG_STATUSES = ["success", "failed", "blocked"] as const;
export type LoginLogStatus = (typeof LOGIN_LOG_STATUSES)[number];

/** Mức nghiêm trọng sự kiện bảo mật (khớp DB user_security_events.severity). */
export const SECURITY_EVENT_SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export type SecurityEventSeverity = (typeof SECURITY_EVENT_SEVERITIES)[number];

/**
 * SECURITY_EVENT_TYPES — union `event_type` (SPEC-02 §22.2) = danh mục CANONICAL mà
 * SecurityEventWriter được phép ghi vào `user_security_events.event_type` (cột text tự do ở DB;
 * writer + validation input CHỈ chấp nhận 1 trong các mã này). Nguồn sự thật cho lane b/c/d
 * (auth writer · users-lock · perm-role) + viewer filter.
 *
 * APPEND-ONLY (BẤT BIẾN #2): CHỈ được THÊM mã mới ở cuối — KHÔNG xoá/đổi tên. Giá trị đã ghi vào
 * bảng append-only là bất biến forensic; đổi tên mã sẽ mồ côi lịch sử event cũ.
 */
export const SECURITY_EVENT_TYPES = [
  "PASSWORD_CHANGED",
  "PASSWORD_RESET_REQUESTED",
  "PASSWORD_RESET_COMPLETED",
  "REFRESH_TOKEN_REUSE_DETECTED",
  "SESSION_REVOKED",
  "ALL_SESSIONS_REVOKED",
  "USER_LOCKED",
  "USER_UNLOCKED",
  "ROLE_ASSIGNED",
  "ROLE_REMOVED",
  "TOTP_ENABLED",
  "TOTP_DISABLED",
  // S2-AUTH-BE-12 (APPEND-only): admin reset/gỡ 2FA của user khác (POST /auth/users/:id/2fa/reset).
  // Forensic: xoá user_totp + user_recovery_codes + thu hồi phiên ⇒ dấu hiệu can thiệp bảo mật.
  "TOTP_RESET",
  // S2-AUTH-USEROPS-1 (APPEND-only): xóa mềm / khôi phục tài khoản + admin đặt lại mật khẩu
  // (/auth/users/:id delete·restore·password/reset). Forensic: can thiệp tài khoản privileged.
  "USER_DELETED",
  "USER_RESTORED",
  "PASSWORD_RESET_BY_ADMIN",
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

/**
 * SECURITY_EVENT_SEVERITY — map `event_type` → `severity` (∈ SECURITY_EVENT_SEVERITIES).
 * SecurityEventWriter LẤY severity từ map này (KHÔNG hard-code rải rác ở emit-site) → mọi giá trị
 * nằm trong allowlist ⇒ KHÔNG vỡ CHECK `user_security_events_severity_check` (mig 0443).
 *
 * Quy ước rủi ro:
 *   - REFRESH_TOKEN_REUSE_DETECTED = "critical" — replay refresh-token = dấu hiệu tấn công/đánh cắp phiên.
 *   - USER_LOCKED = "high" — khoá tài khoản (sự cố bảo mật / hành động can thiệp).
 *   - còn lại low/medium tuỳ mức thay đổi credential/quyền (không dùng "info" ở đợt này).
 *
 * `Record<SecurityEventType, …>` ép TypeScript kiểm exhaustiveness: thêm mã mới ở SECURITY_EVENT_TYPES
 * mà quên gán severity ⇒ typecheck ĐỎ (fail-closed, không để severity mặc định lọt).
 */
export const SECURITY_EVENT_SEVERITY: Record<SecurityEventType, SecurityEventSeverity> = {
  PASSWORD_CHANGED: "medium",
  PASSWORD_RESET_REQUESTED: "low",
  PASSWORD_RESET_COMPLETED: "medium",
  REFRESH_TOKEN_REUSE_DETECTED: "critical",
  SESSION_REVOKED: "low",
  ALL_SESSIONS_REVOKED: "medium",
  USER_LOCKED: "high",
  USER_UNLOCKED: "medium",
  ROLE_ASSIGNED: "medium",
  ROLE_REMOVED: "medium",
  TOTP_ENABLED: "low",
  TOTP_DISABLED: "medium",
  // S2-AUTH-BE-12: admin reset 2FA của user khác = "high" (mirror USER_LOCKED — hành động can thiệp
  // bảo mật privileged: gỡ credential 2FA + thu hồi mọi phiên của victim).
  TOTP_RESET: "high",
  // S2-AUTH-USEROPS-1: xóa tài khoản = "high" (mirror USER_LOCKED — chặn truy cập + thu hồi phiên);
  // khôi phục = "medium" (mở lại truy cập); admin đặt lại mật khẩu = "high" (thay credential của
  // người khác + thu hồi mọi phiên — can thiệp privileged).
  USER_DELETED: "high",
  USER_RESTORED: "medium",
  PASSWORD_RESET_BY_ADMIN: "high",
};

/**
 * Cột được phép ORDER BY (allowlist — repo map sang ORDER BY cố định; chặn SQL-injection
 * qua tham số sort). Mặc định created_at DESC (forensic mới nhất trước).
 */
export const LOGIN_LOG_SORT_FIELDS = ["created_at", "status"] as const;
export type LoginLogSortField = (typeof LOGIN_LOG_SORT_FIELDS)[number];

export const SECURITY_EVENT_SORT_FIELDS = ["created_at", "severity", "event_type"] as const;
export type SecurityEventSortField = (typeof SECURITY_EVENT_SORT_FIELDS)[number];

/** Hướng sắp xếp chung. */
export const AUTH_LOG_SORT_ORDERS = ["asc", "desc"] as const;
export type AuthLogSortOrder = (typeof AUTH_LOG_SORT_ORDERS)[number];

/**
 * Tham chiếu user RÚT GỌN nhúng trong log-item (login-log.user · security-event.user/actor).
 * display_name lấy từ users.full_name (nullable). KHÔNG kèm field nhạy cảm.
 */
export const authLogUserRefSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  display_name: z.string().nullable(),
});
export type AuthLogUserRef = z.infer<typeof authLogUserRefSchema>;

/**
 * Query GET /auth/login-logs — phân trang + filter (status/user_id/from_date/to_date) + sort
 * whitelist. Query-string → coerce; per_page kẹp [1..MAX] (ngoài dải → VALIDATION-ERR field-level).
 * Refine from_date <= to_date (chống dải đảo). Date-only ("2026-06-01") + ISO datetime đều nhận.
 */
export const loginLogListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    per_page: z.coerce
      .number()
      .int()
      .positive()
      .max(AUTH_LOG_PAGE_SIZE_MAX)
      .default(AUTH_LOG_PAGE_SIZE_DEFAULT),
    user_id: z.string().uuid().optional(),
    status: z.enum(LOGIN_LOG_STATUSES).optional(),
    from_date: z.coerce.date().optional(),
    to_date: z.coerce.date().optional(),
    sort: z.enum(LOGIN_LOG_SORT_FIELDS).default("created_at"),
    order: z.enum(AUTH_LOG_SORT_ORDERS).default("desc"),
  })
  .refine((q) => !q.from_date || !q.to_date || q.from_date.getTime() <= q.to_date.getTime(), {
    message: "from_date phải <= to_date.",
    path: ["from_date"],
  });
export type LoginLogListQuery = z.infer<typeof loginLogListQuerySchema>;

/**
 * 1 dòng login-log (AUTH-API-401). `user` nullable: lần fail với email KHÔNG tồn tại (UserNotFound)
 * KHÔNG có user liên kết. failure_reason chỉ mã lý do (WrongPassword/Locked…), KHÔNG chứa secret.
 */
export const loginLogListItemSchema = z.object({
  id: z.string().uuid(),
  user: authLogUserRefSchema.nullable(),
  status: z.enum(LOGIN_LOG_STATUSES),
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  failure_reason: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
});
export type LoginLogListItem = z.infer<typeof loginLogListItemSchema>;

/**
 * Envelope list login-log {success,message,data,error,pagination,meta} (API-01/02).
 *
 * `z.lazy` HOÃN gọi `apiResponseSchema` tới lúc parse — TRÁNH circular-init TDZ: barrel index.ts
 * `export * from "./auth"` bị hoist (ESM) nên auth.ts chạy TRƯỚC khi `apiErrorSchema` (const trong
 * index.ts) khởi tạo; gọi thẳng ở top-level sẽ "Cannot access before initialization". Lazy giải quyết
 * mà vẫn TÁI DÙNG envelope chuẩn (KHÔNG nhân bản apiErrorSchema/pagination/meta → chống drift).
 */
export const loginLogListResponseSchema = z.lazy(() =>
  apiResponseSchema(z.array(loginLogListItemSchema)),
);
export type LoginLogListResponse = z.infer<typeof loginLogListResponseSchema>;

/**
 * Query GET /auth/security-events — phân trang + filter (event_type/severity/user_id/from/to) + sort.
 * event_type tự do (PASSWORD_CHANGED/USER_LOCKED/ROLE_ASSIGNED…) nên là string bị giới hạn độ dài, KHÔNG enum.
 */
export const securityEventListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    per_page: z.coerce
      .number()
      .int()
      .positive()
      .max(AUTH_LOG_PAGE_SIZE_MAX)
      .default(AUTH_LOG_PAGE_SIZE_DEFAULT),
    user_id: z.string().uuid().optional(),
    event_type: z.string().trim().min(1).max(100).optional(),
    severity: z.enum(SECURITY_EVENT_SEVERITIES).optional(),
    from_date: z.coerce.date().optional(),
    to_date: z.coerce.date().optional(),
    sort: z.enum(SECURITY_EVENT_SORT_FIELDS).default("created_at"),
    order: z.enum(AUTH_LOG_SORT_ORDERS).default("desc"),
  })
  .refine((q) => !q.from_date || !q.to_date || q.from_date.getTime() <= q.to_date.getTime(), {
    message: "from_date phải <= to_date.",
    path: ["from_date"],
  });
export type SecurityEventListQuery = z.infer<typeof securityEventListQuerySchema>;

/**
 * 1 dòng security-event (AUTH-API-402). `actor` nullable = hệ thống tự sinh (actor_user_id NULL).
 * `user` nullable phòng user đã soft-delete. KHÔNG phơi cột jsonb `payload` (có thể chứa secret).
 */
export const securityEventListItemSchema = z.object({
  id: z.string().uuid(),
  user: authLogUserRefSchema.nullable(),
  event_type: z.string(),
  severity: z.enum(SECURITY_EVENT_SEVERITIES),
  actor: authLogUserRefSchema.nullable(),
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
});
export type SecurityEventListItem = z.infer<typeof securityEventListItemSchema>;

/** Envelope list security-event {success,message,data,error,pagination,meta} (API-01/02). z.lazy: xem note ở loginLogListResponseSchema (tránh circular-init TDZ với barrel). */
export const securityEventListResponseSchema = z.lazy(() =>
  apiResponseSchema(z.array(securityEventListItemSchema)),
);
export type SecurityEventListResponse = z.infer<typeof securityEventListResponseSchema>;

/* ───────────────────────────────────────────────────────────────────────────
 * S2-AUTH-BE-7 — Session self-service DTOs (GET /auth/sessions + revoke).
 *
 * NGUỒN SỰ THẬT: API-02 (session self-service) · SPEC-02 §14 · DB-02 §12.1 (user_sessions).
 *
 * BẤT BIẾN #3: TUYỆT ĐỐI KHÔNG phơi `refresh_token_hash`/`access_token_jti` (secret material) —
 * list-item CHỈ chứa field forensic an toàn (device/ip/last_seen/created/current). Own-scope CHỈ:
 * mỗi user CHỈ xem/thu hồi phiên của CHÍNH mình (owner-check ở service, KHÔNG cần permission pair
 * riêng — pattern giống /auth/me, CHỐT 2026-07-02).
 * ────────────────────────────────────────────────────────────────────────── */

/** 1 phiên đăng nhập ACTIVE của chính user (KHÔNG lộ token/hash — BẤT BIẾN #3). */
export const sessionListItemSchema = z.object({
  id: z.string().uuid(),
  device_name: z.string().nullable(),
  platform: z.string().nullable(),
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  last_used_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  expired_at: z.string().datetime({ offset: true }),
  /** true = phiên của request hiện tại (từ jti access-token) — FE đánh dấu "phiên này". */
  is_current: z.boolean(),
});
export type SessionListItem = z.infer<typeof sessionListItemSchema>;

/** Envelope list session {success,message,data,error,meta} (API-01/02). z.lazy: tránh circular-init TDZ (xem note loginLogListResponseSchema). */
export const sessionListResponseSchema = z.lazy(() =>
  apiResponseSchema(z.array(sessionListItemSchema)),
);
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;

/** Phản hồi revoke 1 phiên / revoke-others — {ok:true, revoked_count}. */
export const sessionRevokeResponseSchema = z.object({
  ok: z.literal(true),
  revoked_count: z.number().int().nonnegative(),
});
export type SessionRevokeResponse = z.infer<typeof sessionRevokeResponseSchema>;
