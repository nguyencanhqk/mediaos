# S7-CHAT-QA-1 — coverage module CHAT

> `done_when`: **tổng ≥ 80%**, vùng **`ChatAccessService` + tìm kiếm ≥ 95%**.
> Đo trên lane `mediaos_s7qa1`, HEAD `32ccd2a4` + thay đổi của WO này.

## Cách đo (và vì sao đo như thế)

```bash
npx vitest run \
  test/integration/chat-*.int-spec.ts test/integration/s7-chat-*.int-spec.ts src/chat \
  --coverage --coverage.include='src/chat/**' --no-file-parallelism
```

Hai điều kiện bắt buộc, thiếu một là con số vô nghĩa:

1. **`LANE_DB` phải có.** Không có thì mọi `*.int-spec.ts` `describe.skipIf(!hasLaneDb)` bị SKIP, và
   coverage rơi xuống mức của riêng unit test — vẫn ra một con số trông bình thường.
2. **Chạy CẢ HAI glob trong MỘT lần**: `test/integration/**` (int) **và** `src/chat` (unit colocated).
   Bỏ một glob là dìm hoặc thổi con số (memory `coverage-audit-scan-both-globs`).

Kết quả lần chạy: **28 test file · 577 ca · 577 passed / 0 failed**.

---

## 1. Tổng module CHAT — ✅ ĐẠT (ngưỡng 80%)

```
Statements   : 96.16% ( 4708/4896 )
Branches     : 87.66% (  796/908  )
Functions    : 98.03% (  249/254  )
Lines        : 96.16% ( 4708/4896 )
```

## 2. Vùng nhạy cảm: `ChatAccessService` + tìm kiếm — ✅ ĐẠT (ngưỡng 95%)

Số từ lần chạy ĐẦY ĐỦ ở trên:

| File | % Stmts | % Branch | % Funcs | Dòng chưa phủ |
| --- | --- | --- | --- | --- |
| `chat-access.service.ts` | **100** | 100 | 100 | — |
| `chat-search.service.ts` | **100** | 100 | 100 | — |
| `chat-search.repository.ts` | **100** | 87.5 | 100 | (nhánh) 50 |
| `chat-search.controller.ts` | **100** | 100 | 100 | — |
| `chat-visibility.ts` | **100** | 100 | 100 | — |
| `chat-search-cursor.ts` | 94.44 | 91.66 | 100 | 78–79 |

**Aggregate của vùng** (lần chạy thu hẹp `--coverage.include` đúng 6 file trên):

```
Statements   : 98.75% ( 398/403 )
Branches     : 94.23% (  49/52  )
```

### `chat-search-cursor.ts` 78–79 — vì sao KHÔNG viết test để "cho đủ 95%"

```ts
try {
  payload = Buffer.from(raw, "base64url").toString("utf8");
} catch {
  invalid();          // ← dòng 78–79
}
```

`Buffer.from(x, "base64url")` trong Node **không ném** với input rác — nó bỏ qua ký tự không hợp lệ và
trả buffer rỗng/ngắn. Nhánh `catch` này là **phòng thủ không tới được**, không phải đường chưa test.

Ba lý do không "vá" nó:

1. Không có input nào của người dùng làm nó chạy ⇒ muốn phủ thì phải **mock `Buffer.from`**, tức là
   test khẳng định *"nếu Node đổi hành vi thì ta xử lý đúng"* — đo thư viện, không đo sản phẩm.
2. Con trỏ rác **đã có ca thật**: `chat-be4-search` : *ca 14 cursor rác → 400, KHÔNG im lặng rơi về
   trang đầu* — đi qua các vế validate ngay bên dưới (`indexOf`, `UUID_RE`, `Date`, vòng khứ hồi).
   Hành vi mà spec quan tâm (**400, không im lặng**) được phủ; chỉ một `catch` thừa là không.
3. Ngưỡng là để bảo vệ chất lượng, không phải để làm đẹp bảng. Viết test giả chỉ nhằm đẩy 94.44 → 100
   là đúng thứ ngưỡng sinh ra để ngăn.

Vùng nhạy cảm **đạt 98.75% ở mức aggregate** và `ChatAccessService` — file quyết định mọi ranh giới
đọc của module — **đạt 100%**, nên ngưỡng 95% được thoả mà không cần đụng tới nhánh này.

---

## 3. Các file dưới 95% (ngoài vùng nhạy cảm — ngưỡng áp dụng là 80%)

| File | % Stmts | Ghi chú |
| --- | --- | --- |
| `chat-derived-rooms-reconcile.job-handler.ts` | 87.16 | nhánh lỗi/telemetry của job đối soát; đường chính có 5 ca ở `chat-be5` khối C |
| `chat-derived-rooms-sync.service.ts` | 90.51 | nhánh no-op của các writer hiếm |
| `chat-attachments.service.ts` | 94.24 | nhánh presign lỗi hạ tầng (S3 down) |
| `chat-rooms.service.ts` | 82.13 | nhánh 422 `CREATE_TYPE` không tới được qua HTTP (Zod chặn trước) + nhánh lỗi cấp mã |
| `chat-oversight-audit.guard.ts` | 92.24 | nhánh ghi audit hỏng ở tầng guard |

Tất cả đều **trên ngưỡng 80%**. Không file nào trong nhóm này nằm trên đường quyết định quyền đọc.

---

## 4. Cảnh báo khi đo lại

- **Đừng chạy `pnpm test` rồi đọc coverage.** Không `LANE_DB` ⇒ SKIP hàng loạt int-spec.
- **Đừng chạy qua turbo mà không `TURBO_FORCE=1`** — cache trả log CŨ, coverage đọc thành xanh-giả
  (memory `turbo-cache-false-green`).
- **Gộp quá nhiều file trong một lần chạy `--coverage` có thể sập worker** với
  `ERR_IPC_CHANNEL_CLOSED` (tinypool@1.1.1 — KI-014, memory `vitest-worker-crash-chunked-runs`).
  Đã gặp đúng lỗi này khi chạy 7 int-spec nặng + `src/chat` cùng `--coverage`; cách xử lý là **chia
  nhỏ lần chạy**, không phải giảm phạm vi đo.
