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
