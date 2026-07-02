# S2-HR-BE-7 — Employee-code CONFIG admin API

Lane `hrbe7-api`. Source of truth: API-03 §10.10 (HR-API-901/902/903), DB-03 §4.8, S1-FND-SEQ-1.

## Scope delivered

Admin surface for the employee-code FORMAT config + a non-mutating "next code" preview.

| API | Method + route (canonical) | Gate (engine pair) |
| --- | --- | --- |
| HR-API-901 | `GET /api/v1/hr/employee-code-config` | `view:employee-code-config` |
| HR-API-902 | `PATCH /api/v1/hr/employee-code-config` | `update:employee-code-config` |
| HR-API-903 | `POST /api/v1/hr/employee-code/preview` | `preview:employee-code` (seeded mig 0445) |

## Reconcile decisions (spec wins over done_when draft)

- **Route canonical** = `/hr/employee-code-config` (API-03 §10.10), NOT the `/hr/settings/employee-code`
  drafted in `done_when`. FE WO **S2-FE-HR-8** must consume the canonical route.
- **Gate** = the dedicated pair `(view|update, employee-code-config)` (mig 0457), NOT `manage:master-data`.
- `padding` / `reset_policy` / `current_value` live in **`sequence_counters`** (S1-FND-SEQ-1) — this surface
  does NOT extend the `employee_code_configs` schema and NEVER exposes/mutates the counter.

## Invariants

- **#1 tenant**: every read/write via `db.withTenant(companyId)`; repo ANDs `company_id`. Cross-tenant
  read/PATCH proven denied (int-spec RLS case). Body `company_id` is ignored — AuthContext wins.
- **#2 audit append-only**: PATCH writes EXACTLY ONE `audit_logs` row `object_type='employee_code_config'`,
  action `CONFIG_UPDATE`, in the SAME tx (both commit / both roll back). `mediaos_app` UPDATE/DELETE of that
  row is DENIED (int-spec). Migration 0457 UNION-ADDs the object_type to the CHECK (clone 0456/0446) +
  `AUDIT_OBJECT_TYPES` sync — idempotent, no rewrite.
- **#3 no secret/PII in audit**: before/after + old/new snapshot carry the code FORMAT only
  (prefix/pattern/number_length/allow_manual_override/status) — never `current_value`/counter/secret.

## Preview non-mutation

`preview` delegates to `SequenceService.previewNextCode` (no lock, no UPDATE). Int-spec asserts
`sequence_counters.current_value` BEFORE == AFTER. A missing/inactive counter → 422 (never 500).

## Files

- `packages/contracts/src/hr/employee-code-config.ts` — Zod DTOs (GET response, PATCH body w/ value_type
  bounds, preview response) + barrel export.
- `apps/api/src/employees/employee-code-config.{controller,service,repository}.ts` — wired ADDITIVE into
  `EmployeesModule`.
- Tests: `employee-code-config.{controller,service}.spec.ts` (colocated unit, RED-first) +
  `test/integration/employee-code-config.int-spec.ts` (LANE_DB-gated).

## Verify

- Unit: 23 tests green (guard metadata + deny 403, preview-no-mutate, config-only audit, value_type).
- Integration on `mediaos_hrbe7` (chain 0000→0457): 7/7 green — deny 403 + 0 audit, happy PATCH+GET+audit
  changed_fields, preview no-mutation, RLS cross-tenant, append-only DENY, value_type reject-not-persist.
- Regression: `hr-employee-write` (11) + `sequence-concurrent` 0-dup (4) green.
- Migration 0457 re-run = clean no-op (CHECK skip, 0 INSERT, 0 re-scope). Typecheck + build green.

## Follow-ups for other lanes

- **S2-FE-HR-8** (FE): consume canonical `/hr/employee-code-config` + `/hr/employee-code/preview`; add the
  `view/update:employee-code-config` → engine-pair mapping in web-core (PERMISSION_CODE_TO_PAIR).
- **QA (Đội 3)**: acceptance in this WO; note DTO-boundary validation returns 400 (nestjs-zod), not 422.

Validation note: the QA line said "422 khi sai" for value_type; the nestjs-zod `ZodValidationPipe` rejects
schema violations with **400** at the boundary (before the service). The load-bearing guarantee (bad
value_type rejected + not persisted + no audit) holds; the status code is 400 per framework convention.
