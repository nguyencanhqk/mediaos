```yaml
wo: S5-HR-AVATAR-1
zone: red
tier: crown
title: "HR-managed employee avatar (đặt/gỡ avatar cho NV khác) + reconcile owner-check S5-ME-BE-5"
depends_on: [S5-ME-BE-5]
gate: FULL
reviewers: [security-reviewer, database-reviewer, silent-failure-hunter]
branch: feat/me-avatar-own-scope   # gộp vào PR #228 (sửa chung cổng bảo mật avatar)
lanes:
  - id: hravatar-be
    task: >
      BE: (0) RECONCILE cổng bảo mật S5-ME-BE-5 — đổi điều kiện resolve từ `files.owner_user_id =
      employee_profiles.user_id` sang `files.owner_user_id = file_links.created_by` (NGƯỜI TẠO LINK sở hữu
      file). Vẫn chặn forge (created_by≠owner → loại) NHƯNG hỗ trợ avatar do HR upload (owner=HR=created_by).
      Bỏ JOIN employee_profiles trong findVerifiedAvatarsTx, thêm eq(files.ownerUserId, fileLinks.createdBy).
      (1) HrEmployeeAvatarService (employees module): setEmployeeAvatar(hrUser, employeeId, fileId) +
      removeEmployeeAvatar(hrUser, employeeId) + createUploadUrl(hrUser, employeeId, input). Authorize =
      assertWriteScope(update:employee) (reuse HrWriteService pattern, Company/System fail-closed) + verify
      employee tồn tại trong tenant. File-validate mirror MeAvatarService.setAvatar: isFileOwnedByTx(hrUser) +
      Uploaded (confirm-if-pending) + non-Infected + image/*. Quản lý link TRỰC TIẾP (đã authorize, KHÔNG qua
      FileService.link/canLinkFile own-scope): FileLinkRepository.listActiveByEntityTx(ME/avatar, employeeId)
      → softDeleteTx stale → insertTx link mới (created_by=hrUser, isPrimary, accessScope Owner) → HrWriteRepository
      .updateAvatarUrlTx(employeeId, fileId). Audit action 'avatar-update'/'avatar-remove' object_type='employee'
      (before/after {avatarUrl}). Reuse FileService.upload/confirmUpload (không gate service-level).
      (2) HrEmployeeAvatarController: POST /hr/employees/:id/avatar/upload-url · POST /hr/employees/:id/avatar
      (confirm+link+set — endpoint MỚI nên fold confirm OK, không shipped-regression) · DELETE /hr/employees/:id/avatar.
      MỌI route @RequirePermission('update','employee'). :id là @Param owner NHƯNG scope+tenant khoá (KHÔNG IDOR:
      assertWriteScope + RLS). Contracts: reuse setMeAvatarInputSchema {fileId} + meAvatarUploadUrlInput/Response.
    builder: backend-builder
    model: opus
    paths:
      - apps/api/src/foundation/files/file.repository.ts
      - apps/api/src/foundation/files/avatar-presign.service.spec.ts
      - apps/api/test/integration/avatar-presign.int-spec.ts
      - apps/api/src/employees/hr-employee-avatar.service.ts
      - apps/api/src/employees/hr-employee-avatar.controller.ts
      - apps/api/src/employees/hr-employee-avatar.service.spec.ts
      - apps/api/src/employees/employees.module.ts
      - apps/api/test/integration/hr-employee-avatar.int-spec.ts
  - id: hravatar-fe
    task: >
      FE (depends_on hravatar-be): nút "Đổi ảnh"/"Gỡ ảnh" trên EmployeeDetailPage (gate useCan('update','employee')).
      web-core: hrApi (hoặc employeeAvatarApi) get/upload(4-pha)/remove theo /hr/employees/:id/avatar; query key
      hrKeys.employees.avatar(id) — invalidate sau set/remove + invalidate detail (avatarUrl mới). Tái dùng pattern
      useMeAvatar (picker/validate). Ảnh hiện tại hiển thị từ detail.avatarUrl (đã resolve BE). Loading/error/empty.
    builder: frontend-builder
    paths:
      - packages/web-core/src/lib/employee-avatar-api.ts
      - packages/web-core/src/lib/query-keys.ts
      - apps/app/src/routes/hr/employees/EmployeeDetailPage.tsx
      - apps/app/src/routes/hr/employees/use-employee-avatar.ts
      - apps/app/src/routes/hr/employees/EmployeeDetailPage.spec.tsx
```

## GAP-ANALYSIS (2026-07-18)

- HR sửa NV = `PATCH /hr/employees/:id` gate **`update:employee`** + `HrWriteService.assertWriteScope` (Company/System
  fail-closed). Form NV **KHÔNG có** field avatar. `EmployeeDetailPage` chỉ hiển thị `data.avatarUrl` (read-only).
- **Chưa có** đường HR đặt avatar cho NV khác. `employees.service` create/update nhận `dto.avatarUrl` (raw) nhưng
  form không gửi + set fileId raw KHÔNG tạo link ⇒ S5-ME-BE-5 gate không ký ⇒ không hiển thị.
- **XUNG ĐỘT bảo mật (điểm chốt):** S5-ME-BE-5 `findVerifiedAvatarsTx` yêu cầu `files.owner_user_id =
  employee_profiles.user_id` (giả định avatar tự-upload). HR upload → owner=HR ≠ employee.user ⇒ KHÔNG ký ⇒
  avatar HR đặt sẽ không hiện. ⇒ PHẢI đổi bất biến (mục QĐ §0).

## QUYẾT ĐỊNH KIẾN TRÚC

0. **RECONCILE owner-check → `owner = file_links.created_by`** (thay `= employee.user_id`). Đây là bất biến ĐÚNG:
   "người TẠO link avatar phải sở hữu file". Self-service: created_by=employee, owner=employee ✓. HR-managed:
   created_by=HR, owner=HR ✓. Forge (admin gắn file victim): canLinkFile chặn tại nguồn (admin không sở hữu file);
   nếu link forge tồn tại → owner(victim)≠created_by(admin) → loại. Defense-in-depth GIỮ NGUYÊN, mở cho HR.
1. **Reuse `update:employee`** (owner chốt) — KHÔNG cặp quyền mới, KHÔNG migration. Ai sửa được hồ sơ NV thì đổi
   được avatar (avatar directory-class). Authorize = `assertWriteScope('update')` (mirror HrWriteService — Company/
   System fail-closed, chống sub-company IDOR).
2. **HR quản lý link TRỰC TIẾP (KHÔNG qua canLinkFile own-scope):** `MeAvatarFileResolver.canLinkFile` giữ own-scope
   (self-service). HR service ĐÃ authorize (update:employee + scope) tự tạo/gỡ link qua `FileLinkRepository`
   (soft-delete stale + insert created_by=hrUser) + `updateAvatarUrlTx`. TỰ replicate file-validate (isFileOwnedByTx
   hrUser + image + Uploaded + non-Infected) — KHÔNG tin cột, chống forge tại nguồn HR path.
   - **(plan-reviewer #1/#2) NGUYÊN TỬ 1 TX:** toàn bộ set/remove chạy trong MỘT `db.withTenant(tx)`:
     `HrWriteRepository.findForUpdateTx(employeeId)` (FOR UPDATE + guard company + `isNull(deletedAt)` — serialize,
     chống race employee-tự-đổi ‖ HR-đổi; 404 nếu không có) → softDelete stale ME/avatar links → insert link mới →
     `updateAvatarUrlTx` → audit — CÙNG tx (BẤT BIẾN #2, KHÔNG bán-ghi như đường ME đa-tx hiện tại).
   - **(plan-reviewer #1) 23505 → 409 (KHÔNG 500):** insert link phải bọc bắt unique-violation (mirror
     `FileService.insertLinkOrThrow` — `uq_file_links_primary_per_entity_type` + `uq_file_links_entity_file_active`),
     map 409 thân thiện. Soft-delete stale TRƯỚC insert ⇒ không đụng is_primary; vẫn bọc 23505 phòng race.
   - **(plan-reviewer #5) CẤM import cycle:** `EmployeesModule` KHÔNG được import `me/me.constants` (MeModule đã import
     EmployeesModule → cycle DI vỡ). HR service **hardcode literal** `'ME'/'avatar'/'Avatar'` tại chỗ (comment mirror
     `file.repository.ts` AVATAR_LINK_*).
   - **(plan-reviewer warn) file_access_log:** ghi `FileAccessLogService.record` action Link/Unlink CÙNG tx (giữ
     trail file subsystem đầy đủ như FileService.link/unlink). `removeEmployeeAvatar`: soft-delete link trực tiếp
     (bypass canUnlinkFile own-scope) + `updateAvatarUrlTx(null)` + audit avatar-remove — mirror MeAvatarService.removeAvatar.
3. **Fold confirm vào POST /hr/employees/:id/avatar** — endpoint MỚI (không shipped) nên fold không gây regression
   (khác S5-ME-BE-4 vì đó là endpoint đã ship). upload-url riêng (cần presign trước PUT). DELETE gỡ.
4. **KHÔNG migration, KHÔNG cặp quyền mới, KHÔNG sửa canLinkFile/resolver own-scope** (self-service nguyên vẹn).

## INVARIANTS (CLAUDE.md §2)

- #1 company_id/RLS: mọi truy vấn qua withTenant + eq(company_id); :id khoá tenant bởi RLS + assertWriteScope.
- #2 audit append-only + không lộ storage_path: audit avatar-update/remove object_type='employee'; response chỉ
  {fileId,uploadUrl|downloadUrl,expiresAt}. #3: không secret plaintext.
- IDOR (§14.4): dù có @Param :id, authorize = assertWriteScope(update:employee) Company/System + tenant RLS ⇒ chỉ
  NV cùng company + caller đủ write-scope. Forge file: isFileOwnedByTx(hrUser) chặn gắn file người khác.
- Fail-closed: thiếu update:employee/scope → 403; file không sở hữu/không image/chưa Uploaded → 4xx; NV không tồn
  tại → 404.

## TEST (RED trước — deny-path + reconcile)

Unit `hr-employee-avatar.service.spec.ts`: thiếu update:employee → 403 (không chạm file); **(plan-reviewer #3) có
update:employee nhưng scope=Department/Team → 403** (assertWriteScope fail-closed, KHÔNG ghi DB); file KHÔNG do HR
sở hữu → 403 TRƯỚC confirm; non-image → 415; NV không tồn tại/đã soft-delete → 404 (findForUpdateTx); happy →
link(created_by=HR)+avatar_url+audit; **replace 2 lần (A→B) → stale link soft-deleted, KHÔNG đụng
uq_file_links_primary (23505 nếu có → 409, không 500)**; audit assertion: action avatar-update/remove,
object_type='employee', before/after CHỈ {avatarUrl} (KHÔNG PII/storage_path).

Int `hr-employee-avatar.int-spec.ts` (LANE_DB): deny thiếu update:employee → 403; **(plan-reviewer #4) cross-tenant:
HR tenant A dùng fileId tenant B → 404/403**; **file do NHÂN VIÊN KHÁC upload (owner≠HR) → 403**; happy E2E (MinIO)
upload-url→PUT→POST /hr/employees/:id/avatar→GET detail `avatarUrl` ký; DELETE gỡ (link soft-deleted + avatar_url null).

**RECONCILE `avatar-presign.int-spec`:** (plan-reviewer #LOW) forge test hiện tại (`:194-207`, created_by=pA ≠
owner=victim) ĐÃ thoả cổng mới → GIỮ NGUYÊN data, chỉ đổi comment (CẤM sửa thành created_by=victim). Ca ALLOW hiện
tại (`:132-142`, owner=created_by=p.userId) → vẫn ký. **Thêm ca ALLOW MỚI** đúng nghĩa cổng mới: file owner=HR,
created_by=HR, entity=employee với HR≠employee.user → PHẢI ký (cổng cũ owner=employee.user sẽ CHẶN — chứng minh
reconcile mở đúng cho HR).

Unit `avatar-presign.service.spec`: giữ cross-poison/non-verified (không đổi — pair-match + link vẫn áp).

**Pre-merge:** `bash harness/check.sh --all` (REQUIRE_LANE_DB=1) — ép deny-path/IDOR chạy THẬT (memory
ci-skips-most-integration-specs) trước khi PR #228 merge.

## VERIFY

pnpm --filter @mediaos/contracts build (nếu đụng) → api typecheck → vitest src/employees src/foundation/files src/me
(+ dashboard) → bash scripts/lane-db-setup.sh hravatar → LANE_DB → int-spec. FE: web-core build → app typecheck +
spec. FULL gate: security + database + silent-failure. Gộp commit vào nhánh feat/me-avatar-own-scope (PR #228).

## OUT-OF-SCOPE

- KHÔNG cặp quyền mới / migration. KHÔNG đổi self-service (ME) path. KHÔNG sửa canLinkFile/resolver own-scope.
- KHÔNG avatar cho NV chưa có user-link đặc biệt (avatar_url set bình thường; hiển thị theo gate). KHÔNG Nhóm C (task).
```
