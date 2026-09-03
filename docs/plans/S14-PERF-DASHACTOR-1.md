# S14-PERF-DASHACTOR-1 — gộp `gateOrThrow` + cắt round-trip scope (micro-plan)

> Work Order: `harness/backlog.mjs` → `S14-PERF-DASHACTOR-1`. Nợ ghi lại từ `S12-RECRUIT-DASH-1`
> (`harness/handoff.md` 31/08: «`gateOrThrow` trùng 3 bản» + «`resolveActor` đốt 4 round-trip
> `getCompanyRoleGrantsWithScope` uncached mỗi `summary()`»). Sau `S13-PAYROLL-DASH-1` là **4 bản**.
>
> **Bản v2 — đã qua plan-reviewer vòng 1 (03/09, verdict REVISE, 7 BLOCKING).** Từng mục sửa ghim ở §7.

## 1. Đo hiện trạng (grep 03/09, không phải trí nhớ)

### 1a. `gateOrThrow` — 4 bản BYTE-GIỐNG NHAU

| file | dòng | comment tự khai |
| --- | --- | --- |
| `dashboard-widget-handlers.service.ts` | 127 | (bản gốc) |
| `dashboard-widget-office.handlers.ts` | 50 | «mirror DashboardWidgetHandlersService.gateOrThrow» |
| `dashboard-widget-recruit.handlers.ts` | 44 | «mirror DashboardWidgetOfficeHandlers.gateOrThrow» |
| `dashboard-widget-payroll.handlers.ts` | 55 | «mirror DashboardWidgetRecruitHandlers.gateOrThrow» |

Chuỗi «mirror của mirror của mirror» — mỗi bản chỉ chứng nhận bản LIỀN TRƯỚC, không ai chứng nhận
bản gốc. Thân hàm hiện giống hệt nhau đến từng ký tự (đã diff).

### 1b. Round-trip `getCompanyRoleGrantsWithScope` — KHÔNG cache

`permission.cache.ts:95` là **passthrough có chủ ý** (doc-block: «scopes chỉ dùng cho /auth/me
bootstrap, ít gọi»). Giả định đó **đã sai từ lâu**: `DataScopeService.resolveAndAssert` /
`resolveOrNull` — dùng ở 25+ file — đi qua `resolveStrongestScope` → chính method này. Mỗi lời gọi
= 1 query DB (`withTenant` + 3 JOIN).

Đếm cho MỘT lượt xem dashboard đủ 4 widget (mỗi ô = số query `getCompanyRoleGrantsWithScope`):

| đường | trước |
| --- | --- |
| `GET /dashboard/me` → `filterByGatePair` (3 widget khai sàn: ASSET_SUMMARY · RECRUIT_FUNNEL · PAYROLL_COST) | **3** |
| `asset-summary/data` → gate 1 + `AssetsService.summary` → `resolveActorScope` 1 | **2** |
| `recruit-funnel/data` → gate 1 + `CandidatesService.summary` → `RecruitAccessService.resolveActor` **4** | **5** |
| `payroll-cost/data` → gate 1 + `PayrollAccessService.resolveActor` 1 | **2** |
| `room-today/data` → gate 0 (không khai sàn) + `RoomAccessService` | (ngoài diện WO) |
| **TỔNG 4 đường trên** | **12** |

`RecruitAccessService.resolveActor` (`recruit-access.service.ts:31`) là chỗ nặng nhất: 1
`resolveAndAssert` + 3 `resolveOrNull` trong `Promise.all` (`view:interview` · `update:candidate`
sensitive · `manage:offer`) = **4 query cùng (userId, companyId), cùng tập hàng**.

## 2. Quyết định — batch ở tầng DECIDE, KHÔNG cache thêm

**KHÔNG** cache `getCompanyRoleGrantsWithScope` vào Valkey. Lý do: đó là bề mặt QUYẾT ĐỊNH QUYỀN có
vòng invalidation riêng (`invalidateUser` DEL đúng MỘT khoá; doc-block cảnh báo «lệch một chữ giữa
hai đường là grant CŨ sống tới hết TTL 300s, im lặng = leo thang quyền»). Thêm khoá thứ hai là thêm
một đường có thể lệch — đổi một vấn đề hiệu năng lấy một vấn đề an ninh.

**Thay vào đó**: mirror ĐÚNG khuôn `can()` / `canBatch()` đã có sẵn trong repo (`HR-PERF-1`):
_fetch một lần → decide N lần bằng MỘT hàm thuần dùng chung_. Không có trạng thái sống qua request,
không TTL, không invalidation ⇒ **0 bề mặt staleness mới**.

| có sẵn | thêm (mirror 1-1) |
| --- | --- |
| `decideCan(grants, objectGrants, input, now)` (`permission.decide.ts`) | `decideStrongestScope(grants, request, now)` |
| `can()` = 1 fetch + 1 decide | `resolveStrongestScope()` = 1 fetch + 1 decide (**thân hàm chuyển nguyên xi**) |
| `canBatch()` = 1 fetch + N decide, catch fail-closed TOÀN LƯỢT | `resolveStrongestScopes()` = 1 fetch + N decide, catch fail-closed TOÀN LƯỢT (`null` = deny) |

### 2a. HÌNH DẠNG TRẢ VỀ — MẢNG THEO CHỈ SỐ, **KHÔNG Map** (BLOCKING 1+2)

`resolveStrongestScopes(...)` trả `Promise<(DataScope | null)[]>` **cùng độ dài, cùng thứ tự với
`requests`**. KHÔNG `Map`, KHÔNG `.get()`.

Vì sao đây là điều kiện an toàn chứ không phải sở thích: `Map.get()` trả `DataScope | null |
**undefined**`. Hai người gọi ở `recruit-access.service.ts:66-67` viết
`canSeeCandidatePii: candidateUpdateScope !== null` và `canSeeSalary: offerManageScope !== null` —
với `undefined` thì `!== null` là **true** ⇒ **mở khoá PII ứng viên + lương offer**. Và typecheck
KHÔNG bắt được (khác `routeScope`/`interviewViewScope` vốn typed ở `recruit.types.ts:30,34`).
Một map-miss (khoá gõ sai, cặp trùng bị đè) biến deny thành allow trong im lặng.

Mảng-theo-chỉ-số cũng xoá luôn bài toán **đụng độ khoá**: hôm nay `routeKey='candidateUpdate'` và
cờ phụ `update:candidate` là CÙNG cặp; nếu khoá map là `action:resourceType` thì hai request khác
`isSensitive` đè nhau, và bản **không-sensitive (lỏng hơn)** có thể đè bản sensitive ⇒ `*:*` mở khoá
cặp sensitive ở tầng-2 = leo thang im lặng. Với mảng, mỗi request có ô riêng — không có gì để đè.

Nhánh `catch` phải điền **đủ độ dài** mảng bằng `null` (`requests.map(() => null)`), KHÔNG trả mảng
rỗng — mảng rỗng làm mọi `result[i]` thành `undefined`, tức lại đúng cái lỗ trên.

**CẤM tường minh** mẫu `<kết quả batch>.get(...) !== null` ở mọi caller.

## 3. Việc làm

### 3.1 `apps/api/src/permission/permission.decide.ts` (thêm hàm thuần)

`decideStrongestScope(rawGrants, req, now): DataScope | null` với
`req = { action, resourceType, isSensitive? }` — thân hàm **chuyển nguyên văn** từ
`permission.service.ts:630` sau lệnh fetch (5 bước PIN đã ghi ở JSDoc: DENY-override wildcard-aware
→ không nâng cấp scope → sensitive chỉ EXACT → EXACT > WILDCARD → mạnh nhất). Hằng `SCOPE_STRENGTH`
/ `normalizeScope` chuyển theo. NEVER throws (như `decideCan`).

**Export công khai + đánh dấu internal**: JSDoc ghi rõ «hàm này KHÔNG fail-closed — người gọi sở
hữu try/catch», mirror doc-block `permission.decide.ts:19`. Gọi thẳng mà không bọc = mất vỏ
fail-closed của `resolveStrongestScope`.

### 3.2 `apps/api/src/permission/permission.service.ts`

- `resolveStrongestScope` → `fetch + decideStrongestScope` (giữ nguyên chữ ký, JSDoc, try/catch
  fail-closed `null`). **0 thay đổi hành vi** — đây là điều kiện để mọi spec cũ giữ nguyên kết quả.
- `resolveStrongestScopes(userId, companyId, requests)` MỚI → `(DataScope|null)[]` (§2a), 1 fetch.
  - **Short-circuit `requests.length === 0` ⇒ trả `[]` TRƯỚC khi fetch** (mirror `canBatch`
    `permission.service.ts:383`). Không có nó, §3.6 đẻ round-trip 0→1 cho nhân viên thường.
  - Catch = fail-closed TOÀN LƯỢT (mọi phần tử `null`), mirror `canBatch` — KHÔNG partial.
  - Log fail-closed phải mang **TOÀN BỘ danh sách cặp** trong payload (bản đơn log kèm
    `action`/`resourceType` ở `:683-689`; bản batch log MỘT lần ⇒ thiếu danh sách là mất dấu vết
    deny — luật quan sát `lock-observability-rule`).

### 3.3 `apps/api/src/permission/data-scope.service.ts`

`resolveManyOrNull(userId, companyId, requests): Promise<(DataScope|null)[]>` — passthrough mỏng,
mirror `resolveOrNull` (KHÔNG ném; người gọi tự xử `null`). Không đụng `resolveAndAssert` /
`resolveOrNull`.

Doc-block phải mang **cảnh báo tương đương `resolveOrNull` (`data-scope.service.ts:86-99`)**: đây là
hàm KHÔNG-ném, đừng dùng cho route mà cặp gate = cặp bound trừ khi assert TAY ngay sau đó.

### 3.4 `apps/api/src/recruit/recruit-access.service.ts` — 4 → 1

Gộp cặp route + 3 cờ phụ vào MỘT `resolveManyOrNull`, đọc kết quả **theo chỉ số** (`[0]`=route,
`[1]`=`view:interview`, `[2]`=`update:candidate`, `[3]`=`manage:offer`). Ba điểm KHÔNG được mất:

1. **`isSensitive` per-pair đi theo TỪNG request** — `update:candidate` `true` (thiếu cờ ⇒ wildcard
   `*:*` mở khoá PII), `manage:offer` `false`, `view:interview` không khai (giữ `undefined` y như
   hôm nay), cặp route lấy `RECRUIT_ROUTE_PAIRS[routeKey].isSensitive`.
2. **403 của cặp route vẫn phải ném** — `resolveManyOrNull` không ném, nên sau khi lấy mảng phải
   assert TAY: `routeScope == null` ⇒ `ForbiddenException` với **đúng thông điệp cũ**
   (`AUTH-ERR-FORBIDDEN: out of permission scope`, do `resolveAndAssert` ném). Sàn Company
   (`companyFloor`) giữ nguyên thứ tự: assert cặp TRƯỚC, sàn SAU.
3. ⚠️ **Ghi chú thứ tự**: hôm nay `resolveAndAssert` `await` xong TRƯỚC `Promise.all`, nên deny cặp
   route ném trước khi 3 cờ phụ chạy. Bản gộp fetch 1 lần rồi decide cả 4 ⇒ 3 cờ phụ được TÍNH ngay
   cả khi cặp route deny. Vô hại (thuần in-memory, 0 side-effect, vẫn ném trước khi trả) nhưng ghi
   ra để không ai tưởng là rò.

### 3.5 `apps/api/src/dashboard/dashboard-widget-gate.ts` (MỚI) — 1 bản `gateOrThrow`

Hàm thuần `gateWidgetOrThrow(permission, user, widgetCode): Promise<EnginePair>` — thân hàm y
nguyên bản gốc, **KHÔNG thêm/bớt tham số nào** (xem §3.5b). 4 file handler `import` và gọi; xoá 4
bản private.

**KHÔNG gộp** `meetsMinDataScope` / hằng sàn / `WidgetCacheIdentity` của từng widget: sàn Company
của ASSET/RECRUIT/PAYROLL **cùng giá trị nhưng KHÁC LÝ DO** (ASSET: `view:asset@Own` của nhân viên
thường · RECRUIT: `summaryTx` đếm toàn company · PAYROLL: `latestSummaryTx` SUM toàn company). Gộp
code gate ≠ gộp hằng sàn (`done_when` #1).

**KHÔNG đụng** `gate ⊥ fetch`: `gateWidgetOrThrow` chỉ được gọi từ `gateAndResolve`, không bao giờ
từ `fetch` — đúng bất biến ghi ở `dashboard-widget-handlers.service.ts:77`.
**CẤM** chuyền `scope` đã resolve từ `gateAssetSummary` sang `fetchAssetSummary` để "tiết kiệm 1
round-trip": `fetch` KHÔNG chạy khi cache hit ⇒ dựng lại đúng lỗ
`widget-cache-hit-skips-audit-trail`.

Trần 800 dòng KHÔNG bị đụng: `dashboard-widget-handlers.service.ts` = 789 dòng và **giảm** sau khi
bỏ `gateOrThrow`; file mới nhỏ.

### 3.5b. `isSensitive` ở tầng gate — GIỮ NGUYÊN, ghi thành nợ (BLOCKING 4)

4 bản `gateOrThrow` hiện gọi `can()` **KHÔNG truyền `isSensitive`**, kèm comment khẳng định «engine
tự ép effectivelySensitive = input OR grant.isSensitive ⇒ cặp nguồn is_sensitive=true vẫn
exact-match, wildcard KHÔNG lọt».

**Câu đó chỉ đúng một nửa.** `permission.decide.ts:98-118`:
`effectivelySensitive = isSensitive || companyAllows.some(g => g.isSensitive)` — `companyAllows` là
các hàng grant KHỚP, nên `is_sensitive` được đọc là của **hàng `*:*`**, KHÔNG phải của cặp đích. Một
hàng `*:*` với `is_sensitive=false` ⇒ `effectivelySensitive=false` ⇒ **wildcard QUA được gate**.
Cùng lỗ ở tầng sàn scope (`resolveStrongestScope` không được truyền cờ ở đường dashboard).

Hôm nay chưa nổ: mig `0565:463-479` census fail-closed khẳng định KHÔNG role seed nào giữ wildcard,
và 2 role tuỳ biến PROD đã bị thu hồi ở `S14-PROD-PAYROLLGRANT-1`. Tầng-2 (service nguồn) vẫn an
toàn vì `PayrollAccessService`/`RecruitAccessService` truyền cờ TƯỜNG MINH.

**Quyết định cho WO này: KHÔNG sửa.** Thêm `isSensitive:true` vào `gateWidgetOrThrow` là đổi hành vi
quyền thật (403 cho mọi actor cầm wildcard trên RECRUIT_FUNNEL/PAYROLL_COST) — việc đó cần deny-path
riêng, không phải phụ phẩm của một WO perf. Thay vào đó:

- Test §5 **ghim hành vi HIỆN TẠI của tầng gate** (wildcard-only + `is_sensitive=false` ⇒ ALLOW) để
  refactor không âm thầm đổi nó theo chiều nào cả;
- `done_when` #3 («ghim bản gộp KHÔNG cho wildcard qua cặp sensitive») thực thi ở **tầng scope
  resolver** — nơi cờ ĐƯỢC truyền và cũng là nơi code mới của WO nằm;
- Sửa comment sai ở 4 chỗ thành câu ĐÚNG + seed WO nợ `S14-SEC-DASHGATE-WILDCARD-1`.

### 3.6 `apps/api/src/dashboard/dashboard-widget-registry.service.ts` — 3 → 1 (và 0 vẫn là 0)

`filterByGatePair`: gom cặp của MỌI widget **đã qua `can()` VÀ có khai sàn** thành MỘT
`resolveManyOrNull` sau vòng `can()`. Nhờ short-circuit §3.2, danh sách rỗng ⇒ **0 query** —
giữ nguyên tính chất ghi ở comment `:195-196` («đa số không khai ⇒ không tốn round-trip thứ hai»).
Không có nó, dashboard nhân viên thường đi từ **0 → 1**.

Hành vi fail-closed từng widget giữ nguyên: thiếu entry ⇒ loại + `log.warn`; `null` ⇒
`meetsMinDataScope` false ⇒ loại. **KHÔNG throw** làm sập cả dashboard.

### 3.7 Cổng coverage — `permission.decide.ts` phải VÀO cổng (BLOCKING 6)

`vitest.config.ts:201-206` ghim `src/permission/permission.service.ts` ≥80%, cưỡng chế bởi
`test:cov:sensitive` (`package.json:12`). `permission.decide.ts` hiện **không có khoá threshold và
không nằm trong bất kỳ `--coverage.include` nào** — `decideCan` đã ở ngoài cổng từ `HR-PERF-1`.
Chuyển thân quyết định scope sang đó mà không vá là đào sâu lỗ (họ
`coverage-threshold-key-typo-is-dead-gate`). CÙNG commit:

- thêm khoá threshold `src/permission/permission.decide.ts` ≥80% mọi trục;
- thêm `--coverage.include='src/permission/permission.decide.ts'` vào `test:cov:sensitive`;
- thêm spec mới vào danh sách file của `test:cov:sensitive` (nếu không, nó không chạy trong lượt đo).

### 3.8 Neo comment sẽ trôi — sửa cùng lượt

`dashboard-widget-catalog.const.ts:417-421` ghim «permission.service.ts:16-22» cho `SCOPE_STRENGTH` ·
`permission.service.ts:661` ghim «mirror can() (:124-131)» · `dashboard-widget-registry.service.ts:171-172`
ghim «permission.service.ts:206». Cả 3 trỏ vào đoạn sắp dời.

## 4. Đo — SỐ THẬT (spy `toHaveBeenCalledTimes`, đã chạy 03/09)

Spy trên `IPermissionRepository.getCompanyRoleGrantsWithScope` — tầng repo, **dưới** passthrough
cache ⇒ mỗi lượt đếm được = một query DB thật. Spec:
`apps/api/test/foundation/dashboard-scope-roundtrip.unit-spec.ts` (6 ca, **XANH**). Ca «TRƯỚC» tái
dựng nguyên văn hình dạng cũ bằng `resolveOrNull` lẻ, nên nếu bản gộp tuột về hình dạng cũ thì
trước == sau và spec ĐỎ.

| ca | đường | trước | sau | ghim ở |
| --- | --- | --- | --- | --- |
| admin, 3 widget khai sàn | `GET /dashboard/me` | **3** | **1** | ✅ đo |
| nhân viên thường, 0 widget khai sàn | `GET /dashboard/me` | 0 | **0** | ✅ đo (short-circuit) |
| `can()` deny cả 3 widget khai sàn | `GET /dashboard/me` | 0 | **0** | ✅ đo (cùng ca rỗng) |
| RECRUIT_FUNNEL — `resolveActor` | `recruit-funnel/data` | **4** | **1** | ✅ đo |
| RECRUIT_FUNNEL — cả đường (gate 1 + actor) | `recruit-funnel/data` | 5 | **2** | suy từ 2 số trên |
| ASSET_SUMMARY (gate 1 + `resolveActorScope` 1) | `asset-summary/data` | 2 | 2 | không đổi (non-goal) |
| PAYROLL_COST (gate 1 + `resolveActor` 1) | `payroll-cost/data` | 2 | 2 | không đổi (non-goal §8) |
| ROOM_TODAY (không khai sàn) | `room-today/data` | 0 | 0 | không đổi |
| **TỔNG — admin mở dashboard đủ 4 widget** | | **12** | **7** | **−42%** |

Ngoài dashboard, `RecruitAccessService.resolveActor` đứng đầu **mọi** method của module RECRUIT
(`candidates` · `interviews` · `job-openings` · `offers` — 30+ call-site), nên mức cắt 4→1 áp cho
toàn module chứ không riêng widget.

## 5. Test (RED trước)

### 5.1 `apps/api/test/foundation/permission-scope-batch.unit-spec.ts` (MỚI)

1. **Ma trận LITERAL** — mở rộng đúng 8 ca của `data-scope.service.spec.ts:83-150` qua API batch,
   assert **giá trị literal** (`'Department'` · `null` · `'Team'` · `'Company'` …).
   ⚠️ KHÔNG assert «batch === single»: sau §3.2 `resolveStrongestScope` GỌI CHÍNH
   `decideStrongestScope`, nên so hai thứ đó là so một hàm với chính nó (memory
   `same-builder-twice-makes-unit-spec-vacuous`).
2. **Wildcard KHÔNG qua cặp sensitive** (`done_when` #3, tầng resolver): grant `*:*@Company` +
   request `isSensitive:true` ⇒ `null`; **kèm ca ALLOW đối chứng** (grant exact ⇒ `'Company'`) để ca
   DENY không xanh-RỖNG (memory `deny-cases-vacuous-without-allow-case`).
3. **Đếm round-trip**: spy repo — batch N cặp = **đúng 1** lời gọi (`toHaveBeenCalledTimes(1)`,
   KHÔNG `≤N`). Thêm ca `requests=[]` ⇒ **0** lời gọi (§3.2 short-circuit).
4. **Fail-closed toàn lượt**: repo ném ⇒ mảng **đủ độ dài**, MỌI phần tử `null` (không phần tử nào
   `undefined`, không mảng rỗng).
5. **Hai request CÙNG cặp khác `isSensitive`** ⇒ hai kết quả RIÊNG theo chỉ số (ghim §2a).

### 5.2 `apps/api/src/recruit/recruit-access.service.spec.ts` (MỚI, mock `DataScopeService`)

- `routeScope=null` ⇒ ném `ForbiddenException` đúng chuỗi `AUTH-ERR-FORBIDDEN: out of permission scope`;
- `companyFloor` + scope hẹp ⇒ `AUTH-ERR-SCOPE-DENIED` (thứ tự: cặp trước, sàn sau);
- phần tử cờ phụ `null` ⇒ `canSeeCandidatePii=false` / `canSeeSalary=false` (ghim BLOCKING 1);
- `isSensitive` per-request truyền đúng: assert đối số thực của `resolveManyOrNull`.

Lý do cần spec riêng: census 2 tầng `recruit-two-layer-guard-census.unit-spec.ts:81-106` chỉ quét
**call-site** `resolveActor(expr,"key")`, KHÔNG đọc thân hàm ⇒ mất assert bên trong vẫn XANH.

### 5.3 `apps/api/src/dashboard/dashboard-widget-gate.spec.ts` (MỚI)

deny ⇒ 403 · thiếu cặp gate ⇒ 403 `DASH-ERR` · allow ⇒ trả đúng `EnginePair` · **ghim hành vi hiện
tại** với grant `*:*` `is_sensitive=false` ⇒ ALLOW (§3.5b — ghim để refactor không đổi ngầm, kèm
comment trỏ WO nợ).

### 5.4 Regression giữ nguyên số ca + kết quả

`data-scope.service.spec` · `data-scope.service.coverage.spec` · `permission.service.spec` ·
`permission.coverage.spec` · `dashboard-office-widgets` · `dashboard-recruit-funnel` ·
`dashboard-payroll-cost` · `dashboard-widget-security` · `dashboard-widget-catalog2-security` ·
`recruit-be1-scope` · `recruit-two-layer-guard-census`.

## 6. Zone — ESCALATE green → 🔴 + gate FULL

Backlog seed `zone:'green'`, `paths` **đo thiếu**: cắt round-trip không nằm trong
`recruit/`+`payroll/`+`dashboard/`, nó ở `apps/api/src/permission/**` (bẫy
`wo-layer-field-can-understate-scope`).

`pickReviewers` (`.claude/workflows/parallel-lanes.mjs:126-142`) đọc **duy nhất `L.task` + `L.gate`**
— `paths` KHÔNG vào (nó chỉ nâng model qua `pathsTouchRed`). Tiêu đề WO không chứa từ khoá
`DOMAIN.sec` ⇒ nếu chỉ sửa `paths`, reviewers = `typescript-reviewer` baseline. Vậy `harness/backlog.mjs`
phải sửa **cả ba**:

- `zone: 'red'` (đang `'green'` ⇒ đủ điều kiện auto-merge theo `harness/policy.md`);
- `gate: 'FULL'` (bật `security-reviewer` + `silent-failure-hunter`);
- `paths` **thêm** `apps/api/src/permission/**` + `apps/api/vitest.config.ts` + `apps/api/package.json`;
  **bỏ** `apps/api/src/payroll/**` (non-goal §8 — paths lái gate + scheduler).

**KHÔNG gắn nhãn `auto-merge`** — người chốt.

Verify: `bash harness/check.sh --all` (CLAUDE.md §9.5 vùng đỏ), không chỉ `--lane-db`.

## 7. Ghim plan-reviewer vòng 1 (03/09) — 7 BLOCKING đã xử

| # | Phát hiện | Xử ở |
| --- | --- | --- |
| 1 | `Map.get()` → `undefined` ⇒ `!== null` true ⇒ mở khoá PII/lương, typecheck không bắt | §2a — mảng theo chỉ số |
| 2 | Plan tự mâu thuẫn: khoá map gộp trùng, "xử ở tầng người gọi" là bất khả | §2a — bỏ Map hẳn |
| 3 | Ca «tương đương» = so hàm với chính nó; `permission.scopes.spec` KHÔNG test `resolveStrongestScope` | §5.1 ca 1 — ma trận literal từ `data-scope.service.spec:83-150` |
| 4 | Ca wildcard ở tầng gate sẽ ĐỎ hoặc ép đổi hành vi quyền thật | §3.5b + §5.1 ca 2 + §5.3 |
| 5 | `pickReviewers` không đọc `paths` ⇒ FULL gate không bao giờ chạy | §6 — `zone`+`gate`+`paths` |
| 6 | `permission.decide.ts` ngoài mọi `--coverage.include`/threshold | §3.7 |
| 7 | §3.6 đẻ round-trip 0→1 cho nhân viên thường | §3.2 short-circuit + §4 thêm 2 hàng ca |

Cảnh báo đã nhận: doc-block `resolveManyOrNull` (§3.3) · spec riêng cho `resolveActor` (§5.2) ·
CẤM chuyền scope gate→fetch (§3.5) · 3 neo comment trôi (§3.8) · log batch mang đủ danh sách cặp
(§3.2) · verify `--all` (§6) · `decideStrongestScope` export + đánh dấu internal (§3.1).

## 7a. Bằng chứng «chuyển nguyên xi» (không phải lời hứa)

So cơ học thân quyết định cũ (`git show HEAD:apps/api/src/permission/permission.service.ts`, từ
`const matches = (grant…` đến `return best;`) với `decideStrongestScope` mới, sau khi chuẩn hoá
khoảng trắng + đổi tên biến `opts?.isSensitive` → `isSensitive` (destructure từ `req`):

> **Khác biệt DUY NHẤT = một dấu `}`** (khối `try` cũ vs thân hàm mới). Mọi nhánh — DENY-override
> wildcard-aware, lọc `isGrantActive`, `isExact`, `effectivelySensitive`, EXACT>WILDCARD,
> `SCOPE_STRENGTH` không nâng cấp — giữ nguyên từng ký tự.

Vỏ fail-closed (`try/catch` → `null`) ở lại `PermissionService`, KHÔNG chuyển vào hàm thuần —
mirror `decideCan` (`permission.decide.ts:19`: «This function NEVER throws — the caller owns
fail-closed error handling around the fetch»).

## 7b. Phát hiện MỚI trong lúc code — lỗ wildcard ở tầng gate (đã seed WO riêng)

Ca ghim ở `dashboard-widget-gate.spec.ts` **chạy engine THẬT** (`decideCan`) và đo được:

| grant DUY NHẤT của actor | `gateWidgetOrThrow(..., 'PAYROLL_COST')` |
| --- | --- |
| `('*','*')` với `is_sensitive = false` | ✅ **RESOLVE** — wildcard QUA được cặp sensitive |
| `('*','*')` với `is_sensitive = true` | ❌ 403 |
| `('view-line','payroll-period')` exact | ✅ resolve (đúng như mong đợi) |

Tức câu «wildcard KHÔNG lọt» lặp ở cả 4 bản `gateOrThrow` cũ là **SAI**: `decideCan` đọc
`is_sensitive` của **hàng grant KHỚP** (hàng `*:*`), không phải của **cặp đích**.

Chưa nổ ngoài thực địa (mig 0565 §6.7 census 0 role seed giữ wildcard · 2 role tuỳ biến PROD đã thu
hồi ở `S14-PROD-PAYROLLGRANT-1` · tầng-2 service nguồn truyền cờ tường minh nên đường DỮ LIỆU kín) —
hở là đường METADATA `/dashboard/me` + gọi thẳng slug.

**KHÔNG vá trong WO perf này** (§3.5b). Đã: sửa comment sai ở 4 chỗ · ghim hành vi hiện tại bằng
test (kèm 2 ca đối chứng chứng minh cơ chế sensitive vẫn sống) · seed
**`S14-SEC-DASHGATE-WILDCARD-1`** (🔴 red · gate FULL · `depends_on: S14-PERF-DASHACTOR-1`).

## 8. Non-goal (ghi tường minh để phiên sau không "làm nốt cho đều")

- **`PayrollAccessService`** — chỉ có ĐÚNG 1 lời gọi `resolveAndAssert` (`:49-55`), không có gì để
  gộp; sửa = rủi ro thuần trên đường tiền. `apps/api/src/payroll/**` gỡ khỏi `paths`.
- **`RoomAccessService`** (9 call-site) — `rooms/**` ngoài `paths` WO.
- **Cache `getCompanyRoleGrantsWithScope`** — §2, đổi vấn đề hiệu năng lấy vấn đề an ninh.
- **Siết `isSensitive` ở tầng gate dashboard** — §3.5b, thành WO nợ riêng.
