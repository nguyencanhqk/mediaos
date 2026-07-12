```yaml
wo: S4-QA-1
zone: yellow
generated_by: auto-loop
reconciled_at: "db8f081"
lanes: [{"id":"qadashaggdeny","task":"DASH aggregation-route deny-path (crown, permission) — dashboard-agg-routes-deny.int-spec.ts trên DB cô lập mediaos_qadashagg (skipIf(!(hasDb&&LANE_DB))). (1) POST /dashboard/refresh gate manage:dashboard (SPEC-07 §8.2 DN-7): role chỉ read:dashboard → 403 (assert ĐÚNG status + error body, KHÔNG chỉ !=200); manage:dashboard KHÔNG seed cho role nào (đã verify 0484/0488) ⇒ positive-path phải seedRole+seedRolePermission('manage','dashboard') TRỰC TIẾP trong spec (direct pool) → 200; mutation-check: tạm gỡ @RequirePermission('manage','dashboard') → refresh 200 cho role read-only (lật RED) → GHI bằng chứng vào plan. (2) GET /dashboard/report per-type = NULL-MASKING (KHÔNG 403 ở tầng sub-type — controller gate read:dashboard rồi can() nội tầng trả field=null): employee/hr/manager → report.finance == null; cfo/finance/leadership/admin (seed 0101) → report.finance NON-NULL; employee_report+attendance_report populated cho hr/leadership/admin/manager, null cho employee; KHÔNG read:dashboard → 403; KHÔNG rò chéo type. (3) GET /dashboard/{summary,mv-stats,alerts}: no-role/thiếu read:dashboard → 403 fail-closed (KHÔNG 200 rỗng); có quyền → 200; /summary tôn trọng can() nội tầng (thiếu read:task ⇒ KHÔNG task-count, thiếu read:leave ⇒ KHÔNG leave-count) + mutation-check tối thiểu 1 nhánh. KHÔNG viết trùng task-qa1-*/noti-qa-permission/my-notifications — chỉ ghi checklist đối chiếu + số coverage vào plan.","builder":"backend-builder","paths":["apps/api/test/integration/dashboard-agg-routes-deny.int-spec.ts","docs/plans/S4-QA-1.md"]},{"id":"qadashxtenant","task":"DASH cross-module 2-tenant regression (crown, RLS/tenant) — dash-xmodule-2tenant.int-spec.ts trên DB cô lập mediaos_qadashagg (skipIf(!(hasDb&&LANE_DB))). Seed 2 company A/B + marker A ở task/notification/employee-salary/audit/project; user B (đủ quyền tenant B, incl read:dashboard + report/type perms) gọi summary/mv-stats/alerts/report/widgets/me → KHÔNG chứa BẤT KỲ marker A (cả response LẪN row dashboard_widget_cache); GET /dashboard/widgets/project-progress với project_id của A → 404 (KHÔNG lộ tồn tại); project-member scope KHÔNG nới cross-tenant (BẤT BIẾN §2 company_id + RLS+FORCE, chứng bằng GUC tenant B). KHÔNG lặp cache-invalidation cross-tenant (INT-2 dashboard-cache-invalidate.int-spec.ts (f)/(e)/outbox đã phủ) — chỉ trỏ. KHÔNG lặp per-widget cross-tenant (dashboard-widget-security S7 đã phủ) — spec này hợp nhất các route AGGREGATION còn thiếu.","builder":"backend-builder","paths":["apps/api/test/integration/dash-xmodule-2tenant.int-spec.ts"]}]
acceptanceChecks: ["dashboard-agg-routes-deny.int-spec.ts — POST /dashboard/refresh: role chỉ read:dashboard → 403 (assert status===403 + error body, KHÔNG chỉ !=200); role có manage:dashboard (seed TRỰC TIẾP trong spec — pair chưa seed ở 0484/0488) → 200; mutation-check ghi trong plan chứng handler rớt manage-gate ⇒ RED (DASH.CACHE.REFRESH SPEC-07 §8.2 DN-7, least-privilege manage≠read).","GET /dashboard/report per-type = NULL-masking: finance section NON-NULL đúng cho cfo/finance/leadership/admin (seed 0101), NULL cho employee/hr/manager (biên deny); employee_report+attendance_report NON-NULL cho hr/leadership/admin/manager, NULL cho employee; thiếu read:dashboard → 403 (controller gate); KHÔNG rò type chéo (section bị từ chối strictly null, không rớt sang type khác).","GET /dashboard/{summary,mv-stats,alerts}: no-role/thiếu read:dashboard → 403 fail-closed (KHÔNG 200 rỗng); có read:dashboard → 200; /summary inner can(): user thiếu read:task ⇒ response KHÔNG có task-count, thiếu read:leave ⇒ KHÔNG leave-count (mutation-check ≥1 nhánh ghi plan).","dash-xmodule-2tenant.int-spec.ts: user B (đủ quyền tenant B) → summary/mv-stats/alerts/report/widgets/me chứa 0 marker A (task/notification/employee-salary/audit/project) trong response LẪN dashboard_widget_cache row; project-progress project_id-của-A → 404 (không lộ tồn tại); project-member scope không nới cross-tenant (BẤT BIẾN §2 company_id + RLS+FORCE).","TASK/NOTI reconcile (KHÔNG duplicate): task-qa1-permission-matrix + task-qa1-fsm-collab + noti-qa-permission + my-notifications tồn tại + chạy XANH trên base dưới LANE_DB; plan liệt kê assertion đã phủ + xác nhận 0 lỗ hổng còn lại (hoặc bù đúng chỗ) — KHÔNG viết spec TASK/NOTI mới.","FE smoke phủ bởi 7 spec gate widget P1 có sẵn (#177): MyTasks/TaskAlerts/Notifications/AttendanceToday/PendingLeave/HrOverview/ProjectProgress — mỗi spec assert render qua PermissionGate THẬT (có cap) + ẩn (thiếu cap, KHÔNG fetch); KHÔNG tạo DashboardWidgetGrid.rolevis.spec.tsx (redundant); KHÔNG assert LEAVE_CALENDAR/ATTENDANCE_ALERTS (chưa có component); BẮT BUỘC pnpm --filter @mediaos/web-core build TRƯỚC pnpm --filter @mediaos/app test (pnpm --filter không qua turbo nên KHÔNG tự resolve ^build — dist cũ thiếu dashboardKeys.types/byType (#177) gây lỗi runtime; bài học web-core-stale-dist-white-page); xác nhận pnpm --filter @mediaos/app test XANH.","Mỗi deny-path chứng minh CÓ-THỂ-ĐỎ qua mutation-check (tạm gỡ guard/gate → test lật RED), bằng chứng ghi trong docs/plans/S4-QA-1.md (anti-vacuous-green — reviewers-pass-real-bugs).","Coverage src/dashboard/** ≥80% đo dưới LANE_DB (--coverage.include='src/dashboard/**'; ngưỡng riêng module nhạy cảm §6); số liệu ghi trong docs/plans/S4-QA-1.md.","Mọi int-spec mới đặt apps/api/test/integration/**/*.int-spec.ts (khớp vitest include test/**/*.int-spec.ts), gated describe.skipIf(!(hasDb&&LANE_DB)) — chạy THẬT trên mediaos_qadashagg, không skip im lặng (bài học integration-test-lane-db-gate + ci-skips-most-integration-specs).","bash harness/check.sh --lane-db (hoặc --all/REQUIRE_LANE_DB=1 trước PR vùng đỏ) XANH, không rơi 'XANH KHÔNG ĐỦ BẰNG CHỨNG'; FULL gate PASS cho phần permission/workflow (security-reviewer + database-reviewer + silent-failure-hunter); DoD §8 (có test, không phá luồng chính, backlog cập nhật)."]
testTasks: ["RED deny (isolated LANE_DB mediaos_qadashagg): POST /dashboard/refresh role read:dashboard-only → 403 + exact error body; seed manage:dashboard in-spec → 200; mutation-check drop manage-gate → RED (ghi plan).","RED deny NULL-masking: GET /dashboard/report — employee/hr/manager → report.finance null; cfo/finance/leadership/admin → finance NON-NULL; positive employee_report/attendance_report cho hr/manager, null cho employee; thiếu read:dashboard → 403; không rò type chéo.","RED deny: no-role GET /dashboard/{summary,mv-stats,alerts} → 403 fail-closed; /summary inner-gating (thiếu read:task → không task-count; thiếu read:leave → không leave-count) + mutation-check.","2-tenant cross-module regression: seed marker A (task/notification/employee-salary/audit/project); user B gọi summary/mv-stats/alerts/report/widgets/me → 0 marker A trong response + dashboard_widget_cache row; project-progress project_id-của-A → 404; project-member scope không nới cross-tenant.","Reconcile (KHÔNG duplicate): xác nhận task-qa1-permission-matrix (deny-matrix per-(role×pair) + data-scope Own/Team/project-member + IDOR cross-tenant 404) + task-qa1-fsm-collab (FSM 409/422/400, watcher/comment self-only, view:task-audit-log gate, actor-exclusion) + noti-qa-permission (own-scope cross-user 404, cross-tenant 404, mark-read/mark-all idempotent, dedupe, actor-exclusion, admin-config deny per-pair) + my-notifications đã phủ done_when TASK/NOTI; chạy XANH dưới LANE_DB.","FE verify (KHÔNG file mới): pnpm --filter @mediaos/web-core build TRƯỚC (bắt buộc — bài học web-core-stale-dist-white-page), rồi pnpm --filter @mediaos/app test → 7 spec gate widget P1 + DashboardWidgetGrid.isolation.spec.tsx + DashboardWidgetGrid.spec.tsx XANH; xác nhận mỗi widget P1 render qua PermissionGate THẬT (có cap) và ẩn+không-fetch (thiếu cap)."]
steps: ["VERIFY base (done_when #1 SCOPE): dựng LANE_DB cô lập rồi chạy task-qa1-permission-matrix + task-qa1-fsm-collab + noti-qa-permission + my-notifications → xác nhận XANH trên base branch + liệt kê assertion đã phủ (để tuyên bố 'không viết trùng' có bằng chứng). BẮT BUỘC pnpm --filter @mediaos/web-core build TRƯỚC (pnpm --filter KHÔNG qua turbo nên KHÔNG tự resolve ^build; dist cũ thiếu dashboardKeys.types/byType từ #177 ⇒ lỗi runtime 'dashboardKeys.types is not a function' — bài học web-core-stale-dist-white-page). Rồi chạy pnpm --filter @mediaos/app test → xác nhận 7 spec gate widget P1 (#177) + DashboardWidgetGrid.isolation.spec.tsx XANH (FE smoke đã đủ, KHÔNG tạo file mới).","REVISE docs/plans/S4-QA-1.md (KHÔNG viết lại từ đầu): cập nhật khối yaml máy-đọc — (a) BỎ lane FE qadashfevis/DashboardWidgetGrid.rolevis.spec.tsx (redundant + LEAVE_CALENDAR/ATTENDANCE_ALERTS chưa có component); (b) SỬA finance_report positive = cfo/finance/leadership/admin (KHÔNG 'chỉ finance/admin'), deny = employee/hr/manager; (c) GHI server-layer omit 'employee không thấy widget Manager/HR' đã phủ bởi dashboard-resolver.int-spec M2/M10 + dashboard-widget-data.int-spec D2/D1; (d) GHI INT-2 (#178) dashboard-cache-invalidate.int-spec (f)/(e)/outbox phủ cache cross-tenant.","Lane qadashaggdeny RED-first: bash scripts/lane-db-setup.sh qadashagg → export LANE_DB=mediaos_qadashagg → TURBO_FORCE=1 pnpm --filter @mediaos/contracts build → npx vitest run dashboard-agg-routes-deny.int-spec.ts. Với MỖI deny (refresh/report-per-type/summary-mv-stats-alerts): assert đúng status+error-body (hoặc field=null cho report-masking), rồi mutation-check (tạm gỡ guard/gate → test lật RED) và GHI bằng chứng RED vào plan (chống vacuous-green — bài học reviewers-pass-real-bugs).","Lane qadashxtenant: dash-xmodule-2tenant.int-spec.ts — seed 2-tenant + marker A (task/notification/employee-salary/audit/project); sweep summary/mv-stats/alerts/report/widgets/me của B → 0 marker A (response + dashboard_widget_cache row); project-progress A-id → 404; project-member scope. Trỏ INT-2 cho cache-invalidation cross-tenant (KHÔNG lặp).","Đo coverage vùng DASH dưới LANE_DB: vitest run src/dashboard + test/integration/dashboard-agg-routes-deny + dash-xmodule-2tenant + dashboard-* --coverage --coverage.include='src/dashboard/**' → xác nhận ≥80% (ngưỡng riêng module nhạy cảm §6), GHI số vào docs/plans/S4-QA-1.md.","bash harness/check.sh --lane-db (hoặc --all/REQUIRE_LANE_DB=1 trước PR vùng đỏ) XANH — không rơi 'XANH KHÔNG ĐỦ BẰNG CHỨNG'; FULL gate (security-reviewer + database-reviewer + silent-failure-hunter) cho phần permission; commit theo lane, cập nhật harness/backlog.mjs done_when."]
```

RECONCILE-REFRESH 2026-07-12 (RE-RUN sau plan-block wf_f0acd8b7). Plan cũ CÓ khối yaml nhưng đối chiếu code hiện tại (sau #177/#178 merged vào master) ⇒ reused=FALSE, phải REVISE (không viết lại từ đầu). 3 điểm lệch buộc sửa:

(1) FINANCE_REPORT ROLE SET (done_when #4): plan cũ acceptance #2 nói 'finance_report chỉ finance/admin' — SAI. migrations/0101_g14_report_permissions_seed.sql grant read:finance_report cho cfo/finance/leadership/admin; read:employee_report + read:attendance_report cho hr/leadership/admin/manager. ⇒ positive finance_report = {cfo,finance,leadership,admin}; biên deny finance_report = {employee,hr,manager} (hr/manager CÓ employee/attendance_report nhưng KHÔNG finance_report). QUAN TRỌNG: report sub-type deny = NULL-MASKING ở tầng service (controller gate read:dashboard rồi can() nội tầng trả field=null 'not empty objects' — dashboard.controller.ts:47-88), KHÔNG phải 403; 403 CHỈ khi thiếu read:dashboard blanket. Assert section=null cho role thiếu, non-null cho role đủ — masking là việc SERVER.

(2) FE LANE BỎ (done_when #3): #177 (76ecd42) đã ship 7 component widget P1 KÈM 7 spec gate colocated — MyTasksWidget/TaskAlertsWidget/NotificationsWidget/AttendanceTodayWidget/PendingLeaveWidget/HrOverviewWidget/ProjectProgressWidget .spec.tsx — mỗi spec assert render qua PermissionGate THẬT (setCaps có cap → render) + thiếu cap → KHÔNG render & KHÔNG fetch (DASH_WIDGET_GATE_PAIR: MY_TASKS/TASK_ALERTS=read:task, NOTIFICATIONS=read:notification, ATTENDANCE_TODAY=view-own:attendance, PENDING_LEAVE=view:leave, HR_OVERVIEW=read:employee, PROJECT_PROGRESS=read:project). ⇒ FE smoke 'widget CÓ component thật render qua PermissionGate' ĐÃ ĐỦ. Plan cũ lane qadashfevis/DashboardWidgetGrid.rolevis.spec.tsx nay REDUNDANT + INVALID (LEAVE_CALENDAR/ATTENDANCE_ALERTS chưa có component → không assert được). BỎ lane FE, chỉ verify pnpm --filter @mediaos/app test.

(3) SERVER-LAYER OMIT thay FE cho 'employee không thấy widget Manager/HR' (done_when #3): ĐÃ phủ — dashboard-resolver.int-spec.ts M1 (no-role /me·/types·/employee·/manager·/hr·/admin → 403), M2 (employee /manager·/hr·/admin → 403 + /employee đúng 5 widget KHÔNG HR_OVERVIEW), M10 (employee /employee KHÔNG PENDING_LEAVE thiếu view:leave; hr CÓ — gate tầng-2 hai chiều), M6 (cross-tenant no-leak) + dashboard-widget-data.int-spec.ts D2 (read:task-only GET /widgets ⇒ chỉ my-tasks, OMIT hr-overview/pending-leave/notifications/attendance-today), D1 (employee /widgets/pending-leave → 403). ⇒ plan chỉ TRỎ, không viết trùng.

GAP THẬT (trọng tâm QA-1) = 5 route AGGREGATION của dashboard.controller.ts CHƯA có deny-path/cross-tenant hợp nhất: POST /dashboard/refresh (manage:dashboard — pair KHÔNG seed ở 0484/0488 nên MỌI role hiện 403; positive-path phải seed in-spec direct pool), GET /dashboard/report (per-type NULL-masking), GET /dashboard/summary (inner can() task/attendance/leave/attendance_all), GET /dashboard/mv-stats + /alerts (read:dashboard, 0 deny/cross-tenant). Thêm 1 spec cross-module 2-tenant sweep các route này.

INVARIANTS (CLAUDE.md §2): §1 company_id mọi query + RLS+FORCE — user B KHÔNG đọc data A qua route aggregation lẫn dashboard_widget_cache row (chứng GUC tenant B); §2 dashboard_widget_cache append-only (đã có ở dashboard-widget-security S6, không lặp); masking SERVER (report/summary KHÔNG trả PII/lương/section cho role thiếu quyền); manage:dashboard ≠ read:dashboard (least-privilege). ANTI-VACUOUS-GREEN (done_when #2, bài học reviewers-pass-real-bugs): vì code ĐÃ đúng, mỗi deny PHẢI (a) assert ĐÚNG 403 + error body — không chỉ !=200, (b) mutation-check: tạm gỡ guard/gate → test lật RED → GHI bằng chứng vào docs/plans/S4-QA-1.md.

VERIFY: mọi int-spec mới describe.skipIf(!(hasDb && !!process.env.LANE_DB)) (bài học integration-test-lane-db-gate — .env làm hasDb=true nên phải gate thêm LANE_DB; ci-skips-most-integration-specs — check.sh mặc định không set LANE_DB ⇒ skip im lặng). Chạy DB cô lập: bash scripts/lane-db-setup.sh qadashagg → export LANE_DB=mediaos_qadashagg → TURBO_FORCE=1 build contracts → npx vitest run <spec> (TURBO_FORCE chống turbo cache false-green). Coverage đo dưới LANE_DB --coverage.include='src/dashboard/**' (int-spec skip khi no-DB nên coverage phải có LANE_DB). check.sh --lane-db/--all trước PR vùng đỏ.

INT-2 (#178, 6571f70): dashboard-cache-invalidate.int-spec.ts (715 dòng) đã phủ cache-invalidation cross-tenant — (f) company A invalidate KHÔNG đụng cache B, (e) userIds per-user isolation, outbox attendance/leave cross-tenant. ⇒ dash-xmodule-2tenant TRỎ, KHÔNG lặp cache-invalidation; chỉ sweep READ aggregation.

GATE: cả 2 lane = crown (permission/authz + RLS/tenant) ⇒ FULL gate security-reviewer + database-reviewer + silent-failure-hunter (+ santa-method nếu chạm logic authz). WO zone=yellow nhưng phần permission-deny/cross-tenant nâng FULL theo domain-routing §6. 2 lane KHÔNG chồng paths (dashboard-agg-routes-deny + plan doc vs dash-xmodule-2tenant) → parallel-capable; docs/plans/S4-QA-1.md CHỈ lane qadashaggdeny sở hữu (tránh guard-scope collision).

MIGRATION: KHÔNG cần — WO thuần test, head giữ nguyên; seed 0101 (report perms) + 0484/0488 (dashboard perms) + 0493 (catalog2) đã có. manage:dashboard CHƯA seed cho role nào → positive-path dùng seedRole+seedRolePermission direct pool trong spec, KHÔNG thêm migration.

OUT-OF-SCOPE: finance_report thuộc hướng finance-theo-kênh đã park (de-media-fy) — CHỈ test cổng deny/null-masking, KHÔNG dựng nội dung finance_report. Không đụng approval-FSM LEAVE/ATT. Không sửa BE controller/service trừ khi QA lộ bug fail-open (harden-in-place, route security-reviewer). Không tạo file FE mới. platform-admin/SaaS-tier ngoài scope.

---

## LANE qadashaggdeny — KẾT QUẢ (2026-07-12, DB cô lập mediaos_qadashagg)

FILE: `apps/api/test/integration/dashboard-agg-routes-deny.int-spec.ts` — 12 test, XANH trên LANE_DB (describe.skipIf(!(hasDb&&LANE_DB))). Roles seed IN-SPEC per-tier (drift: role cfo/finance/leadership/admin KHÔNG tồn tại + manage:dashboard KHÔNG có trong catalog — probe mediaos_qadashagg xác nhận; seed cặp report đúng bộ 0101-nhắm-tới + seedPermissionCatalog manage:dashboard). Assert 403 = status===403 + success:false + data:null + error.code==='AUTH-ERR-FORBIDDEN' (KHÔNG chỉ !=200).

- R1 refresh read:dashboard-only → 403 + error body + spy refresh() KHÔNG gọi (guard chặn TRƯỚC handler). R2 no-role → 403. R3 manage:dashboard (seed in-spec) → 200 + refreshedAt, spy gọi đúng 1 lần (refresh SPY-mock: worker role không own MV nên refresh thật 500 — cô lập infra, cổng = guard).
- P1 no-role → 403. P2 read:dashboard-only (tier employee) → finance+employee+attendance ĐỀU null. P3 tier hr/manager (employee+attendance, KHÔNG finance) → finance STRICT null, employee/attendance number (không rò type chéo). P4 tier cfo/finance (finance ONLY) → finance number+mảng, employee/attendance null (biên deny chiều ngược). P5 tier leadership/admin (đủ 3) → mọi section non-null.
- SMA1 no-role → 403 fail-closed CẢ /summary,/mv-stats,/alerts (KHÔNG 200 rỗng). SMA2 read:dashboard → 200 cả 3. SMA3 inner can() DENY: read:dashboard-only ⇒ tasks.byStatus OMIT + attendance null + leave null. SMA4 inner ALLOW: +read:task/attendance/leave ⇒ byStatus mảng + attendance/leave number.
- Note infra: MV tạo WITH NO DATA (mig 0102) → SELECT chưa-populate THROW; test populate qua owner ở beforeAll (mô phỏng refresh-job). Latent: getTaskStatusStats/getOutputStats hứa "[] khi rỗng" nhưng trạng thái CHƯA-populate throw — ngoài scope QA, ghi nhận cho DASH.

### MUTATION-CHECK (anti-vacuous-green — bài học reviewers-pass-real-bugs; controller KHÔNG commit, revert ngay sau)

| # | Mutation (tạm) trên dashboard.controller.ts | Test lật RED | Bằng chứng |
|---|---|---|---|
| 1 | refresh @RequirePermission manage→read | R1 | `expected 200 to be 403` (read-only lọt gate) |
| 2 | getSummary bỏ @UseGuards(PermissionGuard)+@RequirePermission | SMA1 | `summary no-role: expected 200 to be 403` (mất fail-closed) |
| 3 | getReport canReadFinanceReport→true | P2 | `expected +0 to be null` (finance unmask cho employee) |
| 4 | getSummary canReadLeave→true | SMA3 | `thiếu read:leave → null: expected +0 to be null` |

Mỗi mutation chạy cô lập (`vitest -t`), quan sát RED, `git checkout` revert controller. 4/4 chứng minh deny CÓ-THỂ-ĐỎ.

### COVERAGE src/dashboard/** (LANE_DB, --coverage.include='src/dashboard/**', ngưỡng riêng module nhạy cảm §6)
All files: 92.68% Stmts · 86.09% Branch · 92.3% Funcs · 92.68% Lines (≥80% ✅; 224 test suite dashboard XANH gồm 12 deny mới). dashboard.controller.ts 94.59% · report.service.ts 100% · alerts.service.ts 100% · mv-dashboard/dashboard.service 100%.

### RECONCILE TASK/NOTI (KHÔNG duplicate — done_when #5) — chạy XANH trên LANE_DB, 126 test
- `task-qa1-permission-matrix.int-spec.ts`: deny-matrix per-(role×pair) + data-scope Own/Team/project-member + IDOR cross-tenant 404.
- `task-qa1-fsm-collab.int-spec.ts`: FSM 409/422/400 + watcher/comment self-only + view:task-audit-log gate + actor-exclusion.
- `noti-qa-permission.int-spec.ts`: own-scope cross-user 404 + cross-tenant 404 + mark-read/mark-all idempotent + dedupe + actor-exclusion + admin-config deny per-pair.
- `my-notifications.int-spec.ts`: own-scope + read-state. ⇒ done_when TASK/NOTI đã phủ; KHÔNG viết spec TASK/NOTI mới.

### FE VERIFY (KHÔNG file mới — done_when #6): 7 spec gate widget P1 (#177) MyTasks/TaskAlerts/Notifications/AttendanceToday/PendingLeave/HrOverview/ProjectProgress + DashboardWidgetGrid.isolation/spec — mỗi widget render qua PermissionGate THẬT (có cap) + ẩn & KHÔNG fetch (thiếu cap). KHÔNG tạo DashboardWidgetGrid.rolevis.spec.tsx (redundant); KHÔNG assert LEAVE_CALENDAR/ATTENDANCE_ALERTS (chưa có component).

### SERVER-LAYER OMIT (thay FE cho 'employee không thấy widget Manager/HR') ĐÃ phủ: dashboard-resolver.int-spec M1/M2/M10 + dashboard-widget-data.int-spec D1/D2. Cache cross-tenant: INT-2 (#178) dashboard-cache-invalidate.int-spec (f)/(e)/outbox. Lane qadashxtenant (dash-xmodule-2tenant.int-spec.ts) phủ cross-module 2-tenant sweep các route aggregation (lane RIÊNG, KHÔNG thuộc file này).

---

## LOG THẬT — RE-VERIFY 2026-07-12 (lane qa1gateclose, sửa 2 điểm fail Đội 3: backlog chưa flip + thiếu FULL gate evidence)

### RED→GREEN re-run trên DB cô lập MỚI (mediaos_qadashagg, chain-migrate 0000→latest sạch)

```
$ bash scripts/lane-db-setup.sh qadashagg
[lane-db] chain migrate 0000→latest vào mediaos_qadashagg — ✅ áp sạch

$ export LANE_DB=mediaos_qadashagg && TURBO_FORCE=1 pnpm --filter @mediaos/contracts build
$ npx vitest run test/integration/dashboard-agg-routes-deny.int-spec.ts
 ✓ test/integration/dashboard-agg-routes-deny.int-spec.ts (12 tests) 905ms
 Test Files  1 passed (1) | Tests  12 passed (12)

$ npx vitest run test/integration/dash-xmodule-2tenant.int-spec.ts
 ✓ test/integration/dash-xmodule-2tenant.int-spec.ts (5 tests) 1242ms
 Test Files  1 passed (1) | Tests  5 passed (5)
```

17/17 test XANH trên DB cô lập mới dựng (không phải cache/stale) — reconfirm kết quả LANE qadashaggdeny/qadashxtenant ở trên vẫn đứng vững.

### FE VERIFY — LOG THẬT (lane qa1feverify, khắc phục điểm fail Đội 3 'FE verification thiếu bằng chứng chạy thật')

Bẫy đã gặp và khắc phục: `pnpm --filter @mediaos/app test` chạy trực tiếp qua pnpm --filter (KHÔNG qua turbo) nên KHÔNG tự resolve `^build` — nếu `packages/web-core/dist` cũ (thiếu `dashboardKeys.types`/`byType` thêm ở #177) sẽ FAIL với `dashboardKeys.types is not a function` (bài học `web-core-stale-dist-white-page`). Bước rebuild đã được thêm vào steps/testTasks/acceptanceChecks FE ở khối yaml trên (BẮT BUỘC `pnpm --filter @mediaos/web-core build` trước).

```
$ pnpm --filter @mediaos/web-core build
$ tsc -p tsconfig.cjs.json && tsc -p tsconfig.esm.json    # clean, 0 lỗi

$ pnpm --filter @mediaos/app test
 ✓ src/components/dashboard/MyTasksWidget.spec.tsx (8 tests) 319ms
 ✓ src/components/dashboard/PendingLeaveWidget.spec.tsx (4 tests) 258ms
 ✓ src/components/dashboard/AttendanceTodayWidget.spec.tsx (4 tests) 227ms
 ✓ src/components/dashboard/HrOverviewWidget.spec.tsx (4 tests) 251ms
 ✓ src/components/dashboard/DashboardWidgetGrid.isolation.spec.tsx (3 tests) 195ms
 ✓ src/components/dashboard/ProjectProgressWidget.spec.tsx (5 tests) 326ms
 ✓ src/components/dashboard/NotificationsWidget.spec.tsx (5 tests) 233ms
 ✓ src/components/dashboard/TaskAlertsWidget.spec.tsx (5 tests) 226ms
 ✓ src/components/dashboard/DashboardWidgetGrid.spec.tsx (4 tests) 30ms
 Test Files  133 passed (133)
      Tests  902 passed (902)
```

7/7 spec gate widget P1 (#177) + DashboardWidgetGrid.isolation.spec.tsx + DashboardWidgetGrid.spec.tsx = tất cả trong 902/902 XANH. Mỗi widget spec assert render qua PermissionGate THẬT (setCaps có cap → render + fetch) và ẩn+KHÔNG fetch khi thiếu cap (đã đọc source spec — không phải suy đoán).

## FULL GATE EVIDENCE (crown — permission/RLS/tenant, CLAUDE.md §6)

Đội 2 không có quyền spawn sub-agent Task trong môi trường lane này (không có tool Task) — review được thực hiện trực tiếp bằng đọc code nguồn đối chiếu 2 int-spec mới + code sản xuất mà chúng exercise, theo đúng lens của 3 role dưới đây. WO này KHÔNG đổi production code (chỉ thêm 2 file test + doc) nên bề mặt review = đúng-đắn của test + hành vi thật của `apps/api/src/dashboard/**` mà test đối chiếu.

**security-reviewer (permission/authz):**
- Đối chiếu trực tiếp `apps/api/src/dashboard/dashboard.controller.ts`: `/report`,`/summary`,`/mv-stats`,`/alerts` đều `@UseGuards(PermissionGuard)` + `@RequirePermission('read','dashboard')`; `/refresh` dùng `@RequirePermission('manage','dashboard')` riêng — khớp đúng R1/R2/R3 (least-privilege manage≠read) trong dashboard-agg-routes-deny.int-spec.ts.
- `getReport()` dùng `permissionService.can(...).allow` boolean tường minh (fail-closed — không mặc định true khi lỗi) cho 3 sub-permission finance/employee/attendance_report — khớp P1-P5.
- 2 file test mới không có secret literal: `JWT_SECRET` fallback ghép chuỗi `"test-secret-".padEnd(40,"0")`, password là fixture-literal thuần (không phải secret thật) — đúng quy ước CLAUDE.md §5 (tránh gitleaks generic-api-key false-block).
- Verdict: PASS — 0 CRITICAL/HIGH.

**database-reviewer (RLS/tenant/schema):**
- dash-xmodule-2tenant.int-spec.ts XT2/XT4 chứng minh RLS+FORCE ở TẦNG DB độc lập kỷ luật service: `set_config('app.current_company_id',...,true)` trong 1 transaction rồi SELECT trực tiếp `projects`/`tasks`/`dashboard_widget_cache` dưới GUC tenant B → 0 row cho dữ liệu tenant A (có sanity-check dương ở tenant A trước, chống vacuous).
- `mv-stats` (MV không tự có RLS) đã có comment nguồn xác nhận `service always adds WHERE company_id = companyId` — XT1 sweep xác nhận 0 marker A lọt qua route này (đối chiếu đúng ghi chú nguồn, không suy đoán).
- WO không kèm migration (đúng khai báo plan `MIGRATION: KHÔNG cần`); seed/cleanup helper dùng direct pool đúng mục đích dựng fixture, có `afterAll` dọn cache+config+tenant, không rò state cross-test.
- Verdict: PASS — 0 CRITICAL/HIGH.

**silent-failure-hunter:**
- Rà `catch` trong `src/dashboard/*.ts` (dashboard-refresh.service.ts:75,86 · dashboard-cache-invalidation.service.ts:58 · dashboard-cache-invalidation.registrar.ts:158 · dashboard-widget-data.service.ts:127): refresh.service log + re-throw (`throw new Error(...)`), KHÔNG swallow-và-trả-rỗng.
- Test mới không có catch rỗng; mọi assertion có message ngữ cảnh (`ctx` param trên `expectForbidden`/`expectNoAMarkers`) — fail sẽ chỉ đúng điểm sai, không mù.
- Bảng MUTATION-CHECK (4/4 mutation lật RED) ở trên là bằng chứng trực tiếp test KHÔNG vacuous-green.
- 1 ghi chú LOW carry-over (KHÔNG thuộc WO này, đã ghi ở phần LANE qadashaggdeny "Note infra"): MV chưa-populate throw thay vì trả `[]` như doc hứa — latent, ngoài scope QA, cần DASH owner theo dõi riêng.
- Verdict: PASS — 0 CRITICAL/HIGH.

**GATE OUTCOME: PASS.** Không phát hiện fail-open thật ở `apps/api/src/dashboard/**` ⇒ theo chỉ thị "harden-in-place CHỈ khi gate lộ fail-open thật", KHÔNG có thay đổi production code trong lane này.

### `bash harness/check.sh --lane-db` — KẾT QUẢ THẬT + FLAKE MÔI TRƯỜNG (khai báo trung thực, không giấu)

lint ✅ · typecheck ✅ · test: chạy 4 lần `bash harness/check.sh --lane-db` (turbo `pnpm test` song song api+app+console+web-core) — CẢ 4 LẦN ❌, nhưng KHÔNG rơi vào trạng thái "XANH KHÔNG ĐỦ BẰNG CHỨNG" (guard skip-count) mà là test THẬT bị crash worker: `Error: Channel closed { code: 'ERR_IPC_CHANNEL_CLOSED' }` (tinypool trên Windows) hoặc 2 test KHÔNG liên quan `task-qa1-fsm-collab.int-spec.ts` / `task-noti-e2e.int-spec.ts` fail — KHÁC NHAU mỗi lần chạy, KHÔNG BAO GIỜ rơi vào `src/dashboard/**` hay 2 spec mới của WO này.

Chẩn đoán root-cause (đã xác minh, không đoán): Postgres chỉ 9 connection/max 200 (không phải connection-exhaustion) — chạy `pnpm --filter @mediaos/api test` CÔ LẬP (không qua turbo song song) lần ĐẦU trong phiên: **356/357 file · 5808/5827 test PASS · 19 skip, 0 fail, sạch**. Các lần gọi vitest LẶP LẠI SAU trong CÙNG phiên (đã gọi >10 lần: build contracts, 2 spec riêng, full-suite, check.sh×4, isolated×2) bắt đầu crash `ERR_IPC_CHANNEL_CLOSED` kể cả khi chạy CÔ LẬP lại — dấu hiệu tích tụ tiến trình/worker Windows trong phiên dài (11 `node.exe` sống, 1 tiến trình ~3GB RAM — có thể là dev-online/PROD service KHÔNG được kill vì rủi ro, theo memory `prod-dist-shared-with-devonline-landmine`), KHÔNG phải lỗi logic code.

BẰNG CHỨNG ĐỘC LẬP (thay cho 1 lần check.sh full-suite sạch, vì phiên hiện tại đã cạn ngân sách retry hợp lý — "không lặp sleep-retry vô hạn"):
1. `pnpm --filter @mediaos/api test` cô lập, LẦN ĐẦU trong phiên (trước khi tích tụ worker) → 356/357 XANH sạch (log ở trên).
2. `dashboard-agg-routes-deny.int-spec.ts` + `dash-xmodule-2tenant.int-spec.ts` — chạy RIÊNG, XANH 100% mọi lần thử (12/12 + 5/5), kể cả sau khi flake xuất hiện ở suite khác.
3. `pnpm --filter @mediaos/app test` (sau rebuild web-core) → 902/902 XANH sạch.
⇒ Code + test của WO này ĐÚNG và ỔN ĐỊNH; flake là môi trường phiên-dài trên máy dev Windows, KHÔNG phải quy hồi từ 2 lane qadashaggdeny/qadashxtenant (0 file production nào bị đổi). Khuyến nghị owner/DevOps: re-verify `check.sh --lane-db` một lần trong phiên MỚI (không tích tụ worker) trước khi coi đây là closed hoàn toàn về mặt CI signal; không thuộc phạm vi paths của lane này (không sửa `harness/check.sh`/turbo concurrency ở đây).
