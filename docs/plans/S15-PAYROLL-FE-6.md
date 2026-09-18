# S15-PAYROLL-FE-6 — thao tác trên DÒNG của đợt chi trả (PAY-SCREEN-013 · PAYROLL-API-069)

> Nợ của `S15-PAYROLL-FE-3`, lộ ra ở `S15-PAYROLL-QA-1` T5: client `payrollApi.updatePaymentBatch`
> (069) đã có ở `packages/web-core`, **`apps/app` không gọi ở đâu** ⇒ đợt chi trả lập xong là bảng
> dòng chỉ-đọc: không đánh dấu đã chi / gỡ dòng / thêm người được. QA-1 không dựng được ca T5 vì
> không có UI nào để đo (`payroll-qa1-disbursement-gates.spec.tsx` §T5 ghi rõ).
>
> Zone 🟡 · LIGHT gate (`typescript-reviewer` + `react-reviewer` + `quality-gate`) · Sonnet.
> Rollback = revert 1 commit; **không** migration, **không** đổi contract.
>
> **Vòng 1 plan-review (17/09/2026): REVISE** — bảng §1 bản đầu sai 3 luật BE (đã vá bên dưới, mỗi
> hàng kèm file:line làm bằng chứng) + 5 lỗ thi công. Bản này là bản sau vá.

## 0. Base branch & phạm vi

- **Base = `master` SAU khi PR #520 (QA-1) merge.** Mục 3.5 sửa `payroll-qa1-disbursement-gates.spec.tsx`
  — file đó chỉ tồn tại trên nhánh QA-1 chưa merge. Không cắt nhánh FE-6 từ `test/s15-payroll-qa-1`
  (squash-merge phá PR xếp tầng — memory `squash-merge-breaks-stacked-prs`).
- Sửa trong: `apps/app/src/routes/payroll/**` · `apps/app/src/i18n/**` (+ plan này + `harness/backlog.mjs`).
  **KHÔNG** chạm BE/contracts/migration — 069 đã đủ.

---

## 1. Luật BE đã ĐO trên code (bản vá sau review)

| Vế | Luật thật (bằng chứng) | Hệ quả cho UI |
| --- | --- | --- |
| Cổng | `batchUpdate = manage:payment-batch` (sensitive) — `payroll-route-pairs.const.ts:153` | Dùng `PAYROLL_ENGINE_PAIRS.batchUpdate` (không mượn khoá `batchComplete` dù giá trị trùng — để census wiring đọc đúng khoá route 069) |
| Trạng thái đợt | `assertNotCompleted` — `payroll-payment-batches.service.ts:225,475-483` ⇒ `Completed` ⇒ 409 **027** kind `batch-already-completed` | Đợt `Completed` = chỉ đọc, không render nút nào. Dùng lại `canEditPaymentBatch` (`payroll-actions.ts:325-330`, đang **chưa ai gọi**) |
| `removeUserIds` | user không có dòng sống ⇒ **404** (`:254`); có dòng đã `paid_at` ⇒ 409 **027** `line-already-paid` và **KHÔNG gỡ dòng nào** (all-or-nothing, `:256-263`) | Chỉ cho chọn dòng CHƯA chi; chữ lỗi phải nói «cả lượt bị từ chối» |
| `markPaidUserIds` | user không có dòng sống ⇒ 404 (`:287`); **SQL có `and l.paid_at is null`** — `payroll-payment-batches.repository.ts:383-390` ⇒ đánh dấu lại dòng đã chi là **no-op IM LẶNG**, `paid_at` cũ giữ nguyên | Envelope `{id, warnings}` KHÔNG có số dòng đổi ⇒ FE không phân biệt «đổi N» với «đổi 0». Bắt buộc `refreshAll()` rồi để bảng tự nói; thông điệp không được khẳng định số lượng |
| `addUserIds` | ứng viên = phiếu của kỳ; id không phải ứng viên ⇒ **404** (`:505`). ⚠️ Đường tường minh **KHÔNG lọc `hasLine`** (`:502` `picked = candidates`; lọc chỉ ở nhánh `userIds === null`, `:516`) ⇒ người đã có dòng ở đợt khác đi tới `insertLinesTx` và vỡ `payroll_payment_lines_payslip_uq` ⇒ 409 **027** kind `payee-already-in-batch` (`payroll.errors.ts:576-580`) | Picker KHÔNG biết được ai đã ở đợt khác (cờ `hasLine` là nội bộ BE) ⇒ phải để BE nói, chữ lỗi `payee-already-in-batch` (đã có: `i18n/locales/vi/payroll.ts:644`) |
| Đợt `bank` thiếu TK | `candidates.some(c => !c.hasBank)` ⇒ 409 **027** kind `payee-no-bank-account`, **ALL-OR-NOTHING cả lượt** (`:507-513`). ⚠️ 026 là `ADVANCE_PERIOD_FROZEN`, **không** liên quan màn này (`payroll.errors.ts:111,117`) | FE không có dữ liệu TK (ở `payroll_employee_settings`, route 038/039 — không nằm trong `payslipSchema`) ⇒ không lọc trước được; chữ lỗi nói rõ «không ai được thêm» |
| Mảng | cả ba mảng `.min(1).max(PAYMENT_BATCH_LINES_MAX)`, body `.strict()` — `payroll-disbursement.ts:239-249` | Mảng rỗng ⇒ 400 `VALIDATION-ERR-001` **không có `kind`** ⇒ rơi `errors.generic`. Nút PHẢI disabled khi chưa chọn ai |
| Thứ tự trong 1 PATCH | `status/payDate/note` → `remove` → `add` → `markPaid` (`:227-291`) | Mỗi nút gửi ĐÚNG một mảng ⇒ 409 trả về không mơ hồ |
| Không có | **KHÔNG** có đường «bỏ đánh dấu đã chi» ở v2 (D-2, `.strict()`) | Không vẽ nút gỡ dấu; chữ xác nhận nói rõ không hoàn tác được |

## 2. Quyết định thiết kế

- **D1 — gate.** Một hook `useCanExact(PAYROLL_ENGINE_PAIRS.batchUpdate.*)` ở thân component, KHÔNG
  gọi hook trong nhánh điều kiện (bẫy FE-4: `useCanExact(a) && useCanExact(b)` trong nhánh là hook có
  điều kiện, `pnpm lint` không bắt).
- **D2 — chỉ đọc theo FSM.** Thanh thao tác + cột chọn hiện khi `canEditPaymentBatch(batch, canUpdate)`
  **VÀ** `canViewLines` (thiếu `view:payment-batch` thì bảng dòng không tải ⇒ không có gì để chọn;
  `PaymentBatchDetailPage.tsx:271-272`). Nút «Thêm người» KHÔNG cần `canViewLines`.
- **D3 — chọn nhiều dòng.** `DataTable` **không có row-selection** (`packages/ui/.../data-table.tsx`
  không có `rowSelection`/`getRowId`) ⇒ tự thêm cột checkbox đầu bảng.
  - State `selected: Set<string>` theo **`userId`** (069 nhận userId, không phải id dòng).
  - `columns` đang `useMemo(…, [t, people])` ⇒ **phải thêm `selected` + hàm toggle vào deps**, nếu không
    checkbox đứng im (stale closure, lint không bắt).
  - Checkbox của dòng đã `paidAt`: `disabled` (không gỡ được, đánh dấu lại là no-op im lặng).
  - Bỏ `pinFirstColumn` ở bảng dòng: cột đầu giờ là checkbox, ghim nó thì cột «Nhân sự» trôi mất.
  - Reset `selected` khi: đổi trang · đổi đợt · **sau mỗi lượt thành công** (giữ userId vừa gỡ thì lượt
    sau ăn 404). Gỡ hết dòng của trang cuối ⇒ lùi `linePage` về trang có dữ liệu.
- **D4 — nút disabled khi tập rỗng** (cả 3 thao tác) — mảng rỗng là 400 không có `kind` (§1).
- **D5 — «Thêm người» = dialog riêng `PaymentBatchAddPayeesDialog`.**
  - Nguồn: `payrollApi.listPayslips({ payrollPeriodId: batch.payrollPeriodId, page, per_page })`, loại
    user đã có dòng sống trong đợt (theo dữ liệu trang hiện tại — biết tới đâu lọc tới đó, phần còn lại
    để BE nói bằng `payee-already-in-batch`).
  - 🔴 **Audit:** 029 ghi `audit_logs {action:'read', objectType:'payslip', view:'list'}` **mỗi lượt gọi**
    (`payroll-payslips.service.ts:198-204`) ⇒ `enabled: addOpen && canPayslipView`. KHÔNG prefetch,
    KHÔNG `enabled: true` khi dialog đóng. Mỗi lượt MỞ dialog = 1 hàng audit đọc phiếu (`staleTime` 30s
    ở `apps/app/src/main.tsx` che các lượt mở liên tiếp). Ca test: **dialog đóng ⇒ `listPayslips` không
    được gọi**.
  - Thiếu `view-payslip:payslip` ⇒ nút «Thêm người» **ẩn** + câu giải thích (cùng khuôn D5 nút UNC).
  - **Không render `net`** trong picker (DTO có, nhưng đây là màn chọn người, không phải màn tiền).
  - Có **phân trang** (`payslipListQuerySchema` có `page/per_page`) — không có thì kỳ > 20 người là
    picker thiếu người im lặng. Không làm «chọn tất cả theo kỳ» (tránh chạm trần 10.000).
  - Gửi **từng người một lượt PATCH** (`allSettled`, khuôn `EmployeeMultiPickerDialog`): 409
    `payee-no-bank-account`/`payee-already-in-batch` là **all-or-nothing cả lượt**, nên gộp cả nhóm
    vào một mảng thì một người xấu chặn tất cả mà không ai biết là ai. Người lỗi giữ lại trong
    selection kèm lý do; người vào rồi thì invalidate ngay.
- **D6 — chữ lỗi: KHÔNG thêm kind mới.** `payroll-error-kind-census.spec.ts:72-75` assert **đẳng thức**
  `PAYROLL_ERROR_KINDS` ↔ tập kind grep từ `apps/api/src/payroll/**` ⇒ thêm kind FE-only là census ĐỎ.
  Ba kind cần dùng (`batch-already-completed` · `line-already-paid` · `payee-already-in-batch` ·
  `payee-no-bank-account`) **đã có** trong bảng. Ca 404 xử bằng **override tại call-site**
  (`info.kind === null && info.status === 404` ⇒ chuỗi riêng của màn này), **KHÔNG** sửa
  `errors.notFound` (`i18n/locales/vi/payroll.ts:575`) — sửa là đổi chữ 404 của CẢ module PAYROLL.
- **D7 — invalidate + feedback.** `refreshAll()` (`paymentBatches.allOf()`, phủ cả nhánh `lines`) sau
  mọi lượt; **không** invalidate `payslips` (phiếu không đổi, và mỗi lượt đọc là một hàng audit tiền).
  Conflict trạng thái (`isPayrollStateConflict`) ⇒ `refreshAll()` như nhánh «Hoàn tất». `warnings`
  (`zero-net:<n>`) hiện qua `renderWarning` — hàm này đang là closure cục bộ trong
  `PaymentBatchFormDialog.tsx:81-88` ⇒ **trích ra module chung** (`payment-batch-warnings.ts`) cho cả
  hai chỗ dùng, không nhân bản.
- **D8 — xác nhận trước khi gửi** (`ConfirmDialog`): nêu SỐ NGƯỜI, **không** nêu số tiền, không log.
  Chữ xác nhận «Gỡ khỏi đợt» cảnh báo thêm: gỡ hết dòng ⇒ nút «Hoàn tất» biến mất và 072 sẽ ăn 409 028
  `batch-empty` (`payroll-actions.ts:348`).

## 3. Việc phải làm

1. `PaymentBatchDetailPage.tsx` (328 dòng, trần 800): cột checkbox + thanh thao tác + 2 mutation
   (`markPaid`, `remove`) + mở dialog thêm người; dùng `canEditPaymentBatch`. Vượt ~450 dòng thì tách
   `components/PaymentLineActions.tsx`.
2. `components/PaymentBatchAddPayeesDialog.tsx` (mới) — theo D5.
3. `payment-batch-warnings.ts` (mới) — `renderWarning` dùng chung; sửa `PaymentBatchFormDialog` gọi nó.
4. `i18n/locales/vi/payroll*.ts` — nhãn nút, chữ xác nhận, chữ 404 riêng của màn, chữ giải thích quyền.
5. Spec `payroll-fe6-payment-lines.spec.tsx` (mới, jsdom) — đóng nợ T5 (`QA-1 done_when 6`):
   - ALLOW ⇒ 3 nút hiện; bấm → `updatePaymentBatch` ĐÚNG payload, đúng một mảng mỗi lượt.
   - DENY thiếu `manage:payment-batch` ⇒ nút VẮNG **và** `expect(mock).not.toHaveBeenCalled()`.
   - Thiếu `view:payment-batch` ⇒ không có cột chọn/thanh thao tác.
   - Thiếu `view-payslip:payslip` ⇒ nút «Thêm người» vắng; **dialog đóng ⇒ `listPayslips` chưa gọi**.
   - Dòng đã `paidAt` ⇒ checkbox disabled. Đợt `Completed` ⇒ không nút nào. Chưa chọn ai ⇒ nút disabled.
   - 409 `line-already-paid` và 409 `payee-already-in-batch` ⇒ chữ riêng, không nuốt lỗi.
   - `markPaid` no-op (BE trả `warnings: []`, dòng vẫn `paidAt` cũ) ⇒ vẫn `refreshAll`, không khẳng định
     số dòng đã đổi.
6. Sửa docblock §T5 của `payroll-qa1-disbursement-gates.spec.tsx` (đang nói «không có UI») → trỏ spec mới.
7. `harness/backlog.mjs`: đóng WO + **seed nợ có tên**: 069 còn ba vế chưa có UI — sửa `status`
   (Draft→Ready) · `payDate` · `note` ⇒ WO mới `S15-PAYROLL-FE-7`.

## 4. Nghiệm thu

`pnpm --filter @mediaos/app test` chạy theo **shard** (`npx vitest run --shard=i/4`, bẫy
`ERR_IPC_CHANNEL_CLOSED` của FE-4) · `payroll-error-kind-census.spec.ts` xanh (D6 chạm bảng kind) ·
census wiring/cặp quyền xanh · `pnpm typecheck` · `pnpm build` · `pnpm lint` xanh.
Không cần LANE_DB (thuần FE, không int-spec mới).

## 5. Câu hỏi để owner chốt (không chặn code, ghi lại quyết định)

1. 400 của `.strict()`/`min(1)` hiện `errors.generic` — chấp nhận, hay cần chữ riêng theo `code`
   (khuôn `CODE_TO_I18N_KEY` ở `payroll-errors.ts:188-191` mở đường sẵn)? **Mặc định: chấp nhận**, vì
   D4 đã chặn mảng rỗng ở FE nên ca này chỉ xảy ra khi có bug FE.
2. «Thêm người» gửi từng-người (D5) đổi lấy độ chính xác lỗi bằng N lượt PATCH = N hàng audit update.
   **Mặc định: chọn từng-người** — mỗi lượt là một lần ghi thật, audit đúng chứ không dư.
