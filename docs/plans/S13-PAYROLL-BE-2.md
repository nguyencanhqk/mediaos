# S13-PAYROLL-BE-2 — Kế hoạch thi công (micro-plan **v2, sau plan-review vòng 1**)

> **WO:** `S13-PAYROLL-BE-2` · zone `red` · FULL gate + Opus · depends_on `S13-PAYROLL-BE-1` (#456, merged) + `S13-PAYROLL-BE-1B` (**PR #458, CHƯA merge**).
> **Nguồn:** SPEC-11 §12 · §13.1–13.5 · §17 · §18 · §20 · §21 · API-18 §5–6 · DB-13 §6 · `docs/plans/S13-PAYROLL-BE-1.md` §13 (bàn giao).
> **Phạm vi:** 17 route còn lại (`PAYROLL-API-007..018` · `029..033`) — máy tính lương · duyệt four-eyes · phiếu lương · ack · export XLSX · NOTI 020–023.
>
> **v2 vá 10 blocker của plan-review vòng 1.** Mỗi mục vá đánh dấu 🩹 `B<n>`. Blocker #1 leo lên **quyết định owner** và đã được ký (§0b).

---

## 0. Đo hiện trạng (đo TRƯỚC khi viết — không suy từ tài liệu)

| Thứ                                       | Đo được (2026-09-01)                                                                                                                                                                                                                                                                                                         | Hệ quả cho plan                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Module `apps/api/src/payroll/`            | 20 file, 3.468 dòng; 18/35 route đã chạy                                                                                                                                                                                                                                                                                     | BE-2 **mở rộng**, không dựng mới                                                |
| `PAYROLL_ROUTE_PAIRS`                     | khai đủ **35** key + 3 cờ; `PAYROLL_PENDING_BE2` = **17 key**                                                                                                                                                                                                                                                                | không sửa bảng cặp — chỉ **gỡ dần** khỏi `PENDING`                              |
| `PAYROLL_ERR_CODE`                        | khai đủ `001..017`; `PAYROLL_PENDING_BE2_ERRORS` = **9 mã**                                                                                                                                                                                                                                                                  | không thêm mã mới — chỉ gỡ khỏi `PENDING` cùng ca test                          |
| `payroll-fsm.ts`                          | 10 chuyển tiếp + 3 ô tại chỗ + `TRAIL_RESET` 9 hàng + `assertReopenAllowed()`                                                                                                                                                                                                                                                | **GỌI**, không viết lại bảng                                                    |
| `payroll-periods.repository.ts:139`       | **`applyTransitionTx(tx, co, id, to, via, actor, extra)`** — sinh patch từ `TRAIL_RESET[via]` trong MỘT câu UPDATE                                                                                                                                                                                                           | 🩹**B10** cả 8 action còn lại đi qua hàm này, **cấm** tự viết UPDATE trạng thái |
| `PayrollInputsRepository.computeInputsTx` | CHỈ ĐỌC, set-based. **`present = att ∪ (lv WHERE paid = true)`** (`:128-133`) ⇒ ngày nghỉ **không lương KHÔNG nằm trong `present_days`**                                                                                                                                                                                     | 🩹**B1** — nền của quyết định công thức §0b                                     |
| Cây làm việc hiện tại                     | **KHÔNG có BE-1B**: repo đếm `count(distinct l.d)::int` (nguyên ngày)                                                                                                                                                                                                                                                        | 🩹**B8** — bước 0 bắt buộc ở §1b                                                |
| `companies.payroll_config_json`           | chỉ `{cutoffDay, payDay}` (mig `0015`) — **không có** rule khấu trừ trễ/sớm                                                                                                                                                                                                                                                  | 🩹 D9 §0b: v1 **không trừ tiền theo phút trễ**                                  |
| `AuditService.record`                     | `Promise<void>` (`audit.service.ts:103`) — **không trả id**                                                                                                                                                                                                                                                                  | 🩹**B3** — dedupeKey KHÔNG dùng được `auditLogId`                               |
| `PayrollAccessService`                    | `resolveActor(user, routeKey)` giải **đúng MỘT** cặp; JSDoc `:23-26` ghi _"KHÔNG resolve thêm cặp phụ nào"_                                                                                                                                                                                                                  | 🩹**B7** — export đòi 2 cặp phải mở lối đi có chủ đích                          |
| `packages/contracts/src/payroll.ts`       | có sẵn `payrollPageQuery` (`:30`), `payrollPeriodLineSchema`, `adjustPayrollLineSchema`, `payrollSummarySchema`, `payslipSchema`, `payslipItemSchema`, `rejectPayrollPeriodSchema`, `reopenPayrollPeriodSchema`, `decidePayrollPeriodSchema`, `acknowledgePayslipSchema`. **`payslipListQuerySchema` THIẾU `page/per_page`** | §7 sửa 1 + thêm 3 schema (nhiều hơn v1 đo)                                      |
| NOTI catalog                              | `0566` + `notification-event-catalog.const.ts` đã seed **020–023**, `dedupe_strategy='DedupeKey'`                                                                                                                                                                                                                            | **KHÔNG cần migration**                                                         |
| Bridge                                    | `OutboxService` đến từ `EventsModule` **@Global** (khuôn `recruit/job-openings.service.ts:14,162`), registrar ở `notifications/`                                                                                                                                                                                             | plan v1 ghi sai "import NotificationsModule" — sửa ở §3                         |
| `exceljs@^4.4.0`                          | đã là dependency `apps/api` (`hr-import.parser.ts` import động)                                                                                                                                                                                                                                                              | export XLSX không cần dep mới                                                   |
| `route-http-coverage.e2e-spec.ts:328`     | `MIN_COVERED_COUNT = 486` · `MAX_UNCOVERED_TOTAL = 0`                                                                                                                                                                                                                                                                        | siết **503** (486 + 17)                                                         |
| `openapi-modules.ts:126-127`              | `payslips` đã khai sẵn cho PAYROLL; **`/me/payslips` thuộc segment `me` của module ME**                                                                                                                                                                                                                                      | 3 route Own **không** thêm vào `segments` PAYROLL                               |
| `param-uuid-ratchet`                      | `UNPIPED_CEILING = 1`, có ca **đẳng thức**                                                                                                                                                                                                                                                                                   | `PATCH …/lines/:lineId` có **2** param — cả hai phải `ParseUUIDPipe`            |
| Migration head                            | `0566` (idx 233)                                                                                                                                                                                                                                                                                                             | **BE-2 không tạo migration**                                                    |

**Kết luận đo:** BE-2 là WO **thuần service/controller/test + 3 spec cổng**. Không migration, không dep mới.

---

## 0b. Quyết định OWNER (2026-09-01) — không phải WO tự chế

**O1 — Khấu trừ nghỉ KHÔNG LƯƠNG: chọn phương án B (giữ dòng khấu trừ, sửa TỬ SỐ).** 🩹**B1**

Plan-review vòng 1 chứng minh: `present_days` **đã loại** ngày nghỉ không lương (`payroll-inputs.repository.ts:128-133`), nên pro-rate theo `present_days` rồi lại trừ `unpaid × đơn giá ngày` là **trừ hai lần** — mất `base × unpaid / work_days` mỗi người mỗi kỳ, im lặng, không CHECK nào bắt. Ba văn bản đang nói ba kiểu (SPEC-11 §13.4 bước 6 · `harness/backlog.mjs:15210` · plan v1 §5).

Owner chốt: **tử số pro-rate = `present_days + unpaid_leave_days`**, giữ nguyên vế khấu trừ nghỉ không lương. Lý do: hai phương án cho **cùng một số `net`**, nhưng B để phiếu lương hiện dòng «nghỉ không lương −2 ngày: −X đ» (`payslip_items.item_type = 'attendance'`) — đúng PAY-DEC-004 «breakdown giải-thích-được»; A thì nhân viên chỉ thấy lương cơ bản đã bị cắt mà không có dòng nào giải thích.

```text
work = 22   present = 18   unpaid = 2   base_salary = 22.000.000
prorate       = LEAST((18 + 2) / 22, 1) = 20/22
base_amount   = round(22.000.000 × 20/22, 2)      = 20.000.000
dailyRate     = 22.000.000 / 22                   =  1.000.000
unpaidDeduct  = round(2 × 1.000.000, 2)           =  2.000.000
→ phần base đóng góp vào net                       = 18.000.000  (≡ phương án A)
```

**Điều kiện đi kèm — BẮT BUỘC:** phương án B chỉ đúng khi `present_days`/`unpaid_leave_days` mang ngữ nghĩa **thập phân nửa ngày**. Với ngữ nghĩa nguyên-ngày hiện tại, một ngày nửa-buổi-làm + nửa-buổi-nghỉ-không-lương cho `present = 1` **và** `unpaid = 1` ⇒ tử số vượt mẫu số. ⇒ **#458 phải merge trước** (§1b).

**O2 — v1 KHÔNG trừ tiền theo phút trễ/về sớm.** SPEC-11 §13.4 viết "trễ/sớm (**nếu bật rule** ATT)"; đo `companies.payroll_config_json` (mig `0015`) chỉ có `{cutoffDay, payDay}` — **không tồn tại rule nào để bật**. `late_minutes` vẫn ghi vào dòng + `input_snapshot_json` để giải thích, nhưng `deduction_amount` **không** cộng vế trễ. Không chốt ⇒ người code tự phát minh đơn giá phút.

**O3 — Sửa văn bản TRƯỚC, code SAU** (tiền lệ BE-1B): patch `SPEC-11 §13.4` (tử số + O2) và `harness/backlog.mjs` src-line trong **commit đầu tiên** của WO, trước khi mở file service.

---

## 1. Quyết định thi công (chốt ở đây — implement KHÔNG tự phát minh)

**D1 — Không cắt phạm vi.** Giữ đủ 17 route trong một WO. Cắt `export` (017) buộc giữ `periodExport` trong `PAYROLL_PENDING_BE2` và mã `016` trong `PAYROLL_PENDING_BE2_ERRORS` ⇒ **hai cổng census sống thêm một WO**, trong khi việc thực là 1 route đọc + `exceljs` có sẵn. _(Đường lùi nếu quá tải: cắt 017 + mã 016, `MIN_COVERED_COUNT` = 502. **Cấm cắt** four-eyes/017, snapshot đóng băng, audit lượt đọc.)_

**D2 — `payrollSummarySchema.totalGross/totalNet` giữ `z.number()`, ĐẢO quyết định của API-18 §6.3.** Cả module (line · payslip · item · mapper `num()`) dùng `z.number()`; riêng `summary` dùng chuỗi thì FE mang **hai** cách đọc tiền trong cùng một màn. Tổng VND (~10¹²) cách `MAX_SAFE_INTEGER` bốn bậc. §6.3 phải ghi **tường minh** «đảo quyết định 01/09/2026, thay cho ghi chú chuỗi cũ» + xác nhận chưa có consumer nào parse chuỗi (FE PAYROLL chưa tồn tại — `S13-PAYROLL-FE-1` còn `todo`).

**D3 — `calculate` là MỘT câu `INSERT … ON CONFLICT DO UPDATE` set-based.** Cấm vòng lặp per-người, cấm số thực JS. Làm tròn · `LEAST`/`GREATEST` · `net` đều ở SQL.

**D4 — `PayrollApproverReader` đặt ở `apps/api/src/payroll/payroll-approver.reader.ts`** (KHÔNG ở `notifications/`). Lý do 🩹: không reader nào trong `notifications/` được `exports` khỏi `NotificationsModule` (`notifications.module.ts:175-180`), mà `submit` (trong `PayrollModule`) cần nó. Đặt ở `payroll/`, `PayrollModule` **exports** nó, registrar import ngược — một câu SQL, hai caller (`submit` 422 `017` + NOTI-020).

**D5 — dedupeKey CONTENT-DERIVED, KHÔNG dùng `auditLogId`.** 🩹**B3** `AuditService.record` trả `void` (`audit.service.ts:103`); RECRUIT đã đụng và né đúng chỗ này (`recruit-noti-bridge.registrar.ts:32-34`). Khoá mới lấy từ `RETURNING` của **chính** câu `applyTransitionTx`:

| Event                 | dedupeKey                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------- |
| 020 SUBMITTED         | `PAYROLL_PERIOD_SUBMITTED:{periodId}:{submittedAtIso}`                                    |
| 021 APPROVED          | `PAYROLL_PERIOD_APPROVED:{periodId}:{approvedAtIso}`                                      |
| 022 REJECTED          | `PAYROLL_PERIOD_REJECTED:{periodId}:{updatedAtIso}` _(reject không có cột `rejected_at`)_ |
| 023 PAYSLIP_PUBLISHED | `PAYSLIP_PUBLISHED:{payslipId}`                                                           |

Giữ nguyên tính chất «mỗi LẦN gửi là một sự kiện»: reject → sửa → submit lại cho `submitted_at` MỚI ⇒ khoá khác ⇒ báo lại. **Phải sửa cùng commit:** `SPEC-11 §17` (cột Dedupe) + comment `notification-event-catalog.const.ts:174-176`.

**D6 — Masking bằng VẮNG KHOÁ + assert FAIL-CLOSED.** Cả 17 route BE-2 đều chở tiền ⇒ `canSeeMoney` luôn `true`; nhánh strip sẽ là code không cổng nào chạm. ⇒ mapper giữ `when(canSeeMoney, …)` **và** thêm `assertMoneyRoute(actor)` ném khi `canSeeMoney === false` trên route chở tiền — không im lặng trả DTO rỗng. Route KHÔNG chở tiền (001/003) vẫn ép `false` như BE-1.

**D7 — Audit lượt đọc: dùng ĐÚNG khuôn inline của BE-1, KHÔNG dựng helper mới.** 🩹 BE-1 ghi inline tại `salary-profiles.service.ts:54,89,108`. Dựng `payroll-read-audit.ts` rồi refactor 2 call-site đó = đụng file đã qua FULL gate không vì lý do nghiệp vụ. BE-2 thêm 5 đường (`lines` · `summary` · `export` · `payslips` · `payslips/:id`) **cùng khuôn inline, trong cùng tx với lượt đọc**. `/me/payslips*` ghi **0 hàng**.

**D8 — `reopen` GIỮ NGUYÊN dòng nháp** (không xoá mềm). 🩹 SPEC không nói; chốt ở đây vì nó quyết `adjustment_amount` có sống sót qua vòng reopen→calculate không. Giữ dòng ⇒ điều chỉnh tay sống sót, nhất quán với §20.17. Có ca test.

---

## 1b. Bước 0 bắt buộc — thứ tự phụ thuộc 🩹**B8**

```text
1. #457 (S13-LEAVE-JOBDATE-1) merge     → gỡ đỏ leave-accrual (CI #458 đang đỏ vì nó)
2. #458 (S13-PAYROLL-BE-1B) merge       → present/paid/unpaid_leave_days thành numeric(8,2)
3. git checkout -b wo/s13-payroll-be-2 origin/master   (rebase nhánh hiện tại)
4. ĐO LẠI `computeInputsTx`: xác nhận 3 đại lượng là thập phân, CTE `req` chặn theo kỳ
5. Chỉ khi 4 xanh mới viết fixture "khớp từng đồng"
```

Bỏ bước 4 ⇒ fixture viết theo ngữ nghĩa nguyên-ngày, ca đối soát vẫn xanh trong khi số **sai** (`tests-can-pin-a-hole-open`). Và theo O1, phương án B **sai về mặt toán học** nếu chạy trên ngữ nghĩa nguyên-ngày.

---

## 2. Phạm vi — 17 route

| Mã  | Method · Path                                 | Route key                | Cặp quyền                                         | Ghi chú                         |
| --- | --------------------------------------------- | ------------------------ | ------------------------------------------------- | ------------------------------- |
| 007 | POST `/payroll-periods/:id/calculate`         | `periodCalculate`        | `calculate:payroll-period`                        | `@Idempotent()`; §4             |
| 008 | GET `/payroll-periods/:id/lines`              | `periodLines`            | `view-line:payroll-period`                        | audit đọc                       |
| 009 | PATCH `/payroll-periods/:id/lines/:lineId`    | `periodAdjustLine`       | `calculate:payroll-period`                        | §4b · **2 param UUID**          |
| 010 | POST `/payroll-periods/:id/submit`            | `periodSubmit`           | `calculate:payroll-period`                        | 422 `017` + NOTI-020            |
| 011 | POST `/payroll-periods/:id/approve`           | `periodApprove`          | `approve:payroll-period`                          | four-eyes + NOTI-021            |
| 012 | POST `/payroll-periods/:id/reject`            | `periodReject`           | `approve:payroll-period`                          | comment bắt buộc + NOTI-022     |
| 013 | POST `/payroll-periods/:id/generate-payslips` | `periodGeneratePayslips` | `publish:payroll-period`                          | `@Idempotent()`; no-op 200      |
| 014 | POST `/payroll-periods/:id/publish`           | `periodPublish`          | `publish:payroll-period`                          | 409 `007`; NOTI-023 theo lô     |
| 015 | POST `/payroll-periods/:id/lock`              | `periodLock`             | `manage:payroll-period`                           | `Locked` terminal               |
| 016 | POST `/payroll-periods/:id/reopen`            | `periodReopen`           | `reopen:payroll-period`                           | `assertReopenAllowed` TRƯỚC     |
| 017 | GET `/payroll-periods/:id/export`             | `periodExport`           | `export:payroll` **+** `view-line:payroll-period` | §6b                             |
| 018 | GET `/payroll-periods/summary`                | `periodSummary`          | `view-line:payroll-period`                        | **khai TRƯỚC** `GET /:id`       |
| 029 | GET `/payslips`                               | `payslipList`            | `view-payslip:payslip`                            | audit đọc                       |
| 030 | GET `/payslips/:id`                           | `payslipDetail`          | `view-payslip:payslip`                            | audit đọc                       |
| 031 | GET `/me/payslips`                            | `mePayslipList`          | `view-own-payslip:payslip`                        | **0 audit**; kỳ `Paid`/`Locked` |
| 032 | GET `/me/payslips/:id`                        | `mePayslipDetail`        | `view-own-payslip:payslip`                        | 404 cho phiếu người khác        |
| 033 | POST `/me/payslips/:id/acknowledge`           | `mePayslipAck`           | `acknowledge-own-payslip:payslip`                 | 409 `015` hai nhánh             |

> ⚠️ **018 khai TRƯỚC 003** — `payroll.controllers.ts:57-58` đã cài sẵn chú thích cho việc này.
> ⚠️ 031–033 vào controller `MePayslipsController` (`@Controller("me/payslips")`) — segment `me` **thuộc module ME** trong `openapi-modules.ts`; **không** thêm vào `segments` của PAYROLL, và phải kiểm `openapi-contract.e2e-spec`.

---

## 3. Cây file

```text
apps/api/src/payroll/
  payroll-calc.repository.ts        MỚI  — CTE khoản thưởng/phạt (§4 B4) + UPSERT set-based (§5)
                                          + recomputeLineNetTx (§4b) + summary + export rows
  payroll-calc.service.ts           MỚI  — calculate (007) · lines (008) · adjust-line (009) · summary (018)
  payroll-approval.service.ts       MỚI  — submit/approve/reject/lock/reopen (010–012, 015, 016)
  payroll-approver.reader.ts        MỚI  — bộ giải «người duyệt hợp lệ» (D4), PayrollModule EXPORTS
  payroll-payslips.repository.ts    MỚI  — generate (copy đóng băng §5b) · list/detail · me · ack
  payroll-payslips.service.ts       MỚI  — generate (013) · publish (014) · 029–033
  payroll-export.service.ts         MỚI  — XLSX qua exceljs (import ĐỘNG), 2 cặp quyền (§6b)
  payroll.mapper.ts                 SỬA  — + mapLine/mapPayslip/mapPayslipItem/mapSummary + assertMoneyRoute
  payroll.errors.ts                 SỬA  — map 23505 `payslips_period_user_uq`→006 · `…acknowledgements…_uq`→015;
                                          23514 `four_eyes_check`→005 **+ 4 CHECK cặp còn lại** (§8b);
                                          XOÁ 9 phần tử PENDING_BE2_ERRORS
  payroll-route-pairs.const.ts      SỬA  — XOÁ 17 phần tử PAYROLL_PENDING_BE2 (còn `[]`)
  payroll-access.service.ts         SỬA  — + resolveActorForExport (§6b) + sửa JSDoc :23-26 CÓ CHỦ ĐÍCH
  payroll.controllers.ts            SỬA  — + 12 route vào PayrollPeriodsController; + MePayslipsController,
                                          PayslipsController
  payroll.module.ts                 SỬA  — provider mới + exports PayrollApproverReader
                                          (OutboxService đến từ EventsModule @Global — KHÔNG import NotificationsModule)

apps/api/src/notifications/
  payroll-noti.payload.ts           MỚI  — hợp đồng payload + requireField fail-loud (khuôn recruit-noti.payload.ts)
  payroll-noti-bridge.registrar.ts  MỚI  — 4 event 020–023 (khuôn recruit-noti-bridge.registrar.ts)

packages/contracts/src/payroll.ts   SỬA  — payslipListQuerySchema += payrollPageQuery;
                                          + payrollLineListQuerySchema · mePayslipListQuerySchema · payrollExportQuerySchema
docs/SPEC/SPEC-11 PAYROLL.md        SỬA  — §13.4 tử số pro-rate (O1) + O2; §17 cột Dedupe (D5)
docs/API Design/API-18_*.md         SỬA  — §5.2 trạng thái + §6.3 kiểu số (D2)
harness/backlog.mjs                 SỬA  — src-line công thức (O3)
apps/api/src/foundation/seed/notification-event-catalog.const.ts  SỬA — comment dedupe (D5)
```

---

## 4. `calculate` (007) — thứ tự trong MỘT transaction

```text
tx = withTenant(companyId):
 1. actor = resolveActor(user, 'periodCalculate')
 2. period = lockForUpdateTx(tx, co, id)        // SELECT … FOR UPDATE; null ⇒ 404 010
 3. status ≥ Approved ⇒ 409 003                  // TRƯỚC assertPeriodTransition — giữ mã 003 sống
    to = resolveActionTarget(status, 'calculate'); assertPeriodTransition(status, to, 'calculate')
 4. attendance_period_id IS NULL ⇒ 409 002 (attendance-period-missing)
    kỳ công .status <> 'locked' ⇒ 409 002 (attendance-not-locked)
 5. NHẢ consume của CHÍNH kỳ này:
    UPDATE bonus_penalties SET payroll_period_id = NULL, consumed_at = NULL   -- CẢ CẶP
     WHERE company_id = $co AND payroll_period_id = $id
 6. inputs = PayrollInputsRepository.computeInputsTx(tx, …)     // DÙNG LẠI, cấm aggregation thứ hai
    eligible = NV có salary_profile hiệu lực tại ngày cuối kỳ
    eligible rỗng ⇒ 422 009 · work_days = 0 ⇒ 422 009
 7. 🩹B4 KHOÁ TẬP KHOẢN — MỘT lần, dùng chung cho SUM và BIND:
    picked = SELECT id, user_id, kind, amount FROM bonus_penalties
              WHERE company_id = $co AND status = 'Approved' AND period_month = $m
                AND payroll_period_id IS NULL AND deleted_at IS NULL
                AND user_id = ANY($eligibleUserIds)          -- KHÔNG bind khoản của NV không có dòng
              FOR UPDATE
 8. UPSERT payroll_period_lines — MỘT câu (§5), SUM thưởng/phạt lấy từ `picked`
 9. Xoá mềm dòng của NV không còn đủ điều kiện (deleted_at; KHÔNG hard-delete)
10. BIND consume ĐÚNG tập đã khoá:
    UPDATE bonus_penalties SET payroll_period_id = $id, consumed_at = now()
     WHERE id = ANY($picked.ids)
11. applyTransitionTx(tx, co, id, to, 'calculate', actorId)     // 🩹B10 — TRAIL_RESET.calculate
12. audit(object_type='payroll_period', action='calculate', payload={periodId, lineCount})  // 0 số tiền
```

**Bốn bẫy phải giữ:**

- Bước 3 kiểm `≥ Approved` **trước** FSM — để `assertPeriodTransition` bắt trước thì kỳ `Approved` trả **001**, mã **003** thành mã chết.
- Bước 5 set **cả cặp** về NULL — set một vế nổ `bonus_penalties_consumed_pair_check` (23514 = 500 vùng đỏ). Chỉ đụng hàng của **chính kỳ này**.
- 🩹**B4** Bước 7 là **lý do tồn tại của cả khối**: `FOR UPDATE` + một tập id dùng cho **cả** SUM lẫn BIND. Không có nó thì (a) khoản xoá mềm vẫn được cộng; (b) khoản của NV thiếu hồ sơ lương bị consume vĩnh viễn mà không ai được trả; (c) READ COMMITTED cho khoản duyệt **giữa** bước 8 và 10 bị bind nhưng không vào `bonus_amount` ⇒ mất tiền im lặng.
- 🩹**B10** Bước 11 **gọi `applyTransitionTx`**, không tự viết `UPDATE payroll_periods SET status…`. Viết tay = mã hoá `TRAIL_RESET` ở nơi thứ hai ⇒ đường vào `23514` (`approved_pair_check`/`generated_pair_check`).

### 4b. `adjust-line` (009) — 8 bước 🩹**B5**

```text
 1. actor = resolveActor(user, 'periodAdjustLine')
 2. period = lockForUpdateTx(tx, co, periodId)                  // FOR UPDATE — SPEC-11 §13.1 liệt kê adjust-line
 3. status ≥ Approved ⇒ 409 003                                  // TRƯỚC kiểm 001
 4. status <> 'Calculated' ⇒ 409 001 (ACTION_NOT_APPLICABLE)
 5. UPDATE payroll_period_lines
      SET adjustment_amount = $amt, adjustment_reason = $reason,
          net = GREATEST(round(gross - deduction_amount + $amt, 2), 0),   -- TÍNH LẠI Ở SQL
          updated_by = $actor, updated_at = now()
    WHERE company_id=$co AND payroll_period_id=$periodId AND id=$lineId AND deleted_at IS NULL
    RETURNING …                                                  // 0 hàng ⇒ 404 010
 6. KHÔNG đổi trạng thái kỳ (ô tại chỗ, không gọi applyTransitionTx)
 7. audit(object_type='payroll_period', payload={periodId, lineId, userId})  // 0 số tiền
 8. envelope trả về KHÔNG chở tiền (route GHI — SPEC-11 §21 «Rò tiền qua route GHI»)
```

Thiếu bước 5 vế `net` ⇒ `generate-payslips` copy `net` cũ ⇒ **phiếu lương sai tiền** và đẳng thức `SUM(items) = gross − deduction + adjustment` vỡ.

---

## 5. Câu UPSERT (D3 · O1) — khung SQL

```sql
WITH picked AS (…§4 bước 7…),
bp AS (SELECT user_id,
              SUM(amount) FILTER (WHERE kind = 'bonus')   AS bonus,
              SUM(amount) FILTER (WHERE kind = 'penalty') AS penalty
         FROM picked GROUP BY user_id)
INSERT INTO payroll_period_lines (
  company_id, payroll_period_id, user_id, salary_profile_id,
  work_days, present_days, paid_leave_days, unpaid_leave_days, late_minutes,
  input_snapshot_json, base_amount, allowance_amount, bonus_amount, penalty_amount,
  deduction_amount, adjustment_amount, adjustment_reason, gross, net, created_by, updated_by)
SELECT
  $companyId, $periodId, i.user_id, sp.id,
  i.work_days, i.present_days, i.paid_leave_days, i.unpaid_leave_days, i.late_minutes,
  $snapshotMeta::jsonb || jsonb_build_object('inputs', to_jsonb(i)),
  base.amt, allw.amt, coalesce(bp.bonus,0), coalesce(bp.penalty,0),
  ded.amt,
  coalesce(old.adjustment_amount, 0), old.adjustment_reason,        -- 🩹B6 hồi sinh điều chỉnh tay
  round(base.amt + allw.amt + coalesce(bp.bonus,0), 2)                        AS gross,
  GREATEST(round(base.amt + allw.amt + coalesce(bp.bonus,0)
                 - ded.amt + coalesce(old.adjustment_amount,0), 2), 0)        AS net,
  $actorId, $actorId
FROM jsonb_to_recordset($inputs::jsonb) AS i(user_id uuid, work_days numeric, present_days numeric,
     paid_leave_days numeric, unpaid_leave_days numeric, late_minutes int)
JOIN LATERAL (…salary_profiles hiệu lực tại ngày cuối kỳ, deleted_at IS NULL…) sp ON true
LEFT JOIN bp ON bp.user_id = i.user_id
-- 🩹B6 dòng đã XOÁ MỀM của cùng (kỳ,người): partial unique loại nó khỏi ON CONFLICT, nên phải
--      mang `adjustment_*` sang nhánh INSERT bằng tay, kẻo NV quay lại đủ điều kiện là MẤT tiền đã nhập.
LEFT JOIN LATERAL (
  SELECT adjustment_amount, adjustment_reason FROM payroll_period_lines pl
   WHERE pl.company_id = $companyId AND pl.payroll_period_id = $periodId
     AND pl.user_id = i.user_id AND pl.deleted_at IS NOT NULL
   ORDER BY pl.deleted_at DESC LIMIT 1) old ON true
-- O1: TỬ SỐ = present + unpaid (phương án B)
CROSS JOIN LATERAL (SELECT round(sp.base_salary
        * LEAST((i.present_days + i.unpaid_leave_days) / NULLIF(i.work_days,0), 1), 2) AS amt) base
CROSS JOIN LATERAL (…tổng allowances từ sp.allowances_json…) allw
-- O1 + O2: khấu trừ = phạt + nghỉ-không-lương × đơn giá ngày. KHÔNG có vế trễ ở v1.
CROSS JOIN LATERAL (SELECT round(coalesce(bp.penalty,0)
        + i.unpaid_leave_days * (sp.base_salary / NULLIF(i.work_days,0)), 2) AS amt) ded
ON CONFLICT (company_id, payroll_period_id, user_id) WHERE deleted_at IS NULL
DO UPDATE SET
  salary_profile_id = EXCLUDED.salary_profile_id,
  work_days = EXCLUDED.work_days, present_days = EXCLUDED.present_days,
  paid_leave_days = EXCLUDED.paid_leave_days, unpaid_leave_days = EXCLUDED.unpaid_leave_days,
  late_minutes = EXCLUDED.late_minutes,
  input_snapshot_json = EXCLUDED.input_snapshot_json,          -- 🩹 nêu TƯỜNG MINH (CHECK <> '{}')
  base_amount = EXCLUDED.base_amount, allowance_amount = EXCLUDED.allowance_amount,
  bonus_amount = EXCLUDED.bonus_amount, penalty_amount = EXCLUDED.penalty_amount,
  deduction_amount = EXCLUDED.deduction_amount,
  gross = EXCLUDED.gross,
  -- GIỮ NGUYÊN điều chỉnh tay của dòng SỐNG (SPEC-11 §13.4 · nghiệm thu §20.17)
  adjustment_amount = payroll_period_lines.adjustment_amount,
  adjustment_reason = payroll_period_lines.adjustment_reason,
  net = GREATEST(round(EXCLUDED.gross - EXCLUDED.deduction_amount
                       + payroll_period_lines.adjustment_amount, 2), 0),
  updated_at = now(), updated_by = $actorId;
```

- 🩹**B6 XOÁ** cặp `deleted_at = NULL, deleted_by = NULL` của plan v1: unique là **partial** `WHERE deleted_at IS NULL` (`db/schema/payroll.ts:248-250`) ⇒ hàng xoá mềm **không nằm trong index** ⇒ `DO UPDATE` không bao giờ chạm nó. Nhánh đó là code chết, và tệ hơn: nó tạo ảo giác «đã lo hồi sinh». Hồi sinh làm bằng `LEFT JOIN LATERAL old` ở nhánh INSERT.
- Hai nhánh phải cho **cùng công thức đóng** `net = GREATEST(gross − deduction + adjustment, 0)` — có unit test đối chiếu.
- `ON CONFLICT` phải kèm vế `WHERE deleted_at IS NULL` (partial index), thiếu là 42P10 lúc chạy.
- **Mọi JOIN dòng nháp lọc `deleted_at IS NULL`** — trừ đúng `LATERAL old`.

### 5b. `generate-payslips` (013) — bảng ánh xạ 🩹**B2**

**Đổi tên cột khi copy** (`payroll_period_lines` → `payslips`): `base_amount → base_salary` · `allowance_amount → total_allowances` · `bonus_amount`/`penalty_amount`/`deduction_amount`/`adjustment_amount`/`gross`/`net`/5 đại lượng ngày/`input_snapshot_json` giữ tên. `payslips.input_snapshot_json` **NOT NULL, KHÔNG DEFAULT** — phải ghi tường minh.

**`payslip_items` — 7 loại, `amount` CÓ DẤU, chỉ sinh dòng ≠ 0:**

| sort | item_type    | Nguồn                                                   | Dấu                 | Label                                   |
| ---- | ------------ | ------------------------------------------------------- | ------------------- | --------------------------------------- |
| 10   | `earning`    | `base_amount`                                           | +                   | Lương cơ bản (present+unpaid/work ngày) |
| 20   | `allowance`  | `allowance_amount`                                      | +                   | Phụ cấp                                 |
| 30   | `bonus`      | `bonus_amount`                                          | +                   | Thưởng                                  |
| 40   | `penalty`    | `penalty_amount`                                        | −                   | Phạt                                    |
| 50   | `attendance` | `unpaid_leave_days × đơn giá ngày`                      | −                   | Nghỉ không lương (N ngày)               |
| 60   | `deduction`  | phần còn lại của `deduction_amount` sau khi trừ 40 + 50 | −                   | Khấu trừ khác                           |
| 70   | `adjustment` | `adjustment_amount`                                     | theo dấu người nhập | Điều chỉnh: «lý do»                     |

> ⚠️ `penalty_amount` và vế nghỉ-không-lương là **thành phần con** của `deduction_amount` (§5 `ded.amt`). Sinh cả item 40/50 **lẫn** một item `deduction` bằng cả `ded.amt` là **đếm hai lần** ⇒ vỡ bất biến. Hàng 60 chỉ tồn tại nếu `deduction_amount − penalty − unpaid×rate ≠ 0` (ở v1 luôn = 0 theo O2 — giữ hàng để O2 đảo được mà không phải sửa mapping).
>
> **Bất biến ép ở service + có UNIT test riêng** (không chỉ int-spec): `SUM(payslip_items.amount) = gross − deduction_amount + adjustment_amount` và `net = GREATEST(tổng đó, 0)`.

Các bước còn lại: đọc cờ `payslips_generated_at` **trên hàng kỳ đang khoá** → đã set ⇒ **no-op 200**; copy từng dòng sống; `applyTransitionTx(… to='Approved', via='generate-payslips')` (ô tại chỗ, ghi `payslips_generated_by/at`); race qua row-lock ⇒ `23505` `payslips_period_user_uq` → **409 006**, rollback toàn bộ.

---

## 6. Duyệt (010–012 · 015 · 016) — four-eyes 3 tầng

| Bước                                                           | Nơi ép                                 |
| -------------------------------------------------------------- | -------------------------------------- |
| `approve:payroll-period` **không grant** cho `payroll-officer` | tầng quyền (seed §9g, đã có)           |
| `submitted_by ≠ actorId` ⇒ 409 **005**                         | service `payroll-approval.service.ts`  |
| `payroll_periods_four_eyes_check`                              | DB — chốt cuối, race map 409 không 500 |

- **`submit`**: sau `lockForUpdateTx`, gọi `PayrollApproverReader.eligibleApproverIds(tx, co, actorId)`; rỗng ⇒ **422 017**, kỳ **ở nguyên `Calculated`**. Rồi `applyTransitionTx(… 'submit')` → audit → enqueue NOTI-020 tới **chính tập id** reader trả về (một bộ giải, hai caller — D4).
- **`reject`**: comment bắt buộc → **đọc `submitted_by` vào biến TRƯỚC** `applyTransitionTx` (hàm này xoá `submitted_*` theo `TRAIL_RESET.reject`) → NOTI-022 tới người đó.
- **`approve`**: `applyTransitionTx(… 'approve')` → NOTI-021 tới `submitted_by`.
- **`reopen`**: `assertReopenAllowed(period)` **ngay sau** `FOR UPDATE`, **trước** `assertPeriodTransition`; `applyTransitionTx(… 'reopen', extra:{reopenReason})`; **không** NOTI; **giữ nguyên dòng nháp** (D8).
- **`lock`**: `Paid → Locked`, terminal tuyệt đối.

### 6b. Export (017) — hai cặp quyền 🩹**B7**

`resolveActor` cố ý chỉ giải MỘT cặp (JSDoc `payroll-access.service.ts:23-26`). SPEC-11 §18 + API-18 §5.1 bắt assert **cả hai**. Lối đi tường minh:

```ts
// payroll-access.service.ts — sửa JSDoc CÓ CHỦ ĐÍCH qua FULL gate, nêu rõ đây là ngoại lệ DUY NHẤT
async resolveActorForExport(user: PayrollRequestUser): Promise<PayrollActor> {
  await this.resolveActor(user, "periodLines");        // vế ĐỌC dòng lương
  return this.resolveActor(user, "periodExport");      // vế XUẤT — actor trả về mang cặp export
}
```

Hai literal ⇒ pin `"PayrollExportService#export": ["periodExport", "periodLines"]` trong `SERVICE_SITE_TO_KEYS` (tiền lệ `BonusPenaltiesService#decide` mang hai key). Ba ca test: thiếu `export` ⇒ 403 · thiếu `view-line` ⇒ 403 · đủ hai ⇒ 200.
Trần 10.000 dòng ⇒ **422 016** (ca biên 10.000 / 10.001). Tên người lấy qua **`PayrollPeopleRepository`** (điểm chiếu danh tính DUY NHẤT — SPEC-11 §18), cấm JOIN thẳng `users`. Audit **một** hàng, payload = kỳ + bộ lọc + số dòng, **không số tiền**. `exceljs` import ĐỘNG + streaming writer.

---

## 7. Contracts 🩹

```ts
// SỬA — API-18 §6.2 bắt phân trang cho /payslips
export const payslipListQuerySchema = z.object({
  ...payrollPageQuery,
  payrollPeriodId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
});

// MỚI
export const payrollLineListQuerySchema = z
  .object({ ...payrollPageQuery, q: z.string().trim().min(1).max(100).optional() })
  .strict();
export const mePayslipListQuerySchema = z
  .object({ ...payrollPageQuery, payrollPeriodId: z.string().uuid().optional() })
  .strict();
export const payrollExportQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
```

`payrollSummarySchema` **không đổi** (D2). Zod mirror CHECK DB đã đúng bằng từ BE-1 — BE-2 chỉ **thêm ca test**, không sửa enum.

**`GET /payroll-periods/summary` — chốt hợp đồng** 🩹: kỳ = **`period_month` lớn nhất, `deleted_at IS NULL`**; công ty **chưa có kỳ nào** ⇒ **200** với `data: null` (không 404 — widget DASH phải phân biệt «chưa có kỳ» với «không có quyền»). Có ca test cả hai nhánh.

---

## 8. NOTI (020–023)

- `payroll-approver.reader.ts` (ở `payroll/`, D4): JOIN `user_roles ⋈ roles ⋈ role_permissions ⋈ permissions` với `(action,resource_type)=('approve','payroll-period')`, `rp.effect='ALLOW'`, `ur.deleted_at IS NULL`, `(ur.expires_at IS NULL OR ur.expires_at > now())`, `u.deleted_at IS NULL`, `u.id <> :actorId`. **Không** xét `object_permissions` (SPEC-11 §13.1 nêu lý do). Không cần phủ 4 hình dạng wildcard — cặp là `is_sensitive`.
- `payroll-noti.payload.ts`: hợp đồng payload + `requireField` **fail-loud** (khuôn `recruit-noti.payload.ts`).
- `payroll-noti-bridge.registrar.ts`: 4 event, `recipient.mode='UserIds'`, `dedupeKeyOf` **bắt buộc cả 4** (D5); `warnIfEmpty` để lại vết khi 0 recipient. Actor-exclusion do engine lo — không lặp.
- **Payload tuyệt đối không có số tiền** — ca test assert trên payload đã enqueue.
- 🩹 **`publish` phát N event 023** (500 phiếu = 500 hàng outbox trong một tx): chèn **theo lô** (`insert … values` nhiều hàng), và nhớ `outbox KHÔNG FIFO` — không ca test nào được assert thứ tự.

### 8b. `mapPayrollPgError` — 4 CHECK còn hở 🩹

Ngoài `four_eyes_check` → 005, phải map **có tên**: `payroll_periods_approved_pair_check` · `published_pair_check` · `generated_pair_check` · `calculated_needs_attendance_check`. Hiện `mapPayrollPgError` trả `null` cho chúng ⇒ **500 vùng đỏ**. Vì §4/§6 đã đi qua `applyTransitionTx` nên bốn cái này chỉ nổ khi có bug — map về **409 001** kèm `kind='trail-pair-violation'` (không 500), + 1 ca test bơm vi phạm trực tiếp.

---

## 9. Test — RED trước cho deny-path

| Nhóm               | File                                 | Ca chính                                                                                                                                                                                  |
| ------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Công thức thuần    | `payroll-calc.spec.ts`               | O1 hai nhánh INSERT/UPDATE cùng công thức đóng; clamp net = 0; `.005`; **`SUM(items)` = gross−deduction+adjustment** (unit, dữ liệu bịa)                                                  |
| Deny-path 17 route | `payroll-be2-permission.int-spec.ts` | thiếu từng cặp ⇒ 403 **+ ca ALLOW đối chứng từng cặp**; `hr-manager` 403 toàn bộ; export thiếu **từng** cặp trong hai ⇒ 403; chủ thể = role dựng trong test                               |
| §20.18             | cùng file trên                       | chỉ `approve`+`view-line` ⇒ `/lines` **200**, `calculate` **403**; ngược lại chỉ `calculate` ⇒ `approve` **403**                                                                          |
| Four-eyes          | `payroll-four-eyes.int-spec.ts`      | tự submit+approve ⇒ 409 005; reopen → cùng actor submit lại ⇒ **200**; 1-người-duyệt ⇒ **422 017**, kỳ vẫn `Calculated`                                                                   |
| Đối soát số        | `payroll-calc-fixture.int-spec.ts`   | fixture O1 **khớp từng đồng** (số cụ thể §0b); ca `work_days` đủ **4 vị từ** lễ (GLOBAL `company_id IS NULL` + `WorkingDayOverride`); ca đối chứng lịch LEAVE vs lịch PAYROLL             |
| Thưởng/phạt        | `payroll-bonus-consume.int-spec.ts`  | 🩹B4 khoản **xoá mềm** không được cộng; khoản của NV **không có hồ sơ lương** KHÔNG bị consume; **duyệt khoản giữa bước 8 và 10** không mất tiền; khoản consume bởi kỳ KHÁC không bị đụng |
| Snapshot đóng băng | `payroll-freeze.int-spec.ts`         | đổi ATT/LEAVE/hồ sơ sau tính ⇒ số không đổi; `adjustment_*` sống sót qua calculate lại; 🩹B6 **xoá mềm → đủ điều kiện lại → điều chỉnh tay còn nguyên**; D8 reopen giữ dòng               |
| Race               | `payroll-race.int-spec.ts`           | 2 calculate ‖ · 2 generate ‖ (409 006) · generate ‖ reopen · 2 ack ‖ (409 015)                                                                                                            |
| Own-scope / IDOR   | `payroll-me-payslip.int-spec.ts`     | cross-employee **cùng company** ⇒ 404; caller không có phiếu ⇒ rỗng; chưa publish ⇒ rỗng                                                                                                  |
| Audit lượt đọc     | `payroll-read-audit.int-spec.ts`     | 7 đường +1 hàng **trong cùng tx** (rollback ⇒ 0); `/me/payslips` **+0**; payload 0 số tiền                                                                                                |
| Masking            | `payroll-masking.int-spec.ts`        | `view:payroll-period` không nhận khoá tiền nào; `/lines` ⇒ 403; **route GHI** (`calculate`/`adjust-line`/`collect`) envelope 0 khoá tiền                                                  |
| Summary            | trong `payroll-be2-permission`       | kỳ mới nhất; **chưa có kỳ ⇒ 200 + `data: null`**; grant hẹp hơn Company ⇒ 403 (sàn scope)                                                                                                 |
| NOTI               | `payroll-noti.int-spec.ts`           | 4 dedupeKey đúng D5; **reject → submit lần hai vẫn báo** (khoá theo `submitted_at`); 023 đúng từng `payslips.user_id`; payload 0 số tiền                                                  |
| Census             | 3 spec sẵn có                        | §10                                                                                                                                                                                       |

Chạy **như CI**: `bash harness/check.sh --lane-db=payrollbe2`. Coverage `apps/api/src/payroll/**` ≥ 85%.

---

## 10. Cổng phải siết CÙNG COMMIT — 3 file, 8 hằng 🩹**B9**

| File                                                          | Hằng                                    | Từ → Đến                                                                      |
| ------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| `payroll-route-pairs.const.ts`                                | `PAYROLL_PENDING_BE2`                   | 17 phần tử → `[]`                                                             |
| `payroll.errors.ts`                                           | `PAYROLL_PENDING_BE2_ERRORS`            | 9 phần tử → `[]`                                                              |
| `test/foundation/payroll-two-layer-guard-census.unit-spec.ts` | `ROUTE_TO_KEY`                          | 18 → **35** dòng                                                              |
| "                                                             | `PAYROLL_CONTROLLERS`                   | + `PayslipsController`, `MePayslipsController`                                |
| "                                                             | `expect(payrollRoutes.length).toBe(18)` | → **35**                                                                      |
| "                                                             | `calls.length ≥ 18`                     | → **35**                                                                      |
| "                                                             | `SERVICE_SITE_TO_KEYS`                  | + ~17 pin (gồm `PayrollExportService#export: ["periodExport","periodLines"]`) |
| `test/foundation/payroll-error-code-census.unit-spec.ts:99`   | `expect(pending.size).toBe(9)`          | → **0**                                                                       |
| `test/foundation/route-http-coverage.e2e-spec.ts:328`         | `MIN_COVERED_COUNT`                     | 486 → **503**                                                                 |

⚠️ **Neo thay thế — bắt buộc.** Khi hai danh sách `PENDING` rỗng, neo chống-xanh-rỗng của chúng biến mất. Thêm ngay trong cùng commit: `expect(new Set(Object.keys(PAYROLL_ROUTE_PAIRS)).size).toBe(35)` **và** `expect(used.size).toBe(35)`; ca error-census giữ `kinds().length ≥ N`. **Cấm hạ neo để lấy màu xanh.**

---

## 11. Rủi ro

| #   | Rủi ro                                             | Giảm thiểu                                                                                                        |
| --- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| R1  | Câu UPSERT §5 lớn, khó review                      | tách `payroll-calc.repository.ts`, mỗi LATERAL có comment nêu nguồn §13.4; unit test công thức tách khỏi int-spec |
| R2  | `ON CONFLICT` trượt partial index ⇒ 42P10 lúc chạy | int-spec `calculate` **hai lần liên tiếp** là ca bắt buộc                                                         |
| R3  | `reject` gửi NOTI sau khi đã xoá `submitted_by`    | đọc vào biến **trước** `applyTransitionTx`; ca assert người nhận ≠ rỗng                                           |
| R4  | Export ngốn RAM ở kỳ lớn                           | trần 10.000 (422 `016`) + streaming writer; ca biên                                                               |
| R5  | Audit lượt đọc rơi ngoài tx                        | inline **trong** tx (D7), ca rollback ⇒ 0 hàng                                                                    |
| R6  | Sửa SPEC-11/API-18 bị coi là "sửa ngầm tài liệu"   | O3: commit văn bản **riêng, đầu tiên**, nêu lý do + tham chiếu O1/D2/D5                                           |
| R7  | 🩹B8 fixture viết trên ngữ nghĩa nguyên-ngày       | §1b bước 4 «đo lại» là điều kiện vào việc, không phải lời khuyên                                                  |
| R8  | Khẩu độ 17 route + engine + NOTI + export          | đường lùi duy nhất ở D1; **cấm** cắt four-eyes/017, snapshot, audit đọc                                           |

---

## 12. Definition of Done

- Văn bản (SPEC-11 §13.4 · §17 · API-18 §6.3 · backlog src) sửa **trước**, commit riêng (O3).
- 17 route chạy; 35/35 cặp gác hai tầng; **3 file / 8 hằng** §10 siết + neo thay thế.
- `calculate` set-based, 0 số thực JS, tử số O1, không vế trễ (O2), tập khoản khoá một lần (B4).
- `adjust-line` tính lại `net` ở SQL (B5); `adjustment_*` sống sót qua calculate lại **và** qua xoá-mềm→hồi-sinh (B6).
- `payslip_items` 7 loại theo bảng §5b; đẳng thức `SUM = gross − deduction + adjustment` có **unit** test.
- Four-eyes 3 tầng + 422 `017` + reopen-rồi-submit-lại **200**; cả 8 action đi qua `applyTransitionTx` (B10).
- Export assert **2 cặp** (B7); phiếu bất biến; ack một lần; `/me` chỉ Own + chỉ kỳ đã phát hành.
- 4 event NOTI dedupeKey content-derived (D5), payload 0 số tiền, 023 chèn theo lô.
- 7 đường audit lượt đọc atomic; `/me/payslips*` 0 hàng.
- `mapPayrollPgError` không để CHECK cặp nào rơi 500 (§8b).
- `bash harness/check.sh --lane-db=payrollbe2` xanh; coverage payroll ≥ 85%.

---

## 13. Sai khác so với plan — ĐO LẠI LÚC THI CÔNG (01/09/2026)

Plan viết trước khi mở một số file; mười điểm dưới đây là chỗ **hiện trạng code khác plan**, ghi lại
để review đọc được lý do thay vì phải suy.

| # | Plan nói | Thi công làm | Vì sao |
| --- | --- | --- | --- |
| Δ1 | `payroll-noti.payload.ts` đặt ở `apps/api/src/notifications/` | đặt ở **`apps/api/src/payroll/`** | `recruit-noti.payload.ts` — khuôn plan viện dẫn — **nằm ở `recruit/`**, không phải `notifications/`. Payload là hợp đồng của PRODUCER; để cạnh service phát nó. `requireField` sống inline trong registrar, đúng như RECRUIT. |
| Δ2 | thêm `PayrollAccessService.resolveActorForExport()` | `PayrollExportService#export` gọi **`resolveActor` HAI LẦN** tường minh | Census tầng-2 quét `resolveActor(<expr>, "<literal>")` và pin theo `Class#method`. Gọi trong `PayrollAccessService` thì site pin thành `PayrollAccessService#resolveActorForExport`, KHÔNG phải `PayrollExportService#export` như §10 yêu cầu. Gọi ngay tại call-site cho đúng pin **và** khỏi phải mở lại file đã qua FULL gate. |
| Δ3 | dedupeKey `PAYROLL_PERIOD_SUBMITTED:{periodId}:{submittedAtIso}` | **`{periodId}:{submittedAtIso}`** (bỏ tiền tố) | `NotificationDedupeService.computeKey` (`notification-dedupe.service.ts:78`) đã ghép `${eventCode}:${dedupeKey}`. Tự tiền tố ⇒ khoá lưu xuống mang **tiền tố đôi**. Đo được vì int-spec neo khoá đỏ ngay lượt đầu. RECRUIT cũng không tiền tố. |
| Δ4 | `PayrollModule` **exports** `PayrollApproverReader`; registrar import ngược | reader ở `payroll/`, **KHÔNG export**; người nhận đi **THEO PAYLOAD outbox** | D4 muốn «một bộ giải, hai caller». Nhét kết quả vào payload còn chặt hơn: cổng `017` và người nhận NOTI-020 dùng **đúng một lần chạy** của reader, không phải hai lần gọi có thể lệch. Hệ quả: registrar 0 phụ thuộc `PayrollModule` ⇒ không cạnh mới trong đồ thị module. |
| Δ5 | `payrollLineListQuerySchema` có `q` (tìm theo tên) | có **`userId`**, KHÔNG có `q` | Tên người là cột danh tính ĐÃ CHIẾU (`PayrollPeopleRepository`). Lọc **trước** khi bọc = đọc `users.full_name` trần (vỡ ratchet identity-projection); lọc **sau** khi bọc = `pagination.total` đếm một tập còn `data` là tập khác ⇒ **phân trang sai IM LẶNG**. Export (017) không phân trang nên `q` ở đó vẫn giữ. |
| Δ6 | dòng lương sinh từ `computeInputsTx` (chỉ người CÓ dữ liệu công/phép) | sinh cho **MỌI nhân sự đủ điều kiện**, bù 0 cho người không có dữ liệu | Lấy nguyên tập `computeInputsTx` thì nhân sự có hồ sơ lương mà tháng đó chưa ai chấm công **biến mất khỏi bảng lương** — im lặng, không dòng nào giải thích. Bù 0 giữ `affectedLines === eligibleCount` (số của `readiness`) và đẩy vấn đề lên chính bảng lương, nơi người duyệt nhìn thấy. Ca A2 của int-spec neo điều này. |
| Δ7 | 4 schema query mới khai `.strict()` | **không** `.strict()` | 4 query schema PAYROLL của BE-1 đều không strict; thêm strict cho riêng nhóm mới là hai luật trong một file, và một query-param lạ (analytics/proxy) sẽ thành 400. `.strict()` giữ nguyên ở các schema **body** như BE-1. |
| Δ8 | trần export + hai-cặp-quyền đo bằng int-spec | đo bằng **unit spec** `payroll-export.service.spec.ts` | (a) Gieo 10.001 dòng thật mỗi lượt CI là chi phí không tương xứng; (b) quan trọng hơn: qua HTTP, route đã 403 sẵn vì decorator `export:payroll`, nên ca HTTP **không phân biệt được** "đã assert `view-line`" với "quên assert" — đúng lớp bẫy `deny-cases-vacuous-without-allow-case`. Unit spec đo THỨ TỰ + NỘI DUNG hai lời gọi trên code thật. Vế HTTP vẫn có: `payroll-be2-permission` ca «thiếu `view-line` ⇒ 403». |
| Δ9 | — | thêm `OutboxService.enqueueMany()` | `publish` một kỳ 500 người phát 500 event NOTI-023. 500 lượt `enqueue` là 500 round-trip **bên trong** transaction đang giữ row-lock trên kỳ. Thêm additive, không đổi hành vi caller cũ. |
| Δ10 | — | vá cổng **D6** của `s13-payroll-db1-invariants` (WO DB-1) | Census wildcard quét MỌI role trong lane DB nên vớ phải role fixture tạm của `recruit-be1-scope` chạy song song ⇒ **đỏ theo thứ tự chạy** (đã đỏ thật trên CI #458). Lọc role của tenant fixture + thêm ca **đối chứng DƯƠNG** chứng minh câu census vẫn thấy role thật. Owner duyệt vá kèm trong BE-2 (01/09). |

### 13b. Điểm plan ĐO ĐÚNG và code theo nguyên văn

`applyTransitionTx` là nơi DUY NHẤT ghi `status` (B10) · `ON CONFLICT` kèm vế partial (L3) · hồi sinh
`adjustment_*` bằng `LEFT JOIN LATERAL old` chứ không `deleted_at = NULL` trong `DO UPDATE` (B6) ·
khoá tập thưởng/phạt MỘT LẦN dùng chung cho SUM và BIND (B4) · `adjust-line` tính lại `net` ở SQL
(B5) · kiểm ĐÓNG BĂNG trước FSM để mã `003` không chết · `summary` khai trước `:id` · 2 param UUID
của `PATCH …/lines/:lineId` đều qua `ParseUUIDPipe`.
