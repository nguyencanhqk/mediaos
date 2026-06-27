/**
 * S3-LEAVE-SEED-1 — SHARED LEAVE permission catalog (action, resource_type) pairs.
 *
 * NGUỒN SỰ THẬT DUY NHẤT cho cặp (action, resource_type) của module LEAVE. Migration 0455 seed catalog +
 * role-grant từ ĐÚNG danh sách này; S3-LEAVE-BE import để gắn @RequirePermission(action, resourceType) trên
 * controller — KHÔNG hard-code chuỗi rời rạc (tránh drift đã gặp ở S1-FND-MODULE: FE/BE lệch cặp engine).
 *
 * BẢN ĐỒ DB-05 §11 → cặp engine (resource_type kebab-case, distinct cho LEAVE — KHÔNG dùng generic
 * 'audit-log' của mig 0005 để tránh over-grant audit toàn công ty):
 *   LEAVE → 'leave' · LEAVE_TYPE → 'leave-type' · LEAVE_POLICY → 'leave-policy' ·
 *   LEAVE_BALANCE → 'leave-balance' · LEAVE_CALENDAR → 'leave-calendar' · LEAVE_FILE → 'leave-file' ·
 *   LEAVE_AUDIT_LOG → 'leave-audit-log'.
 *
 * is_sensitive: [F]=false (self-service nhân viên: xem/tạo/gửi/sửa-nháp/huỷ đơn của mình, đọc danh mục loại
 * nghỉ, xem số dư/lịch nghỉ của mình, duyệt theo phạm vi) — [S]=true (đọc chéo/quản trị/audit: view·leave,
 * reject/cancel-any/revoke/export, quản trị leave-type/leave-policy/leave-balance, file, audit log). 30 cặp.
 *
 * LƯU Ý LEGACY: mig 0063 đã có ('read','leave'),('create','leave'),('approve','leave'),('manage','leave')
 * is_sensitive=false. create/approve·leave trùng cặp dưới đây ([F]=false) ⇒ ON CONFLICT giữ nguyên (KHỚP);
 * read/manage·leave KHÔNG nằm trong tập LEAVE engine mới (để nguyên, không dùng).
 */

/** resource_type kebab-case của LEAVE (dùng ở guard + seed). */
export const LEAVE_RESOURCES = {
  LEAVE: "leave",
  LEAVE_TYPE: "leave-type",
  LEAVE_POLICY: "leave-policy",
  LEAVE_BALANCE: "leave-balance",
  LEAVE_CALENDAR: "leave-calendar",
  LEAVE_FILE: "leave-file",
  LEAVE_AUDIT_LOG: "leave-audit-log",
} as const;

export type LeaveResourceType = (typeof LEAVE_RESOURCES)[keyof typeof LEAVE_RESOURCES];

/** 1 cặp permission engine của LEAVE. */
export interface LeavePermissionPair {
  readonly action: string;
  readonly resourceType: LeaveResourceType;
  /** is_sensitive trong catalog `permissions` (DB-05 §11 / WO). */
  readonly sensitive: boolean;
}

/**
 * 30 cặp (action, resource_type) của LEAVE — ĐỒNG BỘ với migration 0455 (a) catalog INSERT.
 * Thứ tự nhóm theo resource để dễ đối chiếu DB-05 §11.
 */
export const LEAVE_PERMISSIONS: readonly LeavePermissionPair[] = [
  // ── leave (11) ───────────────────────────────────────────────────────────────
  { action: "view-own", resourceType: LEAVE_RESOURCES.LEAVE, sensitive: false },
  { action: "view", resourceType: LEAVE_RESOURCES.LEAVE, sensitive: true },
  { action: "create", resourceType: LEAVE_RESOURCES.LEAVE, sensitive: false },
  { action: "submit", resourceType: LEAVE_RESOURCES.LEAVE, sensitive: false },
  { action: "update-draft", resourceType: LEAVE_RESOURCES.LEAVE, sensitive: false },
  { action: "cancel-own", resourceType: LEAVE_RESOURCES.LEAVE, sensitive: false },
  { action: "approve", resourceType: LEAVE_RESOURCES.LEAVE, sensitive: false },
  { action: "reject", resourceType: LEAVE_RESOURCES.LEAVE, sensitive: true },
  { action: "cancel-any", resourceType: LEAVE_RESOURCES.LEAVE, sensitive: true },
  { action: "revoke", resourceType: LEAVE_RESOURCES.LEAVE, sensitive: true },
  { action: "export", resourceType: LEAVE_RESOURCES.LEAVE, sensitive: true },
  // ── leave-type (4) ─────────────────────────────────────────────────────────────
  { action: "view", resourceType: LEAVE_RESOURCES.LEAVE_TYPE, sensitive: false },
  { action: "create", resourceType: LEAVE_RESOURCES.LEAVE_TYPE, sensitive: true },
  { action: "update", resourceType: LEAVE_RESOURCES.LEAVE_TYPE, sensitive: true },
  { action: "delete", resourceType: LEAVE_RESOURCES.LEAVE_TYPE, sensitive: true },
  // ── leave-policy (4) ───────────────────────────────────────────────────────────
  { action: "view", resourceType: LEAVE_RESOURCES.LEAVE_POLICY, sensitive: true },
  { action: "create", resourceType: LEAVE_RESOURCES.LEAVE_POLICY, sensitive: true },
  { action: "update", resourceType: LEAVE_RESOURCES.LEAVE_POLICY, sensitive: true },
  { action: "delete", resourceType: LEAVE_RESOURCES.LEAVE_POLICY, sensitive: true },
  // ── leave-balance (4) ──────────────────────────────────────────────────────────
  { action: "view-own", resourceType: LEAVE_RESOURCES.LEAVE_BALANCE, sensitive: false },
  { action: "view", resourceType: LEAVE_RESOURCES.LEAVE_BALANCE, sensitive: true },
  { action: "view-transaction", resourceType: LEAVE_RESOURCES.LEAVE_BALANCE, sensitive: true },
  { action: "adjust", resourceType: LEAVE_RESOURCES.LEAVE_BALANCE, sensitive: true },
  // ── leave-calendar (3) ─────────────────────────────────────────────────────────
  { action: "view-own", resourceType: LEAVE_RESOURCES.LEAVE_CALENDAR, sensitive: false },
  { action: "view-team", resourceType: LEAVE_RESOURCES.LEAVE_CALENDAR, sensitive: true },
  { action: "view-company", resourceType: LEAVE_RESOURCES.LEAVE_CALENDAR, sensitive: true },
  // ── leave-file (3) ─────────────────────────────────────────────────────────────
  { action: "view", resourceType: LEAVE_RESOURCES.LEAVE_FILE, sensitive: true },
  { action: "upload", resourceType: LEAVE_RESOURCES.LEAVE_FILE, sensitive: true },
  { action: "delete", resourceType: LEAVE_RESOURCES.LEAVE_FILE, sensitive: true },
  // ── leave-audit-log (1) ────────────────────────────────────────────────────────
  { action: "view", resourceType: LEAVE_RESOURCES.LEAVE_AUDIT_LOG, sensitive: true },
] as const;

/** Tổng số cặp LEAVE — pin để test khẳng định KHÔNG thiếu/thừa (đồng bộ migration 0455). */
export const LEAVE_PERMISSION_COUNT = LEAVE_PERMISSIONS.length; // 30
