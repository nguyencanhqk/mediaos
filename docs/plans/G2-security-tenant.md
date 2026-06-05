# PLAN — G2 Nền bảo mật & đa-tenant (RLS + audit/outbox + auth)

> Tạo TRƯỚC khi viết code (PLAYBOOK §11). Rà bằng `plan-reviewer` tới PASS rồi mới code.
> Nguồn: ADR [0001](../adr/0001-rls-multi-tenant.md) · [0003](../adr/0003-pgbouncer-transaction-mode.md) · [0009](../adr/0009-audit-outbox-event-bus.md) · [0005](../adr/0005-immutable-payroll-finance-snapshot.md) · ERD [`erd-v2.md`](../erd-v2.md) §1/§3/§6 · `TASKS.md` G2 · `CLAUDE.md` §2/§3/§6.

## Meta

- **Mã:** G2 · **Phase:** G2 · **Mốc:** M1 (Lõi sống)
- **Vùng rủi ro chủ đạo:** 🔴 đỏ (crown-jewel foundation — rò chéo tenant = chí mạng)
- **Model chính:** **Opus** (toàn G2 — kể cả G2-1 vì grant/role là nền của bất biến #1+#2)
- **Ước lượng:** XL (~10–14 ngày focus)
- **Review gate:** **FULL** — `ecc:security-reviewer` + `ecc:database-reviewer` + `ecc:silent-failure-hunter` (mọi diff G2 chạm RLS/audit/secret).

## 1. Mục tiêu

Sau G2: **không một query nào đọc được dữ liệu của tenant khác** (ép ở tầng DB, không dựa kỷ luật dev); **mọi hành động quan trọng để lại audit bất biến**; **event nội bộ phát qua outbox không mất, idempotent, có alert khi drop**; có **auth** (login/refresh/me/forgot-password). Đây là nền mọi module sau dựa vào.

## 2. Scope

**Trong:**
- App DB role non-superuser + role tách (owner/migration · app · worker).
- `withTenant(companyId, fn)` — transaction + `set_config('app.current_company_id',$1,true)`.
- Bảng nền `companies`, `users` + RLS policy + FORCE + `company_id NOT NULL` + index + partial-unique soft-delete.
- `audit_logs` (append-only) + `outbox_events` + `processed_events` + `dead_letter_events` + event bus nội bộ + dead-letter alert.
- Test 2-tenant đối kháng (lưới an toàn cả dự án).
- Auth: login / refresh / `/me` / forgot-password; password hash (argon2id); session.

**Ngoài (không làm lần này):**
- Permission engine 4-tầng (G3) — G2 chỉ auth, **chưa** `can()`.
- Envelope encryption `platform_accounts` (G6-2) — `encryption_keys` bảng để sau, KHÔNG dựng ở G2.
- Org/Team/Employee đầy đủ (G5) — G2 `users` tối thiểu.
- Masking DTO theo quyền chi tiết (G3) — G2 chỉ BaseDTO không lộ hash/secret.

**Acceptance (TASKS.md G2 "Done khi"):** không đọc chéo tenant; mọi thay đổi quan trọng có audit; outbox/event idempotent + cảnh báo khi drop. Bất biến #1/#2/#3 (CLAUDE §2) được ép tự động.

## 3. Phụ thuộc (luật thứ tự — CLAUDE §3 / GX-4)

- **Cần có TRƯỚC G2:** G1 đóng (build xanh + CI). ✅ G1-7 vừa wire; **chờ push + CI xanh** → điều kiện mở G2.
- **Trong G2 (thứ tự bắt buộc):** `audit + outbox` (G2-4) và `RLS` (G2-3) PHẢI có trước module nhạy cảm; nhưng auth (G2-6) nên emit audit → **G2-4 trước G2-6**.
- **GX-4 (chí mạng):** với bảng có sẵn dữ liệu phải tạo **policy + FORCE RLS TRƯỚC khi backfill `company_id`**. G2 tạo bảng MỚI → policy+FORCE ngay lúc CREATE (không có cửa sổ rò). **CI assert** thứ tự + assert PgBouncer×RLS không rò.
- Seam đã sẵn (G1): [`apps/api/src/db/index.ts`](../../apps/api/src/db/index.ts) (`pool` qua PgBouncer + `directPool`), [`db.service.ts`](../../apps/api/src/db/db.service.ts) (chỗ cắm `withTenant`). **Cấm** query nghiệp vụ thẳng trên `db` ngoài `withTenant`.

## 3b. Quyết định nền auth (vá rủi ro chặn: email không unique toàn cục)

`users` partial-unique theo `(company_id, email)` → **email KHÔNG unique toàn cục**, nên `login{email,password}` không xác định nổi user. Chốt:

- **Login cần tenant hint:** `POST /auth/login { companySlug, email, password }`. Resolve `companySlug` → `company_id` (bảng `companies.slug` unique global) → mở `withTenant(company_id)` → tìm user theo `(company_id,email)` → verify argon2id. `companySlug` sai trả 401 đồng nhất (không lộ tenant tồn tại). _(Tương lai: subdomain `acme.app` thay cho slug trong body — kiến trúc không đổi.)_
- **Audit sự kiện auth có tenant context:** vì resolve tenant TRƯỚC khi verify password, mọi audit auth (login fail/success, forgot) đã có `company_id` → ghi `audit_logs` bình thường qua withTenant. KHÔNG cần bảng audit hệ thống company_id-nullable ở G2. _(Sự kiện hệ thống thật sự không-tenant để sau, ngoài scope G2.)_

## 4. Phân rã micro-step

| # | Bước nhỏ | Vùng | Model | Agent/Skill | Song song? | Test (deny-path TRƯỚC) | DoD bước |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **G2-1** | 3 DB role: `mediaos_owner` (migration, owns tables) · `mediaos_app` (non-superuser, **NOBYPASSRLS**, chỉ SELECT/INSERT/UPDATE/DELETE theo grant, INSERT-only audit/outbox) · `mediaos_worker` (UPDATE status outbox). App connection dùng `mediaos_app`. | 🔴 | Opus | **FULL gate**: database-reviewer + security-reviewer | — | **RED:** `SELECT rolbypassrls` của `mediaos_app` = false; app role thử `UPDATE/DELETE audit_logs` → từ chối; app role thử `ALTER TABLE`/owner-op → từ chối; app role không phải owner bất kỳ bảng nào. | Migration tạo role + grant; `.env` app URL trỏ `mediaos_app`, direct URL (migration) trỏ owner. |
| **G2-2** | `withTenant(companyId, fn)` trong `db.service.ts`: `db.transaction` → `set_config('app.current_company_id', companyId, true)` **qua tham số bind** (Drizzle `sql`-template `${companyId}` = $1, **cấm string-concat**) → chạy `fn(tx)` → commit. Validate companyId là UUID trước khi mở tx. | 🔴 | Opus | tdd-guide + silent-failure-hunter | — | **RED:** gọi `fn` ngoài transaction → context không set → query bị RLS chặn (0 row). companyId rỗng/không-UUID → throw, không mở tx. Lỗi trong `fn` → rollback (audit không ghi nửa vời). **PgBouncer reuse:** ép pool max=1, chạy `withTenant(A)` rồi `withTenant(B)` liên tiếp cùng physical conn → B KHÔNG thấy GUC của A (đã reset do `local=true`). | 1 connection/1 tx; `local=true` reset sau tx; mọi repo đi qua nó. |
| **G2-3** | Bảng `companies` (gốc tenant) + `users` (`company_id NOT NULL`, password_hash, status, `deleted_at`). RLS policy **`USING (...)` VÀ `WITH CHECK (company_id = current_setting('app.current_company_id')::uuid)`** (USING lọc đọc; WITH CHECK chặn ghi chéo) + `ENABLE` + **`FORCE ROW LEVEL SECURITY`** + index `(company_id,…)` + **partial unique** `users(company_id,email) WHERE deleted_at IS NULL`. Cân nhắc `DEFAULT current_setting(...)::uuid` cho `company_id` để app khỏi tự set. | 🔴 | Opus | database-reviewer + security-reviewer | — | **RED (trước implement):** query `users` KHÔNG qua withTenant → 0 row. Login tenant A đọc user B → 0 row. **Ghi chéo:** trong `withTenant(A)`, `INSERT`/`UPDATE ... company_id = B` → **bị WITH CHECK từ chối**. Thiếu `company_id` khi insert → NOT NULL. Trùng email sau soft-delete cùng tenant → cho phép; trùng email active → chặn. | Migration reversible; policy (USING+WITH CHECK)+FORCE cùng CREATE; Drizzle schema khớp. **Đồng bộ ERD §6 (đang thiếu WITH CHECK).** |
| **G2-5** | **Test 2-tenant đối kháng** (viết sớm, ngay sau G2-3): seed company A & B + users mỗi bên → với mọi repo/endpoint hiện có, login A → mọi path trả **0 row của B**. Harness tái dùng cho mọi phase sau (regression). | 🔴 | Opus | rls-tenant-isolation-tester *(custom — cần tạo)* | — | Là chính nó RED→GREEN: trước RLS đúng thì test phải đỏ. Chạy trên Postgres thật (CI). | Suite chạy trong CI; thêm bảng mới ⇒ thêm ca; **không skip**. |
| **G2-4** | `audit_logs` (INSERT-only; **chốt cột:** `id, company_id, actor_user_id, action, object_type, object_id, before, after, ip, user_agent, created_at`; polymorphic + CHECK enum `object_type` + composite index `(company_id, object_type, object_id)`) + `outbox_events`(append, `(status,available_at)` idx) + `processed_events` (**UNIQUE `(consumer_name, event_id)`** — mỗi consumer xử lý 1 event đúng 1 lần, NHIỀU consumer cùng event là hợp lệ) + `dead_letter_events` + **event bus nội bộ** (ghi DB+outbox cùng tx; worker đọc qua **directPool**; consumer idempotent qua `(consumer_name,event_id)`) + **alert khi `dead_letter_events` có row chưa resolved** (chốt sink: log + 1 kênh noti, không để alert rỗng). | 🔴 | Opus | event-outbox-audit-guide *(custom skill)* + silent-failure-hunter + database-reviewer | — | **RED:** rollback nghiệp vụ ⇒ outbox KHÔNG có event (cùng tx). Cùng `consumer_name` chạy lại cùng `event_id` ⇒ xử lý 1 lần. **2 consumer khác `consumer_name` cùng `event_id` ⇒ cả hai đều xử lý (không chặn nhau).** Drop/handler throw ⇒ vào dead_letter + alert kêu. App role thử UPDATE/DELETE audit ⇒ bị từ chối. | Outbox worker dùng directPool (session bền); grant đúng (app INSERT, worker UPDATE status); alert sink wired + test. |
| **G2-6** | Auth: `POST /auth/login` (**nhận `companySlug`+email+password** — vì email chỉ unique theo tenant, xem §3b) · `/auth/refresh` · `GET /auth/me` · `/auth/forgot-password`. Password **hash argon2id** (chốt dep + cost param; lưu ý native build trên Windows/CI). Refresh token **rotation + hash-at-rest**. Reset token **hash-at-rest + hết hạn + single-use**, không log. Login/logout/forgot → **audit_logs** (qua đường audit có tenant context, §3b). DTO `/me` KHÔNG trả hash. | 🔴 | Opus | security-reviewer (FULL) + tdd-guide | — | **RED:** sai mật khẩu → 401, không lộ user tồn tại. `companySlug` sai → 401 đồng nhất (không lộ tenant tồn tại). `/me` không token → 401. Refresh token đã dùng (rotation) → 401. Response không chứa `password_hash`. forgot-password không tiết lộ email tồn tại; reset token dùng-2-lần → từ chối. **Brute-force:** N lần sai liên tiếp → 429/khóa tạm. | Rate-limit login; token TTL đúng; audit mỗi sự kiện auth. |

> **Thứ tự thực thi (tuần tự — solo, đụng schema/lõi chung):** G2-1 → G2-2 → G2-3 → **G2-5 (viết test isolation ngay)** → G2-4 → G2-6. Không song song (mọi bước đụng DB core / RLS).

## 5. Rủi ro & giảm thiểu (PHẦN QUAN TRỌNG NHẤT)

| Rủi ro | Khả năng | Tác động | Giảm thiểu |
| --- | --- | --- | --- |
| **Rò chéo tenant** (set_config session-level thay vì local; connection tái dùng qua PgBouncer) | Trung bình | 🔴 chí mạng | `set_config(...,true)` LOCAL trong tx (ADR 0003); withTenant 1-tx-1-conn; **G2-5 test đối kháng** là gate; CI assert PgBouncer×RLS. |
| **App role vô tình BYPASSRLS / là owner** ⇒ FORCE vô hiệu | Thấp | 🔴 cao | G2-1 `mediaos_app` NOBYPASSRLS + không owner; assert trong migration test. |
| **Mất event** (phát event trong code, rollback ⇒ event lỡ phát; hoặc crash giữa chừng) | Trung bình | 🟠 cao | Transactional outbox (ghi DB+outbox cùng tx); worker tách; consumer idempotent; dead-letter + alert. |
| **Nuốt lỗi audit/event** (catch rỗng, fallback im lặng) | Trung bình | 🟠 | `silent-failure-hunter` FULL gate; `anti-bandaid-guard` hook chặn catch rỗng; alert dead-letter. |
| **Audit/outbox bị UPDATE/DELETE** (phá append-only — bất biến #2) | Thấp | 🔴 | Grant: app INSERT-only; `guard-immutability.mjs` hook; test app role UPDATE → từ chối. |
| **Lộ secret/hash trong DTO/log** (bất biến #3) | Trung bình | 🔴 | BaseDTO không serialize hash; `guard-secrets.mjs` hook; security-reviewer; `/me` test không chứa hash. |
| **Test RLS không chạy được local** (không Docker) ⇒ ảo tưởng xanh | Cao | 🟠 | Tag integration; **gate ở CI** (Postgres ephemeral G1-6); local mock chỉ phần logic withTenant, KHÔNG coi là pass isolation. |
| **Migration order sai** (backfill trước policy) | Thấp (bảng mới) | 🔴 | Bảng mới ⇒ policy+FORCE cùng CREATE; CI assert GX-4; checklist migration. |

## 6. Test plan

- **Deny-path RED trước implement** (mọi bước 🔴): danh sách ca ở cột "Test" mục 4 — phải đỏ trước khi viết code GREEN.
- **Coverage:** ≥80% chung; **withTenant / RLS / auth = cao hơn** (nhánh deny-path phủ hết).
- **Integration (Postgres thật, CI):** G2-3 RLS, G2-5 2-tenant, G2-4 outbox/idempotency/dead-letter, G2-6 auth flow.
- **Regression bắt buộc chạy lại:** G2-5 isolation suite sau MỌI bước (và mọi phase sau khi thêm bảng).
- **CI assert đặc thù:** (a) `mediaos_app` NOBYPASSRLS + không owner; (b) PgBouncer×RLS không rò qua connection tái dùng; (c) thứ tự policy+FORCE trước backfill (GX-4).

## 7. Commit & merge

- Nhánh: `feat/g2-security-tenant` (cắt từ `master` sau khi G1 merge — xem mục 3).
- Micro-commit mỗi bước G2-x. Conventional: `feat(G2-3): users + RLS policy + FORCE`.
- **Điều kiện merge:** cụm xanh + **FULL gate** đạt (security + database + silent-failure) + G2-5 isolation xanh trên CI + `completion-evaluator` PASS.

## 8. Rollback

- Mỗi migration **reversible** (down drop policy/table). Outbox/audit là bảng mới → drop an toàn (chưa có dữ liệu thật).
- Auth sau lưng feature-flag `AUTH_ENABLED`? Không cần — G2 chưa lên prod; lùi bằng revert commit.
- Nếu RLS gây chặn nhầm (false-deny) → KHÔNG tắt FORCE; sửa policy/withTenant rồi re-test (tắt FORCE = mở cửa rò, cấm).

## 9. Custom component cần tạo trước/khi vào bước (TASKS §"Custom components")

| Tên | Loại | Dùng ở | Khi |
| --- | --- | --- | --- |
| `rls-tenant-isolation-tester` | agent | G2-5 | trước G2-5 |
| `event-outbox-audit-guide` | skill | G2-4 | trước G2-4 |
| `tenant-isolation-guard` | hook | xuyên suốt | ✅ đã có (`guard-tenant.mjs`) |

---

## ✅ Kết quả rà soát plan (`plan-reviewer`)

**Vòng 1 (2026-06-05): VERDICT = REVISE** → 4 rủi ro chặn, đã vá hết:

1. **[RLS ghi chéo] G2-3 thiếu `WITH CHECK`** → đã thêm `USING` + `WITH CHECK` + deny-path "INSERT/UPDATE company_id=B trong withTenant(A) bị từ chối" + ghi chú đồng bộ ERD §6.
2. **[Idempotency sai khóa] G2-4 bỏ `consumer_name`** → đã chốt `processed_events UNIQUE (consumer_name, event_id)` + deny-path "2 consumer khác tên cùng event đều xử lý".
3. **[Login không resolve nổi tenant] email không unique toàn cục** → đã thêm **§3b**: login nhận `companySlug` → resolve `company_id` → withTenant; audit auth có tenant context.
4. **[Vùng đỏ hạ nhầm] G2-1 để 🟡 Sonnet** → đã nâng 🔴 Opus + FULL gate + deny-path role/grant.

**Cảnh báo đã fold vào plan:** harness G2-5 tiến hóa (thêm ca sau G2-4/G2-6) ⟶ *(còn ghi ở mục 6, nên bổ sung 1 dòng ở row G2-5)*; set_config bind-param (G2-2); test PgBouncer pool max=1 (G2-2); rate-limit brute-force (G2-6); forgot-password token hash/expiry/single-use (G2-6); cột `audit_logs` đã chốt (G2-4); argon2 dep + native build (G2-6); dead-letter alert sink (G2-4).

**Câu hỏi mở còn lại (không chặn, cần chốt trước bước tương ứng):**
- Tham số cost argon2id cụ thể (memory/iterations) — chốt ở đầu G2-6.
- Kênh sink cho dead-letter alert (log+noti nào) — chốt ở đầu G2-4.
- **Cổng cứng:** G1 CI xanh lần đầu (cần push) TRƯỚC khi code G2-1.

_Khuyến nghị: chạy `plan-reviewer` vòng 2 xác nhận PASS sau khi review các vá này (tùy chi phí)._

## 🏁 Kết quả đánh giá hoàn thành (`completion-evaluator`)

**Triển khai (2026-06-05, nhánh `feat/g2-security-tenant` cắt từ HEAD G1 — master chưa merge G1):**

- **G2-1** migration `0001_roles_and_grants.sql`: 3 role (`mediaos_owner/app/worker`) + `pgbouncer_auth` (auth_query pass-through, vá lỗ PgBouncer kết nối superuser → bypass RLS). Mật khẩu tách qua `scripts/setup-db-roles.mjs` (BẤT BIẾN #3). docker-compose PgBouncer chuyển sang pass-through user. **⚠️ pass-through PgBouncer chưa chạy thử (không có Docker ở môi trường code) — cần `docker compose up` kiểm chứng.**
- **G2-2** `withTenant` (`db.service.ts`): `set_config(...,true)` LOCAL qua bind-param, validate UUID trước khi mở tx.
- **G2-3** `0002`: `companies`+`users` RLS USING+WITH CHECK+FORCE + partial-unique soft-delete + `resolve_company_by_slug` (SECURITY DEFINER, lỗ RLS có kiểm soát cho login).
- **G2-4** `0003`: `audit_logs` append-only (grant không UPDATE/DELETE) + outbox + `processed_events` + `dead_letter_events` + EventBus + OutboxWorker (claim CTE SKIP LOCKED, idempotent, dead-letter + alert).
- **G2-5** harness 2-tenant data-driven (`rls-registry.ts` + `tenant-isolation.int-spec.ts`) phủ 7 bảng RLS. Agent `rls-tenant-isolation-tester` **CHƯA tạo** (harness từ chối tạo file `.claude/agents/` — cần user cho phép).
- **G2-6** `0004`: auth login/refresh/me/forgot/reset — argon2id (`@node-rs/argon2`, prebuilt → OK Windows/CI), refresh rotation + hash-at-rest, reset single-use, rate-limit (in-memory), audit mọi sự kiện.

**Kiểm thử:** 30 unit test xanh local; 49 integration test (RLS/isolation/outbox/auth) tag `*.int-spec.ts` — TỰ SKIP khi không có DB, **chạy thật trên Postgres ở CI** (CI đã sửa: app kết nối bằng `mediaos_app` để RLS được ép thật; migrate + setup-roles trước test). Lint/typecheck/build toàn workspace xanh.

**FULL gate (security + database + silent-failure reviewer) — đã chạy. Đã VÁ:**
- 🔴 Interval `(int || ' ms')::interval` ném lỗi runtime → `make_interval(secs=>…)` (reaper + backoff đều hỏng nếu không vá — cả 3 reviewer bắt).
- Claim outbox đổi sang CTE (atomic, chống double-claim đồng thời).
- `dead_letter_events` UNIQUE(event_id,consumer_name) + ON CONFLICT (chống dead-letter/alert trùng khi crash giữa chừng).
- `resolve_company_by_slug` bỏ `public` khỏi search_path (chống schema-shadowing).
- `current_setting(...)::uuid` → `NULLIF(...,'')::uuid` (deny thay vì throw khi GUC rác).
- `/me` chọn cột tường minh (loại `password_hash` ở tầng query).
- Alert dead-letter log kèm stack; payload null → throw thay vì `?? {}`.
- Drizzle schema khớp SQL: PK composite `processed_events`, self-FK `replaced_by`, partial-index predicate `dead_letter`.

**FOLLOW-UP cần xử lý (chưa vá — quyết định kiến trúc/ops, ghi để không trôi):**
1. 🔴 **Reset token plaintext trong `outbox_events.payload`** (durable) — cần envelope-encrypt (G6-2) + purge outbox trước PROD. Đã đánh dấu trong code.
2. **Rate-limit login** in-memory → Valkey + bucket theo tài khoản (không chỉ IP) + backoff luỹ tiến; thêm rate-limit cho `/auth/refresh` + `/auth/reset-password` (chống pool-exhaustion + brute-force).
3. **`workerDb` fallback `directPool`** (owner/superuser) khi thiếu `DATABASE_WORKER_URL` → bypass RLS thầm lặng; cần assert `current_user = mediaos_worker` ở prod.
4. **`audit_logs.object_type` CHECK enum đóng** → mỗi module mới phải ALTER; cân nhắc bỏ CHECK, ép ở app, hoặc bảng lookup.
5. **`password.verify` catch** nuốt lỗi hạ tầng thành "sai mật khẩu" → tách lỗi argon2-mismatch vs lỗi hệ thống (log + rethrow).
6. Phụ: bỏ `email` khỏi JWT claim; pin image `edoburu/pgbouncer`; bỏ `DELETE` grant trên `companies`/`users` (ép soft-delete ở DB); `NOINHERIT` cho `pgbouncer_auth`; index `audit_logs(actor_user_id)`; `dead_letter` worker WITH CHECK theo company_id.

**Cổng merge còn chờ:** G1 CI xanh + merge master; chạy integration suite trên CI lần đầu (xác nhận RED→GREEN thật); kiểm chứng PgBouncer pass-through bằng Docker; tạo agent `rls-tenant-isolation-tester` (cần user cho phép); xử lý follow-up #1 trước khi auth lên prod.
