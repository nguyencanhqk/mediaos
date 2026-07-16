# S5-ME-BE-2 — ME preferences + avatar (own-scope mutation)

> zone=yellow · gate LIGHT (typescript-reviewer + quality-gate) — nhánh avatar/file + permission cũng nhận
> security-reviewer soi (per WO). Nguồn chuẩn: SPEC-09 §10.8/§14.2/§15/§17/§21 (ME-DEC-008) · API-11 §5/§8 ·
> mig 0495 (bảng `user_preferences` + 5 pair quyền ME, 20 grant Own).

## Mục tiêu

Thêm 2 nhóm route MUTATION own-scope vào MeModule đã ship (S5-ME-BE-1, read-only):

- `GET/PATCH /api/v1/me/preferences` + `PATCH /api/v1/me/preferences/appearance` — upsert
  `user_preferences` (unique `company_id,user_id`) qua `withTenant`.
- `POST/DELETE /api/v1/me/avatar` — gắn/gỡ avatar cho **employee liên kết CHÍNH user hiện tại**, tái dùng
  `FileService` (register/confirm/MIME-size đã có ở `foundation/files`) — **không dựng pipeline upload mới**;
  cập nhật `employee_profiles.avatar_url`.

`PATCH /me/preferences/notifications` (notification-preference) **KHÔNG thuộc WO này** — BE đã có sẵn ở
`notifications.controller.ts` (`GET/PUT /notifications/preferences`), FE nối ở S5-ME-FE-3; path
`apps/api/src/notifications/**` không nằm trong scope WO này.

## Quyền (khớp NGUYÊN VĂN mig 0495 — KHÔNG tự đặt pair mới)

| Route | Pair (tuple) | Scope seed |
| --- | --- | --- |
| GET `/me/preferences` | `('view','user-preference')` | Own × 4 role |
| PATCH `/me/preferences` (+`/appearance`) | `('update','user-preference')` | Own × 4 role |
| POST/DELETE `/me/avatar` | `('update','avatar')` | Own × 4 role |

Guard: `PermissionGuard` class-level trên 2 controller mới (`MePreferencesController`,
`MeAvatarController`), KHÔNG global. `ME.ACCESS` (`access:me`) **không** gate lại ở đây — đã tách theo
per-route pair như API-11 §5.1 (mỗi route ME có pair riêng, không phải mọi route đều chỉ cần ME.ACCESS).

## Preferences — thiết kế

- `MePreferencesRepository` (mới): `findByUserTx` (SELECT theo `company_id,user_id`) +
  `upsertTx` (INSERT … ON CONFLICT (`company_id,user_id`) DO UPDATE — mirror `HrWriteRepository.updateTx`
  partial-spread pattern: field `undefined` trong patch object = KHÔNG đụng cột đó, Drizzle tự bỏ qua).
- `MePreferencesService`: `getPreferences` (own, `actor.id/actor.companyId` — KHÔNG cần
  `MeCurrentPersonResolver`, `user_preferences` khoá theo `user_id` KHÔNG theo employee) +
  `patchPreferences` (full patch) + `patchAppearance` (subset: theme/locale/timezone/dateFormat/
  timeFormat/density — cấu trúc con của patch tổng, TS structural-compatible).
- Validate Zod enum: `theme` (system/light/dark, khớp DB CHECK) · `density` (comfortable/compact, khớp DB
  CHECK) · `timeFormat` (12h/24h, khớp DB CHECK) · `locale` (vi/en, SPEC §10.8) · `dateFormat` (3 format phổ
  biến DD/MM/YYYY · MM/DD/YYYY · YYYY-MM-DD). `timezone`: **KHÔNG** literal enum (IANA có hàng trăm giá trị)
  — mirror `settings.service.ts` (`Zod chỉ guard min(1)`, IANA thật ép ở SERVICE qua `assertValidTimezone`
  từ `common/tz.util.ts`).
- **ME-DEC-008 (company policy khóa timezone):** field `timezone` chỉ bị chặn khi client gửi giá trị
  KHÁC null/undefined (một override THẬT — set `null` = "revert to inherit" luôn được phép, omit = không
  đụng). Đọc setting `me.allow_user_timezone_override` qua `SettingService.resolveSetting` (key CHƯA seed ở
  `setting-defaults.ts` — nằm ngoài path cho phép của WO này; `resolveSetting` trả `found=false` khi vắng ⇒
  **default DENY**, khớp "Có NẾU company cho phép" — opt-in, không cần default entry mới). Vi phạm →
  `UnprocessableEntityException` mã MỚI `ME_ERROR_CODES.TIMEZONE_OVERRIDE_DENIED` (append-only contracts).
- **KHÔNG audit** (theo chỉ đạo WO + SPEC-09 §17 liệt kê audit bắt buộc KHÔNG có "đổi personal preference"
  — chỉ notification preference BẮT BUỘC + avatar mới cần).

## Avatar — thiết kế (điểm khó nhất WO)

`employee_profiles.avatar_url` là cột `text` (SPEC/DB gọi "URL") nhưng **storage thật CHỈ cấp signed-URL
TTL-ngắn** (`StorageAdapter` cấm persist URL — xem `storage-adapter.port.ts` docstring). Vì vậy quyết định:

> **Lưu `avatar_url` = `fileId` (UUID) của bản ghi `files`** — đã có tiền lệ trong codebase
> (`profile-change-request.repository.ts` L115: `avatar_file_id: "avatarUrl" // stored as avatarUrl in the
> current schema`). `POST /me/avatar` trả kèm `downloadUrl` **tươi** (ký tại thời điểm response, KHÔNG
> persist) để FE hiển thị ngay; muốn hiển thị lại sau, FE gọi lại qua flow file chuẩn.

Luồng `POST /api/v1/me/avatar` body `{fileId}` (file ĐÃ upload+confirm qua
`POST /foundation/files/upload` → PUT bytes → `POST /foundation/files/:id/confirm` — flow CHUẨN đã có,
KHÔNG dựng lại):

1. `MeCurrentPersonResolver.resolve` — unlinked → `409 ME-ERR-UNLINKED-EMPLOYEE` (khớp API-11 §8.4: mã này
   map 409, KHÔNG phải 400 — bảng lỗi API-11 đã chốt).
2. Đọc `files` row trực tiếp qua `FileRepository.findByIdTx` (**KHÔNG** qua `FileService.getMetadata` —
   xem "Bẫy quyền" dưới) — validate: tồn tại trong tenant · `ownerUserId === actor.id` (chống IDOR: chỉ
   gắn file DO CHÍNH MÌNH upload) · `uploadStatus==='Uploaded'` · `scanStatus!=='Infected'` ·
   `mimeType` bắt đầu `image/` (ràng buộc avatar-là-ảnh — file service chung không tự ép).
3. Gỡ (soft-delete) link avatar CŨ của employee này (nếu có) rồi `FileService.link()` link MỚI
   (`moduleCode='ME', entityType='avatar', entityId=employeeId, linkType='Avatar'` — giá trị `'Avatar'`
   ĐÃ có trong `FILE_LINK_TYPE_VALUES`/DB CHECK, đúng chủ đích thiết kế gốc).
4. `HrWriteService.updateOwnAvatar` (MỚI, mirror `updateEmployee`) ghi `employee_profiles.avatar_url=fileId`
   trong CÙNG `withTenant`, audit `objectType:'employee'` action `avatar-update`/`avatar-remove` (tái dùng
   `object_type='employee'` ĐÃ có trong CHECK — KHÔNG cần migration UNION-add).
5. Trả `{fileId, downloadUrl, expiresAt}` (signed URL tươi qua `FileService.getDownloadUrl`).

`DELETE /api/v1/me/avatar`: gỡ link hiện có (soft-delete `file_links`, "theo pattern hiện có" — `unlink()`
đã có sẵn) + `updateOwnAvatar(..., null)` (clear cột).

### Bẫy quyền đã né (KHÔNG dùng `FileService.getMetadata/link/unlink` gate mặc định cho self-service)

`FilesController` (`/foundation/files/*`) gate bằng cặp `*:foundation-file` — seed hiện tại **CHỈ
company-admin có** (blanket non-sensitive grant ở mig 0005); `employee/manager/hr` **0 grant** (đối chiếu
mig 0444/0477 — không có dòng nào cấp `*:foundation-file` cho 3 role này). Nếu avatar link/unlink/download
đi qua fallback `FOUNDATION.FILE.*` của `FilePolicyService`, 3/4 role sẽ 403 dù đã có `update:avatar` Own —
phá tính năng self-service cho đa số user thật.

**Giải pháp (mirror `EmployeeFileResolver`/`HrContractFileResolver` — pattern module tự đăng ký resolver):**
`MeAvatarFileResolver implements FileOwnerPermissionResolver` cho `(moduleCode='ME', entityType='avatar')`,
đăng ký ở `MeModule.onModuleInit` vào `FilePolicyService` (singleton, additive — mirror
`EmployeesModule.onModuleInit`). Resolver **KHÔNG** gọi lại `PermissionService` (route đã gate `update:avatar`
Own ở controller) — chỉ xác nhận `entityId` (employeeId) THUỘC VỀ `input.userId` (self-scope thuần, không có
escalation Team/Department như HR file — đúng thiết kế Own-only của `update:avatar`). `canView/canDownload/
canLink/canUnlink/canDelete` đều dùng CHUNG check này.

`FileRepository`/`FileLinkRepository` cần export thêm từ `FilesModule` (hiện chỉ export
`FileService/FilePolicyService/TempFileCleanupJobHandler`) — additive 1 dòng.

**Nợ để lại (không migration ở lane này):** `employee/manager/hr` vẫn thiếu `upload/view/download:
foundation-file` nên KHÔNG tự hoàn tất bước (1) đăng ký + (3) confirm của flow file chuẩn ngoài
company-admin — cần lane `db-migration`/permission-seed cấp thêm (hoặc ME tự làm presign wrapper riêng ở
WO sau) để mọi role thật sự tự-upload được. Int-spec seed role test riêng có đủ 2 cặp này (mirror
`files-e2e-confirm.int-spec.ts`) để chứng minh **bước gắn avatar** (contract chính của WO) hoạt động đúng
cho MỌI role qua `update:avatar` Own — không phụ thuộc gap trên.

## Test (RED trước)

`apps/api/test/integration/me-preferences-avatar.int-spec.ts` (mới):

- Preferences: deny thiếu `view/update:user-preference` → 403 · IDOR (2 user cùng tenant, PATCH của A
  KHÔNG đụng row B) · cross-tenant (RLS) · upsert idempotent (PATCH 2 lần → 1 row, giá trị lần 2) · appearance
  enum sai → 400 · timezone override bị company khoá → 422 `ME-ERR-TIMEZONE-OVERRIDE-DENIED`; bật policy
  → 200 ghi được.
- Avatar: deny thiếu `update:avatar` → 403 · unlinked-employee → 409 `ME-ERR-UNLINKED-EMPLOYEE` · file
  KHÔNG phải ảnh → 415 · file thuộc user khác (IDOR) → 403 · DELETE khi chưa có avatar → idempotent (không
  lỗi) · full E2E (nếu MinIO sẵn ở `.env`, mirror `files-e2e-confirm.int-spec.ts` storageReady-probe) —
  register→PUT→confirm→POST /me/avatar→ `employee_profiles.avatar_url` = fileId + downloadUrl 200; DB-only
  assert khi MinIO vắng.
- Regression: `me-personal-hub.int-spec.ts` + `me-user-preferences-seed.int-spec.ts` (đóng `it.todo` IDOR ở
  đó bằng cách trỏ sang file mới — giữ nguyên file DB-seed, không rewrite).

## Verify

`pnpm typecheck` → `bash scripts/lane-db-setup.sh mebe2` → `export LANE_DB=mediaos_mebe2` →
`pnpm --filter @mediaos/api test -- me-preferences-avatar me-personal-hub me-user-preferences-seed`.
