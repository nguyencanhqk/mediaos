# G8 Approval — Review Gate Artifact

> CLAUDE.md §6: G8-3 Evaluation = CRUD/permission/audit thường (KHÔNG payroll/secret/finance ledger) → **LIGHT gate**
> + `ecc:database-reviewer` (vì có migration 0083–0085). Mỗi mục: scope · reviewer · trạng thái · finding.

---

## G8-3 — Evaluation template / criteria / scoring — LIGHT gate — 2026-06-13

**Lane:** g8 `feat/g8-approval` · **Band migration:** 0080s · **Gate:** LIGHT + database (migration).

### Diff scope (vs master `2c79f9e`)

| File | Loại |
| --- | --- |
| `apps/api/migrations/0083_g8_evaluation.sql` | TẠO — evaluation_templates/criteria (mutable, soft-delete) + evaluation_results/scores (append-only) + RLS+FORCE + grant |
| `apps/api/migrations/0084_g8_eval_audit_object_types.sql` | CHECK re-stamp — UNION 47 type (45 từ 0090 G12 incl `salary_profile` + evaluation_template/result) |
| `apps/api/migrations/0085_g8_eval_permissions_seed.sql` | seed permission `ON CONFLICT DO NOTHING` (idempotent) |
| `apps/api/src/db/schema/evaluation.ts` · `audit.ts` · `index.ts` | schema + AUDIT_OBJECT_TYPES (47, đồng bộ 0084) |
| `apps/api/src/evaluation/*` | service/repository/controller/dto/module |
| `packages/contracts/src/evaluation.ts` | Zod DTO (weight sum=100 refine, score range) |
| `apps/api/test/integration/{evaluation-deny.int-spec,rls-registry}.ts` · `evaluation.{service,contracts}.spec` | test |

### Reconcile merge master→lane (`aabb0fc`)

- 4 conflict: `_journal.json` (rebuild từ master + 3 entry g8 idx 57/58/59, when 1717500120000/121000/122000 **> master max 1717500112000**) · `audit.ts` (union evaluation+salary_profile) · `schema/index.ts` + `contracts/index.ts` (additive union eval+payroll). `app.module.ts` + `rls-registry.ts` auto-merge sạch.
- ⚠️ **0084 sửa:** g8 wip THIẾU `salary_profile` trong CHECK. Vì 0084 (when 1717500121000) chạy SAU 0090_g12 (1717500110000) → là re-stamp CUỐI → thêm `salary_profile` để CHECK là SUPERSET đủ (nếu thiếu → drop salary_profile khỏi CHECK = CRITICAL phá audit payroll). Đồng bộ `audit.ts` = 47 type.

### Verify (DB cô lập `mediaos_g8`, chain 0000→0085 reset sạch, 60 migration)

- DB CHECK xác nhận `salary_profile` + `evaluation_template` + `evaluation_result` đều có sau migrate.
- **api 1075 pass / 2 skip · web 199 pass · typecheck 4/4 · build 3/3.** lint API 0 error (14 warning pre-existing, 0 trong evaluation/*).
- Deny-path: evaluation-deny 9/9 · evaluation.service 9/9. **Không hồi quy payroll:** salary-profile-appendonly-audit 3/3 (GHI audit object_type='salary_profile' XANH ⇒ reconcile CHECK đúng) · salary-profile-tenant-iso 4/4 · salary-profile.service 20/20.

### Reviewer / skill

| Lens | Kết quả |
| --- | --- |
| `ecc:typescript-reviewer` | **PASS** — 0 CRITICAL/HIGH. Không `any`; type từ contracts; controller mỏng; permission fail-closed ngoài tx. 2 MEDIUM (`.returning()[0]` defensive return type · `byId.get(...)!` an toàn theo invariant 2 vòng lặp) — non-blocking. |
| `ecc:database-reviewer` | **PASS** — Audit CHECK superset 47 type (45 từ 0090 + 2 eval, 0 type bị drop, `salary_profile` có). RLS+FORCE + USING/WITH CHECK + company_id NOT NULL cả 4 bảng. Grant: templates/criteria SELECT,INSERT,UPDATE; results/scores SELECT,INSERT (append-only). Seed idempotent. numeric (no float). rls-registry đăng ký đủ 4 bảng. |
| quality (typecheck + lint) | PASS — 0 error. |

### Finding

- **CRITICAL/HIGH:** 0.
- **MEDIUM (non-blocking):** `.returning()[0]` trả `T|undefined` không guard ở repo (Drizzle insert thành công luôn trả row, lỗi thì THROW — không xảy ra empty trên success path; cùng class với G13, defensive hardening). Intra-request duplicate criteriaId bắt bởi DB uq → 409 (đúng, message hơi chung).

### Verdict

- **LIGHT gate XANH, 0 real CRITICAL/HIGH → g8 thường được land (CLAUDE.md §6 / TASKS §5.5: non-sensitive gate xanh ⇒ land).**
