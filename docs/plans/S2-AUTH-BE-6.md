```yaml
wo: S2-AUTH-BE-6
zone: red
generated_by: auto-loop
reconciled_at: "cd7c8d3"
lanes:
  - id: s2authbe6_db
    task: "Migration 0456 (nối tiếp head 0455): (a) seed catalog permission ('assign','permission', is_sensitive=TRUE) ON CONFLICT DO NOTHING — quản lý phân quyền là nhạy cảm, KHÔNG kế thừa wildcard; (b) grant EXPLICIT assign:permission → company-admin (role 0001) scope 'Company' (mirror 0037/0450, per-pair DELETE wrong-scope + INSERT ON CONFLICT — tránh deny-by-default 403); (c) widen audit_logs_object_type_chk thêm 'role','role_permission' (DO-block UNION ADD-only, idempotent, append-only #2 nguyên vẹn); (d) SYNC mảng AUDIT_OBJECT_TYPES trong schema/audit.ts thêm 'role','role_permission' CÙNG commit. KHÔNG đụng RLS/FORCE/policy/grant của 0005. Chạy migrate trên LANE_DB cô lập."
    builder: db-migration
    paths:
      - "apps/api/migrations/**"
      - "apps/api/src/db/schema/audit.ts"
  - id: s2authbe6_ct
    task: "Zod schema + type + pair-constant cho role write API (append vào permission.ts, auto-export qua index §108): createRoleSchema {name: string.min1.max, description?: string.nullable}; updateRoleSchema {name?, description?} (ít nhất 1 field); assignRolePermissionSchema {action, resourceType, effect?: 'ALLOW'|'DENY' default ALLOW, dataScope?: Own|Team|Department|Company|System default Company}; revokeRolePermissionSchema {action, resourceType, effect}; roleWriteDto (id,name,description,isSystem) trả về. Pair canonical: AUTH_ROLE_CREATE={action:'create',resource:'role'}, AUTH_ROLE_UPDATE={action:'update',resource:'role'}, AUTH_PERMISSION_ASSIGN={action:'assign',resource:'permission'} (mirror AUTH_ROLE/AUTH_PERMISSION view). pnpm build contracts."
    builder: backend-builder
    paths:
      - "packages/contracts/src/permission.ts"
  - id: s2authbe6_be
    task: "RolesAdminService + repo methods + controller routes trong permission module (KHÔNG đụng PermissionAdminService cũ — file mới, hot-file module.ts APPEND providers/controllers). Endpoint: POST /auth/roles (create:role) tạo role company_id=actor.companyId, is_system=false; PATCH /auth/roles/:id (update:role) sửa name/description; POST /auth/roles/:id/permissions + DELETE /auth/roles/:id/permissions (assign:permission, isSensitive:true) ghi/xoá role_permissions. MỌI mutation TRONG 1 withTenant tx: (1) ghi row, (2) audit (RoleCreated/RoleUpdated objectType='role'; PermissionAssigned/PermissionRevoked objectType='role_permission'), (3) assign/revoke permission → emit permission.changed fan-out MỌI user giữ role (reuse findUserIdsWithRole). Chặn: is_system=true HOẶC notOperatorRole → 403/400 KHÔNG sửa; is_sensitive=true permission → 400 KHÔNG cho gán vào role (per-user only); trùng name active → 409 (roles_company_name_active_uq); role không thuộc tenant → NotFound (RLS). Guard @RequirePermission + @UseGuards(PermissionGuard). Viết deny-path RED trước (colocated .spec.ts/.int-spec.ts dưới src/)."
    builder: backend-builder
    paths:
      - "apps/api/src/permission/**"
acceptanceChecks:
  - "POST /auth/roles {name,description} → 201, tạo roles row company_id=actor.companyId, is_system=false, deleted_at=NULL; audit action=RoleCreated objectType='role' objectId=role.id GHI CÙNG withTenant tx (SPEC-02 §13.12; DoD §8 audit)."
  - "PATCH /auth/roles/:id sửa name/description role own-tenant → 200 + audit RoleUpdated (before/after); tạo/sửa trùng name active trong cùng tenant → 409 (roles_company_name_active_uq), 0 audit."
  - "Sửa role system-defined (is_system=true, vd company-admin …001) HOẶC role operator-audience (notOperatorRole) → 403/400, roles row KHÔNG đổi, 0 audit (SPEC-02 §13.12 'role mặc định không sửa/xoá'; DB RLS WITH CHECK company_id NULL cũng chặn — defense-in-depth)."
  - "POST /auth/roles/:id/permissions gán permission non-sensitive → INSERT role_permissions(role_id,permission_id,effect,data_scope) + audit PermissionAssigned objectType='role_permission' + emit permission.changed 1 event/user đang giữ role (cùng tx); DELETE revoke → xoá row + audit PermissionRevoked + emit (matrix §2 'Gán permission')."
  - "Gán permission is_sensitive=TRUE vào role → 400/403 reject, 0 role_permissions row, 0 audit (schema comment 'sensitive per-user only' + matrix §1.1 'sensitive không kế thừa wildcard')."
  - "Guard đúng cặp canonical §13: create:role / update:role (non-sensitive, đã grant company-admin 0005) cho POST/PATCH; assign:permission (isSensitive:true, fail-closed, KHÔNG kế thừa *:*) cho assign/revoke — migration 0456 seed assign:permission + grant company-admin scope Company nên endpoint KHÔNG deny-by-default cho admin."
  - "Deny-path: caller thiếu quyền tương ứng → 403 + 0 audit + 0 DB write (deny-by-default, fail-closed)."
  - "2-tenant: actor company A KHÔNG create/update/assign lên role company B → NotFound/Forbidden qua withTenant + RLS (USING lộ own+system, WITH CHECK chặn ghi ngoài tenant); 0 mutation chéo."
  - "Migration 0456 nối tiếp head 0455 idx đơn điệu; audit_logs_object_type_chk mở rộng UNION ADD-only (append-only #2 nguyên vẹn); AUDIT_OBJECT_TYPES array sync 'role'/'role_permission' CÙNG commit — INSERT audit KHÔNG vỡ CHECK trên Postgres thật."
  - "FULL gate (security-reviewer + database-reviewer + silent-failure-hunter) PASS; coverage ≥80% module nhạy cảm; người chốt red-zone."
testTasks:
  - "RED (viết TRƯỚC, colocated src/permission/*.spec.ts): thiếu create:role → POST /auth/roles 403 + 0 audit; thiếu update:role → PATCH 403; thiếu assign:permission → assign/revoke 403 + 0 role_permissions + 0 audit."
  - "RED: gán permission is_sensitive=TRUE (vd view-salary:payslip / reveal-secret:platform-account) vào role → reject 400/403, 0 role_permissions row, 0 audit."
  - "RED: PATCH/assign lên role is_system=true (company-admin) hoặc operator role → 403/400, state KHÔNG đổi."
  - "Integration DB cô lập (src/permission/*.int-spec.ts, gate hasDb && LANE_DB — tránh xanh-giả): 2-tenant — actor company A tạo/sửa/assign role company B → RLS chặn (NotFound), 0 row; happy-path company-admin: create→update→assign→revoke green; assert audit_logs có RoleCreated/RoleUpdated/PermissionAssigned/PermissionRevoked + outbox_events permission.changed đếm đúng số user giữ role."
  - "Contract test (packages/contracts): createRole/updateRole/assignRolePermission/revokeRolePermission schema round-trip parse hợp lệ + reject input xấu (name rỗng, effect ngoài enum, dataScope ngoài 6 giá trị)."
  - "QA sign-off đối chiếu SPEC-02 §13.12 (tạo role, không trùng name, gán permission cho role) + §13.13 (admin gán permission nếu có quyền) + matrix §2 (ADM: create/update role + assign permission 'Có (giới hạn)')."
steps:
  - "Đội 2 lane s2authbe6_db (NỐI TIẾP TRƯỚC): tạo migration 0456 — seed assign:permission (sensitive) + grant company-admin scope Company; widen audit CHECK 'role'/'role_permission' DO-block UNION; sync AUDIT_OBJECT_TYPES array cùng commit. Verify migrate trên DB cô lập (bash scripts/lane-db-setup.sh + LANE_DB)."
  - "Đội 2 lane s2authbe6_ct (song song db): thêm createRole/updateRole/assignRolePermission/revokeRolePermission schema + pair constants vào packages/contracts/src/permission.ts; pnpm build contracts (dual ESM/CJS)."
  - "Đội 2 lane s2authbe6_be (SAU db+ct): viết deny-path RED trước (thiếu quyền 403 + 0 audit; sensitive-perm-to-role reject; system-role edit reject; 2-tenant RLS). Sau đó GREEN: RolesAdminRepository (insert/update roles; insert/delete role_permissions; find role own-tenant + notOperatorRole; find permission catalog + is_sensitive; reuse findUserIdsWithRole) + RolesAdminService (withTenant tx: row+audit+emit) + controller routes @RequirePermission + DTO wrappers."
  - "Wire vào permission.module.ts (APPEND controller + providers, KHÔNG rewrite factory cũ)."
  - "Integration test DB cô lập (hasDb && LANE_DB): happy-path company-admin create/update/assign/revoke green; 2-tenant cross-company blocked; audit rows + outbox permission.changed đếm được."
  - "FULL gate: security-reviewer + database-reviewer + silent-failure-hunter (+ santa-method crown) → người chốt (red-zone, no auto-merge). Cập nhật harness/backlog.mjs."
```

## Reconcile / Gap-Analysis / Invariants

### GAP-ANALYSIS (đối chiếu code hiện tại)

1. **Read-only đã có** — `auth-roles-permissions.controller.ts` (S2-AUTH-BE-3, `view:role`/`view:permission`). WRITE path CHƯA có.
2. **PermissionAdminService** quản `user_roles` (assign role→user) + `object_permissions`, KHÔNG chạm `role_permissions` hay role create/update. Gap thật — làm SERVICE MỚI (`RolesAdminService`), KHÔNG sửa file crown cũ.
3. **Catalog**: `create:role`/`update:role`/`delete:role` đã seed non-sensitive ở 0005 + grant company-admin (WHERE `is_sensitive=false`). POST/PATCH KHÔNG deny-by-default. `assign:permission` KHÔNG tồn tại ở bất kỳ migration nào. Migration 0456 PHẢI seed `('assign','permission',TRUE)` + grant EXPLICIT company-admin (mirror 0037 grant-object-permission) nếu không endpoint 403 oan (bẫy F2 catalog).
4. **audit** `AUDIT_OBJECT_TYPES` + DB CHECK CHƯA có `'role'`/`'role_permission'` (chỉ `'user_role'`/`'object_permission'`). Widen CHECK UNION + sync array cùng commit (bài học sequence_counter/0446).

### INVARIANTS

- **BẤT BIẾN #1**: mọi query qua `withTenant(companyId)`. RLS roles `WITH CHECK company_id=current_tenant` tự chặn ghi system role (NULL) — nhưng app VẪN reject sớm `is_system` + `notOperatorRole` (defense-in-depth, tránh silent 0-row).
- **BẤT BIẾN #2**: audit append-only trong tx + `role_permissions` KHÔNG UPDATE (GRANT chỉ SELECT/INSERT/DELETE ở 0005). Đổi effect/scope = DELETE+INSERT (mirror assignRole/setObjectPermission + 0450).
- **CONTRACT permission.module**: mọi mutate `user_roles`/`role_permissions`/`object_permissions` PHẢI (1) audit (2) emit `permission.changed` cùng tx. Assign/revoke permission→role fan-out 1 event/user giữ role (reuse `findUserIdsWithRole`), nếu bỏ: cache stale ≤300s + unaudited. Create/update role name/desc KHÔNG đổi capability → KHÔNG cần emit.
- **SENSITIVE**: `assign:permission` guard `isSensitive:true` (Tầng 4, non-wildcard); target permission `is_sensitive=TRUE` bị REJECT khỏi `role_permissions` (sensitive per-user only).

### VERIFY

- Migrate LANE_DB cô lập (drizzle đơn điệu — DB chung skip band thấp → xanh/đỏ giả).
- int-spec colocate `src/` + gate `hasDb && LANE_DB`.

### GATE

FULL (security-reviewer + database-reviewer + silent-failure-hunter) + santa crown + người chốt (red-zone, no auto-merge).

### OUT-OF-SCOPE (anti-scope-creep)

- `DELETE /auth/roles/:id` (soft-delete role) KHÔNG trong `done_when`/title → follow-up WO.
- `role_code` + status column (SPEC-02 §13.12 nêu nhưng DB roles CHỈ có name/description/is_system/deleted_at — spec↔DB divergence, DB chuẩn) → MVP dùng name làm định danh unique (`roles_company_name_active_uq`), `role_code` hoãn.
- Gán role→user (`user_roles`) đã có ở `PermissionAdminController` — KHÔNG làm lại.
- KHÔNG chạm `apps/api/src/users/**`.
- Lane `s2authbe6_db` được phép mở rộng paths ra `apps/api/migrations/**` + `apps/api/src/db/schema/audit.ts` (WO paths thiếu migration/schema — bắt buộc cho db lane, guard-scope waiver).
