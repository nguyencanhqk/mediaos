# S10-QA-SECPOLICY-GATE-1 — KI-065: số phận `PATCH /settings/security-policy`

> Route cấu hình chính sách bảo mật CHẾT: 403 `deny-object-required` với **mọi** actor.
> Zone **đỏ** · gate **FULL** (chạm cấu hình cổng quyền của một route nhạy cảm) · model crown.
> Nguồn đo: `apps/api/test/integration/security-mailconfig-http.int-spec.ts:171` (HTTP thật).

## 0. Recon — đo trên cây hiện tại (19/08/2026), KHÔNG suy đoán

| Câu hỏi | Phép đo | Kết quả |
| --- | --- | --- |
| Bao nhiêu route khai `requiresReauth: true`? | `grep -rn "requiresReauth: true" apps/api/src --include=*.ts \| grep -v spec` | **ĐÚNG 1**: `security-policy.controller.ts:37` (3 hit còn lại nằm trong `permission.decide.ts`, là *giá trị trả về* của decision, không phải decorator) |
| Có nơi nào GHI `req.reauthContext`? | `grep -rn "reauthContext" apps/api/src apps/api/test packages` | **KHÔNG** — chỉ 3 nơi ĐỌC (`permission.guard.ts:21,124`, docblock) + 1 spec tự dựng (`permission.guard.reveal.spec.ts:58`). **Không tồn tại guard/endpoint step-up nào.** |
| SPEC có đòi step-up cho route này? | `grep -rn "xác thực lại\|step-up\|reauth" docs/spec/*.md` | **0 hit** — cờ `requiresReauth` là lựa chọn tự phát của lane CS-9 ("mirror reveal-secret"), KHÔNG do spec ép |
| Ai đang gọi route? | `grep -rn "settings/security-policy" apps/console/src` | Màn hình console THẬT: `routes/settings/security-policy.tsx` + `lib/security-policy-api.ts` → **tính năng người dùng đang chết**, không phải route mồ côi |
| Route nào khác rơi vào reveal-class? | `route-census` + grep | **0** route sản phẩm. Reveal-class (`isSensitive && requiresReauth`) hiện chỉ tồn tại ở tầng engine + spec tổng hợp (`module-registry.deny.int-spec.ts:137`, `platform-entitlements.deny.int-spec.ts:116`) |

## 1. Quyết định: **hướng (a)** — bỏ `requiresReauth` khỏi decorator, GIỮ NGUYÊN engine

Vì sao KHÔNG chọn (b) (lấy `companyId` làm `resourceId` + gán `req.reauthContext`):

1. (b) đòi **xây mới một cơ chế step-up thật** (endpoint xác thực lại + guard ghi cửa sổ reauth +
   FE flow) — đó là một tính năng, không phải bản vá của WO này; làm nửa vời (gán `reauthContext`
   ở đâu đó cho đủ điều kiện) = **cửa sau giả**: cờ nói "đã xác thực lại" trong khi không ai xác thực lại.
2. (b) còn buộc mỗi công ty phải có một hàng `object_permissions` cho chính `companyId` của mình —
   một cấp phát vô nghĩa về nghiệp vụ, và là đường **đẻ ra thao tác cấp-quyền-object mới** cho một
   singleton, đúng chiều leo thang mà KI-065 cảnh báo.
3. (a) **không chạm một dòng nào** của `permission.decide.ts` / `permission.guard.ts` ⇒ ngữ nghĩa
   `needsObjectGrant` không đổi ⇒ **không thể** làm lỏng bất kỳ route nhạy cảm nào khác
   (bài học `reviewer-proposed-fix-can-open-holes`).

Sau khi bỏ cờ, route vẫn giữ `isSensitive: true` ⇒ **cổng nhạy cảm còn nguyên**: grant wildcard
`*:*` (kể cả super-admin) KHÔNG đủ, phải có ALLOW chính xác cặp `configure-security-policy:company`.
Ý định "đổi chính sách bảo mật nên cần xác thực lại" KHÔNG bị vứt đi — nó được seed thành WO
`S10-AUTH-STEPUP-1` (xây step-up thật, rồi mới gắn lại cờ), có hạn gỡ, để workaround không thành
vĩnh viễn (`known-issue-workaround-may-never-have-run`).

## 2. Ratchet chống tái diễn (phép đo tái dùng, không phải văn xuôi)

Bẫy gốc: một cấu hình **bất khả thi** (`requiresReauth` khi không có nơi nào ghi `reauthContext`)
không hề ồn ào — nó chỉ biến thành 403 im lặng. Thêm cổng census runtime:

`apps/api/test/foundation/reauth-reachability.e2e-spec.ts` — boot AppModule, đọc metadata THẬT:

- route khai `requiresReauth: true` mà **không** có `:param` trong path ⇒ ĐỎ (object-tier không bao
  giờ chạy ⇒ `deny-object-required` vĩnh viễn — chính KI-065).
- **bất kỳ** route nào khai `requiresReauth: true` khi trong `apps/api/src/**` (bỏ spec) không có
  nơi nào GHI `reauthContext` ⇒ ĐỎ (không có step-up ⇒ `isReauthValid` luôn false).
- Cổng tự nhả khi ai đó xây step-up thật (điều kiện là sự tồn tại của writer, không phải allowlist tên route).

`RouteInfo` được bổ sung 2 trường `isSensitive` / `requiresReauth` (route-census dùng chung) —
artifact census KHÔNG đổi hình (writer map trường tường minh), nên cổng `ROUTE_CENSUS_WRITE` không đỏ oan.

## 3. Test (RED trước, chạy THẬT ở LANE_DB)

Trong `security-mailconfig-http.int-spec.ts` — **LẬT** ca ghim (xoá ca 403 `deny-object-required`, không nới assert):

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| 1 | ALLOW: actor có ALLOW company-level đúng cặp → `PATCH` | **2xx** + envelope `data` đúng hình + giá trị vừa ghi đọc lại được |
| 2 | Chống tự-khoá (BẤT BIẾN #4) | `exemptUserIds` trả về **chứa actor.id** dù body không gửi |
| 3 | Audit append-only | có hàng `audit_logs` `security_policy.updated` với `actor_user_id` = actor, `before`/`after` khác nhau |
| 4 | DENY thật | actor KHÔNG có cặp quyền → **403 `deny-sensitive`** (assert LÝ DO, không chỉ status) |
| 5 | Không leo thang qua wildcard | actor chỉ có `*:*` ALLOW → **403 `deny-sensitive`** (cổng nhạy cảm vẫn từ chối wildcard) |
| 6 | Cross-tenant | admin công ty B `PATCH` → policy công ty A **không đổi** (companyId lấy từ JWT, không body) |

Unit (không cần DB) — `permission.decide` pin chống leo thang:

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| 7 | reveal-class CÓ `resourceId`, chỉ có ALLOW company-level, không object grant | vẫn `deny-object-required` (ngữ nghĩa engine KHÔNG đổi) |
| 8 | reveal-class CÓ object ALLOW nhưng cửa sổ reauth hết hạn | `deny-reauth-required` |

## 3b. Phát hiện khi vá — nửa thứ hai của cùng tính năng (vá luôn)

Đo sau khi route sống lại: cặp `configure-security-policy:company` (`is_sensitive=true`) **không**
nằm trong `SENSITIVE_CAPABILITY_ALLOWLIST` ⇒ `/auth/me` không trả ⇒ màn console
`settings/security-policy` render `EmptyState "không có quyền"` với **chính company-admin** — vai duy
nhất có grant (catalog KHÔNG có hàng wildcard nào để `useCan` rơi vào). Tức vá BE mà thôi thì tính
năng vẫn không dùng được. Vá cùng PR: APPEND cặp vào `SENSITIVE_CAPABILITY_ALLOWLIST` +
`SENSITIVE_SCREEN_GATE_PAIRS` (cờ HIỂN THỊ, enforcement không đổi) + màn đổi `useCan` → `useCanExact`
+ ca đo bằng chính `/auth/me` (có grant ⇒ `true`; không grant ⇒ VẮNG). Lần lặp thứ 9+ của
`capability-allowlist-hides-admin-screens`.

## 4. Ranh giới (chống phình)

- KHÔNG sửa `permission.decide.ts` / `permission.guard.ts` / migration / seed catalog.
- KHÔNG xây step-up trong WO này (đã seed `S10-AUTH-STEPUP-1`).
- KHÔNG chạy full-suite (ENOBUFS + vitest worker crash) — chạy theo file + `harness/check.sh --lane-db`.

## 5. Nghiệm thu

1. `security-mailconfig-http.int-spec.ts` xanh ở LANE_DB với 6 ca trên (ca ghim 403 đã BIẾN MẤT).
2. `reauth-reachability.e2e-spec.ts` xanh; chứng minh cổng KHÔNG rỗng bằng cách tạm thêm lại cờ ⇒ ĐỎ.
3. `route-guard-coverage.e2e-spec.ts` + `route-http-coverage.e2e-spec.ts` vẫn xanh (census/ratchet không đỏ oan).
4. `module-registry.deny.int-spec.ts` + `platform-entitlements.deny.int-spec.ts` vẫn xanh (reveal-class chưa lỏng).
5. KI-065 ĐÓNG ở RELEASE-02; KI-025 gỡ dòng "`PATCH /settings/security-policy` không tính đã phủ"; ADR `DECISIONS-09` ghi quyết định (a).
