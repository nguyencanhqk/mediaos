# Micro-plan — S3-FE-LEAVE-7 (LeaveOverviewPage /leave)

> Reconcile-refresh cho auto-loop. Bake fix BLOCKING của plan-reviewer (run wf_4a728732).
> Reuse API sẵn có — KHÔNG BE mới, KHÔNG migration. Trọng tâm: đúng cặp quyền + deny-path + paths đủ.

```yaml
wo: S3-FE-LEAVE-7
zone: green
generated_by: hand-authored (post plan-block wf_4a728732)
reconciled_at: "9f4ca6d"
lanes: [{"id":"s3feleave7-fe","task":"LeaveOverviewPage tại /leave (overview) + dời MyLeaveBalancePage→/leave/me/balances; gate section pending-approvals bằng useCan('view','leave') trực tiếp; thêm sidebar my-balances; deny-path test","paths":["apps/app/src/routes/leave/**","apps/app/src/router.tsx","apps/app/src/layouts/**","apps/app/src/i18n/**","packages/web-core/src/lib/**"],"builder":"frontend-builder"}]
acceptanceChecks: ["router.tsx: /leave → LeaveOverviewPage; /leave/me/balances → MyLeaveBalancePage (dời khỏi /leave, hiện router.tsx:733 leaveRoute render MyLeaveBalancePage). Route /leave/me/balances REUSE gate LEAVE.REQUEST.VIEW_OWN (như /leave hiện tại) — KHÔNG dùng LEAVE.BALANCE.VIEW_OWN (chưa có trong PERMISSION_CODE_TO_PAIR → fallthrough → SHOW_403 mọi user)","LeaveOverviewPage: balance summary grid + quick actions (tạo đơn/xem đơn của tôi/link tới /leave/me/balances) + recent requests + pending approvals + upcoming approved leave + warning cards (balance thấp/đơn quá hạn)","Section pending-approvals + query listRequests gate bằng useCan('view','leave') (cặp engine TRỰC TIẾP, enabled:canView) — KHÔNG approve:leave, KHÔNG qua PERMISSION_CODE_TO_PAIR (mirror LeaveApprovalPage.tsx:343-353). Nút approve/reject (nếu có) gate RIÊNG approve:leave","Warning card 'đơn quá hạn': CHỐT nguồn — nếu requests?status=Pending (cross-read) → gate view:leave y hệt pending-approvals; nếu me/requests → gate view-own. KHÔNG để card cross-read cho employee thường (nổ 403)","Recent requests dùng listMyRequests({page:1,pageSize:5}) — KHÔNG per_page (contract leave.ts:441 chỉ có page/pageSize, per_page bị Zod strip → trả 20 dòng)","sidebar-registry.ts: thêm mục leave.my-balances→/leave/me/balances (tránh orphan sau khi dời); giữ leave.overview→/leave","Cập nhật test/link cũ trỏ /leave→/leave/me/balances (MyLeaveBalancePage.spec.tsx + điều hướng nội bộ) — không broken link","TÁI DÙNG API (me/balances · me/requests · requests?status=Pending · calendar), KHÔNG BE mới, KHÔNG migration; loading/error/empty; masking server-side; i18n vi đủ key; check.sh xanh; LIGHT gate"]
testTasks: ["deny-path RED (mirror LeaveApprovalPage.spec.tsx gating): user CHỈ có view-own:leave (employee thường) mở /leave → section pending-approvals + warning 'đơn quá hạn' KHÔNG render VÀ query listRequests KHÔNG chạy (enabled:canView=false) → KHÔNG nổ 403","regression RED: user view-own vẫn thấy balance summary + recent-requests bình thường","allow RED: user có view:leave (HR/manager) → thấy section pending-approvals + cross-read warning"]
steps: ["Đọc router.tsx:733 (leaveRoute) + LeaveApprovalPage.tsx:343-353 (gate view:leave) + sidebar-registry.ts:370-382 + contracts leave.ts:441 (page/pageSize) + registry.ts (ROUTE_REGISTRY /leave gate)","Viết deny-path test RED-trước (3 test ở trên)","router.tsx: /leave→LeaveOverviewPage, thêm /leave/me/balances→MyLeaveBalancePage (gate reuse VIEW_OWN); sidebar-registry thêm leave.my-balances","LeaveOverviewPage: dựng sections; gate cross-read (pending-approvals + warning quá-hạn) bằng useCan('view','leave'); quick-action link balances","Cập nhật test/link cũ trỏ balances; check.sh + LIGHT gate"]
```

## Reconcile notes (prose)

**Bối cảnh block:** (a) file bắt buộc sửa `apps/app/src/router.tsx` + `layouts/workspace/sidebar-registry.ts` **ngoài paths**. (b) `testTasks` rỗng cho trang có section cross-read nhạy cảm. (c) sai cặp quyền: nghiệm thu ghi 'quyền DUYỆT' (`approve:leave`) nhưng BE `GET /leave/requests` ép `view:leave`.

**Fix chốt:**
1. **Paths**: thêm `apps/app/src/router.tsx` + `apps/app/src/layouts/**` vào backlog (đã sửa).
2. **Cặp quyền pending-approvals**: gate LOAD danh sách bằng `useCan('view','leave')` (cặp engine trực tiếp — mirror `LeaveApprovalPage.tsx:343-353` + sidebar `:370-382`), KHÔNG `approve:leave`. Lý do: BE ép `VIEW_LEAVE`; gate nhầm approve → HR/manager có view nhưng thiếu approve mất section, hoặc persona approve-only vẫn phải gọi endpoint cần view → 403. Nút approve/reject gate riêng `approve:leave`.
3. **Route balances mới**: `/leave/me/balances` REUSE gate `LEAVE.REQUEST.VIEW_OWN` (đã trong PERMISSION_CODE_TO_PAIR) — tránh pair-drift do `LEAVE.BALANCE.VIEW_OWN` chưa map → SHOW_403.
4. **per_page → pageSize**: contract `leaveRequestListQuerySchema` chỉ có `page`+`pageSize` (default 20, max 100); `per_page` bị strip.
5. **Orphan + regression**: thêm sidebar `leave.my-balances` + quick-action link; cập nhật `MyLeaveBalancePage.spec.tsx` và link nội bộ (đang giả định `/leave`=balances).

**Điểm tốt giữ nguyên (plan-reviewer xác nhận):** reuse API, không BE/migration → không đụng 3 bất biến tầng DB; masking server-side; LIGHT gate hợp lý; tách route overview/balances đúng UX.
