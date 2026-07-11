# S4-NOTI-SEED-2 — Vá catalog NOTI khớp payload TASK BE-3 (migration 0490)

> Lane `notiSeed2Mig` (Đội 2 — Thực thi). Nợ từ plan-review S4-TASK-BE-3 (PR #150): catalog 0481 lệch
> Event-code registry §9.5 vs Producer §9.4 mà BE-3 thật sự phát ⇒ notification priority/deadline/assignee
> IM LẶNG (đúng lớp bug TASK_MENTIONED). WO này BẮT BUỘC land TRƯỚC S4-INT-1.

## Head-note (RECONCILE 2026-07-11)

- Head THẬT khi tạo (verify `ls apps/api/migrations/*.sql | tail -1`): **0488** (idx 168). Nhánh HR **0489**
  (`0489_hr_profile_personal_fields`, idx 169) CHƯA merge master tại thời điểm cắt worktree ⇒ **reserve gap**.
- Áp dụng convention `idx = fileNum − 320` (0484→164 … 0488→168): file **0490 → idx 170**, `when`
  **1717500845000** (> 1717500840000 reserve cho idx 169/0489). Gap idx 169 do nhánh HR lấp khi merge.
- Drizzle migrator TOLERATE gap (áp 0488@168 → 0490@170 sạch trên DB cô lập — đã verify). Số file `.sql` ==
  số entry journal (cả hai bỏ qua 0489/169) ⇒ db-check count KHÔNG vỡ.

## Phạm vi (THUẦN DATA — KHÔNG DDL, KHÔNG drizzle db:generate)

Seed qua migrator owner-bypass (DATABASE_DIRECT_URL = role owner `mediaos`, rolbypassrls). RLS+FORCE + policy
đã tạo Ở 0479 TRƯỚC seed — 0490 CHỈ INSERT/UPDATE data GLOBAL (company_id NULL). KHÔNG chạm
permissions/role_permissions.

1. INSERT event GLOBAL `TASK_PRIORITY_CHANGED` (Task/Normal/["IN_APP"]/enabled) — ON CONFLICT DO NOTHING.
2. `TASK_DEADLINE_CHANGED → TASK_DUE_DATE_CHANGED` **APPEND-SAFE** (DO-block): rename in-place (giữ id ⇒ FK
   nguyên vẹn) NẾU chưa có canonical + KHÔNG notifications tham chiếu; else giữ canonical + disable legacy.
   TUYỆT ĐỐI KHÔNG DELETE.
3. UPDATE `TASK_ASSIGNEE_CHANGED` SET is_enabled=true.
4. INSERT 3 template IN_APP/vi-VN (`<EVENT>__IN_APP__vi-VN`, status Active, is_default, body NOT NULL) —
   `variables_schema` = ĐÚNG bộ key camelCase payload BE-3 (task-actions.service.ts commonPayload + field
   từng use-case). Placeholder {key} ⊆ variables_schema.
5. VÁ RENDER 0481 (IN-SCOPE): `TASK_ASSIGNED` (`{task_code}/{task_title}`→`{taskCode}/{taskTitle}`) +
   `TASK_STATUS_CHANGED` (`{task_code}/{new_status}`→`{taskCode}/{toStatus}` — payload là **toStatus**,
   KHÔNG newStatus). Idempotent theo template_code.

## variables_schema camelCase (đối chiếu task-actions.service.ts — HARD-CODE trong contract test)

- `TASK_PRIORITY_CHANGED`: taskId, taskTitle, taskCode, projectId, actorUserId, actorEmployeeId, oldPriority, newPriority, assigneeUserId
- `TASK_DUE_DATE_CHANGED`: taskId, taskTitle, taskCode, projectId, actorUserId, actorEmployeeId, oldDueAt, newDueAt, assigneeUserId
- `TASK_ASSIGNEE_CHANGED`: taskId, taskTitle, taskCode, projectId, actorUserId, actorEmployeeId, oldAssigneeEmployeeId, assigneeEmployeeId, assigneeUserId

## Registry sync (notification-event-catalog.const.ts) + regression

- Event: 52 → **53** (thêm TASK_PRIORITY_CHANGED). Enabled: 36 → **39** (PRIORITY + ASSIGNEE_CHANGED +
  DUE_DATE_CHANGED). Disabled dư: 16 → 14. TASK_DEADLINE_CHANGED CHUYỂN sang DUE_DATE (enabled).
- Pin `noti-seed-catalog-permissions.int-spec.ts` dòng 90/91: `toBe(52)→53`, `toBe(36)→39`.
- Regression-gate BẮT BUỘC: seed-1 spec XANH trên CÙNG LANE_DB (DB↔registry 1-1).

## Kiểm chứng (DB cô lập mediaos_notiseed2)

- `bash scripts/lane-db-setup.sh notiseed2 --reset` → chain 0000→0490 sạch (gap idx 169 tolerate).
- `noti-seed2-be3-catalog.int.spec.ts` (20) XANH: 5 mã enabled, DEADLINE 0 row, findActiveTemplate resolve,
  contract variables_schema, idempotency (re-exec 0490 ×2 count không đổi), append-safe + RLS/FORCE,
  Engine E2E TASK_PRIORITY_CHANGED createdCount≥1 fallback=false.
- `noti-seed-catalog-permissions.int-spec.ts` (151) + `noti-event-intake.int-spec.ts` (20) XANH.

```yaml
wo: S4-NOTI-SEED-2
lane: notiSeed2Mig
migration:
  file: apps/api/migrations/0490_s4_notiseed2_task_be3_event_catalog.sql
  journal_idx: 170
  journal_when: 1717500845000
  head_note: "head THẬT 0488/idx168 khi cắt worktree; 0489/idx169 (HR) reserve gap; 0490/idx170"
  pure_data: true
  ddl: false
  db_generate: false
events_enabled_after: [TASK_ASSIGNED, TASK_ASSIGNEE_CHANGED, TASK_STATUS_CHANGED, TASK_PRIORITY_CHANGED, TASK_DUE_DATE_CHANGED]
deadline_rename: TASK_DEADLINE_CHANGED->TASK_DUE_DATE_CHANGED (in-place, append-safe, no-delete)
registry_counts: { events: 53, enabled: 39, disabled: 14 }
render_patch_0481: [TASK_ASSIGNED, TASK_STATUS_CHANGED]  # snake->camelCase, STATUS uses toStatus
tests_green_on_lane_db:
  - src/foundation/seed/noti-seed2-be3-catalog.int.spec.ts
  - test/integration/noti-seed-catalog-permissions.int-spec.ts
  - test/integration/noti-event-intake.int-spec.ts
invariants:
  rls_force_touched: false
  hard_delete: false
  permissions_touched: false
```
