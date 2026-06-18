import { z } from "zod";

/**
 * CS-10 Đối tượng: Mời / Duyệt / Kích hoạt user — nguồn sự thật contract api ↔ console ↔ auth.
 *
 * Luồng: invite(admin) → accept(người được mời + token, đặt mật khẩu) → approve(admin) → tài khoản ACTIVE.
 *
 * BẤT BIẾN:
 *   - token thật CHỈ đi qua email (server lưu token_hash). DTO KHÔNG bao giờ chứa token/hash/password.
 *   - companyId LẤY TỪ JWT (invite/approve/reject/pending) hoặc resolve từ companySlug (accept sessionless) —
 *     KHÔNG nhận companyId từ body.
 *   - accept: single-use (accepted_at) + expiry 72h + email-domain (CS-9) check tại accept.
 */

/** Trạng thái vòng đời lời mời (đồng bộ CHECK migration 0410). */
export const USER_INVITE_STATUSES = ["pending", "accepted", "approved", "rejected"] as const;
export type UserInviteStatus = (typeof USER_INVITE_STATUSES)[number];

/** Permission keys CS-10 (sensitive — mời/duyệt user). */
export const INVITE_USER_ACTION = "invite" as const;
export const APPROVE_USER_ACTION = "approve" as const;
export const USER_INVITE_RESOURCE_TYPE = "user" as const;

/** TTL lời mời (giờ) — đồng bộ với server (chỉ để hiển thị/định hướng client). */
export const USER_INVITE_TTL_HOURS = 72;

// ─── POST /users/invite ─────────────────────────────────────────────────────

/**
 * Tạo lời mời. `email` của tài khoản sẽ tạo; `fullName` để hiển thị + điền sẵn. companyId lấy từ JWT.
 */
export const createUserInviteSchema = z.object({
  email: z.string().email().max(320),
  fullName: z.string().min(1).max(255),
});
export type CreateUserInviteRequest = z.infer<typeof createUserInviteSchema>;

// ─── DTO view (GET /users/pending, response của invite/approve/reject) ───────

/**
 * DTO view 1 lời mời — KHÔNG token/hash/password. Dùng cho hàng đợi "Chờ duyệt" + "Yêu cầu kích hoạt".
 */
export const userInviteSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  status: z.enum(USER_INVITE_STATUSES),
  expiresAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
  createdUserId: z.string().uuid().nullable(),
  invitedBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type UserInviteDto = z.infer<typeof userInviteSchema>;

/**
 * Kết quả tạo lời mời — DTO + `emailSent` (best-effort; false ⇒ admin cần kiểm tra cấu hình SMTP / không có
 * cấu hình mail). KHÔNG bao giờ trả token (chỉ gửi qua email).
 */
export const createUserInviteResultSchema = z.object({
  invite: userInviteSchema,
  emailSent: z.boolean(),
});
export type CreateUserInviteResult = z.infer<typeof createUserInviteResultSchema>;

/** GET /users/pending — hàng đợi (pending + accepted), FE chia tab theo `status`. */
export const pendingInvitesSchema = z.object({
  invites: z.array(userInviteSchema),
});
export type PendingInvitesDto = z.infer<typeof pendingInvitesSchema>;

// ─── POST /users/activation/accept (SESSIONLESS) ────────────────────────────

/**
 * Người được mời kích hoạt tài khoản bằng token (gửi qua email). companySlug để resolve tenant (sessionless).
 * Đặt mật khẩu đăng nhập. Lỗi (token sai/hết hạn/đã dùng/sai domain) → 400 ĐỒNG NHẤT (không lộ chi tiết).
 */
export const acceptInviteSchema = z.object({
  companySlug: z.string().min(1).max(100),
  token: z.string().min(1).max(512),
  password: z.string().min(8).max(1024),
});
export type AcceptInviteRequest = z.infer<typeof acceptInviteSchema>;

/** Kết quả accept — tối thiểu (KHÔNG cấp token đăng nhập; người dùng đăng nhập bình thường SAU khi admin duyệt). */
export const acceptInviteResultSchema = z.object({
  status: z.enum(USER_INVITE_STATUSES),
});
export type AcceptInviteResult = z.infer<typeof acceptInviteResultSchema>;
