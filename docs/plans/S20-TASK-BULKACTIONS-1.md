# S20-TASK-BULKACTIONS-1 — chọn nhiều việc + thanh hành động hàng loạt

Gate LIGHT · FE · US-TASK-QL-03 · nguồn: `docs/plans/S20-WORKUX-STORIES.md` §5.2.2, §3.2 nguyên tắc 5, Q25 = A.

## Quyết định

1. **`DataTable.rowSelection` (additive)** — `{ state, onChange, getRowId, selectAllLabel, rowLabel }`.
   Không truyền ⇒ không thêm cột, `columns` giữ nguyên tham chiếu (hành vi cũ). Chọn theo **id**
   (`getRowId`), header chọn cả **trang đang hiện**. Header/cell của cột chọn là hàm cấp module,
   nhãn đi qua `table.options.meta` ⇒ danh tính ổn định, checkbox không bị gắn lại mỗi render
   (màn gọi dựng `columns` mới mỗi render ⇒ nếu không, mất tiêu điểm bàn phím sau Space).
2. **Không endpoint bulk.** `runTaskBulk` (hàm thuần, `hooks/use-task-bulk-action.ts`) gọi lặp
   `taskCoreApi.assign / changeDeadline / changeStatus` và `taskCollabApi.moveTaskState`, theo lô
   `TASK_BULK_CONCURRENCY` (5) bằng `Promise.allSettled`; trần `TASK_BULK_MAX` (50).
3. **Thanh `TaskBulkActionBar`** — chưa chọn ⇒ không render. Chọn hành động + giá trị ⇒ dòng xác nhận ⇒
   «Xác nhận». Quá 50 ⇒ xác nhận khoá + `aria-describedby` tới lời giải thích. Mốc hạn dùng
   `DeadlineQuickPicker` (variant `quick`), người nhận dùng `EmployeePicker`.
4. **Quyền** — `useCan` từng cặp: `assign:task`, `update-deadline:task`, `update-status:task`,
   `update-state:task` (+ dự án có cột pipeline, đọc `taskStatesApi.listStates`). Không cặp nào ⇒ không
   cột chọn, không thanh. Server vẫn là người quyết từng phần tử.
5. **Kết quả** — toast `task-bulk-result` («Đã thực hiện cho N việc» / «4/6 thành công» / lỗi hết); dòng lỗi
   **vẫn được chọn** (`retainOnly`) và liệt kê «Không thực hiện được» (không phân biệt 403/404). Dòng
   thành công vá thẳng cache danh sách (`patchTaskRows`) rồi invalidate list/my/kanban ⇒ không cần F5.
6. **Cảnh báo** — `warnings[]` từng lời gọi chuẩn hoá bằng hạ tầng ASSIGNWARN, **gộp thành một toast**
   («3 việc: B đang nghỉ phép»).
7. **Chọn** — `useTaskRowSelection(items)` tỉa id không còn trong danh sách đang hiện (đổi lọc/trang).
8. i18n: khối `bulk` mới ở cuối `vi/tasks.ts`; không chạm `tasks-workux.ts`.

## done_when → test

| done_when | Test |
| --- | --- |
| 1 prop additive; thanh ẩn khi chưa chọn; >50 khoá | `data-table.spec.tsx` (rowSelection) · `TaskBulkActionBar.spec.tsx` (ẩn, 51 khoá, 50 mở) · `TaskListPage.spec.tsx` / `ProjectTaskListTab.spec.tsx` |
| 2 route chuyên trách, allSettled, đồng thời hữu hạn, gate theo cặp | `use-task-bulk-action.spec.ts` (6 ⇒ 6 `/assign`, đỉnh đồng thời ≤ hằng) · bar spec (thiếu quyền ⇒ mất nút) |
| 3 lỗi một phần, dòng lỗi giữ chọn, cảnh báo gộp | `use-task-bulk-action.spec.ts` (2/6) · bar spec («4/6 thành công», 2 dòng «Không thực hiện được», «3 việc: Bình đang nghỉ phép») |
| 4 KPI #11 trình duyệt thật | **Sổ vết KPI: (điền sau)** |
| 5 spec cạnh tệp + build ui + auth/console | xem lệnh verify trong PR |

## Nợ

- KPI #11 đo trình duyệt thật (agent khác).
- «Chuyển cột» chỉ ở tab Danh sách của dự án; `/tasks` toàn công ty không có (không biết dự án).
- Chọn không xuyên trang (id ngoài trang hiện bị tỉa).
