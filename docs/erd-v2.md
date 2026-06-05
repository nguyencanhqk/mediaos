# ERD v2 — PATCH cho DATABASE ERD MVP v1

> **Mục đích:** [`DATABASE ERD — MVP v1`](../DATABASE%20ERD%20—%20MVP%20v1.md) là nền tốt, nhưng **thiếu các bảng/cột bắt buộc để thực thi chính 3 bất biến và các ADR**. File này là **bản vá bổ sung** — chỉ ghi phần THÊM/SỬA, không lặp lại toàn bộ ERD gốc.
>
> **Quy ước:** SQL ở đây là pseudo-DDL minh hoạ ý đồ; DDL thật sinh bằng Drizzle ở G1-3. Mọi bảng nghiệp vụ đều ngầm có `company_id NOT NULL` + **FORCE RLS** trừ khi ghi rõ là bảng global.

---

## 0. Tóm tắt các lỗ hổng được vá

| # | Lỗ hổng trong ERD gốc | Bất biến/ADR vi phạm | Cách vá |
| --- | --- | --- | --- |
| 1 | **Không có Outbox/Event/Idempotency** | ADR 0009, CLAUDE.md mục 3, G2-4 | §1 — thêm 3 bảng |
| 2 | **Envelope encryption không đủ cột** (chỉ `encrypted_password`) | ADR 0004, Bất biến #3, G5e | §2 — thêm cột metadata + bảng key |
| 3 | **Append-only không được biểu diễn** (ERD §1.3 lại nói "hầu hết bảng có deleted_at") | Bất biến #2, ADR 0005 | §3 — danh sách append-only + cột supersede |
| 4 | **Không biểu diễn được DENY** | Matrix §10 quy tắc #1, G3-2 | §4 — cột `effect` + bảng deny |
| 5 | **Lock chỉ là JSON, không query được** | G0-3, G5a, BR-006 | §5 — bảng `workflow_step_instance_locks` |
| 6 | **Không khẳng định RLS/NOT NULL** | Bất biến #1, G2-3 | §6 — chuẩn cột tenant |
| 7 | **JSON blob không versioned** | Tối ưu data | §7 — quy ước `*_json` + `schema_version` |
| 8 | **Trạng thái duyệt ở 3 nơi** (step / approval / defect) | ADR 0016, G3/G4-5 | §8 — `approval_requests` là nguồn sự thật, step là projection |
| 9 | **Polymorphic FK tràn lan** (`*_type`/`*_id`) phá toàn vẹn tham chiếu | Toàn vẹn dữ liệu | §9 — quan hệ nóng → FK thật + CHECK; audit/noti giữ polymorphic + CHECK enum |
| 10 | **Soft-delete xung đột UNIQUE** | Bất biến #2, vận hành | §10 — partial unique index `WHERE deleted_at IS NULL` |
| 11 | **Asset không có version chain** (chỉ số `version` rời) | Luồng revision | §11 — `version_group_id` + `parent_asset_id` + `is_current` |

---

## 1. 🔴 Outbox + Event Bus + Idempotency (BẮT BUỘC trước mọi module — G2-4)

> Auto-task, auto-group-chat, notification, audit dispatch đều dựa vào cơ chế này. Ghi DB + outbox trong **CÙNG transaction** → worker đọc outbox → publish → consumer xử lý idempotent.

### 1.1. `outbox_events` (append-only)

```sql
outbox_events
- id              UUID PK
- company_id      UUID NOT NULL          -- vẫn gắn tenant để trace/RLS
- aggregate_type  TEXT NOT NULL          -- 'content_item' | 'task' | 'approval' ...
- aggregate_id    UUID NOT NULL
- event_type      TEXT NOT NULL          -- 'task.created' | 'step.approved' ...
- payload_json    JSONB NOT NULL
- schema_version  INT  NOT NULL DEFAULT 1
- status          TEXT NOT NULL DEFAULT 'pending'  -- pending|published|failed
- retry_count     INT  NOT NULL DEFAULT 0
- available_at    TIMESTAMPTZ NOT NULL   -- để backoff
- published_at    TIMESTAMPTZ
- created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
-- KHÔNG có updated_by/deleted_at: append-only (chỉ update status/retry qua worker)
```
Index: `(status, available_at)`, `(company_id, aggregate_type, aggregate_id)`.

### 1.2. `processed_events` (chống xử lý trùng — idempotency)

```sql
processed_events
- id               UUID PK
- consumer_name    TEXT NOT NULL          -- 'notification' | 'autotask' | 'chat'
- event_id         UUID NOT NULL          -- = outbox_events.id
- processed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
- UNIQUE (consumer_name, event_id)        -- mỗi consumer xử lý 1 event đúng 1 lần
```

### 1.3. `dead_letter_events` (sự kiện hỏng — Alerting GX/G2-4)

```sql
dead_letter_events
- id            UUID PK
- company_id    UUID
- event_id      UUID NOT NULL
- consumer_name TEXT NOT NULL
- error_text    TEXT NOT NULL
- payload_json  JSONB NOT NULL
- created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
- resolved_at   TIMESTAMPTZ            -- null = chưa xử lý → cảnh báo
```

> ⚠️ Yêu cầu vận hành: có **alert khi dead_letter_events có row chưa resolved** (lỗ hổng "Alerting runtime" trong TASKS.md).

---

## 2. 🔴 Envelope Encryption cho `platform_accounts` (ADR 0004 — G5e)

ERD gốc chỉ có `encrypted_password`. Envelope encryption + rotation cần metadata. **Thay thế** cột đó bằng nhóm cột sau:

### 2.1. Sửa bảng `platform_accounts`

```sql
-- BỎ: encrypted_password
-- THÊM:
- secret_ciphertext   BYTEA NOT NULL     -- mật khẩu đã mã hóa bằng DEK
- encrypted_dek       BYTEA NOT NULL     -- DEK đã được KMS/KEK bọc (wrapped)
- dek_key_version     INT  NOT NULL      -- để rotation
- kms_key_id          TEXT NOT NULL      -- định danh KEK ở KMS/Vault
- iv_nonce            BYTEA NOT NULL     -- IV/nonce cho AEAD
- auth_tag            BYTEA NOT NULL     -- GCM/AEAD auth tag
- enc_algo            TEXT NOT NULL DEFAULT 'AES-256-GCM'
- last_rotated_at     TIMESTAMPTZ
```

### 2.2. `encryption_keys` (theo dõi KEK/rotation — global hoặc per-company)

```sql
encryption_keys
- id            UUID PK
- key_version   INT  NOT NULL
- kms_key_id    TEXT NOT NULL
- purpose       TEXT NOT NULL         -- 'platform_account' | ...
- status        TEXT NOT NULL         -- active | retiring | revoked
- created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
- retired_at    TIMESTAMPTZ
- UNIQUE (purpose, key_version)
```

Nguyên tắc: mã hóa **phía app**, KHÔNG pgcrypto-in-SQL; mọi lần `reveal-secret` → re-auth + ghi `audit_logs`.

---

## 3. 🔴 Bảng APPEND-ONLY / SNAPSHOT bất biến (Bất biến #2 — ADR 0005)

> Sửa mâu thuẫn: ERD §1.3 nói "hầu hết bảng có `deleted_at`". Các bảng dưới đây **KHÔNG** có `deleted_at`, **app role không có quyền UPDATE/DELETE** (chỉ INSERT). Sửa = tạo bản ghi mới supersede.

### 3.1. Danh sách bảng append-only

```text
audit_logs           -- thuần INSERT
outbox_events        -- chỉ worker đổi status (qua role riêng), app chỉ INSERT
payslips             -- snapshot lương
payslip_items
kpi_results          -- snapshot KPI đã khóa kỳ
profit_snapshots
revenue_records      -- sửa = ghi bản điều chỉnh mới, không UPDATE row cũ
cost_records
```

### 3.2. Cột supersede cho snapshot (thay cho UPDATE)

Thêm vào các bảng snapshot (`payslips`, `kpi_results`, `profit_snapshots`):

```sql
- version        INT  NOT NULL DEFAULT 1
- superseded_by  UUID            -- trỏ tới bản ghi mới thay thế (null = bản hiện hành)
- is_current     BOOLEAN NOT NULL DEFAULT true
```

> Thực thi ở tầng DB: GRANT cho app role **chỉ SELECT, INSERT** trên các bảng này; **không** UPDATE/DELETE. Worker/job dùng role riêng nếu cần đổi `status`/`locked_at`.

---

## 4. 🔴 Biểu diễn DENY rõ ràng (Matrix §10 quy tắc #1 — G3-2)

ERD gốc không thể biểu diễn "quyền bị cấm có ưu tiên cao nhất". Vá:

### 4.1. Thêm cột `effect` vào `role_permissions` và `object_permissions`

```sql
- effect   TEXT NOT NULL DEFAULT 'allow'   -- 'allow' | 'deny'
```

### 4.2. Thuật toán `can()` (đặc tả chi tiết ở G0-4)

```text
1. Nếu có bất kỳ DENY khớp (role/object) → DENY  (ưu tiên cao nhất)
2. Quyền nhạy cảm (sensitive) phải có ALLOW cấp riêng — KHÔNG kế thừa từ role thường
3. Kiểm tra scope (company/org_unit/team/project/channel/own) khớp
4. Nếu có ALLOW khớp scope → ALLOW
5. Mặc định → DENY (deny-by-default)
6. Mọi quyết định trên dữ liệu nhạy cảm → ghi audit
```

> Danh sách deny-case cụ thể → tạo ở **G0-4** (`permission-matrix-spec`), dùng làm test RED trước (G3-3).

---

## 5. 🟠 Lock workflow query được (G0-3, BR-006)

ERD gốc chỉ có `workflow_step_instances.locked_reason` + `defects.locked_scope_json`. JSON không query được "bước nào đang bị khóa vì defect nào". Vá:

```sql
workflow_step_instance_locks
- id                        UUID PK
- company_id                UUID NOT NULL
- workflow_instance_id      UUID NOT NULL
- locked_step_instance_id   UUID NOT NULL   -- bước bị khóa
- caused_by_defect_id       UUID            -- vì defect nào
- caused_by_step_instance_id UUID           -- lỗi bắt nguồn từ bước nào
- lock_reason               TEXT NOT NULL
- locked_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
- released_at               TIMESTAMPTZ     -- null = đang khóa
```
Index: `(company_id, workflow_instance_id, released_at)`.

> MVP-0 (workflow tuần tự) chỉ cần khóa "bước sau bước lỗi". Lock-propagation đa nhánh (lỗi nhân vật → khóa mọi cảnh) → thiết kế ở **G0-3**, dùng ở **G5a**.

---

## 6. 🟠 Chuẩn cột tenant + RLS (Bất biến #1 — G2-3)

Khẳng định cho **mọi bảng nghiệp vụ**:

```sql
- company_id UUID NOT NULL                        -- KHÔNG nullable
-- + RLS policy:
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE ROW LEVEL SECURITY;          -- ép cả owner
CREATE POLICY tenant_isolation ON <t>
  USING (company_id = current_setting('app.current_company_id')::uuid);
```

- App DB role: **non-superuser, KHÔNG BYPASSRLS, KHÔNG owner bảng** (G2-1).
- Mọi truy cập qua `withTenant(companyId, fn)` → `set_config('app.current_company_id', $1, true)` (local=true, trong cùng transaction — bắt buộc với PgBouncer transaction-mode).
- **Thứ tự migration (GX-4):** tạo policy + FORCE RLS **TRƯỚC** khi backfill `company_id` — nếu không có cửa sổ rò chéo tenant. Assert trong CI.

---

## 7. 🟡 Quy ước JSON column (giảm rủi ro blob)

Mọi cột `*_json` (`formula_json`, `condition_json`, `payload_json`, `location_json`, `working_days_json`, `default_channels_json`) phải:

1. Có **Zod schema** tương ứng trong `packages/contracts`.
2. Có cột đồng hành `schema_version INT` (hoặc field `version` trong JSON).
3. Validate khi ghi (boundary validation) — không tin dữ liệu JSON tự do.

---

## 8. 🔴 Approval — một nguồn sự thật (ADR 0016 — G3/G4-5)

> Vá mâu thuẫn: trạng thái duyệt đang nằm ở 3 nơi (`workflow_step_instances`, `approval_requests`, `defects`). Chốt: **`approval_requests` + `approval_steps` là nguồn sự thật DUY NHẤT**; step chỉ là **projection** cập nhật qua event. Chi tiết & lý do: [ADR 0016](../adr/0016-approval-single-source-of-truth.md).

### 8.1. Quy tắc ghi trạng thái

```text
Ghi quyết định:   approval_steps.decision  (approved | revision_requested | rejected ...)
       ↓ (cùng tx)
Cập nhật:         approval_requests.status + current_level
       ↓ emit qua OUTBOX (ADR 0009) — 'approval.completed'
Consumer (idempotent qua processed_events):
       → UPDATE workflow_step_instances.status / approved_at   ← CHỈ consumer được ghi
       → nếu revision_requested: INSERT defects (gắn step lỗi + responsible_user_id)
```

- **MVP-0 (G4-5) duyệt 1 cấp vẫn đi qua `approval_requests`** (`max_level = 1`, đúng 1 `approval_steps`). Không có đường tắt ghi thẳng `step.status='approved'`.
- `workflow_step_instances.reviewer_user_id` = "người **nên** duyệt" (định tuyến). Người **thực sự** quyết = `approval_steps.approver_user_id` + `decided_at`. `step.approved_at` chỉ là gương soi.
- `defects` = **chi tiết của một quyết định `revision_requested`**, KHÔNG phải kênh duyệt song song.

### 8.2. Hệ quả ràng buộc (đưa vào FULL gate)

- ❌ Cấm `UPDATE workflow_step_instances SET status='approved'` trong service nghiệp vụ — chỉ consumer event được làm.
- `approval_requests` nhắm mục tiêu bằng **FK thật** (`workflow_step_instance_id` / `task_id`) — bỏ dùng `target_type/target_id` (xem §9).

---

## 9. 🟠 Polymorphic FK → FK thật cho quan hệ nóng (toàn vẹn tham chiếu)

> Postgres không enforce FK trên cột polymorphic (`*_type` + `*_id`) → dễ orphan/rác. Vá theo 2 nhóm.

### 9.1. NHÓM NÓNG — đổi sang FK thật nullable + CHECK "đúng một"

Các bảng cần toàn vẹn tham chiếu mạnh. **Bỏ** cặp `target_type/target_id`, dùng FK thật đã có sẵn + CHECK đảm bảo đúng một mục tiêu được set:

| Bảng | Bỏ | Dùng FK thật (nullable) | Ràng buộc |
| --- | --- | --- | --- |
| `approval_requests` | `target_type`, `target_id` | `workflow_step_instance_id`, `task_id` (đã có) | CHECK đúng 1 trong 2 NOT NULL |
| `workflow_instances` | `target_type`, `target_id` | `project_id`, `content_item_id` (đã có); +`expense_request_id`, `leave_request_id`, `meeting_id` (G5) | CHECK đúng 1 NOT NULL |
| `cost_allocations` (G5g) | `allocation_target_type`, `allocation_target_id` | `channel_id`, `project_id`, `content_item_id` | CHECK đúng 1 NOT NULL |

```sql
-- ví dụ approval_requests (MVP-0 chỉ cần 2 nhánh)
ALTER TABLE approval_requests
  ADD CONSTRAINT approval_target_exactly_one CHECK (
    (workflow_step_instance_id IS NOT NULL)::int
  + (task_id IS NOT NULL)::int = 1
  );
```

> `tasks` và `defects` **đã** dùng FK thật (`content_item_id`, `project_id`, `workflow_step_instance_id`…) — không cần sửa.

### 9.2. NHÓM LINH HOẠT — giữ polymorphic, nhưng có lưới an toàn

`audit_logs` (`object_type/object_id`), `notifications` (`related_type/related_id`), `object_permissions` (`object_type/object_id`): tính linh hoạt > toàn vẹn ⇒ **giữ polymorphic**, nhưng bắt buộc:

1. **CHECK constraint** validate `*_type` thuộc enum cho phép (chống gõ sai/typo loại).
2. **Composite index** `(<type>, <id>)` + có `company_id` ở đầu cho RLS.
3. **Cron dọn orphan** định kỳ (vì không có FK) — chỉ với audit/notification (không xóa audit thật, chỉ đánh dấu/cảnh báo orphan).

```sql
ALTER TABLE notifications
  ADD CONSTRAINT notif_related_type_enum CHECK (
    related_type IN ('task','approval_request','workflow_step_instance',
                     'content_item','project','defect','payslip')
  );
CREATE INDEX ON notifications (company_id, related_type, related_id);
```

---

## 10. 🟡 Partial unique index cho soft-delete (Bất biến #2 — vận hành)

> `deleted_at` + `UNIQUE(col)` xung đột: xóa mềm rồi tạo lại trùng `email`/`code` sẽ FAIL. Quy tắc DB bắt buộc: **mọi UNIQUE trên bảng có `deleted_at` phải là partial index `WHERE deleted_at IS NULL`**.

```sql
-- SAI:  UNIQUE (company_id, email)
-- ĐÚNG:
CREATE UNIQUE INDEX users_email_active_uq
  ON users (company_id, email) WHERE deleted_at IS NULL;
```

Áp cho (không giới hạn): `users(company_id, email)`, `channels(company_id, code)`, `projects(company_id, code)`, `roles(company_id, code)`, `permissions(code)`, `departments/teams(company_id, code)`.

- Bảng **append-only** (§3) **không** có `deleted_at` ⇒ dùng UNIQUE thường (không partial).
- Đưa quy tắc này vào hook DB review / `ecc:database-reviewer` của FULL gate.

---

## 11. 🟡 Asset version chain (`content_assets` — luồng revision)

> ERD gốc chỉ có `version` là **số rời**, không biết bản nào là "current/final", bản nào nối tiếp bản nào. Luồng trả-sửa sinh nhiều `edited_video` ⇒ cần chuỗi version rõ.

### 11.1. Thêm cột vào `content_assets`

```sql
- version_group_id  UUID NOT NULL   -- mọi bản của CÙNG asset logic share id này (root tự trỏ chính mình)
- parent_asset_id   UUID            -- bản liền trước trong chuỗi (null = bản gốc)
- is_current        BOOLEAN NOT NULL DEFAULT true   -- bản hiện hành của version_group
- superseded_by     UUID            -- bản thay thế (null = mới nhất)
-- giữ: version INT  (giờ có nghĩa: thứ tự TRONG version_group, bắt đầu 1)
```

### 11.2. Ràng buộc & quy tắc

```sql
-- chỉ đúng 1 bản current cho mỗi version_group
CREATE UNIQUE INDEX content_assets_one_current_uq
  ON content_assets (company_id, version_group_id) WHERE is_current;
```

- Tạo bản mới (revision): INSERT row mới cùng `version_group_id`, `parent_asset_id` = bản cũ, `version = max+1`, `is_current = true`; đồng thời set bản cũ `is_current = false`, `superseded_by` = bản mới (làm trong **cùng transaction**).
- "Final/current" = row `is_current = true` của `version_group_id`. Query lịch sử = đi theo `parent_asset_id` hoặc lọc theo `version_group_id ORDER BY version`.
- Không hard-delete bản cũ (truy vết revision) — chỉ chuyển `is_current=false`.

---

## 12. Bảng tổng hợp THÊM MỚI

| Bảng mới | Module | G-phase | Bất biến/ADR |
| --- | --- | --- | --- |
| `outbox_events` | Infra/Event | G2-4 | ADR 0009 |
| `processed_events` | Infra/Event | G2-4 | ADR 0009 |
| `dead_letter_events` | Infra/Event | G2-4 | ADR 0009 |
| `encryption_keys` | Security | G5e | ADR 0004 |
| `workflow_step_instance_locks` | Workflow | G0-3/G5a | BR-006 |

## 13. Bảng tổng hợp SỬA CỘT

| Bảng | Thay đổi |
| --- | --- |
| `platform_accounts` | Bỏ `encrypted_password`; thêm 8 cột envelope (§2.1) |
| `role_permissions`, `object_permissions` | Thêm `effect` (allow/deny) |
| `payslips`, `kpi_results`, `profit_snapshots` | Thêm `version`, `superseded_by`, `is_current`; bỏ `deleted_at` |
| `audit_logs`, `revenue_records`, `cost_records`, `payslip_items` | Xác nhận append-only (no UPDATE/DELETE grant) |
| Mọi bảng nghiệp vụ | `company_id NOT NULL` + FORCE RLS policy |
| `approval_requests` | Bỏ `target_type/target_id`; dùng FK thật `workflow_step_instance_id`/`task_id` + CHECK đúng-một (§8, §9.1) |
| `workflow_instances`, `cost_allocations` | Bỏ `*_target_type/_id`; FK thật nullable + CHECK đúng-một (§9.1) |
| `workflow_step_instances` | `status`/`approved_at` thành **projection** — chỉ consumer event ghi (§8) |
| `notifications`, `audit_logs`, `object_permissions` | Giữ polymorphic + CHECK enum loại + composite index + cron orphan (§9.2) |
| Mọi bảng có `deleted_at` | UNIQUE → **partial index** `WHERE deleted_at IS NULL` (§10) |
| `content_assets` | Thêm `version_group_id`, `parent_asset_id`, `is_current`, `superseded_by`; unique 1-current (§11) |

---

_Tài liệu liên quan: [`DATABASE ERD — MVP v1`](../DATABASE%20ERD%20—%20MVP%20v1.md) · [`roadmap-mapping.md`](./roadmap-mapping.md) · [`mvp-0-scope.md`](./mvp-0-scope.md) · `docs/adr/` (0004, 0005, 0009, 0010, **0016**) · [`CLAUDE.md`](../CLAUDE.md)_
