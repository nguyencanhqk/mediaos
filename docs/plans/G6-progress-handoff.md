# G6 — Sổ bàn giao tiến độ (HANDOFF cho session mới)

> Đọc file này + [`G6-media-full.md`](./G6-media-full.md) (kế hoạch gốc, plan-reviewer PASS) TRƯỚC khi code tiếp.
> Mục tiêu: 1 session mới cầm file này là tiếp tục được ngay, không phải dò lại.
> Cập nhật lần cuối: 2026-06-07 · Branch: **`feat/g6-media`** · HEAD: **`4e620a0`**
> ⚠️ **2 session song song chung 1 working tree:** session này làm **G6-5** (Channel Health — commit `4e620a0`);
> 1 session khác làm **G6-4** (Content full — commits `0041ea4`/`22a3ae2`/`9b2691f` = migration 0024/0025/0026).
> Do chung working tree, commit `22a3ae2` (g6-4b) đã "nuốt" luôn phần G6-5 ở `media.ts`/`media.repository.ts`/
> `media.service.ts` — code đủ trên branch, chỉ lệch nhãn commit. §1 table dưới đây CHƯA gộp G6-4; cần 2 session
> reconcile lại docs.

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

**Trạng thái DB thực tế (đã verify live):**
- DB từng kẹt ở **0013** (G5 0014–0019 + G6 0020–0021 CHƯA từng apply). Nay đã migrate sạch tới **0021** (22 record trong `drizzle.__drizzle_migrations`).
- `platforms` seed 6 code; `channels.platform_id` NOT NULL; `channels_status_check` = 5 value mới; `channel_members` tồn tại; audit CHECK có đủ type G6.
- **G2-5 2-tenant regression: 100 pass / 2 skip** (đã phủ `channels` + `channel_members`).
- `pnpm typecheck` xanh cả 3 package.
- **G6-1e FE (f4a07d2):** typecheck 3 pkg + lint (0 error) + 17 web test + `vite build` xanh. Cài thêm dep `@tanstack/react-table` (data-grid theo CLAUDE.md). KHÔNG migration. ⚠️ Chưa render live với API+DB (mới verify build/type, chưa chạy browser + auth + seed).

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

### 4.3 — G6-4 (Content full) · 🟢 · plan §4 G6-4 (SQL sẵn — nhiều cạm bẫy data-migration)
- **4a Migration 0024** `g6_content_types.sql`: CREATE `content_types` (⚠️ `default_workflow_template_id`/`default_evaluation_template_id` = **uuid TRẦN, KHÔNG FK** — bảng template chưa tồn tại ở M2).
- **4b Migration 0025** `g6_content_items_full.sql` (🔴 data migration): ALTER `content_items` (content_type_id FK + cols + production_status) + seed content_types (**NOT EXISTS guard**, KHÔNG `ON CONFLICT` vì partial index) + backfill + **DO-block GUARD NULL** + DROP cột text `content_type` (tên CHECK DB thật = `content_items_content_type_check`). ⚠️ Breaking change: đổi đồng bộ SQL + `media.ts` + contracts (`contentTypeSchema` enum→object) + FE default 'video'. ⚠️ Sửa `seedContentItem` trong rls-registry (đang dùng `content_type` text → đổi sang `content_type_id`/NULL).
- **4c Migration 0026** `g6_content_channels_assets.sql`: `content_channels` + `content_assets` (version chain, one-current uq **WHERE is_current AND deleted_at IS NULL**).
- **4d** schema + contracts. **4e** BE (multi-channel publish + asset version INSERT+flip 1 tx + suggest-workflow). **4f** FE.
- Mỗi migration: journal → migrate → regression → rls-registry.

### 4.4 — G6-5 (Channel Health) · 🟢 · **KHÔNG migration** · ✅ XONG
- ✅ **5a** BE: `PATCH /channels/:id/health` trong `ChannelsController` (gate `update:channel`) + `MediaService.updateChannelHealth` (audit-in-tx `ChannelHealthUpdated`, objectType `channel`; healthScore numeric(5,2) → `numToStr`). Filter "kênh rủi ro": `ListChannelsFilter.risk` + `listChannels` (`inArray(health_status, ['risk','declining'])`) + `@Query('risk')` (`risk==='true'`). Contracts: `updateChannelHealthSchema` (.partial) + `UpdateChannelHealthRequest` + `risk` vào `listChannelsQuerySchema`. `UpdateChannelHealthDto`.
- ✅ **5b** FE: `channelsApi.updateChannelHealth` + `risk` trong `ChannelFilters`/`buildChannelQuery`. Tab "Sức khỏe" trong `channel-detail.tsx` (dropdown `HEALTH_OPTIONS`, điểm 0–100 có guard, textarea note; Save bọc `<PermissionGate update channel>`, input disabled khi !canManage). `ChannelFilterBar`: checkbox "Chỉ kênh rủi ro". `home.tsx`: widget "Kênh rủi ro" (`listChannels({risk:true})`, gate `read:channel` qua `enabled`, link `/channels/$channelId`). `HEALTH_OPTIONS` thêm vào constants.
- **DoD**: ✅ typecheck 3 pkg + api/web lint 0 error + 17 web test + vite build xanh. ⚠️ **chưa render live** (auth header chưa wa FE-wide — pre-existing). KHÔNG migration → KHÔNG đụng journal/rls-registry.

### 4.5 — G6-2 (🔴 CROWN-JEWEL, LÀM CUỐI, hand-driven) · plan §6 + §4 G6-2
> ⚠️ TASKS/plan: **đừng để AI tự do**. RED-test-first (14 ca §6e), FULL gate, Opus.
- **2a Migration 0022**: `platform_accounts` (8 cột envelope + worker policy + column-grant) + `encryption_keys` + `channel_accounts`.
- **2b** 14 RED deny-path tests TRƯỚC.
- **2c** `apps/api/src/crypto/` (EnvelopeCipher AES-256-GCM + KmsProvider Local/Vault + SecretEncryptionService, AAD pinned, app-gen UUID).
- **2d Migration 0027** (seed `edit-platform-account` sensitive + grants). **2e0** vá `PermissionGuard` forward `resourceId`+`ctx` + fail-closed (BẮT BUỘC trước 2e). **2e** reveal-secret endpoint. **2f** reset-token envelope + scrub outbox (0028). **2g** rotation job. **2h** FE.

---

## 5. Khởi động session mới (copy-paste)

```
Tôi tiếp tục G6 trên branch feat/g6-media (HEAD 9e583dc).
Đọc: docs/plans/G6-progress-handoff.md + docs/plans/G6-media-full.md.
Đã xong tới G6-3 (Projects ERD-full — migration 0023 + BE ProjectsController + FE /projects tabs; typecheck/lint/test/build + RLS regression xanh, chưa render live).
Tiếp theo: [G6-4 Content full — migration 0024/0025/0026, NHIỀU cạm bẫy data-migration §4.3]  (hoặc G6-5 Channel Health — KHÔNG migration; hoặc nêu bước bạn muốn).
Trước khi code: pnpm db:up; nếu cần migrate dùng:  set -a && . ./.env && set +a && pnpm --filter @mediaos/api db:migrate
```

Mỗi bước có migration → **migrate + chạy tenant-isolation regression + thêm bảng vào rls-registry** rồi mới commit (per-migration gate, plan §8).
