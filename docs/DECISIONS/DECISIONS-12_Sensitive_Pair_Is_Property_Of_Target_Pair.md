# DECISIONS-12 — `is_sensitive` là thuộc tính của CẶP ĐÍCH, không phải của HÀNG GRANT KHỚP

| | |
| --- | --- |
| **Trạng thái** | 🟢 **ĐÃ CHỐT 2026-09-04** — thi hành trong WO `S14-SEC-DASHGATE-WILDCARD-1` |
| **Ngày** | 2026-09-04 |
| **Bối cảnh** | Đo 03/09 bằng test chạy thật: actor cầm DUY NHẤT grant `('*','*')` **qua được** `gateWidgetOrThrow(…,'PAYROLL_COST')` — cặp đích `view-line:payroll-period` là **sensitive** |
| **Vùng** | 🔴 ĐỎ — crown-jewel: `can()` hot-path của TOÀN hệ |
| **Phạm vi** | `permission.decide.ts` (một biểu thức) · `permission.types.ts` (một trường) · `permission.service.ts` (ảnh chụp catalog + 4 điểm bơm) · `permission-catalog-snapshot.ts` (mới). **KHÔNG** migration, **KHÔNG** đổi catalog quyền, **KHÔNG** đụng seed/grant |

---

## 1. Lỗ — cơ chế chính xác

`permission.decide.ts:103` (trước bản vá):

```ts
const effectivelySensitive = isSensitive || companyAllows.some((g) => g.isSensitive);
```

`companyAllows` là **HÀNG GRANT KHỚP** (wildcard-aware). Actor chỉ cầm `('*','*')` ⇒ hàng khớp là hàng
`*:*`, mà `permissions.is_sensitive` của **chính hàng đó** = `false` ⇒ `effectivelySensitive = false` ⇒
rơi xuống nhánh «priority 4: non-sensitive ALLOW (wildcards valid here)» ⇒ **ALLOW**, dù **cặp đích** là
sensitive. Cùng cơ chế ở `decideStrongestScope:202-203` (đường sàn scope).

**Cờ được đọc của HÀNG GRANT, không phải của CẶP ĐÍCH. Đó là toàn bộ lỗ.**

Cổng sensitive vốn được thiết kế đúng — nó đòi «grant EXACT non-wildcard» — nhưng nó **chỉ bật** khi
biết cặp đích là sensitive, và nguồn tri thức duy nhất nó có (hàng grant khớp) chính là hàng wildcard
mà nó định chặn. Cổng tự khoá mình bằng chìa của kẻ đi qua.

**Không phải lỗ:** actor có grant EXACT cho cặp sensitive ⇒ hàng đó mang `is_sensitive=true` ⇒ gate đúng.
Đây là lý do lỗ không nổ ở đường DỮ LIỆU (§4).

---

## 2. Luật đúng ĐÃ TỒN TẠI ở hai nơi khác — quyết định này là HỘI TỤ, không phát minh

| Nơi | Cách làm | Trạng thái trước 04/09 |
| --- | --- | --- |
| `permission.service.ts` `userGrantsPermissionIds` | `if (p.isSensitive)` với `p` = **catalog entry của cặp đích** ⇒ ép `allows.some(g => g.action!=='*' && g.resourceType!=='*')` | ĐÚNG |
| `payroll-approver.reader.ts:70-74` | SQL: wildcard tính cho vế DENY, **không** tính cho vế ALLOW của cặp đích | ĐÚNG |
| `decideCan` / `decideStrongestScope` | đọc cờ của **hàng grant khớp** | **SAI** ← WO này vá |

⇒ **Ba bản cài đặt này là MỘT HỌ và phải giữ đồng bộ.** Sửa luật sensitive ở một bản mà không đối chiếu
hai bản kia là dựng lại chính lỗ này ở chỗ khác. Ai chạm một trong ba, đọc lại cả ba.

---

## 3. Hai hướng đã cân nhắc

### (A) Mỗi call site tự truyền `isSensitive` của cặp đích — **LOẠI**

Đo 03/09 bề mặt gọi thiếu cờ:

| Đường | Tổng | Thiếu `isSensitive` |
| --- | --- | --- |
| `permission.can({...})` | 36 | **25** |
| `dataScope.resolveOrNull / resolveAndAssert / resolveManyOrNull` | 120 | **87** |

**112 điểm gọi.** Phần lớn truyền cặp **ĐỘNG** (`assertCan(action, resourceType)`, `pair.action`,
`FOUNDATION_FILE_PERMISSION[input.action]`) ⇒ không sửa tĩnh được: mỗi site sẽ phải tự tra catalog.
(A) = (B) nhân 112, cộng 112 cơ hội quên. Và mỗi WO mới thêm một cơ hội quên nữa — bản vá không tự giữ.

### (B) Engine tra cờ theo CẶP ĐÍCH — **CHỌN**

Một ảnh chụp catalog trong `PermissionService`; `decideCan`/`decideStrongestScope` nhận thêm trường
`pairIsSensitive` và OR vào cổng wildcard. Call site **không đổi một dòng nào**. Cặp mới thêm vào catalog
tự được bảo vệ.

Giá phải trả — và biện pháp — ở §5.

---

## 4. 🔴 CHƯA NỔ ngoài thực địa ≠ đã an toàn

Đường DỮ LIỆU vẫn kín tới hôm nay nhờ **ba lớp độc lập**, không lớp nào là bản vá:

1. mig 0565 §6.7 census fail-closed — **0 role SEED giữ wildcard**;
2. hai role tuỳ biến PROD từng giữ wildcard đã thu hồi ở `S14-PROD-PAYROLLGRANT-1`;
3. tầng-2 service nguồn (`PayrollAccessService` / `RecruitAccessService`) truyền cờ **tường minh**.

Đo 03/09 trên DB dev: catalog **390** hàng / **139** sensitive / đúng **1** hàng wildcard (`*:*`,
`is_sensitive=false`) / **0 role giữ wildcard** — kể cả `SA` (SA giữ **372 cặp EXACT**).

**Một role tuỳ biến mới cầm `*:*` là lỗ sống lại.** Quyết định này bịt ở tầng engine để lớp 1–3 trở lại
đúng vai defense-in-depth thay vì là thứ duy nhất đang đỡ.

---

## 5. Thiết kế đã chốt

### 5.1 Trường RIÊNG `pairIsSensitive`, KHÔNG OR vào `isSensitive`

`isSensitive` điều khiển **ba** thứ khác nhau trong `decideCan`:

| Dùng ở | Dòng (trước vá) | Hệ quả nếu bị lật ngầm |
| --- | --- | --- |
| cổng wildcard/exact | `:103-110`, `:202-208` | ← **chỗ DUY NHẤT muốn đổi** |
| `auditRequired` ở object-tier ALLOW | `:82` | `hr-read.service.ts:360,393` · `employees.service.ts:223` dùng `reveal = allow && auditRequired` ⇒ lật `false→true` biến **MASK thành REVEAL** |
| `needsObjectGrant = objectGrantRequired ?? (isSensitive && requiresReauth)` | `:95-98` | deny **cả actor có grant EXACT** |

⇒ Cờ mới đặt ở **một dòng duy nhất**, **SAU** cả hai vùng nguy hiểm:

```ts
const effectivelySensitive =
  isSensitive || companyAllows.some((g) => g.isSensitive) || (pairIsSensitive ?? false);
```

Vị trí giải quyết hai rủi ro trên **về mặt cấu trúc**, không bằng kỷ luật: object-tier trả về ở `:82` và
`needsObjectGrant` quyết ở `:95-98` đều **trước** dòng này ⇒ cờ mới không với tới được chúng.

### 5.2 Bất biến kết quả — đúng MỘT return site mới, gộp HAI trạng thái cũ

`explicitAllows` lọc `g.action !== "*" && g.resourceType !== "*"` ⇒ mọi phần tử là grant EXACT cho đúng
cặp đích. `grant.isSensitive` lấy từ `innerJoin(permissions)` ⇒ với grant exact nó **CHÍNH LÀ** cờ catalog
của cặp đích. Suy ra: nếu `pairIsSensitive === true` **và** `explicitAllows` khác rỗng thì
`companyAllows.some(g => g.isSensitive)` đã `true` từ trước ⇒ nhánh sensitive đã vào kể cả khi không vá.

⇒ **Mọi lần vào nhánh NHỜ `pairIsSensitive` đều có `explicitAllows === []`** ⇒ luôn dừng ở return
`deny-sensitive`. Nhánh reauth và nhánh allow **không** có đường vào mới ⇒ mọi `auditRequired` giữ nguyên.

| Trạng thái cũ | Mới | Ý nghĩa |
| --- | --- | --- |
| `allow / auditRequired:false` (actor **chỉ có wildcard**) | `deny-sensitive` | ← **chính là lỗ đang vá** |
| `deny-default / auditRequired:false` (actor **không có grant nào khớp**) | `deny-sensitive` | vẫn DENY, nhưng **`reason` đổi** |

**`reason` là chuỗi ĐI RA NGOÀI**, không chỉ nằm trong log: `files.service.ts` đưa nó vào **cả message
403 lẫn cột `file_access_logs.denied_reason`** (dữ liệu LƯU LẠI); `permission.guard.ts` và
`profile-change-request.service.ts` nhét vào message. Đổi `deny-default → deny-sensitive` trên cặp
sensitive là **chủ đích** và phải cập nhật kỳ vọng test, KHÔNG kết luận bản vá sai.

### 5.3 Ảnh chụp catalog — vòng đời

| Q/Đ | Nội dung |
| --- | --- |
| **D1 — không preload lúc boot** | `OnModuleInit` đọc DB biến DB thành phụ thuộc CỨNG lúc khởi động; API PROD hiện **boot được khi chưa có DB**. Nạp lười ở lần kiểm quyền đầu. |
| **D2 — hỏng khi nạp** | Có ảnh chụp cũ + refresh lỗi ⇒ GIỮ ảnh cũ + `logger.error`, KHÔNG ném. Chưa có ảnh chụp + nạp lỗi ⇒ `pairIsSensitive = true` + `logger.error`, KHÔNG ném, **KHÔNG đóng dấu TTL** (blip DB không khoá 300s). Nhờ §5.1, `true` chỉ siết cổng wildcard ⇒ degradation có biên. **Cấm ném:** `can()` bọc try/catch fail-closed ⇒ một lỗi catalog sẽ deny TOÀN BỘ kiểm quyền = sự cố lớn hơn lỗ đang vá. |
| **D3 — ảnh chụp ĐÃ NẠP mà cặp VẮNG ⇒ `false`** | Cặp không có trong catalog không thể là cặp sensitive của catalog. Chọn `true` sẽ biến mọi mock `getAllPermissions(): []` thành «mọi cặp sensitive» và làm hàng loạt spec đỏ vì lý do sai. |
| **D4 — cặp truy vấn tự chứa `*` ⇒ `true`** | Chặn `*` thành đường lách chính bản vá. |
| **D5 — TTL** | `PERMISSION_CATALOG_TTL_MS = 300_000`, refresh **await** khi hết hạn, kèm timeout cho query (DB treo không kéo `can()` treo theo). |
| **D6 — single-flight** | `dashboard-widget-registry.service.ts` gọi `Promise.all(rows.map(… can()))` ⇒ ảnh chụp lạnh + N widget = N query song song. Giữ promise đang bay, trả lại cho mọi caller đồng thời. **Promise chia sẻ KHÔNG BAO GIỜ reject** — bọc try/catch BÊN TRONG, trả sentinel, xoá slot trong `finally`; để nó reject là bắn unhandled rejection trên đường **mọi** `can()` đi qua. |
| **D7 — seam cho test là method PUBLIC trên `PermissionService`** | Ảnh chụp là state **PER-INSTANCE** (module-level làm mọi instance trong cùng file test dùng chung ảnh chụp bất kể repo nào nạp trước). `resetCatalogSnapshotForTest()` gọi qua `app.get(PermissionService)`. |
| **D8 — không Valkey, KHÔNG móc `permission.changed`** | Ảnh chụp trong tiến trình, mỗi instance tự nạp ⇒ 0 khoá chia sẻ để lệch. `permission.changed` là sự kiện của **GRANT**, không phải catalog — nối vào đó là nối nhầm dây. |

**Cửa sổ ≤300s:** cặp sensitive seed **khi API đang chạy** có thể lọt tối đa một TTL. Chỉ nổ khi có holder
wildcard (đo: 0). Migration đi kèm deploy ⇒ restart xoá ảnh chụp.

---

## 6. Hệ quả có chủ ý — không phải hồi quy

1. **Kiểu dashboard của actor chỉ-wildcard tụt về `Employee`**: `view-admin/hr/manager:dashboard` đều
   sensitive ⇒ mất; `view-employee:dashboard` non-sensitive ⇒ còn.
2. **Đổi hành vi ở module ngoài DASH.** Cặp sensitive chạm được từ site thiếu cờ:
   `view-line:payroll-period` · `view:candidate` · `view:leave` · `view:audit-log` ·
   `view-own:attendance` · `view-team:attendance` · `view-team:leave-calendar` · `import:employee`.
   Vá theo **BỀ MẶT** là chủ đích của WO, không phải scope creep.
3. **Ca test khẳng định wildcard MỞ được cặp sensitive sẽ đỏ.** Đỏ ở đó là tín hiệu ĐÚNG
   (`tests-can-pin-a-hole-open`). Ca dùng `*:*` để mở cặp **non-sensitive** (vd `manage:offer` ở
   `recruit-be1-scope.int-spec.ts`) **phải vẫn xanh**; nếu đỏ ⇒ bản vá sai, không phải fixture sai.

---

## 7. Ngoài phạm vi — ghi tường minh

- **FE `use-can.ts` có fallback `caps["*:*"]`** và `getCapabilities()` vẫn publish `*:*` (lọc theo cờ
  HÀNG GRANT). Sau bản vá, actor chỉ-wildcard sẽ **thấy** màn sensitive rồi ăn 403 — khoảng lệch nới
  rộng. **Không phải lỗ mới** (đã ghi ở `use-can.ts`, `useCanExact` là lối đúng) và 0 holder wildcard nên
  0 người gặp. **DEFER TƯỜNG MINH** → WO `S14-SEC-CAPWILDCARD-1`.
- Không đổi `SENSITIVE_CAPABILITY_ALLOWLIST` (cờ HIỂN THỊ, không phải cổng).
- Không đổi seed/migration/catalog quyền.
- Không đụng `PayrollAccessService` / `RecruitAccessService` (đã truyền cờ tường minh; `pairIsSensitive`
  trùng lặp vô hại).

---

## 8. Cổng NGƯỜI trước deploy PROD

PROD **không đo được từ phiên agent** (`classifier-blocks-prod-db-from-agent`) ⇒ owner chạy census.

⚠️ Tiêu chí **KHÔNG** phải «có wildcard ⇒ DỪNG»: `super-admin-bootstrap.service.ts` grant TOÀN BỘ catalog
(trừ `reveal-secret:platform-account`) nên SA có thể ôm cả `*:*` mà vẫn đủ cặp EXACT ⇒ không mất gì.

**Tiêu chí đúng:** role giữ wildcard **VÀ THIẾU** grant exact cho cặp sensitive nó đang với tới.

---

**Liên quan:** DECISIONS-06 (động từ quyền chuẩn) · DECISIONS-09 (reauth + object grant) ·
`docs/permission-matrix-spec.md` · `docs/plans/S14-SEC-DASHGATE-WILDCARD-1.md`.
