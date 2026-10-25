# S20-CHAT-UNREAD-1 — lượt đếm KPI #3

Theo `docs/plans/S20-WORKUX-STORIES.md` §4 và §7 Q25 = A. Lượt đếm chạy trong trình duyệt thật (Playwright MCP, Chromium, khung 1366×900) với API giả lập, chạy tay trước khi mở PR. jsdom không có layout nên không đo được vị trí khung cuộn. Ở đây mọi số vị trí lấy từ `getBoundingClientRect`/`scrollTop` thật, và cuộn bằng bánh xe chuột thật để trình duyệt tự bắn sự kiện `scroll`.

Fixture có ba phòng nhóm. «Kinh doanh» có `unreadCount` 25, `lastMessageSeq` 125 (125 tin, nên mốc là 125 − 25 + 1 = 101). «Hành chính» có 0 tin chưa đọc, 40 tin. «Kỹ thuật» có 0 tin chưa đọc, 60 tin, và nhận tin realtime giả lập.

## Sổ vết

| Ngày       | Commit đo  | Phép đo                                                     | Đích                                     | Đo được                                                                                                                                                                                                                                                                       |
| ---------- | ---------- | ----------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 25/10/2026 | `000628b8` | (a) KPI #3: thao tác · chuyển trang, xuất phát `/chat`      | ≤ 1 thao tác, 0 chuyển trang             | ✅ 1 thao tác (bấm phòng «Kinh doanh»). 0 lần tải lại tài liệu. Pathname đổi 1 lần, `/chat` → `/chat/:roomId`, trong cùng ChatPage (`history.length` không đổi)                                                                                                               |
| 25/10/2026 | `000628b8` | (a) tin `roomSeq` 101 ngay dưới vạch, trong khung nhìn      | trong khung, ngay dưới «25 tin chưa đọc» | ✅ Có đúng 1 vạch «25 tin chưa đọc», nằm trong khung, cách mép trên khung 16 px. Tin 101 là tin đầu tiên sau vạch (khe 0 px, trọn trong khung). Tin 100 là tin cuối trước vạch. Khung cách đáy 2.795 px (không bị kéo xuống đáy). Trang không cuộn (`scrollY` 0)              |
| 25/10/2026 | `000628b8` | (a) `POST …/read` ở lần vẽ đầu                              | 0                                        | ✅ 0 sau 1,5 s, vẫn 0 sau thêm 2 s đứng yên ở vạch. Badge phòng vẫn là 25. Lúc mở có 1 trang `GET …/messages?limit=50` (gọi 2 lần do StrictMode ở dev), không có `beforeSeq` vì mốc nằm trong trang đầu                                                                       |
| 25/10/2026 | `000628b8` | (a) cuộn tới đáy                                            | có `POST read` mang seq 125              | ✅ Sau 5 nấc bánh xe, khung cách đáy 0 px và có đúng 1 `POST /chat/rooms/:id/read {"seq":125}`. Badge phòng về 0 sau khi bơm tiếng vọng `chat:read` của server (xem «Giới hạn»)                                                                                               |
| 25/10/2026 | `000628b8` | (b) phòng 0 tin chưa đọc                                    | không vạch, khung ở đáy                  | ✅ 0 vạch. Khung cách đáy 0 px, tin 40 trong khung. 1 thao tác, 0 tải lại. Có `POST read {"seq":40}` như hành vi cũ                                                                                                                                                           |
| 25/10/2026 | `000628b8` | (c) đang đọc giữa chừng có tin mới (phòng 0 chưa đọc)       | khung không bị kéo, nút «↓ N tin mới»    | ✅ Cuộn lên tới `scrollTop` 4460 (cách đáy 1.800 px). Bơm tin 61 thì `scrollTop` vẫn là 4460 và nút hiện «1 tin mới». Bơm thêm 62, 63 thì `scrollTop` vẫn là 4460 và nút hiện «3 tin mới». 0 `POST read` khi đang ở giữa. Bấm nút: về đáy (0 px), có 1 `POST read {"seq":63}` |
| 25/10/2026 | `000628b8` | (c) mở tại vạch rồi có tin mới (phòng 25 chưa đọc, tin 126) | khung không bị kéo khỏi vạch             | ✅ `scrollTop` giữ ở 3497, vạch vẫn cách mép trên 16 px, tin 101 vẫn ngay dưới vạch. Nút từ «25 tin mới» thành «26 tin mới». 0 `POST read`                                                                                                                                    |

**Cách đếm chuyển trang.** Nếu coi «pathname đổi» là chuyển trang thì ra 1. Nếu coi «rời màn chat» là chuyển trang thì ra 0, đúng cột «0→0» ở §4 dòng 3. Bấm phòng chỉ đổi `:roomId` trong cùng ChatPage. Script ghi cả hai số, giống S20-CHAT-DEEPLINK-1.

## Giới hạn của lượt đo

- **Không có socket.** API giả lập không phục vụ `/socket.io`, nên app hiện dải «Mất kết nối — đang kết nối lại». Tin realtime ở (c) được bơm qua chính store của app, tức cùng module Vite `/src/stores/chat.store.ts`, bằng `applyIncomingMessage`. Đó là đúng bước handler `chat:message` làm sau `safeParse`. Trước khi bơm, API giả lập đã nối tin đó vào phòng (`POST /__smoke/state {live}`), nên các lần nạp trang sau vẫn khớp.
- **Badge phòng chỉ về 0 qua tiếng vọng `chat:read`.** App bỏ qua `unreadCount` mà `POST read` trả về; badge chỉ đổi khi nhận `applyReadEvent`. Vì vậy script bơm sự kiện đó, với con trỏ bằng seq vừa POST.

## Thấy được trên trình duyệt (ngoài đích)

- Nút «↓ 25 tin mới» hiện ngay từ lần vẽ đầu, cùng lúc với vạch «25 tin chưa đọc», nên hai nhãn trùng số. Đây là theo mã: mốc «đã thấy» bằng mốc chưa đọc trừ 1. Nút nổi ở giữa đáy khung và đè lên chữ của tin đang hiện (tin 105 trong ảnh A1).
- Mất socket thì đọc tới đáy vẫn POST read, nhưng badge phòng và badge header giữ nguyên 25 cho tới khi có `chat:read` hoặc danh sách phòng nạp lại. Hành vi này có từ trước, không nằm trong diff của WO.
- Bong bóng tin ngắn bị co hẹp và xuống dòng: «KT #46 — Ok» nằm trên 2 dòng (ảnh C1). `MessageBubble` có từ trước, không nằm trong diff.
- Thanh thao tác khi rê chuột (thích · trả lời · ⋯) đè lên giờ của tin phía trên khi con trỏ dừng trong khung (ảnh C1). Đây là thanh có từ trước.

Ảnh (dưới `.playwright-mcp/s20-kpi/`, không commit): `unread-A0-chat-list.png` · `unread-A1-open-at-divider.png` · `unread-A2-scrolled-bottom.png` · `unread-B1-no-unread-at-bottom.png` · `unread-C1-new-messages-mid-read.png` · `unread-C2-after-jump.png` · `unread-D1-divider-plus-live.png`.

## Chạy lại

1. Build `packages/contracts` (dist/cjs) trong cây đang đo.
2. Trong thư mục này: `node gen-fixtures.cjs > fixtures.json` (tuỳ chọn, vì `fixtures.json` đã có sẵn). Bước này kiểm luôn mốc 101. Sau đó chạy `node mock-api.cjs fixtures.json`, nghe ở `127.0.0.1:59999`.
3. Dev server từ gốc cây đang đo: `VITE_API_URL=http://127.0.0.1:59999/api/v1 VITE_AUTH_APP_URL=http://127.0.0.1:59998 pnpm --filter @mediaos/app exec vite --port 5299 --strictPort`. Không bao giờ trỏ API thật.
4. Chép `run.js` vào `.playwright-mcp/s20-kpi/` của checkout mà Playwright MCP được phép đọc, và **bỏ dấu `;` cuối tệp**: MCP bọc mã thành `(…)(page)` nên `};` báo «Unexpected token ';'». Sau đó gọi `browser_run_code` với `filename=` trỏ vào bản chép. Kết quả là JSON với các phần A (KPI #3), B, C, D. Ảnh lưu dưới `.playwright-mcp/s20-kpi/`.
5. Xong thì dừng dev server và API giả lập theo PID đang nghe cổng 5299 / 59999 (`netstat -ano`), không diệt theo tên ảnh.

`page.route`/`route.fulfill` làm rơi kết nối Playwright MCP trên máy đo, nên API giả lập phải là một tiến trình node riêng.
