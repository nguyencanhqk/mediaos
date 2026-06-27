<!-- ⚙️ KHỐI MÁY-ĐỌC (auto-loop ĐỌC khối này thay vì phân rã lại; reconcile-refresh trước build). -->
```yaml
wo: S2-AUTH-DB-2
zone: red
status: in_progress
generated_by: opus
reconciled_at: "head 0442 / idx 125 (origin/master). Next: 0443, idx 126, when 1717500610000."
lanes:
  - id: S2-AUTH-DB-2
    builder: db-migration   # LANE NỐI TIẾP duy nhất chạm schema/migration — crown → Opus
    task: "Reconcile AUTH tables vs §12.1: ALTER users (+normalized_email/failed_login_count/locked_at/locked_reason/audit cols + indexes); CREATE user_sessions (mutable) + login_logs (append-only) + user_security_events (append-only) — mỗi bảng company_id NOT NULL + RLS ENABLE+FORCE + policy + register RLS_TABLES; login_logs/user_security_events GRANT SELECT,INSERT (no UPDATE/DELETE)."
    paths:
      - "apps/api/src/db/schema/users.ts"
      - "apps/api/src/db/schema/auth.ts"
      - "apps/api/src/db/schema/auth-logs.ts"
      - "apps/api/src/db/schema/index.ts"
      - "apps/api/migrations/0443_s2_authdb2_sessions_logs_security_events.sql"
      - "apps/api/migrations/meta/_journal.json"
      - "apps/api/test/integration/rls-registry.ts"
      - "apps/api/test/integration/auth-appendonly.int-spec.ts"
      - "apps/api/test/helpers/seed.ts"   # cleanupTenants: explicit delete 3 new tables before users (FK) — per plan-review R1#1
acceptanceChecks:
  - "users có cột normalized_email (generated stored lower(email)), failed_login_count (NOT NULL DEFAULT 0), locked_at, locked_reason, created_by/updated_by/deleted_by; unique (company_id, normalized_email) WHERE deleted_at IS NULL + index (company_id, status). KHÔNG db:generate/drop; users RLS giữ nguyên (đã ENABLE+FORCE từ 0002)."
  - "user_sessions/login_logs/user_security_events: company_id NOT NULL DEFAULT GUC + RLS ENABLE+FORCE + policy tenant_isolation (USING+WITH CHECK GUC). rls-guards 'không bảng nào company_id thiếu case' + rls-coverage-assert (ENABLE+FORCE+đọc+ghi) đều XANH (3 case mới trong RLS_TABLES)."
  - "login_logs + user_security_events APPEND-ONLY: app role GRANT SELECT,INSERT only (KHÔNG UPDATE/DELETE). RED test: app INSERT OK; app UPDATE → permission denied; app DELETE → permission denied (BẤT BIẾN #2)."
  - "user_sessions MUTABLE: GRANT SELECT,INSERT,UPDATE (revoke = UPDATE revoked_at). index (user_id, expired_at, revoked_at) + unique(refresh_token_hash)."
  - "indexes §12.4: unique (company_id, normalized_email) users; login_logs (company_id, created_at desc)+(normalized_email, created_at desc); migrate 0000→head sạch trên lane DB; cross-tenant deny xanh (tenant-isolation tự phủ qua RLS_TABLES)."
  - "Migration 0443 nối tiếp head 0442 (idx 126, when 1717500610000); journal append đơn điệu; KHÔNG đụng refresh_tokens/password_reset_tokens (đã thoả §12.1)."
testTasks:
  - "apps/api/test/integration/auth-appendonly.int-spec.ts (mirror audit-logs-appendonly): gate hasDb && LANE_DB; seed direct (superuser); app INSERT login_logs/user_security_events OK; app UPDATE/DELETE → rejects.toThrow(/permission denied/)."
  - "RLS_TABLES += {user_sessions, login_logs, user_security_events} → rls-guards + rls-coverage-assert + tenant-isolation tự phủ ENABLE+FORCE+policy+cross-tenant-deny."
  - "migrate 0000→head trên DB cô lập lane (scripts/lane-db-setup.sh) → áp 0443 sạch, không drop."
steps:
  - "Schema TS: users.ts (+cột); auth.ts (+userSessions); auth-logs.ts MỚI (loginLogs+userSecurityEvents); index.ts export."
  - "0443_s2_authdb2_sessions_logs_security_events.sql (style mig 0442: CREATE TABLE IF NOT EXISTS, ENABLE+FORCE, DROP POLICY IF EXISTS+CREATE POLICY tenant_isolation, GRANT theo mutable/append-only, GRANT SELECT worker)."
  - "_journal.json append {idx:126, version:'7', when:1717500610000, tag:'0443_s2_authdb2_sessions_logs_security_events', breakpoints:true}."
  - "RLS_TABLES += 3 case (cuối mảng); RED auth-appendonly.int-spec.ts."
```

# S2-AUTH-DB-2 — Micro-plan (đối chiếu AUTH tables vs DB-02 §12.1 / IMPLEMENTATION-05 §12.1·§12.4)

> Zone: 🔴 RED / crown (auth · RLS · append-only · migration). Reconcile-first, **additive**, spec-wins, **một head — một lane**.
> Migration head: idx **125** / `0442_s2_hrdb1_hr_core_reconcile` (origin/master). Next: `0443`, idx **126**, when `1717500610000`.
> Nguồn: DB-02 §7 · IMPLEMENTATION-05 §12.1/§12.4 · ISSUE-BOARD-01 §18.3 (AUTH-DB-001/002) · SPEC-02.

## 0. Kết quả đối chiếu (verify line-level + LIVE DB `mediaos`)

| §12.1 bảng | Trạng thái hiện tại (live DB) | Hành động |
| --- | --- | --- |
| `users` | có id/company_id/email(citext)/password_hash/full_name/status/created_at/updated_at/deleted_at/last_login_at (0002+0370). **Thiếu** normalized_email · failed_login_count · locked_at · audit cols. | **ALTER** thêm cột + index. RLS giữ (đã ENABLE+FORCE 0002). |
| `password_reset_tokens` | có token_hash·expires_at·used_at·company_id·user_id (auth.ts/0004). | ✅ **thoả §12.1** ("token hash, expired_at, used_at") — KHÔNG đụng. |
| `user_sessions` | **KHÔNG tồn tại** (live DB xác nhận). `refresh_tokens` đang gánh session nhưng KHÁC tên + thiếu ip/user_agent. | **CREATE** bảng canonical (mutable). refresh_tokens GIỮ NGUYÊN (no-drop). |
| `login_logs` | **KHÔNG tồn tại**. | **CREATE** (append-only). |
| `user_security_events` | **KHÔNG tồn tại**. | **CREATE** (append-only, event_type/severity/payload). |

> ⚠️ Plan cũ `S0-AUTH-DB-1.md` ghi "login_logs/user_sessions đã có RLS+FORCE band auth" — **SAI**, đã bác bằng `information_schema.tables` trên DB `mediaos` (chỉ có users/refresh_tokens/password_reset_tokens). Tin DB, KHÔNG tin claim cũ.

## 1. Schema delta (additive — KHÔNG db:generate, KHÔNG drop/rename)

### A. `users` (ALTER — RLS giữ, KHÔNG backfill company_id vì đã NOT NULL)
| Cột thêm | Kiểu | Ghi chú |
| --- | --- | --- |
| `normalized_email` | `text GENERATED ALWAYS AS (lower(email::text)) STORED` | §12.1+§12.4. email đã citext (case-insensitive) → cột này dư-nhẹ nhưng spec yêu cầu; generated ⇒ không drift, app khỏi set. |
| `failed_login_count` | `int NOT NULL DEFAULT 0` | đếm fail liên tiếp (BE-1 tăng/reset). |
| `locked_at` | `timestamptz` | thời điểm khoá. |
| `locked_reason` | `text` | cặp tự nhiên với locked_at (DB-02 §7.1). |
| `created_by`/`updated_by`/`deleted_by` | `uuid REFERENCES users(id)` | audit cols (§12.1 "audit columns"). self-ref nullable. |

Index: `users_company_normalized_email_active_uq UNIQUE (company_id, normalized_email) WHERE deleted_at IS NULL` (§12.4) · `users_company_status_idx (company_id, status)`.
KHÔNG đụng `users_company_email_active_uq` cũ (giữ — citext đã ép unique; index mới = spec-literal song song).

### B. `user_sessions` (CREATE — MUTABLE, GRANT SELECT,INSERT,UPDATE)
`id · company_id NOT NULL DEFAULT GUC REFERENCES companies ON DELETE CASCADE · user_id NOT NULL REFERENCES users · refresh_token_hash text NOT NULL · access_token_jti text · ip_address · user_agent · device_id text · device_name text · platform · last_used_at · expired_at timestamptz NOT NULL · revoked_at · revoked_by uuid REFERENCES users ON DELETE SET NULL · revoked_reason · created_at`. *(R1-MED: thêm access_token_jti/device_id/device_name nullable theo DB-02 §7.6 — tránh BE-1 re-migration.)*
RLS ENABLE+FORCE + policy. Index: `(user_id, expired_at, revoked_at)` · UNIQUE `(refresh_token_hash)` · `(company_id, created_at desc)`.
→ revoke = UPDATE `revoked_at` (no hard-delete grant). **Coexist refresh_tokens**: BE-1 chốt session strategy S2-OQ-001 (HttpOnly cookie) rồi hợp nhất; DB-2 chỉ dựng bảng canonical §12.1 cần cho BE-1.

### C. `login_logs` (CREATE — APPEND-ONLY, GRANT SELECT,INSERT) — **company_id NULLABLE (R1#2)**
`id · company_id uuid NULL DEFAULT GUC REFERENCES companies ON DELETE CASCADE · user_id uuid NULL REFERENCES users ON DELETE SET NULL · email text NOT NULL · normalized_email text NOT NULL · login_status text NOT NULL CHECK IN ('success','failed','blocked') · failure_reason text · ip_address · user_agent · platform · session_id uuid NULL REFERENCES user_sessions ON DELETE SET NULL · metadata jsonb NOT NULL DEFAULT '{}' · created_at`.
RLS ENABLE+FORCE + **nullable-tenant policy** (mẫu `public_holidays` 0434):
- `USING (company_id = GUC OR company_id IS NULL)` — tenant đọc row mình + row unattributed.
- `WITH CHECK (company_id = GUC OR (company_id IS NULL AND <no-context>))` — app ghi row tenant mình; ghi NULL-company CHỈ khi KHÔNG có ngữ cảnh (pre-auth, unknown-email fail). Vẫn refsGuc ⇒ qua rls-coverage-assert (b).
Index: `(company_id, created_at desc)` · `(normalized_email, created_at desc)` · `(user_id, created_at desc)` · `(ip_address, created_at desc)` · `(company_id, login_status)`.
> **R1#2 — company_id NULLABLE per DB-02 §7.8** (REVERSED từ NOT NULL): fail login email-không-tồn-tại KHÔNG resolve được company nhưng S2-AUTH-BE-1 done_when YÊU CẦU ghi login_log Failed (chống brute-force, KHÔNG lộ user). NOT NULL chặn → BE-1 phải bỏ log/giả company. Nullable + nullable-tenant RLS giải đúng. login_status **lowercase** theo chuẩn codebase.

### D. `user_security_events` (CREATE — APPEND-ONLY, GRANT SELECT,INSERT)
`id · company_id NOT NULL DEFAULT GUC REFERENCES companies ON DELETE CASCADE · user_id uuid NOT NULL REFERENCES users · event_type text NOT NULL · severity text NOT NULL DEFAULT 'info' CHECK IN ('info','low','medium','high','critical') · actor_user_id uuid NULL REFERENCES users · ip_address · user_agent · payload jsonb NOT NULL DEFAULT '{}' · created_at`.
RLS ENABLE+FORCE + policy. Index: `(company_id, user_id, created_at desc)` · `(company_id, event_type)`.

## 2. Migration 0443 — thứ tự (RLS+FORCE TRƯỚC mọi backfill; KHÔNG có backfill ở WO này)
1. `ALTER TABLE users ADD COLUMN …` (generated/default/nullable — không backfill company_id). + 2 index.
2. CREATE `user_sessions` → ENABLE+FORCE → policy → index → GRANT (app SELECT,INSERT,UPDATE · worker SELECT).
3. CREATE `login_logs` → ENABLE+FORCE → policy → index → GRANT (app SELECT,INSERT · worker SELECT) — append-only.
4. CREATE `user_security_events` → ENABLE+FORCE → policy → index → GRANT (app SELECT,INSERT · worker SELECT) — append-only.

Style = mig 0442 (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS tenant_isolation` + `CREATE POLICY`, không `--> statement-breakpoint`, chạy cả file 1 query). Header ghi rõ deviation (login_logs company_id NOT NULL; user_sessions coexist refresh_tokens).

## 3. Bất biến (crown)
- **#1 tenant (RLS+FORCE):** 3 bảng mới company_id NOT NULL + ENABLE+FORCE + policy `current_setting('app.current_company_id', true)`; FORCE TRƯỚC dữ liệu (không backfill). RLS_TABLES += 3 case ⇒ rls-guards/coverage/tenant-isolation tự ép. WITH CHECK chặn INSERT chéo.
- **#2 append-only:** login_logs + user_security_events → app GRANT SELECT,INSERT only (KHÔNG UPDATE/DELETE). RED test write-then-update/delete FAIL. user_sessions KHÔNG append-only (revoke=UPDATE hợp lệ).
- **#3 no secret:** không bảng nào lưu plaintext secret; refresh_token_hash = HASH (BE-1 hash trước khi ghi). login_logs.metadata/user_security_events.payload = ngữ cảnh non-sensitive (cấm password/token).

## 4. Phạm vi KHÔNG đụng
refresh_tokens · password_reset_tokens · roles/permissions/role_permissions/user_roles/object_permissions (0005/0441) · RLS/policy/grant bảng cũ · wildcard seed. KHÔNG sửa contracts (BE-1). KHÔNG service/guard/endpoint (BE-1/BE-4).

## 5. Verify (DB cô lập theo lane)
```
bash scripts/lane-db-setup.sh authdb2
export LANE_DB=mediaos_authdb2
pnpm --filter @mediaos/api db:migrate          # 0443 áp sạch, nối head 0442 (idx 126)
pnpm --filter @mediaos/api test -- auth-appendonly rls-guards rls-coverage-assert tenant-isolation migration-smoke
pnpm --filter @mediaos/api typecheck
```
Đích: migrate 0000→head sạch; 3 bảng ENABLE+FORCE+policy; login_logs/user_security_events UPDATE/DELETE bằng app role = permission denied; user_sessions UPDATE OK; cross-tenant deny xanh; typecheck xanh.

## 6. Gate
**FULL** (diff chạm auth/RLS/append-only/migration): `security-reviewer` + `rls-tenant-isolation-tester` + `silent-failure-hunter`. Người chốt vùng đỏ trước merge (PR auto-merge label).

## 7. Out-of-scope (WO sau)
- Login/logout/me · session issue/revoke · ghi login_log/security_event → **S2-AUTH-BE-1**.
- change/forgot/reset-password (purpose/ip trên password_reset_tokens nếu cần) → **S2-AUTH-BE-4**.
- Hợp nhất refresh_tokens ↔ user_sessions theo S2-OQ-001 → **S2-AUTH-BE-1**.
- Seed permission/role với data_scope → **S2-AUTH-SEED-1**.
