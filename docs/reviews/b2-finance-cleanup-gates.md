# B2+B3 — Finance cleanup · Gate record

Lane `feat/b2-finance-cleanup` off master `0ecd684`. Commit impl `4a366a7`. **KHÔNG migration.**

## Nội dung
- **B2(a) pagination** revenue/cost/allocation — `financePaginationFields` Zod `limit [1..100] default 50` / `offset ≥0 default 0`, **REJECT** out-of-range (400), thread service→repo, `orderBy(date,id)` tie-break deterministic, repo `?? DEFAULT` belt-and-suspenders (không unbounded).
- **B2(b) gỡ N+1** `cost-allocation.service.allocate` — `insertManyTx` (1 multi-row INSERT) + `existingTargetKeysTx` (≤6 query, batch target-guard `= ANY(string_to_array($csv,',')::uuid[])`) trong 1 `withTenant` tx (soft-delete-old + insert-new atomic). Bug thật đã sửa: array-bind cũ `= ANY(${uniqueIds}::uuid[])` ném `malformed array literal` → đổi sang pattern `kpi.repository.ts`.
- **B2(c) masking parity** — list revenue/cost mask SERVER-side đồng nhất `ProfitService` (`canViewFinance` view-finance+isSensitive, fail-safe `catch→false→mask`, amount=null khi thiếu quyền).
- **B3 overflow guard** `revenue Number()>2^53` — `amountToCents` guard `Number.isSafeInteger(round(v*100))` ném `MoneyError` → `BadRequestException` 400 (fail-LOUD), thay `numToStr` cũ `toFixed(2)` lossy âm thầm; ném TRƯỚC khi sinh string INSERT (không lossy vào numeric(18,2)).

## Verify (DB cô lập `mediaos_b2`)
- Full api: **1818 pass / 0 fail / 5 skip** (130 file).
- Spec mới: pagination 27+4 · allocate-query-count 2 (N=50→≤30 query) · list-masking 5 · money-overflow 10.
- typecheck/lint/prettier/build + contracts build: sạch (11 lint error tồn dư `demo-seed-dashboard.mjs` pre-existing out-of-diff).

## Gate FULL (independent, opus) — TẤT CẢ OK / blocking=false
- **security-reviewer**: OK. Masking parity không rò amount role không quyền; array-bind no-SQLi (UUID Zod-validated, single bind-param); pagination chặn unbounded; overflow fail-loud không lossy; company_id/RLS giữ.
- **database-reviewer**: OK (SAFE-TO-LAND). Batch atomic trong tx; pagination deterministic không mất/lặp row; masking đúng tầng read-only không phá append-only; overflow đúng numeric(18,2). LOW: `listCostAllocationQuerySchema` forward-declared chưa consumer; DEFAULT_LIMIT dup minor DRY.
- **silent-failure-hunter**: OK. Overflow fail-loud mọi đường write; masking fail-closed (catch→mask); pagination reject 400 không coerce; batch whole-rollback không per-element swallow.

**Verdict: SAFE-TO-LAND. DỪNG trước merge — chờ user chốt.**
