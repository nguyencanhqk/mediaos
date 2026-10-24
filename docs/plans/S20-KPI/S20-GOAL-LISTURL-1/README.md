# S20-GOAL-LISTURL-1 — lượt đếm KPI #18 (phần prefill)

Theo `docs/plans/S20-WORKUX-STORIES.md` §4 và §7 Q25 = A: đếm trong trình duyệt thật (Playwright MCP) với API giả lập, chạy tay trước khi mở PR.

## Sổ vết

| Ngày       | Commit     | Phép đo                                                                      | Đích                            | Đo được                                                                           |
| ---------- | ---------- | ---------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| 24/10/2026 | `1a0f4541` | KPI #18: phân rã mục tiêu phòng cho 6 nhân viên, xuất phát `/goals/{cha}`    | ≤ 42 thao tác, ≤ 6 chuyển trang | 32 thao tác (2 + 6 × 5), 2 chuyển trang; «Lưu và thêm tiếp» ×5 không chuyển trang |
| 24/10/2026 | `1a0f4541` | Một mục tiêu con                                                             | ≤ 7 thao tác, 1 chuyển trang    | 7 thao tác, 1 chuyển trang                                                        |
| 24/10/2026 | `1a0f4541` | Back từ `/goals` về trang chi tiết đứng trước                                | URL chi tiết giữ y nguyên       | ❌ URL chi tiết bị ghi thêm bộ lọc danh sách (2/2 lượt) — đã vá ở commit kế tiếp  |
| 24/10/2026 | `49a62537` | Back từ `/goals` (2 lượt) · Back về `/home` · bấm dòng rồi Back · «Quay lại» | URL giữ y nguyên                | ✅ mọi URL đúng như trước; trang chi tiết mở từ dòng không mang bộ lọc danh sách  |

Ca kèm theo (cùng lượt `1a0f4541`):

- Thiếu `create:goal` ⇒ 0 nút «Thêm mục tiêu con»; tự gõ URL `/goals/new?…` rồi lưu ⇒ BE trả 403, form báo thiếu quyền.
- `/goals` URL trống: phạm vi `view:goal` rộng hơn Own ⇒ kỳ = quý hiện tại theo giờ công ty + phòng của tôi; phạm vi Own ⇒ chỉ kỳ.
- Tham số rác ⇒ mặc định, không màn lỗi. «Của tôi» gọi `GET /me/goals` kèm kỳ, 0 request mang `employeeId`.

## Chạy lại

1. Build `packages/contracts` (dist/cjs) trong cây đang đo.
2. `node gen-fixtures.cjs > fixtures.json` (tuỳ chọn — `fixtures.json` đã có sẵn), rồi `node mock-api.cjs fixtures.json` (nghe `127.0.0.1:59999`).
3. Dev server từ gốc repo: `VITE_API_URL=http://127.0.0.1:59999/api/v1 VITE_AUTH_APP_URL=http://127.0.0.1:59998 pnpm --filter @mediaos/app exec vite --port 5299 --strictPort`.
4. Trong Playwright MCP: `browser_run_code` với nội dung `run.js`. Ảnh lưu dưới `.playwright-mcp/s20-kpi/`.

`page.route`/`route.fulfill` làm rơi kết nối Playwright MCP trên máy đo, nên API giả lập là một tiến trình node riêng.
