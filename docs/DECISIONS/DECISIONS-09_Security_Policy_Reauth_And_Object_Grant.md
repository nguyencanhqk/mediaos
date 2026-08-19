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
