```yaml
wo: S3-LEAVE-BE-3
zone: red
generated_by: auto-loop
reconciled_at: "cd7c8d3"
lanes:
  - id: L1-contracts-approval
    task: "packages/contracts/src/leave.ts: thêm approveLeaveRequestSchema (note/comment optional), rejectLeaveRequestSchema (reason BẮT BUỘC min(1)), pendingLeaveRequestListQuerySchema (status default 'Pending' + page/pageSize + leaveTypeId/employeeId/fromDate/toDate) và leaveManagementListItemView (đơn + requester employeeCode/fullName + department) + envelope {items,meta}. Zod = nguồn sự thật DTO (server-authoritative; strip client status/approvedBy/employeeId). KHÔNG sửa các schema BE-2 hiện có (additive)."
    builder: backend-builder
    paths:
      - packages/contracts/src/leave.ts
  - id: L2-leave-approval-workflow
    task: "apps/api/src/leave/**: LeaveApprovalService (FSM TitleCase Pending→Approved/Rejected) — approve/reject với FOR UPDATE row-lock (findRequestForUpdateTx) + status-guard (chỉ Pending, else 409) chống double-approve; scope-check TRƯỚC khi chạm dữ liệu qua DataScopeService.resolveContext + isEmployeeInScope trên owner-employee (manager=Team direct_manager/EMR · hr/company-admin=Company, tái dùng S2-INT-2) — ngoài scope→403, cross-tenant→404; CHẶN self-approval approver.id===request.userId → 422 LEAVE-ERR-APPROVER-INVALID (SPEC-05 §14.9 MUST, crown); approve: convert Reserved→Used (pending_days -= totalDays + used_days += totalDays race-safe qua incrementUsedIfEnoughTx, ghi leave_balance_transactions RESERVE→USE, balanceEffectStatus='Used'), set approvedAt/approvedBy, mark leave_request_days.attendanceSyncStatus='Pending' (handoff S3-INT-1); reject: release reserve (pending_days -= totalDays, RELEASE tx, used KHÔNG đổi, balanceEffectStatus='Released'), set rejectedAt/rejectedBy/rejectionReason, KHÔNG tạo attendance record; ghi leave_request_approvals (APPROVE/REJECT append-only) + audit (LeaveApproved/LeaveRejected + balance) + outbox leave.request.approved/rejected (eventCode LEAVE_REQUEST_APPROVED/REJECTED) TẤT CẢ trong 1 tx withTenant. Repository: pending-list scoped (join employee_profiles + buildEmployeeScopeCondition), markDaysSyncPendingTx. Controller repoint: GET /requests → view:leave (scoped, status filter) · POST /:id/approve → approve:leave + scope · POST /:id/reject → reject:leave + reason bắt buộc + scope. Thêm LEAVE_ERR.APPROVER_INVALID/OUT_OF_SCOPE vào leave-request.logic.ts. Wire providers leave.module.ts (append additive; DataScopeService inject qua PermissionModule đã export). permission/** chỉ tiêu thụ read-only (KHÔNG sửa engine/seed)."
    builder: backend-builder
    paths:
      - apps/api/src/leave/**
      - apps/api/src/permission/**
acceptanceChecks:
  - "GET /leave/requests?status=Pending trả CHỈ đơn trong data-scope người gọi: manager=Team (direct_manager + EMR managedUserIds, tái dùng S2-INT-2) · hr/company-admin=Company; employee (không grant view:leave) → 403; có pagination/filter."
  - "POST /leave/requests/:id/approve: gate approve:leave; scope-check TRƯỚC mutation (ngoài scope→403, cross-tenant→404 không lộ tồn tại); self-approval (approver===requester)→422 LEAVE-ERR-APPROVER-INVALID; chỉ Pending mới duyệt (else 409); status→Approved + approvedBy/approvedAt set."
  - "Approve balance: balanceEffectStatus Reserved→Used, pending_days -= totalDays + used_days += totalDays race-safe (used ≤ total chốt trong WHERE — 2 duyệt song song KHÔNG trừ 2 lần); leave_balances.remaining_days (GENERATED) đúng; ghi leave_balance_transactions RESERVE→USE (append-only); leave_request_approvals action=APPROVE."
  - "Approve trigger ATT sync: leave_request_days.attendance_sync_status='Pending' cho ngày working; outbox leave.request.approved (eventCode LEAVE_REQUEST_APPROVED) enqueue TRONG tx (handoff S3-INT-1, KHÔNG tự dựng sync service)."
  - "POST /leave/requests/:id/reject: gate reject:leave; reason BẮT BUỘC (thiếu→422/400); scope-check TRƯỚC mutation; chỉ Pending (else 409); status→Rejected + rejectedBy/rejectedAt/rejectionReason; reserve release (pending_days -= totalDays, RELEASE tx, used_days KHÔNG đổi); KHÔNG tạo attendance leave record, KHÔNG phát sync event; leave_request_approvals action=REJECT; outbox LEAVE_REQUEST_REJECTED."
  - "BẤT BIẾN: mọi ghi qua withTenant(company_id token) + RLS; leave_request_approvals & leave_balance_transactions INSERT-only (không UPDATE/DELETE); audit objectType leave_request/leave_balance (đã trong CHECK — không migration)."
  - "DoD §8: có test (deny-path RED trước + integration DB cô lập), coverage ≥80% module nhạy cảm; typecheck/build/lint xanh; FULL gate (crown) PASS + owner chốt; cập nhật backlog.mjs."
testTasks:
  - "DENY-RED (viết TRƯỚC): manager duyệt/xem đơn NGOÀI team (owner không thuộc reports/EMR) → 403; HR duyệt đơn company-scope → OK; employee gọi approve/view → 403 (không grant)."
  - "DENY-RED: direct API approve/reject ngoài scope → 403; cross-tenant (đơn công ty khác) approve/reject → 404 không lộ tồn tại; withTenant chặn rò tenant."
  - "DENY-RED: self-approval (người tạo tự duyệt đơn mình) → 422 LEAVE-ERR-APPROVER-INVALID (chặn ở service, không chỉ FE)."
  - "DENY-RED: reject thiếu reason → 422/400; reject KHÔNG tạo attendance leave record + KHÔNG convert reserve→use (pending released, used_days không đổi) + KHÔNG phát LEAVE_REQUEST_APPROVED."
  - "STATE-MACHINE: approve/reject đơn KHÔNG-Pending (Draft/Approved/Rejected/Cancelled) → 409; chỉ Pending→Approved / Pending→Rejected hợp lệ."
  - "CONCURRENCY (row-lock idempotency): 2 approve song song cùng đơn → chỉ 1 thành công, used_days KHÔNG trừ 2 lần (FOR UPDATE + status-guard + CHECK used≤total)."
  - "BALANCE-LEDGER: approve → RESERVE→USE rows + pending↓/used↑; reject → RELEASE row + pending↓; append-only deny (UPDATE/DELETE leave_balance_transactions & leave_request_approvals bị app role từ chối) — mở rộng leave-ledger-appendonly.int-spec."
  - "EVENT/AUDIT: approve phát outbox LEAVE_REQUEST_APPROVED + day-rows sync_status=Pending; reject phát LEAVE_REQUEST_REJECTED; audit LeaveApproved/LeaveRejected ghi trong tx (rollback → không có audit/event ma)."
  - "INTEGRATION DB cô lập: AppModule+supertest+Postgres thật trên LANE_DB=mediaos_leavebe3 (reset→head clean); QA-05 permission/data-scope + QA-02 state-transition/balance matrix; coverage ≥80%."
steps:
  - "L1 TRƯỚC (contracts = nguồn sự thật DTO): thêm approve/reject/pending-list schemas + management list-item view vào packages/contracts/src/leave.ts; build contracts (turbo) để L2 import được type."
  - "L2 dựng LeaveApprovalService + repo methods (scoped pending-list, convert reserve→use, release, mark-days-sync-pending); tất cả đi qua db.withTenant(companyId) — company_id từ token, RLS."
  - "L2 repoint controller: GET /requests → view:leave (scope) + status; POST /:id/approve → approve:leave + scope + self-approval block; POST /:id/reject → reject:leave + reason bắt buộc + scope. Giữ static route order (requests/calculate trước :id/*)."
  - "L2 wire LeaveApprovalService vào leave.module.ts (append providers); xác minh DataScopeService inject được (PermissionModule export line 137)."
  - "Ghi leave_request_approvals + leave_balance_transactions INSERT-only; audit + outbox trong CÙNG tx (rollback drop hết — không event/audit ma)."
  - "Deny-path RED viết TRƯỚC (đội 2), chạy đỏ, rồi implement xanh; verify trên lane DB cô lập; FULL gate + owner chốt."
```

NEW plan (không có docs/plans/S3-LEAVE-BE-3.md — phân rã mới). GAP-ANALYSIS code hiện tại (spec thắng):

- GAP-1 (crown): controller POST /:id/approve & /:id/reject đang route sang LEGACY LeaveService (status lowercase 'pending'→'approved', luồng taskId, incrementUsedIfEnoughTx trừ used_days trực tiếp, KHÔNG scope-check). BE-2 tạo đơn TitleCase 'Pending' + RESERVE (balanceEffectStatus='Reserved'). Legacy approve check status!=='pending' ⇒ 409 mọi đơn BE-2. BE-3 REPOINT sang LeaveApprovalService FSM TitleCase; legacy LeaveService.approve/reject/createRequest thành orphan → ĐỂ NGUYÊN (out-of-scope xoá, tránh scope-creep).
- GAP-2: reject route hiện gate @RequirePermission('approve','leave') SAI → phải reject:leave (mig 0455, sensitive=true, manager=Team/hr=Company).
- GAP-3: GET /requests hiện gate ('read','leave') = cặp orphan KHÔNG có trong catalog 0455 cho 4 role canonical ⇒ 403 tất cả. REPOINT view:leave + DataScopeService (manager=Team, hr/ca=Company). Static /requests/calculate phải khai báo TRƯỚC /:id/* (Express order — đã đúng ở BE-1).
- GAP-4: KHÔNG có scope enforcement trên approve/reject hôm nay (approver bất kỳ có approve:leave duyệt được MỌI đơn company). BE-3 thêm resolveContext + isEmployeeInScope trên owner-employee (userId/employeeId) TRƯỚC mutation.
- GAP-5 (crown, SPEC-05 §14.9 MUST): self-approval CHƯA bị chặn → 422 LEAVE-ERR-APPROVER-INVALID, chặn tầng service.

TRIGGER BOUNDARY: S3-INT-1 (AttendanceLeaveSyncService/onLeaveApproved) depends_on S3-LEAVE-BE-3 (chiều ngược) ⇒ BE-3 KHÔNG dựng sync service; chỉ (a) enqueue outbox leave.request.approved mang leave_request_days + (b) set day-rows.attendance_sync_status='Pending'. S3-INT-1 sẽ consume. done_when 'gọi handler S3-INT-1' hiểu là event-hook nhất quán trong/sau tx.

NO-MIGRATION: idempotency chống double-approve = FOR UPDATE row-lock + status='Pending' guard (terminal→409), + leave_balances CHECK(used_days<=total_days) backstop race — KHÔNG cần cột idempotency_key mới. audit object_type 'leave_request'/'leave_balance' đã trong CHECK (BE-2 dùng). ⇒ KHÔNG có lane db-migration; head migration giữ nguyên.

INVARIANTS: §2.1 company_id mọi query qua withTenant + RLS (company_id từ token, không client); §2.2 leave_request_approvals + leave_balance_transactions append-only (INSERT), leave_request_days soft-delete; §2.3 không secret; §3 permission+scope check TRƯỚC khi chạm dữ liệu.

VERIFY: bash scripts/lane-db-setup.sh leavebe3 → export LANE_DB=mediaos_leavebe3 → pnpm --filter @mediaos/api test (leave suite + full green) + typecheck + build + lint. Contracts build (turbo) trước khi typecheck API.

GATE: FULL (crown — permission/RLS/approval-FSM/audit/append-only): security-reviewer + database-reviewer + silent-failure-hunter(nếu có, hiện chưa có agent → route quality-gate) + santa-method; deny-path RED viết trước; đỏ/CRITICAL/nhạy cảm → owner chốt trước merge (red-zone, không auto-merge).

OUT-OF-SCOPE (không làm ở WO này): AttendanceLeaveSyncService (S3-INT-1); cancel-by-admin LEAVE-API-206 / revoke LEAVE-API-207 (→ S3-LEAVE-BE-5/6); approver-routing gán current_approver theo policy nhiều bước (chỉ scope-check MVP); leave-file; notification delivery (chỉ phát event, không gửi); xoá legacy LeaveService orphan; require_attachment; per-company TZ (dùng default VN).
