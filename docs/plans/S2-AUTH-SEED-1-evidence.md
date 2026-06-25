# S2-AUTH-SEED-1 — Test evidence (verified on real isolated LANE_DB)

> Reproduced 2026-06-25 to close the QA-test-engineer evidence gaps (RED-before-GREEN artifact,
> committed coverage report, integration tests run on a real isolated LANE_DB). All numbers below
> were produced on PostgreSQL 17 (`mediaos-postgres` container), isolated lane DBs, from this branch.

## 1. Migration chain applies clean (0000 → 0444)

```
bash scripts/lane-db-setup.sh authseed1 --reset    # creates mediaos_authseed1, chain 0000→0444
[lane-db] ✅ mediaos_authseed1 sẵn sàng (chain 0000→latest áp sạch).
```

Band idx 127, file `0444_s2_authseed1_canonical_roles_perms.sql`, `_journal.json when=1717500620000`
(> head `0443` when=1717500610000). Forward-only, additive, no `db:generate` drop.

## 2. RED-before-GREEN (real, not a tautology)

Same spec file run against the **0443 baseline** (no `0444` seed) vs the **0444** DB:

| DB state | Command | Result |
| --- | --- | --- |
| **RED** — head `0443` (no seed) | `LANE_DB=mediaos_authseed1red vitest run test/integration/auth-seed-canonical-roles.int-spec.ts` | **48 failed / 18 passed (66)** |
| **GREEN** — head `0444` (seed applied) | `LANE_DB=mediaos_authseed1 vitest run …` (3 spec files) | **81 passed / 0 failed (81)** |

The 48 seed-assertion failures at `0443` collapse to 0 once `0444` is applied → the tests genuinely
exercise the seed (per-pair `data_scope`, canonical roles, grants), they don't pass vacuously.

## 3. GREEN — full WO spec run on mediaos_authseed1 (head 0444)

```
LANE_DB=mediaos_authseed1 pnpm --filter @mediaos/api exec vitest run \
  src/permission/super-admin-bootstrap.service.spec.ts \
  test/integration/super-admin-bootstrap.int-spec.ts \
  test/integration/auth-seed-canonical-roles.int-spec.ts

 ✓ test/integration/auth-seed-canonical-roles.int-spec.ts (66 tests)
 ✓ src/permission/super-admin-bootstrap.service.spec.ts (6 tests)
 ✓ test/integration/super-admin-bootstrap.int-spec.ts (9 tests)
 Test Files  3 passed (3)
      Tests  81 passed (81)
```

Runtime log confirms the bootstrap path: `super-admin seeded (company=…, role granted 259 catalog
permissions)` and idempotent re-boot (no duplicate user/role/user_role).

## 4. Coverage ≥ 80% on the sensitive area (v8, measured on LANE_DB)

`vitest run … --coverage --coverage.provider=v8 --coverage.include=src/permission/super-admin-bootstrap.*`

| File | % Stmts | % Branch | % Funcs | % Lines |
| --- | --- | --- | --- | --- |
| **All files** | **96.66** | **86.2** | **90** | **96.66** |
| `super-admin-bootstrap.service.ts` | 98.24 | 90.9 | 80 | 98.24 |
| `super-admin-bootstrap.repository.ts` | 93.93 | 71.42 | 100 | 93.93 |

(Raw `coverage-summary.json` — `coverage/` is gitignored; totals: lines 174/180, statements 174/180,
functions 9/10, branches 25/29.)

## Reproduce

```
# GREEN + coverage
cd <this worktree> && bash "../MediaOS/scripts/lane-db-setup.sh" authseed1 --reset
LANE_DB=mediaos_authseed1 pnpm --filter @mediaos/api exec vitest run \
  src/permission/super-admin-bootstrap.service.spec.ts \
  test/integration/super-admin-bootstrap.int-spec.ts \
  test/integration/auth-seed-canonical-roles.int-spec.ts --coverage

# RED baseline (run lane-db-setup from a checkout at head 0443, e.g. master)
cd <repo at 0443> && bash scripts/lane-db-setup.sh authseed1red --reset
LANE_DB=mediaos_authseed1red pnpm --filter @mediaos/api exec vitest run \
  test/integration/auth-seed-canonical-roles.int-spec.ts   # → 48 failed / 18 passed
```
