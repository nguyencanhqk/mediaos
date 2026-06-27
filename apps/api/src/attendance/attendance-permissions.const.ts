/**
 * S3-ATT-SEED-1 — SHARED ATT permission catalog (action, resource_type) pairs.
 *
 * NGUỒN SỰ THẬT DUY NHẤT cho cặp (action, resource_type) của module ATT. Migration 0454 seed catalog +
 * role-grant từ ĐÚNG danh sách này; S3-ATT-BE-1 import để gắn @RequirePermission(action, resourceType) trên
 * controller — KHÔNG hard-code chuỗi rời rạc (tránh drift đã gặp ở S1-FND-MODULE: FE/BE lệch cặp engine).
 *
 * BẢN ĐỒ DB-04 §12 → cặp engine (resource_type kebab-case, distinct cho ATT — KHÔNG dùng generic
 * 'read'/'audit-log' của mig 0005 để tránh over-grant audit toàn công ty):
 *   ATTENDANCE → 'attendance' · ADJUSTMENT → 'adjustment' · REMOTE_REQUEST → 'remote-request' ·
 *   SHIFT → 'shift' · SHIFT_ASSIGNMENT → 'shift-assignment' · RULE → 'attendance-rule' ·
 *   AUDIT_LOG → 'attendance-audit-log'.
 *
 * is_sensitive: theo DB-04 §12 cho cặp được liệt kê (authoritative); cặp KHÔNG có ở §12
 * (view-sensitive·attendance, recalculate·attendance, cancel-own·remote-request) theo default WO
 * (view-sensitive/recalculate = sensitive; cancel-own = non-sensitive). 33 cặp.
 */

/** resource_type kebab-case của ATT (dùng ở guard + seed). */
export const ATT_RESOURCES = {
  ATTENDANCE: "attendance",
  ADJUSTMENT: "adjustment",
  REMOTE_REQUEST: "remote-request",
  SHIFT: "shift",
  SHIFT_ASSIGNMENT: "shift-assignment",
  RULE: "attendance-rule",
  AUDIT_LOG: "attendance-audit-log",
} as const;

export type AttResourceType = (typeof ATT_RESOURCES)[keyof typeof ATT_RESOURCES];

/** 1 cặp permission engine của ATT. */
export interface AttPermissionPair {
  readonly action: string;
  readonly resourceType: AttResourceType;
  /** is_sensitive trong catalog `permissions` (DB-04 §12 / WO default). */
  readonly sensitive: boolean;
}

/**
 * 33 cặp (action, resource_type) của ATT — ĐỒNG BỘ với migration 0454 (a) catalog INSERT.
 * Thứ tự nhóm theo resource để dễ đối chiếu DB-04 §12.
 */
export const ATT_PERMISSIONS: readonly AttPermissionPair[] = [
  // ── attendance (10) ──────────────────────────────────────────────────────────
  { action: "check-in", resourceType: ATT_RESOURCES.ATTENDANCE, sensitive: false },
  { action: "check-out", resourceType: ATT_RESOURCES.ATTENDANCE, sensitive: false },
  { action: "view-own", resourceType: ATT_RESOURCES.ATTENDANCE, sensitive: true },
  { action: "view-team", resourceType: ATT_RESOURCES.ATTENDANCE, sensitive: true },
  { action: "view-company", resourceType: ATT_RESOURCES.ATTENDANCE, sensitive: true },
  { action: "view-detail", resourceType: ATT_RESOURCES.ATTENDANCE, sensitive: true },
  { action: "view-sensitive", resourceType: ATT_RESOURCES.ATTENDANCE, sensitive: true },
  { action: "adjust-direct", resourceType: ATT_RESOURCES.ATTENDANCE, sensitive: true },
  { action: "recalculate", resourceType: ATT_RESOURCES.ATTENDANCE, sensitive: true },
  { action: "export", resourceType: ATT_RESOURCES.ATTENDANCE, sensitive: true },
  // ── adjustment (7) ───────────────────────────────────────────────────────────
  { action: "create-own", resourceType: ATT_RESOURCES.ADJUSTMENT, sensitive: false },
  { action: "view-own", resourceType: ATT_RESOURCES.ADJUSTMENT, sensitive: true },
  { action: "view-team", resourceType: ATT_RESOURCES.ADJUSTMENT, sensitive: true },
  { action: "view-company", resourceType: ATT_RESOURCES.ADJUSTMENT, sensitive: true },
  { action: "approve", resourceType: ATT_RESOURCES.ADJUSTMENT, sensitive: true },
  { action: "reject", resourceType: ATT_RESOURCES.ADJUSTMENT, sensitive: true },
  { action: "cancel-own", resourceType: ATT_RESOURCES.ADJUSTMENT, sensitive: false },
  // ── remote-request (7) ───────────────────────────────────────────────────────
  { action: "create-own", resourceType: ATT_RESOURCES.REMOTE_REQUEST, sensitive: false },
  { action: "view-own", resourceType: ATT_RESOURCES.REMOTE_REQUEST, sensitive: true },
  { action: "view-team", resourceType: ATT_RESOURCES.REMOTE_REQUEST, sensitive: true },
  { action: "view-company", resourceType: ATT_RESOURCES.REMOTE_REQUEST, sensitive: true },
  { action: "approve", resourceType: ATT_RESOURCES.REMOTE_REQUEST, sensitive: true },
  { action: "reject", resourceType: ATT_RESOURCES.REMOTE_REQUEST, sensitive: true },
  { action: "cancel-own", resourceType: ATT_RESOURCES.REMOTE_REQUEST, sensitive: false },
  // ── shift (4) ────────────────────────────────────────────────────────────────
  { action: "view", resourceType: ATT_RESOURCES.SHIFT, sensitive: false },
  { action: "create", resourceType: ATT_RESOURCES.SHIFT, sensitive: true },
  { action: "update", resourceType: ATT_RESOURCES.SHIFT, sensitive: true },
  { action: "delete", resourceType: ATT_RESOURCES.SHIFT, sensitive: true },
  // ── shift-assignment (2) ──────────────────────────────────────────────────────
  { action: "view", resourceType: ATT_RESOURCES.SHIFT_ASSIGNMENT, sensitive: true },
  { action: "update", resourceType: ATT_RESOURCES.SHIFT_ASSIGNMENT, sensitive: true },
  // ── attendance-rule (2) ───────────────────────────────────────────────────────
  { action: "view", resourceType: ATT_RESOURCES.RULE, sensitive: true },
  { action: "config", resourceType: ATT_RESOURCES.RULE, sensitive: true },
  // ── attendance-audit-log (1) ──────────────────────────────────────────────────
  { action: "view", resourceType: ATT_RESOURCES.AUDIT_LOG, sensitive: true },
] as const;

/** Tổng số cặp ATT — pin để test khẳng định KHÔNG thiếu/thừa (đồng bộ migration 0454). */
export const ATT_PERMISSION_COUNT = ATT_PERMISSIONS.length; // 33
