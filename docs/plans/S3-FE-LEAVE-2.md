```yaml
wo: S3-FE-LEAVE-2
zone: yellow
generated_by: auto-loop
reconciled_at: "679582a"
lanes:
  - id: fe-leave-2-core
    task: "[web-core / crown: đổi cổng permission + client workflow duyệt] (a) Thêm 3 method vào packages/web-core/src/lib/leave-api.ts: listRequests(query?: Partial<PendingLeaveRequestListQuery>): Promise<LeaveManagementListResponse> → GET /leave/requests validate leaveManagementListResponseSchema; approveRequest(id, note?): Promise<LeaveRequestDetailView> → POST /leave/requests/:id/approve validate leaveRequestDetailViewSchema; rejectRequest(id, reason): Promise<LeaveRequestDetailView> → POST /leave/requests/:id/reject validate leaveRequestDetailViewSchema. (b) query-keys.ts: leaveInvalidation.approve & reject BỎ leaveKeys.balances.all — chỉ còn leaveRequestsListPrefix + leaveKeys.requests.detail(requestId) (approver KHÔNG giữ balance key của requester). (c) registry.ts: leave.approvals route-meta requiredAnyPermissions ['LEAVE.REQUEST.APPROVE','LEAVE.REQUEST.VIEW'] → CHỈ ['LEAVE.REQUEST.VIEW'] (= view:leave, khớp BE GET /leave/requests). (d) cập nhật leave-api.spec / query-keys.spec / registry.spec."
    builder: frontend-builder
    paths: ["packages/web-core/**"]
  - id: fe-leave-2-page
    task: "[apps/app / crown: workflow phê duyệt FE] depends_on fe-leave-2-core. (a) Dựng apps/app/src/routes/leave/LeaveApprovalPage.tsx: pending request table (leaveApi.listRequests, queryKey leaveKeys.requests.list(params), enabled=canView view:leave) hiện requester(employeeCode/fullName/department)+leaveType+period+totalDays+status; approval detail drawer/modal render TỪ hàng đã chọn (KHÔNG có endpoint approver-detail → không fetch thêm); approve confirmation + reject confirmation với reject reason textarea BẮT BUỘC (block submit khi rỗng, map rejectLeaveRequestSchema min1); onSuccess dùng leaveInvalidation.approve/reject; đủ loading/empty/error/forbidden. (b) router.tsx: leaveApprovalsRoute thay ModulePlaceholder → LeaveApprovalPage. (c) sidebar-registry.ts leave.approvals requiredAnyPermissions → ['LEAVE.REQUEST.VIEW'] (view:leave). (d) GATE: canView=useCan('view','leave'); nút approve=useCan('approve','leave'); nút reject=useCan('approve','leave') Ở FE (UI-hint, comment rõ: reject:leave sensitive, KHÔNG allowlist ⇒ useCan('reject','leave') LUÔN false; BE ép reject:leave fail-closed). (e) i18n locales/vi/leave.ts thêm namespace approval.* + nav routeTitle.leaveApprovals. (f) reconcile test fixture MANAGER_PERMS + deny-path RED."
    builder: frontend-builder
    paths: ["apps/app/**"]
acceptanceChecks:
  - "Route /leave/approvals render LeaveApprovalPage (KHÔNG còn ModulePlaceholder); table pending dùng leaveApi.listRequests → GET /leave/requests, queryKey leaveKeys.requests.list(params); có đủ loading/empty/error/forbidden."
  - "Approval detail drawer/modal mở từ 1 hàng pending, hiện requester(employeeCode/fullName/department)+leaveType+period+totalDays+reason+status (render từ LeaveManagementListItemView, không fetch endpoint detail riêng vì BE không có)."
  - "Approve: có confirmation → gọi leaveApi.approveRequest(id,note?); onSuccess invalidate leaveKeys.requests.list-prefix + requests.detail(id), KHÔNG invalidate balances."
  - "Reject: confirmation có reject reason textarea BẮT BUỘC — submit bị chặn khi rỗng (không gọi API); khi có lý do gọi leaveApi.rejectRequest(id,reason) khớp rejectLeaveRequestSchema (min1,max2000)."
  - "PIN CỔNG: gate route + sidebar + list-load = view:leave (LEAVE.REQUEST.VIEW) Ở CẢ registry.ts VÀ sidebar-registry.ts — KHÔNG phải approve:leave; verify khớp leave.controller GET /leave/requests (VIEW_LEAVE) + SENSITIVE_CAPABILITY_ALLOWLIST có 'view:leave'."
  - "Nút approve gate useCan('approve','leave'); nút reject gate useCan('approve','leave') (UI-hint) + comment giải thích reject:leave sensitive/không allowlist ⇒ useCan('reject','leave') luôn false, BE ép reject:leave fail-closed — CHỦ Ý, không bỏ sót."
  - "grep leaveInvalidation.approve/reject KHÔNG còn leaveKeys.balances.all; vẫn còn list-prefix + requests.detail(id)."
  - "leaveApi có listRequests(→leaveManagementListResponseSchema) + approveRequest/rejectRequest(→leaveRequestDetailViewSchema); typecheck xanh không any."
  - "web test xanh (pnpm --filter @mediaos/app test + @mediaos/web-core test) + pnpm typecheck xanh (DoD §8)."
  - "harness/backlog.mjs S3-FE-LEAVE-2 done_when cập nhật; không phá luồng MyLeaveRequests/Detail hiện có (regression xanh)."
testTasks:
  - "DENY-PATH RED — LeaveApprovalPage.spec.tsx: (a) useCan('view','leave')=false → forbidden mềm + KHÔNG gọi listRequests; (b) useCan('approve','leave')=false → nút approve+reject KHÔNG render (PermissionGate deny); (c) có approve THIẾU reject → bấm reject, rejectRequest reject ApiError 403 → lỗi mềm hiển thị, list KHÔNG optimistic-apply, KHÔNG crash; (d) approve ngoài scope → approveRequest 403 → lỗi mềm; (e) assert session.modules !== [] và UserPermission.scopes !== [] (chống xanh-giả)."
  - "RED — reject reason bắt buộc: submit reject khi textarea rỗng → KHÔNG gọi rejectRequest (assert not.toHaveBeenCalled)."
  - "RECONCILE registry-guard.spec.tsx: thêm view:leave @ Team vào MANAGER_PERMS (khớp mig 0455); assert employee(không view:leave) → LEAVE_SIDEBAR ẩn leave.approvals; manager(view:leave Team)→hiện; hr(view:leave Company)→hiện. Thêm case evaluateRouteAccess leave.approvals meta: thiếu LEAVE.REQUEST.VIEW → SHOW_403, có → ALLOW."
  - "query-keys.spec.ts: leaveInvalidation.approve & reject trả list-prefix + requests.detail(id) và KHÔNG chứa balances.all."
  - "leave-api.spec.ts: listRequests/approveRequest/rejectRequest gọi đúng path+method (GET /leave/requests, POST /leave/requests/:id/approve|reject) và validate đúng schema."
  - "QA-05 approval flow smoke: happy-path manager duyệt 1 đơn Pending → list refetch, drawer đóng (integration mức component, mock leaveApi)."
steps:
  - "Lane fe-leave-2-core TRƯỚC (web-core là dependency của app): thêm leaveApi.listRequests/approveRequest/rejectRequest (validate schema contracts đã có); sửa leaveInvalidation.approve/reject bỏ balances.all; re-point registry.ts leave.approvals meta → ['LEAVE.REQUEST.VIEW']; cập nhật unit spec web-core; pnpm --filter @mediaos/web-core test + typecheck xanh."
  - "Lane fe-leave-2-page SAU: viết deny-path spec RED trước (LeaveApprovalPage.spec.tsx + reconcile registry-guard.spec.tsx MANAGER_PERMS), chạy đỏ."
  - "Dựng LeaveApprovalPage.tsx (table + drawer + approve/reject dialog + reject reason required + states) theo pattern MyLeaveRequestsPage/LeaveRequestDetailPage; gate view:leave cho list, approve:leave cho cả 2 nút (comment UI-hint reject)."
  - "Thay ModulePlaceholder bằng LeaveApprovalPage trong router.tsx; đổi sidebar-registry.ts leave.approvals → ['LEAVE.REQUEST.VIEW']; thêm i18n approval.*."
  - "Chạy lại spec → GREEN; pnpm --filter @mediaos/app test + @mediaos/web-core test + pnpm typecheck xanh; FULL-ish gate (security-reviewer + react-reviewer + typescript-reviewer + quality-gate); cập nhật harness/backlog.mjs done_when."
```

## GAP-ANALYSIS (fresh, 2026-07-01)

WO thuần FE. Đã có sẵn (KHÔNG làm lại):

1. Migration 0455 seed view/approve/reject:leave cho manager(Team)/hr(Company)/company-admin(Company), employee KHÔNG — red-zone đã ship.
2. Contracts `leaveManagementListItemView`/`Response` + `approveLeaveRequestSchema` + `rejectLeaveRequestSchema`(min1) đã có trong packages/contracts.
3. BE leave.controller: GET /leave/requests gate view:leave (listPending, scope trong LeaveApprovalService: manager=Team, hr/ca=Company), POST :id/approve gate approve:leave, POST :id/reject gate reject:leave + reason required.
4. Route /leave/approvals + registry meta + sidebar entry đã tồn tại nhưng render ModulePlaceholder và gate SAI (requiredAny [APPROVE,VIEW]).

CẦN LÀM:

- web-core `leaveApi` 3 method mới (listRequests/approveRequest/rejectRequest — hiện thiếu).
- Bỏ `leaveKeys.balances.all` khỏi `leaveInvalidation.approve/reject` trong query-keys.ts.
- Đổi gate `leave.approvals` → `view:leave` Ở CẢ `registry.ts`(web-core) VÀ `sidebar-registry.ts`(app).
- `LeaveApprovalPage` thay `ModulePlaceholder`.
- i18n `approval.*`.

## PAIR-DRIFT PIN (chống bẫy S1-FND-MODULE FE-permit/BE-403)

Nguồn THẬT = `leave.controller.ts` + `leave-permissions.const.ts` + mig 0455 + `SENSITIVE_CAPABILITY_ALLOWLIST` (permission.service.ts L35-41 chứa `'view:leave'`, KHÔNG chứa `'reject:leave'`).

- **(i) list/route/sidebar gate = view:leave** (sensitive, đã allowlist ⇒ lộ /auth/me cho ai có) — KHÔNG approve:leave; nếu chỉ gate approve thì user có approve mà thiếu view sẽ 403 khi load list.
- **(ii) nút approve = approve:leave** (non-sensitive, luôn lộ).
- **(iii) nút reject = approve:leave Ở FE CHỦ Ý** — vì reject:leave is_sensitive & KHÔNG trong allowlist ⇒ useCan('reject','leave') LUÔN false ⇒ nếu gate reject bằng reject:leave thì nút biến mất với MỌI role; BE vẫn ép reject:leave fail-closed (defense-in-depth), FE chỉ là UI-hint.

## FIXTURE-RECONCILE

MANAGER_PERMS trong registry-guard.spec.tsx hiện THIẾU `view:leave` (chỉ có `approve:leave Team`) → sau khi gate thành `view:leave` phải thêm `view:leave@Team` cho khớp mig 0455 (giữ test đúng-thực-tế, không xanh-giả).

## INVARIANTS (CLAUDE.md §2)

- FE không quyết masking (server làm) — không áp dụng trực tiếp nhưng drawer không fetch thêm data = đúng pattern.
- Không hard-code role/permission (dùng `useCan` + registry meta).
- Soft-delete / audit không áp dụng (read-heavy page; approve/reject writes ở BE đã có audit).

## DRAWER NOTE

BE KHÔNG có GET /leave/requests/:id cho approver → drawer render TỪ hàng `LeaveManagementListItemView` đã chọn (đủ field), không fetch detail riêng. `invalidate requests.detail(id)` giữ nguyên (harmless no-op trên trang này, để đồng bộ nếu requester mở session khác).

## BALANCE

BỎ khỏi invalidate — approver không giữ balance key của requester; balance requester tự cập nhật ở phiên họ.

## VERIFY

`pnpm --filter @mediaos/web-core test` + `pnpm --filter @mediaos/app test` + `pnpm typecheck`; deny-path RED trước GREEN.

## GATE

Crown (workflow phê duyệt + đổi cổng permission route) → security-reviewer + react-reviewer + typescript-reviewer + quality-gate; coverage ≥80% cho LeaveApprovalPage.

## OUT-OF-SCOPE

cancel-any/revoke/export (cặp sensitive khác), leave-type/policy/balance admin, calendar, approver-detail endpoint mới, thay đổi BE/contracts/migration.

## THỨ TỰ MERGE (hot-file)

`fe-leave-2-core` (web-core: leave-api.ts append method, query-keys.ts sửa leaveInvalidation, registry.ts sửa 1 meta) TRƯỚC → `fe-leave-2-page` (app: router.tsx thay component, sidebar-registry.ts sửa 1 requiredAny, LeaveApprovalPage mới, i18n append, spec). Paths không chồng (`packages/web-core/**` vs `apps/app/**`).
