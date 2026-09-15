# S15-PAYROLL-BE-4 — Track C: tạm ứng · đợt chi trả + tệp UNC · ngân sách · import thu nhập/khấu trừ khác · NOTI 024–027

> 🔴 Vùng đỏ — tiền + PII thanh toán (số TK đầy đủ rời server) + cạnh FSM `Published → Paid`. **Opus** code + review.
> **FULL gate TUẦN TỰ**: security-reviewer → silent-failure-hunter → **database-reviewer HẸP** (plan-review B5: 0 DDL nhưng
> 4 repository mới với SQL tay — hỏi ĐÚNG 4 thứ: thứ tự khoá 067/069/072 vs T1/T2/T3 · vị từ `company_id` trên TỪNG câu mới kể
> cả UPDATE/soft-delete · chỉ mục cho `NOT EXISTS` luật PHỦ · MỘT nguồn cho vị từ «payslips của kỳ»). Plan-review đối kháng
> **một vòng** — verdict REVISE 5 BLOCKING, vá ở §0b ⇒ PASS, KHÔNG mở vòng 2 (memory `plan-review-rounds-inject-new-holes`).
> Nhánh `feat/s15-payroll-be-4` **stacked** trên `feat/s15-payroll-be-3` (`9ed2e99b`, PR #510 đang mở — BE-4 dùng
> `releaseAdvancesTx`/`lockPickedAdvancesTx`/`bindAdvancesTx`/`assertUsableTemplateTx` của BE-3). Sau khi #510 squash-merge:
> `git merge origin/master` + `--ours` cho file BE-3 đã sửa (memory `squash-merge-breaks-stacked-prs`), retarget PR về master.
> Lane `mediaos_be4` (head `0575` — BE-4 **KHÔNG có migration**).

## 0. Quyết định thiết kế (15/09/2026 — owner KHÔNG có mặt trong phiên; ghi tường minh để lật rẻ)

| # | Câu hỏi | Chốt (mặc định) | Đổi ở đâu nếu owner lật |
| --- | --- | --- | --- |
| D-1 | Dòng của đợt lập thế nào (067/069) | 067 nhận `userIds?[]`; **vắng ⇒ tự nạp** MỌI phiếu của kỳ chưa có dòng sống ở đợt nào (toàn công ty — `payslip_uq`), lọc theo `method`: `bank` ⇒ chỉ người có số TK trong `payroll_employee_settings` (người thiếu ⇒ `warnings: ["no-bank-account:<n>"]`, không lỗi) · `cash` ⇒ mọi người. `userIds` tường minh + `bank` + người thiếu TK ⇒ **409 027 `payee-no-bank-account`**. 069 thêm/bớt dòng bằng `addUserIds[]`/`removeUserIds[]` (bớt = xoá mềm) | `PayrollPaymentBatchesService.populateTx` |
| D-2 | «Dòng chưa chi» (027 `batch-incomplete`) là gì | `paid_at IS NULL` trên dòng sống. 069 `markPaidUserIds[]` ghi `paid_at = now()` từng dòng; 072 nhận `{ payDate?, confirmAllPaid? }` — `confirmAllPaid: true` ghi `paid_at` cho MỌI dòng chưa chi **trong cùng tx** trước khi kiểm. Còn dòng chưa chi ⇒ 409 027 `batch-incomplete` `{unpaidLines}`. **KHÔNG có đường «bỏ đánh dấu đã chi» ở v2 — kể cả gỡ dòng** (B1: dòng `paid_at NOT NULL` không gỡ được ⇒ 409 027 `line-already-paid`; gỡ được là nhả `payslip_uq` cho phiếu vào đợt khác = chi hai lần) | `PayrollPaymentBatchesService.complete` · `update` |
| D-3 | 026 `advance-period-frozen` áp ở đâu | 060 tạo và 062 đổi `deductPeriodMonth`: kỳ đích tồn tại (sống) và `status ∉ {Draft, CollectingData}` ⇒ 409 026 (**SPEC-11 §15.1 hàng 060 nguyên văn**). 063 duyệt: kỳ đích `status ∉ {Draft, CollectingData, Calculated}` ⇒ 409 026 — SPEC im lặng; cho duyệt ở `Calculated` vì tính lại tại chỗ nhặt được (BE-3 §4.3 bước 10/13), chặn từ `Reviewing` vì snapshot đã đóng băng và khoản sẽ mồ côi vĩnh viễn (chỉ `reopen` cứu). **B3: duyệt khi kỳ đang `Calculated` ⇒ 200 + `warnings: ["recalculate-required"]`** — không có nó thì officer `submit` thẳng và khoản mồ côi im lặng. 064 từ chối: không kiểm | hằng `ADVANCE_CREATE_OPEN_STATUSES` · `ADVANCE_APPROVE_OPEN_STATUSES` ở `payroll-advances.service.ts` |
| D-4 | «Thực hiện» của ngân sách (073) | `SUM(payslips.gross)` của kỳ `status ∈ PUBLISHED_PERIOD_STATUSES` (export từ `payroll-payslips.repository.ts` — **không** viết danh sách thứ hai) có `period_month` thuộc `fiscal_year`; theo đơn vị = `employee_profiles.org_unit_id` **hiện tại** của `payslips.user_id` (hồ sơ sống, mới nhất); hàng `org_unit_id NULL` = toàn công ty. Đọc lúc gọi, không lưu (DB-13 §14.4). Ghi rõ «gross, chưa gồm phần DN» trong DTO doc | `PayrollBudgetsRepository.actualByUnitTx` |
| D-5 | `template-in-use` (052) chặn khi nào | **Xoá mềm HOẶC `isActive:false`** mẫu đang được ≥ 1 kỳ **chưa xoá mềm** tham chiếu (`payroll_periods.template_id`, bất kể trạng thái kỳ) ⇒ 409 023 `template-in-use` `{periods:n}` — theo SPEC-11 §12.1/backlog nguyên văn. Đọc bằng `SELECT count(*)` thường dưới khoá catalog độc quyền đã có ở 052 — **KHÔNG `FOR SHARE/UPDATE`** hàng kỳ (BE-3 §0b M1) | vị từ ở `PayrollTemplatesRepository.periodsUsingTx` |
| D-6 | Tệp UNC (071) | XLSX 7 cột cố định: `STT · Mã NV · Họ tên · Số tài khoản · Ngân hàng · Số tiền · Nội dung`; `cash` xuất được (hai cột TK rỗng); `Số tiền` = `payslips.net`; `Nội dung` = `Luong <YYYY-MM> <mã NV>` (ASCII cho cổng ngân hàng); tên tệp `unc-<batch.code>.xlsx` (mã đợt không phải PII); chuỗi bắt đầu `= + - @` được tiền tố `'` (chống formula injection — QA-1); > 10.000 dòng ⇒ 422 016 | `payroll-payment-export.service.ts` |
| D-7 | Khuôn import (076/077) | 5 cột theo VỊ TRÍ: `Mã NV · Loại · Số tiền · Lý do · Kỳ (YYYY-MM)`; `Loại` nhận `bonus`/`penalty` hoặc nhãn Việt `Thưởng`/`Thu nhập`/`Phạt`/`Khấu trừ`; `Kỳ` phải bằng `period_month` của kỳ trong URL (chống nộp nhầm tệp); `?dryRun=true` mặc định (khuôn HR); apply ghi `bonus_penalties` `Pending` + `created_by = actor` trong MỘT tx; kỳ `status ∉ {Draft, CollectingData, Calculated}` ⇒ 409 003 `period-frozen` (khoản sẽ không bao giờ được gộp). Lỗi theo dòng vào `details[]` dạng `{field:"row:<n>", message}` — **không bao giờ lặp lại số tiền trong message** | `payroll-adjustments-import.columns.ts` (MỘT nguồn cho parser 076 + tệp mẫu 077) |
| D-8 | Người nhận NOTI 024/027 | Reader mới `PayrollPairHoldersReader.holdersTx(tx, companyId, routeKey, excludeUserId)` = CTE của `PayrollApproverReader` tham số hoá theo cặp (exact ALLOW · DENY thắng · sàn Company · role sống); 024 dùng `advanceApprove`, 027 dùng `batchList` (`('view','payment-batch')`). `PayrollApproverReader` giữ nguyên (không đụng file đã qua gate) | `payroll-pair-holders.reader.ts` |
| D-9 | Mã đợt | `code?` tuỳ chọn ở 067; vắng ⇒ `CT-<YYYYMM>-<BANK\|CASH>-<8 hex>` (C5); trùng ⇒ `23505 payroll_payment_batches_company_code_uq` ⇒ 409 027 kind MỚI `batch-code-exists` | `mapPayrollPgError` |
| D-10 | Four-eyes đợt (security DB-2 MEDIUM-3) | 072: `completed_by ≠ created_by` ⇒ vi phạm 409 027 kind MỚI `batch-four-eyes` (tiền-kiểm dưới khoá; DB không có CHECK). **C3: 067 tiền-kiểm «tồn tại ≥ 1 người KHÁC actor giữ `manage:payment-batch`@Company» qua `PayrollPairHoldersReader`** ⇒ rỗng ⇒ 422 017 kind MỚI `no-eligible-completer` (fail-fast lúc LẬP, không kẹt kỳ `Published` vĩnh viễn — cùng lớp 017 ở `submit`) | `PayrollPaymentBatchesService.complete` · `create` |
| D-11 | Widget 002/003 | **KHÔNG làm** ở BE-4 — SPEC-11 §5.1b hàng 26 giao `S15-PAYROLL-DASH-1`. 073/059 chỉ cần trả đủ dữ liệu nguồn | — |

## 0b. Vá plan-review vòng 1 (15/09) — ĐỌC TRƯỚC, ĐÈ lên §4 ở mọi chỗ mâu thuẫn

Verdict vòng 1 = **REVISE** (5 BLOCKING + cảnh báo). Đã vá đủ 5/5 và nhận 9 cảnh báo rẻ ⇒ **PASS, KHÔNG mở vòng 2**. Các mục dưới đã được chép vào §4 tương ứng (không chỉ ở đây).

| ID | Lỗ | Vá |
| --- | --- | --- |
| **B1** | 069 `removeUserIds` xoá mềm được dòng ĐÃ `paid_at` ⇒ `payslip_uq` (partial) nhả slot ⇒ phiếu vào đợt B ⇒ **chi hai lần** mà luật PHỦ vẫn «đủ»; D-2 còn khuyến nghị «gỡ rồi thêm lại» | `removeUserIds` gặp dòng `paid_at IS NOT NULL` ⇒ **409 027 kind MỚI `line-already-paid`** (không gỡ dòng nào trong lượt). KHÔNG có đường bỏ-đánh-dấu ở v2 (D-2 sửa lại). Int-spec: mark paid → remove ⇒ 409 + dòng còn sống; đột biến (o) bỏ vế lọc |
| **B2** | 063 chỉ chặn `created_by === actor` — **người THỤ HƯỞNG** giữ `approve:payroll-advance` tự duyệt được (CHECK DB cũng chỉ soi `created_by`) | tiền-kiểm dưới `FOR UPDATE`: `created_by === actor` **HOẶC `row.user_id === actor`** ⇒ 409 025 `self-approval`. SPEC-11 §12.1 hàng 025 ghi «tự duyệt = người tạo HOẶC người thụ hưởng». Int-spec: thụ hưởng có cặp approve ⇒ 409 |
| **B3** | D-3 cho duyệt ở kỳ `Calculated` nhưng không tín hiệu bắt buộc tính lại ⇒ officer `submit` thẳng ⇒ khoản `Approved` mồ côi vĩnh viễn (T3 khoá bind từ `Reviewing`, `reopen` chặn từ `Published`) | 063 khi kỳ đích đang `Calculated` ⇒ 200 + `warnings: ["recalculate-required"]` (envelope `PayrollWriteResultDto`); int-spec ghim. Ghi SPEC-11 §15.1 hàng 063. Cộng: cảnh báo `unconsumed-advances` sẵn có ở lượt tính lại |
| **B4** | Body 069 tái dùng `paymentBatchStatusEnum` (3 giá trị) ⇒ PATCH `status:'Completed'` lách TOÀN BỘ cổng 072 (T1 chỉ đóng băng khi `OLD.status='Completed'`), dòng của đợt đó được luật PHỦ đếm; lưới cuối `completed_pair_check` chưa map ⇒ 500 | Zod 069 `status: z.enum(["Draft","Ready"])` **riêng** (`paymentBatchEditableStatusEnum`); unit `Completed ⇒ 400`; map `payroll_payment_batches_completed_pair_check` · `payroll_payment_lines_bank_pair_check` · `payroll_advances_deducted_bound_check` ⇒ **400 `VALIDATION-ERR-001`** (helper `payrollBadRequest`, lưới cuối — SPEC-11 §12.1 bảng) + bảng chân trị unit |
| **B5** | Bỏ `database-reviewer` vì «0 DDL» — sai loại rủi ro: 4 repository SQL tay | Giữ database-reviewer HẸP (header) |
| C1 | `payslips` **KHÔNG có `deleted_at`** (append-only) — §4.3 viết «phiếu (deleted_at NULL)» ⇒ SQL lỗi cột | Bỏ vế; vị từ «payslips của kỳ» = **MỘT hàm** `payslipsOfPeriodSql(companyId, periodId)` dùng cho CẢ populate (067/069) LẪN coverage (072) |
| C2 | Audit 072 không ghi số dòng bị `confirmAllPaid` lật; 069 `added/removed` thiếu last4 | 072 `after += {confirmAllPaid, markedPaidCount}`; 069 `added/removed/markedPaid = [{userId, last4}]` |
| C3 | Four-eyes 072 (D-10) tạo ngõ cụt công ty một-người-vận-hành: người lập không hoàn tất được, kỳ kẹt `Published` | 067 tiền-kiểm bằng `PayrollPairHoldersReader.holdersTx(batchComplete − actor)` rỗng ⇒ **422 017 kind MỚI `no-eligible-completer`** (cùng lớp 017 `no-eligible-approver`) |
| C4 | 071 xuất được đợt `Draft` ⇒ hai tệp UNC chồng người | Chấp nhận, ghi §3.10 (tín hiệu: 2 audit `read` 071 quanh một `update` 069) |
| C5 | D-9 4 hex ⇒ 409 do server | 8 hex |
| C6 | 076 nạp cùng tệp hai lần (khoá idempotency khác) ⇒ nhân đôi Pending | `warnings: ["possible-duplicate:<n>"]` đếm Pending trùng `(user, kind, amount, period_month)` — không chặn (còn cổng duyệt) |
| C7 | NOTI 025/026 `[user_id, created_by]` có thể chứa `null` ⇒ `requireUserIds` ném lúc giao = dead-letter câm | lọc `Boolean` + rỗng ⇒ KHÔNG enqueue (cùng luật 024) |
| C8 | Đột biến (h) bị T3 `insert-shape` chặn ⇒ đo rỗng | (h) chạy dưới `DISABLE TRIGGER payroll_advance_freeze_guard` trong tx |
| C9 | `done_when` backlog lệch SPEC (071 «gác manage:payment-batch» — SPEC BA cặp; 073 «gác view-line» — SPEC `view:payroll-budget`) | sửa 2 dòng `done_when` cùng commit |
| C10 | §6.3 thiếu 3 cổng tĩnh: census (9) `MONEY_FREE_ROUTES` đẳng thức · `param-uuid-census` · `body-validation-census` | thêm §6.3 |
| C11 | R7 chưa đo | ĐÃ ĐO: `0565:242-243` officer có `export:payroll` + `view-payslip:payslip` ⇒ 071 dùng được với officer |
| C12 | D-4 org_unit HIỆN TẠI đổi chỗ số năm cũ khi chuyển phòng | ghi DTO doc + SPEC §15.1 hàng 073 («số đọc lúc gọi, theo đơn vị hiện tại») |
| C13 | 065 `canSeeMoney = true` (không money-free) — nhân viên thấy `amount` của mình | int-spec ghim `amount` CÓ MẶT ở 065 |

## 1. Ranh giới

**TRONG phạm vi** — 19 route `PAYROLL-API-059..077` (API-18 §5b track C) + 4 mapping NOTI + nợ đã ghi `done_when`:

1. **Tạm ứng 059–065**: list (audit) · tạo (`created_by` từ `req.user`; 026 theo D-3; FK `user_id` ⇒ 404 sentinel) · chi tiết (audit) · sửa/xoá mềm chỉ `Pending` chưa khấu trừ (025) · duyệt/từ chối four-eyes (025 `self-approval` tiền-kiểm dưới `FOR UPDATE`, CHECK `payroll_advances_four_eyes_check` là lưới race) · `GET /me/payroll-advances` Own fail-closed rỗng, **0 audit**.
2. **Đợt chi trả 066–072**: list/chi tiết/dòng (audit; số TK **`bankAccountLast4`**) · lập từ kỳ `Published` (027 `period-not-published`; snapshot TK SINH Ở SERVER từ `payroll_employee_settings`, KHÔNG nhận từ body) · sửa đợt + thêm/bớt/đánh dấu đã chi dòng khi `Draft`/`Ready` · **tệp UNC** 071 gác **BA cặp** `manage:payment-batch` + `export:payroll` + `view-payslip:payslip` (assert cả ba ở service) + audit · **072 hoàn tất theo LUẬT PHỦ** (row-lock kỳ TRƯỚC · đợt SAU; 028 `batch-empty`; 027 `batch-incomplete`/`batch-already-completed`/`batch-four-eyes`; phủ đủ ⇒ `assertPeriodTransition('Published','Paid','complete-batch')` + `TRAIL_RESET` ghi `paid_*` + NOTI-027 đúng MỘT lần/kỳ; chưa đủ ⇒ 200 kỳ giữ `Published`).
3. **Ngân sách 073–075**: list kèm thực hiện (D-4; sàn Company; audit) · tạo (029 `budget-exists` từ UNIQUE) · sửa/xoá mềm.
4. **Import 076–077**: XLSX/CSV → `bonus_penalties` `Pending` (toàn tệp hoặc không dòng nào — 030) · tệp mẫu XLSX sinh từ CHÍNH hằng cột.
5. **NOTI 024–027**: payload outbox + 4 `registerSource` ở `PayrollNotiBridgeRegistrar` (dedupe content-derived, payload 0 tiền).
6. **Map lỗi DB theo TAG** trigger T1/T2/T3 + 3 UNIQUE + CHECK four-eyes tạm ứng + FK `user_id` hai bảng; census: mỗi tag/tên có ≥ 1 ca kích hoạt THẬT.
7. **052 `template-in-use`** (nợ BE-2/BE-3, D-5).
8. **DTO kỳ additive**: `paidBy` · `paidAt` · `legacyPaidTrail` (kỳ `Locked` di sản O-1 lối A — DB-2 LOW-2).
9. FE cùng PR (memory `s15-payroll-be2-wave-state`): `PAYROLL_ENGINE_PAIRS` +19 · `payroll-wiring.spec` 58→77 · `PAYROLL_ERROR_KINDS` +16 · i18n vi; census BE: 2 tầng 58→77 · mã lỗi 26→32 · `route-http-coverage` `MIN_COVERED_COUNT` 605→624 · artifact route-census regen.
10. SPEC-11 §12.1 (kind mới + D-3) · §15.1 (body 067/069/072 · D-3 063) · API-18 §5.2 + §6.5b (028 `no-completed-batch` → `batch-empty` — lệch SPEC-11) cùng commit.

**NGOÀI phạm vi** (đừng làm): widget DASH 002/003 (DASH-1) · route xoá đợt (không có trong 50 mã; T1 `has-active-lines` không map — 500 có chủ đích, census QA ghim) · sửa snapshot TK tại chỗ (gỡ + thêm lại dòng khi `Draft`/`Ready`; mỗi lượt có audit before/after masked) · PDF/báo cáo (BE-5) · màn FE (FE-3) · «bỏ đánh dấu đã chi» · nợ `bonus_penalties` (F)/(C) cùng lỗ B2 — đã vá ở 0574 · trần đồng hồ · sidebar/`pruneUnbuiltScreens`.

## 2. Số đo đã có (15/09, đọc code thật trên `9ed2e99b`)

| Điểm | Bằng chứng |
| --- | --- |
| 4 bảng + 3 trigger + CHECK | `schema/payroll-disbursement.ts` (mig 0572); T1 tag `period-immutable · frozen · insert-completed · has-active-lines`; T2 `not-found · insert-into-completed · frozen · move-to-completed · cross-user · cross-period`; T3 `insert-shape · frozen · rebind · status-terminal · period-frozen · not-found` (`0572:490-760`) |
| Máy tính lương đã bind/nhả tạm ứng | `payroll-calc.repository.ts` `releaseAdvancesTx` (`Deducted → Approved` + NULL cả cặp) · `lockPickedAdvancesTx` (`Approved` · đúng tháng · chưa gắn · sống · đủ điều kiện) · `bindAdvancesTx` (`Deducted` + cặp cùng câu); calc gọi sau khoá kỳ (`payroll-calc.service.ts:118-148`) |
| Cạnh FSM sẵn | `payroll-fsm.ts` `{ action: "complete-batch", from: "Published", to: "Paid" }` · `TRAIL_RESET["complete-batch"] = { set: ["paid"] }` · `applyTransitionTx` ghi `paidBy/paidAt` (`schema/payroll.ts:178-179`) |
| Cặp quyền + allowlist | 8 cặp track C seed 0571 (`view/manage/approve/view-own:payroll-advance · view/manage:payment-batch · view/manage:payroll-budget`); `permission.service.ts:250-257` và `:339-345` đã có cả 8 ⇒ **không sửa** |
| Audit object_type | `schema/audit.ts` đã có `payroll_advance · payroll_payment_batch · payroll_budget` (0571) ⇒ không migration |
| NOTI catalog | `notification-event-catalog.const.ts:200-203` 4 mã bật; template 0573 biến: 024/025 `{actor_name, deduct_period_month, payroll_advance_id}` · 026 `+ reason` · 027 `{period_month, payroll_period_id}`; `target_url` 024 `/payroll/advances` · 025/026 `/me/payroll-advances` · 027 `/payroll/periods/{payroll_period_id}` |
| Khuôn tái dùng | `bonus-penalties.service.ts` (FSM + `lockPendingUnconsumed` thứ tự 013→011) · `payroll-export.service.ts` (exceljs, 2 cặp, trần 10.000, audit) · `employees/hr-import.parser.ts` + `hr-employee-import.service.ts` (parse theo VỊ TRÍ, MIME/ext/size, dryRun) · `payroll-approver.reader.ts` (CTE cặp → user) · `payroll-employees.mapper.ts` (`bankAccountLast4` dẫn xuất) |
| Census neo | 2 tầng `58` route · `≥ 59` literal · sensitive `21/24` · noFloor `[mePayslip*]` (3) · `PAYROLL_CONTROLLERS` 11 tên; mã lỗi `26`; FE wiring `58` · sensitive `distinct 24`; `route-http-coverage` `MIN_COVERED_COUNT = 605`; FE kinds shape2 = 3 (inline) — **mọi kind mới viết shape1 `payrollDetails("…")`** |
| Điểm chiếu danh tính | `PayrollPeopleRepository.namesByUserIdsTx(actor)` duy nhất; ratchet chiều 6 `rawSqlIdentity` pin ⇒ SQL thô KHÔNG được chạm `users.full_name/email` |
| Contracts | `payroll.ts` **860 dòng** (> 800) ⇒ file mới `payroll-disbursement.ts` (import ngược enum, không re-export) · `payroll.ts` chỉ +3 dòng (`paidBy` · `paidAt` · `legacyPaidTrail`) |
| Own-route khuôn | `MePayslipsController` (`me/payslips`, thuộc segment `me` của `openapi-modules.ts`) · pair `(…, true, false, false)` |
| Idempotent v2 | 10 route ĐÓNG: BE-4 lấy **060 · 067 · 072 · 074** — **076 multipart CỐ Ý KHÔNG** (security-reviewer M2: interceptor băm `request.body` trước `FileInterceptor` ⇒ vân tay rỗng, mù tệp; cùng khuôn HR import) |
| Coverage script | `package.json` `test:cov:payroll` liệt kê file — thêm 3 int-spec BE-4 |

## 3. Điểm KHÁC WO / tài liệu — đọc trước khi review

### 3.1 API-18 §6.5b hàng 028 còn `no-completed-batch` — SPEC-11 §12.1 đã đổi sang `batch-empty`
Mã chết theo SPEC-11 (072 là cửa duy nhất vào `Paid`). Sửa API-18 cùng commit; code ném đúng `batch-empty`.

### 3.2 Backlog done_when «Deducted NGAY LÚC BIND» — BE-3 đã làm; BE-4 KHÔNG viết lại
Đã đo §2. BE-4 chỉ map TAG trigger T3 và tiền-kiểm 025/026 ở route ghi.

### 3.3 «063 duyệt khi kỳ ≥ Calculated» — SPEC im lặng ⇒ D-3
Áp 026 nguyên văn ở 060/062; 063 chặn từ `Reviewing`. Nếu áp «≥ Calculated» cho 063 thì khoản tạo ở `CollectingData` mà duyệt sau lượt tính đầu ⇒ 409 vĩnh viễn trừ khi `reopen` — sai với hành vi «tính lại tại chỗ» đã có. Ghi SPEC-11 §15.1 hàng 063.

### 3.4 «Sửa snapshot qua đường riêng có audit» (security DB-2 MEDIUM-3) — KHÔNG mở route sửa snapshot
Đường riêng = gỡ dòng + thêm lại (069) khi đợt còn `Draft`/`Ready`: snapshot đọc LẠI từ settings, audit ghi `{removed:[userId], added:[userId], snapshotLast4}`. Body 069 **không có trường TK nào** (Zod `.strict()`). Đợt `Completed` ⇒ T2 `frozen`.

### 3.5 «Đã chi» KHÔNG đọc `payroll_periods.paid_*` (DB-2 LOW-2)
DTO đợt/dòng dẫn xuất từ `payroll_payment_lines` + đợt `Completed`; DTO kỳ thêm `legacyPaidTrail = (paid_at = published_at AND paid_by = published_by)` để FE-3 không hiện «đã chi» cho kỳ `Locked` di sản. Số `unpaidPayees` của 072 = phiếu của kỳ chưa có dòng sống thuộc đợt `Completed`.

### 3.6 T2 `cross-user`/`cross-period`/`not-found` và T1 `has-active-lines`, T3 `not-found` — cố ý KHÔNG map
SPEC-11 §12.1: service PHẢI chặn trước ⇒ tới DB là bug ⇒ 500 có chủ đích. Service chặn: phiếu lấy từ `payslips` của ĐÚNG kỳ của đợt (`user_id` đi cùng), đợt sống, kỳ sống. Census QA ghim 4 tag này **vắng** trong `mapPayrollPgError` (ca đẳng thức tập tag đã map).

### 3.7 Rò số TK qua `DrizzleQueryError.message` (security DB-2 MEDIUM-2)
Mọi câu ghi `payroll_payment_lines` bọc `mappedLineWrite()`: lỗi PG **không map** ⇒ ném `Error` mới chỉ mang `code` + `constraint` + tag (không `params`, không `cause`). Int-spec spy `Logger.error` trên đường 23505 `payslip_uq` (race) + đường 500 giả lập (tag `cross-user` gieo thẳng) và assert log KHÔNG chứa chuỗi số TK của fixture.

### 3.8 `bank_name_snapshot` không có chi nhánh
Cột snapshot chỉ 3 (DB-13 §14.3); `bank_branch` của settings không đóng băng — tệp UNC cột «Ngân hàng» = `bank_name_snapshot` (không chi nhánh). Ghi DB-13 §14.3 một dòng.

### 3.9 Import dùng `bonus_penalties` v1 — trigger (F) 0574 không chạm
INSERT `Pending` không mang cặp consume ⇒ (F) không bắn; CHECK four-eyes 0575 chỉ soi `Approved` ⇒ không bắn. Không có ca nào cần tắt trigger.

### 3.10 Nợ nhỏ để lại có ý thức (không làm ở BE-4)
- Người thay đổi số TK **giữa** lập đợt và hoàn tất — tệp UNC đã xuất mang số cũ (đúng thiết kế đóng băng); FE-3 hiện `snapshotAt`. Tín hiệu: audit `read` 071 + `update` 039 cùng user sau `created_at` của dòng.
- (C4) 071 xuất được đợt `Draft`/`Ready` ⇒ xuất → sửa dòng → xuất lại = hai tệp UNC chồng người. Không siết trạng thái (kế toán cần tệp nháp để đối chiếu); tín hiệu phát hiện: hai audit `read` 071 kẹp một audit `update` 069 trên cùng `batchId`.
- (C12) «Thực hiện» ngân sách theo `org_unit_id` HIỆN TẠI: người chuyển phòng làm số năm cũ đổi chỗ giữa đơn vị — DB-13 §14.4 chốt đọc lúc gọi; DTO doc + SPEC §15.1 hàng 073 ghi rõ để kế toán không coi là số đóng băng.

## 4. Thiết kế

### 4.1 Bảng route → cặp · sàn · audit · idempotent

| Mã | Route | key | Cặp (`isSensitive` · floor) | Audit | Idem |
| --- | --- | --- | --- | --- | --- |
| 059 | `GET /payroll/advances` | `advanceList` | view:payroll-advance ✓ Company | read `payroll_advance` id NULL `{filters,rowCount}` | |
| 060 | `POST /payroll/advances` | `advanceCreate` | manage:payroll-advance ✓ Company | create `payroll_advance` `{userId, deductPeriodMonth, status}` | ✓ |
| 061 | `GET /payroll/advances/:id` | `advanceDetail` | view:payroll-advance ✓ | read `{}` | |
| 062 | `PATCH /payroll/advances/:id` | `advanceUpdate` | manage:payroll-advance ✓ | update/delete (tên trường) | |
| 063 | `POST /payroll/advances/:id/approve` | `advanceApprove` | approve:payroll-advance ✓ | approve `{status}` + NOTI-025 | |
| 064 | `POST /payroll/advances/:id/reject` | `advanceReject` | approve:payroll-advance ✓ | reject + NOTI-026 | |
| 065 | `GET /me/payroll-advances` | `meAdvanceList` | view-own:payroll-advance ✓ **Own** (floor off, objectGrant `false`) | **0** | |
| 066 | `GET /payroll/payment-batches` | `batchList` | view:payment-batch ✓ | read `payroll_payment_batch` id NULL | |
| 067 | `POST /payroll/payment-batches` | `batchCreate` | manage:payment-batch ✓ | create `{periodId, method, lineCount}` | ✓ |
| 068 | `GET /payroll/payment-batches/:id` | `batchDetail` | view:payment-batch ✓ | read `{}` | |
| 069 | `PATCH /payroll/payment-batches/:id` | `batchUpdate` | manage:payment-batch ✓ | update `{added, removed, markedPaid, changedFields}` (last4) | |
| 070 | `GET /payroll/payment-batches/:id/lines` | `batchLines` | view:payment-batch ✓ | read `{rowCount}` | |
| 071 | `GET /payroll/payment-batches/:id/export` | `batchExport` | manage:payment-batch ✓ **+ `periodExport` + `payslipList`** (3 `resolveActor` cùng site) | read `{rowCount, format:'xlsx'}` — KHÔNG TK, KHÔNG tiền | |
| 072 | `POST /payroll/payment-batches/:id/complete` | `batchComplete` | manage:payment-batch ✓ | complete `payroll_payment_batch` `{periodStatus, unpaidPayees}` + (khi `Paid`) `complete-batch` trên `payroll_period` + NOTI-027 | ✓ |
| 073 | `GET /payroll/budgets` | `budgetList` | view:payroll-budget ✓ Company | read `payroll_budget` id NULL `{fiscalYear, orgUnitId?, rowCount}` | |
| 074 | `POST /payroll/budgets` | `budgetCreate` | manage:payroll-budget ✓ | create `{fiscalYear, orgUnitId}` | ✓ |
| 075 | `PATCH /payroll/budgets/:id` | `budgetUpdate` | manage:payroll-budget ✓ | update/delete (tên trường) | |
| 076 | `POST /payroll-periods/:id/import-adjustments` | `importAdjustments` | manage:bonus-penalty ✓ (cặp CŨ) | import `payroll_period` `{fileName, rowCount, dryRun}` (chỉ apply) | ✗ (multipart — M2) |
| 077 | `GET /payroll/imports/adjustments-template` | `importTemplate` | manage:bonus-penalty ✓ | **0** | |

`MONEY_FREE_ROUTES` += 11 (route ghi trả `{id}`/đếm + 077): `advanceCreate · advanceUpdate · advanceApprove · advanceReject · batchCreate · batchUpdate · batchComplete · budgetCreate · budgetUpdate · importAdjustments · importTemplate`. Route đọc chở tiền (`amount`/`net`/`totalNet`/`plannedAmount`) gác đúng cặp chở-tiền ⇒ `assertMoneyRoute` ở mapper.

### 4.2 Tạm ứng — `PayrollAdvancesService` (khuôn `BonusPenaltiesService`)

```text
create(060):  resolveActor → tx: assertTargetPeriodOpen(month, CREATE_OPEN) ⇒ 409 026
              → repo.createTx(status Pending, created_by=actor)  [mapPayrollPgError: FK user_id ⇒ 404]
              → audit → NOTI-024 payload {advanceId, createdAtIso, recipientUserIds=holders(advanceApprove)−actor,
                actor_name, deduct_period_month, payroll_advance_id}
              (recipient rỗng ⇒ KHÔNG enqueue, warnings ["no-eligible-approver"] — không 422: tạm ứng vẫn tạo được,
               officer thấy cảnh báo; khác 017 vì không kẹt FSM)
update(062):  lock FOR UPDATE → payrollPeriodId≠NULL ⇒ 025 advance-already-deducted (kiểm TRƯỚC)
              → status≠Pending ⇒ 025 advance-not-pending → month đổi ⇒ assertTargetPeriodOpen(CREATE_OPEN)
              → update/softDelete (chỉ status/decided_* KHÔNG chạm) [map T3]
decide(063/064): resolveActor(status==='Approved' ? 'advanceApprove' : 'advanceReject') (conditional literal — census
              bắt) → lock → 025 already-deducted → 025 not-pending
              → (B2) created_by===actor **HOẶC user_id===actor** ⇒ 025 self-approval (người tạo lẫn người THỤ HƯỞNG)
              → 063: assertTargetPeriodOpen(APPROVE_OPEN) ⇒ 026 → decideTx (chỉ status/decided_*/note) [map:
              CHECK four_eyes ⇒ 025 self-approval · T3 tag] → audit
              → (B3) kỳ đích đang `Calculated` ⇒ warnings ["recalculate-required"] (tính lại tại chỗ mới nhặt khoản)
              → NOTI-025/026 {advanceId, decidedAtIso, recipientUserIds = uniq([user_id, created_by]).filter(Boolean) − actor,
                reason (026)} — (C7) rỗng ⇒ KHÔNG enqueue
listMine(065): resolveActor('meAdvanceList') → repo.listTx({userId: actor}) — không hàng ⇒ rỗng; 0 audit
```

`assertTargetPeriodOpen(tx, companyId, month, allowed)`: `SELECT status FROM payroll_periods WHERE company_id AND period_month = month AND deleted_at IS NULL` (không khoá — khoá kỳ ở đây chỉ để chặn race với `calculate`, mà `calculate` đã nhả/nhặt lại theo tập `Approved` tại thời điểm nó khoá; race tệ nhất = khoản không được nhặt lượt này và hiện `unconsumed-advances` — không sai tiền).

DTO tạm ứng: mirror `bonusPenaltySchema` + `deductPeriodMonth` (`amount` `.optional()` theo `canSeeMoney`). Own DTO (065) cùng schema.

### 4.3 Đợt chi trả — `PayrollPaymentBatchesService`

**Thứ tự khoá cố định (DB-2 M5): kỳ `FOR UPDATE` (khi chạm kỳ) → đợt `FOR UPDATE` → RỒI MỚI ghi dòng.** T2 đọc đợt `FOR SHARE` khi ghi dòng — cùng tx đang giữ `FOR UPDATE` ⇒ không tự xung đột; ghi dòng trước rồi UPDATE đợt = nâng khoá = 40P01.

```text
create(067):  resolveActor → tx:
  0 (C3) holdersTx(batchComplete pair, − actor) rỗng ⇒ 422 017 no-eligible-completer (fail-fast, chưa ghi gì)
  1 lock kỳ FOR UPDATE ⇒ 404 · status≠Published ⇒ 409 027 period-not-published
  2 INSERT đợt (status Draft, code D-9, created_by) [map: code uq ⇒ 027 batch-code-exists; T1 insert-completed ⇒ 027]
  3 lock đợt FOR UPDATE (hàng vừa chèn — giữ đúng thứ tự cho bước 4)
  4 populateTx: ứng viên = payslipsOfPeriodSql (C1: bảng payslips append-only, KHÔNG có deleted_at — MỘT vị từ dùng chung
    với coverage 072) LEFT JOIN dòng sống toàn công ty ⇒ chưa có dòng; lọc userIds nếu có (userId không có phiếu ở kỳ ⇒
    404 sentinel); JOIN settings (bank_account_number…); bank: thiếu TK ⇒ tường minh ⇒ 409 027 payee-no-bank-account,
    tự nạp ⇒ bỏ qua + warning `no-bank-account:<n>`; net = 0 ⇒ warning `zero-net:<n>` (R8)
    → INSERT lines (company, batch, user_id, payslip_id, 3 snapshot) MỘT câu INSERT … SELECT set-based (số TK KHÔNG là
      param) [mappedLineWrite: payslip_uq/batch_user_uq ⇒ 027 payee-already-in-batch · T2 tag insert-into-completed ⇒ 027]
  5 audit {periodId, method, lineCount, skippedNoBank} → {id, warnings}
update(069):  Zod: status ∈ {Draft, Ready} RIÊNG (B4 — KHÔNG tái dùng enum 3 giá trị; `Completed` ⇒ 400) · .strict()
  tx: lock đợt FOR UPDATE ⇒ 404 · Completed ⇒ 409 027 batch-already-completed
  → patch (payDate·note·status Draft↔Ready)
  → removeUserIds: (B1) dòng sống có paid_at NOT NULL trong tập ⇒ 409 027 line-already-paid (KHÔNG gỡ dòng nào);
    còn lại soft-delete
  → addUserIds: populateTx(tường minh) → markPaidUserIds: UPDATE paid_at=now() WHERE paid_at IS NULL
  [mọi ghi dòng qua mappedLineWrite] → audit {added:[{userId,last4}], removed:[{userId,last4}], markedPaid:[userId],
    changedFields} (C2) → {id, warnings}
complete(072): tx:
  0 lock kỳ FOR UPDATE (đọc period_id của đợt bằng SELECT thường TRƯỚC, rồi khoá kỳ, rồi khoá đợt — kỳ của đợt BẤT
    BIẾN (T1) nên đọc trước không đua) ⇒ 404
  1 lock đợt FOR UPDATE ⇒ 404 · Completed ⇒ 027 batch-already-completed · created_by===actor ⇒ 027 batch-four-eyes
  2 confirmAllPaid ⇒ UPDATE lines SET paid_at=now() WHERE batch AND deleted_at IS NULL AND paid_at IS NULL
  3 count(dòng sống)=0 ⇒ 409 028 batch-empty · count(dòng sống paid_at NULL)>0 ⇒ 027 batch-incomplete {unpaidLines}
  4 UPDATE đợt Completed + completed_by/at + pay_date [map T1 frozen ⇒ 027]
  5 PHỦ ĐỦ: uncovered = payslipsOfPeriodSql NOT EXISTS (dòng sống ⋈ đợt Completed sống cùng kỳ) — đếm dưới khoá kỳ
    uncovered>0 ⇒ audit, trả 200 {id, batchStatus:'Completed', periodStatus:'Published', unpaidPayees}
    =0 ⇒ assertPeriodTransition(period.status,'Paid','complete-batch') → applyTransitionTx('Paid','complete-batch')
       [map CHECK paid_pair ⇒ 001 trail-pair-violation] → audit kỳ → NOTI-027 {periodId, recipientUserIds =
       holders(batchList) − actor, period_month, payroll_period_id} (dedupe = periodId ⇒ once-ever; rỗng ⇒ không enqueue)
  audit đợt (C2): {periodStatus, unpaidPayees, confirmAllPaid, markedPaidCount, lineCount}
```

Ca ÂM bắt buộc: kỳ 10 phiếu, đợt A (6) + đợt B (4): hoàn tất A ⇒ 200 `Published` `unpaidPayees:4`, **không 409**; hoàn tất B ⇒ 200 `Paid`, `unpaidPayees:0`, đúng 1 hàng outbox 027; hoàn tất song song A và B (`Promise.all` sau `app.listen(0)` — memory `supertest-closes-shared-server-on-first-response`) ⇒ đúng một kỳ `Paid`, 0 lỗi 40P01, 1 hàng 027.

Audit `read` cho 066/068/070/071 trong CÙNG tx với lượt đọc (reveal + audit atomic).

DTO: `paymentBatchSchema {id, payrollPeriodId, periodMonth, code, method, status, payDate, note, lineCount, paidLineCount, totalNet?, createdBy, createdAt, completedBy, completedAt, updatedAt}` · `paymentLineSchema {id, userId, employeeCode, fullName, payslipId, net?, bankAccountLast4, bankName, accountHolder, paidAt, createdAt}` · `completePaymentBatchResultSchema {id, batchStatus, periodStatus, unpaidPayees}`. Tên qua `namesByUserIdsTx(actor)`.

### 4.4 Tệp UNC — `PayrollPaymentExportService` (khuôn `PayrollExportService`)

Ba `resolveActor` tường minh ở ĐẦU `export()` (thiếu cặp nào ⇒ 403 trước khi chạm DB): `batchExport` · `periodExport` · `payslipList`. Đọc đợt + dòng sống ⋈ `payslips.net` ⋈ tên (`namesByUserIdsTx`) → > 10.000 ⇒ 422 016 `export-limit` → audit read (đúng MỘT hàng, `{rowCount, format}`) → exceljs ngoài tx. Cột D-6; sanitizer `xlsxSafe(s)`. Controller đặt `Content-Type` ở đường thành công (bài học 017 — `@Header` áp trước handler làm 4xx đội nhãn XLSX).

### 4.5 Ngân sách — `PayrollBudgetsService`

073: `listTx(fiscalYear = query.fiscalYear ?? năm hiện tại (UTC), orgUnitId?)` + `actualByUnitTx(fiscalYear)` một câu GROUP BY `org_unit_id` (NULL bucket = tổng công ty) ⇒ map vào từng hàng; `variance = planned − actual`; audit read. 074: `orgUnitId` sống ⇒ `orgUnitLiveTx` (tái dùng của templates repo — export hàm) ⇒ 404 · INSERT [map: `payroll_budgets_year_unit_uq` ⇒ 409 029 `budget-exists`]. 075: lock → patch `plannedAmount`/`note` hoặc xoá mềm. Zod: `fiscalYear` int 2000..2100 (mirror CHECK) · `plannedAmount` ≥ 0 · `orgUnitId` uuid nullable.

### 4.6 Import — `PayrollAdjustmentImportService` (khuôn HR)

`payroll-adjustments-import.columns.ts`: `ADJUSTMENT_IMPORT_COLUMNS = [{key:'employeeCode', header:'Mã NV'}, {key:'kind', header:'Loại'}, {key:'amount', header:'Số tiền'}, {key:'reason', header:'Lý do'}, {key:'periodMonth', header:'Kỳ (YYYY-MM)'}]` + `KIND_LABELS` (vi→enum). 077 sinh workbook 1 sheet: header + 1 hàng ví dụ từ CHÍNH hằng. 076:
1. `resolveActor('importAdjustments')` → file: vắng/rỗng/> 5MB/ext·MIME (`HrImportParser` — inject từ `EmployeesModule`? **KHÔNG** import module HR: copy `parse()` thành `PayrollImportParser` nhỏ (≤ 80 dòng, lazy `exceljs`/`csv-parse`) để không kéo cạnh module) ⇒ 400/422 030 `import-invalid`.
2. Header hàng 0 phải khớp ĐÚNG BẰNG 5 nhãn (trim, không phân biệt hoa/thường) ⇒ lệch ⇒ 422 030 `import-invalid` `{reason:'header'}`. Dòng dữ liệu = 0 ⇒ `import-invalid` · > 5.000 ⇒ `import-too-large`.
3. tx: `findTx` kỳ ⇒ 404 · status ∉ {Draft, CollectingData, Calculated} ⇒ 409 003 `period-frozen` · Zod từng dòng (`amount > 0` chuỗi thập phân · `kind` · `reason` 1..500 · `periodMonth === period.periodMonth`) · mã NV trùng trong tệp ⇒ lỗi dòng · resolve `employee_code → user_id` MỘT câu (`employee_profiles` sống, `user_id NOT NULL`, `= ANY($codes)`) ⇒ thiếu ⇒ `import-unknown-user`.
4. Có lỗi dòng ⇒ 422 030 (kind ưu tiên: `import-unknown-user` nếu có ít nhất một, ngược lại `import-invalid`), `details[] = [{field:'kind'}, {field:'row:<n>', message:'<mô tả không kèm giá trị tiền>'} …]` (cắt 50 dòng đầu + `{field:'errorRows', message: n}`), **0 hàng ghi**.
5. `dryRun` ⇒ trả `{id: periodId, status, affectedLines: n, warnings: ['dry-run', …]}`; apply ⇒ INSERT set-based `bonus_penalties` `Pending` `created_by = actor` (`period_month` = của kỳ) → audit `import` → `{id, status, affectedLines: n, warnings: [...]}`. (C6) cả hai nhánh đếm Pending sống trùng `(user_id, kind, amount, period_month)` với dòng tệp ⇒ `possible-duplicate:<n>` (không chặn — còn cổng duyệt).

### 4.7 052 `template-in-use`

`PayrollTemplatesService.update`: sau `findTx(forUpdate)` (đã dưới `payrollCatalogLockTx`): nếu `dto.delete === true` hoặc `dto.isActive === false` (và `before.isActive`) ⇒ `n = repo.periodsUsingTx(companyId, id)` (`count(*)` kỳ sống có `template_id = id`, **không FOR SHARE/UPDATE**) ⇒ `n > 0` ⇒ 409 023 `template-in-use` `{periods: n}`.

### 4.8 NOTI — `payroll-noti.payload.ts` + `payroll-noti-bridge.registrar.ts` (additive)

| Event | eventType | eventCode | sourceEntity | recipients (payload) | dedupe |
| --- | --- | --- | --- | --- | --- |
| 024 | `payroll.advance_submitted` | `PAYROLL_ADVANCE_SUBMITTED` | `payroll_advance` / advanceId | `recipientUserIds` (holders `advanceApprove` − actor; rỗng ⇒ không enqueue) | `${advanceId}:${createdAtIso}` |
| 025 | `payroll.advance_approved` | `PAYROLL_ADVANCE_APPROVED` | advanceId | `recipientUserIds` = uniq[user_id, created_by] − actor | `${advanceId}:${decidedAtIso}` |
| 026 | `payroll.advance_rejected` | `PAYROLL_ADVANCE_REJECTED` | advanceId | như 025 (+ `reason`) | `${advanceId}:${decidedAtIso}` |
| 027 | `payroll.payment_batch_completed` | `PAYROLL_PAYMENT_BATCH_COMPLETED` | `payroll_period` / periodId | holders `batchList` − actor | `${periodId}` |

Biến template snake_case khớp `variables_schema` 0573 (thiếu khoá ⇒ dead-letter câm). **0 số tiền**. Registrar: `requireField`/`requireUserIds` như 4 mapping cũ (rỗng ⇒ ném; vì thế producer KHÔNG enqueue khi rỗng).

### 4.9 Mã / kind mới (`payroll.errors.ts` additive; mọi kind là literal `payrollDetails("…")`)

| Mã | key | HTTP | kind | Nơi ném |
| --- | --- | --- | --- | --- |
| 025 | `ADVANCE_CONFLICT` | 409 | `advance-not-pending` · `advance-already-deducted` · `self-approval` (người tạo HOẶC thụ hưởng — B2) | 062/063/064 + map CHECK four-eyes + T3 `frozen/status-terminal/insert-shape` ⇒ `advance-not-pending`, `rebind` ⇒ `advance-already-deducted` |
| 026 | `ADVANCE_PERIOD_FROZEN` | 409 | `advance-period-frozen` | 060/062/063 + T3 `period-frozen` |
| 027 | `PAYMENT_BATCH_CONFLICT` | 409 | `period-not-published` · `batch-incomplete` · `batch-already-completed` · `payee-already-in-batch` · **`batch-code-exists`** · **`batch-four-eyes`** · **`payee-no-bank-account`** · **`line-already-paid`** (B1) | 067/069/072 + map `payslip_uq`/`batch_user_uq`/`code_uq` + T1 `frozen/insert-completed/period-immutable` + T2 `frozen/insert-into-completed/move-to-completed` |
| 028 | `BATCH_EMPTY` | 409 | `batch-empty` | 072 |
| 029 | `BUDGET_EXISTS` | 409 | `budget-exists` | map `payroll_budgets_year_unit_uq` |
| 030 | `IMPORT_INVALID` | 422 | `import-invalid` · `import-too-large` · `import-unknown-user` | 076 |
| 017 | (có) | 422 | **`no-eligible-completer`** (C3) | 067 |
| 023 | (có) | 409 | **`template-in-use`** | 052 |
| 003 | (có) | 409 | `period-frozen` (tái dùng) | 076 |
| 010 | (có) | 404 | `not-found` | FK `payroll_advances_user_id*` · `payroll_payment_lines_user_id*` · `payroll_budgets_org_unit_id*` ⇒ sentinel |
| — | `payrollBadRequest` | 400 | `VALIDATION-ERR-001` (B4, lưới cuối) | CHECK `payroll_payment_batches_completed_pair_check` · `payroll_payment_lines_bank_pair_check` · `payroll_advances_deducted_bound_check` |

Map TAG (luật 3 mở rộng): `payroll_advance_freeze_guard:<tag>:` · `payroll_payment_batch_freeze:<tag>:` · `payroll_payment_line_guard:<tag>:` — bóc tag bằng regex `^(\w+):([a-z-]+):`; tag không trong bảng ⇒ `null` (500 có chủ đích §3.6). Unit `payroll.errors.spec.ts` bảng chân trị: mọi tag ĐÃ map ⇒ đúng mã/kind; 4 tag KHÔNG map ⇒ `null`; 3 CHECK lưới cuối ⇒ 400; message trả về KHÔNG chứa chuỗi tham số giả (`"9999-1111"`).

Census mã lỗi 26 → **32**. FE `PAYROLL_ERROR_KINDS` +18: `advance-not-pending · advance-already-deducted · advance-period-frozen · period-not-published · batch-incomplete · batch-already-completed · payee-already-in-batch · batch-code-exists · batch-four-eyes · payee-no-bank-account · line-already-paid · batch-empty · budget-exists · import-invalid · import-too-large · import-unknown-user · template-in-use · no-eligible-completer`; `STATE_CONFLICT_KINDS` += `advance-not-pending · advance-already-deducted · advance-period-frozen · period-not-published · batch-already-completed · batch-incomplete · batch-empty · batch-four-eyes · line-already-paid · template-in-use`.

### 4.10 DTO kỳ additive
`payrollPeriodSchema` += `paidBy: uuid|null` · `paidAt: datetime|null` · `legacyPaidTrail: boolean` (mapper: `!!row.paidAt && row.paidAt.getTime() === row.publishedAt?.getTime() && row.paidBy === row.publishedBy`).

## 5. File

| File | Việc | Dòng ước |
| --- | --- | --- |
| `packages/contracts/src/payroll-disbursement.ts` **MỚI** | Zod tạm ứng · đợt · dòng · complete · ngân sách · import query; import ngược `payrollAdvanceStatusEnum`… từ `./payroll` | ≤ 300 |
| `packages/contracts/src/payroll.ts` | `paidBy/paidAt/legacyPaidTrail` | +3 |
| `packages/contracts/src/index.ts` | `export * from "./payroll-disbursement"` | +1 |
| `apps/api/src/payroll/payroll-route-pairs.const.ts` | +19 key (059–077) | +30 |
| `apps/api/src/payroll/payroll-access.service.ts` | `MONEY_FREE_ROUTES` +11 | +12 |
| `apps/api/src/payroll/payroll.errors.ts` | 6 key · message · map UNIQUE/CHECK/FK/TAG (592 → ~720; **tách `payroll-pg-error.map.ts`** nếu > 800) | +130 |
| `apps/api/src/payroll/payroll-disbursement.dto.ts` **MỚI** | DTO Nest từ contracts | ≤ 40 |
| `apps/api/src/payroll/payroll-advances.controllers.ts` **MỚI** | `PayrollAdvancesController` (059–064) + `MePayrollAdvancesController` (065) | ≤ 180 |
| `apps/api/src/payroll/payroll-advances.service.ts` + `.repository.ts` **MỚI** | §4.2 | ≤ 330 + ≤ 220 |
| `apps/api/src/payroll/payroll-payment.controllers.ts` **MỚI** | `PayrollPaymentBatchesController` (066–072) · `PayrollBudgetsController` (073–075) · `PayrollAdjustmentImportsController` (076–077, `@Controller()` root, path đầy đủ) | ≤ 300 |
| `apps/api/src/payroll/payroll-payment-batches.service.ts` **MỚI** | §4.3 (tách `payroll-payment-batches.complete.ts` nếu > 400) | ≤ 400 |
| `apps/api/src/payroll/payroll-payment-batches.repository.ts` **MỚI** | đợt + dòng: lock · list · populate · softDelete · markPaid · coverage · lines ⋈ net | ≤ 400 |
| `apps/api/src/payroll/payroll-payment-export.service.ts` **MỚI** (+ `.spec.ts`) | §4.4 | ≤ 160 |
| `apps/api/src/payroll/payroll-budgets.service.ts` + `.repository.ts` **MỚI** | §4.5 | ≤ 200 + ≤ 160 |
| `apps/api/src/payroll/payroll-adjustments-import.columns.ts` · `payroll-import.parser.ts` · `payroll-adjustments-import.service.ts` **MỚI** (+ `.spec.ts`) | §4.6 | ≤ 60 + ≤ 90 + ≤ 300 |
| `apps/api/src/payroll/payroll-pair-holders.reader.ts` **MỚI** | D-8 | ≤ 90 |
| `apps/api/src/payroll/payroll-disbursement.mapper.ts` **MỚI** | DTO tạm ứng · đợt · dòng · ngân sách (last4 dẫn xuất, `when(canSeeMoney)`) | ≤ 160 |
| `apps/api/src/payroll/payroll.mapper.ts` | §4.10 | +6 |
| `apps/api/src/payroll/payroll-noti.payload.ts` | 4 payload | +60 |
| `apps/api/src/notifications/payroll-noti-bridge.registrar.ts` | 4 `registerSource` | +60 |
| `apps/api/src/payroll/payroll-templates.service.ts` + `.repository.ts` | §4.7 (`periodsUsingTx` · export `orgUnitLiveTx`) | +30 |
| `apps/api/src/payroll/payroll.module.ts` | additive: 5 controller + 9 provider | +25 |
| `apps/api/package.json` | `test:cov:payroll` +3 file | +1 |
| `apps/api/test/foundation/payroll-two-layer-guard-census.unit-spec.ts` · `payroll-error-code-census.unit-spec.ts` · `route-http-coverage.e2e-spec.ts` | neo §2 | |
| `apps/api/test/integration/s15-payroll-be4-advances.int-spec.ts` · `s15-payroll-be4-batches.int-spec.ts` · `s15-payroll-be4-budgets-import.int-spec.ts` **MỚI** | §6.2 | |
| `apps/api/test/helpers/payroll-v2-fixtures.ts` | `publishedPeriodWithPayslips(direct, companyId, users, net[])` (INSERT thẳng kỳ `Published` đủ vết + phiếu) · `bankSettings(direct, companyId, userId, acct)` | +60 |
| `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` | regen `ROUTE_CENSUS_WRITE=1` | |
| `apps/app/src/routes/payroll/constants.ts` · `payroll-wiring.spec.ts` · `payroll-errors.ts` · `apps/app/src/i18n/locales/vi/payroll.ts` | +19 pair · 58→77 · +16 kind · nhãn vi | |
| `docs/SPEC/SPEC-11 PAYROLL.md` · `docs/API Design/API-18…` · `docs/DB/DB-13…` | §3.1 · §3.3 · §3.8 · kind mới · §5.2 trạng thái 059–077 | |
| `harness/backlog.mjs` | BE-4 `in_progress` → paths thêm `apps/app/src/routes/payroll/**` · `apps/app/src/i18n/**` · `docs/SPEC/**` · `docs/DB/**` · `docs/_review/**` · `apps/api/package.json`; done_when FE-3/BE-5/QA-1 nhận nợ (§9) | |

## 6. RED-first

### 6.1 Unit (không DB)
1. `payroll.errors.spec.ts` (additive): bảng tag → mã/kind (§4.9) · 4 tag không map ⇒ `null` · `payee-already-in-batch` cho CẢ HAI tên uq · `batch-code-exists` · `budget-exists` · message không chứa `params` giả.
2. `payroll-payment-export.service.spec.ts`: 7 cột đúng thứ tự · `xlsxSafe` (`=SUM(1)` ⇒ `'=SUM(1)`) · cash ⇒ cột TK rỗng · tên tệp không PII.
3. `payroll-adjustments-import.service.spec.ts` (parser thuần, matrix giả): header lệch ⇒ `import-invalid`; nhãn Việt → enum; `Kỳ` ≠ kỳ ⇒ lỗi dòng; trùng mã trong tệp; > 5.000 ⇒ `import-too-large`; message lỗi dòng không chứa số tiền (`"1234567"` vắng).
4. `payroll-disbursement.mapper.spec.ts`: `bankAccountLast4` từ snapshot (NULL ⇒ null · `"123"` ⇒ `"123"`), `legacyPaidTrail` 4 ca (bằng/khác/NULL).

### 6.2 Integration (`LANE_DB=mediaos_be4`, gate `hasDb && LANE_DB`)

**`s15-payroll-be4-advances.int-spec.ts`**
- ALLOW/DENY song sinh từng route 059–065 (officer đủ cặp · employee chỉ `view-own` · role thiếu cặp ⇒ 403; ALLOW `=== 200/201`).
- 060: 201 · `created_by = actor` (DB) · outbox 024 tới ĐÚNG tập holders(`approve:payroll-advance`) − actor · payload 0 khoá tiền · tháng có kỳ `Calculated` ⇒ 409 026 · tháng không có kỳ ⇒ 201 · `userId` tenant khác ⇒ 404.
- 062: sửa `Pending` ⇒ 200; sau duyệt ⇒ 409 025 `advance-not-pending`; hàng `Deducted` (gieo thẳng + `DISABLE TRIGGER` trong tx cho kỳ đã tính) ⇒ 025 `advance-already-deducted` **kiểm trước**; `delete:true`.
- 063/064: người TẠO tự duyệt ⇒ 409 025 `self-approval` · **người THỤ HƯỞNG có cặp approve tự duyệt ⇒ 409 025 (B2)** · duyệt ⇒ 025/026 outbox tới `[user, created_by] − actor` · reject thiếu note ⇒ 400 · duyệt lần hai ⇒ 025 · kỳ `Reviewing` ⇒ 409 026 · kỳ `Calculated` ⇒ 200 **+ `warnings` chứa `recalculate-required` (B3)**; kỳ `CollectingData` ⇒ `warnings` KHÔNG chứa.
- 065: `amount` CÓ MẶT (C13 — route Own chở tiền của chính mình).
- Race: hai duyệt song song (hai officer khác người tạo) ⇒ đúng 1 × 200, 1 × 409 025 (T3 `status-terminal`); INSERT thẳng `Approved` `decided_by = created_by` ⇒ 23514 `payroll_advances_four_eyes_check` ⇒ qua API tương đương 409 025.
- 065: nhân viên thấy ĐÚNG của mình, không thấy của người khác (IDOR), rỗng khi chưa có, 0 audit; nhân viên gọi 061 ⇒ 403.
- Cross-tenant: token B đọc tạm ứng A ⇒ 404.
- Audit: 059/061 +1 hàng/lượt, payload không tiền.

**`s15-payroll-be4-batches.int-spec.ts`** (fixture: kỳ `Published` INSERT thẳng + 10 phiếu `net` khác nhau + settings TK cho 8 người)
- 067: kỳ `Approved` ⇒ 409 027 `period-not-published` · `bank` tự nạp ⇒ 8 dòng + `warnings ['no-bank-account:2']` · snapshot = số TK lúc lập (đổi settings sau ⇒ dòng giữ số cũ) · `userIds` tường minh có người thiếu TK ⇒ 409 `payee-no-bank-account` · `cash` ⇒ 10 dòng, snapshot NULL · trùng `code` ⇒ 409 `batch-code-exists` · body có `bankAccountNumber` ⇒ 400 (strict).
- 068/070: `totalNet` = Σ net · 070 **vắng khoá** `bankAccountNumber`, có `bankAccountLast4` · audit +1.
- 069: add/remove/markPaid · thêm người đã ở đợt khác ⇒ 409 027 `payee-already-in-batch` (`payslip_uq`, tên đúng) · đợt `Completed` ⇒ 027 `batch-already-completed` · **markPaid rồi remove ⇒ 409 027 `line-already-paid`, dòng còn sống, `payslip_uq` KHÔNG nhả (thêm người đó vào đợt khác ⇒ vẫn 409 `payee-already-in-batch`) (B1)** · `status:'Completed'` ⇒ 400 (B4) · audit `added/removed` mang last4.
- 067 (C3): công ty chỉ MỘT người giữ `manage:payment-batch` ⇒ 422 017 `no-eligible-completer`, 0 đợt được tạo.
- 071: 3 ca DENY (thiếu từng cặp ⇒ 403, 0 audit) + ALLOW `=== 200` + tệp chứa số TK ĐẦY ĐỦ + Σ «Số tiền» = Σ net + đúng 1 hàng audit không chứa số TK/tiền · > trần ⇒ 422 016 (trần hạ bằng env test? **không** — gieo qua hằng: dùng `PAYROLL_EXPORT_MAX_ROWS` export và ca chỉ assert nhánh qua unit) .
- 072 LUẬT PHỦ (§4.3): đợt rỗng ⇒ 409 028 · chưa đánh dấu chi ⇒ 409 027 `batch-incomplete` · `confirmAllPaid` ⇒ qua · người lập tự hoàn tất ⇒ 409 `batch-four-eyes` · A(6) ⇒ 200 `Published` `unpaidPayees:4` (ca ÂM: không 409) · B(4) ⇒ 200 `Paid`, `paid_by/at` ghi, `legacyPaidTrail:false`, 1 hàng outbox 027 tới holders(`view:payment-batch`) − actor, 0 hàng 023 · hoàn tất lần hai ⇒ 027 `batch-already-completed` · lập đợt mới sau `Paid` ⇒ 027 `period-not-published`.
- Race 2 đợt cuối song song (`app.listen(0)` + `Promise.all`) ⇒ đúng 1 kỳ `Paid`, 0 lỗi 5xx, 1 hàng 027.
- Trigger race: T1 `frozen` (UPDATE thẳng đợt Completed rồi gọi 069 ⇒ 027) · T2 `insert-into-completed` (gieo đợt Completed rồi 069 add ⇒ 027).
- MEDIUM-2: spy `Logger`; race `payslip_uq` + ca gieo `cross-user` thẳng DB qua đường 069 (bắt 500) ⇒ log không chứa chuỗi TK fixture.
- Kỳ `Locked` di sản (`paid_* := published_*`) ⇒ 003 trả `legacyPaidTrail:true`.
- Cross-tenant 066/068/070/071/072 ⇒ 404.

**`s15-payroll-be4-budgets-import.int-spec.ts`**
- 073: officer scope Department ⇒ 403 (sàn) · thực hiện = Σ gross phiếu kỳ `Published`+`Paid` cùng năm, kỳ `Approved` không tính, theo đơn vị đúng, toàn công ty = tổng · audit +1.
- 074: 201 · trùng (năm, đơn vị) ⇒ 409 029 · trùng (năm, NULL) ⇒ 409 029 (bẫy NULL) · `orgUnitId` tenant khác ⇒ 404 · officer (không có `manage:payroll-budget`) ⇒ 403.
- 075: sửa · xoá mềm ⇒ tạo lại được.
- 076: dryRun mặc định ⇒ 0 hàng · apply ⇒ N hàng `Pending`, `created_by = actor`, `period_month` = kỳ · tệp 1 dòng sai ⇒ 422 030 `import-invalid` + `row:n` + **0 hàng** · mã NV lạ ⇒ `import-unknown-user` · header lệch ⇒ `import-invalid` · kỳ `Approved` ⇒ 409 003 `period-frozen` · CSV cũng qua · role thiếu `manage:bonus-penalty` ⇒ 403 · audit `import` +1 (apply), dryRun 0.
- 077: 200 XLSX, header = 5 nhãn hằng; nạp lại tệp mẫu vào 076 dryRun ⇒ 0 lỗi (khuôn tự-nhất-quán).
- 052: mẫu gắn kỳ sống ⇒ `delete:true` 409 023 `template-in-use` · `isActive:false` ⇒ 409 · kỳ xoá mềm ⇒ 200 · mẫu không gắn ⇒ 200.
- NOTI đường thật (khuôn `payroll-be2-noti-audit`): drain outbox ⇒ hàng `notifications` với `module_code='PAYROLL'`, dedupe key `PAYROLL_ADVANCE_SUBMITTED:<id>:<iso>` / `PAYROLL_PAYMENT_BATCH_COMPLETED:<periodId>`; hoàn tất đợt 2 kỳ khác nhau ⇒ 2 noti; cùng kỳ (giả lập enqueue 2 lần) ⇒ 1.

### 6.3 Census tĩnh
- 2 tầng: `ROUTE_TO_KEY` +19 · `PAYROLL_CONTROLLERS` +5 · `SERVICE_SITE_TO_KEYS` (+ `PayrollPaymentExportService#export: [batchExport, periodExport, payslipList]` · `PayrollAdvancesService#decide: [advanceApprove, advanceReject]`) · neo 58→77, `≥ 59`→`≥ 80`, sensitive 21→29 / 24→32, noFloor + `meAdvanceList`, objectGrant + `meAdvanceList`, **(9) `MONEY_FREE_ROUTES` đẳng thức +11** (C10).
- Mã lỗi 26→32; FE kinds census +18; wiring 58→77; `MIN_COVERED_COUNT` 605→624; route-census artifact regen; `openapi-contract` segment (`payroll`, `payroll-periods`, `me`) — không đổi; **`param-uuid-census` (8 route `:id` mới đều `ParseUUIDPipe`) · `body-validation-census` (6 body + 4 query mới đều `@UsePipes(ZodValidationPipe)` cấp method; 076 dùng `@Query(new ZodValidationPipe(...))` như HR import)** (C10).
- Census khoá catalog: 052 đã là writer; `periodsUsingTx` không thêm caller mới.

### 6.4 Đột biến (mỗi cái chỉ làm đỏ ca của nó, revert sau)
(a) 072 đẩy `Paid` ở đợt đầu ⇒ ca ÂM A(6) đỏ · (b) đảo khoá đợt→kỳ ⇒ ca race 2 đợt (40P01 hoặc treo) · (c) bỏ cổng `batch-empty` ⇒ ca rỗng · (d) map `batch_user_uq` thay `payslip_uq` ⇒ ca «người ở đợt khác» 500 · (e) 071 bỏ `resolveActor('payslipList')` ⇒ census (3) đỏ + ca DENY · (f) snapshot lấy từ body ⇒ strict 400 đỏ/ca «đổi settings sau» đỏ · (g) 065 bỏ lọc `user_id = actor` ⇒ IDOR đỏ · (h) 063 bỏ tiền-kiểm self ⇒ ca «thụ hưởng tự duyệt» đỏ (CHECK DB không soi `user_id`) + ca gieo `created_by NULL` thẳng **dưới `DISABLE TRIGGER payroll_advance_freeze_guard`** (C8) ⇒ CHECK không bắt ⇒ đỏ · (i) import ghi `Approved` ⇒ ca `Pending` đỏ · (j) import ghi một phần ⇒ ca «1 dòng sai ⇒ 0 hàng» đỏ · (k) NOTI-027 dedupe theo batchId ⇒ ca 2 đợt đỏ · (l) `legacyPaidTrail` luôn false ⇒ ca `Locked` di sản đỏ · (m) bỏ `template-in-use` ⇒ ca 052 đỏ · (n) `mappedLineWrite` ném lại `cause` ⇒ ca log đỏ · (o) 069 `removeUserIds` bỏ vế lọc `paid_at` ⇒ ca B1 đỏ · (p) 069 Zod nhận `Completed` ⇒ ca B4 đỏ · (q) 067 bỏ tiền-kiểm C3 ⇒ ca `no-eligible-completer` đỏ.

## 7. Test/pin di sản phải sửa (đo lúc thi công, dán §11)
`payroll-two-layer-guard-census` · `payroll-error-code-census` · `route-http-coverage` · FE `payroll-wiring` + `payroll-error-kind-census` · `s15-payroll-be3-*` (DTO kỳ thêm khoá — ca `toEqual` trên DTO kỳ nếu có) · `openapi-docs.e2e-spec` (tên field DTO có `bankAccountLast4` — đã có tiền lệ 038).

## 8. Cổng & bằng chứng
`pnpm --filter @mediaos/contracts build` → typecheck/lint api + app → unit payroll + 4 census → `LANE_DB=mediaos_be4` 3 int-spec mới + `payroll-be2-noti-audit` + `s15-payroll-be3-*` + `s15-payroll-db2-invariants` → `bash harness/check.sh --lane-db=be4` (KHÔNG banner) → `test:cov:payroll` ≥ 85 % `src/payroll/` → FE census → `ROUTE_CENSUS_WRITE=1` regen → đột biến §6.4 → reviewer tuần tự (security → silent-failure). Dán số đo vào §11.

## 9. Rủi ro

| # | Rủi ro | Xử lý |
| --- | --- | --- |
| R1 | Stacked trên #510: squash-merge ⇒ conflict giả trên file BE-3 | `git merge origin/master` + `--ours` (memory) — KHÔNG `--delete-branch` khi merge #510 còn PR con |
| R2 | 40P01 giữa 072 (kỳ→đợt) và 069 (đợt) / T2 FOR SHARE | thứ tự cố định + ca race; 069 KHÔNG khoá kỳ |
| R3 | T2 chạy 2 lookup/dòng ⇒ 067 kỳ 500 người ≈ 1.000 câu trong trigger | chấp nhận (DB-2 ghi); đo thời gian ca 500 dòng ở QA-1 |
| R4 | `employee_code` NULL/trùng ở hồ sơ xoá mềm | resolve lọc `deleted_at IS NULL` + unique partial `employee_profiles_company_code_active_uq` |
| R5 | Ratchet danh tính chiều 6 | 0 SQL thô chạm `users` — tên qua `namesByUserIdsTx`; `employee_code` cho import đọc từ `employee_profiles` (không phải cột danh tính `users`) |
| R6 | FE census/i18n pin đổi (58/21/24/3) | sửa cùng commit, không hạ neo |
| R7 | Officer thiếu `export:payroll`/`view-payslip:payslip` ⇒ 071 403 với chính vai vận hành | **ĐÃ ĐO (C11)**: `0565:242-243` cấp cả hai cho `payroll-officer`@Company ⇒ officer dùng được 071 |
| R8 | `net` phiếu 0 đồng ⇒ dòng UNC 0 | giữ dòng (người vẫn «được chi 0») — bank có thể từ chối; ghi warning `zero-net:<n>` ở 067 |
| R9 | D-3/D-5 owner lật | hằng tập trung; SPEC ghi «mặc định BE-4, owner lật rẻ» |
| R10 | NOTI 024 rỗng người duyệt | không enqueue + warning; registrar không bao giờ nhận mảng rỗng |

## 10. Chi phí & reviewer
Khuôn BE-3 (~$1,77k): BE-4 không migration ⇒ **~$1,2–1,6k** — code + test ~$600–900 · check + đột biến ~$150 · plan-review ~$64 (đã tốn) · 3 reviewer tuần tự ~$300 (database-reviewer prompt HẸP 4 câu ở header). Chỉ hỏi reviewer thứ không tự đo được (thứ tự khoá 072/069/T2 · rò TK qua log · luật PHỦ dưới race · 3 cặp 071).

## 11. Bằng chứng (15/09/2026 — phiên IMPLEMENT, lane `mediaos_be4`)

| Cổng | Kết quả |
| --- | --- |
| Contracts build · `tsc --noEmit` api/app · eslint (api src+test, app, contracts) · prettier theo danh sách file | XANH |
| Unit (không DB) — `payroll.errors.spec` (+22 ca track C: 11 tag map · 5 tag KHÔNG map ⇒ null · 2 uq `payee-already-in-batch` · code-uq · budget-uq · four-eyes · 3 CHECK ⇒ 400 · 4 FK ⇒ 404 · đối chứng FK nội bộ) · `payroll-disbursement.mapper.spec` (14) · `payroll-payment-export.service.spec` (11) · `payroll-adjustments-import.service.spec` (11) | **87/87** |
| Int — `s15-payroll-be4-advances` **22/22** · `s15-payroll-be4-batches` **19/19** · `s15-payroll-be4-budgets-import` **12/12** · `s13-payroll-qa1-scope-floor` (ROUTES 55→73 · EXEMPT 3→4 · fixture advance/batch/budget) **163/163** | XANH trên `LANE_DB=mediaos_be4` |
| Census — 2 tầng **77/77** (`≥ 80` literal · sensitive 29/32 · noFloor/objectGrant + `meAdvanceList` · `MONEY_FREE_ROUTES` +11 đẳng thức) · mã lỗi **32** + mọi kind có ca (`import-too-large` phải thêm ca int 5.001 dòng CSV mới có literal) · `route-http-coverage` **624** · param-uuid · body-validation · catalog-lock · formula-architecture | XANH |
| FE — `payroll-wiring` (77 · distinct 32 · sensitive 29) · `payroll-error-kind-census` (+18 kind, shape2 vẫn = 3) · fsm-parity · actions · money-mask | **82/82** + `tsc` app XANH |
| Route census artifact | regen `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` (+19 route, 307 dòng) |
| Đột biến §6.4 (8/17 ca đã chạy — mỗi ca khôi phục byte-giống, không còn `.bak`) | (a) luật PHỦ ⇒ ĐỎ 2 ca · (q) C3 ⇒ ĐỎ · (o) B1 `line-already-paid` ⇒ ĐỎ · (n) `mappedLineWrite` ném lại `err` ⇒ ca MEDIUM-2 ĐỎ (log chứa số TK) · (h) bỏ vế thụ hưởng ⇒ ca B2 ĐỎ · (g) bỏ lọc `user_id = actor` ⇒ ca IDOR 065 ĐỎ · (m) bỏ `template-in-use` ⇒ ca 052 ĐỎ · (e) 071 bỏ `payslipList` ⇒ unit ba cặp ĐỎ. **Chưa chạy**: (b) đảo khoá · (c) `batch-empty` · (d) map `batch_user_uq` · (f) snapshot từ body · (i)/(j) import · (k) NOTI-027 dedupe theo batchId (**không đo được**: producer chỉ enqueue MỘT lần/kỳ nên ca «2 đợt» không phân biệt khoá — ghi nợ QA-1) · (l) `legacyPaidTrail` · (p) Zod `Completed` |
| Trigger kích hoạt THẬT ở DB (census tag/tên) | `payroll_payment_batch_freeze:frozen:` · `payroll_payment_line_guard:insert-into-completed:` · `:frozen:` (UPDATE `paid_at` dòng đợt Completed) · `:cross-user:` (qua spy repo, ⇒ 500 sạch) · `payslip_uq` (race 2 đợt cùng thêm 1 người) · `payroll_advances_four_eyes_check` (UPDATE thẳng) · `payroll_payment_batches_company_code_uq` · `payroll_budgets_year_unit_uq` (cả bẫy NULL) · FK `payroll_advances_user_id` (tenant khác) · `payroll_budgets_org_unit_id` (đơn vị tenant khác) |

**Lệch so với plan, có chủ đích:** (1) `mapPayrollTrackCTag` nằm TRONG `payroll.errors.ts` (786 dòng < 800), không tách file — census FE/mã lỗi đọc kind theo literal `payrollDetails("…")` nên tách file phải giữ literal, không đáng. (2) `PayrollAdjustmentImportRepository` (file mới, 3 câu SQL) thay vì SQL trong service — giữ luật «Repository lo DB». (3) Body 063/064 dùng `note` (SPEC-11 §15.1 hàng 064 nguyên văn), không `decisionNote` như thưởng/phạt. (4) 072 trả **200** (`@HttpCode`), các route POST hành động tạm ứng giữ 201 mặc định như thưởng/phạt. (5) Lỗi tệp ở 076 (vắng/quá 5MB/sai loại/parse hỏng) ⇒ **422 030 `import-invalid` {reason}** thay vì 400 như HR — một mã cho FE.

**Phiên (e) dừng theo hook COST CRITICAL ~$140** trước cổng full — phần còn lại chạy ở phiên (f) 15/09, ghi ở §11b.

## 11b. FULL gate + vá sau gate (15/09/2026 — phiên (f), lane `mediaos_be4`)

| Cổng | Kết quả |
| --- | --- |
| `bash harness/check.sh --all --lane-db=be4` (TRƯỚC vá) | **XANH 9/9**: secret-literals · lint · typecheck · migration-no-drop · tooling · test chunked 18/18 chunk trên lane (KI-014 crash hạ tầng chunk 14/16 chạy lại, 0 test đỏ) · build · prod-tenant-check · db-readiness (12/12 index · 0 bảng thiếu FORCE RLS · 0 grant UPDATE/DELETE ledger) |
| `security-reviewer` (Opus, tĩnh) | **PASS** — 0 CRITICAL/HIGH · 3 MEDIUM · 4 LOW. 7 câu (PII số TK · cặp quyền/IDOR · four-eyes · FSM/chi hai lần · import · idempotency/audit · khác) đều OK trừ M1/M2 |
| `silent-failure-hunter` (tĩnh) | **BLOCK → VÁ**: H1 `count(*)…[0]?.n ?? 0` trên `uncoveredPayeesTx` (luật PHỦ) · `lineCountsTx` (027 `batch-incomplete`) · `periodsUsingTx` (052) = fail-OPEN nếu driver trả 0 hàng. 8 mục săn còn lại OK (NOTI trong tx · trigger không map đã bị service chặn · audit trong tx · parser không rơi về 0 · không `void`/`.then` nuốt) |
| `database-reviewer` HẸP (2 câu) | **PASS** — 1a không có cặp khoá ngược (kỳ là tài nguyên đơn giữa 067/072/004; 069 không chạm kỳ; batches không dùng catalog lock) · 1b luật PHỦ chỉ đếm đợt `Completed`, 069 chỉ sửa được `Draft\|Ready` (service + T1/T2) ⇒ bất biến cấu trúc, không fail-open · 1c T3 nhánh F không kích ở 063 (`payroll_period_id` NULL→NULL) · 2: MỌI câu ghi có `company_id` tường minh trên chính bảng bị ghi; 1 LOW `insertLinesTx` thiếu `EXISTS` batch (→ BE-4B) |
| Vá sau gate (cùng nhánh, commit thứ 2) | **M1** ô «Số tài khoản» UNC qua `xlsxSafe` (+1 unit) · **M2** gỡ `@Idempotent()` ở 076 (multipart — interceptor băm `request.body` rỗng trước `FileInterceptor` ⇒ vân tay mù tệp; cùng khuôn HR import) + sửa SPEC-11 §15.1 hàng 076, API-18 §5.2 (11→10 route) · **H1** `payroll-sql.util.ts` (`singleRowOrThrow` · `intOrThrow` · `countOrThrow`) dùng ở 3 call-site + unit helper 8 ca + unit call-site 3 ca (stub `tx.execute` trả `{rows:[]}` ⇒ ném — Postgres không bao giờ tới nhánh này nên int-spec không đo được) · **SFH#2** 067 tự nạp trúng 0 người ⇒ `warnings: ["no-eligible-payees"]` (+1 int-spec: tự nạp lần 2 cùng kỳ ⇒ 201, 0 dòng, `no-eligible-payees` + `no-bank-account:2`) · **SFH#3** `Logger.warn` (tĩnh) khi holders rỗng ở 072 và 063/064 (không tiền/TK) |
| Sau vá: prettier (danh sách file) · eslint · `tsc --noEmit` api | XANH |
| Sau vá: `test:cov:payroll` trên `LANE_DB=mediaos_be4` | **36 file · 904 test XANH** (advances 22 · batches **20** · budgets-import 12) · coverage `src/payroll/**` **94,25 % stmts · 86,01 % branch · 97 % funcs** (≥ 85 %) |

**Nợ để lại có ý thức → `S15-PAYROLL-BE-4B`** (backlog): M3 `users.status` ở `PayrollPairHoldersReader` + `PayrollApproverReader` (kế thừa, không hồi quy) · L4 truthy-guard `if (f.userId)` ở Own 065 · L5 XLSX dựng ma trận trước khi đếm dòng (zip-bomb; đã có cap 5 MB) · L6 rethrow `DrizzleQueryError` thô 3 chỗ ở `payroll-advances.service.ts` (log 5xx chở amount; không rò client) · L7 `.strict()` 4 schema · SFH#4 071 audit commit trước `writeBuffer` (audit thừa nếu sinh tệp ném — chọn «không bao giờ thiếu audit») · DB-LOW `insertLinesTx` thêm `EXISTS` batch. **Không chạy** 9 đột biến còn lại (b c d f i j l p, k không đo được) — cổng đã đủ bằng chứng bằng reviewer + call-site unit.
