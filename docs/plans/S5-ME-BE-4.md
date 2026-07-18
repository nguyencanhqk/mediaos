```yaml
wo: S5-ME-BE-4
zone: red
tier: crown
generated_by: claude-session
title: "Avatar own-scope self-upload (ME presign wrapper) + GET current avatar"
depends_on: [S5-ME-BE-2]
gate: FULL
reviewers: [security-reviewer, silent-failure-hunter, database-reviewer]
lanes:
  - id: mebe4avatar
    task: >
      Đóng "Nợ để lại" của S5-ME-BE-2 (docs/plans/S5-ME-BE-2.md §Nợ để lại): employee/manager/hr THIẾU
      upload/view/download:foundation-file nên KHÔNG tự upload+confirm được file để gắn avatar, và KHÔNG có
      cách own-scope lấy downloadUrl cho avatar hiện tại lúc tải trang. Hướng A (owner chốt): ME tự bọc
      presign wrapper own-scope, TÁI DÙNG FileService nội bộ (gate foundation-file nằm ở FilesController —
      FileService KHÔNG gate ⇒ MeAvatarController gate bằng update:avatar Own gọi thẳng được). KHÔNG migration,
      KHÔNG cặp quyền mới, KHÔNG mở rộng grant foundation-file cho role thường.
      (1) contracts packages/contracts/src/me.ts APPEND-ONLY: meAvatarUploadUrlInputSchema
      {originalName,sizeBytes,declaredMimeType(image)}, meAvatarUploadUrlResponseSchema {fileId,uploadUrl,expiresAt},
      meCurrentAvatarSchema = meAvatarSchema.nullable() (GET trả null khi chưa có avatar). meAvatarSchema tái dùng.
      (2) me-avatar.controller.ts APPEND 3 route (guard class-level PermissionGuard sẵn) — KHÔNG đổi POST/DELETE cũ:
      POST /me/avatar/upload-url @RequirePermission(update,avatar) → svc.createUploadUrl;
      POST /me/avatar/confirm    @RequirePermission(update,avatar) → svc.confirmOwnUpload (own-scope wrapper confirm);
      GET  /me/avatar            @RequirePermission(access,me)     → svc.getCurrentAvatar (own-scope theo token, FAIL-SOFT).
      (3) me-avatar.service.ts (INJECT thêm MeAvatarRepository vào constructor — provider đã có ở me.module.ts):
      + createUploadUrl(actor,dto) [resolveOwnEmployeeIdOrThrow (unlinked→409, MUTATION) → assert declaredMimeType
      image/* → this.files.upload(actor,{originalName,declaredMimeType,sizeBytes,visibility:'Private'}) → {fileId,uploadUrl,expiresAt}];
      + confirmOwnUpload(actor,fileId) [fileRepo.findByIdTx → !file → 404 (mirror setAvatar:56) → owner-check
      ownerUserId===actor.id (IDOR — không confirm file người khác) → this.files.confirmUpload(actor,fileId,{}) → tái dùng
      confirmUploadResponseSchema (contracts/files.ts — không chứa checksum/storage; CHỐT shape này, KHÔNG 204 mơ hồ)];
      + getCurrentAvatar(actor) FAIL-SOFT [person unlinked → null; repo.getAvatarFileIdTx null → null; else try
      this.files.getDownloadUrl(actor,fileId) → {fileId,downloadUrl,expiresAt}, CATCH HẸP THEO KIỂU
      `err instanceof ForbiddenException|NotFoundException|ConflictException` → null (+ log debug 1 dòng khi degrade);
      lỗi hạ tầng/DB KHÁC PHẢI propagate — KHÔNG bare `catch{}` (silent-failure-hunter soi điểm này)].
      setAvatar/removeAvatar GIỮ NGUYÊN (Pending→409 không đổi — test regression int-spec:410-425 vẫn xanh).
      (4) me-avatar.repository.ts APPEND getAvatarFileIdTx(tx,companyId,employeeId)→ employee_profiles.avatar_url (withTenant+eq).
      (5) me.constants.ts: KHÔNG cặp mới. GET dùng ME_ACCESS_PAIR (access:me, mig 0495 — đã tồn tại, mọi user ME có, đúng
      là READ); POST upload-url/confirm dùng ME_AVATAR_UPDATE_PAIR (update:avatar Own). Cả hai đã seed ⇒ KHÔNG migration.
    builder: backend-builder
    model: opus
    paths:
      - packages/contracts/src/me.ts
      - apps/api/src/me/me-avatar.controller.ts
      - apps/api/src/me/me-avatar.service.ts
      - apps/api/src/me/me-avatar.repository.ts
      - apps/api/test/integration/me-preferences-avatar.int-spec.ts
      - apps/api/src/me/me-avatar.service.spec.ts
```

## GAP-ANALYSIS (đối chiếu CODE 2026-07-18)

Xác nhận qua đọc code + test:

- **BE POST/DELETE /me/avatar** (`me-avatar.controller.ts`, S5-ME-BE-2) đã có — nhưng chỉ **link** 1 file
  ĐÃ `Uploaded`. Không tạo được `fileId`, không đọc lại được avatar hiện tại.
- **Lỗ hổng A (upload):** để có `fileId`, FE phải gọi `POST /foundation/files/upload` + `POST
  /foundation/files/:id/confirm` — cả hai `@RequirePermission("upload","foundation-file")`
  (`files.controller.ts:57,70`). Seed thực tế: `*:foundation-file` **CHỈ company-admin có** (mig 0005 blanket
  non-sensitive; employee/manager/hr 0 grant — `me-avatar-file.resolver.ts` docstring + int-spec dòng 511-513
  + `S5-ME-BE-2.md:106` "Nợ để lại").
- **Lỗ hổng B (hiển thị avatar hiện tại):** `employee_profiles.avatar_url` lưu **fileId thô** (không phải URL —
  `me-avatar.service.ts` docstring). `hr-read.service.ts:482` trả `avatarUrl: row.avatarUrl` = fileId. Cách duy
  nhất đổi ra URL: `GET /foundation/files/:id/download-url` cần `download:foundation-file` (chỉ admin). Không có
  `GET /me/avatar`. ⇒ user thường không thấy avatar cũ lúc tải trang.
- **FileService (nội bộ) KHÔNG gate:** `files.service.ts` — `upload`/`confirmUpload`/`getDownloadUrl` không có
  `@RequirePermission` (gate nằm ở FilesController). `getDownloadUrl` dispatch qua `FilePolicy.canDownload` →
  `MeAvatarFileResolver.canDownloadFile` (own-scope) khi file là link ME/avatar ⇒ own-user lấy được URL avatar
  của CHÍNH mình (đúng như `setAvatar` đã dùng, `me-avatar.service.ts:95`). ⇒ ME bọc wrapper own-scope hợp lệ,
  KHÔNG cần grant foundation-file.

## INVARIANTS (CLAUDE.md §2 — luôn áp)

- **#1 company_id/RLS:** mọi truy vấn qua `withTenant` (repo mới `getAvatarFileIdTx` nhận companyId + eq).
- **#2 không hard-delete / không lộ storage:** không đụng bảng append-only; response wrapper KHÔNG lộ
  storage_path/checksum (chỉ `{fileId, uploadUrl|downloadUrl, expiresAt}`; downloadUrl TTL-ngắn có expiresAt).
- **#3 không secret plaintext:** không log fileId ở mức nhạy cảm; không đổi masking HR.
- **IDOR (SPEC-09 §14.4/§17.1):** MỌI route own-scope resolve owner 100% từ token; KHÔNG @Param owner. Owner-check
  file (`ownerUserId===actor.id`) GIỮ NGUYÊN TRƯỚC confirm — không được confirm file người khác upload.
- **Fail-closed:** resolver không tìm thấy row (cross-tenant RLS 0-row / not-my-employee) ⇒ deny.

## QUYẾT ĐỊNH KIẾN TRÚC (builder phải theo)

1. **Gate GET /me/avatar = `access:me`** (KHÔNG `update:avatar`, KHÔNG cặp `view:avatar` mới) — GET là READ, gate
   sau `update` là lệch ngữ nghĩa (và có thể deny oan user chỉ có view); cặp `view:avatar` mới = migration ⇒ vi phạm
   Hướng A. `access:me` (ME_ACCESS_PAIR, mig 0495) đã có, mọi user ME đều qua, đồng nhất với các READ khác của
   MeController. Own-scope KHÔNG đến từ cặp quyền mà từ token (getAvatarFileIdTx đọc employee của token-user) +
   `MeAvatarFileResolver` (getDownloadUrl own-scope) ⇒ access:me an toàn cho read này.
2. **KHÔNG fold confirm vào POST /me/avatar** (sửa theo plan-reviewer REVISE #1) — thêm `POST /me/avatar/confirm`
   riêng own-scope thay vì đổi ngữ nghĩa endpoint ĐÃ SHIP. Giữ POST /me/avatar y nguyên (link file ĐÃ Uploaded;
   Pending→409 KHÔNG đổi) ⇒ **test regression int-spec:410-425 (Pending→409, thuần-DB) vẫn xanh**, không biến
   deny-path thành phụ-thuộc-storage. Flow own-scope: upload-url → PUT bytes → confirm → POST /me/avatar → GET.
   `confirmOwnUpload` idempotent (file đã Uploaded → 200, mirror FileService.confirmUpload). Confirm khi bytes chưa
   PUT → 422 `FOUNDATION-FILE-ERR-CONFIRM-ABSENT` (surface, KHÔNG nuốt) — test này thuộc nhánh MinIO probe.
3. **GET /me/avatar FAIL-SOFT** (plan-reviewer #2/#3) — read tải-trang KHÔNG được ném lỗi cứng: unlinked → `null`;
   avatar_url null → `null`; getDownloadUrl ném Forbidden/NotFound/Conflict (link ME/avatar soft-deleted/khuyết,
   file Infected/not-downloadable, hoặc avatar do admin set link khác) → CATCH → `null` (coi như chưa có avatar
   hiển-thị-được). Response = `meAvatarSchema.nullable()`.
4. **createUploadUrl KHÔNG kèm module/entity metadata** khi register (đăng ký file Private owned-by-actor thuần) —
   link ME/avatar CHỈ tạo ở bước POST /me/avatar (tránh dispatch policy sớm khi file chưa Uploaded).
5. **KHÔNG migration, KHÔNG schema change, KHÔNG đụng permission-seed.** Không sửa app.module.ts (MeModule đã
   import FilesModule + đăng ký resolver ở onModuleInit từ S5-ME-BE-2).

### Ghi chú cho FULL-gate reviewer (plan-reviewer flagged, chấp nhận cho MVP)

- **getDownloadUrl có tác dụng phụ:** ghi `file_access_log` (action=Download) + bump `download_count` MỖI lần
  GET /me/avatar (files.service.ts:487-499) ⇒ mỗi lần tải /me tăng đếm tải. Chấp nhận MVP (avatar là own-file); FE
  nên cache theo `expiresAt` để giảm gọi lại. Không phải bug.
- **Không magic-byte verify (tiền tồn tại):** FileService chỉ khớp `declaredMimeType ∈ allowlist` + extension↔MIME,
  KHÔNG re-detect nội dung (dù files.ts:79 hứa). Holder `update:avatar` có thể register `image/png` rồi PUT bytes
  khác. Ngoài scope WO — nêu để security-reviewer biết.
- **Orphan Pending (tiền tồn tại):** files.upload KHÔNG set `is_temporary` ⇒ avatar Pending bỏ dở có thể không được
  job dọn temp reap. Ngoài scope; cân nhắc WO sau.
- **originalName phải có đuôi ảnh hợp lệ** (vd `avatar.png`) — nếu không files.upload reject `EXTENSION`. FE contract
  phải truyền tên thật (ghi vào docstring contract).

## TEST (RED trước — deny-path + IDOR + gap-closed)

Extend `me-preferences-avatar.int-spec.ts` (DB cô lập `LANE_DB=mediaos_mebe4`, gate `hasDb && LANE_DB`). **GIỮ NGUYÊN
test 410-425 (Pending→409, thuần-DB)** — POST /me/avatar không đổi.

DB-only (không cần MinIO):
- `POST /me/avatar/upload-url`: thiếu update:avatar → **403**; unlinked-employee → **409 ME-ERR-UNLINKED-EMPLOYEE**;
  declaredMimeType không phải image → **415/400** (KHÔNG register file rác — chưa chạm storage).
- `POST /me/avatar/confirm`: thiếu update:avatar → **403**; **IDOR** — confirm fileId của user KHÁC (ownerUserId≠actor)
  → **403 TRƯỚC khi chạm confirm/storage** (owner-check đứng trước).
- `GET /me/avatar`: thiếu access:me → **403**; user chưa có avatar → **200 `data=null`**; unlinked → **200 `data=null`**
  (FAIL-SOFT, KHÔNG 409); cross-tenant — token tenant A KHÔNG đọc avatar user cùng-id tenant B.

Nhánh MinIO (storageReady probe, mirror block E2E 480-506):
- `POST /me/avatar/confirm` khi bytes CHƯA PUT → **422 FOUNDATION-FILE-ERR-CONFIRM-ABSENT** (surface, không nuốt).
- **GAP-CLOSED (E2E):** user có **CHỈ `update:avatar` + `access:me`** (KHÔNG foundation-file grant nào):
  upload-url → PUT bytes → `POST /me/avatar/confirm` → **200** → `POST /me/avatar {fileId}` → **201**, `avatar_url=fileId`,
  `file_links` Avatar; `GET /me/avatar` → **200** `downloadUrl ^https?://`. Chứng minh flow chạy TRỌN cho role thường
  KHÔNG cần foundation-file (đóng "Nợ để lại").

Unit `me-avatar.service.spec.ts`:
- createUploadUrl: unlinked → throw 409; non-image → throw 415/400 (KHÔNG gọi files.upload); image → gọi files.upload
  đúng input {visibility:'Private', không entityId}.
- confirmOwnUpload: owner-check chạy TRƯỚC files.confirmUpload (file người khác → throw 403, files.confirmUpload KHÔNG
  được gọi).
- getCurrentAvatar FAIL-SOFT: avatar_url null → null; files.getDownloadUrl throw Forbidden/NotFound/Conflict → trả null
  (KHÔNG rethrow).

## VERIFY

`pnpm --filter @mediaos/contracts build` (rebuild dist — FE/BE import từ dist) → `pnpm --filter @mediaos/api typecheck`
→ `bash scripts/lane-db-setup.sh mebe4` → `export LANE_DB=mediaos_mebe4` → `pnpm --filter @mediaos/api test -- me-preferences-avatar`
→ `bash harness/check.sh --lane-db=mebe4` (deny-path/IDOR chạy THẬT, TURBO_FORCE chống false-green). FULL gate:
security-reviewer + silent-failure-hunter + database-reviewer. IMPLEMENT/REVIEW = Opus.

## OUT-OF-SCOPE (chống scope-creep)

- KHÔNG build FE (⇒ WO riêng **S5-ME-FE-4**: web-core meAvatarApi + AvatarUploadCard + gắn /hr/me/profile + banner /me).
- KHÔNG migration / KHÔNG cặp quyền mới / KHÔNG mở rộng grant foundation-file cho role thường.
- KHÔNG đổi masking HR / KHÔNG đổi `avatar_url` semantics (vẫn lưu fileId) / KHÔNG đụng employees.service admin-set avatar.
- KHÔNG virus-scan pipeline mới (giữ scanStatus guard hiện có).
```
