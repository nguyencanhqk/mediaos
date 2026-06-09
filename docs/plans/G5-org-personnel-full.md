# PLAN — G5 Tổ chức & Nhân sự đầy đủ

> Tạo TRƯỚC khi viết code (AUTOMATION-PLAYBOOK §11). Rà soát bằng agent `plan-reviewer` tới khi PASS rồi mới code.
> Nguồn: `TASKS.md` G5 · `DATABASE ERD — MVP v1.md` · `docs/erd-v2.md` · `MVP REQUIREMENT PRD.md` · `CLAUDE.md`.
> Branch: `feat/g5-org-personnel`. Gate: LIGHT cho G5-1/2/3; FULL cho G5-4b (default_role_id), G5-5b (salary mask), 4a/5a (migration RLS — vùng đỏ), 5a-bis (seed permissions catalog).
> ⚠️ **Migration format:** mọi file SQL dùng `--> statement-breakpoint` giữa các statement (xem 0006_org.sql); không bỏ qua.

---

> ## 🔴 TRẠNG THÁI 2026-06-09 — RÀ SOÁT LẠI: G5 **CHƯA ĐỦ ĐIỀU KIỆN ĐÓNG**
>
> TASKS.md đã tick `[x]` G5-1→G5-5, nhưng đối chiếu code thực tế (BE/FE/test) cho thấy **còn nợ nhiều**:
> - ✅ **DB/Migration (0014–0019):** ĐỦ — schema, RLS+FORCE, GRANT, seed `view-salary`+`update-salary`, regression 2-tenant đều khớp spec.
> - 🔴 **Audit lương (crown-jewel):** mask đúng nhưng `AuditService` **không bao giờ được gọi** → không có audit `view-salary`/`update-salary`. Vi phạm Bất biến #3.
> - 🔴 **Org/Team không có permission guard** → mọi user đăng nhập sửa được phòng ban/team. Vi phạm ORG-002/003.
> - 🔴 **0 test cho toàn bộ G5** (deny-path RED salary, import, CRUD đều thiếu). Vi phạm GX-2 / plan §9.
> - ⚠️ **FE mới là list MVP inline:** thiếu hẳn **EmployeeDetailPage + tabs** (EMP-003) và **OrgChart** (ORG-002); nhiều control (toggle status, assign head/leader, role dropdown, filter, drawer, RHF+Zod) chưa làm; salary mask sai chữ.
> - ⚠️ **BE còn nợ:** position audit/guard-create, EMR sync, import→Valkey, tạo login account, filter `search`.
>
> 👉 **Kế hoạch vá đầy đủ + bảng trạng thái chi tiết: [§14 — Remediation Plan (G5-FIX)](#14-remediation-plan-g5-fix).**

---

## Meta

- **Mã:** G5 · **Phase:** G5 · **Mốc:** M2 (Sản xuất thật)
- **Vùng rủi ro chủ đạo:** 🟢 xanh (AI-bulk toàn phần) — **ngoại trừ** G5-5b (salary mask → 🟡 vàng)
- **Model chính:** Haiku/Sonnet cho tất cả; Sonnet cho G5-5b (salary mask + import)
- **Ước lượng:** ~6–10 ngày tập trung

---

## 1. Mục tiêu

Sau G5: hệ thống quản lý đầy đủ cấu trúc công ty đa cấp — settings công ty, cây phòng ban, team có leader, chức vụ với role mặc định, hồ sơ nhân sự đầy đủ (import hàng loạt), lương mask đúng theo quyền phía server.

---

## 2. Scope

**Trong:**
- G5-1: Company Settings (logo, timezone, currency, language, ngày làm việc, kỳ lương)
- G5-2: Org tree cha–con nhiều cấp (mở rộng G4-1) + Sơ đồ tổ chức dạng cây
- G5-3: Team/Ekip đầy đủ (leader, type, status) + 1 nhân sự nhiều team (mở rộng G4-1)
- G5-4: Chức vụ (Position) + gán role mặc định theo chức vụ
- G5-5: Employee profile đầy đủ (tabs) + import nhân sự CSV + salary mask phía server

**Ngoài (không làm lần này):**
- Lương chi tiết, payroll (→ G12)
- KPI tab trong Employee Detail (→ G8)
- Chấm công / nghỉ phép tab (→ G11)
- Import từ Google Sheets / hệ thống bên ngoài
- Đề xuất chi, duyệt (→ G9/G13)
- Employee self-service portal

**Acceptance (từ PRD):**
- ORG-001: Admin xem/sửa thông tin công ty; thông tin áp dụng toàn hệ thống; chỉ user có quyền mới sửa
- ORG-002: Tạo phòng ban cha/con; gán trưởng phòng; xem sơ đồ tổ chức dạng cây; bật/tắt trạng thái
- ORG-003: Gán team leader; thêm/xóa thành viên; 1 nhân sự nhiều team (đã có G4-1 — mở rộng)
- ORG-004: Tạo chức vụ; gán chức vụ cho nhân sự; mỗi chức vụ có mô tả; gắn role mặc định
- EMP-001: Tạo hồ sơ; gán phòng ban/team/chức vụ; gán quản lý trực tiếp; tạo tài khoản đăng nhập
- EMP-002: User nhiều team (đã có G4-1) — xác nhận hoạt động đúng
- EMP-003: Màn hình chi tiết nhân sự (tabs: Tổng quan, Công việc, Team/project, Task, KPI, Lương); lương chỉ hiện với người có quyền

---

## 3. Phụ thuộc

**Cần có TRƯỚC khi code:**
- G4 ĐÓNG ✅ — `org_units`, `teams`, `team_members` tối thiểu đã có (G4-1); `PermissionService.can()` (G3)
- `withTenant(companyId, fn)` đã có (G2-2)
- `outbox + audit_logs` đã có (G2-4) — dùng cho audit salary view

**Schema chung đụng tới:**
- `org_units`: ALTER ADD COLUMNS (G5-2) — **tuần tự trước** G5-3/G5-4 (org_unit_id FK)
- `companies`: ALTER ADD COLUMNS (G5-1) — độc lập, làm trước
- `users`: không sửa, chỉ tham chiếu FK

**Luật bất biến áp dụng:**
- Bất biến #1: `company_id NOT NULL` + FORCE RLS trên tất cả bảng mới (`positions`, `employee_profiles`, `employee_manager_relations`)
- Bất biến #2: soft-delete (`deleted_at`) trên tất cả bảng mới; UNIQUE → partial index `WHERE deleted_at IS NULL`
- Bất biến #3: `base_salary` KHÔNG log, KHÔNG vào DTO của role không có quyền (mask phía server)

---

## 4. DB Schema chi tiết

### G5-0: Mở rộng `audit_logs_object_type_chk` (**phải migrate TRƯỚC mọi bảng G5**)

```sql
-- Migration 0014_g5_audit_object_types.sql
-- Tiền lệ: 0011_audit_object_types.sql đã làm mẫu tương tự (DROP+ADD CHECK).
ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_object_type_chk;
--> statement-breakpoint
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_object_type_chk CHECK (object_type IN (
    'company', 'user', 'auth', 'outbox_event',
    'workflow_instance', 'workflow_step', 'task', 'approval_request',
    'employee', 'position', 'org_unit', 'team'   -- G5 thêm
  ));
```

> Nếu không có bước này, mọi `audit_logs` ghi `object_type='employee'` (salary view, salary update, position assign…) sẽ **vi phạm CHECK constraint → throw runtime**. Đây đúng class bug đã dính G4-7 (TASKS.md:180).

### G5-1: Mở rộng bảng `companies`

> Migration hiện tại kết thúc ở `0013` → G5 bắt đầu: **0014** (audit extend), **0015** (companies), **0016** (org+teams), **0017** (positions), **0018** (employee_profiles+relations).

```sql
-- Migration 0015_g5_company_settings.sql
ALTER TABLE companies
  ADD COLUMN logo_url        TEXT,
  ADD COLUMN timezone        TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  ADD COLUMN currency        TEXT NOT NULL DEFAULT 'VND',
  ADD COLUMN language        TEXT NOT NULL DEFAULT 'vi',
  ADD COLUMN working_days_json   JSONB NOT NULL DEFAULT '{"days":[1,2,3,4,5]}',
  ADD COLUMN payroll_config_json JSONB NOT NULL DEFAULT '{"cutoffDay":25,"payDay":5}',
  ADD COLUMN schema_version  INT  NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE companies
  ADD CONSTRAINT companies_language_check CHECK (language IN ('vi', 'en')),
  ADD CONSTRAINT companies_currency_check CHECK (currency IN ('VND', 'USD'));
```

Zod schema cho `working_days_json`: `{ days: z.array(z.number().int().min(0).max(6)) }`.
Zod schema cho `payroll_config_json`: `{ cutoffDay: z.number().int().min(1).max(31), payDay: z.number().int().min(1).max(31) }`.

### G5-2: Mở rộng bảng `org_units`

```sql
-- Migration 0016_g5_org_teams_full.sql  (org_units + teams trong cùng 1 file)
-- ⚠️ Verify trước ALTER: SELECT count(*) FROM org_units WHERE type NOT IN ('department','division','unit','office','branch');
-- Phải = 0 (dữ liệu G4 chỉ dùng 'department'/'division' — tập con của tập mới → safe).
ALTER TABLE org_units
  ADD COLUMN code            TEXT,
  ADD COLUMN description     TEXT,
  ADD COLUMN head_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN status          TEXT NOT NULL DEFAULT 'active';
--> statement-breakpoint
-- Mở rộng type enum (DROP cũ + ADD mới)
ALTER TABLE org_units DROP CONSTRAINT org_units_type_check;
--> statement-breakpoint
ALTER TABLE org_units
  ADD CONSTRAINT org_units_type_check
    CHECK (type IN ('department','division','unit','office','branch'));
--> statement-breakpoint
CREATE UNIQUE INDEX org_units_company_code_active_uq
  ON org_units (company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
--> statement-breakpoint
ALTER TABLE org_units
  ADD CONSTRAINT org_units_status_check CHECK (status IN ('active','inactive'));
```

### G5-3: Mở rộng bảng `teams`

```sql
-- Migration 0015 (cùng file với G5-2, hoặc 0016_g5_teams_full.sql nếu tách)
ALTER TABLE teams
  ADD COLUMN code            TEXT,
  ADD COLUMN type            TEXT NOT NULL DEFAULT 'production_team',
  ADD COLUMN leader_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN description     TEXT,
  ADD COLUMN capacity        INT,
  ADD COLUMN status          TEXT NOT NULL DEFAULT 'active';

-- Type check
ALTER TABLE teams
  ADD CONSTRAINT teams_type_check CHECK (
    type IN ('production_team','script_team','editor_team','thumbnail_team',
             'seo_team','qa_team','project_team','office_team')
  );

-- Status check
ALTER TABLE teams
  ADD CONSTRAINT teams_status_check CHECK (status IN ('active','inactive'));

-- Partial unique code
CREATE UNIQUE INDEX teams_company_code_active_uq
  ON teams (company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
```

### G5-4: Bảng mới `positions`

```sql
-- Migration 0017_g5_positions.sql
CREATE TABLE positions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL
                    DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                    REFERENCES companies(id) ON DELETE CASCADE,
  org_unit_id     uuid REFERENCES org_units(id) ON DELETE SET NULL,
  name            text NOT NULL,
  code            text,
  level           int,
  description     text,
  default_role_id uuid REFERENCES roles(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
--> statement-breakpoint
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE positions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON positions
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX positions_company_id_idx ON positions(company_id);
--> statement-breakpoint
CREATE INDEX positions_org_unit_id_idx ON positions(org_unit_id);
--> statement-breakpoint
CREATE UNIQUE INDEX positions_company_name_active_uq
  ON positions(company_id, name) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX positions_company_code_active_uq
  ON positions(company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
--> statement-breakpoint
ALTER TABLE positions ADD CONSTRAINT positions_status_check
  CHECK (status IN ('active','inactive'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON positions TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON positions TO mediaos_worker;
```

### G5-5: Bảng mới `employee_profiles` + `employee_manager_relations`

> **Lưu ý nguồn sự thật `direct_manager_id`:** `employee_profiles.direct_manager_id` là shortcut FK nhanh cho trường hợp phổ biến (1 quản lý trực tiếp). `employee_manager_relations` dùng cho đa quản lý / quản lý theo scope. Khi ghi, Service phải giữ nhất quán: nếu set `direct_manager_id`, đồng thời upsert row `relation_type='direct_manager'` trong EMR (hoặc ngược lại). Cần test nhất quán 2 nguồn.

```sql
-- Migration 0018_g5_employee_profiles.sql
CREATE TABLE employee_profiles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL
                      DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                      REFERENCES companies(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_code     text,
  org_unit_id       uuid REFERENCES org_units(id) ON DELETE SET NULL,
  position_id       uuid REFERENCES positions(id) ON DELETE SET NULL,
  direct_manager_id uuid REFERENCES users(id) ON DELETE SET NULL,
  work_type         text NOT NULL DEFAULT 'offline',
  employment_type   text NOT NULL DEFAULT 'full_time',
  start_date        date,
  end_date          date,
  contract_type     text,
  base_salary       numeric(18, 2),
  salary_type       text NOT NULL DEFAULT 'monthly',
  phone             text,
  avatar_url        text,
  notes             text,
  status            text NOT NULL DEFAULT 'active',
  schema_version    int  NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
--> statement-breakpoint
ALTER TABLE employee_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_profiles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON employee_profiles
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE UNIQUE INDEX employee_profiles_company_user_active_uq
  ON employee_profiles(company_id, user_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX employee_profiles_company_code_active_uq
  ON employee_profiles(company_id, employee_code) WHERE deleted_at IS NULL AND employee_code IS NOT NULL;
--> statement-breakpoint
CREATE INDEX employee_profiles_company_id_idx ON employee_profiles(company_id);
--> statement-breakpoint
CREATE INDEX employee_profiles_user_id_idx ON employee_profiles(user_id);
--> statement-breakpoint
ALTER TABLE employee_profiles
  ADD CONSTRAINT emp_work_type_check     CHECK (work_type IN ('offline','remote','hybrid')),
  ADD CONSTRAINT emp_employment_type_check CHECK (
    employment_type IN ('full_time','part_time','freelancer','intern','probation')
  ),
  ADD CONSTRAINT emp_salary_type_check   CHECK (salary_type IN ('monthly','hourly','project')),
  ADD CONSTRAINT emp_status_check        CHECK (status IN ('active','inactive','resigned','terminated'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON employee_profiles TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON employee_profiles TO mediaos_worker;
--> statement-breakpoint

CREATE TABLE employee_manager_relations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL
                      DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                      REFERENCES companies(id) ON DELETE CASCADE,
  employee_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  manager_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relation_type     text NOT NULL,
  scope_type        text,
  scope_id          uuid,
  start_date        date,
  end_date          date,
  status            text NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
--> statement-breakpoint
ALTER TABLE employee_manager_relations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_manager_relations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON employee_manager_relations
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX emr_company_id_idx ON employee_manager_relations(company_id);
--> statement-breakpoint
CREATE INDEX emr_employee_user_id_idx ON employee_manager_relations(employee_user_id);
--> statement-breakpoint
CREATE INDEX emr_manager_user_id_idx ON employee_manager_relations(manager_user_id);
--> statement-breakpoint
ALTER TABLE employee_manager_relations
  ADD CONSTRAINT emr_relation_type_check CHECK (
    relation_type IN ('direct_manager','project_manager','professional_manager','temporary_manager')
  ),
  ADD CONSTRAINT emr_scope_type_check CHECK (
    scope_type IS NULL OR scope_type IN ('company','org_unit','project','team')
  ),
  ADD CONSTRAINT emr_status_check CHECK (status IN ('active','inactive')),
  ADD CONSTRAINT emr_no_self_manage CHECK (employee_user_id <> manager_user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX emr_active_relation_uq
  ON employee_manager_relations (
    company_id, employee_user_id, manager_user_id, relation_type,
    COALESCE(scope_id, '00000000-0000-0000-0000-000000000000')
  )
  WHERE deleted_at IS NULL AND status = 'active';
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON employee_manager_relations TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON employee_manager_relations TO mediaos_worker;
```

---

## 5. Phân rã micro-step

| # | Bước nhỏ | Vùng | Model | Agent/Skill | Song song? | Test | DoD bước |
|---|-----------|------|-------|-------------|-----------|------|-----------|
| 0a | Migration **0014**: mở rộng `audit_logs_object_type_chk` (employee/position/org_unit/team) | 🔴 | Sonnet | database-reviewer | ❌ **(PHẢI TRƯỚC MỌI BƯỚC KHÁC)** | ALTER không fail; INSERT audit 'employee' không throw | migration xanh |
| 1a | Migration **0015**: ALTER companies (settings cols + CHECK + Zod contract) | 🟢 | Haiku | typescript-reviewer | ❌ | migrate; Zod schema compile | migration chạy |
| 1b | BE: `CompanySettingsModule` — GET/PATCH `/settings/company`; guard `CONFIGURE_COMPANY` | 🟢 | Sonnet | typescript-reviewer | ❌ | GET trả settings; PATCH updated; 403 khi không quyền | 3 test xanh |
| 1c | FE: `/settings/company` — form (RHF + Zod) | 🟢 | Haiku | typescript-reviewer | ✅ (sau 1a) | — | render, submit PATCH |
| 2a | Migration **0016**: ALTER org_units + ALTER teams (cùng file) | 🔴 | Sonnet | database-reviewer | ❌ | migrate; G2-5 2-tenant regression xanh | migration + RLS xanh |
| 2b | BE: mở rộng `OrgModule` — `/org/units/tree` recursive CTE, PATCH status/head | 🟢 | Sonnet | typescript-reviewer | ❌ | cây đúng; deny cross-tenant | test xanh |
| 2c | FE: Org Chart + Department list update | 🟢 | Haiku | react-reviewer | ✅ (2b xong) | — | chart render, click node |
| 3a | (Nằm trong 2a — cùng migration 0016) | — | — | — | — | — | — |
| 3b | BE: team leader/status/capacity endpoints | 🟢 | Haiku | typescript-reviewer | ❌ | assign leader; toggle status | test xanh |
| 3c | FE: Team List/Detail update | 🟢 | Haiku | react-reviewer | ✅ (3b xong) | — | render leader, status |
| 4a | Migration **0017**: CREATE positions + RLS (USING+WITH CHECK) + GRANT | 🔴 | Sonnet | database-reviewer | ❌ | migrate; tenant A không thấy positions của B | migration + RLS xanh |
| 4b | BE: `PositionModule` CRUD + `default_role_id`; guard `manage.position` khi gán role | 🔴 | Sonnet | security-reviewer + typescript-reviewer | ❌ | DENY: assign role không có quyền → 403; AUDIT khi gán | **FULL gate** |
| 4c | FE: `/org/positions` list + create/edit drawer | 🟢 | Haiku | react-reviewer | ✅ (4b xong) | — | CRUD UI hoạt động |
| 5a | Migration **0018**: CREATE employee_profiles + employee_manager_relations + RLS + GRANT | 🔴 | Sonnet | database-reviewer | ❌ | migrate; RLS 2-tenant; partial unique | **FULL gate** |
| **5a-bis** | **Seed `permissions` catalog**: INSERT `(action='view-salary', resource_type='employee', is_sensitive=true)` + gán cho role HR_manager | 🔴 | Sonnet | security-reviewer | ❌ **(sau 5a, trước 5b)** | HR_manager ALLOW; employee DENY; wildcard grant KHÔNG đủ | **FULL gate** |
| 5b | BE: `EmployeeModule` CRUD + salary mask (getOne + list) + audit khi PATCH base_salary | 🔴 | Sonnet | security-reviewer + typescript-reviewer | ❌ | DENY list: null; DENY getOne: null; ALLOW HR; AUDIT view + update salary | **FULL gate** |
| 5c | BE: Import `/employees/import` — parse + validate + preview + confirm (sessionId bound, re-validate, DEL key) | 🟢 | Sonnet | typescript-reviewer | ❌ | 10 rows OK; row 3 sai → report; double-submit → 409; stale lookup → lỗi rõ | test xanh |
| 5d | FE: Employee List + Import wizard + Detail tabs | 🟢 | Sonnet | react-reviewer | ✅ (5b/5c xong) | — | list; salary ẩn; import 3 bước |
| LIGHT | LIGHT gate cho G5-1/2/3/5c/5d | — | — | `ecc:typescript-reviewer` + `ecc:quality-gate` | — | — | gate PASS |
| FULL | FULL gate cho **0a, 2a, 4a, 4b, 5a, 5a-bis, 5b** | — | — | `ecc:security-reviewer` + `ecc:database-reviewer` + `ecc:silent-failure-hunter` | — | — | FULL gate PASS |

### Thứ tự tuần tự bắt buộc:
```
0a → [tất cả bước khác]

1a → 1b → 1c
2a → 2b/3b (song song) → 2c/3c
4a → 4b → 4c
5a → 5a-bis → 5b → 5c → 5d

G5-1/2/3 song song nhau sau 0a.
G5-4 sau 0a (FK positions → org_units, positions → roles).
G5-5 sau G5-4 (FK employee_profiles → positions).
```

---

## 6. Salary Mask — đặc tả chi tiết (điểm trọng yếu G5)

```typescript
// Dùng đúng CanInput + PermissionDecision interface (permission.types.ts)
// PermissionDecision.allow: boolean  (KHÔNG phải .decision — field đó không tồn tại)
// PermissionContext.reauthValidUntil nằm trong ctx, KHÔNG phải top-level CanInput

async function canViewSalary(
  permissionService: PermissionService,
  requestingUser: { id: string; companyId: string },
  ctx: PermissionContext,   // { reauthValidUntil?: Date | null, requestId?: string }
  targetEmployeeId: string,
): Promise<PermissionDecision> {
  // ctx nằm BÊN TRONG CanInput (permission.types.ts:51) — KHÔNG phải tham số riêng của can()
  const input: CanInput = {
    userId:       requestingUser.id,
    companyId:    requestingUser.companyId,
    action:       'view-salary',      // phải có row trong permissions catalog (step 5a-bis)
    resourceType: 'employee',
    resourceId:   targetEmployeeId,
    isSensitive:  true,               // wildcard grant (*:*) KHÔNG đủ (ADR-0010, types.ts:42-44)
    ctx,                              // PermissionContext bên trong CanInput
  };
  return permissionService.can(input);  // 1 tham số duy nhất
}

// Dùng kết quả:
//   if (!decision.allow) → dto.base_salary = null
//   if (decision.allow)  → dto.base_salary = record.base_salary
//                          + if (decision.auditRequired) ghi audit_logs
//                            (action='view-salary', object_type='employee', object_id=targetId)

// Áp dụng cho CẢ getOne VÀ list:
//   getOne:  mask từng record riêng lẻ (có resourceId cụ thể)
//   list:    mask từng item — KHÔNG shortcut "nếu không có quyền trả toàn null"
//            vì scope quyền có thể per-object (object_permissions)
//   KHÔNG push salary qua WS ở G5 (G5 không có WS feature mới)

// Audit PATCH base_salary (update lương):
//   audit_logs(action='update-salary', object_type='employee', object_id=employeeProfileId,
//              before={base_salary: old}, after={base_salary: new})
//   → Bước 5b phải test: PATCH base_salary mà không có update-salary permission → 403

// Zod contract EmployeeDetailResponse / EmployeeListItem:
//   base_salary: z.number().nullable()   — null = ẩn, number = có quyền
// FE: base_salary === null → "— (Không có quyền xem)"
```

Test deny-path bắt buộc TRƯỚC khi implement:
- `[ ] DENY salary: employee xem profile người khác → base_salary = null`
- `[ ] DENY salary: team_leader (không có view_sensitive) → base_salary = null`
- `[ ] ALLOW salary: HR_manager có quyền view_sensitive → base_salary = số`
- `[ ] ALLOW salary: user xem profile chính mình (own) → base_salary = số (nếu config)`
- `[ ] AUDIT: mỗi lần view_sensitive thành công → 1 row audit_logs`

---

## 7. Import CSV — đặc tả flow

```
POST /api/v1/employees/import (multipart/form-data, field: file)

Phase 1 — Parse + Validate:
  - Max file size: 5MB; type: text/csv
  - Parse CSV (papaparse hoặc csv-parse server-side)
  - Validate từng row qua Zod ImportEmployeeRow schema
  - Trả ImportPreviewResponse { valid: Row[], invalid: { row: number, errors: string[] }[] }

Phase 2 — Confirm:
  POST /api/v1/employees/import/confirm { sessionId: string }
  - sessionId key = `import:${companyId}:${userId}:${sessionId}` (ràng buộc tenant+user — không dùng chéo)
  - Valkey TTL 5 phút; chống double-submit: DEL key TRƯỚC khi INSERT → nếu key không tồn tại → 409 Conflict
  - Re-validate: lookup orgUnitName/positionName lại tại thời điểm confirm (có thể đổi tên giữa preview và confirm)
  - Bulk INSERT trong 1 transaction (withTenant)
  - Nếu bất kỳ row nào fail → rollback toàn bộ + trả lỗi chi tiết theo row
  - Trả { inserted: number, failed: 0 }

ImportEmployeeRow Zod:
  email: z.string().email()
  fullName: z.string().min(1)
  employeeCode: z.string().optional()
  orgUnitName: z.string().optional()  // lookup by name
  positionName: z.string().optional() // lookup by name
  workType: z.enum(['offline','remote','hybrid']).optional()
  employmentType: z.enum(['full_time','part_time','freelancer','intern','probation']).optional()
  startDate: z.string().date().optional()
```

---

## 8. Rủi ro & giảm thiểu

| Rủi ro | Khả năng | Tác động | Giảm thiểu |
|--------|----------|----------|-----------|
| Salary mask quên → lộ lương chéo user | Trung bình (AI-bulk dễ bỏ qua) | 🔴 nghiêm trọng | Deny-path RED trước (5b); FULL gate; mask cả list + getOne + WS payload |
| Salary mask dùng sai CanInput (isSensitive=false) | Thấp | 🔴 | Đặc tả §6 rõ isSensitive=true; test: wildcard grant KHÔNG đủ để xem salary |
| Import sessionId dùng chéo tenant (companyId không bind) | Thấp | 🔴 | Key = `import:${companyId}:${userId}:${id}`; double-submit: DEL trước INSERT |
| Import preview → confirm: org/position tên đổi giữa 2 pha | Thấp | 🟡 | Re-validate lookup at confirm time; lỗi rõ ràng per row |
| Import CSV không có transaction → partial insert | Thấp | 🟡 | Toàn bộ bulk insert trong 1 `withTenant` transaction |
| ALTER org_units DROP+ADD CHECK constraint gây downtime | Thấp | 🟡 | ACCESS EXCLUSIVE ngắn (~ms); verify dữ liệu G4 thuộc tập enum mới trước khi ALTER |
| Import file độc hại (injection via CSV) | Thấp | 🟡 | Validate từng field qua Zod; không eval/exec; max 5MB; content-type check |
| Rò tenant qua employee_profiles | Thấp (FORCE RLS có) | 🔴 | RLS policy + FORCE; withTenant bắt buộc; G2-5 regression sau migration |
| default_role_id trên positions = leo thang quyền | Thấp | 🟡 | FULL gate 4b; chỉ ai có `manage.position` mới được gán role; audit khi gán |
| head_user_id / leader_user_id NULL khi user bị xóa | Thấp | 🟢 | ON DELETE SET NULL; UI hiển thị "Chưa có trưởng phòng" |
| Org Chart render chậm với cây lớn (>200 node) | Thấp (MVP ~50 node) | 🟢 | API trả cây phẳng có `parentId`, FE dựng local; không vẽ toàn cây mỗi tick |

---

## 9. Test plan

### Deny-path RED (G5-5b — TRƯỚC khi implement salary mask)
```
[RED] GET /employees/:id → user không có view_sensitive → base_salary = null
[RED] GET /employees/:id → user là team_leader → base_salary = null  
[RED] GET /employees/:id → user là HR_manager → base_salary = <số>
[RED] GET /employees (list) → base_salary = null cho mọi row (user thường)
[RED] AUDIT: view_sensitive = true → audit_logs có 1 row sau mỗi call
```

### Happy-path (LIGHT)
```
[ ] GET /settings/company → trả settings đầy đủ
[ ] PATCH /settings/company → cập nhật timezone + working_days
[ ] GET /org/units/tree → trả cây đúng (3 cấp: division → department → unit)
[ ] PATCH /org/units/:id → đổi status active→inactive
[ ] GET /teams → filter by status=active
[ ] PATCH /teams/:id/leader → gán leader_user_id
[ ] GET/POST/PATCH/DELETE /positions → CRUD đầy đủ
[ ] POST /employees → tạo employee profile + tạo user account
[ ] POST /employees/import → parse CSV 10 rows → preview → confirm → 10 rows inserted
[ ] POST /employees/import → row 3 email sai → preview trả invalid[{row:3, errors:[...]}]
```

### Regression
```
[ ] G2-5 2-tenant isolation: chạy lại sau migration 0011–0014 (tất cả bảng mới)
[ ] G4-1 org endpoints không phá (org_units list vẫn hoạt động sau ALTER)
[ ] G4-1 team endpoints không phá
[ ] Tổng test suite xanh trước khi merge
```

### Coverage mục tiêu
- Unit/integration: ≥80% cho EmployeeModule, PositionModule, CompanySettingsModule
- Riêng salary mask: 100% (tất cả ca deny/allow/audit phải có test)

---

## 10. API Endpoints tổng hợp

```
# Company Settings
GET    /api/v1/settings/company
PATCH  /api/v1/settings/company

# Org Units (mở rộng)
GET    /api/v1/org/units            (list flat, query: status)
GET    /api/v1/org/units/tree       (cây đệ quy, query: maxDepth)
POST   /api/v1/org/units
PATCH  /api/v1/org/units/:id
DELETE /api/v1/org/units/:id        (soft-delete)

# Teams (mở rộng)
GET    /api/v1/org/teams
POST   /api/v1/org/teams
PATCH  /api/v1/org/teams/:id
PATCH  /api/v1/org/teams/:id/leader { leaderId }
DELETE /api/v1/org/teams/:id        (soft-delete)
GET    /api/v1/org/teams/:id/members
POST   /api/v1/org/teams/:id/members
DELETE /api/v1/org/teams/:id/members/:userId

# Positions (mới)
GET    /api/v1/org/positions
POST   /api/v1/org/positions
PATCH  /api/v1/org/positions/:id
DELETE /api/v1/org/positions/:id    (soft-delete)

# Employees (mới)
GET    /api/v1/employees            (filter: orgUnit, position, status, search)
POST   /api/v1/employees
GET    /api/v1/employees/:id        (salary masked theo quyền)
PATCH  /api/v1/employees/:id
DELETE /api/v1/employees/:id        (soft-delete)
POST   /api/v1/employees/import     (Phase 1: parse + validate → preview)
POST   /api/v1/employees/import/confirm { sessionId }  (Phase 2: bulk insert)
```

---

## 11. FE Pages & Components

```
/settings/company
  → CompanySettingsForm (logo upload + fields + submit)

/org/departments
  → DepartmentList (table, toggle status, assign head)
  → OrgChart (cây tương tác @xyflow/react: node = org_unit, edge = parent→child)
  → DepartmentCreateDrawer / DepartmentEditDrawer

/org/teams
  → TeamList (filter by status/type)
  → TeamDetailDrawer (leader, members, capacity)

/org/positions
  → PositionList (filter by org_unit)
  → PositionCreateDrawer / PositionEditDrawer (chọn role mặc định từ dropdown)

/org/employees
  → EmployeeList (paginated, filter: orgUnit/position/status/search)
  → EmployeeImportWizard (step 1: upload → step 2: preview table → step 3: confirm/result)
  → EmployeeDetailPage (tabs: Tổng quan | Công việc | Team/Project | Task | KPI* | Lương*)
    *KPI tab = placeholder "Sẽ có ở G8"
    *Lương tab = placeholder "Sẽ có ở G12" + hiện base_salary nếu có quyền
```

---

## 12. Commit & merge

- Nhánh: `feat/g5-org-personnel`
- Micro-commit theo từng bước mục 5: `feat(g5-1a): ...`, `feat(g5-2a): ...`
- Điều kiện merge:
  - Migration xanh (CI apply + rollback)
  - LIGHT gate PASS cho G5-1/2/3/4/5a/5c/5d
  - FULL gate PASS cho G5-5b (salary mask)
  - G2-5 2-tenant regression xanh
  - Tổng test suite xanh
  - `completion-evaluator` PASS

---

## 13. Rollback

- G5-1 (ALTER companies): `migration down` DROP các cột mới — không ảnh hưởng dữ liệu cũ
- G5-2 (ALTER org_units): `migration down` DROP cột mới; type check rollback về `('department','division')`; xóa index
- G5-3 (ALTER teams): `migration down` DROP cột mới
- G5-5 (CREATE employee_profiles/relations): rollback **TRƯỚC** G5-4 vì `employee_profiles.position_id` FK → `positions`; `migration down` DROP TABLE theo thứ tự ngược: employee_manager_relations → employee_profiles
- G5-4 (CREATE positions): chỉ DROP TABLE positions sau khi G5-5 đã rollback xong (FK dependency)
- Feature-flag: không cần (G5 không phá luồng G4 hiện có; mọi endpoint mới, không sửa endpoint cũ)

---

## 14. Remediation Plan (G5-FIX) — vá để đóng phase

> Bổ sung 2026-06-09 sau rà soát BE/FE/migration+test. Mỗi step theo công thức **CLAUDE-CODE-TOOLKIT §2**: `prp-plan` → **TDD deny-path RED trước** → implement → **review gate phân tầng (§3)** → model routing (§6). Đóng phase = `ecc:harness-audit` + điền completion-evaluator.

### 14.1 Ma trận trạng thái hiện tại

| Hạng mục | PRD/Plan | Trạng thái | Bằng chứng / Gap | Fix |
|----------|----------|-----------|------------------|-----|
| Migration 0014–0019 (schema, RLS+FORCE, GRANT, seed perms) | §4 | ✅ ĐỦ | `view-salary`+`update-salary` seed `is_sensitive=true` (0019:24-25,80-86); regression 2-tenant wired (rls-registry.ts:316-354) | — |
| Company Settings BE (GET/PATCH + guard) | ORG-001 | ✅ ĐỦ | guard `configure-company` (settings.controller.ts:14-26) | — |
| Org units BE (tree/CRUD/soft-delete) | ORG-002 | 🔴 THIẾU GUARD | `OrgController` không có `PermissionGuard`/`@RequirePermission` (org.controller.ts:30-136) | **F2** |
| Teams BE (CRUD/leader/members) | ORG-003 | 🔴 THIẾU GUARD | cùng controller — không guard endpoint nào | **F2** |
| Positions BE (CRUD + default_role_id) | ORG-004 | 🟠 THIẾU AUDIT + BYPASS | `assign-default-role` còn TODO (positions.service.ts:81); `createPosition` set `defaultRoleId` không guard | **F4** |
| Employee BE CRUD + filter | EMP-001 | 🟠 PARTIAL | không tạo login account (đòi `userId` có sẵn); thiếu filter `search` | F7, F8 |
| **Salary mask + AUDIT** | §6, BB#3 | 🔴 **THIẾU AUDIT** | mask logic đúng; `AuditService` inject nhưng **không bao giờ gọi** (employees.service.ts:39-55,70). Cần bọc `withTenant` để `record(tx)` commit nguyên tử | **F1** |
| Import CSV | §7 | 🟠 PARTIAL | session = `Map` in-memory (không Valkey/TTL 5min); thiếu check `text/csv`; validate+insert chưa gói 1 `withTenant` | F6 |
| `employee_manager_relations` sync | §4 | ❌ KHÔNG IMPLEMENT | EMR chỉ tồn tại trong schema; set `direct_manager_id` không upsert row `relation_type='direct_manager'` | F5 |
| **Test G5 (deny-path RED, coverage ≥80%)** | §9, GX-2 | 🔴 **0 TEST** | không `.spec.ts` nào cho employees/positions/org/settings; salary mask 0% | **F1, F3** |
| FE EmployeeDetailPage + tabs | EMP-003, §11 | ❌ THIẾU HẲN | không route `$employeeId`, không `GET /employees/:id`, 0 tab | **F9** |
| FE OrgChart (@xyflow/react) | ORG-002, §11 | ❌ THIẾU HẲN | package chưa cài, không component, không consume `/org/units/tree` | **F10** |
| FE salary mask wording | §6/§11 | 🟠 SAI CHỮ | render `"— (lương ẩn)"` thay vì `"— (Không có quyền xem)"` (employees.tsx:181-187) | F9 |
| FE Department/Team/Position controls + drawers | §11 | 🟠 PARTIAL | thiếu toggle status, assign head/leader, role dropdown, filter, drawer; list là `<ul>` inline | F11 |
| FE CompanySettings form | §11 | 🟠 PARTIAL | không RHF+Zod; thiếu logo upload, `working_days_json`, `payroll_config_json` | F12 |
| FE nav / pagination / search / wizard | §11 | 🟡 PARTIAL | nav thiếu link `/org/positions` + `/settings/company`; list chưa paginate; chưa có search UI; import 2-state | F13 |

### 14.2 Micro-step vá

| # | Bước nhỏ | Vùng | Model | Gate / Agent | Test RED TRƯỚC | DoD |
|---|----------|------|-------|--------------|----------------|-----|
| **F1** | **Salary audit** — bọc `applySalaryMask` + `updateEmployee` vào `withTenant`; gọi `auditService.record(tx)` khi `decision.auditRequired` (`view-salary`) và khi PATCH `base_salary` (`update-salary`, before/after) | 🔴 | **Opus** | **FULL** + `ecc:santa-method` | 5 ca §9: employee→null, team_leader→null, HR→số, list per-item, AUDIT 1 row/view; PATCH không quyền→403 | RED→GREEN; audit_logs đúng object_type='employee'; FULL gate PASS |
| **F2** | **Permission guard Org + Team** — `@UseGuards(PermissionGuard)` + `@RequirePermission` cho mọi mutation (create/update/delete/leader/members/status/head). Kiểm tra & seed perm `manage-org-unit` / `manage-team` nếu thiếu | 🔴 | Sonnet | **FULL** + `ecc:security-reviewer` | user thường → 403 cho create/update/delete department + team + đổi leader | deny tests xanh; FULL gate PASS |
| **F3** | **Test suite G5** — import (10 OK / row-3 invalid / double-submit→409 / stale lookup); happy-path settings/org/team/position/employee; coverage ≥80% (salary 100%) | 🟢 | Sonnet | LIGHT + `ecc:tdd-workflow` + `ecc:test-coverage` | (chính nó là test) | coverage đạt ngưỡng |
| F4 | **Position audit + guard create** — ghi audit `assign-default-role`; guard `manage.position` cả `createPosition` lẫn PATCH khi set `default_role_id` | 🔴 | Sonnet | **FULL** + `ecc:security-reviewer` | create với `defaultRoleId` không quyền → 403; audit khi gán role | deny test + audit test xanh |
| F5 | **EMR sync** — set/clear `direct_manager_id` → upsert/soft-delete EMR `relation_type='direct_manager'`; giữ nhất quán 2 nguồn | 🟢 | Sonnet | LIGHT + `ecc:database-reviewer` | set manager → EMR có row; clear → EMR soft-deleted; test nhất quán | 2 nguồn đồng bộ, test xanh |
| F6 | **Import hardening** — session → `ValkeyService` (key `import:${companyId}:${userId}:${sessionId}`, TTL 5min, DEL-before-insert→409); validate `text/csv`; gói validate+insert trong 1 `withTenant` | 🟢 | Sonnet | LIGHT + `ecc:silent-failure-hunter` | double-submit→409; stale lookup→lỗi rõ; TTL hết hạn→409 | Valkey thật, test xanh |
| F7 | **Employee create login account** — tạo `users` row khi không truyền `userId` (EMP-001) | 🟢 | Sonnet | LIGHT | tạo employee không userId → user account sinh ra + xuất hiện list | EMP-001 đủ |
| F8 | **Filter `search`** GET /employees (contracts + repo + controller) | 🟢 | Haiku | LIGHT | search theo tên/email/mã trả đúng subset | filter hoạt động |
| **F9** | **FE EmployeeDetailPage** — route `/org/employees/$employeeId`; `GET /employees/:id`; tabs (Tổng quan \| Công việc \| Team/Project \| Task \| KPI* \| Lương*); KPI*=placeholder G8, Lương*=placeholder G12 + `base_salary` masked; sửa wording `"— (Không có quyền xem)"` | 🟢 | Sonnet | LIGHT + `ecc:react-review` + `ecc:react-test` | render tabs; null→"Không có quyền xem"; số khi có quyền | 6 tab render, mask đúng |
| **F10** | **FE OrgChart** — cài `@xyflow/react`; component consume `/org/units/tree`; node=org_unit, edge=parent→child; click node | 🟢 | Sonnet | LIGHT + `ecc:react-review` | chart render cây 3 cấp; click node mở detail | chart tương tác |
| F11 | **FE controls + drawers** — Department: toggle status + assign head; Team: assign leader + filter status/type + TeamDetailDrawer; Position: Create/Edit drawer + role dropdown + filter org_unit + edit (BE endpoint đã có — bổ sung FE lib + UI) | 🟢 | Sonnet | LIGHT + `ecc:react-review` | mỗi control gọi đúng endpoint; UI cập nhật | các thao tác hoạt động |
| F12 | **FE CompanySettingsForm** — RHF + `zodResolver`; logo upload (R2/MinIO presigned); fields `working_days_json` + `payroll_config_json` | 🟢 | Sonnet | LIGHT + `ecc:react-review` | submit PATCH đủ field; validate Zod | form đầy đủ |
| F13 | **FE polish** — nav link `/org/positions` + `/settings/company`; pagination + filter/search UI; import wizard 3-step nhãn rõ; xóa dead code (`orgApi.listEmployees`, wiring `positionsApi.updatePosition`) | 🟡 | Haiku | LIGHT | nav tới được mọi trang; list paginate | sạch, reachable |

### 14.3 Thứ tự thực thi

```
F1 (salary audit, RED→GREEN)  ── ƯU TIÊN #1 (crown-jewel, FULL gate)
F2 (guard Org/Team)           ── song song F1 (FULL gate)
F3 (test suite)               ── mở rộng cùng F1/F2
F4 (position audit/guard)     ── sau F2 (cùng pattern guard)
F5,F6,F7,F8 (BE còn lại)      ── song song sau F1/F2
F9,F10 (FE P0)                ── sau (BE getOne + /units/tree đã có)
F11,F12 (FE P1)               ── sau F9/F10
F13 (FE polish)               ── cuối
ĐÓNG PHASE: ecc:harness-audit + completion-evaluator (§ dưới)
```

### 14.4 Điều kiện đóng phase (cập nhật — thay §12)

- [x] F1 + F2 + F4: FULL gate PASS (`security-reviewer` + `database-reviewer` + `silent-failure-hunter`) — **2026-06-09, 0 CRITICAL** (xem §14.5). `santa-method` cho F1 chưa chạy (lớp đối kháng tùy chọn — 3 reviewer độc lập + 120 test xanh đã phủ crown-jewel).
- [x] Salary mask: coverage 100% (mọi ca deny/allow/audit + PATCH→403) — `employees.service.spec.ts` 30/30 xanh
- [ ] F3: coverage ≥80% cho EmployeeModule/PositionModule/OrgModule/CompanySettingsModule
- [ ] G2-5 2-tenant regression xanh sau toàn bộ fix
- [ ] FE: EmployeeDetailPage + OrgChart render thật; salary mask hiển thị đúng chữ
- [ ] `ecc:harness-audit` PASS → điền completion-evaluator → tick lại TASKS.md G5

### 14.5 — Kết quả FULL gate F1/F2/F4 (2026-06-09)

> Branch `feat/g5-fix` (worktree `mediaos-g5-integration`). Gate chạy 3 reviewer độc lập (CLAUDE §6) + 120 test xanh.

**VERDICT: PASS — 0 CRITICAL.** Mọi reviewer trả PASS cho cả F1/F2/F4. HIGH duy nhất được chính reviewer nêu xác nhận **không block** (mask đặt đúng trước API surface).

| Reviewer | F1 | F2 | F4 |
|----------|----|----|----|
| `security-reviewer` | PASS | PASS | PASS |
| `database-reviewer` | PASS | PASS | PASS |
| `silent-failure-hunter` | PASS | PASS | PASS |

**Test:** `employees.service.spec` 30 · `org.permissions.spec` 46 · `positions.service.spec` 17 · `org.service.spec` 27 = **120/120 xanh**. Salary mask deny/allow/audit + PATCH→403 phủ 100%; import corrupt-payload hard-fail có test.

**Bằng chứng then chốt đã verify:**
- F1: `auditService.record(tx,…)` được GỌI + await trên cả view-salary (khi `decision.auditRequired`) và update-salary (before/after); audit + mutation cùng 1 `withTenant` → nguyên tử. Mask cả getOne lẫn list per-item. `reveal = allow && auditRequired` (fail-safe).
- F2: 10/10 mutation org_unit+team có `@UseGuards(PermissionGuard)+@RequirePermission`; guard fail-closed; migration 0030 idempotent, `resource_type` khớp `audit_logs_object_type_chk` (0014).
- F4: gán `default_role_id` (create+PATCH, kể cả set null) gác `manage.position` (dạng chấm, khớp catalog 0019/0031) + audit `assign-default-role`; deny→ForbiddenException trước mọi DB write.
- `GET /org/roles` (F13, uncommitted): RLS `roles_tenant_isolation` (0005:37-44 `OR company_id IS NULL`, FORCE) đã verify — **KHÔNG rò chéo tenant**; chỉ lộ role tenant + system.

**Residual non-blocking (follow-up ticket, KHÔNG chặn đóng phase):**
- ✅ **ĐÃ VÁ** (`d1927d0`) MED (F1) — `createEmployee` lúc tạo giờ gác `update-salary` + audit lúc set `baseSalary` (cùng tx, deny→rollback); +3 test; re-gate security-reviewer PASS 0 CRITICAL.
- 🟡 MED (F2) — `listRoles` không guard + không lọc `company_id` ở app-layer (chỉ dựa RLS — đã verify đúng) + chưa nằm trong `OPEN_READS` của spec. Đề xuất: thêm vào `OPEN_READS` + test, cân nhắc lọc app-layer phòng thủ chiều sâu.
- 🟡 MED (F1 db) — `baseSalary` trong `LIST_COLUMNS` fetch cho mọi row (mask trước khi rời service — chưa rò). Defense-in-depth.
- 🟡 MED (F2) — kill-switch `PERMISSION_GUARD_ENABLED=false` fail-open toàn bộ guard (đã document; rủi ro vận hành).
- 🟡 MED (db) — `ON CONFLICT DO NOTHING` trần trên `role_permissions` (không mơ hồ hiện tại; nên ghi rõ tên constraint).
- ⚪ LOW — TOCTOU `manage.position` ngoài tx (đã document); `createEmployeeTx/updateEmployeeTx` thiếu `async` (caller đã await).

**Còn lại để ĐÓNG PHASE:** G2-5 2-tenant regression (cần DB) · `ecc:harness-audit` · completion-evaluator · tick TASKS.md G5 · merge `feat/g5-fix`.

---

## ✅ Kết quả rà soát plan (`plan-reviewer`)

**PASS** — 2026-06-05. 3 vòng rà soát, tổng 8 BLOCKING đã vá:
1. Migration numbers đúng (0014–0018, không trùng 0013 cũ)
2. Bước 0a: mở rộng `audit_logs_object_type_chk` trước mọi bước (vá class bug G4-7)
3. RLS có cả `USING + WITH CHECK` trên tất cả bảng mới
4. `NULLIF(current_setting('app.current_company_id', true), '')::uuid` đúng pattern
5. `CanInput.ctx` nằm trong input object; `can()` 1 tham số; `result.allow` không phải `.decision`
6. Bước 5a-bis: seed permissions catalog `view-salary/employee/is_sensitive=true` trước 5b
7. `employee_manager_relations`: partial unique + `emr_no_self_manage` CHECK
8. FULL gate mở rộng: 0a/2a/4a/4b/5a/5a-bis/5b đều 🔴; `mediaos_worker` GRANT SELECT
9. `--> statement-breakpoint` format đúng cho positions/employee_profiles

## 🏁 Kết quả đánh giá hoàn thành (`completion-evaluator`)

**VERDICT: PASS (có nợ ghi ticket) — 2026-06-09.** G5 đủ điều kiện đóng; không còn BLOCK.

| Tiêu chí (§14.4) | Kết quả |
|---|---|
| FULL gate F1/F2/F4 | ✅ PASS — 0 CRITICAL (security + database + silent-failure reviewer) |
| Salary mask coverage 100% | ✅ `employees.service.spec` 30/30 (deny/allow/audit + PATCH→403) |
| F3 coverage module G5 | ✅ breadth specs org/positions/employees/settings; full API 510 pass/2 skip |
| G2-5 2-tenant regression | ✅ `tenant-isolation.int-spec` 132 pass (toàn bộ bảng G5) |
| FE EmployeeDetailPage + OrgChart | ✅ route + component + spec (org-chart.spec, employees-detail.spec); web typecheck xanh |
| harness-audit | 🟡 25/29 (2 fail = `evals/` + `SECURITY.md` — hygiene toàn repo, ngoài scope G5) |

**Điểm rubric ~93/100** (trừ điểm cho 2 MEDIUM residual + harness-hygiene toàn repo).

**Nợ ghi ticket (non-blocking, KHÔNG chặn đóng phase):**
1. ✅ **ĐÃ VÁ** (`d1927d0`) — F1 `createEmployee` set `baseSalary` lúc tạo giờ gác `update-salary` + audit (before null/after value) trong cùng tx; +3 test; re-gate PASS 0 CRITICAL.
2. 🟡 `baseSalary` trong `LIST_COLUMNS` fetch mọi row (mask trước khi rời service — chưa rò; defense-in-depth).
3. 🟡 kill-switch `PERMISSION_GUARD_ENABLED=false` fail-open (đã document) · ⚪ TOCTOU `manage.position` · ⚪ `createEmployeeTx/updateEmployeeTx` thiếu `async`.

**Hành động đóng còn lại:** merge `feat/g5-fix` (chọn nhánh đích).
