# S3-ATT-BE-3 — Shift/Rule/Assignment (minimum) + effective-resolve + audit-in-tx

Crown-jewel micro-plan / decision record. Nguồn nghiệp vụ: IMPLEMENTATION-06 §8.3/§10.1, API-04, DB-04
§7.1/7.2/7.3/§12/§16, SPEC-01 §16.3 (audit "hành động quan trọng"). Bất biến: CLAUDE.md §2.

## Phạm vi

- `GET /attendance/shifts` (list) · `GET /attendance/rules/effective` — permission `ATT.SHIFT.VIEW` /
  `ATT.RULE.VIEW`; `getEffectiveShiftRule` TÁI DÙNG `AttendanceService.resolveShiftAndRule` (S3-ATT-BE-1)
  — MỘT hiện thực thứ tự ưu tiên Employee≻Department≻Company≻System cho cả check-in/out/today lẫn read
  standalone.
- CRUD shift/rule/assignment MỨC TỐI THIỂU (create/update; no delete/bulk/filter — nâng cao = carry-over
  **CO-S4-007**), permission CREATE/UPDATE/CONFIG.
- **Audit-in-tx** cho mọi config-mutation (WO fix round S3-ATT-BE-3-FIX-AUDIT-WIRE).

## Audit (AC#3) — quyết định

Config của shift/rule/assignment đổi cách tính công TOÀN công ty ⇒ 'hành động quan trọng' (SPEC-01
§16.3 / DoD §8 / bất biến #2). 5 call-site ghi audit IN-TX (cùng `withTenant` tx → cùng commit/rollback):

| Service method            | action                     | object_type        | actionGroup   |
| ------------------------- | -------------------------- | ------------------ | ------------- |
| `createShift`             | `ShiftCreated`             | `shift`            | CREATE        |
| `updateShift`             | `ShiftUpdated`             | `shift`            | CONFIG_UPDATE |
| `createRule`              | `RuleCreated`              | `attendance_rule`  | CREATE        |
| `updateRule`              | `RuleUpdated`              | `attendance_rule`  | CONFIG_UPDATE |
| `createShiftAssignment`   | `ShiftAssignmentCreated`   | `shift_assignment` | CREATE        |

- `before`/`after` (+ `oldValues`/`newValues` trên update) = **snapshot cấu hình ONLY**
  (`shiftSnapshot`/`ruleSnapshot`/`assignmentSnapshot` = DTO mapper strip `createdAt`/`updatedAt`). Bảng
  KHÔNG có cột secret/PII; `AuditService` mask lần nữa trước insert — **bất biến #3**.
- 404 (row không tồn tại / tenant khác) → throw TRƯỚC audit ⇒ KHÔNG ghi audit giả cho mutation không xảy ra.

## Scope reconcile (paths ↔ done_when)

Reviewer (Đội 3) chỉ ra `paths` cũ (`apps/api/src/attendance/**` + contracts) LOẠI TRỪ migration/schema,
trong khi audit đòi mở rộng CHECK `audit_logs.object_type`. Chọn **option (a)**: giao audit TRỌN trong WO
này → mở rộng `paths` thêm `apps/api/migrations/**` + `apps/api/src/db/schema/audit.ts`.

- **Migration 0457** (`0457_s3_attbe3_shift_rule_audit_object_type.sql`): DO-block UNION ADD-only (clone
  0456/0446/0440) thêm `shift`/`attendance_rule`/`shift_assignment` vào CHECK — idempotent, KHÔNG rewrite
  cứng, KHÔNG đụng RLS/grant/FORCE (append-only #2 nguyên vẹn). Journal idx 137.
- `AUDIT_OBJECT_TYPES` (schema/audit.ts) sync 3 giá trị CÙNG commit.

## Test (RED → GREEN)

- `attendance-shift.service.spec.ts` (unit, no-DB, 16 total): +6 audit-wiring — `record()` gọi trên CÙNG
  tx sentinel, đúng object_type/action, snapshot config-only (assert KHÔNG có key secret/PII/timestamp),
  và KHÔNG ghi audit khi update 404 (fail-closed, no false trail).
- `test/integration/att-core-tenant-deny.int-spec.ts` (HTTP, gate `hasDb && LANE_DB`, +6): audit
  ShiftCreated/Updated/RuleCreated/AssignmentCreated LAND trong `audit_logs` đúng object_type (chứng minh
  CHECK 0457 hoạt động trên Postgres thật) + **QA-06 2-tenant WRITE deny** — tenant B dùng shiftId/ruleId
  của A để PATCH → 404, hàng A KHÔNG đổi, KHÔNG có audit-row xuyên tenant.

## Verify

- Lane DB cô lập `mediaos_s3attbe3fix` (chain 0000→0457): `pnpm --filter @mediaos/api test` — attendance
  **336 PASS** (gồm sibling int-specs chạy với audit đã wire). `typecheck` green.

## Carry-over

- **CO-S4-007**: CRUD nâng cao (delete/bulk/filter/list phân trang shift-rule admin) + applied_rule
  snapshot lịch sử đầy đủ (rule đổi KHÔNG sai dữ liệu quá khứ — DB-04 §16, phần compute nằm ở luồng
  attendance_records của S3-ATT-BE-1).
