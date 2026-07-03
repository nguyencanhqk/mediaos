# S3-QA-1 — Micro-plan (gap analysis + việc cần làm)

wo: S3-QA-1
zone: red
paths cho phép: `apps/api/src/attendance/**/*.spec.ts`, `apps/api/test/**`, `apps/app/**` (test-only, KHÔNG sửa production code)
worktree: `C:\dev 2\mediaos-s3-qa-1` (branch `auto/S3-QA-1`, base `e565b47` = master hiện tại)
lane DB: `mediaos_s3qa1`

## Kết luận trước khi lập việc

Code ATT đã rất chín — phần lớn 3 done_when đã có test thật (Postgres+RLS+HTTP) từ các WO trước (BE-1/BE-2/BE-6, attendance-permission, att-core-tenant-deny, att-permissions-seed, attendance-leave-sync). Gap thật sự hẹp hơn nhiều so với tiêu đề WO gợi ý — KHÔNG viết lại test đã có, chỉ lấp khoảng trống.

## Gap analysis theo done_when

### #1 today + check-in/out
- THIẾU: "đã check-in nhưng chưa check-out" (canCheckOut=true) — không có assertion nào trong specs hiện tại.
- THIẾU: race 0-dup THẬT (2 request đồng thời chạm unique-constraint backstop `mapCheckInError`/`isUniqueViolation`) — hiện chỉ có double-click tuần tự (sequential), chưa có `Promise.all` thật cho check-in.
- THIẾU (nhỏ): resigned qua real-DB round-trip (hiện chỉ có unit mock).
- Còn lại (no-shift, full-day-leave, success, sequential 0-dup, no-employee mock, server-time): ĐÃ CÓ đầy đủ.

### #2 records scope + pagination/filter + leave-block integration
- THIẾU: filter `fromDate`/`toDate`/`status`/`attendanceStatus`/`shiftId`/`departmentId` trên 3 route đọc (`/my-records`, `/team-records`, `/records`) — repo (`buildWhere`) đã hỗ trợ nhưng chưa có test nào gọi qua các query-param này trên 3 route đó.
- Scope Own/Team/Company + forbidden cross-scope, mask GPS/IP/device, pagination clamp/sort: ĐÃ CÓ đầy đủ (`attendance-be2.int.spec.ts`).
- check-in chặn khi full-day leave approved (tích hợp thật S3-INT-1, approve thật → sync thật → 409): ĐÃ CÓ ĐẦY ĐỦ, KHÔNG viết lại (`attendance-leave-sync.int.spec.ts:316-357`).

### #3 permission Employee/Manager/HR/Admin + cross-team/cross-company + regression + coverage
- THIẾU HOÀN TOÀN: test dùng role **canonical thật** (`employee`/`manager`/`hr`/`company-admin`) chạm guard/service/HTTP của ATT — toàn bộ test hiện có dùng role **custom/bespoke** (đủ nghiệp vụ nhưng không chứng minh ma trận grant thật của 4 role canonical hoạt động đúng qua code path thật). `att-permissions-seed.int.spec.ts` chỉ verify hàng DB `role_permissions`, không chạy qua guard/service.
- Đặc biệt: **chưa từng có test nào dùng role `company-admin` thật** chạm bất kỳ route ATT nào.
- **[PLAN-FIX sau plan-reviewer] Premise 2FA SAI — xác nhận lại:** `vitest.config.ts` set `TWO_FACTOR_ENFORCEMENT_ENABLED=false` trong test env ⇒ `TwoFactorEnforcementGuard` luôn cho qua, và company-admin canonical MỚI SEED (chưa enroll) thì `/auth/login` KHÔNG phát challenge 2FA (challenge chỉ phát khi user đã enroll). Tức là **login HTTP thật cho cả 4 role canonical đều khả thi trong lane test** — không có rào cản 2FA nào. Vì vậy: **ƯU TIÊN login HTTP thật** (giống pattern be1/be2/leave-sync) cho case cần chứng minh quyền qua controller-guard (đặc biệt check-in/out — xem điểm dưới), thay vì bypass DI. Chỉ dùng pattern `ctxFor` (ExecutionContext trực tiếp, như G11-1) khi cần test riêng lẻ 1 guard method mà không cần dựng cả app HTTP.
- **[PLAN-FIX] DI trực tiếp (`app.get(Service)`) KHÔNG chứng minh được permission cho `checkIn`/`checkOut`** — `AttendanceService.checkIn` không tự gọi `permission.can()`, gate NẰM Ở CONTROLLER (`@RequirePermission('check-in', ...)`). Nếu test gọi thẳng service qua DI để né "2FA", nó sẽ bỏ qua đúng cái guard cần chứng minh → test vô nghĩa cho mục permission. **Group B (DI) CHỈ hợp lệ cho route ĐỌC** (`listTeamRecords`/`listCompanyRecords`/`getRecordDetail` — các hàm này tự gọi `resolveAndAssert`/scope-check nội bộ nên DI vẫn hợp lệ). Bất kỳ assertion nào về quyền check-in/out của role canonical PHẢI đi qua HTTP thật (`/auth/login` thật, vì 2FA off) hoặc `ctxFor` (guard trực tiếp), KHÔNG đi qua DI gọi thẳng service.
- **[PLAN-FIX] TRÁNH TRÙNG:** `attendance-permission.int-spec.ts` (G11-1) ĐÃ dùng role canonical `employee` (…008) qua guard thật: allow `checkIn`, deny `approve`/`lockPeriod`/`listMonthly`. File mới KHÔNG lặp lại 2 assertion này — chỉ thêm phần THIẾU: 3 role còn lại (manager/hr/company-admin canonical) + các route ĐỌC (view-team/view-company/view-detail) + scope-filter cross-team/cross-company.
- regression Auth/HR: chưa verify — cần CHẠY (không phải viết), kỳ vọng xanh vì không đổi production code.
- coverage ATT sensitive ≥80%: chưa có threshold nào cho ATT trong `vitest.config.ts` hiện tại — đo ad-hoc bằng CLI (không sửa config, vì `vitest.config.ts`/`package.json` NẰM NGOÀI `paths` cho phép). **[PLAN-FIX BLOCKING] Lệnh đo PHẢI có `LANE_DB=mediaos_s3qa1` prefix** (xem mục Lệnh verify — thiếu biến này khiến `runDb=false`, MỌI int-spec bị skip, coverage đo ra ~0% giả cho `attendance-read.service.ts`/`attendance-leave-sync.service.ts` — đây là bẫy "LANE_DB false-green" đã biết). Builder PHẢI chạy lệnh coverage thật (có LANE_DB), báo số đo thật cho 4 file, và bổ sung test-only nếu file nào <80% cho tới khi đạt — KHÔNG chỉ "đo ad-hoc rồi bỏ".

## Việc cần làm (file cụ thể)

1. **MỞ RỘNG** `apps/api/src/attendance/attendance-be1.service.spec.ts` — APPEND 1 test: "đã check-in nhưng chưa check-out → canCheckOut:true, canCheckIn:false".
2. **MỞ RỘNG** `apps/api/src/attendance/attendance-be1.int.spec.ts` — APPEND 2 test:
   - Race 0-dup thật: `Promise.all` 2 lệnh `service.checkIn()` thật (1 lần `freezeDate` bên ngoài, KHÔNG lồng 2 lần `vi.useFakeTimers`). **[PLAN-FIX] CHỈ assert invariant, KHÔNG assert đã đi qua nhánh cụ thể nào**: đúng 1 `fulfilled` + 1 `rejected` (`reason instanceof ConflictException`) + `SELECT count(*)=1` từ `attendance_records` cho user đó. TUYỆT ĐỐI không assert message lỗi cụ thể hay "đã chạm unique-constraint" (không deterministic — có thể qua app-guard hoặc DB-backstop tuỳ timing, cả 2 đều hợp lệ).
   - Resigned real-DB: seed employee `status='resigned'` thật (không mock) → `service.checkIn` → `ForbiddenException` thật.
3. **FILE MỚI** `apps/api/src/attendance/attendance-qa1-records-filters.int.spec.ts` — tự seed riêng, test filter `fromDate/toDate/status/attendanceStatus/shiftId` **+ `departmentId`** (PLAN-FIX: thêm case departmentId trên `/records`, `buildWhere` đã hỗ trợ qua join `employee_profiles.org_unit_id`) trên `/records` + `/my-records` + kết hợp pagination + case rỗng.
4. **FILE MỚI** `apps/api/test/integration/att-qa1-canonical-roles-gate.int-spec.ts` — seed 2 company, 4 role canonical thật (employee/manager/hr/company-admin — **tra ID theo `SELECT id FROM roles WHERE name=$1 AND company_id IS NULL`, KHÔNG hard-code UUID**) + org-unit cross-team + cross-company. 2 nhóm test:
   - **(A) Permission qua guard/controller thật** — dùng `ctxFor` (ExecutionContext trực tiếp, nhanh) HOẶC login HTTP thật (khả thi vì 2FA off trong test env) cho case cần qua cả pipeline: manager ALLOW `view-team` DENY `view-company`; hr/company-admin ALLOW `view-team`+`view-company`+`view-detail`. **KHÔNG lặp lại** case employee đã có ở `attendance-permission.int-spec.ts` (allow checkIn/deny approve) — chỉ thêm 3 role còn lại + route đọc.
   - **(B) Scope-filter + mask qua DI trực tiếp** (`app.get(AttendanceReadService)`) — **CHỈ dùng cho route ĐỌC** (`listTeamRecords`/`listCompanyRecords`/`getRecordDetail`, các hàm này tự `resolveAndAssert` nội bộ nên DI hợp lệ). **TUYỆT ĐỐI không dùng DI để test quyền `checkIn`/`checkOut`** (gate nằm ở controller, DI sẽ bỏ qua guard cần chứng minh — vô nghĩa cho mục permission). Cross-team: mgr canonical thấy report+self, KHÔNG thấy otherMgr/otherEmp. Cross-company: hr/company-admin A không bao giờ thấy B. Mask: hr/company-admin canonical → `locationJson` thật; manager canonical → `null`.

## Rủi ro/side-effect cần tránh
- KHÔNG sửa thân test đã có — chỉ APPEND hoặc file mới.
- Mọi file mới gate `describe.skipIf(!(hasDb && LANE_DB))`.
- `afterAll` nên tự `DELETE FROM employee_profiles` trước `cleanupTenants()` như precedent be2/leave-sync (belt-and-suspenders — **[PLAN-FIX]** thực ra `employee_profiles.company_id/user_id` đã `onDelete:cascade` nên `cleanupTenants` xoá users/companies là đã cascade sạch; explicit delete vô hại nhưng KHÔNG phải "chống leak", chỉ là giữ nhất quán style file khác).
- Race test: KHÔNG lồng 2 lần `vi.useFakeTimers()`.
- Role canonical là shared toàn cầu (company_id IS NULL) — chỉ `seedUserRole` gắn user, TUYỆT ĐỐI không sửa `role_permissions` của role canonical (phá lane khác chạy song song).
- Email/slug random-suffix để chạy song song nhiều lane không đụng unique constraint.

## Có cần sửa production code không?
KHÔNG — mọi hành vi yêu cầu đã hiện thực đầy đủ, việc còn lại thuần là viết test lấp khoảng trống. Coverage-gate cứng trong CI (nếu muốn) nằm ngoài `paths` cho phép → escalate riêng nếu cần, KHÔNG tự sửa `vitest.config.ts`/`package.json` trong WO này.

## Lệnh verify
- `LANE_DB=mediaos_s3qa1 pnpm --filter @mediaos/api test` (full regression, đặc biệt Auth/HR suites xanh).
- **[PLAN-FIX BLOCKING]** Đo coverage ad-hoc PHẢI có `LANE_DB` (không sửa file config, chỉ prefix env var):
  `LANE_DB=mediaos_s3qa1 vitest run src/attendance test/integration/att-qa1-canonical-roles-gate.int-spec.ts --coverage --coverage.include='src/attendance/attendance.service.ts' --coverage.include='src/attendance/attendance-read.service.ts' --coverage.include='src/attendance/attendance.logic.ts' --coverage.include='src/attendance/attendance-leave-sync.service.ts' --coverage.reporter=text-summary --no-file-parallelism --coverage.clean=true`
  Thiếu `LANE_DB` → mọi int-spec bị `skipIf(!runDb)` bỏ qua → coverage đo giả-thấp (bẫy đã biết). Builder PHẢI báo số đo THẬT cho cả 4 file, bổ sung test-only nếu <80% cho tới khi đạt.
- FE smoke: `pnpm --filter @mediaos/app test` (không kỳ vọng đỏ, done_when không có mục FE).
