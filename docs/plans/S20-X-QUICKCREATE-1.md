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

| Tiêu chí                                                                                  | Test                                                       |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| nút gate create:task; phím tắt có bổ trợ, bỏ qua ô nhập, không nuốt phím                  | `GlobalTopbar.spec.tsx`, `use-quick-create-hotkey.spec.ts` |
| chỉ tiêu đề, tôi, dự án trống                                                             | `QuickCreateHost.spec.tsx` (payload)                       |
| chip chỉ gợi ý; lưu trữ/không thành viên ⇒ ẩn; Thêm chi tiết; Enter ⇒ toast Mở ⇒ `?task=` | `QuickCreateHost.spec.tsx`                                 |
| thiếu quyền; tiêu đề rỗng/khoảng trắng; server lỗi giữ tiêu đề                            | `QuickCreateHost.spec.tsx`                                 |

## Lệch paths

Thêm `components/quick-create/**` (nằm trong paths); sửa `routes/tasks/TaskQuickAdd.tsx` (trong paths). Không thêm namespace i18n: key `quickCreate.*` ở `tasks.ts`.

## Nợ

- «Giao người khác» không có ở form gọn (đúng đặc tả) — chỉ qua «Thêm chi tiết».
- Phím tắt chưa có trong bảng phím tắt/trợ giúp (chưa có màn như vậy ngoài chat).
- Esc ở vùng khác của hộp tạo nhanh khi nó mở TRÊN một Sheet: Sheet chỉ tìm modal con TRONG panel nên có thể đóng cả Sheet; Esc tại ô nhập đã stopPropagation. Cần đo trình duyệt thật (chưa làm được ở phiên này) — chuyển QA.

## Sổ vết (vá review)

1. [MEDIUM] Hotkey bị nuốt khi drawer mở — `wouldStackOnModal`: chỉ nhường khi alertdialog hoặc >=2 lớp modal; 1 modal (Sheet chat/việc) vẫn mở. Hộp vẽ ở vỏ, ngoài panel Sheet nên focus-trap React của Sheet không bắt. Test: hotkey.spec (sheet đơn mở được / chồng / alertdialog). KPI #20 (tạo nhanh ở /goals khi drawer chat mở): chứng minh ở mức jsdom; đo trình duyệt thật CHƯA làm.
2. [LOW] ProtectedShell.spec thêm ca «mount QuickCreateHost đúng một lần». KPI #20 đo trình duyệt thật + ca thiếu quyền: ca thiếu quyền đã có ở QuickCreateHost.spec; đo trình duyệt thật còn nợ (ghi vào mô tả PR).
3. [MEDIUM] Chip dự án đóng hộp khi blur — `TaskQuickAdd.closeOnBlur=false` cho hộp (Dialog tự lo Esc/click ngoài). Test: blur relatedTarget=chip ⇒ hộp còn, chip bấm được.
4. [MEDIUM] Mất việc im lặng khi đóng hộp lúc request bay — `onCreateError` ⇒ host `toast.error` kèm tiêu đề. Test: đóng rồi server 500 ⇒ toast chứa tiêu đề.
5. [LOW] «Thêm chi tiết» khi pending — nút disabled khi `createMutation.isPending`; host tách `handleQuickCreated` (không đụng form đầy đủ) khỏi `handleFullCreated`. Test: pending ⇒ nút khoá, không mở form.

## Sổ vết vòng 2 (vá review hẹp + đo trình duyệt thật 07/11/2026)

1. [MEDIUM] Esc từ vùng không phải ô nhập đóng cả hộp lẫn drawer chat — hộp portal ra ngoài panel Sheet nên Sheet không thấy modal con. Vá: vùng nội dung hộp mang `data-floating-layer="open"` (hợp đồng sẵn có của Sheet/Popover) ⇒ Sheet nhường Esc; KHÔNG sửa packages/ui. Test: Host.spec «hộp mở trên Sheet».
2. [LOW] Đóng hộp ⇒ focus rơi về body (Dialog chung chụp phần tử trước-khi-mở SAU khi autoFocus đã chạy ⇒ chụp trúng ô nhập của chính hộp). Vá: store chụp `returnFocusTo` lúc `open()`; Host trả focus khi đóng (không khi sang form đầy đủ), phần tử gốc đã mất ⇒ nút topbar. Test: 2 ca focus.
3. [LOW] Lỗi hiện hai lần — `handleCreateError` chỉ toast khi hộp ĐÃ đóng. Test: «hộp CÒN mở ⇒ không toast»; ca hộp đã đóng giữ nguyên.
4. [LOW] 422 hiện chuỗi chung nhắc hạn/cột — TaskQuickAdd thêm `showServerReason` + `badRequestMessage` (opt-in, chỉ hộp gọn bật): 400/422 hiện message server (bỏ tiền tố slug), rỗng ⇒ chuỗi dự phòng `quickCreate.badRequest` (không nhắc hạn/cột); 403/5xx/mạng vẫn chuỗi i18n, không lộ chi tiết server. Test: 422 có lý do · 422 rỗng · 500.
5. [GHI CHÉP] Khi drawer chat mở, nút topbar bị lớp phủ Sheet che (modal, cố ý) ⇒ KPI #20 đạt qua phím tắt Alt+Shift+N; không sửa.

Số đo KPI #20 (Chromium Playwright MCP 1440x900, vite từ worktree @ b3392dce, API giả lập):
- Ca A (/goals + drawer chat mở, Alt+Shift+N → gõ tiêu đề → Enter): 3 thao tác, 0 đổi pathname; POST /tasks {title, assigneeEmployeeId: tôi}, không projectId; toast «Đã tạo việc» + «Mở»; «Mở» ⇒ /goals?task=<id>, drawer việc mở, chat vẫn mở.
- Ca B (/goals, không chat, nút topbar «+ Tạo việc» → gõ → Enter): 3 thao tác, 0 đổi path.
- Ca thiếu create:task: không nút, phím tắt vô tác dụng (Host.spec).
