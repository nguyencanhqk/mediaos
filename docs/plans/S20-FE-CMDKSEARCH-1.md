# S20-FE-CMDKSEARCH-1 — Ctrl+K tìm việc / dự án / đồng nghiệp theo quyền

Nguồn: US-X-07 · UI-02 §14.1, §18.1–18.3 · UI-06 §4.2. FE thuần, không đổi BE/contract.

## Quyết định

1. Dữ liệu ở `apps/app/src/layouts/home/use-command-search.ts`; phần hiển thị ở `CommandSearchResults.tsx`;
   `AppSwitcher.tsx` chỉ nối dây (bàn phím, điều hướng, dirty-guard).
2. Quyền: `useCan("read","task")` · `("read","project")` · `("read","employee")`. Thiếu quyền ⇒ nhóm không
   tồn tại trong kết quả VÀ `enabled:false` ⇒ không request. Không có phép so vai trò.
3. Endpoint dùng sẵn (chỉ import): `taskCoreApi.listTasks({search,limit})`,
   `taskProjectApi.listProjects({search,limit})`, `hrApi.listEmployees({search,page:1,pageSize})`.
   Lưu ý: tham số HR thật là `search` (không phải `q`). Data-scope do server áp.
4. Dưới 2 ký tự (sau trim) ⇒ 0 request, tắt ngay không đợi debounce. Debounce 250 ms. Tối đa 5 mục/nhóm
   (gửi `limit` + cắt lại ở FE).
5. Khoá query khai cục bộ `["command-search", group, term]` (không sửa `query-keys.ts`); `gcTime:0`,
   không persist, không ghi storage, không «tìm gần đây».
6. Nhóm «Đồng nghiệp» map ngay trong queryFn thành `{id, tên, ảnh, phòng ban}`; mọi trường khác (email,
   lương, điện thoại…) bị bỏ trước khi vào state.
7. Mỗi nhóm là một query độc lập, bọc timeout 8 s: lỗi/quá hạn ⇒ nhóm đó «Không tải được», nhóm khác vẫn hiện.
   Tất cả nhóm hiển thị đều rỗng ⇒ «Không tìm thấy “…”» + nút gợi ý sang trang tìm của module
   (`/tasks?search=`, `/tasks/projects`, `/hr/employees`), chỉ gợi ý nhóm người dùng được phép đọc.
8. Chọn kết quả: việc ⇒ `useTaskDrawer().openTask(id)` (`?task=`, ở lại trang, không cần dirty-guard);
   dự án ⇒ `/tasks/projects/:id`; người ⇒ `/hr/employees/:id` (hai đường này qua dirty-guard chung với
   chuyển app: `pendingApp` đổi thành `pendingAction`).
9. Bàn phím: ↑/↓ xoay vòng trên danh sách phẳng các mục đã tải xong, Enter mở mục đang chọn;
   `aria-activedescendant` trỏ mục đang chọn.
10. CHAT-DEC-027 (SPEC-15 §22c: Ctrl/⌘+K trong chat là phím «tìm» của chat): bộ nghe Ctrl+K toàn cục
    bỏ qua (không `preventDefault`, không mở bảng) khi sự kiện đến từ trong `[data-testid="chat-composer"]`.
    Không sửa `MessageComposer`; dùng `data-testid` sẵn có làm mốc nhận diện (nợ: đổi sang thuộc tính
    chuyên dụng khi composer được mở khoá).
11. i18n: khoá `commandSearch.*` ở `packages/web-core/src/i18n/locales/vi/nav.ts` (không namespace mới,
    không đụng `apps/app/src/i18n/index.ts`). `layout.spec.tsx` (mock `t` trả khoá) đổi một dòng placeholder
    từ chuỗi cứng sang khoá `commandSearch.placeholder`.

## Ánh xạ done_when → test (`AppSwitcher.command-search.spec.tsx`)

| done_when | Ca |
| --- | --- |
| 1 deny-path | «thiếu quyền đọc hồ sơ nhân viên…KHÔNG request tới HR» · «không có quyền việc/dự án ⇒ không gọi» · «dưới 2 ký tự ⇒ không gọi API nào» |
| 2 bảng lệnh | «debounce 250ms… tối đa 5» · «mũi tên + Enter: việc mở drawer ?task=, người mở hồ sơ» |
| 3 Đồng nghiệp | «chỉ render tên/phòng ban, không lộ trường khác» · «không lưu vào storage» |
| 4 lỗi/rỗng/chat | «một endpoint lỗi…» · «không có kết quả…» · «Ctrl+K khi focus ở ô soạn chat…» |
| 5 gate | test + typecheck + eslint xanh; security-reviewer: CHƯA chạy ở bước này (nợ, xem dưới) |

## Sổ vết

- RED trên mã cũ: 9/10 ca đỏ (ca còn lại, «dưới 2 ký tự», xanh vì mã cũ không gọi gì — giữ làm hồi quy).
- GREEN: 10/10; `src/layouts` + `layout.spec` + `ConversationPanel.spec`: 175 ca xanh; typecheck app + eslint xanh.
- Sổ vết KPI: (điền sau)

## Nợ

- security-reviewer (gom dữ liệu nhiều module, có HR) — chạy ở bước gate.
- Người không có `read:employee` chưa tìm được đồng nghiệp: chờ danh bạ nhẹ của CHAT (§7 Q1 = B, WO đỏ Đợt 3).
- Trang `/tasks` nhận `?search=` qua `validateTaskListSearch`; chưa có ca e2e cho gợi ý «danh sách việc».
- Danh sách phẳng chưa gộp các ứng dụng vào vòng mũi tên (ứng dụng vẫn chọn bằng chuột/Tab).
