# S14-SEC-CAPWILDCARD-1 — `capabilities` phản chiếu quyết định của `can()` ở tầng công ty

> Zone 🔴 red · gate FULL · depends_on `S14-SEC-DASHGATE-WILDCARD-1` (merged `092fc6e7` / PR #476).
> **ADR nền: `docs/DECISIONS/DECISIONS-13_Capabilities_Mirror_Company_Tier_Decision.md`** (đảo
> `S2-AUTH-BE-5`, owner chốt 05/09) · `DECISIONS-12` (cờ sensitive theo CẶP ĐÍCH).
>
> ## Trạng thái: **THIẾT KẾ ĐÃ CHỐT — CHƯA CÓ DÒNG CODE NÀO**
>
> Owner chốt 05/09: dừng sau ADR + plan, không code trong phiên này (cổng chi phí). Plan này là **tài
> liệu thi công**: phiên sau code thẳng từ §9/§14, **không cần plan-review lại** trừ khi đổi thiết kế.
>
> | Vòng                                             | Verdict                                               | Còn lại           |
> | ------------------------------------------------ | ----------------------------------------------------- | ----------------- |
> | v1 (khai triển wildcard, GIỮ luật lọc sensitive) | plan-review **BLOCK** 6 mục + census bác giả định nền | bỏ hẳn            |
> | v2 (caps == `can()`, gồm sensitive)              | plan-review **BLOCK** 6 mục (B1–B6) + 7 cảnh báo      | vá hết ở v3       |
> | **v3 (bản này)**                                 | vá B1–B6 + W1–W8; ADR đã viết                         | **sẵn sàng code** |
>
> **Hoàn tác**: không migration, không seed, không feature-flag ⇒ rollback = `git revert`.

---

## 1. Hai lỗ — và lỗ lớn hơn không phải lỗ WO được giao

### 1.1 Lỗ được giao (wildcard)

`getCapabilities` (`permission.service.ts:589-612`) lọc `!g.isSensitive` — cờ của **HÀNG GRANT KHỚP**.
Với grant `('*','*')`, hàng khớp mang `is_sensitive=false` ⇒ sống sót ⇒ `caps["*:*"] = true`. FE
`use-can.ts:16-22` rơi xuống khoá đó ⇒ thấy màn sensitive rồi **ăn 403** (engine đã kín sau
`DECISIONS-12`). Đây là bản cài đặt **thứ tư** của luật sensitive, trôi khỏi ba bản ADR-12 §2 vừa hội tụ.

### 1.2 Lỗ lớn hơn (allowlist) — và nó đang gây hại NGAY BÂY GIỜ

Cùng vế đó cũng xoá mọi cặp sensitive actor giữ bằng grant **EXACT** — tức grant `can()` **CHO PHÉP**.
Bù bằng `SENSITIVE_CAPABILITY_ALLOWLIST` (69 chuỗi literal viết tay). Danh sách tay luôn thiếu, và
thiếu **im lặng**. Lý lẽ đầy đủ + đánh đổi: **`DECISIONS-13` §1–§2** (đọc trước khi review).

**Số đo, không phải lý thuyết** — câu Q4 của census chạy trên DB dev 05/09: **71 cặp** sensitive ngoài
allowlist đang có actor giữ grant exact. Sáu cặp đầu chạm **49 actor**:

| Cặp                                                                          | Actor |
| ---------------------------------------------------------------------------- | ----- |
| `view:leave-file` · `upload:leave-file` · `delete:leave-file`                | 49    |
| `view-detail:attendance` · `view-own:adjustment` · `view-own:remote-request` | 49    |

⇒ Đây là **màn tự-phục-vụ của chính nhân viên** (`view-own:*`) đang bị giấu khỏi họ. WO này không phải
hardening phòng xa — nó gỡ một thứ đang hỏng, cho 49 người trên dev.

---

## 2. Trạng thái PROD — giả định "nợ SẠCH" đã BỊ BÁC

| Nguồn                                                                                   | Nội dung                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| memory `superadmin-not-a-canonical-role` — đo THẬT trên PROD **2026-08-02**, chỉ SELECT | PROD **không có** role `super-admin`. Role quyền cao thật là **`SA`** — company-scoped, **10 user**, giữ **379/379** cặp catalog gồm **128/128** cặp `is_sensitive`, và "SA có `*:*` **và** mọi cặp catalog". |
| `migrations/0569_…sql:167-168` (viết dựa trên dump PROD)                                | "Catalog **CÓ** cặp `('*','*')` ⇒ vế wildcard không neo sẽ RAISE trên mọi DB đã bootstrap. (DB dev hiện chưa bootstrap nên bẫy này KHÔNG lộ ra khi thử local.)"                                               |

### 2.1 Vì sao dev đo ra 0 mà không kết luận được "PROD = 0"

| DB                                                  | pairs   | sensitive | hàng wildcard                   |
| --------------------------------------------------- | ------- | --------- | ------------------------------- |
| `mediaos` (dev dùng chung)                          | 390     | 139       | **1** (`*:*`, `is_sensitive=f`) |
| `mediaos_capwildcard` (dựng **thuần từ migration**) | **389** | **140**   | **0**                           |

Diff: `mediaos` **thừa** `*|*|false` + `view|employee|false`, **thiếu** `upload|candidate-file|true`.
⇒ **KHÔNG migration nào seed hàng `('*','*')`** (grep `apps/api/migrations/*.sql`: 0 INSERT); hai hàng
thừa là **fixture int-spec đóng dấu vào catalog GLOBAL** (`test-fixture-stamps-global-permission-catalog`).
Con số "0 actor giữ wildcard" trên dev bằng 0 vì dev **chưa bootstrap SA**, không vì hệ sạch.

⚠️ Cả hai nguồn là **ảnh CŨ** (02/08; catalog khi đó 379). Đủ để **bác** "PROD = 0", **không** đủ thay
số hiện tại ⇒ census PROD vẫn là cổng §12.

---

## 3. Hợp đồng mới

Phát biểu chuẩn nằm ở **`DECISIONS-13` §4**. Nhắc lại gọn:

> `capabilities[k] === true` ⟺ `k ∉ EXCLUDED` ∧ `can()` ALLOW `k` ở **tầng CÔNG TY** cho call-site
> **không khai** `requiresReauth`/`objectGrantRequired`. Và **`k` KHÔNG BAO GIỜ chứa `*`**.

`EXCLUDED` = lớp reveal/step-up (`DECISIONS-13` §4.1) — **bắt buộc**, xem §4.2.

---

## 4. Thuật toán — MỘT luật, HAI nguồn cặp

### 4.1 Định lý cặp-đích (plan-review đã xác minh ở tầng DDL)

`migrations/0005_permissions.sql:61` là `CONSTRAINT … UNIQUE (action, resource_type)` **toàn phần**
(không partial); `permissions` **không có** `deleted_at` ⇒ mỗi cặp đúng một cờ. `getCompanyRoleGrants`
lấy cờ từ **chính hàng được grant** (`permission.repository.ts:33`, innerJoin `:41`) ⇒ với grant
**EXACT**, cờ hàng-grant **CHÍNH LÀ** cờ cặp đích.

⇒ Grant EXACT **không cần catalog**. Đó là chốt của §4.3.

> **Modulo cache:** `permission.cache.ts:52-89` phục vụ hàng grant kèm `isSensitive` từ Valkey tới 300s.
> Vô hại ở đây: cặp sensitive đi qua nhờ **có ALLOW exact**, không nhờ giá trị cờ.

### 4.2 Luật (vá B1 — vế `EXCLUDED`)

```text
caps = { "a:t" : (a,t) ∈ P
                 ∧ (a,t) ∉ EXCLUDED                       ← B1: lớp reveal/step-up
                 ∧ ¬denied(a,t)
                 ∧ ( ¬sensitive(a,t) ∨ hasExactAllow(a,t) ) }

P              = { cặp của grant ALLOW EXACT } ∪ { cặp catalog khớp bởi grant ALLOW WILDCARD }
denied(a,t)    = ∃ grant DENY còn hiệu lực g: matches(g,a,t)
matches(g,a,t) = (g.action = a ∨ g.action = '*') ∧ (g.resourceType = t ∨ g.resourceType = '*')
```

`matches` **tái dùng** từ `permission.decide.ts:233-235` — không viết lại (nếu không đây là bản cài đặt
thứ năm).

**Chốt tường minh 3 vị ngữ** (vá B6 vòng 1):

1. Vế `!g.isSensitive` trên **hàng grant** bị **GỠ**. Cổng sensitive đọc cờ **cặp đích**.
2. **Tập DENY tính trên TOÀN BỘ grant còn hiệu lực** (không chỉ tập non-sensitive) — mirror `decideCan`
   và `getAllowlistedSensitiveCapabilities:646-656`. ⚠️ Đây là vế **SIẾT** duy nhất của WO ⇒ nó có ca
   riêng §9.2-#18 và đột biến riêng §9.3.
3. `EXCLUDED` lấy từ **MỘT nguồn** đặt cạnh `REVEAL_CLASS_PAIRS`
   (`apps/api/src/auth/step-up/reveal-class-pairs.ts` — const đó **cố ý RỖNG**, đừng nhét vào nó), khởi
   tạo `[('reveal-secret','platform-account')]`. **KHÔNG** viết danh sách literal thứ hai ở
   `permission.service.ts`. Ratchet: mọi cặp catalog có `action` bắt đầu `reveal-secret` phải ∈ `EXCLUDED`.

### 4.3 Nguồn catalog — chỉ chạm khi CÓ grant wildcard, và PHẢI có trần (vá B1 vòng 1 + B3)

```text
allows    = grant ALLOW còn hiệu lực
P        ← { (g.action, g.resourceType, g.isSensitive, hasExactAllow=true) : g ∈ allows, g exact }
wildcards = allows ∖ exact
IF wildcards ≠ ∅:                                  ← CHỈ khi đó mới đọc catalog
   pairs = await pairCatalog.list()                ← §4.3.1 — có TRẦN + single-flight + TTL
   P ← P ∪ { (p.action, p.resourceType, p.isSensitive, hasExactAllow=false)
             : p ∈ pairs, p.action ≠ '*', p.resourceType ≠ '*', ∄ cùng cặp trong P,
               ∃ g ∈ wildcards: matches(g, p.action, p.resourceType) }
```

⚠️ **Vòng khai triển KHÔNG được hạ `hasExactAllow` về `false`** cho cặp đã có (một `Map.set` vô ý ở
vòng hai là đủ lật cổng sensitive) — ca §9.2-#19.

Ba hệ quả:

1. **Actor không giữ wildcard ⇒ 0 truy vấn thêm.** Trên PROD đó là gần như mọi người (chỉ `SA` giữ
   wildcard) ⇒ chi phí W1 ≈ 0 thực tế, và biến mất hẳn nếu PROD không có hàng catalog `*:*` (Q5).
2. **Định lý §4.1 đúng ở MỌI trạng thái**, không chỉ trạng thái lành ⇒ 7 stub `sentinelCatalog()` (§9.4)
   giữ xanh **theo cấu tạo**.
3. Loại hàng catalog chứa `*` là ratchet ở **điểm phát khoá**, không ở tập đích ⇒ nhánh nào cũng kín.

#### 4.3.1 `PermissionPairCatalogSnapshot` — LỚP MỚI, KHÔNG tái dùng lớp cũ

plan-review B3 chặn đúng: `repo.getAllPermissions()` là `runRaw` **không trần**
(`permission.repository.ts:266-272`), trong khi caller duy nhất trên đường request hôm nay bọc nó trong
`PermissionCatalogSnapshot` với `PERMISSION_CATALOG_LOAD_TIMEOUT_MS = 5_000` **vì đúng lý do này**
(`permission-catalog-snapshot.ts:22-23`: _"DB treo KHÔNG được kéo `can()` treo theo"_). Gọi thẳng repo
⇒ `/auth/me` bắn **3 lượt song song không trần** (`auth.service.ts:1348-1352` + `getMyApps`).

**Quyết: lớp MỚI, file riêng**, mượn _hình dạng_ của lớp cũ (TTL 300s · timeout 5s · single-flight
với ô `inFlight` gán đúng thứ tự theo bản vá `S14-SEC-CATALOGSNAP-HARDEN-1` §3.2 · hook `onError` ·
state **per-instance**), nhưng **bất biến suy biến NGƯỢC chiều** và phải ghi thẳng trong docblock:

|          | `PermissionCatalogSnapshot` (có sẵn) | `PermissionPairCatalogSnapshot` (mới)                     |
| -------- | ------------------------------------ | --------------------------------------------------------- |
| Giữ gì   | `sensitivePairs: Set \| null`        | danh sách **cặp** (kèm cờ), loại hàng chứa `*`            |
| Suy biến | **SIẾT** — mọi cặp = sensitive       | **giữ ảnh CŨ**; chưa từng nạp ⇒ **rỗng** + `logger.error` |
| Ai đọc   | `can()` — cổng                       | `getCapabilities`/`getCapabilityScopes` — gợi ý UI        |

**KHÔNG** gộp vào lớp cũ: hai bất biến ngược chiều trong một ô là đúng khuôn
`cache-breaks-two-source-flag-invariants` (§4.5 của v2, plan-review xác nhận đúng).

### 4.4 Nhánh SUY BIẾN — kể ĐÚNG chiều (vá B2b)

| Tình huống                                                                            | Kết quả                                                | Chiều       |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------- |
| Actor **không** giữ wildcard                                                          | Không đọc catalog. Không có nhánh suy biến.            | —           |
| Có wildcard · snapshot **đã nạp được ít nhất 1 lần** · lượt nạp mới ném/rỗng/quá trần | Dùng **ảnh CŨ** ⇒ caps đầy đủ; `logger.error`          | trung tính  |
| Có wildcard · snapshot **CHƯA từng nạp** (cold start + DB catalog chết)               | Giữ khoá exact, **mất** phần wildcard + `logger.error` | ⚠️ **SIẾT** |
| `getCompanyRoleGrants()` ném                                                          | `catch` sẵn có ⇒ `{}` + log (hợp đồng cũ, KHÔNG đổi)   | siết        |

⚠️ **v2 viết "hướng suy biến ở đây NỚI" — SAI**, và plan-review B2b bắt đúng. Với actor **chỉ** giữ
wildcard (SA, ~10 user PROD), mất phần wildcard nghĩa là `caps = {}`, trong khi hôm nay họ nhận
`{"*:*": true}` mà `useCan` (4 vế) và `hasAnyCapability` đọc là **"mọi thứ"** ⇒ hàng đó là **SIẾT tối
đa**: 0 khoá, và `/auth/me.modules` + `/foundation/modules/my-apps` trả **0 app card**
(`module-catalog.service.ts:52-77`).

Ảnh-cũ ở §4.3.1 thu hàng đó về **chỉ còn cold start**. Vẫn phải: ghi runbook, và đưa §11 mục 6
("availability của nhóm wildcard"). **KHÔNG** phát `*:*` ở nhánh suy biến để "giữ hành vi cũ" — nó phá
bất biến hình dạng §3, tức đổi một sự cố khả dụng lấy một lỗ.

**KHÔNG** dựng sàn thử-lại như ADR-12 D9: đường này không phải hot-path.

---

## 5. Bề mặt gọi + số lượt đọc catalog

| Đường                    | File                                                    |
| ------------------------ | ------------------------------------------------------- |
| `/auth/me` trực tiếp     | `auth.service.ts:1349`                                  |
| `/auth/me` → `getMyApps` | `auth.service.ts:1360` → `module-catalog.service.ts:54` |
| `getCapabilityScopes`    | `auth.service.ts:1351`                                  |

⇒ **3** lượt/`/auth/me` **của actor giữ wildcard**; **0** cho mọi người khác. Sau §4.3.1 ba lượt này
**gộp về 1** nhờ single-flight + TTL. Không nằm trên hot-path `can()`.

---

## 6. Vế BẮT BUỘC — `getCapabilityScopes`

`:686` tự khai **"KEYSET Y HỆT getCapabilities"** và lọc bằng đúng vế `!g.isSensitive`. Sửa một bên là
để `/auth/me` nói hai chuyện trong cùng payload ⇒ **cùng helper, cùng luật**.

### 6.1 Chọn grant đóng góp scope — soi gương `decideStrongestScope`

`permission.decide.ts:256-259` nhánh non-sensitive: `eligible = exact.length > 0 ? exact : allowMatches`
— **exact THẮNG, wildcard bị LOẠI HẲN**. Union ngây thơ sau khai triển cho
`scopes["view:user"] = ["Own","Company"]` trong khi BE resolve ra **`Own`** ⇒ FE được gợi ý **RỘNG HƠN**
BE — đẻ lại đúng lớp lệch WO này đang đóng, chỉ đổi trục.

**Luật:** `eligible = hasExactAllow ? {ALLOW exact khớp} : {ALLOW wildcard khớp}`;
`scopes[k] = dedupe(eligible.map(g => g.dataScope))`. `isGrantActive` lọc **trước** ⇒ ca "exact HẾT HẠN

- wildcard còn hiệu lực" tự rơi về wildcard (ca §9.2-#12).

### 6.2 `scopes` chứa cặp sensitive — quyết định + lý do

plan-review nêu phương án hẹp hơn: giữ keyset parity ở `capabilities` nhưng `scopes` chỉ trả cặp
non-sensitive (đo được: **0 consumer** đọc `scopes` cho cặp sensitive — cả 4 site `createPermissionChecker`
truyền `scopes: []`, `use-can.ts` không đọc `scopes`).

**Quyết: GIỮ parity (scopes CÓ cặp sensitive).** Lý do: bất biến "keyset `scopes` === keyset
`capabilities`" là thứ **máy kiểm được** (ca #10) và đã được hợp đồng khai ở
`contracts/src/auth.ts:152-154`; đổi nó thành "⊆" là thay một bất biến chặt bằng một bất biến lỏng để
mua một thứ **không consumer nào dùng**. Nhưng phải đưa `security-reviewer` (§11 mục 2) — nếu reviewer
BLOCK thì phương án ⊆ là đường lùi đã sẵn sàng, chi phí thấp.

### 6.3 `getAllowlistedSensitiveCapabilities` — GIỮ, đánh dấu bị THAY THẾ

Output của nó ⊆ `getCapabilities` mới ⇒ merge ở `auth.service.ts:1357` và `module-catalog.service.ts:57`
thành no-op.

**Lý do GIỮ (nêu cho đúng — v2 nói quá):** _không đổi hai thứ trong một PR vùng đỏ_. Lý lẽ "dư thừa
suy biến" của v2 **yếu**: khi `getCompanyRoleGrants` hỏng thì **cả hai** hàm cùng trả `{}` (chung một
đường đọc grant) ⇒ dư thừa chỉ tồn tại ở nhánh "`getCapabilities` hỏng riêng", xác suất ≈ 0.

Nghĩa vụ: docblock `:626-638` ghi rõ đã bị thay thế + trỏ WO dọn `S18-AUTH-CAPALLOWLIST-RETIRE-1`.
⚠️ **Phải kiểm:** sau vế `EXCLUDED` (§4.2), có mục allowlist nào rơi vào `EXCLUDED` không? Nếu có,
merge `{...allowlistedSensitiveCaps, ...caps}` sẽ **phục hồi** nó ⇒ thủng §4.2. (Đo: 69 mục hiện
không có `reveal-secret:*` — xác nhận lại lúc code.)

---

## 7. FE — 0 dòng logic, nhưng bề mặt là **8** điểm (vá B4 vòng 2 + W)

| #     | Điểm                                                                                                                                                                                                                                   | Fallback `*`? | Đổi thế nào                                                                                                                                          |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `use-can.ts:16-22` `useCan` (**345** call-site)                                                                                                                                                                                        | ✅ 4 vế       | Fallback thành **code chết**. Cặp sensitive: `false` → `true` cho người có grant ⇒ **màn HIỆN**.                                                     |
| 2     | `use-can.ts:39-41` `useCanExact` (**128**)                                                                                                                                                                                             | ❌            | Cặp sensitive ngoài allowlist: `false` → `true` ⇒ **màn HIỆN**.                                                                                      |
| 3     | `<PermissionGate>` (**72**)                                                                                                                                                                                                            | qua `useCan`  | như #1                                                                                                                                               |
| 4     | `module-app-metadata.ts:196-204` `hasAnyCapability`                                                                                                                                                                                    | ✅ 4 vế       | Fallback chết; app-card gác bằng cặp sensitive nay hiện đúng.                                                                                        |
| 5-8   | `createPermissionChecker` (`registry.ts:255-271` — khớp khoá **LITERAL**, KHÔNG có nhánh `*`) tại `ProtectedRoute.tsx:60-67` (cổng ROUTE) · `HomePortalLayout.tsx:51-55` · `AppSwitcher.tsx:50-56` · `ModuleWorkspaceLayout.tsx:50-55` | ❌            | **Chiều NỚI.** Actor chỉ-wildcard hôm nay `{"*:*":true}` ⇒ khớp 0 khoá ⇒ route/sidebar/app **ĐÓNG**; sau khai triển nhận ~249 khoá literal ⇒ **MỞ**. |
| **9** | `apps/console/src/lib/chat-oversight-gate.ts:33` `hasChatOversightCapability()` — đọc **thẳng store, NGOÀI React**, là `beforeLoad` của route console (`console/src/router.tsx:225`)                                                   | ❌            | **Không đổi** (`view:chat-oversight` đã ∈ 69 mục). Ghi vào census vì "7 điểm" của v2 là **số sai**, mà §7.2 dựa vào census đó.                       |

⚠️ #5-8 dựng `Map` mới mỗi lần gọi từ **toàn bộ** map caps, `scopes: []` ⇒ số khoá đi 1 → ~249 với SA.
Lúc code: xác nhận `evaluateRouteAccess` **không** dùng `hasScope`/`hasAnyScope` (`registry.ts:287-294`),
vì cả bốn site nhét `scopes: []`.

### 7.2 Quyết định (`done_when`): **GIỮ NGUYÊN `use-can.ts`. 0 dòng logic FE đổi.**

1. Sau bản vá, fallback là **code chết trên payload thật** — truy nguồn được: `stores/auth.ts:57`
   `setUser` là **cổng ghi duy nhất** (**không** `persist`, **không** localStorage), đúng **3** call-site
   sản phẩm (`web-core/src/lib/session.ts:57` · `app/…/TwoFactorSetupPage.tsx:72` ·
   `console/…/settings/account.tsx:34`), cả ba truyền `me.capabilities`. Ratchet §9.2-#5 ở BE khoá kín
   hình dạng khoá tới FE.
2. Gỡ = đổi hành vi 345 + 128 + 72 điểm để đổi lấy 0 hành vi thực tế.
3. Phòng thủ theo tầng: hôm nào BE tái sinh khoá `*`, FE vẫn hành xử như hôm nay.

**Thay đổi FE duy nhất:** comment ở `use-can.ts` + `module-app-metadata.ts` trỏ về ratchet BE.

---

## 8. Bán kính — mệnh đề CÓ ĐIỀU KIỆN (vá B2)

| Nhóm actor                                                                            | Đổi gì                                                                                                         |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Giữ grant **sensitive EXACT** ngoài allowlist (dev: **71 cặp**, 6 cặp × **49 actor**) | caps **THÊM** khoá ⇒ màn/route bị allowlist bịt nay **HIỆN**. Bán kính lớn nhất, và là **mục đích**.           |
| Giữ grant **wildcard** (`SA`, ~10 user PROD)                                          | mất `*:*`, được ~249 khoá literal ⇒ route/sidebar (#5-8) **MỞ**; cặp sensitive vẫn tới qua grant exact của họ. |
| **Chỉ** grant exact non-sensitive                                                     | **0 đổi** (định lý §4.1).                                                                                      |

> **Mệnh đề (đơn điệu nới):** `caps_cũ ∖ {"*:*"} ⊆ caps_mới`
> — **chỉ đúng khi CẢ HAI tiền đề sau đúng**, và cả hai đều phải ĐO, không được giả định:
>
> **(T1)** Catalog **không có** hàng dạng wildcard mang `is_sensitive = true`. Nếu có, vế DENY-siết
> §4.2-(2) bắt đầu nhìn thấy `DENY` trên hàng đó (hôm nay vô hình vì bị `!g.isSensitive` lọc trước) và
> sẽ suppress **cả khoá non-sensitive** actor giữ bằng grant exact ⇒ **MẤT khoá**.
> Không exotic: `PermissionCatalogSnapshot` đã coi mọi cặp chứa `*` là sensitive
> (`permission-catalog-snapshot.ts:142`, ADR-12 D4) ⇒ "đồng bộ catalog cho khớp D4" là bản vá hợp lý
> mà ai đó sẽ làm, và nó kích hoạt đúng phản ví dụ này. **Đo bằng Q5 + Q6.**
>
> **(T2)** `PermissionPairCatalogSnapshot` đã nạp được ít nhất một lần (§4.4). Cold start + catalog chết
> ⇒ actor chỉ-wildcard mất sạch khoá.

⇒ **§12 giữ nguyên nhánh DỪNG.** v2 viết "không còn nhánh DỪNG nào ở tầng census vì §8 đã chứng minh"
— sai, vì §8 chỉ đúng dưới T1/T2.

---

## 9. Test — RED trước

### 9.1 Ca đang GHIM LỖ

**(a) 9 khẳng định `caps["*:*"] === true`** — `auth-me-capabilities.int.spec.ts`, `WILDCARD_CAP_KEY`
(`:104`), tại **`:234` `:273` `:433` `:574` `:737` `:879` `:1001` `:1136` `:1276`** (mỗi ca có actor
wildcard riêng, seed `:179 :364 :521 :706 :810` …).

Áp khuôn 3 khẳng định cho **cả 9**, KHÔNG xoá dòng (`tests-can-pin-a-hole-open`):
(a) `"*:*" in caps === false` · (b) một cặp non-sensitive **chính tắc** vẫn `true` — dùng `view:user`
(`migrations/0444…sql:39`, `is_sensitive=false`), **không** lấy cặp bất kỳ vì catalog lane bị nhiều spec
đóng dấu · (c) khẳng định sensitive **đảo chiều theo grant của actor ca đó**: chỉ-wildcard ⇒ vẫn VẮNG;
có exact ⇒ **CÓ**. ⚠️ Đọc từng ca, đừng áp máy móc.

**(b) CENSUS BẮT BUỘC trước khi sửa** — họ khẳng định vắng-mặt: `expect(key in caps).toBe(false)` tại
`:235 :240 :257 :275 :277 :420 :427 :435 :437 :443 :449` … Hôm nay chúng xanh vì **HAI lý do khác nhau**:
"actor không có grant" (vẫn đúng sau v3) **hoặc** "sensitive bị lọc" (**ĐẢO** sau v3). Với **mỗi**
khẳng định, ghi actor đó có grant exact trên cặp đó không; ca thuộc loại thứ hai phải **liệt kê ra PR**
— sửa nó là **đổi một khẳng định an ninh**, không phải dọn test.

**(c) Cổng ratchet tĩnh mới:** cấm mọi spec khẳng định một khoá cap chứa `*` là `true`.

### 9.2 Ca mới

| #      | Loại                                   | Nội dung                                                                                                                                                                                                                                                                                                                     |
| ------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | RED (unit)                             | Actor chỉ `('*','*')` ⇒ 0 khoá chứa `*`; có cặp non-sensitive; **không** cặp sensitive nào.                                                                                                                                                                                                                                  |
| 2      | RED (**unit** — B5 vòng 1)             | `('view','*')` ⇒ có `view:<T non-sensitive>`, **không** `view:<T sensitive>`, không `view:*`.                                                                                                                                                                                                                                |
| 3      | RED (**unit**)                         | `('*','T')` — trục còn lại.                                                                                                                                                                                                                                                                                                  |
| 4      | ĐỐI CHỨNG                              | Actor grant exact **non-sensitive thuần** ⇒ output **bằng nhau theo TẬP khoá + giá trị** (KHÔNG `JSON.stringify` — thứ tự khoá không phải hợp đồng). Kỳ vọng viết **hằng tay**.                                                                                                                                              |
| 5      | RATCHET                                | `Object.keys(caps).every(k => !k.includes("*"))` với mọi tổ hợp grant.                                                                                                                                                                                                                                                       |
| 6      | RED §1.2                               | Grant **EXACT SENSITIVE ngoài allowlist** ⇒ khoá **CÓ MẶT**.                                                                                                                                                                                                                                                                 |
| 7      | ĐỐI CHỨNG                              | **Chỉ** wildcard + cặp sensitive ⇒ khoá **VẮNG**. Thiếu ca này thì #6 thành "phát mọi cặp sensitive".                                                                                                                                                                                                                        |
| 8      | RED                                    | DENY wildcard suppress sau khai triển: `('*','*')` ALLOW + `('view','user')` DENY ⇒ `view:user` vắng, cặp khác còn.                                                                                                                                                                                                          |
| 9      | RED                                    | DENY `('*','T')` suppress **mọi** action trên `T`.                                                                                                                                                                                                                                                                           |
| 10     | RED §6                                 | keyset `getCapabilityScopes` **=== TẬP** keyset `getCapabilities`, cho cả 3 nhóm actor §8.                                                                                                                                                                                                                                   |
| 11     | RED §6.1                               | `view:user@Own` + `*:*@Company` ⇒ `scopes["view:user"] === ["Own"]`, cặp khác `["Company"]`.                                                                                                                                                                                                                                 |
| 12     | RED §6.1                               | exact **HẾT HẠN** + wildcard còn hiệu lực ⇒ rơi về scope wildcard (không `[]`, không mất khoá).                                                                                                                                                                                                                              |
| **13** | **RED §4.2-(3) / B1**                  | Actor có grant exact `reveal-secret:platform-account` ⇒ khoá **VẮNG**.                                                                                                                                                                                                                                                       |
| **14** | **RATCHET §4.2-(3)**                   | Mọi cặp catalog có `action` bắt đầu `reveal-secret` ∈ `EXCLUDED`.                                                                                                                                                                                                                                                            |
| 15     | RED §4.4                               | Có wildcard · snapshot **đã** nạp · lượt mới ném ⇒ dùng **ảnh CŨ**, caps ĐẦY ĐỦ, `logger.error` được gọi.                                                                                                                                                                                                                    |
| 16     | RED §4.4                               | Có wildcard · snapshot **chưa** nạp · load ném ⇒ khoá exact **CÒN**, khoá wildcard **MẤT**, log.                                                                                                                                                                                                                             |
| 17     | RED §4.4                               | Y HỆT #16 nhưng catalog trả `[]` — **kể cả vế log**.                                                                                                                                                                                                                                                                         |
| **18** | **RED §4.2-(2) / B5**                  | ALLOW exact trên cặp sensitive X **+ DENY exact trên chính X (hàng sensitive)** ⇒ X **VẮNG**. Ca DUY NHẤT đo vế SIẾT của v3.                                                                                                                                                                                                 |
| **19** | **RED §4.3**                           | Actor có **CẢ** exact sensitive X **CẢ** wildcard khớp X ⇒ X **CÓ** (vòng khai triển không hạ `hasExactAllow`).                                                                                                                                                                                                              |
| 20     | ĐỐI CHỨNG §4.3                         | Actor **không** wildcard + catalog ném ⇒ `pairCatalog.list` **KHÔNG được gọi**, caps đầy đủ.                                                                                                                                                                                                                                 |
| 21     | ĐỐI CHỨNG §4.3.1                       | Load **vượt trần 5s** ⇒ rơi nhánh suy biến, `/auth/me` **vẫn trả** (không treo).                                                                                                                                                                                                                                             |
| 22     | ĐỐI CHỨNG                              | `getCompanyRoleGrants` ném ⇒ `{}` + log (hợp đồng cũ không đổi).                                                                                                                                                                                                                                                             |
| **23** | **ĐỐI CHỨNG hữu hạn thay #13-cũ / B6** | Ba nhóm actor §8 + **hai phản ví dụ** T1/T2: (a) catalog có hàng `('view','*')` `is_sensitive=true` + DENY trên nó ⇒ khoá non-sensitive **BỊ MẤT** — ca này **khẳng định phản ví dụ tồn tại**, không phải khẳng định nó không xảy ra; (b) cold start + catalog ném + actor chỉ-wildcard ⇒ `caps = {}`. Kỳ vọng **viết tay**. |

> ⚠️ **Bỏ hẳn ca "đơn điệu" kiểu property test neo bằng bản sao `getCapabilities` cũ trong spec** (v2 #13).
> Bản sao code trong test **trôi im lặng** và fixture viết tay **không bao giờ sinh ra** T1/T2. #23 thay
> nó bằng danh sách hữu hạn có kỳ vọng tay, gồm cả hai phản ví dụ.

### 9.3 Đột biến bắt buộc

| Đột biến                                                   | Phải giết                                                                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Gỡ vế loại hàng catalog chứa `*` khỏi tập đích             | #5 — ⚠️ **chỉ giết được khi** fixture catalog CÓ hàng `*` **và** actor giữ grant `action='*'`. Ghi điều kiện vào ca. |
| Cổng sensitive "luôn qua"                                  | #7                                                                                                                   |
| Cổng sensitive "luôn chặn"                                 | #6                                                                                                                   |
| **Gỡ vế `EXCLUDED`**                                       | **#13**                                                                                                              |
| **Gom DENY chỉ trên grant non-sensitive** (revert vế SIẾT) | **#18**                                                                                                              |
| Hạ `hasExactAllow` trong vòng khai triển                   | #19                                                                                                                  |
| §6.1 → union ngây thơ                                      | #11                                                                                                                  |
| Đảo thứ tự `isGrantActive` vs chọn exact                   | #12                                                                                                                  |
| Gỡ `logger.error` nhánh rỗng                               | #17                                                                                                                  |
| Bỏ `if wildcards ≠ ∅` (đọc catalog vô điều kiện)           | #20                                                                                                                  |
| Bỏ `withTimeout`                                           | #21                                                                                                                  |

### 9.4 Blast radius trên stub — đo lại trên master

`done_when` gốc nói "2 stub khai `Promise<[]>`" — **hết đúng**: PR #478 (`d4b37200`) đổi **cả 7** sang
`sentinelCatalog()` (`permission.service.spec.ts:142` · `permission.service.reveal.spec.ts:86` ·
`permission.scopes.spec.ts:53` · `data-scope.service.spec.ts:56` · `data-scope.service.coverage.spec.ts:62` ·
`test/foundation/dashboard-scope-roundtrip.unit-spec.ts:53` · `test/foundation/permission-scope-batch.unit-spec.ts:61`).

`permission-catalog-fixture.ts:42-47` trả **đúng 1 hàng** `__catalog-sentinel__`, **cố ý không khớp** cặp
mà grant stub cấp ⇒ **§4.3 làm tan chiều hỏng này** (grant EXACT không chạm catalog). Còn đúng một ca
phải xử lý:

- `permission.scopes.spec.ts:101-110` _("omits sensitive grants — keyset mirrors getCapabilities")_
  **ĐẢO NGHĨA** dưới hợp đồng §3. Viết lại thành **hai** ca: sensitive + exact ⇒ **CÓ**; sensitive + chỉ
  wildcard ⇒ **VẮNG**. Nạp catalog có cặp `view:salary` cờ `true` cho stub đó để ca thật sự đo vế
  sensitive. (Bản hiện tại **xanh-RỖNG**: `view:salary` undefined vì **vắng catalog**, không vì vế
  sensitive.)

> Đo lại danh sách này trước khi sửa — bảng trên là ảnh của master lúc viết plan.

---

## 10. Cổng verify

`bash harness/check.sh --all --lane-db` xanh **không banner**. Lane đã dựng: `mediaos_capwildcard`
(389 cặp / 140 sensitive / 0 wildcard — **khác** dev DB, đọc §2.1 trước khi diễn giải kết quả).

---

## 11. Điểm phải đưa `security-reviewer` — nêu tường minh

1. **Đảo `S2-AUTH-BE-5`**: `/auth/me` nay liệt kê cặp sensitive actor giữ. Lý lẽ đầy đủ ở
   **`DECISIONS-13` §1–§2 + §5 (cái MẤT)**. ⚠️ **KHÔNG** đọc câu "hàng rào tuỳ tiện" của plan v2 — sai,
   đã rút; tiêu chí có thật (`permission.service.ts:21-27`) và có cổng máy
   (`sensitive-screen-gate-allowlist.spec.ts:20-31`).
2. **`scopes` nay kèm cặp sensitive** (§6.2) — 0 consumer dùng; phương án ⊆ là đường lùi sẵn.
3. **Cổng sensitive nằm ở `hasExactAllow`** — sai vế này thì `*:*` mở toàn bộ 140 cặp sensitive trên FE.
   Ca #7 + #19 + đột biến "luôn qua" là hàng canh; đột biến độc lập.
4. **Vế `EXCLUDED`** (§4.2-(3)) là thứ giữ break-glass khỏi caps. Ca #13/#14.
5. **Chiều NỚI ở 5 cổng route/sidebar/console** (§7 #5-9) — xác nhận không cổng nào là enforcement thật.
6. **Availability nhóm wildcard** (§4.4): cold start + catalog chết ⇒ SA mất sạch app-card.
7. **Mệnh đề đơn điệu chỉ đúng dưới T1/T2** (§8) — đừng đọc nó như định lý vô điều kiện.
8. `getAllPermissions()` chạy `runRaw` **NGOÀI** `withTenant` (`permission.repository.ts:267`) — catalog
   là bảng GLOBAL không cột `company_id` ⇒ không phải bề mặt rò tenant (BẤT BIẾN #1). Khẳng định sẵn.

---

## 12. RELEASE — cổng NGƯỜI

Owner chạy `docs/plans/S14-SEC-CAPWILDCARD-1.census.sql` trên PROD (chỉ-đọc, vai bỏ qua RLS —
`classifier-blocks-prod-db-from-agent`), dán Q0–Q6 vào PR.

| Câu       | Đọc thế nào                                                                                                                                                                                         | Cổng?       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **Q0/Q5** | `pairs_wildcard = 0` ⇒ PROD không có hàng catalog `*:*` ⇒ grant wildcard **bất khả biểu diễn** (FK `role_permissions.permission_id`) ⇒ nhánh khai triển là phòng xa thuần tuý.                      | —           |
| **Q1**    | Số actor giữ wildcard = số người được **MỞ** route/sidebar. Báo CS.                                                                                                                                 | —           |
| **Q2**    | Người hôm nay thấy-rồi-403. Dưới v3 họ **vẫn không** thấy cặp sensitive (ca #7). Chỉ là số liệu.                                                                                                    | —           |
| **Q3**    | Giữ wildcard **và** có exact sensitive ⇒ nhóm **ĐƯỢC LỢI**.                                                                                                                                         | —           |
| **Q4**    | **Danh sách màn sẽ hiện thêm.** Dev = 71 cặp / 49 actor. ⚠️ **Phải đọc TRƯỚC khi code**: nếu có cặp thuộc lớp reveal/step-up, hoặc cặp owner **không muốn** phơi ⇒ đổi thiết kế, không phải chờ PR. | ⚠️ **CÓ**   |
| **Q6**    | `DENY` trỏ vào hàng catalog wildcard. Trả về hàng nào `is_sensitive = true` ⇒ **tiền đề T1 SAI** ⇒ có actor sẽ **MẤT khoá**.                                                                        | ⛔ **DỪNG** |

---

## 13. Ngoài phạm vi — tường minh

- **Không** đụng logic `use-can.ts` / `useCanExact` / `hasAnyCapability` (§7.2).
- **Không** xoá `SENSITIVE_CAPABILITY_ALLOWLIST` / `getAllowlistedSensitiveCapabilities` (§6.3) →
  WO dọn `S18-AUTH-CAPALLOWLIST-RETIRE-1`.
- **Không** đụng seed / migration / catalog quyền · **không** đụng `PermissionCatalogSnapshot` (lớp cũ).
- **Không** thêm phần tử vào `REVEAL_CLASS_PAIRS` (const đó cố ý rỗng, có WO riêng) — `EXCLUDED` là
  const **khác**, đặt cạnh nó.
- **Không** vá lệch `scopes` vs `resolveStrongestScope` cho grant non-wildcard (hôm nay không lệch).

### 13.1 `paths` — đã nới ở phiên 05/09

`harness/backlog.mjs` nay có `apps/api/src/foundation/**` · `packages/contracts/**` ·
`docs/DECISIONS/**`. ⚠️ **Còn thiếu `apps/console/**`** (điểm census #9, §7) — nới lúc code.
Zod shape **không** đổi (`z.record(z.boolean())`); chỉ docblock `contracts/src/auth.ts:111-116,152-154`.

### 13.2 Nợ ghi nhận

- **Invalidation**: sau v3, `capabilities` phụ thuộc **catalog**, không chỉ grant ⇒ seed cặp mới / lật
  `is_sensitive` giờ đổi caps. Ghi vào docblock — nếu không, WO cache tương lai sẽ mở lỗ mà không ai
  nhớ vì sao.
- `getCapabilities` và `can()` đọc **hai ảnh chụp khác nhau** (pair-list vs sensitive-set, TTL riêng)
  ⇒ trong một cửa sổ TTL có thể lệch ⇒ "FE thấy, BE 403" **giả** trong int-spec seed cặp mới. Ai gọi
  `resetCatalogSnapshotForTest()` phải reset **cả hai**.

---

## 14. Thứ tự thi công (phiên sau)

> Bước 0 (ADR) **ĐÃ XONG** phiên 05/09: `DECISIONS-13` đã viết + owner chốt.

1. Đọc **Q4** của census PROD (§12) — cổng ⚠️, có thể đổi thiết kế.
2. Nới `paths` thêm `apps/console/**`; đổi WO `status` → `in_progress`.
3. Census họ khẳng định vắng-mặt (§9.1b) ⇒ liệt kê ca "đổi khẳng định an ninh".
4. Chuyển 9 ca ghim (§9.1a) + viết ca #1–#23 ⇒ **đo RED**.
5. Dựng `PermissionPairCatalogSnapshot` (§4.3.1) + const `EXCLUDED` cạnh `REVEAL_CLASS_PAIRS`.
6. Trích helper chung (`matches` tái dùng) ⇒ vá `getCapabilities` (§4) + `getCapabilityScopes` (§6).
7. Đo lại blast radius stub (§9.4) ⇒ viết lại `permission.scopes.spec.ts:101-110`.
8. Chạy **11** đột biến (§9.3) ⇒ mỗi cái giết đúng ca đã khai.
9. Docblock: `permission.service.ts` (3 method) · `contracts/src/auth.ts` · comment FE 2 file.
10. `bash harness/check.sh --all --lane-db` ⇒ FULL gate (§11) ⇒ PR (**KHÔNG** nhãn auto-merge).

---

**Liên quan:** `DECISIONS-13` · `DECISIONS-12` · `docs/plans/S14-SEC-DASHGATE-WILDCARD-1.md` ·
`docs/plans/S14-SEC-CATALOGSNAP-HARDEN-1.md` · memory `capability-allowlist-hides-admin-screens` ·
`superadmin-not-a-canonical-role` · `permission-grant-census-must-cover-four-wildcard-shapes` ·
`test-fixture-stamps-global-permission-catalog` · `empty-success-is-the-fail-open-shape` ·
`tests-can-pin-a-hole-open` · `same-builder-twice-makes-unit-spec-vacuous` ·
`cache-breaks-two-source-flag-invariants` · `classifier-blocks-prod-db-from-agent` ·
`red-zone-wo-cost-profile`.
