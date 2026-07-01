```yaml
wo: S3-FE-ATT-2
zone: yellow
generated_by: auto-loop
reconciled_at: "679582a"
lanes:
  - id: S3-FE-ATT-2-FE
    task: >
      1 LANE DUY NHẤT (apps/app import export MỚI của web-core + router getMeta đọc ROUTE_REGISTRY
      của CORE → coupled, KHÔNG tách 2 worktree song song — theo tiền lệ S3-FE-REGISTRY-1).
      (a) web-core: thêm useCanExact(action,resourceType) khớp CHÍNH XÁC
      caps[`${action}:${resourceType}`]===true, KHÔNG wildcard fallback (fail-closed khớp BE cho
      cặp is_sensitive), export ở index.ts (append).
      (b) apps/app: trích AttendanceStatusBadge (STATUS_VARIANT + t('status.*')) tái dùng;
      MyAttendanceRecordsPage (Own, useCanExact view-own) + TeamAttendanceRecordsPage (Team,
      useCanExact view-team, ẩn/forbidden nếu thiếu) nối listMyRecords/listTeamRecords;
      AttendanceRecordDetailPage nối getRecord(:id) — KHÔNG gate useCan('view-detail')
      (cặp không surfaced) mà để SERVER là cổng (ApiError.status 403→forbidden/404→notfound);
      columns ngày/ca/check-in/check-out/tổng giờ/status/nguồn; filter tháng/khoảng ngày/status;
      loading/empty/error/forbidden; hooks TanStack Query; wire router (my-records/team-records bỏ
      ModulePlaceholder + thêm /attendance/records/$recordId với local meta); append i18n +
      constants; deny-path specs RED-trước.
    builder: frontend-builder
    paths:
      - packages/web-core/src/hooks/use-can.ts
      - packages/web-core/src/hooks/use-can-exact.spec.ts
      - packages/web-core/src/index.ts
      - apps/app/src/routes/attendance/AttendanceStatusBadge.tsx
      - apps/app/src/routes/attendance/MyAttendanceRecordsPage.tsx
      - apps/app/src/routes/attendance/MyAttendanceRecordsPage.spec.tsx
      - apps/app/src/routes/attendance/TeamAttendanceRecordsPage.tsx
      - apps/app/src/routes/attendance/TeamAttendanceRecordsPage.spec.tsx
      - apps/app/src/routes/attendance/AttendanceRecordDetailPage.tsx
      - apps/app/src/routes/attendance/AttendanceRecordDetailPage.spec.tsx
      - apps/app/src/routes/attendance/hooks/useAttendanceRecords.ts
      - apps/app/src/routes/attendance/constants.ts
      - apps/app/src/i18n/locales/vi/attendance.ts
      - apps/app/src/router.tsx
acceptanceChecks:
  - "router.tsx: /attendance/my-records→MyAttendanceRecordsPage, /attendance/team-records→TeamAttendanceRecordsPage KHÔNG còn ModulePlaceholder; có route /attendance/records/$recordId→AttendanceRecordDetailPage (local meta requiredAny VIEW_OWN/TEAM/COMPANY)."
  - "3 trang nối API THẬT: My→attendanceApi.listMyRecords, Team→listTeamRecords, Detail→getRecord — KHÔNG mock data cứng."
  - "Columns đủ 7: ngày(workDate)/ca(shiftId hoặc nhãn — null-safe '—')/check-in(checkInAt)/check-out(checkOutAt)/tổng giờ(workingMinutes→h:m)/status(AttendanceStatusBadge từ attendanceStatus)/nguồn(checkInMethod ở list, attendanceSource ở detail)."
  - "Filter tháng→fromDate/toDate half-open + khoảng ngày tuỳ chọn + status(attendanceStatus); đổi filter → refetch với query params mới + reset page về 1."
  - "AttendanceStatusBadge render Present/Late/Early Leave/Missing Hours|Check-in|Check-out/Leave với variant + nhãn t('status.*'); dùng CHUNG ở My/Team/Detail (+ AttendanceStatusCard không đổi hành vi)."
  - "Gate cặp NHẠY CẢM bằng useCanExact (KHÔNG wildcard): user chỉ có '*:*' → useCanExact('view-team','attendance')=false ⇒ Team forbidden + KHÔNG gọi listTeamRecords (khớp BE is_sensitive → 403; tránh FE-permit/BE-403)."
  - "AttendanceRecordDetailPage KHÔNG gọi useCan('view-detail','attendance') làm cổng (cặp không có trong SENSITIVE_CAPABILITY_ALLOWLIST → luôn false); dựa SERVER: ApiError.status 403→forbidden, 404→notFound."
  - "Menu Team/Company ẩn/403 theo permission (sidebar+route đã exact qua createPermissionChecker — không regress registry-guard.spec.tsx / registry.spec.ts); Team page thêm forbidden state page-level."
  - "Mỗi trang xử lý đủ loading/empty/error/forbidden."
  - "KHÔNG hard-code role/permission chuỗi rời; dùng ATT_ENGINE_PAIRS + PERMISSION_CODE_TO_PAIR (view-team:attendance/view-company:attendance) — KHÔNG tự chế 'ATT.RECORD.VIEW_TEAM'."
  - "pnpm --filter @mediaos/web test (list+detail+useCanExact) xanh; pnpm --filter @mediaos/web typecheck xanh; masking do server (client không nhận locationJson khi thiếu quyền)."
testTasks:
  - "RED crown deny (web-core) use-can-exact.spec.ts: caps={'view-team:attendance':true}→useCanExact('view-team','attendance')=true; caps={'*:*':true} (KHÔNG có exact) → useCanExact('view-team','attendance')=FALSE trong khi useCan(...)=true (chứng minh fail-closed khác biệt)."
  - "RED deny-path (TeamAttendanceRecordsPage.spec.tsx, nhân pattern registry-guard.spec.tsx): employee (useCanExact view-team=false) → render forbidden EmptyState VÀ attendanceApi.listTeamRecords KHÔNG được gọi (assert not.toHaveBeenCalled); manager (view-team=true) → DataTable render items."
  - "MyAttendanceRecordsPage.spec.tsx: loading skeleton · error state+retry · empty state · forbidden (useCanExact view-own=false → không gọi listMyRecords) · columns render (ngày/ca/check-in/out/tổng giờ/status/nguồn) · StatusBadge · đổi filter (month/status) → queryFn nhận params mới."
  - "AttendanceRecordDetailPage.spec.tsx: loading · success render field (ngày/ca/check-in/out/tổng giờ/status/nguồn) · ApiError(status 403)→forbidden state · ApiError(status 404)→notFound state · locationJson=null render null-safe (mask server). KHÔNG mock useCan('view-detail') làm cổng."
  - "Regression: chạy lại apps/app/src/test/registry-guard.spec.tsx + packages/web-core/src/lib/registry.spec.ts — sidebar/route deny-path ATT (employee ẩn Team/Company; manager thấy Team ẩn Company; hr thấy Company) VẪN xanh (không sửa các assert đã đúng)."
  - "Integration DB cô lập: N/A cho WO này (thuần FE). Scope/masking/deny server-side đã phủ ở apps/api S3-ATT-BE-2 int-specs (attendance-be2.int.spec.ts) — KHÔNG lặp; chỉ đảm bảo FE không tự suy quyền nhạy cảm."
steps:
  - "web-core (TRƯỚC — prereq được apps/app tiêu thụ): thêm useCanExact(action,resourceType) = useAuthStore((s)=>s.capabilities[`${action}:${resourceType}`] ?? false) — CHÍNH XÁC, KHÔNG wildcard; export append ở packages/web-core/src/index.ts. RED spec use-can-exact.spec.ts: exact→true; chỉ có '*:*' trong caps→false cho cặp sensitive (đối lập useCan wildcard=true)."
  - "apps/app: trích AttendanceStatusBadge.tsx từ STATUS_VARIANT + t('status.*') của AttendanceStatusCard (DRY); AttendanceStatusCard đổi sang dùng component chung (không đổi hành vi)."
  - "Append i18n vào apps/app/src/i18n/locales/vi/attendance.ts: records.{title,description,columns.{date,shift,checkIn,checkOut,totalHours,status,source,actions},filters.{month,fromDate,toDate,allStatuses},empty,error,forbidden}, team.{...}, detail.{title,forbidden,notFound,error,fields.*}. Append ATT_PATHS.RECORD_DETAIL(id) + hằng filter vào constants.ts (append-only)."
  - "Thêm hooks apps/app/src/routes/attendance/hooks/useAttendanceRecords.ts: useMyAttendanceRecords(params,enabled)/useTeamAttendanceRecords(params,enabled) (attendanceKeys.myRecords/teamRecords) + useAttendanceRecordDetail(id,enabled) (attendanceKeys.records.detail); enabled gate bằng useCanExact."
  - "MyAttendanceRecordsPage.tsx (Own): gate useCanExact('view-own','attendance'); DataTable columns ngày/ca/check-in/check-out/tổng giờ/status(StatusBadge)/nguồn; filter tháng (quick→fromDate=đầu tháng,toDate=đầu tháng kế, half-open) + khoảng ngày + status(attendanceStatus); server-pagination (mẫu MyLeaveRequestsPage); loading/empty/error/forbidden; click row → nav /attendance/records/:id."
  - "TeamAttendanceRecordsPage.tsx (Team): CÙNG shell, gate useCanExact('view-team','attendance') → thiếu ⇒ forbidden EmptyState + KHÔNG gọi listTeamRecords (enabled=false); listTeamRecords."
  - "AttendanceRecordDetailPage.tsx: KHÔNG gate useCan('view-detail') (cặp không surfaced → luôn false); render shell, getRecord(id); map ApiError.status 403→forbidden,404→notFound; render ngày/ca/check-in/out/tổng giờ/status/nguồn(attendanceSource)+locationJson null-safe (mask do server); loading/error."
  - "Wire router.tsx: attMyRecordsRoute→MyAttendanceRecordsPage, attTeamRecordsRoute→TeamAttendanceRecordsPage (bỏ ModulePlaceholder); thêm attRecordDetailRoute path '/attendance/records/$recordId' + local RouteMeta (moduleCode ATT, requiredAnyPermissions [ATT.ATTENDANCE.VIEW_OWN,VIEW_TEAM,VIEW_COMPANY]) qua buildModuleRouteContent; GIỮ attRecordsRoute (company list) = ModulePlaceholder (out-of-scope S3-FE-ATT-5)."
  - "Viết specs (deny-path RED-trước) cho 3 trang + useCanExact; chạy pnpm --filter @mediaos/web test + typecheck (contracts build trước qua turbo) đến xanh; verify spec MỚI thực sự xuất hiện trong run summary (colocated *.spec.tsx)."
```

## Reconcile (gap-analysis / invariants / verify / gate / out-of-scope)

### GAP-ANALYSIS (đối chiếu code 2026-07-01)

BE records endpoints my/team/company/detail đã tồn tại + gated (attendance.controller.ts, VIEW_TEAM/VIEW_COMPANY/VIEW_DETAIL is_sensitive). Web-core API layer + query-keys đã ship (S3-FE-REGISTRY-1 #59 merged): attendanceApi.listMyRecords/listTeamRecords/listRecords/getRecord + attendanceKeys.myRecords/teamRecords/records — KHÔNG cần thêm API client. Contracts đã có: attendanceRecordListQuery/ListResponse/RecordDetail (attendanceRecordListItemSchema = V2 + userId/employeeCode/fullName/orgUnit; detail thêm locationJson SENSITIVE nullable + attendanceSource/workMode/checkInStatus/checkOutStatus). Router đã có 3 route ATT records nhưng trỏ ModulePlaceholder. Việc thực = 3 trang UI + StatusBadge chung + filter + gate fail-closed + wiring + i18n + specs.

### CROWN NUANCE 1 (must-not-miss)

view-detail:attendance is_sensitive=true nhưng KHÔNG nằm trong SENSITIVE_CAPABILITY_ALLOWLIST (permission.service.ts chỉ có view:audit-log + view-own/view-team/view-company:attendance + view:leave). Vì vậy view-detail:attendance KHÔNG BAO GIỜ xuất hiện trong /auth/me capabilities, tức useCan('view-detail','attendance') LUÔN false. TUYỆT ĐỐI KHÔNG gate AttendanceRecordDetailPage bằng cặp này (sẽ forbidden mọi user). Cổng THẬT = SERVER: render trang, gọi getRecord(id), map ApiError.status 403→forbidden, 404→notFound (out-of-scope không lộ tồn tại). Route detail dùng local meta requiredAny [VIEW_OWN,VIEW_TEAM,VIEW_COMPANY] (mọi attendance viewer điều hướng được; server enforce per-record + view-detail).

### CROWN NUANCE 2 (fail-closed khớp BE)

view-own/view-team/view-company:attendance là is_sensitive, chỉ surfaced qua getAllowlistedSensitiveCapabilities theo cặp LITERAL (wildcard `*:*` bị lọc, KHÔNG kế thừa). Nhưng useCan (use-can.ts) CÓ wildcard fallback (`*:*`): user có non-sensitive `*:*` trong base caps → useCan('view-team','attendance')=true (FE-permit) trong khi BE can() cho cặp sensitive YÊU CẦU exact non-wildcard ALLOW → 403. Gate page-level cho cặp sensitive PHẢI dùng useCanExact (khớp CHÍNH XÁC, không wildcard). Sidebar/route đã exact sẵn qua createPermissionChecker (buildPermissionCheckerFromStore → resolveKey chỉ exact/PERMISSION_CODE_TO_PAIR, KHÔNG wildcard) nên menu/route đã fail-closed; chỉ page component cần useCanExact.

### INVARIANTS (CLAUDE.md §2/§5)

- Masking là việc SERVER: locationJson=null khi thiếu view-sensitive:attendance, client chỉ render field nhận được.
- company_id do server resolve, client KHÔNG gửi.
- KHÔNG hard-code role/permission (dùng ATT_ENGINE_PAIRS + PERMISSION_CODE_TO_PAIR view-team/view-company:attendance, KHÔNG tự chế mã 'ATT.RECORD.VIEW_TEAM').
- Hot-file APPEND-only: attendance.ts i18n append records/detail keys, constants.ts append path/filter, index.ts append export useCanExact, router.tsx additive (thêm route detail, đổi 2 dòng placeholder→page).
- requiredScopes chỉ defense-in-depth (scopes từ /auth/me lọc bỏ cặp sensitive → có thể rỗng, KHÔNG dùng làm cổng-cứng runtime — pair-as-gate mới là cổng).

### DATA GAP (nhẹ)

attendanceRecordListItemSchema có shiftId (uuid nullable) NHƯNG KHÔNG có tên ca → column 'ca' render shiftId rút gọn/'—' null-safe (hoặc nhãn nếu sau này BE thêm). 'nguồn' = checkInMethod ở list (web/mobile/manual/adjustment), attendanceSource ở detail. 'tổng giờ' = workingMinutes (có thể null khi chưa check-out) → format h/m an toàn.

### OUT-OF-SCOPE (chống scope-creep)

1. Company records LIST page /attendance/records = S3-FE-ATT-5 (giữ ModulePlaceholder, route gate VIEW_COMPANY đã đúng).
2. adjustment/remote-work/reports = S3-FE-ATT-3/4/6.
3. KHÔNG sửa AttendanceTodayPage (đã done; wildcard-gate lý thuyết của nó là nợ tiền lệ, không thuộc WO — chỉ chuyển sang AttendanceStatusBadge chung nếu trích component, giữ nguyên hành vi).
4. KHÔNG sửa permission.service.ts / seed / migration.

### VERIFY

pnpm --filter @mediaos/web test (vitest jsdom) + typecheck; specs PHẢI colocated *.spec.tsx cạnh trang (apps/app chạy src/**/*.spec.tsx) — verify spec mới xuất hiện trong run summary (tránh xanh-giả). Deny-path RED viết & chạy đỏ TRƯỚC khi implement (permission/pair-as-gate).

### GATE

zone=yellow, FE-only (KHÔNG chạm permission/RLS/secret/audit/auth/migration diff) => LIGHT gate (react-reviewer + typescript-reviewer + quality-gate). ĐỀ NGHỊ security-reviewer soi RIÊNG useCanExact (fail-closed cho cặp sensitive) + AttendanceRecordDetailPage (server-là-cổng, không tự suy view-detail) vì đây là logic phân quyền hiển thị nhạy cảm. Coupling web-core↔apps/app => 1 LANE tuần tự cùng cây (KHÔNG 2 worktree — tiền lệ S3-FE-REGISTRY-1). Spec (docs/spec/SPEC-04 §9 trạng thái, FRONTEND-09) là nguồn sự thật; khi lệch code cũ → spec thắng.
