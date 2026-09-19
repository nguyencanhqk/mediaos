# S15-PAYROLL-FE-7 — ba vế còn lại của PAYROLL-API-069 (`status` · `payDate` · `note`)

> Nợ của `S15-PAYROLL-FE-6` (ghi ở plan FE-6 §3.7): FE-6 đã dựng ba thao tác trên **DÒNG**
> (`markPaidUserIds` · `removeUserIds` · `addUserIds`), nhưng ba trường của **BẢN THÂN ĐỢT** —
> `status` (Draft↔Ready) · `payDate` · `note` — vẫn chưa có đường sửa nào ở `apps/app`: đợt lập
> xong là mã/ngày chi/ghi chú đóng cứng, muốn sửa phải xoá đợt và lập lại.
>
> Zone 🟡 · LIGHT gate (`typescript-reviewer` + `react-reviewer` + `quality-gate`) · Sonnet.
> Rollback = revert 1 commit; **không** migration, **không** đổi contract, **không** chạm BE.

## 0. Base branch & phạm vi

- **Base = `master` sau khi #522 (DASH-1) merge** (`324ec824`). FE-6 (#521) đã ở master ⇒ không
  còn rủi ro xung đột file với nó (backlog note của WO này).
- Sửa trong: `apps/app/src/routes/payroll/**` · `apps/app/src/i18n/**` (+ plan này +
  `harness/backlog.mjs`). **KHÔNG** chạm BE/contracts/migration — 069 đã đủ cả ba vế.

---

## 1. Luật BE đã ĐO trên code (mọi hàng có file:line)

| Vế | Luật thật (bằng chứng) | Hệ quả cho UI |
| --- | --- | --- |
| Cổng | `batchUpdate = manage:payment-batch` — dùng lại `canUpdateBatch` đã có sẵn ở `PaymentBatchDetailPage.tsx:80-83` | `useCanExact(PAYROLL_ENGINE_PAIRS.batchUpdate.*)`, KHÔNG mượn khoá `batchComplete` dù giá trị cặp trùng (census wiring đọc theo KHOÁ) |
| FSM | `assertNotCompleted(before)` — `payroll-payment-batches.service.ts:225,475-483` ⇒ `Completed` ⇒ 409 **027** `batch-already-completed`. **KHÔNG có assert chuyển tiếp nào khác**: service chỉ set thẳng cột (`:229-246`) | Đợt `Completed` ⇒ không có mục sửa. `Draft`/`Ready` đổi **hai chiều** tự do (§2 D3) |
| Enum `status` | `paymentBatchEditableStatusEnum = z.enum(["Draft","Ready"])` — RIÊNG, không tái dùng `paymentBatchStatusEnum` (`packages/contracts/src/payroll-disbursement.ts:231`). Gửi `Completed` ⇒ 400 (lách cổng 072 + four-eyes + `completed_by/at`) | Ô chọn trạng thái sinh **từ chính `paymentBatchEditableStatusEnum.options`**, không gõ tay mảng ⇒ `Completed` không thể lọt vào, và bảng đổi thì UI đổi theo |
| `payDate` | `z.string().date().nullable().optional()` (`:242`) — cột `pay_date date` NULL được (`0572_…trackc_ddl.sql:311`), **không** CHECK nào ràng buộc khoảng ngày | `<Input type="date">`; ô rỗng ⇒ gửi `null` (xoá ngày), KHÔNG phải `""` (400) |
| `note` | `z.string().trim().max(500).nullable().optional()` (`:243`) — `.trim()` **không** có `.min(1)` ⇒ `""` là HỢP LỆ và ghi thẳng chuỗi rỗng vào cột | Ô rỗng/toàn khoảng trắng ⇒ gửi `null` (xoá ghi chú) chứ không phải `""`, để DTO trả `null` như lúc chưa từng nhập |
| Ba trường đi CHUNG một lượt | `changedFields = ["status","payDate","note"].filter(k => dto[k] !== undefined)` rồi **MỘT** `repo.updateTx` (`:227-246`) | Ba vế này gộp trong MỘT PATCH là đúng và nguyên tử — **khác** ba mảng dòng (mỗi mảng một lượt, FE-6 §1) |
| Trường không đổi | Lọc theo `!== undefined`, và `audit_logs.after.changedFields` ghi đúng danh sách đó (`:294-302`) | Chỉ gửi trường **thật sự đổi**: gửi kèm trường không đổi là bịa một vết audit «đã sửa» + đụng `updated_at` |
| Body rỗng | `{}` qua được Zod (mọi trường `.optional()`, `.strict()`) ⇒ BE vẫn ghi một hàng audit `update` với `changedFields: []` (`:294`) | Nút Lưu **disabled khi chưa đổi gì** — không để một lượt bấm nhầm sinh vết audit rỗng |
| `Ready` có khoá gì không | **KHÔNG.** 071 (xuất UNC) và 072 (hoàn tất) không đọc `Ready` ở đâu: `canCompletePaymentBatch` chỉ chặn `Completed` + `lineCount === 0` + four-eyes (`payroll-actions.ts:344-350`); BE `complete` cũng chỉ `assertNotCompleted` | Lùi `Ready → Draft` **không** khoá và **không** mất gì ⇒ hai chiều là an toàn |
| 404 | PATCH 404 ở đây = **đợt** không còn (`findTx` rỗng — `:223`), khác hẳn 404 của FE-6 (người không còn dòng sống). ⚠️ `payrollErrorI18nKey` tra `kind → code → generic` và **KHÔNG đọc `status`** (`payroll-errors.ts:243-254`) ⇒ 404 không kind rơi vào `errors.generic` «Có lỗi xảy ra, vui lòng thử lại», KHÔNG phải `errors.notFound` | Override TẠI CHỖ bằng chữ riêng `paymentBatchEdit.batchNotFound` (không thêm `kind` ⇒ census không đụng); đợt đã biến mất thì form hết nghĩa ⇒ xử như 409: đóng hộp + đẩy chữ ra dải thông báo + tải lại |

> **Lệch backlog ↔ SPEC — đã kiểm, KHÔNG phải lệch thật.** `done_when` viết «Draft↔Ready»; SPEC-11
> ghi `Draft → Ready → Completed` (dòng 412) — nhưng đó là **mô tả vòng đời** trong bảng bảng-biểu,
> không phải ma trận chuyển tiếp: SPEC-11 chỉ có FSM tường minh cho **kỳ lương** (§13.1), không có
> cho đợt chi trả. BE không assert chiều nào (bằng chứng hàng «FSM» ở trên) ⇒ làm hai chiều theo
> `done_when`, không cần sửa SPEC.

## 2. Quyết định thiết kế

- **D1 — chỗ đặt:** mục **«Sửa thông tin đợt»** trong menu `⋯` của `DetailPageHeader`
  (`overflowItems`, cùng chỗ với «Xuất tệp chuyển khoản»). Menu tự ẩn khi mảng rỗng
  (`detail-page-header.spec.tsx:39-45`) ⇒ người không có quyền không thấy dấu vết nút.
- **D2 — gate:** `canEditBatch = canEditPaymentBatch(batch, canUpdateBatch)` (đã tính sẵn ở
  `PaymentBatchDetailPage.tsx:142`). **KHÔNG** đòi `canViewLines` (sửa đầu đợt không đọc dòng) và
  **KHÔNG** đòi `payslipList` (không đụng phiếu ⇒ không sinh hàng audit đọc tiền).
- **D3 — ô chọn trạng thái sinh từ enum contract.** `paymentBatchEditableStatusEnum.options` là
  nguồn; nhãn tra `paymentBatchStatus.<value>` (i18n đã có đủ ba nhãn — `payroll-disbursement.ts:17-21`).
  Ca spec neo: **`Completed` KHÔNG xuất hiện trong danh sách chọn**.
- **D4 — chỉ gửi trường ĐỔI (dirty diff).** So với giá trị đang có của `batch`; `payDate`/`note`
  rỗng ⇒ `null`. Nút Lưu `disabled` khi diff rỗng (§1 hàng «Body rỗng»).
- **D5 — hộp thoại tự đóng khi dữ liệu nền đổi?** KHÔNG. Form là bản nháp cục bộ; `refreshAll()`
  chạy sau khi lưu xong. Khoá tái đồng bộ = hộp mở/đóng (`useEffect` theo `open`, khuôn
  `PaymentBatchFormDialog.tsx:38-48`) — không re-sync mù theo query (bài học S15-PAYROLL-FE-2).
- **D6 — không thêm kind lỗi mới.** `payroll-error-kind-census.spec.ts` assert **đẳng thức**
  `PAYROLL_ERROR_KINDS` ↔ tập kind grep từ `apps/api/src/payroll/**` ⇒ kind FE-only là census ĐỎ.
  Kind chính của đường này (`batch-already-completed`) **đã có** (`payroll-errors.ts:169` ·
  `i18n/.../payroll.ts:643`) ⇒ dùng thẳng `payrollErrorText`. Ca 404 xử bằng override tại call-site
  (D6b), KHÔNG thêm kind.
- **D5b — RỦI RO ĐÃ CHẤP NHẬN (LIGHT gate, cả hai reviewer nêu): mất-cập-nhật khi sửa đồng thời.**
  Diff tính lại mỗi lượt render so với prop `batch` sống, nhưng hộp KHÔNG re-sync khi đang mở (D5) ⇒
  nếu người khác đổi `note`/`payDate` lúc hộp đang mở, lượt Lưu sau có thể gửi đè giá trị mà người
  dùng này không hề sửa. BE **không** có kiểm tranh chấp lạc quan cho hai trường đó (chỉ `status →
  Completed` được `assertNotCompleted` gác). Chấp nhận vì: (a) đánh đổi ngược lại là clobber cái
  người dùng đang gõ; (b) cùng khuôn với các hộp anh em đã merge; (c) hai trường này không chở tiền
  và có vết audit `changedFields` truy được. Muốn đóng hẳn thì cần cột phiên bản ở BE — WO riêng.
- **D6b — 404 có chữ riêng.** Xem hàng «404» của §1: để mặc định thì một đợt vừa bị xoá hiện ra câu chung chung mời người dùng «thử lại» mãi.
- **D7 — sau khi lưu:** `refreshAll()` (`paymentBatches.allOf()` — phủ cả detail lẫn list lẫn lines) +
  dải thông báo của trang (`onFeedback`) + đóng hộp. Lỗi tranh chấp trạng thái ⇒ `refreshAll()` như
  nhánh «Hoàn tất» (`isPayrollStateConflict`), và lỗi hiện **trong hộp** để người dùng sửa tiếp.
- **D8 — `warnings`:** envelope `{id, warnings}` dùng chung với các vế khác của 069. Đường này KHÔNG
  sinh warning (BE chỉ gán `warnings` trong nhánh `addUserIds` — `service.ts:266-278`), nhưng vẫn
  render qua `renderPaymentBatchWarnings` nếu có — không nuốt im lặng mảng server trả về.
- **D9 — không log giá trị.** Ghi chú là chữ tự do người dùng nhập; không `console.*`, không đưa vào
  querystring/testid (BẤT BIẾN #3 tinh thần).
- **D10 — trần file.** `PaymentBatchDetailPage.tsx` đang 516 dòng ⇒ form đi ra component riêng
  `components/PaymentBatchEditDialog.tsx`; trang chỉ nhận thêm ~20 dòng (mục menu + render có điều kiện).

## 3. Việc phải làm

1. `components/PaymentBatchEditDialog.tsx` (mới, ~180 dòng) — theo D3–D9.
2. `PaymentBatchDetailPage.tsx` — state `editOpen`, mục `⋯ → Sửa thông tin đợt` (chỉ khi `canEditBatch`),
   render hộp **có điều kiện** (`editOpen && canEditBatch`).
3. `i18n/locales/vi/payroll-disbursement.ts` — khối `paymentBatchEdit` (tiêu đề · 3 nhãn trường ·
   gợi ý · nút · câu thành công) + `paymentBatchDetail.edit` (nhãn mục menu).
4. `payroll-fe7-payment-batch-edit.spec.tsx` (mới, jsdom) — §4.
5. `harness/backlog.mjs` — đóng WO.

## 4. Ca test phải có (mỗi DENY đi kèm ALLOW đối chứng)

| # | Ca | Neo luật |
| --- | --- | --- |
| A1 | ALLOW ⇒ mục «Sửa thông tin đợt» có trong `⋯`; mở ra thấy 3 trường | D1/D2 |
| A2 | Danh sách trạng thái đúng `["Draft","Ready"]` — **`Completed` VẮNG** | §1 enum RIÊNG + `done_when` 2 |
| A3 | Đổi mỗi `status` ⇒ PATCH body **đúng** `{status:"Draft"}` (một khoá) | D4 |
| A4 | Đổi cả ba ⇒ MỘT PATCH mang đủ 3 khoá | §1 «đi chung một lượt» |
| A5 | Xoá ngày chi + xoá ghi chú ⇒ `{payDate:null, note:null}` (KHÔNG `""`) | §1 `note` `""` hợp lệ ⇒ phải tự chuẩn hoá |
| A6 | Ghi chú toàn khoảng trắng ⇒ `null` | như trên |
| A7 | Chưa đổi gì ⇒ nút Lưu `disabled` **và** `updatePaymentBatch` không được gọi | §1 «Body rỗng» |
| D1 | Thiếu `manage:payment-batch` ⇒ mục VẮNG **và** client không được gọi | cổng giả |
| D2 | Đợt `Completed` (có đủ quyền) ⇒ mục VẮNG | FSM |
| E1 | 409 `batch-already-completed` ⇒ chữ RIÊNG, không rơi «Đã có lỗi xảy ra» | D6 |
| E2 | 404 ⇒ chữ RIÊNG `batchNotFound` (KHÔNG rơi `errors.generic`, KHÔNG mượn `lineNotFound` của FE-6); hộp đóng + chữ ra dải thông báo của trang | §1 hàng 404 · D6b |

## 5. Nghiệm thu

`pnpm --filter @mediaos/app test` chạy theo **shard** (`npx vitest run --shard=i/4` — bẫy
`ERR_IPC_CHANNEL_CLOSED` của FE-4) · `payroll-error-kind-census.spec.ts` xanh · census wiring/cặp
quyền xanh · `pnpm typecheck` · `pnpm lint` · `pnpm build` xanh. Không cần `LANE_DB` (thuần FE,
không int-spec mới).
