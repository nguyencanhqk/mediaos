# G11 — Review Gate (HR: Attendance · Leave)

> Gate cho lane G11 trên branch `feat/g11-hr`. Lane **thường** (Sonnet, non-crown) → gate **LIGHT + DB** (diff chạm audit CHECK + RLS + permission seed nên thêm `database-reviewer`). KHÔNG crown → không santa, không FULL.

**Ngày:** 2026-06-13 · **Reviewer:** `ecc:database-reviewer` + `ecc:typescript-reviewer` (song song) · **Verify:** `pnpm --filter @mediaos/api test` trên DB cô lập `mediaos_g11` (chain 0000→0063 sạch).

## Verify (DB cô lập)
- ✅ **G11 GREEN — 228 passed / 2 skipped:** leave.logic 6 · attendance.logic 18 · leave.service 16 · attendance.service 21 · attendance-permission.int (deny-path HTTP) 4 · tenant-isolation.int (RLS 2-tenant, +6 bảng HR trong rls-registry) 165.
- ⚠️ **PRE-EXISTING ngoài G11 (4 file fail):** `auth.int-spec` (1 test) + `reset-token-envelope.int-spec` (3 test) fail thật (`forgotPassword` ghi 0 outbox row); `platform-accounts-reveal.int-spec` + `secret-rotation.int-spec` fail ở **`beforeAll` setup** (23 test skipped) — cùng gốc môi trường KEK/encryption (G6-2). Fail **giống hệt** trên DB chung `mediaos` lẫn cô lập `mediaos_g11`; diff G11 KHÔNG chạm secret/auth/crypto/outbox → **KHÔNG do G11**. **Debt riêng — không chặn land G11.**

## Verdict: 🔴 BLOCK → ✅ RESOLVED (F1–F5 đã vá, re-verify GREEN)

### Khắc phục đã áp (commit kèm)
- **F1 TOCTOU** — `approve/rejectAdjustment` + `approve/rejectRequest`: dời đọc + check `status` VÀO trong tx, re-read qua `findAdjustmentByIdForUpdateTx`/`findRequestByIdForUpdateTx` (`SELECT … FOR UPDATE`). 2 approver đua → approver thứ 2 chờ khoá row → đọc status≠pending → 409. Unit test khẳng định approve đọc qua `*ForUpdateTx`.
- **F2 check-out perm** — thêm catalog `('check-out','attendance')` ở `0063` + grant cho mọi role có `check-in` (admin/hr auto qua `resource_type IN`, project-manager + employee-roles thêm tay); decorator route `check-out` → `@RequirePermission("check-out","attendance")`.
- **F3 mapError leak** — cả 2 service: `err instanceof HttpException` pass-through, còn lại log gốc + ném `InternalServerErrorException` generic (không lộ PG detail). `hr-tasks` raw `Error` → `InternalServerErrorException`.
- **F4 scope=all** — `listBalances(actor, {scope})`: `scope='all'` ⇒ bắt buộc `manage:leave` (fail-closed) rồi query toàn bộ; `scope='me'` ⇒ chỉ bản thân. Hết âm thầm thu hẹp.
- **F5 overnight checkout** — `checkOut` tra **open-record** (`findOpenRecordForUserTx`: checkInAt NOT NULL & checkOutAt NULL) thay vì theo `workDate` của hôm nay; ca qua đêm (D→D+1) check-out đúng record.
- **Re-verify (mediaos_g11):** typecheck sạch · G11 specs **229 pass / 2 skip** (unit 62 · deny-path int 4 · RLS 2-tenant 165) · full suite **790 pass**, chỉ còn 4 pre-existing fail nêu trên.
- **F6–F8** ✅ **ĐÃ ĐÓNG** (merged master §5.4): F6 pagination + F8 cleanup `1e7c5bf` · F7 period-lock `1a05e4f`. Xem bảng dưới.

## Verdict gốc: 🔴 BLOCK (cả 2 reviewer) — đã vá xong

## Findings (đã chắt lọc + cross-check)

| # | Sev | Nguồn | File | Vấn đề | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| F1 | **CRITICAL** | DB+TS (hội tụ) | `attendance.service.ts` approve/rejectAdjustment · `leave.service.ts` approve/rejectRequest | **TOCTOU**: đọc `status` ngoài tx rồi mới mở `withTenant` → 2 approver cùng pass guard → double-approve (double audit/outbox; leave có CHECK `used<=total` cứu trừ-phép nhưng `approvedBy/At` + status bị ghi đè 2 lần; attendance KHÔNG có guard số). | ❌ cần vá |
| F2 | **HIGH** | DB+TS (hội tụ) | `attendance.controller.ts` route `check-out` | `@RequirePermission("check-in","attendance")` trên route check-out (catalog 0063 không có `check-out`). Sai action → audit sai + không revoke độc lập được. | ❌ cần vá |
| F3 | **HIGH** | TS | `attendance.service.ts` + `leave.service.ts` `mapError`; `hr-tasks.service.ts` raw `Error` | `mapError` re-throw raw infra error (PG wire) → filter trả 500 lộ tên bảng/constraint. Fix: bọc `InternalServerErrorException`. | ❌ cần vá |
| F4 | **HIGH** | TS | `leave.service.ts` listBalances + `leave.controller.ts` | `scope=all` → `userId=undefined` → bỏ qua permission check **và** `?? actor.id` → âm thầm trả về chỉ bản thân (silent-failure: manager không thấy ai). | ❌ cần vá |
| F5 | MEDIUM | TS | `attendance.service.ts` checkOut | `workDate = localDateOf(now)` → ca qua đêm (D check-in, D+1 check-out) tra `workDate=D+1` không có record → không check-out được. Fix: tra open-record (`checkInAt NOT NULL AND checkOutAt NULL`) không khoá theo ngày. | ❌ cần vá |
| F6 | MEDIUM→follow-up | DB | `attendance.repository.ts` findAdjustments/findRecordsByMonth/findPeriods · `leave.repository.ts` findRequests | List query không LIMIT/pagination → unbounded ở tenant lớn. | ✅ **DONE `1e7c5bf`** — limit/offset (clamp 1–100, default 50) threaded contracts→dto→service→repo; `attendance.pagination.spec` 28✓ |
| F7 | MEDIUM→follow-up | DB | `0061` `attendance_periods` | App role có UPDATE → kỳ đã `locked` có thể bị set lại `open` (không guard DB). Feed payroll G12. Fix: trigger chặn `locked→open` hoặc revoke UPDATE + SECURITY DEFINER. | ✅ **DONE `1a05e4f`** — mig `0064` trigger BEFORE UPDATE `enforce_attendance_period_lock` chặn locked→open (RAISE EXCEPTION); RED→GREEN 4/4 (core-deny + 2 allow-sanity + RLS-regression) |
| F8 | LOW | DB+TS | `attendance.service.ts` `monthRange` vs `tz.util.ts` `monthDateRange`; `prevDay` footgun; `toAdjustmentDto` identity-spread; comment `gte/lt` sai | Dọn DRY + comment. | ✅ **DONE `1e7c5bf`** — monthRange→`monthDateRange`; between+prevDay→gte/lt; bỏ identity-spread; sửa comment (no behaviour change) |
| ~~Fx~~ | ~~HIGH~~ | ~~DB H-1~~ | ~~RLS `(SELECT current_setting…)` wrapper~~ | **FALSE POSITIVE** — G11 dùng đúng pattern của **cả 22 migration master** (raw `current_setting(...)::uuid`). Reviewer áp Supabase best-practice không khớp repo. **Bác.** | ✅ reject |

## Invariant check (database-reviewer)
PASS: tenant isolation (RLS+FORCE+`withTenant`) · no hard-delete/append-only (app role không DELETE) · audit CHECK superset 24+7=31 · Task Hub `task_type='hr'` không bảng riêng · ADR-0008 timezone · `remaining_days` GENERATED · journal idx 39–42 + when tăng dần. ✅ period-lock guard DB **đã có** (F7 `0064` trigger, journal idx 43).

## Hành động
- **Phải vá trước land:** F1–F5 (surgical). Sau vá → re-run `mediaos_g11` test phải vẫn GREEN + thêm test race cho F1.
- **Follow-up ✅ ĐÃ ĐÓNG (merged master §5.4):** F6 pagination + F8 cleanup `1e7c5bf` · F7 period-lock immutability (trước G12) `1a05e4f`. Merged master xanh: api 895 pass + web 184 pass, chain-migrate `0000→0064` sạch.
- **Reject:** RLS-wrapper (false positive).
