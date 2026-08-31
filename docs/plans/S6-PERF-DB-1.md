# S6-PERF-DB-1 — Performance/Query/Cache hardening + DB Migration/Seed/Backup/Rollback verification (WS5/WS6)

> **Zone:** 🔴 red (crown) · **Gate:** FULL (`database-reviewer` — chạm migration/DB) · **Layer:** DEVOPS/DB
> **Nguồn:** IMPLEMENTATION-09 §14 (WS5) · §15 (WS6) · IMP09-IN-006/008/012 · DB-01..10 · DEVOPS-05 · DEVOPS-10
> **Phụ thuộc:** S6-STAB-1 ✓
> **Ngày lập:** 2026-07-29 · lập SAU khi đo trạng thái thật (§1), không lập từ tiêu đề WO

---

## 0. Kết luận một dòng

Phần lớn WS5/WS6 **đã được xây từ S5-PERF-1 · S5-DEVOPS-1 · G1-8/G16-2**. Việc thật còn lại của WO này
**không phải xây mới** mà là: (a) **chứng minh chạy được** thứ đã có, (b) **vá 2 chỗ đang hỏng/lệch** mà
phép đo phát hiện, (c) **cắm chốt hồi quy** để các bảo đảm perf/DB không âm thầm trôi, (d) **ký bằng chứng**
vào `docs/DEVOPS/`.

Bài học neo: `wo-seed-hand-measurements-can-be-incomplete` + `patched-version-unpatched-main-entry` —
**script tồn tại ≠ script chạy được**. Mọi ô dưới đây phải có log chạy thật, không có ô nào tick bằng suy luận.

---

## 1. ĐO TRƯỚC KHI SỬA — trạng thái thật ngày 2026-07-29

Tất cả số dưới đây lấy bằng lệnh chạy thật trên cluster docker local (`mediaos-postgres`, DB `mediaos` = DB PROD,
**chỉ đọc**), không suy từ code/doc.

| # | Hạng mục kiểm | Cách đo | Kết quả |
| --- | --- | --- | --- |
| M1 | Migration journal: số entry · gap idx · `when` đơn điệu · file↔journal 1:1 | đọc `meta/_journal.json` + `readdirSync` | ✅ 201 entry · **0 gap** · **0 nghịch thời gian** · **0 file lệch** |
| M2 | Migrate-from-empty (0000→head) trên DB ephemeral + `db:check` | `scripts/migrate-verify-ephemeral.sh` (MIGVERIFY_PSQL=docker) | ✅ **PASS** — head idx 200 (`0533_...`), 201 migration áp sạch, DB ephemeral tự DROP |
| M3 | GUARD self-test của migrate-verify (chặn drop nhầm `mediaos`/`mediaos_dev`) | `--self-test` | ✅ PASS 8/8 ca |
| M4 | BẤT BIẾN #1 — FORCE RLS trên **mọi** bảng có `company_id` | `pg_class.relforcerowsecurity` | ✅ **0 bảng vi phạm** |
| M5 | BẤT BIẾN #2 — append-only: app role không có UPDATE/DELETE trên 11 bảng ledger | `information_schema.role_table_grants` | ✅ **0 grant** |
| M6 | Index hot-path §14.3 (ATT/LEAVE/TASK/NOTI/AUDIT) | `pg_indexes` | ✅ đủ mặt (chi tiết §2.1) |
| M7 | Migration band hiện tại có lệnh phá huỷ không | grep `DROP TABLE\|DROP COLUMN` | ✅ chỉ ở **comment `-- Down:`** + 3 dòng thật thuộc **kỷ nguyên media đã park** (`content_items`, `locked_by/at`) — band S2..S6 **additive** |
| M8 | `backup-restore-drill.sh` **chạy được trên máy này** | `command -v pg_dump/pg_restore/psql` | ❌ **KHÔNG** — host Windows không có pg client trên PATH, chỉ có trong container |
| M9 | Danh sách bảng cốt lõi mà drill assert | đọc script | ❌ **LỆCH** — assert `payslips`, `cost_allocations` (**đã park, out-of-scope**); **thiếu** `employee_profiles`, `permissions`, `role_permissions`, `outbox_events` |
| M10 | Chốt hồi quy cho "index đủ cho query nặng" | tìm trong `check.sh`/CI | ❌ **KHÔNG CÓ** — §14.3 hôm nay là checklist người đọc, không ai canh |
| M11 | Baseline perf mới nhất | `DEVOPS-15_Performance_Smoke...md` | ⚠️ đo **2026-07-25** trên dev-online, **trước** loạt thay đổi S6 (data_scope /org, NOTI tx, matview wrapper) |
| M12 | dev-online :3200 sống không (để chạy perf-smoke) | `curl /health` | ❌ **DOWN** (000). PROD :3100 → 200 |

**Đọc bảng trên:** 7 ô XANH là bảo đảm **đang đúng** — việc của WO là **khoá chúng lại** bằng chốt hồi quy, không
phải xây lại. 5 ô ĐỎ/VÀNG (M8·M9·M10·M11·M12) là **việc thật** của WO.

### 1.1 Hai lỗ thật mà phép đo phát hiện

**LỖ-1 (M8) — "restore rehearsal" là lời hứa không kiểm chứng được.**
`done_when` của WO đòi *"backup + restore rehearsal thành công"*. Script `scripts/backup-restore-drill.sh` tồn tại
từ G16-2 và **fail ngay dòng 27** trên máy này vì không có `pg_dump` trên PATH. Nghĩa là: kể từ khi Postgres
chuyển vào container, **drill chưa từng chạy được** — bảo đảm "backup khôi phục được" đang là giả định.
`migrate-verify-ephemeral.sh` đã giải đúng bài này bằng `MIGVERIFY_PSQL` (gọi psql trong container); drill
**chưa được vá cùng đợt**.

**LỖ-2 (M9) — drill đang canh sai tập bảng.**
`CORE_TABLES` của drill là ảnh chụp kỷ nguyên media: assert `payslips` + `cost_allocations` tồn tại, và
**không** assert `employee_profiles` (bảng HR canonical), `permissions`/`role_permissions` (RBAC — thiếu là
user không vào được flow P0, đúng mục cấm của §15.6.3), `outbox_events` (event bus, luật phụ thuộc §3).
Hệ quả **hai chiều**: (a) khi dọn bảng park → drill **đỏ oan**; (b) hôm nay drill **PASS mà không hề kiểm**
RBAC/HR/outbox — đúng loại "PASS oan" đã ghi ở `audit-check-union-parse-anchor-trap`.

---

## 2. Phạm vi WO — 5 việc, không hơn

> Nguyên tắc RELEASE-05 §4.1: WO đợt S6 chỉ nhận **nợ đã đo**, không mở scope mới. Mọi việc dưới đây neo
> vào một ô ĐỎ/VÀNG ở §1.

### V1 — Vá `backup-restore-drill.sh`: chạy được trong container (đóng LỖ-1)

- Thêm 3 biến thoát y hệt cơ chế `MIGVERIFY_PSQL`: `DRILL_PSQL` · `DRILL_PG_DUMP` · `DRILL_PG_RESTORE`.
  Mặc định = binary trên PATH ⇒ **không đổi hành vi ở Linux/CI**.
- Auto-fallback: PATH không có pg client **mà** container `mediaos-postgres` đang chạy ⇒ tự dùng
  `docker exec -i mediaos-postgres <tool>`. Không có cả hai ⇒ fail rõ ràng (KHÔNG skip im lặng).
- Kỹ thuật stream (dump/restore chạy trong container, file nằm ở host):
  `pg_dump ... --file=-` → stdout → redirect host; `pg_restore --dbname=...` ← stdin từ host.
  URL `localhost:5432` phân giải đúng **cả trong container** (postgres tự lắng nghe 5432) — đã verify.
- Wrapper `m backup-drill` trong `mediaos.ps1`, cùng khuôn `Invoke-MigrateVerify` (dò psql → set env → gọi bash).

**Rào an toàn giữ nguyên, không nới:** drill chỉ `pg_dump` **read-only** trên DB nguồn; DB tạm tên
`mediaos_drill_<stamp>_<pid>`; DROP trong `trap EXIT`. **Bổ sung** blocklist tường minh giống migrate-verify
(`mediaos`, `mediaos_dev` không bao giờ được DROP) — hôm nay drill dựa vào tên sinh ngẫu nhiên là **đủ trên
thực tế nhưng không có guard tường minh**; thêm cho đồng nhất với `migrate-verify`.

### V2 — Sửa tập assert của drill cho khớp sản phẩm de-media-fy (đóng LỖ-2)

- `CORE_TABLES`: **bỏ** `payslips`, `cost_allocations` (park). **Thêm** `employee_profiles`, `permissions`,
  `role_permissions`, `outbox_events`, `leave_balances`.
- Bảng kiểm RLS/FORCE/policy: thay `payslips` → `employee_profiles` (bảng nhạy cảm THẬT của MVP).
- Danh sách index assert: thêm nhóm hot-path canonical hiện đang **không được canh**:
  `idx_attendance_records_employee_date` · `idx_leave_requests_employee_date` ·
  `idx_tasks_assignee_status_due` · `idx_notifications_unread`.
- ⚠️ **Không** đổi giá trị `EXPECTED_MIGRATIONS` mặc định (đang đọc động từ journal — đúng rồi).

### V3 — Chốt hồi quy index cho query nặng (đóng M10)

- Thêm `scripts/check-perf-indexes.mjs`: khai **tường minh** từng họ query nặng của §14.3 ↔ index bắt buộc
  (bảng · cột dẫn đầu · điều kiện partial), rồi đối chiếu với `pg_indexes` của DB đích. Thiếu ⇒ **exit 1**.
- **Chỉ đọc**, tự SKIP + exit 0 khi không với tới DB (không phá CI/máy không có Docker) — cùng khuôn
  `check-prod-test-tenants.mjs`.
- Wire vào `harness/check.sh` ở tier `--all` (cạnh `prod-tenant-check`) — tier trước khi mở PR vùng đỏ.
- ⚠️ **CẤM** assert planner chọn đích danh index qua `EXPLAIN` — bài học `pg-planner-index-assert-trap`
  (dataset nhỏ ⇒ seq scan hợp lệ ⇒ đỏ oan). Chỉ assert **index TỒN TẠI**, đó mới là thứ migration kiểm soát được.

### V4 — Chạy thật + thu bằng chứng

- Chạy `migrate-verify` (đã xong, M2) · `backup-restore-drill` (sau V1/V2) · `check-perf-indexes` (sau V3).
- Perf-smoke: dev-online DOWN (M12). **Quyết định:** không bật dev-online chỉ để lấy số
  (`prod-dist-shared-with-devonline-landmine`: `m dev-online` recompile dist mà PROD đang chạy ⇒ nguy cơ PROD 500 —
  chi phí rủi ro > giá trị một con số p95 trên dataset 45 NV). Thay bằng: giữ baseline S5-PERF-1 làm mốc,
  ghi rõ **ngày đo + điều kiện + cái gì đã đổi từ đó**, và neo bảo đảm perf vào **hình dạng truy vấn + index**
  (V3) — thứ kiểm được tự động, không trôi theo môi trường. Nếu owner muốn số mới: `m dev-online-fast` rồi
  `node scripts/perf-smoke.mjs --json`.

### V5 — Ký bằng chứng vào `docs/DEVOPS/`

- File mới `docs/DEVOPS/DEVOPS-13_DB_Readiness_Backup_Rollback_Verification_Report.md`:
  bảng §1 (đo trước) · kết quả chạy sau vá · đối chiếu checklist §15.2/§15.3/§15.4 · rollback path §15.5
  (expand/contract, app-rollback-trước, restore chỉ khi sự cố nặng) · phần **CHƯA đạt** ghi thẳng, không tô hồng.
- Cập nhật `docs/DEVOPS/DEVOPS-00` traceability + `harness/backlog.mjs` (CLAUDE §8).

---

## 3. Có cần migration không?

**KHÔNG — trừ khi V3 phát hiện index thiếu.** M6 cho thấy các họ index §14.3 đã đủ mặt. Nếu V3 báo thiếu:

- Migration đánh số **0535** trở đi — **0534 đã bị PR #306 (S6-SEC-MV-1) lấy** và PR đó đang mở, chưa merge.
  (Bài học `wo-paths-drive-gate-and-scheduler`: đụng số đang bay = conflict + gate lệch.)
- `CREATE INDEX` phải **`IF NOT EXISTS`** và additive thuần; KHÔNG `CONCURRENTLY` trong migration transaction
  của drizzle (sẽ lỗi) — nếu cần CONCURRENTLY thì tách runbook thủ công, ghi vào DEVOPS-05.

---

## 4. Rủi ro & cách chặn

| # | Rủi ro | Chặn |
| --- | --- | --- |
| R1 | Drill sửa xong lại **chạm DB PROD** (`mediaos` là DB PROD trên máy này) | Drill chỉ `pg_dump` read-only nguồn; V1 thêm blocklist tường minh cho nhánh DROP; chạy thử với `KEEP_TEMP=1` một lần để mắt người soi tên DB tạm trước khi tin `trap` |
| R2 | `docker exec` fallback vô tình bật ở **CI Linux** (nơi có pg client thật) | Fallback CHỈ kích hoạt khi `command -v` trượt **và** container tồn tại; PATH có tool ⇒ đường cũ, byte-identical |
| R3 | Guard index mới làm **đỏ oan** máy không có Docker | SKIP + exit 0 khi không kết nối được (khuôn `check-prod-test-tenants.mjs`); chỉ chạy ở tier `--all` |
| R4 | Guard index đóng đinh index **sai/thừa** ⇒ sau này không xoá được index rác | Danh sách khai **theo họ query của §14.3**, mỗi dòng ghi rõ query nào cần; xoá index ⇒ phải sửa guard **có chủ ý** (đó là tính năng, không phải phiền toái) — bài học `tests-can-pin-a-hole-open` nhắc phải đọc assert trước khi nghi mình hỏng |
| R5 | Perf "đạt ngưỡng" tick bằng số **cũ 4 ngày** | V4 ghi rõ ngày/điều kiện/delta; không tick ô nào bằng số cũ mà không ghi chú |
| R6 | Trùng số migration với PR #306 đang bay | §3: bắt đầu từ 0535; kiểm `git fetch` + `ls migrations` ngay trước khi tạo |
| R7 | Drill để lại DB tạm khi bị Ctrl-C ⇒ **pgdata phình** (bài học `pgdata-bloat-lane-dbs-and-job-log`) | `trap EXIT` sẵn có; V4 verify bằng `\l` sau khi chạy, đếm DB `mediaos_drill_*` = 0 |

---

## 5. Definition of Done (ánh xạ done_when của WO)

- [ ] **DW1 perf** — index đủ cho mọi họ query nặng §14.3 **có chốt hồi quy chạy được** (V3 xanh, log kèm);
      pagination/export cap/unread partial index/dashboard cache đối chiếu lại còn đúng; baseline perf ghi rõ
      ngày + điều kiện + delta kể từ S5-PERF-1
- [ ] **DW2 DB readiness** — migrate-from-empty ✅ (M2) · journal forward-only/no-gap ✅ (M1) ·
      **backup + restore rehearsal chạy THẬT và PASS** (V1+V2+V4, có log) · rollback path verify + ghi runbook
- [ ] **DW3 bất biến** — `db:generate` không sinh diff phá huỷ; migration additive (M7); FORCE RLS (M4) +
      append-only (M5) **verify lại sau** khi drill restore xong, không chỉ trước
- [ ] **DW4 gate** — `bash harness/check.sh --all` xanh (hoặc `--lane-db`); FULL gate `database-reviewer` PASS;
      PR mở, **KHÔNG auto-merge** (zone đỏ, chờ người chốt)

---

## 6. Thứ tự thi công

```
V1 (drill container-fallback)  ─┐
V2 (drill assert set)          ─┴─▶ V4 chạy thật ──▶ V5 ký bằng chứng ──▶ check.sh --all ──▶ PR
V3 (guard index + wire check.sh) ┘
```

V1·V2 cùng file ⇒ làm nối tiếp trong một lượt. V3 độc lập file khác. Không có lane song song
(§9: 1 Work Order/phiên, tuần tự).
