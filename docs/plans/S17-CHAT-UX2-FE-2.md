# S17-CHAT-UX2-FE-2 — Hội thoại v2 (bong bóng hai phía · thanh tác vụ nổi · đã-xem avatar · hero · phím tắt)

> Zone 🟡 · gate LIGHT · phụ thuộc `S17-CHAT-UX2-DOC-1` (đã merge — PR #464, `b2b3c9e6`).
> Nguồn nghiệp vụ: [SPEC-15 §9 · §14 · §22c CHAT-DEC-024](<../SPEC/SPEC-15 CHAT.md>) ·
> [hồ sơ wave §5/§6](./S17-CHAT-UX2-WAVE.md). **Không đụng BE, không đổi DTO, không thêm sự kiện WS.**

---

## 1. Đã làm gì

| # | Việc | File |
| --- | --- | --- |
| 1 | **Bong bóng hai phía**: tin của tôi lề phải nền `--bubble-mine`, người khác lề trái nền `--surface-2`; avatar CHỈ bên trái, chỉ tin đầu cụm; giờ ở tin cuối cụm (+ hover cho tin giữa cụm); tin `system` canh giữa như cũ | `MessageBubble.tsx` |
| 2 | **Thanh tác vụ NỔI** (👍 nhanh · trả lời · ghim [gate] · thu hồi [gate] · `⋯ › Sao chép`) | `MessageActions.tsx` (mới) |
| 3 | **«Đã xem» = dãy avatar** ≤3 + «+N», tooltip/nhãn trợ năng liệt kê ĐỦ tên | `SeenByAvatars.tsx` (mới) |
| 4 | **Thanh đầu v2**: avatar phòng/peer · tên · «Đang hoạt động» (DM) hoặc «N thành viên» · 🔍 tìm-trong-phòng · nút gọi · ⓘ | `ConversationHeader.tsx` (mới) |
| 5 | **Hero khung trống** + 2 hành động (Tin nhắn mới [gate `create:chat-room`] · Tìm kiếm) | `ChatEmptyHero.tsx` (mới) |
| 6 | **Dải ngày dính đỉnh** khung cuộn; bong bóng đang-gửi áp lề phải như tin thật; `isLastOfGroup` tính một lượt | `MessageList.tsx` |
| 7 | **Phím tắt**: Esc huỷ trả lời → đóng bảng thông tin; Ctrl/⌘+Shift+F mở tìm-trong-phòng | `ConversationPanel.tsx` |
| 8 | Token màu `--bubble-mine` · `--surface-2` (light + dark) | `packages/ui/src/styles/theme.css` |

## 2. Ba quyết định đáng ghi

**(a) Token PHẲNG thay vì `bg-primary/12`.** Hồ sơ wave §6 viết «bong bóng của tôi = `primary/12%` nền».
Màu trong suốt cho ra **tỉ số tương phản khác nhau trên mỗi nền nó chồng lên** (khung cuộn thường ·
dải làm nổi `bg-primary/10` của kết quả tìm kiếm) ⇒ không có con số nào để khẳng định, và
`done_when #1` đòi đo ≥4.5:1 ở CẢ hai chế độ. Nên trộn sẵn `primary` 12% trên `--background` của từng
chế độ thành hai token phẳng: `#daedf8` (light) · `#0d2437` (dark). Đo được: ~14:1 với `--foreground`
ở cả hai — `MessageBubble.theme.spec.tsx` đọc thẳng `theme.css` và tính WCAG.

> Bài đo KHÔNG dựng trên DOM: jsdom không có engine CSS, `getComputedStyle` trả rỗng ⇒ một bài
> "đo tương phản" trên DOM sẽ xanh với **mọi** cặp màu, kể cả chữ trắng trên nền trắng.

**(b) ⚠️ Phím tắt tìm kiếm là Ctrl/⌘+Shift+F, KHÔNG phải Ctrl/⌘+K — lệch có chủ đích so với `done_when #6`.**
`done_when` viết «Ctrl/⌘+K mở tìm kiếm **(không trùng phím tắt shell)**». Hai vế mâu thuẫn nhau trên
code thật: `apps/app/src/layouts/home/AppSwitcher.tsx:166-176` đã gắn Ctrl/⌘+K trên `document` kèm
`preventDefault`, **luôn sống ở mọi trang**. Bắt thêm ở khung chat là hai handler cùng nổ trên một lần
bấm — bảng chuyển app bật lên đồng thời với cột tìm kiếm. Ràng buộc trong ngoặc thắng cái tên phím;
chọn Ctrl/⌘+Shift+F (khuôn «tìm trong hội thoại» của Slack/Teams). Ghim bằng ca test
«KHÔNG cướp Ctrl/⌘+K» để quyết định này không trôi ngược.

**(c) Hero có nút chỉ ở khung trống của TRANG.** Khung trống *trong* một phòng đã mở dùng cùng
component nhưng **0 nút**: ô soạn nằm ngay dưới và đó chính là hành động cần làm; thêm «Tin nhắn mới»
ở đó là mời tạo phòng thứ hai khi người dùng vừa mở đúng phòng họ muốn nhắn.

## 3. Hai bẫy đã gỡ trong lúc làm

- **Bài đếm avatar suýt đỏ vì lý do sai.** `MessageList.grouping.spec.tsx` gieo `myUserId = ANNA` và mọi
  tin đều của ANNA. Bố cục hai phía chỉ vẽ avatar bên trái ⇒ mọi tin thành «của tôi» ⇒ 0 avatar và cả
  bộ đếm đỏ vì **bố cục**, không phải vì luật gộp. Đổi người đang xem thành người THỨ BA: giữ nguyên
  số ca, giữ nguyên thứ đang đo.
- **Nhãn «Đã ghim» mất tích ở tin gộp.** Nhãn bám vào hàng TÊN, mà hàng đó chỉ tồn tại ở tin đầu cụm
  của người khác ⇒ ghim một tin gộp là ghim xong mà không có dấu vết nào. Đưa nhãn vào trong bong bóng
  cho mọi trường hợp còn lại.
- **Thanh tác vụ ẩn vẫn ăn chuột.** Thanh ở `-top-3` chồng lên đáy bong bóng phía trên; `opacity-0`
  không tắt `pointer-events` ⇒ bấm vào tin trên trúng nút vô hình của tin dưới. Cặp
  `pointer-events-none` + `group-hover:/focus-within:pointer-events-auto` xử lý, và **không** dùng
  `invisible`/`hidden` (chúng loại nút khỏi luồng tab ⇒ mất tác vụ với người dùng bàn phím).

## 4. Nghiệm thu

| done_when | Bằng chứng |
| --- | --- |
| #1 hai phía · avatar trái · giờ cuối cụm · tương phản ≥4.5:1 light+dark | `MessageBubble.spec.tsx` (3 describe v2) · `MessageBubble.theme.spec.tsx` (light+dark + 2 ca đối chứng) · `MessageList.grouping.spec.tsx` giữ **9 ca** |
| #2 ratchet XSS xanh · reply/recalled/attachment/ReactionBar y cũ | `MessageBubble.spec.tsx` nhóm (a)(b)(c) không đổi, vẫn xanh |
| #3 thanh tác vụ nổi · hover/focus-within · bàn phím vào được | `MessageBubble.spec.tsx` «thanh tác vụ nổi» (8 ca, gồm ca ALLOW/DENY của `canPin`/`canRecall`) |
| #4 đã xem ≤3 + «+N» · tooltip tên · 0/1/3/5 người | `SeenByAvatars.spec.tsx` (9 ca) · `MessageList.spec.tsx` ca §13.2 |
| #5 header + hero 2 hành động (gate create) | `ConversationHeader.spec.tsx` (11 ca) · `ChatEmptyHero.spec.tsx` (6 ca, DENY kèm ALLOW) |
| #6 phím tắt · typecheck/build/test xanh | `ConversationPanel.spec.tsx` «phím tắt» (8 ca) |

**Lệnh đã chạy (worktree `mediaos-s17fe2`, nhánh `wo/s17-chat-ux2-fe-2`):**

```
pnpm --filter @mediaos/app typecheck   ✅
pnpm --filter @mediaos/app lint        ✅
pnpm --filter @mediaos/app build       ✅
pnpm --filter @mediaos/ui  test        ✅ 98/98
npx vitest run src/{components,hooks,layouts,stores,test,routes}   ✅ 258 file · 2 458 test
```

> Chạy `npx vitest run` một lượt cho CẢ apps/app thì tiến trình chết giữa chừng với
> `ERR_IPC_CHANNEL_CLOSED` **trước khi in tổng kết** — hạ tầng, không phải bài test (0 dòng `FAIL`
> trong log). Đúng triệu chứng đã ghi ở memory `fullsuite-enobufs-and-unrescued-chunk` ·
> `vitest-worker-crash-chunked-runs`. Chạy theo 6 chunk thư mục: cả 6 exit 0.

## 5. Chừa lại cho WO sau (KHÔNG làm ở đây)

- `peer` · `lastMessage` trong DTO danh sách phòng → **BE-1**; avatar peer ở thanh đầu hiện lấy tạm từ
  **roster phòng** (đã tải khi mở phòng), không mở đường ký mới.
- Chip lọc · dòng phòng 56px · gỡ cache `resolvedNames` → **FE-1**.
- `@mention` · emoji · dán ảnh trong ô soạn → **FE-3** (`ConversationPanel` không đụng composer).
- Drawer + responsive 3→2→1 cột → **FE-5**. `ConversationPanel` vẫn dùng lại được với
  `showHeader={false}`; `ConversationHeader` tách riêng chính là để FE-5 dùng lại được với kích thước khác.
