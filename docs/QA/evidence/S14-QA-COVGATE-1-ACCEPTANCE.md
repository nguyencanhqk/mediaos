# S14-QA-COVGATE-1 — nghiệm thu (bằng chứng đo)

> Work Order: `harness/backlog.mjs` → `S14-QA-COVGATE-1`. Kế thừa nợ từ
> `docs/QA/evidence/S13-PAYROLL-QA-1-ACCEPTANCE.md` §6.3. Micro-plan: `docs/plans/S14-QA-COVGATE-1.md`.
> Ngày đo: **2026-09-02**.

## 1. Trước khi vá

- `apps/api/package.json:12` — `test:cov` = `vitest run src/workflow --coverage --coverage.include=src/workflow/**`.
  `src/workflow` **không còn tồn tại** (module dọn hết ở `S10-CLEAN-WORKFLOWCLUSTER-2`) ⇒ lệnh chạy
  "thành công" (exit 0, 0 test) mà không đo gì.
- `apps/api/vitest.config.ts` — 15 khoá `coverage.thresholds` hiện tại (sau khi `S13-PAYROLL-QA-1` đã
  gỡ 4 khoá `src/workflow/*` + sửa 1 lỗi số ít/số nhiều) đều trỏ file CÓ THẬT — đã quét lại và xác
  nhận, không có khoá chết mới.

## 2. Vá

- Xoá script `test:cov` (bare) khỏi `apps/api/package.json` — không còn phạm vi mặc định hợp lý (mỗi
  module nhạy cảm đã có `test:cov:<module>` riêng; chạy `--coverage` toàn repo không
  `--coverage.include` vi phạm bất biến đã ghi tại `vitest.config.ts`).
- Cập nhật 2 comment trong `vitest.config.ts` còn nhắc script đã xoá.
- Thêm `apps/api/test/foundation/coverage-thresholds-ratchet.unit-spec.ts` — ratchet tự-kiểm 2 bề mặt
  (khoá `thresholds` + token đường dẫn trong mọi script `test:cov*`), đọc `vitest.config.ts` qua
  **AST** (không regex trên toàn văn — tránh bẫy đọc nhầm comment).

## 3. RED → GREEN

`git stash` tạm bản vá `package.json`+`vitest.config.ts`, chạy riêng spec mới: ca kiểm `test:cov*`
ĐỎ đúng dự kiến (`expected [ 'test:cov: src/workflow' ] to deeply equal []`). `git stash pop` khôi
phục ⇒ 6/6 ca xanh, bao gồm 2 ca PHẢN CHỨNG (khoá/token ma bị bắt) + 2 ca ĐAI CHỐNG-BẪY (comment
không bị đọc nhầm thành khoá; glob giữa chuỗi như `chat-call*.ts` không cắt cụt thành path ma).

## 4. Kết quả đo

| Lệnh | Kết quả |
| --- | --- |
| `npx vitest run test/foundation/coverage-thresholds-ratchet.unit-spec.ts` | 6/6 PASS |
| `npx tsc -p apps/api/tsconfig.json --noEmit` | sạch |
| `npx vitest run` (apps/api, không LANE_DB) | 296 file / 4650 test PASS, phần còn lại SKIP đúng (chờ Postgres) |
| `bash harness/check.sh --lane-db=s14qacovgate1` | **XANH ✅** cả 7 bước — `@mediaos/api` 625/625 file spec chạy (4 lần crash-hạ-tầng tự hồi phục đã biết, 0 test đỏ thật) |

## 5. Nợ còn lại

Không phát sinh trong phạm vi WO này.
