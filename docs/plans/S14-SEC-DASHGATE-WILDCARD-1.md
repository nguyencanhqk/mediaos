# S14-SEC-DASHGATE-WILDCARD-1 — Vá lỗ wildcard `*:*` lọt qua cặp SENSITIVE

> Zone: **đỏ (crown-jewel: permission engine)** · Gate: **FULL** · Model: Opus (code + review)
> Phụ thuộc: `S14-PERF-DASHACTOR-1` (merged #469 — WO đó GHIM hành vi hiện tại bằng test; WO này ĐỔI nó).
>
> **v2 (03/09)** — viết lại sau plan-review vòng 1 (FAIL, 5 BLOCKING + 5 HIGH). Mọi mục ghi
> «✅ B*/H*» là chỗ vá đúng finding đó. §8 ghim lại các finding đã tự xác minh.

---

## 1. Lỗ — cơ chế chính xác

`permission.decide.ts:103`

```ts
const effectivelySensitive = isSensitive || companyAllows.some((g) => g.isSensitive);
```

`companyAllows` là **HÀNG GRANT KHỚP** (wildcard-aware). Actor chỉ cầm `('*','*')` ⇒ hàng khớp là hàng
`*:*`, mà `permissions.is_sensitive` của **chính hàng đó** = `false` ⇒ `effectivelySensitive=false` ⇒
rơi xuống nhánh «priority 4: non-sensitive ALLOW (wildcards valid here)» ⇒ **ALLOW**, dù **cặp đích**
là sensitive. Cùng cơ chế ở `decideStrongestScope:202-203` (đường sàn scope).

**Cờ được đọc của HÀNG GRANT, không phải của CẶP ĐÍCH.** Đó là toàn bộ lỗ.

**Không phải lỗ:** actor có grant EXACT cặp sensitive ⇒ hàng đó mang `is_sensitive=true` ⇒ gate đúng.

### 1.1 Luật đúng ĐÃ TỒN TẠI ở hai nơi khác trong repo (✅ M5, H4)

| Nơi | Cách làm | Trạng thái |
| --- | --- | --- |
| `permission.service.ts:728-730` `userGrantsPermissionIds` | `if (p.isSensitive)` với `p` = **catalog entry của cặp đích** ⇒ ép `allows.some(g => g.action!=='*' && g.resourceType!=='*')` | ĐÚNG |
| `payroll-approver.reader.ts:70-74` | SQL: wildcard tính cho vế DENY, **không** tính cho vế ALLOW của cặp đích | ĐÚNG |
| `decideCan` / `decideStrongestScope` | đọc cờ của **hàng grant khớp** | **SAI** |

⇒ WO này làm engine **hội tụ về luật đã có sẵn hai bản**, không phát minh luật mới. ADR phải ghi cả 3
bản là một họ phải giữ đồng bộ (H4).

---

## 2. Số đo (03/09 — chạy thật trên DB dev + census script, KHÔNG suy từ comment)

### 2.1 Catalog `permissions`

| Đo | Giá trị |
| --- | --- |
| tổng hàng | **390** |
| `is_sensitive = true` | **139** |
| hàng wildcard | **đúng 1**: `*:*`, `is_sensitive=false` |
| role giữ wildcard (`role_permissions ⋈ permissions`) | **0 hàng** — kể cả `SA` (SA giữ 372 cặp EXACT) |

Grant PHẢI join `permissions` ⇒ chỉ hình dạng `*:*` dựng được hôm nay. Nhưng matcher xử lý `action==='*'`
**HOẶC** `resourceType==='*'` độc lập ⇒ bản vá phủ **cả 4 hình dạng**
(memory `permission-grant-census-must-cover-four-wildcard-shapes`).

### 2.2 Bề mặt gọi thiếu cờ

| Đường | Tổng | **Thiếu `isSensitive`** |
| --- | --- | --- |
| `permission.can({...})` | 36 | **25** |
| `dataScope.resolveOrNull/resolveAndAssert/resolveManyOrNull` | 120 | **87** |

**112 điểm gọi.** Phần lớn truyền cặp **ĐỘNG** (`assertCan(action, resourceType)`, `pair.action`,
`FOUNDATION_FILE_PERMISSION[input.action]`) ⇒ không sửa tĩnh được.

### 2.3 Cặp SENSITIVE thật chạm được từ site thiếu cờ

`view-line:payroll-period` · `view:candidate` · `view:leave` · `view:audit-log` · `view-own:attendance` ·
`view-team:attendance` · `view-team:leave-calendar` · `import:employee`
(+ site truyền action ĐỘNG trên `employee` / `task` — hai resource có 7 và 2 action sensitive).

### 2.4 Census xung đột — làm lại theo GIÁ TRỊ, không grep literal (✅ B5)

Phương pháp v1 (grep `isSensitive: false`) **mù với cờ truyền qua biến**. Ví dụ phản chứng có thật:
`role-admin.service.ts:803-817` `assertCan(actor, action, resourceType, isSensitive: boolean)`, doc-block
`:799-801` khai TƯỜNG MINH «`isSensitive=false` (create/update:role) ⇒ wildcard hợp lệ».

**Đo lại (bắt buộc chạy lại trong lúc thi công, ghi kết quả vào PR):** tập
`{ cặp mà một call site khai/suy ra cờ = false } ∩ { catalog is_sensitive = true }`.

Kết quả sơ bộ đã kiểm tay: `create:role` · `update:role` **không** sensitive (catalog: `role` chỉ có
`change-role` sensitive) ⇒ site B5 **không** bị lật. Các cờ suy từ const cũng non-sensitive:
`me.constants.ts:94,106,112,118` · `leave-calendar.service.ts:14-17` ·
`dashboard-widget-catalog.const.ts:462,666` · `payroll-route-pairs.const.ts` · `recruit-access.service.ts:57`.
**Nhưng §4 làm câu hỏi này gần như vô hại**: cờ catalog KHÔNG còn ghi đè `auditRequired`/`objectGrantRequired`.

### 2.5 Cặp vắng catalog chạm được từ site thiếu cờ

`read:attendance_all` (`dashboard.controller.ts:155`). Xem D3 §4.3.

---

## 3. Hướng vá — **(B)**, có ADR

(A) «mỗi call site tự truyền cờ» **không phải lựa chọn**: §2.2 cho thấy các site nguy hiểm nhất truyền
cặp ĐỘNG ⇒ (A) buộc tra catalog **ở 112 chỗ** = (B) nhân 112, cộng 112 cơ hội quên.

**ADR: `docs/DECISIONS/DECISIONS-12_Sensitive_Pair_Is_Property_Of_Target_Pair.md`.**
Nội dung: cờ `is_sensitive` là thuộc tính của **cặp đích**; hàng grant chỉ còn vai trò defense-in-depth;
3 bản cài đặt (§1.1) phải đồng bộ; ghi rõ (M2) rằng bản vá **có** đổi `permission.decide.ts` (thêm MỘT
trường vào input, không đổi thân quyết định `auditRequired`).

---

## 4. Thiết kế

### 4.1 ✅ B1 — Catalog nằm TRONG `PermissionService`, KHÔNG phải provider DI mới

**Đo:** `new PermissionService(` xuất hiện **56 lần** (`apps/api`), trong đó ~20 là int-spec dựng tay
(`settings-permission-leak.int-spec.ts:44,225` · `rbac-operator-escalation.int-spec.ts:74` ·
`permission-admin.int-spec.ts:160` · `auth-me-bootstrap.int-spec.ts:80` · … ); `permission.module.ts:128-133`
dựng bằng factory `new PermissionService(cachedRepo)`.

⇒ Thêm tham số constructor = **typecheck đỏ ~35 file**; thêm tham số optional = bản vá **INERT** ở mọi
site dựng tay, tức đúng những int-spec chống-leo-thang lại chạy trên engine chưa vá
(`tests-can-pin-a-hole-open`).

**Chốt:** `PermissionService` tự dựng ảnh chụp từ `this.repo.getAllPermissions()` —
`IPermissionRepository` đã khai method này (`permission.types.ts:183`), `CachedPermissionRepository`
đã delegate (`permission.cache.ts:160`), và `listGrantableScopes` đã dùng chính nó
(`permission.service.ts:446`). **0 call-site đổi, 0 provider mới, 0 dòng `permission.module.ts`.**

### 4.2 ✅ H1 + H2 + F1 — Trường RIÊNG `pairIsSensitive`, đặt ĐÚNG MỘT chỗ

v1 định OR cờ catalog vào `isSensitive`. Sai, vì `isSensitive` **điều khiển 3 thứ khác nhau**:

| Dùng ở | Dòng | Hệ quả nếu bị lật ngầm |
| --- | --- | --- |
| cổng wildcard/exact | `:103-110`, `:202-208` | ← **CHỖ DUY NHẤT muốn đổi** |
| `auditRequired` ở object-tier ALLOW | `:82` | `hr-read.service.ts:360,393` · `:136,151` · `employees.service.ts:223` dùng `reveal = allow && auditRequired` ⇒ lật false→true = **mask biến thành REVEAL** |
| `needsObjectGrant = objectGrantRequired ?? (isSensitive && requiresReauth)` | `:95-98` | deny **cả actor có grant EXACT** |

**Chốt — MỘT dòng, đặt SAU cả hai vùng nguy hiểm:**

```
// permission.decide.ts:103 — object-tier (:61-84) và needsObjectGrant (:95-98) nằm TRƯỚC dòng này
const effectivelySensitive =
  isSensitive || companyAllows.some((g) => g.isSensitive) || (pairIsSensitive ?? false);
```

Vị trí giải quyết H1 + H2 **về mặt cấu trúc**, không phải bằng kỷ luật: object-tier trả về ở `:82` và
`needsObjectGrant` quyết ở `:95-98` đều **trước** `:103` ⇒ cờ mới không với tới được chúng.
(`decideStrongestScope:202` tương tự, và nó không có `auditRequired`.)

> v2 dựng hai cờ `auditSensitive`/`gateSensitive`. Chứng minh dưới đây cho thấy **không cần** — bản
> một-dòng cho kết quả y hệt với diff nhỏ hơn và ít chỗ sai hơn.

#### Chứng minh: chỉ ĐÚNG MỘT return site mới với tới được

`explicitAllows` (`:107`) lọc `g.action !== "*" && g.resourceType !== "*"` ⇒ mọi phần tử của nó là grant
**EXACT** cho đúng cặp đích. Mà `grant.isSensitive` được lấy từ `innerJoin(permissions)`
(`permission.repository.ts:34,41`) ⇒ với grant exact, `grant.isSensitive` **CHÍNH LÀ** cờ catalog của
cặp đích.

⇒ Nếu `pairIsSensitive === true` **và** `explicitAllows` khác rỗng, thì `companyAllows.some(g => g.isSensitive)`
đã `true` từ trước ⇒ nhánh sensitive **đã** vào kể cả khi không có bản vá.
⇒ **Mọi lần vào nhánh NHỜ `pairIsSensitive` đều có `explicitAllows === []`** ⇒ luôn dừng ở `:109`.
⇒ `:111-118` (reauth) và `:119` (allow) **không** có đường vào mới ⇒ mọi `auditRequired` giữ nguyên giá trị.

**Bất biến kết quả — đúng MỘT return site mới, gộp HAI trạng thái cũ:**

| Trạng thái cũ | Mới | Ý nghĩa |
| --- | --- | --- |
| `:132` `allow / auditRequired:false` (actor **chỉ có wildcard**) | `:109` `deny-sensitive` | ← **chính là lỗ đang vá** |
| `:136` `deny-default / auditRequired:false` (actor **không có grant nào khớp**) | `:109` `deny-sensitive` | ✅ **F1** — vẫn DENY, nhưng **`reason` đổi** |

#### ✅ F1 — `reason` là chuỗi ĐI RA NGOÀI, phải xử lý tường minh

`decision.reason` không chỉ nằm trong log: `files.service.ts:393,397,457,461,563,570,667,675,743,747`
đưa nó vào **cả message 403 lẫn cột `file_access_logs.denied_reason`** (dữ liệu LƯU LẠI);
`permission.guard.ts:140` và `profile-change-request.service.ts:587` nhét vào message;
`chat-attachments.service.ts:263` **so sánh** `decision.reason === "deny-no-resolver" | "deny-error"`
(hai giá trị này không nằm trong họ đang đổi ⇒ không ảnh hưởng, nhưng phải kiểm lại khi sửa).

⇒ Trên 25 call-site `can()` thiếu cờ (§2.2), actor **không có grant** trên cặp sensitive sẽ đổi
`deny-default` → `deny-sensitive`. Vẫn 403, vẫn deny — nhưng chuỗi đổi.
**`auditRequired` ở `:109` GIỮ NGUYÊN `true`** (đang hard-code): không consumer sản phẩm nào đọc
`auditRequired` trên nhánh DENY (3 chỗ duy nhất đều là `reveal = allow && auditRequired`), và audit
NHIỀU hơn cho một denial trên cặp nhạy cảm là chiều đúng.

### 4.3 Ảnh chụp catalog — vòng đời

| Quyết định | Nội dung |
| --- | --- |
| **D1 — không preload lúc boot** | `OnModuleInit` đọc DB biến DB thành phụ thuộc cứng lúc khởi động; memory `prod-api-boots-without-db-until-login` ghi API PROD **boot được khi chưa có DB**. Nạp lười ở lần kiểm quyền đầu. |
| **D2 — hỏng khi nạp** | có ảnh chụp cũ + refresh lỗi ⇒ GIỮ ảnh cũ + `logger.error`, KHÔNG ném. **Chưa có ảnh chụp nào** + nạp lỗi ⇒ `pairIsSensitive = true` + `logger.error`, KHÔNG ném, **KHÔNG đóng dấu TTL** (✅ M3 — blip DB không khoá 300s). Nhờ §4.2, `true` chỉ siết cổng wildcard: không lật `auditRequired`, không bật `needsObjectGrant` ⇒ degradation có biên. **Cấm ném**: `can()` bọc try/catch fail-closed ⇒ một lỗi catalog sẽ deny TOÀN BỘ kiểm quyền = sự cố lớn hơn lỗ đang vá. |
| **D3 — ✅ B2/B3: ảnh chụp ĐÃ NẠP mà cặp VẮNG ⇒ `false` (non-sensitive)** | v1 chọn `true`. **Sai:** unit spec mock `getAllPermissions(): []` (`permission.service.spec.ts:137` · `permission.service.reveal.spec.ts:80` · `permission.coverage.spec.ts:69` · `permission.scopes.spec.ts:49` · `data-scope.service.spec.ts:51` · `data-scope.service.coverage.spec.ts:57` · `test/foundation/permission-scope-batch.unit-spec.ts:56` · `dashboard-scope-roundtrip.unit-spec.ts:48`) ⇒ MỌI cặp thành sensitive ⇒ đỏ hàng loạt; và `test/helpers/seed.ts:155-171` seed catalog **SAU** `app.init()` ⇒ đỏ/flaky theo thứ tự chạy. Với `false`, các spec đó giữ nguyên hành vi. |
| **D4 — cặp truy vấn tự chứa `*` ⇒ `true`** | chặn `*` thành đường lách chính bản vá. ✅ M7: ghép ca test này với assert census «0 call-site sản phẩm truyền `*`» để nó không là code chết. |
| **D5 — TTL** | `PERMISSION_CATALOG_TTL_MS = 300_000`, refresh **await** khi hết hạn. Kèm `AbortSignal.timeout` cho query (✅ M3: DB treo không kéo `can()` treo theo). |
| **D6 — ✅ B4 + F3 single-flight** | `dashboard-widget-registry.service.ts:184-201` gọi `Promise.all(rows.map(… can()))` ⇒ ảnh chụp lạnh + N widget = **N query song song**, đúng trên đường WO này đang vá. Giữ promise đang bay, trả lại cho mọi caller đồng thời. ✅ **F3: promise chia sẻ KHÔNG BAO GIỜ reject** — bọc `try/catch` BÊN TRONG, trả giá trị sentinel (`null` = nạp hỏng), và xoá slot trong `finally`. Để nó reject là bắn unhandled rejection trên đường **mọi** `can()` đi qua — repo đã ăn đúng đòn này (memory `vitest-unhandled-rejection-after-teardown`: CI ĐỎ trong khi 1821/1821 PASS). |
| **D7 — ✅ B3 + F4 seam cho test** | ✅ **F4 chốt: ảnh chụp là state PER-INSTANCE của `PermissionService`** (không phải module-level — module-level làm mọi instance trong CÙNG file test dùng chung ảnh chụp bất kể repo nào nạp trước, vỡ ở `data-scope.service.spec.ts:85-146` dựng 8 instance và ở §5.3 dùng stub mini-catalog). Seam = **method public trên `PermissionService`** (`resetCatalogSnapshotForTest()`), int-spec gọi qua `app.get(PermissionService)` — **không** export hàm module-level (sẽ là dây chết, không chạm được ảnh chụp của singleton DI). |
| **D8 — không Valkey** | ảnh chụp trong tiến trình, mỗi instance tự nạp ⇒ 0 khoá chia sẻ để lệch (memory `valkey-shared-across-all-envs-no-channel-prefix`). ✅ M8: **KHÔNG** móc vào `permission.changed` — đó là sự kiện của GRANT, không phải catalog. Ghi comment để người sau không nối nhầm dây. |

### 4.4 Điểm nối

| File | Sửa |
| --- | --- |
| `permission.types.ts` | `CanInput.pairIsSensitive?: boolean`; `ScopeRequest.pairIsSensitive?: boolean` |
| `permission.decide.ts` | §4.2 — tách `auditSensitive` / `gateSensitive` ở `decideCan`; `\|\| pairIsSensitive` ở `decideStrongestScope` |
| `permission.service.ts` | ảnh chụp private + `pairIsSensitiveFor()`; bơm vào `can` · `canBatch` (mỗi spec) · `resolveStrongestScope` · `resolveStrongestScopes` (mỗi request) |
| `permission-catalog-snapshot.ts` (mới) | logic ảnh chụp thuần (TTL · single-flight · fail mode) để unit-test không cần DB |

**✅ F2 — Trần hot-path phải có CỔNG ĐO, không phải lời hứa.**
Ca ghim BLOCKING-7 của #469 (`test/foundation/dashboard-scope-roundtrip.unit-spec.ts:120-126`
«nhân viên thường = 0 — KHÔNG phải 1») đếm bằng `CountingRepo.hits`, mà `hits()` **chỉ** được gọi trong
`getCompanyRoleGrantsWithScope` (`:35-38`); `getAllPermissions()` ở `:48-50` **không đếm gì** ⇒ ca đó
vẫn XANH kể cả khi ảnh chụp được nạp TRƯỚC short-circuit, tức dashboard phổ biến nhất đi 0→1 query
trong im lặng — đúng cái #469 vừa chặn. Cùng lỗ ở `permission-scope-batch.unit-spec.ts:27,43`.

⇒ CÙNG COMMIT: thêm bộ đếm `catalogHits` vào `CountingRepo` **và** `CountingScopeRepo`, rồi assert
`catalogHits === 0` trên ca `requests = []`. Không có bộ đếm này thì trần §4.3 không đo được.

---

## 5. Test (RED trước)

### 5.1 Unit — `permission-catalog-snapshot.spec.ts` (mới, không cần DB)

1–2. cặp catalog `true` ⇒ `true`; catalog `false` ⇒ `false`
3. ảnh chụp đã nạp + cặp vắng ⇒ **`false`** (D3)
4. cặp chứa `*` ⇒ `true` — cả 4 hình dạng (D4)
5. N lời gọi **tuần tự** ⇒ repo gọi **1 lần**
6. **N lời gọi ĐỒNG THỜI (`Promise.all`)** ⇒ repo gọi **1 lần** (D6 — ca #5 một mình xanh-RỖNG với bug fan-out)
7. hết TTL ⇒ nạp lần 2 (đồng hồ TIÊM, không `vi.useFakeTimers` toàn cục — memory `fake-timers-break-socketio-client-emit`)
8. refresh lỗi + có ảnh cũ ⇒ giữ giá trị cũ, không ném
9. nạp lỗi + chưa có ảnh ⇒ `true`, không ném, **và lần gọi kế tiếp vẫn thử nạp lại** (D2 không đóng dấu TTL)
10. query treo quá timeout ⇒ hành xử như lỗi nạp, không treo caller

### 5.2 Unit — `permission.decide.spec` / `permission.service.spec.ts`

11. `*:*` + `pairIsSensitive:true` ⇒ `deny-sensitive`
12. **ALLOW đối chứng**: cùng actor, `pairIsSensitive:false` ⇒ allow (chống ca deny xanh-RỖNG — `deny-cases-vacuous-without-allow-case`)
13. **ALLOW đối chứng 2**: grant EXACT + `pairIsSensitive:true` ⇒ allow
14. **✅ H2 — ca ghim không-hồi-quy `auditRequired`**: với `isSensitive:false` + `pairIsSensitive:true` + grant EXACT ⇒ `allow===true` **và `auditRequired===false`** (chứng minh mask KHÔNG thành reveal). Ca đối xứng cho object-tier ALLOW (`:82`).
15. **✅ H1 — ca ghim `needsObjectGrant`**: `isSensitive:false` + `requiresReauth:true` + `pairIsSensitive:true` ⇒ **không** `deny-object-required`
16. `canBatch` cho 11–13 ⇒ byte-identical `can()`
17. `resolveStrongestScope(s)`: `*:*` + sensitive ⇒ `null`; exact ⇒ scope

### 5.3 ✅ H5 — Sửa ca GHIM ngược, chạy qua `PermissionService` THẬT

`dashboard-widget-gate.spec.ts:32-37` `permissionOverGrants` gọi **thẳng `decideCan`**, không qua
`PermissionService`. Tiêm catalog giả vào helper đó = tự viết phép OR trong fixture rồi test chính nó
(`same-builder-twice-makes-unit-spec-vacuous`).

**Chốt:** dựng lại `permissionOverGrants` thành `new PermissionService(stubRepo)` với `stubRepo` trả
grant như cũ **và** `getAllPermissions()` trả catalog thật-thu-nhỏ có `view-line:payroll-period`
(`is_sensitive: true`). Rồi:
- ca «`*:*` ⇒ HIỆN TẠI qua được» → **đảo** thành `rejects.toThrowError("AUTH-ERR-FORBIDDEN: thiếu quyền view-line:payroll-period")`, đổi tên khối, viết lại doc-block;
- **GIỮ** 2 ca đối chứng (`*:*` mang `is_sensitive=true` ⇒ chặn; EXACT ⇒ qua).

### 5.4 Integration (LANE_DB) — `test/integration/dash-wildcard-sensitive-gate.int-spec.ts` (mới)

Fixture: role tuỳ biến giữ **DUY NHẤT** `('*','*')`; gọi `__resetCatalogSnapshotForTest()` sau seed (D7).
Tái dùng khuôn bật widget của `dashboard-payroll-cost.int-spec.ts` / `dashboard-recruit-funnel.int-spec.ts`.

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| 18 | `GET /dashboard/me` | `PAYROLL_COST` + `RECRUIT_FUNNEL` **KHÔNG có** |
| 19 | `GET /dashboard/widgets/payroll-cost` | **403**, assert **đúng mã** `AUTH-ERR-FORBIDDEN` (không dùng `.not.toBe(200)` — `allow-counter-case-not-403-lets-500-through`) |
| 20 | ✅ H3 ĐỐI CHỨNG: `NOTIFICATIONS` (`read:notification`, non-sensitive, có ở **cả** Employee lẫn Admin) | hiện + 200 |
| 21 | ĐỐI CHỨNG: actor có grant EXACT `view-line:payroll-period` @Company | hiện + 200 |
| 22 | ✅ H3 — kiểu dashboard resolve được của actor wildcard | **Employee** (`view-admin/hr/manager:dashboard` đều sensitive ⇒ mất; `view-employee:dashboard` non-sensitive ⇒ còn). Ghim tường minh: đây là **hệ quả có chủ ý**, không phải hồi quy |

✅ H3: **bỏ** ca 16 cũ (`MY_TASKS` chỉ có ở type Employee — `dashboard-widget-catalog.const.ts:584`) và
ca 18 cũ («công ty B gọi slug của A» — slug toàn cục, `getWidget` dùng `companyId` của CHÍNH caller,
`dashboard-widget-data.controller.ts:41-47` ⇒ ca vacuous).

### 5.5 ✅ B2 — Hồi quy: **≥17 file**, không phải 5

Chạy và phân loại từng file dùng grant `*:*`:

`src/auth/auth-me-capabilities.int.spec.ts:179,364,521,706,810,954,1081,1218` ·
`src/auth/auth-logs-viewer.int.spec.ts:191` · `src/permission/permission.batch.int.spec.ts:196` ·
`src/permission/permission.service.reveal.spec.ts` · `src/security-policy/security-policy.permission-contract.spec.ts` ·
`test/integration/admin-users-deny.int-spec.ts:205` · `module-registry.deny.int-spec.ts:56` ·
`platform-entitlements.deny.int-spec.ts:56` · `permission-admin.int-spec.ts:140` ·
`payroll-be1-scope.int-spec.ts:320` · **`recruit-be1-scope.int-spec.ts:686-687,702,718`** ·
`employees-salary-sensitive.int-spec.ts` · `hr-identity-read.int-spec.ts` ·
`role-member-del-oracle.int-spec.ts` · `test/foundation/audit-permission-deny.int-spec.ts:132` ·
`module-toggle-permission-deny.int-spec.ts:116` · `system-settings-permission-deny.int-spec.ts:117`

⚠️ `recruit-be1-scope.int-spec.ts:686-687` khai thẳng ca **ALLOW phụ thuộc wildcard** («Wildcard `*:*` …
VẪN mở khoá salary offer»). `manage:offer` **non-sensitive** ⇒ ca này **phải vẫn xanh**; nếu đỏ ⇒ bản vá
sai, không phải fixture sai. Ghi rõ trong PR.

**Luật phân loại đỏ (KHÔNG sửa cho xanh):** (a) ca chứng minh wildcard không mở cặp sensitive ⇒ vẫn
xanh; (b) ca dùng `*:*` chỉ để «cho actor có quyền» trên cặp **sensitive** ⇒ fixture sai, đổi sang grant
EXACT; (c) ca khẳng định wildcard MỞ được cặp **sensitive** ⇒ `tests-can-pin-a-hole-open`, đảo kỳ vọng +
ghi lý do; ✅ **(d) ca VẪN deny nhưng `reason` đổi `deny-default` → `deny-sensitive`** (§4.2 F1) ⇒ cập
nhật kỳ vọng, **KHÔNG** kết luận bản vá sai. Thiếu ô (d) là đẩy người thi công đi sửa nhầm engine.

### 5.6 Cổng coverage (memory `coverage-threshold-key-typo-is-dead-gate`)

CÙNG COMMIT: khoá `"src/permission/permission-catalog-snapshot.ts"` ≥80 cả 4 trục trong
`apps/api/vitest.config.ts` (cạnh `src/permission/permission.decide.ts:215-220`) +
`--coverage.include='src/permission/permission-catalog-snapshot.ts'` trong `test:cov:sensitive`
(`apps/api/package.json:12` — đã chạy cả thư mục `src/permission` nên spec mới tự vào run).
**Xác minh bằng cách chạy thật và ĐỌC bảng coverage có dòng file mới** — khoá gõ sai = cổng chết, im lặng.

---

## 6. ✅ M1 + F5 — `paths` của WO

ĐÃ NỚI 03/09 (trước khi viết code): thêm `apps/api/src/auth/**` (hồi quy §5.5) ·
`apps/api/vitest.config.ts` + `apps/api/package.json` (cổng coverage §5.6) · `docs/DECISIONS/**` (ADR-12).

✅ **F5 — còn thiếu `apps/api/src/security-policy/**`**: §5.5 bắt phải chạy/phân loại
`security-policy.permission-contract.spec.ts`, sửa fixture ở đó sẽ bật cảnh báo `guard-scope`.
Thêm nốt trước khi chạm file (memory `wo-paths-drive-gate-and-scheduler` — `paths` lái cả gate lẫn scheduler).

## 7. Thứ tự thi công

1. Nới `paths` (§6) · ADR `DECISIONS-12` (§3).
2. `permission-catalog-snapshot.ts` + spec §5.1 (RED → GREEN).
3. `permission.types.ts` + `permission.decide.ts` §4.2 + spec §5.2 (gồm ca ghim H1/H2).
4. Bơm vào 4 điểm `PermissionService` (§4.4).
5. §5.3 sửa ca ghim ngược.
6. §5.4 int-spec trên `LANE_DB`.
7. Chạy §5.5, phân loại đỏ theo luật (a)/(b)/(c). Chạy lại census §2.4 theo giá trị, ghi kết quả.
8. Cổng coverage §5.6.
9. Sửa doc-block SAI ở `dashboard-widget-gate.ts:31-45` + `dashboard-widget-registry.service.ts:169-176`
   (đang mô tả lỗ như nợ CÒN SỐNG).
10. `bash harness/check.sh --all --lane-db` — xanh, **không banner**.
11. `harness/backlog.mjs` → `done`. PR **KHÔNG** gắn nhãn `auto-merge` (vùng đỏ, gate FULL).

## 8. Rủi ro & chốt người

| Rủi ro | Biện pháp |
| --- | --- |
| **PROD có role giữ `*:*` ⇒ mất quyền khi deploy** | Dev = 0 hàng (§2.1). PROD không đo được từ phiên agent (`classifier-blocks-prod-db-from-agent`) ⇒ **cổng NGƯỜI**. ✅ M6: tiêu chí census KHÔNG phải «có wildcard ⇒ DỪNG» — `super-admin-bootstrap.service.ts:104-111` grant TOÀN BỘ catalog (trừ `reveal-secret:platform-account`) nên SA có thể ôm cả `*:*` mà vẫn đủ 389 cặp EXACT ⇒ không mất gì. Tiêu chí đúng: **role giữ wildcard VÀ THIẾU grant exact cho cặp sensitive nó đang với tới**. |
| Cặp sensitive seed khi API đang chạy ⇒ cửa sổ ≤300s | Chỉ nổ khi có holder wildcard (đo: 0). Migration đi kèm deploy ⇒ restart xoá ảnh chụp. D7 lo phía test. Ghi vào ADR. |
| Đổi hành vi ở module ngoài DASH (§2.3) | **Chủ đích** (done_when #4 — vá theo BỀ MẶT). §5.5 + `check.sh --all` là lưới bắt. Liệt kê đủ trong PR body. |
| Query thêm ở hot-path | Ca đếm §5.1 #5 **và** #6 (đồng thời) + giữ short-circuit `requests.length===0`. |
| ✅ M4 — FE nới rộng khoảng lệch | `use-can.ts:17-21` có fallback `caps["*:*"]`, và `getCapabilities()` vẫn publish `*:*` (lọc theo cờ HÀNG GRANT — `permission.service.ts:476,492`). Sau bản vá, actor chỉ có wildcard sẽ **thấy** màn sensitive rồi ăn 403. **Không phải lỗ mới** (đã ghi ở `use-can.ts:33-34`, và `useCanExact` là lối đúng). **DEFER TƯỜNG MINH** — 0 holder wildcard nên 0 người gặp; mở WO nối `S14-SEC-CAPWILDCARD-1` trong `harness/backlog.mjs` cùng commit. |

**Non-goal tường minh:** không đổi `SENSITIVE_CAPABILITY_ALLOWLIST` (cờ HIỂN THỊ, không phải cổng —
`sensitive-screen-gate-allowlist.spec.ts:16`) · không đổi seed/migration · không đụng
`PayrollAccessService`/`RecruitAccessService` (đã truyền cờ tường minh; `pairIsSensitive` trùng lặp vô hại) ·
không sửa `getCapabilities()` (xem M4 defer).

**Đã tự xác minh, plan-review vòng 1 nói ĐÚNG:** không consumer sản phẩm nào import `decideCan`/
`decideStrongestScope` ngoài `PermissionService` (`permission.service.ts:12-17`; hai import khác đều là
spec) ⇒ vá ở `PermissionService` + hàm thuần là ĐỦ phủ đường sản phẩm · object grant cũng
`innerJoin(permissions)` (`permission.repository.ts:218`) nên D3 nhất quán cho cả hai tầng · slug/route
§5.4 tồn tại thật · `read:dashboard` non-sensitive nên actor wildcard vẫn tới được cổng widget.

**Memory liên quan:** `permission-grant-census-must-cover-four-wildcard-shapes` ·
`sensitive-capability-allowlist-is-backend` · `asset-guards-pairs-in-two-layers` ·
`deny-cases-vacuous-without-allow-case` · `coverage-threshold-key-typo-is-dead-gate` ·
`tests-can-pin-a-hole-open` · `same-builder-twice-makes-unit-spec-vacuous` ·
`prod-api-boots-without-db-until-login` · `classifier-blocks-prod-db-from-agent` ·
`wo-paths-drive-gate-and-scheduler` · `allow-counter-case-not-403-lets-500-through`.
