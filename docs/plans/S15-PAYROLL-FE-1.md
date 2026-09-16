# S15-PAYROLL-FE-1 — micro-plan (vùng 🟡 · LIGHT gate · Sonnet/main-loop)

> **WO:** FE track A — PAY-SCREEN-007 «Nhân viên» (danh sách + chi tiết 5 tab) · PAY-SCREEN-008 «Bảng công kỳ»
> · form hồ sơ lương v2 (GROSS/NET · đối tượng TNCN · lương BH · thử việc · tỉ lệ hưởng · phụ cấp/khấu trừ
> có định mức chọn từ catalog) trên vỏ UI chung (DEC-020).
> **Nguồn sự thật:** `docs/SPEC/SPEC-11 PAYROLL.md` §3.12 · §9.1 · §11.3 · §14 · §18.1 · UI-07 §10.4/§13.7/§21.8
> v1.1a · API-18 §5b track A · contracts `payroll-employees.ts` + `payroll.ts` §2 + `payroll-catalog.ts` §1.
> **Tiên quyết đã merge:** BE-1 #503 (036–043) · UI-SHELL-1 #504 (`DataToolbar`/`ColumnPicker`/`TableFooter`/
> `StatusPill`/`DetailPageHeader` + `PAYROLL_SIDEBAR_V2` + `pruneUnbuiltScreens`) · BE-2 #506 (044 catalog).
>
> **Số đo lúc viết plan (16/09/2026):** `PAYROLL_ENGINE_PAIRS` = 77 khoá (FE ↔ BE khớp, wiring spec xanh) ·
> contracts track A ĐỦ (`payrollEmployee*`, `payrollDependent*`, `payrollTimesheet*`, `salaryComponentDto`) ⇒
> **WO này KHÔNG thêm DTO** (`payroll.ts` đang 865 dòng > trần, không đụng) · web-core `payrollApi` CHƯA có
> hàm nào cho 036–044 · `orgApi.getTree()` (`/org/units/tree`) MỞ cho mọi user tenant (`TENANT_READ`, không
> PermissionGuard — `org.controller.ts:45`) · `idempotencyKeyFor(scope, payload)` băm payload (khoá KHÔNG mang PII).

---

## 1. Phạm vi ĐÓNG + phản-phạm-vi

**LÀM:**

| #   | Hạng mục                                                                                                                                           | Vị trí                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | web-core: client 036–044 (+ keys), route registry `payroll.employees`, 3 titleKey nav                                                              | `packages/web-core/src/lib/payroll-employees-api.ts` (mới, spread vào `payrollApi`) · `query-keys.ts` · `registry.ts` · `i18n/locales/vi/nav.ts`                        |
| 2   | PAY-SCREEN-007 list: toolbar chuẩn (q · UnitSelector · có/chưa hồ sơ lương) + DataTable ghim cột định danh + ⚙ + footer                            | `routes/payroll/PayrollEmployeeListPage.tsx`                                                                                                                            |
| 3   | PAY-SCREEN-007 detail 5 tab, gác **từng tab** bằng `useCanExact` — thiếu cặp ⇒ **ẩn tab**                                                          | `PayrollEmployeeDetailPage.tsx` + `components/employee/*`                                                                                                               |
| 4   | Form hồ sơ lương **v2** (dùng CHUNG cho PAY-SCREEN-004 và tab «Lịch sử lương») + bảng `items[]` chọn từ catalog 044 (`valueType = 'profile_item'`) | `components/SalaryProfileFormDialog.tsx` (viết lại) · `components/SalaryProfileItemsEditor.tsx` · `salary-profile-form.ts` (thuần) · `use-salary-components-catalog.ts` |
| 5   | PAY-SCREEN-008 = **TAB** «Bảng công» của chi tiết kỳ, có route riêng `/payroll/periods/$periodId/timesheet` (deep-link, gate = cặp đường tải 043)  | `components/PeriodTimesheetTab.tsx` · `PayrollPeriodDetailPage.tsx` (thêm dải tab) · `router.tsx`                                                                       |
| 6   | `UnitSelector` (UI-07 §10.4 mục 11) — lần đầu dựng, đặt trong module PAYROLL                                                                       | `components/UnitSelector.tsx`                                                                                                                                           |
| 7   | i18n `payroll` namespace mở rộng · wiring spec cập nhật · test màn hình                                                                            | `i18n/locales/vi/payroll.ts` · `payroll-wiring.spec.ts` · specs mới                                                                                                     |

**⛔ KHÔNG LÀM:** không DTO mới (contracts đủ) · không migration/BE · không màn track B/C (009–014, FE-2/FE-3) ·
không «Tổng quan»/«Báo cáo» (FE-4) · không sửa `packages/ui` (ngoài `paths`; `UnitSelector` ở lại app tới khi có
consumer thứ hai) · không dọn nợ `apps/app/src/hooks/use-local-pref.ts` sinh đôi (ngoài `paths`) · không sửa
`sidebar-registry.ts` (mục «Nhân viên» đã khai, tự hiện khi route có).

---

## 2. Quyết định thiết kế (ghi để reviewer đọc, không phải hỏi lại)

| #   | Quyết định                                                                                                                                                                                                                  | Vì sao                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Gate tab = `useCanExact` từng cặp**, KHÔNG `<PermissionGate>`                                                                                                                                                             | 17 cặp v2 đều sensitive; wildcard `*:*` không kế thừa cặp sensitive ở BE ⇒ `useCan` là hiện tab cho vai server chắc chắn 403 (memory `sensitive-pair-widget-needs-usecanexact`). Tab «Thuế TNCN» đòi **CẢ HAI** `view:salary-profile` + `view:payroll-employee` (SPEC-11 §9.1). |
| D2  | **Cột `taxCode` ở list 007 theo đúng khuôn mask cột tiền**: vắng khoá trên mọi hàng HOẶC trang rỗng ⇒ vắng khỏi ⚙ (fail-closed)                                                                                             | `taxCode` là PII chiếu có điều kiện (§18.1 A hàng 2) — liệt kê nhãn cho vai không đọc được là biến picker thành chỉ mục PII (UI-07 §10.4 mục 10; khuôn `payroll-money-column-mask.spec.tsx`).                                                                                   |
| D3  | **Số TK chỉ hiện `•••• {last4}`**; ô nhập số TK ở form 039 là **write-only**: để trống ⇒ KHÔNG gửi khoá (giữ nguyên số cũ)                                                                                                  | DTO 038 không có `bankAccountNumber` (contracts luật 1); 039 là upsert MERGE nên «trống = giữ nguyên» đúng ngữ nghĩa server. Muốn xoá TK ⇒ ô «Xoá tài khoản ngân hàng» gửi 4 khoá `null` cùng lúc (mirror CHECK cặp).                                                           |
| D4  | **Khoá idempotency 039/041 = `idempotencyKeyFor(scope, {userId, ...body})`** (băm), KHÔNG `payrollIdempotencyKey(join)`                                                                                                     | payload chở số TK / tên NPT — join chuỗi là ghi PII vào bảng idempotency và header. Hash64 giữ đúng luật «suy từ nội dung» mà không lộ nội dung. 020 giữ `payrollIdempotencyKey("create-salary-profile", userId, effectiveDate)` (neo UNIQUE, không PII).                       |
| D5  | **Bảng công (008) là TAB của chi tiết kỳ + route riêng** `/payroll/periods/$periodId/timesheet`, gate `access:payroll` + `view-line:payroll-period`                                                                         | UI-07 §21.8 v1.1a (không lên sidebar) + done_when «link sang chi tiết kỳ» (cần deep-link). Tab «Bảng công» chỉ hiện khi `useCanExact(view-line)` — cùng cặp với 043.                                                                                                            |
| D6  | **Trạng thái khoá kỳ công** trên tab 008 lấy qua picker 035 (`manage:payroll-period`, không nhạy cảm) đối chiếu `period.attendancePeriodId`; thiếu cặp/không tìm thấy ⇒ pill «không rõ», KHÔNG lỗi                          | DTO kỳ chỉ có `attendancePeriodId`; 043 không chở trạng thái; thêm trường là việc BE (ngoài `paths`). Đường 035 là đường DUY NHẤT `payroll-officer` đọc được kỳ công.                                                                                                           |
| D7  | **`items[]` chỉ chọn từ catalog 044 lọc `valueType === 'profile_item'` && `isActive`** (client-side, `per_page` = 100); thiếu `view:salary-component` ⇒ bảng phụ cấp hiện «không mở được danh mục» và **không** gửi `items` | Server 422 018/019 với mã ngoài catalog; lọc valueType không có ở query 044. Không có ô gõ tay (memory `ui-promises-backend-never-reads`, nợ BE-1).                                                                                                                             |
| D8  | **`insuranceSalary`/`probationSalary` để trống ⇒ `null`** (nghĩa «dùng lương cơ bản» / «không có»), `payRatioPct` mặc định `100`, `salaryType` mặc định `GROSS`, `pitPayer` mặc định `EMPLOYEE`                             | mirror DB-13 §12.1 default; gửi `0` là số thật, khác `null`. Builder thuần `buildSalaryProfilePayload` có spec.                                                                                                                                                                 |
| D9  | **Lịch sử lương = timeline gập được theo `effectiveDate`**, mỗi phiên bản tải chi tiết 021 **khi mở** (không prefetch)                                                                                                      | UX note 6 UI-07 §21.8: mỗi lượt xem lương là một hàng audit — prefetch hàng loạt là xả audit giả.                                                                                                                                                                               |
| D10 | **`UnitSelector` sống ở `routes/payroll/components`**, API `orgApi.getTree()`, không gate FE thêm                                                                                                                           | BE mở cho mọi user tenant; vai vào được màn 007 đã ở scope Company (§11.3). Đưa lên `packages/ui` khi có consumer thứ hai (YAGNI + `packages/ui` ngoài `paths`).                                                                                                                |
| D11 | **Route detail 007 gate = `access:payroll` + `view:payroll-employee`** (cặp đường tải 037), detail dùng RouteMeta cục bộ như 002/003                                                                                        | `read-path-gate-pair-must-match-download-pair`.                                                                                                                                                                                                                                 |

---

## 3. Bản đồ file (mới / sửa) — mỗi file < 400 dòng

**web-core** (`packages/web-core/src/`): `lib/payroll-employees-api.ts` (MỚI) · `lib/payroll-api.ts` (spread) ·
`lib/query-keys.ts` (`payrollKeys.employees.*`, `periods.timesheet`, `catalog.components`) · `lib/registry.ts`
(+`payroll.employees`) · `i18n/locales/vi/nav.ts` (+3 titleKey).

**app** (`apps/app/src/routes/payroll/`):

| File                                                                                                                                                                    | Vai trò                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----- |
| `PayrollEmployeeListPage.tsx`                                                                                                                                           | 007 list                                              |
| `PayrollEmployeeDetailPage.tsx`                                                                                                                                         | 007 detail — header + dải tab gác từng cặp            |
| `components/employee/EmployeeGeneralTab.tsx`                                                                                                                            | tab 1 (037)                                           |
| `components/employee/EmployeeSalaryHistoryTab.tsx` + `SalaryProfileVersionCard.tsx`                                                                                     | tab 2 (019 + 021 lazy) + nút «+ Phiên bản»            |
| `components/employee/EmployeeInsuranceTab.tsx`                                                                                                                          | tab 3 (038 đọc + 039 form)                            |
| `components/employee/EmployeeTaxTab.tsx`                                                                                                                                | tab 4 (`taxCode` từ 037 + NPT đang hiệu lực từ 040)   |
| `components/employee/EmployeeDependentsTab.tsx` + `DependentFormDialog.tsx`                                                                                             | tab 5 (040 + 041/042 kể cả xoá mềm)                   |
| `components/employee/employee-forms.ts` (+spec)                                                                                                                         | builder thuần payload 039/041/042 + validate ngày NPT |
| `components/UnitSelector.tsx`                                                                                                                                           | bộ lọc đơn vị (D10)                                   |
| `components/PeriodTimesheetTab.tsx`                                                                                                                                     | 008                                                   |
| `components/SalaryProfileFormDialog.tsx` (viết lại) · `components/SalaryProfileItemsEditor.tsx` · `salary-profile-form.ts` (+spec) · `use-salary-components-catalog.ts` | form v2                                               |
| `constants.ts`                                                                                                                                                          | +badge variant trạng thái NV, hằng tab                |
| `PayrollPeriodDetailPage.tsx`                                                                                                                                           | +prop `tab` + dải tab «Bảng lương / Bảng công»        |
| `SalaryProfileListPage.tsx`                                                                                                                                             | dùng form v2 (cột mới: loại lương)                    |
| `../../router.tsx`                                                                                                                                                      | +3 route · `../../i18n/locales/vi/payroll.ts`         | +khoá |

---

## 4. Ma trận test (deny-path cạnh allow-path — chống xanh-rỗng)

| Spec                                        | Ca                                                                                                                                                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payroll-wiring.spec.ts` (sửa)              | route `payroll.employees` tồn tại, gate `access:payroll`+`view:payroll-employee`, screenCode 007; sidebar lá 3→**4**; timesheet vẫn KHÔNG ở sidebar                                                                          |
| `payroll-employee-tabs.spec.tsx` (mới)      | ALLOW đủ cặp ⇒ 5 tab; DENY chỉ `view:payroll-employee` ⇒ ẩn «Lịch sử lương» + «Thuế TNCN», còn 3; DENY `useCan=true`/`useCanExact=false` ⇒ không tab nào (đảo hook là đỏ); tab BH hiện `•••• 1234`, KHÔNG có chuỗi số TK dài |
| `payroll-employee-list-mask.spec.tsx` (mới) | ALLOW hàng có `taxCode` ⇒ nhãn «Mã số thuế» trong ⚙; DENY vắng khoá ⇒ vắng; DENY trang rỗng ⇒ vắng (fail-closed)                                                                                                             |
| `salary-profile-form.spec.ts` (mới)         | builder: trống ⇒ `null` BH/thử việc; `payRatioPct` số; `items` chỉ khi có catalog; thiếu quyền catalog ⇒ không khoá `items`; validate `baseSalary > 0`, `payRatioPct ∈ (0,100]`                                              |
| `employee-forms.spec.ts` (mới)              | 039: số TK trống ⇒ KHÔNG có khoá `bankAccountNumber`; «xoá TK» ⇒ 4 khoá null; 041: `effectiveTo < effectiveFrom` ⇒ lỗi client; 042 delete payload `{delete:true}`                                                            |
| `PeriodTimesheetTab.spec.tsx` (mới)         | không cặp `view-line` ⇒ không gọi 043; có ⇒ bảng có cột ngày `tabular-nums`; pill khoá kỳ công: `locked`/`open`/không rõ                                                                                                     |

---

## 5. Cổng phải XANH trước khi mở PR

`pnpm --filter @mediaos/web-core typecheck` · `pnpm --filter @mediaos/app typecheck` · `pnpm --filter @mediaos/app
test` (kể cả wiring + 5 spec mới) · `pnpm lint` (workspace) · `bash harness/check.sh --quick` · build app · LIGHT
gate: `typescript-reviewer` + `react-reviewer` (domain FE) + `quality-gate`.

## 6. Nợ / giả định (KHÔNG giấu)

- **G1** Nhãn `employeeStatus` (`active|inactive|resigned|terminated`, `emp_status_check`) chép sang namespace
  `payroll` — giá trị lạ ⇒ hiện nguyên chuỗi (không bịa).
- **G2** UnitSelector không đệ quy cây con khi lọc (036 khớp CHÍNH XÁC `orgUnitId`, plan BE-1 §9.3).
- **G3** Chưa có màn sửa/xoá phiên bản hồ sơ lương (022) ngoài đường tạo — cùng phạm vi v1; FE-2/FE-4 mở nếu cần.
- **N1** `PayrollPeriodDetailPage.tsx` sau WO ~460 dòng (< 800) — tách `PeriodLinesSection` là WO dọn sau.

## 7. Bằng chứng (điền khi đóng WO)

**Đo 16/09/2026 (phiên i) — mọi cổng §5 XANH:**

| Cổng                                                                            | Kết quả                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/app` vitest (toàn suite)                                                  | **281 file / 2773 test PASS** (payroll: 12 file / 132 test, gồm 6 spec mới: `payroll-employee-tabs` 7 · `payroll-employee-list-mask` 3 · `PeriodTimesheetTab` 6 · `payroll-period-tabs` 2 · `salary-profile-form` 13 · `employee-forms` 17; `payroll-wiring` 21→22) |
| `packages/web-core` vitest                                                      | 45 file / 742 test PASS                                                                                                                                                                                                                                             |
| typecheck `app` · `api` · `web-core` (turbo, contracts+web-core dist build lại) | 0 error — `api` chạy vì contracts đổi (`warnings` bỏ `.default([])`)                                                                                                                                                                                                |
| eslint (thư mục đổi) · prettier (file đổi)                                      | 0 lỗi                                                                                                                                                                                                                                                               |
| `pnpm --filter @mediaos/app build` (vite)                                       | ✅                                                                                                                                                                                                                                                                  |
| `bash harness/check.sh --quick`                                                 | XANH ✅ (secret-literals · lint · typecheck · migration-no-drop · tooling-tests)                                                                                                                                                                                    |
| LIGHT gate — `typescript-reviewer`                                              | **PASS** · 0 CRITICAL/HIGH · 2 MEDIUM (`isTruncated` thông điệp · `probationSalary` null≠undefined) · 2 LOW — **đã vá cả 4**                                                                                                                                        |
| LIGHT gate — `code-reviewer` (React/UX/SPEC)                                    | **REQUEST_CHANGES → đã vá**: 1 HIGH (tab «Bảng công» vẫn kéo 008 `lines` — route audit lượt đọc ⇒ `enabled: canViewLines && tab === "lines"`, ghim bằng `payroll-period-tabs.spec.tsx`) · 2 LOW (bọc `TabsContent` · 3 khoá i18n thừa)                              |

**Lệch có chủ đích so với plan:** `salaryHistory.noPermission`/`insurance.noPermission` không tồn tại (gate đặt ở page cha — tab thiếu cặp thì ẩn, không có thông điệp riêng). Không đụng `packages/ui`, không DTO mới (ngoài bỏ `.default([])` ở envelope ghi track A — cùng luật với `payrollWriteResultSchema` v1).

**PR:** #513 (`feat/s15-payroll-fe-1` → master, commit `6e671ed0`; KHÔNG auto-merge — owner chốt sau CI).
