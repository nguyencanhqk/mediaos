# S5-ME-BE-3 — BE Hoạt động bảo mật own-scope: `GET /me/security/activity`

```yaml
wo: S5-ME-BE-3
zone: red # crown AUTH — plan-reviewer PASS trước khi code; FULL gate security-reviewer
generated_by: direct-session (2026-07-17)
reconciled_at: "33bcdf68"
paths_dùng:
  - packages/contracts/src/me.ts # APPEND query + item schema (hot-file, không rewrite)
  - apps/api/src/me/me-security-activity.util.ts # MỚI — maskIp + summarizeUserAgent (pure)
  - apps/api/src/me/me-security-activity.util.spec.ts # MỚI — unit spec colocated (vitest src/**)
  - apps/api/src/me/me-security-activity.repository.ts # MỚI — UNION 2 bảng, own-scope
  - apps/api/src/me/me-security-activity.service.ts # MỚI — clamp window + map DTO
  - apps/api/src/me/me-security-activity.controller.ts # MỚI — route + guard + no-store
  - apps/api/src/me/me.constants.ts # APPEND hằng số window/per_page
  - apps/api/src/me/me.module.ts # APPEND controller + providers (khối additive)
  - apps/api/test/integration/me-security-activity.int-spec.ts # MỚI — RED trước
không_đụng:
  - apps/api/src/auth/auth-logs-viewer.* # viewer admin Company-scope GIỮ NGUYÊN (done_when)
  - apps/api/src/auth/auth.controller.ts # sessions list/revoke TÁI DÙNG /auth/sessions — KHÔNG dựng lại
  - apps/api/src/db/** # KHÔNG migration, KHÔNG seed permission mới
```

## 1. GAP-ANALYSIS (đối chiếu code 2026-07-17)

- **BE sẵn**: `login_logs` + `user_security_events` (schema `apps/api/src/db/schema/auth-logs.ts`, mig 0443, append-only, RLS live). Admin viewer Company-scope đã có (`auth-logs-viewer.controller.ts`, cặp `view:audit-log` sensitive) — **route ME riêng chưa có**. Sessions self-service đã có ở `/auth/sessions` (+ revoke/revoke-others) — ME **không** dựng lại.
- **Thiếu**: endpoint own-scope `GET /api/v1/me/security/activity` (SPEC-09 §14.2, ME-FUNC-016, màn ME-SCREEN-008 do S5-ME-FE-2 tiêu thụ sau).
- **Contracts**: `packages/contracts/src/me.ts` chưa có schema activity → APPEND.

## 2. QUYẾT ĐỊNH CHỐT (shape route + gate)

1. **Route**: `GET /api/v1/me/security/activity` — controller MỚI `MeSecurityActivityController` (`@Controller("me/security")`). KHÔNG thêm vào `MeController` vì class đó giữ bất biến tài liệu hoá "CỐ Ý KHÔNG khai @Param/@Query/@Body"; route này cần @Query phân trang.
2. **Gate**: class-level `PermissionGuard` + `@RequirePermission('access','me')` (tuple `ME_ACCESS_PAIR`, seed mig 0495) — đúng done_when: **KHÔNG** dùng cặp `view:audit-log` (đó là viewer admin), **KHÔNG** seed cặp mới (SPEC §11.1 `ME.SECURITY_ACTIVITY.VIEW_OWN` là mã đề xuất; engine chạy theo tuple — không migration trong WO này). 401 do JwtAuthGuard global.
3. **Own-scope cứng từ token**: service nhận `req.user` → repo `WHERE user_id = <actor>` hard-code, chạy TRONG `db.withTenant(companyId)` (RLS + FORCE, BẤT BIẾN #1). Query DTO **không có** field `user_id`/`employee_id`; Zod mặc định strip key lạ ⇒ `?user_id=<B>` bị BỎ QUA (mirror IDOR test ME-BE-1). Bài học `reused-method-must-be-actor-scoped`: KHÔNG tái dùng `AuthLogsViewerService` (nó nhận filter user_id tùy ý — admin scope); repo ME riêng, actor-locked ngay trong SQL.
4. **Nguồn dữ liệu**: UNION ALL 2 nhánh cùng shape trong 1 query (phân trang merged đúng, không merge in-memory):
   - `login_logs`: `WHERE user_id = actor` → eventType map `LOGIN_SUCCESS|LOGIN_FAILED|LOGIN_BLOCKED` (từ `login_status`). (Row pre-auth company NULL có `user_id` NULL ⇒ không bao giờ khớp actor; RLS nullable-tenant không mở đường rò.)
   - `user_security_events`: `WHERE user_id = actor` → eventType = `event_type` nguyên trạng + `severity`.
   - ORDER BY `created_at DESC, id DESC` (tie-break ổn định) → LIMIT/OFFSET; total = `count(login) + count(events)` (2 count rẻ hơn count-over-union). **CẢ 2 count-branch PHẢI áp CÙNG bộ lọc với data query** (`user_id = actor AND created_at ∈ [effectiveFrom, effectiveTo]`) — count lệch clamp ⇒ `total`/`has_next` sai (finding plan-review M1).
   - **KHÔNG SELECT** `metadata`/`payload` (jsonb có thể chứa ngữ cảnh nhạy cảm) — field không tồn tại trong row ⇒ không có đường lộ (mạnh hơn redact-at-read, mirror AuthLogsViewerService, BẤT BIẾN #3). Nếu drizzle `unionAll` không cho `.orderBy` trên union ở version hiện dùng → fallback `tx.execute` + sql-template THAM SỐ HOÁ (không nối chuỗi) — vẫn trong withTenant.
5. **DTO tối giản** (done_when + §17): `{ id, source: 'login'|'security_event', eventType, severity|null, device|null, ipMasked|null, createdAt }`. KHÔNG email/normalized_email/failure_reason/session_id/actor/metadata/payload/raw IP/raw UA.
   - `maskIp` (util thuần): IPv4 `a.b.c.d` → `a.b.*.*`; IPv6 giữ 2 hextet đầu + `::*`; không parse được → `null` (fail-closed: thà mất hiển thị còn hơn lộ). §10.6 "IP đã mask theo policy" — MVP mask LUÔN (chưa có policy key mở raw; không thêm setting mới).
   - `summarizeUserAgent` (util thuần): rút gọn browser-family + OS (vd `"Chrome trên Windows"`); không nhận diện được → `null`. KHÔNG trả raw UA (giảm fingerprint surface).
6. **Phân trang + giới hạn thời gian** (done_when): query `page` (≥1, default 1) · `per_page` (1..50, default 20) · `from_date`/`to_date` optional (refine from≤to → 400 VALIDATION-ERR, mirror `loginLogListQuerySchema`). Query schema **KHÔNG `.strict()`** (object thường + refine — key lạ như `user_id` bị STRIP, không 400; đừng copy `.strict()` từ mePreferences*, finding plan-review L1). Service CLAMP cửa sổ về tối đa `ME_SECURITY_ACTIVITY_MAX_DAYS = 90` ngày gần nhất (`effectiveFrom = max(from_date, now−90d)`) — client không kéo lịch sử vô hạn.
7. **Không cache dài** (§12.6): không thêm tầng cache; set header `Cache-Control: no-store` trên route.
8. **Append-only giữ nguyên** (BẤT BIẾN #2): route CHỈ SELECT/COUNT — không có path ghi/sửa/xoá. §17 không yêu cầu audit cho việc user tự xem activity của mình → KHÔNG ghi audit (tránh audit-loop xem-log-sinh-log).
9. **Envelope**: `paginated(data, toPagination(total, page, per_page))` — pagination hoist chuẩn API-01 §16.1 (mirror viewer admin).

## 3. THỨ TỰ THỰC THI (RED trước)

1. **Contracts APPEND** (`packages/contracts/src/me.ts`): `meSecurityActivityQuerySchema` (+refine) · `meSecurityActivitySourceSchema` · `meSecurityActivityItemSchema` + types. Build contracts trước khi api compile.
2. **Int-spec RED** `apps/api/test/integration/me-security-activity.int-spec.ts` — gate `hasDb && LANE_DB` (memory `integration-test-lane-db-gate`), mirror khung `me-personal-hub.int-spec.ts`:
   - a. unauth → 401 (guard global).
   - b. có quyền nguồn nhưng KHÔNG `access:me` → 403 `AUTH-ERR-FORBIDDEN`.
   - c. happy: plant trực tiếp (direct pool) 2 login_logs + 2 user_security_events cho A với IP thật `203.0.113.77`, UA đầy đủ, `metadata/payload` chứa marker `PLANT-DO-NOT-LEAK` → 200, 4 item merge DESC, pagination block đúng.
   - d. **shape không lộ nhạy cảm**: serialize toàn response — KHÔNG chứa `203.0.113.77` (chỉ dạng mask `203.0.*.*`), KHÔNG `PLANT-DO-NOT-LEAK`, KHÔNG key `ip_address|user_agent|metadata|payload|email`; item chỉ đúng bộ key DTO. UA plant chứa token đặc trưng (vd `XYZBUILD/9.9.9`) → assert token KHÔNG xuất hiện (chặn rò fragment raw-UA qua `device`, finding plan-review M3).
   - e. own-scope cùng tenant: plant rows cho B (marker riêng) → response A không chứa marker B.
   - f. IDOR: `?user_id=<B>&employee_id=<B>` (+body) → 200, chỉ item của A.
   - g. cross-tenant: plant `login_logs` tenant B gắn `user_id = A` (dữ liệu lệch) → RLS chặn, marker không xuất hiện.
   - g2. **nullable-tenant** (finding plan-review M2): plant `login_logs (company_id=NULL, user_id=<B>)` → A KHÔNG thấy (actor-lock chặn dù RLS nullable cho row NULL đi qua); plant `(company_id=NULL, user_id=<A>)` → A THẤY (chính chủ — fail đăng nhập pre-auth vẫn hiện cho đúng chủ).
   - h. giới hạn thời gian: plant row `created_at = now() − 200 days` → KHÔNG trong data **VÀ `pagination.total` không đếm nó** (count cùng clamp, finding plan-review M1).
   - i. phân trang + validate: `per_page=1` → 1 item + `has_next`; `per_page=999` → 400; `from_date > to_date` → 400.
   Chạy trên DB cô lập: `bash scripts/lane-db-setup.sh mebe3` → `LANE_DB=mediaos_mebe3` → xác nhận **RED** (route chưa tồn tại).
3. **Unit spec colocated** `me-security-activity.util.spec.ts` (RED): maskIp IPv4/IPv6/null/rác; summarizeUserAgent Chrome/Edge/Firefox/Safari/không rõ/null.
4. **Implement**: util → repository (UNION, actor-locked) → service (clamp window + map DTO) → controller (guard + DTO query + no-store) → `me.module.ts` APPEND. Business ở service, controller chỉ forward `req.user` (quy tắc §5 CLAUDE.md).
5. **Verify**: `pnpm --filter @mediaos/contracts build` → `pnpm --filter @mediaos/api typecheck` → int-test với LANE_DB (GREEN) → `bash harness/check.sh --lane-db=mebe3` (TURBO_FORCE chống false-green).
6. **FULL gate**: security-reviewer (diff auth/me/contracts) + soi silent-failure (không nuốt lỗi: repo/service ném lỗi hạ tầng → 500 chuẩn envelope, KHÔNG fail-soft ở route này vì đây là màn bảo mật — degraded-giả nguy hiểm hơn lỗi tường minh).
7. Backlog `done_when` cập nhật + PR (red zone → auto-merge KHÔNG gắn; người chốt).

## 4. RỦI RO & CHẶN

| Rủi ro | Chặn |
| --- | --- |
| Rò dữ liệu user khác qua param | DTO không khai owner param; zod strip key lạ; SQL khoá `user_id = actor`; int-spec f. |
| Rò cross-tenant | withTenant + RLS FORCE; int-spec g (planted row). |
| Lộ metadata/payload/token | Repo không SELECT 2 cột jsonb; int-spec d assert marker. |
| Lộ raw IP/UA | mask/summarize ở service (server-side, FE không bao giờ nhận raw); int-spec d. |
| Reuse nhầm service admin (actor-scope drift) | Không reuse `AuthLogsViewerService`; repo ME riêng actor-locked (memory `reused-method-must-be-actor-scoped`). |
| False-green int-spec | gate `hasDb && LANE_DB` + chạy `--lane-db`; TURBO_FORCE=1. |
| unionAll orderBy không hỗ trợ | Thử union-builder drizzle TRƯỚC; fallback `tx.execute` + sql-template tham số hoá trong withTenant. Fallback PHẢI khoá shape: nhánh login `NULL::text AS severity, 'login'::text AS source`; nhánh events `severity, 'security_event'::text AS source`; `ORDER BY created_at DESC, id DESC`; tham số hoá actor/effectiveFrom/effectiveTo/limit/offset — KHÔNG nối chuỗi. |
| Drift permission seed | Không seed mới — dùng đúng tuple 0495 `('access','me')` như 3 controller ME hiện có. |

## 5. OUT-OF-SCOPE (chống creep)

KHÔNG: sessions list/revoke (đã có `/auth/sessions`) · FE (S5-ME-FE-2) · migration/seed permission mới · policy setting mở raw IP · export activity · đổi viewer admin `auth-logs-viewer.*` · webhook/alert. Spec lệch code cũ → spec thắng.
