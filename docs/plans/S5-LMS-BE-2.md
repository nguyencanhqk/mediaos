# S5-LMS-BE-2 — Micro-plan (🔴 crown · zone=red · gate FULL)

> WO: `harness/backlog.mjs` → `S5-LMS-BE-2`. Wave: [S5-LMS-WAVE.md](S5-LMS-WAVE.md) §4 B03. Nợ MEDIUM security-review #253.
> Mục tiêu: mỗi lần **mint thành công** link SSO tại `GET /integrations/lms/sso-link` → ghi **1 row**
> `audit_logs` objectType=`lms_sso` action=`sso_link_minted` objectId=`jti` — KHÔNG log token/chữ ký/secret.
>
> **depends_on: S5-LMS-DB-1** (cần audit type `lms_sso` từ mig 0509). PR này **stacked trên `wo/S5-LMS-DB-1`**
> (base = nhánh đó, KHÔNG phải master) — 0509 + `AUDIT_OBJECT_TYPES` đã có sẵn trong base.

---

## 0. Quyết định chốt

| # | Quyết định | Lý do |
| --- | --- | --- |
| **D1 — FAIL-CLOSED** | Ghi audit **TRƯỚC**, chỉ trả `{url}` khi audit đã commit. Audit-write lỗi → propagate (request 500, **KHÔNG** trả token) | plan-review #253 W5: "không phát token chưa audit được". Mint link SSO = phát 1 credential một-lần ⇒ phát mà không có vết audit là vô hiệu hoá chính món nợ đang trả. `db.withTenant` bọc `audit.record` trong tx: audit vỡ → rollback → throw → 500, token không rò |
| **D2 — objectId = jti (UUID)** | `buildSsoUrl` trả thêm `jti`; audit ghi `objectId=jti` | `audit_logs.object_id` kiểu `uuid`; `jti = randomUUID()` (pin D7 của DB-1). Truy vết 1-1 link đã mint ↔ token LMS consume |
| **D3 — Wiring qua DI @Global** | Inject `DatabaseService` + `AuditService` (đều `@Global` — DbModule/EventsModule) vào `LmsSsoService`, KHÔNG cần sửa `imports` của `IntegrationsLmsModule` | Đã kiểm: cả 2 module `@Global`. Giảm blast-radius wiring |
| **D4 — 503 giữ nguyên, TRƯỚC mọi DB** | Thiếu env (`LMS_SSO_SECRET`/`LMS_BASE_URL`) → `ServiceUnavailableException` **trước** khi build/audit ⇒ KHÔNG ghi audit | done_when: "mint fail (503 thiếu env) không ghi" |
| **D5 — Payload audit tối thiểu, KHÔNG nhạy cảm** | Chỉ `{action, objectType, objectId=jti, actorUserId, actorType:'User', resultStatus:'Success', actionGroup:'INTEGRATION', permissionCode:'LMS.ACCESS'}`. `before/after/metadata/oldValues/newValues` = **để trống** (KHÔNG token, KHÔNG chữ ký, KHÔNG secret, KHÔNG email vào before/after) | BẤT BIẾN #3. `actorUserId` + `createdAt` (auto) đã đủ "ai mint lúc nào"; jti là objectId. Không nhét gì có thể lộ |
| **D6 — `buildSsoUrl` giữ public + thuần** | Vẫn là token-factory thuần (không DB), trả `{url, jti}`; thêm `async mintSsoLink(user)` là đường DUY NHẤT controller gọi | Giữ unit test crypto/TTL/jti chạy nhanh không cần DB; controller đi qua đường audited |

---

## 1. Phạm vi

**TRONG:**
1. `apps/api/src/integrations/lms/lms-sso.service.ts` — inject DB+Audit; `buildSsoUrl` trả `{url, jti}`; thêm `async mintSsoLink(user: {id, companyId, email})`.
2. `apps/api/src/integrations/lms/lms-sso.controller.ts` — `getSsoLink` thành `async`, truyền `req.user` (đủ `id`+`companyId`+`email`) cho `mintSsoLink`.
3. `apps/api/src/integrations/lms/lms-sso.service.spec.ts` — cập nhật construct (mock DB+Audit), giữ test `buildSsoUrl`; thêm test `mintSsoLink` fail-closed + audit-entry shape (unit, mock tx).
4. `apps/api/test/integration/lms-sso-audit.int-spec.ts` (MỚI) — audit-in-tx thật trên lane DB.

**NGOÀI:** migration (đã ở DB-1) · quyền mới · module imports · `apps/lms` · đổi hành vi token (HMAC/TTL/jti giữ NGUYÊN — chỉ THÊM audit).

---

## 2. Các bước

1. **RED:** viết `lms-sso-audit.int-spec.ts` + phần `mintSsoLink` trong unit spec TRƯỚC → đỏ (chưa có method).
2. **GREEN:** sửa service + controller.
3. **Verify:** `LANE_DB=mediaos_lmsdb1` (đã có 0509) → `pnpm --filter @mediaos/api test` (unit + int) · `pnpm typecheck` · `pnpm lint`.
4. **Gate FULL:** `security-reviewer` + `silent-failure-hunter` (đường auth/secret).
5. **PR stacked:** base `wo/S5-LMS-DB-1`, KHÔNG nhãn auto-merge (vùng đỏ). Ghi rõ "stacked on #259 — merge #259 trước".

---

## 3. Test plan

**Unit — `lms-sso.service.spec.ts`** (giữ 503 + crypto/TTL/jti cũ; construct đổi sang `new LmsSsoService(mockDb, mockAudit)`):

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| U1 | `mintSsoLink` khi env đủ, mock `db.withTenant` resolve | trả `{url}`; `audit.record` gọi ĐÚNG 1 lần với `{objectType:'lms_sso', action:'sso_link_minted', objectId=<jti trong url>, actorUserId:user.id}` |
| U2 | **fail-closed**: mock `db.withTenant` **reject** | `mintSsoLink` **reject** (KHÔNG resolve url); token không rò ra ngoài |
| U3 | thiếu env | `ServiceUnavailableException` (503) **và** `db.withTenant` KHÔNG được gọi (không audit) |
| U4 | audit-entry KHÔNG chứa token/chữ ký/secret | serialize toàn bộ `entry` truyền cho `audit.record` → KHÔNG chứa substring của token/sig/secret env |

**Integration — `lms-sso-audit.int-spec.ts`** (gate `hasDb && LANE_DB`; seed company+user; set env test ghép-chuỗi):

| # | Ca | Kỳ vọng | RED? |
| --- | --- | --- | --- |
| I1 | `mintSsoLink({id,companyId,email})` env đủ | đúng **1** row `audit_logs` objectType=`lms_sso`, action=`sso_link_minted`, objectId là UUID, actorUserId=user.id, company_id=company | ✅ (method chưa có) |
| I2 | row đó `before/after/old_values/new_values/metadata` | đều NULL/không chứa token/chữ ký/`LMS_SSO_SECRET` | ✅ |
| I3 | objectId (jti) khớp jti trong URL trả về | bằng nhau | ✅ |
| I4 | gọi 2 lần | 2 row, objectId khác nhau (jti một-lần) | ✅ |

## 4. Rủi ro / bẫy

- **Stacked PR** (memory `squash-merge-breaks-stacked-prs`): #259 squash-merge sẽ làm nhánh này lệch base ⇒ sau khi #259 merged, rebase `wo/S5-LMS-BE-2` lên master (bỏ 2 commit của DB-1). Ghi trong PR.
- **Fail-closed lan xuống môi trường thiếu 0509**: nếu 0509 chưa áp (PROD/dev-online) mà BE-2 lên → MỌI request sso-link 500 (audit vỡ CHECK → rollback). Đây CHÍNH là lý do handover DB-1: **0509 phải áp PROD+dev-online TRƯỚC BE-2 merge**. Nhắc lại trong PR.
- **Đừng đổi TTL/HMAC**: chỉ THÊM audit. `buildSsoUrl` build token y hệt, chỉ trả thêm jti.
- **Masker là lưới, không phải lá chắn chính**: D5 chủ động KHÔNG nhét gì nhạy cảm — không dựa vào masker.
- **Unit test `new LmsSsoService()` cũ**: 2 spec file là của tôi, cập nhật construct; không call-site sản phẩm nào khác `new`.

## 5. Definition of Done

`done_when` WO + unit+int xanh trên lane DB + typecheck/lint + FULL gate PASS + cập nhật ledger + PR stacked
(base #259, KHÔNG auto-merge) có ghi chú thứ tự merge (#259 trước) + nhắc 0509 phải áp PROD/dev-online trước.
