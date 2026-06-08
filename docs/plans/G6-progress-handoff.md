# G6 — Sổ bàn giao tiến độ (HANDOFF cho session mới)

> Đọc file này + [`G6-media-full.md`](./G6-media-full.md) (kế hoạch gốc, plan-reviewer PASS) TRƯỚC khi code tiếp.
> Mục tiêu: 1 session mới cầm file này là tiếp tục được ngay, không phải dò lại.
> Cập nhật lần cuối: 2026-06-07 · Branch: **`feat/g6-media`** · HEAD: **`7c008ce`** (G6-4 done — còn **G6-2**)
> ✅ **Reconciled:** 2 session song song đã hoàn tất — **G6-5** (Channel Health, `4e620a0` + fix settings.module
> `421e15c`) và **G6-4** (Content full, `0041ea4`→`7c008ce`). Lịch sử interleave nhưng linear, không conflict;
> tree cuối nhất quán + xanh. **G6-1/3/4/5 XONG — chỉ còn G6-2 (crown-jewel, hand-driven).**

---

## 1. Đã xong (committed trên `feat/g6-media`)

| Commit | Nội dung | Đã verify? |
| --- | --- | --- |
| `1cd20c3` `feat(G5)` | Commit toàn bộ G5 còn treo + **vá `_journal.json`** (0014–0019 bị bỏ sót, drizzle chưa bao giờ apply) | ✅ migrate |
| `e9c7edf` `docs(G6)` | Plan G6 + cập nhật roadmap | — |
| `d246d74` `feat(g6-0)` | **Migration 0020** — `audit_logs_object_type_chk` + `AUDIT_OBJECT_TYPES` (11 type G6, cùng commit) | ✅ |
| `8a9fbe3` `feat(g6-1)` | **Migration 0021** — `platforms` (catalog global, seed 6) + ALTER `channels` (platform_id FK, reconcile, widen status, health cols, partial-unique code) + `channel_members`; Drizzle schema + contracts + create-path + RLS registry | ✅ |
| `c5060aa` `feat(g6-1d)` | `ChannelsController` (permission-gated) + channel CRUD/filter/get/update/soft-delete + members CRUD + **audit-in-tx** + `GET /platforms` | ✅ typecheck + regression |
| `f4a07d2` `feat(g6-1e)` | **FE channels**: `channels-api` client + `ChannelTable` (TanStack Table v8) + `ChannelFilterBar` (platform/status/manager/niche/q) + `CreateChannelDialog`/`EditChannelDialog` + detail `/channels/$id` tabs (Overview/Members) + members CRUD; `Dialog`/`Select` primitives; `<PermissionGate>` create/update/delete | ✅ typecheck(3 pkg)+lint+17 test+vite build |
| `6a380a1` `feat(g6-3a)` | **Migration 0023** — ALTER `projects` (code/type/owner/manager/dates/priority/budget + type/priority CHECK + code partial-uq) + ALTER `project_channels` (role/status + GRANT UPDATE + fix-forward uq dẫn đầu company_id) + `project_teams` + `project_members` (RLS+FORCE); Drizzle schema; rls-registry (2 bảng mới) | ✅ migrate + regression |
| `d5021ba` `test(g2-5)` | **Vá lỗ rls-registry tồn đọng G5** — `positions`/`employee_profiles`/`employee_manager_relations` có company_id nhưng chưa đăng ký → `rls-guards` completeness test đỏ ngầm (gate cũ chỉ chạy tenant-isolation nên không lộ) | ✅ rls-guards 3 pass |
| `e335795` `feat(g6-3bc)` | **Contracts + BE**: `projectSchema` full + request schemas; `ProjectsRepository`/`Service`/`Controller` (tách khỏi MediaService) — CRUD + attach/detach kênh/team/member + audit-in-tx + `@RequirePermission` gate; gỡ project khỏi MediaController/Service/Repo (giữ content) | ✅ typecheck+lint+app boot |
| `c41039c` `feat(g6-3d)` | **FE projects**: `projects-api` + `ProjectTable`/`ProjectFilterBar` (status/type/priority/PM/q) + create/edit dialogs + detail `/projects/$id` tabs (Tổng quan/Kênh/Team/Thành viên/Nội dung); `link-dialogs`; media-api thu gọn content-only | ✅ typecheck(3 pkg)+lint+17 test+vite build |
| `9e583dc` `fix(g6-3)` | **FULL-gate review fix**: in-tx tenant-scoped guard channel/team/user (chặn link chéo tenant + TOCTOU soft-delete); audit objectId removeTeam→teamId; listProjects sub-query scope theo project ids; numToStr finite guard | ✅ typecheck+lint+regression |
| `4e620a0` `feat(g6-5)` | **Channel Health** (KHÔNG migration — health_* có ở 0021): `PATCH /channels/:id/health` + audit `ChannelHealthUpdated` + filter risk; FE tab Sức khỏe + filter "kênh rủi ro" + Dashboard widget | ✅ typecheck+lint+build |
| `421e15c` `fix(api)` | **settings.module import PermissionModule** — unblock e2e bootstrap (pre-existing lỗ G5, ngoài G6) | ✅ |
| `0041ea4` `feat(g6-4a)` | **Migration 0024** `content_types` (RLS+FORCE; template id = uuid TRẦN không FK, defer G7/G8) + Drizzle + rls-registry | ✅ migrate 24 + regression |
| `22a3ae2` `feat(g6-4b)` | **Migration 0025** `content_items` ERD-full (🔴 breaking: `content_type` text → `content_type_id` FK; NOT EXISTS seed + backfill + GUARD NULL + production_status) + media.ts + contracts (contentTypeSchema enum→object) + rls-registry seedContentItem + FE default | ✅ migrate 25 + regression |
| `9b2691f` `feat(g6-4c)` | **Migration 0026** `content_channels` + `content_assets` (version chain, one-current uq WHERE is_current AND deleted_at IS NULL) + Drizzle + rls-registry x2 | ✅ migrate 26 + tenant-isolation 126 |
| `da67d1a` `feat(g6-4de)` | **Contracts + BE**: content full contracts (publishStatus/contentChannel, assetType/contentAsset+version, suggest); `ContentController`/`Service`/`Repository` tách — CRUD + đa kênh publish (snapshot platform_id) + asset version chain (demote→insert→supersede 1-tx) + soft-delete current flip + suggest-workflow + audit + cross-tenant guard; gỡ content khỏi Media\* (xoá MediaController) | ✅ typecheck + content.int 9 |
| `b554a27` `feat(g6-4f)` | **FE content**: `content-api` + `/content` list (filter+table+CreateContentDialog gợi ý workflow) + `/content/$id` tabs (Tổng quan/Kênh đăng/Asset version) + constants VI + nav | ✅ typecheck 4 + web lint/build |
| `7c008ce` `fix(g6-4)` | **FULL-gate review fix**: ListContentQueryDto (q≤200 + filter uuid, chặn DoS); guard ownerUserId chéo tenant; escape ILIKE; guard insert rows + demote/supersede rows; softDelete luôn is_current=false; contentExistsTx cho update/remove channel; join deleted_at | ✅ content.int 10 + regression |

**Trạng thái DB thực tế (đã verify live):**
- Đã migrate sạch tới **0026** (26 record trong `drizzle.__drizzle_migrations`). `content_items.content_type` text ĐÃ DROP → `content_type_id` FK; `content_types`/`content_channels`/`content_assets` tồn tại (RLS+FORCE).
- **2-tenant regression: tenant-isolation 126 pass / 2 skip + rls-guards 3 pass** (đã phủ content_types/content_channels/content_assets). `content.int-spec` 10 ca (version chain/đa kênh/cross-tenant/suggest).
- `pnpm typecheck` xanh cả 3 package; web lint 0 error + vite build xanh.
- ⚠️ **Chưa render live** với browser+auth+seed (mọi FE G6 cùng trạng thái — auth header chưa wa FE-wide, pre-existing).
- ✅ G6-5 (Channel Health) + e2e bootstrap fix (`421e15c`) đã xong ở session song song.

---

## 2. RUNBOOK — bẫy đã gặp, làm đúng ngay (QUAN TRỌNG)

```bash
# 0) Bật hạ tầng (Docker Desktop phải chạy trước)
pnpm db:up                       # postgres/pgbouncer/valkey/minio

# 1) ⚠️ db:migrate KHÔNG tự load .env (migrate.ts đọc thẳng process.env, không dotenv).
#    PHẢI inject env từ root .env:
set -a && . ./.env && set +a && pnpm --filter @mediaos/api db:migrate

# 2) Chạy 2-tenant RLS regression (env DB đã baked trong vitest.config.ts → app role direct :5432)
pnpm --filter @mediaos/api exec vitest run test/integration/tenant-isolation.int-spec.ts

# 3) Soi schema nhanh
docker exec mediaos-postgres psql -U mediaos -d mediaos -tAc "SELECT ... "

# 4) Typecheck
pnpm typecheck
```

- **Journal**: mọi migration mới PHẢI thêm entry vào `apps/api/migrations/meta/_journal.json` (idx tăng dần, `when` = 1717500000000 + idx*1000, `tag` = tên file không `.sql`). Quên = drizzle bỏ qua file.
- **Migration format**: `--> statement-breakpoint` giữa MỌI statement. Widen-CHECK trên bảng có data PHẢI có `UPDATE`/backfill + `DO $$ ... RAISE EXCEPTION ... $$` guard TRƯỚC `ADD CONSTRAINT`.
- **CHECK byte-identical** giữa SQL và `db/schema/*.ts`.
- **RLS registry**: mỗi bảng mới có `company_id` → THÊM 1 case vào `apps/api/test/integration/rls-registry.ts` (kèm seed dùng `platform_id` subquery nếu chạm channels). Không thêm = regression "xanh giả".

---

## 3. Quyết định đã chốt (ĐỪNG litigate lại)

1. **Member ops gated `update:channel`** (channel-manager đã có ở 0005) — KHÔNG tách resource type `channel-member` ở G6-1. Nếu G6-3/4 cần resource type riêng (`project-team`, `project-member`, `content-*`) → **seed trong migration của chính phase đó** (0023/0024/0026) thay vì dồn hết vào 0027; 0027 chỉ giữ phần SENSITIVE (`edit-platform-account`) của G6-2.
2. **Fix-forward trong 0021** (lệch so với draft plan, đã ghi chú trong file SQL):
   - Widen legacy `channels_platform_check` → 6 code (để `platform` text mirror được `platform_id` cho podcast/website).
   - Thêm cột `channels.health_note` (cho riskNote của G6-5; plan gốc thiếu chỗ chứa).
3. **ChannelsController tách riêng** khỏi `MediaController` (legacy projects/content). G6-3/G6-4 nên tạo `ProjectsController`/`ContentController` tương tự + retrofit guard, KHÔNG nhồi hết vào MediaController.
4. **Audit pattern**: service mở `db.withTenant(companyId, async (tx) => { repo.write(..., tx); await audit.record(tx, {...}); })` — business + audit CÙNG tx (mẫu `tasks.service.ts`). `objectType` phải nằm trong `AUDIT_OBJECT_TYPES`.

---

## 4. Còn lại — theo THỨ TỰ (user chốt: làm hết phần 🟢 rồi mới tới G6-2)

### 4.1 — G6-1e (FE channels) · 🟢 · KHÔNG migration · ✅ XONG (`f4a07d2`)
- ✅ `lib/channels-api.ts` (dùng `apiFetch` chung từ `api-client.ts`) — channels CRUD + members + `GET /platforms`. Đã gỡ `listChannels`/`createChannel` trùng khỏi `media-api.ts`.
- ✅ `components/channels/`: `ChannelTable` (TanStack Table v8, sort + link), `ChannelFilterBar` (platform/status/manager/niche/q), `CreateChannelDialog` + `EditChannelDialog` (dùng chung `channel-form-fields.tsx`), `AddChannelMemberDialog`, `constants.ts` (label VI), `use-channel-options.ts` (employees/teams cho dropdown).
- ✅ Primitives mới: `components/ui/dialog.tsx` + `components/ui/select.tsx` (house style nhẹ, không kéo shadcn nặng).
- ✅ `/channels` (rewrite) + `/channels/$channelId` (mới, tab Overview + Members; tab dùng state nội bộ, không cần lib Tabs). Route `channelDetailRoute` trong `router.tsx` (beforeLoad: authGuard). Mọi phần nhạy cảm bọc `<PermissionGate>` create/update/delete.
- **DoD**: ✅ typecheck FE xanh. ⚠️ list/filter/detail mới verify ở mức build/type — **chưa render live** (cần `db:up` + api + web + login + seed để chốt).

### 4.2 — G6-3 (Projects full) · 🟢 · ✅ XONG (`6a380a1`→`9e583dc`)
- ✅ **3a Migration 0023** `g6_projects_full.sql`: ALTER `projects` (code/type/owner/manager/dates/priority/budget + CHECK type+priority) + ALTER `project_channels` (role_in_project, status + **GRANT UPDATE** + **fix-forward `project_channels_uq` dẫn đầu company_id**) + CREATE `project_teams` + `project_members` (RLS+FORCE). journal idx 23 (when 1717500023000). migrate sạch tới 0023 (23 record). rls-registry +`project_teams`/`project_members`.
- ✅ **3b** Drizzle schema (`projects` full + `projectChannels` cols + `projectTeams` + `projectMembers`, CHECK byte-aligned) + contracts (`projectSchema` full + type/priority enum + create/update/listQuery + link request schemas).
- ✅ **3c** BE: `ProjectsRepository`/`Service`/`Controller` (**tách riêng** khỏi MediaService theo §3.3) — CRUD + attach/detach kênh/team/member + audit-in-tx (`project`/`project_team`/`project_member`) + `@RequirePermission` (link ops dùng `update:project`, mirror §3.1 — KHÔNG seed resource riêng). FULL-gate fix (`9e583dc`): guard chéo tenant + TOCTOU in-tx.
- ✅ **3d** FE: `/projects` (filter + TanStack Table) + `/projects/$projectId` tabs (Tổng quan/Kênh/Team/Thành viên/Nội dung). `projects-api` (authed apiFetch), detail dùng 1 getProject (embed links).
- **DoD**: ✅ typecheck 3 pkg + lint 0 error + 17 web test + vite build + app boot (routes `/projects*`) + tenant-isolation 118 pass + rls-guards 3 pass. ⚠️ **chưa render live** (auth header chưa wa FE-wide — pre-existing, mọi trang authed cùng trạng thái).

> ⚠️ **TRAP cho G6-2 (0022) — journal when-ordering:** 0023–0026 được tạo TRƯỚC 0022 (G6-2 làm cuối). `migrate.ts` của Drizzle áp migration có `when` > `when` lớn nhất đã apply. 0022 nếu giữ `when=1717500022000` (< 0023..0026 đã apply) sẽ **bị BỎ QUA**. Khi làm G6-2: đặt `when` của 0022 **LỚN HƠN** 0028 (vd 1717500030000+) HOẶC renumber. KHÔNG dùng công thức `when=base+idx*1000` cho 0022.

### 4.3 — G6-4 (Content full) · 🟢 · ✅ XONG (`0041ea4`→`7c008ce`)
- ✅ **4a Migration 0024** `content_types` (RLS+FORCE; template id uuid trần KHÔNG FK). **4b Migration 0025** `content_items` ERD-full (🔴 breaking `content_type` text→`content_type_id` FK; NOT EXISTS seed + backfill + GUARD NULL + production_status; DROP CHECK `content_items_content_type_check` tên DB thật). **4c Migration 0026** `content_channels` + `content_assets` (one-current uq WHERE is_current AND deleted_at IS NULL). Mỗi migration: journal idx 24/25/26 → migrate → regression → rls-registry (đủ 3 bảng).
- ✅ **4d/4e BE**: contracts content full (contentTypeSchema enum→**object**); `ContentController`/`Service`/`Repository` **tách riêng** (mirror Projects) — CRUD + đa kênh publish (snapshot platform_id) + **asset version chain** (demote is_current=false → INSERT bản mới → set superseded_by, 3-bước né FK + one-current uq, CÙNG 1 tx) + soft-delete current flip + suggest-workflow (đọc default_workflow_template_id) + audit-in-tx (`content`/`content_channel`/`content_asset`/`content_type`) + cross-tenant guard in-tx. Gated `*:content` (resource content-type/channel/asset DÀNH 0027). Gỡ content khỏi Media\* (xoá `media.controller.ts`).
- ✅ **4f FE**: `content-api` + `/content` list (filter production/status/q + table + CreateContentDialog gợi ý workflow) + `/content/$contentId` tabs (Tổng quan sửa production/status/priority/urls · Kênh đăng thêm/đổi status/gỡ · Asset nhóm theo version_group + thêm version + badge hiện hành) + constants VI + nav.
- ✅ **FULL gate** (database+security+silent-failure reviewer) → fix `7c008ce`: ListContentQueryDto (q≤200+uuid), ownerUserId guard chéo tenant, escape ILIKE, guard insert/demote/supersede rows, softDelete luôn is_current=false, contentExistsTx update/remove channel, join deleted_at.
- **DoD**: ✅ typecheck 4 task + `content.int-spec` 10 ca + rls-guards 3 + tenant-isolation 126 + web lint 0 error + vite build xanh. ⚠️ chưa render live.

### 4.4 — G6-5 (Channel Health) · 🟢 · **KHÔNG migration** · ✅ XONG
- ✅ **5a** BE: `PATCH /channels/:id/health` trong `ChannelsController` (gate `update:channel`) + `MediaService.updateChannelHealth` (audit-in-tx `ChannelHealthUpdated`, objectType `channel`; healthScore numeric(5,2) → `numToStr`). Filter "kênh rủi ro": `ListChannelsFilter.risk` + `listChannels` (`inArray(health_status, ['risk','declining'])`) + `@Query('risk')` (`risk==='true'`). Contracts: `updateChannelHealthSchema` (.partial) + `UpdateChannelHealthRequest` + `risk` vào `listChannelsQuerySchema`. `UpdateChannelHealthDto`.
- ✅ **5b** FE: `channelsApi.updateChannelHealth` + `risk` trong `ChannelFilters`/`buildChannelQuery`. Tab "Sức khỏe" trong `channel-detail.tsx` (dropdown `HEALTH_OPTIONS`, điểm 0–100 có guard, textarea note; Save bọc `<PermissionGate update channel>`, input disabled khi !canManage). `ChannelFilterBar`: checkbox "Chỉ kênh rủi ro". `home.tsx`: widget "Kênh rủi ro" (`listChannels({risk:true})`, gate `read:channel` qua `enabled`, link `/channels/$channelId`). `HEALTH_OPTIONS` thêm vào constants.
- **DoD**: ✅ typecheck 3 pkg + api/web lint 0 error + 17 web test + vite build xanh. ⚠️ **chưa render live** (auth header chưa wa FE-wide — pre-existing). KHÔNG migration → KHÔNG đụng journal/rls-registry.

### 4.5 — G6-2 (🔴 CROWN-JEWEL, LÀM CUỐI, hand-driven) · plan §6 + §4 G6-2
> ⚠️ TASKS/plan: **đừng để AI tự do**. RED-test-first (14 ca §6e), FULL gate, Opus.
- **2a Migration 0022** · ✅ XONG: `platform_accounts` (8 cột envelope ERD v2 §2.1, KHÔNG `encrypted_password`) + worker policy `platform_accounts_worker_all` + column-grant `UPDATE(encrypted_dek,kms_key_id,dek_key_version,last_rotated_at)` + `encryption_keys` (GLOBAL no-RLS, seed key_version 1 `local-dev-kek`) + `channel_accounts` (link thuần A, uq dẫn đầu company_id). **journal idx 27 / when 1717500030000** (> max-applied 26000; KHÔNG dùng base+idx). Drizzle schema (`bytea` customType — bytea đầu tiên repo) + rls-registry (+platform_accounts/+channel_accounts; `encryption_keys` KHÔNG đăng ký vì global). **Hardening sau FULL gate:** gỡ dead `GRANT SELECT channel_accounts→worker` + `CHECK octet_length(iv_nonce)=12 / auth_tag=16`. migrate sạch, tenant-isolation 132 + rls-guards 3 + typecheck XANH. FULL gate (security+database reviewer) = **PASS-WITH-WARNINGS, 0 blocker**.
  - ⚠️ **CARRY-FORWARD từ FULL gate 2a (xử lý ở bước tương ứng):**
    - **2c/2e (🔴 nhất):** `platform_accounts.id` có DB default `gen_random_uuid()` nhưng AAD pin theo id → crypto service **PHẢI tự `crypto.randomUUID()` + truyền `id` vào INSERT TRƯỚC encrypt** (KHÔNG để DB sinh → tránh AAD mismatch). RED cover.
    - **2e:** mask `secret_ciphertext/encrypted_dek/iv_nonce/auth_tag/recovery_*/two_factor_note` khỏi default DTO (RED 7/10); cân nhắc view `platform_accounts_safe` (defense-in-depth, tùy chọn).
    - **2g:** cân nhắc tách worker policy SELECT/UPDATE + thêm `encryption_keys.revoked_at` (forensics).
    - **prod cutover:** seed `local-dev-kek` chạy cả prod (ON CONFLICT DO NOTHING) → Vault provisioning thật (2g) phải override; GATE cutover.
- **2b** · ✅ XONG (RED-first): 6 spec + seed-infra; **39 RED đúng lý do** (NOT_IMPLEMENTED throw / wrong-behavior assertion / current-plaintext drive **real SUT**), typecheck XANH, KHÔNG đỏ vì import/setup. Skeleton throw-only: `crypto/{secret-encryption.types,envelope-cipher,local-kek.provider,secret-encryption.service,secret-rotation.service}.ts` (2c/2g) + `media/platform-accounts.service.ts` (2e). Specs: `crypto/secret-encryption.service.spec.ts`, `permission/guards/permission.guard.reveal.spec.ts`, `permission/permission.service.reveal.spec.ts`, `test/integration/{platform-accounts-reveal,secret-rotation,reset-token-envelope}.int-spec.ts`. `test/helpers/seed.ts` (+seedRole/PermissionCatalog/RolePermission/UserRole/ObjectGrant/PlatformAccount; +cleanup platform_accounts/channel_accounts).
  - 🔒 **RED ghim 2 ràng buộc thiết kế cho 2c/2e0/2e (đừng phá khi GREEN):** **(F2) reveal-secret BẮT BUỘC object-grant per-account** — company-level ALLOW + (resourceId null | no object grant) PHẢI **fail-closed DENY** (RED 14/14b); guard PHẢI forward `resourceId`+`ctx` (2e0; RED 2e0-A/B/D). AAD pinned `companyId‖recordId‖encAlgo‖dekKeyVersion` + **app-gen uuid** (RED 8c/8e/8g). reveal/edit audit-in-tx kể cả deny + `secret_reveal_failed` (RED 4/8). reset-token mục tiêu `payload.resetTokenEnc` + scrub (RED 12).
  - 5 green còn lại = baseline hợp lệ (2e0-C, 14b-baseline, RED 13c worker-policy SELECT) + 2 deferred-active (RED 13b/13e — rotation invariant chỉ test được sau 2g; 13a/13d đã đỏ-ngay). FULL gate (security+database+silent-failure+santa) để dành sau khi GREEN 2c/2e. CHƯA commit — chờ review.
- **2c** `apps/api/src/crypto/` (EnvelopeCipher AES-256-GCM + KmsProvider Local/Vault + SecretEncryptionService, AAD pinned, app-gen UUID).
  - ⏳ **ĐANG DỞ — core XONG (GREEN), chưa commit:** `NodeEnvelopeCipher` (AES-256-GCM thật: seal random 12B nonce/ghi + 16B tag; open throw generic) ✅ + `SecretEncryptionService` (DEK random 32B/ghi → wrapDek → AAD pinned `companyId‖recordId‖encAlgo‖dekKeyVersion` → seal → cột; decrypt đảo lại, generic error, `dek.fill(0)` finally, KHÔNG log) ✅. **13/13 crypto-spec GREEN + typecheck XANH.** Vá test: RED 9 đổi stub-cipher (iv hằng) → `NodeEnvelopeCipher` thật để assert nonce-uniqueness hợp lệ.
  - ✅ **2c-CÒN-LẠI HOÀN TẤT (GREEN, chưa commit):**
    - `local-kek.provider.ts`: `LocalKekProvider` thật — KEK 32B đọc **lazy** từ `KMS_LOCAL_KEK_PATH` (fail-fast nếu thiếu file/độ dài≠32, KHÔNG log KEK); `wrapDek/unwrapDek` AES-256-GCM trên Buffer DEK, `wrapped = iv(12)‖tag(16)‖ct`, AAD = `kmsKeyId:keyVersion` (dựng lại được lúc unwrap); `currentKey` đọc `encryption_keys` active (`status='active'`, max `key_version`) qua `db.execute` (bảng GLOBAL no-RLS → KHÔNG withTenant; comment giải thích guard-tenant WARN advisory), fail-closed khi không có key.
    - `vault-kek.provider.ts` (mới): `VaultKekProvider` DI-stub (3 method throw `NOT_IMPLEMENTED:2g`, constructor inert) — impl Vault transit thật để 2g/prod.
    - `crypto.module.ts` (mới): DI `ENVELOPE_CIPHER→NodeEnvelopeCipher` (useExisting) + `KMS_PROVIDER→Local|Vault` (useFactory theo `env.KMS_PROVIDER`); export `SecretEncryptionService` + 2 token. **KHÔNG @Global, KHÔNG add vào app.module** (2e import vào PlatformAccountsModule) → app-boot KHÔNG đổi.
    - `env.schema.ts`: thêm `KMS_PROVIDER` (default `'local'`), `KMS_LOCAL_KEK_PATH` (default `.secrets/local-kek.bin`), `KMS_VAULT_ADDR/TOKEN` optional + `.superRefine` fail-fast (vault PHẢI có addr+token). Default 'local' → `loadEnv({})` vẫn pass (spec cũ xanh).
    - **Dev infra:** tạo KEK 32B `.secrets/local-kek.bin` (gitignored) + wire root `.env` (KMS_PROVIDER/KMS_LOCAL_KEK_PATH absolute) + document `.env.example`.
    - **Tests mới:** `local-kek.provider.spec.ts` (7 ca: currentKey active/fail-closed [db mock], wrap↔unwrap round-trip, tamper→throw, wrong keyVersion AAD→throw, KEK missing/wrong-len fail-fast) + `crypto.module.spec.ts` (1 ca: module compile + resolve service/cipher/local-kms) + 3 ca env vault-refine.
    - **DoD ✅:** crypto-spec **13/13 GREEN** (không đụng); env-spec 7; local-kek 7; crypto.module 1 → **28 passed**; `pnpm typecheck` 4/4 package xanh; app-boot không đổi (CryptoModule ngoài graph). **CHƯA commit — chờ review.**
  - ✅ **2e0 HOÀN TẤT (GREEN, chưa commit):** vá `PermissionGuard` + luật F2 fail-closed.
    - `permission.guard.ts`: forward `resourceId` (`req.params.id`) + `ctx {reauthValidUntil, requestId}` vào `can()` — CHỈ cho lớp reveal (`isSensitive && requiresReauth`) → route :id của G6-1/3/4 GIỮ NGUYÊN type-level, ZERO regression. Đọc `req.reauthContext` (populate từ Valkey theo (userId,accountId) là việc ReauthGuard/endpoint của 2e). Thêm type `ReauthAwareRequest`.
    - `permission.service.ts`: khối **F2** sau check company-DENY, trước company-ALLOW: `needsObjectGrant = objectGrantRequired ?? (isSensitive && requiresReauth)` → nếu tới đây (không object ALLOW nào match, hoặc resourceId null) → **fail-closed DENY** `deny-object-required`. Object-tier ALLOW + reauth vẫn return allow TRƯỚC đó (RED 5/baseline); object grant + thiếu/hết reauth → deny-reauth-required (RED 3/4).
    - `permission.types.ts`: thêm reason `'deny-object-required'` + optional `CanInput.objectGrantRequired`.
    - **Reconcile spec cũ (yêu cầu đổi, đã báo+duyệt phương án A):** 3 ca G3-3 reveal-secret (`reauth1/reauth2/allow8`) trong `permission.service.spec.ts` thêm object-grant + `resourceId` → test ĐÚNG mô hình post-F2 (giữ assertion deny-reauth-required/allow).
    - **DoD ✅:** `permission.guard.reveal.spec` (2e0-A/B/C/D) + `permission.service.reveal.spec` (RED 14b-1/2/3 + baseline) GREEN; regression `permission.g3-4.spec` (20) + `permission.service.spec` (reconciled) GREEN → **80/80 permission**; typecheck api XANH. **CHƯA commit.**
  - ▶️ **KẾ TIẾP:** 2e (reveal/list/edit endpoint + ReauthGuard Valkey per-(userId,accountId) + mask projection + CryptoModule wire vào PlatformAccountsModule) → 2d(0027) → 2f(0028) → 2g → 2h. **FULL gate sau khi GREEN 2e** (diff đủ chạm secret+permission+audit+RLS+migration).
- **2d Migration 0027** (seed `edit-platform-account` sensitive + grants). **2e0** vá `PermissionGuard` forward `resourceId`+`ctx` + fail-closed (BẮT BUỘC trước 2e). **2e** reveal-secret endpoint. **2f** reset-token envelope + scrub outbox (0028). **2g** rotation job. **2h** FE.

---

## 5. Khởi động session mới (copy-paste)

```
Tôi tiếp tục G6-2 (🔴 CROWN-JEWEL Platform Account Encryption) trên branch feat/g6-media, HEAD 831b986.
Model: Opus. HAND-DRIVEN — KHÔNG tự do, KHÔNG nhảy bước. RED đã có (là spec); đây là pha GREEN.
Tôi review từng bước. Trước khi code: ĐỌC + trình kế hoạch cho tôi duyệt.

### ĐÃ XONG (committed):
- 2a `0022` platform_accounts(envelope)+encryption_keys+channel_accounts (RLS+FORCE+worker policy+column-grant).
- 2b (commit 831b986): 39 RED deny-path "đỏ đúng lý do" (typecheck xanh, không lỗi setup) + 6 skeleton SUT
  throw-only + seed-infra. Files spec: src/crypto/secret-encryption.service.spec.ts,
  src/permission/guards/permission.guard.reveal.spec.ts, src/permission/permission.service.reveal.spec.ts,
  test/integration/{platform-accounts-reveal,secret-rotation,reset-token-envelope}.int-spec.ts.
- 2c-core (831b986): NodeEnvelopeCipher (AES-256-GCM thật) + SecretEncryptionService (DEK 32B/ghi → wrapDek
  → AAD pinned → seal; decrypt đảo, generic error, dek.fill(0), KHÔNG log). 13/13 crypto-spec GREEN.

### ĐỌC KỸ TRƯỚC:
- handoff §4.5 (2a/2b ✅, 2c ⏳ + CÒN-LẠI) + §2 RUNBOOK + §3 (quyết định đã chốt).
- plan §6b (interface), §6c (reveal flow + window scope B), §6d (KMS/rotation/reset-token), §6e (16 RED — contract), §6f (FULL gate).
- CLAUDE §2#3 (không secret plaintext) + §3 (permission engine trước module nhạy cảm).

### THỨ TỰ BẮT BUỘC (KHÔNG đảo): 2c-còn-lại → 2e0 → 2e → 2d(0027) → 2f → 2g → 2h.
Mỗi bước = implement để pha RED tương ứng → GREEN. KHÔNG nới lỏng test để pass — sửa impl, không sửa spec
(trừ khi spec sai THẬT, báo tôi trước).

### BƯỚC KẾ — 2c-CÒN-LẠI (hoàn tất crypto module, KHÔNG migration):
- local-kek.provider.ts (đang throw): KEK 32B từ file `.secrets/` (env KMS_LOCAL_KEK_PATH; ADR-0004 cấm KEK-in-env-host prod).
  wrapDek/unwrapDek = AES-256-GCM wrap DEK dưới KEK. currentKey(purpose) = đọc encryption_keys active (max key_version).
- crypto.module.ts (mới): DI ENVELOPE_CIPHER→NodeEnvelopeCipher; KMS_PROVIDER→Local|Vault theo env KMS_PROVIDER; export SecretEncryptionService.
- env.schema.ts: KMS_PROVIDER('local'|'vault')/KMS_VAULT_ADDR/KMS_VAULT_TOKEN/KMS_LOCAL_KEK_PATH (fail-fast).
- DoD 2c: module wireable + 13 crypto-spec vẫn GREEN + typecheck xanh + app-boot OK.

### 2e0 (BẮT BUỘC trước 2e) — vá PermissionGuard + luật F2 fail-closed:
- Seam permission.guard.ts:73-80 (KHÔNG truyền resourceId/ctx) → forward resourceId (route :id) + ctx
  {reauthValidUntil đọc Valkey theo (userId,accountId), requestId}. RED 2e0-A/B/D xanh.
- Luật F2 (RED 14/14b): reveal-secret BẮT BUỘC object-grant per-account — company-level ALLOW KHÔNG đủ; sensitive +
  resourceId null/unresolvable → fail-closed DENY. Quyết định nơi enforce (cờ can() hay guard/service) — trình tôi duyệt.

### 2e reveal/list/edit (platform-accounts.service.ts đang throw) — RED platform-accounts-reveal.int:
- createAccount: 🔴 app-gen crypto.randomUUID() TRUYỀN vào INSERT TRƯỚC encrypt (CARRY-FORWARD 2a) → encryptSecret → audit secret_created.
- revealSecret: object-tier + reauth window scope B per-(userId,accountId) (RED 7b) → decrypt JIT trong try/catch trong
  withTenant → OK audit secret_revealed / tamper VẪN commit secret_reveal_failed rồi rethrow generic (RED 8). Trả plaintext 1 lần.
- list/getAccount: mask projection — secret_ciphertext/encrypted_dek/iv_nonce/auth_tag + recovery_*/two_factor_note KHÔNG vào DTO mọi role (RED 7 serialize THẬT).
- updateSecret: gate edit-platform-account (sensitive) → DEK+nonce mới → audit secret_updated (RED 11). Controller @RequirePermission + reauth endpoint. Wire CryptoModule.

### 2d `0027` + 2f `0028` (migration — TRAP journal: when > max-applied 1717500030000, vd 31000/32000):
- 0027: seed permissions reveal-secret + edit-platform-account (is_sensitive=true) + grants (KHÔNG seed system role).
- 2f reset-token (RED reset-token-envelope.int): forgotPassword (auth.service.ts:213-216) → encryptSecret(token,{purpose:'auth_reset_token'})
  → payload CHỈ resetTokenEnc; mail consumer decrypt JIT; 0028 seed encryption_keys purpose='auth_reset_token' + SCRUB outbox cũ
  (rows eventType=auth.password_reset_requested còn plaintext) — gate prod cutover vào scrub.

### 2g rotation (RED secret-rotation.int) — secret-rotation.service.ts đang throw:
- reWrapAccount/reWrapAll: worker direct pool (mediaos_worker) → unwrapDek(old)→wrapDek(new)→UPDATE
  encrypted_dek/kms_key_id/dek_key_version/last_rotated_at; ciphertext bytes KHÔNG đổi; decrypt vẫn plaintext gốc. Nhờ worker policy + column-grant (0022). Resumable.

### RÀNG BUỘC RED ĐÃ GHIM (đừng phá khi GREEN):
F2 object-grant per-account + fail-closed · AAD pinned companyId‖recordId‖encAlgo‖dekKeyVersion + app-gen uuid ·
audit-in-tx kể cả deny + secret_reveal_failed · mask projection · reauth window scope B · reset-token resetTokenEnc + scrub.

### RUNBOOK: Docker pnpm db:up. Migrate (migrate.ts KHÔNG tự load .env): set -a && . ./.env && set +a && pnpm --filter @mediaos/api db:migrate.
Test: pnpm --filter @mediaos/api exec vitest run <path>. Regression sau MỖI migration: tenant-isolation.int-spec.ts + rls-guards (+ thêm bảng vào rls-registry.ts).
2 e2e suite health/workflow-lifecycle ĐỎ là PRE-EXISTING (SettingsModule DI) — ngoài scope.

### DoD & gate: từng bước → pha RED tương ứng GREEN + typecheck xanh + regression xanh + cập nhật handoff §4.5.
FULL gate (ecc:security-reviewer + database-reviewer + silent-failure-hunter + santa-method) SAU khi GREEN 2e (+ harness-audit + security-scan trước merge).
Commit theo PATH TƯỜNG MINH (parallel sessions chia worktree — KHÔNG git add -A).

Bắt đầu bằng ĐỌC handoff §4.5 + plan §6, rồi trình kế hoạch 2c-còn-lại cho tôi duyệt TRƯỚC khi code.
```

Mỗi bước có migration → **migrate + chạy tenant-isolation regression + thêm bảng vào rls-registry** rồi mới commit (per-migration gate, plan §8).
