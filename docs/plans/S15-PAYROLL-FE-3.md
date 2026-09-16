# S15-PAYROLL-FE-3 — micro-plan (vùng 🟡 · LIGHT gate)

> **WO:** FE track C — PAY-SCREEN-012 «Tạm ứng» · 013 «Chi trả» (đợt · dòng · tệp UNC · hoàn tất) ·
> 014 «Ngân sách lương» · dialog import thu nhập/khấu trừ khác (076/077) · PAY-SCREEN-017
> «Tạm ứng của tôi» ở sidebar **ME** · chip trạng thái kỳ 8 giá trị.
> **Nguồn sự thật:** `docs/SPEC/SPEC-11 PAYROLL.md` §9.1 · §12.1 · §13.1 · §14 · §15.1 (059–077) · §18.1 ·
> UI-07 §Template/§Lưu ý UX · contracts `payroll-disbursement.ts` (395 dòng, ĐỦ).
> **Tiên quyết đã merge:** BE-4 #511 (059–077) · BE-4B #512 (nợ gate) · FE-1 #513 (vỏ track A) · UI-SHELL-1 #504.

---

## 0. Đo TRƯỚC khi viết plan (16/09/2026) — WO này là **WIRING**, không phải dựng mới

| Hạng mục | Trạng thái đo được | Hệ quả |
| --- | --- | --- |
| contracts track C | ✅ `payroll-disbursement.ts` 395 dòng, export ở `index.ts:137` | **KHÔNG thêm DTO nào** |
| 19 cặp quyền track C ở FE | ✅ `constants.ts:102-124` (`advance*` · `batch*` · `budget*` · `import*`) | KHÔNG khai cặp mới |
| 18 `kind` lỗi track C | ✅ `payroll-errors.ts:77-95` + `KIND_TO_I18N_KEY` + `STATE_CONFLICT_KINDS` | KHÔNG thêm mã lỗi |
| Chữ lỗi tiếng Việt track C | ✅ `i18n/locales/vi/payroll.ts:597-621` (18 khoá) | KHÔNG thêm `errors.*` |
| 8 trạng thái kỳ + màu chip | ✅ `PAYROLL_PERIOD_STATUSES` 8 giá trị + `..._BADGE_VARIANT` 8 khoá | **done_when «chip 8 giá trị» ĐÃ ĐẠT** |
| FSM cạnh `complete-batch` | ✅ `payroll-actions.ts:61` + `payroll-fsm-parity.spec.ts` pin 11 cạnh | parity spec KHÔNG phải sửa |
| Sidebar 3 mục track C | ✅ `PAYROLL_SIDEBAR_V2` đã khai `payroll.advances` · `payroll.budgets` · `payroll.paymentBatches`; `pruneUnbuiltScreens()` cắt vì thiếu route | **thêm ROUTE_REGISTRY là mục tự hiện** — KHÔNG sửa sidebar PAYROLL |
| web-core client 059–077 | ❌ CHƯA có (`payroll-api.ts` 001–035 · `payroll-employees-api.ts` 036–044) | phải dựng |
| `payrollKeys` nhánh track C | ❌ CHƯA có `advances`/`meAdvances`/`paymentBatches`/`budgets` | phải dựng |
| i18n namespace màn | ❌ chưa có `advances.*`/`paymentBatches.*`/`budgets.*`/`adjustmentImport.*` | phải dựng |

---

## 1. Phạm vi ĐÓNG + phản-phạm-vi

**LÀM:**

| # | Hạng mục | Vị trí |
| --- | --- | --- |
| 1 | web-core: client 059–077 (19 route) + 4 nhánh `payrollKeys` | `packages/web-core/src/lib/payroll-disbursement-api.ts` (MỚI, spread vào `payrollApi`) · `query-keys.ts` |
| 2 | 4 mục `ROUTE_REGISTRY` + 5 route ở `router.tsx` + 1 mục `ME_SIDEBAR` | `registry.ts` · `router.tsx` · `sidebar-registry.ts` |
| 3 | PAY-SCREEN-012 «Tạm ứng»: list + lọc + form tạo/sửa + duyệt/từ chối four-eyes + badge «đã khấu trừ» | `PayrollAdvanceListPage.tsx` · `components/AdvanceFormDialog.tsx` |
| 4 | PAY-SCREEN-013 «Chi trả»: list đợt + chi tiết (dòng · xuất UNC · hoàn tất) | `PaymentBatchListPage.tsx` · `PaymentBatchDetailPage.tsx` · `components/PaymentBatchFormDialog.tsx` |
| 5 | PAY-SCREEN-014 «Ngân sách lương»: bảng năm × đơn vị + kế hoạch/thực hiện/chênh lệch | `PayrollBudgetListPage.tsx` · `components/BudgetFormDialog.tsx` |
| 6 | Dialog import thu nhập/khấu trừ khác (076 dryRun→apply · 077 tệp mẫu) | `components/AdjustmentImportDialog.tsx` |
| 7 | PAY-SCREEN-017 «Tạm ứng của tôi» — module **ME** | `MePayrollAdvancesPage.tsx` (colocated, khuôn `MePayslipsPage`) |
| 8 | constants (2 mảng trạng thái + màu) · 4 helper thuần · 2 badge · i18n 4 namespace · wiring spec | `constants.ts` · `payroll-actions.ts` · `components/StatusBadges.tsx` · `i18n/locales/vi/payroll.ts` · `payroll-wiring.spec.ts` |

**⛔ KHÔNG LÀM:** không DTO/contracts mới · không BE/migration · không mã lỗi hay chữ `errors.*` mới ·
không màn track B (009/010/011 — FE-2) · không «Tổng quan»/«Báo cáo»/Recharts/PDF (FE-4 + BE-5) ·
không sửa `PAYROLL_SIDEBAR_V2` (3 mục đã khai sẵn) · không sửa `payroll-fsm-parity.spec.ts` (đã đủ 11 cạnh) ·
không dọn nợ `PayrollPeriodDetailPage.tsx` 447 dòng (ngoài phạm vi) · không đụng `packages/ui`.

---

## 2. Quyết định thiết kế (ghi để reviewer đọc, không phải hỏi lại)

| # | Quyết định | Vì sao |
| --- | --- | --- |
| D1 | **Four-eyes tạm ứng RỘNG HƠN thưởng/phạt: ẩn nút Duyệt/Từ chối khi actor là người TẠO **HOẶC** người THỤ HƯỞNG** (`createdBy === me ‖ userId === me`) | BE chặn cả hai vế (`payroll-advances.service.ts`, 409 `PAYROLL-ERR-025` `self-approval`); CHECK ở DB chỉ soi `created_by`. SPEC §9.1 chỉ viết «ẩn với người tạo» — **hẹp hơn BE**. Theo BE, nếu không người thụ hưởng tự duyệt khoản của mình vẫn thấy nút rồi ăn 409. `currentUserId === null` ⇒ KHÔNG chặn (fail-open, cùng `isFourEyesBlocked`). |
| D2 | **Own và quản trị là HAI sổ cache tách rời**: `payrollKeys.advances` (059) ≠ `payrollKeys.meAdvances` (065) | Tiền lệ `payslips` vs `mePayslips` — khác cặp quyền, khác tập kết quả; gộp sổ là một lượt `invalidate` của quản trị kéo theo refetch đường Own (và ngược lại) với cặp quyền khác hẳn. |
| D3 | **«Tạm ứng của tôi» gate `access:me` DUY NHẤT**, `moduleCode: "ME"`, `screenCode: "PAY-SCREEN-017"`, KHÔNG có chuỗi `payroll` nào trong gate route | SPEC-11 §9.1 + UI-07 ghi thẳng; `constants.ts:109` đã ghi chú sẵn. Cổng THẬT là `('view-own','payroll-advance')` ở BE. Nhét sau `access:payroll` là đúng lớp lỗi `personal-prefs-must-not-sit-behind-permission-gate`. Wiring spec pin y như khối `me.payslips`. |
| D4 | **Mọi query trên route CÓ audit lượt đọc phải `enabled` theo khối ĐANG hiện**, không chỉ theo quyền | 059 · 061 · 066 · 068 · 070 · 073 ghi `audit_logs` **mỗi lượt đọc** (§18.1 B). Bẫy đã ăn ở FE-1: tab dùng chung query của trang cha ⇒ hàng audit «đã xem tiền» không hề xảy ra. Cụ thể: `linesQuery` (070) của chi tiết đợt chỉ chạy khi khối dòng chi thật sự render. |
| D5 | **Nút tải tệp UNC gác bằng CẢ BA cặp** `manage:payment-batch` + `export:payroll` + `view-payslip:payslip`, đều `useCanExact` | 071 assert ba cặp ở service (SPEC §15.1); `constants.ts:116` đã ghi. Hiện nút khi chỉ có một cặp là mời người dùng ăn 403 — cùng khuôn `canExport` của `PayrollPeriodDetailPage`. |
| D6 | **Không màn nào hiển thị số tài khoản đầy đủ** — chỉ `•••• {bankAccountLast4}`; không có ô nhập số TK ở form lập đợt | §18.1 A: `bankAccountNumber` **không bao giờ** có mặt trong DTO; snapshot sinh Ở SERVER từ `payroll_employee_settings`. Body 067 `.strict()` ⇒ gửi trường TK lên là 400. |
| D7 | **Nút «Hoàn tất» ẩn theo FSM ∩ quyền ∩ four-eyes**: ẩn khi `status === "Completed"` ‖ `lineCount === 0` ‖ `createdBy === me` | SPEC §9.1 «ẩn thay vì hiện rồi 409». Ba vế map đúng ba lỗi BE: `batch-already-completed` (027) · `batch-empty` (028) · `batch-four-eyes`. Kỳ chắc chắn đã `Published` vì đợt chỉ lập được từ kỳ `Published` và `Published` không mở lại được ⇒ **không cần tải thêm kỳ** để suy nút. |
| D8 | **Còn dòng chưa chi �⇒ KHÔNG ẩn nút, mà hộp xác nhận hiện ô «Xác nhận đã chi tất cả»** (`confirmAllPaid`) | 072 nhận `confirmAllPaid: true` để ghi `paid_at` cho mọi dòng trong CÙNG tx (D-2 của BE-4). Ẩn nút ở đây sẽ khoá chết đợt hợp lệ; `batch-incomplete` chỉ phát khi người dùng cố hoàn tất mà KHÔNG tick. |
| D9 | **Query 059 gửi ĐÚNG khoá của `payrollAdvanceListQuerySchema`** (`userId` · `status[]` · `deductPeriodMonth` · `page` · `per_page`) — không sort, không cột lạ | 059 là tiền lệ `.strict()` đầu tiên của repo (BE-4B L7): khoá lạ ⇒ **400**, không bị bỏ im lặng. Muốn thêm sort phải sửa schema ở contracts (ngoài WO này). |
| D10 | **Cột tiền theo khuôn mask fail-CLOSED**: `rows.length === 0 ‖ rows.every(r => r.amount === undefined)` ⇒ cột vắng khỏi ⚙ | Mọi trường tiền `.optional()` (mask = vắng khoá). Trang RỖNG không có hàng để đo ⇒ không được kết luận «được xem» (khuôn `payroll-money-column-mask.spec.tsx`). |
| D11 | **Import là DIALOG hai pha** (dryRun mặc định `true` → apply `dryRun=false`), **KHÔNG gửi `Idempotency-Key`**. 🔁 **ĐÍNH CHÍNH sau khi đo BE (16/09):** 076 trả `PayrollWriteResultDto` `{id,status,affectedLines,warnings}` — **KHÔNG có báo cáo kiểu HR** (`counts.ok/fail` + `errors[]`). Dòng lỗi KHÔNG về ở đường thành công mà **ném 422**: `details[]` mang các phần tử `field:"row:<n>"` (tối đa **50**, hằng `MAX_ROW_ERRORS_IN_DETAILS`) + `field:"errorRows"` = TỔNG số dòng lỗi. FE bóc bằng `parseKindError(err).fields` (`ReadonlyMap<string,string>`). | 076 là multipart và CỐ Ý không `@Idempotent()` (interceptor băm body RỖNG trước `FileInterceptor` ⇒ vân tay hằng ⇒ phát lại tệp cũ, im lặng bỏ tệp mới). Toàn tệp hoặc không dòng nào ⇒ khuôn 3 bước của HR import là **tham chiếu, không phải bản sao**: HR partial-success còn payroll all-or-nothing. |
| D12 | **Ngân sách KHÔNG phân trang**, lọc bằng năm + `UnitSelector`; `variance` đọc từ server | 073 không có `payrollPageQuery` (≤ vài chục hàng/năm); `actualAmount`/`variance` server tính lúc gọi — FE **không tự trừ** (số của người chuyển phòng gom theo đơn vị HIỆN TẠI). |

---

## 3. Bản đồ file (mới / sửa) — mỗi file < 400 dòng

**MỚI**

| File | Ước dòng | Nội dung |
| --- | --- | --- |
| `packages/web-core/src/lib/payroll-disbursement-api.ts` | ~210 | 19 client 059–077; list qua `apiFetchPaginated`, 071/077 qua `apiFetchBlob`, 076 `FormData` |
| `apps/app/src/routes/payroll/PayrollAdvanceListPage.tsx` | ~300 | PAY-SCREEN-012 |
| `apps/app/src/routes/payroll/components/AdvanceFormDialog.tsx` | ~175 | tạo (060) / sửa (062) |
| `apps/app/src/routes/payroll/PaymentBatchListPage.tsx` | ~255 | PAY-SCREEN-013 list |
| `apps/app/src/routes/payroll/PaymentBatchDetailPage.tsx` | ~340 | dòng chi (070) · UNC (071) · hoàn tất (072) |
| `apps/app/src/routes/payroll/components/PaymentBatchFormDialog.tsx` | ~185 | lập đợt (067) từ kỳ `Published` |
| `apps/app/src/routes/payroll/PayrollBudgetListPage.tsx` | ~250 | PAY-SCREEN-014 |
| `apps/app/src/routes/payroll/components/BudgetFormDialog.tsx` | ~150 | 074/075 |
| `apps/app/src/routes/payroll/components/AdjustmentImportDialog.tsx` | ~225 | 076/077 |
| `apps/app/src/routes/payroll/MePayrollAdvancesPage.tsx` | ~175 | PAY-SCREEN-017 |

**SỬA (append, không rewrite)**

`query-keys.ts` (+4 nhánh) · `registry.ts` (+4 mục) · `router.tsx` (+5 route) · `sidebar-registry.ts`
(+1 mục `ME_SIDEBAR`) · `constants.ts` (+2 mảng trạng thái, +2 bảng màu) · `payroll-actions.ts` (+4 helper
thuần) · `components/StatusBadges.tsx` (+2 badge) · `i18n/locales/vi/payroll.ts` (+4 namespace) ·
`payroll-wiring.spec.ts` (bump 4→7 lá, +khối `me.payrollAdvances`).

---

## 4. Ma trận test (deny-path cạnh allow-path — chống xanh-rỗng)

| # | Ca | File |
| --- | --- | --- |
| T1 | `canDecideAdvance`: ALLOW (người thứ ba, `Pending`) · DENY người tạo · **DENY người thụ hưởng** · DENY `Approved` · null user ⇒ không chặn | `payroll-advance-actions.spec.ts` |
| T2 | `canEditAdvance`: ALLOW `Pending` chưa khấu trừ · DENY khi `payrollPeriodId !== null` · DENY `Approved` | `payroll-advance-actions.spec.ts` |
| T3 | `canCompleteBatch`: ALLOW `Ready` có dòng · DENY `Completed` · DENY `lineCount === 0` · DENY người lập đợt | `payroll-advance-actions.spec.ts` |
| T4 | Nút UNC: ALLOW đủ 3 cặp · DENY thiếu `export:payroll` · DENY thiếu `view-payslip:payslip` (ca ALLOW đặt cạnh — chống xanh-rỗng) | `payment-batch-export-gate.spec.tsx` |
| T5 | `linesQuery` (070, CÓ audit) **không gọi** khi khối dòng chi chưa render / thiếu cặp | `payment-batch-lines-gate.spec.tsx` |
| T6 | Cột tiền mask fail-CLOSED ở 3 màn: ALLOW hiện nhãn · DENY vắng nhãn · trang RỖNG vắng nhãn | `payroll-trackc-money-mask.spec.tsx` |
| T7 | `me.payrollAdvances`: gate KHÔNG chứa `payroll`; nằm ở `ME_SIDEBAR`, vắng khỏi `PAYROLL_SIDEBAR` | `payroll-wiring.spec.ts` |
| T8 | Sidebar PAYROLL sau khi thêm route: 7 lá, mọi lá có route thật + cùng gate | `payroll-wiring.spec.ts` |

---

## 5. Cổng phải XANH trước khi mở PR

🔴 **BƯỚC 0 — `pnpm --filter @mediaos/web-core build` TRƯỚC khi chạy bất kỳ spec nào của `apps/app`.**
Đã ăn bẫy này lúc thi công (16/09): `apps/app` import `@mediaos/web-core` từ **dist đã build**, không
phải source. WO này thêm 4 mục `ROUTE_REGISTRY` ở web-core ⇒ trước khi build lại, `payroll-wiring.spec.ts`
đọc registry CŨ và đỏ 6 ca với thông điệp **đánh lạc hướng** (`leaves` = 4 thay vì 7 ·
`me.payrollAdvances` không tồn tại) — trông hệt như «quên thêm entry» trong khi entry đã có. Cùng lớp lỗi
[[web-core-stale-dist-white-page]] · [[stale-contracts-dist-typecheck-false-red`]]. Sau khi build: 58/58 xanh.

`pnpm --filter @mediaos/app test` · `pnpm --filter @mediaos/web-core test` · `pnpm typecheck` (turbo,
`dependsOn ^build` — **không** `tsc` lẻ, bẫy `.default()` trên schema phản hồi) · `pnpm lint` ·
`pnpm --filter @mediaos/app build` · `bash harness/check.sh --quick` · LIGHT gate
(`typescript-reviewer` + `code-review`).

---

## 6. Nợ / giả định (KHÔNG giấu)

- N1 `PayrollPeriodDetailPage.tsx` 447 dòng (nợ FE-1, ngoài `paths`).
- N2 4 file prettier drift có sẵn trên master (nợ FE-1).
- N3 Sửa/xoá đợt chi (069 `addUserIds`/`removeUserIds`) chỉ mở ở mức **đánh dấu đã chi** + gỡ dòng;
  thêm người vào đợt đã lập để sau (không có trong done_when).
- N4 `triggerBlobDownload` vẫn import chéo từ `routes/attendance/download-blob` (4 bản sao có sẵn) —
  không gom ở WO này.

---

## 7. Bằng chứng (đo 16/09/2026)

| Cổng | Kết quả |
| --- | --- |
| `pnpm typecheck` (turbo, 10 task) | ✅ **10/10 successful** — sau khi vá `TS4104` ở `AdjustmentImportDialog` (state `readonly RowError[]` ↔ `data` MUTABLE của `DataTable`; sửa kiểu state, KHÔNG `@ts-ignore`, KHÔNG `[...spread]` mỗi lần vẽ) |
| `pnpm --filter @mediaos/app test` | ✅ **282/282 test file PASS**. ⚠️ Lệnh vẫn **exit 1** vì `Unhandled Rejection: Channel closed` (`ERR_IPC_CHANNEL_CLOSED`) của tinypool **SAU teardown** — đúng [[vitest-unhandled-rejection-after-teardown]], KHÔNG có ca nào đỏ. Đọc số summary, đừng đọc exit code |
| `pnpm --filter @mediaos/web-core test` | ✅ **742/742** |
| `payroll-wiring.spec.ts` + `payroll-actions.spec.ts` | ✅ **58/58** (wiring 26 · actions 32) |
| `payroll-advance-actions.spec.ts` (MỚI) | ✅ **19/19** — gồm ca DENY **người thụ hưởng** (vế four-eyes mà SPEC bỏ sót) |
| `pnpm --filter @mediaos/app build` (vite) | ✅ `built in 4.66s` |
| `pnpm lint` | ✅ không lỗi; chỉ warning `no-unused-vars` CÓ SẴN ở `@mediaos/api` (ngoài `paths` của WO) |

**Quy mô:** 9 file màn/dialog MỚI + `payroll-disbursement-api.ts` + 8 hot-file wiring (append, không rewrite).

**Ba chỗ tài liệu SAI, đã sửa theo code BE (đo, không suy):**

1. **Four-eyes tạm ứng** — SPEC-11 §9.1 viết «ẩn với chính người tạo», nhưng BE chặn **CẢ người thụ hưởng**
   (`payroll-advances.service.ts:311` `before.createdBy === user.id || before.userId === user.id`). CHECK
   `payroll_advances_four_eyes_check` ở DB **chỉ soi `created_by`** ⇒ **không suy luật từ CHECK**. Thiếu vế này
   thì người được cấp tạm ứng vẫn thấy nút «Duyệt» trên khoản của mình rồi ăn 409.
2. **076 import** trả `PayrollWriteResultDto`, **KHÔNG** có báo cáo kiểu HR (`counts.ok/fail` + `errors[]`) —
   dòng lỗi về qua **422** `details[]` (`row:<n>` tối đa 50 + `errorRows`), bóc bằng `parseKindError(...).fields`.
3. **073 ngân sách** trả **MẢNG TRẦN**, không phải envelope phân trang ⇒ `apiFetch`, không `apiFetchPaginated`.
