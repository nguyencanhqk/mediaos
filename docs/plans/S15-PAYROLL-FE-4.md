# S15-PAYROLL-FE-4 — FE track D: Tổng quan · Báo cáo · PDF phiếu lương

> Zone 🟡 · LIGHT gate (`typescript-reviewer` + `react-reviewer` + quality) · nhánh `feat/s15-payroll-fe-4` cắt từ
> `origin/master` (`4fbc5beb`) — **KHÔNG stack** lên PR #518 (BE-5B). Phần PDF (§2 D8) nối SAU khi #518 merge
> (merge `origin/master` vào nhánh, không rebase).
> Nguồn: SPEC-11 §9.1 (PAY-SCREEN-015/016) · §15.1 hàng 078–085 · DECISIONS-14 §3 · contracts
> `payroll-reports.ts` + `payroll-pdf.ts` (#518).

## 0. Đo-trước (17/09/2026) — cái gì ĐÃ CÓ, cái gì THIẾU

| Hạng mục                                                                             | Trạng thái trên master                                                                    |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Contracts 078–082 (`payroll-reports.ts`)                                             | ✅ có (BE-5 #517)                                                                         |
| Contracts 083–085 (`payroll-pdf.ts`)                                                 | ⏳ trên nhánh #518                                                                        |
| Cặp FE `PAYROLL_ENGINE_PAIRS.overview/…/reportExport`                                | ✅ có; `payslipPdf/mePayslipPdf/payslipPdfBatch` đến cùng #518                            |
| Mục sidebar `payroll.overview` (`/payroll`) + `payroll.reports` (`/payroll/reports`) | ✅ khai ở `PAYROLL_SIDEBAR_V2`, đang bị `pruneUnbuiltScreens` cắt ⇒ thêm route là TỰ HIỆN |
| Client web-core 078–085                                                              | ❌ thiếu                                                                                  |
| Màn 015/016, route `/payroll` + `/payroll/reports(/:code)`                           | ❌ thiếu                                                                                  |
| `recharts` trong workspace                                                           | ❌ chưa cài (bản ở `apps/lms` nằm ngoài workspace — không tính)                           |
| 018 `?payrollPeriodId=` (tổng toàn kỳ)                                               | ✅ BE có; `payrollApi.getSummary()` chưa nhận tham số                                     |
| 036 `insuranceIssue`                                                                 | ✅ BE + contracts; màn Nhân viên chưa có bộ lọc/URL param                                 |

## 1. Phạm vi

1. Client web-core `payroll-reports-api.ts` (078–082, sau #518 thêm 083–085) spread vào `payrollApi`; `getSummary(query?)`.
2. PAY-SCREEN-015 Tổng quan `/payroll` — 6 khối biểu đồ + Lời nhắc.
3. PAY-SCREEN-016 Báo cáo — danh mục (080) + màn xem `/payroll/reports/$reportCode` (081) + xuất XLSX (082).
4. Nút PDF: phiếu quản trị (083) · «Phiếu lương của tôi» (084) · PDF hàng loạt ở tab phiếu của kỳ (085).
5. Chi tiết kỳ: hàng tổng = tổng TOÀN KỲ từ 018 (nhận từ BE-5).
6. Màn Nhân viên: bộ lọc `insuranceIssue` đọc từ URL (đích deep-link của Lời nhắc).

Ngoài phạm vi: widget DASH (→ `S15-PAYROLL-DASH-1`), ma trận allow/deny từng route (→ QA-1).

## 2. Quyết định

- **D1 — recharts cài ở `apps/app`, KHÔNG ở `packages/ui`.** `done_when` ghi `packages/ui`, nhưng ADR
  DECISIONS-14 §3.4 (1) + §5 chốt runtime = `apps/app`; ADR thắng. Lợi thêm: `packages/ui` build bằng `tsc`
  thành barrel ESM, đặt recharts ở đó là kéo nó vào mọi consumer của `@mediaos/ui`. `recharts@^3.10.1` (MIT,
  phát hành 25/07/2026 — đủ tuổi) + `react-is@19.2.7` (peer của recharts 3, khớp `react` đang ghim).
- **D2 — wrapper biểu đồ theme-aware ở `apps/app/src/components/charts/`**: màu lấy từ CSS var của design
  system (`var(--…)`), không mã hex rời; tooltip/trục định dạng tiền qua `payroll-format`. Chỉ trang Tổng quan
  import ⇒ recharts nằm trong chunk lazy của trang đó (kiểm bằng `vite build`: chunk `index-*` không chứa
  `recharts`).
- **D3 — `/payroll` là PAY-SCREEN-015, người thiếu cặp thì CHUYỂN HƯỚNG.** `ROUTE_REGISTRY` `payroll.overview`
  gate `access:payroll` + `view:payroll-report` (khớp mục sidebar — cổng test «sidebar = route»). Route
  `/payroll` = vỏ route chỉ đòi `access:payroll` (meta nới cục bộ) + `PayrollRootEntry`: đánh giá meta bằng `evaluateRouteFromStore`; `SHOW_403` ⇒ `navigate`
  (replace) tới lá sidebar PAYROLL ĐẦU TIÊN mà người dùng mở được (hàm thuần `pickFirstAllowedPath`); không lá
  nào ⇒ giữ trang 403 như cũ. Trang Tổng quan (kèm recharts) nạp LAZY bên trong entry — người bị chuyển
  hướng không tải chunk biểu đồ. Thẻ app vẫn `defaultRoute: /payroll/periods` (ca wiring cũ giữ nguyên).
- **D4 — 078 là MỘT lượt gọi cho cả 6 khối.** `done_when` «mỗi khối gác useCanExact(view-line)» viết trước
  BE-5: cổng thật của 078 là `view:payroll-report` (+ sàn Company, server). ⇒ một query, `enabled` =
  `useCanExact(overview)`; mỗi khối có skeleton/empty riêng, lỗi dùng chung một băng «Tải lại». Khối ngân sách
  vắng khoá (thiếu `view:payroll-budget`) ⇒ khối hiện «không có quyền xem ngân sách», không vẽ 0.
- **D5 — Lời nhắc (079) query riêng, cùng cổng.** Link sâu chỉ hiện khi người dùng MỞ ĐƯỢC đích
  (`useCanExact(employeeList)` cho 2 mục nhân viên, `periodList` cho kỳ) — nếu không, hiện số đếm trơn.
  Đích nhân viên: `/payroll/employees?insuranceIssue=not-joined|salary-out-of-range`.
- **D6 — Danh mục báo cáo dựng từ 080, không hard-code 7 mục.** Yêu thích lưu `useLocalPref`
  (`payroll.reports.favorites`), mục yêu thích lên đầu, giữ thứ tự server trong từng nhóm. Nút xuất chỉ khi
  `exportable`.
- **D7 — Màn xem báo cáo**: RouteMeta CỤC BỘ `/payroll/reports/$reportCode` (khuôn chi tiết nhân viên), gate
  như danh mục. Bộ lọc dựng từ `requiredParams ∪ optionalParams` của mục 080: `fromMonth/toMonth` (mặc định 12
  kỳ tới tháng hiện tại) · `orgUnitId` (`UnitSelector`) · `fiscalYear` (mặc định năm hiện tại) ·
  `batchStatus` · `userId` (picker người của PAYROLL, chỉ khi có cặp picker). Thiếu tham số bắt buộc ⇒ KHÔNG
  gọi 081 (081 audit mỗi lượt). Nhãn cột = i18n theo `key` (+ ghi đè theo báo cáo: `totalNet` của
  `payment-summary` = «Tổng tiền»); giá trị enum (trạng thái kỳ/đợt, loại khoản, hình thức chi, loại lương)
  dịch qua khoá i18n SẴN CÓ. Hàng tổng từ `totals` (toàn bộ lọc — server SUM). Mã báo cáo lạ (URL gõ tay) ⇒
  empty «không tìm thấy», không gọi API.
- **D8 — PDF (sau #518).** 083: nút ở `PayslipDetailPage`, hiện khi `useCanExact(payslipPdf) &&
useCanExact(periodExport)` (BE assert CẢ HAI). 084: nút ở chi tiết «Phiếu lương của tôi», không cặp thêm.
  Mở tab trắng ĐỒNG BỘ trong click rồi gán `location` sau `await` (khuôn `CandidateCvTab` — tránh
  popup-blocker); URL không lưu vào state/cache. 085: nút ở tab phiếu của kỳ, gate `payslipPdfBatch` +
  `payslipList`; lấy-hoặc-tạo ⇒ gọi lại mỗi 3 s khi `Pending` (tối đa theo `PAYSLIP_PDF_BATCH_STALE_SEC`),
  `Uploaded` ⇒ link tải, `Failed` ⇒ chữ theo `failure` + «Thử lại» (`retry:true`).
- **D9 — Hàng tổng chi tiết kỳ**: `getSummary({ payrollPeriodId })` (query `enabled` = cùng điều kiện với
  008). Có `lineTotals`/`componentTotals` ⇒ hàng tổng = TOÀN KỲ, nhãn «Tổng»; chưa về/lỗi ⇒ giữ tổng trang +
  nhãn «Tổng trang» như cũ (không bao giờ ghi «Tổng» cho số của một trang).
- **D10 — i18n** track D ở file mới `locales/vi/payroll-reports.ts` spread vào `payroll.ts` (giữ < 800 dòng).
- **D11 — dạng biểu đồ theo VIỆC của dữ liệu (dataviz), hai chỗ lệch chữ `done_when`:** (a) «donut cơ cấu» →
  thanh ngang xếp hạng MỘT màu — 078 trả tới 8 khoản + «Khác» = 9 lớp, vượt trần màu phân loại; (b) «bar+line
  theo đơn vị» → cột ngang thu nhập BQ, thấp/cao nhất/số người ở tooltip + bảng — «cột + đường» cần HAI trục
  (lỗi biểu đồ số 1). «Gauge ngân sách» = meter ngang + mức bằng CHỮ + biểu tượng. Mỗi khối có nút «xem dạng
  bảng» (lối tới giá trị không cần rê chuột). Token `--chart-1/2` (light `#0771a6`/`#eb6834`, dark
  `#1b9ad0`/`#d95926`) qua bộ kiểm bảng màu ở CẢ HAI chế độ; `#1fa9e0` (brand dark) trượt dải sáng nên lùi một bậc.
- **D12 — mở signed-URL**: `open-signed-url.ts` mở tab trắng TRONG click rồi gán URL; **không** truyền cờ
  `noopener` vào `window.open` (theo chuẩn HTML hàm trả `null` ⇒ tab trắng không bao giờ được điều hướng) mà cắt
  `tab.opener = null`. Popup bị chặn ⇒ điều hướng chính tab. ⚠️ `recruit/components/CandidateCvTab.tsx` đang
  dùng đúng mẫu có cờ `noopener` ⇒ nhiều khả năng tải CV hỏng im lặng — NGOÀI phạm vi WO, ghi nợ.

## 3. File dự kiến

- `packages/web-core/src/lib/payroll-reports-api.ts` (mới) · `payroll-api.ts` (spread + `getSummary(query)`) ·
  `query-keys.ts` (`payrollKeys.overview/reports/pdfBatch`) · `registry.ts` (`payroll.overview`, `payroll.reports`)
  · `i18n/locales/vi/nav.ts` (routeTitle)
- `apps/app/package.json` + `pnpm-lock.yaml` (recharts, react-is)
- `apps/app/src/components/charts/*` (wrapper)
- `apps/app/src/routes/payroll/PayrollOverviewPage.tsx` + `components/overview/*` ·
  `PayrollReportListPage.tsx` · `PayrollReportViewPage.tsx` · `report-view.ts` (hàm thuần) ·
  `payroll-root-redirect.ts` · `PayrollRootEntry.tsx` · `overview-data.ts` · `open-signed-url.ts` ·
  `components/PayslipPdfBatchControl.tsx` · `components/reports/ReportFilters.tsx`
- `PayslipDetailPage.tsx` · `MePayslipsPage.tsx` · `components/PeriodPayslipsSection.tsx` ·
  `components/PeriodLinesSection.tsx` · `period-line-columns.ts` · `PayrollEmployeeListPage.tsx`
- `apps/app/src/router.tsx` (3 route) · `i18n/locales/vi/payroll-reports.ts` + `payroll.ts`
- Spec: `payroll-track-d-logic.spec.ts` (hàm thuần) · `payroll-track-d-screens.spec.tsx` (cổng + no-call khi
  thiếu cặp + ALLOW cạnh DENY) · `payroll-track-d-pdf.spec.tsx` · `payroll-wiring.spec.ts` (10 → 12 lá, 2 route
  mới) · `payroll-period-tabs.spec.tsx` (018 theo cùng điều kiện tab với 008)

## 4. Kiểm chứng

`pnpm --filter @mediaos/contracts build && pnpm --filter @mediaos/web-core build` → `pnpm --filter @mediaos/app
typecheck/test/build` (đọc SỐ summary — exit 1 do IPC là nhiễu đã biết) · `pnpm lint` phạm vi đổi · `pnpm audit
--audit-level=high` (dep mới) · kiểm chunk: `recharts` không nằm trong entry chunk · `bash harness/check.sh`.

## 5. Nhật ký

- 17/09 — đo-trước + plan. PR #518 (BE-5B) đang chờ CI; phần D8 đợi merge.
- 17/09 — phần 1 (`554d9bd8`): 015 · 016 · tổng toàn kỳ · lọc BH. Owner uỷ quyền `--admin` ⇒ #518 merge
  `b1fdbb94`; merge master vào nhánh (`bc009793`, xung đột duy nhất `pnpm-lock.yaml` — lấy bản master rồi
  `pnpm install`, diff lock so master giữ nguyên 297 dòng của recharts). Phần 2 (`daf58fa7`): nút PDF 083/084/085.

### 5.1 Bằng chứng

| Kiểm                                                   | Kết quả                                                                                                                                                                                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm audit --audit-level=high` trước/sau cài recharts | 0 high/critical; cùng 10 low/moderate có sẵn (recharts thêm 0)                                                                                                                                                                     |
| Spec PAYROLL (`vitest run src/routes/payroll`)         | 19 file · 262 ca xanh (mới: logic 25 · màn 17 · PDF 11)                                                                                                                                                                            |
| Đột biến (ca DENY không xanh-rỗng)                     | 11/11 bị giết: `enabled` 078 · `enabled` 081 · link sâu thiếu cặp · 080 khi mã lạ · redirect tự trỏ `/payroll` · ngưỡng «vượt» · 083 thiếu export · 085 thiếu export · `retry` khi hỏi lại · cắt opener · đóng tab khi chưa có URL |
| `vite build`                                           | chunk `PayrollOverviewPage-*.js` 431 KB chứa recharts; chunk entry `index-*` KHÔNG chứa `recharts-wrapper`                                                                                                                         |
