# S11-ASSET-FE-1 — FE ASSET (7 màn) · plan

> WO `S11-ASSET-FE-1` · zone **green** · depends_on `S11-ASSET-BE-1` (đã merge #437, master `54887ce6`).
> Nguồn: `SPEC-13 ASSET.md` §9 (màn) · §11 (quyền) · §12 (mã lỗi) · §14 (trạng thái UI) · §15 (API) ·
> `docs/plans/S11-OFFICE-WAVE.md` §6. Contracts đã có sẵn: `packages/contracts/src/asset.ts` (507 dòng).

---

## 1. Số đo hiện trạng (đo 30/08/2026, KHÔNG suy đoán)

| Thứ | Trạng thái đo được |
| --- | --- |
| BE routes | 4 controller: `assets` (14 route) · `asset-categories` (4) · `asset-inventories` (7) · `me-assets` (1) = **26 route** |
| Contracts | `packages/contracts/src/asset.ts` ĐỦ schema request/response; `purchasePrice`/`supplier` đã `.nullable().optional()`, `currentHolder` `.optional()` — FE dùng thẳng, KHÔNG khai lại |
| `PERMISSION_CODE_TO_PAIR` | **0** mã `ASSET.*` ⇒ mọi màn ASSET ẩn dù DB đã grant (fail-closed) |
| `ModuleCode` | ĐÃ có `"ASSET"` (registry.ts:31) — không cần thêm |
| `ROUTE_REGISTRY` | **0** entry ASSET |
| `APP_REGISTRY` | **0** entry ASSET (12 app: dashboard…social) |
| `SIDEBAR_REGISTRY` | **0** entry ASSET (9 module) |
| `modules.ASSET.is_active` | **false** (0550 cố ý giữ — tiền lệ 0538 CHAT) |
| pin smoke | `EXTENSION_INACTIVE_MODULES` chứa `"ASSET"` — `migration-smoke.int-spec.ts:90-97` |
| migration head | `0555_s11roomdb1_noti_room` ⇒ WO này dùng **0556** |
| i18n | `apps/app/src/i18n/locales/vi/` 12 namespace, **chưa** có `assets` |
| routes FE | `apps/app/src/routes/` **chưa** có `assets/` |

**Cặp quyền THẬT đọc từ controller** (chống pair-drift — KHÔNG chép bảng spec):
`view:asset` · `create:asset` · `update:asset` · `delete:asset` · `assign:asset` · `revoke:asset` ·
`dispose:asset` · `manage:asset-category` · `manage:asset-maintenance` · `manage:asset-inventory` = **10 cặp
enforce**. Cặp thứ 11 `access:asset` **không** route nào enforce — nó là cổng nav (seed 0550 dòng 59, grant
Own cho cả 4 role canonical), đúng họ `access:goal` / `access:me` / `access:chat`.

---

## 2. Quyết định thi công

### 2.1 Gate lối vào = ĐỦ CẢ HAI cặp `access:asset` + `view:asset`

Thẻ App Switcher, mục sidebar và RouteMeta của `/assets` đều khai `requiredPermissions` (ĐỦ CẢ HAI), **không**
`requiredAnyPermissions: ["access:asset"]` như tiền lệ GOAL.

**Vì sao lệch tiền lệ GOAL:** `/assets` tải `GET /assets` = `view:asset`. Gate lối vào bằng mình `access:asset`
dựng lại đúng lỗ đã vá ở CHAT (registry.ts:640-650, owner báo 05/08/2026): admin thu `view:asset` per-role mà
còn `access:asset` ⇒ user thấy thẻ/menu rồi đâm vào trang lỗi. Đây là họ lỗi
`read-path-gate-pair-must-match-download-pair` (S5-TASK-COVER-1). Hôm nay 0550 cấp cả hai cùng lúc nên hai vế
trùng nhau, nhưng grant là **per-(permission, role)** sửa được ⇒ fail-closed ở đây là menu biến mất, không
phải người dùng đâm tường.

Cặp literal (`"access:asset"`), **KHÔNG** qua `PERMISSION_CODE_TO_PAIR` — cùng kỹ thuật `access:me`/`access:goal`.

### 2.2 11 mã dotted vào `PERMISSION_CODE_TO_PAIR`

Dùng cho `useCan()` **trong page** (gate nút/tab). Tên mã lấy đúng cột "Mã hiển thị" SPEC-13 §11:

| Mã dotted | Cặp engine |
| --- | --- |
| `ASSET.ACCESS` | `access:asset` |
| `ASSET.ASSET.VIEW` | `view:asset` |
| `ASSET.ASSET.CREATE` | `create:asset` |
| `ASSET.ASSET.UPDATE` | `update:asset` |
| `ASSET.ASSET.DELETE` | `delete:asset` |
| `ASSET.ASSIGNMENT.CREATE` | `assign:asset` |
| `ASSET.ASSIGNMENT.REVOKE` | `revoke:asset` |
| `ASSET.ASSET.DISPOSE` | `dispose:asset` |
| `ASSET.CATEGORY.MANAGE` | `manage:asset-category` |
| `ASSET.MAINTENANCE.MANAGE` | `manage:asset-maintenance` |
| `ASSET.INVENTORY.MANAGE` | `manage:asset-inventory` |

### 2.3 Nút hành động ẩn theo **FSM ∩ quyền**, không chỉ quyền

SPEC-13 §14: "hành động bị FSM chặn ⇒ nút **không hiện** thay vì hiện rồi 409". Suy nút từ `status` +
`counts`/`openMaintenance` của `assetDetailResponseSchema`:

| Nút | Điều kiện FSM | Cặp |
| --- | --- | --- |
| Cấp phát | `status === "In Stock"` | `assign:asset` |
| Thu hồi | `status === "Assigned"` | `revoke:asset` |
| Mở bảo trì | `status ∈ {In Stock, Assigned}` **và** `openMaintenance === null` | `manage:asset-maintenance` |
| Đóng bảo trì | `openMaintenance !== null` | `manage:asset-maintenance` |
| Thanh lý | `status ∈ {In Stock, Under Maintenance}` **và** KHÔNG có lượt Active | `dispose:asset` |
| Ghi nhận mất | `status ∈ {In Stock, Assigned, Under Maintenance}` | `dispose:asset` |
| Tìm thấy lại | `status === "Lost"` | `dispose:asset` |
| Xoá mềm | `status === "In Stock"` **và** `counts.assignments === 0 && counts.maintenances === 0` | `delete:asset` |

> «Thanh lý» ẩn khi còn lượt Active kể cả lúc `status === "Under Maintenance"` — ASSET-ERR-008 kiểm theo **sự
> tồn tại hàng Active**, không theo `status`. Suy từ `currentHolder !== undefined`.

### 2.4 Idempotency-Key cho cấp phát

Client sinh **một lần khi mở form** (SPEC-13 §12 — server KHÔNG suy từ payload, xem
`idempotency-key-must-be-content-derived` cho vế ngược lại: ở ASSET ngày cấp không nằm trong body nên khoá
suy-từ-payload buộc phải lấy đồng hồ server ⇒ vi phạm `period-key-idempotency-needs-frozen-source`). Sinh mới
khi: mở form · sau gửi **thành công** · sau lỗi `KEY_REUSED`. TTL server 15′.

### 2.5 Trường tài chính

`purchasePrice`/`supplier` chỉ có khoá khi scope hiệu dụng = Company. Contracts đã `.optional()` ⇒ FE render
có điều kiện (`=== undefined` ⇒ **không** render hàng, không render "—"). `/me/assets` **không bao giờ** có.

---

## 3. Bản đồ file

### 3.1 Sửa (hot-file — append, KHÔNG rewrite)

| File | Thay đổi |
| --- | --- |
| `packages/web-core/src/lib/registry.ts` | +11 mã `PERMISSION_CODE_TO_PAIR` · +1 `APP_REGISTRY` (`appKey:"assets"`, order sau social) · +2 `ROUTE_REGISTRY` (`asset.list`, `asset.inventories`) |
| `packages/web-core/src/lib/query-keys.ts` | +`assets` root key + factory list/detail/assignments/maintenances/summary/categories/inventories + `me.assets` |
| `apps/app/src/layouts/workspace/sidebar-registry.ts` | +`ASSET_SIDEBAR` (2 mục) · +`SIDEBAR_REGISTRY.ASSET` · +1 mục `/me/assets` vào `ME_SIDEBAR` |
| `apps/app/src/router.tsx` | +7 lazy import · +6 route (list, new, `$assetId`, `$assetId/edit`, inventories, `inventories/$inventoryId`) · +1 `/me/assets` |
| `apps/app/src/layouts/workspace/DynamicIcon.tsx` | +icon `package` (tránh fallback Circle) |
| `apps/app/src/i18n/index.ts` | +namespace `assets` |
| `apps/app/src/i18n/locales/vi/*` | +`routeTitle.*` keys · +`app.assets`/`appDesc.assets` |
| `apps/api/test/integration/migration-smoke.int-spec.ts` | **gỡ** `"ASSET"` khỏi `EXTENSION_INACTIVE_MODULES` (CÙNG commit với migration) |

### 3.2 Tạo mới

```
apps/api/migrations/0556_s11assetfe1_enable_asset_module.sql   -- UPDATE modules SET is_active=true WHERE code='ASSET'
apps/app/src/i18n/locales/vi/assets.ts
apps/app/src/routes/assets/
  constants.ts              -- nhãn trạng thái (SPEC-01 §17), màu badge, option lọc
  asset-form-schema.ts      -- rehydrate từ contracts + rule ngày ASSET-ERR-014
  asset-actions.ts(+spec)   -- suy nút từ FSM ∩ quyền (§2.3) — thuần hàm, test được
  asset-errors.ts(+spec)    -- đọc error.details[] → kind (mảng ErrorDetail, KHÔNG object)
  AssetListPage.tsx(+spec)          -- ASSET-SCREEN-001
  AssetDetailPage.tsx(+spec)        -- ASSET-SCREEN-002 (3 tab + QR)
  AssetFormPage.tsx(+spec)          -- ASSET-SCREEN-003
  AssetInventoryListPage.tsx(+spec) -- ASSET-SCREEN-005a
  AssetInventoryDetailPage.tsx(+spec)-- ASSET-SCREEN-005b
  components/
    AssetStatusBadge.tsx
    AssetAssignDialog.tsx    -- ASSET-SCREEN-004 (cấp phát, Idempotency-Key)
    AssetRevokeDialog.tsx    -- ASSET-SCREEN-004 (thu hồi)
    AssetDisposeDialog.tsx   -- thanh lý / mất / tìm thấy lại
    AssetMaintenanceDialog.tsx
    AssetCategoryDialog.tsx  -- ASSET-SCREEN-007 (CRUD loại + Khôi phục)
    AssetQrCode.tsx          -- render từ asset_code, KHÔNG endpoint (ASSET-DEC-001)
    AssetHandoverPrint.tsx   -- biên bản in FE-side (ASSET-DEC-002)
apps/app/src/routes/me/MeAssetsPage.tsx(+spec)  -- ASSET-SCREEN-006
```

---

## 4. Thứ tự thi công

1. **Nền quyền + wiring** (registry, query-keys, sidebar, router, i18n, icon) — chưa có page thì route trỏ stub.
2. **Thuần hàm trước** (`asset-actions.ts`, `asset-errors.ts`, `constants.ts`) + spec RED → GREEN.
3. **ASSET-SCREEN-001/003** (list + form) — đường CRUD cơ bản.
4. **ASSET-SCREEN-002** (chi tiết + 3 tab + QR) + dialog 004/dispose/maintenance.
5. **ASSET-SCREEN-007** (loại) — gồm `?includeDeleted=true` + Khôi phục.
6. **ASSET-SCREEN-005** (kiểm kê) — list + detail + bulk-mark.
7. **ASSET-SCREEN-006** (`/me/assets`).
8. **Migration 0556 + gỡ pin smoke** — CÙNG commit (DB-10 §10.2).
9. Verify: `pnpm --filter @mediaos/web... typecheck|test|build` + `bash harness/check.sh`.

---

## 5. Rủi ro đã biết

| Rủi ro | Chặn bằng |
| --- | --- |
| `error.details` là **mảng** `ErrorDetail{field,message,rule}`, không object — đọc `details.kind` trả `undefined` ⇒ nuốt lỗi | `asset-errors.ts` parse mảng, tìm `field === "kind"`; có spec neo (`error-details-must-be-errordetail-array`) |
| Thiếu `.optional()` cho trường masked ⇒ ZodError trắng trang đúng người vừa được bảo vệ | contracts đã đúng — FE **không** khai lại schema, import thẳng |
| Static route `/assets/new`, `/assets/inventories` bị TanStack coi là `$assetId` | Khai static **TRÊN** `$assetId` (bẫy đã ghi ở `/goals/new`, `/goals/templates`) |
| Quên gỡ pin `EXTENSION_INACTIVE_MODULES` ⇒ smoke đỏ | Cùng commit với 0556; checklist §4 bước 8 |
| Migration 0556 không vào `_journal.json` ⇒ **bị bỏ qua im lặng** | `migration-not-in-journal-is-silently-skipped` — kiểm journal sau khi tạo |
| Gate màn ≠ gate đường tải | §2.1 — cả hai cặp ở mọi lối vào |
| Go-live: role `asset-manager` chưa gán cho admin PROD ⇒ ASSET vô hình | Ghi vào §12 kết quả; **không** vá bằng blanket grant (`blanket-grant-migration-role-drift`) |

---

## 6. Definition of Done

- [ ] 7 màn ASSET-SCREEN-001..007; pagination/filter; Zod validate; loading/error/empty/403 đủ (§14)
- [ ] 11 mã dotted trong `PERMISSION_CODE_TO_PAIR`; gate qua `PermissionGate`/`useCan`, **không** hard-code role
- [ ] Nút hành động ẩn theo FSM ∩ quyền (§2.3) — không hiện nút rồi ăn 409
- [ ] QR render từ `asset_code`; nhãn trạng thái từ constants chuẩn
- [ ] Migration 0556 bật `modules.ASSET.is_active=true` + gỡ pin smoke CÙNG commit
- [ ] `pnpm typecheck` · `pnpm test` · `pnpm build` xanh; `harness/check.sh` xanh
