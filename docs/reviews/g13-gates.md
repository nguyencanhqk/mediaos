# G13 Finance — Review Gate Artifact

> CLAUDE.md §6: FULL gate (diff chạm RLS / permission / audit / finance — crown-jewel).
> Mỗi mục: scope · reviewer/skill · trạng thái · finding + fix đã áp.

---

## G13-1 — Revenue append-only ledger (verify mediaos_g13)

**Ngày:** 2026-06-13 · **Lane:** g13 · **Band migration:** 0070–0079 · **Chế độ:** TDD · **Gate:** FULL (crown-jewel)

### Scope diff

| File | Loại |
| --- | --- |
| `apps/api/src/finance/revenue.service.ts` | WIP → verify (create/adjust/void; assertCanWrite fail-closed; audit-in-tx; outbox) |
| `apps/api/src/finance/revenue.repository.ts` | WIP → verify (list/findByIdTx/insertTx append-only); gỡ import `isNull` thừa |
| `apps/api/src/finance/finance.module.ts` | TẠO MỚI (provide RevenueService+RevenueRepository; import EventsModule+PermissionModule) |
| `apps/api/src/app.module.ts` | wire FinanceModule (additive, hot-file §5.3) |
| `apps/api/vitest.config.ts` | VÁ DRIFT: env DB URL đọc `process.env`/`LANE_DB` TRƯỚC literal (laneDbEnv()) |
| `apps/api/test/integration/finance-revenue-deny.int-spec.ts` | +4 RED tăng cường (source enum / double-adjust uq / adjust-on-void / void-on-void) |

### Verify (DB cô lập mediaos_g13)

- `lane-db-setup.sh g13 --reset` → chain 0000→0074 apply SẠCH (revenue_records tồn tại, GRANT = SELECT,INSERT).
- `finance-revenue-deny.int-spec` — **12/12 GREEN** (4 chốt a/b/c/d + 4 boundary e), KHÔNG skip (hasDb=true).
- finance suite — **51/51** (profit-calc 5 · money 18 · allocation 16 · deny 12).
- tenant-isolation int-spec (rls-registry incl revenue_records) — **160 pass / 2 skip**.
- e2e (bootstrap full AppModule incl FinanceModule) — **19/19**.
- `pnpm --filter @mediaos/api typecheck` — clean. `lint` — 0 error (9 warning pre-existing/benign).

### Reviewer / skill

| Lens | Kết quả |
| --- | --- |
| `ecc:security-review` (RLS / permission / audit / secret) | PASS — 0 CRITICAL. withTenant chokepoint, UUID-validated; permission fail-closed ngoài tx; outbox payload chỉ id+actorUserId. |
| `ecc:santa-method` (crown-jewel dual review, Pattern B inline) | **NICE** — cả 2 reviewer PASS 5/5 invariant. |
| typescript / quality (typecheck + lint) | PASS. |
| database (migration 0070 RLS+FORCE+grant+CHECK+uq) | PASS — append-only grant đúng; source CHECK + replaces_uq + chain_check ở DB. |
| silent-failure (can() catch fail-closed; audit-in-tx; outbox-in-tx) | PASS — không nuốt lỗi; deny không mở tx. |

### 5 invariant — verdict

1. **APPEND-ONLY** — PASS (grant SELECT,INSERT; service không update/delete; sửa/xoá = bản ghi mới chain).
2. **RLS 2-tenant** — PASS (mọi đọc/ghi qua withTenant; policy USING+WITH CHECK + FORCE).
3. **Permission fail-closed** — PASS (assertCanWrite ngoài tx → deny ⇒ 0 side-effect; infra error ⇒ deny).
4. **Audit-in-tx** — PASS (audit.record(tx,…) cùng tx INSERT; object_type='revenue_record'; chain replaces_record_id).
5. **Outbox no-PII** — PASS (payload = revenueRecordId + replacesRecordId + actorUserId).

### Finding

- **CRITICAL/HIGH:** 0.
- **MEDIUM (non-blocking, agreed bởi cả 2 reviewer):** adjust()/void() dựa `revenue_records_replaces_uq` ở DB để chặn double-adjust race (đúng — DB là race authority, test (e) phủ), nhưng unique-violation hiện nổi lên dạng lỗi Postgres thô. → Khi build HTTP layer (controller, ngoài scope lượt này), map unique-violation → 409/BadRequest cho API semantics sạch. Ghi nợ G13-1 HTTP.

### Residual / nợ

- HTTP layer (RevenueController + @RequirePermission) CHƯA build — service/repo/module sẵn sàng.
- `lane-db-setup.sh` lấy từ `../MediaOS/scripts/` (shared); `vitest.config.ts` drift đã vá (đọc LANE_DB).
- Land CUỐI (sau G9→G10→G11): reconcile journal (idx 39-43 / when 1717500080000+) + audit_logs_object_type_chk UNION mọi lane (MERGE NOTE 0070).

---

## G13-2 — Cost + Cost Allocation (FIN-003) — FULL gate (crown-jewel) — 2026-06-13

**Diff scope (additive, KHÔNG hot-file rewrite):** `apps/api/src/finance/cost.service.ts` · `cost.repository.ts`
· `cost-allocation.service.ts` · `cost-allocation.repository.ts` (TẠO) · `finance.module.ts` (additive: +4 provider,
giữ RevenueService) · 3 test (`finance-cost-deny.int-spec.ts` 13 · `finance-cost-allocation-deny.int-spec.ts` 10 ·
`allocation-resolve.spec.ts` 11). KHÔNG migration mới (0071 cost ĐÃ land master qua `2d4533f`; schema/audit-types
/contracts/_journal đã reconcile ở master `8759e7e`). audit.ts AUDIT_OBJECT_TYPES đã chứa cost_record/cost_allocation
— KHÔNG sửa.

### Verify (DB cô lập `mediaos_g13`, chain 0000→latest sạch)

- cost-deny 13/13 · cost-allocation-deny 10/10 · allocation-resolve 11/11 XANH. Full suite **1027 pass / 2 skip / 0 fail** (revenue + mọi lane không hồi quy).
- `pnpm --filter @mediaos/api typecheck` clean · `@mediaos/contracts typecheck` clean · lint finance scope 0 error.
- Coverage (DB present): `cost.service.ts` 100% line/func, 77% branch (gap = `?? null` defensive defaults; theo precedent G13-1 KHÔNG hard-gate file DB-tested để tránh false-red no-DB run).

### Reviewer / skill

| Lens | Kết quả |
| --- | --- |
| `ecc:security-review` (permission / RLS / audit / injection) | PASS — 0 CRITICAL. assertCanWrite create:finance ngoài tx fail-closed; raw `sql.identifier` chỉ nhận literal từ map cố định (TARGET_TABLE/targetColumn) — KHÔNG user input; targetId/period parameterized; cross-tenant polymorphic target guard qua RLS. |
| `ecc:code-review` (database + silent-failure + typescript, Pattern B inline) | APPROVE — 0 CRITICAL/HIGH. |
| database | PASS — append-only grant cost_records SELECT,INSERT; cost_allocations SELECT,INSERT,UPDATE (no DELETE); re-allocate soft-delete+insert+audit+outbox CÙNG 1 tx (atomic); active_uq/method_check ở DB. |
| silent-failure | PASS — không catch rỗng; MoneyError→400, non-MoneyError re-throw; permission infra-error ⇒ deny. |
| typescript | PASS — không `any`; types từ contracts; immutable; DB_RESOLVED_METHODS `satisfies`. |

### 5+1 invariant — verdict

1. **APPEND-ONLY cost_records** — PASS (grant SELECT,INSERT; CostService không update/delete; sửa/xoá = chain entry_kind+replaces_record_id).
2. **RLS 2-tenant** — PASS (mọi đọc/ghi qua withTenant; 0 row chéo qua service + APP role; cross-tenant target từ chối).
3. **Permission fail-closed** — PASS (create/adjust/void/allocate check create:finance ngoài tx → deny ⇒ 0 side-effect, kiểm đếm=0).
4. **Audit-in-tx** — PASS (CostCreated/CostAdjusted/CostVoided object_type='cost_record'; CostAllocated/CostReallocated object_type='cost_allocation' cùng tx).
5. **Cents-exact** — PASS (money.ts bigint dồn dư target cuối; SUM(allocated_amount)===amount cost gốc tuyệt đối cho equal/manual/by_work_hours; weight=0 ⇒ MoneyError→400).
6. **cost_allocations mutable-có-kiểm-soát** — PASS (re-allocate = soft-delete set cũ + insert set mới CÙNG tx; active_uq chặn double-active; app role DELETE bị từ chối).

### Finding

- **CRITICAL/HIGH:** 0.
- **MEDIUM (non-blocking):** (1) target validation + DB-weight resolve là N tuần tự await (≤200 target theo contract cap — chấp nhận). (2) double-adjust race nổi lên dạng lỗi Postgres thô (cost_records_replaces_uq) — map→409 khi build HTTP layer (nợ G13-2 HTTP, mirror nợ G13-1).

### Residual / nợ

- HTTP layer (CostController/CostAllocationController + @RequirePermission) CHƯA build — service/repo/module sẵn sàng.
- by_video_count/by_task_count/by_revenue_ratio resolve qua repository COUNT/SUM; target team/org_unit/employee không có FK ở content/tasks ⇒ weight 0 (caller xử lý; revenue_ratio chỉ tính bản hiệu lực entry_kind<>void AND NOT replaced).
- **🛠️ crown-jewel finance ledger — KHÔNG auto-commit. needs_human chốt (TASKS §5.5).** G13 đã land master trước đó (revenue/cost-schema); G13-2 service layer là phần bổ sung — người chốt quyết định land.
