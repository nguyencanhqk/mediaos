# S14-QA-COVGATE-1 — dọn cổng coverage CHẾT (micro-plan)

> Work Order: `harness/backlog.mjs` → `S14-QA-COVGATE-1`. Nợ được ghi lại từ `S13-PAYROLL-QA-1`
> (`docs/QA/evidence/S13-PAYROLL-QA-1-ACCEPTANCE.md` §6.3): script `test:cov` (`apps/api/package.json`)
> vẫn trỏ `src/workflow` — module đã xoá hẳn ở `S10-CLEAN-WORKFLOWCLUSTER-2`.

## 1. Vấn đề

Vitest **bỏ qua trong im lặng** — không cảnh báo, không đỏ — khi:

- một script chạy `vitest run <dir không tồn tại>` (0 test, exit 0);
- một khoá `coverage.thresholds` không khớp file nào trong report.

`S13-PAYROLL-QA-1` đo được 5/7 khoá của module PAYROLL chết theo kiểu này (4 khoá `src/workflow/*` +
1 khoá payroll gõ nhầm số ít/số nhiều) và đã vá phần `vitest.config.ts`. Phần còn lại — script
`test:cov` trong `package.json` — bị hoãn sang WO riêng vì ngoài diện PAYROLL. Đây là WO đó.

## 2. Quyết định

`test:cov` (bare) bị **XOÁ**, không sửa lại đường dẫn, vì:

1. Không còn "phạm vi mặc định" hợp lý: mỗi module nhạy cảm (`payroll`/`sensitive`/`call`/`asset`/
   `room`/`recruit`) đã có script `test:cov:<module>` riêng.
2. Đặt `test:cov` chạy `--coverage` toàn repo KHÔNG `--coverage.include` sẽ VI PHẠM đúng bất biến ghi
   ở `vitest.config.ts` (đoạn cạnh threshold `call-signalling.gateway.ts`): "không job nào được chạy
   `--coverage` mà thiếu `--coverage.include`" — vì thresholds per-file chỉ CẮN khi file đó lọt vào
   report, một lượt full-repo không include sẽ kéo TẤT CẢ threshold key vào report dưới một lượt
   KHÔNG chạy `LANE_DB` (int-spec skip) ⇒ đỏ oan/không đo đúng ý nghĩa của từng khoá.

## 3. Việc làm

- `apps/api/package.json` — xoá dòng `test:cov`.
- `apps/api/vitest.config.ts` — cập nhật 2 comment còn nhắc script đã xoá (nợ ghi ở dòng ~106 và
  chú thích "workflow-scoped `test:cov` run" ở nhóm auth/permission).
- `apps/api/test/foundation/coverage-thresholds-ratchet.unit-spec.ts` (MỚI) — ratchet tự-kiểm:
  1. mọi khoá `test.coverage.thresholds` trong `vitest.config.ts` trỏ file CÓ THẬT — đọc qua **AST**
     (TypeScript compiler API), KHÔNG regex trên toàn văn (tránh bẫy đọc nhầm chuỗi trong comment,
     memory `vitest-exclude-selfcheck-reads-comments`);
  2. mọi token đường dẫn `src/**`/`test/**` CỤ THỂ (không glob) trong từng script `test:cov*` của
     `package.json` trỏ file/thư mục CÓ THẬT;
  3. hai ca PHẢN CHỨNG (fixture cài khoá/token ma) + hai ca ĐAI CHỐNG-BẪY (path chỉ nằm trong comment;
     glob giữa chuỗi như `chat-call*.ts` không bị cắt cụt thành path ma) — chứng minh cơ chế thật sự
     VI PHẠM được, không phải test xanh-rỗng.

## 4. RED → GREEN đã chạy

`git stash` tạm hai file đã sửa (`package.json` + `vitest.config.ts`) rồi chạy riêng spec mới:
ca "mọi script `test:cov*` ... trỏ đường dẫn CÓ THẬT" ĐỎ đúng lý do dự kiến
(`expected [ 'test:cov: src/workflow' ] to deeply equal []`), 5 ca còn lại vẫn xanh. `git stash pop`
khôi phục bản vá ⇒ cả 6 ca xanh.

## 5. Verify

- `npx tsc -p apps/api/tsconfig.json --noEmit` — sạch.
- `npx vitest run` (apps/api, không LANE_DB) — 296 file / 4650 test PASS, phần còn lại SKIP đúng
  (int-spec chờ Postgres).
- `bash harness/check.sh --lane-db=s14qacovgate1` — **XANH ✅** toàn bộ 7 bước; `@mediaos/api`
  625/625 file spec chạy (4 lần crash-hạ-tầng-tự-hồi-phục đã biết, 0 test đỏ thật).

## 6. Nợ còn lại (ngoài phạm vi)

Không phát sinh. `test:cov*` giờ là danh sách đóng, mỗi khoá/đường dẫn có ratchet canh; thêm/xoá
module coverage-scoped sau này phải đi kèm sửa spec này trong CÙNG commit.
