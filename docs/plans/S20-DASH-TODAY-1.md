# S20-DASH-TODAY-1 — Dashboard Employee thành màn «Hôm nay» (gate LIGHT)

Nguồn: `docs/plans/S20-WORKUX-STORIES.md` §5.4 US-X-03 + US-X-08 (biến thể B), §6 Đợt 1A bước 3, §7 Q21 = B.

## L0 — đo lại
- Trang dashboard Employee **đúng là `DashboardMePage`** (route `/dashboard`, `router.tsx`; loại dashboard do server
  resolve qua `GET /dashboard/me`, `dashboard_type === "Employee"`). Không cần mở rộng `paths` vì trang.
- Chưa có endpoint **chi tiết đơn nghỉ theo phạm vi duyệt**: `leaveApi.getMyRequest` chỉ cho đơn CỦA MÌNH.

## Quyết định
1. **Hàng việc bấm được**: `MyTasksWidget` + `TaskAlertsWidget` — `<button aria-label="Mở việc: …">` gọi
   `useTaskDrawer().openTask(id)` (push `?task=`, drawer toàn cục của `ProtectedShell`). Không đổi trạng thái ở widget.
2. **`?request=`**: route `/leave/approvals` có `validateSearch` (`leave-approval-search.ts`); `LeaveApprovalPage` nhận
   `requestId` + `onClearRequest`. UUID hợp lệ mới tra (rác ⇒ 0 lời gọi); tra bằng `GET /leave/requests`
   (scope Team/Company của server, `status=Pending`, `pageSize=100`) — ngoài phạm vi / đã xử lý / lỗi ⇒ cùng
   thông điệp «Không tìm thấy đơn hoặc đơn đã được xử lý», danh sách vẫn hiện. Duyệt/từ chối vẫn bấm + xác nhận.
3. **`PendingLeaveWidget`**: hàng ⇒ `/leave/approvals?request=<id>`; gate thêm `approve:leave` (ngoài `view:leave` mirror BE).
4. **«Mục tiêu cần check-in»**: `GoalCheckinDueBlock` (FE thuần, không widget BE/seed), `GET /me/goals` mỗi trạng thái
   mở (Active, Draft) như `MeGoalsCard`, gate `access:goal` + `checkin:goal` (`enabled` tắt ⇒ 0 lời gọi). Đặt dưới lưới,
   chỉ khi `dashboard_type === "Employee"`. «Xong hết» = khối rỗng **và** mọi widget MY_TASKS/TASK_ALERTS/PENDING_LEAVE
   hiện có đều `Empty` (đọc cùng `queryKey` widget ⇒ dùng chung cache, không thêm lời gọi).
5. **`defaultLanding`**: `lib/default-landing.ts` — so khớp CHÍNH XÁC allowlist `/home · /dashboard · /me ·
   /tasks/my-tasks`, trả về HẰNG của ta; còn lại ⇒ `/home`. Áp ở route vào-app `/` (đích đăng nhập: `DEFAULT_APP_URL`),
   replace, một lần/lần mount, lỗi tải ⇒ ở nguyên. Chọn «Trang mở đầu» ở `MeAppearancePage` (`patchPreferences`).

## done_when → test
| Tiêu chí | Test |
| --- | --- |
| Hàng việc là nút, Tab/Enter, `?task=` | `MyTasksWidget.spec` · `TaskAlertsWidget.spec` (hàng bấm được; rỗng ⇒ không hàng giả) |
| Hàng đơn → `?request=`, thiếu approve ⇒ ẩn | `PendingLeaveWidget.spec` |
| `?request=` ngoài phạm vi / đã xử lý / lỗi / không UUID (0 lời gọi) / thiếu `view:leave` | `LeaveApprovalPage.spec` (deny-path trước) |
| Mở sẵn dialog nhưng chưa duyệt; đóng ⇒ gỡ param | `LeaveApprovalPage.spec` |
| Khối mục tiêu: gate, ≤5, Xem tất cả, Check-in, Nháp khoá, lỗi riêng + Thử lại, «xong hết» | `GoalCheckinDueBlock.spec` · `DashboardMePage.spec` |
| Allowlist `defaultLanding` + tấn công (`/evil`, URL tuyệt đối, `//host`, `/\host`, query/hash, hoa-thường, khoảng trắng) | `default-landing.spec.ts` |
| Chọn «Trang mở đầu» | `MeAppearancePage.spec` |

## Lệch `paths` (file mới/ngoài danh sách, nhỏ)
- `apps/app/src/routes/leave/leave-approval-search.ts` (validateSearch thuần TS, tách khỏi tệp component).

## Nợ / không làm
- BE: endpoint chi tiết đơn nghỉ theo phạm vi duyệt (hiện tra qua danh sách Pending tối đa 100 dòng ⇒ đơn thứ 101+ báo «không tìm thấy»).
- «Xong hết» chỉ hiện trong khối mục tiêu; người thiếu quyền mục tiêu không thấy thông điệp tổng.
- `mergeOpenGoals` lặp với `MeGoalsCard` (có thể rút ra dùng chung sau).
- Áp `defaultLanding` chỉ ở `/` — người mở thẳng `/home` giữ `/home`; chưa có ca e2e đăng nhập thật.

## Sổ vết KPI: (điền sau)

### Sổ vết — vá review (07/11/2026)

1. LOW default-landing redirect mỗi lần mount `/` ⇒ vòng lặp «Về trang chủ»: ĐÃ VÁ — 3 link «Về trang chủ» (forbidden.tsx, RouteStates.tsx x2) trỏ `/home`; `/` chỉ còn là cổng vào app.
2. LOW cast `as "/"` + Home nháy: ĐÃ VÁ một phần — `DEFAULT_LANDING_GO` gõ kiểu cho `/home`, `/tasks/my-tasks`; `/dashboard`, `/me` sinh động từ ROUTE_REGISTRY nên không có trong kiểu router ⇒ chỉ ép đúng 2 literal (ghi chú trong mã). Hook trả `true` khi đang tải/sắp chuyển ⇒ IndexEntry không vẽ Home.
3. LOW allClear đếm widget không thấy: ĐÃ VÁ — nguồn lọc theo useCan (read:task; view:leave + approve:leave), rỗng ⇒ false; 2 ca test.
4. LOW quý đóng băng useMemo([]): ĐÃ VÁ — tính mỗi render; ca test đổi quý.
5. LOW radiogroup thiếu bàn phím: ĐÃ VÁ — roving tabindex, mũi tên chọn mục kế, aria-disabled thay disabled; 2 ca test.

### Sổ vết — vá vòng 2 (07/11/2026)

1. MEDIUM Home trống suốt retry: ĐÃ VÁ — `useApplyDefaultLanding` nhả Home khi `failureCount>0` hoặc quá `DEFAULT_LANDING_HOLD_MAX_MS` (1500ms); dữ liệu về muộn không điều hướng. 2 ca test (đỏ trên mã cũ).
2. LOW GET /me/preferences gọi 2 lần: NỢ — `packages/web-core/src/lib/session.ts:45` gọi `meApi.getPreferences()` không ghi cache; sửa sạch cần đổi web-core (ngoài paths) ⇒ đề xuất `queryClient.setQueryData(meKeys.preferences(), prefs)` ở session.
3. LOW `?request=123` bị viết lại: ĐÃ VÁ — giá trị không phải chuỗi bị bỏ khỏi search (URL sạch, 0 lời gọi; trang không mở dialog/thông điệp cho dạng số, chuỗi sai UUID vẫn báo như cũ). Spec mới `leave-approval-search.spec.ts`.
4. LOW hai nút Check-in cùng tên: ĐÃ VÁ — `aria-label` «Check-in: {tên mục tiêu}» (i18n `dashboard.goalCheckin.checkinFor`); ca đo bằng getAttribute.
5. INFO defaultLanding độc hại: KHÔNG ĐỔI — `/` (IndexEntry, router.tsx:71) bình thường cũng ở `/` và vẽ Home; ca bị bỏ qua giống hệt ⇒ giữ. done_when «vào /home» hiểu là «Home hiện, ở lại origin».
6. LOW widget gọi lại 2x sau đổi trạng thái: NỢ, có SẴN trên master — `routes/tasks/hooks/use-task-action-mutation.ts:141-144` duyệt cả `taskCoreInvalidation.list()` và `.my()`, mà cả hai đều chứa `dashboardKeys.widgets.all` (`packages/web-core/src/lib/query-keys.ts:521-522`) ⇒ mỗi widget bị invalidate 2 lần (cùng widget pending-leave). Ngoài paths (routes/tasks + web-core).

KPI luồng A (/home, defaultLanding=null): 4 thao tác, 1 chuyển trang; POST /tasks/T1/change-status {status:Done}; landing độc hại ở lại origin. Đo 07/11/2026 Chromium Playwright MCP 1440x1600 @ d2de717e.

### Sổ vết — vòng 3 (luồng điều phối, 07/11/2026)

1. LOW nhả Home KHÔNG chốt (review hẹp vòng 2): react-query đưa `failureCount` về 0 khi retry thành công ⇒ Home đã vẽ bị nhảy sang đích muộn. ĐÃ VÁ — cờ nhả chốt một chiều (`releasedLatch`, dùng chung cho trần thời gian); ca «lỗi tạm rồi retry thành công» ĐỎ trên mã cũ (`expected true to be false`), xanh sau vá.
2. MEDIUM (đo trình duyệt) `?request=123` vẫn tới trang dạng SỐ: route gốc không có validateSearch nên search thô của cha gộp xuống dù hàm validate của route này đã bỏ ⇒ ĐÃ VÁ ở router.tsx: chuẩn hoá `String(request)` ⇒ hành vi giống `?request=abc` (thông điệp «không tìm thấy», 0 lời gọi), kiểu khớp khai báo. Mục 3 vòng 2 hiệu chỉnh: URL vẫn sạch `?request=123`, trang CÓ báo «không tìm thấy».
3. Đo lại trình duyệt thật vòng 2 (@ f5f395d8): preferences luôn 500 ⇒ Home hiện ~60 ms sau lời gọi đầu, TRƯỚC retry đầu ~1 s, không điều hướng muộn sau 8 s; nút Check-in có aria-label «Check-in: <tên mục tiêu>».
