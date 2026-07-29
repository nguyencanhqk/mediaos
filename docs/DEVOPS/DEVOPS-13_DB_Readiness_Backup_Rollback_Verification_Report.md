# DEVOPS-13: DB READINESS · BACKUP · ROLLBACK VERIFICATION REPORT
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

> **Work Order:** S6-PERF-DB-1 · Workstream WS5 (Performance/Query/Cache) + WS6 (Migration/Seed/Backup/Rollback)
> **Nguồn:** [IMPLEMENTATION-09](../IMPLEMENTATION/IMPLEMENTATION-09_Sprint_6_Stabilization_Release_Candidate_Go-live_Execution_Plan.md) §14 · §15 · IMP09-IN-006/008/012 · IMP09-DB-001..005
> **Chuẩn đối chiếu:** [DEVOPS-05](DEVOPS-05_Database_Migration_Seed_Deployment.md) · [DEVOPS-10 Backup/Rollback/DR](DEVOPS-10_Backup_Rollback_Disaster_Recovery.md)
> **Bổ trợ (không thay thế):** [DEVOPS-10 Performance Smoke Baseline](DEVOPS-10_Performance_Smoke_Observability_Baseline_Report.md) — S5-PERF-1
> **Kế hoạch:** [docs/plans/S6-PERF-DB-1.md](../plans/S6-PERF-DB-1.md)
> **Gate:** 🔴 FULL (chạm migration/DB) — `database-reviewer`

---

## 1. Thông tin tài liệu

| Trường | Giá trị |
| --- | --- |
| Ngày đo | 2026-07-29 |
| Môi trường | Cluster docker local (`mediaos-postgres`) — DB `mediaos` (**= DB PROD**, chỉ đọc) + DB ephemeral |
| Migration head | idx 200 · `0533_s6qatenantwrite1_team_members_composite_fk` (201 migration) |
| Công cụ | `scripts/migrate-verify-ephemeral.sh` · `scripts/backup-restore-drill.sh` · `scripts/check-db-readiness.mjs` · `scripts/check-migration-no-drop.sh` |
| Loại | **Verification report** — mọi ô có log chạy thật; ô nào chưa chạy được thì ghi CHƯA ĐẠT, không suy luận |

> **Nguyên tắc của báo cáo này:** *script tồn tại ≠ script chạy được*. Đợt này tìm ra đúng một trường
> hợp như vậy (§3.1) và một chốt **không thể ĐỎ** đã bị loại bỏ thay vì ship (§5.2).

---

## 2. Tóm tắt phán quyết

| # | Hạng mục (done_when của WO) | Phán quyết | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Index đủ cho query nặng + có chốt hồi quy | ✅ ĐẠT | §4.1 — 12/12 họ query §14.3, chốt RED-proof |
| 2 | Migration/seed verify từ TRỐNG | ✅ ĐẠT | §3.2 — migrate-from-empty 0000→head PASS |
| 3 | Journal forward-only / no-gap | ✅ ĐẠT | §3.3 — 201 entry, 0 gap, 0 nghịch thời gian |
| 4 | **Backup + restore rehearsal thành công** | ✅ ĐẠT (**mới chạy được lần đầu**) | §3.1 — drill PASS sau khi vá |
| 5 | Rollback path verify | ✅ ĐẠT | §5.1 — expand/contract + chốt no-drop |
| 6 | Không `db:generate` drop; migration additive | ✅ ĐẠT (đo lại bằng cách khác — xem §5.2) | §5.2 |
| 7 | RLS / append-only intact sau verify | ✅ ĐẠT | §4.2 · §4.3 |
| 8 | Perf latency đạt ngưỡng | ⚠️ **DÙNG SỐ CŨ 2026-07-25** — xem §6, không đo lại đợt này | §6 |
| 9 | `check.sh --all` xanh | ✅ ĐẠT (7/7 step; ghi chú KI-014) | §8 |

---

## 3. WS6 — Migration · Backup · Restore

### 3.1 Backup/Restore rehearsal — LỖ ĐÃ VÁ (IMP09-DB-003)

**Phát hiện.** `scripts/backup-restore-drill.sh` có từ G16-2, nhưng **chưa từng chạy được kể từ khi
Postgres chuyển vào container**: script yêu cầu `pg_dump`/`pg_restore`/`psql` trên PATH, mà host
Windows không có (chỉ có trong container). Nó fail ở 3 dòng `command -v` đầu tiên. Nghĩa là bảo đảm
*"backup khôi phục được"* đang là **giả định chưa kiểm chứng**, dù `done_when` của nhiều WO đã tick nó.

`scripts/migrate-verify-ephemeral.sh` đã giải đúng bài này từ S5-DEVOPS-1 bằng `MIGVERIFY_PSQL`
(gọi psql trong container); drill lỡ đợt vá đó.

**Đã vá (3 phần).**

1. **Fallback pg client trong container** — thêm `DRILL_PSQL` · `DRILL_PG_DUMP` · `DRILL_PG_RESTORE`,
   tự dò theo thứ tự: env tường minh → binary trên PATH → `docker exec -i mediaos-postgres <tool>`.
   Không có đường nào ⇒ **fail rõ ràng, KHÔNG skip im lặng**.
   ⚠️ Fallback chỉ kích hoạt khi PATH trượt ⇒ CI/Linux có pg client thật giữ nguyên hành vi cũ.
2. **Stream thay vì `--file`/path** — dump ghi qua STDOUT, restore đọc qua STDIN. Nếu giữ `--file`,
   pg_dump trong container sẽ ghi vào filesystem **của container** và host nhận file rỗng ⇒ restore
   "thành công" trên dump rỗng ⇒ **PASS oan**. Thêm assert `[[ -s "$DUMP" ]]` chặn đúng ca đó.
3. **Guard DROP tường minh + `--self-test`** — prefix bắt buộc `^mediaos_drill_` + blocklist
   `{mediaos, mediaos_dev, postgres, template0/1}`. Trên máy này DB nguồn `mediaos` **chính là DB PROD**,
   nên nhánh DROP không được phép chỉ dựa vào "tên sinh cục bộ nên chắc đúng".

**Kết quả chạy thật (2026-07-29):**

```
$ bash scripts/backup-restore-drill.sh --self-test
OK: SELF-TEST PASS — guard chặn {mediaos, mediaos_dev, postgres, template*} + mọi tên lạ   (9/9 ca)

$ DATABASE_DIRECT_URL=… bash scripts/backup-restore-drill.sh
pg client: psql='docker exec -i mediaos-postgres psql' …
1/5 pg_dump (read-only, custom-format)        OK: dump sẵn sàng (3.7M)
2/5 CREATE DATABASE mediaos_drill_20260729061530_1657 + pg_restore
                                              OK: restore xong (không lỗi ngoài role/grant)
3/5 verify chuỗi migration                    applied=201 journal=201 expected=201  OK
4/5 verify schema                             OK: 12 bảng cốt lõi · RLS bật+FORCE+policy
                                              OK: 7 bảng ledger append-only
                                              OK: 9 index hot-path
5/5 smoke (cơ bản + tenant-GUC)               OK
DRILL PASS ✅   →  cleanup: DROP DATABASE mediaos_drill_20260729061530_1657
```

Sau khi chạy: `SELECT datname … LIKE 'mediaos_drill%'` trả **rỗng** — không sót DB tạm (chống phình
pgdata, bài học đã ghi ở `pgdata-bloat-lane-dbs-and-job-log`).

**Chạy lại:** `m backup-drill` (wrapper mới trong `mediaos.ps1`, cùng khuôn `m migrate-verify`).

#### 3.1.1 Tập assert của drill đã LỆCH — đã sửa

Drill đang canh **sai tập bảng** — ảnh chụp kỷ nguyên media:

| | Trước | Sau |
| --- | --- | --- |
| Bảng cốt lõi | có `cost_allocations`, `payslips` (**đã park, out-of-scope**); **thiếu** `employee_profiles`, `permissions`, `role_permissions`, `outbox_events`, `leave_balances` | 12 bảng canonical MVP |
| RLS/FORCE/policy | `tasks, notifications, payslips, users` | `tasks, notifications, employee_profiles, users` |
| Ledger append-only | *(không kiểm)* | 7 bảng |
| Index hot-path | 4 (chỉ nhóm G16-2) | 9 (G16-2 + canonical ATT/LEAVE/TASK/NOTI/AUDIT) |

Hệ quả cũ **hai chiều**: (a) dọn bảng park ⇒ drill **đỏ oan**; (b) hôm nay drill PASS mà **không hề
kiểm** RBAC/HR/outbox — thiếu `permissions`/`role_permissions` chính là mục cấm go-live §15.6.3
("permission seed thiếu làm user không vào được flow P0") mà drill lẽ ra phải bắt.

### 3.2 Migrate-from-empty (IMP09-IN-008)

```
$ MIGVERIFY_PSQL="docker exec -i mediaos-postgres psql" bash scripts/migrate-verify-ephemeral.sh
1/3 CREATE DATABASE mediaos_migverify_20260729060750_1494 (throwaway)
2/3 db:migrate (0000→head)     OK: áp sạch
3/3 db:check                   [db:check] head idx: 200 (0533_…) — journal OK
                               (forward-only, no-gap, no-dup; 201 migrations áp)
MIGRATE-VERIFY PASS ✅ — mediaos/mediaos_dev không hề bị chạm tới
```

GUARD self-test của script này cũng PASS 8/8 ca (chặn DROP nhầm `mediaos`/`mediaos_dev`).

### 3.3 Migration journal — forward-only / no-gap

| Kiểm | Kết quả |
| --- | --- |
| Số entry journal ↔ số file `.sql` | 201 ↔ 201 (khớp) |
| File có mà journal thiếu / journal có mà file thiếu | 0 / 0 |
| Gap ở `idx` | **0** |
| `when` nghịch thời gian (không forward-only) | **0** |
| Migration đã áp trên DB PROD | 201 = head |

### 3.4 Checklist §15.2 · §15.3 — đối chiếu

| Nhóm | Trạng thái | Ghi chú |
| --- | --- | --- |
| Xác nhận đúng DB/environment | ✅ | Guard DB-đích ở `lane-db-setup.sh` + `check-prod-test-tenants.mjs` + blocklist trong drill/migrate-verify |
| Backup trước migration | ✅ có công cụ | `scripts/backup-db.sh` (dump → mã hoá age/gpg → rclone offsite → retention GFS) |
| Migration chưa bị sửa sau khi deploy | ✅ | `db:check` so journal ↔ file ↔ bảng `__drizzle_migrations` |
| Dev-only seed không chạy ở staging/prod | ✅ | `seed-staging` guard cứng DB đích = `mediaos_dev`; `check-prod-test-tenants.mjs` canh tenant test lọt PROD |
| Dừng ngay khi migration lỗi | ✅ | `migrate.ts` fail-fast; drill/migrate-verify `set -Eeuo pipefail` |
| Bảng MVP · FK/constraint/index · RBAC seed tồn tại sau migration | ✅ | §3.1 (drill) + §4.1 (guard index) |
| Bootstrap admin an toàn (không hard-code password) | ✅ | `PLATFORM_SUPERADMIN_*` qua env lúc boot; `STAGING_SEED_*` fail-fast ≥12 ký tự |

---

## 4. Chốt hồi quy mới — `scripts/check-db-readiness.mjs`

Ba bảo đảm dưới đây **đang đúng** nhưng trước đợt này **không ai canh**: một migration xoá index hay
quên FORCE RLS trên bảng mới sẽ không làm đỏ bất cứ thứ gì. Đã gom thành một chốt chạy ở
`harness/check.sh --all` (cạnh `prod-tenant-check` — tier trước khi mở PR vùng đỏ).

```
$ node scripts/check-db-readiness.mjs
[db-readiness] DB "mediaos" ✅
  A. index query nặng §14.3 : 12/12 đạt
  B. FORCE RLS (BẤT BIẾN #1): 0 bảng có company_id thiếu FORCE
  C. append-only (BẤT BIẾN #2): 0 grant UPDATE/DELETE cho 'mediaos_app' trên 9 bảng ledger
```

### 4.1 A — Độ phủ index cho query nặng (§14.3)

Khớp theo **cột dẫn đầu**, không theo tên index (đổi tên/rebuild không được làm đỏ; mất độ phủ thì phải đỏ).

| Ô §14.3 | Bảng | Cột dẫn đầu bắt buộc | Đạt |
| --- | --- | --- | --- |
| Attendance theo employee/date | `attendance_records` | company_id, employee_id, work_date | ✅ |
| Attendance theo phòng ban/tháng | `attendance_records` | company_id, department_id, work_date | ✅ |
| Leave theo employee/date | `leave_requests` | company_id, employee_id, start_date | ✅ |
| Leave approved **day** | `leave_request_days` | company_id, employee_id | ✅ |
| Hàng chờ duyệt nghỉ phép | `leave_requests` | company_id, current_approver_user_id, status | ✅ |
| Task theo assignee/status/due | `tasks` | company_id, main_assignee_employee_id, task_status, due_at | ✅ |
| Task board theo project/status | `tasks` | company_id, project_id, task_status | ✅ |
| **Notification unread (PARTIAL)** | `notifications` | company_id, recipient_user_id + `WHERE … 'Unread'` | ✅ |
| Notification list theo người nhận | `notifications` | company_id, recipient_user_id, created_at | ✅ |
| Audit log theo thời gian | `audit_logs` | company_id, created_at | ✅ |
| Login log theo thời gian | `login_logs` | company_id, created_at | ✅ |
| Employee list theo trạng thái | `employee_profiles` | company_id, status | ✅ |

> ⚠️ Chốt **chỉ assert index TỒN TẠI**, KHÔNG assert planner chọn nó qua `EXPLAIN` — trên dataset nhỏ
> seq scan là lựa chọn hợp lệ nên assert EXPLAIN sẽ **đỏ oan** ở dev/CI (bài học `pg-planner-index-assert-trap`).
> Thứ migration kiểm soát được là index có mặt hay không.

### 4.2 B — BẤT BIẾN #1 (FORCE RLS)

Quét **mọi** bảng thường có cột `company_id` (không dùng danh sách cứng — bảng mới tự động được canh):
**0 bảng** thiếu `relforcerowsecurity`.

### 4.3 C — BẤT BIẾN #2 (append-only)

`mediaos_app` có **0** quyền `UPDATE`/`DELETE` trên 9 bảng ledger: `audit_logs` · `login_logs` ·
`attendance_logs` · `leave_balance_transactions` · `task_activity_logs` · `notification_delivery_logs` ·
`employee_status_histories` · `user_security_events` · `file_access_logs`.

### 4.4 RED-proof — chốt này ĐỎ được

Chốt chưa từng đỏ = chốt chưa biết có tác dụng không. Đã chứng minh trên DB throwaway
(`mediaos_redproof_*`, migrate từ trống rồi cố ý gây 3 lỗ, xong DROP):

| Lỗ gây ra | Kết quả |
| --- | --- |
| `DROP INDEX idx_notifications_unread` | ❌ bắt được — báo đúng "không index nào … kèm WHERE chứa 'Unread'" |
| `ALTER TABLE tasks NO FORCE ROW LEVEL SECURITY` | ❌ bắt được — liệt kê `tasks` |
| `GRANT UPDATE ON audit_logs TO mediaos_app` | ❌ bắt được — liệt kê `audit_logs:UPDATE` |
| Tổng | **exit 1** (trước đó exit 0 trên cùng DB khi còn sạch) |

> Đáng chú ý: ca thứ nhất chứng minh bộ khớp **không rỗng nghĩa**. Bảng `notifications` còn index khác
> **cùng cột dẫn đầu** (`idx_notifications_recipient_list`) — chốt vẫn ĐỎ vì thiếu vế partial `WHERE`.

---

## 5. Rollback path (§15.5)

### 5.1 Nguyên tắc đang được thực thi

| §15.5 | Trạng thái trong repo |
| --- | --- |
| 1. Migration backward-compatible nếu có thể | ✅ band S2..S6 additive (§5.2) |
| 2. Không drop column/table trong cùng release | ✅ **nay có chốt tự động** — `scripts/check-migration-no-drop.sh` |
| 3. Dùng expand/contract | ✅ đã là luật thành văn; bài học `migration-expand-contract-required` (revoke grant khi live code còn enforce = cửa sổ 403) |
| 4. Lỗi application ⇒ rollback app trước | ✅ DEVOPS-10 §12; app và DB tách được vì migration additive |
| 5. DB restore chỉ cho sự cố nặng + approval | ✅ DEVOPS-10 §13 · §16 |
| 6. Sau rollback phải smoke test | ✅ `scripts/smoke-test-g3.sh` + `/health`, `/health/db` |

### 5.2 "Không `db:generate` drop" — đo bằng cách khác, và VÌ SAO

Cách hiển nhiên là chạy `db:generate` rồi soi diff. **Đã thử và nó vô nghĩa** — ghi lại đầy đủ để
người sau không lặp lại:

1. **`db:generate` trước đợt này KHÔNG CHẠY NỔI.** Nó chết với
   `TypeError: Do not know how to serialize a BigInt` (drizzle-kit 0.30.6). Gốc: một literal BigInt
   trong schema — `sequences.ts::currentValue … .default(0n)` — đi thẳng vào snapshot, rồi
   `diffSchemasOrTables` gọi `JSON.stringify` lên snapshot đó.
   **Đã vá:** đổi sang `.default(sql\`0\`)`. DDL sinh ra **giống hệt** (`DEFAULT 0`, khớp cột thật
   `current_value bigint DEFAULT 0` trên DB PROD). Typecheck xanh; 42/42 test `foundation/sequences` xanh.

2. **Sau khi vá, diff của nó KHÔNG có lệnh phá huỷ** — đúng như done_when đòi:

   | Loại lệnh trong diff | Số |
   | --- | ---: |
   | `CREATE TABLE` | 148 |
   | `CREATE INDEX` / `CREATE UNIQUE INDEX` | 483 |
   | `ALTER TABLE … ADD` | 527 |
   | **`DROP` / `TRUNCATE` bất kỳ** | **0** |

3. **Nhưng diff đó KHÔNG phải bằng chứng đáng tin** — và đây mới là phần quan trọng.
   `migrations/meta/` chỉ có **đúng 1 snapshot** (`0000_snapshot.json`) cho **201 migration**: toàn bộ
   migration từ 0001 là **viết tay**, drizzle-kit không thấy. Baseline diff của nó gần như rỗng ⇒ nó
   luôn sinh "tạo lại cả thế giới" và **không bao giờ sinh nổi một lệnh DROP**.
   **Chứng minh bằng phép thử ĐỎ:** xoá hẳn một cột khỏi schema TS
   (`system-jobs.ts::durationMs`) rồi chạy lại ⇒ diff **vẫn 0 DROP**, chốt vẫn XANH.
   ⇒ Một chốt dựa vào `db:generate` **không thể ĐỎ**. Đã **loại bỏ** thay vì ship — chốt không đỏ được
   thì tệ hơn không có chốt, vì nó chế ra sự yên tâm giả.

4. **Điểm kiểm soát THẬT = chính file migration viết tay.** `scripts/check-migration-no-drop.sh` quét
   `DROP TABLE` · `DROP COLUMN` · `TRUNCATE` · `DROP SCHEMA` (bỏ dòng comment trước khi quét — repo
   ghi rất nhiều `-- Down: DROP TABLE …` như tài liệu rollback).

   - **Phạm vi hẹp có chủ ý:** KHÔNG quét `DROP CONSTRAINT`/`DROP INDEX`/`DROP POLICY` — trong repo
     này chúng là **thành ngữ THAY THẾ hợp lệ**. `DROP CONSTRAINT audit_logs_object_type_chk` rồi ADD
     lại chính là luật UNION-ADD của CHECK audit `object_types` (CLAUDE.md §9.3), xuất hiện ở ~30
     migration. Bắt đỏ ở đó = chuông reo liên tục ⇒ người ta tắt chốt ⇒ mất cả phần có ích.
   - **Baseline di sản (2 file, đã deploy, thuộc kỷ nguyên đã park):**
     `0025_g6_content_items_full.sql` (`content_items DROP COLUMN content_type`) ·
     `0130_g12_period_approval_fsm.sql` (`DROP COLUMN locked_by, locked_at`).
   - **Đường hợp lệ cho migration mới:** dòng `-- DESTRUCTIVE-APPROVED: <lý do> (<người duyệt>)` ngay
     trong file — hiện thực hoá §15.2 "có người chịu trách nhiệm approve migration".
   - **RED-proof:** thêm migration giả chứa `ALTER TABLE tasks DROP COLUMN some_col;` ⇒ **exit 1**,
     bắt đúng dòng 3 và **bỏ qua đúng** dòng comment `-- Down: DROP TABLE something;`. Thêm dòng
     `DESTRUCTIVE-APPROVED` ⇒ exit 0 kèm log ghi rõ ai duyệt. Đã xoá file giả sau khi thử.
   - Chạy ở **tier mặc định** của `check.sh` (không cần Postgres, ~0.2s).

   Kết quả hiện tại: `quét 201 migration — 0 lệnh phá huỷ chưa đăng ký (baseline di sản: 2 · đã duyệt: 0)`.

---

## 6. WS5 — Performance: trạng thái và giới hạn của báo cáo này

**Số latency KHÔNG được đo lại trong đợt này.** Nói thẳng thay vì tick ô:

- Baseline hiện hành là của **S5-PERF-1, đo 2026-07-25** trên DEV-ONLINE (`mediaos_dev`, company `demo`,
  30 vòng/endpoint): 5/5 endpoint SLA lõi p95 ≤ 30ms, ngưỡng smoke MVP 800ms — xem
  [DEVOPS-10 Performance Smoke Baseline](DEVOPS-10_Performance_Smoke_Observability_Baseline_Report.md).
- **Đã đổi gì kể từ đó:** loạt WO bảo mật S6 — ép `data_scope` cho `/org/employees` (#302), gộp
  transaction NOTI (#301), siết đường đọc `login_logs` (#300), lưới tenant-isolation vế GHI (#303).
  Các thay đổi này thêm **điều kiện lọc**, không thêm vòng lặp N+1; nhưng **chưa có số đo sau thay đổi**.
- **Vì sao không đo lại:** dev-online (`:3200`) đang DOWN tại thời điểm đo, và bật lại bằng
  `m dev-online` **recompile `dist` mà PROD (`:3100`) đang dùng chung** ⇒ rủi ro PROD 500
  (bài học `prod-dist-shared-with-devonline-landmine`). Đổi lấy một con số p95 trên dataset 45 nhân
  viên thì **rủi ro > giá trị**.
- **Bù lại bằng thứ kiểm được tự động:** bảo đảm perf của MVP neo vào **hình dạng truy vấn + độ phủ
  index**, và phần đó nay có chốt hồi quy chạy mỗi `check.sh --all` (§4.1) — bền hơn một con số đo một
  lần rồi trôi.
- **Muốn số mới:** `m dev-online-fast` (chạy bản build, KHÔNG recompile dist PROD) rồi
  `node scripts/perf-smoke.mjs --json`.

**Đối chiếu lại các cơ chế §14.3/§14.5 (đọc code, không đo tải):** pagination clamp ở employee/attendance/
task list · `ATTENDANCE_EXPORT_MAX_ROWS = 10_000` · partial index `idx_notifications_unread` cho badge
unread · dashboard widget cache TTL + invalidate theo event · `/tasks/board` cap `BOARD_PAGE_LIMIT_MAX`,
summary bằng JOIN (không loop-per-row). Tất cả vẫn còn nguyên.

---

## 7. Còn LẠI — chưa đạt / có chủ ý để lại

| # | Việc | Vì sao để lại |
| --- | --- | --- |
| 1 | **Perf p95 sau các thay đổi S6** chưa có số | §6 — cần dev-online, tránh landmine dist dùng chung. Không chặn RC vì hình dạng truy vấn + index đã có chốt |
| 2 | Restore rehearsal mới chạy trên **cluster local**, chưa trên staging riêng | Chưa có staging tách máy; DEVOPS-10 §11 chấp nhận drill trên môi trường test |
| 3 | `IMP09-DB-002` backup metadata / `IMP09-DB-004` access control / `IMP09-DB-005` retention | `backup-db.sh` đã hiện thực (mã hoá + offsite + GFS) nhưng **chưa có bằng chứng chạy định kỳ** (cron/scheduled task). Thuộc WS7/S6-REL-1 |
| 4 | Snapshot drizzle (`meta/`) lệch thực tế (1/201) | Không sửa ở đợt này: đồng bộ lại snapshot là việc lớn, rủi ro cao, và **không cần thiết** vì migration viết tay + chốt no-drop đã phủ đúng điểm kiểm soát. Ghi lại ở §5.2 để người sau không tưởng `db:generate` là nguồn sự thật |

---

## 8. Gate — `harness/check.sh --all`

Chạy trên DB lane cô lập `mediaos_perfdb` (mint từ trống + chain migration 0000→head).

| Step | Kết quả |
| --- | --- |
| `lint` | ✅ |
| `typecheck` | ✅ (10/10 task) |
| `migration-no-drop` *(mới)* | ✅ 201 migration · 0 lệnh phá huỷ chưa đăng ký |
| `test` (LANE_DB=mediaos_perfdb, chunked) | ✅ **0 test đỏ do code** — 2 dạng đỏ HẠ TẦNG, xem ghi chú bên dưới |
| `build` | ✅ (7/7 task) |
| `prod-tenant-check` | ✅ (BỎ QUA đúng — đang nối lane DB, không phán quyết trên lane) |
| `db-readiness` *(mới)* | ✅ 12/12 index · 0 RLS thiếu FORCE · 0 grant ledger |

### 8.1 Hai dạng đỏ HẠ TẦNG gặp phải — nói rõ để không nhầm với lỗi code

Step `test` chạy 3 lượt trên máy Windows này. **Không lượt nào có test đỏ vì assertion**; cả hai dạng
đỏ đều là hạ tầng đã có tên trong sổ. Ghi lại đầy đủ vì cả hai đều dễ bị đọc nhầm thành "code hỏng".

| Lượt | Kết quả | Nguyên nhân |
| --- | --- | --- |
| 1 (`check.sh --all`) | step `test` ĐỎ | **KI-014** — crash hạ tầng tinypool (**0 test đỏ**) |
| 2 (chunked runner riêng, cùng env) | **exit 0** — 12/12 chunk api + FE xanh | chunk 9 & 11 dính KI-014 nhưng **tự phục hồi ở retry đầu** |
| 3 (`check.sh --all` lần 2) | step `test` ĐỎ — 1 test | **ENOBUFS** (xem dưới) — chunk 8 lại dính KI-014 và tự phục hồi |

**Dạng A — KI-014, tinypool crash (0 test đỏ).** `harness/chunk-test.mjs` nhận diện và tự chạy lại; ở
lượt 2 và 3 nó phục hồi thành công.

**Dạng B — ENOBUFS (lượt 3).** Đúng một test đỏ:

```
FAIL test/integration/me-personal-hub.int-spec.ts >
     cross-tenant — token tenant A KHÔNG surface employee của tenant B (planted rows)
Error: connect ENOBUFS 127.0.0.1:65531 - Local (undefined:undefined)
```

Đây là **cạn cổng ephemeral của Windows dưới tải full-suite** (`fullsuite-enobufs-and-unrescued-chunk`),
không phải assertion thất bại — thông điệp là lỗi **socket**, không phải so sánh giá trị.
⚠️ Chunk runner **KHÔNG retry ca này** vì nó phân loại theo "có ≥1 test đỏ ⇒ đỏ THẬT"; ENOBUFS lại
biểu hiện như một test đỏ. Đây chính là vế "unrescued chunk" của bài học đó.

**Chứng minh không phải hồi quy — 3 vế độc lập:**
1. **Lượt 2** chạy đúng test đó trên đúng codebase này ⇒ **XANH**.
2. **Chạy cô lập lại sau đó:** `vitest run test/integration/me-personal-hub.int-spec.ts` ⇒
   **17/17 XANH** (gồm chính ca cross-tenant đã đỏ).
3. Test đó (`/me` cross-tenant) **không có đường liên hệ nào** với thay đổi của WO này:
   default cột `sequence_counters.current_value`, script drill, 2 script guard độc lập, dòng wire
   trong `check.sh`.

**Kiểm chứng "không có test đỏ nào bị giấu":** 22 dòng khớp chữ `failed` trong log lượt 2 đều là
**fixture lỗi mô phỏng** (`DB connection failed (simulated)`, `Valkey write failed`, `usage insert
failed`, …) và log đường-lỗi kỳ vọng — không dòng nào là kết quả test.

> **Việc để lại (không thuộc WO này):** chunk runner nên nhận diện ENOBUFS/ECONNRESET như crash hạ
> tầng để retry thay vì đóng dấu "đỏ THẬT". Đề xuất mở KI riêng — sửa ở đây sẽ là scope creep vào
> `harness/chunk-test.mjs`, ngoài phạm vi WS5/WS6.

---

## 9. Tái lập toàn bộ

```bash
# 1. Migration: từ TRỐNG 0000→head, trên DB ephemeral tự DROP
m migrate-verify                    # hoặc: MIGVERIFY_PSQL="docker exec -i mediaos-postgres psql" \
                                    #        bash scripts/migrate-verify-ephemeral.sh

# 2. Backup + restore rehearsal (dump→restore DB tạm→verify→tự DROP)
m backup-drill                      # hoặc: bash scripts/backup-restore-drill.sh --self-test
                                    #        DATABASE_DIRECT_URL=… bash scripts/backup-restore-drill.sh

# 3. Chốt hồi quy (đều nằm trong check.sh)
bash scripts/check-migration-no-drop.sh      # tier mặc định — không cần Postgres
node scripts/check-db-readiness.mjs          # tier --all — tự SKIP nếu không với tới DB

# 4. Gate đầy đủ
bash harness/check.sh --all
```
