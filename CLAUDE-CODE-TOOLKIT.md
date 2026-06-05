# CLAUDE-CODE-TOOLKIT — MediaOS

> **Artifact 2/3** của bộ harness. Bản đồ công cụ Claude Code cho dự án MediaOS.
> Trả lời câu hỏi: _"Task này dùng agent/skill/hook nào, model nào, custom component nào?"_
> Đọc kèm `CLAUDE.md` (hợp đồng vận hành) và `TASKS.md` (kế hoạch thực thi).

---

## 0. Cách đọc file này

- Cột **ECC** = agent/skill có sẵn trong bộ ECC (gọi qua Skill tool hoặc Agent tool, tiền tố `ecc:`).
- Cột **Custom** = thành phần CHƯA có, phải tự tạo (spec ở §5).
- **Model** = Haiku / Sonnet / Opus theo độ khó (luật §6 CLAUDE.md).
- Nguyên tắc bao trùm: **search-first** (`ecc:search-first`, `gh search`) trước khi viết mới; **review gate phân tầng** sau khi viết.

---

## 1. Harness lõi (đã cài — Artifact 1)

| Thành phần               | Vị trí           | Vai trò                                                |
| ------------------------ | ---------------- | ------------------------------------------------------ |
| `CLAUDE.md`              | root             | 3 bất biến + luật phụ thuộc + tech stack + review gate |
| `.claude/settings.json`  | —                | Đăng ký hooks + permissions + env                      |
| `guard-tenant.mjs`       | `.claude/hooks/` | Chặn query thiếu `company_id` / không qua `withTenant` |
| `guard-immutability.mjs` | `.claude/hooks/` | Chặn UPDATE/DELETE/hard-delete bảng audit/snapshot     |
| `guard-secrets.mjs`      | `.claude/hooks/` | Chặn secret plaintext / pgcrypto-in-SQL / log secret   |

> 3 hook = ép tự động 3 bất biến. Nếu hook chặn nhầm → sửa pattern hook, KHÔNG bypass.

**Cài đặt skill lõi 1 lần (G0-6):**

```text
ecc:configure-ecc          # cấu hình harness
ecc:agent-sort             # chỉ nạp skill/agent dự án thật cần (tránh phình context)
ecc:project-init           # khi bootstrap monorepo (G1-1)
```

---

## 2. Bản đồ ECC theo Giai đoạn

### G0 — Quyết định & Thiết kế

| Task                         | ECC                                   | Custom                           | Model  |
| ---------------------------- | ------------------------------------- | -------------------------------- | ------ |
| G0-1 Chốt scope MVP-0        | `ecc:planner`, `ecc:plan-prd`         | —                                | Opus   |
| G0-2 Viết ADR                | `ecc:architecture-decision-records`   | —                                | Opus   |
| G0-3 Spike Workflow FSM      | `ecc:architect`                       | `workflow-statemachine-designer` | Opus   |
| G0-4 Spike Permission Matrix | `ecc:type-design-analyzer`            | `permission-matrix-spec`         | Opus   |
| G0-5 Hạ tầng $0              | `ecc:deep-research`                   | —                                | Sonnet |
| G0-6 Harness                 | `ecc:configure-ecc`, `ecc:agent-sort` | —                                | Sonnet |

### G1 — Bootstrap repo & hạ tầng

| Task                     | ECC                                                               | Custom                                                         | Model  |
| ------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------- | ------ |
| G1-1 Monorepo pnpm+Turbo | `ecc:project-init`                                                | —                                                              | Sonnet |
| G1-2 Docker Compose      | `ecc:docker-patterns`                                             | —                                                              | Haiku  |
| G1-3 Drizzle + migration | `ecc:postgres-patterns`, `ecc:database-migrations`                | —                                                              | Sonnet |
| G1-4 NestJS skeleton     | `ecc:nestjs-patterns`, `ecc:api-design`                           | —                                                              | Sonnet |
| G1-5 Vite+React skeleton | `ecc:frontend-patterns`, `ecc:design-system`, `ecc:vite-patterns` | —                                                              | Sonnet |
| G1-6 CI                  | —                                                                 | `ci-pipeline-generator`                                        | Sonnet |
| G1-7 Hooks guardrail     | `ecc:hookify`, `ecc:hookify-rules`                                | `tenant-isolation-guard`, `no-hard-delete`, `secret-scan-gate` | Sonnet |
| G1-8 Backup pg_dump→B2   | `ecc:terminal-ops`                                                | —                                                              | Haiku  |

### G2 — Nền bảo mật & đa-tenant (FULL gate toàn bộ)

| Task                            | ECC                                                | Custom                        | Model |
| ------------------------------- | -------------------------------------------------- | ----------------------------- | ----- |
| G2-1 App DB role non-superuser  | `ecc:postgres-patterns`, `ecc:database-reviewer`   | —                             | Opus  |
| G2-2 `withTenant()` wrapper     | `ecc:postgres-patterns`                            | —                             | Opus  |
| G2-3 Bảng nền + RLS             | `ecc:database-migrations`, `ecc:database-reviewer` | —                             | Opus  |
| G2-4 Audit + outbox + event bus | `ecc:silent-failure-hunter`                        | `event-outbox-audit-guide`    | Opus  |
| G2-5 Test 2-tenant đối kháng    | `ecc:tdd-guide`                                    | `rls-tenant-isolation-tester` | Opus  |
| G2-6 Auth                       | `ecc:security-reviewer`, `ecc:error-handling`      | —                             | Opus  |

### G3 — Permission Engine (FULL gate)

| Task                           | ECC                                         | Custom                   | Model  |
| ------------------------------ | ------------------------------------------- | ------------------------ | ------ |
| G3-1 Bảng RBAC                 | `ecc:database-reviewer`                     | —                        | Sonnet |
| G3-2 `PermissionService.can()` | `ecc:type-design-analyzer`, `ecc:architect` | `permission-matrix-spec` | Opus   |
| G3-3 Test deny-path TRƯỚC      | `ecc:tdd-guide`, `ecc:tdd-workflow`         | —                        | Opus   |
| G3-4 Guards + cache Valkey     | `ecc:nestjs-patterns`, `ecc:redis-patterns` | —                        | Sonnet |
| G3-5 FE `<PermissionGate>`     | `ecc:react-patterns`, `ecc:frontend-a11y`   | —                        | Sonnet |

### G4 — 🎯 MVP-0 Walking Skeleton

| Task                           | ECC                                                   | Custom                         | Model  |
| ------------------------------ | ----------------------------------------------------- | ------------------------------ | ------ |
| G4-1 Org/Employee              | `ecc:nestjs-patterns`, `ecc:react-patterns`           | —                              | Sonnet |
| G4-2 Channel/Project/Content   | `ecc:feature-dev`                                     | —                              | Sonnet |
| G4-3 1 workflow cứng           | `ecc:architect`                                       | `workflow-state-machine-guide` | Opus   |
| G4-4 My Tasks + submit         | `ecc:tdd-workflow`                                    | —                              | Sonnet |
| G4-5 Approval 1 cấp + return   | `ecc:tdd-workflow`                                    | —                              | Sonnet |
| G4-6 Notification + group chat | `ecc:nestjs-patterns`                                 | —                              | Sonnet |
| G4-7 E2E full vòng đời         | `ecc:e2e-runner`, `ecc:e2e-testing`, `ecc:browser-qa` | —                              | Sonnet |
| G4-8 Pilot 1 team              | `ecc:canary-watch`                                    | —                              | Haiku  |

### G5 — Mở rộng module (mỗi module: `ecc:prp-plan` → TDD → implement → review gate)

| Module                            | ECC                                              | Custom                                                                                       | Model  |
| --------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------ |
| G5a Workflow Builder (React Flow) | `ecc:a11y-architect`, `ecc:frontend-patterns`    | `workflow-statemachine-tester`                                                               | Opus   |
| G5b Approval 3 cấp + KPI          | `ecc:prp-plan`, `ecc:tdd-workflow`               | —                                                                                            | Sonnet |
| G5c Chat realtime + Meeting       | `ecc:nestjs-patterns`, `ecc:redis-patterns`      | `realtime-test-harness`                                                                      | Opus   |
| G5d Attendance + Leave            | `ecc:tdd-workflow`                               | —                                                                                            | Sonnet |
| G5e Platform Account Encryption   | `ecc:security-reviewer`                          | `secret-encryption-reviewer`, `envelope-encryption-auditor`, `kms-provisioning-and-rotation` | Opus   |
| G5f Payroll + Bonus/Penalty       | `ecc:santa-method`, `ecc:security-reviewer`      | `payroll-snapshot-immutability-guard`, `immutable-snapshot-architect`                        | Opus   |
| G5g Finance                       | `ecc:database-reviewer`, `ecc:santa-method`      | `immutable-snapshot-architect`                                                               | Opus   |
| G5h Dashboard theo role           | `ecc:dashboard-builder`, `ecc:frontend-patterns` | —                                                                                            | Sonnet |
| G5i Mobile RN                     | `ecc:flutter-review`\*, `ecc:frontend-a11y`      | `react-native-reviewer/patterns/build-fix/push`                                              | Sonnet |

\* ECC chưa có reviewer React Native riêng → tạm dùng pattern chung + custom `react-native-*`.

### GX — Xuyên suốt (mọi sprint)

| Task                                        | ECC                                                       |
| ------------------------------------------- | --------------------------------------------------------- |
| GX-1 Review gate phân tầng                  | xem §3                                                    |
| GX-2 Test deny-path + coverage ≥80%         | `ecc:tdd-guide`, `ecc:test-coverage`                      |
| GX-3 Audit + event mọi hành động            | `ecc:silent-failure-hunter`                               |
| GX-4 Migration an toàn (RLS trước backfill) | `ecc:database-migrations`                                 |
| GX-5 Backup + health + audit harness        | `ecc:canary-watch`, `ecc:harness-audit` (cuối G2/G5b/G5f) |
| GX-6 Theo dõi chi phí + model routing       | `ecc:cost-tracking`, `ecc:model-route`                    |
| GX-7 i18n (vi) + timezone                   | `ecc:documentation-lookup`                                |

---

## 3. Review gate phân tầng (§6 CLAUDE.md) — bảng quyết định

```text
diff chạm: permission / RLS / secret / payroll / audit ?
   ├─ CÓ  → FULL gate:
   │         ecc:security-reviewer + ecc:database-reviewer + ecc:silent-failure-hunter
   │         (+ ecc:santa-method nếu là crown-jewel: payroll, permission algebra, FSM)
   └─ KHÔNG (CRUD/UI thường) → LIGHT gate:
             ecc:typescript-reviewer + ecc:quality-gate
```

- FE chạm `.tsx/.jsx` → thêm `ecc:react-review`.
- Trước khi đóng Giai đoạn G2 / G5b / G5f → chạy `ecc:harness-audit`.
- Trước commit nhánh chung → `ecc:security-scan` + `ecc:security-review`.

---

## 4. Hooks guardrail — đặc tả 3 hook lõi (G1-7)

| Hook                     | Sự kiện                 | Chặn khi                                                                            | Pass khi                                                 |
| ------------------------ | ----------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `tenant-isolation-guard` | PreToolUse (Edit/Write) | Repository/query SQL không có `company_id` hoặc không bọc `withTenant(`             | Mọi data-access qua `withTenant`                         |
| `no-hard-delete`         | PreToolUse (Edit/Write) | `DELETE FROM`/`.delete(` trên bảng audit/snapshot; thiếu `deleted_at` ở soft-delete | Soft-delete; append-only tables không bị UPDATE/DELETE   |
| `secret-scan-gate`       | PreToolUse + PreCommit  | Secret plaintext, pgcrypto-in-SQL, log/DTO chứa secret                              | Envelope encryption app-side; secret không rò ra log/DTO |

> Hiện đã có bản `.mjs` tương ứng (`guard-tenant`, `guard-immutability`, `guard-secrets`). G1-7 = nâng lên CI check (`*-ci-check`) để chạy cả ngoài Claude Code.

---

## 5. Custom components phải tự tạo — đặc tả tóm tắt

> ECC chưa có. Tạo trong `.claude/agents/`, `.claude/skills/`, `.claude/hooks/`. Mỗi cái kèm test riêng.

| Tên                                                 | Loại         | Dùng ở     | Mục tiêu / Tiêu chí done                                                                                                                              |
| --------------------------------------------------- | ------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow-statemachine-designer`                    | agent        | G0-3, G4-3 | Sinh bảng `workflow_transitions` + luật "khóa phần liên quan" + auto-sinh task. Done: transition hợp lệ duy nhất, không deadlock, có guard điều kiện. |
| `workflow-statemachine-tester`                      | agent        | G5a        | Fuzz mọi đường đi FSM; phát hiện transition mồ côi / vòng lặp / bước song song hỏng DAG.                                                              |
| `permission-matrix-spec`                            | skill        | G0-4, G3-2 | Nguồn sự thật RBAC×Scope×Object×Sensitive + danh sách deny-case. Done: mọi sensitive-permission KHÔNG kế thừa; sinh được test deny-path.              |
| `immutable-snapshot-architect`                      | agent        | G5f, G5g   | Thiết kế bảng snapshot append-only (payslip/kpi/profit); cấm UPDATE; khóa kỳ trước khi tính.                                                          |
| `event-outbox-audit-guide`                          | skill        | G2-4       | Transactional outbox + audit bất biến + event bus idempotent + dead-letter + alert khi drop.                                                          |
| `tenant-isolation-guard` / `-ci-check`              | hook         | G1-7       | Ép `company_id`/`withTenant`; chạy cả trong Claude Code và CI.                                                                                        |
| `rls-tenant-isolation-tester`                       | agent        | G2-5       | Seed 2 tenant A/B; assert mọi path trả 0 row của B khi login A.                                                                                       |
| `secret-encryption-reviewer`                        | agent        | G5e        | Soát envelope encryption app-side; chặn pgcrypto-in-SQL & secret rò DTO.                                                                              |
| `envelope-encryption-auditor`                       | skill        | G5e        | Audit DEK/KEK, rotation, reveal-secret + re-auth + audit.                                                                                             |
| `sensitive-action-audit-hook`                       | hook         | G5e        | Ép audit log cho mọi hành động nhạy cảm (reveal secret, đổi quyền).                                                                                   |
| `payroll-snapshot-immutability-guard`               | hook         | G5f        | Chặn sửa payslip đã chốt; ép khóa kỳ KPI trước khi chạy lương.                                                                                        |
| `secret-scan-gate`                                  | hook/skill   | G1-7       | Quét secret pre-commit (xem §4).                                                                                                                      |
| `ci-pipeline-generator`                             | skill        | G1-6       | Sinh CI: lint+typecheck+test trên Postgres ephemeral + assert RLS-trước-backfill.                                                                     |
| `react-native-*` (reviewer/patterns/build-fix/push) | agent/skill  | G5i        | Bộ công cụ RN: review, pattern, fix build, push FCM.                                                                                                  |
| `realtime-test-harness`                             | custom       | G5c        | Test WS lifecycle: connect/reconnect, presence cross-tenant, ordering, room `co:{companyId}`.                                                         |
| `kms-provisioning-and-rotation`                     | custom infra | G5e        | Provision KMS/Vault, rotation key, break-glass.                                                                                                       |

**Thứ tự tạo custom (theo phụ thuộc):**

1. G1-7 hooks (`tenant-isolation-guard`, `no-hard-delete`, `secret-scan-gate`) → đã có bản `.mjs`, nâng CI.
2. `event-outbox-audit-guide` + `rls-tenant-isolation-tester` (G2).
3. `permission-matrix-spec` + `workflow-statemachine-designer` (G0/G3/G4).
4. Phần nhạy cảm muộn: `immutable-snapshot-architect`, `*-encryption-*`, `payroll-*`, `react-native-*`, `realtime-test-harness`, `kms-*`.

---

## 6. Model routing (GX-6) — bảng nhanh

| Loại task                                                                              | Model      | Lý do                      |
| -------------------------------------------------------------------------------------- | ---------- | -------------------------- |
| build-fix, CRUD đơn, docs, format, Docker                                              | **Haiku**  | rẻ, đủ năng lực            |
| phát triển module, FE component, API thường                                            | **Sonnet** | cân bằng                   |
| spike khó: workflow FSM, permission algebra, payroll/finance snapshot, ADR, RLS design | **Opus**   | reasoning sâu, crown-jewel |

> Theo dõi chi phí: `ecc:cost-tracking` / `ecc:cost-report`. Định tuyến: `ecc:model-route`.

---

## 7. Lệnh tham chiếu nhanh

```text
# Lập kế hoạch module
/ecc:prp-plan  hoặc  /ecc:plan

# TDD
/ecc:tdd-workflow      # bất kỳ ngôn ngữ
/ecc:react-test        # FE
# (backend NestJS: tdd-workflow + nestjs-patterns)

# Review
/ecc:code-review               # local diff
/ecc:security-review           # bảo mật
/ecc:database-reviewer (agent) # SQL/migration/RLS

# Hạ tầng / vận hành
/ecc:harness-audit             # cuối G2/G5b/G5f
/ecc:canary-watch              # sau deploy
/ecc:cost-tracking             # chi phí
```

---

_Liên kết: `CLAUDE.md` (hợp đồng) · `TASKS.md` (kế hoạch) · `TECH-DECISION-RECORD.md` (quyết định kiến trúc — Artifact 3)._
