# PLAN — G6 Media: Channel · Account · Project · Content

> Tạo TRƯỚC khi viết code (AUTOMATION-PLAYBOOK §11). Rà soát bằng agent `plan-reviewer` tới khi PASS rồi mới code.
> Nguồn: `TASKS.md` G6 (L209–223) · `DATABASE ERD — MVP v1.md` (Module 4 §6.1–6.6, Module 5 §7.1–7.9) · `docs/erd-v2.md` (§2 envelope, §10 partial-unique, §11 asset version) · `MVP REQUIREMENT PRD.md` (CH-/PRJ-/CNT-/BR-) · `USER ROLE & PERMISSION MATRIX — MVP v1.md` (§7.1, §11) · `docs/permission-matrix-spec.md` · `docs/adr/0004` (envelope encryption) · `docs/adr/0010` (4-tier permission, sensitive không kế thừa) · `CLAUDE.md`.
> Branch: `feat/g6-media`. Gate: **LIGHT** cho G6-1/3/4/5 (CRUD/UI thường); **FULL** cho **G6-2** (crown-jewel secret) và **mọi migration chạm RLS/secret/audit** (toàn bộ 0020–0028).
> ⚠️ **Migration format:** mọi file SQL dùng `--> statement-breakpoint` giữa các statement (xem `0007_media.sql`/`0014`); không bỏ qua. CHECK list phải byte-identical giữa `db/schema/media.ts` và SQL.
> ⚠️ **Guard pre-work (CRITICAL):** `PermissionGuard` hiện (permission.guard.ts:73–80) gọi `can()` **CHỈ** với `userId/companyId/action/resourceType/isSensitive/requiresReauth` — **KHÔNG** truyền `resourceId` lẫn `ctx`. Vì `permission.service.ts:55–58` bỏ qua toàn bộ object-tier khi `resourceId == null`, reveal-secret sẽ rơi xuống type-level check → **bypass Tầng 3 (object_permissions)**. Bước **2e0** (mới) bắt buộc vá guard TRƯỚC khi mở reveal-secret. Xem §6c + RED ca 14.

---

## Meta

- **Mã:** G6 · **Phase:** G6 · **Mốc:** M2 (Sản xuất thật)
- **Vùng rủi ro chủ đạo:** 🟢 xanh (AI-bulk toàn phần) — **ngoại trừ** G6-2 Platform Account Encryption (🔴 đỏ, crown-jewel, hand-driven)
- **Model chính:** Haiku/Sonnet cho G6-1/3/4/5; **Opus** cho G6-2 (envelope crypto + reveal-secret + permission algebra)
- **Ước lượng:** ~10–14 ngày tập trung

---

## 1. Mục tiêu

Sau G6: hệ thống quản lý đầy đủ ~100 kênh đa nền tảng (platform/channel/health/members), **tài khoản nền tảng mã hóa envelope app-side** (reveal-secret = re-auth + audit mỗi lần xem/sửa), project chứa nhiều kênh/team/thành viên/content, và 1 content đăng đa kênh với asset có version — những thứ mà G4-2 (slice tối thiểu) chưa làm được.

---

## 2. Scope

**Trong:**
- **G6-1** (🟢 M): `platforms` (catalog global) + mở rộng `channels` (platform_id FK, code, url, language, target_country, niche, channel_manager_id, primary_team_id, health) + `channel_members` + gán Manager/team + lọc theo platform/status/manager.
- **G6-2** (🔴 L, crown-jewel): `platform_accounts` envelope encryption (AES-256-GCM, DEK wrap qua KMS/Vault, app-side) + `encryption_keys` + `channel_accounts` (M:N) + `reveal-secret` endpoint (re-auth + audit mỗi xem/sửa) + di trú reset-token (outbox payload) sang envelope + **vá `PermissionGuard` để truyền `resourceId`+`ctx`** (đk tiên quyết Tầng-3 + re-auth). FULL gate.
- **G6-3** (🟢 S): mở rộng `projects` (code, project_type, owner, manager, dates, priority, budget) + mở rộng `project_channels` (role_in_project, status) + `project_teams` + `project_members` (PRJ-002/003/004, BR-003).
- **G6-4** (🟢 M): `content_types` + mở rộng `content_items` (content_type_id FK, main_channel_id, production_status, urls, …) + `content_channels` (đăng đa kênh) + `content_assets` (asset + version chain) + gợi ý workflow theo content type.
- **G6-5** (🟢 S): Channel Health (health_status, health_score, risk note) trên `channels` → feed Dashboard.

**Ngoài (không làm lần này):**
- Workflow **Builder** + sinh Workflow Instance/Step Instance/task thật (→ G7). G6-4 chỉ **gợi ý** template đọc từ `content_types.default_workflow_template_id`.
- **`workflow_templates` + `evaluation_templates`** chưa tồn tại ở M2 (template-concept land G7-1 per TASKS.md L229; evaluation là G8). Do đó `content_types.default_workflow_template_id` + `default_evaluation_template_id` ở G6 là **cột uuid trần KHÔNG FK** (defer FK → G7/G8). Xem §4 G6-4a + §12.
- Doanh thu/Chi phí/Lợi nhuận của kênh/content (→ G9/G12/G13); chỉ chừa cột/tab placeholder, gate `view-finance` (đã có ngoài G6).
- KPI/đánh giá sau đăng (→ G8); chấm điểm asset/step.
- Cloud KMS (AWS/GCP) — chỉ là upgrade path sau (G16); G6-2 dùng `KmsProvider` interface với DEV=local KEK, PROD=Vault transit.
- Realtime push cho publish status (G6 không thêm WS feature mới).
- Channel Health auto-compute từ analytics (G6-5 chỉ là cập nhật thủ công + surface; tính toán trend → giai đoạn sau).

**Acceptance (từ PRD/TASKS):**
- **CH-001:** Tạo/sửa kênh; gán Channel Manager; gán team phụ trách; lọc theo nền tảng/trạng thái/manager.
- **CH-002 (crown-jewel):** Chỉ người có quyền xem thông tin nhạy cảm; mật khẩu không plaintext; mọi lần xem/sửa tài khoản ghi audit; liên kết nhiều tài khoản với 1 kênh.
- **CH-003:** Channel Manager cập nhật health status; surface kênh cần chú ý; feed Dashboard kênh rủi ro.
- **PRJ-001:** Tạo project + gán Manager + start/deadline + status/priority + xuất hiện trong list.
- **PRJ-002:** Gắn nhiều kênh; 1 kênh thuộc nhiều project (M:N); project detail liệt kê kênh.
- **PRJ-003:** Gắn nhiều team + role của team trong project.
- **PRJ-004:** Thêm user vào project + role + workload; user chỉ thấy project theo quyền.
- **CNT-001:** Tạo content/video thuộc project; gắn 1 hoặc nhiều kênh; chọn content type; hệ thống gợi ý workflow theo content type.
- **CNT-002:** Gắn nhiều kênh vào 1 content; mỗi kênh có lịch đăng + publish status + publish link riêng.
- **CNT-003:** Upload/gắn link asset; có version; gắn asset vào task/workflow step (link logic, engine ở G7); người không quyền không xem được asset.
- **BR-002/003:** Quyền xem tài khoản kênh **không tự kế thừa**; Project ≠ 1 video (nhiều kênh/team/member/content).
- **G6 Done (TASKS):** "quản lý ~100 kênh; tài khoản kênh mã hoá (re-auth + audit); project nhiều kênh/content; 1 content đăng nhiều kênh."

---

## 3. Phụ thuộc

**Cần có TRƯỚC khi code:**
- G4 ĐÓNG ✅ — `channels`, `projects`, `project_channels`, `content_items` (slice tối thiểu G4-2) đã có trong `db/schema/media.ts` + `0007_media.sql`.
- `PermissionService.can()` (G3) + 4-tier engine + `reauthValidUntil` seam (`permission.types.ts:24-28`) — **bắt buộc cho G6-2** (CLAUDE §3: không code module nhạy cảm khi permission chưa xong).
  - ⚠️ **Seam CHƯA đủ:** `PermissionGuard` (permission.guard.ts:73–80) chưa forward `resourceId` lẫn `ctx`. Bước **2e0** vá việc này; không có nó, Tầng-3 (object_permissions) bị bỏ qua và re-auth window không bao giờ được kiểm. ADR-0010: sensitive KHÔNG kế thừa qua wildcard/manage.
- `withTenant(companyId, fn)` (G2-2) · `AuditService.record(tx, …)` + `OutboxService.enqueue(tx, …)` (G2-4) — media hiện tại CHƯA dùng audit/outbox/permission, G6 phải retrofit.
- `permissions` catalog đã seed `0005` (channel/project/content + `platform-account` gồm `reveal-secret` is_sensitive=TRUE + `delete-project` TRUE) + **8 system roles ở 0005 (`…001` company-admin … `…008` employee)** + **`hr-manager` (`…009`) thêm ở 0019**. (Đính chính: 0005 KHÔNG có 9 roles; role thứ 9 hr-manager nằm ở 0019.)
- KMS/Vault provisioning (component `kms-provisioning-and-rotation`) — DEV `LocalKekProvider` đủ để code; PROD Vault transit trước khi có secret thật.

**Schema chung đụng tới (luật thứ tự — tuần tự, không song song):**
- `audit_logs_object_type_chk` (G6-0): mở rộng object types — **TRƯỚC mọi bảng G6 ghi audit**.
- `channels`: ALTER ADD COLUMN (G6-1) — cần `platforms` (G6-1) tạo trước (FK platform_id) → tuần tự. ⚠️ Widen status enum phải reconcile dữ liệu `'inactive'` hiện có (xem §4 G6-1a — `'inactive'` KHÔNG nằm trong tập mới).
- `projects`: ALTER ADD COLUMN (G6-3) — độc lập channels.
- `content_items`: ALTER + đổi `content_type` text → `content_type_id` FK (G6-4) — cần `content_types` (G6-4) trước; backfill phải guard NULL.
- `platform_accounts`/`channel_accounts`: NEW (G6-2) — cần `platforms` (FK) + `channels` đã mở rộng → sau G6-1.

**Luật bất biến áp dụng:**
- Bất biến #1: `company_id NOT NULL DEFAULT currentCompanyDefault` + ENABLE+FORCE RLS + policy USING+WITH CHECK trên MỌI bảng nghiệp vụ mới. **Ngoại lệ:** `platforms` = catalog global (no company_id); `encryption_keys` = registry hạ tầng global (không gắn RLS tenant kiểu bảng nghiệp vụ — xem §4 ghi chú bảo mật registry).
- Bất biến #2: soft-delete (`deleted_at`) nơi phù hợp; UNIQUE → partial index `WHERE deleted_at IS NULL`. Link M:N thuần (`project_channels`, `project_teams`, `channel_accounts`) có thể hard DELETE. `content_assets` cấm hard-delete version cũ — chỉ flip `is_current=false`.
- Bất biến #2b (mới): mọi **composite UNIQUE của bảng M:N PHẢI dẫn đầu bằng `company_id`** và NULL-safe (dùng `COALESCE`/NOT NULL cho cột nullable trong key). 0007 `project_channels_uq` thiếu `company_id` — đây là **class bug có sẵn**, fix-forward (KHÔNG mirror lỗi).
- Bất biến #2c (mới): bảng M:N mang **cột trạng thái mutable** (status/role) PHẢI có `GRANT UPDATE`, hoặc bỏ cột mutable để trở lại pure hard-DELETE link. Không ship cột `NOT NULL` mutable mà thiếu UPDATE privilege.
- Bất biến #3: secret `platform_accounts` → envelope encryption app-side, KHÔNG pgcrypto-in-SQL, KHÔNG log, KHÔNG vào DTO của role không quyền (mask phía server tại tầng query-projection).
- Bất biến #4 (mới — worker RLS): bảng nào worker (rotation/background) phải đọc/ghi cross-tenant PHẢI có **worker policy `TO mediaos_worker USING(true) WITH CHECK(true)`** + app policy scope `TO mediaos_app` (mirror `outbox_worker_all`/`outbox_app_tenant_iso` ở 0003). Worker connect direct pool KHÔNG set `app.current_company_id` → policy mặc định lọc `company_id = NULL` → 0 row (silent failure).

---

## 4. DB Schema chi tiết

### Đánh số migration (latest hiện tại = 0019 → G6 bắt đầu 0020)

| File | Nội dung | Gate |
| --- | --- | --- |
| **0020** `g6_audit_object_types.sql` | Mở rộng `audit_logs_object_type_chk` (channel, platform_account, channel_account, channel_member, project, project_team, project_member, content, content_channel, content_asset, content_type) — **TRƯỚC mọi bảng G6** | 🔴 FULL |
| **0021** `g6_platforms_channels.sql` | CREATE `platforms` (global) + ALTER `channels` (platform_id FK + cols + health + **reconcile + widen status**) + CREATE `channel_members` | 🔴 FULL (RLS + channels ALTER + data) |
| **0022** `g6_platform_accounts.sql` | CREATE `platform_accounts` (8 cột envelope, worker policy + column-grant rotation) + `encryption_keys` + `channel_accounts` | 🔴 FULL (secret + RLS) |
| **0023** `g6_projects_full.sql` | ALTER `projects` (cols) + ALTER `project_channels` (role_in_project, status + **GRANT UPDATE**) + CREATE `project_teams` + `project_members` | 🔴 FULL (RLS bảng mới + grant) |
| **0024** `g6_content_types.sql` | CREATE `content_types` (workflow/eval template id = **uuid trần, KHÔNG FK**, defer G7/G8) | 🔴 FULL (RLS bảng mới) |
| **0025** `g6_content_items_full.sql` | ALTER `content_items` (content_type_id FK + cols + production_status) + seed content_types (guarded) + backfill + **guard NULL** + DROP content_type text | 🔴 FULL (data migration + CHECK) |
| **0026** `g6_content_channels_assets.sql` | CREATE `content_channels` + `content_assets` (+ version chain, one-current uq **+ deleted_at guard**) | 🔴 FULL (RLS bảng mới) |
| **0027** `g6_permissions_seed.sql` | Seed permission catalog G6 mới + grants + `edit-platform-account` (is_sensitive) | 🔴 FULL (permission) |
| **0028** `g6_reset_token_envelope.sql` | Seed `encryption_keys` purpose='auth_reset_token' (di trú reset-token sang envelope — code ở G6-2) + **scrub plaintext reset-token cũ trong outbox** | 🔴 FULL (secret) |

> **Tất cả migration tạo bảng mới:** RLS policy + FORCE **TRƯỚC** mọi backfill `company_id` (CLAUDE §3 — nếu không có cửa sổ rò chéo tenant). Đồng bộ CHECK list với `db/schema/*.ts`. **Mọi ALTER widen CHECK trên bảng có dữ liệu PHẢI có DO-block guard / backfill TRƯỚC `ADD CONSTRAINT`.** **G2-5 2-tenant regression chạy AFTER MỖI migration 0021/0022/0023/0025/0026** (CI per-migration gate, không gộp 1 lần cuối).

---

### G6-0: Mở rộng `audit_logs_object_type_chk` (**PHẢI migrate TRƯỚC mọi bảng G6**)

```sql
-- Migration 0020_g6_audit_object_types.sql
-- Tiền lệ: 0011/0014 đã làm mẫu (DROP+ADD CHECK). Đồng bộ với AUDIT_OBJECT_TYPES (audit.ts:35-49).
-- 12 type cũ (đến 'team') byte-identical 0014; append 11 type G6.
ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_object_type_chk;
--> statement-breakpoint
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_object_type_chk CHECK (object_type IN (
    'company', 'user', 'auth', 'outbox_event',
    'workflow_instance', 'workflow_step', 'task', 'approval_request',
    'employee', 'position', 'org_unit', 'team',              -- G5 (12 type, đến 'team')
    'channel', 'platform_account', 'channel_account', 'channel_member',   -- G6 media
    'project', 'project_team', 'project_member',
    'content', 'content_channel', 'content_asset', 'content_type'         -- G6 content
  ));
```

> Đồng thời append đúng các string này vào `AUDIT_OBJECT_TYPES` trong `apps/api/src/db/schema/audit.ts` (drives `AuditObjectType`). **Nếu thiếu bước này**, mọi `audit_logs` ghi `object_type='platform_account'` (reveal-secret), `'channel'`, `'content'`… sẽ vi phạm CHECK → throw runtime. Đây đúng class bug đã dính **G4-7 và G5-0a** — TS const + SQL CHECK phải đổi cùng commit. (Cross-check: `audit.ts` `AUDIT_OBJECT_TYPES` hiện đúng 12 entry kết thúc `'team'`; SQL 0014 byte-identical 12 type.)

---

### G6-1a: `platforms` (NEW — catalog GLOBAL, no company_id) + ALTER `channels`

```sql
-- Migration 0021_g6_platforms_channels.sql
-- platforms: catalog dùng chung, KHÔNG có company_id, KHÔNG RLS tenant (ERD v1 §6.1).
CREATE TABLE platforms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  code        text NOT NULL,
  type        text,
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX platforms_code_uq ON platforms (code);
--> statement-breakpoint
ALTER TABLE platforms ADD CONSTRAINT platforms_code_check
  CHECK (code IN ('youtube','tiktok','facebook','instagram','podcast','website'));
--> statement-breakpoint
ALTER TABLE platforms ADD CONSTRAINT platforms_status_check
  CHECK (status IN ('active','inactive'));
--> statement-breakpoint
-- GLOBAL catalog: app role chỉ đọc; ghi do migration/seed. KHÔNG FORCE RLS (không có company_id).
-- Bảo mật: platforms KHÔNG chứa dữ liệu per-tenant; chỉ là registry tĩnh.
GRANT SELECT ON platforms TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON platforms TO mediaos_worker;
--> statement-breakpoint
-- Seed 6 platform chuẩn (idempotent).
INSERT INTO platforms (name, code, type) VALUES
  ('YouTube','youtube','video'), ('TikTok','tiktok','short'),
  ('Facebook','facebook','social'), ('Instagram','instagram','social'),
  ('Podcast','podcast','audio'), ('Website','website','web')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- ===== ALTER channels (G4-2 slice → ERD full) =====
ALTER TABLE channels
  ADD COLUMN platform_id        uuid REFERENCES platforms(id) ON DELETE RESTRICT,
  ADD COLUMN code               text,
  ADD COLUMN url                text,
  ADD COLUMN language           text,
  ADD COLUMN target_country     text,
  ADD COLUMN niche              text,
  ADD COLUMN channel_manager_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN primary_team_id    uuid REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN health_status      text,
  ADD COLUMN health_score       numeric(5,2);
--> statement-breakpoint
-- Backfill platform_id từ cột text 'platform' hiện có (CHECK cũ 0007: youtube/tiktok/facebook/instagram).
UPDATE channels c SET platform_id = p.id FROM platforms p WHERE p.code = c.platform;
--> statement-breakpoint
-- ⚠️ GUARD (executable, KHÔNG phải comment): nếu còn row platform_id NULL (code lệch / chưa seed) → abort
-- với context thay vì để SET NOT NULL fail không chẩn đoán.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM channels WHERE platform_id IS NULL AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'channels.platform_id backfill incomplete: % rows have NULL platform_id',
      (SELECT count(*) FROM channels WHERE platform_id IS NULL AND deleted_at IS NULL);
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE channels ALTER COLUMN platform_id SET NOT NULL;
--> statement-breakpoint
-- ⚠️ Widen status enum. OLD CHECK (0007) = ('active','inactive'). 'inactive' KHÔNG thuộc tập mới!
-- PHẢI reconcile dữ liệu TRƯỚC khi ADD CONSTRAINT, nếu không ADD CONSTRAINT abort.
-- Mapping quyết định: 'inactive' -> 'paused' (kênh tắt tạm). Áp dụng cho mọi row (kể cả soft-deleted).
ALTER TABLE channels DROP CONSTRAINT channels_status_check;
--> statement-breakpoint
UPDATE channels SET status = 'paused' WHERE status = 'inactive';
--> statement-breakpoint
-- GUARD: chắc chắn không còn giá trị ngoài tập mới trước khi ADD.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM channels
             WHERE status NOT IN ('active','testing','paused','stopped','archived')) THEN
    RAISE EXCEPTION 'channels.status has values outside new enum: %',
      (SELECT string_agg(DISTINCT status, ',') FROM channels
       WHERE status NOT IN ('active','testing','paused','stopped','archived'));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE channels ADD CONSTRAINT channels_status_check
  CHECK (status IN ('active','testing','paused','stopped','archived'));
--> statement-breakpoint
ALTER TABLE channels ADD CONSTRAINT channels_health_status_check
  CHECK (health_status IS NULL OR health_status IN
    ('healthy','watching','declining','risk','paused','stopped'));
--> statement-breakpoint
-- Giữ cột text 'platform' tạm cho rollback an toàn; DROP ở migration dọn sau (0029, ngoài G6).
-- ⚠️ Partial unique code: app PHẢI normalize '' -> NULL ở boundary (code='' KHÔNG bị skip bởi code IS NOT NULL).
CREATE UNIQUE INDEX channels_company_code_active_uq
  ON channels (company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
--> statement-breakpoint
CREATE INDEX channels_platform_id_idx ON channels (platform_id);
--> statement-breakpoint
CREATE INDEX channels_manager_idx ON channels (company_id, channel_manager_id);
--> statement-breakpoint
CREATE INDEX channels_company_status_idx ON channels (company_id, status);
```

> Channel-health (`health_status`, `health_score`) sống NGAY trên `channels` — KHÔNG bảng riêng (G6-5 chỉ cập nhật + surface). `platform` text cũ giữ lại đến migration dọn để rollback không mất dữ liệu mapping.
> **Đính chính so với draft cũ:** comment "G4 chỉ active/inactive ⊂ tập mới" SAI — `'inactive'` KHÔNG thuộc `('active','testing','paused','stopped','archived')`. Đã thêm `UPDATE … SET status='paused' WHERE status='inactive'` + DO-block guard.

### G6-1b: `channel_members` (NEW)

```sql
-- Migration 0021 (cùng file)
CREATE TABLE channel_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL
                     DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                     REFERENCES companies(id) ON DELETE CASCADE,
  channel_id       uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_in_channel  text,
  permission_level text,
  joined_at        timestamptz,
  left_at          timestamptz,
  status           text NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
--> statement-breakpoint
ALTER TABLE channel_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE channel_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY channel_members_tenant_isolation ON channel_members
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX channel_members_company_id_idx ON channel_members (company_id);
--> statement-breakpoint
CREATE INDEX channel_members_channel_id_idx ON channel_members (channel_id);
--> statement-breakpoint
CREATE INDEX channel_members_user_id_idx ON channel_members (user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX channel_members_active_uq
  ON channel_members (company_id, channel_id, user_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE channel_members
  ADD CONSTRAINT channel_members_role_check CHECK (
    role_in_channel IS NULL OR role_in_channel IN
      ('channel_manager','seo','uploader','content_lead','production_lead','finance_viewer','qa')
  ),
  ADD CONSTRAINT channel_members_status_check CHECK (status IN ('active','inactive'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON channel_members TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON channel_members TO mediaos_worker;
```

> **Convention policy name:** dùng `<table>_tenant_isolation` (table-prefixed, grep-able) + `TO mediaos_app` (khớp 0007/0003). KHÔNG dùng bare `tenant_isolation` — bare name (a) khó grep, (b) thiếu role-clause khiến policy áp luôn cho worker. channel_members không có worker job nên không cần worker policy, nhưng vẫn scope `TO mediaos_app` cho nhất quán.

---

### G6-2: Platform Account Encryption (🔴 CROWN-JEWEL — đặc tả sâu ở §6)

```sql
-- Migration 0022_g6_platform_accounts.sql  — RLS+FORCE TRƯỚC backfill (GX-4).
-- ERD v2 §2.1: BỎ encrypted_password (ERD v1); thay bằng ĐÚNG 8 cột envelope.
-- ⚠️ security-reviewer cần xác nhận 8 cột envelope byte-for-byte vs erd-v2 §2.1.
CREATE TABLE platform_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                       REFERENCES companies(id) ON DELETE CASCADE,
  platform_id        uuid NOT NULL REFERENCES platforms(id) ON DELETE RESTRICT,
  account_name       text,
  account_email      text,
  account_identifier text,
  recovery_email     text,   -- ⚠️ PII nhạy (recovery hint) — KHÔNG vào DTO role không quyền (xem §6b)
  recovery_phone     text,   -- ⚠️ PII nhạy — như trên
  two_factor_note    text,   -- ⚠️ hint nhạy — như trên
  owner_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  security_level     text,
  status             text NOT NULL DEFAULT 'active',
  -- 🔒 ENVELOPE columns (ERD v2 §2.1 L86-96) — secret_ciphertext thay encrypted_password:
  secret_ciphertext  bytea NOT NULL,
  encrypted_dek      bytea NOT NULL,
  dek_key_version    int   NOT NULL,
  kms_key_id         text  NOT NULL,
  iv_nonce           bytea NOT NULL,
  auth_tag           bytea NOT NULL,
  enc_algo           text  NOT NULL DEFAULT 'AES-256-GCM',
  last_rotated_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
--> statement-breakpoint
ALTER TABLE platform_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- App policy: scope TO mediaos_app (KHÔNG để áp luôn cho worker).
CREATE POLICY platform_accounts_app_tenant_iso ON platform_accounts
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- ⚠️ Worker policy (BẤT BIẾN #4): rotation job chạy direct pool KHÔNG set app.current_company_id.
-- Không có policy này, worker thấy 0 row → rotation (RED 13) im lặng fail. Mirror outbox_worker_all (0003).
CREATE POLICY platform_accounts_worker_all ON platform_accounts
  TO mediaos_worker
  USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE INDEX platform_accounts_company_id_idx ON platform_accounts (company_id);
--> statement-breakpoint
CREATE INDEX platform_accounts_platform_id_idx ON platform_accounts (platform_id);
--> statement-breakpoint
CREATE INDEX platform_accounts_owner_idx ON platform_accounts (company_id, owner_user_id);
--> statement-breakpoint
ALTER TABLE platform_accounts ADD CONSTRAINT platform_accounts_enc_algo_check
  CHECK (enc_algo IN ('AES-256-GCM'));
--> statement-breakpoint
ALTER TABLE platform_accounts ADD CONSTRAINT platform_accounts_status_check
  CHECK (status IN ('active','inactive','suspended'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_accounts TO mediaos_app;
--> statement-breakpoint
-- ⚠️ Worker rotation cần UPDATE 4 cột wrap (KHÔNG được chạm secret_ciphertext/business cols).
-- Column-level grant: worker re-wrap được mà không thể đọc-ghi secret_ciphertext.
GRANT SELECT ON platform_accounts TO mediaos_worker;
--> statement-breakpoint
GRANT UPDATE (encrypted_dek, kms_key_id, dek_key_version, last_rotated_at)
  ON platform_accounts TO mediaos_worker;
--> statement-breakpoint

-- ===== encryption_keys: GLOBAL key registry (KHÔNG RLS tenant) =====
-- Bảo mật (đã review): kms_key_id = đường dẫn key trong Vault (Vault key path), KHÔNG phải key material.
-- KHÔNG chứa dữ liệu per-tenant. Để RLS-free OK; worker là writer duy nhất (rotation).
CREATE TABLE encryption_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_version int  NOT NULL,
  kms_key_id  text NOT NULL,   -- Vault transit key PATH, không phải key material
  purpose     text NOT NULL,
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  retired_at  timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX encryption_keys_purpose_version_uq ON encryption_keys (purpose, key_version);
--> statement-breakpoint
ALTER TABLE encryption_keys ADD CONSTRAINT encryption_keys_purpose_check
  CHECK (purpose IN ('platform_account','auth_reset_token'));
--> statement-breakpoint
ALTER TABLE encryption_keys ADD CONSTRAINT encryption_keys_status_check
  CHECK (status IN ('active','retiring','revoked'));
--> statement-breakpoint
-- Registry hạ tầng: app đọc để chọn key version; ghi/rotation do worker/migration.
GRANT SELECT ON encryption_keys TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON encryption_keys TO mediaos_worker;
--> statement-breakpoint
INSERT INTO encryption_keys (key_version, kms_key_id, purpose, status)
VALUES (1, 'local-dev-kek', 'platform_account', 'active')
ON CONFLICT (purpose, key_version) DO NOTHING;
--> statement-breakpoint

-- ===== channel_accounts: M:N channel ↔ platform_account (hard DELETE) =====
-- ⚠️ Quyết định: relation_type/status mutable → cần UPDATE. 2 phương án:
--   (A) pure hard-DELETE link: bỏ cột status, relation_type immutable (re-link để đổi).
--   (B) cấp UPDATE để chuyển status.
-- Chọn (A) cho nhất quán "link M:N thuần" → KHÔNG cột status; relation_type immutable (set lúc INSERT).
CREATE TABLE channel_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL
                        DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                        REFERENCES companies(id) ON DELETE CASCADE,
  channel_id          uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  platform_account_id uuid NOT NULL REFERENCES platform_accounts(id) ON DELETE CASCADE,
  relation_type       text NOT NULL DEFAULT 'main_google_account',  -- NOT NULL → NULL-safe unique
  created_at          timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE channel_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE channel_accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY channel_accounts_app_tenant_iso ON channel_accounts
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- ⚠️ company_id index (BẮT BUỘC cho RLS scan) — draft cũ thiếu.
CREATE INDEX channel_accounts_company_id_idx ON channel_accounts (company_id);
--> statement-breakpoint
CREATE INDEX channel_accounts_channel_id_idx ON channel_accounts (channel_id);
--> statement-breakpoint
CREATE INDEX channel_accounts_account_id_idx ON channel_accounts (platform_account_id);
--> statement-breakpoint
-- ⚠️ Composite UNIQUE PHẢI dẫn đầu company_id + NULL-safe (relation_type NOT NULL ở trên).
CREATE UNIQUE INDEX channel_accounts_uq
  ON channel_accounts (company_id, channel_id, platform_account_id, relation_type);
--> statement-breakpoint
ALTER TABLE channel_accounts ADD CONSTRAINT channel_accounts_relation_check CHECK (
  relation_type IN
    ('main_google_account','recovery_email','adsense','analytics',
     'youtube_channel_account','tiktok_account','facebook_page')
);
--> statement-breakpoint
-- Link M:N thuần → hard DELETE: KHÔNG cấp UPDATE (không còn cột mutable).
GRANT SELECT, INSERT, DELETE ON channel_accounts TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON channel_accounts TO mediaos_worker;
```

> **Soft-delete + secret lifecycle (data-lifecycle gap đã vá — xem §6d):** `platform_accounts` soft-delete (`deleted_at`). Mọi read path PHẢI lọc `deleted_at IS NULL`. `channel_accounts` CASCADE từ `platform_accounts` chỉ fire khi HARD delete parent — vì parent soft-delete, service PHẢI tự xóa (hard DELETE) link `channel_accounts` của account khi soft-delete account, tránh orphan-but-live link. Hard-purge job + crypto-shred (xóa/rotate wrapped DEK) cho row soft-deleted sau retention window — xem §6d.

---

### G6-3: ALTER `projects` + ALTER `project_channels` + `project_teams` + `project_members`

```sql
-- Migration 0023_g6_projects_full.sql
-- ⚠️ Verify trước widen (nếu widen status): dữ liệu G4 projects.status ⊂ ('active','paused','archived').
ALTER TABLE projects
  ADD COLUMN code               text,
  ADD COLUMN project_type       text,
  ADD COLUMN description        text,
  ADD COLUMN owner_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN project_manager_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN start_date         date,
  ADD COLUMN end_date           date,
  ADD COLUMN priority           text,
  ADD COLUMN budget             numeric(18,2);
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_type_check CHECK (
  project_type IS NULL OR project_type IN
    ('content_production','channel_operation','growth_campaign','recruitment',
     'training','finance','office_internal','equipment')
);
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_priority_check CHECK (
  priority IS NULL OR priority IN ('low','medium','high','urgent')
);
--> statement-breakpoint
CREATE UNIQUE INDEX projects_company_code_active_uq
  ON projects (company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
--> statement-breakpoint
CREATE INDEX projects_company_status_idx ON projects (company_id, status);
--> statement-breakpoint

-- ===== ALTER project_channels (M:N) =====
-- ⚠️ project_channels mang cột mutable status/role_in_project → BẮT BIẾN #2c: PHẢI cấp UPDATE.
-- 0007 GRANT cũ = SELECT/INSERT/DELETE (no UPDATE). Thêm UPDATE để PATCH status/role được.
ALTER TABLE project_channels
  ADD COLUMN role_in_project text,
  ADD COLUMN status          text NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE project_channels ADD CONSTRAINT project_channels_status_check
  CHECK (status IN ('active','inactive'));
--> statement-breakpoint
GRANT UPDATE ON project_channels TO mediaos_app;
--> statement-breakpoint
-- ⚠️ (fix-forward) 0007 project_channels_uq thiếu company_id → class bug. Sửa unique tại đây:
-- DROP unique cũ (auto-name project_channels_uq từ inline UNIQUE 0007) + tạo lại dẫn đầu company_id.
DROP INDEX IF EXISTS project_channels_uq;
--> statement-breakpoint
CREATE UNIQUE INDEX project_channels_uq ON project_channels (company_id, project_id, channel_id);
--> statement-breakpoint

-- ===== project_teams (M:N project ↔ team) =====
CREATE TABLE project_teams (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL
                    DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                    REFERENCES companies(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_id         uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role_in_project text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE project_teams ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_teams FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_teams_app_tenant_iso ON project_teams
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX project_teams_company_id_idx ON project_teams (company_id);
--> statement-breakpoint
CREATE INDEX project_teams_project_id_idx ON project_teams (project_id);
--> statement-breakpoint
CREATE INDEX project_teams_team_id_idx ON project_teams (team_id);
--> statement-breakpoint
-- ⚠️ Composite UNIQUE dẫn đầu company_id (fix-forward, không mirror project_channels cũ).
CREATE UNIQUE INDEX project_teams_uq ON project_teams (company_id, project_id, team_id);
--> statement-breakpoint
-- project_teams: pure hard-DELETE link (role_in_project immutable; re-link để đổi) → KHÔNG cột status, KHÔNG UPDATE.
GRANT SELECT, INSERT, DELETE ON project_teams TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON project_teams TO mediaos_worker;
--> statement-breakpoint

-- ===== project_members (project ↔ user + role + workload — soft-delete) =====
CREATE TABLE project_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL
                     DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                     REFERENCES companies(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_in_project  text,
  permission_level text,
  workload_percent numeric(5,2),
  start_date       date,
  end_date         date,
  status           text NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
--> statement-breakpoint
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_members_app_tenant_iso ON project_members
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX project_members_company_id_idx ON project_members (company_id);
--> statement-breakpoint
CREATE INDEX project_members_project_id_idx ON project_members (project_id);
--> statement-breakpoint
CREATE INDEX project_members_user_id_idx ON project_members (user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX project_members_active_uq
  ON project_members (company_id, project_id, user_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE project_members ADD CONSTRAINT project_members_status_check
  CHECK (status IN ('active','inactive'));
--> statement-breakpoint
-- project_members có status mutable (active/inactive) + soft-delete → cần UPDATE.
GRANT SELECT, INSERT, UPDATE, DELETE ON project_members TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON project_members TO mediaos_worker;
```

---

### G6-4a: `content_types` (NEW)

```sql
-- Migration 0024_g6_content_types.sql
-- ⚠️ CRITICAL FIX: workflow_templates + evaluation_templates KHÔNG TỒN TẠI ở M2.
--   - workflow.ts thực tế export bảng 'workflow_definitions' (KHÔNG phải workflow_templates).
--   - template-concept land G7-1 (TASKS L229); evaluation_templates là G8.
--   → default_workflow_template_id / default_evaluation_template_id = uuid TRẦN, KHÔNG REFERENCES.
--     FK deferred sang G7/G8 (lúc đó ADD CONSTRAINT ... REFERENCES workflow_templates/evaluation_templates).
CREATE TABLE content_types (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                     uuid NOT NULL
                                   DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                                   REFERENCES companies(id) ON DELETE CASCADE,
  name                           text NOT NULL,
  code                           text,
  description                    text,
  -- FK to workflow_templates/evaluation_templates DEFERRED to G7/G8 (chưa có bảng ở M2):
  default_workflow_template_id   uuid,   -- NO REFERENCES (defer G7)
  default_evaluation_template_id uuid,   -- NO REFERENCES (defer G8)
  target_platform                text,
  standard_duration              int,
  status                         text NOT NULL DEFAULT 'active',
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  deleted_at                     timestamptz
);
--> statement-breakpoint
ALTER TABLE content_types ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE content_types FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY content_types_app_tenant_iso ON content_types
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX content_types_company_id_idx ON content_types (company_id);
--> statement-breakpoint
CREATE UNIQUE INDEX content_types_company_name_active_uq
  ON content_types (company_id, name) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX content_types_company_code_active_uq
  ON content_types (company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
--> statement-breakpoint
ALTER TABLE content_types ADD CONSTRAINT content_types_status_check
  CHECK (status IN ('active','inactive'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON content_types TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON content_types TO mediaos_worker;
```

> **Đính chính so với draft cũ (CRITICAL):** draft ghi `default_workflow_template_id uuid REFERENCES workflow_templates(id)` + `default_evaluation_template_id uuid REFERENCES evaluation_templates(id)` — **cả 2 bảng không tồn tại ở M2** → migration fail `relation "workflow_templates" does not exist`. Đã đổi thành **uuid trần KHÔNG FK**; FK defer G7/G8. (Nếu muốn FK workflow ngay, chỉ có thể trỏ `workflow_definitions(id)` — nhưng template-concept thuộc G7 nên defer là lựa chọn rủi ro thấp hơn.) Code đọc `default_workflow_template_id` cho suggest-workflow chỉ trả id (FE pre-fill, instance thật ở G7).

### G6-4b: ALTER `content_items` (content_type text → content_type_id FK + cols)

```sql
-- Migration 0025_g6_content_items_full.sql  — DATA MIGRATION + CHECK reconcile.
-- BƯỚC 1: thêm content_type_id + cột mới (chưa drop cột text 'content_type').
ALTER TABLE content_items
  ADD COLUMN content_type_id    uuid REFERENCES content_types(id) ON DELETE SET NULL,
  ADD COLUMN code               text,
  ADD COLUMN description        text,
  ADD COLUMN owner_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN main_channel_id    uuid REFERENCES channels(id) ON DELETE SET NULL,
  ADD COLUMN language           text,
  ADD COLUMN production_status  text,
  ADD COLUMN planned_publish_at timestamptz,
  ADD COLUMN published_at       timestamptz,
  ADD COLUMN final_url          text,
  ADD COLUMN thumbnail_url      text,
  ADD COLUMN script_url         text,
  ADD COLUMN video_file_url     text,
  ADD COLUMN priority           text;
--> statement-breakpoint
-- BƯỚC 2: seed content_types tối thiểu cho các code đang có ('video','short','reel') theo từng company.
-- ⚠️ CRITICAL FIX: content_types CHỈ có PARTIAL unique (content_types_company_code_active_uq
--   WHERE deleted_at IS NULL AND code IS NOT NULL). 'ON CONFLICT DO NOTHING' KHÔNG target được
--   partial index (Postgres cần arbiter cụ thể; arbiter-less ON CONFLICT chỉ xét non-partial unique).
--   → dùng NOT EXISTS guard (an toàn với partial index, không cần arbiter), idempotent.
INSERT INTO content_types (company_id, name, code)
SELECT DISTINCT c.company_id, x.name, x.code
FROM content_items c
CROSS JOIN (VALUES ('Video dài','video_long'),('YouTube Short','youtube_short'),('Social Post','social_post'))
  AS x(name, code)
WHERE NOT EXISTS (
  SELECT 1 FROM content_types ct
  WHERE ct.company_id = c.company_id AND ct.code = x.code AND ct.deleted_at IS NULL
);
--> statement-breakpoint
-- BƯỚC 3: backfill content_type_id (join 1:1 per (company_id, code) — đã đảm bảo bởi partial unique).
UPDATE content_items ci SET content_type_id = ct.id
FROM content_types ct
WHERE ct.company_id = ci.company_id
  AND ct.deleted_at IS NULL
  AND ct.code = CASE ci.content_type
        WHEN 'video' THEN 'video_long'
        WHEN 'short' THEN 'youtube_short'
        WHEN 'reel'  THEN 'social_post' END;
--> statement-breakpoint
-- ⚠️ GUARD (executable): mọi content_items chưa soft-delete PHẢI có content_type_id.
-- Nếu content_type cũ là giá trị ngoài {video,short,reel} hoặc NULL → backfill để NULL → abort với context.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM content_items WHERE content_type_id IS NULL AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'content_items.content_type_id backfill incomplete: % rows (unmapped content_type)',
      (SELECT count(*) FROM content_items WHERE content_type_id IS NULL AND deleted_at IS NULL);
  END IF;
END $$;
--> statement-breakpoint
-- BƯỚC 4: production_status (10-value, TÁCH khỏi 'status' workflow-lite hiện có). Backfill từ status cũ.
ALTER TABLE content_items ADD CONSTRAINT content_items_production_status_check CHECK (
  production_status IS NULL OR production_status IN
    ('idea','planning','in_production','waiting_review','revision','approved',
     'scheduled','published','analyzed','cancelled')
);
--> statement-breakpoint
UPDATE content_items SET production_status = CASE status
  WHEN 'draft' THEN 'idea' WHEN 'in_production' THEN 'in_production'
  WHEN 'review' THEN 'waiting_review' WHEN 'approved' THEN 'approved'
  WHEN 'published' THEN 'published' ELSE 'idea' END
WHERE production_status IS NULL;
--> statement-breakpoint
ALTER TABLE content_items ADD CONSTRAINT content_items_priority_check
  CHECK (priority IS NULL OR priority IN ('low','medium','high','urgent'));
--> statement-breakpoint
-- DROP cột text 'content_type' + CHECK cũ. Giữ 'status' cũ (workflow-lite).
-- ⚠️ Tên CHECK: Postgres auto-name từ inline unnamed CHECK 0007 = 'content_items_content_type_check'
--   (KHÔNG phải 'content_items_type_check' như Drizzle media.ts:123 khai báo — tên Drizzle là cosmetic,
--   KHÔNG nằm trong DB vì migration là raw SQL, xem meta/_journal.json). DROP theo tên DB thật.
ALTER TABLE content_items DROP CONSTRAINT content_items_content_type_check;
--> statement-breakpoint
ALTER TABLE content_items DROP COLUMN content_type;
--> statement-breakpoint
CREATE UNIQUE INDEX content_items_company_code_active_uq
  ON content_items (company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
--> statement-breakpoint
CREATE INDEX content_items_content_type_id_idx ON content_items (content_type_id);
--> statement-breakpoint
CREATE INDEX content_items_main_channel_idx
  ON content_items (company_id, main_channel_id, production_status);
--> statement-breakpoint
CREATE INDEX content_items_project_status_idx
  ON content_items (company_id, project_id, status);
```

> `content_type` chuyển từ free-text CHECK enum (`video/short/reel`) sang `content_type_id` FK là **breaking change** chạm: SQL CHECK + `db/schema/media.ts` + Zod contract (`contentTypeSchema` enum) + FE default `"video"`. Đổi đồng bộ trong cùng commit step 4b. **content_type_id để nullable** (FK ON DELETE SET NULL — type bị xóa thì content vẫn sống); nhưng backfill được guard NULL nên không có orphan content lúc migrate. (Cân nhắc SET NOT NULL sau khi vận hành ổn nếu ERD intent yêu cầu — hiện giữ nullable để chịu được content type bị soft-delete sau này.)

### G6-4c: `content_channels` (đa kênh) + `content_assets` (version chain)

```sql
-- Migration 0026_g6_content_channels_assets.sql
CREATE TABLE content_channels (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                       REFERENCES companies(id) ON DELETE CASCADE,
  content_item_id    uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  channel_id         uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  -- platform_id: snapshot publish-time. ON DELETE RESTRICT (nhất quán với channels/platform_accounts
  -- vốn RESTRICT platforms FK — KHÔNG dùng SET NULL như draft cũ). Derivable từ channel; giữ làm snapshot.
  platform_id        uuid REFERENCES platforms(id) ON DELETE RESTRICT,
  publish_status     text,
  publish_url        text,
  planned_publish_at timestamptz,
  published_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE content_channels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE content_channels FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY content_channels_app_tenant_iso ON content_channels
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- ⚠️ company_id standalone index (BẮT BUỘC cho RLS scan) — draft cũ thiếu.
CREATE INDEX content_channels_company_id_idx ON content_channels (company_id);
--> statement-breakpoint
CREATE INDEX content_channels_content_id_idx ON content_channels (content_item_id);
--> statement-breakpoint
CREATE INDEX content_channels_publish_idx ON content_channels (company_id, channel_id, publish_status);
--> statement-breakpoint
-- ⚠️ Composite UNIQUE dẫn đầu company_id.
CREATE UNIQUE INDEX content_channels_uq ON content_channels (company_id, content_item_id, channel_id);
--> statement-breakpoint
ALTER TABLE content_channels ADD CONSTRAINT content_channels_publish_status_check CHECK (
  publish_status IS NULL OR publish_status IN
    ('not_scheduled','scheduled','publishing','published','failed','removed')
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON content_channels TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON content_channels TO mediaos_worker;
--> statement-breakpoint

-- ===== content_assets + version chain (ERD v2 §11) =====
CREATE TABLE content_assets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL
                     DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                     REFERENCES companies(id) ON DELETE CASCADE,
  content_item_id  uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  asset_type       text,
  name             text,
  file_url         text,
  external_url     text,
  version          int  NOT NULL DEFAULT 1,
  version_group_id uuid NOT NULL,   -- nhóm version; v1 PHẢI = id (anchor, ép ở service)
  parent_asset_id  uuid REFERENCES content_assets(id) ON DELETE SET NULL,
  is_current       boolean NOT NULL DEFAULT true,
  superseded_by    uuid REFERENCES content_assets(id) ON DELETE SET NULL,
  uploaded_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
--> statement-breakpoint
ALTER TABLE content_assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE content_assets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY content_assets_app_tenant_iso ON content_assets
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- ⚠️ company_id standalone index (one-current uq chỉ cover WHERE is_current) — draft cũ thiếu.
CREATE INDEX content_assets_company_id_idx ON content_assets (company_id);
--> statement-breakpoint
CREATE INDEX content_assets_content_id_idx ON content_assets (content_item_id);
--> statement-breakpoint
CREATE INDEX content_assets_version_group_idx ON content_assets (version_group_id);
--> statement-breakpoint
-- ⚠️ ĐÚNG 1 version current/group + LOẠI soft-deleted (ERD v2 §11.2).
-- Draft cũ thiếu 'AND deleted_at IS NULL' → row soft-deleted còn is_current=true sẽ chiếm slot current,
-- chặn promote version mới. Service PHẢI flip is_current=false khi soft-delete bản current (cùng tx).
CREATE UNIQUE INDEX content_assets_one_current_uq
  ON content_assets (company_id, version_group_id) WHERE is_current AND deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE content_assets ADD CONSTRAINT content_assets_type_check CHECK (
  asset_type IS NULL OR asset_type IN
    ('script','voice','raw_video','edited_video','thumbnail','seo_document','reference','final_output')
);
--> statement-breakpoint
ALTER TABLE content_assets ADD CONSTRAINT content_assets_status_check
  CHECK (status IN ('active','archived'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON content_assets TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON content_assets TO mediaos_worker;
```

> **Version chain (ERD v2 §11):** tạo version mới = INSERT row mới (cùng `version_group_id`, `parent_asset_id` = bản trước, `version`+1, `is_current=true`) **+ flip bản cũ `is_current=false` + set `superseded_by`** trong CÙNG 1 transaction `withTenant`. Cấm hard-delete version cũ. Partial unique `WHERE is_current AND deleted_at IS NULL` ép đúng 1 bản hiện hành/group. **Service-layer invariant:** v1 PHẢI có `parent_asset_id IS NULL` và `version_group_id = id` (anchor group, tránh orphan group); soft-delete bản current PHẢI flip `is_current=false` cùng tx (test ở 4c/4e). `version_group_id` không có FK → integrity ép ở service.

---

## 5. Phân rã micro-step

| # | Bước nhỏ | Vùng | Model | Agent/Skill | Song song? | Test (deny-path trước nếu 🔴/🟡) | DoD bước |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **0** | Migration **0020**: mở rộng `audit_logs_object_type_chk` (11 object types G6) + append `AUDIT_OBJECT_TYPES` (audit.ts) | 🔴 | Sonnet | `ecc:database-reviewer` | ❌ **(PHẢI TRƯỚC MỌI BƯỚC)** | ALTER không fail; INSERT audit 'platform_account'/'channel'/'content' không throw | migration xanh + TS const đồng bộ |
| 1a | Migration **0021**: CREATE `platforms` (global, seed 6) + ALTER `channels` (platform_id FK + backfill + GUARD + reconcile 'inactive'→'paused' + widen status + health) + CREATE `channel_members` | 🔴 | Sonnet | `ecc:database-reviewer` | ❌ (sau 0) | migrate; DO-block guard pass; G2-5 2-tenant xanh | migration + RLS xanh |
| 1b | Drizzle schema `media.ts`: thêm `platforms`, `channelMembers`; sửa `channels` (cols + CHECK byte-identical) | 🟢 | Haiku | `ecc:typescript-reviewer` | ❌ (sau 1a) | typecheck; `$inferSelect` đúng | schema compile |
| 1c | Contracts `media.ts`: `platformSchema`, `channelSchema` (full), `createChannelSchema`, `updateChannelSchema`, `channelMemberSchema` | 🟢 | Haiku | `ecc:typescript-reviewer` | ✅ (sau 1b) | Zod compile; code='' normalize→NULL | contracts build |
| 1d | BE: mở rộng `MediaService`/`MediaRepository` — channel CRUD đầy đủ + filter (platform/status/manager) + `channel_members` assign + **retrofit audit + permission guard** | 🟢 | Sonnet | `ecc:typescript-reviewer` | ❌ (sau 1c) | list filter đúng; assign manager; 403 không quyền; audit 'channel' | test xanh |
| 1e | FE: `/channels` (ChannelTable + FilterBar + CreateChannelDialog) + `/channels/$channelId` (tab shell + Overview/Members tabs) | 🟢 | Haiku | `ecc:react-reviewer` | ✅ (sau 1d) | — | list/filter/detail render |
| **2a** | **Migration 0022**: CREATE `platform_accounts` (8 cột envelope + **worker policy + column-grant rotation**) + `encryption_keys` + `channel_accounts` (uq dẫn đầu company_id) + RLS + GRANT | 🔴 | **Opus** | `ecc:database-reviewer` + `ecc:security-reviewer` | ❌ | migrate; RLS 2-tenant; KHÔNG có cột `encrypted_password`; worker thấy row qua worker policy; encryption_keys không RLS tenant | **FULL gate** |
| **2b** | **RED deny-path tests** (§6e ca 1–14) viết TRƯỚC, chạy ĐỎ trên stub | 🔴 | **Opus** | `ecc:tdd-guide` | ❌ (sau 2a) | 14 ca RED đỏ đúng lý do (deny-sensitive / deny-reauth-required / object-tier / no-leak / failed-reveal-audit) | test đỏ đủ |
| **2c** | `apps/api/src/crypto/`: `EnvelopeCipher` (AES-256-GCM + AAD pinned) + `KmsProvider` (LocalKek/Vault) + `SecretEncryptionService` (DEK/record, zero buffer, **app-gen UUID cho AAD**) | 🔴 | **Opus** | `ecc:security-reviewer` + `ecc:silent-failure-hunter` + `ecc:santa-method` | ❌ (sau 2b) | seal/open round-trip; tamper tag/AAD → throw; nonce unique/record; AAD bind company_id+id+algo+ver | crypto xanh + fail-closed |
| **2d** | Migration **0027**: seed permission `edit-platform-account` (is_sensitive) + grants metadata read/update/manage cho channel-manager + reveal-secret KHÔNG vào system role | 🔴 | **Opus** | `ecc:security-reviewer` + `ecc:database-reviewer` | ❌ (sau 0) | catalog có `edit-platform-account`; wildcard KHÔNG đủ; system role không có reveal-secret | **FULL gate** |
| **2e0** | **(MỚI — CRITICAL prereq)** Vá `PermissionGuard`: đọc `resourceId` từ route param + build `ctx:{reauthValidUntil,requestId}` → truyền cả 2 vào `can()`. Hoặc reveal-handler chuyên biệt. Không có bước này, Tầng-3 object_permissions bị bypass. | 🔴 | **Opus** | `ecc:security-reviewer` + `ecc:silent-failure-hunter` | ❌ (sau 2d) | RED 14: company-level ALLOW + KHÔNG object grant trên account X → 403 (deny object-tier); guard forward resourceId+ctx | guard xanh + Tầng-3 enforced |
| **2e** | BE: `PlatformAccountModule` — CRUD (mask projection) + `POST /:id/reveal` (re-auth + decrypt + audit, **audit cả failed-reveal**) + `POST /reauth` (window scope theo (userId,accountId) hoặc one-shot) + edit-audit + `channel_accounts` link + filter `deleted_at IS NULL` | 🔴 | **Opus** | `ecc:security-reviewer` + `ecc:silent-failure-hunter` + `ecc:santa-method` | ❌ (sau 2c/2e0) | RED→GREEN ca 1–11,14; secret KHÔNG vào list DTO; audit mỗi reveal + mỗi edit + mỗi failed-reveal | **FULL gate** |
| **2f** | BE: di trú reset-token — `forgotPassword` envelope-encrypt outbox payload (purpose='auth_reset_token') + mail consumer decrypt JIT + seed key (0028) + **scrub plaintext token cũ trong outbox** | 🔴 | **Opus** | `ecc:security-reviewer` + `ecc:silent-failure-hunter` | ❌ (sau 2c) | RED ca 12: payload KHÔNG chứa plaintext token; consumer round-trip đúng; outbox cũ scrub | **FULL gate** |
| **2g** | `kms-provisioning-and-rotation` (infra) + rotation re-wrap job (worker, **dùng worker policy + column-grant**) + break-glass runbook | 🔴 | **Opus** | `ecc:security-reviewer` + `ecc:santa-method` | ✅ (sau 2c) | RED ca 13: re-wrap đổi encrypted_dek/kms_key_id/last_rotated_at (version PIN — DECISION A), plaintext không đổi; worker thấy row | runbook + job xanh |
| 2h | FE: `ChannelAccountsTab` (PlatformAccountCard grouped by relation_type) + `SecretField` (masked + reveal) + `ReAuthModal` + gate `<PermissionGate reveal-secret>` | 🔴 | Sonnet | `ecc:react-reviewer` + `ecc:security-reviewer` | ✅ (sau 2e) | reveal → re-auth modal → fetch 1 field; không cache plaintext | secret UX gated |
| 3a | Migration **0023**: ALTER `projects` + ALTER `project_channels` (+ **GRANT UPDATE** + uq dẫn đầu company_id) + CREATE `project_teams` + `project_members` + RLS | 🔴 | Sonnet | `ecc:database-reviewer` | ❌ (sau 0) | migrate; RLS 2-tenant; partial unique; PATCH status project_channel chạy | migration + RLS xanh |
| 3b | Schema + contracts: `projects` full, `projectTeamSchema`, `projectMemberSchema`, `addProjectTeamSchema`, `addProjectMemberSchema` | 🟢 | Haiku | `ecc:typescript-reviewer` | ❌ (sau 3a) | typecheck; Zod compile | schema/contracts |
| 3c | BE: project CRUD full + attach/detach **kênh/team/member** (M:N) + audit 'project'/'project_team'/'project_member' + permission `assign` | 🟢 | Sonnet | `ecc:typescript-reviewer` | ❌ (sau 3b) | gắn nhiều kênh/team/member; 1 kênh nhiều project; deny cross-tenant | test xanh |
| 3d | FE: `/projects` (ProjectTable + type filter) + `/projects/$projectId` tabs (Channels/Teams/Members/Content) | 🟢 | Haiku | `ecc:react-reviewer` | ✅ (sau 3c) | — | tabs + attach dialogs |
| 4a | Migration **0024**: CREATE `content_types` (template id = uuid trần, KHÔNG FK) + RLS | 🔴 | Sonnet | `ecc:database-reviewer` | ❌ (sau 0) | migrate (KHÔNG fail vì FK thiếu bảng); RLS 2-tenant | migration xanh |
| 4b | Migration **0025**: ALTER `content_items` (content_type_id FK + cols + production_status) + seed (NOT EXISTS) + backfill + **GUARD NULL** + DROP content_type text + CHECK reconcile | 🔴 | Sonnet | `ecc:database-reviewer` | ❌ (sau 4a) | GUARD content_type_id ≠ NULL hết; production_status map đúng; G2-5 + G4-2 regression xanh | **FULL gate** (data migration) |
| 4c | Migration **0026**: CREATE `content_channels` (uq+idx company_id) + `content_assets` (version chain + one-current uq **WHERE is_current AND deleted_at IS NULL**) + RLS | 🔴 | Sonnet | `ecc:database-reviewer` | ❌ (sau 4b) | migrate; one-current uq chặn 2 current/group; soft-deleted không chiếm slot | migration + RLS xanh |
| 4d | Schema + contracts: `contentItem` full, `contentTypeSchema`→object, `contentChannelSchema`, `contentAssetSchema`, `createContentAssetVersionSchema` | 🟢 | Haiku | `ecc:typescript-reviewer` | ❌ (sau 4c) | typecheck; FE default 'video' bỏ | contracts (breaking) đồng bộ |
| 4e | BE: content CRUD full + multi-channel publish (content_channels per-channel status/url/lịch) + asset CRUD + **version (INSERT + flip is_current 1 tx) + soft-delete current flip** + suggest-workflow (đọc default_workflow_template_id) | 🟢 | Sonnet | `ecc:typescript-reviewer` | ❌ (sau 4d) | gắn nhiều kênh; mỗi kênh status riêng; version chain đúng; soft-delete current flip; suggest trả template id | test xanh |
| 4f | FE: `/content` + `/content/$contentId` tabs (PublishTargetsTable + AssetManager + version history) + `CreateContentDialog` (ContentTypeSelect → suggest workflow) | 🟢 | Haiku | `ecc:react-reviewer` | ✅ (sau 4e) | — | multi-publish + asset version UI |
| 5a | BE: Channel Health — `PATCH /channels/:id/health` (health_status, health_score, risk note) + audit + surface "kênh cần chú ý" (filter risk/declining) | 🟢 | Haiku | `ecc:typescript-reviewer` | ❌ (sau 1d) | cập nhật health; list filter risk; permission channel manage | test xanh |
| 5b | FE: `ChannelHealthTab` (HealthScoreBadge + risk list) + Dashboard widget "kênh rủi ro" | 🟢 | Haiku | `ecc:react-reviewer` | ✅ (sau 5a) | — | health tab + dashboard feed |
| LIGHT | LIGHT gate cho G6-1/3/4/5 (CRUD/UI) | — | — | `ecc:typescript-reviewer` + `ecc:quality-gate` | — | — | gate PASS |
| FULL | FULL gate cho **0, 1a, 2a–2g, 3a, 4b, 4c** | — | — | `ecc:security-reviewer` + `ecc:database-reviewer` + `ecc:silent-failure-hunter` (+ `ecc:santa-method` cho 2c/2e crown-jewel) + `ecc:security-scan` | — | — | FULL gate PASS |

> ⚠️ **Tooling note (CRITICAL fix):** draft cũ trích dẫn 3 reviewer/hook KHÔNG TỒN TẠI (`secret-encryption-reviewer`, `envelope-encryption-auditor`, `sensitive-action-audit-hook`). `.claude/agents/` chỉ có `completion-evaluator`, `plan-reviewer`, `rls-tenant-isolation-tester`; `.claude/hooks/` chỉ có `anti-bandaid(-guard)`, `format-on-write`, `guard-immutability`, `guard-secrets`, `typecheck-changed`. **Quyết định:** dùng tool TỒN TẠI (`ecc:security-reviewer` + `ecc:santa-method` + `ecc:silent-failure-hunter` + `ecc:security-scan`) và **chuyển mọi kiểm tra secret-leak/audit-coverage thành RED test** (ca 7/10/11/4-failed-reveal) vì KHÔNG hook nào bắt được runtime leak. KHÔNG trình bày agent không tồn tại như lưới an toàn. (Tùy chọn: nếu muốn tự build `secret-encryption-reviewer` agent thì làm TRƯỚC 2a và gate merge vào sự tồn tại của nó — nhưng default là dùng RED test.)

### Thứ tự tuần tự bắt buộc:
```
0  →  [tất cả bước khác]                       (audit object types TRƯỚC mọi audit-write)

G6-1:  1a → 1b → 1c → 1d → 1e
G6-2:  (cần platforms+channels từ 1a)  2a → 2b(RED) → 2c → 2e0 → 2e ; 2d sau 0 (trước 2e0) ; 2f sau 2c ; 2g sau 2c ; 2h sau 2e
G6-3:  3a → 3b → 3c → 3d                        (sau 0; độc lập G6-1/2)
G6-4:  4a → 4b → 4c → 4d → 4e → 4f              (4b cần content_types 4a + channels 1a)
G6-5:  5a → 5b                                  (sau 1d — health cột đã có ở 1a)

Song song an toàn: G6-3 ∥ G6-1 (khác bảng); G6-5 sau G6-1.
G6-2 KHÔNG song song với 1a (FK platform_id, channel_id); KHÔNG song song nội bộ (secret crown-jewel, 1 nhánh, hand-driven).
G6-4 sau G6-1 (FK main_channel_id, content_channels.channel_id) + content_types.
⚠️ 2e0 (vá guard) BẮT BUỘC trước 2e (mở reveal endpoint) — nếu không Tầng-3 bypass.
```

---

## Permission seed (G6 — catalog + grants, mirror G5 salary-mask)

> Migration **0027** `g6_permissions_seed.sql` — pattern `INSERT … ON CONFLICT (action, resource_type) DO NOTHING`; fixed role UUID `…001`–`…009` (**…001–…008 ở 0005**, **…009 hr-manager ở 0019**). **Đã có sẵn** trong `0005` (KHÔNG re-seed, ON CONFLICT bảo vệ): `channel/project/content` CRUD + `platform-account` (gồm **`reveal-secret` is_sensitive=TRUE**) + `delete-project` (TRUE).

**(a) Resource types G6 ADD (non-sensitive, CRUD+manage):** `channel-member`, `project-team`, `project-member`, `content-type`, `content-channel`, `content-asset`, `content-version`.

**(b) Sensitive ADD:** `edit-platform-account` (`platform-account`, **is_sensitive=TRUE**) — Matrix §11 tách riêng khỏi generic `update`. (`reveal-secret` đã có ở 0005:281.)

**(c) Grants non-sensitive:**
- **company-admin (`…001`)**: re-run blanket `WHERE p.is_sensitive=false` (idempotent ON CONFLICT) → tự phủ resource type mới. **CỐ Ý loại sensitive** (anti-escalation, ADR-0010).
- **channel-manager (`…003`)**: `channel` read/update/manage; `channel-member` read/update/manage; `content` read/update/delete/approve/comment; `content-channel` create/read/update/delete; `content-asset` read/manage; `content-version` read; **`platform-account` read/update/manage (metadata, KHÔNG secret)**.
- **project-manager (`…002`)**: `project` read/update/assign/manage; `project-team` CRUD; `project-member` CRUD+assign; `content` create/read/update/delete/approve/comment; `content-channel` CRUD; `content-asset` read/manage; `channel` read. **KHÔNG** blanket `platform-account read` (Matrix 8.2 "Không mặc định" → object_permissions).
- **script-writer/editor/uploader/qa-reviewer (`…004–007`)**: `content-asset` read; `content-version` read (assigned scope); uploader thêm `content-channel` read.

**(d) Grants sensitive — KHỐI RIÊNG `WHERE … is_sensitive=true`, KHÔNG role hệ thống nào nhận mặc định** (mirror `0019` L78–86). Nếu muốn đường seed demo: tạo role `security-admin` và grant **explicit**:

```sql
-- reveal-secret + edit-platform-account (SENSITIVE) — wildcard KHÔNG đủ (ADR-0010). Mirror 0019:78-86.
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '<security-admin-uuid>', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type = 'platform-account'
  AND p.action IN ('reveal-secret', 'edit-platform-account')
  AND p.is_sensitive = true
ON CONFLICT DO NOTHING;
```

> ⚠️ Object-tier enforcement: reveal-secret dựa vào **object_permissions (Tầng 3)** để giới hạn TỪNG account. Một company-level exact ALLOW trên `reveal-secret:platform-account` sẽ cho reveal MỌI account của tenant NẾU guard không truyền `resourceId` (xem 2e0). Vì vậy seed demo nên grant qua **object_permissions cho account cụ thể**, không phải company-level blanket — và guard PHẢI forward `resourceId` để Tầng-3 thật sự được đánh giá.

**`CanInput` cho reveal-secret** (mirror G5 salary-mask + thêm re-auth + resourceId):

```ts
const decision = await this.permissionService.can({
  userId,
  companyId,                       // RLS mới là enforcer thật; companyId chỉ ctx/cache-key
  action: 'reveal-secret',         // exact string catalog (0005)
  resourceType: 'platform-account',
  resourceId: platformAccountId,   // ⚠️ concrete id → full 4-tier (gồm Tầng-3 object_permissions).
                                   //    Guard PHẢI forward (2e0); nếu null → object-tier bị skip (bypass).
  isSensitive: true,               // wildcard *:* / manage KHÔNG thỏa (kể cả company-admin)
  requiresReauth: true,            // CHỈ reveal-secret bật cờ này
  ctx: { reauthValidUntil, requestId },   // service so reauthValidUntil > now(); guard PHẢI forward (2e0)
});
// decision.reason: 'deny-sensitive'         → 403, KHÔNG decrypt (relying on manage/wildcard)
//                  'deny-reauth-required'    → trả re-auth challenge, KHÔNG decrypt
//                  'deny-default' (object)   → 403, có company ALLOW nhưng KHÔNG object grant trên id này
//                  allow:true → envelope decrypt app-side; auditRequired=true → 1 audit row reveal
```

So với **salary-mask** (G5): cùng shape `isSensitive:true`. Lưu ý `view-salary` tồn tại trên **HAI** resource_type — `payslip` (0005:286) và `employee` (0019) — là 2 row riêng biệt; **analogy reveal-secret dùng biến thể `employee`/0019** (`action:'view-salary'`, `resourceType:'employee'`), **KHÔNG `requiresReauth`** và không cần `reauthValidUntil`. reveal-secret = salary-mask (`employee`/0019) **+ `requiresReauth:true` + `ctx.reauthValidUntil` + `resourceId` (Tầng-3)**.

---

## 6. G6-2 Platform Account Encryption — đặc tả sâu (điểm trọng yếu G6)

### (a) Crypto design — AES-256-GCM, DEK/record wrapped by KEK
- **Envelope app-side** (ADR-0004 binding, ⚠️ High irreversibility): DEK mới **mỗi lần ghi (create AND update/rotate-secret)** (`crypto.randomBytes(32)`) mã hóa secret; KEK (trong KMS/Vault, **không bao giờ** trong DB/env-host) wrap DEK. **KHÔNG pgcrypto-in-SQL** (ADR-0004 bác bỏ: "key gần DB, rò log").
- **AEAD:** `aes-256-gcm` qua Node built-in `crypto` (`createCipheriv`/`createDecipheriv`). Nonce 12-byte `crypto.randomBytes(12)` mới **MỖI write** — **CẤM re-encrypt in-place tái dùng DEK** (catastrophic GCM nếu (DEK,nonce) lặp). Auth tag 16-byte. RED ca 9 cover cả **PATCH/update path** (không chỉ 2 create).
- **AAD binding — pinned composition (FIX):** `aad = utf8(companyId) || utf8(platform_account_id) || utf8(enc_algo) || utf8(dek_key_version)`. **`platform_account_id` PHẢI do APP sinh (`crypto.randomUUID()`) TRƯỚC INSERT** và truyền vào `encryptSecret` — KHÔNG dùng DB-default `gen_random_uuid()` (lúc encrypt chưa biết id → AAD không bind được như draft cũ mô tả). Vì GCM verify phụ thuộc AAD byte-identical, composition này được ghi cố định; decrypt dựng lại AAD đúng thứ tự/encoding từ cột row. (Phương án thay thế nếu không muốn app-gen id: bind AAD chỉ `companyId+enc_algo+dek_key_version` — nhưng plan CHỌN app-gen id để bind cả id.)
- **8 cột envelope** = đúng ERD v2 §2.1 (xem migration 0022). KHÔNG mang theo `encrypted_password`. security-reviewer xác nhận 8 cột byte-for-byte vs erd-v2 §2.1.

### (b) Service interface — app-side, không pgcrypto, không log
Module mới `apps/api/src/crypto/`:
```ts
export interface KmsProvider {                 // KEK không bao giờ rời provider
  wrapDek(plaintextDek: Buffer, purpose: KeyPurpose): Promise<WrappedDek>;
  unwrapDek(wrapped: Buffer, kmsKeyId: string, keyVersion: number): Promise<Buffer>;
  currentKey(purpose: KeyPurpose): Promise<{ kmsKeyId: string; keyVersion: number }>;
}
export type KeyPurpose = 'platform_account' | 'auth_reset_token';
export interface EnvelopeCipher {              // AEAD thuần, không biết KMS/DB
  seal(plaintext: string, dek: Buffer, aad: Buffer): SealedSecret;  // {ciphertext, iv, authTag, algo}
  open(sealed: SealedSecret, dek: Buffer, aad: Buffer): string;     // throw khi sai tag/AAD
}
export interface SecretEncryptionService {     // orchestrate: new DEK → seal → wrap → cột row
  encryptSecret(plaintext: string, ctx: EncryptCtx): Promise<EncryptedColumns>;  // ctx.recordId app-gen
  decryptSecret(row: EncryptedColumns, ctx: EncryptCtx): Promise<string>;        // CHỈ reveal path
}
```
**Luật cứng (ÉP bởi RED test, KHÔNG bởi hook không tồn tại):** DEK zero bằng `dek.fill(0)` trong `finally`; AAD từ `EncryptCtx` (pinned §6a); **không log** plaintext/DEK/ciphertext/tag; error message generic ("decrypt failed"), exception filter không serialize field secret. **secret + recovery_email/recovery_phone/two_factor_note KHÔNG vào DTO** role không quyền — mask tại **tầng query-projection** (mirror `auth.service.ts me()` chỉ select cột public — cột secret + 3 cột recovery hint KHÔNG nằm trong default projection của list/detail). Decrypt chỉ ở `reveal-secret` endpoint (c) + mail-consumer reset-token (d).

> ⚠️ **`guard-secrets.mjs` chỉ là literal-scanner** (regex trên text ADDED qua Write/Edit; exempt path test/fixtures/*.example; không soi runtime data-flow). Nó **KHÔNG** bắt được: (1) secret column lọt list/detail DTO projection, (2) secret/DEK/tag truyền vào `logger.error`, (3) plaintext ghi audit before/after, (4) fixture in secret thật. **Defense thật = RED test:**
> - **RED 7** — projection allowlist test trên **response đã serialize thật** (không chỉ type): list/detail/WS DTO KHÔNG chứa `secret_ciphertext`/`encrypted_dek`/`iv_nonce`/`auth_tag`/plaintext (mọi role).
> - **RED 10** — logger-spy test: KHÔNG log call argument nào chứa plaintext/DEK/tag xuyên encrypt/decrypt/error path.
> - **RED + exception-filter test** — decrypt error serialize ra client chỉ chứa message generic.

### (c) Reveal-secret flow — is_sensitive + re-auth + audit MỖI xem/sửa
0. **(2e0 prereq)** `PermissionGuard` đọc `resourceId` từ route param + dựng `ctx:{reauthValidUntil,requestId}` (đọc window từ Valkey/session) → truyền **cả `resourceId` lẫn `ctx`** vào `can()`. KHÔNG có bước này, `resourceId==null` → Tầng-3 object_permissions bị skip (permission.service.ts:55-58) → company-level ALLOW reveal MỌI account (bypass). RED 14 chứng minh Tầng-3 thật sự enforce.
1. Client POST factor (password/2FA) → `POST /platform-accounts/reauth` → `PasswordService.verify` → mint window (TTL ~5 phút) → set `reauthValidUntil`.
   - ⚠️ **Window scope (FIX over-scope):** KHÔNG key window CHỈ theo `userId` (1 lần step-up → reveal mọi account 5 phút = bulk-exfil). Chọn 1 trong: (A) **one-shot/consume-on-use token** cho 1 reveal, hoặc (B) key Valkey theo **`(userId, platform_account_id)`** + cap reveals-per-window. Plan CHỌN (B) (per-account window) + TTL ngắn. RED 7b: re-auth account A KHÔNG authorize reveal account B (cần step-up mới). Mọi reveal trong window VẪN ghi audit riêng.
2. `POST /platform-accounts/:id/reveal` → JwtAuthGuard → CompanyGuard → PermissionGuard (`@RequirePermission('reveal-secret','platform-account',{isSensitive:true, requiresReauth:true})`, **resourceId từ param** sau 2e0) → service.
3. Trong `withTenant(companyId)` (audit + business read CÙNG tx, deny vẫn audit):
   - **Audit-on-attempt/failed-reveal (FIX):** decrypt là CPU op app-side **có thể throw** (sai tag/AAD/tamper). Wrap `decryptSecret` trong try/catch:
     - **Thành công** → ghi `audit_logs` `action='platform_account.secret_revealed'` (KHÔNG secret) cùng tx → trả plaintext.
     - **Thất bại** (tamper/corruption) → **VẪN commit audit row** `action='platform_account.secret_reveal_failed'` (KHÔNG secret, `reason='decrypt_error'`) TRƯỚC khi rethrow generic error. Tamper/corruption reveal trở nên **auditable**.
   - Audit row gồm `objectType='platform_account'`, `objectId`, `actorUserId`, `ip`, `userAgent`; before/after **KHÔNG** chứa secret. RED 4 (deny vẫn audit) + RED mới (tampered ciphertext vẫn tạo audit row).
4. Trả plaintext **một lần**, không cache, không re-list.

**Audit MỖI edit:** create/update secret ghi `platform_account.secret_created`/`secret_updated` (KHÔNG secret trong payload — chỉ actor + ip + "đã đổi"). Edit cần `edit-platform-account` (is_sensitive). Audit-coverage ÉP bằng **RED test** (ca 11), không bởi hook.

### (d) Key rotation + break-glass + reset-token migration + secret lifecycle
- **KMS $0/self-host:** DEV `LocalKekProvider` (KEK 32-byte từ file `.secrets/`, dev-ONLY; ADR-0004 bác KEK-in-env-host cho prod). **PROD:** HashiCorp Vault `transit` (container cùng Compose stack, ARM64, rotation+audit native, KEK không rời Vault). `KmsProvider` interface → dev↔prod là DI swap. Unseal keys/token **off DB host** (infra §3.2).
- **Env (`env.schema.ts`, fail-fast):** `KMS_PROVIDER` ('local'|'vault'), `KMS_VAULT_ADDR`, `KMS_VAULT_TOKEN`, `KMS_LOCAL_KEK_PATH`.
- **Rotation (rẻ vì DEK/record):** rotate KEK ở Vault → mark `encryption_keys` cũ `retiring` → job re-wrap mỗi row: `unwrapDek(old)`→`reWrapDek(new)`→UPDATE `encrypted_dek`/`kms_key_id`/`last_rotated_at` (**ciphertext bytes KHÔNG đổi**). Key cũ → `revoked` sau khi xong. Chạy qua worker (direct pool, ADR-0003), resumable.
  - 🔴 **DECISION A (đã chốt, khớp code 2g):** `dek_key_version` = **seal version BẤT BIẾN** — AAD bind nó nên rotation **KHÔNG đổi** version (đổi = vỡ decrypt của ciphertext giữ nguyên). Rotation chỉ đổi `kms_key_id`/`encrypted_dek`/`last_rotated_at`.
  - ⚠️ **Worker RLS + grant (FIX):** worker connect direct pool KHÔNG set `app.current_company_id`. Nhờ **`platform_accounts_worker_all` policy** (`TO mediaos_worker USING(true)`) worker thấy mọi row; nhờ **column-grant `UPDATE(encrypted_dek,kms_key_id,dek_key_version,last_rotated_at)`** worker re-wrap được mà KHÔNG chạm `secret_ciphertext`/business cols. Không có 2 thứ này, RED 13 (rotation) im lặng fail (0 row / no privilege). ⚠️ Grant gồm `dek_key_version` (migration 0022 đã ship) nhưng rotation **KHÔNG** ghi cột này (DECISION A — seal version bất biến); grant rộng hơn write-set thực tế.
- **Break-glass:** runbook (1) unseal Vault từ shares offline, (2) emergency KEK access có audit bắt buộc, (3) rotate ngay sau. Viết TRƯỚC khi có secret thật (infra §9 Q5).
- **Secret lifecycle / right-to-erasure (FIX):** (1) mọi read path `platform_accounts` lọc `deleted_at IS NULL`. (2) Khi soft-delete account → service hard-DELETE các `channel_accounts` link của nó (tránh orphan-but-live). (3) **Hard-purge job** xóa hẳn row soft-deleted sau retention window + **crypto-shred** (xóa/rotate wrapped DEK) — không giữ ciphertext vô thời hạn. (4) `recovery_email`/`recovery_phone`/`two_factor_note` là PII nhạy lưu plaintext text column → KHÔNG bao giờ xuất hiện trong DTO không-quyền (cùng masking projection như secret); chúng là recovery hint, không phải secret chính, nhưng vẫn mask.
- **Reset-token (🔴 CRITICAL, TASKS:150):** `forgotPassword` hiện ghi **plaintext token vào `outbox_events.payload`** (auth.service.ts:210-216, có comment HARDEN-before-prod). G6-2 phải: (1) `encryptSecret(token, {purpose:'auth_reset_token'})` → lưu CHỈ envelope `payload.resetTokenEnc`; (2) mail consumer `decryptSecret` JIT; (3) seed `encryption_keys` purpose='auth_reset_token' (0028); (4) **one-time scrub (0028 / 2f):** DELETE/re-encrypt mọi `outbox_events` rows `eventType='auth.password_reset_requested'` đang chứa plaintext `resetToken` (chỉ new write được encrypt; plaintext durable cũ phải scrub) — **gate prod cutover vào scrub hoàn tất**.

### (e) Deny-path tests viết TRƯỚC (RED) — TDD, FULL gate (mirror G3-3 viết 52 ca RED trước)
```
[RED 1]  Không grant reveal-secret → 403 'deny-default' + audit row (auditRequired=isSensitive)
[RED 2]  Chỉ wildcard *:* ALLOW → 403 'deny-sensitive' (wildcard KHÔNG thỏa sensitive)
[RED 3]  Exact ALLOW, KHÔNG re-auth window → 403 'deny-reauth-required', requiresReauth:true
[RED 4]  Exact ALLOW, re-auth HẾT HẠN (reauthValidUntil <= now) → 403 'deny-reauth-required' + audit (deny vẫn audit)
[RED 5]  Exact ALLOW + re-auth hợp lệ → 200 plaintext + audit 'secret_revealed' cùng tx
[RED 6]  Cross-tenant: user company A reveal/list platform_accounts company B → 0 row/403 (G2-5 mở rộng, RLS)
[RED 7]  List/detail DTO (response serialize thật) KHÔNG chứa secret_ciphertext/encrypted_dek/iv_nonce/auth_tag/plaintext + KHÔNG recovery_* (mọi role) — masking
[RED 7b] Re-auth account A KHÔNG authorize reveal account B (per-account window scope)
[RED 8]  Tamper ciphertext / sai auth_tag / sai AAD (đổi companyId/id) → throw generic, không trả rác + VẪN ghi audit 'secret_reveal_failed'
[RED 9]  Update/PATCH secret (rotate-secret) → DEK mới + iv_nonce mới + ciphertext khác (CẤM tái dùng DEK); cũng test 2 create khác nonce
[RED 10] Logger-spy: KHÔNG log call nào (encrypt/decrypt/error) chứa secret/DEK/tag (no-leak)
[RED 11] Edit thiếu edit-platform-account (sensitive) → 403; edit thành công → audit 'secret_updated'
[RED 12] Reset-token: outbox payload sau forgotPassword KHÔNG chứa plaintext; có envelope; consumer round-trip đúng; outbox cũ scrub
[RED 13] Rotation (worker): re-wrap đổi encrypted_dek/kms_key_id/last_rotated_at (dek_key_version PIN bất biến — DECISION A); decryptSecret vẫn trả plaintext gốc; ciphertext bytes không đổi; worker thấy row (worker policy)
[RED 14] (Tầng-3 object scope) User có company-level reveal-secret ALLOW nhưng KHÔNG object grant trên account X → 403 (deny object-tier) — chứng minh resourceId được forward & Tầng-3 enforce, KHÔNG bị bypass bởi null-resourceId
```
Coverage ≥80% (ngưỡng cao hơn cho module nhạy cảm — mục tiêu 100% nhánh deny/allow/audit/tamper).

### (f) FULL gate cho G6-2 (diff chạm secret+permission+audit+RLS+migration)
`ecc:security-reviewer` + `ecc:database-reviewer` + `ecc:silent-failure-hunter` + `ecc:santa-method` (crown-jewel, Opus) + `ecc:security-scan`. **Hook tồn tại:** `guard-secrets.mjs` (literal-scanner only — KHÔNG bắt runtime leak), `guard-immutability.mjs`, `anti-bandaid(-guard)`, `format-on-write`, `typecheck-changed`. **Enforcement secret-leak/audit-coverage = RED test (ca 4/7/10/11/14), KHÔNG hook.** Trước merge: `ecc:harness-audit` + `ecc:security-scan`. (Nếu sau này build agent `secret-encryption-reviewer`/`envelope-encryption-auditor` thật trong `.claude/agents/`, thêm vào gate — nhưng KHÔNG phụ thuộc agent chưa tồn tại.)

---

## 7. Rủi ro & giảm thiểu (PHÒNG RỦI RO — phần quan trọng nhất)

| Rủi ro | Khả năng | Tác động | Giảm thiểu |
| --- | --- | --- | --- |
| Quên mở rộng `audit_logs_object_type_chk` trước → INSERT audit 'platform_account'/'channel'/'content' throw | Trung bình (class bug G4-7/G5-0a) | 🔴 cao | Bước **0** TRƯỚC mọi bước; TS const + SQL CHECK đổi cùng commit; test INSERT audit từng object_type |
| reveal-secret rơi xuống type-level (guard không truyền resourceId) → bypass Tầng-3, company-ALLOW reveal MỌI account | Trung bình (guard hiện thiếu) | 🔴 nghiêm trọng | **Bước 2e0** vá guard forward `resourceId`+`ctx`; RED 14 chứng minh deny object-tier |
| FULL gate dựa vào reviewer/hook KHÔNG tồn tại (secret-encryption-reviewer…) | Cao (draft cũ trích) | 🔴 | Dùng tool tồn tại (`ecc:security-reviewer`/`santa-method`/`silent-failure-hunter`/`security-scan`); chuyển kiểm tra leak/audit → RED test 4/7/10/11/14 |
| Secret plaintext lọt DTO/log (crown-jewel) | Trung bình (AI-bulk dễ bỏ) | 🔴 nghiêm trọng | Mask tại query-projection (secret + recovery_* không trong default select); **RED 7 (response serialize) + RED 10 (logger-spy)**; never log. `guard-secrets.mjs` chỉ literal-scan, KHÔNG đủ một mình |
| reveal-secret thỏa bằng wildcard/`manage` (escalation) | Thấp | 🔴 | `isSensitive:true` → exact ALLOW; RED ca 2 'deny-sensitive'; system role KHÔNG seed reveal-secret |
| Thiếu re-auth → reveal không step-up | Thấp | 🔴 | `requiresReauth:true`; guard truyền `reauthValidUntil` vào ctx (2e0); RED ca 3/4 |
| Re-auth window quá rộng (1 step-up → bulk-exfil mọi account 5') | Trung bình | 🔴 | Window per-account `(userId,accountId)` hoặc one-shot; cap reveals/window; RED 7b; mỗi reveal vẫn audit |
| Failed/tampered reveal KHÔNG để lại audit (decrypt throw trước audit) | Trung bình | 🔴 | try/catch quanh decrypt → commit audit 'secret_reveal_failed' trước rethrow; RED 8 |
| Nonce GCM tái dùng dưới cùng DEK (re-encrypt in-place) | Thấp | 🔴 | DEK+nonce mới MỖI write (create+update); CẤM re-encrypt in-place; RED ca 9 (PATCH path); AAD pinned |
| AAD bind id nhưng id do DB-default (chưa biết lúc encrypt) | Trung bình | 🔴 | App-gen `crypto.randomUUID()` trước INSERT, truyền vào encryptSecret; AAD composition pinned §6a; RED 8 (swap companyId fail) |
| pgcrypto-in-SQL thay vì app-side | Thấp | 🔴 | ADR-0004 cấm; `guard-secrets.mjs` + review `ecc:security-reviewer` |
| Reset-token plaintext còn trong outbox khi lên prod | Trung bình | 🔴 | 2f envelope payload + **scrub outbox cũ (0028)**; gate prod cutover vào scrub; RED ca 12 |
| Rò chéo tenant qua bảng G6 mới (thiếu RLS/FORCE) | Thấp (FORCE có) | 🔴 cao | policy `<table>_app_tenant_iso` USING+WITH CHECK + FORCE TRƯỚC backfill; G2-5 2-tenant AFTER MỖI migration |
| Worker (rotation/background) thấy 0 row vì policy lọc company_id=NULL | Trung bình | 🔴 | `<table>_worker_all TO mediaos_worker USING(true)`; column-grant rotation; RED 13 |
| channels.status widen abort vì row 'inactive' (không thuộc tập mới) | Trung bình | 🔴 | UPDATE 'inactive'→'paused' + DO-block guard TRƯỚC ADD CONSTRAINT (0021) |
| Backfill `channels.platform_id` sai → SET NOT NULL abort không chẩn đoán | Thấp | 🟡 | DO-block `RAISE EXCEPTION` đếm NULL rows giữa backfill và SET NOT NULL; giữ cột text cũ cho rollback |
| 0024 FK tới `workflow_templates`/`evaluation_templates` (bảng KHÔNG tồn tại) → migration fail | Cao (draft cũ) | 🔴 | uuid trần KHÔNG FK; defer FK G7/G8 |
| 0025 seed content_types `ON CONFLICT DO NOTHING` không match partial index → error/dup | Cao (draft cũ) | 🔴 | NOT EXISTS guard thay ON CONFLICT; backfill join 1:1 per (company_id,code) |
| 0025 backfill content_type_id để NULL (content_type ngoài map) → orphan content | Trung bình | 🟡 | DO-block GUARD `RAISE EXCEPTION` nếu content_type_id NULL (chưa soft-delete); ELSE map default |
| project_channels/channel_accounts mang status mutable nhưng thiếu GRANT UPDATE | Trung bình (draft cũ) | 🔴 | project_channels: +GRANT UPDATE; channel_accounts: bỏ cột status (pure hard-DELETE) |
| M:N composite unique thiếu company_id (+NULL relation_type defeat unique) | Cao (draft cũ + 0007) | 🔴 | uq dẫn đầu company_id + relation_type NOT NULL (NULL-safe); fix-forward project_channels_uq |
| content_assets one-current uq không loại soft-deleted → chiếm slot, chặn promote | Trung bình (draft cũ) | 🟡 | `WHERE is_current AND deleted_at IS NULL`; service flip is_current=false khi soft-delete current |
| Thiếu company_id index trên channel_accounts/content_channels/content_assets → RLS scan chậm | Cao (draft cũ) | 🟡 | thêm `<table>_company_id_idx` standalone mỗi bảng mới |
| Secret row giữ vô thời hạn sau soft-delete (no erasure) | Thấp | 🟡 | read lọc deleted_at; hard-purge + crypto-shred sau retention; xóa link channel_accounts khi soft-delete account |
| `content_items` đổi content_type→FK làm vỡ contract/FE | Trung bình | 🟡 | Breaking change gom 1 commit (SQL+schema+Zod+FE); backfill+guard content_type_id; regression G4-2 |
| Decrypt/KMS lỗi nuốt im (silent failure) | Thấp | 🔴 | fail-closed; `ecc:silent-failure-hunter` trong gate; không lặp lỗi catch của auth.service.ts |
| Vá triệu chứng thay root-cause | Thấp | 🟡 | giao thức §5 PLAYBOOK; anti-bandaid-guard; regression sau mỗi bước |
| Version asset có >1 current/group | Thấp | 🟡 | partial unique `WHERE is_current AND deleted_at IS NULL`; INSERT + flip cũ trong 1 tx; cấm hard-delete |
| Rollback widen-CHECK abort vì dữ liệu đã ở giá trị mới (channels/content_items) | Trung bình | 🟡 | down-migration backfill map ngược TRƯỚC re-ADD CHECK hẹp (xem §12); DO-block guard down-path |
| Fix lan sang module khác (auth, workflow) | Thấp | 🟡 | nhánh cô lập `feat/g6-media`; regression suite sau mỗi bước; 2f chỉ chạm auth qua interface |

---

## 8. Test plan

### Deny-path RED (G6-2 — TRƯỚC khi implement; chi tiết §6e ca 1–14)
```
[RED] reveal-secret không grant → 403 deny-default + audit
[RED] wildcard *:* → 403 deny-sensitive
[RED] không/het re-auth → 403 deny-reauth-required (KHÔNG decrypt) + deny vẫn audit
[RED] exact ALLOW + re-auth hợp lệ → 200 + audit secret_revealed cùng tx
[RED] company-level ALLOW nhưng KHÔNG object grant trên account X → 403 deny object-tier (Tầng-3 enforce, ca 14)
[RED] re-auth account A KHÔNG cho reveal account B (per-account window, ca 7b)
[RED] cross-tenant reveal/list company B → 0 row/403
[RED] list/detail DTO (serialize thật) KHÔNG có secret_ciphertext/encrypted_dek/iv_nonce/auth_tag/plaintext + KHÔNG recovery_* (mọi role)
[RED] tamper tag/AAD → throw generic + VẪN audit 'secret_reveal_failed'; nonce unique/record (create+PATCH); logger-spy no-leak
[RED] edit thiếu edit-platform-account → 403; edit OK → audit secret_updated
[RED] reset-token outbox KHÔNG plaintext + consumer round-trip + scrub outbox cũ
[RED] rotation re-wrap đổi DEK wrap, plaintext không đổi, worker thấy row
```

### Happy-path (LIGHT)
```
[ ] GET /channels?platform=youtube&status=active&managerId=… → filter đúng
[ ] POST /channels → tạo + platform_id FK + audit 'channel'
[ ] POST /channels/:id/members → assign channel_manager
[ ] GET /channels/:id → detail + members + health
[ ] POST /projects + attach nhiều kênh/team/member; 1 kênh ∈ nhiều project; PATCH project_channel status
[ ] POST /content + content_type_id + suggest-workflow trả default_workflow_template_id
[ ] POST /content/:id/channels (đa kênh) → mỗi kênh publish_status/url/lịch riêng
[ ] POST /content/:id/assets + POST version → is_current flip, 1 current/group; soft-delete current flip is_current
[ ] PATCH /channels/:id/health → health_status=risk → list "kênh cần chú ý" hiện
```

### Regression (BẮT BUỘC)
```
[ ] G2-5 2-tenant isolation: chạy lại AFTER MỖI migration 0021/0022/0023/0025/0026 (per-migration CI gate, KHÔNG gộp cuối)
    — lý do: mỗi migration tạo/ALTER bảng RLS; lỗi FORCE/grant giữa chừng có thể bị migration sau che lấp.
[ ] G4-2 media regression: channels/projects/content list + create cũ KHÔNG vỡ sau ALTER
    (đặc biệt content_items đổi content_type→FK: endpoint createContent cũ vẫn chạy) — chạy sau 0021/0023/0025
[ ] G3 permission engine: deny-sensitive/deny-reauth-required/deny-default(object) reason không đổi
[ ] auth reset-password flow vẫn hoạt động sau di trú envelope (2f) — gửi mail + verify token
[ ] Tổng test suite xanh trước merge
```

### Coverage mục tiêu
- Unit/integration ≥80% cho `MediaService`/`PlatformAccountModule`/`ContentModule`.
- **Riêng G6-2 (crypto + reveal-secret + reset-token): 100%** mọi nhánh deny/allow/audit/tamper/object-tier.

---

## 9. API Endpoints tổng hợp

```
# Platforms (catalog global, read-only)
GET    /api/v1/platforms

# Channels (mở rộng)
GET    /api/v1/channels                 (filter: platform, status, managerId, niche, q)
POST   /api/v1/channels
GET    /api/v1/channels/:id
PATCH  /api/v1/channels/:id
DELETE /api/v1/channels/:id             (soft-delete)
PATCH  /api/v1/channels/:id/health      (G6-5: health_status, health_score, riskNote)
GET    /api/v1/channels/:id/members
POST   /api/v1/channels/:id/members
PATCH  /api/v1/channels/:id/members/:memberId
DELETE /api/v1/channels/:id/members/:memberId

# Platform Accounts (🔒 G6-2 crown-jewel)
GET    /api/v1/platform-accounts                  (mask: KHÔNG secret + KHÔNG recovery_* trong DTO; deleted_at IS NULL)
POST   /api/v1/platform-accounts                  (app-gen id; encrypt app-side; audit secret_created)
GET    /api/v1/platform-accounts/:id              (masked)
PATCH  /api/v1/platform-accounts/:id              (edit-platform-account sensitive; DEK mới; audit secret_updated)
DELETE /api/v1/platform-accounts/:id              (soft-delete + hard-DELETE channel_accounts link)
POST   /api/v1/platform-accounts/reauth           (step-up: password/2FA → mint reauthValidUntil per-account)
POST   /api/v1/platform-accounts/:id/reveal       (reveal-secret + re-auth + Tầng-3 + audit revealed/reveal_failed)
POST   /api/v1/channels/:id/accounts              (channel_accounts link, relation_type)
DELETE /api/v1/channels/:id/accounts/:accountId   (hard DELETE link)

# Projects (mở rộng + M:N)
GET    /api/v1/projects                 (filter: type, status, channel, managerId)
POST   /api/v1/projects
GET    /api/v1/projects/:id
PATCH  /api/v1/projects/:id
DELETE /api/v1/projects/:id             (soft-delete)
POST   /api/v1/projects/:id/channels    · PATCH …/channels/:channelId (status/role) · DELETE …/channels/:channelId (hard DELETE)
POST   /api/v1/projects/:id/teams       · DELETE …/teams/:teamId         (hard DELETE)
POST   /api/v1/projects/:id/members     · PATCH/DELETE …/members/:userId (soft-delete)

# Content Types
GET/POST/PATCH/DELETE /api/v1/content-types
GET    /api/v1/content-types/:id/suggest-workflow   (đọc default_workflow_template_id — id only, instance G7)

# Content (mở rộng + đa kênh + asset/version)
GET    /api/v1/content                  (filter: type, productionStatus, channel, project, owner)
POST   /api/v1/projects/:id/content     (giữ tương thích G4-2) + POST /api/v1/content
GET    /api/v1/content/:id
PATCH  /api/v1/content/:id
DELETE /api/v1/content/:id              (soft-delete)
GET/POST /api/v1/content/:id/channels   · PATCH/DELETE …/channels/:ccId   (multi-publish)
POST   /api/v1/content/:id/assets/:assetId/versions   (INSERT + flip is_current 1 tx)
DELETE /api/v1/content/:id/assets/:assetId            (soft-delete + flip is_current nếu là current, KHÔNG hard-delete version)
```

---

## 10. FE Pages & Components

```
/channels
  → ChannelTable (TanStack Table v8) + ChannelFilterBar (platform/status/manager/niche)
  → ChannelHealthBadge + CreateChannelDialog + ImportChannelsDialog
/channels/$channelId  (tab shell shadcn <Tabs>)
  → ChannelOverviewTab · ChannelAccountsTab(🔒) · ChannelProjectsTab · ChannelContentTab
  → ChannelHealthTab (HealthScoreCard + Recharts trend) · ChannelMembersTab (AddChannelMemberDialog)
  → ChannelAuditLogTab (gate access-audit-log)

# 🔒 ChannelAccountsTab (G6-2 — crown-jewel UX, gate mọi phần)
  → PlatformAccountCard (grouped by relation_type)
  → SecretField (masked ••• + reveal eye, wraps useRevealSecret)
  → ReAuthModal (step-up password/2FA → short-lived per-account reveal window; KHÔNG cache plaintext)
  → RequestAccessButton (visibility level 3) · EditPlatformAccountDialog (gate edit-platform-account)
  → AccountAccessLogTable (audit các lần reveal + reveal_failed)
  * Masked-by-default: secret + recovery_* do SERVER ẩn — DTO role không quyền KHÔNG chứa; client render •••
  * Employee/Freelancer: tab ẩn hoàn toàn (<PermissionGate>)

/projects
  → ProjectTable + ProjectFilterBar (project_type) + CreateProjectDialog
/projects/$projectId  (tabs)
  → ProjectOverviewTab · ProjectChannelsTab (AttachChannelDialog + role/status PATCH)
  → ProjectTeamsTab (ProjectTeamList + ProjectMemberList + workload bar + AddMemberDialog)
  → ProjectContentTab

/content  → ContentListPage (ContentTable + ContentFilterBar)
/content/$contentId  (tabs)
  → ContentOverviewTab · ContentWorkflowTimeline (suggestion only)
  → PublishTargetsTab (PublishTargetsTable + AddPublishChannelDialog — per-channel status/url/lịch)
  → AssetManagerTab (AssetTypeSection grouped + AssetVersionHistory + UploadAssetDialog + AssetPreviewModal)
  → ContentReviewTab · ContentSeoTab

# CreateContentDialog: ContentTypeSelect.onChange → mediaApi.suggestWorkflow(typeId)
#   → pre-fill WorkflowTemplateSelect (editable; instance thật ở G7)

# Dashboard: widget "Kênh rủi ro" (G6-5 feed — health_status risk/declining)

# Route mới (router.tsx, mỗi route beforeLoad: authGuard):
#   /channels/$channelId · /content · /content/$contentId
#   (/channels · /projects · /projects/$projectId nâng cấp tại chỗ)
# Mọi phần nhạy cảm: <PermissionGate action resourceType> + useCan(); scope-aware (kênh phụ trách/assigned).
```

---

## 11. Commit & merge

- Nhánh: `feat/g6-media`
- Micro-commit theo từng bước mục 5: `feat(g6-0): audit object types`, `feat(g6-1a): platforms+channels`, `feat(g6-2e0): guard resourceId+ctx`, `feat(g6-2e): reveal-secret`…
- Điều kiện merge:
  - Migration xanh (CI apply + rollback) cho 0020–0028 (mọi DO-block guard pass).
  - LIGHT gate PASS cho G6-1/3/4/5 (CRUD/UI).
  - **FULL gate PASS cho G6-2** (0022/0027/0028 + 2e0 guard + crypto + reveal-secret) + 0020/0021/0023/0025/0026 (migration chạm RLS/audit/data).
  - 14 ca RED G6-2 → GREEN; **G2-5 2-tenant regression xanh AFTER MỖI migration 0021/0022/0023/0025/0026**; G4-2 media regression xanh; auth reset flow xanh; outbox scrub hoàn tất trước prod cutover.
  - Tổng test suite xanh + `completion-evaluator` PASS.

---

## 12. Rollback (thứ tự DROP đúng FK)

> **Rollback chạy STRICT newest→oldest (0028 → 0020)** để dependent của `platforms` FK (0022 channel_accounts/platform_accounts) bị gỡ TRƯỚC khi 0021 drop `platforms`. DROP theo thứ tự NGƯỢC dependency trong từng migration. **Mọi down-path widen-CHECK PHẢI backfill map ngược về giá trị hợp lệ cũ TRƯỚC khi re-ADD CHECK hẹp** (kèm DO-block guard), nếu không re-ADD abort. Reset-token (2f) revert bằng feature-flag `RESET_TOKEN_ENVELOPE` về plaintext-outbox cũ (chỉ DEV) — KHÔNG revert nếu đã có token thật.

- **0028** (seed reset-token key + scrub): DELETE row `encryption_keys WHERE purpose='auth_reset_token'`. (Scrub plaintext outbox KHÔNG revert — không phục hồi plaintext.)
- **0027** (permissions seed): DELETE `role_permissions` G6 + `permissions WHERE resource_type IN ('channel-member','project-team','project-member','content-type','content-channel','content-asset','content-version')` + `edit-platform-account`. (Không xóa `reveal-secret`/channel/project/content — thuộc 0005.)
- **0026**: DROP `content_assets` → DROP `content_channels`.
- **0025** (ALTER content_items): re-ADD cột text `content_type`; **backfill ngược** `content_type` từ `content_type_id` (map `content_types.code` → {video_long→'video', youtube_short→'short', social_post→'reel'}); **rows có content_type_id trỏ tới content type code KHÁC (user-tạo) → map về 'video' (default hợp lệ) hoặc NULL** (tránh vi phạm CHECK hẹp); DO-block guard không còn giá trị ngoài {video,short,reel}; rồi re-ADD CHECK `('video','short','reel')`; DROP cột mới + `content_type_id`. (Reversible nhưng mất production_status mịn + content type user-tạo → flag.)
- **0024**: DROP `content_types` (sau khi 0025 đã bỏ FK content_type_id).
- **0023**: DROP `project_members` → DROP `project_teams` → ALTER `project_channels` DROP (role_in_project,status) + REVOKE UPDATE + restore uq cũ (nếu cần) → ALTER `projects` DROP cột mới.
- **0022** (crown-jewel): DROP `channel_accounts` → DROP `platform_accounts` (worker policy + column-grant tự mất theo) → DROP `encryption_keys`. (Mất secret đã mã hóa — chỉ rollback khi CHƯA có secret thật.)
- **0021**: DROP `channel_members` → ALTER `channels` DROP cột mới → **backfill ngược status** (`UPDATE channels SET status='inactive' WHERE status IN ('paused','testing','stopped','archived')` — quyết định map về 'inactive') + DO-block guard ⊂ {active,inactive} → re-ADD CHECK status cũ `('active','inactive')` → DROP `platforms` (sau khi channels.platform_id đã drop; sau khi 0022 đã gỡ — đảm bảo bởi thứ tự newest→oldest).
- **0020** (audit CHECK): DROP+ADD CONSTRAINT về list 12 cũ (G5) — chỉ khi KHÔNG còn audit row dùng object_type G6.
- Feature-flag: G6 endpoint mới không phá luồng G4-2; riêng `content_items` content_type→FK là điểm không reversible mềm → gắn flag `CONTENT_TYPE_FK` cho FE chuyển đổi.

---

## ✅ Kết quả rà soát plan (`plan-reviewer`)

**VERDICT: PASS** — 2026-06-06 (rà soát đối kháng độc lập, verify từng claim load-bearing chống lại repo). **KHÔNG còn rủi ro BLOCKING.** Mọi cạm bẫy cổ điển đã được nhận diện & xử lý đúng, không bịa số liệu repo:
- Guard bypass Tầng-3 (§6c/2e0) là phát hiện THẬT — verify `permission.guard.ts:73-80` gọi `can()` không truyền `resourceId`/`ctx`; `permission.service.ts:55-58` skip object-tier khi `resourceId == null`. Bước 2e0 đặt TRƯỚC 2e (mở reveal) đúng thứ tự.
- Migration 0020–0028 liền mạch (latest thực = 0019, Glob xác nhận); ALTER không CREATE-đè bảng G4; audit CHECK G6-0 byte-identical 0014 + 11 type G6; channels status widen có guard 'inactive'→'paused'; `project_channels_uq` fix-forward thêm company_id; worker-policy mirror 0003:60-67; số role/UUID 0005(…001–008)/0019(…009 hr-manager) + reveal-secret is_sensitive=TRUE đều đúng; `content_types` template id = uuid trần (không FK tới bảng chưa tồn tại).

### 🔧 5 cảnh báo + quyết định vá (ÁP DỤNG TRƯỚC/ TRONG KHI CODE — không blocking nhưng bắt buộc theo dõi)

1. **[silent-failure · HIGH — fold vào bước 2e0 + RED]** Nếu route reveal đặt sai tên param (vd `:accountId` vs `:id`), guard đọc `resourceId = undefined` → âm thầm rơi về type-level (bypass Tầng-3) **mà không báo lỗi**. → **Bắt buộc:** trong 2e0, khi `@RequirePermission` có `requiresReauth/isSensitive=true` mà guard KHÔNG resolve được `resourceId` từ param → **fail-closed 403 + log** (cấm fallback im lặng type-level). Thêm **RED ca 14b**: sensitive action thiếu resourceId resolvable → 403, không phải allow. Chạy `silent-failure-hunter` cho guard.
2. **[regression integrity · HIGH — thêm micro-step]** G2-5 "xanh" sẽ là **xanh giả** nếu harness data-driven chưa cover bảng G6 mới. → **Thêm bước 1a-bis (sau 0a, 🔴):** mở rộng `test/integration/rls-registry.ts` thêm ~10 bảng G6 (`channel_members`, `platform_accounts`, `channel_accounts`, `project_teams`, `project_members`, `content_types`, `content_channels`, `content_assets`, + ALTER targets) với `idColumn`/`skipNoContext` — mirror cách G4-7 thêm 22 bảng (TASKS L180). KHÔNG tuyên bố G2-5 xanh trước khi harness phủ đủ.
3. **[append-only clarity · LOW — ghi chú 0020]** `0020` chạy `ALTER … DROP/ADD CONSTRAINT audit_logs` qua **migration role (`DATABASE_DIRECT_URL`)**, KHÔNG qua `mediaos_app` (chỉ có `GRANT SELECT, INSERT` 0003:35). Append-only áp cho *app-role DML*, không phải migration DDL — tiền lệ 0011/0014 y hệt. → Thêm 1 dòng vào §4 G6-0 để completion-evaluator không nhầm vi phạm bất biến #2.
4. **[thứ tự 2 trục · LOW — ghi chú §5]** Số migration ≠ thứ tự bước build: `0027` (seed `edit-platform-account`) nằm sau 0022–0026 trên đĩa, nhưng **bước 2d phải áp trước 2e0/2e** (permission phải tồn tại trước khi test guard/reveal). → Thêm câu làm rõ ở §5.
5. **[rollback an toàn · LOW — ghi chú §12]** Down-path `0025` mất `production_status` mịn + content-type user-tạo (map về 'video'). → Gắn cảnh báo cứng: **KHÔNG rollback 0025 trên môi trường đã có content user-tạo ngoài {video,short,reel}** (tương tự cảnh báo secret 0022).

### ❓ Open-verify (FULL gate 2a/2c xử lý — không blocking)
- **8 cột envelope** `platform_accounts` đối chiếu byte-for-byte với `erd-v2.md §2.1` (reviewer không có đường dẫn erd-v2 trong context bắt buộc; plan nội bộ nhất quán 8 cột). Xác nhận tại FULL gate migration 0022.
- **ADR-0004 lệch tooling:** ADR liệt kê `secret-encryption-reviewer` / `envelope-encryption-auditor` / `sensitive-action-audit-hook` là thành phần CẦN, nhưng **chưa tồn tại** trong `.claude/`. Plan thay bằng RED test + reviewer hiện có (trung thực). → TODO: hoặc tạo `secret-encryption-reviewer` thật, hoặc cập nhật "Hệ quả" ADR-0004 cho khớp repo (tránh completion-evaluator chấm thiếu).
- `view-salary` tồn tại trên cả `payslip` (0005:286) **và** `employee` (0019:24) — verify đúng; analogy reveal-secret hợp lệ.
- `0027` blanket grant `is_sensitive=false` cho company-admin phủ `read/update/manage` `platform-account` (metadata, KHÔNG secret) — đúng intent; RED ca 7 chạy CẢ với company-admin để chắc metadata-blanket không kéo theo cột secret.

> **Hành động:** fix #1 và #2 (HIGH) đã ghi vào §4/§5/§6e bên dưới như bước bắt buộc; #3/#4/#5 là ghi chú đã nêu. Plan đủ điều kiện bắt đầu code từ **0a (0020 audit) → 1a-bis (mở rộng harness) → G6-1**.

## 🏁 Kết quả đánh giá hoàn thành (`completion-evaluator`)

_(điền khi đóng phase: điểm rubric + PASS/BLOCK + việc còn nợ.)_
