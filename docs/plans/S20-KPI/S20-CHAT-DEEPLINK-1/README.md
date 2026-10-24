# S20-CHAT-DEEPLINK-1 — lượt đếm KPI #1 · #2

Theo `docs/plans/S20-WORKUX-STORIES.md` §4 và §7 Q25 = A: đếm trong trình duyệt thật (Playwright MCP) với API giả lập, chạy tay trước khi mở PR.

## Sổ vết

| Ngày       | Commit     | KPI | Đích                         | Đo được                                                                                                                                                |
| ---------- | ---------- | --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 24/10/2026 | `c27e6b22` | #1  | ≤ 4 thao tác, 0 chuyển trang | 4 thao tác (chuông → thông báo → gõ vào ô đã có focus → Enter), 0 đổi pathname, URL /tasks giữ nguyên                                                  |
| 24/10/2026 | `c27e6b22` | #2  | ≤ 4 thao tác, 0 chuyển trang | 4 thao tác (avatar/tên → «Nhắn riêng» → gõ → Enter), 0 tải lại trang; pathname đổi 1 lần /chat/G → /chat/D bằng `replace` trong cùng ChatPage (Q5 = A) |

Ca kèm theo (cùng lượt):

- Thiếu cặp `create:chat-room` ⇒ 0 lối «Nhắn riêng» trên trang và trong danh sách thành viên, 0 lời gọi tạo phòng.
- `/chat/<uuid không có trong danh sách phòng của tôi>` ⇒ thông báo chung «Không mở được cuộc trò chuyện này», 0 request mang id đó.
- `/chat/abc` ⇒ thay về `/chat` bằng `replace`, 0 request theo phòng.

Ghi chú cách đếm KPI #2: nếu coi «pathname đổi» là chuyển trang thì ra 1; nếu coi «rời màn chat» là chuyển trang (thiết kế Q5 = A) thì ra 0. Script ghi cả hai.

## Chạy lại

1. Build `packages/contracts` (dist/cjs) trong cây đang đo.
2. `node gen-fixtures.cjs > fixtures.json` (tuỳ chọn — `fixtures.json` đã có sẵn), rồi `node mock-api.cjs fixtures.json` (nghe `127.0.0.1:59999`).
3. Dev server từ gốc repo: `VITE_API_URL=http://127.0.0.1:59999/api/v1 VITE_AUTH_APP_URL=http://127.0.0.1:59998 pnpm --filter @mediaos/app exec vite --port 5299 --strictPort`.
4. Trong Playwright MCP: `browser_run_code` với nội dung `run.js`. Ảnh lưu dưới `.playwright-mcp/s20-kpi/`.

`page.route`/`route.fulfill` làm rơi kết nối Playwright MCP trên máy đo, nên API giả lập là một tiến trình node riêng.
