# G11 — Progress Handoff (HR: Attendance · Leave)

> Trạng thái thực thi lane **G11** (HR — chấm công + nghỉ phép). Cập nhật mỗi viên.
> Nguồn kế hoạch: `TASKS.md` §G11 (M4) + §5 (Parallel Execution Playbook). Bất biến #4 (Task Hub): đơn công/nghỉ duyệt **qua `tasks.task_type='hr'`**, KHÔNG bảng approval riêng.

**Lane:** G11 · **Tier:** thường (Sonnet, KHÔNG plan-step — §5.6) · **Band migration:** `0060–0069`
**Branch:** `feat/g11-hr` · **Worktree:** `c:/dev 2/mediaos-g11-hr` (CẤM mở phiên thứ 2 trên worktree này — shared git index)
**HEAD:** `6181a05` · ahead master **+7** · behind master **−1** (`f360ae5`) · ahead `origin/feat/g11-hr` **+2 (CHƯA push)**
**Working tree:** sạch (0 file WIP) · **FE (`apps/web`): 0 file — toàn bộ G11 hiện là BE-only**

---

## 🚦 TL;DR — đọc cái này trước

- **BE G11-1 (Attendance) + G11-2 (Leave) code GREEN** (unit-level), wired `app.module.ts`, contracts freeze, schema `hr.ts`, emit `task_type='hr'` qua `hr-tasks.service.ts`, timezone đúng ADR-0008 (`tz.util.ts`).
- **CHƯA verify trên DB cô lập** → mọi tuyên bố "xanh" hiện **CHƯA đáng tin** (xem 🔴 BLOCKER #1).
- **2 việc chặn land:** (1) branch **thiếu tooling DB-cô-lập** (behind master `f360ae5`); (2) **chưa chạy gate** (`docs/reviews/g11-gates.md` chưa tồn tại).
- **FE chưa làm gì** (Attendance Dashboard/Monthly · Adjustment Requests · Leave Requests/Calendar = 0 dòng).
- **2 commit chưa push.**

---

## ✅ ĐÃ XONG (đừng làm lại)

| Viên | Commit | Tóm tắt |
| --- | --- | --- |
| journal cấp band | `4f9ee3c` | Cấp lại `_journal.json` 0060–0063 → **idx 39–42 / when 1717500070000–73000** (đơn điệu trong band, land #3). |
| 0060 audit CHECK | `56c53f0` | **Union audit `object_types` CHECK** = `0033` (24 type G7) **+ 7 type HR = 31** (hot-file append, KHÔNG rewrite — §5.3). Fix CRITICAL-3. |
| G11-2 Leave | `4b7ea4a` | **Leave module GREEN** — controller/dto/module/service + spec, wire `LeaveModule`; emit `task_type='hr'`; gỡ stale 5-type `taskType` shadow. (8 files +961/−10) · **22/22 leave · 54/54 HR** (claim tại thời điểm commit, unit). |
| G11-1 Attendance | `6181a05` | **Attendance G11-1** — `rls-registry` +6 bảng HR + **deny-path HTTP** (`attendance-permission.int-spec.ts`) + **cross-month lock** (khoá kỳ công) xanh. **HEAD hiện tại.** |

**Migration band (idx/when trong `meta/_journal.json`):**

| File | idx | when | Nội dung |
| --- | --- | --- | --- |
| `0060_g11_audit_object_types.sql` | 39 | 1717500070000 | DROP+ADD `audit_logs_object_type_chk` = UNION 31 type (DDL qua migration role, hợp lệ với BẤT BIẾN #2). **PHẢI chạy TRƯỚC mọi bước G11** (nếu không audit HR vi phạm CHECK). |
| `0061_g11_attendance.sql` | 40 | 1717500071000 | `work_schedules` · `attendance_records` · `attendance_adjustment_requests` · `attendance_periods` (khoá kỳ công) + RLS + GRANT. **ADR-0008:** ca = `time` + cột timezone (wall-clock lặp lại), `work_date` = ngày LOCAL suy ở app (date-fns + @date-fns/tz). |
| `0062_g11_leave.sql` | 41 | 1717500072000 | `leave_types` · `leave_requests` · `leave_balances` + RLS + GRANT. Đơn nghỉ qua Task Hub (`task_id` trỏ `tasks`, KHÔNG approval riêng). **Trừ phép (`used_days`) chỉ lúc DUYỆT, trong cùng tx, có audit.** `remaining_days` = **GENERATED COLUMN** (không lệch total/used → feed payroll G12 sạch). |
| `0063_g11_permissions_seed.sql` | 42 | 1717500073000 | Seed HR permissions catalog. **Chạy SAU 0061/0062.** Không quyền nào `is_sensitive` (lương mới sensitive — G12) nhưng vẫn guard per-route + audit. |

**Module/code (BE):**
- `apps/api/src/attendance/` — controller · dto · logic(+spec) · repository · service(+spec) · module
- `apps/api/src/leave/` — cùng shape
- `apps/api/src/tasks/hr-tasks.service.ts` — emit `task_type='hr'` vào Task Hub chung (BẤT BIẾN #4)
- `apps/api/src/common/tz.util.ts` — timezone helpers (ADR-0008)
- `apps/api/src/db/schema/hr.ts` (+ barrel `index.ts`, `audit.ts` union, `employees.ts`) — schema HR
- `packages/contracts/src/{attendance,leave}.ts` (+ `index.ts`, `task.ts`) — Zod DTO frozen
- `apps/api/test/integration/{attendance-permission.int-spec.ts, rls-registry.ts}` — deny-path + RLS 2-tenant harness mở rộng 6 bảng HR
- Wired: `app.module.ts` (`AttendanceModule` + `LeaveModule`)

**Diffstat tổng:** 35 files, **+4532 / −1** (so với merge-base master).

---

## 🔴 CHẶN LAND — phải xử lý trước khi merge

### BLOCKER #1 — Branch thiếu tooling DB-cô-lập (behind master `f360ae5`)

Master đã thêm **1 commit G11 CHƯA có:**

```
f360ae5 feat(parallel): DB cô lập mỗi lane chống shared-DB drift
```

Commit này thêm `scripts/lane-db-setup.sh` + đọc `LANE_DB` trong `vitest.config.ts`. **Branch `feat/g11-hr` chưa có:** `vitest.config.ts` vẫn **hard-code `localhost:5432/mediaos`** (DB CHUNG) và **không có** `scripts/lane-db-setup.sh`.

> **Vì sao nguy hiểm (memory `mediaos-shared-db-drift-parallel-lanes`):** drizzle migrator áp migration **đơn điệu theo `when`**. Nếu lane band cao (vd G8 `0080s`) đã migrate DB chung `mediaos`, mọi migration band thấp hơn — gồm **G11 `0060s`** — bị **SKIP vĩnh viễn** → bảng HR vắng → test **xanh-giả / đỏ-giả**. Mọi con số "xanh" ở bảng trên là **unit-level hoặc trên DB chung** → **chưa verify trên DB sạch cô lập.**

**Khắc phục (bước đầu tiên của phiên kế):**
```bash
cd "c:/dev 2/mediaos-g11-hr"
git merge master            # kéo f360ae5 (tooling DB-cô-lập). Xung đột khó xảy ra — f360ae5 chỉ là tooling.
bash scripts/lane-db-setup.sh g11        # tạo mediaos_g11 + chain-migrate 0000→0063 (--reset để làm lại sạch)
export LANE_DB=mediaos_g11
pnpm --filter @mediaos/api test          # CHẠY THẬT trên DB cô lập
```
→ Xác nhận: deny-path (`attendance-permission.int-spec`), RLS 2-tenant (rls-registry +6 bảng HR), cross-month lock, leave trừ-phép-trong-tx **đều xanh trên DB sạch.**

### BLOCKER #2 — Chưa chạy review gate

`docs/reviews/g11-gates.md` **chưa tồn tại** (G3/G4/G7 đã có; G11 chưa). G11 chủ đạo 🤖🟢 (LIGHT) nhưng diff **chạm audit CHECK + permission seed + RLS** → cần:
- `ecc:database-reviewer` (migration/RLS/schema/repository) — **bắt buộc**
- `ecc:typescript-reviewer` (baseline) + `ecc:quality-gate`
- KHÔNG crown-jewel → Sonnet, không santa, không plan-step (§5.6).

Tạo artifact `docs/reviews/g11-gates.md` ghi: gate level, reviewer, finding, fix.

---

## ⏭️ VIỆC KẾ TIẾP (thứ tự)

1. **Merge master + verify trên DB cô lập** (BLOCKER #1) — bước chặn mọi thứ khác.
2. **Chạy gate** (BLOCKER #2) → vá finding → `docs/reviews/g11-gates.md`.
3. **FE G11** (chưa làm — `apps/web` 0 file): Attendance Dashboard/Monthly · Adjustment Requests · Leave Requests/Calendar. 🤖🟢 LIGHT gate. Nối contract `attendance.ts`/`leave.ts` đã freeze.
4. **Push** (đang +2 chưa push) → checkpoint.
5. **Merge → master theo thứ tự phụ thuộc** (§5.4): G9-1 trunk **đã land** → rebase g11 lên master → re-gate → merge. **Khi merge: reconcile** (a) audit `object_types` CHECK = UNION lại đủ mọi lane đã merge; (b) `_journal.json` idx liên tục + when tăng dần.
6. **Cập nhật `TASKS.md`**: dòng G11 (hiện **stale** — chỉ ghi leave `4b7ea4a`, thiếu attendance `6181a05`) + bảng tiến độ §4; tick `[x]` G11-1/G11-2 khi FE + gate xong.

---

## ⚠️ Cạm bẫy / lưu ý khi tiếp tục

- **Hot-file = APPEND, cấm rewrite** (§5.3): audit CHECK union · permission seed `ON CONFLICT DO NOTHING` · `schema/index.ts` + `app.module.ts` khối additive · **`tasks` shape chỉ G9 đổi** — G11 chỉ INSERT `task_type='hr'`.
- **`guard-migration-band` hook** chặn (exit 2) file migration số ngoài `0060–0069` trên branch này. Migration HR kế tiếp (nếu có) = `0064+`.
- **NUL-byte trap** (memory `literal-unicode-escape-becomes-nul-byte`): nếu hand-author SQL/journal có ` ` literal → escape `\\u0000`, kẻo file/commit hoá binary.
- **`task_type='hr'` emit-only** — Task Board hiển thị/duyệt là G9-3/G9-4 (chưa làm). G11 chỉ đảm bảo đơn vào đúng bảng `tasks` + `task_id` back-ref.
- **`attendance_periods` (khoá kỳ công)** chặn mọi ghi vào tháng đã chốt → là ranh giới **feed payroll G12**; đừng nới lỏng khi làm G12.
- **Số test "54/54 HR · 22/22 leave"** là claim tại commit leave (`4b7ea4a`), **trước** attendance `6181a05` → con số tổng thực tế cao hơn; **đếm lại sau khi verify DB cô lập**, đừng trích lại số cũ.

---

## 📌 Phụ thuộc (DAG §5.1)

```
master (G1–G7 ✅ · G9-1 trunk ✅ land d58d465)
  └─ G11 HR (task_type='hr')  ← Wave A, phụ thuộc đã land → mở song song OK
        └─ feed: G12 Payroll (cần attendance + khoá kỳ công) — Wave B, chờ G11 merge
```

G11 **không bị chặn bởi lane khác**; chỉ chặn bởi 2 BLOCKER nội bộ ở trên. G12 (Wave B) là consumer hạ nguồn — đừng mở tới khi G11 land master.
