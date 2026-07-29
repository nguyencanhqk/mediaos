/**
 * S6-SEC-ORGSCOPE-1 — cặp quyền của đường ĐỌC danh bạ `/org/employees`, khai MỘT LẦN.
 *
 * VÌ SAO phải là hằng số chứ không viết literal ở hai chỗ: `data_scope` là PER-(permission, role).
 * `PermissionGuard` gate theo cặp trong `@RequirePermission`, còn `DataScopeService.resolveAndAssert`
 * resolve scope theo cặp NÓ được truyền. Hai chỗ trôi lệch nhau ⇒ gate một cặp mà bound hàng theo
 * scope của cặp khác — lỗ hổng im lặng, test allow-path vẫn xanh
 * (memory `read-path-gate-pair-must-match-download-pair`).
 *
 * ⟲ **S6-SEC-PERMVERB-1 (2026-07-29) — chốt động từ canonical `view:user`; KHÔNG migration.**
 * ADR: `docs/DECISIONS/DECISIONS-06_Permission_Verb_Canonical.md`.
 *
 * VÌ SAO đổi: `0444_s2_authseed1_canonical_roles_perms.sql:87-90` cố ý giới thiệu `view:user` là
 * canonical ("KHÁC legacy read:user"), `module-app-metadata.ts:10` tuyên bố `read:user` là LEGACY
 * "KHÔNG dùng", còn `/auth/users` + role-admin + dashboard USER_SUMMARY đều gate `view:user`.
 * `/org/employees` là chỗ DUY NHẤT còn gate động từ cũ. Vì `data_scope` là PER-(permission, role),
 * hai endpoint cùng lớp dữ liệu mang hai cặp khác nhau ⇒ siết scope một bên KHÔNG siết bên kia.
 *
 * VÌ SAO KHÔNG cần migration / không cần tách 2 release (đo PROD 2026-07-29, 1 tenant `funtime`):
 * pha EXPAND đã xảy ra từ 0444. Toàn bộ 7 user SỐNG giữ cặp danh bạ đều giữ CẢ HAI động từ —
 * `SA`(6 user) + `company-admin`(1) có read:user@Company VÀ view:user@Company ⇒ đổi gate ảnh hưởng
 * 0 user. Hai role lệch đều 0 user: `project-manager` (media-era, chỉ read:user — MẤT quyền, cố ý,
 * de-media-fy) và `hr` (chỉ view:user — ĐƯỢC quyền, đúng §13). Không grant mới nào được cấp.
 *
 * ⚠️ CONTRACT CHƯA CHẠY — cố ý: row `read:user` vẫn còn trong catalog + vẫn còn grant cho
 * `project-manager`. KHÔNG revoke ở cùng release đổi enforce (memory `migration-expand-contract-required`).
 * Sau đổi này `read:user` KHÔNG còn được route nào đọc; ca `org-directory-permission.int-spec.ts`
 * "`read:user` (LEGACY) KHÔNG còn mở được danh bạ" khoá đúng điều đó.
 *
 * Giữ đồng bộ với BA pin literal độc lập (chúng CỐ Ý không import hằng này — import ⇒ tautology):
 * `src/org/org.permissions.spec.ts` (census) · `test/integration/org-directory-scope.int-spec.ts`
 * (`DIRECTORY_PAIR`) · `test/integration/org-directory-permission.int-spec.ts` (`DIRECTORY_PAIR`).
 */
export const ORG_EMPLOYEE_DIRECTORY = {
  action: "view",
  resourceType: "user",
} as const;
