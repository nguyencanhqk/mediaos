# Micro-plan — `S11-ASSET-BE-1` (🔴 red · crown · FULL gate · code-only, KHÔNG migration)

> **WO:** Module NestJS `assets`: CRUD danh mục + tài sản, cấp phát/thu hồi, bảo trì, kiểm kê — permission guard §9d, audit log, outbox NOTI, `:id`=UUID ở biên, `API_MODULE_TAGS` + route-census regen.
> **Nguồn sự thật:** [API-14 ASSET API Design](<../API Design/API-14_ASSET_API_Design.md>) · [SPEC-13 ASSET](<../spec/SPEC-13 ASSET.md>) · [DB-15 ASSET Database Design](<../DB/DB-15 ASSET Database Design.md>) · [permission-matrix-spec §9d](<../permission-matrix-spec.md>) · [S11-ASSET-DB-1 (đã merge)](S11-ASSET-DB-1.md) · [S11-OFFICE-WAVE §7](S11-OFFICE-WAVE.md)
> **Nhánh:** `wo/s11-asset-be-1` → PR vào `master`. Vùng 🔴 ⇒ **người chốt merge**, KHÔNG nhãn auto-merge. FULL gate: `security-reviewer` + `database-reviewer` + `silent-failure-hunter`.
> **Lane DB:** lane MỚI TINH `mediaos_assetbe1` (đã dựng 30/08, chain 0000→0555) → `export LANE_DB=mediaos_assetbe1` (KHÔNG tái dùng lane của DB-1 — memory `fresh-lane-db-exposes-teardown-ri-race`).
> **Rev 2** (30/08/2026) — planner Sonnet → orchestrator chốt 3 điểm mở (§1.1) → plan-reviewer Opus vòng 1 BLOCK 15 + 7 WARN → đã vá (§13). Không mở vòng 2 (quyết định owner: 1 vòng + vá).

---

## 0. Hiện trạng ĐO THẬT (30/08/2026, không lấy từ tài liệu)

| Thứ | Giá trị đo được | Nguồn |
| --- | --- | --- |
| Head migration | **idx 222 · `0555_s11roomdb1_noti_room.sql` · when `1717587344000`** | `migrations/meta/_journal.json` |
| WO này | **KHÔNG migration mới** — `paths` khai báo chỉ `apps/api/src/assets/**`, `app.module.ts`, `config/openapi-modules.ts`, `test/foundation/**`, `packages/contracts/**`. 6 bảng + seed đã merge ở `0549`–`0551` | `harness/backlog.mjs` (WO record) |
| 6 bảng ASSET | `asset_categories` · `assets` (mutable, soft-delete) · `asset_assignments` · `asset_maintenances` · `asset_inventories` · `asset_inventory_items` (4 sổ: `SELECT,INSERT` + `UPDATE` cấp cột, KHÔNG DELETE, KHÔNG `deleted_at`) | `0549` |
| CHECK tên chính xác | `chk_asset_categories_prefix` · `chk_asset_categories_interval` · `chk_assets_status` (5 giá trị) · `chk_assets_price` · `chk_assets_warranty` · `chk_asset_assignments_status` · `_issue` · `_return` · `_return_pair` · `_ack_v1` (acknowledged_at luôn NULL) · `chk_asset_maintenances_status` · `_cost` · `_close_pair` · `chk_asset_inventories_status` · `_close_pair` (4 số tổng kết) · `chk_asset_inventory_items_result` · `_expected` (**3 giá trị**, tập con) · `_check_pair` | `0549:97-450` |
| Partial unique (chốt cuối FSM) | `uq_asset_assignments_active (company_id,asset_id) WHERE status='Active'` · `uq_asset_maintenances_open (company_id,asset_id) WHERE status='Open'` · `uq_asset_inventories_open (company_id) WHERE status='Open'` (1 đợt/company, KHÔNG theo category) · `uq_assets_company_code_active` · `uq_assets_company_serial_active` · `uq_asset_categories_company_code_active` (partial `deleted_at IS NULL`) · `uq_asset_categories_company_prefix` (**KHÔNG partial** — prefix không cấp lại) | `0549` |
| Cột app role **KHÔNG được UPDATE** (column-GRANT đúng-bằng, verify fail-loud ở `0549`) | `asset_assignments`: chỉ `return_condition,return_note,returned_at,returned_by,status,updated_at,updated_by` — **KHÔNG** `asset_id,employee_id,assigned_*,issue_*,expected_return_date,acknowledged_at` · `asset_maintenances`: chỉ `closed_at,closed_by,cost,next_due_date,result_note,status,updated_at,updated_by` — KHÔNG `reason,vendor,opened_*` · `asset_inventories`: chỉ `closed_at,closed_by,found_count,missing_count,note,not_checked_count,status,total_items,updated_at,updated_by` — KHÔNG `name,category_id,opened_*` · `asset_inventory_items`: chỉ `checked_at,checked_by,note,result,updated_at,updated_by` — KHÔNG `inventory_id,asset_id,expected_*` · `asset_categories`/`assets`: **GRANT UPDATE cấp BẢNG** (không giới hạn cột ở DB) — app phải TỰ loại `asset_code`/`status` ra khỏi câu UPDATE khi PATCH, DB không chặn hộ | `0549:541-561` |
| 11 cặp quyền + role `asset-manager` | id cố định `00000000-0000-0000-0000-000000000012`, `is_system=true`, `requires_two_factor=false`, `company_id NULL`; KHÔNG canonical · **28 grant**: `employee`/`manager`/`hr` chỉ có `access@Own`+`view@{Own/Department/Company}` — **0 cặp ghi**; `company-admin`/`asset-manager` đủ 11 cặp (`access@Own`, 10 cặp còn lại `@Company`) | `0550` |
| **⚠️ Hệ quả kiến trúc quan trọng** | Vì 9 cặp GHI (`create/update/delete/assign/revoke/dispose/manage-*`) chỉ được cấp **`@Company`** cho đúng 2 role, **KHÔNG có scope Own/Department nào ở đường GHI** — khác GOAL. Mọi service GHI chỉ cần: (a) `PermissionGuard`+`@RequirePermission` ở controller, (b) `DataScopeService.resolveAndAssert` xác nhận có grant (403 nếu không), (c) tenant isolation qua `withTenant`+`company_id` trong WHERE. **KHÔNG cần** `assertWriteTarget`/`assertWriteAllowed` kiểu GOAL. Chỉ đường **ĐỌC** (`view:asset`) có 3 tầng Own/Department/Company + masking | `0550:73-150` + SPEC-13 §11 |
| 3 event NOTI | `ASSET_ASSIGNED` (Normal) · `ASSET_REVOKED` (Normal) · `ASSET_MAINTENANCE_DUE` (High) — **`dedupe_strategy='DedupeKey'`** cả 3 (KHÁC GOAL: `GOAL_ASSIGNED`/`GOAL_FINALIZED` dùng `'None'`) · 3 template `IN_APP/vi-VN` global, `target_url_template`: `/me/assets` (010/011) · `/assets/{asset_id}` (012) | `0551` |
| `AUDIT_OBJECT_TYPES` | Đã có sẵn 5 giá trị `asset · asset_category · asset_assignment · asset_maintenance · asset_inventory` (KHÔNG `asset_inventory_item`) | `apps/api/src/db/schema/audit.ts:384-388` |
| `packages/contracts/src/asset.ts` | Đã có 9 enum + `ASSET_CODE_PREFIX_RE`; barrel `index.ts` đã `export * from "./asset"` (tên `assetLifecycleStatusSchema`, **không** `assetStatusSchema` — đụng `media.ts` park). WO này **thêm DTO** vào CÙNG file | `packages/contracts/src/asset.ts` · `index.ts:170-173` |
| `schema/assets.ts` | Drizzle PARITY 6 bảng đã có (không sửa; migration SQL là chuẩn, KHÔNG `db:generate`) | `apps/api/src/db/schema/assets.ts` |
| Route census hiện tại | **468 route / 85 controller / 429 gated / 12 public / 27 ungated / 39 needVerdict**. API-14 §5: 24 mã ASSET-API = **26 route HTTP** (020, 021 mỗi mã gộp 2 route) ⇒ sau regen kỳ vọng **494 route**, `gated` +26, `ungated`/`needVerdict` **không đổi** | `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` |
| Ratchet `:id` UUID | `UNPIPED_CEILING = 1` — **KHÔNG được tăng**; mọi `:id`/`:maintenanceId`/`:itemId` PHẢI `ParseUUIDPipe` | `test/foundation/param-uuid-ratchet.unit-spec.ts:67` |
| `body-validation-census.ts` (KI-068) | `validatedAtBoundary=true` khi (a) type tham số `@Body()` là **class `createZodDto`**, (b) `@Body(new ZodValidationPipe(schema))`, hoặc (c) `@UsePipes(...)` **cấp METHOD**. `@UsePipes` **cấp class KHÔNG tính** | `test/foundation/body-validation-census.ts:17-27` |
| `main.ts` | `app.useGlobalPipes(new ZodValidationPipe())` **đã bật global** — validate vẫn CHẠY THẬT với DTO `createZodDto`, nhưng census không biết ⇒ vẫn khai `@UsePipes(ZodValidationPipe)` **cấp method** trên route ghi (đúng `done_when`) | `apps/api/src/main.ts:48` |
| `@Idempotent()` | Decorator method-level, không tham số (`../common/idempotency/idempotency.decorator`), interceptor toàn cục `APP_INTERCEPTOR`. TTL `IDEMPOTENCY_TTL_SEC=900`s. Header `Idempotency-Key` KHÔNG bắt buộc. Khoá = sha256(companyId+userId+method+path+key) | `apps/api/src/common/idempotency/idempotency.interceptor.ts` |
| `AuditService.record(tx, entry)` | `{action, objectType: AuditObjectType, objectId?, actorUserId?, before?, after?}` — gọi TRONG cùng `withTenant` tx; tự mask `before/after` | `apps/api/src/events/audit.service.ts:103-161` |
| `OutboxService.enqueue(tx, {eventType, payload})` | `eventType` chuỗi nội bộ (vd `"asset.assigned"`, KHÔNG phải NOTI `eventCode`) — registrar map `eventType → eventCode` | `apps/api/src/events/outbox.service.ts` |
| `SequenceService` | `nextCode(companyId, {sequenceKey, scopeType, scopeReferenceId})` mở **tx RIÊNG** (`db.withTenant` nội bộ) — GOAL gọi nó **TRƯỚC/NGOÀI** tx nghiệp vụ (`goals.service.ts:176-179`), KHÔNG lồng tx. `ensureCounterTx(tx, companyId, key, defaults)` — insert-if-missing IDEMPOTENT, nhận `tx` của CALLER | `apps/api/src/foundation/sequences/sequence.service.ts:128-162,204-211` |
| `pgErrorOf()` pattern | Khuôn bóc `{code, constraint}` từ `DrizzleQueryError.cause` (tối đa 5 tầng `cause`) — copy khuôn cho ASSET, KHÔNG `(err as any).code` trần | `apps/api/src/chat/chat-calls.repository.ts:610-641` |
| Identity-projection census (KI-052/N-1c) | Quét MỌI điểm chạm `users.email`/`users.fullName` trong `apps/api/src`; MỖI điểm mới PHẢI có 1 dòng ở `test/foundation/identity-projection-verdicts.ts` (`IDENTITY_VERDICTS`). L1 helper `apps/api/src/permission/identity-projection.ts`: `fromScope(cond, "scoped-predicate"\|"identity-gated", why, targetCol)` + `identityColumns(grant, spec, flagKey?)` | `identity-projection-census.ts` · `identity-projection.ts` |
| `DataScopeService` | `resolveAndAssert(userId, companyId, action, resourceType)` → `DataScope` (403 nếu không grant) · `resolveContext(userId, companyId)` → `{orgUnitId, headedOrgUnitIds,…}` · `departmentOrgUnitIds(ctx)` = own ∪ headed · `buildEmployeeScopeCondition(scope, ctx)` | `apps/api/src/permission/data-scope.service.ts` |
| `SystemJobHandler` | `@SystemJobHandler()` (class decorator) + khai trong `providers` của module mình — **tự đăng ký** qua `DiscoveryService`, KHÔNG sửa `scheduler/**` | `apps/api/src/scheduler/job-handler.ts` |
| `NotificationEngineService.intake()` | Producer in-process cho job: `{eventCode, sourceModule, sourceEntityType, sourceEntityId, dedupeKey, recipient:{mode:'UserIds',userIds,employeeIds}, payload}` — `dedupeKey` truyền **thô**, engine tự ghép `eventCode:` | `apps/api/src/notifications/task-reminder.job-handler.ts:143-154` |
| `OutboxNotificationBridge.registerSource()` | `{eventType, eventCode, sourceModule, sourceEntityType, sourceEntityIdOf, resolveRecipients, dedupeKeyOf?}` — **`dedupeKeyOf` OPTIONAL**, fallback = `ctx.eventId` (LUÔN khác nhau) ⇒ **quên `dedupeKeyOf` = dedupe biến mất câm lặng** khi catalog dùng `'DedupeKey'` | `apps/api/src/notifications/outbox-notification-bridge.service.ts:24-129` |
| `NotificationDedupeService.computeKey` | Nhánh `'DedupeKey'`: `${eventCode}:${dtoDedupeKey}` — SPEC-13 §17 minh hoạ `asset:assigned:{assignmentId}`, **giá trị lưu thật** = `ASSET_ASSIGNED:{assignmentId}` — hành vi đúng (once-ever), chỉ khác chữ | `notification-dedupe.service.ts:71-78` |
| Registrar NOTI sống ở đâu | `GoalNotiBridgeRegistrar`/`ChatNotiBridgeRegistrar` ở `apps/api/src/notifications/**` (KHÔNG import feature module — acyclic), khai trong `providers` của `NotificationsModule` | `notifications.module.ts:121-141` |
| **⚠️ `paths` WO KHÔNG có `apps/api/src/notifications/**`** | S5-GOAL-BE-2 khai `paths` gồm `notifications/**`; S11-ASSET-BE-1 chưa | `harness/backlog.mjs` |
| `API_MODULE_TAGS` | Chưa có mục `ASSET`. Segment `me` đã thuộc module `ME` (`/me/assets` tự vào nhóm ME) | `openapi-modules.ts:83-96` |
| `app.module.ts` | Khối import cuối là `ChatModule` (~dòng 104) — additive: `AssetsModule` NGAY SAU | `app.module.ts:85-105` |
| Test helper | `seedRolePermission(direct, roleId, permId, effect, scope)` · `seedUserRole` · `seedPermissionCatalog` · `cleanupTenants()` đã dọn 6 bảng ASSET (DB-1) TRƯỚC `DELETE FROM users` | `apps/api/test/helpers/seed.ts` |

---

## 1. Scope fence — việc KHÔNG làm ở WO này

- ❌ **KHÔNG migration mới, KHÔNG `db:generate`.** Nếu code cần cột/constraint KHÔNG có trong DB thật → sửa CODE cho khớp DB.
- ❌ **KHÔNG bật `modules.ASSET.is_active`** — `done_when` riêng của `S11-ASSET-FE-1`.
- ❌ **KHÔNG cấp phát 2 bước** (`acknowledged_at` luôn NULL — `chk_asset_assignments_ack_v1`; KHÔNG route/DTO nào nhận trường này).
- ❌ **KHÔNG endpoint QR ảnh / biên bản PDF** (ASSET-DEC-001/002 — FE render).
- ❌ **KHÔNG** import Excel, khấu hao, tự động thu hồi khi nghỉ việc (§5.2 API-14).
- ❌ **KHÔNG sửa `PERMISSION_CODE_TO_PAIR`** ở `packages/web-core` (FE-1).
- ❌ **KHÔNG gán role `asset-manager`** cho user nào.
- ❌ **KHÔNG hạ/tăng** `param-uuid` ratchet, KHÔNG thêm entry `route-verdicts.ts` (mọi route ASSET có `@RequirePermission`).
- ✅ `paths` WO **ĐÃ** có `apps/api/src/notifications/**` + `test/integration/**` + `docs/_review/**` + `docs/API Design/**` + `docs/spec/**` + `docs/plans/**` (sửa 30/08 trước vòng review — registrar/reader/job NOTI sống ở `notifications/` theo tiền lệ `GoalNotiBridgeRegistrar`/`TaskReminderJobHandler`, giữ chiều phụ thuộc một-hướng). Không còn việc sửa backlog nào ngoài đóng WO.
- ⚠️ **Job `ASSET_MAINTENANCE_DUE`**: chỉ `@SystemJobHandler()` + khai trong `AssetsModule.providers` — KHÔNG sửa `scheduler/**`. Nhịp chạy là hạ tầng chung — nếu lệch SPEC-13 §13.3 "1 lần/ngày" ⇒ ghi nợ, không tự sửa.

### 1.1 Ba điểm mở của planner — ĐÃ CHỐT (orchestrator, 30/08)

1. **dedupeKey**: đi theo công thức hệ thống thật (`ASSET_ASSIGNED:{assignmentId}`); SPEC-13 §17 câu minh hoạ đính chính 1 dòng trong cùng PR (không blocking).
2. **2 nhánh lỗi không có số trong SPEC-13 §12** (`SequenceNotFoundError` khi tạo tài sản; `23514 chk_asset_inventory_items_expected` khi mở đợt): dùng **2 sentinel mới** theo khuôn sentinel có sẵn (`ASSET-ERR-NOT-FOUND`/`ASSET-ERR-FORBIDDEN`): **`ASSET-ERR-COUNTER-MISSING` (409)** · **`ASSET-ERR-INVENTORY-SNAPSHOT-INVALID` (409)**. Thêm 2 dòng vào SPEC-13 §12 + API-14 §7 cùng PR.
3. **`updateAssetSchema` dùng `.strict()`** ⇒ body có `assetCode`/`status` trả **400 VALIDATION-ERR** (Zod) thay vì 422 `ASSET-ERR-011` như API-14 §7.4 viết. Chọn `.strict()` (đơn giản, chặn ở biên, không cần nhánh service không thể kiểm — Zod đã strip). Đính chính API-14 §7.4 + SPEC-13 dòng tương ứng: `ASSET-ERR-011` giữ cho `serial-taken`; nhánh `readonly-field` = 400 validation.

---

## 2. Bảng endpoint (24 mã · 26 route HTTP)

Ký hiệu scope: **W** = chỉ ghi được ở `Company` (chỉ `company-admin`/`asset-manager` có cặp); **R(O/D/C)** = đọc theo 3 tầng Own/Department/Company (SPEC-13 §13.6); **R@Own** = luôn Own bất kể grant thật (ép cứng ở service, mirror `/me/goals`). Idem = `@Idempotent()`.

| Mã | Method · Path | Cặp quyền | Scope | DTO (zod) | Mã lỗi theo nhánh | Audit | Outbox | Idem |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 001 | `GET /asset-categories` | `('view','asset')` (+`('manage','asset-category')` cho `includeDeleted`) | danh mục loại KHÔNG có "người giữ" ⇒ mọi scope thấy TOÀN BỘ danh sách loại (chỉ khác quyền `includeDeleted`) | `ListAssetCategoriesQueryDto` (`includeInactive?`, `includeDeleted?`) | 400 shape sai; `includeDeleted` khi thiếu manage → **BỎ QUA cờ, 200** (`resolveOrNull`, API-14 001 — KHÔNG 403; review B13) | — | — | — |
| 002 | `POST /asset-categories` | `('manage','asset-category')` | W | `CreateAssetCategoryDto` | 409 `ASSET-ERR-010` kind=`code-taken`/`prefix-taken`; 400 | ✅ `asset_category` | — | — |
| 003 | `PATCH /asset-categories/:id` | `('manage','asset-category')` | W | `UpdateAssetCategoryDto` (`{name?,description?,defaultMaintenanceIntervalDays?,sortOrder?,isActive?,codePrefix?,restore?}`) | 409 `010` (kể cả `prefix-locked` khi đổi `codePrefix` sau khi đã sinh mã); 404 | ✅ | — | — |
| 004 | `DELETE /asset-categories/:id` | `('manage','asset-category')` | W | — (204) | 409 `010` kind=`has-assets`; 404 | ✅ | — | — |
| 005 | `GET /assets` | `('view','asset')` | R(O/D/C) | `ListAssetsQueryDto` | 400 | — | — | — |
| 006 | `POST /assets` | `('create','asset')` | W | `CreateAssetDto` | 422 `014` (ngày sai); 409 `011` kind=`serial-taken`; 409 `COUNTER-MISSING`; 404 danh mục ngoài tenant | ✅ `asset` | — | — |
| 024 | `GET /assets/summary` | `('view','asset')` | R(O/D/C) | `AssetSummaryQueryDto` | 400 | — | — | — |
| 007 | `GET /assets/:id` | `('view','asset')` | R(O/D/C) + masking `currentHolder`/tài chính | — | 404 (`NOT-FOUND` — cross-tenant HOẶC ngoài scope, CÙNG phản hồi) | — | — | — |
| 008 | `PATCH /assets/:id` | `('update','asset')` | W | `UpdateAssetDto` `.strict()` (KHÔNG field `assetCode`/`status`) | 400 (field lạ, §1.1); 422 `014`; 409 `011` serial-taken; 404 | ✅ | — | — |
| 009 | `DELETE /assets/:id` | `('delete','asset')` | W | — (204) | 409 `015` (không `In Stock` hoặc có lịch sử); 404 | ✅ | — | — |
| 010 | `POST /assets/:id/assign` | `('assign','asset')` | W | `AssignAssetDto` | 404/422 `002` (`employee-not-found`/`employee-inactive`); 409 `001` (FSM); idempotency 409 | ✅ `asset_assignment` | `ASSET_ASSIGNED` | ✅ |
| 011 | `POST /assets/:id/revoke` | `('revoke','asset')` | W | `RevokeAssetDto` | 409 `003` (không có lượt Active); 422 `016` | ✅ `asset_assignment` | `ASSET_REVOKED` | — |
| 012 | `GET /assets/:id/assignments` | `('view','asset')` | R(O/D/C) — lọc HÀNG (Own: chỉ hàng của caller; Department: nhân viên trong đơn vị) | `ListAssignmentsQueryDto` | 404 | — | — | — |
| 013 | `POST /assets/:id/maintenances` | `('manage','asset-maintenance')` | W | `OpenMaintenanceDto` | 409 `004` (đã Open — kiểm TRƯỚC `assertTransition`); 409 `001` | ✅ `asset_maintenance` | — | — |
| 014 | `POST /assets/:id/maintenances/:maintenanceId/close` | `('manage','asset-maintenance')` | W | `CloseMaintenanceDto` | 409 `005` kind=`already-closed`; 404 `005` kind=`maintenance-not-found`; 422 `014` | ✅ `asset_maintenance` | — | — |
| 015 | `GET /assets/:id/maintenances` | `('view','asset')` | R(O/D/C); `cost` chỉ ở Company | `ListMaintenancesQueryDto` | 404 | — | — | — |
| 016 | `POST /assets/:id/dispose` | `('dispose','asset')` | W | `DisposeAssetDto` (`{kind,reason}`) | 400 (reason<3, Zod); 409 `001` (FSM); 409 `008` (còn lượt Active khi `kind='Disposed'`) | ✅ `asset` | `ASSET_REVOKED` (chỉ khi tự đóng lượt Active — `kind='Lost'`) | — |
| 017 | `POST /assets/:id/recover` | `('dispose','asset')` | W | `RecoverAssetDto` (`{reason}`) | 400; 409 `001` (không phải `Lost`) | ✅ `asset` | — | — |
| 018 | `GET /asset-inventories` | `('view','asset')` | Company only (Own/Department → **rỗng**, không lỗi) | `ListInventoriesQueryDto` | 400 | — | — | — |
| 019 | `POST /asset-inventories` | `('manage','asset-inventory')` | W | `OpenInventoryDto` | 409 `006`; 404 category | ✅ `asset_inventory` | — | ✅ |
| 020a | `GET /asset-inventories/:id` | `('view','asset')` | Own/Department → **404** (KHÔNG rỗng — khác 018) | — | 404 | — | — | — |
| 020b | `GET /asset-inventories/:id/items` | `('view','asset')` | như 020a | `ListInventoryItemsQueryDto` | 404 | — | — | — |
| 021a | `PATCH /asset-inventories/:id/items/:itemId` | `('manage','asset-inventory')` | W | `MarkInventoryItemDto` | 409 `007` (đợt Closed); 404 | ✅ `asset_inventory` (payload `itemIds:[itemId]`) | — | — |
| 021b | `POST /asset-inventories/:id/items/bulk-mark` | `('manage','asset-inventory')` | W | `BulkMarkInventoryItemsDto` (`itemIds` max 200) | 400 (>200, Zod); 409 `007`; 404 | ✅ `asset_inventory` | — | — |
| 022 | `POST /asset-inventories/:id/close` | `('manage','asset-inventory')` | W | `CloseInventoryDto` (`{note?}`) | 409 `007` kind=`already-closed`; 404 | ✅ `asset_inventory` | — | ✅ |
| 023 | `GET /me/assets` | `('view','asset')` @ép Own | R@Own, KHÔNG bao giờ có trường tài chính | `MeAssetsQueryDto` (`includeReturned?`) | — | — | — | — |

**Thứ tự khai báo route bắt buộc trong `AssetsController`:** `GET /assets/summary` (024) PHẢI đứng TRƯỚC `GET /assets/:id` (007) — nếu không Nest nuốt `summary` thành `:id` → 400 (bài học `goals/tree`).

**Tách controller** (theo prefix, KHÔNG 1 controller khổng lồ):
- `AssetCategoriesController` (`@Controller("asset-categories")`) — 001–004.
- `AssetsController` (`@Controller("assets")`) — 005–017, 024 (13 route, mỏng, chỉ định tuyến).
- `AssetInventoriesController` (`@Controller("asset-inventories")`) — 018–022.
- `MeAssetsController` (`@Controller()`, `@Get("me/assets")`) — 023, mirror `MeGoalsController`.

---

## 3. FSM ép ở service — `apps/api/src/assets/asset-fsm.ts`

### 3.1 Bảng chuyển tiếp (SPEC-13 §13.1) — 1 hàm thuần `assertTransition(from, action)`

```text
type AssetStatus = 'In Stock' | 'Assigned' | 'Under Maintenance' | 'Disposed' | 'Lost'
type AssetAction = 'assign' | 'revoke' | 'openMaintenance' | 'closeMaintenance' | 'dispose' | 'recover'
```

| from ↓ / to → | In Stock | Assigned | Under Maintenance | Disposed | Lost |
| --- | --- | --- | --- | --- | --- |
| **In Stock** | — | `assign` ✓ | `openMaintenance` ✓ | `dispose` ✓ | `dispose`(kind=Lost) ✓ |
| **Assigned** | `revoke`(Good/Damaged) ✓ | — | `openMaintenance` ✓ (lượt Active giữ nguyên) | ✗ **008** (guard `assertNoActiveAssignment` chạy TRƯỚC `assertTransition` — review B3; ô này KHÔNG có trong ma trận ⇒ nếu dữ liệu lệch (Assigned mà 0 lượt Active) mới rơi về 001) | `revoke`(Lost) ✓ **hoặc** `dispose`(kind=Lost) ✓ — cả hai **tự đóng lượt bảo trì Open** nếu có (review B4) |
| **Under Maintenance** | `closeMaintenance` ✓ (0 lượt Active) | `closeMaintenance` ✓ (còn lượt Active) | `revoke`(Good/Damaged) ✓ **(đường chéo — status GIỮ NGUYÊN, chỉ đóng lượt)** | `dispose` ✓ **CHỈ KHI** 0 lượt Active | `revoke`(Lost) ✓ **hoặc** `dispose`(kind=Lost) ✓ |
| **Disposed** | ✗ | ✗ | ✗ | — | ✗ |
| **Lost** | `recover` ✓ | ✗ | ✗ | ✗ | — |

Mọi ô ✗ → `ConflictException(ASSET_ERR.TRANSITION(from, action))` = **409 ASSET-ERR-001**. `assertTransition` là hàm THUẦN — unit-test 100% ma trận ở `asset-fsm.spec.ts`.

### 3.2 Guard thứ hai — `assertNoActiveAssignment`

- `dispose(kind='Disposed')`: **TRƯỚC** `assertTransition` (review B3 — cùng khuôn §3.3), kiểm có lượt `Active` không — có ⇒ **409 ASSET-ERR-008** (bất kể status `Assigned` hay `Under Maintenance`).
- `dispose(kind='Lost')`: KHÔNG gọi guard này — tự đóng lượt Active với `return_condition='Lost'`, phát `ASSET_REVOKED`.
- Khoá hàng `assets` bằng `SELECT … FOR UPDATE` trước khi kiểm lượt Active để chống "assign xen giữa dispose" (§3.4).

### 3.3 Thứ tự guard khi mở bảo trì

`assertNoOpenMaintenance` (chốt cuối `uq_asset_maintenances_open` → **409 ASSET-ERR-004**) chạy **TRƯỚC** `assertTransition` — tài sản `Under Maintenance` mở lượt thứ 2 phải trả `004`, không `001`.

### 3.4 MỘT câu UPDATE có `WHERE status = <from>` — mẫu chung mọi mutation trạng thái

Mọi mutation đổi `assets.status` (assign/revoke/dispose/recover) VÀ mọi "đóng sổ" (thu hồi/đóng bảo trì/đóng đợt) = **1 câu UPDATE** đủ cột CHECK `*_pair`:

```sql
-- ví dụ assign: INSERT lượt Active (chốt cuối = uq_asset_assignments_active) TRƯỚC,
-- rồi UPDATE assets SET status='Assigned', status_changed_at=now(), status_changed_by=$user, updated_at=now(), updated_by=$user
--   WHERE company_id=$1 AND id=$2 AND status='In Stock'
--   RETURNING *;
```

**Khoá hàng trước (Rev 2):** mọi mutation trạng thái mở bằng `SELECT … FROM assets WHERE company_id AND id AND deleted_at IS NULL FOR UPDATE` — hai request đua trên cùng tài sản xếp hàng ở đây, request sau đọc status ĐÃ đổi ⇒ FSM trả 4xx đúng mã; các câu UPDATE bên dưới vẫn giữ `WHERE status = <from>` (phòng thủ kép). **Ngoại lệ có chủ đích (review B5/B6):**
- `revoke`: câu quyết định ERR-003 là `UPDATE asset_assignments … WHERE status='Active' RETURNING` (0 hàng ⇒ 409 003), KHÔNG phải UPDATE `assets`. UPDATE `assets` dùng `CASE`: `Lost` ⇒ `'Lost'` · đang `Assigned` ⇒ `'In Stock'` · đang `Under Maintenance` ⇒ giữ nguyên; `condition_note` ghi khi `Damaged`; `WHERE status IN ('Assigned','Under Maintenance')`.
- `closeMaintenance`: đích tính **TRONG SQL** — `SET status = CASE WHEN EXISTS (lượt Active) THEN 'Assigned' ELSE 'In Stock' END WHERE status='Under Maintenance'` — không SELECT-rồi-UPDATE ở JS.
- `revoke(Lost)` và `dispose(Lost)` đóng lượt bảo trì Open cùng tx (`result_note` = lý do) — nếu không `uq_asset_maintenances_open` chiếm mãi ⇒ sau `recover` không mở bảo trì được (B4).
- Cấm `try/catch` nuốt exception quanh câu chẩn đoán — `withTenant` rollback khi throw (`db.service.ts`).

**Phân biệt 0-hàng KHÔNG đẻ round-trip đua:**
1. UPDATE atomic với `WHERE status=<from>` chạy TRƯỚC — round-trip DUY NHẤT quyết định kết quả GHI.
2. `RETURNING` 0 hàng ⇒ mới chạy **1 SELECT chẩn đoán** (`SELECT id, status FROM assets WHERE company_id=$1 AND id=$2`) — SELECT này **KHÔNG BAO GIỜ gate một hành động ghi**, chỉ CHỌN THÔNG ĐIỆP (không có ⇒ 404; có nhưng `status` khác ⇒ 409 qua `assertTransition` trên status đọc được). Race giữa 1 và 2 chỉ làm sai lệch THÔNG ĐIỆP, không sai dữ liệu — ghi rõ trong comment.
3. Race PARTIAL UNIQUE (2 assign song song): `INSERT asset_assignments` (chạy TRƯỚC UPDATE `assets`, cùng tx) bị `uq_asset_assignments_active` chặn 1 trong 2 ⇒ `23505` → **409 ASSET-ERR-001** qua `pgErrorOf()`, KHÔNG 500. **Thứ tự bắt buộc trong `assign()`:** INSERT lượt → UPDATE `assets.status`.

### 3.5 Map lỗi PG → ASSET-ERR (bóc từ `err.cause`, khuôn `pgErrorOf`)

`assets.errors.ts` export `mapAssetPgError(err: unknown): HttpException | null` (pure, unit-test bằng lỗi giả lập):

| `code` | `constraint` | Map |
| --- | --- | --- |
| `23505` | `uq_asset_assignments_active` | 409 `ASSET-ERR-001` |
| `23505` | `uq_asset_maintenances_open` | 409 `ASSET-ERR-004` |
| `23505` | `uq_asset_inventories_open` | 409 `ASSET-ERR-006` |
| `23505` | `uq_assets_company_code_active` | 409 `ASSET-ERR-010` kind=`code-taken` |
| `23505` | `uq_assets_company_serial_active` | 409 `ASSET-ERR-011` kind=`serial-taken` |
| `23505` | `uq_asset_categories_company_code_active` | 409 `ASSET-ERR-010` kind=`code-taken` |
| `23505` | `uq_asset_categories_company_prefix` | 409 `ASSET-ERR-010` kind=`prefix-taken` (+ SELECT chẩn đoán `categoryId`+`deleted` — §7) |
| `23505` | `uq_asset_inventory_items_inventory_asset` | 409 `ASSET-ERR-006` kind=`snapshot-duplicate` (review WARN) |
| `23514` | `chk_asset_inventory_items_expected` | 409 **`ASSET-ERR-INVENTORY-SNAPSHOT-INVALID`** (§1.1) |
| `23514` | `chk_assets_warranty` · `chk_assets_price` · `chk_asset_maintenances_cost` · `chk_asset_categories_interval` | 422 `ASSET-ERR-014` (ngày) / 400-tương-đương 422 số âm — LƯỚI THỨ HAI (review B12); lưới thứ nhất = service kiểm trên giá trị HỢP NHẤT hàng đã lưu ∪ patch |
| khác (`*_pair`, `23503`…) | — | KHÔNG map riêng — `AllExceptionsFilter` xử lý (chỉ vỡ khi service có bug thiếu cột — chặn bằng test §9) |

**Hình dạng lỗi (review B1/B2):** MỌI mã ném dạng object `{ code: 'ASSET-ERR-xxx', message, details }` (filter đọc `payload.code`); `details` là MẢNG `ErrorDetail {field,message,rule}` — `kind` = phần tử `{field:'kind', message:'<kind>', rule:'asset'}`, cặp phụ (`categoryId`/`deleted`/`from`/`action`) là các phần tử tiếp theo. Đính chính ví dụ API-14 §7.4 (object) cùng PR.

---

## 4. Data-scope + MASKING ở server

### 4.1 Resolve 1 lần/request — `AssetAccessService` (mirror `GoalAccessService`, KHÔNG có nhánh ghi)

```ts
interface AssetActorScope {
  scope: DataScope;                 // Own | Department | Company (System gộp Company — N=1)
  actorUserId: string;
  actorEmployeeId: string | null;
  deptOrgUnitIds: string[];         // rỗng nếu scope !== 'Department'
  readScopeExists?: SQL;            // undefined = Company (không filter)
}
async resolveActorScope(tx, user): Promise<AssetActorScope>   // action cố định 'view'
```

- `scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, 'view', 'asset')`.
- Mutations chỉ cần `resolveAndAssert(user.id, companyId, action, resourceType)` để 403 nếu thiếu grant — **KHÔNG có `assertWriteAllowed`/`assertWriteTarget`** (§0).

### 4.2 `readScopeExists` (dùng cho `GET /assets`, `/assets/summary`, `/assets/:id`)

```sql
-- Own: có BẤT KỲ lượt (Active HOẶC Returned) của employee của caller trên tài sản này
EXISTS (SELECT 1 FROM asset_assignments aa
         JOIN employee_profiles ep ON ep.id = aa.employee_id AND ep.company_id = $companyId
        WHERE aa.company_id = $companyId AND aa.asset_id = assets.id
          AND ep.user_id = $actorUserId AND ep.deleted_at IS NULL)
-- Department: có lượt ACTIVE mà employee thuộc đơn vị mình ∪ đơn vị mình làm trưởng
EXISTS (SELECT 1 FROM asset_assignments aa
         JOIN employee_profiles ep ON ep.id = aa.employee_id AND ep.company_id = $companyId
        WHERE aa.company_id = $companyId AND aa.asset_id = assets.id
          AND aa.status = 'Active' AND ep.org_unit_id IN ($deptOrgUnitIds) AND ep.deleted_at IS NULL)
-- Company: undefined
```

**BẮT BUỘC `EXISTS`, KHÔNG `JOIN`** `asset_assignments` vào SELECT danh sách (Own gồm cả `Returned` ⇒ N lượt ⇒ nhân bản hàng — memory `partial-unique-index-makes-join-duplicate`).

**Bộ lọc `holderEmployeeId` (005) theo scope (review B9 — chặn oracle "ai đang giữ"):** Company ⇒ honour; Own/Team ⇒ chỉ khi `= actorEmployeeId`, khác ⇒ trả **rỗng** (không lỗi); Department ⇒ chỉ khi employee thuộc `deptOrgUnitIds`, ngoài ⇒ rỗng. Ca DENY + ALLOW đối chứng ở §9.1.

### 4.3 Masking `currentHolder` — điểm CHẠM CENSUS DANH TÍNH

`assets.repository.ts#findDetailTx`: `LEFT JOIN asset_assignments aa ON … status='Active' LEFT JOIN employee_profiles ep LEFT JOIN users u`. Cột `u.fullName` = điểm chạm `identity-projection-census`.

**Bắt buộc L1 helper:**
```ts
const holderVisibleCond =
  actor.scope === 'Company' ? sql`true`
  : actor.scope === 'Own' ? sql`${users.id} = ${actor.actorUserId}`
  : actor.scope === 'Department' ? inArray(employeeProfiles.orgUnitId, actor.deptOrgUnitIds)
  : sql`false`;
const grant = fromScope(holderVisibleCond, 'scoped-predicate', '<why>', users.id);
const { holderVisible, holderFullName } = identityColumns(grant, { holderFullName: users.fullName }, 'holderVisible');
```
- `employeeCode`/`assignedAt` chiếu thẳng, nhưng mapper PHẢI dùng CHUNG cờ `holderVisible` để quyết định build `currentHolder`. Ngoài scope ⇒ **VẮNG KHOÁ `currentHolder`** (không `null`).
- **Đăng ký verdict** ở `identity-projection-verdicts.ts` — **3 dòng** (review B8: `findDetailTx` 007 · `listTx` 005 — danh sách CÓ `currentHolder` vì ASSET-SCREEN-001 có cột người giữ · list 012), basis `"scoped-predicate"`, `signedBy: "S11-ASSET-BE-1"`. **Nâng `BASIS_CEILINGS['scoped-predicate']` 21 → 24** (review B7 — trần đang bão hoà, cổng cố ý bắt sửa số có chủ đích qua FULL gate). 015 (`openedBy/closedBy`) và 020b (`expectedHolderEmployeeId`) chỉ trả **id**, không tên ⇒ không phải điểm chiếu. Comment tại chỗ: `grant.table='users'` nhưng nhánh Department dùng `employee_profiles.org_unit_id` — `identityColumns` chỉ đối chiếu bảng của spec column, nhãn `table` nói về cột được bọc, không về vị từ.
- `GET /assets/:id/assignments` (012): lọc HÀNG (Own: `ep.user_id=actorUserId`; Department: `ep.org_unit_id IN deptOrgUnitIds`) TRƯỚC khi SELECT.

### 4.4 Masking tài chính (`purchasePrice`/`supplier`/`asset_maintenances.cost`)

Masking THUẦN TS trong `assets.mapper.ts`, MỘT hàm duy nhất `toAssetDetailDto(row, effectiveScope)`: `showFinancial = scope === 'Company'`; vắng khoá khi không show. `/me/assets` (023): repository **KHÔNG BAO GIỜ SELECT** `purchase_price`/`supplier` (che ở SQL, không dựa mapper). Contracts FE: `purchasePrice`/`supplier`/`currentHolder`/`cost` **`.optional()`** (memory `server-masking-needs-optional-fe-schema`).

### 4.5 404-không-403 (SPEC-13 §12 `ASSET-ERR-012`/`013`)

Ngoài scope ĐỌC ⇒ **404** (KHÔNG 403 — khác GOAL, KHÔNG copy `loadReadableGoalTx`). Đưa `readScopeExists` THẲNG vào `WHERE` của SELECT chi tiết — 0 hàng gộp chung cross-tenant + ngoài scope ⇒ `NotFoundException(ASSET_ERR.NOT_FOUND)`.

---

## 5. Cấu trúc file — `apps/api/src/assets/`

| File | Trách nhiệm | ~dòng |
| --- | --- | --- |
| `assets.module.ts` | 4 controller + service/repository + `AssetMaintenanceDueJobHandler` | 60 |
| `asset-categories.controller.ts` | 001–004, `@UsePipes(ZodValidationPipe)` cấp method + `ParseUUIDPipe` | 90 |
| `asset-categories.service.ts` | CRUD loại + `ensureCounterTx` cùng tx + `restore` + `prefix-locked` | 180 |
| `asset-categories.repository.ts` | DB access `asset_categories` | 150 |
| `assets.controller.ts` | 005–017, 024 — MỎNG | 280 |
| `assets.service.ts` | list/get/summary/create/update/delete (KHÔNG FSM mutation) | 280 |
| `assets.repository.ts` | DB access `assets` (JOIN currentHolder §4.3) | 250 |
| `asset-fsm.ts` | `assertTransition` thuần + bảng | 90 |
| `asset-lifecycle.service.ts` | assign/revoke/dispose/recover — FSM + `asset_assignments` + audit + outbox | 320 |
| `asset-assignments.repository.ts` | INSERT lượt Active, UPDATE 1-câu thu hồi, list lịch sử (lọc scope) | 180 |
| `asset-maintenance.service.ts` | open/close — `assertNoOpenMaintenance` + `assertTransition` + `next_maintenance_due` | 180 |
| `asset-maintenance.repository.ts` | DB access `asset_maintenances` | 140 |
| `asset-inventories.controller.ts` | 018–022 | 140 |
| `asset-inventory.service.ts` | open (INSERT…SELECT lọc Disposed/Lost) / mark (1+bulk≤200) / close (GROUP BY 1 câu) | 260 |
| `asset-inventory.repository.ts` | DB access `asset_inventories`/`asset_inventory_items` | 200 |
| `asset-access.service.ts` | §4 — resolve scope, `readScopeExists`, `loadReadableAssetTx` | 150 |
| `me-assets.controller.ts` | 023 | 40 |
| `assets.dto.ts` | `createZodDto` class (mirror `goals.dto.ts`) | 150 |
| `assets.errors.ts` | `ASSET_ERR` + `mapAssetPgError` (§3.5) | 150 |
| `assets.mapper.ts` | `toAssetDetailDto`/`toAssetListItemDto`/`toMeAssetItemDto`/`toAssetAuditSnapshot` — ĐIỂM MASKING DUY NHẤT | 180 |
| `asset-noti.payload.ts` | Payload builders 3 event (§6) | 90 |
| `asset-maintenance-due.job-handler.ts` | `@SystemJobHandler()` — quét `next_maintenance_due ≤ today+7`, `intake()` | 140 |
| `apps/api/src/notifications/asset-noti-bridge.registrar.ts` + `asset-audience.reader.ts` | Registrar 2 event outbox (mirror GOAL) — CÓ `dedupeKeyOf` | 120 |

### 5.1 Contracts — `packages/contracts/src/asset.ts` (mở rộng, KHÔNG file mới)

Giữ 9 enum hiện có nguyên vẹn. Thêm:

| Schema | Field chính | Mirror CHECK |
| --- | --- | --- |
| `createAssetCategorySchema` | `code, name, codePrefix (ASSET_CODE_PREFIX_RE), description?, defaultMaintenanceIntervalDays? (>0), sortOrder?` | `chk_asset_categories_prefix`/`_interval` |
| `updateAssetCategorySchema` | partial + `isActive?`, `restore?: z.literal(true).optional()` | — |
| `createAssetSchema` | `categoryId (uuid), name, serialNumber?, brand?, model?, purchaseDate? (date), purchasePrice? (>=0), supplier?, warrantyEndDate? (date), location?, description?` | `chk_assets_price`/`_warranty` (ngày `purchaseDate ≤ today`/`warranty ≥ purchase` = ASSET-ERR-014 ở SERVICE) |
| `updateAssetSchema` | `createAssetSchema.partial().strict()` (§1.1) | — |
| `assignAssetSchema` | `employeeId (uuid), issueCondition? (assetIssueConditionSchema), issueNote?, expectedReturnDate? (date)` | `chk_asset_assignments_issue` |
| `revokeAssetSchema` | `returnCondition (assetReturnConditionSchema, BẮT BUỘC), returnNote?` | `_return`/`_return_pair` |
| `openMaintenanceSchema` | `reason (min 1), vendor?` | — |
| `closeMaintenanceSchema` | `resultNote?, cost? (>=0), nextDueDate? (date)` | `chk_asset_maintenances_cost` |
| `disposeAssetSchema` | `kind (assetDisposeKindSchema), reason (min 3)` | — |
| `recoverAssetSchema` | `reason (min 3)` | — |
| `openInventorySchema` | `name (min 1), categoryId? (uuid), note?` | — |
| `markInventoryItemSchema` | `result (z.enum(['Found','Missing'])) — chặt hơn CHECK CÓ CHỦ ĐÍCH (không đường API đặt lại 'Not Checked'), note?` | tập con `chk_asset_inventory_items_result` |
| `bulkMarkInventoryItemsSchema` | `itemIds (z.array(uuid).min(1).max(200)), result, note?` | — |
| `closeInventorySchema` | `note?` | — |
| `listAssetsQuerySchema` | `categoryId?, status? (CSV — nhất quán), holderEmployeeId?, q?, maintenanceDueBefore? (date), sortBy?, limit/offset (z.coerce)` | — |
| `assetSummaryQuerySchema` | `categoryId?` | — |
| `meAssetsQuerySchema` | `includeReturned? (z.preprocess, KHÔNG `z.coerce.boolean()` trần — memory `zod-query-param-double-pipe-idempotent`), limit/offset` | — |
| response DTO | `assetDetailResponseSchema`, `assetListItemResponseSchema` với `purchasePrice`/`supplier`/`currentHolder` **`.optional()`** | — |

---

## 6. Audit + NOTI

### 6.1 `object_type` theo endpoint = 5 giá trị `AUDIT_OBJECT_TYPES` đã có — KHÔNG sửa `schema/audit.ts`.

### 6.2 Snapshot audit KHÔNG chứa tiền — `toAssetAuditSnapshot(row)`: strip `purchasePrice`/`supplier` KHÔNG ĐIỀU KIỆN; maintenance snapshot strip `cost`.

### 6.3 Outbox — `asset-noti.payload.ts` + `AssetNotiBridgeRegistrar` (trong `notifications/`)

Trong `asset-lifecycle.service.ts.assign()`, CÙNG tx: `outbox.enqueue(tx, { eventType: 'asset.assigned', payload: { assignmentId, asset_code, asset_name, actor_name } })`.

```ts
this.bridge.registerSource({
  eventType: 'asset.assigned', eventCode: 'ASSET_ASSIGNED',
  sourceModule: 'ASSET', sourceEntityType: 'asset_assignment',
  sourceEntityIdOf: (ctx) => strField(ctx.payload, 'assignmentId'),
  resolveRecipients: async (ctx) => /* AssetAudienceReader.holderUserIdOfAssignment */,
  // ⚠️ BẮT BUỘC — dedupe_strategy='DedupeKey': quên = dedupe câm lặng (§0).
  dedupeKeyOf: (ctx) => strField(ctx.payload, 'assignmentId'),
});
```
`ASSET_REVOKED` tương tự (`dedupeKeyOf` = `assignmentId`). `AssetAudienceReader` (raw SQL `asset_assignments.employee_id → employee_profiles.user_id`).

### 6.4 `ASSET_MAINTENANCE_DUE` — job, KHÔNG qua bridge (mirror `TaskReminderJobHandler`)

`notifications/asset-maintenance-due.job-handler.ts` (sống cạnh `TaskReminderJobHandler`, khai trong `NotificationsModule.providers` — tránh `AssetsModule` import `NotificationsModule`; KHÔNG cần `@Optional()` vì cả 2 dep là provider thật): `@SystemJobHandler()`, `jobCode='ASSET_MAINTENANCE_DUE'`; `queryDue`: `WHERE company_id=$1 AND deleted_at IS NULL AND next_maintenance_due IS NOT NULL AND next_maintenance_due <= today+7 AND status NOT IN ('Disposed','Lost')` (idx `idx_assets_company_maintenance_due`); recipients (review B10, vị từ ĐỦ): `user_roles ur JOIN roles r ON r.id=ur.role_id AND r.company_id IS NULL AND r.deleted_at IS NULL AND r.name IN ('asset-manager','company-admin') JOIN users u ON u.id=ur.user_id AND u.company_id=$1 AND u.deleted_at IS NULL WHERE ur.company_id=$1 AND ur.deleted_at IS NULL AND (ur.expires_at IS NULL OR ur.expires_at > now())`; fan-out asset × recipient qua `engine.intake()` với `dedupeKey = ${asset.id}:${nextMaintenanceDue}` (once-ever theo (asset, hạn)); payload ĐỦ 4 khoá template `0551`: `asset_name · asset_code · due_date · asset_id` (deep-link `/assets/{asset_id}`). Nhịp chạy = 60s (`DEFAULT_SYSTEM_JOBS_POLL_MS`) — dedupe làm nó thành 1 noti/(asset, hạn); ghi nợ "1 lần/ngày" ở PR. Payload outbox 2 event assign/revoke kèm `actorUserId` để engine loại actor (review WARN).

---

## 7. Counter mã tài sản

`AssetCategoriesService.create()` — 1 tx: INSERT category (bắt `23505` → `010` code-taken/prefix-taken) → `sequence.ensureCounterTx(tx, companyId, { sequenceKey: 'asset_code', scopeType: 'Custom', scopeReferenceId: newCategory.id }, { moduleCode: 'ASSET', prefix: \`TS-${codePrefix}-\`, paddingLength: 4, resetPolicy: 'Never', status: 'Active' })` → audit. `prefix-taken` cần `details.categoryId`+`deleted` — SELECT chẩn đoán SAU khi bắt lỗi.

`AssetsService.create()` — `sequence.nextCode(...)` **NGOÀI/TRƯỚC** tx chính (mirror `createGoal`); `SequenceNotFoundError` → **409 `ASSET-ERR-COUNTER-MISSING`**. Sau đó `withTenant`: resolve category tồn tại + INSERT assets + audit.

`code_prefix` khoá sau khi đã sinh mã: `update()` khi `dto.codePrefix` đổi → `count(assets WHERE category_id)` > 0 ⇒ 409 `010` kind=`prefix-locked` (luật service THUẦN).

---

## 8. Kiểm kê

### 8.1 Mở đợt (019) — 1 tx: `resolveAndAssert` → category tồn tại (404) → INSERT inventory (23505 `uq_asset_inventories_open` → 409 `006`) → `snapshotItemsTx` → audit.

```sql
INSERT INTO asset_inventory_items (company_id, inventory_id, asset_id, expected_status, expected_holder_employee_id)
SELECT a.company_id, $inventoryId, a.id, a.status,
       (SELECT aa.employee_id FROM asset_assignments aa WHERE aa.company_id = a.company_id AND aa.asset_id = a.id AND aa.status = 'Active' LIMIT 1)
  FROM assets a
 WHERE a.company_id = $companyId AND a.deleted_at IS NULL
   AND a.status NOT IN ('Disposed', 'Lost')                              -- BẮT BUỘC, khớp chk_asset_inventory_items_expected
   AND ($categoryId::uuid IS NULL OR a.category_id = $categoryId);
```
Mọi cột qualify `alias.column` (memory `drizzle-sql-template-renders-columns-unqualified`).

### 8.2 Đánh dấu (021a/021b) — 1 UPDATE `WHERE company_id AND inventory_id AND id IN (...) AND EXISTS(inventory Open)` `RETURNING id`; `updated.length !== itemIds.length` ⇒ SELECT chẩn đoán: đợt không có → 404; `Closed` → 409 `007`; item lạ → 404. Audit `asset_inventory` payload `{itemIds, result, note}`. >200 chặn ở Zod.

### 8.3 Đóng đợt (022) — **MỘT** `UPDATE asset_inventories SET status='Closed', closed_*, note, total_items=(SELECT count(*) …), found_count=(SELECT count(*) … WHERE result='Found'), missing_count=…, not_checked_count=… WHERE company_id AND id AND status='Open' RETURNING` — 4 số tính TRONG câu UPDATE (review WARN: GROUP BY rồi UPDATE hai round-trip để mark xen giữa làm số cũ mà CHECK vẫn qua). 0 hàng ⇒ 404 vs 409 `007` already-closed (§3.4). **KHÔNG đổi `assets.status`** (SPEC-13 §13.4).

---

## 9. Test RED-trước

### 9.1 Int-spec (LANE_DB)

| File | Ca chính (mỗi DENY có ALLOW đối chứng) |
| --- | --- |
| `test/integration/asset-be1-scope.int-spec.ts` | Deny 403 cho từng cặp trong 11 (role dựng test, KHÔNG SA); cross-tenant → 404 mọi endpoint; masking `currentHolder`/tài chính đủ 3 scope × ALLOW (Own: holder hiện tại thấy; holder cũ KHÔNG thấy holder mới nhưng vẫn thấy asset; Department: trong đơn vị thấy, ngoài không; Company: đủ); `In Stock` CHỈ hiện ở Company; 018 rỗng ở Own/Department; 020 → 404 ở Own/Department; `/me/assets` không nhận `employeeId` |
| `test/integration/asset-be1-fsm.int-spec.ts` | Mọi ô ✗ → 409 `001`; ô hợp lệ → đúng trạng thái sau (kể cả đường chéo `Under Maintenance` revoke); `dispose(Disposed)` từ `Under Maintenance` còn Active → 409 `008`; `dispose(Lost)` từ `Assigned` → OK + đóng lượt; mở bảo trì khi đã Open → `004`; **race 2 assign song song** → 1 Active + 1 409 (không 500); race 2 mở bảo trì / 2 mở đợt tương tự |
| `test/integration/asset-be1-inventory.int-spec.ts` | Mở đợt lọc `Disposed`/`Lost`; asset tạo SAU không vào đợt; mark khi Closed → 409 `007`; bulk >200 → 400; đóng đợt tổng kết = đếm thật; đóng 2 lần → 409 |
| `test/integration/asset-be1-lifecycle-idempotency.int-spec.ts` | Assign lặp cùng `Idempotency-Key` → 1 lượt + `Idempotency-Replayed`; khác user cùng key → không phát lại chéo; cùng key khác payload → 409 |
| `test/integration/asset-be1-noti.int-spec.ts` | Assign → `ASSET_ASSIGNED` đúng 1 hàng cho user của employee; revoke → `ASSET_REVOKED`; job `handler.run({companyId})` phát đúng 1/asset/recipient trong hạn +7; **chạy job lần 2 → 0 mới** (bằng chứng `dedupeKeyOf`/dedupe thật); đổi `next_maintenance_due` → phát lại |
| `test/integration/asset-be1-code-counter.int-spec.ts` | Tạo loại ⇒ counter `scope_type='Custom'`; 2 asset ⇒ `TS-<PREFIX>-0001`/`0002`; xoá mềm rồi tạo loại cùng prefix ⇒ 409 `010 prefix-taken` + `details.categoryId`+`deleted=true`; `restore:true` ⇒ sống lại, tiếp `0003`; đổi `codePrefix` sau khi có asset ⇒ 409 `prefix-locked`; validate body sai → 400 không 500 |

### 9.2 Unit spec colocated (không DB)

- `asset-fsm.spec.ts` — 100% ma trận §3.1.
- `assets.errors.spec.ts` — `mapAssetPgError` với `cause` 1–3 tầng, match đúng-bằng constraint.
- `assets.mapper.spec.ts` — masking thuần theo scope; `toMeAssetItemDto` KHÔNG BAO GIỜ có khoá tài chính dù row "bẩn".

### 9.3 Ratchet/census cùng commit

- `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` — regen `ROUTE_CENSUS_WRITE=1`.
- `identity-projection-verdicts.ts` — +2 dòng.

---

## 10. Thứ tự thi công + lệnh verify

1. `export LANE_DB=mediaos_assetbe1` (lane đã dựng).
2. RED: 3 unit-spec + 6 int-spec §9.1 (import module chưa tồn tại ⇒ đỏ).
3. Thi công theo thứ tự: contracts `asset.ts` → `asset-fsm.ts` → `assets.dto.ts` → `assets.errors.ts` → `assets.mapper.ts` → 4 repository → `asset-access.service.ts` → categories service+controller → assets service+controller → lifecycle → maintenance → inventory service+controller → `me-assets.controller.ts` → `assets.module.ts` → `app.module.ts` (additive) → `openapi-modules.ts` (entry `ASSET`, segments `assets`,`asset-categories`,`asset-inventories`) → `harness/backlog.mjs` (`paths` += `notifications/**`) → `notifications/asset-audience.reader.ts` + `asset-noti-bridge.registrar.ts` (đăng ký `notifications.module.ts` providers) → job handler.
4. `LANE_DB=mediaos_assetbe1 pnpm --filter @mediaos/api exec vitest run test/integration/asset-be1-*.int-spec.ts src/assets` tới xanh.
5. `ROUTE_CENSUS_WRITE=1 pnpm --filter @mediaos/api exec vitest run test/foundation/route-guard-coverage.e2e-spec.ts` — kiểm `routes: 494`, `ungated`/`needVerdict` không đổi.
6. Chạy đích danh: `param-uuid-ratchet` · `body-validation-ratchet` · `identity-projection-ratchet` · `openapi-contract.e2e-spec` (0 route ASSET UNCLASSIFIED) · `route-http-coverage.e2e-spec`.
7. `bash harness/check.sh --quick` (vòng lặp) → `bash harness/check.sh --all` trước PR (REQUIRE lane).
8. FULL gate: `security-reviewer` + `database-reviewer` + `silent-failure-hunter`. Vá CRITICAL/HIGH. PR → người chốt.
9. Docs cùng PR: API-14 §5.2 bảng "Trạng thái hiện thực" 24 mã ⏳→✅; API-14 §7.4 + SPEC-13 §12 (3 đính chính §1.1); backlog `paths`.

---

## 11. Rủi ro còn lại & cách chặn

| Bẫy | Áp dụng | Cách chặn |
| --- | --- | --- |
| `nestjs-zod` class-level pipe không validate | mọi controller | `@UsePipes(ZodValidationPipe)` **cấp METHOD** trên route ghi; DTO `createZodDto` |
| Contract mirror CHECK 2 chiều | `asset.ts` | Tái dùng 9 enum đã pin; `markInventoryItemSchema.result` chặt hơn CÓ CHỦ ĐÍCH (ghi rõ) |
| drizzle `sql` cột không kèm tên bảng | `snapshotItemsTx`, EXISTS §4.2, GROUP BY | mọi cột `alias.column` |
| Route mới ⇒ census đỏ | 26 route | `API_MODULE_TAGS` entry `ASSET` TRƯỚC khi regen |
| `@Idempotent()` key do FE sinh | 010/019/022 | chỉ decorator, không suy khoá server |
| Partial unique ⇒ join nhân bản | `readScopeExists` | BẮT BUỘC `EXISTS` |
| Reused method actor-scoped | `resolveActorScope` | gọi 1 lần/request, truyền `actor` xuống repo |
| Identity-projection census | `findDetailTx`, list 012 | L1 `fromScope`+`identityColumns` + L2 verdict 2 dòng |
| **`dedupeKeyOf` optional bị quên** (bug-class MỚI vs GOAL) | registrar | int-spec chạy 2 lần khẳng định 0 noti mới |
| **`paths` WO thiếu `notifications/**`** | registrar/reader | sửa backlog cùng commit đầu |
| **Write-scope GOAL không áp dụng** | mọi service GHI | KHÔNG copy `assertWriteAllowed`/`assertWriteTarget` |
| Check-then-act thay vì UPDATE atomic | assign/revoke/dispose/recover/close* | UPDATE `WHERE status=<from>` ĐI TRƯỚC, SELECT chỉ để chọn thông điệp |
| 500 trước pipe = guard 2FA | `asset-manager` | `requires_two_factor=false` đã chốt DB-1; không đổi |
| Test đóng đinh lỗ hổng | mọi ca DENY | mỗi ca DENY kèm ALLOW |

---

## 13. Nhật ký plan-review (vòng 1 → Rev 2, 30/08/2026 — ĐÚNG MỘT vòng theo quyết định owner)

Verdict vòng 1: **BLOCK 15** + 7 WARN. Xử lý (tất cả đã vá vào plan/code, không mở vòng 2):

| # | Điểm | Xử lý |
| --- | --- | --- |
| B1 | `details` object bị filter nuốt | Hướng (a): mảng `ErrorDetail`, `kind` = phần tử `field:'kind'` — §3.5; đính chính API-14 §7.4 |
| B2 | `error.code` generic nếu ném chuỗi | `assets.errors.ts` ném object `{code,message,details}` cho MỌI mã — §3.5 |
| B3 | `Assigned→Disposed` phải 008 | guard 008 chạy TRƯỚC FSM cho `dispose(Disposed)` — §3.1/§3.2; ca test riêng |
| B4 | `revoke(Lost)` không đóng bảo trì Open | đóng cùng tx — §3.4; ca test |
| B5 | đích đóng bảo trì tính ở JS ⇒ race | `CASE WHEN EXISTS(lượt Active)` trong UPDATE + FOR UPDATE — §3.4 |
| B6 | revoke Under Maintenance bị 409 oan | UPDATE `assets` dùng CASE giữ nguyên status; ERR-003 quyết ở UPDATE lượt — §3.4 |
| B7 | trần `scoped-predicate` 21 bão hoà | nâng 21 → 24 — §4.3 |
| B8 | 005 có `currentHolder`? | CÓ (SCREEN-001) ⇒ 3 điểm chiếu, 3 verdict — §4.3 |
| B9 | `holderEmployeeId` là oracle | honour theo scope, ngoài scope ⇒ rỗng — §4.2 |
| B10 | recipients job thiếu vị từ tombstone/expires | vị từ đủ — §6.4; ca "thu hồi role ⇒ 0 noti" |
| B11 | thiếu `.max()` ⇒ 22001 = 500 | `.trim().max(<varchar>)` mọi chuỗi + `.int()` interval — contracts |
| B12 | PATCH ngày theo body-only ⇒ 23514 | kiểm trên giá trị HỢP NHẤT + map 23514 lưới hai — §3.5 |
| B13 | `includeDeleted` thiếu quyền → 403 sai spec | `resolveOrNull` ⇒ bỏ qua cờ, 200 — §2 |
| B14 | spec NOTI thiếu `acquireOutboxWorkerLock` | bắt buộc trong `asset-be1-noti.int-spec` — §9.1 |
| B15 | plan đòi sửa backlog thừa | gỡ 4 chỗ — §1 |
| W | `actorUserId` payload outbox · 4 khoá payload job · `restore` phải `findById` kể cả đã xoá · `updateAssetSchema` refine non-empty · đóng đợt 1 UPDATE · `condition_note` khi Damaged · map `uq_asset_inventory_items_inventory_asset` | tất cả áp dụng — §3.4/§3.5/§5.1/§6.4/§7/§8.3 |

Giữ nguyên (reviewer xác nhận đúng): bảng 24 mã/26 route, cặp quyền, `dedupeKeyOf` bug-class, EXISTS-không-JOIN, 404-không-403, counter `ensureCounterTx`/`nextCode` ngoài tx, `.partial().strict()` đúng thứ tự, census 468→494, `param-uuid` giữ `=== 1`, job không cần `@Optional()`/migration.

## 14. Kết quả thi công + FULL gate (30/08/2026)

| Mục | Kết quả |
| --- | --- |
| Code | `apps/api/src/assets/**` 19 file (4 controller · 26 route · `asset-fsm.ts` thuần · masking DUY NHẤT `assets.mapper.ts` · scope EXISTS `asset-access.service.ts`) + `notifications/asset-{audience.reader,noti-bridge.registrar,maintenance-due.job-handler}.ts` + contracts `asset.ts` (DTO/response, `.strict()` PATCH, trần tiền/int, ngày thật) |
| Census/ratchet | route 468→**494** (gated 429→455, ungated 27/needVerdict 39 KHÔNG đổi) · `API_MODULE_TAGS` ASSET · identity-projection: +3 verdict (`holderSelect` · `listByAssetTx` · `findUserDisplayNameTx` self-bound) + 2 `ROW_SCOPE_MINT_PINS`; trần `scoped-predicate` 21→23, `self-bound-row` 3→4 (có chủ đích) · param-uuid `=== 1` giữ · body-validation xanh · openapi-contract xanh |
| Test | int-spec `asset-be1-{scope,fsm,inventory-counter,noti-idempotency}` trên `LANE_DB=mediaos_assetbe1` (deny 403 × 12 cặp + ALLOW · cross-tenant 404 · masking 3 scope · holder-oracle · /me/assets · FSM 15 ô + race 3 loại · 008 trước FSM · revoke UM · Lost đóng bảo trì · counter/prefix/restore · kiểm kê snapshot/bulk/close · NOTI dedupe thật + actor-exclusion + job 2 lần/đổi hạn/thu hồi role + idempotency replay + audit_logs) + unit `asset-fsm` (5) · `assets.errors` (12 nhánh) · `assets.mapper` (7) |
| `check.sh` | `--quick` XANH · `--all --lane-db=assetbe1` XANH (test chunked · build · prod-tenant-check · db-readiness) |
| FULL gate | security-reviewer **PASS** (0 CRIT/HIGH; 5 MED + 4 LOW — đã vá: trần số/int, `isCompanyScope` tách khỏi `showFinancial`, mã 011 cho `uq_assets_company_code_active`, số ≠ mã ngày, `.strict()` loại, `employee_profiles.deleted_at`, `users.company_id` ở join; nợ ghi §15) · database-reviewer **PASS có điều kiện** (4 HIGH — đã vá: FOR UPDATE đợt kiểm kê cho mark+close, trần `numeric(18,2)` + lưới 22003, ngày thật, job 1 intake/asset + LIMIT 500 + cận dưới 30 ngày; MED: xoá hạn cũ khi đóng không hạn, vị từ index `maintenanceDueBefore`) · silent-failure-hunter **PASS** (2 HIGH — đã vá: registrar NÉM khi thiếu khoá neo/biến template thay vì im lặng; MED: `actor_name` không quy "Hệ thống", job kêu khi 0 recipient, count guard fail-closed, audit lượt bảo trì đóng ép, tolerance ngày UTC+1; test: `toBe(004)`, 12/12 nhánh errors, assert `audit_logs`, render `title/body`) |
| Lệch doc có chủ đích (đã đính chính API-14 §5.2/§7.4 + SPEC-13 §12/§17) | `details` mảng `ErrorDetail`; 009/011-readonly/016 = 400 Zod; 2 sentinel mới; `Assigned→Disposed` = 008; `dedupe_key` thật `ASSET_ASSIGNED:{assignmentId}`; mã idempotency thật `REQUEST-ERR-IDEMPOTENCY-*` |

## 15. Nợ ghi lại (ngoài WO, không chặn merge)

- **Nested connection** khi `resolveActorScope` chạy TRONG `withTenant` (PermissionRepository tự mở tx riêng) — khuôn ĐÃ SHIP của GOAL, ASSET mirror; WO riêng cho `resolveStrongestScope`/`resolveContext` nhận `tx` (security-reviewer MED-4).
- Nhịp job `ASSET_MAINTENANCE_DUE` = 60s (scheduler chung) — dedupe (asset, hạn) + LIMIT 500 + cận dưới 30 ngày; "1 lần/ngày" của SPEC-13 §13.3 là việc scheduler.
- Index `idx_assets_company_status_category` thứ tự cột không tối ưu cho filter `categoryId` đơn (database-reviewer MED-2) — cân nhắc migration ở QA-1/PERF.
- TZ công ty cho luật ngày (hiện tolerance +1 ngày UTC) — việc FND chung.
- `users.status` chưa lọc ở recipient job (engine lọc ở tầng gửi) — kiểm lại khi có ca `suspended`.

## 12. Definition of Done (khớp `done_when` backlog)

- [ ] 24 mã / 26 route theo API-14 §5.1; mọi handler `withTenant` + `PermissionGuard`+`@RequirePermission` + DTO `createZodDto` + pipe method-level.
- [ ] FSM ở `asset-fsm.ts`, chuyển tiếp sai → 4xx `ASSET-ERR`, không 500 (kể cả race).
- [ ] Audit mọi mutation; outbox `ASSET_ASSIGNED`/`ASSET_REVOKED` qua registrar CÓ `dedupeKeyOf`; `ASSET_MAINTENANCE_DUE` job dedupe (asset, hạn).
- [ ] `API_MODULE_TAGS` `ASSET`; route-census regen (`494`); ratchet param-uuid/body-validation/identity-projection KHÔNG tăng.
- [ ] Deny-path/cross-tenant/masking int-spec RED-trước xanh trên `LANE_DB`.
- [ ] Mở đợt lọc `Disposed`/`Lost`; `23514`/`SequenceNotFoundError` map sentinel; thu hồi/đóng bảo trì/đóng đợt = 1 UPDATE.
- [ ] `harness/backlog.mjs`: `paths` += `apps/api/src/notifications/**`; docs đính chính §1.1.
- [ ] FULL gate PASS, `check.sh --all` xanh, người chốt merge.
