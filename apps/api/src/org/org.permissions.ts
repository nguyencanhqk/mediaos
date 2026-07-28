/**
 * S6-SEC-ORGSCOPE-1 — cặp quyền của đường ĐỌC danh bạ `/org/employees`, khai MỘT LẦN.
 *
 * VÌ SAO phải là hằng số chứ không viết literal ở hai chỗ: `data_scope` là PER-(permission, role).
 * `PermissionGuard` gate theo cặp trong `@RequirePermission`, còn `DataScopeService.resolveAndAssert`
 * resolve scope theo cặp NÓ được truyền. Hai chỗ trôi lệch nhau ⇒ gate một cặp mà bound hàng theo
 * scope của cặp khác — lỗ hổng im lặng, test allow-path vẫn xanh
 * (memory `read-path-gate-pair-must-match-download-pair`).
 *
 * `S6-SEC-PERMVERB-1` chốt động từ canonical là `view:user` (ADR) — khi thi công, đổi ĐÚNG file này
 * cộng migration backfill per-pair; controller và service tự đi theo. Giữ đồng bộ với
 * `DIRECTORY_PAIR` trong `test/integration/org-directory-scope.int-spec.ts`.
 *
 * Nguồn seed hiện tại: `read:user` — `0005_permissions.sql:205`.
 */
export const ORG_EMPLOYEE_DIRECTORY = {
  action: "read",
  resourceType: "user",
} as const;
