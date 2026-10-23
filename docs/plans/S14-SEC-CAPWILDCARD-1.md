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
> | v4 — delta 23/10/2026 (**§15**)                  | CW-1..3 owner chốt + đo lại drift trên `0d7350c7`     | **sẵn sàng code** |
> | v4.1 — plan-review 23/10 (**§15.9**)             | PASS_WITH_FIXES 9 finding (2 HIGH) — áp cả 9          | **sẵn sàng code** |
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
   **v4 (§15 D-v4-1/2, owner chốt CW-1): luật theo TIỀN TỐ action `reveal-`, không chỉ `reveal-secret`.**

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

| #      | Loại                                                          | Nội dung                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1      | RED (unit)                                                    | Actor chỉ `('*','*')` ⇒ 0 khoá chứa `*`; có cặp non-sensitive; **không** cặp sensitive nào.                                                                                                                                                                                                                                                                                                                                                                              |
| 2      | RED (**unit** — B5 vòng 1)                                    | `('view','*')` ⇒ có `view:<T non-sensitive>`, **không** `view:<T sensitive>`, không `view:*`.                                                                                                                                                                                                                                                                                                                                                                            |
| 3      | RED (**unit**)                                                | `('*','T')` — trục còn lại.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 4      | ĐỐI CHỨNG                                                     | Actor grant exact **non-sensitive thuần** ⇒ output **bằng nhau theo TẬP khoá + giá trị** (KHÔNG `JSON.stringify` — thứ tự khoá không phải hợp đồng). Kỳ vọng viết **hằng tay**.                                                                                                                                                                                                                                                                                          |
| 5      | RATCHET                                                       | `Object.keys(caps).every(k => !k.includes("*"))` với mọi tổ hợp grant.                                                                                                                                                                                                                                                                                                                                                                                                   |
| 6      | RED §1.2                                                      | Grant **EXACT SENSITIVE ngoài allowlist** ⇒ khoá **CÓ MẶT**.                                                                                                                                                                                                                                                                                                                                                                                                             |
| 7      | ĐỐI CHỨNG                                                     | **Chỉ** wildcard + cặp sensitive ⇒ khoá **VẮNG**. Thiếu ca này thì #6 thành "phát mọi cặp sensitive".                                                                                                                                                                                                                                                                                                                                                                    |
| 8      | RED                                                           | DENY wildcard suppress sau khai triển: `('*','*')` ALLOW + `('view','user')` DENY ⇒ `view:user` vắng, cặp khác còn.                                                                                                                                                                                                                                                                                                                                                      |
| 9      | RED                                                           | DENY `('*','T')` suppress **mọi** action trên `T`.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 10     | RED §6                                                        | keyset `getCapabilityScopes` **=== TẬP** keyset `getCapabilities`, cho cả 3 nhóm actor §8.                                                                                                                                                                                                                                                                                                                                                                               |
| 11     | RED §6.1                                                      | `view:user@Own` + `*:*@Company` ⇒ `scopes["view:user"] === ["Own"]`, cặp khác `["Company"]`.                                                                                                                                                                                                                                                                                                                                                                             |
| 12     | RED §6.1                                                      | exact **HẾT HẠN** + wildcard còn hiệu lực ⇒ rơi về scope wildcard (không `[]`, không mất khoá).                                                                                                                                                                                                                                                                                                                                                                          |
| **13** | **ĐỐI CHỨNG + giết đột biến «gỡ `EXCLUDED`»** (v4.1 §15.9-F2) | Actor có grant exact `reveal-secret:platform-account` ⇒ khoá **VẮNG** ở **4 mặt** (§15.9-F5). ⚠️ Xanh sẵn trên master vì lọc `!g.isSensitive` (`permission.service.ts:641`) — KHÔNG phải RED; giá trị của ca = giết đột biến.                                                                                                                                                                                                                                            |
| **14** | **RATCHET §4.2-(3)**                                          | **(v4.1 §15.9-F3/F4)** (a) token action = literal ĐẦU tuple, regex `\(\s*'(reveal[^']*)'\s*,` trên `apps/api/migrations/*.sql` (KHÔNG `\breveal` — bắt chữ trong comment) ⇒ mọi token bị `EXCLUDED` loại · số token PHÂN BIỆT ≥ 2 · (b) catalog SỐNG ở lane: `SELECT action FROM permissions WHERE action ILIKE 'reveal%'` ⇒ mọi hàng bị loại, ≥ 2 hàng · (c) `REVEAL_CLASS_PAIRS.every(p => isCapabilityExcluded(p.action))` · (d) allowlist ∩ `EXCLUDED` = ∅.          |
| 15     | RED §4.4                                                      | Có wildcard · snapshot **đã** nạp · lượt mới ném ⇒ dùng **ảnh CŨ**, caps ĐẦY ĐỦ, `logger.error` được gọi.                                                                                                                                                                                                                                                                                                                                                                |
| 16     | RED §4.4                                                      | Có wildcard · snapshot **chưa** nạp · load ném ⇒ khoá exact **CÒN**, khoá wildcard **MẤT**, log.                                                                                                                                                                                                                                                                                                                                                                         |
| 17     | RED §4.4                                                      | Y HỆT #16 nhưng catalog trả `[]` — **kể cả vế log**.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **18** | **RED §4.2-(2) / B5**                                         | ALLOW exact trên cặp sensitive X **+ DENY exact trên chính X (hàng sensitive)** ⇒ X **VẮNG**. Ca DUY NHẤT đo vế SIẾT của v3.                                                                                                                                                                                                                                                                                                                                             |
| **19** | **RED §4.3**                                                  | Actor có **CẢ** exact sensitive X **CẢ** wildcard khớp X ⇒ X **CÓ** (vòng khai triển không hạ `hasExactAllow`).                                                                                                                                                                                                                                                                                                                                                          |
| 20     | ĐỐI CHỨNG §4.3                                                | Actor **không** wildcard + catalog ném ⇒ `pairCatalog.list` **KHÔNG được gọi**, caps đầy đủ.                                                                                                                                                                                                                                                                                                                                                                             |
| 21     | ĐỐI CHỨNG §4.3.1                                              | Load **vượt trần 5s** ⇒ rơi nhánh suy biến, `/auth/me` **vẫn trả** (không treo).                                                                                                                                                                                                                                                                                                                                                                                         |
| 22     | ĐỐI CHỨNG                                                     | `getCompanyRoleGrants` ném ⇒ `{}` + log (hợp đồng cũ không đổi).                                                                                                                                                                                                                                                                                                                                                                                                         |
| **23** | **ĐỐI CHỨNG hữu hạn thay #13-cũ / B6**                        | Ba nhóm actor §8 + **hai phản ví dụ** T1/T2: (a) catalog có hàng `('view','*')` `is_sensitive=true` + DENY trên nó ⇒ khoá non-sensitive **BỊ MẤT** — ca này **khẳng định phản ví dụ tồn tại**, không phải khẳng định nó không xảy ra; (b) cold start + catalog ném + actor chỉ-wildcard ⇒ `caps = {}`. Kỳ vọng **viết tay**.                                                                                                                                             |
| **24** | **ĐỐI CHỨNG + giết đột biến 12** (v4.1 §15.9-F2)              | Mức **hàm chiếu thuần** (`capability-projection.ts`), không chỉ `/auth/me`. Actor có grant exact `reveal-break-glass:break-glass` (mig 0201) ⇒ khoá **VẮNG** ở 4 mặt (§15.9-F5); cùng actor, cặp đối chứng `request-break-glass:break-glass` (mig 0200:207, sensitive, **ngoài** allowlist 86) vẫn **CÓ** — giết cả đột biến «loại theo resource» lẫn «loại mọi sensitive». Bằng chứng bắt buộc: ca **ĐỎ** trên trạng thái trung gian v3 (`EXCLUDED` = `reveal-secret`). |

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
| **(v4) Thu hẹp `EXCLUDED` về `reveal-secret` / 1 cặp**     | **#24** + **#14**                                                                                                    |

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

## 15. Plan v4 — delta 23/10/2026 (đo trên `0d7350c7`)

> DELTA, không viết lại: §1–§14 vẫn là thiết kế; mục này chỉ ghi cái ĐỔI. Owner chốt 23/10 (không mở lại):
> **CW-1** giữ v2/v3, nới `EXCLUDED` + ratchet sang tiền tố `reveal-` · **CW-2** nút nhạy cảm hiện cho người
> BE đã cho phép (ADR-13), KHÔNG dựng danh sách ẩn ở FE · **CW-3** lane riêng, chỉ deploy API, không
> migration, rollback = `git revert`. [ĐO] = đọc mã/tệp thấy · [SUY RA] = suy luận.

### 15.1 Census PROD 16/10 — chỉ số tổng hợp (§12, §14 bước 1 = XONG)

Q0 = 423 cặp / 157 sensitive / **`pairs_wildcard` = 1** · Q1 = 0 actor / 0 role giữ wildcard ALLOW · Q3 = 0 ·
Q6 = 0 · Q4 = 71 cặp chia 7 nhóm, không nhóm nào đòi đổi kiến trúc · Q4a = 86 · **Q5 = CHƯA ĐO** (bản chạy 16/10
không có Q5). Chi tiết theo actor ở kênh owner, **không** vào repo. Hệ quả (v4.1, §15.9-F6) [SUY RA]:

- Q6 = 0 ⇒ **phản ví dụ** T1 chưa xảy ra trên ảnh 16/10. T1 là mệnh đề về CATALOG (Q5) ⇒ **chưa chứng minh**;
  `pairs_wildcard = 1` ⇒ hàng §12 "Q0/Q5 = 0 ⇒ phòng xa thuần tuý" **KHÔNG áp** cho PROD. Nhánh DỪNG §12 giữ.
- Q1 = 0 ⇒ trên PROD không actor nào giữ wildcard ALLOW **trên ảnh 16/10** (ảnh 02/08 ở §2 đã cũ) ⇒ nhánh khai
  triển §4.3, `PermissionPairCatalogSnapshot` và rủi ro cold-start §4.4 **ngủ trên ảnh 16/10** — KHÔNG phải ngủ
  vĩnh viễn: `SuperAdminBootstrapService` grant TOÀN catalog (trừ `reveal-secret:platform-account`) mỗi lần boot
  khi `PLATFORM_SUPERADMIN_EMAIL` được đặt (`super-admin-bootstrap.service.ts:39-40,108`) và catalog PROD có hàng
  wildcard (Q0; `0569:167-168`) ⇒ holder wildcard có thể xuất hiện lại ⇒ T2 sống lại. Mục runbook T2 ở §11
  điểm 6 GIỮ. Tác dụng PROD hôm nay = cặp sensitive exact ngoài allowlist hiện ra (Q4) + `EXCLUDED` + vế
  DENY-siết. Thiết kế giữ nguyên (CW-1).

### 15.2 Drift file:dòng của v3 [ĐO `git log 42249f56..0d7350c7` + grep]

| v3 dẫn                                                                                                    | Trên `0d7350c7`                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permission.service.ts` (874 dòng)                                                                        | **922 dòng** — `fddea800` chèn 2 khối 17 cặp PAYROLL v2 (`:235`, `:324`); mọi dòng sau `:232` dời **+48**                                                                                                                                                                                                                                         |
| ↳ `getCapabilities` `:589-612` · docblock allowlist `:626-638`                                            | `:637-670` (vế `!g.isSensitive` `:641`) · `:672-686`; deny của `getAllowlisted…` `:646-656` → `:694-704` (v4.1 F8: v4 ghi `:668`/`:674`)                                                                                                                                                                                                          |
| ↳ `getCapabilityScopes` "KEYSET" `:686`                                                                   | `:732` (lọc `:744`); tiêu chí `:21-27` không dời                                                                                                                                                                                                                                                                                                  |
| `SENSITIVE_CAPABILITY_ALLOWLIST` "69 mục" (§1.2, §6.3)                                                    | **86** = 69 + 17 PAYROLL v2 (mig 0571); 0 mục chứa `*`, 0 mục `reveal-`; `SENSITIVE_SCREEN_GATE_PAIRS` = 53                                                                                                                                                                                                                                       |
| `permission.cache.ts:52-89`                                                                               | `66a5fe6b` (ADR-15): `getCompanyRoleGrantsWithScope` nay memo theo request ≤ 2000 ms; `getCompanyRoleGrants` (`:59`) không đổi                                                                                                                                                                                                                    |
| `auth.service.ts:1348-1360`                                                                               | `:1553-1566` (10 commit, chủ yếu S18-AUTH, không đổi nghĩa); tệp 2536 dòng                                                                                                                                                                                                                                                                        |
| `module-app-metadata.ts:196-204` (BE, `foundation/module-catalog/`)                                       | `:211-221`                                                                                                                                                                                                                                                                                                                                        |
| `stores/auth.ts:57` `setUser`                                                                             | `:71`, `35dbd0cf` thêm tham số `scopes` vào store; 3 call-site sản phẩm giữ nguyên, nay truyền `me.scopes`                                                                                                                                                                                                                                        |
| `console/src/router.tsx:225`                                                                              | `:227`                                                                                                                                                                                                                                                                                                                                            |
| `permission-catalog-fixture.ts:42-47` · `permission.service.spec.ts:142` · `permission.scopes.spec.ts:53` | `:44-50` · `:143` · `:54`; 5 stub còn lại đúng dòng                                                                                                                                                                                                                                                                                               |
| (v4.1 F8 — sót ở v4) tên `EXCLUDED`                                                                       | `super-admin-bootstrap.service.ts:22` đã có `EXCLUDED_PAIRS` = loại khỏi **GRANT** của super-admin (chỉ `reveal-secret:platform-account`) — khái niệm KHÁC `EXCLUDED` của caps; bootstrap vẫn grant `reveal-break-glass` mỗi boot. **KHÔNG gộp** (gộp = đổi grant super-admin).                                                                   |
| (v4.1 F8) `decideCan`                                                                                     | closure riêng `matchesCompanyGrant` `permission.decide.ts:59-61` (đường cổng `can()`) — KHÁC closure `matches` `:233-235` của `decideStrongestScope`.                                                                                                                                                                                             |
| (v4.1 F8) `use-can.ts`                                                                                    | đường thật `packages/web-core/src/hooks/use-can.ts`.                                                                                                                                                                                                                                                                                              |
| (v4.1 F8) `HrOverviewRailSlot.tsx`                                                                        | `apps/app/src/routes/social/feed/components/HrOverviewRailSlot.tsx:73` cũng gọi `createPermissionChecker` (checker dựng từ MỘT khoá `read:employee` + scope thật) — bổ sung cho §15.5 #11.                                                                                                                                                        |
| Không đổi (0 commit)                                                                                      | `permission.decide.ts` (`matches` `:233-235` là **closure cục bộ**, chưa export; exact-thắng `:262`) · `permission.repository.ts` (`:266-272`; cờ `:34`) · `permission-catalog-snapshot.ts` (`:22-23`, `:142`) · `reveal-class-pairs.ts` · `contracts/src/auth.ts` · `use-can.ts` · `auth-me-capabilities.int.spec.ts` (9 dòng ghim §9.1a đúng y) |

### 15.3 Quyết định v4

- **D-v4-1 (CW-1)** `EXCLUDED` = **luật tiền tố**, không danh sách: `isCapabilityExcluded(action)` ⟺
  `action.startsWith("reveal-")`, tệp mới `apps/api/src/auth/step-up/capability-exclusion.ts` cạnh
  `reveal-class-pairs.ts` (chiều import permission → auth/step-up đã có sẵn). Catalog [ĐO migrations] có đúng
  **2** cặp tiền tố này, cả hai `is_sensitive=true`: `reveal-secret:platform-account` (0005:281) ·
  `reveal-break-glass:break-glass` (0201:23). So khớp tiền tố ở đây là chiều **LOẠI** (thu hẹp gợi ý UI) —
  ngược chiều cảnh báo "KHÔNG so khớp tiền tố" ở `reveal-class-pairs.ts:50-54` (chiều MINT = nới) ⇒ không
  mâu thuẫn; ghi docblock để reviewer không đọc nhầm. `REVEAL_CLASS_PAIRS` vẫn rỗng, không chạm.
  **(v4.1)** Docblock `capability-exclusion.ts` ghi thêm: (i) action `reveal` KHÔNG gạch (khuôn step-up DECISIONS-09,
  `valkey-key.spec.ts:145`) **cố ý** giao cho ratchet #14 — ratchet đỏ thì owner quyết, **CẤM** tự nới luật runtime
  (§15.9-F3); (ii) KHÔNG gộp với `EXCLUDED_PAIRS` của bootstrap (§15.2); (iii) loại `reveal-break-glass` là **chủ
  đích thu hẹp gợi ý UI** — cổng thật là grant `active` ở service; `can()` CÓ ALLOW cặp này ở tầng công ty
  (`0201:6-8`, `contracts/src/crypto.ts:107-108`), KHÔNG phải hệ quả của `needsObjectGrant` (§15.9-F7).
- **D-v4-2** (v4.1: cách trích token + 2 vế thêm ở §9.2 #14, §15.9-F3/F4) Ratchet #14 **rộng hơn** luật runtime để không thành tautology: bắt token action `^reveal`
  (cả `reveal`/`reveal_…`) ⇒ một action reveal mới không theo tiền tố làm ĐỎ, buộc quyết định. Số khớp ≥ 2
  (chống xanh-RỖNG). Kèm allowlist ∩ `EXCLUDED` = ∅ ⇒ merge §6.3 không phục hồi được khoá bị loại.
- **D-v4-3 (CW-2)** 0 dòng logic FE; không danh sách ẩn ở FE. Bề mặt đo lại §15.5.
- **D-v4-4 (CW-3)** Lane riêng · chỉ deploy API · 0 migration · rollback `git revert`. Diff FE chỉ là comment
  ⇒ không cần deploy FE.
- **D-v4-5 (trần 800 dòng)** `permission.service.ts` đã 922 ⇒ **không làm dài thêm**: logic chiếu cap/scope
  sang tệp mới `apps/api/src/permission/capability-projection.ts` (hàm thuần: grants + pairs + now ⇒
  caps/scopes); 2 method service chỉ uỷ quyền; số dòng service sau vá ≤ 922. `matches` được **export** từ
  `permission.decide.ts` thay closure `:233-235` (0 đổi hành vi — `decideStrongestScope` gọi chính hàm đó).
  **(v4.1 F8)** CHỈ thay closure của `decideStrongestScope`; **KHÔNG** chạm `matchesCompanyGrant`
  (`permission.decide.ts:59-61`) của `decideCan` — đường cổng `can()`.
- **D-v4-6 (chỗ đặt test)** `permission.service.spec.ts` 1010 dòng, int-spec 1293 dòng ⇒ ca unit #1–#24 ở
  tệp spec MỚI; 9 dòng ghim §9.1a đổi **1 dòng ↔ 1 dòng** qua helper assert ở tệp mới (khuôn 3 khẳng định
  nằm trong helper, tham số = loại actor); int-spec MỚI nếu có dựng qua `applyMainPipeline`.
- **D-v4-7** `census.sql` VALUES của Q4: **69 → 86** (thêm đúng 17 cặp PAYROLL v2 — [ĐO] code = census + 17,
  0 mục ngược). Chữ "69" ở §1.2/§6.3 và ADR-13 §4.2-(2) đọc là 86.
- **D-v4-8** ADR-13 §4.1: thêm dòng **sửa đổi 23/10 (CW-1)** — tiền tố `reveal-`; không viết lại ADR.
  **(v4.1 F7)** Dòng sửa đổi nói thật: `reveal-break-glass` được `can()` ALLOW ở tầng công ty (cổng thật = grant
  `active` ở service) ⇒ loại nó khỏi caps là **chủ đích thu hẹp gợi ý UI**; câu "`can()` không bao giờ ALLOW ở
  tầng công ty" của §4.1 chỉ áp cho `reveal-secret`.
- **D-v4-9** §6.2 GIỮ. `scopes` nay có **1** consumer thật (§15.5 #11, cặp non-sensitive) ⇒ "0 consumer cho
  cặp sensitive" vẫn đúng; ca #11 thêm biến thể `read:employee` (cặp có consumer thật).

### 15.4 §9.4 — cặp seed SAU census 16/10 [ĐO]

0 migration mới sau 16/10 (mới nhất 0592, commit 13/10); 0 lệnh INSERT `permissions` lúc chạy trong
`apps/api/src` ⇒ catalog = ảnh census ⇒ **không** cặp nào đổi blast radius hay cờ sensitive. 7 stub
`sentinelCatalog()` giữ nguyên; `permission.scopes.spec.ts:101-110` vẫn là ca DUY NHẤT đảo nghĩa.

### 15.5 CW-2 — bề mặt FE đo lại [ĐO]

| #      | Điểm                                                                                      | So với §7                                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1–4    | `use-can.ts:16-22` · `:39-41` · `<PermissionGate>` · `hasAnyCapability`                   | Đúng y (0 commit `use-can.ts`). Đếm `grep -F` thô (gồm định nghĩa): 371 · 180 · 97                                                    |
| 5–8    | `createPermissionChecker` tại ProtectedRoute · HomePortal · AppSwitcher · ModuleWorkspace | Vẫn khoá LITERAL, `scopes: []` ⇒ chiều NỚI như §7                                                                                     |
| 9      | `console/src/lib/chat-oversight-gate.ts:33` (`router.tsx:227`)                            | Không đổi (`view:chat-oversight` ∈ 86)                                                                                                |
| **10** | **MỚI** `app/src/layouts/portal/portal-session.ts:27-33` (`f407c1d1`)                     | Điểm `createPermissionChecker` thứ 5, cùng khuôn #5-8 ⇒ chiều NỚI; 0 actor PROD (Q1 = 0)                                              |
| **11** | **MỚI** `HrOverviewRailSlot.tsx:70-86` (`35dbd0cf`) đọc `scopes["read:employee"]`         | Có exact ⇒ không đổi (§6.1 exact thắng); chỉ-wildcard ⇒ hiện với scope wildcard — khớp nhánh non-sensitive của `decideStrongestScope` |

⇒ 0 dòng logic FE đổi; comment chỉ ở `use-can.ts` (+ `module-app-metadata.ts` là BE). `apps/console/**`
**0 dòng cần đổi** dưới CW-2 — nới `paths` chỉ khi FULL gate đòi comment ở #9.

### 15.6 Ca + đột biến thêm (đã ghi vào §9.2/§9.3)

- **#14 sửa** (D-v4-2) · **#24 mới** (D-v4-1, tên ca trung tính: "loại mọi action tiền tố reveal-") ·
  biến thể `read:employee` cho #11.
- Đột biến thứ **12**: thu hẹp `EXCLUDED` về `reveal-secret` (hoặc so khớp đúng 1 cặp) ⇒ giết #24 + #14.

### 15.7 §14 — thứ tự thi công, delta

1 = XONG (15.1) · 2 = việc luồng chính · 3: họ khẳng định vắng-mặt đếm lại **37 dòng `toBe(false)`** (v3 liệt 11 + "…") ·
**4b** sửa `census.sql` 69 → 86 · 5: `capability-exclusion.ts` (D-v4-1) · 6: `capability-projection.ts` +
export `matches` (D-v4-5) · 8: **12** đột biến · 9: thêm ADR-13 §4.1 (D-v4-8) · 10 = việc luồng chính.

- **(v4.1 F9) Bước 10, TRƯỚC `check.sh`:** sau khi rebase lên master mới, đo lại §15.4 — migration mới có seed
  cặp `reveal*` hoặc cặp sensitive mới không. Chuỗi song song có WO được ghi `apps/api/migrations/**`
  (`S20-CHAT-MENTIONALL-1`, `backlog.mjs:25500`) ⇒ claim "0 migration sau 16/10" có thể hết đúng. [ĐO] 0 WO
  `S20-*` có `apps/api/src/permission/**` trong `paths` ⇒ không đụng tệp lõi.
- **(v4.1 F1) Bước 10 — PR chỉ ghi CHỈ SỐ TỔNG HỢP** (§15.9, khối ghi đè).

### 15.8 Lệch trong `backlog.mjs` (luồng chính sửa — WO này không chạm)

- `done_when` "Don dieu … (ca #13)" dùng số ca v2: ở v3 #13 = `EXCLUDED`, đơn điệu = #23 **có điều kiện** T1/T2;
  "(ca doi chung #4/#16)" — đối chứng không-wildcard ở v3 là **#20**.
- `title` "bỏ danh sách tay" ≠ §13 (GIỮ allowlist, dọn ở `S18-AUTH-CAPALLOWLIST-RETIRE-1`).
- **(v4.1 F1)** `done_when` `backlog.mjs:15607` "dan Q0/Q1/Q3/Q4 vao PR (Q4 = danh sach man se hien them)" ⇒ đổi
  thành "ghi CHỈ SỐ TỔNG HỢP Q0–Q6 vào PR, không dán hàng nào" (§15.9-F1) — sửa khi chuyển WO sang `in_progress`.

### 15.9 v4.1 — plan-review 23/10 (PASS_WITH_FIXES) — 9 finding, đã đo lại từng cái trên `b83e5f09`

> **GHI ĐÈ §12 (câu "dán Q0–Q6 vào PR") và §14 bước 10 (F1):** repo PUBLIC ⇒ PR chỉ ghi **chỉ số tổng hợp**
> (Q0 ba số đếm · Q1/Q3 số đếm · Q4 số cặp + số nhóm · Q4a · Q5 số hàng wildcard `is_sensitive=true` · Q6 số
> hàng). **KHÔNG** dán hàng nào của Q1b (tên role · `company_id` · holders, `census.sql:52-54`), Q2 (`user_id` ·
> `company_id`, `census.sql:79`) hay Q4. Chi tiết theo actor ở kênh owner.

| F   | Mức  | Kết luận       | Đo lại (ÁP = đúng ⇒ đã vá; TỪ CHỐI = sai)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ---- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | HIGH | **ÁP**         | §12 `:429-430` + `backlog.mjs:15607` đúng như finding ⇒ khối ghi đè trên + §15.8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F2  | HIGH | **ÁP**         | `permission.service.ts:641` lọc `!g.isSensitive` ⇒ cả 2 cặp `reveal-` vắng sẵn trên master; `/auth/me` gộp `{...allowlisted, ...caps}` (`auth.service.ts:1562`) ⇒ cặp đối chứng thuộc allowlist làm đột biến sống. Vá: §9.2 #13/#24 đổi nhãn; đối chứng `request-break-glass:break-glass` (`0200:207`, sensitive; [ĐO] 0 mục `break-glass` trong allowlist); ca ở mức hàm chiếu; bằng chứng ĐỎ trên trạng thái trung gian v3.                                                                                                                                |
| F3  | MED  | **ÁP**         | ADR-13 `:84-85` định nghĩa theo call-site; `valkey-key.spec.ts:145` dùng action `reveal` (không gạch); `REVEAL_CLASS_PAIRS` rỗng `reveal-class-pairs.ts:39`; [ĐO] 0 call-site khai `requiresReauth: true`/`objectGrantRequired: true` trong `apps/api/src` ngoài spec (5 dòng grep khớp = comment `reveal-class-pairs.ts:9`, `security-policy.controller.ts:21` và trường kết quả `permission.decide.ts:81,142,168`). Vá: #14-(c) + docblock D-v4-1-(i). Ghi chú: `every` trên mảng rỗng = true ⇒ (c) xanh-RỖNG có chủ đích hôm nay, KHÔNG tính vào sàn ≥ 2. |
| F4  | MED  | **ÁP**         | [ĐO] `\breveal[a-z_-]*` trên migrations khớp chữ trong comment ở 0027 · 0074 · 0121 · 0200 · 0201 (gồm `reveal_denied` `0201:13`, `reveal-via-break-glass`, `reveal-path`) · 0320 ⇒ ratchet ngây thơ đỏ trên master. Regex đầu-tuple khớp **đúng 2** (`0005:281`, `0201:23`). Vá: #14-(a)/(b).                                                                                                                                                                                                                                                               |
| F5  | MED  | **ÁP**         | #13/#24 khẳng định vắng ở **4 mặt**: `getCapabilities` · `getCapabilityScopes` · `/auth/me.capabilities` (SAU merge allowlist) · `getMyApps`. Fixture #10 thêm một actor giữ exact `reveal-*` (bắt bản cài đặt áp `EXCLUDED` cho caps mà quên scopes, hoặc ngược lại).                                                                                                                                                                                                                                                                                       |
| F6  | MED  | **ÁP (chỉnh)** | `0569:167-168` + `super-admin-bootstrap.service.ts:39-40,108` đúng. Chỉnh finding: Q5 **không có** trong bản chạy 16/10 ⇒ ghi "CHƯA ĐO", không có số để chép; Q0 có `pairs_wildcard` = 1. §15.1 đã vá.                                                                                                                                                                                                                                                                                                                                                       |
| F7  | LOW  | **ÁP**         | `0201:6-8` + `contracts/src/crypto.ts:107-108`: `reveal-break-glass` ép ở tầng CÔNG TY + grant `active` ở service. Câu ADR-13 §4.1 "can() không bao giờ ALLOW ở tầng công ty" chỉ đúng cho `reveal-secret`. Vá: D-v4-1-(iii) + D-v4-8.                                                                                                                                                                                                                                                                                                                       |
| F8  | LOW  | **ÁP**         | [ĐO] `getCapabilities` hết `:670`, docblock `:672`; `EXCLUDED_PAIRS` `super-admin-bootstrap.service.ts:22`; `matchesCompanyGrant` `permission.decide.ts:59-61`; `use-can.ts` ở `packages/web-core/src/hooks/`; thêm `HrOverviewRailSlot.tsx:73`. Vá: §15.2 + D-v4-5.                                                                                                                                                                                                                                                                                         |
| F9  | LOW  | **ÁP**         | `backlog.mjs:25500` thuộc `S20-CHAT-MENTIONALL-1` (id `:25469`). Vá: §15.7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

0 finding bị từ chối.

---

**Liên quan:** `DECISIONS-13` · `DECISIONS-12` · `docs/plans/S14-SEC-DASHGATE-WILDCARD-1.md` ·
`docs/plans/S14-SEC-CATALOGSNAP-HARDEN-1.md` · memory `capability-allowlist-hides-admin-screens` ·
`superadmin-not-a-canonical-role` · `permission-grant-census-must-cover-four-wildcard-shapes` ·
`test-fixture-stamps-global-permission-catalog` · `empty-success-is-the-fail-open-shape` ·
`tests-can-pin-a-hole-open` · `same-builder-twice-makes-unit-spec-vacuous` ·
`cache-breaks-two-source-flag-invariants` · `classifier-blocks-prod-db-from-agent` ·
`red-zone-wo-cost-profile`.
