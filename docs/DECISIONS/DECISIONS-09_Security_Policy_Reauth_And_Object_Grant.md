# DECISIONS-09 — `requiresReauth` trên route SINGLETON: bỏ cờ, KHÔNG nới engine (KI-065)

| | |
| --- | --- |
| **Trạng thái** | 🟢 **ĐÃ CHỐT 2026-08-19** — thi hành trong WO `S10-QA-SECPOLICY-GATE-1` |
| **Ngày** | 2026-08-19 |
| **Bối cảnh** | `PATCH /api/v1/settings/security-policy` trả 403 `deny-object-required` cho **mọi** actor từ khi ra đời (2026-07) tới 14/08/2026 — KI-065, RELEASE-02 |
| **Vùng** | 🔴 ĐỎ — chạm cấu hình cổng quyền của một route nhạy cảm (permission/auth) |
| **Phạm vi** | Decorator của một route + allowlist CỜ HIỂN THỊ (§3b) + cổng test. **KHÔNG** sửa `permission.decide.ts`, `permission.guard.ts`, migration hay seed quyền |

---

## 1. Vấn đề — một cấu hình BẤT KHẢ THI, hỏng im lặng

`permission.decide.ts:93` định nghĩa lớp "reveal-secret":

```ts
const needsObjectGrant = objectGrantRequired ?? (isSensitive && requiresReauth);
```

Route nào khai **cả hai** cờ đó sẽ đòi một **object-level ALLOW** gắn với `resourceId` cụ thể, **và**
một cửa sổ re-auth còn hạn. `SecurityPolicyController` khai đúng cả hai — nhưng:

1. Route là **singleton** (1 hàng chính sách / công ty), **không có `:id`**. `PermissionGuard` lấy
   `resourceId = req.params?.id ?? null` ⇒ luôn `null` ⇒ **object-tier không bao giờ chạy** ⇒
   `deny-object-required` vĩnh viễn.
2. Toàn bộ `apps/api/src` **không có một chỗ nào GHI `req.reauthContext`** (đo bằng grep 19/08/2026:
   chỉ có nơi ĐỌC ở `permission.guard.ts:21,124` + một spec tự dựng). Tức **không tồn tại step-up
   thật** ⇒ `isReauthValid()` luôn false ⇒ kể cả có object grant vẫn `deny-reauth-required`.

Hỏng **đúng chiều an toàn** (403, fail-closed) nên **không phải lỗ bảo mật** — và cũng chính vì thế
nó không ném exception, không log lỗi, không có cảnh báo nào. Hậu quả thật: màn hình console
`settings/security-policy` (ép 2FA · giới hạn IP · khung giờ · domain email) **không lưu được gì**;
mọi thay đổi phải sửa thẳng DB `company_security_policies` (đúng cách đã phải làm ở KI-027).

> Cờ `requiresReauth` ở đây **không do SPEC yêu cầu** (`grep` docs/spec: 0 hit) — nó là lựa chọn tự
> phát của lane CS-9, ghi trong docblock là "mirror reveal-secret".

---

## 2. Hai hướng vá đã cân nhắc

**(b) Coi singleton là resource** — lấy `companyId` làm `resourceId` **và** gán `req.reauthContext`
ở một guard step-up. Bị loại vì:

- đòi **xây mới cơ chế step-up thật** (endpoint xác thực lại + guard ghi cửa sổ + luồng FE) — đó là
  một tính năng, không phải bản vá; làm nửa vời (gán `reauthContext` cho đủ điều kiện) là **cửa sau
  giả**: hệ thống tuyên bố "đã xác thực lại" trong khi không ai xác thực lại;
- buộc mỗi công ty phải có một hàng `object_permissions` trỏ vào chính `companyId` của mình — cấp
  phát vô nghĩa về nghiệp vụ, lại mở thêm một đường thao tác object-grant mới cho một singleton;
- muốn "cho nhanh" thì phải sửa `needsObjectGrant` — tức **nới cổng object-grant của MỌI route nhạy
  cảm khác**, đúng kiểu leo thang mà bài học `reviewer-proposed-fix-can-open-holes` cảnh báo.

**(a) Bỏ `requiresReauth` khỏi decorator, giữ `isSensitive`** — ĐƯỢC CHỌN.

---

## 3. Quyết định

1. `PATCH /settings/security-policy` khai `@RequirePermission("configure-security-policy", "company",
   { isSensitive: true })` — **không** `requiresReauth`.
2. **Không sửa một dòng nào** của `permission.decide.ts` / `permission.guard.ts`. Ngữ nghĩa
   `needsObjectGrant` / `requiresReauth` giữ NGUYÊN cho lớp reveal-secret.
3. Ý định "đổi chính sách bảo mật nên cần xác thực lại" **không bị vứt bỏ**: seed WO
   `S10-AUTH-STEPUP-1` (xây step-up thật, rồi mới gắn lại cờ). Đây là **hạn gỡ tường minh**, không
   phải một dòng TODO (`known-issue-workaround-may-never-have-run`).

### Cái gì CÒN được bảo vệ sau quyết định này

| Lớp | Trạng thái |
| --- | --- |
| Phải đăng nhập + đúng công ty | ✅ `JwtAuthGuard` + `CompanyGuard` (companyId lấy từ JWT, KHÔNG từ body/param) |
| Phải có quyền `configure-security-policy:company` | ✅ `PermissionGuard` |
| Wildcard `*:*` (kể cả super-admin) **KHÔNG đủ** | ✅ cổng nhạy cảm của `decideCan` (`isSensitive` còn nguyên) |
| Ghi audit `security_policy.updated` (before/after, cùng tx) | ✅ `SecurityPolicyService.updatePolicy` |
| Chống tự-khoá (BẤT BIẾN #4): người gọi PATCH luôn vào exempt-list | ✅ giữ nguyên |
| Bắt buộc xác thực lại (step-up) | ❌ **chưa có** — và trước quyết định này cũng chưa từng có; cờ cũ chỉ tạo ảo giác |

---

## 3b. Nửa thứ hai của cùng tính năng: cờ hiển thị (phát hiện khi vá, đã vá luôn)

Vá route ở BE **chưa đủ để tính năng dùng được**. Đo 19/08/2026:

- `configure-security-policy:company` có `is_sensitive = true` trong catalog (đo thẳng DB), và
  `getCapabilities()` **lọc bỏ toàn bộ cặp sensitive** — chỉ cặp nằm trong
  `SENSITIVE_CAPABILITY_ALLOWLIST` mới được `getAllowlistedSensitiveCapabilities()` trả về `/auth/me`.
- Cặp này **không nằm trong allowlist**, và trong catalog **không có hàng wildcard `*:*` nào**
  (đo: `select … where action='*' or resource_type='*'` ⇒ 0 hàng) ⇒ kể cả fallback wildcard của
  `useCan` cũng không cứu.
- Kết quả: `apps/console/src/routes/settings/security-policy.tsx` render `EmptyState "không có quyền"`
  cho **chính company-admin** — vai DUY NHẤT được cấp cặp này (đo: `roles ⋈ role_permissions ⋈
  permissions` chỉ trả một hàng `company-admin/ALLOW`).

Đây là lần lặp **thứ 9+** của lớp lỗi `capability-allowlist-hides-admin-screens`. Vì cùng một tính
năng, vá luôn trong WO này thay vì mở KI thứ hai:

1. APPEND `"configure-security-policy:company"` vào `SENSITIVE_CAPABILITY_ALLOWLIST` **và**
   `SENSITIVE_SCREEN_GATE_PAIRS` (test khoá `sensitive-screen-gate-allowlist.spec.ts` ép cặp gác màn
   phải có trong allowlist). Allowlist chỉ là **CỜ HIỂN THỊ** — enforcement vẫn là `PermissionGuard`
   per-resource + RLS; wildcard KHÔNG kế thừa.
2. Màn console chuyển `useCan` → **`useCanExact`**: với cặp sensitive, `useCan` rơi xuống `*:*` nên sẽ
   mở màn cho một actor mà BE chắc chắn trả 403 `deny-sensitive` (FE-permit/BE-403).
3. Ca đo trong int-spec: `/auth/me` của actor có grant **phải** chứa cặp; actor không grant **phải**
   vắng (grant-bound, không phải cờ bật-cho-mọi-người).

---

## 4. Hàng rào đi kèm (để bẫy này không tái sinh)

1. `apps/api/test/foundation/reauth-reachability.e2e-spec.ts` — census runtime: route khai
   `requiresReauth` mà (i) không có `:param`, hoặc (ii) trong `src/**` không có nơi nào **GHI**
   `reauthContext` ⇒ **ĐỎ**. Cổng **tự nhả** khi step-up thật ra đời (đo bằng sự tồn tại của writer,
   không phải allowlist tên route). Có ca thử-ngược chứng minh cổng không rỗng.
2. `apps/api/src/security-policy/security-policy.permission-contract.spec.ts` — nạp **metadata thật**
   của decorator vào `decideCan`: ALLOW đúng cặp ⇒ allow; chỉ wildcard ⇒ `deny-sensitive`; không grant
   ⇒ `deny-sensitive`. Kèm hồi quy: route reveal-class **có** `:id` vẫn `deny-object-required`.
3. `apps/api/test/integration/security-mailconfig-http.int-spec.ts` — ca ghim 403 cũ đã **LẬT** sang
   ALLOW 2xx thật + DENY thật + cross-tenant + audit, chạy qua HTTP thật ở `LANE_DB`.

---

## 5. Khi nào xem lại

Khi `S10-AUTH-STEPUP-1` hoàn thành (có endpoint/guard GHI `req.reauthContext` thật). Lúc đó:
gắn lại `requiresReauth: true` **chỉ khi** route đã có `resourceId` hợp lệ để object-tier chạy, hoặc
sau khi engine có khái niệm "singleton resource" được thiết kế tường minh — và phải kèm ADR mới, vì
đó là thay đổi ngữ nghĩa của `needsObjectGrant`.

> **CẬP NHẬT 2026-08-20 — §5 đã có câu trả lời: đọc tiếp §6.** `S10-AUTH-STEPUP-1` vào thi công với
> thiết kế chốt ở **§6** dưới đây. §6 **KHÔNG** gắn lại `requiresReauth` cho route nào — kể cả
> `PATCH /settings/security-policy`, vẫn chưa đủ điều kiện (§6 điểm 5) — nó chỉ xây NĂNG LỰC còn thiếu
> và chốt tường minh **điều kiện** để một route được phép khai lại cờ.

---

## 6. Step-up THẬT: thiết kế chốt (ADR nối tiếp §5 — `S10-AUTH-STEPUP-1`)

| | |
| --- | --- |
| **Trạng thái** | 🟡 **CHỐT THIẾT KẾ 2026-08-20** — lane L1..L4 chỉ được chạy SAU khi người chốt vùng đỏ duyệt §6 |
| **Vùng** | 🔴 ĐỎ / crown-jewel — auth + permission engine. FULL gate (security + database + silent-failure + santa-method + quality-gate) |
| **Phạm vi** | Xây NĂNG LỰC step-up + cổng chống tái diễn. **KHÔNG** gắn `requiresReauth` lên route sản phẩm nào; **KHÔNG** migration (head giữ `0546_s7calldb1_chat_calls.sql`) |
| **Đo trên** | worktree `auto/S10-AUTH-STEPUP-1`, gốc master `4f1c2ed2` (sau `a38036b1` = S10-FND-VALKEYSCOPE-2) |

Mười một quyết định dưới đây là **hợp đồng thi công**: mỗi điểm một câu quyết định + hệ quả phải nói ra.
Mọi số dòng trích dẫn đều **đo lại tay trên cây này**, không chép lại từ plan.

### (1) Cơ chế = cửa sổ lưu PHÍA SERVER khoá theo bộ-5 — không token client, không cờ session

**Quyết định:** step-up cấp một _cửa sổ_ **lưu ở server**, khoá bằng bộ-5
`(companyId, userId, action, resourceType, resourceId)`, TTL ngắn (`STEP_UP_TTL_SEC` — có `.default()`
**và** `.max()`); `ReauthGuard` chỉ **ĐỌC** cửa sổ đó.

- **Cấm** ba hình dạng khác: token bearer do client giữ (client tự trình = tự cấp quyền); cờ session
  toàn cục kiểu `session.reauthedAt` (một lần xác thực mở **mọi** đối tượng); claim trên JWT (không
  thu hồi được trước hạn, và access token không được đúc lại giữa luồng).
- Khoá đi qua builder `stepUpKey()` trong `apps/api/src/common/valkey/valkey-key.ts` nên **bắt buộc
  mang `envScope`** (KI-067):
  `stepup:{envScope}:{companyId}:{userId}:{action}:{resourceType}:{resourceId}`.
- Hệ quả **cố ý**: cửa sổ của user A không mở cho user B; cửa sổ cấp cho object X không mở object Y;
  cross-tenant bất khả — cả ba là **thành phần của khoá**, không phải một phép kiểm tra thêm có thể quên.

### (2) D1 — chỉ TOTP, qua đường verify THUẦN tự viết; CẤM `verifyChallenge`

**Quyết định:** step-up xác thực **chỉ bằng TOTP**, qua một method **MỚI** (nạp `user_totp` → giải mã
secret bằng KEK → `TotpService.verify` → claim replay bằng **marker RIÊNG** `stepup-totp`);
**TUYỆT ĐỐI KHÔNG gọi `TwoFactorService.verifyChallenge`**.

Đo lại `apps/api/src/auth/two-factor.service.ts` (`verifyChallenge` mở ở dòng 264):

- nhánh TOTP **ĐÚNG** gọi `replayGuard.claim("totp-step", …)` — **marker của luồng LOGIN** ⇒ mã vừa dùng
  đăng nhập trong cùng time-step 30s sẽ bị coi là SAI khi step-up, và ngược lại (nguồn flake chắc chắn);
- nhánh TOTP **SAI** rơi thẳng xuống `update(userRecoveryCodes).set({ usedAt: new Date() })` ⇒ một lượt
  step-up **có thể ĐỐT recovery code** của người dùng (D2: đường code mới không được chạm bảng này).

`stepup-totp` là phần tử **MỚI** của union đóng `ReplayMarker` (valkey-key.ts:60 — không APPEND thì
không compile). Sau `a38036b1`, `ReplayGuardService.claim()` chỉ còn **một** `setNx` và danh sách miễn
trừ legacy đã bị gỡ (đo: `grep -rn LEGACY_UNSCOPED apps/api/src` = 0 kết quả) ⇒ marker mới **không còn**
nguy cơ ghi khoá unscoped. `verifyChallenge` **giữ nguyên từng dòng**; spec 2FA cũ phải xanh không sửa.

### (3) Chưa bật TOTP ⇒ không mint được, và nói rõ bằng mã lỗi

**Quyết định:** `POST /api/v1/auth/step-up` của user chưa enroll TOTP trả **HTTP 409** +
`code: "AUTH-ERR-STEP-UP-2FA-REQUIRED"`, message _"Bạn cần bật xác thực 2 bước (2FA) trước khi xác thực
lại."_ — **KHÔNG 403 câm, KHÔNG 500**.

- **Đẻ mã mới là bắt buộc, không phải lười tra cứu:** đo `docs/spec/**` + `docs/API Design/**` ⇒ **không
  tồn tại** slug `AUTH-ERR-*` nào cho "chưa bật 2FA". Mã sẵn có gần nhất là `TWO_FACTOR_SETUP_REQUIRED`
  (two-factor-enforcement.guard.ts:22) nhưng mang nghĩa **KHÁC** — "công ty/vai trò **ÉP** bạn enroll" —
  dùng lại sẽ nói dối FE ở công ty không ép 2FA.
- `AllExceptionsFilter` ưu tiên `payload.code` (all-exceptions.filter.ts:86-90) ⇒ 409 vẫn ra đúng mã,
  không rơi về `RESOURCE-ERR-CONFLICT`.
- **Mã TOTP sai ⇒ 400** `AUTH-ERR-STEP-UP-INVALID-CODE`, **KHÔNG 401**. Lý do đo được:
  `packages/web-core/src/lib/api-client.ts:405` bắt 401 của request authed → refresh single-flight →
  **REPLAY request đúng 1 lần** ⇒ một lần gõ sai sẽ tự động tiêu **hai** lượt rate-limit và ghi **hai**
  hàng audit, ở đúng endpoint vốn là oracle TOTP.
- **Cặp ngoài registry ⇒ 400** `AUTH-ERR-STEP-UP-PAIR-NOT-ALLOWED`. **Bucket đang khoá ⇒ 429** dùng mã
  nền `SYSTEM-ERR-RATE-LIMIT` (không đẻ mã mới cho 429).

### (4) D3 — registry `REVEAL_CLASS_PAIRS` khởi tạo RỖNG, sống trong `src`, là DEFAULT của một DI token

**Quyết định:** `export const REVEAL_CLASS_PAIRS: readonly RevealClassPair[] = []` nằm trong
`apps/api/src/auth/step-up/reveal-class-pairs.ts`, và là **giá trị DEFAULT** của một DI token; endpoint
step-up **đọc token**, cổng test **import CÙNG const** — một nguồn, hai đầu đọc.

- Spec ghim `REVEAL_CLASS_PAIRS.length === 0` **và** `default provider === REVEAL_CLASS_PAIRS` so bằng
  **identity** (không deep-equal — deep-equal cho phép fork ngầm một bản sao rỗng).
- **Hệ quả tường minh, là trạng thái ĐÚNG:** ở PROD hôm nay **không cặp nào mintable**; `POST /auth/step-up`
  tồn tại nhưng **luôn** trả 400 `AUTH-ERR-STEP-UP-PAIR-NOT-ALLOWED`. Đây không phải lỗi cần "vá cho
  chạy" — đó là cổng chống tái diễn KI-065: chừng nào chưa ai thêm cặp vào registry thì **không route nào**
  được phép khai `requiresReauth`.
- Int-spec mint được cửa sổ bằng `overrideProvider(token).useValue([cặp test])` — **không** nới const thật.

### (5) Điều kiện để THÊM một cặp về sau (ba điều kiện, đủ cả ba)

**Quyết định:** một cặp `(action, resourceType)` chỉ được APPEND vào `REVEAL_CLASS_PAIRS` khi route tiêu
thụ nó thoả **đồng thời**: (a) có đúng segment `:id` trong path — `PermissionGuard` lấy
`resourceId = req.params?.id ?? null` (permission.guard.ts:119); (b) có `ReauthGuard` chạy **TRƯỚC**
`PermissionGuard` theo đúng nghĩa §6 điểm (8); (c) có **đường cấp object grant thật** (`object_permissions`
trỏ vào chính `resourceId` đó, cấp qua nghiệp vụ chứ không phải INSERT tay).

**`PATCH /settings/security-policy` VẪN chưa đủ điều kiện** — nó là singleton, không có `:id` (§2), nên
kể cả sau khi step-up ra đời vẫn hỏng ở (a). Muốn gắn lại cờ cho nó thì phải có ADR riêng cho khái niệm
"singleton resource", vì đó là **đổi ngữ nghĩa `needsObjectGrant`** (§5) — không phải việc của WO này.

### (6) 🚩V2-BLOCK#5 — NGỮ NGHĨA CỬA SỔ: **DÙNG-LẠI-ĐƯỢC trong TTL, TTL TUYỆT ĐỐI (không sliding)**

**Quyết định:** một cửa sổ đã cấp **dùng lại được nhiều lần** cho tới khi hết TTL; **đường ĐỌC KHÔNG gia
hạn TTL** dưới bất kỳ hình thức nào.

- **Vì sao không single-use:** khoá đã hẹp tới đúng một `(hành động, đối tượng)`; một thao tác UI thường
  đẻ >1 request (ghi rồi refetch, hoặc replay sau 401 như đo ở điểm 3) ⇒ single-use sẽ hỏng ngay ở lần
  dùng thật đầu tiên và đẩy người dùng vào vòng nhập TOTP liên tục. Bán kính nổ của "dùng lại" đã bị bộ-5
  chặn: không mở được đối tượng khác, người khác, công ty khác, hành động khác.
- **Ràng buộc bắt buộc đi kèm:** đường đọc là **đọc thuần** — `GET` (Valkey) hoặc đọc Map (memory).
  **CẤM** `SET` / `EXPIRE` / `TOUCH` / `GETEX` / ghi lại entry trong `getValidWindow()`. Không có ràng buộc
  này, sliding-window biến một TTL 5 phút thành **phiên step-up vô hạn** cho ai còn gõ tiếp.
- **Nghiệm thu bám ĐÚNG lựa chọn này** (L3/L4 không được chọn khác):
  1. ca _"đọc window 2 lần trong TTL, lần 2 VẪN hợp lệ"_;
  2. ca _"đường ĐỌC không gia hạn TTL"_ — đo bằng store stub: sau `getValidWindow()`, **không** có lời gọi
     `set`/`expire` nào và giá trị expiry đọc lại **y hệt** giá trị lúc mint;
  3. ca _"hết TTL ⇒ null ⇒ `deny-reauth-required`"_.

### (7) 🚩V2-BLOCK#1 — đường GHI khi mất Valkey: rẽ nhánh theo `isEnabled()`, KHÔNG suy từ `set()`

**Quyết định:** nhánh lưu chọn theo `valkey.isEnabled()` (mẫu `login-rate-limiter.ts:117`,
`replay-guard.service.ts:52`); **TUYỆT ĐỐI không suy ra "đã ghi" từ giá trị trả về của
`ValkeyService.set()`**.

Đo `apps/api/src/permission/valkey.service.ts:99`: `set()` có `if (!this.client) return true;` — nghĩa là
ở môi trường **thiếu `VALKEY_URL`** nó trả `true` **mà không ghi gì**. Ai viết
`if (!(await valkey.set(...))) throw` sẽ thấy `true`, trả 200 kèm `reauthValidUntil`, trong khi cửa sổ
**không nằm ở đâu cả** ⇒ guard đọc null ⇒ 403 CÂM = KI-065 nguyên xi.

Hình dạng bắt buộc của đường ghi (L2 hiện thực đúng hình này; `grep` phải **không** thấy mẫu
`if (!(await …set(…)))` trong `apps/api/src/auth/step-up`):

- `valkey.isEnabled() === true` ⇒ gọi `set()`, **gán kết quả vào một biến có tên** rồi mới kiểm; biến
  `false` = outage thật ⇒ ném lỗi hạ tầng tường minh (**503**, mã nền `SYSTEM-ERR-001`) — **không** rơi
  xuống memory, vì ở deployment nhiều instance, memory của instance A vô hình với instance B ⇒ đúng cái
  bẫy "200 nhưng 403 vĩnh viễn" vừa nói.
- `isEnabled() === false` (Valkey **chưa cấu hình**: dev/test/single-instance) ⇒ **fallback memory
  per-process** tôn trọng TTL, theo khuôn `ReplayGuardService`.
- **Đường ĐỌC rẽ theo CÙNG một nhánh** — ghi memory mà đọc Valkey (hoặc ngược lại) là deny vĩnh viễn.
- **Hệ quả nhiều-instance phải nói ra:** chạy >1 instance API **không** có `VALKEY_URL` ⇒ cửa sổ mint ở
  instance A vô hình ở instance B ⇒ **deny** (fail-closed — mất tiện, **không** mất an toàn). Luật vận
  hành: PROD/dev-online **phải** có `VALKEY_URL`.
- **Đường ĐỌC mất Valkey ⇒ không có cửa sổ ⇒ deny.** Fail-closed là hành vi ĐÚNG, không được châm chước.

### (8) 🚩V2-BLOCK#4 — THỨ TỰ guard là một phần của hợp đồng, không phải chi tiết triển khai

**Quyết định:** `ReauthGuard` **PHẢI chạy trước** `PermissionGuard`; dạng chuẩn là khai **cùng một tầng,
đúng thứ tự**: `@UseGuards(ReauthGuard, PermissionGuard)`.

Đo thẳng `@nestjs/core@11.1.24` — `helpers/context-creator.js`, `createContext()` trả
`[...global, ...class, ...method]`, và `GuardsConsumer` duyệt mảng theo thứ tự ⇒ **hai** cấu hình đều SAI
dù cả hai guard đều "tồn tại":

- `@UseGuards(PermissionGuard, ReauthGuard)` cùng cấp — sai thứ tự khai;
- `PermissionGuard` ở **cấp CLASS** + `ReauthGuard` ở **cấp ROUTE** — class luôn chạy trước route.

Cả hai cho 403 vĩnh viễn **trong khi cổng chỉ-kiểm-tồn-tại vẫn XANH**. Vì thế lý do `no-reauth-guard`
của `findUnreachableReauthRoutes` phải **đo VỊ TRÍ** trong `[...classGuards, ...routeGuards]`
(route-census.ts:151,186-187 đã tách theo tầng và giữ thứ tự), ghim bằng `ReauthGuard.name` — **không**
literal chuỗi (`index-ratchet-must-pin-definition-not-name`) — và có ca thử-ngược ĐỎ cho **cả hai** cấu
hình sai ở trên.

### (9) Rate-limit: khoá `(companyId|userId)` lấy TỪ JWT, bucket TÁCH HẲN khỏi login

**Quyết định:** khoá là `rlKey("stepup", companyId + "|" + userId)` ⇒
`rl:{envScope}:stepup:{companyId}|{userId}`, với `companyId`/`userId` lấy **từ JWT**; `"stepup"` là phần
tử MỚI của union đóng `RlBucket` (valkey-key.ts:49-57), **tách hẳn** `rl:…:ip` / `rl:…:acct` của login.

- **CẤM nhúng `ip`:** sau cloudflared mọi `req.ip` = `::1` (KI-066) ⇒ "per-IP" thoái hoá thành bucket
  **toàn công ty** — một người gõ sai khoá step-up của tất cả.
- **CẤM nhúng `email`:** mở đường quấy rối victim (khoá người khác bằng cách gõ sai tên họ).
- Thứ tự bắt buộc trong service: Zod → cặp ∈ registry → **`isLocked()` TRƯỚC khi verify** (đang khoá ⇒ từ
  chối, spy `verify` gọi **0 lần**) → verify → sai: `recordFailure` + audit; đúng: `reset(key)` + cấp cửa sổ.
- `STEP_UP_MAX_ATTEMPTS` và `STEP_UP_TTL_SEC` đều có `.default()` **và** `.max()` trong `env.schema.ts`
  (`env-schema-floor-breaks-test-fixtures`: biến mới không default từng giết fixture int-spec).

### (9b) AMENDMENT 2026-08-20 (`FIX-1-BE-STEPUP-FLOOD`) — khoá đứng ĐẦU TIÊN, và mọi nhánh ghi vết phải bồi bucket

> **APPEND, không viết lại (9).** Câu "Thứ tự bắt buộc trong service" ở điểm (9) được **SIẾT** bởi mục
> này; khi hai chỗ khác nhau, **(9b) là thứ tự hiện hành**. (9) vẫn đúng ở phần nó nói: `isLocked()`
> đứng **trước** verify — (9b) chỉ đẩy nó lên thêm một nấc.

**Lỗ đã đo (A09 — Logging Failures, MEDIUM).** Bản đầu đặt cổng registry **trước** `isLocked()`, và
nhánh registry (`step-up.service.ts` cũ :103-109) cùng nhánh `not-enrolled` (:124-130) mỗi lượt ghi
1 hàng `audit_logs` + 1 hàng `user_security_events` rồi ném, **không** gọi `recordFailure()`. Vì registry
hôm nay **RỖNG** theo D3, **mọi** lời gọi đi đúng đường đó; `app.module.ts` không có throttler toàn cục
(chỉ `JwtAuthGuard` · `CompanyGuard` · `TwoFactorEnforcementGuard`). Hệ quả: một tài khoản **đã đăng
nhập bất kỳ** bồi được **vô hạn** hàng vào hai bảng **append-only không xoá được** — vừa phình lưu trữ,
vừa chôn tín hiệu `STEP_UP_FAILED` thật dưới nhiễu.

**Thứ tự HIỆN HÀNH (thay cho dòng thứ-tự ở (9)):**

```text
Zod (ranh giới)
  → isLocked(bucketKey)          ← ĐẦU TIÊN. Đang khoá ⇒ 429 NGAY, KHÔNG chạm DB, verify gọi 0 lần.
  → cặp ∈ REVEAL_CLASS_PAIRS     ← ngoài registry ⇒ recordFailure + audit `Denied` + STEP_UP_FAILED
  → verify TOTP THUẦN
      · not-enrolled ⇒ recordFailure + audit `Denied` + 409 AUTH-ERR-STEP-UP-2FA-REQUIRED
      · sai          ⇒ recordFailure + audit `Failure` + 400 AUTH-ERR-STEP-UP-INVALID-CODE
      · đúng         ⇒ reset(key) + cấp cửa sổ + audit `Success` + STEP_UP_GRANTED
```

**Hai nửa của bản vá, và vì sao cần CẢ HAI:**

1. **`isLocked()` lên đầu.** Chỉ bồi bucket thôi thì chưa đủ: khi đã khoá, nhánh khoá cũ vẫn ghi 1 hàng
   cho **mỗi** request ⇒ đường bồi chỉ đổi nhãn (`PAIR_NOT_ALLOWED` → `429`) chứ không đóng. Nay nhánh
   khoá ghi **0 hàng**.
2. **`recordFailure(bucketKey, STEP_UP_MAX_ATTEMPTS)` ở CẢ nhánh registry-denied LẪN not-enrolled.** Chỉ
   đẩy `isLocked()` lên đầu thôi cũng chưa đủ: không nhánh nào bồi bucket thì khoá **không bao giờ**
   đóng. Quy tắc rút ra, áp cho mọi nhánh tương lai: **nhánh nào ghi hàng append-only, nhánh đó phải trả
   giá bằng một lần bồi bucket.** `recordFailure` gọi **TRƯỚC** khi ghi, để lỗi hạ tầng ở đường ghi
   không biến thành đường chạy vô hạn.

**Trần lưu trữ sau vá:** `STEP_UP_MAX_ATTEMPTS` hàng (mặc định 5) mỗi cửa sổ khoá `LOGIN_LOCKOUT_SEC`
(mặc định 900s) mỗi `(companyId,userId)` — thay cho vô hạn.

**Nhánh khoá ghi 0 hàng KHÔNG phải là mất vết** (nếu không thì đây lại là A09 theo chiều ngược): chính
`STEP_UP_MAX_ATTEMPTS` lượt dựng nên cái khoá đó đều **đã** có hàng `audit_logs` + `user_security_events`.
Hàng thứ N+1, N+2, … không mang thêm thông tin nào, chỉ mang thêm dung lượng.

**Không mở đường quấy rối:** bucket khoá theo `(companyId|userId)` lấy **từ JWT** (giữ nguyên (9) và
BLOCK#6) ⇒ kẻ bồi chỉ tự khoá **chính mình**; không có tham số nào của request chọn được nạn nhân khác.
Có ca đo: actor thứ hai cùng công ty vẫn step-up bình thường trong lúc bucket kia đang khoá.

**Đo bởi (RED trước):** `step-up.service.spec.ts` — khoá THẮNG registry (429 chứ không 400, verify 0
lần) · nhánh khoá gọi 0 lần `audit.record`/`securityEvents.record`/`withTenant` · registry-denied và
not-enrolled đều `recordFailure(bucket, STEP_UP_MAX_ATTEMPTS)` · bucket **có trạng thái** lặp N+2 lượt ⇒
đúng N hàng rồi dừng. `step-up-reauth.int-spec.ts` (HTTP thật, DB cô lập) — lặp cặp-ngoài-registry N lượt
⇒ N hàng, lượt N+1/N+2 ⇒ 429 và `count(*)` **trước/sau bằng nhau**.

**Ca cũ đổi CÓ CHỦ ĐÍCH (không xoá):** ca "bucket ĐANG KHOÁ" trước đây assert nhánh khoá **có** ghi
audit; nay assert nó **không** ghi. Đây là mặt lật của cùng phép đo, ghi lại ở đây để người sau không
"sửa lại cho giống ADR cũ".

### (9c) Ghi nhận: `audit_logs.object_id` của hàng step-up là UUID do CALLER chọn

`object_id` = `resourceId` lấy thẳng từ body (`step-up.service.ts`), **không** kiểm quan hệ sở hữu.
**Đúng thiết kế** — cửa sổ tự nó KHÔNG cấp quyền gì; `permission.decide.ts` vẫn đòi object grant ở
Tier-3 (ca `uNoObject` của int-spec chứng minh: có cửa sổ hợp lệ + ALLOW cấp công ty vẫn ra
`deny-object-required`). Hệ quả cần biết: một hàng audit step-up **có thể** trỏ tới đối tượng mà actor
không có liên hệ nào — hàng đó nói "ai đó đã xác thực lại và tự khai một UUID", không nói "ai đó chạm
được đối tượng đó".

⚠️ **Khi duyệt CẶP ĐẦU TIÊN vào `REVEAL_CLASS_PAIRS`** (điều kiện ở điểm (5)): cân nhắc ghi kèm vào
metadata một cờ **"đã/chưa có object grant"** tại thời điểm step-up, để hàng audit tự nói được điều đó
mà người đọc log không phải tự join sang `object_permissions`.

### (10) Audit CẢ HAI nhánh + dual-write `user_security_events` — KHÔNG migration

**Quyết định:** mọi lượt step-up (đúng **và** sai) ghi một hàng `audit_logs` + một hàng
`user_security_events` **trong cùng transaction**; **không thêm migration nào** (head giữ
`0546_s7calldb1_chat_calls.sql`).

- `action` theo tiền tố module: `auth.step_up_granted` / `auth.step_up_failed` / `auth.step_up_denied`.
- `objectType: "auth"` — **đã** nằm trong `AUDIT_OBJECT_TYPES` và trong CHECK của `audit_logs` ⇒ **không**
  chạm CHECK (`audit-check-union-parse-anchor-trap`).
- `objectId = resourceId`; cột `audit_logs.object_id` là **uuid** ⇒ Zod bắt buộc `z.string().uuid()`, nếu
  không thì 22P02 và (theo `drizzle-wraps-pg-error-code-in-cause`) ra **500 chứ không phải 400**.
- `resultStatus ∈ Success | Failure | Denied` — cột có sẵn từ mig 0432.
- `user_security_events.event_type` là `text` **không CHECK** (mig 0443) ⇒ mã sự kiện mới chỉ cần APPEND ở
  `packages/contracts` + gán severity trong `SECURITY_EVENT_SEVERITY` (Record exhaustive ⇒ quên gán là
  typecheck ĐỎ, không phải lỗi runtime).
- **Metadata sạch:** chỉ `action` / `resourceType` / `resourceId` / `reauthValidUntil`. Cấm mã TOTP,
  secret, recovery code, hash (BẤT BIẾN #3). Bảng audit **append-only** — không UPDATE/DELETE.
- Nhánh Zod trượt (`resourceId` không phải UUID) bị chặn ở **ranh giới** ⇒ **không** hàng audit, **không**
  cửa sổ (có ca đếm trước/sau).

### (11) CẤM tường minh (vi phạm bất kỳ dòng nào = BLOCK, không thương lượng)

1. Sửa `needsObjectGrant` (permission.decide.ts:93) hoặc bất kỳ dòng nào của `permission.decide.ts` /
   `permission.guard.ts` — `git diff --stat` hai file đó phải **RỖNG**.
2. Gán `req.reauthContext` ở interceptor, middleware, hoặc **vô điều kiện** ở bất kỳ đâu. **Writer duy
   nhất** là `apps/api/src/permission/guards/reauth.guard.ts`, và chỉ ghi khi store trả cửa sổ còn hạn.
3. Gọi `TwoFactorService.verifyChallenge` hoặc chạm bảng `user_recovery_codes` từ đường step-up.
4. Dùng lại marker replay `totp-step`, hoặc dùng chung bucket `rl:…:ip` / `rl:…:acct` của login.
5. **Dựng lại đường ghi khoá Valkey legacy unscoped** mà `a38036b1` (S10-FND-VALKEYSCOPE-2 · KI-067) vừa
   gỡ — kể cả "cho tương thích".
6. Gắn `requiresReauth` lên **bất kỳ route sản phẩm nào**, hoặc thêm cặp vào `REVEAL_CLASS_PAIRS`, trong
   WO này.
7. Nới `MAX_UNCOVERED_HIGH_RISK` / `MIN_COVERED_COUNT`, nới điều kiện `:id` của cổng, hay thêm miễn trừ
   mới vào census khoá Valkey.
8. `@ts-ignore` / `eslint-disable` / `catch` rỗng để làm xanh build.

### Khi nào xem lại §6

Khi có **nhu cầu nghiệp vụ thật** cần một route đòi xác thực lại. Lúc đó: kiểm ba điều kiện ở điểm (5),
APPEND cặp vào `REVEAL_CLASS_PAIRS`, gắn cờ + `@UseGuards(ReauthGuard, PermissionGuard)` đúng thứ tự
(điểm 8), và mở WO riêng — cổng `reauth-reachability` sẽ ĐỎ nếu thiếu bất kỳ mảnh nào.
