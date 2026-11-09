# S20-NOTI-LIVETOAST-1 — báo tức thì ở mọi trang (plan ngắn)

Gate LIGHT · chỉ FE (`apps/app`). Không đổi contracts/API/schema.

## Sự kiện nền (đã đo trong mã)

- `notification:new` mang DTO **cũ** (`notificationSchema`: id/type/refId/refType/body) — KHÔNG có tiêu đề, KHÔNG có
  `target_url`, `type` luôn `general`, `refId/refType` null với thông báo từ engine. Muốn toast «Mở» phải lấy dòng
  tương ứng ở `GET /notifications/dropdown` (cùng khoá cache với chuông).
- Drawer chat (`chat-dock.store.openRoom`) tự focus ô soạn; `useChatRoomLinkOpener` (DEEPLINK-1) lo mọi ca đang ở
  `/chat*` / thiếu quyền / phòng vắng.

## Quyết định

1. **Một nguồn toast cho DM/@nhắc**: thông báo có đích `/chat/<uuid>` KHÔNG toast ở `useNotificationRealtime`;
   toast tin nhắn (`useChatToast`) là nguồn duy nhất. Hệ quả: tắt «Toast tin nhắn» thì DM/@nhắc không có toast
   nào (chuông vẫn nhận). Chọn quy tắc này thay vì «khử trùng theo thời gian» vì thứ tự `chat:message` ↔
   `notification:new` không đảm bảo.
2. Hook mới tách làm hai (`useNotificationRealtime`, `useChatToast`) + `useUnreadTitle`, cả ba mount ở
   `ProtectedShell`; `use-chat-realtime.ts` KHÔNG sửa (nó không biết router; thêm `useChatRoomLinkOpener` vào đó
   làm vỡ spec của nó). Hook gắn/gỡ đúng handler của mình, không `disconnect()`, không `reconnection()`.
3. Lấy dòng thông báo thất bại ⇒ KHÔNG toast (tránh toast cụt/nhân đôi); chuông vẫn cập nhật qua invalidate + poll.
4. Poll chuông: 120 s khi socket nối, 30 s khi mất (`use-notification-realtime-state.ts`, zustand nhỏ); nối lại sau
   đứt ⇒ invalidate bù, lần bắt tay đầu không.
5. `useOpenNotificationTarget` tách khỏi `NotificationTargetLink` (hành vi bấm dòng giữ nguyên) để toast «Mở» dùng
   CHUNG luật mở đích — không chép.
6. «(N)» tiêu đề = `totalUnreadCount(roomsById)` (chat, đúng số badge `ChatBadge`; không cộng thông báo chuông).
7. Tuỳ chọn toast: `lib/toast-prefs.ts`, khoá `mediaos.toast-prefs.v1:<userId>`; mọi đọc/ghi bọc try/catch; ghi bị
   chặn ⇒ giữ trong bộ nhớ tab. Mặc định: toast bật, xem trước TẮT. Toast tin chỉ có thân khi bật xem trước và
   thân lấy từ payload đã nhận (0 API thêm).
8. i18n: `vi/notifications.ts` (`toast`, `liveToast`) + `vi/me.ts` (`toastPrefs`). Không đụng `vi/chat.ts`.
9. `packages/ui` toast chỉ có success/error/warning ⇒ dùng `success` (vùng `aria-live` polite, nút bàn phím) cho
   cả hai loại toast; tránh `error` (assertive).

## done_when → test

| Tiêu chí                                                                                                        | Test                                                                                                |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Hook mount một lần ở shell, gate `read:notification`                                                            | `ProtectedShell.spec` (mỗi hook 1 lần) · `use-notification-realtime.spec` (thiếu quyền ⇒ 0 handler) |
| `notification:new` ⇒ invalidate + toast «Mở»; target không an toàn ⇒ không «Mở»                                 | `use-notification-realtime.spec`                                                                    |
| Poll 120/30 s; không lặp lỗi console; unmount không ngắt socket chat; hết phiên                                 | `use-notification-realtime.spec` · `NotificationBadge.spec`                                         |
| DM/@nhắc một toast «Trả lời»; phòng đang mở/tắt tiếng/nhóm không nhắc ⇒ không toast; gộp 15 s; thu hồi gỡ toast | `use-chat-toast.spec`                                                                               |
| Không nhân đôi giữa toast thông báo và toast tin                                                                | `use-notification-realtime.spec` (đích chat ⇒ không toast)                                          |
| «(N)» = badge; 0 ⇒ tiêu đề gốc                                                                                  | `use-unread-title.spec`                                                                             |
| 3 tuỳ chọn, localStorage theo userId, bị chặn ⇒ mặc định an toàn, người khác không thừa hưởng, xem trước TẮT    | `toast-prefs.spec` · `MeNotificationPreferencesPage.spec` · `use-chat-toast.spec`                   |

## Nợ

- `/me/preferences/notifications` chưa kiểm bằng tay; KPI trình duyệt thật (độ trễ toast ≤ 2 s) do agent khác đo.
- Thời gian toast giao việc ≈ 1 lần `GET /dropdown` sau `notification:new` (thêm 1 request/thông báo khi bật toast).
  Gọn hơn nếu BE nhét `title`/`target_url` vào `wsNotificationEventSchema` (đổi contracts — ngoài WO này).
- Toast chưa tự đánh dấu đã đọc khi bấm «Mở» (chuông/trang Thông báo vẫn đánh dấu như cũ).
- `toast` thiếu biến thể `info` (packages/ui) — hiện dùng `success`.
- N tiêu đề tab chưa cộng thông báo chuông (đúng chữ done_when).

Sổ vết KPI: (điền sau)

Sổ vết review:
- [LOW] use-chat-toast: thu hồi 1 tin trong toast gộp không cập nhật «N tin» ⇒ đã vá: dựng lại toast với số đếm mới (về dạng đơn khi còn 1); ca test mới trong `use-chat-toast.spec` (đỏ trên mã cũ).
