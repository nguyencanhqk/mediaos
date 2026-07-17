# S5-ME-QA-1 — QA ME: IDOR sweep + cross-user/tenant + aggregation degraded + preference policy

> WO: `S5-ME-QA-1` · module QA · zone 🟡 · gate **LIGHT** (nhánh permission/IDOR → `security-reviewer` soi deny-path)
> Nguồn: **SPEC-09 §19 (nghiệm thu) + §20 (test scenario)** · QA-05 (permission/data-scope testing) · IMP02-STORY-120.
> Depends_on: `S5-ME-BE-2`, `S5-ME-BE-3` (đã ship). Deliverable = **integration test** (không đổi code sản phẩm).

## 1. Phạm vi — mọi endpoint `/me/*` đã ship

| Endpoint | Gate (tuple THẬT mig 0495) | Own-scope enforce |
| --- | --- | --- |
| `GET /me` | `access:me` | owner = token (không @Param/@Query/@Body) |
| `GET /me/overview` | `access:me` | như trên + fail-soft per-section |
| `GET /me/{attendance,leave,task,notification}-summary` | `access:me` | như trên |
| `GET /me/preferences` | `view:user-preference` | `WHERE user_id = token` (RLS chỉ cô lập TENANT) |
| `PATCH /me/preferences` · `PATCH /me/preferences/appearance` | `update:user-preference` | upsert khoá `user_id = token`; body `.strict()` |
| `POST /me/avatar` · `DELETE /me/avatar` | `update:avatar` | employeeId resolve từ token; file `ownerUserId === actor.id` |
| `GET /me/security/activity` | `access:me` | repo khoá `user_id = token`; query KHÔNG `.strict()` (key lạ STRIP) |
| `GET/PUT /notifications/preferences` (ME-SCREEN-013 tái dùng) | own-scope by token (no PermissionGuard) | `mandatory` rule chặn opt-out |

## 2. Ma trận test ↔ done_when ↔ SPEC-09 §20

File: `apps/api/test/integration/me-qa1-idor-sweep.int-spec.ts` — Postgres THẬT, DB cô lập `mediaos_meqa1`, gate `hasDb && LANE_DB` (int-spec chạy thật, không false-green).

| # | Kịch bản (done_when / SPEC-09 §20) | Test |
| --- | --- | --- |
| T1 | **IDOR sweep** cả 8 GET `/me/*`: truyền `?user_id=<A2 **cùng tenant**>&employee_id=<empA2>` → response **giống hệt** no-param (owner 100% từ token; §14.4/§16, §20.6). Target cùng-tenant mạnh hơn cross-tenant: RLS KHÔNG cứu 1 route honor-param | so sánh `body.data`(+`pagination`) baseline vs tampered cho 8 GET route |
| T2 | IDOR body-tamper PATCH `/me/preferences`: body có `user_id` lạ → **400** (`.strict()`); query `?user_id=<A2 cùng tenant>` → ghi vào **chính caller**, A2 KHÔNG đổi (khoá `WHERE user_id=token`) | strict reject + query-tamper landed-on-self, peer cùng-tenant bất biến |
| T3 | IDOR avatar: `POST /me/avatar` file của **user khác** → 403; file **tenant khác** → 404; `fileId` không tồn tại (+body `user_id`) → 404 | ownership/tenant/none |
| T4 | **cross-user deny CÙNG TENANT** (khoá `user_id` ở TẦNG APP, KHÔNG do RLS — mig 0495 "CROSS-USER KHÔNG DO RLS"): activity A **chứa** event của mình nhưng **KHÔNG** chứa event/IP của A2 (cùng company A); pref A ≠ A2 | app-lock proof: seed event riêng cho A2, assert vắng + event A hiện |
| T5 | **cross-tenant deny** (RLS `company_id`): A không thấy activity/pref của tenant B | isolation |
| T6 | **session người khác → 403/404** | **TÁI DÙNG** `auth-session-selfservice.int-spec.ts` (đã phủ cross-user 404 + cross-tenant + no-secret) — chỉ tham chiếu, không nhân bản (done_when "tái dùng nếu đã phủ") |
| T7 | **aggregation degraded, HTTP 200, section khác ok** (§19.10 / §20.5): (a) thiếu 1 quyền nguồn → section `forbidden`; (b) `module.LEAVE.enabled=false` → `module_disabled`; (c) unlinked → `unlinked_employee` | 3 dạng degraded; overview vẫn 200, identity + section khác `ok` |
| T8 | **unlinked-employee**: user chưa liên kết → `GET /me` linkStatus `unlinked`; overview hr/att/leave `unlinked_employee`, task/noti `ok` (§19.3/§20.2) | tenant C |
| T9 | **company khóa timezone** (ME-DEC-008 / §20.6): PATCH timezone khi setting chưa mở → **422** `ME-ERR-TIMEZONE-OVERRIDE-DENIED`; `null`/absent luôn cho | deny + revert-to-inherit allowed |
| T10 | **notification bắt buộc không tắt được** (§19.12/§20.6): PUT `{mandatory,false}` → **400**; `{mandatory,true}` → 200; type thường `{x,false}` → 200 | mandatory guard |
| T11 | **field nhạy cảm** (§17/§20.3): response `GET /me`, `/me/overview`, `/me/security/activity` **KHÔNG** salary/PII (identity_number, bank_account…) ngoài mask + **KHÔNG** token/secret; IP → mask `a.b.*.*`, UA → nhãn allowlist (raw không rời server) | assert no-secret + masking |
| T12 | **auth gates**: không token → 401; có token nhưng thiếu `access:me` → 403 (§20.1) | 401 + 403 |
| T13 | **per-route permission gate**: user CÓ `access:me` nhưng THIẾU cặp per-route → `GET /me`=200 nhưng `GET /me/preferences`(view)=403 · `PATCH /me/preferences`(update)=403 · `POST /me/avatar`(update:avatar)=403 — chứng minh mỗi controller gate ĐÚNG cặp riêng, KHÔNG phải chỉ `access:me` | mis-wire @RequirePermission bị bắt |

### Không phủ ở integration (có lý do)
- **Infra-'error' section** (§20.5 "ATT lỗi / TASK timeout / NOTI unread lỗi"): phân loại `classifyReaderError` (non-HttpException / 500 → `error`, 404 → `ok`+null, 403 → `forbidden`) đã phủ **đầy đủ** ở unit `apps/api/src/me/me-aggregation.service.spec.ts`. Không dựng lỗi hạ tầng giả ở integration (drop bảng = brittle); integration phủ 3 dạng degraded **tất định** (forbidden/module_disabled/unlinked) — cùng bất biến "1 nguồn hỏng ≠ toàn trang 500".
- **Mapping bất thường >1 employee** (§20.2 → 409 + audit append-only persist qua tx-riêng): partial-unique `(company_id,user_id) WHERE deleted_at IS NULL` chặn seed 2 active ⇒ **KHÔNG thể** dựng ở int-spec đường-thật. Unit `me-current-person.resolver.spec.ts` phủ THIẾT KẾ tx-riêng (mock repo); phần "audit_logs THẬT còn lại sau rollback 409" nằm ngoài tầm với của mọi test (un-seedable) — ghi rõ ở đây để KHÔNG ngộ nhận có phủ real-DB.
- **Token hết hạn / user locked sau khi mở trang** (§20.1): thuộc AUTH guard chung (đã có suite auth); ME không thêm logic.

## 3. Bất biến & lưu ý kỹ thuật
- **Không mutate catalog**: `seedPermissionCatalog` truyền `is_sensitive` **đúng nguyên văn** mig 0495 (access/view/update/read = false; `view-own:attendance` = true) để `ON CONFLICT DO UPDATE` là no-op (chống canonical-seed-pin regression).
- **Gate LANE_DB**: `describe.skipIf(!(hasDb && LANE_DB))` — thiếu LANE_DB thì SKIP (lane-db-guard đếm), KHÔNG chạy trên `mediaos` dùng chung (false-red).
- **Teardown**: `user_preferences`/`notification_rules`/`notification_preferences` CASCADE theo companies+users; `files`/`login_logs`/`user_security_events` đã có trong `cleanupTenants`.
- **So sánh IDOR**: chỉ so `body.data` (+`pagination`) — `meta.timestamp` trong envelope là volatile.

## 4. Coverage
Integration drive HTTP-thật qua guard→controller→service→repository cho **cả 4 controller ME** + avatar happy-path (seed file `Uploaded/image`, presign offline qua MinIO signing) → cùng unit specs sẵn có (aggregation/resolver/util) đạt **≥80% `apps/api/src/me`**. Kiểm chứng: `pnpm --filter @mediaos/api test -- --coverage` (include `src/me/**`).

## 5. Verify
```
export LANE_DB=mediaos_meqa1
pnpm --filter @mediaos/api test -- me-qa1-idor-sweep
bash harness/check.sh --lane-db=meqa1      # chạy như CI (deny-path thực thi thật)
```
