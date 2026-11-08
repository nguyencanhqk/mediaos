# S20-TASK-LEAVEHANDOFF-1 — bàn giao việc ngay trên đơn nghỉ của tôi (US-TASK-NV-93)

## Quyết định
- Khối `LeaveTaskHandoff` mount trong `LeaveRequestDetailPage` (trang này CHỈ là đơn của chính tôi — `getMyRequest`; QL xem đơn người khác ở màn khác ⇒ tự thoả «QL không thấy khối»).
- Quy tắc thuần ở `leave-task-handoff.ts`: đủ điều kiện = Pending/Approved và `endDate ≥ hôm nay` (giờ công ty); lọc việc = nguồn `assigned`, chưa Done/Cancelled, ngày hạn local (giờ công ty) trong `[startDate, endDate]`.
- Dữ liệu: `useQuery` với `taskKeys.my()` + `taskCoreApi.getMyTasks` — CÙNG key với «Việc của tôi», không endpoint mới. `enabled` chỉ khi có `read:task` VÀ đơn đủ điều kiện ⇒ thiếu quyền/đơn không đủ điều kiện = không gọi API.
- Dời hạn: tái dùng `TaskRowDeadlineControl` + `DeadlineQuickPicker` qua prop `presets`; thêm `afterLeavePreset(endDate)` + `nextWorkingDay` ở `deadline-presets.ts` (bộ mặc định không đổi). Gate `update-deadline:task` và rollback/lý do lỗi do control có sẵn lo.
- Đổi người: tái dùng `TaskRowAssigneeControl` (gate `assign:task`, cảnh báo người đang nghỉ của ASSIGNWARN-1).
- Báo người giao: nút (cần `comment:task`) mở drawer với `?taskTab=comment`. Thêm giá trị `comment` vào `TASK_DRAWER_TABS`; `TaskDetailContent` giữ tab Bình luận và truyền `autoFocusComposer` cho `TaskCommentThread` ⇒ ô soạn mới có focus.
- Không tự dời hạn, không tự giao. Không đổi FSM/quyền/schema.

## done_when → test
| Tiêu chí | Test |
| --- | --- |
| Hiện khối, lọc đúng, N = 2 (27–31/10; việc Done loại) | `leave-task-handoff.spec.ts` (lọc + múi giờ), `LeaveTaskHandoff.spec.tsx` «2 việc» |
| Dời hạn + chip «Sau kỳ nghỉ» = ngày làm việc kế 17:00; Thứ Sáu 31/10/2025 ⇒ Thứ Hai 03/11 | `leave-task-handoff.spec.ts` «Sau kỳ nghỉ», `LeaveTaskHandoff.spec.tsx` chip + 403 + deny |
| Báo người giao: tab Bình luận + focus | `LeaveTaskHandoff.spec.tsx` (taskTab=comment, deny comment), `TaskCommentThread.spec.tsx` focus |
| Đổi người chỉ khi `assign:task` | `LeaveTaskHandoff.spec.tsx` |
| Không khối: Draft/Rejected/Cancelled · đã qua · thiếu `read:task` (không gọi API) | `leave-task-handoff.spec.ts`, `LeaveTaskHandoff.spec.tsx`, `LeaveRequestDetailPage.spec.tsx` |
| Trống / lỗi `/tasks/my` chỉ khối báo lỗi + «Thử lại», đơn vẫn hiển thị | `LeaveTaskHandoff.spec.tsx`, `LeaveRequestDetailPage.spec.tsx` |

## Tệp ngoài `paths` (tối thiểu, để «Báo người giao» có focus)
`routes/tasks/task-drawer-nav.ts`, `TaskDetailContent.tsx`, `TaskCommentThread.tsx` (+ spec), `TaskRowQuickEdit`/`TaskInlineFields` chỉ ĐỌC (tái dùng).

## Nợ
- Sổ vết KPI: (điền sau) — KPI #24 đo trong trình duyệt thật bởi agent khác.
- Ngày lễ không tính vào «ngày làm việc kế tiếp» (đúng yêu cầu WO).
- Hết quyền `update-deadline:task` thì hạn hiện chữ tĩnh; chưa có lối «xin dời hạn» (ngoài phạm vi).
