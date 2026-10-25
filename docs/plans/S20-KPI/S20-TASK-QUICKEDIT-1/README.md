# S20-TASK-QUICKEDIT-1 — lượt đếm KPI #7

Theo `docs/plans/S20-WORKUX-STORIES.md` §4 và §7 Q25 = A: đếm trong trình duyệt thật (Playwright MCP) với API giả lập, chạy tay trước khi mở PR.

## Sổ vết

| Ngày       | Commit     | Phép đo                                                                         | Đích                                           | Đo được                                                                                                                                                                                |
| ---------- | ---------- | ------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 25/10/2026 | `57979dfe` | KPI #7: Đang làm → Hoàn thành bằng badge trên dòng, xuất phát `/tasks/my-tasks` | ≤ 4 thao tác, 0 chuyển trang                   | 2 thao tác (bấm badge «Đang làm» → chọn «Hoàn thành»), 0 đổi pathname, 0 tải lại tài liệu; URL giữ `/tasks/my-tasks`                                                                   |
| 25/10/2026 | `57979dfe` | Request của KPI #7                                                              | đúng route change-status, 0 `PATCH /tasks/:id` | 1 × `POST /tasks/{id}/change-status` body `{"status":"Done"}` → 200, rồi 1 × `GET /tasks/my` (invalidate); 0 PATCH                                                                     |
| 25/10/2026 | `57979dfe` | Lạc quan: phản hồi change-status trễ 800 ms                                     | dòng đổi trước khi server trả lời              | Dòng rời nhóm «Đang làm» ngay (nhóm 1 → 0) trước khi có phản hồi; bật «Hiện việc đã xong» thấy việc với badge «Hoàn thành»                                                             |
| 25/10/2026 | `57979dfe` | Chip «Thứ Sáu này», hôm nay giả lập Thứ Năm 22/10/2026 10:00 giờ VN             | body change-deadline = 23/10 17:00 giờ công ty | 2 thao tác, 0 chuyển trang; 1 × `POST /tasks/{id}/change-deadline` body `{"dueAt":"2026-10-23T10:00:00.000Z"}`; chip đổi thành «17:00 23/10/26»; 0 PATCH                               |
| 25/10/2026 | `57979dfe` | Cùng chip, máy ở múi America/New_York (lúc đó là 23:00 Thứ Tư 21/10 ở NY)       | vẫn 2026-10-23T10:00Z (giờ máy sẽ ra 21:00Z)   | `{"dueAt":"2026-10-23T10:00:00.000Z"}`; nhãn mốc vẫn theo giờ công ty («Hôm nay 17:00» = 22/10/26)                                                                                     |
| 25/10/2026 | `57979dfe` | Người dùng thiếu `update-status:task`                                           | badge không bấm được, 0 menu                   | 0 nút `task-row-status-*`, 0 nút «Đổi trạng thái…»; bấm vào badge tĩnh «Đang làm» ⇒ 0 listbox, 0 option, 0 request change-status; chip hạn vẫn còn (3/3) vì còn `update-deadline:task` |
| 25/10/2026 | `57979dfe` | Bố cục ở 390 px                                                                 | không tràn ngang                               | `scrollWidth` 390 = `clientWidth` 390; badge xuống dòng dưới tiêu đề; popover mốc hạn lật lên trên khi chip sát đáy, nằm trọn trong khung (x 131–377)                                  |

Quan sát kèm theo (không thuộc đích đo, ghi để người duyệt quyết):

- Chọn «Hoàn thành» khi «Hiện việc đã xong» đang tắt ⇒ dòng biến mất ngay khỏi danh sách, không có toast xác nhận hay «Hoàn tác». Người dùng không thấy dấu hiệu nào cho biết thay đổi đã lưu.
- Hôm nay là Thứ Năm ⇒ «Ngày mai 17:00» và «Thứ Sáu này 17:00» cùng ra 23/10/26 17:00: hai chip trùng mốc.
- Menu trạng thái từ «Đang làm» có đủ 5 mục (trạng thái hiện tại được đánh dấu), khớp `task-fsm.ts`.

Máy đo chạy Asia/Bangkok, cùng UTC+7 với giờ công ty, nên các lượt A/B không phân biệt được giờ máy với giờ công ty. Vì vậy có thêm lượt TZ chạy trong context America/New_York.

## Chạy lại

1. Build `packages/contracts` (dist/cjs) trong cây đang đo.
2. `node gen-fixtures.cjs > fixtures.json` (tuỳ chọn, `fixtures.json` đã có sẵn), rồi `node mock-api.cjs fixtures.json` (nghe `127.0.0.1:59999`).
3. Dev server từ gốc cây đang đo: `VITE_API_URL=http://127.0.0.1:59999/api/v1 VITE_AUTH_APP_URL=http://127.0.0.1:59998 pnpm --filter @mediaos/app exec vite --port 5299 --strictPort`.
4. Chép `run.js` vào `.playwright-mcp/s20-kpi/` của checkout chính (MCP chỉ đọc file dưới gốc đó; đường dẫn phải viết `c:\…` chữ thường như danh sách gốc MCP báo) và bỏ dấu `;` cuối file (`browser_run_code` bọc nội dung thành `await (…)(page)`). Rồi `browser_run_code` với `filename=`. Ảnh lưu dưới `.playwright-mcp/s20-kpi/task-quickedit-*.png`.
5. Chạy từng phần bằng cách sửa dòng `PARTS` trong bản chép. Phần `TZ` tạo context mới, nên chạy riêng ở lượt cuối.
6. Xong: dừng hai tiến trình theo PID đang nghe cổng 5299 và 59999 (`netstat -ano`), không diệt theo tên ảnh.

`page.route`/`route.fulfill` làm rơi kết nối Playwright MCP trên máy đo, nên API giả lập là một tiến trình node riêng. Đường chưa giả lập (`/foundation/company/branding`, `/me/avatar`, `/socket.io`) trả 404 và được ghi vào `unmocked`. Chúng không ảnh hưởng luồng đo.
