# S16-SOCIAL-STORAGETESTGATE-1 — int-spec storage chốt đúng tên đích, ca bỏ qua phải đếm được

> Plan v1 · 20/10/2026 · mã đo trên `f3dcdb45` · worktree `MediaOS-stg` nhánh `test/s16-social-storagetestgate-1` · 🟡 test-infra, gate LIGHT
> (`typescript-reviewer` + `silent-failure-hunter`).
> Viết tắt: `T/` = `apps/api/test/` · `TI/` = `apps/api/test/integration/` · `H/` = `harness/`. [ĐO] = đã đọc mã ở `f3dcdb45` · [SUY RA] = L1 đo.

## 1. Phạm vi + nguồn

- WO: `harness/backlog.mjs` mục `S16-SOCIAL-STORAGETESTGATE-1` (3 `done_when`: mọi int-spec storage thật qua `resolveStorageTestTarget` —
  CI thiếu storage ⇒ ĐỎ, cục bộ lệch ⇒ bỏ qua kèm `console.warn` tên ca + 0 lời gọi storage · đo bằng vi phạm thật · `check.sh --all` /
  `REQUIRE_LANE_DB=1` ⇒ ca bỏ qua theo từng ca ⇒ ĐỎ).
- Nguồn: plan `S16-SOCIAL-FILEDISPOSITION-1` §8 N4 (helper D12 `T/helpers/storage-test-target.ts` + unit 42 ca) · plan `S19-OPS-STORAGEPUBLIC-1`
  B7 + N7 (`:66`, `:189` — ghim `S3_*` trong `test.env` của `apps/api/vitest.config.ts`; C5 đợi WO này). Owner 19/10: N7 đi kèm WO này.

### 1.1 Vì sao spec cũ chạm được bucket PROD [ĐO]

- `app.module.ts:55-58` `ConfigModule.forRoot({ envFilePath: ENV_FILE_PATHS })` chạy lúc IMPORT `AppModule`; `@nestjs/config` 4.0.4
  `config.module.js:202` chỉ gán khoá CHƯA có trong `process.env` ⇒ shell export thắng, còn `unset` (như `lane-vitest.sh:32`) ⇒ giá trị `.env`.
  Các dòng `process.env.S3_BUCKET ??= …` trong spec chạy SAU import ⇒ vô tác dụng khi `.env` có khoá.
- `object-storage.service.ts:95-115` đọc `process.env.S3_*` lúc dựng service (beforeAll). `DEVOPS-03:361`: `mediaos-assets` = bucket PROD
  (2698 object) — cũng là fallback của 12 chỗ `??=` trong test.
- `vitest.config.ts:95` `env: laneDbEnv()`; ngữ cảnh config KHÔNG nạp `.env` (không import `load-env`) ⇒ `test.env` chỉ thấy env của shell.
- Lời gọi mạng phía server: `server-file.service.ts:121` put (PDF phiếu lương 083/084/085) · `files.service.ts:315` stat + `:343` getBytes
  (confirm hàng `Pending`) · `temp-file-cleanup.job-handler.ts:153` delete.

### 1.2 Bảng tệp [ĐO]

| #   | Tệp                                                                                                                                                                                                           | Hôm nay                                                                                                                          | Đích                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | `TI/files-e2e-confirm`                                                                                                                                                                                        | `:159-163` CreateBucket, `BucketAlreadyOwnedByYou` ⇒ sẵn sàng (có thể TẠO bucket) · E1–E4 `ctx.skip()` im lặng · không dọn       | cổng ở beforeAll TRƯỚC dựng app · E1–E4 `needStorage` · dọn theo tiền tố `companyId/` |
| 2   | `TI/hr-employee-avatar`                                                                                                                                                                                       | describe lồng CreateBucket nuốt lỗi · 1 ca                                                                                       | như 1                                                                                 |
| 3   | `TI/me-preferences-avatar`                                                                                                                                                                                    | như 2 · 3 ca                                                                                                                     | như 1                                                                                 |
| 4   | `TI/temp-file-cleanup`                                                                                                                                                                                        | d1 `:168-172` `??=` không cổng, handler DeleteObject THẬT lên bucket env · d2 `:298` `describe.skipIf(!S3_*)` lồng, 5 ca im lặng | d1 seed `storage_provider='Local'` (D-5) · d2 cổng + `needStorage` 5 ca               |
| 5   | `TI/s15-payroll-be5b-pdf`                                                                                                                                                                                     | `:47` `hasLaneDb` gộp `hasStorage` ⇒ CI thiếu S3 = skip CẢ TỆP im lặng · cục bộ GHI PDF vào bucket `.env`                        | cổng tệp chỉ DB · cổng storage ở beforeAll · mọi ca sinh PDF `needStorage`            |
| 6   | `TI/s15-payroll-be5b-pdf-batch`                                                                                                                                                                               | `:59` như 5                                                                                                                      | như 5                                                                                 |
| 7   | `TI/s15-payroll-qa1-idor-leak`                                                                                                                                                                                | `:55` + `describe.skipIf(!hasStorage)` G7·084 lồng, im lặng                                                                      | `needStorage` ở ca G7·084                                                             |
| 8   | `TI/s15-payroll-qa1-race`                                                                                                                                                                                     | `:38` + G8-4 lồng, im lặng                                                                                                       | như 7                                                                                 |
| 9   | `TI/s13-payroll-qa1-scope-floor`                                                                                                                                                                              | `:789-797` `if (hasStorage) … else not 403` ⇒ XANH-GIẢ, và nhánh nào cũng gọi route ghi PDF                                      | ca storage `needStorage` + khẳng định cứng 200 + `fileName`                           |
| 10  | `TI/s16-filedisposition-storage`                                                                                                                                                                              | ĐÃ dùng helper; `openTestBucket` `:183-213` + `skipStorageCase` `:220-225` riêng                                                 | quy về helper chung (giữ mọi ca)                                                      |
| 11  | `TI/s19-storage-provider-compat`                                                                                                                                                                              | ĐÃ dùng helper; `skipCase` riêng; NotFound ⇒ «chạy s16 trước»                                                                    | quy về helper chung (helper tạo bucket CHO PHÉP khi NotFound ⇒ hết phụ thuộc thứ tự)  |
| 12  | 8 tệp chỉ ký ngoại tuyến (`chat-be3` · `chat-be8` · `s12` · `s14` · `s19-task-file-download-url` · `social-be1c` · `T/helpers/social-qa1-seed.ts` · `src/foundation/files/file-access-hardening.int.spec.ts`) | `S3_* ??=` (15 tệp, kể cả 1–4 + 10) — không gọi mạng                                                                             | bỏ mọi `S3_* ??=` (ghim ở `test.env` thay thế, D-1)                                   |

## 2. Quyết định

| #   | Quyết định                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Lý do                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | **N7 làm ở WO này:** `vitest.config.ts` ghim MỌI khoá `S3_*` mà `env.schema` biết qua hàm THUẦN `pinTestStorageEnv(process.env)` (trong `storage-test-target.ts`). Hồ sơ `live` CHỈ khi `S3_BUCKET` === tên cho phép (CI `mediaos-test` · cục bộ `mediaos-fdisp-test`) VÀ host của `S3_ENDPOINT` (qua `new URL`) ∈ {`localhost`, `127.0.0.1`} VÀ có đủ hai khoá ⇒ chép nguyên. Còn lại ⇒ hồ sơ `offline`: endpoint `http://localhost:9000`, khoá giả (ghép chuỗi), bucket chặn `mediaos-storage-off`, kèm `STORAGE_TEST_PROFILE` | Quy tắc DƯƠNG đóng cả lớp: không spec nào (đã chuyển hay chưa) thấy được bucket PROD hay token R2 PROD sau C5. Khoá giả ⇒ lời gọi lỡ tay bị MinIO từ chối xác thực ⇒ 0 object                           |
| D-2 | `resolveStorageTestTarget` GIỮ NGUYÊN hợp đồng (42 ca unit). KHÔNG thêm `REQUIRE_STORAGE`/`REQUIRE_LANE_DB` vào helper                                                                                                                                                                                                                                                                                                                                                                                                           | CI đã `throw` qua `isCiEnv`; turbo strict-env lọc `REQUIRE_*`/`S3_*` trên đường Linux (`turbo.json` `globalPassThroughEnv`); `check.sh --all` không export `REQUIRE_LANE_DB` ⇒ cổng đặt ở guard đọc log |
| D-3 | Helper I/O MỚI `T/helpers/storage-test-gate.ts`: `openStorageTestGate(file)` gọi ở beforeAll NGOÀI CÙNG, trước `Test.createTestingModule`. `skip-file` ⇒ ném (cổng tệp lệch) · `throw` ⇒ ném · `skip-storage` ⇒ một dòng warn cấp tệp, cổng đóng · `run` ⇒ HeadBucket; NotFound ⇒ CreateBucket (tên đã qua chốt); lỗi khác ⇒ ném mọi môi trường; in dòng nhãn chạy. Trả `{ run, bucket, s3(), needStorage(ctx, caseName), removeObjects(prefixes) }`                                                                             | `s3()` ném khi cổng đóng (như `live()` của s16) ⇒ 0 lời gọi; một chỗ thay 2 bản riêng s16/s19                                                                                                           |
| D-4 | Nhãn log cố định, hàm định dạng THUẦN trong `storage-test-target.ts`: `[storage-test-skip] {"file":…,"case":…,"reason":…}` (warn, trong `needStorage` rồi `ctx.skip()`) · `[storage-test-run] {"file":…,"bucket":…}` (log, beforeAll khi chạy)                                                                                                                                                                                                                                                                                   | JSON ⇒ guard parse chắc; dòng warn cấp tệp KHÔNG mang nhãn ⇒ không bị tính là ca                                                                                                                        |
| D-5 | `temp-file-cleanup` d1 seed `storage_provider='Local'` (`files.ts:33` liệt kê `Local`): handler `:151` trả `not-object-store` rồi vẫn soft-delete (`:121-130`) ⇒ d1 thuần DB; đường xoá object chỉ ở d2 (CI luôn chạy)                                                                                                                                                                                                                                                                                                           | d1 hôm nay gọi DeleteObject lên bucket env không cổng; với D-1 nó sẽ đỏ vì khoá giả                                                                                                                     |
| D-6 | `H/lane-db-guard.mjs`: `parseStorageMarkers(text)` (bỏ ANSI + tiền tố turbo như `cleanLine`; khử trùng lặp skip theo (file, case), run theo file; nhãn không parse được vẫn đếm) · `decideGate` nhận `storageSkips`/`storageRuns`, xét TRƯỚC nhánh `laneDbSet` (`:83-88`): strict ∧ skips > 0 ⇒ `red` · strict ∧ laneDbSet ∧ runs === 0 ⇒ `red` (thành công rỗng) · không strict ∧ skips > 0 ⇒ tối thiểu `warn` · tham số vắng ⇒ hành vi cũ. CLI in thêm `STORAGE:skips=N runs=M`                                                | Cổng hôm nay trả `ok` vô điều kiện khi có LANE_DB và chỉ đếm dòng «Test Files»                                                                                                                          |
| D-7 | `check.sh`: chỉ sửa câu gợi ý banner (`:227`) — thêm cách chạy hồ sơ `live` (export 4 khoá `S3_*` cục bộ, `S3_BUCKET=mediaos-fdisp-test`). Luồng `:181-186`/`:229-231` giữ nguyên                                                                                                                                                                                                                                                                                                                                                | guard mới đọc cùng `TEST_LOG`                                                                                                                                                                           |
| D-8 | `api.yml` bước Test: `pnpm --filter @mediaos/api test 2>&1 \| tee "$RUNNER_TEMP/api-test.log"` (bash mặc định `pipefail`) + bước có tên «Storage int-spec gate» chạy guard `--lane-db-set=1 --strict=1`, đỏ nếu `LEVEL` ≠ `ok`                                                                                                                                                                                                                                                                                                   | CI ném khi lệch (D-2) nhưng không ai thấy nếu spec bị bọc skip cả tệp; bước có tên cho bằng chứng «N tệp storage CHẠY» (STORAGEPUBLIC Verify 6)                                                         |
| D-9 | Ratchet unit `T/foundation/storage-spec-ratchet.unit-spec.ts`: quét `T/**/*.int-spec.ts` · `src/**/*.int.spec.ts` · `T/helpers/*.ts`. Cấm `storageReady` · `hasStorage` · `CreateBucketCommand` (trừ `storage-test-gate.ts`) · `process.env.S3_[A-Z_]+ ??=`. Dương: tệp nào import `@aws-sdk/client-s3` hoặc thuộc danh sách 11 tệp §1.2 ⇒ phải import `openStorageTestGate`                                                                                                                                                     | Chặn tái phát; đỏ trên mã cũ                                                                                                                                                                            |

## 3. Thiết kế

- `storage-test-target.ts` (vẫn THUẦN): thêm `STORAGE_TEST_SENTINEL_BUCKET` · `pinTestStorageEnv` · `STORAGE_SKIP_TAG`/`STORAGE_RUN_TAG` ·
  `storageSkipLine(file, caseName, reason)` · `storageRunLine(file, bucket)`. Khoá giả của hồ sơ `offline` ghép bằng `[…].join("-")` (CLAUDE.md §5).
- `vitest.config.ts`: `env: { ...laneDbEnv(), ...pinTestStorageEnv(process.env) }` — cùng khuôn `resolveTestDbUrls` (import từ `./test/…`).
- Khuôn mỗi tệp storage: `describe.skipIf(!runDb)` giữ · beforeAll ngoài cùng: `gate = await openStorageTestGate("test/integration/<tệp>")`
  rồi mới dựng app · mỗi ca storage dòng đầu `if (!gate.needStorage(ctx, "<mã ca> …")) return;` (dạng trả boolean an toàn dù `ctx.skip()` có
  ném hay không — L1 đo bản vitest) · afterAll `gate.removeObjects(<tiền tố companyId/>)` (chỉ khi chạy, chỉ trên `gate.bucket`).
- Payroll 5/6: cổng tệp `hasDb && LANE_DB`; ca chỉ-DB (deny 403/404) giữ chạy — với D-1 route không còn tới được bucket thật.
- Guard + check.sh + api.yml theo D-6/D-7/D-8. `vitest.config.ts` không đổi gì ngoài dòng `env`.

## 4. Ca RED (viết trước, chạy trên mã cũ)

- R1 `H/lane-db-guard.test.mjs` (node --test, fixture = dòng sinh từ định dạng D-4, cả có/không ANSI + tiền tố turbo): (a) đếm 2 skip khác
  nhau + 1 trùng (chunk chạy lại) ⇒ 2 · (b) strict + laneDbSet + skip > 0 ⇒ `red` (mã cũ `ok`) · (c) strict + laneDbSet + 0 run ⇒ `red` ·
  (d) không strict + skip ⇒ `warn`, CLI exit 0 · (e) dòng warn cấp tệp («sẽ BỎ QUA») không tính · (f) nhãn hỏng JSON vẫn đếm · (g) 14 ca cũ xanh.
- R2 `T/foundation/storage-test-target.unit-spec.ts` thêm `pinTestStorageEnv`: shell trống ⇒ `offline` · cục bộ `mediaos-assets` + endpoint
  thật ⇒ `offline`, khoá ≠ đầu vào · `mediaos-fdisp-test` + loopback + khoá ⇒ `live` nguyên văn · `mediaos-fdisp-test` + endpoint R2 ⇒ `offline` ·
  `http://localhost.evil.test:9000` ⇒ `offline` · `127.0.0.1` ⇒ `live` · CI `mediaos-test` ⇒ `live` · CI trống ⇒ `offline` (rồi helper ném) ·
  hoa-thường/khoảng trắng tên bucket ⇒ `offline` · đủ mọi khoá `S3_*` của `env.schema` · khứ hồi `storageSkipLine` → guard CLI (execFile
  `node H/lane-db-guard.mjs` trên tệp tạm) ⇒ `STORAGE:skips=1` + `LEVEL:red` (chống trôi nhãn giữa TS và .mjs).
- R3 `T/foundation/storage-test-gate.unit-spec.ts` (S3 giả tiêm vào, 0 mạng): cổng đóng ⇒ `needStorage` in đúng 1 dòng nhãn + gọi `ctx.skip`
  - 0 lời `send` · `s3()` ném khi đóng · run + NotFound ⇒ CreateBucket đúng tên · lỗi khác ⇒ ném · CI lệch ⇒ ném · `skip-file` ⇒ ném.
- R4 ratchet D-9 ⇒ đỏ, liệt kê 9 tệp chưa chuyển + 15 tệp `??=`.
- R5 sống (an toàn trên mã cũ): lane-vitest `s16-filedisposition-storage` + `s19-storage-provider-compat` (đã qua helper; cổng đóng ⇒ 0 lời
  gọi) với `S3_BUCKET` không export ⇒ chép `Tests N passed | M skipped`; `node H/lane-db-guard.mjs <log> --lane-db-set=1 --strict=1` ⇒ mã
  cũ `LEVEL:ok` = xanh-giả đã đo. **KHÔNG chạy tệp 1–9 trên mã cũ** (chúng ghi/xoá/tạo trên bucket `.env`).

## 6. Phép đo · vi phạm thật · mutant

- An toàn MinIO dùng chung PROD: chỉ HeadBucket/ListObjectsV2 trên `mediaos-fdisp-test`, bucket chặn và bucket thử `mediaos-stg-probe-<HHMM>`;
  script đếm từ chối mọi tên ngoài danh sách đó (không bao giờ liệt kê bucket PROD); khoá nạp như `lane-vitest.sh` nạp mật khẩu DB, không in.
- M-0 trước: bucket chặn + bucket thử ⇒ NotFound; đếm object `mediaos-fdisp-test`.
- M-closed (hồ sơ `offline`, sau GREEN): 4 lô ≤ 3 — (1) tệp 1-2-3 · (2) 4-10-11 · (3) 5-6-9 · (4) 7-8; chép từng tệp `Tests N passed | M
skipped`; số nhãn skip = M ca storage; guard strict ⇒ `red`, không strict ⇒ `warn`. Lô (5)–(7) tệp nhóm 12 ⇒ xanh (ký ngoại tuyến không gãy).
- M-probe (done_when 2): export `S3_BUCKET=mediaos-stg-probe-<HHMM>` + endpoint/khoá thật ⇒ D-1 hạ về `offline` ⇒ cùng số skip; sau lượt
  bucket thử + bucket chặn vẫn NotFound ⇒ 0 object mới.
- M-open (hồ sơ `live`, `S3_BUCKET=mediaos-fdisp-test`): 11 tệp chạy, 0 nhãn skip, 11 nhãn run, guard strict ⇒ `ok`; số object
  `mediaos-fdisp-test` sau = trước (dọn theo tiền tố).
- Mutant (cây sạch sau mỗi lượt): μ1 `pinTestStorageEnv` chép `S3_BUCKET` vô điều kiện ⇒ R2 đỏ · μ2 guard bỏ xét storage khi laneDbSet ⇒ R1
  đỏ · μ3 bỏ khử trùng lặp ⇒ R1(a) đỏ · μ4 `needStorage` trả true khi đóng ⇒ R3 đỏ; sống: cùng mutant trên tệp 1 ở M-closed ⇒ E1 ĐỎ (khoá giả)
  chứ không xanh · μ5 một tệp quay lại `storageReady` ⇒ R4 đỏ.
- done_when 3: `bash H/check.sh --all --lane-db=stg` hồ sơ `offline` ⇒ kỳ vọng ĐỎ CHỈ do lane-db-guard (vitest exit 0) — đồng thời quét
  spec gọi storage ngầm (hồ sơ `offline` làm chúng đỏ vì khoá giả). Rồi `--all` hồ sơ `live` ⇒ XANH (cổng PR).

## 7. Lát thi công

- **L0** — commit `chore(docs)` riêng chỉ `harness/backlog.mjs`: thêm vào `paths` `apps/api/vitest.config.ts` (N7) ·
  `apps/api/src/foundation/files/file-access-hardening.int.spec.ts` · `harness/lane-db-guard.mjs` · `harness/lane-db-guard.test.mjs` ·
  `harness/check.sh`.
- **L1 RED** — R1–R4 trên mã cũ + R5 sống; ghi đỏ/xanh vào §9.3. Đo [SUY RA]: danh sách khoá `S3_*` của `env.schema` · `ctx.skip()` có ném ở
  bản vitest hiện dùng · `storage_provider` CHECK nhận `Local`.
- **L2 GREEN-a** — `storage-test-target.ts` + `vitest.config.ts` + guard + `check.sh` banner ⇒ R1/R2 xanh.
- **L2 GREEN-b** — `storage-test-gate.ts` + chuyển tệp 1–11 + bỏ `??=` nhóm 12 ⇒ R3/R4 xanh; `api.yml` D-8.
- **L3 đo** — §6 M-0 → M-closed → M-probe → M-open → mutant; typecheck api; prettier.
- **L4 gate LIGHT** — `typescript-reviewer` + `silent-failure-hunter` (hội tụ trên «0 lời gọi khi đóng» · «nhãn ⇄ guard» · «CI không còn
  đường skip»).
- **L5** — `check.sh --all` hai hồ sơ (§6) + gitleaks nhánh ⇒ luồng chính push + mở PR.

## 8. [OWNER] / luồng chính

| #   | Việc                                                                                                                                                                                                                                                              | Chốt                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| W-1 | Ưu tiên + ngân sách                                                                                                                                                                                                                                               | Đã chọn ~14:53 20/10: PR + merge hôm nay (trần 250) |
| W-2 | `kept/…/lane-vitest.sh` (ngoài kho): biến opt-in xuất `S3_BUCKET` chỉ khi = `mediaos-fdisp-test` hoặc khớp `^mediaos-stg-probe-[0-9]{4}$`, kèm endpoint loopback + 2 khoá MinIO cục bộ (không in). Sau C5 khoá lấy từ biến MinIO của compose, KHÔNG từ `S3_*` gốc | Luồng chính, trước L3                               |
| W-3 | Hai lượt `check.sh --all` nặng trên máy PROD — nếu không đủ giờ: thay lượt `offline` bằng 4 lô M-closed + guard CLI cùng tham số check.sh, ghi lệch vào §9.3                                                                                                      | Luồng chính quyết ở L5                              |

## 9. Ngoài phạm vi · nợ · rủi ro

- Nợ: (N1) `turbo.json` chưa passthrough `S3_*` ⇒ trên Linux/macOS `check.sh --all` không chạy được hồ sơ `live` (luôn ĐỎ — đúng, chỉ bất
  tiện; máy này dùng chunk-runner) · (N2) ~27 spec tệp khác chưa đọc từng ca — D-1 khiến lời gọi ngầm (nếu có) ĐỎ thay vì chạm bucket thật;
  lượt `--all` `offline` liệt kê, vá trong WO nếu ít, ngược lại gieo WO.
- Rủi ro: (a) assert cứng host `localhost:9000` trong URL ký — giữ endpoint `offline` = `http://localhost:9000` · (b) unit `src/storage/*.spec.ts`
  tự gán `process.env.S3_BUCKET` — không đổi · (c) d1 `temp-file-cleanup` đổi `storage_provider` (D-5) bớt phủ «xoá object rồi soft-delete»
  ở hồ sơ `offline`; d2 phủ ở CI · (d) cục bộ mặc định nay bỏ qua nhiều ca storage (có nhãn) — cố ý · (e) bucket `mediaos-fdisp-test` tạo bởi
  helper khi NotFound — chỉ tên cho phép, không bao giờ tên PROD.

### 9.3 Sổ vết

| Mốc     | Lúc        | Ghi                                                                                                                                                                                                                                                                                                        |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan v1 | 20/10/2026 | Trên `f3dcdb45`. D-1 ghim `S3_*` ở `test.env` (N7, hồ sơ `live`/`offline`, quy tắc dương) · D-3 helper I/O chung · D-4 nhãn JSON · D-6 guard đếm ca storage, strict ⇒ đỏ bất kể LANE_DB · D-8 bước CI có tên · D-9 ratchet. 11 tệp chuyển + 8 tệp bỏ `??=`; L0 thêm 5 path. Không chạy tệp 1–9 trên mã cũ. |
