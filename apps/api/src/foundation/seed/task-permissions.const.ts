/**
 * S4-TASK-SEED-1 — Catalog 23 cặp permission TASK canonical (DB-06 §12.1) + ma trận grant
 * per-(role, pair) 67 hàng seed ở 0485 (+5 hàng hoãn — SPEC-06 §9, truy nguyên từng hàng ở
 * docs/plans/S4-TASK-SEED-1.md §3).
 *
 * Nguồn cho task-permissions-seed.int.spec.ts (đối chiếu DB thật sau mig 0485) — mirror
 * attendance-permissions.const (mig 0454). OWNER CHỐT 2026-07-09: ĐÚNG 23 mã, KHÔNG hơn —
 * không cặp `checklist` (gate bằng update:task), không TASK.PROJECT.FILE_UPLOAD/DELETE
 * (SPEC-06 §8.2 TK-1 liệt kê nhưng DB-06 §12.1 không có → cần owner quyết ở WO khác).
 *
 * is_sensitive=true (8 cặp): delete/close/archive/manage-member/view-report:project +
 * delete/export:task + view:task-audit-log. read:project/read:task PHẢI false (cổng nav FE —
 * getCapabilities lọc bỏ mọi cặp sensitive).
 */

export interface TaskPermissionEntry {
  action: string;
  resourceType: string;
  sensitive: boolean;
}

export const TASK_PERMISSIONS: readonly TaskPermissionEntry[] = [
  // project (8)
  { action: "read", resourceType: "project", sensitive: false },
  { action: "create", resourceType: "project", sensitive: false },
  { action: "update", resourceType: "project", sensitive: false },
  { action: "delete", resourceType: "project", sensitive: true },
  { action: "close", resourceType: "project", sensitive: true },
  { action: "archive", resourceType: "project", sensitive: true },
  { action: "manage-member", resourceType: "project", sensitive: true },
  { action: "view-report", resourceType: "project", sensitive: true },
  // task (14)
  { action: "read", resourceType: "task", sensitive: false },
  { action: "create", resourceType: "task", sensitive: false },
  { action: "update", resourceType: "task", sensitive: false },
  { action: "delete", resourceType: "task", sensitive: true },
  { action: "assign", resourceType: "task", sensitive: false },
  { action: "comment", resourceType: "task", sensitive: false },
  { action: "watch", resourceType: "task", sensitive: false },
  { action: "export", resourceType: "task", sensitive: true },
  { action: "view-kanban", resourceType: "task", sensitive: false },
  { action: "update-status", resourceType: "task", sensitive: false },
  { action: "update-priority", resourceType: "task", sensitive: false },
  { action: "update-deadline", resourceType: "task", sensitive: false },
  { action: "file-upload", resourceType: "task", sensitive: false },
  { action: "file-delete", resourceType: "task", sensitive: false },
  // task-audit-log (1) — resource DISTINCT, KHÔNG tái dùng generic 'audit-log' (tránh over-grant)
  { action: "view", resourceType: "task-audit-log", sensitive: true },
] as const;

export const TASK_PERMISSION_COUNT = 23;

/** 8 cặp sensitive — dùng cho assert allowlist + UPDATE-nâng trong 0485. */
export const TASK_SENSITIVE_PAIRS: readonly string[] = TASK_PERMISSIONS.filter(
  (p) => p.sensitive,
).map((p) => `${p.action}:${p.resourceType}`);

export type TaskGrantScope = "Own" | "Team" | "Department" | "Company" | "System";

/** 1 hàng ma trận: scope per role canonical (undefined = KHÔNG grant — deny-hole phải giữ). */
export interface TaskMatrixRow {
  action: string;
  resource: string;
  emp?: TaskGrantScope;
  mgr?: TaskGrantScope;
  hr?: TaskGrantScope;
  ca?: TaskGrantScope;
}

/**
 * Ma trận grant 67 hàng SEED Ở 0485 (employee 7 · manager 19 · hr 18 · company-admin 23).
 * Truy nguyên từng hàng: SPEC-06 §9 (docs/spec/SPEC-06 TASK.md:524-543) — chi tiết ở plan §3.
 * "Nếu owner/creator" của manager (close/delete/archive/manage-member:project, delete:task)
 * = owner-check per-project ở BE (S4-TASK-BE-1) — seed chỉ cấp capability @Team.
 *
 * ⚠️ 5 grant HOÃN sang S4-TASK-BE-2 (TASK_DEFERRED_GRANTS bên dưới): route legacy /tasks đang SỐNG
 * gate pair-only (KHÔNG áp data-scope/owner-check) ⇒ grant write/destructive net-new cho role
 * scope-đích < Company sẽ mở ghi/xóa TOÀN-CÔNG-TY ngay khi migrate. Fail-closed: employee/manager
 * hôm nay 403 trên các route đó → giữ 403 tới khi BE-2 enforce scope+membership CÙNG release grant.
 */
export const TASK_GRANT_MATRIX: readonly TaskMatrixRow[] = [
  // project — KHÔNG route sống nào tiêu thụ (đã quét 2026-07-10: tasks module chỉ gate task/label/
  // project_state) ⇒ capability dormant tới S4-TASK-BE-1 (route mới PHẢI kèm owner-check per-project).
  { action: "read", resource: "project", emp: "Own", mgr: "Team", hr: "Company", ca: "Company" },
  { action: "create", resource: "project", mgr: "Team", hr: "Company", ca: "Company" },
  { action: "update", resource: "project", mgr: "Team", hr: "Company", ca: "Company" },
  { action: "close", resource: "project", mgr: "Team", ca: "Company" },
  { action: "archive", resource: "project", mgr: "Team", ca: "Company" },
  { action: "delete", resource: "project", mgr: "Team", ca: "Company" },
  { action: "manage-member", resource: "project", mgr: "Team", ca: "Company" },
  { action: "view-report", resource: "project", mgr: "Team", hr: "Company", ca: "Company" },
  // task — read/comment giữ cho emp/mgr (đã disclose plan §7: read = tiền lệ đã-chấp-nhận,
  // comment = mirror RECON-1); create/update/delete HOÃN cho emp/mgr (TASK_DEFERRED_GRANTS).
  { action: "read", resource: "task", emp: "Own", mgr: "Team", hr: "Company", ca: "Company" },
  { action: "create", resource: "task", hr: "Company", ca: "Company" },
  { action: "update", resource: "task", hr: "Company", ca: "Company" },
  {
    action: "update-status",
    resource: "task",
    emp: "Own",
    mgr: "Team",
    hr: "Company",
    ca: "Company",
  },
  { action: "comment", resource: "task", emp: "Own", mgr: "Team", hr: "Company", ca: "Company" },
  {
    action: "file-upload",
    resource: "task",
    emp: "Own",
    mgr: "Team",
    hr: "Company",
    ca: "Company",
  },
  { action: "file-delete", resource: "task", mgr: "Team", hr: "Company", ca: "Company" },
  { action: "watch", resource: "task", emp: "Own", mgr: "Team", hr: "Company", ca: "Company" },
  {
    action: "view-kanban",
    resource: "task",
    emp: "Own",
    mgr: "Team",
    hr: "Company",
    ca: "Company",
  },
  { action: "assign", resource: "task", mgr: "Team", hr: "Company", ca: "Company" },
  { action: "update-priority", resource: "task", mgr: "Team", hr: "Company", ca: "Company" },
  { action: "update-deadline", resource: "task", mgr: "Team", hr: "Company", ca: "Company" },
  { action: "delete", resource: "task", ca: "Company" },
  { action: "export", resource: "task", mgr: "Team", hr: "Company", ca: "Company" },
  // task-audit-log — hr theo tiền lệ ATT/LEAVE (0454/0455); manager KHÔNG có
  { action: "view", resource: "task-audit-log", hr: "Company", ca: "Company" },
] as const;

/**
 * 5 grant HOÃN — S4-TASK-BE-2 grant trong migration CÙNG release với enforcement
 * scope+membership trên task CRUD (lật cả assert DENY tương ứng trong
 * task-permissions-seed.int.spec.ts, mirror khuôn RECON-2 lật task-recon-grants).
 * Lý do từng hàng: docs/plans/S4-TASK-SEED-1.md §7 (route sống pair-only:
 * POST /tasks · PATCH /tasks/:id{,/status,/labels/*} · DELETE /tasks/:id + DELETE attachment).
 */
export const TASK_DEFERRED_GRANTS: readonly TaskMatrixRow[] = [
  { action: "create", resource: "task", emp: "Own", mgr: "Team" },
  { action: "update", resource: "task", emp: "Own", mgr: "Team" },
  { action: "delete", resource: "task", mgr: "Team" },
] as const;

/** Số grant kỳ vọng per role TRÊN TẬP 23 cặp canonical SAU 0485 (verify exact — chống over-grant). */
export const TASK_EXPECTED_GRANT_COUNTS = {
  employee: 7,
  manager: 19,
  hr: 18,
  "company-admin": 23,
} as const;
