```yaml
wo: S3-FE-REGISTRY-1
zone: red
generated_by: auto-loop
reconciled_at: "cd7c8d3"
lanes:
  - id: beCapExpose
    task: "CROWN (RED-PATH, FULL gate + security review): APPEND vào SENSITIVE_CAPABILITY_ALLOWLIST (apps/api/src/permission/permission.service.ts L29) 4 cặp gate FE: 'view-own:attendance','view-team:attendance','view-company:attendance','view:leave' — APPEND vào Set (GIỮ 'view:audit-log', KHÔNG rewrite). KHÔNG thêm view-own:leave/approve:leave (đã non-sensitive theo leave-permissions.const → đã lộ). Chỉ mở CỜ HIỂN THỊ (UI-hint); enforcement (can()/PermissionGuard per-resource) KHÔNG đổi. RED int-spec TRƯỚC ở apps/api/src/auth/auth-me-capabilities.int.spec.ts: role được grant view-team:attendance → /auth/me.capabilities CÓ 4 cặp; user KHÔNG grant → VẮNG; wildcard *:* KHÔNG kế thừa cặp nhạy cảm (sensitive gate); view:audit-log vẫn còn."
    builder: backend-builder
    paths:
      - apps/api/src/permission/permission.service.ts
      - apps/api/src/auth/auth-me-capabilities.int.spec.ts
  - id: feRegistryApi
    task: "1 LANE DUY NHẤT (web-core + apps/app cùng cây tuần tự, KHÔNG worktree song song). CROWN (pair-drift): (a) SỬA PERMISSION_CODE_TO_PAIR (packages/web-core/src/lib/registry.ts L111-128): ATT.ATTENDANCE.VIEW_OWN→'view-own:attendance', VIEW_TEAM→'view-team:attendance', VIEW_COMPANY→'view-company:attendance'; LEAVE.REQUEST.VIEW_OWN→'view-own:leave', LEAVE.REQUEST.VIEW→'view:leave', LEAVE.REQUEST.APPROVE→'approve:leave' (giữ). Bỏ 'read:attendance'/'read:leave'. Sửa comment L107-108 (bỏ giả định sai 'gộp cùng cặp đọc' — mỗi scope-level = cặp riêng is_sensitive, pair-as-gate). (b) Sửa registry.spec.ts:82-107 dùng cặp company-admin THẬT rồi vẫn khẳng định 7 app. (c) DENY-PATH RED-TRƯỚC ở CẢ packages/web-core/src/lib/registry.spec.ts LẪN apps/app/src/test/registry-guard.spec.tsx (employee/manager/hr; fixtures populate session.modules + UserPermission.scopes THẬT). (d) ADD route+sidebar ATT scoped (/attendance/team-records VIEW_TEAM, /attendance/records company VIEW_COMPANY) gate requiredAny theo cặp đúng, KHÔNG hard-code role. (e) TẠO attendance-api.ts (typed apiFetch qua @mediaos/contracts attendance schemas, KHÔNG nhận/forward company_id, KHÔNG đụng token-storage) + export ở index.ts; leaveApi đã có → chỉ bổ sung nếu matrix cần. (f) APPEND query-keys (teamRecords, records.detail, myRecords) KHÔNG rename key cũ + mutation invalidation matrix (check-in/out→today+my-records; approve→list+detail+balance). DEFER: KHÔNG dựng leaveApi.policy, /leave/settings/policies giữ ModulePlaceholder, KHÔNG thêm /leave/calculate (đã tồn tại)."
    builder: frontend-builder
    paths:
      - packages/web-core/**
      - apps/app/**
acceptanceChecks:
  - "registry.ts PERMISSION_CODE_TO_PAIR: ATT.ATTENDANCE.VIEW_OWN→'view-own:attendance', VIEW_TEAM→'view-team:attendance', VIEW_COMPANY→'view-company:attendance', LEAVE.REQUEST.VIEW_OWN→'view-own:leave', LEAVE.REQUEST.VIEW→'view:leave', LEAVE.REQUEST.APPROVE→'approve:leave'; KHÔNG còn 'read:attendance'/'read:leave'; comment L107-108 đã sửa (bỏ 'gộp cùng cặp đọc')."
  - "permission.service.ts SENSITIVE_CAPABILITY_ALLOWLIST = Set chứa ĐÚNG {'view:audit-log' (giữ), 'view-own:attendance','view-team:attendance','view-company:attendance','view:leave'}; view-own:leave & approve:leave KHÔNG có mặt (đã non-sensitive theo leave-permissions.const, đã lộ); getAllowlistedSensitiveCapabilities/getCapabilities không đổi thuật toán."
  - "registry.spec.ts test 'getVisibleApps 7 app company-admin' dùng cặp THẬT (view-own/view-team/view-company:attendance + view-own:leave + view:leave + approve:leave), assert đúng 7 app gồm attendance + leave; KHÔNG còn caps giả read:attendance/read:leave."
  - "Deny-path (registry.spec.ts + registry-guard.spec.tsx): employee → evaluateRouteAccess(/attendance/team-records, /attendance/records-company, /leave/approvals) KHÔNG ALLOW (SHOW_403/404) VÀ filterSidebarItems ẨN item Team/Company/approvals; manager(view-team:attendance) THẤY Team KHÔNG Company; hr(view-company:attendance) THẤY Company; fixtures có session.modules + UserPermission.scopes populate THẬT (≠[])."
  - "ROUTE_REGISTRY + sidebar-registry.ts có att.team-records (/attendance/team-records requiredAny ['ATT.ATTENDANCE.VIEW_TEAM']) + att.records (/attendance/records requiredAny ['ATT.ATTENDANCE.VIEW_COMPANY']); leave.approvals giữ; KHÔNG hard-code role; requiredScopes trên cặp sensitive KHÔNG dùng làm cổng-cứng runtime."
  - "packages/web-core/src/lib/attendance-api.ts tồn tại, typed 100% qua @mediaos/contracts (attendanceTodayV2/checkIn/checkOut/attendanceRecordListResponse/attendanceRecordDetail), KHÔNG tham số company_id, KHÔNG import token-storage (chỉ apiFetch); export trong packages/web-core/src/index.ts."
  - "query-keys.ts APPEND teamRecords + records.detail (+ myRecords) — grep xác nhận myToday/mySummary/list/detail (attendance) + requests.detail/balances.my (leave) KHÔNG bị đổi tên; mutation invalidation matrix có mặt (check-in/out→today+my-records; approve→list+detail+balance)."
  - "DEFER tuân thủ: KHÔNG có leaveApi.policy; route /leave/settings/policies vẫn ModulePlaceholder; KHÔNG thêm /leave/calculate mới (đã có sẵn); không phát sinh lane/route ngoài spec."
  - "pnpm --filter @mediaos/web-core test + apps/app registry-guard/ProtectedRoute test XANH; auth-me-capabilities.int.spec.ts XANH trên LANE_DB cô lập; pnpm typecheck XANH."
  - "DoD §8: có test (deny-path RED + happy), permission guard giữ ở server (không nới enforcement), FE loading/error/empty không regress, cập nhật harness/backlog.mjs; 2 lane crown → người duyệt red-zone TRƯỚC merge."
testTasks:
  - "RED deny-path (packages/web-core/src/lib/registry.spec.ts): ma trận employee/manager/hr trên evaluateRouteAccess cho /attendance/team-records + /attendance/records(company) + /leave/approvals; fixtures makePerms với scopes THẬT (Own/Team/Company) + session.modules populate (ATT/LEAVE active) — assert employee KHÔNG ALLOW, manager Team-only, hr Company."
  - "RED deny-path (apps/app/src/test/registry-guard.spec.tsx): filterSidebarItems với ATT_SIDEBAR mở rộng (team-records/records) → employee ẩn item Team/Company + leave approvals; manager thấy Team ẩn Company; hr thấy Company; getVisibleApps giữ attendance+leave hiển thị cho company-admin."
  - "Happy-path fix (registry.spec.ts:82-107): caps = cặp company-admin THẬT → getVisibleApps trả đúng 7 app (attendance,dashboard,hr,leave,notifications,system,tasks)."
  - "Backend int-spec cô lập (apps/api/src/auth/auth-me-capabilities.int.spec.ts, chạy với LANE_DB): grant role view-team:attendance → /auth/me.capabilities CÓ 4 cặp sensitive ATT/LEAVE; user KHÔNG grant → VẮNG; DENY/*:* KHÔNG kế thừa cặp nhạy cảm; view:audit-log vẫn hiện diện (không regress S2-AUTH-BE-5)."
  - "Contract/type test (typecheck): attendanceApi return types khớp @mediaos/contracts attendance schemas; query-keys mới + invalidation matrix compile sạch (KHÔNG @ts-ignore)."
steps:
  - "Lane beCapExpose TRƯỚC (dependency logic + crown/security): RED int-spec auth-me-capabilities.int.spec.ts (granted vs non-granted vs wildcard *:*), rồi APPEND 4 cặp sensitive ATT/LEAVE view vào SENSITIVE_CAPABILITY_ALLOWLIST (append Set, giữ view:audit-log). GREEN trên DB cô lập (bash scripts/lane-db-setup.sh + LANE_DB)."
  - "Chốt thiết kế scope (crown, owner/security): getCapabilityScopes lọc !isSensitive → /auth/me.scopes KHÔNG mang 4 cặp sensitive → requiredScopes KHÔNG được là cổng-cứng runtime trên route ATT sensitive-pair (sẽ 403 cả manager/hr). Pair-as-gate là cổng THẬT (view-team:attendance = cổng Team). requiredScopes chỉ giữ ở fixture test/defense-in-depth, KHÔNG enforce runtime cho cặp sensitive."
  - "Lane feRegistryApi — viết DENY-PATH RED TRƯỚC (registry.spec.ts + registry-guard.spec.tsx): employee(view-own:attendance+view-own:leave, Own)/manager(view-team:attendance, Team)/hr(view-company:attendance, Company); fixtures session.modules + UserPermission.scopes populate THẬT (KHÔNG [])."
  - "Sửa PERMISSION_CODE_TO_PAIR (6 mapping ATT/LEAVE) + comment L107-108 → GREEN deny-path."
  - "Sửa registry.spec.ts:82-107 happy-path caps = cặp company-admin THẬT, vẫn 7 app gồm attendance+leave."
  - "ADD ROUTE_REGISTRY + sidebar-registry.ts item ATT scoped (att.team-records/att.records) gate requiredAny cặp đúng; giữ leave.approvals; KHÔNG hard-code role; app inactive/hidden → getVisibleApps/filterSidebarItems tự ẩn."
  - "TẠO packages/web-core/src/lib/attendance-api.ts (today/check-in/check-out/my-records/team-records/records/records.detail) typed qua @mediaos/contracts (attendanceTodayV2Schema, checkInSchema, checkOutSchema, attendanceRecordListResponseSchema, attendanceRecordDetailSchema); export ở index.ts. leaveApi giữ nguyên trừ khi matrix cần approve/reject wrapper."
  - "APPEND query-keys.ts (teamRecords, records.detail, myRecords) KHÔNG rename myToday/mySummary/list/detail; định nghĩa mutation invalidation matrix (helper/const): check-in/out→[attendanceKeys.myToday, myRecords]; leave approve→[leaveKeys.requests.list, requests.detail, balances]."
  - "pnpm --filter @mediaos/web-core test + apps/app registry/guard test GREEN; pnpm typecheck GREEN (contracts build trước qua turbo)."
  - "FULL gate (security-reviewer + typescript-reviewer + react-reviewer + santa-method cho crown); owner chốt red-zone TRƯỚC merge (cả 2 lane crown)."
```

## GAP-ANALYSIS (đối chiếu code 2026-07-01)

(1) registry.ts L114-118 vẫn map VIEW_OWN/TEAM/COMPANY→`read:attendance` và VIEW_OWN/VIEW→`read:leave` — cả hai KHÔNG có trong catalog (`attendance-permissions.const` chỉ có `view-own/view-team/view-company:attendance`; `leave-permissions.const` dùng `view-own:leave`/`view:leave`; `read:leave` chỉ là legacy mig 0063 KHÔNG grant cho role mới; `read:attendance` chưa từng tồn tại) → ATT/LEAVE app hiện ẩn với MỌI user.

(2) `permission.service.ts` L29 `SENSITIVE_CAPABILITY_ALLOWLIST = {'view:audit-log'}` → 4 cặp view sensitive ATT/LEAVE bị `getCapabilities`/`getAllowlistedSensitiveCapabilities` lọc khỏi `/auth/me` → dù FE map đúng vẫn ẩn.

(3) `registry.spec.ts:82-107` pin caps giả `read:attendance`/`read:leave` → xanh-giả.

`leaveApi` ĐÃ tồn tại (`packages/web-core/src/lib/leave-api.ts`, header S3-FE-LEAVE-1, có `calculate` + contract `leaveCalculateResponseSchema`) → WO này KHÔNG rebuild leaveApi; DEFER `/leave/calculate` của `done_when` đã lỗi-thời (contract đã có) nhưng vẫn KHÔNG thêm mới. `attendanceApi` CHƯA có → tạo mới; contracts `attendance.ts` đã đủ schema (`today V2`/`check-in`/`out`/`list`/`detail`) nên buildable trong paths web-core.

## INVARIANT/RỦI RO #1 (crown, cần owner+security chốt)

`getCapabilityScopes` (`permission.service.ts` L337) lọc `!g.isSensitive` ⇒ `/auth/me.scopes` KHÔNG bao giờ mang 4 cặp sensitive ATT (`view-team/view-company:attendance`) hay `view:leave`. Do đó `requiredScopes:[Team]/[Company]` KHÔNG được dùng làm CỔNG-CỨNG runtime cho route sensitive-pair: `checkRequirement` với `requiredScopes>0` + `scopes` rỗng → `NO_SCOPE` ⇒ 403 CẢ manager/hr.

Hiện store chỉ lưu `capabilities` (auth store `setUser(user,capabilities)`); `buildPermissionCheckerFromStore` + `buildSessionFromStore` (`ProtectedRoute.tsx`) hard-code `scopes:[]/modules:[]` ⇒ BẤT KỲ route nào set `requiredScopes` sẽ 403-toàn-bộ ở runtime.

**KẾT LUẬN:** gate scope-level bằng PAIR-AS-GATE (cặp riêng cho từng level = cổng thật; `VIEW_TEAM` tự chặn employee vì thiếu `view-team:attendance`). `requiredScopes` CHỈ giữ trong fixture deny-path test (populate scopes THẬT để chứng minh defense-in-depth) — KHÔNG gắn hard-gate runtime trên route sensitive-pair. Nếu muốn defense-in-depth runtime: phải wire `store.scopes+modules` từ `/me` VÀ cặp gating phải NON-sensitive (vd `approve:leave` scope Team/Company — có trong `/me.scopes`) — chỉ áp cho cặp non-sensitive.

## RỦI RO #2 (leave-calendar team/company)

`done_when` nhắc deny-path `/leave/calendar(team/company)` NHƯNG allowlist explicit (4 cặp) + `PERMISSION_CODE_TO_PAIR` explicit KHÔNG bao gồm cặp `view-team:leave-calendar`/`view-company:leave-calendar` (đều `is_sensitive` theo `leave-permissions.const`). Nếu thêm route `/leave/calendar` team/company gate bằng cặp đó mà KHÔNG allowlist → ẩn với CẢ hr (vỡ case c).

**ĐỀ XUẤT (chốt owner):** hoặc (i) mở rộng append-only cùng nguyên tắc (thêm `view-team/view-company:leave-calendar` vào allowlist + mapping) — nhất quán, hoặc (ii) DEFER route calendar team/company sang WO leave-approvals/calendar, WO này chỉ khẳng định pair-as-gate ở tầng checker cho leave-calendar (test với caps explicit). Mặc định plan: giữ scope acceptance CỐT LÕI trên cặp ATT + `view:leave` (explicit `done_when`); leave-calendar team/company là điểm mở → không tự thêm để chống scope-creep.

## VERIFY/GATE

Chạy trên DB cô lập (`CLAUDE.md §9.5` — `bash scripts/lane-db-setup.sh <lane>` + `export LANE_DB`) cho int-spec backend (drizzle migrator đơn điệu; DB chung → xanh/đỏ-giả). FULL gate (permission/auth/crown): `security-reviewer` + `typescript-reviewer` + `react-reviewer`, `+santa-method` cho 2 lane crown. Lưu ý (memory): agent `silent-failure-hunter` KHÔNG tồn tại ở repo này → bỏ qua/route reviewer sẵn có. Cả 2 lane RED-zone → auto-merge tắt, người chốt trước merge. Thứ tự: `beCapExpose` (crown/security, dependency hiển thị) TRƯỚC `feRegistryApi` (2 lane KHÔNG chồng path: `apps/api/src/permission` + `apps/api/src/auth` int-spec vs `packages/web-core` + `apps/app`).

## HOT-FILE & APPEND (KHÔNG rewrite)

- `permission.service.ts` `SENSITIVE_CAPABILITY_ALLOWLIST` = APPEND vào Set (giữ `view:audit-log`)
- `registry.ts` `PERMISSION_CODE_TO_PAIR` = sửa 6 dòng ATT/LEAVE (fix bug, không phải append)
- `query-keys.ts` + `attendanceKeys`/`leaveKeys` = APPEND key mới KHÔNG rename
- `index.ts` web-core = APPEND export `attendanceApi`
- `sidebar-registry.ts` `ATT_SIDEBAR` + `ROUTE_REGISTRY` = APPEND item/route ATT scoped

## OUT-OF-SCOPE (chống scope-creep)

- KHÔNG dựng `leaveApi.policy`
- `/leave/settings/policies` giữ `ModulePlaceholder`
- KHÔNG thêm `/leave/calculate` (đã có)
- KHÔNG wire `store.scopes`/`modules` runtime (giữ fallback an toàn `modules:[]` ở `ProtectedRoute`) trừ khi owner yêu cầu defense-in-depth
- KHÔNG migration (mig 0454/0455 seed ATT/LEAVE permission đã có — thay đổi chỉ là code allowlist, KHÔNG thêm row permission)
- KHÔNG có lane `db-migration`

## SPEC THẮNG CODE

`done_when` nói "attendanceApi + leaveApi" nhưng `leaveApi` đã ship (S3-FE-LEAVE-1) → coi `leaveApi` là ĐÃ CÓ, WO tập trung `attendanceApi` + registry pair-fix + backend allowlist + invalidation matrix; ghi rõ lệch để builder không rebuild `leaveApi`.
