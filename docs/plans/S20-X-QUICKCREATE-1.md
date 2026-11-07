# S20-X-QUICKCREATE-1 — «+ Tạo việc» toàn cục (US-X-05)

## Quyết định
- **Tái dùng** `TaskQuickAdd` (S20-TASK-QUICKADD-1) trong `Dialog`: thêm prop tuỳ chọn `onCreated`, `onExpand`+`expandLabel`, `withDeadlineChip`, `titleRequiredMessage` (mặc định giữ hành vi cũ ⇒ MyTasks/Kanban không đổi).
- **Vỏ**: `QuickCreateHost` mount ở `ProtectedShell` (phím tắt + hộp + form đầy đủ), trạng thái mở ở `quick-create.store.ts` (zustand); nút «+ Tạo việc» ở `GlobalTopbar` chỉ gọi `open`. Gate `useCan("create","task")` ở CẢ nút lẫn host (thiếu quyền: không nút, không listener).
- **Phím tắt Alt+Shift+N** (`use-quick-create-hotkey.ts`, so `event.code === "KeyN"`):
  - không phím một ký tự (WCAG 2.1.4); không trùng Ctrl+K (AppSwitcher), Alt+↑/↓ và Ctrl+Shift+F (chat), `n`/`/` của trang;
  - Alt+N đơn dễ đụng menu trình duyệt/Windows; Alt+Shift+N không là phím của Chrome/Edge/Firefox (ẩn danh là Ctrl+Shift+N); Unikey/EVKey dùng Ctrl+Shift / Alt+Z;
  - AltGr (= Ctrl+Alt) bị loại vì kiểm `!ctrlKey`; macOS Option+N là phím chết ⇒ dùng `code`;
  - bỏ qua khi focus ở input/textarea/select/contenteditable và khi đang trong `role=dialog` (không chồng modal); không `preventDefault` ở các nhánh bỏ qua.
- **Mở drawer tại chỗ**: toast `success` (hệ toast TOAST-1) có action «Mở» → `useTaskDrawer().openTask(id)` (PUSH `?task=`, đã có ở shell).
- **Chip dự án gần nhất**: id lưu `localStorage` (try/catch, `recent-project.ts`), sau khi tạo xong có `projectId`. Mỗi lần mở hỏi `GET /projects/:id`; chỉ hiện khi `status != Archived`, `closedAt == null`, `myProjectRole` khác null/Viewer. Lỗi 403/404 ⇒ ẩn. Không bao giờ tự chọn.
- «Thêm chi tiết»: đóng hộp gọn, mở `TaskFormDrawer` (create) với `initialValues={{title}}`, `defaultAssigneeMe`, `defaultProject` nếu đã bấm chip. Không sửa `TaskFormDrawer*`.

## done_when → test
| Tiêu chí | Test |
| --- | --- |
| nút gate create:task; phím tắt có bổ trợ, bỏ qua ô nhập, không nuốt phím | `GlobalTopbar.spec.tsx`, `use-quick-create-hotkey.spec.ts` |
| chỉ tiêu đề, tôi, dự án trống | `QuickCreateHost.spec.tsx` (payload) |
| chip chỉ gợi ý; lưu trữ/không thành viên ⇒ ẩn; Thêm chi tiết; Enter ⇒ toast Mở ⇒ `?task=` | `QuickCreateHost.spec.tsx` |
| thiếu quyền; tiêu đề rỗng/khoảng trắng; server lỗi giữ tiêu đề | `QuickCreateHost.spec.tsx` |

## Lệch paths
Thêm `components/quick-create/**` (nằm trong paths); sửa `routes/tasks/TaskQuickAdd.tsx` (trong paths). Không thêm namespace i18n: key `quickCreate.*` ở `tasks.ts`.

## Nợ
- «Giao người khác» không có ở form gọn (đúng đặc tả) — chỉ qua «Thêm chi tiết».
- Phím tắt chưa có trong bảng phím tắt/trợ giúp (chưa có màn như vậy ngoài chat).
- Sổ vết KPI: (điền sau)
