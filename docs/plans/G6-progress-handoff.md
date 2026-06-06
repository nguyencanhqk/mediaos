# G6 — Sổ bàn giao tiến độ (HANDOFF cho session mới)

> Đọc file này + [`G6-media-full.md`](./G6-media-full.md) (kế hoạch gốc, plan-reviewer PASS) TRƯỚC khi code tiếp.
> Mục tiêu: 1 session mới cầm file này là tiếp tục được ngay, không phải dò lại.
> Cập nhật lần cuối: 2026-06-06 · Branch: **`feat/g6-media`** · HEAD: **`c5060aa`**

---

## 1. Đã xong (committed trên `feat/g6-media`)

| Commit | Nội dung | Đã verify? |
| --- | --- | --- |
| `1cd20c3` `feat(G5)` | Commit toàn bộ G5 còn treo + **vá `_journal.json`** (0014–0019 bị bỏ sót, drizzle chưa bao giờ apply) | ✅ migrate |
| `e9c7edf` `docs(G6)` | Plan G6 + cập nhật roadmap | — |
| `d246d74` `feat(g6-0)` | **Migration 0020** — `audit_logs_object_type_chk` + `AUDIT_OBJECT_TYPES` (11 type G6, cùng commit) | ✅ |
| `8a9fbe3` `feat(g6-1)` | **Migration 0021** — `platforms` (catalog global, seed 6) + ALTER `channels` (platform_id FK, reconcile, widen status, health cols, partial-unique code) + `channel_members`; Drizzle schema + contracts + create-path + RLS registry | ✅ |
| `c5060aa` `feat(g6-1d)` | `ChannelsController` (permission-gated) + channel CRUD/filter/get/update/soft-delete + members CRUD + **audit-in-tx** + `GET /platforms` | ✅ typecheck + regression |

**Trạng thái DB thực tế (đã verify live):**
- DB từng kẹt ở **0013** (G5 0014–0019 + G6 0020–0021 CHƯA từng apply). Nay đã migrate sạch tới **0021** (22 record trong `drizzle.__drizzle_migrations`).
- `platforms` seed 6 code; `channels.platform_id` NOT NULL; `channels_status_check` = 5 value mới; `channel_members` tồn tại; audit CHECK có đủ type G6.
- **G2-5 2-tenant regression: 100 pass / 2 skip** (đã phủ `channels` + `channel_members`).
- `pnpm typecheck` xanh cả 3 package.

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

### 4.1 — G6-1e (FE channels) · 🟢 · KHÔNG migration
- `/channels`: `ChannelTable` (TanStack Table v8) + `ChannelFilterBar` (platform/status/manager/niche) + `CreateChannelDialog`.
- `/channels/$channelId`: tab shell `<Tabs>` → Overview + Members (`AddChannelMemberDialog`).
- API client: `apps/web/src/lib/` (mẫu `employees-api.ts`). Endpoint đã có: `GET/POST/PATCH/DELETE /channels`, `/channels/:id/members`, `GET /platforms`.
- Route mới trong `apps/web/src/router.tsx` (beforeLoad: authGuard). Mọi phần nhạy cảm bọc `<PermissionGate action resourceType>`.
- **DoD**: typecheck FE xanh; list/filter/detail render.

### 4.2 — G6-3 (Projects full) · 🟢 · plan §4 G6-3 (SQL sẵn)
- **3a Migration 0023** `g6_projects_full.sql`: ALTER `projects` (code/type/owner/manager/dates/priority/budget + CHECK type+priority) + ALTER `project_channels` (role_in_project, status + **GRANT UPDATE** + **fix-forward `project_channels_uq` dẫn đầu company_id**) + CREATE `project_teams` + `project_members` (RLS+FORCE). → journal 0023 → **migrate + regression + thêm 3 bảng vào rls-registry**.
- **3b** schema (`projects` full, `projectTeams`, `projectMembers`) + contracts.
- **3c** BE: project CRUD full + attach/detach kênh/team/member + audit `project`/`project_team`/`project_member` + permission (`project` đã có ở 0005; cân nhắc seed `project-team`/`project-member` nếu muốn resource riêng).
- **3d** FE: `/projects` + `/projects/$id` tabs.

### 4.3 — G6-4 (Content full) · 🟢 · plan §4 G6-4 (SQL sẵn — nhiều cạm bẫy data-migration)
- **4a Migration 0024** `g6_content_types.sql`: CREATE `content_types` (⚠️ `default_workflow_template_id`/`default_evaluation_template_id` = **uuid TRẦN, KHÔNG FK** — bảng template chưa tồn tại ở M2).
- **4b Migration 0025** `g6_content_items_full.sql` (🔴 data migration): ALTER `content_items` (content_type_id FK + cols + production_status) + seed content_types (**NOT EXISTS guard**, KHÔNG `ON CONFLICT` vì partial index) + backfill + **DO-block GUARD NULL** + DROP cột text `content_type` (tên CHECK DB thật = `content_items_content_type_check`). ⚠️ Breaking change: đổi đồng bộ SQL + `media.ts` + contracts (`contentTypeSchema` enum→object) + FE default 'video'. ⚠️ Sửa `seedContentItem` trong rls-registry (đang dùng `content_type` text → đổi sang `content_type_id`/NULL).
- **4c Migration 0026** `g6_content_channels_assets.sql`: `content_channels` + `content_assets` (version chain, one-current uq **WHERE is_current AND deleted_at IS NULL**).
- **4d** schema + contracts. **4e** BE (multi-channel publish + asset version INSERT+flip 1 tx + suggest-workflow). **4f** FE.
- Mỗi migration: journal → migrate → regression → rls-registry.

### 4.4 — G6-5 (Channel Health) · 🟢 · **KHÔNG migration** (cột health_* đã có ở 0021)
- **5a** BE: `PATCH /channels/:id/health` (health_status/score/note) — repo đã có `updateChannelHealth`, chỉ cần endpoint trong ChannelsController + service method + audit; filter "kênh rủi ro" (status risk/declining) trong listChannels.
- **5b** FE: `ChannelHealthTab` + Dashboard widget "kênh rủi ro".

### 4.5 — G6-2 (🔴 CROWN-JEWEL, LÀM CUỐI, hand-driven) · plan §6 + §4 G6-2
> ⚠️ TASKS/plan: **đừng để AI tự do**. RED-test-first (14 ca §6e), FULL gate, Opus.
- **2a Migration 0022**: `platform_accounts` (8 cột envelope + worker policy + column-grant) + `encryption_keys` + `channel_accounts`.
- **2b** 14 RED deny-path tests TRƯỚC.
- **2c** `apps/api/src/crypto/` (EnvelopeCipher AES-256-GCM + KmsProvider Local/Vault + SecretEncryptionService, AAD pinned, app-gen UUID).
- **2d Migration 0027** (seed `edit-platform-account` sensitive + grants). **2e0** vá `PermissionGuard` forward `resourceId`+`ctx` + fail-closed (BẮT BUỘC trước 2e). **2e** reveal-secret endpoint. **2f** reset-token envelope + scrub outbox (0028). **2g** rotation job. **2h** FE.

---

## 5. Khởi động session mới (copy-paste)

```
Tôi tiếp tục G6 trên branch feat/g6-media (HEAD c5060aa).
Đọc: docs/plans/G6-progress-handoff.md + docs/plans/G6-media-full.md.
Đã xong tới G6-1d (backend channels, đã verify migrate 0014–0021 + 2-tenant regression 100 pass).
Tiếp theo: [G6-1e FE]  (hoặc nêu bước bạn muốn).
Trước khi code: pnpm db:up; nếu cần migrate dùng:  set -a && . ./.env && set +a && pnpm --filter @mediaos/api db:migrate
```

Mỗi bước có migration → **migrate + chạy tenant-isolation regression + thêm bảng vào rls-registry** rồi mới commit (per-migration gate, plan §8).
