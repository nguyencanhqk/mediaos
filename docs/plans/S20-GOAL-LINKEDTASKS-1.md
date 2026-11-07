# S20-GOAL-LINKEDTASKS-1 — Tab «Công việc gắn»: nhóm theo người, quá hạn, «Thêm việc»

## Quyết định

- Mở drawer `?task=` + «Không mở được việc này» đã có từ S20-TASK-DRAWER-1 (nút `goal-linked-task-open-*`, test i1/i2 ở `GoalDetailPage.spec`) — không làm lại.
- Đóng drawer ⇒ tab theo dõi `?task=` (`useRouterState`), lượt chuyển có→không ⇒ invalidate `goalInvalidation.taskProgress(goal.id)`.
- Quá hạn = cờ `isOverdue` của server (giờ công ty, loại Done/Cancelled); FE chỉ sắp xếp (quá hạn lên đầu, rồi hạn sớm) và hiển thị hạn quy theo `companyTimeZone()` (không cắt chuỗi UTC).
- Nhóm theo người: khoá `mainAssigneeEmployeeId`, «x/y xong» (Done/tổng), nhóm có việc quá hạn đứng đầu, «Chưa giao» cuối.
- «Thêm việc»: `TaskFormDrawer` + `initialValues` (không prop thứ hai); `POST /tasks` (trong drawer) rồi `POST /goals/:id/tasks {taskIds:[id]}` (hook `useGoalAddTask`). Bước 1 lỗi ⇒ drawer giữ dữ liệu, `onSuccess` không chạy ⇒ không gọi bước 2. Bước 2 lỗi ⇒ banner «Đã tạo việc «tên» nhưng chưa gắn vào mục tiêu» + «Thử gắn lại» + «Mở việc».
- Gate nút: `update:goal` + `update:task` (canEditLinks) + `create:task` (hằng `TASK_CREATE_PAIR_FOR_DECOMPOSE`), qua `useCan`.
- Nợ MSGTOTASK vá ở `TaskFormDrawer`: option cố định của ô dự án bám `initialValues.projectId` (kể cả ""), không có thì `defaultProject.id`; tên lấy từ danh sách → `defaultProject` (nếu cùng id) → nhãn dự phòng.

## done_when → test

| Tiêu chí                               | Test                                                      |
| -------------------------------------- | --------------------------------------------------------- |
| Bấm dòng mở drawer, ngoài phạm vi      | `GoalDetailPage.spec` (i1/i2, có sẵn)                     |
| Đóng drawer ⇒ invalidate tiến độ       | `GoalLinkedTasksTab.spec` «đóng drawer việc»              |
| Nhóm theo người, quá hạn đỏ + đầu      | `GoalLinkedTasksTab.spec` + `goal-linked-tasks-view.spec` |
| Gate đủ ba cặp (thiếu một ⇒ không nút) | `GoalLinkedTasksTab.spec` it.each ×3                      |
| Hai bước, bước 2 lỗi, thử lại          | `GoalLinkedTasksTab.spec` «hai bước»                      |
| projectId điền sẵn + ô dự án cố định   | `GoalLinkedTasksTab.spec` + `TaskFormDrawer.spec`         |

## Lệch paths

Tệp mới ngoài glob WO nhưng cùng thư mục tính năng: `goals/goal-linked-tasks-view*.ts`, `components/GoalAddTask.tsx`, `components/GoalLinkedTaskTable.tsx`.

## Nợ

- `TaskCoreResponseDto` không có mã việc (`taskCode`) ⇒ banner dùng TÊN việc thay «[mã]».
- Chưa kiểm «Esc/Back đóng drawer, vẫn ở tab Công việc gắn» trên trình duyệt thật (tab do `?tab=`, drawer chỉ đổi `?task=`).
- Banner lỗi bước gắn mất khi rời trang (state cục bộ); việc đã tạo vẫn nằm ở danh sách việc.

Sổ vết KPI: (điền sau)

## Sổ vết — vá review 07/11

1. [LOW] Thêm việc lần hai xoá banner lần một: vá — `failure` thành mảng theo task.id; test «việc B sau A lỗi».
2. [LOW] Ca «Mở việc» chỉ đếm navigate: vá — assert search updater ra `task:"new"`. `localDateOf` mock ở tab: để lại, hạn theo giờ công ty đã phủ ở goal-linked-tasks-view.spec.
3. [LOW] Nút «Tháo» trùng tên + th rỗng: vá — aria-label kèm tên việc, th sr-only «Thao tác»; test trợ năng.
4. [LOW] (trùng 1) Tạo việc thứ hai xoá im lặng banner: vá cùng mục 1.
5. [LOW] Lỗi gắn bị nuốt khi unmount: vá — onError gọi toast.error có nút «Mở việc»; test toast.error.
