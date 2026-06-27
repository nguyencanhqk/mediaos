# Dashboard báo cáo dự án — MediaOS

App nhỏ **served + live** để xem: dự án đang ở đâu · tiến độ % · giai đoạn · Work Order nào đang làm/sẵn sàng/chờ · **kiểm tra ở đâu/thế nào** mỗi việc · cảnh báo rủi ro.

## Chạy

```bash
node harness/dashboard/server.mjs      # hoặc: pnpm dashboard
# → http://localhost:5180            Board Work Order (sprint hành S0–S1)
# → http://localhost:5180/progress   Ma trận Module → Tính năng (toàn 112 story)
# → http://localhost:5180/docs        Trình duyệt tài liệu (toàn bộ docs/)
# (đổi cổng: PORT=6000 node harness/dashboard/server.mjs)
```

> **3 trang** dùng chung menu điều hướng (Báo cáo · Tiến độ · Tài liệu):
> - `/` board Work Order · `/progress` ma trận tính năng (IMPLEMENTATION-02 × backlog × ledger
>   qua `harness/lib/stories.mjs`) · `/docs` trình duyệt tài liệu (`docs.html`).
> - Story chưa có Work Order = "Sprint sau" (backlog hành chỉ giữ S0–S1, kéo dần theo IMPLEMENTATION-02 §9).

Ctrl+C để dừng. **LIVE**: server đọc lại `harness/backlog.mjs` mỗi lần poll (5s) → sửa backlog là dashboard tự cập nhật, không cần restart.

## Kiến trúc (zero-dep, cô lập)

- **`server.mjs`** — Node `http` thuần (KHÔNG deps, KHÔNG build). Đọc CÙNG nguồn sự thật như `gen-status`: `harness/backlog.mjs` + git + `_journal.json`. Phục vụ:
  - `GET /api/status` → JSON (tính lại mỗi request: tiến độ, Work Order, readiness, verify-guide, rủi ro).
  - `GET /` → `index.html`.
- **`index.html`** — React 18 + htm nạp qua ESM CDN (esm.sh), poll `/api/status` mỗi 5s, click card → xem `done_when` + cách kiểm tra.
- Đặt ngoài workspace (`apps/*`/`packages/*`) → **CI/turbo/product build KHÔNG đụng tới**. Không thêm deps vào monorepo.

> Lưu ý: React nạp từ esm.sh nên lần đầu cần internet. Cần chạy offline hoàn toàn → nói mình vendor React vào `harness/dashboard/vendor/`.

## Quan hệ với phần còn lại

| Lớp | Vai trò |
| --- | --- |
| `backlog.mjs` | NGUỒN SỰ THẬT máy-đọc (Work Order) |
| `gen-status.mjs` → `docs/STATUS.md` | bản tĩnh "đang ở đâu" cho mỗi phiên CLI |
| **dashboard** (file này) | bản **trực quan + live** của cùng dữ liệu |
| agent **`project-analyst`** | đọc dashboard + git + check/CI → **viết báo cáo + cảnh báo rủi ro** (gọi theo yêu cầu) |

"Kiểm tra ở đâu/thế nào" mỗi Work Order được suy tự `paths` + `zone`: lệnh `check.sh` (đỏ → `--all`), DB cô lập lane, `pnpm --filter` test, spec nghiệm thu, glob test. Vùng đỏ luôn ghi rõ: deny-path RED trước + FULL gate + người chốt.
