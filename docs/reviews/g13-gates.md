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
