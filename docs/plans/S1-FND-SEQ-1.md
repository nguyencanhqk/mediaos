# Micro-plan — S1-FND-SEQ-1 (SequenceService)

> Đội 1 phân rã. RECONCILE-FIRST: service/repo/formatter/test ĐÃ tồn tại và đạt phần lớn done_when.
> Delta actionable = `ensureCounter` (BACKEND-04 §11.5) + chốt reconcile (audit-on-PATCH, no-tamper current_value).

## Nguồn
- DB-08 §8.9 (sequence_counters: FOR UPDATE, KHÔNG MAX(code)+1, reset theo last_reset_at, audit mọi update config)
- BACKEND-04 §8.6 / §9.7 / §11.5 / §14.5 (interface có `ensureCounter`; API preview = FOUNDATION.SEQUENCE.VIEW)
- DECISIONS-02 (3 bất biến: company_id+RLS+FORCE · append-only audit · no secret plaintext)
- QA-02 §FOUNDATION-SEQ-001/002, §HR-CODE-002 · QA-06 §MOD-SYS-005

## Trạng thái hiện có (GIỮ — đã khớp spec)
- nextCode: withTenant tx → lockCounterForUpdateTx (FOR UPDATE) → computeNextValue (reset Never/Yearly/Monthly/Daily theo tz) → renderCode → updateCounterValueTx. KHÔNG MAX(code)+1. ✓
- previewNextCode: findCounterTx (no lock) → KHÔNG mutate. ✓
- updateSequence (admin PATCH): tx withTenant, ghi audit sequence_counter/SequenceUpdated, before/after = config (KHÔNG current_value/secret). ✓ anti-tamper: updateConfigTx KHÔNG set current_value.
- integration: 20 nextCode song song → 0 dup, value 1..N liên tục; isolation tenant A↛B; Inactive deny; Monthly reset. ✓
- unit spec: lock-path, Inactive, NotFound, reset Never/Monthly/Daily, preview-no-mutate, audit-no-current_value. ✓

## Delta cần làm (GAP)
1. `ensureCounter(input: EnsureSequenceCounterInput)` ở SequenceService — idempotent upsert counter theo
   (company_id, sequence_key, scope_type, COALESCE(scope_reference_id)) cho seed/module-init. Repo thêm
   `upsertCounterTx` dùng ON CONFLICT DO NOTHING (mirror partial-unique mig 0434, WHERE deleted_at IS NULL).
   KHÔNG reset current_value nếu đã tồn tại (idempotent). Audit khi tạo MỚI (SequenceCreated) — KHÔNG khi đã có.
2. Verify reconcile (không churn): scope_type Department dùng scope_reference_id (DB-08 §8.9 rule 5) — đảm bảo
   counterWhere COALESCE đã phủ; bổ test nếu thiếu.

## OUT-OF-SCOPE (lane khác)
- Controller + permission guard /foundation/sequences/* (FOUNDATION.SEQUENCE.VIEW/UPDATE) → S1-FND-WIRE-1.
- Zod contracts /foundation/sequences → S1-FND-WIRE-1 (packages/contracts/src/foundation/**).
- QA hardening tổng hợp Foundation → S1-QA-FND-1.

## Invariants áp dụng
- BẤT BIẾN #1: mọi đường qua withTenant; repo lọc eq(company_id) defense-in-depth dù RLS+FORCE.
- BẤT BIẾN #2: KHÔNG hard-delete; audit append-only (record qua AuditService trong tx).
- BẤT BIẾN #3: KHÔNG secret trong audit before/after (chỉ config hình thức mã).
- Migration: KHÔNG cần (schema+RLS landed mig 0434). KHÔNG db:generate drop.

## Gate
- LIGHT→FULL: chạm audit append-only + tenant isolation ⇒ security-reviewer + silent-failure-hunter +
  database-reviewer + typescript-reviewer. RED deny-path TRƯỚC cho ensureCounter (cross-tenant không rò).
