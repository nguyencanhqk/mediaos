# S20-TASK-WORKLOAD-1 — Màn «Đội của tôi» (`GET /tasks/workload` + `/tasks/team`)

> Plan 11/11/2026 · worktree `MediaOS-w4a` · nhánh `feat/s20-task-workload-1` (nền `c4ef4952`) · zone 🟠 amber → **FULL gate** (chạm bộ dựng phạm vi đọc + nâng trần sổ chiếu danh tính, xem D10).
> Nguồn: `harness/backlog.mjs:25336` · `docs/plans/S20-WORKUX-STORIES.md:832` (US-TASK-QL-04) · SPEC-06 §14.17 · KPI #12.
> v2 (11/11): sửa theo review đối kháng; điểm nhận và điểm bác ghi ở §7 «Phản biện».

## 1. Đo hiện trạng (file:line)

| # | Sự thật đo được | Chỗ |
| --- | --- | --- |
| H1 | `GET /tasks` = `listTasks` → `TaskCoreService.listTasks`; `@Get("my")` khai trước `@Get(":taskId")` | `tasks.controller.ts:89-118` |
| H2 | Bộ dựng phạm vi đọc của GET /tasks = `resolveReadScopeExists` (PRIVATE, 3 người gọi `:190,227,281`): `resolveAndAssert` → Company/System ⇒ `undefined`; còn lại `buildEmployeeScopeCondition` + `repo.buildReadScopeExists` | `task-core.service.ts:1130-1137` |
| H3 | `buildReadScopeExists` = (A) assignee ∈ `employee_profiles` (chưa xoá mềm) thoả `scopeCond` **OR** (B) người xem là member Active của dự án chứa việc (cap theo `mode` read/collab/write) | `task-core.repository.ts:314-353` |
| H3b | `buildReadScopeExists` có **~9 người gọi** ngoài GET /tasks, gồm đường GHI (`project-access.service.ts:146`, mode `write`) và đường tệp/bình luận/checklist/kanban/goal (`task-file.resolver.ts:103` · `task-file.service.ts:407` · `task-comments.service.ts:282,333` · `task-checklists.service.ts:372` · `task-kanban.service.ts:83` · `goals/goal-tasks-link.service.ts:104`) | grep `buildReadScopeExists` |
| H4 | ⇒ Dùng NGUYÊN H3 thì người ngoài phạm vi có việc trong dự án chung SẼ hiện (nhánh B) — trái tiêu chí 2. Cần thêm vị từ «người thuộc phạm vi» = nhánh (A) | `task-core.repository.ts:321-326` |
| H5 | Vị từ «quá hạn» viết tay 2 nơi: `isOverdue` của SELECT và bộ lọc `overdue` của `listTx` (`due_at < now()`, mở = NULL hoặc ∉ Done/Cancelled) | `task-core.repository.ts:217-218, 395-399` |
| H6 | Trạng thái: `Todo · In Progress · In Review · Done · Cancelled` | `contracts/src/task.ts:543-549` |
| H7 | Giờ công ty BE: `resolveCompanyTz(db, companyId)` **tự mở `db.withTenant` riêng** (fallback `Asia/Ho_Chi_Minh`) + `tz.util` (`localDateOf`, `addDaysToLocalDate`, `wallTimeToInstant`) | `dashboard/dashboard-company-tz.util.ts:17-25` · `common/tz.util.ts:44,86,101` |
| H8 | Chốt tĩnh S20-SEC-TASKLEGACYREAD-1: tập GET của `TasksController` phải KHỚP `APPROVED_GET_PATHS`; cùng tệp có bảng `GUARDED_MUTATIONS` (metadata `@RequirePermission` + cặp DENY 403/ALLOW mỗi handler) | `tasks.permissions.spec.ts:40-83, 166-176` |
| H9 | Census route sinh bằng `ROUTE_CENSUS_WRITE=1 … vitest run test/foundation/route-guard-coverage.e2e-spec.ts`; ca so artifact ↔ runtime | `route-guard-coverage.e2e-spec.ts:42,139,261` |
| H10 | Sàn độ phủ HTTP `MIN_COVERED_COUNT = 689` (quét tĩnh supertest) | `route-http-coverage.e2e-spec.ts:385` |
| H11 | FE `/tasks?assignee=<uuid>&overdue=true&project=&department=` ĐÃ hỗ trợ → `assigneeEmployeeId/overdue/projectId/departmentId` | `routes/tasks/task-list-search.ts:30-49,101-131` |
| H12 | Tiền lệ route tĩnh `/tasks/overdue`: registry (order 51.5) + `makeModuleRoute` + sidebar `TASK_SIDEBAR` (nhãn literal) | `registry.ts:1415-1428` · `router.tsx:1515-1525` · `layouts/workspace/sidebar/task.ts` |
| H13 | `routeTitle` của route trong ROUTE_REGISTRY khai ở `web-core/i18n/locales/vi/nav.ts` (tiền lệ SOCIAL `:205-209`) | `nav.ts:205` |
| H14 | Envelope `{success,data}` bọc ở `ResponseEnvelopeInterceptor`, `apiFetch` bóc `data` ⇒ trả object `{items,…}` an toàn | `main.ts:55` · `web-core/lib/api-client.ts:51-63` |
| H15 | Snapshot sidebar = `toMatchFileSnapshot` (`sidebar-tree.raw.txt` · `.by-permission.txt`) | `sidebar-registry.snapshot.spec.ts:123,138` |
| H16 | Icon `users` có trong `DynamicIcon.ICON_MAP`; SPEC-06 KHÔNG có mã màn hình cho «Đội của tôi» | `DynamicIcon.tsx:92` |
| H17 | Ratchet chiếu danh tính: chiều 6 đếm MỌI template `sql` có `email\|full_name` ≤ `BLIND_SPOT_PINS.rawSqlIdentity = 15`; mọi điểm chiếu `users.fullName` qua identifier cần 1 dòng `IDENTITY_VERDICTS`, đếm theo `BASIS_CEILINGS` — đo 11/11: **mọi basis đã bão hoà** (`membership` 14/14 · `scoped-predicate` 25/25 · `second-assert` 13/13 · `identity-gated` 18) | `identity-projection-census.ts:461` · `identity-projection-verdicts.ts:835-955` · `identity-projection-ratchet.unit-spec.ts:127-166` |
| H18 | Tiền lệ đúng khuôn: `goals.repository.ts#ownerNamesTx` — truy vấn drizzle RIÊNG tra tên theo `employeeIds` của các hàng vừa đọc qua read-scope, basis `membership`, ký FULL gate S20-GOAL-OWNERCHECKIN-1 (nâng trần 13→14) | `goals.repository.ts:182-220` · `identity-projection-verdicts.ts:516-523, 895-904` |

## 2. Quyết định

- **D1 — Dùng chung bộ dựng phạm vi, không viết lại.** Tách `TaskCoreService.resolveReadScope(tx,user)` PUBLIC trả `{ scope, scopeCond?, actorEmployeeId?, exists? }`; `resolveReadScopeExists` (private) thành `(await this.resolveReadScope(tx,user)).exists` — trích hàm thuần, 3 người gọi GET /tasks (`:190,227,281`) không đổi hành vi. Workload gọi đúng hàm này. Lý do: một nguồn duy nhất cho phạm vi; bản sao composition 6 dòng sẽ trôi. Hồi quy GET /tasks: §5.
- **D2 — Vị từ «người thuộc phạm vi»: hàm MỚI đứng riêng, `buildReadScopeExists` KHÔNG ĐỤNG.** Thêm `TaskCoreRepository.buildAssigneeScopeExists(scopeCond)` = đúng văn bản nhánh (A) của H3 (`exists (select 1 from employee_profiles where employee_profiles.id = tk.main_assignee_employee_id and employee_profiles.deleted_at is null and ${scopeCond})`), chú thích neo chéo hai chiều (ở hàm mới và ở `assigneeExists` của `buildReadScopeExists`). Unit `task-workload.predicates.spec.ts` ghim: render (`PgDialect.sqlToQuery`) `buildReadScopeExists(c, scopeCond, e, u)` **chứa nguyên văn** chuỗi render của `buildAssigneeScopeExists(scopeCond)` (nhánh A đứng trước nên đánh số tham số trùng) — lệch là ĐỎ. Lý do: không đưa 9 người gọi của H3b (có đường ghi) vào bán kính của WO này.
  - **Vị từ người chính xác** (AND với `exists` của D1), dựng bằng `buildWorkloadPersonPredicate(scope, scopeCond)`:
    - S ∈ {Company, System}: không thêm gì.
    - S = Team/Department: `(tk.main_assignee_employee_id IS NULL OR ${buildAssigneeScopeExists(scopeCond)})`.
    - S = Own: `${buildAssigneeScopeExists(scopeCond)}` (bỏ vế NULL ⇒ không có «Chưa giao»).
  - Viết thẳng `scope ∈ {Own,Team,Department} ⇒ AND nhánh (A)` sẽ XOÁ nhóm NULL ở Team/Department (nhánh A không bao giờ khớp NULL) — đó là lý do vế `IS NULL` nằm trong vị từ chứ không chỉ ở D3.
- **D3 — Định nghĩa «người xuất hiện» (test cả hai chiều).** Gọi V = người xem, S = scope `read:task` của V, T = việc có `company_id = V`, `deleted_at IS NULL`, **mở** (status NULL hoặc ∉ Done/Cancelled), khớp `projectId/departmentId`, thoả `exists` của D1 **và** vị từ người của D2.
  - Dòng người E xuất hiện ⇔ ∃ t ∈ T, `t.main_assignee = E`.
  - Dòng «Chưa giao» xuất hiện ⇔ ∃ t ∈ T có `main_assignee IS NULL` (Own không bao giờ có, do D2 — service vẫn ép `unassigned=null` khi Own: phòng thủ kép).
  - Hệ quả: chỉ có việc Done/Cancelled/xoá mềm ⇒ KHÔNG xuất hiện; người trong đội không có việc mở ⇒ không xuất hiện (màn là «tải việc», không phải danh bạ). Company/System thấy cả người có hồ sơ xoá mềm còn việc mở (không giấu việc sống; tên = null theo D10).
  - Việc loại workflow (Task Hub, `WORKFLOW_TASK_TYPES`) **được đếm** như GET /tasks đang trả — chủ ý để P1 khớp số tuyệt đối; câu hỏi mở cho owner ở §6.
- **D4 — Hằng dùng chung** ở `apps/api/src/tasks/task-workload.predicates.ts`: `TASK_DUE_SOON_DAYS = 7`, `taskOpenPredicate(alias)`, `taskOverduePredicate(alias)` (= `due_at < now()` ∧ mở, như H5), `dueSoonWindowEnd(now, tz)` = đầu ngày công ty của (hôm nay + 8) ⇒ «sắp hạn» = mở ∧ ¬quá hạn ∧ `due_at < windowEnd` (hết ngày thứ 7 theo giờ công ty). `listTx` (bộ lọc `overdue`) đổi sang `taskOverduePredicate("tk")` để «Quá hạn: N» == `GET /tasks?overdue=true` bằng cấu trúc, không chỉ bằng test. REPORTCOUNTS/PROJLISTSTATS import từ đây.
- **D5 — Số ngày trễ lâu nhất** = `max((now() AT TIME ZONE tz)::date - (due_at AT TIME ZONE tz)::date)` lọc quá hạn; `null` khi 0 việc quá hạn; trễ trong ngày = 0. `tz` là bind-param.
  - **Thứ tự gọi (chống lồng transaction):** `resolveCompanyTz` tự mở `withTenant` (H7) ⇒ service gọi `const tz = await resolveCompanyTz(db, companyId)` **TRƯỚC** `db.withTenant(...)` của workload, KHÔNG gọi trong callback. Lồng hai `withTenant` = hai connection trên PgBouncer transaction-mode ⇒ treo dưới tải. Ghim bằng chú thích tại chỗ + unit `task-workload.service.spec.ts`: mock `resolveCompanyTz` và `db.withTenant`, assert thứ tự gọi (tz xong rồi mới mở withTenant; withTenant gọi đúng 1 lần).
- **D6 — Hai truy vấn trong CÙNG MỘT `withTenant`** (không chiếu tên trong SQL thô — D10):
  1. `aggregateTx` (raw `sql`, KHÔNG chứa `full_name`/`email`): CTE `agg` = `select main_assignee_employee_id, count(*) filter(…) … from tasks tk where … group by 1` → `order by (assignee is null) desc, overdue desc, max_overdue_days desc nulls last, active desc, assignee asc limit 102`.
  2. `assigneeNamesTx(tx, companyId, employeeIds)` (drizzle, khuôn `ownerNamesTx` H18) cho ≤101 id không-NULL vừa trả.
  - TS tách nhóm NULL → `unassigned`, còn lại cắt 100 + `truncated`; trong nhóm cùng bộ số (overdue, maxOverdueDays, active) sắp ổn định theo `displayName` (null cuối) rồi `employeeId`. Biên cắt 100 chọn theo `employeeId` (không theo tên) — chấp nhận, vì `truncated` đã nhắc lọc. Việc con tính như dòng riêng (giống `GET /tasks` không `parentOnly`).
- **D7 — Hợp đồng** (tệp MỚI `contracts/src/task-workload.ts`, export ở `index.ts`): query `{ projectId?: idSchema, departmentId?: idSchema }` (rác ⇒ 400); counts `{ activeCount, overdueCount, dueSoon7dCount, inReviewCount, maxOverdueDays: int|null }`; row = `{ employeeId, displayName: string|null } & counts`; response `{ items: row[] (≤100), unassigned: counts|null, truncated: boolean }`; `TASK_WORKLOAD_MAX_ROWS = 100`.
  - **Strict chỉ ở server:** schema xuất ra KHÔNG `.strict()` (zod mặc định bỏ khoá lạ) — FE `getWorkload` parse bằng nó ⇒ WO sau (widget `TEAM_TASKS_TODAY`, REPORTCOUNTS) thêm trường thì FE cũ KHÔNG vỡ. Lớp cứng hoá DTO ở server: repository/service dựng dòng bằng gán từng trường tường minh (không spread hàng DB) + unit service assert `taskWorkloadRowSchema.strict().parse(row)` và `Object.keys(row).sort()` đúng tập 7 khoá (không avatar/email/chức danh/userId).
- **D8 — Không mã lỗi/quyền mới.** Gate `@RequirePermission("read","task")` (cặp sẵn); `projectId` ngoài phạm vi ⇒ 200 rỗng (thu hẹp, không lộ tồn tại — như `GET /tasks`). Handler `getTeamWorkload`, `@Get("workload")` khai NGAY SAU `@Get("my")`, TRƯỚC `@Get(":taskId")`. Trong `tasks.permissions.spec.ts`, CÙNG một lần sửa: (i) thêm `"workload"` vào `APPROVED_GET_PATHS` kèm chú thích «đọc TỔNG HỢP trên CÙNG biểu thức phạm vi, không phải đường danh sách thứ hai»; (ii) thêm `{ handlerName: "getTeamWorkload", action: "read", resourceType: "task" }` vào `GUARDED_MUTATIONS` (metadata + cặp DENY 403/ALLOW unit).
- **D9 — FE.** routeKey `task.team`, path `/tasks/team`, `screenCode: "TASK-SCREEN-TEAM-WORKLOAD"` (khuôn mã ngữ nghĩa như `HR-SCREEN-EMPLOYEE-LIST`; không bịa số SPEC), `titleKey: routeTitle.taskTeam` ở `nav.ts`, gate `TASK.TASK.VIEW`, order 51.2; sidebar «Đội của tôi», icon `users`, group `operation`, order 22. Thứ tự = thứ tự server (quá hạn giảm dần); «Chưa giao» ghim cuối, KHÔNG có liên kết. `displayName = null` ⇒ hiện «(Không rõ tên)». Chỉ hai số có liên kết khớp tuyệt đối: «Quá hạn: N» → `/tasks?assignee=E&overdue=true[&project][&department]` và «Chờ duyệt: N» → `…&status=In Review`. Rỗng (`items=[]` ∧ `unassigned=null`) ⇒ «Đội đang không có việc mở»; lỗi ⇒ thông báo + Thử lại (`refetch`); `truncated` ⇒ dòng nhắc lọc. Bộ lọc dự án/phòng ban dùng lại bộ chọn của `TaskListToolbar.tsx` (phòng ban chỉ hiện khi `useCan` read:department). Mục menu gate `TASK.TASK.VIEW` ⇒ NV @Own cũng thấy và chỉ thấy dòng của chính mình (FE không biết data_scope) — câu hỏi owner ở §6.
- **D10 — Chiếu `displayName` (ratchet danh tính H17).** KHÔNG ghép `u.full_name` vào template `sql` thô (sẽ đẩy `rawSqlIdentity` 15→16 — docblock ratchet: mặc định là SỬA, không nâng pin). Chọn: truy vấn drizzle riêng `task-workload.repository.ts#assigneeNamesTx` chép khuôn `goals.repository.ts#ownerNamesTx` — `select { employeeId: employeeProfiles.id, fullName: users.fullName, … }` join `users` cùng `company_id`, `where company_id = $c and id in (ids)`; hồ sơ hoặc tài khoản xoá mềm ⇒ `null`; KHÔNG hậu tố «(Đã nghỉ)» (màn tải việc, không phải hồ sơ).
  - Thêm 1 dòng `IDENTITY_VERDICTS`: `point: "tasks/task-workload.repository.ts#assigneeNamesTx:users.fullName"`, `basis: "membership"`, `signedBy: "S20-TASK-WORKLOAD-1"`, reason: id tra tên là `main_assignee_employee_id` của CHÍNH các hàng `aggregateTx` vừa trả, đã qua `exists` read-scope của GET /tasks (D1) VÀ vị từ người D2 ⇒ không mở tập tên nào ngoài `assigneeName` mà GET /tasks đã trả cho cùng người xem; CHỈ `full_name`. Bằng chứng: R2/R3/R9 (DENY: không dòng/tên ngoài phạm vi).
  - Mọi basis đã bão hoà ⇒ **nâng `BASIS_CEILINGS.membership` 14 → 15** kèm khối chú thích như các lần nâng trước (lý do · tiền lệ `ownerNamesTx` · FULL gate). `membership` thay vì `scoped-predicate` (25/25): cùng lập luận tiền lệ goals — tập người bị chặn bởi quyền đọc TÀI NGUYÊN (việc), không phải vị từ scope đặt trên chính câu tra tên.
  - `identity-projection-verdicts.ts` nằm ngoài `paths` hiện tại ⇒ bổ sung `paths` (§6/§3 L-plan).
- **D11 — Phát hành (FE tự lên từ master, API deploy tay).** Hai PR nối tiếp từ cùng nhánh gốc:
  - **PR-1 (BE):** contracts + BE + census + verdict + test. Merge, rồi owner deploy API.
  - **PR-2 (FE):** web-core + app (registry/route/sidebar/page). Mở SAU khi PR-1 merge (rebase lên master — squash-merge làm vỡ PR xếp chồng). **Điều kiện merge PR-2:** ĐO được API PROD chứa commit squash của PR-1 (không tin lời «đã deploy»): `curl` `GET /api/v1/tasks/workload` trên PROD (có phiên) trả ≠ 400 ParseUUID, hoặc tem build ở `/health` ⊇ commit PR-1.
  - Lý do: API cũ nhận `/tasks/workload` vào `@Get(":taskId")` ⇒ 400 ParseUUID ⇒ mọi người bấm mục menu mới gặp màn lỗi. Lưới cuối nếu lệch giờ: màn lỗi + Thử lại của D9 (không trắng trang).

## 3. Lát thi công

| Lát | Tệp | Việc |
| --- | --- | --- |
| L-plan | `harness/backlog.mjs` (`paths` của WO) | Commit đầu, TRƯỚC L0: thêm `apps/api/src/tasks/task-core.service.ts` · `apps/api/src/tasks/task-core.repository.ts` · `apps/api/src/tasks/tasks.permissions.spec.ts` · `apps/app/src/i18n/locales/vi/tasks-workux.ts` · `apps/api/test/foundation/identity-projection-verdicts.ts` ⇒ hook `guard-scope` không cảnh báo suốt WO |
| L0 RED | `apps/api/test/integration/s20-task-workload.int-spec.ts` (MỚI, `applyMainPipeline`, `describe.skipIf(!hasDb)`) · `apps/api/src/tasks/task-workload.predicates.spec.ts` · `task-workload.service.spec.ts` | Viết ca §4, chạy ĐỎ trước khi có route |
| L1 contracts | `packages/contracts/src/task-workload.ts` (MỚI) · `index.ts` (+1 dòng export) | D7; build contracts |
| L2 BE lõi | `task-workload.predicates.ts` · `task-workload.repository.ts` · `task-workload.service.ts` (MỚI) · `tasks.module.ts` (providers, khối additive) · `tasks.dto.ts` (`TaskWorkloadQueryDto`) · `tasks.controller.ts` (route `getTeamWorkload`) | D4–D8, D10 |
| L2b BE dùng chung 🔴 FULL gate | `task-core.service.ts` (D1, trích hàm ~10 dòng) · `task-core.repository.ts` (D2: THÊM `buildAssigneeScopeExists` — `buildReadScopeExists` không đổi; `listTx` dùng `taskOverduePredicate`) · `tasks.permissions.spec.ts` (D8: `APPROVED_GET_PATHS` + `GUARDED_MUTATIONS`) · `identity-projection-verdicts.ts` (D10: 1 verdict + trần membership 14→15) | Commit riêng, ghi rõ «FULL gate» trong thân commit (luật amber `harness/policy.md`: commit chạm đường đỏ ⇒ FULL) |
| L3 census | `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` | `ROUTE_CENSUS_WRITE=1` qua run-heavy, KHÔNG sửa tay; chạy lại không cờ ⇒ xanh |
| — | **Ranh giới PR-1 / PR-2 (D11)** | |
| L4 web-core | `lib/task-core-api.ts` (`getWorkload(query)` parse `taskWorkloadResponseSchema` KHÔNG strict) · `lib/query-keys.ts` (`taskKeys.workload(params)`) · `lib/registry.ts` + `registry.spec.ts` · `i18n/locales/vi/nav.ts` (`taskTeam: "Đội của tôi"`) | build web-core |
| L5 app | `routes/tasks/TeamWorkloadPage.tsx` + `TeamWorkloadPage.spec.tsx` (MỚI) · `router.tsx` (`makeModuleRoute` + cây route) · `layouts/workspace/sidebar/task.ts` · snapshot `sidebar-tree.*` (`vitest run -u` đúng tệp spec) · `i18n/locales/vi/tasks-workux.ts` (khoá gốc MỚI `teamWorkload`, không trùng `tasks.ts`) | KHÔNG đụng `apps/app/src/i18n/index.ts` |
| L6 KPI #12 | script Playwright MCP lưu `docs/plans/S20-TASK-WORKLOAD-1/kpi12.*` | Đếm thao tác/chuyển trang (§6 rủi ro) |

## 4. Ca RED — DENY đứng cạnh ALLOW (int-spec, LANE_DB, 2 tenant)

Dữ liệu: tenant A — QL `M` (read:task @Team; **`M` KHÔNG có việc mở nào** — `M` thuộc phạm vi Team của chính mình nên có việc mở sẽ thành dòng thứ 9), đội 8 NV `N1..N8` có việc mở; `N9` trong đội chỉ có việc Done/Cancelled/xoá mềm; NV `E` (@Own); HR `H` (@Company); trưởng đơn vị `D` (read:task @Department trên đơn vị `OU1`), `Z` ∈ `OU1` có việc mở, `Y` ∉ `OU1` có việc mở trong dự án `P`; người ngoài đội `X` có việc mở trong dự án `P`; `M`, `E`, `D` đều là member Active của `P`; 1 việc mở chưa giao trong `P`; tenant B có NV + việc mở. Mọi lời gọi HTTP chạy TUẦN TỰ (`for … await`), không `Promise.all` ⇒ không cần `app.listen(0)`.

| # | DENY | ALLOW đứng cạnh |
| --- | --- | --- |
| R1 | Người không có `read:task` ⇒ 403 | `M` ⇒ 200 |
| R2 | `E` (Own): KHÔNG có dòng `X`, `unassigned = null` dù là member `P` | `E` có đúng 1 dòng = chính mình, số khớp |
| R3 | `M` (Team): `X` KHÔNG xuất hiện (việc trong dự án chung) | `N1..N8` = đúng 8 dòng + `unassigned` ≠ null (vế `IS NULL` của D2 sống ở Team); giao 1 việc mở cho `M` ⇒ `M` thành dòng thứ 9 (rồi hoàn tác) |
| R4 | `N9` (chỉ Done/Cancelled/xoá mềm) KHÔNG xuất hiện | Mở lại 1 việc của `N9` ⇒ `N9` xuất hiện (chiều thuận D3) |
| R5 | `H`/`M` tenant A: 0 dòng của tenant B, kể cả `?projectId=<dự án B>` ⇒ `items=[]` | Người xem tenant B thấy dòng tenant B |
| R6 | `?projectId=abc` ⇒ 400 | `?projectId=P` ⇒ chỉ đếm việc trong `P` |
| R7 | `GET /tasks/workload` KHÔNG bị `:taskId` nuốt (không 400 ParseUUID) | 200 đúng schema `taskWorkloadResponseSchema.strict()` từng dòng (khoá đúng 7, không email/avatar/userId) |
| R8 | — | `H` (Company) thấy cả `X` và `Y` |
| R9 | `D` (Department): `Y` (ngoài `OU1`, việc mở trong `P` mà `D` là member) KHÔNG xuất hiện, tên `Y` không có trong response | `Z` xuất hiện, số của `Z` khớp `GET /tasks?assigneeEmployeeId=Z…` như P1; `unassigned` ≠ null |
| P1 | — | **Khớp số**: với mỗi dòng E của `M` và của `D` (có/không `projectId`): `overdueCount` = len(`GET /tasks?assigneeEmployeeId=E&overdue=true`); `inReviewCount` = len(`…&status=In Review`); `activeCount` = len(`GET /tasks?assigneeEmployeeId=E`) lọc ∉ Done/Cancelled; `dueSoon7dCount` = len(`…&dueFrom=now&dueTo=windowEnd−1ms`) lọc mở ∧ ¬quá hạn |
| P2 | Việc hạn hôm-nay+8 00:00 (giờ công ty) KHÔNG tính sắp hạn | Hạn hôm-nay+7 23:59 tính; việc trễ 3 ngày công ty ⇒ `maxOverdueDays = 3` |

Unit:
- `task-workload.predicates.spec.ts`: `dueSoonWindowEnd` qua `Asia/Ho_Chi_Minh` + 1 tz âm (biên nửa đêm); neo chéo D2 (render `buildReadScopeExists` chứa nguyên văn render `buildAssigneeScopeExists`); `buildWorkloadPersonPredicate`: Company/System ⇒ không vị từ, Team/Department ⇒ SQL render chứa `main_assignee_employee_id IS NULL OR`, Own ⇒ KHÔNG chứa vế `IS NULL` (DENY đứng cạnh ALLOW ở tầng SQL, không chỉ ở kiểm tra TS).
- `task-workload.service.spec.ts`: tách nhóm NULL, cắt 101→100 + `truncated=true`, Own ⇒ `unassigned=null` (phòng thủ kép); thứ tự `resolveCompanyTz` trước `withTenant` (D5); dòng `strict().parse` + đúng tập khoá (D7); sắp ổn định theo tên trong nhóm cùng số (D6).
- `tasks.permissions.spec.ts`: `getTeamWorkload` trong `GUARDED_MUTATIONS` + `APPROVED_GET_PATHS` (D8).

FE (`TeamWorkloadPage.spec.tsx`): thứ tự theo quá hạn; href «Quá hạn: 3» đúng `assignee/overdue/project/department`; «Chưa giao» không link; `displayName=null` ⇒ «(Không rõ tên)»; rỗng ⇒ «Đội đang không có việc mở»; lỗi ⇒ bấm Thử lại gọi lại API (DENY: không có nút khi thành công); `truncated` hiện nhắc; response có khoá lạ ⇒ vẫn render (parse không strict). Registry: `task.team` path/screenCode/gate.

## 5. Hồi quy (mọi lệnh qua `run-heavy.sh A …`, theo tệp)

- API unit: `src/tasks/tasks.permissions.spec.ts` · `task-workload.*.spec.ts` · `tasks.service.spec.ts`.
- API int (LANE_DB, đọc «Test Files» — skipped = KHÔNG đạt): `s20-task-workload.int-spec.ts` · `task-read-paths-scope.int-spec.ts` · `task-core.int-spec.ts` · `task-core-tenant-deny.int-spec.ts` · `task-qa1-permission-matrix.int-spec.ts` (D1 trích hàm phạm vi của GET /tasks list/my/detail) · int-spec đang dùng `overdue=true` của `GET /tasks` (grep `overdue` trong `test/integration`; D4 đổi `listTx`) · `tasks-core-param-uuid.int-spec.ts`. (`buildReadScopeExists` không đổi nhờ D2 ⇒ không cần chạy int-spec của 9 người gọi H3b; neo chéo unit là lưới.)
- Foundation: `route-guard-coverage.e2e-spec.ts` (ghi rồi kiểm) · `route-http-coverage.e2e-spec.ts` (kỳ vọng 690/690; nâng sàn lên 690 là tuỳ chọn, ngoài `paths`) · `param-uuid-ratchet.unit-spec.ts` · **`identity-projection-ratchet.unit-spec.ts`** (D10: `rawSqlIdentity` vẫn 15, verdict mới khớp điểm, membership 15/15) · openapi-docs e2e.
- Build/type: contracts + web-core build (`TURBO_FORCE=1`) · `@mediaos/api typecheck` · `@mediaos/app typecheck` · eslint các tệp chạm.
- FE (PR-2): `registry.spec.ts` · `sidebar-registry.snapshot.spec.ts` · `task-list-search.spec.ts` · `TeamWorkloadPage.spec.tsx`.
- Trước PR-1: `bash harness/check.sh --all --lane-db` + FULL gate (security-reviewer + database-reviewer + silent-failure-hunter) TRƯỚC khi mở PR. PR-2: LIGHT gate (typescript-reviewer + react-reviewer + quality-gate) + `check.sh --all`.

## 6. Rủi ro · nợ · câu hỏi owner

- **KPI #12 cần trình duyệt thật**: phiên báo «Browser disconnected» ⇒ lượt đếm Playwright có thể phải hoãn; khi đo: xác minh từ `/` tới `/tasks/team` là 1 chuyển trang (nếu `/` không có sidebar Công việc thì số thật là 2 — ghi đúng số, sửa bảng kèm lý do hoặc đề xuất lối tắt ở trang chủ thành WO riêng).
- **Phát hành hai bước (D11)**: PR-2 chờ API PROD đo được ⊇ PR-1 — nếu owner chưa deploy, PR-2 đứng chờ, không merge.
- **Câu hỏi owner (không chặn, đã chọn mặc định có chủ ý):** (Q1) ai thấy mục menu «Đội của tôi» — mặc định mọi người có `TASK.TASK.VIEW` (NV @Own thấy 1 dòng của mình); đổi sang gate riêng cần quyền/cờ mới ⇒ WO sau. (Q2) việc loại workflow (`WORKFLOW_TASK_TYPES`) có tính là tải việc không — mặc định CÓ, khớp GET /tasks; loại ra thì phải loại ở cả bộ lọc danh sách để P1 còn khớp.
- Trần `BASIS_CEILINGS.membership` 14→15 (D10) là nới có chủ đích — reviewer FULL gate phải ký riêng điểm này.
- «Chưa giao» không bấm được: `GET /tasks` chưa có bộ lọc «chưa giao» (nợ, WO riêng).
- `activeCount`/`dueSoon7dCount` không có liên kết: danh sách chưa có bộ lọc «chỉ việc mở» và `dueFrom/dueTo` của URL là NGÀY — nợ.
- `isOverdue` trong `TASK_CORE_SELECT` vẫn viết tay (`task-core.repository.ts:217`) — gom về `taskOverduePredicate` ở WO sau (đụng mọi projection).
- `buildReadScopeExists` vẫn tự chứa nhánh (A) (D2 neo chéo bằng unit, không gộp) — gộp thành dùng `buildAssigneeScopeExists` là WO riêng có hồi quy đủ 9 người gọi (H3b).
- N > cỡ trang của `/tasks` ⇒ «thấy đúng N» phải qua nhiều trang (danh sách không có tổng).
- SPEC-06 chưa có mã màn hình cho «Đội của tôi» ⇒ cập nhật spec (doc) sau.
- Widget `TEAM_TASKS_TODAY` dùng lại endpoint này — WO riêng (hợp đồng không strict ở FE cho phép thêm trường).
- `paths` WO: bổ sung ở commit L-plan (§3) — không đợi lúc đóng dấu sổ.

## 7. Phản biện (review đối kháng v1 → v2)

| # | Điểm review | Xử lý |
| --- | --- | --- |
| 1 | HIGH — `u.full_name` trong `sql` thô vượt `rawSqlIdentity` | **Nhận.** Đo: mọi basis bão hoà (H17). Chọn phương án (a) biến thể: tên qua drizzle `assigneeNamesTx` khuôn `ownerNamesTx` + verdict `membership` + nâng trần 14→15 có chú thích (D10); `rawSqlIdentity` giữ 15. **Bác phương án (b)** «dùng lại `assigneeWorkload` của projects.repository»: đó chính là template `sql` thô (`u.full_name`, `projects.repository.ts:868`) — một trong 15 vùng mù, lọc theo MỘT dự án, không theo phạm vi người xem; dùng lại là kéo vùng mù sang endpoint mới. Bác (c) (15→16): ratchet nói mặc định là sửa. Thêm ratchet vào §5, verdicts vào `paths`. |
| 2 | HIGH — sửa `buildReadScopeExists` lan sang 9 người gọi (có đường ghi) | **Nhận phương án (a).** `buildReadScopeExists` không đụng; `buildAssigneeScopeExists` đứng riêng + unit neo chéo nguyên văn (D2). L2b vẫn đánh dấu FULL gate (D1 + verdicts). |
| 3 | MEDIUM — AND nhánh (A) ở Team/Department xoá nhóm NULL | **Nhận.** Vị từ chính xác ghi vào D2 (`IS NULL OR …` cho Team/Department, chỉ (A) cho Own) + unit SQL-level + R3/R9 kiểm `unassigned ≠ null`. |
| 4 | MEDIUM — `resolveCompanyTz` lồng `withTenant` | **Nhận.** Đo đúng: hàm tự mở `withTenant` (`dashboard-company-tz.util.ts:17-25`). D5 ép gọi TRƯỚC `withTenant` + unit thứ tự gọi. Không thêm biến thể `…Tx` (YAGNI — đổi tệp dashboard ngoài `paths`). |
| 5 | MEDIUM — thiếu `GUARDED_MUTATIONS` | **Nhận.** D8 (ii), cùng lần sửa với `APPROVED_GET_PATHS`. |
| 6 | MEDIUM — thiếu ca Department | **Nhận.** R9 (DENY `Y` ngoài đơn vị dù chung dự án · ALLOW `Z` khớp số) + `D` trong P1. |
| 7 | MEDIUM — thứ tự deploy + strict làm vỡ FE cũ | **Nhận.** D11 tách PR-1 (BE) / PR-2 (FE), PR-2 merge khi ĐO được API PROD ⊇ PR-1. D7: strict chỉ ở server (gán tường minh + unit `strict().parse`), FE parse không strict. Chọn hai PR thay vì cờ ẩn menu: không có hạ tầng feature-flag FE sẵn — thêm cờ là bề mặt mới cho một khoảng chờ vài giờ. |
| 8 | LOW — R3 đếm 9 nếu `M` có việc mở; `Promise.all` cần `listen(0)` | **Nhận.** Fixture ghi rõ `M` không có việc mở + ca thuận `M` thành dòng 9; mọi lời gọi tuần tự ⇒ không cần `listen(0)` / ratchet supertest-listen. |
| 9 | LOW — menu cho NV @Own; việc workflow có đếm không | **Nhận** dưới dạng quyết định mặc định + câu hỏi owner Q1/Q2 (§6, D3, D9). |
| 10 | LOW — `paths` thiếu, hoãn tới lúc đóng dấu | **Nhận.** Commit L-plan đầu tiên bổ sung 5 đường (§3), trước L0. |

## 8. Sổ vết (11/11/2026, chuỗi A)

- **RED:** lượt `red1` (trước khi có mã) — 3 tệp spec ĐỎ (không nạp được `task-workload.predicates` / `task-workload.service`): predicates 13 ca · service 7 ca · int-spec 11 ca chưa chạy được. Kiểm đột biến sau GREEN: bỏ `personPredicate` ở service ⇒ int-spec **3/11 ca ĐỎ** (R2 · R3 · R9 — các ca DENY «người ngoài phạm vi / Chưa giao ở Own»), 8 ca ALLOW vẫn xanh ⇒ ca DENY có răng; đã hoàn tác.
- **GREEN:** unit 155/155 (predicates · service · permissions · identity ratchet) · int-spec `s20-task-workload` 11/11 (không skip, LANE_DB `mediaos_w4a`) · hồi quy BE 28 tệp / 592 ca xanh (task-core · tenant-deny · qa1-permission-matrix · read-paths-scope · param-uuid · subtask-counting · `src/tasks`) · census: `route-guard-coverage` ghi lại 689→690 (chỉ thêm `TasksController#getTeamWorkload`), `route-http-coverage` 690/690, `param-uuid-ratchet` xanh · `rawSqlIdentity` giữ 15, `membership` 15/15.
- **FE:** `TeamWorkloadPage.spec` 11/11 · `registry.spec` 169 · snapshot sidebar cập nhật đúng 1 mục `task.team` · `task-list-search.spec` xanh · typecheck API + app xanh · eslint sạch.
- **Đo trang danh sách (§ đề bài):** `/tasks?assignee=&overdue=true&status=&project=&department=` ĐÃ được `validateTaskListSearch`/`toTaskListQuery` hỗ trợ (H11) ⇒ KHÔNG sửa `task-list-search*`.
- **Lệch kế hoạch có chủ ý:** (1) commit L-plan (thêm `paths` vào `harness/backlog.mjs`) KHÔNG làm — lệnh giao cấm sửa backlog; các tệp ngoài `paths` đã chạm: `task-core.service.ts` · `task-core.repository.ts` · `tasks.permissions.spec.ts` · `identity-projection-verdicts.ts` · `i18n/locales/vi/tasks-workux.ts` ⇒ brain cập nhật `paths` khi đóng dấu sổ. (2) Bộ chọn dự án/phòng ban: toolbar danh sách là JSX nội tuyến ⇒ trang gọi trực tiếp cùng hook/khoá truy vấn, KHÔNG đụng `TaskListToolbar`. (3) Đồng hồ: service tiêm được (`WORKLOAD_CLOCK`, mặc định giờ thật) và repo nhận `now`/`windowEnd` làm tham số ⇒ biên quá hạn + cửa sổ sắp hạn dùng CÙNG một thời điểm (chống đỏ theo giờ). Int-spec dùng hạn cách xa nửa đêm trừ ca P2 (biên +7 23:59 / +8 00:00 tính từ giờ công ty lúc chạy — có thể lệch nếu lượt chạy cắt qua nửa đêm giờ công ty; rủi ro đã ghi). (4) `done_when` nói «một truy vấn GROUP BY» — thực tế 1 truy vấn aggregate + 1 truy vấn tra tên theo lô, cùng `withTenant` (D6/D10, lý do: ratchet danh tính).
- **Phát hành:** PR-1 (BE) = commit `a2724c29`; PR-2 (FE) = commit kế. Tách PR theo D11 là việc brain khi mở PR (cùng nhánh, hai commit).
- **Sổ vết KPI:** (điền sau)
- **Nợ cho gate/lane khác:** FULL gate BE chưa chạy (security-reviewer · database-reviewer · silent-failure-hunter) — phải ký riêng nâng trần `membership` 14→15 · `check.sh --all --lane-db` chưa chạy ở bước này · KPI #12 trình duyệt thật · SPEC-06 chưa có mã màn hình · PR-2 chờ API PROD ⊇ PR-1 (D11; điều kiện đo qua `/health` commit + `git merge-base --is-ancestor`, curl có phiên chỉ dành cho owner vì 2FA PROD).

## 9. Sổ vết vá review (11/11/2026, chuỗi A)

- **#1 [MEDIUM] a11y bảng:** ô người → `<th scope="row">`, tiêu đề cột `scope="col"`, `<caption class="sr-only">`, liên kết đếm `aria-label` «Quá hạn: 3 — {tên}». Ca mới `a11y: …` (rowheader/columnheader/table name/link name) — đỏ trên mã cũ (không có caption/rowheader), xanh sau vá.
- **#2 [LOW] loading/truncated:** khoá i18n `teamWorkload.loading`; `truncated` nội suy `{{max}}` từ `TASK_WORKLOAD_MAX_ROWS` (contract); `placeholderData: keepPreviousData`. Hai ca mới (loading có chữ · truncated lấy trần từ contract).
- **#3 [HIGH] santa — thiếu ca khoá `scopeExists`:** đã tự đọc mã: đúng (Team/Department chỉ có nhánh B của `scopeExists` giới hạn «Chưa giao»). Thêm int-spec R10 (dự án Q không thành viên + việc cá nhân; M/D đếm 1, Company đếm 3) và unit `scopeExists` = đúng sentinel `exists`. Đột biến `scopeExists: undefined` ⇒ đúng 1 ca đỏ ở unit và 1 ca (R10) ở int-spec; đã hoàn tác.
