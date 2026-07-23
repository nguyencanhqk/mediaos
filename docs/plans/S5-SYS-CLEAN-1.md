# S5-SYS-CLEAN-1 — Retention tự động cho `system_job_runs`

> Zone: **RED** (crown) — chạm bảng append-mostly + tạo primitive XOÁ + migration grant. Gate: **FULL**
> (security + database + silent-failure + santa-method). Depends_on: S5-LMS-BE-4 (đã ship #262).

## 0. Bối cảnh & vì sao WO này tồn tại

- BE-4 (#262) hạ `audit_logs` xuống "chỉ ghi khi CÓ THAY ĐỔI THẬT" và **viện dẫn `system_job_runs` làm
  bằng chứng thay thế "job có chạy không"** (§3D). ⇒ WO dọn `system_job_runs` **không được xoá quá tay**,
  nếu không sẽ phá chỗ dựa của BE-4.
- `system_job_runs` **KHÔNG** nằm trong `PROTECTED_TABLES` (retention.service.ts:43-73) ⇒ hiện KHÔNG có gì
  chặn một job dọn thô xoá sạch. WO này là bản **tự động hoá CÓ NGƯỠNG** thay cho purge tay 2026-07-22
  (memory `pgdata-bloat-lane-dbs-and-job-log`).

## 1. Đo thực tế trên PROD (DB `mediaos`, 2026-07-24)

| chỉ số | giá trị |
| --- | --- |
| tổng row | 48.022 / 19 MB |
| theo job_code | RETENTION_CLEANUP 17.079 · TEMP_FILE_CLEANUP 16.973 · TASK_REMINDER 13.699 · LMS_USER_SYNC 271 |
| status | **toàn bộ `Success`** (0 Failed/Partial/Running) |
| row `company_id IS NULL` | **0** |
| row > 30 ngày | **0** (row cũ nhất 17 ngày) |
| grant | app: `SELECT` · worker: `SELECT/INSERT/UPDATE` · **không role nào có DELETE** |

⇒ Retention này là **phòng ngừa**: chạy hôm nay xoá ~0 dòng; bảng phình ~3.200 dòng/ngày cho tới khi
row đầu tiên chạm mốc 30 ngày (~13 ngày nữa) rồi ổn định.

## 2. Quyết định của owner (2026-07-24, qua AskUserQuestion)

1. **Kill-switch**: mặc định **XOÁ THẬT**, có env TẮT riêng (KHÔNG dùng chung `RETENTION_JOB_ENABLED`).
2. **Ngưỡng ngày**: **30 ngày** cho mọi job_code khác; **`LMS_USER_SYNC` sàn ≥90 ngày** (hợp đồng BE-4 §3D).
3. **Row `company_id IS NULL`** (job cấp system/global): **GIỮ VĨNH VIỄN**, có test + đếm cảnh báo.

## 3. Cơ chế XOÁ — SECURITY DEFINER function (tiền lệ `resolve_api_key_by_hash`, mig 0310)

**Vấn đề**: không role runtime nào có DELETE trên `system_job_runs`; done_when cấm cấp thêm grant DELETE
cho app role; int-spec pin "KHÔNG DELETE role nào" cho CẢ app lẫn worker (table_grants).

**Giải**: 1 function `purge_system_job_runs(...)` `SECURITY DEFINER` **owned by `mediaos`** (superuser — có
DELETE + BYPASSRLS *chỉ trong thân function*). `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO mediaos_worker`.
- **Bất biến giữ nguyên**: KHÔNG cấp DELETE trên BẢNG cho role nào ⇒ `system-jobs-schema.int-spec.ts:263-312`
  vẫn XANH (EXECUTE-trên-function KHÔNG xuất hiện trong `role_table_grants`). App role KHÔNG được đụng
  (thậm chí gián tiếp) — chỉ `mediaos_worker` gọi được.
- **An toàn chéo tenant by-construction**: DELETE **luôn** có `company_id = p_company_id` (bind param) ⇒
  row `company_id IS NULL` (global) KHÔNG BAO GIỜ khớp ⇒ **GIỮ VĨNH VIỄN** tự động (không cần nhánh riêng).
  Đây chính là lý do chọn tenant-scoped predicate thay vì quét global (owner decision #3).

### 3.1 Function (migration 0510)

```sql
CREATE FUNCTION purge_system_job_runs(               -- CREATE (KHÔNG "OR REPLACE") — bám 0310, fail nếu đã tồn tại
  p_company_id  uuid,
  p_default_days integer,   -- caller truyền 30 (nhưng bị SÀN CỨNG bên dưới)
  p_lms_days     integer,   -- caller truyền 90 (SÀN CỨNG ≥90 — hợp đồng BE-4 §3D, KHÔNG tin caller)
  p_batch_size   integer,   -- trần 1 lượt
  p_dry_run      boolean    -- true = ĐẾM eligible, KHÔNG xoá (kill-switch OFF)
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer;
  v_default_days integer;
  v_lms_days     integer;
BEGIN
  -- Guard tham số: chặn truyền rác. Batch có TRẦN CỨNG.
  IF p_company_id IS NULL OR p_default_days <= 0 OR p_lms_days <= 0
     OR p_batch_size <= 0 OR p_batch_size > 100000 THEN
    RAISE EXCEPTION 'purge_system_job_runs: tham so khong hop le';
  END IF;

  -- SÀN CỨNG ép Ở PRIMITIVE (BLOCKING#2 plan-review): dù caller/refactor/gọi-thẳng truyền số nhỏ hơn,
  -- LMS_USER_SYNC KHÔNG BAO GIỜ bị xoá <90 ngày (bảo vệ "bằng chứng job chạy" của BE-4 §3D); các job khác
  -- KHÔNG BAO GIỜ <7 ngày. GREATEST = fail-safe theo hướng GIỮ (clamp lên phía an toàn, không ném).
  v_lms_days     := GREATEST(p_lms_days, 90);
  v_default_days := GREATEST(p_default_days, 7);

  IF p_dry_run THEN
    SELECT count(*) INTO v_n
    FROM system_job_runs
    WHERE company_id = p_company_id                       -- global (NULL) KHÔNG khớp
      AND status IN ('Success','Skipped')                 -- Failed/Partial/Running GIỮ
      AND started_at < now() - make_interval(days =>
            CASE WHEN job_code = 'LMS_USER_SYNC' THEN v_lms_days ELSE v_default_days END);
    RETURN v_n;
  END IF;

  WITH victim AS (
    SELECT id FROM system_job_runs
    WHERE company_id = p_company_id
      AND status IN ('Success','Skipped')
      AND started_at < now() - make_interval(days =>
            CASE WHEN job_code = 'LMS_USER_SYNC' THEN v_lms_days ELSE v_default_days END)
    ORDER BY started_at
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED                                 -- không giẫm INSERT/UPDATE worker đang chạy
  )
  DELETE FROM system_job_runs s USING victim WHERE s.id = victim.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION purge_system_job_runs(uuid,integer,integer,integer,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_system_job_runs(uuid,integer,integer,integer,boolean) TO mediaos_worker;
```

- **CHỈ xoá `status IN ('Success','Skipped')`** ⇒ `Failed`/`Partial`/`Running` GIỮ VĨNH VIỄN (bảo thủ hơn
  yêu cầu owner — owner chỉ nêu Failed/Partial; ta giữ luôn Running vì run-row treo = crash cần điều tra).
  `'Skipped'` thêm vào allowlist là **an toàn & không-op thực tế**: `JobRunner` khi lock bị giữ thì return
  sớm KHÔNG ghi run-row (`job-runner.ts:63-66`) ⇒ hiện KHÔNG có run-row 'Skipped' nào; đưa vào chỉ để nếu
  tương lai ai đó ghi 'Skipped' (non-error terminal) thì cũng dọn được. Ghi rõ để owner/reviewer khỏi suy lại.
- **SÀN CỨNG trong function (BLOCKING#2)**: hằng số 30/90 ở handler chỉ là input; sàn thật ép Ở SQL primitive
  bằng `GREATEST` ⇒ hợp đồng §3D không "tin caller". Test §5 pin cả hai tầng (unit pin đối số handler = 30/90;
  int-spec pin hành vi thật qua `handler.run()` với mốc LMS-50d-GIỮ).
- **Phụ thuộc RLS-bypass (câu hỏi mở plan-review)**: `system_job_runs` là `FORCE ROW LEVEL SECURITY` (0475:60)
  và KHÔNG có policy cho role migrate. DELETE trong thân function chỉ ăn nếu **owner function (role của
  `DATABASE_DIRECT_URL`) có BYPASSRLS** — đúng như 0310 `resolve_api_key_by_hash` đang chạy thật (auth PAT
  sống ⇒ owner có bypass; đã verify `pg_roles`: `mediaos` rolbypassrls=true). Nếu owner KHÔNG bypass thì DELETE
  bị RLS lọc về **0 row IM LẶNG** (không lỗi) ⇒ **int-spec case default-30d (seed 40d → PHẢI xoá) là bằng
  chứng RED-first** rằng function thật sự xoá được (câm = đỏ).
- **Migration band**: 0510, journal idx 190, when 1717587312000 (nối tiếp head 0509 idx 189). Schema drizzle
  `system-jobs.ts` KHÔNG đổi (function/RLS không biểu diễn được bằng drizzle — parity thủ công, giống 0475).

## 4. Handler `SystemJobRunsRetentionJobHandler` (app-layer)

File: `apps/api/src/foundation/retention/system-job-runs-retention.job-handler.ts` (cùng nhà
`retention-cleanup.job-handler.ts`, đăng ký `@SystemJobHandler()` trong `RetentionModule.providers`).

- `jobCode = 'SYSTEM_JOB_RUNS_RETENTION'` (DUY NHẤT toàn hệ — khoá `system_job_locks` + `job_code`).
- Chạy qua **`workerDb`** (role `mediaos_worker`) — mirror `JobRunLogger`/`JobLockService`: constructor
  `dbw: Database | null = workerDb ?? null`, gọi `assertWorkerRoleSafe(mode:'prod-only')` TRƯỚC khi chạm DB,
  **fail-closed** khi `workerDb` vắng. KHÔNG dùng `RetentionService` (đó là app-withTenant cho
  `data_retention_policies` — `system_job_runs` là infra, không phải policy row).
- **KHÔNG gộp vào vòng `RetentionCleanupJob`** (vòng đó lặp `data_retention_policies` bằng model
  `retentionDays` phẳng — không biểu diễn được ngưỡng-có-điều-kiện + không có row `system_job_runs`). Đây là
  **diễn giải "thêm vào RetentionCleanupJob"** trong title = thêm vào *phân hệ retention*, dưới dạng handler
  chuyên biệt. Ghi rõ để reviewer khỏi hiểu là lệch scope.

### 4.1 Hằng số (KHÔNG magic number)
```
DEFAULT_RETENTION_DAYS = 30
LMS_RETENTION_DAYS     = 90
PURGE_BATCH_SIZE       = 5000
MAX_BATCHES_PER_RUN    = 40      // trần drain 1 nhịp = 200k; chống loop vô hạn
GLOBAL_ROWS_WARN       = 1000    // ngưỡng warn nếu row company_id IS NULL phình bất thường
ENV = 'SYSTEM_JOB_RUNS_RETENTION_ENABLED'
OFF_VALUES = { 'false','0','off','no','disabled' }   // case-insensitive, trim
```
- **Kill-switch INVERT** so với `RETENTION_JOB_ENABLED` (mặc định OFF): env này **mặc định ON** theo owner
  decision #1. **Nới điều kiện TẮT** (plan-review non-blocking foot-gun): vì đây là công tắc dừng của job
  **mặc định XOÁ THẬT**, operator gõ `0/off/no/disabled` lúc khẩn phải TẮT được, không chỉ đúng chuỗi
  `'false'`. ⇒ `dryRun = OFF_VALUES.has(String(env ?? '').trim().toLowerCase())`. (unset/rỗng/khác → xoá thật.)
- **Đối số function pin qua helper thuần** (BLOCKING#2): tách `buildPurgeArgs(companyId, dryRun)` trả tuple
  `[companyId, DEFAULT_RETENTION_DAYS, LMS_RETENTION_DAYS, PURGE_BATCH_SIZE, dryRun]` → unit-test assert
  handler LUÔN truyền `(…, 30, 90, 5000, …)`. Sàn cứng ở SQL (§3.1) là lớp 2.
- Khai `SYSTEM_JOB_RUNS_RETENTION_ENABLED` vào `.env.example` (operator biết công tắc tồn tại — nhất là vì
  mặc định XOÁ THẬT).

### 4.2 Luồng `run({companyId})`
1. `assertWorkerRoleSafe` (once) → fail-closed nếu thiếu workerDb.
2. `dryRun`? → gọi function `p_dry_run=true` 1 lần → `eligible = count`; `deleted=0`; return metadata.
3. Ngược lại (xoá thật): **loop** gọi function `p_dry_run=false` với `PURGE_BATCH_SIZE`, cộng dồn `deleted`,
   dừng khi `n < PURGE_BATCH_SIZE` (drained) hoặc chạm `MAX_BATCHES_PER_RUN`. Mỗi call = 1 statement/1 tx
   (khoá nhả giữa lô — FOR UPDATE SKIP LOCKED).
4. **Đếm cảnh báo global** (owner #3): `SELECT count(*) WHERE company_id IS NULL` (worker có SELECT+RLS
   worker_all) → `globalRowsKept`. Nếu > `GLOBAL_ROWS_WARN` (=1000) → `logger.warn` (phát hiện nếu tương lai
   có job global spam). KHÔNG xoá. _(Chạy PER-TENANT nên với N>1 sẽ query lặp N lần/nhịp — thừa, không hại;
   N=1 hiện tại không sao. Ghi chú để tương lai không tưởng là bug — plan-review.)_
5. Return `JobRunResult`:
   ```
   { total: <batches or 1>, success: <same>, failed: 0,
     metadata: { deleted, dryRun, batches, globalRowsKept, capHit } }   // CHỈ số + cờ, KHÔNG chuỗi ngoài
   ```
   Metadata đi qua `AuditMaskerService.mask` ở `JobRunLogger` trước khi ghi (BẤT BIẾN #3) — chỉ đếm nên an toàn.

- **Run-row của chính job này** (`SYSTEM_JOB_RUNS_RETENTION`, Success, non-LMS) sẽ tự bị dọn sau 30 ngày ⇒
  không tự-phình. Job chạy mỗi nhịp scheduler (60s hiện tại) như mọi handler khác (không có lịch riêng — NGOÀI
  phạm vi WO này, xem src[]).

## 5. Test

### 5.1 Unit (RED trước) — `system-job-runs-retention.job-handler.spec.ts` (fake `dbw`, KHÔNG DB)
- **buildPurgeArgs pin hợp đồng (BLOCKING#2)**: `buildPurgeArgs(id, false)` === `[id, 30, 90, 5000, false]`;
  `buildPurgeArgs(id, true)` === `[id, 30, 90, 5000, true]` — chứng minh handler LUÔN truyền 30/90 (không phải
  30/30) nên LMS được sàn 90 ở tầng caller; sàn SQL (§3.1) là lớp 2.
- Kill-switch: env `='false'|'0'|'off'|'no'|'disabled'` (và `'FALSE'`, `' off '`) → dry-run: gọi function
  `p_dry_run=true` ĐÚNG 1 lần, KHÔNG loop, `deleted=0`, `dryRun=true`. env unset/`'true'`/`'x'` → xoá thật.
- Xoá thật: fake trả `[5000,5000,137]` → loop dừng ở lô <batch, `deleted=10137`, `batches=3`, `capHit=false`.
- Cap: fake luôn trả `5000` → dừng ở `MAX_BATCHES_PER_RUN`, `capHit=true` (KHÔNG loop vô hạn).
- Fail-closed: `dbw=null` → NÉM trước khi chạm DB (mirror JobRunLogger spec).
- Hằng số export đúng (30/90/5000/40).

### 5.2 Integration (RED trước, gate `hasDb && LANE_DB`) — `test/integration/system-job-runs-retention.int-spec.ts`
> **Chạy end-to-end qua `handler.run({companyId})` THẬT** (workerDb lane DB + env thật), KHÔNG gọi SQL với
> `90` tự nhét — chỉ như vậy mới pin được handler thực sự truyền 30/90 (BLOCKING#2).
> **Isolation (plan-review)**: seed vào **tenant riêng (`seedCompany`) + `job_code` tổng hợp DUY NHẤT** cho
> mỗi test; `beforeEach`/`afterEach` dọn **CHỈ theo phạm vi đó** (`DELETE … WHERE company_id = seeded OR
> job_code = uniqueCode`) qua **direct pool** (app/worker KHÔNG có DELETE — BẤT BIẾN #2). **KHÔNG**
> `DELETE FROM system_job_runs` toàn bảng (clobber run-row test khác = flake, memory
> `super-admin-bootstrap-flaky`).
- **done_when #1**: seed `Failed` 2 năm tuổi → `handler.run` (real) → row CÒN NGUYÊN.
- **done_when #2 (sàn ≥90 end-to-end)**: seed `LMS_USER_SYNC/Success` 100d + **50d** → `handler.run` →
  100d XOÁ, **50d GIỮ**. 50d GIỮ ⇒ chứng minh **FUNCTION tôn trọng sàn ≥90 end-to-end** (sàn `GREATEST` ở
  §3.1 khiến bất kỳ input <90 vẫn không xoá <90 ngày). _Chú ý (plan-review): sau khi có clamp SQL, case này
  KHÔNG còn phân biệt "handler truyền 90" vs "handler truyền 30 rồi SQL clamp"; việc handler THẬT SỰ truyền
  90 được pin RIÊNG bởi unit `buildPurgeArgs === [id,30,90,…]` (§5.1) — hai tầng bổ trợ, không chồng lấn._
- **default 30d (bằng chứng function KHÔNG câm / RLS-bypass OK)**: seed non-LMS `Success` 40d + 20d →
  `handler.run` → 40d XOÁ, 20d GIỮ. 40d bị xoá = function thật sự DELETE được (nếu owner không bypass RLS →
  0 row câm → test ĐỎ).
- **done_when #3**: seed `company_id IS NULL / Success` 2 năm → `handler.run` (tenant A) → CÒN NGUYÊN +
  metadata `globalRowsKept ≥1`.
- **cross-tenant**: seed tenant B `Success` 2 năm → `handler.run`(A) → row B CÒN NGUYÊN (predicate pin company_id).
- **Running giữ**: seed `Running` 2 năm → `handler.run` → CÒN NGUYÊN.
- kill-switch dry-run: env `='false'` → 0 row bị xoá dù `eligible>0`.
- **grant/permission**: (a) `role_table_grants` KHÔNG có DELETE mới cho app/worker (bảng); (b) `EXECUTE` trên
  `purge_system_job_runs` = CHỈ `mediaos_worker` — verify `has_function_privilege('mediaos_worker', …, 'EXECUTE')`
  = true VÀ `has_function_privilege('mediaos_app', …, 'EXECUTE')` = false VÀ PUBLIC không có (proname qua
  `pg_proc`).
- **Nghiệm thu (BLOCKING#1 — điều kiện MERGE, KHÔNG tuỳ chọn)**: `bash harness/check.sh --all` (hoặc
  `REQUIRE_LANE_DB=1 bash harness/check.sh`) — vì mọi bằng chứng an toàn của primitive-XOÁ nằm ở int-spec
  gate `hasDb && LANE_DB`; chạy `pnpm test`/`--lane-db` (opt-in, exit 0) có thể SKIP = **xanh giả** (memory
  `ci-skips-most-integration-specs` + `src-green-is-not-integration-green`). `--all`/`REQUIRE_LANE_DB=1` biến
  int-spec skip vượt ngưỡng thành **exit 1 (ĐỎ)** ⇒ ép deny/safety-path chạy THẬT trước merge (CLAUDE §9 vùng đỏ).

## 6. Định nghĩa Done (map done_when backlog)
- [ ] Failed/Partial(/Running) KHÔNG BAO GIỜ xoá — int-spec RED-trước, chạy qua `handler.run`.
- [ ] LMS_USER_SYNC <90d giữ (mốc 50d) / >90d xoá; non-LMS mốc 30d — sàn ép Ở SQL primitive (`GREATEST`) +
      pin đối số handler (unit) + hành vi thật (int-spec).
- [ ] Row `company_id IS NULL` GIỮ (predicate tenant-scoped) + metadata `globalRowsKept` + test.
- [ ] Migration 0510 tạo function SECURITY DEFINER + REVOKE PUBLIC + GRANT EXECUTE worker; **KHÔNG** cấp
      DELETE bảng cho role nào (app/worker table_grants bất biến); EXECUTE chỉ worker (không app/PUBLIC).
- [ ] `SYSTEM_JOB_RUNS_RETENTION_ENABLED` khai `.env.example`; comment ở `system-jobs-schema.int-spec.ts`
      ghi rõ "DELETE-capability nay tồn tại QUA SECURITY DEFINER có kiểm soát" (tên assert cũ không còn nghĩa đen).
- [ ] FULL gate PASS; **nghiệm thu `check.sh --all` / `REQUIRE_LANE_DB=1` = ĐỎ-nếu-skip (điều kiện merge)**.

## 6b. Quyết định KHÔNG làm (đã cân nhắc, từ chối có lý do)
- **KHÔNG ghi `audit_logs` mỗi lần purge** (plan-review non-blocking gợi ý): job chạy mỗi 60s, khi row bắt đầu
  chạm 30 ngày sẽ có `deleted>0` ~mỗi nhịp ⇒ audit-per-purge **tái lập đúng spam mà BE-4 (#262) vừa dập tắt**
  (mục tiêu §3D là GIẢM audit_logs). Bằng chứng "đã xoá bao nhiêu/khi nào" đủ nằm ở `system_job_runs.metadata`
  của run-row job này (< 30 ngày luôn còn). Mâu thuẫn trực tiếp với BE-4 ⇒ từ chối.

## 7. Rủi ro & đã phòng
- **SECURITY DEFINER = cross-tenant primitive** → bound bằng `company_id = param` + `search_path` cố định +
  `REVOKE PUBLIC` + guard tham số + allowlist status. Mirror 0310.
- **Xoá quá tay phá bằng chứng BE-4** → sàn LMS 90d + Failed/Partial giữ vĩnh viễn (append-mostly bảo toàn).
- **Migration số trùng** → khai `apps/api/migrations/**` trong paths (memory `wo-paths-drive-gate-and-scheduler`);
  head 0509 → 0510.
- **Handler dùng workerDb (pattern mới cho @SystemJobHandler)** → mirror JobRunLogger/JobLockService
  (assertWorkerRoleSafe + fail-closed); reviewer soi diff.
- **NGOÀI phạm vi** (ghi rõ): giảm `SYSTEM_JOBS_POLL_MS` (đòn 0-code owner tự chỉnh .env.prod); lịch riêng
  per-job cho scheduler; dọn bảng khác.
