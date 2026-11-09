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

## Sổ vết — vá review (09/11)

Mỗi lỗi có ca test đỏ trên mã cũ → xanh (đo: app 6 đỏ, ui 2 đỏ khi trả 3 tệp nguồn về HEAD).

| # | Lỗi | Vá | Test |
| --- | --- | --- | --- |
| 1·3·10 | `pending`/`failedIds` sống sót khi chọn về 0 ⇒ chọn lại mở thẳng dòng xác nhận cũ | effect theo `count === 0` xoá cả hai | bar spec «bỏ chọn hết rồi chọn lại» |
| 2 | `pinFirstColumn` + `rowSelection` ghim checkbox thay vì cột tiêu đề | ghim cả cột chọn (`w-12`) lẫn cột kế (`left-12`) | `data-table.spec` «pinFirstColumn + rowSelection» |
| 4 | Mất tiêu điểm bàn phím khi vào xác nhận / huỷ / chạy xong / xoá | focus «Xác nhận» khi vào pending; Huỷ ⇒ vùng thanh (`tabIndex=-1`); xong-hết/xoá ⇒ checkbox đầu bảng | bar spec «tiêu điểm chuyển sang Xác nhận» |
| 5 | `role=menu/menuitem` không có hợp đồng phím | bỏ role menu/menuitem/aria-haspopup, dùng `role=group` + nút thường (`aria-expanded`) | bar spec «không tự xưng role=menu» |
| 6 | Thanh/số việc/câu xác nhận/danh sách lỗi không được đọc | vùng `role=status` bền (sr-only) chứa số việc + câu xác nhận; `<ul role=alert>`; span hiển thị `aria-hidden` | bar spec «vùng role=status bền» |
| 7 | Chọn không xuyên trang nhưng dòng trang trước vẫn nằm trong lệnh | `DataTable` tỉa selection khi tập dòng đang hiện đổi (trang/lọc/sắp); bỏ qua khi loading/gom nhóm | `data-table.spec` «sang trang khác ⇒ bỏ chọn» |
| 8·9 | Chọn đổi giữa lúc chạy bị `retainOnly` ghi đè; setState sau unmount | `retainOnly` GIAO với lựa chọn hiện tại; ref `mounted` chặn setState/callback (bar + hook). Không khoá checkbox (để dễ dùng) | hook spec `retainOnly` · bar spec «rời màn giữa lúc chạy» |

Còn lại: không (không lỗi nào hoãn). Ghi chú: focus khi «xoá» dùng `querySelector` trong phần tử cha của thanh (thanh là anh em của bảng ở cả 2 màn).

## Sổ vết — vá vòng 2 (09/11)

| # | Lỗi | Vá | Test |
| --- | --- | --- | --- |
| R1 | `setFailedIds` gán lại failedIds cũ dù lựa chọn đã về 0 giữa lúc chạy | giao failedIds với lựa chọn HIỆN TẠI (ref theo render) | bar spec «race: chọn về 0 giữa lúc chạy» |
| R2 | Checkbox chọn dòng/tất cả chỉ 16×16px (WCAG 2.2 SC 2.5.8) | bọc `<label>` h-6 w-6 (24px) + `-my-1` bù ⇒ dòng KHÔNG cao thêm; tên trợ năng giữ nguyên | `data-table.spec` «vùng bấm 24px». Đo kích thước/độ cao dòng thật: CHỈ trình duyệt (jsdom không bố cục) — chờ smoke |
| R3 | «Giao cho…» như ô trống (avatar «?»), tên trợ năng «Đổi người: …» | `EmployeePicker labelOnly`: không avatar, nút viền có nhãn, aria-label = «Giao cho…» | bar spec «nút Giao cho… có nhãn rõ» |
| R4 | Thành công trọn vẹn khác dạng lỗi một phần | `bulk.result.allOk` = «{{count}}/{{count}} thành công» | bar spec «6/6 thành công» |
| R5 | Ca «>50 ⇒ khoá» không chạm được trên /tasks (trang < 50) | KHÔNG đổi luồng; trần `TASK_BULK_MAX`=50 vẫn giữ cho tab dự án/tương lai; giữ test đơn vị trần | spec thanh «chọn quá 50» |
