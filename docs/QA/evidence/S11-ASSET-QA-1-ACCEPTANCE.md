# S11-ASSET-QA-1 — nghiệm thu QA module ASSET (bằng chứng đo)

> Work Order: `harness/backlog.mjs` → `S11-ASSET-QA-1`. Nguồn luật: [`SPEC-13 ASSET`](../../spec/SPEC-13%20ASSET.md)
> §20 (tiêu chí nghiệm thu) + §21 (test scenario cấp cao).
> Lane `mediaos_assetqa` (dựng mới, chain `0000 → 0557`) · master `454c60b3` + thay đổi của WO này.
> Ngày đo: **2026-08-30**.

Bảng dưới **không nhân bản** nội dung test — nó ánh xạ *luật §21* → *ca đang canh luật đó*. Cột **Ca**
in đậm = ca **MỚI** của WO này; ô không in đậm = đã có từ `S11-ASSET-BE-1`/`DB-1` (không viết lại).

---

## 1. Truy vết SPEC-13 §21 → ca test

| Nhóm §21 | Ca đang canh | Kết luận |
| --- | --- | --- |
| Deny-path (RED trước) | **`s11-asset-qa1-permission-matrix` A (26 ca) + B (27 ca)** · `asset-be1-scope` A | **LỖ ĐÃ LẤP** — xem §2 |
| FSM | `asset-be1-fsm` (20 ca) · **`s11-asset-qa1-error-residue`** (ô `Under Maintenance` × revoke không lượt Active) | đủ |
| Masking danh tính | `asset-be1-scope` C (Own / Department / Company + ca ALLOW từng scope) | đủ |
| Race | `asset-be1-fsm` RACE (3 ca) | đủ |
| Validate — 16 mã §12, mỗi mã ≥ 1 ca | **`asset-error-code-census.unit-spec` (18 ca, cổng tĩnh)** + **ca runtime ERR-003 mới** | **LỖ ĐÃ LẤP** — xem §3 |
| Idempotent (replay · KEY_REUSED) | `asset-be1-noti-idempotency` | đủ |
| Idempotent (interceptor chung: IN_PROGRESS · KEY_REUSED · INVALID_KEY) | **`s11-asset-qa1-idempotency-scope` (5 ca)** | **LỖ ĐÃ LẤP** — xem §4 |
| Mã & counter · Mã & prefix | `asset-be1-inventory-counter` | đủ |
| Kiểm kê | `asset-be1-inventory-counter` | đủ |
| Masking tiền (3 scope) | `asset-be1-scope` C · contracts `purchasePrice: z.number().nullable().optional()` | đủ |
| Sổ không xoá | `s11-asset-db1-invariants` A (GRANT 4 sổ) | đủ |
| Tenant (6 bảng RLS) | `rls-registry` có đủ `asset_categories · assets · asset_assignments · asset_maintenances · asset_inventories · asset_inventory_items` | đủ |
| NOTI | `asset-be1-noti-idempotency` · `s11-asset-db1-invariants` G | đủ |
| Audit | `asset-be1-fsm` audit (payload không có tiền) | đủ |

**Ngoài phạm vi WO này (báo, không làm):** §20 mục 11 — widget DASH «Tài sản» **chưa được xây** (không
có mã ASSET nào trong `src/dashboard/**` hay `apps/app/src/routes/dashboard`). Nó thuộc module DASH,
nằm ngoài `paths` của WO (`apps/api/src/assets/**` · `apps/api/test/**` · `apps/app/src/routes/assets/**`)
⇒ cần một WO riêng (đề xuất `S11-ASSET-DASH-1`), không âm thầm gộp vào đây.

---

## 2. Lỗ #1 — deny-path chứng minh SAI thứ

`asset-be1-scope` mục A dựng **một** chủ thể thiếu gần hết quyền (`e1` chỉ có `view@Own`) rồi bắn vào 12
endpoint ghi ⇒ 403. Ca đó chứng minh *"thiếu quyền thì bị chặn"*, **không** chứng minh *"route được gác
bằng ĐÚNG cặp"*: nếu `POST /assets/:id/dispose` lỡ khai `('update','asset')`, `e1` vẫn 403 vì nó thiếu
**cả hai** ⇒ lưới xanh trong khi cặp đã lệch.

Phép đo mới = **A/B cùng một request, chỉ đổi chủ thể**: `full` giữ đủ 11 cặp; `no-<P>` giữ 10 cặp,
thiếu đúng cặp `P`. Ma trận phủ **đủ 22 route** của 4 controller:

| Cặp | Route được gác | Deny (A) | Allow (B) |
| --- | --- | --- | --- |
| `('view','asset')` | `GET /assets` · `/assets/summary` · `/assets/:id` · `/assets/:id/assignments` · `/assets/:id/maintenances` · `/asset-categories` · `/asset-inventories` · `/asset-inventories/:id` · `/asset-inventories/:id/items` · `/me/assets` | 10 ca 403 | 10 ca **200** |
| `('create','asset')` | `POST /assets` | 1 | 1 |
| `('update','asset')` | `PATCH /assets/:id` | 1 | 1 |
| `('delete','asset')` | `DELETE /assets/:id` | 1 | 1 |
| `('assign','asset')` | `POST /assets/:id/assign` | 1 | 1 |
| `('revoke','asset')` | `POST /assets/:id/revoke` | 1 | 1 |
| `('dispose','asset')` | `POST /assets/:id/dispose` · `/recover` | 2 | 2 |
| `('manage','asset-category')` | `POST` · `PATCH :id` · `DELETE :id` `/asset-categories` | 3 | 3 |
| `('manage','asset-maintenance')` | `POST /assets/:id/maintenances` · `…/:mid/close` | 2 | 2 |
| `('manage','asset-inventory')` | `POST /asset-inventories` · `PATCH :id/items/:itemId` · `POST :id/items/bulk-mark` · `POST :id/close` | 4 | 4 |
| `('access','asset')` | *(cổng NAV, không route)* | — | mục D: thiếu `access` + có `view` ⇒ `GET /assets` **200** |

Kèm theo:

- **Chống "chủ thể hỏng toàn cục"**: mỗi chủ thể `no-<P>` phải dùng được route của cặp KHÁC (ca B cuối) —
  nếu không, 403 ở mục A có thể chỉ vì user seed sai.
- **Không tác dụng phụ**: route ghi bắn vào UUID không tồn tại / body rỗng ⇒ qua guard rồi dừng ở
  pipe/service (400/404). Guard chạy trước pipe nên vế 403 không phụ thuộc body — hai vế A/B dùng **chung** body.
- **Census route** (mục C): tập cặp khai bằng `@RequirePermission` phải khớp **đúng số lượng** với ma
  trận (22) ⇒ route thứ 23 mọc lên là ĐỎ.

---

## 3. Phát hiện của WO: ASSET gác quyền ở **HAI TẦNG** — lệch một tầng thì runtime MÙ

Đo bằng **đột biến có kiểm soát** (RED-trước-GREEN, không tin lưới xanh):

| Đột biến | Kết quả | Đọc ra điều gì |
| --- | --- | --- |
| Đổi **decorator** `dispose` → `@RequirePermission("update","asset")`, giữ nguyên service | 55 ca A/B **VẪN XANH**; chỉ census (mục C) ĐỎ | Đường HTTP vẫn 403 vì **tầng thứ hai** chặn: `asset-lifecycle.service.ts` gọi `access.assertCan(user,"dispose","asset")` (403 `AUTH-ERR-FORBIDDEN: out of permission scope`) |
| Đổi **cả hai** tầng sang `update` | Mục A ĐỎ: `POST /assets/:id/dispose` trả 404 thay vì 403 | Ma trận runtime **không** xanh-rỗng — nó đo đúng thứ nó nói |

Hệ quả đã đóng vào lưới: thêm ca census **"cặp ở service `assertCan` KHỚP ĐÚNG tập cặp khai trên route"**.
Không có ca này, lệch một-tầng trôi im lặng cho tới ngày service được gọi từ **job** (không qua guard) —
lúc đó mất hẳn tầng còn lại.

---

## 4. Lỗ #2 — `ASSET-ERR-003` chưa từng có ca nào

Coverage dòng của `src/assets/**` là **97.5 %** ngay sau `S11-ASSET-BE-1` — vậy mà `ASSET-ERR-003`
(`NO_ACTIVE_ASSIGNMENT`) **không có lấy một ca**. Lý do: đường tự nhiên nhất ("thu hồi tài sản đang
`In Stock`") **không chạm được** 003 — `assertTransition` chặn trước bằng **001** (chính spec BE-1 ghi chú
như vậy). Đường thật tới 003:

```
In Stock → (mở bảo trì) → Under Maintenance, CHƯA từng cấp phát → thu hồi
  · §13.1: ô `Under Maintenance` × thu hồi Good/Damaged là ô HỢP LỆ (status giữ nguyên)
  · returnActiveTx không thấy lượt Active ⇒ 409 ASSET-ERR-003
```

Ca mới `s11-asset-qa1-error-residue`: vế DENY (409 + mã + **không tác dụng phụ**: status giữ
`Under Maintenance`, lượt bảo trì vẫn `Open`) và vế **ALLOW đối chứng** (cùng trạng thái nhưng CÓ lượt
Active ⇒ 201, lượt `Returned`, status giữ nguyên) — thiếu vế sau thì ca DENY có thể xanh chỉ vì "thu hồi
khi bảo trì luôn hỏng".

**Cổng giữ luật về sau:** `test/foundation/asset-error-code-census.unit-spec.ts` — mọi mã **được ném**
trong `src/assets/**` phải có ít nhất một assert trong bề mặt test ASSET; riêng hai mã biên Zod
(`009 REASON_REQUIRED` · `016 RETURN_CONDITION`) phải **không** được ném (đính chính SPEC-13 §12 ngày
30/08 — chúng trả `400 VALIDATION-ERR-001`), nếu một ngày service ném thật thì cổng ĐỎ và buộc bổ sung
ca runtime.

---

## 5. Lỗ #3 — biên của `@Idempotent()` trên đường ASSET

`asset-be1-noti-idempotency` đã phủ replay + `KEY_REUSED`. Ba vế còn lại của §21 và một vế **BẤT BIẾN #1**
được bổ sung ở `s11-asset-qa1-idempotency-scope`:

| Ca | Đo gì | Ghi chú phương pháp |
| --- | --- | --- |
| `INVALID_KEY` | khoá > 200 ký tự ⇒ 409 **và 0 lượt sinh ra**; khoá dài **đúng 200** (biên) ⇒ 201 | vế "0 lượt" mới chứng minh interceptor chặn TRƯỚC handler |
| `IN_PROGRESS` | bấm-đúp khi request đầu chưa xong ⇒ 409 `REQUEST-ERR-IDEMPOTENCY-IN-PROGRESS`, **không** phải `ASSET-ERR-001` | **tất định, không đua**: giữ khoá hàng `SELECT … FOR UPDATE` trên `assets` bằng tx của pool owner ⇒ request #1 treo **trong** handler (sau khi interceptor đã ghi khoá) ⇒ #2 chắc chắn gặp in-flight |
| khác **người gọi**, cùng chuỗi khoá | mỗi bên chạy nghiệp vụ của mình, không header phát lại | khoá băm `companyId+userId+method+path+key` |
| khác **công ty**, cùng chuỗi khoá | như trên | thiếu vế này thì hai tenant đọc được phản hồi của nhau **qua đường cache** |
| handler LỖI ⇒ nhả khoá | 404 rồi retry cùng khoá + cùng payload ⇒ chạy THẬT lại (không mang header phát lại) | lỗi không được cache; khoá không "chết" |

> Ghi chú về ca `IN_PROGRESS`: bản đầu viết theo kiểu `Promise.all` rồi `if (loser) … else …`. Đó là ca
> **có thể không bao giờ chạy nhánh mình định đo** — nếu request đầu xong trước, nhánh IN_PROGRESS biến
> mất mà lưới vẫn xanh. Đã thay bằng cách ép bằng khoá hàng ở trên.

---

## 6. Coverage

Lệnh tái lập (đã thêm vào `apps/api/package.json`):

```bash
bash harness/check.sh --lane-db=assetqa      # hoặc tự export LANE_DB + 3 mật khẩu DB
pnpm --filter @mediaos/api test:cov:asset
```

| Chỉ số | Đo được | Ngưỡng WO |
| --- | --- | --- |
| Statements | **97.59 %** (3078/3154) | ≥ 80 % |
| Branches | **88.74 %** (560/631) | ≥ 80 % |
| Functions | **98.21 %** (165/168) | ≥ 80 % |
| Lines | **97.59 %** | ≥ 80 % |

**KHÔNG** cắm ngưỡng `thresholds` cho `src/assets/**` vào `vitest.config.ts`: phần lớn con số trên do
int-spec sinh ra, mà int-spec `describe.skipIf(!hasLaneDb)` ⇒ lần chạy **không có DB** sẽ đọc ra ~0 % và
làm ĐỎ GIẢ. Đây đúng là cái bẫy mà chính khối `thresholds` hiện tại đã ghi chú (chỉ gác file
unit-test-được). Bằng chứng vì thế là **lệnh tái lập + con số trong tài liệu này**, không phải một cổng
tự bắn vào chân mình.

---

## 7. Tổng kết lượt chạy

| Bộ | Tệp | Ca |
| --- | --- | --- |
| MỚI — ma trận quyền per-pair | `test/integration/s11-asset-qa1-permission-matrix.int-spec.ts` | 56 |
| MỚI — biên idempotency + cô lập chủ thể | `test/integration/s11-asset-qa1-idempotency-scope.int-spec.ts` | 5 |
| MỚI — mã lỗi còn sót (ERR-003) | `test/integration/s11-asset-qa1-error-residue.int-spec.ts` | 2 |
| MỚI — census mã lỗi (cổng tĩnh) | `test/foundation/asset-error-code-census.unit-spec.ts` | 18 |
| **Cộng mới** | | **81** |
| Cụm ASSET đầy đủ (unit + int, có `LANE_DB`) | 10 tệp | **157** |
| FE ASSET | `apps/app/src/routes/assets/*.spec.ts` | 91 |

Toàn bộ chạy trên lane cô lập `mediaos_assetqa` — **không** có banner «XANH KHÔNG ĐỦ BẰNG CHỨNG».
