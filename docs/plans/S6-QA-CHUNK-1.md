# S6-QA-CHUNK-1 — KI-014: truy gốc crash chạy test local + runner chia chunk

> WO: `harness/backlog.mjs` → `S6-QA-CHUNK-1` · zone **yellow** · gate **LIGHT**
> Nguồn: `RELEASE-02` KI-014 · `RELEASE-06` §4.4 (STAB-F04) · memory `vitest-worker-crash-chunked-runs`

---

## 1. Vấn đề

`bash harness/check.sh` ở **mọi tier** không thể xanh trên máy Windows này: bước test chết giữa chừng
với `Unhandled Rejection: Error: Channel closed (ERR_IPC_CHANNEL_CLOSED)`, **0 ca test đỏ**. Hệ quả
thật không phải "release bị chặn" (CI ubuntu vẫn chạy đủ) mà là **cổng verify local mất tác dụng** —
đỏ-giả thường trực dạy người đọc bỏ qua đỏ, kể cả đỏ THẬT.

## 2. Thứ tự bắt buộc: truy gốc TRƯỚC, vá triệu chứng SAU

`done_when[0]` cấm nhảy thẳng sang runner chia chunk. Phải có **số đo** cho từng cấu hình rồi mới
được kết luận "gốc không sửa được". Ma trận tối thiểu:

| Trục     | Giá trị thử                                                                       |
| -------- | --------------------------------------------------------------------------------- |
| pool     | `forks` (mặc định) · `threads` · `--no-isolate`                                   |
| maxForks | 31 (mặc định = `availableParallelism()-1`) · 16 · 8 · 4                           |
| Tầng gọi | `npx vitest` trực tiếp · qua `pnpm` · qua `turbo` (song song / `--concurrency=1`) |
| Runtime  | Node 24.15.0 (máy này) **vs** Node 22 (bản CI dùng)                               |

Mỗi ô: ≥3 lần chạy, ghi exit code · thời lượng · chữ ký crash · **có/không test đỏ thật**.

## 3. Giả thuyết cần loại trừ (theo thứ tự rẻ → đắt)

1. **Một spec bẩn làm chết worker** → loại nếu package nạn nhân đổi ngẫu nhiên giữa các lần chạy.
2. **Áp lực tiến trình tổng hợp** (turbo chạy 7 package song song × ~31 fork) → loại bằng
   `turbo --concurrency=1`.
3. **Số worker trong MỘT package** → quét ngưỡng maxForks.
4. **Lệch runtime local vs CI** (Node 24 vs Node 22) → A/B bằng Node 22 tải riêng.
5. **Bug upstream tinypool/vitest** → đọc mã `ProcessWorker.send`, tra bản vá ngược dòng.

## 4. Điều kiện để được phép chuyển sang runner chia chunk

Chỉ khi (3) và (4) đều **không** cho cấu hình xanh ổn định, VÀ không có bản vá ngược dòng dùng được
mà không phải nâng cấp lớn ngoài phạm vi WO. Kết luận phải kèm bảng số đo trong
`docs/QA/evidence/`.

## 5. Thiết kế runner (nếu tới bước này)

- Sống trong `harness/` — **không** phải chuỗi lệnh chép tay trong doc (`done_when[1]`).
- Nguồn danh sách file = `vitest list --filesOnly` của **chính app đó** ⇒ không thể giảm phạm vi lén.
- Chia chunk theo **trần số file** (RELEASE-06 §4.4: crash phụ thuộc kích thước chunk, không phải file
  cụ thể) — không hard-code danh sách thư mục.
- **Phân loại đỏ**: crash hạ tầng (IPC/SEGV/ACCESS_VIOLATION/log cụt không có dòng tổng kết) **khác**
  test đỏ thật. Chỉ chunk crash mới được chạy lại; test đỏ thật **không bao giờ** retry.
  → An toàn của luật này phải chứng minh bằng số đo: crash chưa từng đi kèm test đỏ.
- Gộp mọi chunk thành **MỘT** mã thoát.
- In đối chiếu `số file runner chạy` vs `vitest list`, và **công bố** 6 file `exclude` của
  `apps/api/vitest.config.ts` thay vì để chúng biến mất.
- `check.sh` gọi runner **chỉ trên Windows**; CI ubuntu giữ nguyên đường `pnpm test` một lần.

## 6. Rủi ro & chốt chặn

| Rủi ro                                | Chốt                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| Retry che một test đỏ thật            | Phân loại theo chữ ký + **có test đỏ ⇒ cấm retry**; chứng minh bằng số đo                    |
| Runner chạy thiếu file (xanh giả)     | Đối chiếu bắt buộc với `vitest list`, lệch ⇒ ĐỎ                                              |
| `lane-db-guard` mù sau khi đổi runner | Runner phải in dòng tổng kết vitest cho guard đọc; chạy lại `harness/lane-db-guard.test.mjs` |
| Sửa lan sang test/code sản phẩm       | `paths` WO **không** mở `apps/*/src/**`                                                      |

## 7. Định nghĩa đóng

`bash harness/check.sh --all` xanh THẬT trên máy Windows này **với `LANE_DB` set**, cộng
`RELEASE-02` KI-014 + `RELEASE-06` §4.4 cập nhật kèm bằng chứng.

## 8. LIGHT gate chạy bù — 2026-07-28

WO merge ở `dde98ac5` khi **chưa chạy** gate (ràng buộc phiên, ghi trong ledger). Chạy bù trên
đúng diff đã merge. Phạm vi: `harness/chunk-test.mjs` + wiring `harness/check.sh` (0 file sản phẩm).

**Kết luận: PASS** — 0 CRITICAL, 0 HIGH. Luật phân loại crash-vs-đỏ là chỗ dễ sai nhất và nó
fail-closed đúng chiều: `crashed` đòi **đồng thời** `status≠0` · `failed===0` · **không** có dòng
`× file` trong văn bản · (có chữ ký crash **hoặc** không ghi nổi JSON). Bất kỳ dấu hiệu đỏ nào —
kể cả khi report JSON không kịp ghi — đều chặn retry.

| #   | Mức    | Phát hiện                                                                                                                                                                                                                                                                                                                                        | Xử lý                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MEDIUM | Chốt "chống giảm phạm vi lén" chỉ bắt file **đã vào** `vitest list` rồi không chạy. Nó **mù** với vế nguy hiểm hơn: file spec nằm ngoài `include` nên không bao giờ vào danh sách — đúng bẫy đã có tiền lệ trong repo (spec đặt ở `test/unit/**` không bao giờ chạy, mọi reporter vẫn XANH). Sáu file này chỉ được in dạng `ℹ️` giữa một log dài | **ĐÃ VÁ 2026-07-28** — `UNCOLLECTED_BASELINE` (6 dòng, đều là module PARK theo de-media-fy). Ngoài baseline ⇒ **ĐỎ**; dòng baseline cũ ⇒ chỉ cảnh báo (không giấu được test nào). **RED-proof:** thêm `packages/ui/tmp-redproof/scope-guard.spec.ts` + `git add -N` ⇒ runner **ĐỎ** đúng tên file dù 16/16 file · 98/98 test xanh; gỡ ⇒ XANH, exit 0. Baseline đối chiếu lại với phép đo thật: 6/6 khớp, 0 thừa 0 thiếu |
| 2   | LOW    | `parseArgs` không validate số: `--chunk-size=abc` → `NaN` → gom thành một chunk **rỗng** ⇒ vitest chạy TOÀN BỘ file (bỏ qua việc chia chunk) thay vì báo lỗi                                                                                                                                                                                     | Không vá — hệ quả là chạy thừa, không phải chạy thiếu; đường mặc định không đi qua                                                                                                                                                                                                                                                                                                                                      |

**Giới hạn còn lại (không phải lỗi của WO, cần biết):** cả runner lẫn chốt baseline mới **chỉ chạy
trên Windows** (`check.sh` gọi runner theo `uname`). CI ubuntu vẫn là `pnpm test` một lần ⇒ **CI
không có** vế chống-co-phạm-vi này. Đúng thiết kế đã chốt ở §5, ghi lại để không ai tưởng CI đang gác.
