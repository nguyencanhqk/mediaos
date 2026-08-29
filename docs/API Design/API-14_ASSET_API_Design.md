# API-14: ASSET API DESIGN (Quản lý tài sản — Danh mục · Hồ sơ · Cấp phát · Bảo trì · Kiểm kê)

**MODULE ASSET - QUẢN LÝ TÀI SẢN - API DESIGN**

> **📚 Bộ tài liệu API — Hệ thống Quản lý Doanh nghiệp**
> [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [API-02 AUTH](<API-02 AUTH API Design.md>) · [API-03 HR](<API-03_HR_API_Design.md>) · [API-04 ATT](<API-04_ATT_API_Design.md>) · [API-05 LEAVE](<API-05_LEAVE_API_Design.md>) · [API-06 TASK](<API-06_TASK_API_Design.md>) · [API-07 NOTI](<API-07_NOTI_API_Design.md>) · [API-08 DASH](<API-08_DASH_API_Design.md>) · [API-09 FOUNDATION](<API-09_FOUNDATION_API_Design.md>) · [API-10 Permission Matrix](<API-10 PERMISSION MATRIX.md>) · [API-11 ME](<API-11_ME_API_Design.md>) · [API-12 GOAL](<API-12_GOAL_API_Design.md>) · [API-13 CHAT](<API-13_CHAT_API_Design.md>) · **API-14 ASSET**
>
> **Nguồn & liên quan:** [Chuẩn API: API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [Đặc tả: SPEC-13 ASSET](<../SPEC/SPEC-13 ASSET.md>) · [Thiết kế DB: DB-15](<../DB/DB-15 ASSET Database Design.md>) · [DB-09 §8.16 Index](<../DB/DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 Seed ASSET](<../DB/DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>) · [Ma trận phân quyền §9d](<../permission-matrix-spec.md>) · [Chỉ mục tài liệu](<../README.md>)
>
> **Đánh số:** API-14 ASSET · API-15 ROOM (OFFICE-DEC-001, owner ký 28/08/2026) — nối tiếp API-13 CHAT.

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | API-14 |
| Tên tài liệu | ASSET API Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | ASSET - Quản lý tài sản |
| Phiên bản | v0.1 |
| Trạng thái | **Stub — Approved** (owner duyệt gói wave S11-OFFICE 28/08/2026, cùng SPEC-13 §1). Khung endpoint đã chốt; DTO chi tiết bổ sung ở WO backend `S11-ASSET-BE-1` |
| Giai đoạn | Phase 3 · wave S11-OFFICE — hậu go-live |
| Tài liệu nguồn | SPEC-13 ASSET, API-01 Tổng quan, DB-15, DB-09/10, permission-matrix-spec §9d |
| Ngày tạo | 28/08/2026 |
| Ngày cập nhật | 28/08/2026 |

> **Trạng thái Stub:** Tài liệu khoá **tên file + danh sách endpoint + cặp quyền + nguyên tắc bắt buộc** để README/SPEC-13 §15 trỏ nhất quán. DTO/schema request-response đầy đủ, ví dụ payload và OpenAPI bổ sung ở WO backend (`S11-ASSET-BE-1`) — đồng bộ `packages/contracts/src/asset.ts`.

---

## 2. Mục đích tài liệu

Mô tả thiết kế API cho module **ASSET** — hồ sơ tài sản có FSM, cấp phát/thu hồi cho nhân viên, bảo trì, kiểm kê theo đợt, thanh lý (SPEC-13 §2). API-14 dùng làm cơ sở cho:

1. Backend triển khai controller/service/DTO dưới prefix `/api/v1/assets`, `/api/v1/asset-categories`, `/api/v1/asset-inventories`, `/api/v1/me/assets`.
2. Frontend triển khai 7 màn `ASSET-SCREEN-001..007` (`apps/app/src/routes/assets/` + mục «Tài sản của tôi» trong `/me`).
3. QA viết test deny-path/IDOR/cross-tenant + FSM + race cấp phát song song cho khu vực ASSET.

---

## 3. Căn cứ thiết kế

1. **API-01** — prefix `/api/v1`, envelope response/error thống nhất, pagination chuẩn, header `X-Request-Id` / `Idempotency-Key`, bắt buộc kiểm authentication + permission + data scope + business validation + audit.
2. **SPEC-13 ASSET** — nguồn sự thật nghiệp vụ: nguyên tắc (§3), permission 11 cặp (§11), 16 mã lỗi (§12), FSM + lõi nghiệp vụ (§13), API (§15), sự kiện (§17), audit/bảo mật (§18), OFFICE-DEC-001 + ASSET-DEC-001..004 (§22).
3. **DB-15** — 6 bảng mới (RLS+FORCE, composite tenant FK), 4 bảng sổ không DELETE, partial unique cho lượt cấp phát/bảo trì/đợt kiểm kê đang sống, counter mã tài sản.
4. **DB-09 §8.16** — index ASSET; **DB-10** — seed module `ASSET` + role `asset-manager` + 11 cặp + audit UNION-ADD + 3 event NOTI.
5. **permission-matrix-spec §9d** — ánh xạ 11 cặp quyền sang tuple `(action, resource_type)` mà permission engine thực thi + ma trận data_scope.
6. **API-03 HR** — người giữ tài sản là `employees`; ASSET chỉ JOIN, không sở hữu.
7. **API-09 FOUNDATION** — `SequenceService` (mã tài sản), `audit_logs`, OutboxNotificationBridge phát `ASSET_ASSIGNED` / `ASSET_REVOKED` / `ASSET_MAINTENANCE_DUE`.
8. **API-11 ME** — `/me/assets` theo chuẩn own-scope, employee resolve từ token (ME-DEC / SPEC-09 §14.4).

---

## 4. Phạm vi API-14

### 4.1 Bao gồm trong v1

| Nhóm API | Mô tả |
| --- | --- |
| Asset Categories | CRUD loại tài sản (mã · tên · prefix mã · chu kỳ bảo trì mặc định) |
| Assets | Danh sách/lọc · tạo (sinh mã) · chi tiết (kèm người giữ) · sửa mô tả · xoá mềm có điều kiện · thống kê |
| Assignments | Cấp phát (1 bước) · thu hồi (tình trạng khi thu) · lịch sử |
| Maintenances | Mở/đóng lượt bảo trì · lịch sử |
| Lifecycle | Thanh lý / ghi nhận mất / tìm thấy lại |
| Inventories | Mở đợt (snapshot) · đánh dấu 1/nhiều dòng · đóng đợt (tổng kết) |
| ME Assets | `GET /me/assets` — own-scope |

### 4.2 Không bao gồm (ngoài phạm vi v1 — SPEC-13 §5.2)

- Endpoint sinh ảnh **QR** (ASSET-DEC-001 — FE render) và **biên bản PDF** (ASSET-DEC-002 — FE in).
- Cấp phát 2 bước (`acknowledge`) · đề xuất cấp phát tự phục vụ · khấu hao · import/export Excel · quét mã bằng camera.
- Tự động thu hồi khi nhân viên nghỉ việc (Phase sau — hiện chỉ có bộ lọc `holderEmployeeId` cho màn offboarding).

---

## 5. Endpoint tổng hợp ASSET (SPEC-13 §15)

Prefix: `/api/v1`

```http
GET    /api/v1/asset-categories
POST   /api/v1/asset-categories
PATCH  /api/v1/asset-categories/{category_id}
DELETE /api/v1/asset-categories/{category_id}

GET    /api/v1/assets
POST   /api/v1/assets
GET    /api/v1/assets/summary
GET    /api/v1/assets/{asset_id}
PATCH  /api/v1/assets/{asset_id}
DELETE /api/v1/assets/{asset_id}
POST   /api/v1/assets/{asset_id}/assign
POST   /api/v1/assets/{asset_id}/revoke
GET    /api/v1/assets/{asset_id}/assignments
POST   /api/v1/assets/{asset_id}/maintenances
POST   /api/v1/assets/{asset_id}/maintenances/{maintenance_id}/close
GET    /api/v1/assets/{asset_id}/maintenances
POST   /api/v1/assets/{asset_id}/dispose
POST   /api/v1/assets/{asset_id}/recover

GET    /api/v1/asset-inventories
POST   /api/v1/asset-inventories
GET    /api/v1/asset-inventories/{inventory_id}
GET    /api/v1/asset-inventories/{inventory_id}/items
PATCH  /api/v1/asset-inventories/{inventory_id}/items/{item_id}
POST   /api/v1/asset-inventories/{inventory_id}/items/bulk-mark
POST   /api/v1/asset-inventories/{inventory_id}/close

GET    /api/v1/me/assets
```

> **24 mã ASSET-API = 26 route HTTP** (020 và 021 mỗi mã gói 2 route). Route-census đếm **route** — WO BE regen census với 26, không phải 24.

### 5.1 Bảng endpoint (stub — chi tiết DTO ở WO backend)

| Mã | Method | Path | Chức năng | Cặp quyền (SPEC-13 §11) | Audit | NOTI |
| --- | --- | --- | --- | --- | --- | --- |
| ASSET-API-001 | GET | `/asset-categories` | Danh mục loại; `?includeInactive=true` (`is_active=false`); **`?includeDeleted=true`** trả thêm loại **đã xoá mềm** (kèm `deletedAt`, `deleted=true`) — tham số chỉ được honour khi caller có `('manage','asset-category')`, ngược lại **bỏ qua** (không 403) — nguồn id cho `restore` ở 003 | `('view','asset')` (+ `('manage','asset-category')` cho `includeDeleted`) | — | — |
| ASSET-API-002 | POST | `/asset-categories` | Tạo loại `{ code, name, codePrefix, description?, defaultMaintenanceIntervalDays?, sortOrder? }` + tạo counter **cùng tx** | `('manage','asset-category')` | ✅ | — |
| ASSET-API-003 | PATCH | `/asset-categories/{id}` | Sửa; `codePrefix` khoá khi đã sinh mã (ASSET-ERR-010). Nhận thêm `{ isActive?, restore?: true }` — `restore` **khôi phục loại đã xoá mềm** (`deleted_at = NULL`, giữ counter): đường **duy nhất** để dùng lại prefix (DB-15 §6.7); `{id}` của loại đã xoá mềm chỉ được chấp nhận ở route này | `('manage','asset-category')` | ✅ | — |
| ASSET-API-004 | DELETE | `/asset-categories/{id}` | Xoá mềm; chặn khi còn tài sản chưa Disposed/Lost (ASSET-ERR-010) | `('manage','asset-category')` | ✅ | — |
| ASSET-API-005 | GET | `/assets` | Danh sách — filter `categoryId` · `status[]` · `holderEmployeeId` · `q` · `maintenanceDueBefore`; sort `assetCode`/`createdAt`; pagination; data scope SPEC-13 §13.6 | `('view','asset')` | — | — |
| ASSET-API-006 | POST | `/assets` | Tạo hồ sơ `{ categoryId, name, serialNumber?, brand?, model?, purchaseDate?, purchasePrice?, supplier?, warrantyEndDate?, location?, description? }` → `assetCode` sinh ở server | `('create','asset')` | ✅ | — |
| ASSET-API-007 | GET | `/assets/{id}` | Chi tiết + `currentHolder` (JOIN HR) + `openMaintenance?` + đếm lượt cấp phát/bảo trì; ngoài scope → 404. **`currentHolder` lọc theo scope** (Own: chỉ khi là caller; Department: chỉ nhân viên trong đơn vị; ngược lại vắng khoá) — §6.4 | `('view','asset')` | — | — |
| ASSET-API-008 | PATCH | `/assets/{id}` | Sửa mô tả; body **không** có `assetCode`/`status` (ASSET-ERR-011) | `('update','asset')` | ✅ | — |
| ASSET-API-009 | DELETE | `/assets/{id}` | Xoá mềm khi `In Stock` + 0 lịch sử (ASSET-ERR-015) | `('delete','asset')` | ✅ | — |
| ASSET-API-010 | POST | `/assets/{id}/assign` | Cấp phát `{ employeeId, issueCondition?, issueNote?, expectedReturnDate? }`; `In Stock → Assigned`; header `Idempotency-Key` **do client sinh** khi mở form (§6.10) | `('assign','asset')` | ✅ | `ASSET_ASSIGNED` |
| ASSET-API-011 | POST | `/assets/{id}/revoke` | Thu hồi `{ returnCondition: 'Good'\|'Damaged'\|'Lost', returnNote? }`; `Assigned → In Stock` (hoặc `Lost`). **Được phép khi đang `Under Maintenance`**: lượt → `Returned`, `status` giữ nguyên (`Good`/`Damaged`) hoặc → `Lost` + đóng bảo trì (SPEC-13 §13.1) | `('revoke','asset')` | ✅ | `ASSET_REVOKED` |
| ASSET-API-012 | GET | `/assets/{id}/assignments` | Lịch sử cấp phát, pagination, mới nhất trước. **Lọc theo scope**: Own chỉ hàng của caller; Department chỉ hàng nhân viên trong đơn vị; Company đầy đủ (§6.4) | `('view','asset')` | — | — |
| ASSET-API-013 | POST | `/assets/{id}/maintenances` | Mở lượt `{ reason, vendor? }`; → `Under Maintenance` | `('manage','asset-maintenance')` | ✅ | — |
| ASSET-API-014 | POST | `/assets/{id}/maintenances/{maintenanceId}/close` | Đóng `{ resultNote?, cost?, nextDueDate? }`; trạng thái sau = dẫn xuất (SPEC-13 §13.1) | `('manage','asset-maintenance')` | ✅ | — |
| ASSET-API-015 | GET | `/assets/{id}/maintenances` | Lịch sử bảo trì | `('view','asset')` | — | — |
| ASSET-API-016 | POST | `/assets/{id}/dispose` | `{ kind: 'Disposed'\|'Lost', reason }`; tự đóng lượt bảo trì Open / lượt cấp phát Active theo §13.1; `Disposed` khi **tồn tại lượt Active** (kể cả đang `Under Maintenance`) → ASSET-ERR-008 — guard `assertNoActiveAssignment` ngoài `assertTransition` | `('dispose','asset')` | ✅ | `ASSET_REVOKED` nếu có lượt Active bị đóng |
| ASSET-API-017 | POST | `/assets/{id}/recover` | `Lost → In Stock` `{ reason }` | `('dispose','asset')` | ✅ | — |
| ASSET-API-018 | GET | `/asset-inventories` | Danh sách đợt (Company scope; scope khác trả rỗng) | `('view','asset')` | — | — |
| ASSET-API-019 | POST | `/asset-inventories` | Mở đợt `{ name, categoryId?, note? }` + snapshot dòng (1 tx) | `('manage','asset-inventory')` | ✅ | — |
| ASSET-API-020 | GET | `/asset-inventories/{id}` · `/asset-inventories/{id}/items` | Chi tiết đợt + dòng (filter `result`, pagination). Scope Own/Department → **404 ASSET-ERR-012** (chi tiết không có khái niệm "rỗng"; danh sách 018 mới trả rỗng) | `('view','asset')` | — | — |
| ASSET-API-021 | PATCH · POST | `/asset-inventories/{id}/items/{itemId}` · `/asset-inventories/{id}/items/bulk-mark` | Đánh dấu `{ result: 'Found'\|'Missing', note? }` (bulk: `{ itemIds[], result, note? }`, tối đa 200/lần); đợt Closed → ASSET-ERR-007 | `('manage','asset-inventory')` | ✅ `object_type='asset_inventory'`, `object_id=inventory_id`, payload `itemIds`+`result` (không có object_type riêng cho dòng) | — |
| ASSET-API-022 | POST | `/asset-inventories/{id}/close` | Đóng đợt + ghi 4 số tổng kết; **không** đổi trạng thái tài sản | `('manage','asset-inventory')` | ✅ | — |
| ASSET-API-023 | GET | `/me/assets` | Tài sản của tôi — employee từ token; `?includeReturned=true`; **không bao giờ** trả trường tài chính, **bất kể** data_scope của caller (company-admin gọi cũng không thấy giá — luật §6.6 chỉ áp cho `/assets*`) | `('view','asset')` scope Own | — | — |
| ASSET-API-024 | GET | `/assets/summary` | Đếm theo `status` × `categoryId` trong scope người gọi — nguồn widget DASH. **Khai route TRƯỚC `/assets/{id}`** (kẻo `summary` bị bắt làm id — bài học `goals/tree`) | `('view','asset')` | — | — |

> **Notation permission:** chuỗi `('action','resource')` là **cặp engine thực thi** (permission-matrix-spec §9d + DB-10 seed) — không phải chuỗi dotted `ASSET.RESOURCE.ACTION` hiển thị FE.
>
> ⚠️ **Mọi `{id}` là UUID ở biên** — pipe `ParseUUIDPipe`/Zod **cấp method**, không `@UsePipes` cấp class (`nestjs-zod-class-level-pipe-does-nothing`); sai định dạng trả **400**, không để rơi xuống DB thành 500 `22P02`. Ratchet param-uuid **không được tăng**.

### 5.2 Trạng thái hiện thực (đối chiếu code)

| Mã | Trạng thái | Ghi chú |
| --- | --- | --- |
| ASSET-API-001..024 | ⏳ Chưa | Thi công ở `S11-ASSET-BE-1` sau `S11-ASSET-DB-1`. Cập nhật bảng này khi WO đóng |

> Lệch giữa bảng này và code ⇒ **sửa code**, không sửa ngầm tài liệu (CLAUDE.md — docs/spec + docs/DB là chuẩn). Cột này là ảnh chụp tiến độ.

---

## 6. Nguyên tắc API BẮT BUỘC (SPEC-13 §3, §13, §18)

1. **FSM ép ở service qua đúng một hàm** `assertTransition(from, to, action)` theo ma trận SPEC-13 §13.1; chuyển tiếp sai → **409 ASSET-ERR-001**. Không controller nào tự kiểm trạng thái.
2. **Chốt cuối ở DB, map về 4xx**: vi phạm `uq_asset_assignments_active` / `uq_asset_maintenances_open` / `uq_asset_inventories_open` (race) → **409** đúng mã ASSET-ERR-001/004/006 — bóc mã PG `23505` từ `error.cause` (drizzle bọc lỗi), **không** để lọt thành 500.
3. **"Ai đang giữ" là dẫn xuất** — DTO `currentHolder` JOIN từ lượt Active + HR; không có trường ghi `holderEmployeeId` ở bất kỳ body nào.
4. **Data scope ép ở service**, không phải RLS: Own = lượt của employee tôi; Department = lượt Active của nhân viên đơn vị tôi (∪ đơn vị tôi làm trưởng); Company = tất cả. Ngoài scope → **404** (ASSET-ERR-012/013), **không** 403. Ép bằng **`EXISTS` cho cả ba scope**, **không JOIN** `asset_assignments` vào danh sách (Own gồm cả lượt Returned ⇒ JOIN nhân bản hàng — DB-15 §8). **Scope cũng lọc BÊN TRONG payload**: người giữ cũ vẫn ở scope Own của tài sản đó mãi mãi, nên `currentHolder` chỉ trả khi người giữ hiện tại là caller (Own) / trong đơn vị (Department), `assignments[]` chỉ trả hàng của caller (Own) / của nhân viên trong đơn vị (Department). Vắng khoá, không `null`.
5. **`/me/assets` resolve employee từ token** — không có tham số nào cho phép truyền `employeeId` (chống IDOR, mirror ME/GOAL-API-013).
6. **Che ở server**: `purchasePrice` · `supplier` · `maintenances[].cost` **chỉ có mặt khi scope hiệu dụng là Company**; vắng ở cả Own lẫn Department (chốt tường minh SPEC-13 §18). FE schema Zod khai `.optional()` — thiếu là `ZodError` trắng trang.
7. **Mọi mutation trạng thái ghi audit** trong cùng transaction (cấp phát · thu hồi · mở/đóng bảo trì · mở/đánh dấu/đóng kiểm kê · dispose/recover · CRUD loại · xoá mềm); payload audit **không** chứa số tiền.
8. **`company_id` ở mọi query** — mọi truy vấn qua `withTenant(companyId, fn)`.
9. **NOTI qua OutboxNotificationBridge** — enqueue trong transaction, `dedupeKey` suy từ nội dung (SPEC-13 §17); payload chỉ mã/tên tài sản + tên người + link.
10. **`Idempotency-Key` của cấp phát do CLIENT sinh** (một lần khi mở form cấp phát — chuẩn API-01 §21, như `clientMessageId` của CHAT). Cơ chế = **`@Idempotent()` dùng chung** (`apps/api/src/common/idempotency/`, BACKEND-12 §14.1) — **không fork**: khoá scope `company_id + user_id + method + path + key`, **TTL 15 phút** (`IDEMPOTENCY_TTL_SEC`), header **không bắt buộc ở interceptor** (back-compat), replay **phát lại envelope nguyên trạng** + header `Idempotency-Replayed: true` (không có `meta.idempotent_replay`). FE ASSET **luôn** gửi header. Server **không** tự suy khoá từ payload: ngày cấp không có trong body ⇒ mọi khoá "suy từ payload" đều phải lấy đồng hồ server (khoá theo kỳ không có nguồn đóng băng) và còn chặn nhầm ca "thu hồi rồi cấp lại cùng người trong ngày". Chống hai lượt Active là việc của partial unique, không phải của idempotency.
11. **Khai `API_MODULE_TAGS` cho `ASSET`** (`apps/api/src/config/openapi-modules.ts`) và regen route-census có chủ đích (`ROUTE_CENSUS_WRITE=1`) — route mới không khai ⇒ census ĐỎ.

---

## 7. Chuẩn response, lỗi, pagination, idempotency (theo API-01)

### 7.1 Envelope thành công (object) — ví dụ chi tiết tài sản

```json
{
  "success": true,
  "message": "Lấy dữ liệu thành công",
  "data": {
    "id": "…",
    "assetCode": "TS-LT-0042",
    "name": "MacBook Pro 14",
    "category": { "id": "…", "code": "LAPTOP", "name": "Laptop" },
    "status": "Assigned",
    "currentHolder": { "employeeId": "…", "employeeCode": "NV-0012", "fullName": "Nguyễn Văn A", "assignedAt": "2026-09-01T02:00:00Z" },
    "openMaintenance": null,
    "nextMaintenanceDue": "2027-03-01",
    "purchasePrice": 45000000,
    "counts": { "assignments": 3, "maintenances": 1 }
  },
  "meta": { "request_id": "req_…", "timestamp": "2026-09-01T09:00:00+07:00" }
}
```

> Cùng tài sản đọc bằng scope **Own** hoặc **Department**: `purchasePrice`/`supplier` **không có khoá** trong `data` (không phải `null`). Ở Own, nếu caller không phải người giữ hiện tại thì `currentHolder` cũng **vắng khoá** và `counts.assignments` chỉ đếm lượt của caller.

### 7.2 Envelope list + pagination (`GET /assets`, `/assets/{id}/assignments`, `/asset-inventories/{id}/items`, `/me/assets`)

```json
{
  "success": true,
  "message": "Lấy danh sách thành công",
  "data": [ { "…": "…" } ],
  "pagination": { "page": 1, "per_page": 20, "total": 143, "total_pages": 8, "has_next": true, "has_prev": false },
  "meta": { "request_id": "req_…", "timestamp": "…" }
}
```

### 7.3 Thống kê (`GET /assets/summary`)

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "byStatus": { "In Stock": 12, "Assigned": 87, "Under Maintenance": 3, "Disposed": 9, "Lost": 1 },
    "byCategory": [ { "categoryId": "…", "code": "LAPTOP", "name": "Laptop", "total": 60, "assigned": 55 } ],
    "maintenanceDueSoon": 4
  },
  "meta": { "request_id": "req_…", "timestamp": "…" }
}
```

### 7.4 Envelope lỗi + mã lỗi

Mã lỗi theo API-01 §13 `MODULE-ERR-CODE`. Namespace ASSET gồm **hai nhóm**:

- **Đánh số** `ASSET-ERR-001`..`ASSET-ERR-016` — vi phạm quy tắc nghiệp vụ, định nghĩa đầy đủ ở SPEC-13 §12.
- **Đặt tên** — sentinel chung của module (quy ước sẵn có `GOAL-ERR-NOT-FOUND`, `HR-ERR-CONTRACT-DATE`…), không chiếm số trong dãy §12:

| Mã sentinel | HTTP | Ý nghĩa |
| --- | ---: | --- |
| `ASSET-ERR-NOT-FOUND` | 404 | Tài sản / loại / lượt / đợt / nhân viên tham chiếu **không tồn tại trong company** hoặc **ngoài data scope** — một phản hồi duy nhất (ASSET-ERR-002 vế 404, 012, 013) |
| `ASSET-ERR-FORBIDDEN` | 403 | Có cặp `access` nhưng thiếu cặp hành động (do `PermissionGuard`, thường trả `AUTH-ERR-FORBIDDEN`) |

Ánh xạ HTTP của dãy đánh số:

| HTTP | Dùng cho |
| --- | --- |
| `400` | Body/param sai định dạng (`VALIDATION-ERR-001`), `{id}` không phải UUID |
| `404` | ASSET-ERR-002 (nhân viên không thuộc company) · 005 (`maintenance-not-found`) · 012 · 013 |
| `409` | ASSET-ERR-001 · 003 · 004 · 005 · 006 · 007 · 008 · 010 · 011 (serial trùng) · 015 · **mã của interceptor idempotency dùng chung**: `IN_PROGRESS` (bấm-đúp khi request đầu chưa xong) · `KEY_REUSED` (cùng key, khác payload) · `INVALID_KEY` (key sai định dạng) — `idempotency.interceptor.ts` |
| `422` | ASSET-ERR-002 (nhân viên không `active`) · 009 · 011 (gửi `assetCode`/`status`) · 014 · 016 |

Dùng lại nhóm lỗi chung API-01: `AUTH-ERR-UNAUTHENTICATED` 401 · `AUTH-ERR-FORBIDDEN` 403 · `AUTH-ERR-SCOPE-DENIED` 403 (chỉ khi cố tình ghi ngoài scope — v1 mọi cặp ghi đều Company nên hiếm gặp) · `VALIDATION-ERR-001` 400 · `SYSTEM-ERR-RATE-LIMIT` 429.

```json
{
  "success": false,
  "message": "Tài sản đang ở trạng thái Assigned, không thể cấp phát",
  "error": { "code": "ASSET-ERR-001", "type": "BusinessRuleError", "details": { "from": "Assigned", "action": "assign" } },
  "meta": { "request_id": "req_…", "timestamp": "…" }
}
```

### 7.5 Idempotency

`POST /assets/{id}/assign` gắn `@Idempotent()` (interceptor dùng chung — BACKEND-12 §14.1); header `Idempotency-Key` **do client sinh** (§6.10), FE **luôn** gửi, nhưng interceptor **không bắt buộc** (thiếu header ⇒ chạy như thường, không 400 — back-compat có chủ ý của hạ tầng chung). `POST /asset-inventories` và `POST /asset-inventories/{id}/close` **nên** gắn. Khoá scope `company_id + user_id + method + path + idempotency_key`, **TTL 15 phút** (`IDEMPOTENCY_TTL_SEC = 900`); replay **phát lại envelope nguyên trạng** + header `Idempotency-Replayed: true` — **không** có `meta.idempotent_replay` (envelope không sửa được ở tầng replay).

---

## 8. Dữ liệu ASSET (SPEC-13 §16, DB-15)

- ASSET **không tạo lại**: `employees` (`employee_profiles`), `users`, `sequence_counters`, `audit_logs`, `notification_*`.
- Bảng canonical do ASSET sở hữu: `asset_categories` · `assets` · `asset_assignments` · `asset_maintenances` · `asset_inventories` · `asset_inventory_items`. RLS+FORCE mọi bảng; 4 bảng sổ **không có** DELETE, UPDATE cấp cột. Chi tiết cột: DB-15 §6; index: DB-09 §8.16; seed: DB-10.

---

## 9. Trạng thái tài liệu & việc còn nợ

| Hạng mục | Trạng thái |
| --- | --- |
| Tên file + prefix + danh sách endpoint §5 + cặp quyền | ✅ Khoá ở stub này |
| Nguyên tắc bắt buộc (FSM/chốt-cuối/scope/masking/audit/tenant/idempotency) | ✅ Ghi rõ (§6) |
| Cross-link SPEC-13 / DB-15 / DB-09 / DB-10 / permission-matrix §9d / API-01 | ✅ |
| DTO request/response chi tiết từng endpoint + `packages/contracts/src/asset.ts` | ⏳ `S11-ASSET-BE-1` |
| Đối chiếu endpoint đã ship vs thiết kế (§5.2) | ⏳ cập nhật khi `S11-ASSET-BE-1` đóng |
| OpenAPI/Swagger nhóm ASSET (`API_MODULE_TAGS`) | ⏳ `S11-ASSET-BE-1` |
| Flip Stub → Approved | ✅ owner duyệt gói wave 28/08/2026 (đồng bộ SPEC-13 §1 + DB-15 §1) |

---

## 10. Liên quan

- **Đặc tả nghiệp vụ (nguồn sự thật):** [SPEC-13 ASSET](<../SPEC/SPEC-13 ASSET.md>) — §11 permission, §12 mã lỗi, §13 FSM/lõi nghiệp vụ, §15 API, §17 sự kiện, §18 audit/bảo mật, §22 quyết định.
- **Chuẩn API:** [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) — envelope, mã lỗi, pagination, idempotency.
- **Thiết kế DB:** [DB-15 ASSET Database Design](<../DB/DB-15 ASSET Database Design.md>) · [DB-09 §8.16 index](<../DB/DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 seed ASSET](<../DB/DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>).
- **Phân quyền:** [Ma trận phân quyền §9d](<../permission-matrix-spec.md>).
- **Chỉ mục:** [README §9](<../README.md>).
