# S19-OPS-STORAGEPUBLIC-1 — storage PROD chuyển sang Cloudflare R2 (bucket riêng tư, URL ký) để tệp dùng được từ máy khác

> Trạng thái: **plan v2 (14/10/2026) — hướng (c) R2 · plan-review PASS_WITH_FIXES, 10 finding đã vá (§9.3) · CHỜ OWNER
> DUYỆT trước khi thi công** · đo trên `b9e437f2` (worktree `MediaOS-stpub`,
> nhánh `fix/s19-ops-storagepublic-1`). Zone ĐỎ · DEVOPS + test storage · KHÔNG đổi mã ký URL · không migration.
> Plan v1 (hướng (a), commit `71a14fb1` ngay dưới commit này) giữ làm tư liệu; mọi phần của v1 không nhắc lại ở đây là
> KHÔNG còn hiệu lực.
> Nguồn: mục WO trong `harness/backlog.mjs` (hợp đồng v2, `done_when` đánh số `[0]`–`[7]`) · ba bản đồ đọc-hiểu của v1
> (SU1 bề mặt ký · SU2 hạ tầng · SU3 dữ kiện ngoài) · phép thử + phép đo trên bucket R2 THỬ ngày 14/10 (§1).
> Kho PUBLIC — plan, commit, PR không nêu tên miền thật, mã tài khoản, tên bucket PROD hay bất kỳ giá trị khoá nào;
> evidence có những thứ đó để NGOÀI kho.
> **Bảng [OWNER] ở §8 — 3 mục CHẶN phần chuyển PROD (O1 · O2 · O3); 0 mục chặn phần mã.**

Viết tắt: `St/` = `apps/api/src/storage/` · `T/` = `apps/api/test/` · `Sw/` = `scripts/windows/` ·
`W/` = `packages/web-core/src/` · `D03` = `docs/DEVOPS/DEVOPS-03_Docker_Containerization.md` · «bucket thử» = bucket R2
`mediaos-fdisp-test` (tên duy nhất `T/helpers/storage-test-target.ts:31` cho ghi khi chạy cục bộ).

## 1. Bối cảnh + phép đo

Storage PROD (container tự host) chỉ nghe ở địa chỉ nội bộ của máy chủ và API ký URL bằng chính địa chỉ đó ⇒ URL ký phát
cho trình duyệt (tải lên · xem · tải về) chỉ dùng được TRÊN máy chủ (đo 09/10, v1 M1–M5). Hướng R2: URL ký nằm trên miền
S3 API của nhà cung cấp, tới được từ mọi nơi, không cần đường vào riêng, không đụng tunnel.

| # | Đo gì | Bằng gì | Kết quả | Ngày |
| --- | --- | --- | --- | --- |
| M1 | Bán kính phát URL ký | v1 M5 (SU1 §B) | MỌI URL ký đi qua đúng HAI hàm `St/object-storage.service.ts` `createUploadUrl` · `createDownloadUrl`; 10 lời gọi trực tiếp + mọi module qua `FileService`; 3 route đặt URL ký vào `Location` của 302 | 09/10 |
| M2 | Client S3 | `St/object-storage.service.ts:93,95-141` | MỘT `S3Client` dựng từ 6 biến `S3_*` đọc thẳng `process.env` lúc dựng service ⇒ đổi nhà cung cấp = đổi GIÁ TRỊ env + khởi động lại API; không đổi mã | 09/10 |
| M3 | Bản SDK | `pnpm-lock.yaml` (worktree `MediaOS-qa1` trùng `origin/master`, `git diff` rỗng) | `@aws-sdk/client-s3` `3.1068.0` | 14/10 |
| R1 | **Nhóm S1–S9 của #578 trên R2** | `s16-filedisposition-storage.int-spec.ts`, 6 biến `S3_*` trỏ bucket thử, lane `mediaos_qa1` | **19/20 xanh**: kiểu nội dung nằm trong chữ ký PUT (lệch ⇒ 403, thiếu ⇒ từ chối) · HEAD trả đúng kiểu · confirm so kiểu · `response-content-type` + `attachment`/`inline` do server ép · sửa URL ký ⇒ 403 · S7–S8. **Đỏ duy nhất: S6 CHO PHÉP** — phản hồi GET KHÔNG có `x-content-type-options` (`:677`, dây bẫy có chủ ý của #578) | 14/10 |
| R2 | Thao tác phía server + header phản hồi | script đo chỉ-đọc trên bucket thử (cùng SDK + cấu hình client của API, §9.3) | PutObject 200 · HeadObject đúng kiểu · GetObject theo URL ký: `content-type` + `content-disposition` đúng giá trị ký, KHÔNG `cache-control`, KHÔNG dấu cache của lớp biên · thêm `response-cache-control` đã ký ⇒ được tôn trọng · ListObjectsV2 ĐƯỢC với token một-bucket · DeleteObject 204 → HeadObject 404 | 14/10 |
| R3 | Bucket riêng tư — cạm «xanh giả» | như R2 | GET KHÔNG chữ ký ⇒ **400 cho CẢ khoá có thật lẫn khoá không tồn tại** ⇒ phép đo không chữ ký đứng một mình không chứng minh gì; phải đặt cạnh lượt CÓ chữ ký trên CÙNG khoá ⇒ 200 (finding F2 của review v1) | 14/10 |
| R4 | CORS chưa cấu hình | như R2 | Preflight PUT từ origin FE ⇒ **403, không header CORS** ⇒ chưa có chính sách CORS thì MỌI lượt tải lên từ trình duyệt hỏng | 14/10 |
| R5 | Chính sách CORS của R2 | tài liệu nhà cung cấp (trang CORS của R2, đọc 14/10) | Trường: `AllowedOrigins` · `AllowedMethods` · `AllowedHeaders` · `ExposeHeaders` · `MaxAgeSeconds`; nhận `*`; **không có trường cho yêu cầu kèm thông tin xác thực (credentials)**; origin `null` không được nhắc; lan truyền tới 30 giây; đặt qua bảng điều khiển hoặc `wrangler r2 bucket cors set` | 14/10 |
| R6 | Đường FE đọc byte bằng JS sau 302 | `W/lib/api-client.ts` (`apiFetchBlob`, `credentials: "include"` — `api-client.spec.ts:351`) · `W/lib/task-file-api.ts:24-36,188` · grep mọi lời gọi `apiFetchBlob` | DUY NHẤT tải tệp TASK đi theo 302 sang storage rồi đọc body; mọi lời gọi khác là file xuất do API tự phục vụ. Sau redirect khác origin, lượt thứ hai mang `Origin: null` (chuẩn Fetch) + chế độ credentials ⇒ cần `Access-Control-Allow-Credentials` mà R2 không có (R5) ⇒ **đường này sẽ hỏng trên R2** [SUY RA — đo bằng trình duyệt thật ở L4]. Chính chú thích của file đã ghi cách sửa: route JSON `download-url` + điều hướng | 14/10 |
| R7 | Mọi đường còn lại của trình duyệt | v1 M12 · SU1 §C | PUT bằng `fetch`/XHR kèm `Content-Type`, `credentials: "omit"`, chỉ đọc mã trạng thái ⇒ cần CORS PUT + header `content-type`. Xem/tải bằng `<img>` hoặc điều hướng ⇒ KHÔNG cần CORS. `avatarSrc` nhận mọi host có `X-Amz-Signature` 64 hex (`apps/app/src/routes/social/feed/lib/feed-format.ts:27-29`) | 09/10 |
| R8 | CSP của FE | `apps/{app,auth,console}/public/_headers` | Chỉ chính sách cache tĩnh, KHÔNG có CSP ⇒ không có danh sách host nào phải thêm miền R2 | 14/10 |
| R9 | Cookie phiên | v1 F6 · R2 trang URL ký | URL ký của R2 chỉ chạy trên miền S3 API của nhà cung cấp, không dùng được với tên miền riêng ⇒ cookie phiên của tên miền công ty KHÔNG đi kèm lượt tải ảnh/tệp | 14/10 |
| R10 | Dữ liệu phải di trú | `du` trong container storage · plan-review v2 F1 | **dưới 1 GB**, MỘT bucket (`mediaos-assets` theo script cài — `Sw/01-setup-env.ps1:81`) dùng CHUNG cho PROD, dev-online (`D03:375`) và int-spec chạy trên checkout chính (mặc định `S3_BUCKET ??= "mediaos-assets"` — `apps/api/src/foundation/files/file-access-hardening.int.spec.ts:226`). Khoá object có tiền tố `{companyId}/` (`St/storage-key.ts:110`) ⇒ **phần PROD = đúng các tiền tố công ty của DB PROD**, không phải cả bucket | 14/10 |
| R11 | Công cụ chép | máy chủ | `rclone` đã cài; `mc` không có; image `mc` không còn nguồn công khai (`D03:394`) | 14/10 |
| R12 | Trần cỡ tải lên | `packages/contracts/src/task.ts:260` · `St/object-storage.service.ts:157-162` | 50 MB ép TRƯỚC mọi lượt ký; R2 một lượt PUT ~5 GB; không còn trần 100 MB của tunnel | 09/10 |
| R13 | CI | `.github/workflows/api.yml:101-106,205-220` | CI chạy storage tự host, không TLS ⇒ CI KHÔNG BAO GIỜ chứng minh tương thích R2 | 09/10 |
| M20 | **CHƯA ĐO (owner)** | — | Hiện trạng từ thiết bị ngoài (`done_when[0]`) · phạm vi CORS cần cho console/auth (có lượt tải lên nào từ hai app này) · tên + vùng đặt bucket PROD · khung giờ chuyển | — |

## 2. Quyết định owner đã có

| Ngày | Nguyên văn lựa chọn | Hệ quả |
| --- | --- | --- |
| 09/10 ~14:55 | «Thử R2 trước» (sau dữ kiện O1 của v1 về storage tự host) | v1 dừng, không vá, không thi công |
| 12/10 ~13:00 | «Giữ R2, tôi tạo bucket hôm nay» | bucket thử đã có, Public Access: Disabled |
| 14/10 ~09:30 | «Chạy ngay» (phép thử R2) → **«chấp nhận»** mất `x-content-type-options: nosniff` | đi hướng (c); B11 dưới đây |

Ba hướng + so sánh: v1 §2 (không đổi). Lý do chọn (c) thay (a): không đưa cổng của storage tự host ra Internet, không
sửa cấu hình tunnel đang chở mọi hostname PROD, khoá ký là token MỘT bucket thay vì tài khoản gốc của storage (v1 F1),
không cookie phiên đi kèm (R9), không trần 100 MB, KHÔNG đổi mã ký. Giá: di trú dữ liệu + một nhà cung cấp ngoài.

## 3. Bất biến phải giữ

| # | Bất biến | Nguồn · cách giữ |
| --- | --- | --- |
| B1 | URL PUT: `content-type` nằm trong chữ ký; lệch kiểu ⇒ storage từ chối | #578 · R1 S1/S2 trên R2 |
| B2 | URL GET: kiểu trả + cách phục vụ do server ép bằng hai `response-*` đã ký | #578 · R1 S5/S9 |
| B3 | Tự kiểm sau ký fail-closed (không đổi mã) | #578 |
| B4 | `assertKeyInTenant` trước mọi lượt ký GET + thao tác server; khoá object giữ nguyên khi di trú (cùng `storage_path`) | CLAUDE.md §2.1 · D5 chép NGUYÊN khoá |
| B5 | TTL URL ký giữ nguyên (`S3_PRESIGN_TTL_SEC`, mặc định 300) | không đổi biến này |
| B6 | Không secret plaintext: token R2 chỉ ở `.env` + `.env.prod` của máy chủ và file cấu hình ngoài kho; không vào log, không vào kho, không vào khung chat; script không in giá trị | CLAUDE.md §2.3 |
| B7 | dev · CI · lane · dev-online GIỮ storage tự host, không đổi gì. Sau C5, `.env` gốc mang token R2 PROD và `load-env` lấy nó làm giá trị dự phòng cho khoá CHƯA có (`apps/api/src/config/load-env.ts:21-37`) ⇒ **cấm chạy int-spec từ checkout chính**; dev-online phải tự mang đủ 6 `S3_*` (kiểm ở C5) | §5 chỉ đổi env của PROD · plan-review v2 F3 |
| B8 | Bucket PROD riêng tư: không bật đường công khai của nhà cung cấp, không gắn tên miền riêng; GET không chữ ký bị từ chối (đo theo cặp R3) | `done_when[3]` |
| B9 | Không mất tệp: chép, KHÔNG BAO GIỜ xoá/đồng bộ-xoá ở nguồn; dữ liệu trên storage tự host giữ nguyên tới khi owner quyết (§9 N3); **cấm `m reset` trong 30 ngày lùi** (nó chạy `docker compose down -v`, xoá luôn volume mà L-A cần — `mediaos.ps1:298`) | D5 · plan-review v2 F8 |
| B10 | Không đổi PORT / adapter / DTO / mã ký; không migration; không dependency mới | phạm vi |
| B11 | **Mất `nosniff` là quyết định có chủ ý (owner 14/10)**: test ghim hành vi ĐO được theo từng nhà cung cấp, không xoá dây bẫy | D2 |

## 4. Thiết kế phần mã + script

| D | Quyết định | Lý do | Phương án đã loại |
| --- | --- | --- | --- |
| D1 | **Không thêm biến env, không đổi `St/` hay `env.schema`.** PROD đổi GIÁ TRỊ 6 biến sẵn có: `S3_ENDPOINT=https://<mã tài khoản>.r2.cloudflarestorage.com` · `S3_ACCESS_KEY`/`S3_SECRET_KEY` = token Object Read & Write chỉ cho bucket PROD · `S3_BUCKET` · `S3_REGION=auto` · `S3_FORCE_PATH_STYLE=true` | R1 + R2 chạy với đúng mã hôm nay. Ít thay đổi nhất = ít chỗ hỏng nhất | Luật «production đòi `https://`» (đường lùi về storage nội bộ `http://` sẽ không boot được) · biến endpoint ký riêng của v1 (R2 có MỘT endpoint) |
| D2 | Ca S6 CHO PHÉP ghim header theo nhà cung cấp: helper `T/helpers/storage-provider.ts` `expectedNoSniff(endpoint)` — hostname khớp TOÀN BỘ `^[0-9a-f]{32}(\.(eu\|fedramp))?\.r2\.cloudflarestorage\.com$` ⇒ `null`; còn lại ⇒ `"nosniff"`. Chú thích dẫn R1 + B11 | Giữ dây bẫy ở CẢ hai phía: storage tự host mất header ⇒ đỏ; R2 bắt đầu gửi header ⇒ đỏ (để cập nhật chủ ý) | Xoá assert (mất bẫy) · so `includes("r2.cloudflarestorage.com")` (khớp host giả mạo kiểu `…com.evil.test` — quy tắc DƯƠNG trên hostname) |
| D3 | Int-spec MỚI `T/integration/s19-storage-provider-compat.int-spec.ts` (dựng qua `applyMainPipeline`, cổng `resolveStorageTestTarget` như #578): thao tác phía server qua CHÍNH `ObjectStorageService` + cặp riêng tư R3 | S1–S9 không phủ PutObject phía server (phiếu lương — `foundation/files/server-file.service.ts:121`) và DeleteObject (dọn tệp tạm — `temp-file-cleanup.job-handler.ts:153`); R2 mới đo tay một lần | Chạy int-spec PAYROLL trên R2 (cổng bucket của chúng nuốt lỗi — nợ `S16-SOCIAL-STORAGETESTGATE-1`) |
| D4 | Script `scripts/storage-r2-compat.sh <file-cấu-hình>`: đọc ĐÚNG 3 khoá (`S3_ENDPOINT` · `S3_ACCESS_KEY` · `S3_SECRET_KEY`) bằng quy tắc dương (32 hex · 64 hex · dạng endpoint R2), không `source` file, không in giá trị; đặt TƯỜNG MINH đủ 6 biến `S3_*` (bucket thử · `S3_REGION=auto` · `S3_FORCE_PATH_STYLE=true`) để không biến nào lấy từ `.env` của máy (plan-review v2 F7); bỏ `DATABASE_*` tường minh (để `LANE_DB` quyết); chạy HAI int-spec (#578 + D3); đầu ra chỉ tên ca + tổng kết, che mọi URL | CI không bao giờ đo R2 (R13) ⇒ cần MỘT lệnh lặp lại được trước lần chuyển và trước MỖI lần nâng `@aws-sdk/*` (luật ghi vào `D03`) | Workflow CI có khoá R2 (khoá ra khỏi máy chủ; kho public) |
| D5 | Script `Sw/storage-migrate-r2.ps1 -SourceConf <f> -TargetConf <f> -Mode Plan\|Copy\|Check [-Prefix <uuid>[,<uuid>…]]` bọc `rclone`: cấu hình remote bằng biến môi trường của tiến trình (không ghi file cấu hình rclone), mỗi file conf 4 khoá (`S3_ENDPOINT` · `S3_ACCESS_KEY` · `S3_SECRET_KEY` · `S3_BUCKET`) kiểm bằng quy tắc dương; `-Prefix` CHỈ nhận UUID (quy tắc dương, mỗi giá trị = một tiền tố công ty — R10); `Plan` = số object + tổng byte THEO TỪNG tiền tố cấp 1 của nguồn + `rclone copy --dry-run` trên các tiền tố đã chọn; `Copy` = `rclone copy` từng tiền tố (KHÔNG `sync`, KHÔNG `move`, KHÔNG cờ xoá — danh sách lệnh cho phép là hằng trong script); `Check` = `rclone check` HAI chiều trên từng tiền tố: thiếu ở đích hoặc lệch hash ⇒ KHÔNG ĐẠT; chỉ-có-ở-đích ⇒ in SỐ LƯỢNG (vd tệp tạm đã bị dọn ở nguồn giữa hai lượt chép) để chuyển cho N3 + so `Content-Type` của mẫu ≤ 20 object (HEAD hai phía). In số object · tổng byte · số lệch, không in khoá object. Đường lùi = cùng script, đảo hai file conf. UTF-8 BOM; không `catch [Kiểu-PS7]`; stdout của lệnh native không lọt vào giá trị trả | B4 + B9; idempotent (chạy lại `Copy` = 0 byte mới) ⇒ dùng cho lượt bù sau khi chuyển; công cụ có sẵn (R11) | Script Node tự viết (tự lo phân trang, thử lại, checksum) · `mc mirror` (không có image) · Super Slurper (cần nguồn tới được từ Internet) |
| D6 | Chính sách CORS của bucket PROD (lưu nguyên văn trong `D03` §13.5 với `<Domain>`): MỘT luật — `AllowedOrigins` = origin của các app FE CÓ tải lên (mặc định 3 origin của `Sw/01-setup-env.ps1:36-37`; O4) · `AllowedMethods` = CHỈ `PUT` (mọi lượt đọc là `<img>` / điều hướng, không cần CORS; sau D7 không còn lời gọi JS nào đọc byte — plan-review v2 F6; thêm `GET` chỉ khi L4 đo ra nhu cầu) · `AllowedHeaders` = `content-type` · `ExposeHeaders` = rỗng · `MaxAgeSeconds` = 600. KHÔNG `*`, KHÔNG `null`. Bucket thử dùng cùng hình dạng với origin của dev cục bộ (L4) | R4 + R7; `done_when[3]` | `*` cho GET (không cứu được tệp TASK — R5 không có credentials) |
| D7 | Tải tệp TASK: **WO tiền đề `S19-OPS-TASKFILEURL-1`** (seed ở commit này) — route JSON `GET /tasks/:taskId/files/:fileId/download-url` cùng cổng `read:task` với route 302 (`apps/api/src/tasks/task-files.controller.ts:72-73`) + FE `downloadTaskFile` lấy URL rồi điều hướng. Phải lên PROD TRƯỚC bước C7 | R6. Đúng cách sửa mà chú thích `W/lib/task-file-api.ts:33-36` đã ghi; chạm `apps/api/src/tasks` + `W/` — ngoài `paths` của WO này | Gộp vào WO này (thêm vùng quyền TASK vào một WO hạ tầng) |
| D8 | `.env.example` khối S3: thêm CHÚ THÍCH dạng giá trị R2 (`S3_REGION=auto`, `S3_FORCE_PATH_STYLE=true`, endpoint không kèm tên bucket, token một bucket) — không đổi giá trị mẫu | Máy mới biết cách bật R2; phải qua `apps/api/src/config/env-example-boots.spec.ts` | — |
| D9 | Tài liệu: ADR mới `docs/DECISIONS/DECISIONS-16_Prod_Object_Storage_R2.md` (quyết định · B11 · O1 · storage tự host giữ cho dev/CI · đường lùi) · `D03` §13.5 (R2 PROD · CORS D6 · lệnh D4 + luật nâng SDK · cạm R3) + ghi chú cạnh `:375-376` · RELEASE-08 (runbook §5 + lùi) · RELEASE-02 **KI-084** ở CUỐI bảng (rebase ngay trước PR) · DEVOPS-11 §6.1 + §9.1 mỗi nơi một dòng (CORS của storage là chính sách bucket, khác CORS của API) | `done_when[5]` | Sửa CLAUDE.md §4 (đã ghi «Cloudflare R2 / MinIO») |

Không đổi: `St/**` · `apps/api/src/config/**` · `docker-compose.yml` · script tunnel · `Sw/01-setup-env.ps1` (máy mới
vẫn mặc định storage tự host; bật R2 theo `D03` §13.5).

## 5. Chuyển PROD — checklist owner tự chạy

**Điều kiện mở:** O1 · O2 trả lời trước C1; O3 trước C7; `S19-OPS-TASKFILEURL-1` ở PROD trước C7. Agent không chạm PROD,
không đọc `.env*`. Gián đoạn duy nhất: một lần khởi động lại API ở C7 — không khởi động lại tunnel, không tạo lại container.

| # | Bước | ĐO là đã đạt | Đường lùi |
| --- | --- | --- | --- |
| C0 | Ghi commit PROD (`GET /api/v1/health`) + `/health/db`; từ thiết bị KHÁC máy chủ gửi một tệp qua chat + xem một avatar | ghi §9.3 (`done_when[0]`) | — |
| C1 | Bảng điều khiển R2: tạo bucket PROD (tên + vùng theo O2; đường công khai TẮT; không tên miền riêng) + Account API token MỚI «Object Read & Write» CHỈ bucket đó (KHÔNG dùng lại token của app khác, vd LMS — plan-review v2 F9) ⇒ file `r2-prod.conf` ngoài kho (4 khoá D5). Lập `minio-prod.conf` (4 khoá của storage tự host, chép từ `.env` — chứa khoá gốc của storage tự host). Hai file nằm ở thư mục KHÔNG đồng bộ lên đám mây, xoá khi hết 30 ngày lùi (N3) | ảnh chụp «Public access: Disabled» lưu NGOÀI kho | xoá bucket + thu hồi token |
| C2 | Đặt CORS D6 lên bucket PROD (bảng điều khiển, thẻ JSON) | phép đo §6 «CORS» chạy với `r2-prod.conf` (owner, hoặc agent nếu O6 cho): preflight PUT từ origin FE ⇒ có `Access-Control-Allow-Origin` = đúng origin đó; origin lạ ⇒ không có | xoá chính sách |
| C3 | Merge PR (không đổi hành vi PROD) → kéo mã về checkout chính → `m prod-update api` theo lịch thường | health mang commit mới | `m prod-rollback` |
| C4 | Owner lấy danh sách `id` của bảng `companies` trên DB PROD (chỉ in id). `storage-migrate-r2.ps1 -SourceConf minio-prod.conf -TargetConf r2-prod.conf -Mode Plan -Prefix <các id đó>` (đọc bảng đếm theo tiền tố: tiền tố lạ = dữ liệu dev-online / test, KHÔNG chép) rồi `-Mode Copy` rồi `-Mode Check` cùng `-Prefix` (PROD vẫn chạy trên storage tự host) | trên đúng các tiền tố PROD: số object + byte hai phía bằng nhau; 0 thiếu, 0 lệch hash; mẫu `Content-Type` khớp | không cần (đích chưa được dùng) |
| C5 | (khung giờ O3) TRƯỚC: lệnh chỉ in TÊN khoá xác nhận `.env.dev` + `.env.dev-online` tự mang đủ 6 `S3_*` (B7). Sửa 6 biến `S3_*` trong CẢ `.env` LẪN `.env.prod` theo D1 → `m prod-restart api` | health 200; `logs\api.err.log` không lỗi storage | trả 6 dòng cũ ở cả hai file → `m prod-restart api` |
| C6 | NGAY sau C5: `-Mode Copy` lần nữa cùng `-Prefix` (bù object ghi vào storage cũ giữa C4 và C5) → `-Mode Check` | lượt bù ≥ 0 object; 0 thiếu, 0 lệch hash; SỐ object chỉ-có-ở-đích (tệp tạm bị dọn ở nguồn giữa C4–C6) ghi vào sổ vết NGOÀI kho rồi chuyển cho N3 / `S16-SOCIAL-ORPHANUPLOAD-1` | như C5 |
| C7 | Smoke trên máy chủ rồi từ thiết bị NGOÀI (`done_when[6]`): ảnh + pdf tên có dấu qua chat; avatar; một tệp hồ sơ; một tệp TASK (sau D7); ô soạn bài SOCIAL sau khi FE-2D lát A merge | ảnh hiện · pdf tải về đúng tên · avatar hiện · tệp TASK tải được | lùi L-A dưới |
| C8 | 7 ngày theo dõi: mỗi lần `m prod-env` phải mang 6 dòng R2 (đo bằng lệnh in «R2» / «KHÔNG phải R2», không in giá trị — `D03` §13.5); cùng lệnh áp cho tiến trình dev-online (phải ra «KHÔNG phải R2») | ghi §9.3 | — |
| C9 | Gỡ điều kiện «chưa merge» ở PR FE-2D lát A; đóng KI-084; thu hồi token của bucket thử (O7) | — | — |

**Lùi L-A (sau C5):** `-SourceConf r2-prod.conf -TargetConf minio-prod.conf -Mode Copy` (đưa tệp tạo SAU lúc chuyển về
storage cũ) → trả 6 dòng ở cả hai file env → `m prod-restart api` → `-Mode Check` theo chiều ngược. Không bước nào xoá
dữ liệu ở bất kỳ phía nào.

## 6. Ca test viết TRƯỚC (TỪ CHỐI đứng cạnh CHO PHÉP) + mutant ★

| Ca | `done_when` | Tầng · file | TỪ CHỐI ⇄ CHO PHÉP | Đỏ kỳ vọng trên mã hôm nay |
| --- | --- | --- | --- | --- |
| P-1 | [4] | unit · `T/foundation/storage-provider.unit-spec.ts` | `https://r2.cloudflarestorage.com.evil.test` · `https://<32 hex>.r2.cloudflarestorage.com.x` · `https://abc.r2.cloudflarestorage.com` (không 32 hex) · `http://localhost:9000` ⇒ `"nosniff"` ⇄ `https://<32 hex>.r2.cloudflarestorage.com` · biến thể `.eu` ⇒ `null` | helper chưa có (đỏ nạp — chỉ chấp nhận ở L1, ghi §9.3) |
| S6 | [4] | int · `s16-filedisposition-storage.int-spec.ts:662-678` dùng helper | — ⇄ chạy trên R2 ⇒ xanh; chạy trên storage tự host ⇒ xanh | trên R2: `expected null to be 'nosniff'` (đã đo R1) |
| K-1 | [4] | int · `T/integration/s19-storage-provider-compat.int-spec.ts` | — ⇄ `putObject` phía server ⇒ `statObject` trả đúng kiểu + cỡ; `getObjectBytes` trả đúng byte | ca nền (đo bằng ★3) |
| K-2 | [4] | như trên | sau `deleteObject` ⇒ `statObject` báo KHÔNG TỒN TẠI ⇄ trước `deleteObject` ⇒ tồn tại | ca nền (★4) |
| K-3 | [3] | như trên | GET KHÔNG chữ ký vào khoá CÓ THẬT ⇒ 4xx ⇄ URL ký của CHÍNH khoá đó ⇒ 200 (cặp R3 — vế CHO PHÉP đứng TRƯỚC, cùng khoá) | ca nền (★5) |
| CORS | [3] | phép đo chỉ-đọc (script đo của §9.3 đưa vào kho ở L3 dưới dạng một chế độ của D4) | preflight PUT + `content-type` từ origin LẠ ⇒ không `Access-Control-Allow-Origin` ⇄ từ origin trong D6 ⇒ đúng origin đó | trước C2: cả hai đều 403 (đã đo R4) |

- Báo cáo verify chép NGUYÊN VĂN dòng đếm `Tests N passed | M skipped` của từng file int-spec cho CẢ hai storage (tự host
  qua lane · R2 qua D4) và nói rõ «ca storage thật: CHẠY / BỎ QUA».
- **Mutant ★** (cấy SAU khi lát đã commit; `cp` bản sao trước khi cấy; đỏ phải khớp THÔNG ĐIỆP):

| ★ | Mutant | Ca giết + thông điệp |
| --- | --- | --- |
| ★1 | helper luôn trả `"nosniff"` | S6 trên R2 `expected null to be 'nosniff'` |
| ★2 | helper so bằng `includes(...)` | P-1 đỏ ở ca `…com.evil.test` |
| ★3 | (kiểm assert có răng — cấy vào SPEC) `statObject` đọc một khoá ngẫu nhiên thay khoá vừa ghi | K-1 đỏ với lỗi «không tồn tại» mà `statObject` ném cho khoá vắng — chép NGUYÊN VĂN tên lỗi + thông điệp ở lượt chạy thật vào §9.3 |
| ★4 | bỏ lời gọi `deleteObject` | K-2 đỏ ở vế TỪ CHỐI: `statObject` KHÔNG ném (`promise resolved … instead of rejecting`) |
| ★5 | (kiểm assert có răng — cấy vào SPEC) vế TỪ CHỐI của K-3 gọi URL ký thay URL trần | K-3 `expected 200 to be greater than or equal to 400` |
| ★6 | `Copy` của D5 đổi thành `sync` | script từ chối chạy (lệnh ngoài danh sách cho phép), in đúng câu báo |

## 7. Lát thi công · verify · gate

Tuần tự, mỗi lát MỘT commit, RED → GREEN (chạy ca trên mã trước lát, chép thông điệp đỏ THẬT vào §9.3).

| Lát | Làm gì | Ca |
| --- | --- | --- |
| L0 | (commit này) hợp đồng WO v2 + `paths` thêm `scripts/*.sh`, `docs/DECISIONS/**` + seed `S19-OPS-TASKFILEURL-1` | — |
| L1 | helper D2 + unit P-1 + sửa ca S6 | P-1 · S6 |
| L2 | int-spec D3 | K-1 · K-2 · K-3 |
| L3 | `scripts/storage-r2-compat.sh` (D4, kèm chế độ đo CORS) + `Sw/storage-migrate-r2.ps1` (D5). **Diễn tập không dùng dữ liệu PROD:** ghi ~10 object tổng hợp nhiều kiểu (`image/png` · `application/pdf` · tên có dấu) vào bucket thử của storage tự host → `Plan` → `Copy` sang bucket thử R2 dưới tiền tố `rehearsal/` → `Check` → `Copy` lần hai (0 byte mới) → đảo chiều | ★6 · số đo diễn tập ghi §9.3 |
| L4 | **Trình duyệt thật trên bucket thử** (owner đặt CORS D6 với origin của dev cục bộ lên bucket thử): API cục bộ trỏ bucket thử + FE vite + Playwright — tải lên ảnh (PUT), xem ảnh, tải pdf (điều hướng), tải tệp TASK qua 302 (kỳ vọng HỎNG ⇒ xác nhận R6/D7) | ghi §9.3 |
| L5 | Tài liệu D8 + D9 · nợ §9 vào backlog | — |

**Verify** (chạy từ `C:/dev 2/MediaOS-stpub`; mỗi lúc MỘT lệnh nặng; KHÔNG `source .env`, KHÔNG in `.env`):
1. `pnpm --filter @mediaos/contracts build` (worktree chưa có dist).
2. `bash harness/check.sh --quick`.
3. `bash scripts/lane-db-setup.sh stpub` rồi `LANE_DB=mediaos_stpub S3_BUCKET=mediaos-fdisp-test pnpm --filter @mediaos/api exec vitest run test/foundation/storage-provider.unit-spec.ts test/integration/s19-storage-provider-compat.int-spec.ts test/integration/s16-filedisposition-storage.int-spec.ts --maxWorkers=2` — storage tự host; đọc dòng tổng kết nguyên văn.
4. `LANE_DB=mediaos_stpub bash scripts/storage-r2-compat.sh "C:/dev 2/r2-spike.conf"` — R2; kỳ vọng 20/20 + K-1…K-3.
5. Trước khi mở PR: `S3_BUCKET=mediaos-fdisp-test bash harness/check.sh --all --lane-db=stpub`.
6. Sau khi mở PR: log job `api.yml` phải có tên HAI file int-spec + dòng đếm.

**Gate:** plan qua `plan-reviewer` TRƯỚC khi viết mã. **FULL gate** tuần tự sau L5, TRƯỚC khi mở PR: `security-reviewer`
→ `ecc:silent-failure-hunter` → `ecc:typescript-reviewer`, mỗi agent có ngân sách lượt công cụ ghi trong prompt. Không
migration ⇒ không `database-reviewer`.

**Bẫy áp vào WO này:** khoá giả trong spec ghép chuỗi (gitleaks) · int-spec mới dựng app qua `applyMainPipeline` · ca
storage «xanh» mà bị bỏ qua đọc y hệt đã chạy ⇒ dòng đếm · `.ps1` có tiếng Việt cần UTF-8 BOM · `s16-filedisposition-
storage.int-spec.ts` đang 776 dòng — phần thêm ≤ 10 dòng · file `r2-*.conf` và log của D4 có thể chứa URL ký của bucket
thử ⇒ không chép vào kho.

## 8. Bảng [OWNER]

| # | Câu hỏi | Mặc định an toàn | CHẶN? |
| --- | --- | --- | --- |
| **O1** | Tệp hồ sơ nhân sự · CV · phiếu lương sẽ nằm ở nhà cung cấp ngoài, máy chủ ngoài Việt Nam. Công ty cần xác nhận nghĩa vụ về chuyển dữ liệu cá nhân ra nước ngoài (quy định bảo vệ dữ liệu cá nhân hiện hành — hỏi pháp chế; plan không phải ý kiến pháp lý) | Phần mã làm tới khi mở PR (không chép dữ liệu nào). KHÔNG bước C4 trở đi khi chưa có câu trả lời | **CÓ — chặn C4+** |
| **O2** | Tên bucket PROD + gợi ý vùng đặt (Location hint) — vùng không đổi được sau khi tạo | Owner đặt; plan và kho chỉ viết «bucket PROD» | **CÓ — chặn C1** |
| **O3** | Khung giờ chuyển (C5–C7, ~30 phút, một lần khởi động lại API) | giờ vắng; owner ngồi máy | **CÓ — chặn C5** |
| O4 | `auth.` và `console.` có lượt tải lên nào không (bỏ origin thừa khỏi D6)? | giữ cả 3 origin; đo ở L4 / C7 | Không |
| O5 | dev-online tiếp tục dùng storage tự host (người dùng dev-online ở máy khác vẫn không xem được tệp) | Có — WO riêng nếu cần | Không |
| O6 | Cho agent chạy phép đo CORS (chỉ-đọc, ghi rồi xoá 1 object tổng hợp) trên bucket PROD lúc còn rỗng ở C2? | Owner tự chạy lệnh | Không |
| O7 | Thu hồi token của bucket thử sau WO, hay giữ cho lệnh D4 trước mỗi lần nâng SDK? | GIỮ (D4 cần nó) | Không |
| O8 | Sao lưu bucket PROD (R2 không có phiên bản object) | ghi nợ §9 N4; không seed khi owner chưa muốn | Không |

## 9. Ngoài phạm vi / nợ · rủi ro + đường lùi

**Không làm (seed ở L5, chữ trung tính):**
- N1 — `S19-OPS-TASKFILEURL-1` (seed ở L0; tiền đề của C7).
- N2 — đường vào storage cho dev-online (O5).
- N3 — dọn dữ liệu PROD còn trên storage tự host sau 30 ngày theo dõi (owner quyết).
- N4 — sao lưu bucket PROD định kỳ về máy chủ (O8).
- N5 — đưa lệnh «R2 / KHÔNG phải R2» của C8 vào `m prod-status` (`mediaos.ps1` ngoài `paths`).
- N6 — v1 N5 (câu về `Host` sau tunnel ở DEVOPS-14 lệch bằng chứng) vẫn còn, không thuộc hướng R2.
- N7 — hàng rào test: ghim 6 `S3_*` trong `test.env` của `apps/api/vitest.config.ts` để `.env` gốc (sau C5 mang token R2 PROD) không bao giờ đổ vào spec (ngoài `paths`; B7 tạm thay bằng luật «không chạy int-spec từ checkout chính»).

| Rủi ro | Giảm bằng | Đường lùi |
| --- | --- | --- |
| Nâng `@aws-sdk/*` làm hỏng tương thích R2 trong khi CI (storage tự host) vẫn xanh | D4 + luật trong `D03` §13.5: chạy D4 trước mọi lần nâng | giữ bản SDK cũ |
| `m prod-env` chép `.env.prod` thiếu 6 dòng R2 ⇒ PROD lặng lẽ quay về storage cũ (tệp mới ở đó, tệp đã chuyển báo không tồn tại) | C5 ghi CẢ HAI file; lệnh đo C8 | thêm lại 6 dòng |
| Lộ token PROD ⇒ đọc / ghi / liệt kê / xoá MỌI object của bucket (R2 đo: token một-bucket vẫn liệt kê được) | token chỉ một bucket, không quyền quản trị; chỉ ở env máy chủ; quy trình thay token ở `D03` §13.5 | thu hồi + tạo token mới + C5 |
| `rclone` không giữ `Content-Type` | `Check` so mẫu kiểu; diễn tập L3 đo trước | chép lại với cờ metadata hoặc sửa kiểu theo hàng `files` |
| Tệp ghi vào storage cũ giữa C4 và C5 | C6 chạy ngay sau khởi động lại; confirm lỡ nhịp ⇒ người dùng tải lại một lần | — |
| Nhà cung cấp gián đoạn ⇒ mọi tính năng tệp hỏng | chấp nhận (B11 cùng lượt quyết); đường lùi L-A | L-A |
| Phép đo «riêng tư» xanh giả | cặp K-3 / R3 | — |

### 9.3 Sổ vết

| Bước | Ngày | Kết quả |
| --- | --- | --- |
| Plan v1 (hướng a) + plan-review | 09/10/2026 | `71a14fb1`; PASS_WITH_FIXES 13 finding — dừng theo lựa chọn «Thử R2 trước» |
| Phép thử R1 | 14/10/2026 09:11 | 19/20 xanh; đỏ S6 CHO PHÉP (`x-content-type-options` vắng); 0 lỗi dọn object |
| Phép đo R2–R4 | 14/10/2026 09:25 | như bảng §1 (script đo nằm ngoài kho tới L3) |
| Plan v2 | 14/10/2026 | commit này, trên `b9e437f2` |
| Plan-review v2 | 14/10/2026 | `plan-reviewer` (≈30 lượt, chỉ đọc): **PASS_WITH_FIXES** — F1 HIGH (bucket dùng chung ⇒ chép theo tiền tố công ty PROD) · F2 MEDIUM (`check` một chiều che phần dư ở đích) · F3 MEDIUM (`.env` gốc mang token PROD làm dự phòng) · F4 MEDIUM (vòng đời hai file conf) · F5–F10 LOW (thông điệp mutant · CORS chỉ `PUT` · D4 đủ 6 biến · cấm `m reset` · token mới không dùng lại của LMS · TASKFILEURL ghi nhật ký truy cập). Cả 10 đã vá vào plan + hợp đồng ở commit kế. Xác minh giữ nguyên: D1 đúng (API không tạo bucket, không `HeadBucket` lúc boot, health không chạm storage; `files.storage_bucket` không mã nào đọc) · không script nào sao lưu volume storage · P-1 nằm trong `include` của vitest |
| Nơi thi công | 14/10/2026 | worktree `MediaOS-qa1` (đã có `.env` + KEK + deps; chép file bí mật sang worktree khác từng bị chặn) thay `MediaOS-stpub`; lane `mediaos_stpub` |
| L1 `e040ecb3` | 14/10/2026 | RED: P-1 không nạp được (`ERR_MODULE_NOT_FOUND`); S6 trên R2 `expected null to be 'nosniff'` (R1). Lượt GREEN đầu lộ một ca SAI của chính test: `new URL()` đưa hostname về chữ thường ⇒ ca «chữ HOA» chuyển sang CHO PHÉP. GREEN: P-1 12/12 · S1–S9 20/20 trên R2 · 20/20 trên storage tự host · tsc api xanh |
| L2 `e84b3f6d` | 14/10/2026 | lượt đầu ĐỎ trên storage tự host (`HeadBucket` → `Unknown`): spec không dựng app nên `.env` không được nạp ⇒ nạp `src/config/load-env` như `main.ts`. GREEN: 3/3 trên cả hai (K-3 không chữ ký: storage tự host 403 · R2 400) |
| L3 `46bc9521` | 14/10/2026 | lệnh tương thích R2 35/35 · probe CORS (bucket thử chưa có CORS: CHO PHÉP ⇒ KHÔNG ĐẠT 403, TỪ CHỐI ⇒ ĐẠT) · diễn tập di trú trên dữ liệu TỔNG HỢP lộ xanh giả của PS 5.1 (`ConvertFrom-Json` trả cả mảng như một phần tử ⇒ phép so Content-Type rỗng) — vá trước commit; Content-Type giữ nguyên cho png · pdf · text/plain;charset · mp4 · docx |
| L4 | 14/10/2026 | đo bằng Chromium thật qua trang đo tối thiểu tái hiện đúng hình dạng request của FE (PUT `credentials: "omit"` + `Content-Type` · `<img>` · `fetch` kèm credentials qua 302 · điều hướng) — nhẹ hơn dựng API + FE thật, cùng câu hỏi CORS. Mốc TRƯỚC CORS: PUT bị chặn ở preflight («No 'Access-Control-Allow-Origin' header»). Token «Object Read & Write» KHÔNG đọc / đặt được CORS (403) ⇒ CHỜ owner đặt CORS cho bucket thử rồi đo lượt SAU |
| L4 (sau CORS) | 16/10/2026 | **ĐẠT** — owner đặt CORS D6 (origin dev cục bộ) lên bucket thử; probe 3/3 (origin cho phép ⇒ 204 + allow-origin/PUT/content-type · `null` ⇒ 403 cả PUT lẫn GET). Chromium 155, cùng trang đo: PUT ⇒ **200** · `<img>` URL ký ⇒ **hiện** · `fetch` kèm credentials qua 302 ⇒ **HỎNG** («No 'Access-Control-Allow-Origin' header» ở lượt sau redirect) — đúng kỳ vọng, xác nhận R6/D7 (đường tải tệp TASK phải đi `download-url` + điều hướng, đã lên PROD ở S19-OPS-TASKFILEURL-1). Không cần thêm `GET` vào D6. Object thử đã xoá; token thử chờ owner thu hồi |
| L5 `708b7a85` | 14/10/2026 | ADR · DEVOPS-03 §13.5 · RELEASE-08 §9 · KI-084 · DEVOPS-11 · `.env.example`; `id-uniqueness` 14/14 · `env-example-boots` 3/3 |
| Mutant ★1 … ★6 | 14/10/2026 | 6/6 bị giết đúng thông điệp, khôi phục từ bản sao + kho sạch sau mỗi lượt: ★1 `expected null to be 'nosniff'` · ★2 P-1 6 ca đỏ (`expected true to be false`) · ★3 `expected { Object (exists, sizeBytes, ...) } to deeply equal { exists: true, … }` · ★4 `expected { exists: true, … } to deeply equal { Object … }` · ★5 `expected 200 to be greater than or equal to 400` · ★6 script từ chối «lệnh rclone 'sync' không nằm trong danh sách cho phép» |
| FULL gate | 14/10/2026 | 3 reviewer song song, chỉ đọc, có ngân sách lượt: `security-reviewer` PASS_WITH_FINDINGS (2 MEDIUM · 5 LOW) · `silent-failure-hunter` PASS_WITH_FINDINGS (2 HIGH · 2 MEDIUM · 3 LOW) · `typescript-reviewer` PASS_WITH_FINDINGS (1 MEDIUM · 5 LOW). Vá hết ở `b4a01e4f` trừ 1 LOW (chặn int-spec s19 khi endpoint R2 thiếu cờ riêng — cổng tên bucket đã chặn). Diễn tập lại sau vá lộ thêm: `-Prefix a b` qua `powershell -File` lặng lẽ gán `b` vào `-RclonePath` ⇒ `PositionalBinding=$false` + `-PrefixFile` |
| Verify | 14/10/2026 | `check.sh --all --lane-db=stpub` **XANH 9/9** (api 849 · app 398 · web-core 50 · contracts 45 · ui 24 · console 22 · auth 4 file spec; build 7/7; db-readiness đạt). Sau vá gate: R2 **37/37** qua `storage-r2-compat.sh` (cả hai int-spec «ca storage thật CHẠY») · storage tự host **37/37** · tsc api · eslint file đổi · `id-uniqueness` 19/19 · diễn tập di trú 6 kịch bản đạt |
| C0 … C9 (evidence NGOÀI kho, ở đây chỉ ĐẠT / KHÔNG ĐẠT + ngày) | | |
| C1 | 16/10/2026 | **ĐẠT** — bucket PROD (O2) + token riêng một bucket; đo có ký: token PROD vào được bucket PROD và bị từ chối ở bucket thử, token thử bị từ chối ở bucket PROD, hai token khác khoá. Ảnh chụp «Public access» + `minio-prod.conf` (cho C4) còn chờ owner |
| C2 | 16/10/2026 | **ĐẠT** — `storage-r2-cors-probe.mjs` với `r2-prod.conf`: 7/7 (3 origin FE ⇒ 204 + đúng allow-origin/PUT/content-type; `null` + origin lạ ⇒ 403 cả PUT lẫn GET) |
| C3 | 16/10/2026 | #583 merge = `a9bdc3db`; checkout chính đã kéo về. `m prod-update api` theo lịch thường (không đổi hành vi) |
