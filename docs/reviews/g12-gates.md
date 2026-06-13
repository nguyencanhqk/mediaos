# G12 Review Gates

> Artifact gate phân tầng (CLAUDE.md §6). Diff chạm `payroll / permission / RLS / audit` ⇒ **FULL gate**.
> Lane G12 (worktree `mediaos-g12-payroll`), band migration `0090–0099`. Verify DB cô lập `mediaos_g12`.

## G12-1 — Salary Profile (CROWN JEWEL, TDD) — `feat/g12-payroll`

**Phạm vi:** schema `salary_profiles` (lương cơ bản/loại/chu kỳ/ngày hiệu lực/phụ cấp) — RLS + FORCE +
`company_id NOT NULL` + soft-delete; repository qua `withTenant`; service (mask + reveal⟹audit + audit
khi sửa + mapError); API CRUD chỉ người có quyền nhạy cảm xem/sửa; **audit khi sửa**. KPI/bonus (G12-3)
KHÔNG nằm trong lượt này (chờ G8 land).

### Migration (band 0090–0099)

| File | Nội dung |
| --- | --- |
| `0090_g12_audit_object_types.sql` | DROP+ADD `audit_logs_object_type_chk` = **SUPERSET 31 type của 0060 + `salary_profile` = 32**. Đồng bộ `AUDIT_OBJECT_TYPES` (db/schema/audit.ts) CÙNG commit. |
| `0091_g12_salary_profiles.sql` | CREATE TABLE + `ENABLE`+`FORCE` RLS + policy USING+WITH CHECK + `company_id NOT NULL DEFAULT current_setting` + index + **partial-unique active/(company,user)** + soft-delete + CHECK enums + `base_salary > 0` + **GRANT SELECT,INSERT,UPDATE app / SELECT worker — KHÔNG DELETE**. |
| `0092_g12_permissions_seed.sql` | INSERT `view-salary-profile` + `manage-salary-profile` `resource_type='salary_profile'` **`is_sensitive=TRUE`** ON CONFLICT DO NOTHING; grant role_permissions **CHỈ company-admin (…001) + hr-manager (…009)** — KHÔNG wildcard, KHÔNG role thường. |
| `meta/_journal.json` | append idx 43/44/45, when 1717500090000/091000/092000 (đơn điệu tăng trong band). |

Chain `0000→0092` áp **SẠCH** vào `mediaos_g12` (44 migration trước + 3 mới). Verify live DB:
`FORCE RLS = t|t`; audit CHECK = 32 type (gồm `salary_profile`+`leave_balance`+`workflow_template`);
GRANT app = `INSERT,SELECT,UPDATE`, worker = `SELECT`; perms granted ONLY role 001+009, is_sensitive=t.

### TDD — RED trước, GREEN sau

**RED (viết TRƯỚC):**
- `packages/contracts/src/payroll.spec.ts` — Zod: salaryType/payCycle enum, effectiveDate ISO, baseSalary>0,
  allowances `{name, amount≥0}`, masked DTO baseSalary/allowances nullable + strip field lạ. **14 pass.**
- `salary-profile.service.spec.ts` — (a) view DENY→mask null+0 audit · (b) view ALLOW+auditRequired=false
  →fail-SAFE mask+0 audit · (c) UPDATE ALLOW→1 audit `salary_profile_updated` before/after · (d) audit INSERT
  ném→update rollback (lương không lộ) · (e) mapError→500 generic không leak schema/constraint/code +
  create/update/delete deny→403, NotFound, 409 unique. **20 pass.**
- `salary-profile-permission.int-spec.ts` (skipIf !LANE_DB, permission engine THẬT) — (a) wildcard `*:*` user
  ⇒ 403 mọi route (sensitive KHÔNG kế thừa) · (b) employee đọc lương người khác ⇒ 403 · (c) no-role
  fail-closed 403. **7 pass.**
- `salary-profile-tenant-isolation.int-spec.ts` (2-tenant) — login A: list/get B ⇒ 0 row; INSERT company_id=B
  bị WITH CHECK chặn; INSERT own tenant chỉ A thấy. **4 pass.** (+ `salary_profiles` vào `rls-registry.ts`
  harness G2-5 — rls-guards 3/3, tenant-isolation 168 pass.)
- `salary-profile-appendonly-audit.int-spec.ts` — app role UPDATE/DELETE audit_logs (salary_profile) bị từ
  chối (append-only BẤT BIẾN #2); CHECK chấp nhận `salary_profile`. **3 pass.**

**GREEN:** repository (mọi method qua `withTenant`+`eq(companyId)`+`isNull(deletedAt)`, insert/update/softDelete
`*Tx`) → service (permission.can sensitive resourceId, mask mặc định, reveal⟹audit-in-tx khi xem, audit
before/after khi SỬA/XOÁ, mapError generic) → controller (`@RequirePermission view/manage 'salary_profile'
{isSensitive:true}` MỖI route) → dto → payroll.module → app.module (additive). Hot-file `schema/index.ts` ·
`contracts/index.ts` · `app.module.ts` · `audit.ts` · `_journal.json` · `rls-registry.ts` = **append-only**.

### Verify (DB cô lập `mediaos_g12`, §9.6)

- `pnpm --filter @mediaos/api typecheck` — **clean**.
- `pnpm --filter @mediaos/api lint` — **0 errors** (9 warnings đều pre-existing ngoài payroll).
- Prettier — **All matched files use Prettier code style**.
- Test salary-profile — **34 pass** (4 file) + contracts payroll **14 pass** = 48.
- Coverage `salary-profile.service.ts` ≥80% mọi metric (ngưỡng nhạy cảm CLAUDE.md §6) — **pass** (threshold
  scoped per-file trong `vitest.config.ts`).
- Full API suite trên `mediaos_g12`: **862 pass / 25 skip / 4 fail**. 4 fail = `auth.int-spec` +
  `reset-token-envelope.int-spec` (G6-2/G2-6 KEK/crypto **baseline môi trường**) — diff G12 KHÔNG chạm
  auth/crypto/reset/secret/envelope (xác nhận `git diff --stat`). Cùng pattern fail như G9-3/G11.

### FULL gate — self-review (security · database · silent-failure · santa)

| Dimension | Kết quả |
| --- | --- |
| **security-reviewer** | Lương is_sensitive=TRUE; permission engine G3-2 KHÔNG cho wildcard `*:*` thoả mãn (verified deny-path int-spec a). resourceId=profile.id ⇒ honor object_permissions. Mask mặc định phía SERVER; mutation response mask. KHÔNG secret plaintext, KHÔNG log lương (audit ghi số đã chuẩn hoá, không log payload riêng). Seed grant CHỈ admin+hr. **0 CRITICAL.** |
| **database-reviewer** | `company_id NOT NULL DEFAULT current_setting` + ENABLE+FORCE RLS + policy USING+WITH CHECK (verified 2-tenant). Soft-delete; GRANT KHÔNG DELETE (app), worker SELECT-only (verified live). Partial-unique active/(company,user). Migration band 0090s, journal đơn điệu, chain áp sạch. Audit CHECK superset 32 (không xoá type lane khác). **0 CRITICAL.** |
| **silent-failure-hunter** | reveal⟹audit ATOMIC trong cùng `withTenant` tx — audit ném ⇒ rollback ⇒ lương không persist/không lộ (verified test d). Fail-SAFE khi allow && !auditRequired (mask). mapError log server-side (KHÔNG nuốt) + trả 500 generic không leak. KHÔNG `@ts-ignore`/`eslint-disable`/`catch {}` rỗng. **0 CRITICAL.** |
| **santa-method** (crown-jewel) | Hai trục review (security ⨯ database) hội tụ; deny-path + atomic-audit + RLS 2-tenant + append-only đều có test THẬT trên Postgres. Không phát hiện blocker. |

**Verdict:** 0 CRITICAL / 0 blocking. Non-sensitive→auto-commit theo §5.5 KHÔNG áp (đây LÀ vùng nhạy cảm
🛠️ crown-jewel) ⇒ checkpoint commit `wip(g12)` trong lane; **người chốt** trước khi land master (§5.5).

### Residual / follow-up (non-blocking)

- G12-1 giữ **1 active profile/user**; cột `effective_date` để sẵn cho lịch sử lương **G12-2** (append bản
  hiệu lực mới thay vì sửa thẳng) — KHÔNG over-engineer ở đây (YAGNI).
- Pagination cho `GET /salary-profiles` (list theo company): theo dõi cùng G12-2 khi dữ liệu lớn.
- FE Salary Profile screen: lượt sau (G12-1 chỉ BE + contract).
- Merge: Wave B (§5.1) — cần rebase lên master sau khi Wave A land; reconcile audit-CHECK union +
  journal idx/when khi nhiều lane merge.
