# S20-FE-TOAST-2 — toast cho auth/console · dọn toast khi đổi người dùng · SOCIAL onError

Zone xanh · gate LIGHT · nối tiếp S20-FE-TOAST-1 (#617).

## Quyết định

1. **Dọn toast ở MỘT chỗ — web-core, theo danh tính của auth store.** `lib/session-boundary.ts` mới:
   `onSessionBoundary(handler)` rình `useAuthStore`, bắn khi `companyId:id` của `user` đổi — đăng xuất
   (A → null) · hết phiên (api-client `logout()` rồi `redirectToAuth()`) · đổi phiên tại chỗ (A → B) ·
   đăng nhập sau trang trống. KHÔNG bắn khi `/me` làm mới cùng người hay chỉ đổi access token.
   Handler ném lỗi không chặn handler sau (log `[session-boundary]`).
2. **`ToastFn.clear?` + `configureToast` tự đăng ký.** Đích có `clear` (toast của `@mediaos/ui` có) ⇒
   `configureToast` gắn `clear` vào ranh giới phiên; gắn lại/`null` thì gỡ đích cũ. Không app nào phải
   nhớ thêm dòng dọn. **S19-SEC-FECACHELOGOUT-1** cắm `queryClient.clear()` bằng đúng
   `onSessionBoundary` (đã export ở `@mediaos/web-core`) — WO này KHÔNG đụng QueryClient/auth store.
3. **apps/auth:** `routes/root-layout.tsx` mới (`<Outlet/>` + `<Toaster className="top-4"/>` — không có
   topbar), gắn vào `createRootRoute({ component })`; `main.tsx` gọi `configureToast(toast)`.
4. **apps/console:** `RootLayout` mount `<Toaster/>` một lần ở CẢ hai nhánh (route bare `/` và route có
   AppShell); `main.tsx` gọi `configureToast(toast)` trước `boot()`.

## Mutation SOCIAL — kiểm kê 06/11/2026

28 chỗ khai mutation (19 tệp, không tính định nghĩa `useGuardedMutation`) — **tất cả đã có `onError`
hiện lỗi TẠI CHỖ** (dải `ActionErrorBanner` / `AdminErrorNotice` / ô lỗi trong hộp thoại / thông báo
của tab), nên **0 chỗ chuyển sang toast** (thêm toast = báo hai lần): PollBlock ×3 · use-create-post ·
use-feed-actions ×4 · NewsPage (ack) · PostDetailPage ×3 · CreateGroupDialog · GroupMembersTab ×2 ·
GroupRequestsTab · GroupSettingsTab ×2 · use-group-membership ×2 · use-invite-request ·
IdeaReviewDialog · HiddenPostsTab · ReportDialog · ResolveReportDialog · BadgeFormDialog ·
use-badge-toggle · ExportEngagementButton. Rào mới `social-mutation-onerror.spec.ts`: tệp khai
`mutationFn:` phải có đủ `onError:`, kèm sàn 28 chỗ chống xanh rỗng. Gỡ chú thích «App KHÔNG có hệ toast»
ở `ActionErrorBanner.tsx` + 6 chú thích cùng ý (AdminErrorNotice · use-guarded-mutation · use-create-post ·
use-feed-actions · PostDetailPage · NewsPage) — chỉ đổi chú thích.

## Bẫy tiêu điểm Dialog/Sheet — kết luận: toast nằm NGOÀI bẫy

- `Dialog`/`Sheet` của `packages/ui` KHÔNG portal; bẫy Tab là `onKeyDown` trên panel, Esc là listener
  `document`; lớp phủ `z-50`. `Toaster` là anh em của vỏ app, `fixed z-[60]` ⇒ nằm TRÊN lớp phủ, ngoài panel.
- Chuột/cảm ứng: bấm được nút đóng/hành động của toast khi hộp thoại đang mở.
- Bàn phím: Tab trong hộp thoại KHÔNG bao giờ tới toast; chỉ tới được bằng **F8**. Esc trong toast chỉ
  đóng toast (`stopPropagation` chặn listener Esc của hộp thoại); đóng thì tiêu điểm trả về chỗ cũ trong
  hộp thoại. Nhưng đang ở trong toast mà bấm Tab thì tiêu điểm ĐI RA trang nền sau hộp thoại (rò bẫy).
- Trình đọc màn hình: vùng `aria-live` nằm ngoài phần tử `aria-modal="true"` — NVDA/JAWS vẫn đọc vùng
  live; VoiceOver có thể bỏ qua nội dung ngoài modal ⇒ lỗi do thao tác TRONG hộp thoại nên báo bằng
  ô lỗi trong hộp thoại (đúng cách SOCIAL đang làm), không chỉ bằng toast.

## done_when → test

1. auth/console mount + configureToast: `apps/auth/src/routes/root-layout.spec.tsx` ·
   `apps/auth/src/test/main.spec.tsx` · `apps/console/src/routes/root-layout.spec.tsx` (khối TOAST-2) ·
   `apps/console/src/test/boot.spec.tsx`.
2. Dọn khi đổi người dùng: `packages/web-core/src/lib/session-boundary.spec.ts` (đăng xuất · A→B tại chỗ
   · cùng người không dọn · gắn lại đích · handler lỗi) · console «A đăng xuất rồi B đăng nhập ⇒ B KHÔNG
   thấy thông báo của A» (toast thật + Toaster thật) · ProtectedShell.spec «đổi phiên tại chỗ A → B».
3. SOCIAL: `apps/app/src/routes/social/social-mutation-onerror.spec.ts`.
4. `ProtectedShell.spec` mock `@/hooks/use-branding` — log hết «Not implemented: navigation».

## Lệch paths

Không. (Sửa chú thích trong `routes/social/**` + spec mới đều nằm trong paths.)

## Nợ

- Bẫy Tab của Dialog/Sheet nên nhận vùng `[data-slot="toaster"]` (Tab trong toast quay về panel) — WO ui.
- Mutation đang bay lúc đăng xuất có thể bắn toast SAU khi đã dọn (thường là 401 ⇒ không toast) — theo
  dõi cùng S19-SEC-FECACHELOGOUT-1 (huỷ mutation khi dọn QueryClient).
- Owner xem trên trình duyệt thật: vị trí `top-4` ở apps/auth, toast trên lớp phủ hộp thoại console,
  tương phản chế độ tối.

## Sổ vết gate (06/11/2026, luồng chính)

- Review LIGHT (workflow 3 góc nhìn + xác minh đối kháng, 9 agent): 5 finding đề xuất, 0 đứng vững sau phản biện.
- Cổng máy: `check.sh --quick` XANH · chunk-test app 462 · auth 6 · console 23 · ui 25 · web-core 53 tệp XANH.
- Kiểm toán mutant `session-boundary.spec.ts`: bỏ đăng ký `clear` (đỏ 3 ca) · bỏ so danh tính (đỏ 1) · không gỡ đích cũ khi gắn lại (đỏ 1) · bỏ dời mốc `previous` — SỐNG ⇒ thêm ca «sau A → B, B làm mới /me nhiều lần ⇒ dọn đúng một lần» (đỏ trên mutant, xanh trên mã thật).
