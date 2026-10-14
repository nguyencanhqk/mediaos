# S19-OPS-TASKFILEURL-1 — tải tệp đính kèm TASK qua route JSON `download-url` + điều hướng (bỏ đọc byte bằng JS sau 302)

> Trạng thái: **plan v1 (14/10/2026) — CHỜ `plan-reviewer` trước khi thi công** · đo trên `b9e437f2` (worktree
> `MediaOS-s19`, nhánh `fix/s19-ops-taskfileurl-1`). Zone ĐỎ (một đường cấp quyền đọc tệp) · API + FE + tài liệu ·
> KHÔNG migration · KHÔNG dependency · KHÔNG đổi DTO của contracts.
> Nguồn: mục WO chèn vào `harness/backlog.mjs` ở commit này (hợp đồng, `done_when` đánh số `[0]`–`[3]`) · ba bản đồ
> đọc-hiểu (U1 phía API · U2 phía FE · U3 cổng tự động + tài liệu) · plan v2 của `S19-OPS-STORAGEPUBLIC-1` §1 R5–R6, D7
> (nhánh `fix/s19-ops-storagepublic-1`, chưa ở master).
> Thẩm quyền: owner chọn «Làm tới khi mở PR (Recommended)» ngày 14/10 sau khi được báo ước 250–400 USD.
> Kho PUBLIC — plan, commit, PR không nêu tên miền thật, mã tài khoản hay giá trị khoá nào.
> **Bảng [OWNER] ở §8 — 1 mục CHẶN MERGE (O1, thứ tự deploy); 0 mục chặn phần mã.**

Viết tắt: `Ts/` = `apps/api/src/tasks/` · `Fs/` = `apps/api/src/foundation/files/` · `T/` = `apps/api/test/` ·
`W/` = `packages/web-core/src/` · `A/` = `apps/app/src/` · «route 302» = `GET /tasks/:taskId/files/:fileId/download` ·
«route JSON» = `GET /tasks/:taskId/files/:fileId/download-url` · «bucket thử» = bucket R2 thử của `S19-OPS-STORAGEPUBLIC-1`.

## 1. Bối cảnh + phép đo

Hôm nay FE tải tệp TASK bằng cách gọi route 302 qua `fetch` kèm credentials rồi đọc byte sau redirect sang storage.
Storage tự host trả CORS có credentials nên đường này chạy. R2 thì không trả, nên khi PROD chuyển storage
(`S19-OPS-STORAGEPUBLIC-1` C7) người dùng sẽ mất tải tệp TASK. Cách sửa: API phát URL ký qua JSON, FE điều hướng tới URL đó.
Điều hướng là thao tác cấp trang, không cần CORS.

| # | Đo gì | Bằng gì | Kết quả |
| --- | --- | --- | --- |
| M1 | Đường tải FE hôm nay | `W/lib/task-file-api.ts:187-188` · `A/routes/tasks/TaskFilePanel.tsx:65-72` · grep `apiFetchBlob(` | `downloadTaskFile` gọi `apiFetchBlob` tới route 302; nút tải đi qua `useMutation` → `triggerBlobDownload`. Đây là lời gọi `apiFetchBlob` DUY NHẤT đi qua storage; các lời gọi còn lại là tệp do API tự phục vụ (`attendance-api.ts:338` · `hr-api.ts:92,329` · `payroll-*.ts` · `social-stats-api.ts:43`) |
| M2 | Vì sao hỏng trên R2 | STORAGEPUBLIC R5–R6 | Sau redirect khác origin, lượt thứ hai mang `Origin: null` + credentials, nên cần `Access-Control-Allow-Credentials`. Chính sách CORS của R2 không có trường đó **[SUY RA — đo ở L5]** |
| M3 | Route 302 | `Ts/task-files.controller.ts:41,72-82` | `@Get(":fileId/download")` + `@RequirePermission("read","task")` + 2 `ParseUUIDPipe` + `@Res` library-mode; thân route gọi `svc.getDownloadUrl` rồi `res.redirect(302)`. `PermissionGuard` gắn ở mức class; docblock `:33-38` ghi: thiếu `@RequirePermission` thì route MỞ |
| M4 | Hàm kiểm dùng chung ĐÃ CÓ | `Ts/task-file.service.ts:143-157` | `TaskFileService.getDownloadUrl(user, taskId, fileId): Promise<DownloadUrlDto>` |
| M5 | Chuỗi kiểm, theo thứ tự | `Ts/task-file.service.ts:386-431,86,147-153` · `Ts/task-file.repository.ts:123-146,185-200` · `Fs/files.service.ts:497-566` · `Fs/file-download-state.ts:30-36` · `Ts/task-file.resolver.ts:57-59,83-114` | (1) `assertScope`: `resolveAndAssert` (403 khi không có grant), rồi `isTaskInScopeTx` trong `withTenant` ⇒ **404 `TASK-ERR-TASK-NOT-FOUND`** (`:39`) cho chéo công ty · ngoài scope · task xoá mềm. (2) `findLinkedFileTx`: company_id + `TASK`/`task` + `entity_id = taskId` + hai `deleted_at IS NULL` ⇒ **404 `TASK-ERR-FILE-NOT-FOUND`** (`:40`). (3) scan-guard STRICT {Clean, NotRequired} ⇒ **409 `NOT_DOWNLOADABLE`**. (4) `FileService.getDownloadUrl`: `findByIdTx` (404) → resolver `canAccessTask('read')`; nếu deny thì `logDeny` + 403 → state-guard (Infected / chưa `Uploaded`) ⇒ `logDeny` + 409 → `storage.get` → log GRANT → `bumpDownloadCount` |
| M6 | Nhật ký truy cập theo nhánh | M5 | Nhánh 404 (bước 1–2) và 409 scan-guard (bước 3) KHÔNG ghi `file_access_logs`. Nhánh 403 resolver và 409 state-guard ghi deny. Nhánh cho phép ghi grant (`Download`, `FOUNDATION.FILE.DOWNLOAD`). Đường tải KHÔNG ghi `audit_logs`: audit chỉ có ở link/delete/cover (`Ts/task-file.service.ts:97-99,354-376`) |
| M7 | Khuôn route JSON trong repo | `Fs/files.controller.ts:95-117` · `apps/api/src/recruit/recruit-candidate-file.controller.ts:41-43,57-67` · `apps/api/src/payroll/payroll-pdf.controllers.ts:36,48,71` | Foundation: route JSON và route 302 anh em gọi CÙNG service. RECRUIT: route theo thực thể, 2 `ParseUUIDPipe`. Payroll: route JSON mang URL ký có `@Header("Cache-Control", "no-store")` |
| M8 | DTO | `packages/contracts/src/files.ts:187-199` · `files.spec.ts:228-250` · `W/lib/files-api.ts` | `downloadUrlSchema = { url: z.string().url(), expiresAt: z.string().datetime() }`, có ca chống lộ khoá storage; FE mẫu parse bằng `apiFetch(path, downloadUrlSchema)` |
| M9 | TTL + cách phục vụ | `apps/api/src/storage/object-storage.service.ts:116,259-289` · `apps/api/src/storage/content-serving.ts:19-26,99-112` · plan `S16-SOCIAL-FILEDISPOSITION-1.md:251` | TTL mặc định 300 s, trần 3600 s. png/jpeg/gif/webp/mp4/webm ⇒ `inline`, không kèm tên. MIME hợp lệ khác (kể cả PDF) ⇒ `attachment` kèm tên tệp. MIME rủi ro ⇒ `application/octet-stream` + `attachment`. Smoke đã chốt: PDF tệp TASK phải TẢI VỀ đúng tên |
| M10 | Khuôn mở URL ký trên FE | `A/routes/payroll/open-signed-url.ts:1-33` · `MePayslipsPage.tsx:12,43-55` · `PayslipDetailPage.tsx:8` · `components/PayslipPdfBatchControl.tsx:8` · `payroll-track-d-pdf.spec.tsx:64,95-147` | `openSignedUrlInNewTab`: mở tab trắng ĐỒNG BỘ, `opener = null`, gán `href` sau `await`. Popup bị chặn ⇒ `location.assign`. Lỗi ⇒ đóng tab rồi ném lại. Payroll gọi helper TRỰC TIẾP trong click và lưu lỗi bằng `useState`. Spec ghim `open("", "_blank")` NGAY sau `fireEvent.click` |
| M11 | Phản mẫu trong repo (không chép) | `A/routes/recruit/components/CandidateCvTab.tsx:64-80` · `A/routes/hr/employees/EmployeeFilesTab.tsx:67-71` | CV ứng viên truyền `"noopener,noreferrer"`, nên `window.open` trả `null` (chú thích `open-signed-url.ts:8-9`) và tab trắng không bao giờ được điều hướng. HR gọi `window.open` SAU `await` |
| M12 | `useMutation` KHÔNG gọi `mutationFn` trong cùng nhịp click | mã TanStack Query v5 (`Mutation.execute` có `await` trước `mutationFn`) | Nếu đặt `window.open` trong `mutationFn` thì nó chạy sau ít nhất một microtask **[SUY RA từ mã thư viện; ca F-2 + mutant ★9 ghim]**. Đây là lý do payroll gọi helper ngoài `useMutation` |
| M13 | Cổng màn hình = cổng đường tải | `A/routes/tasks/TaskFilePanel.tsx:341-363,430` | Nút tải không có gate riêng; nó hiện khi panel qua `canView = read:task`, đúng cặp quyền của route |
| M14 | Cổng tự động phải chạm | `T/foundation/route-guard-coverage.e2e-spec.ts:139,261-285` (artifact `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json`) · `T/foundation/param-uuid-verdicts.ts:52-74,1415-1427,1603` + `param-uuid-ratchet.unit-spec.ts:242-262` · `T/foundation/route-http-coverage.e2e-spec.ts:323-324,377` · `T/foundation/pipeline-parity.unit-spec.ts:29` · `T/foundation/supertest-listen-ratchet.unit-spec.ts:52-68` · `T/foundation/openapi-contract.e2e-spec.ts:102-217` | Census đỏ khi có route mới chưa regen. `PARAM_UUID_MEASURED_SIZE = 183`, song ánh site ↔ dòng verdict; cột `before` cấm ghi «suy ra». `MAX_UNCOVERED_TOTAL = 0`, `MIN_COVERED_COUNT = 691` (nâng theo SỐ IN RA). `HAND_ROLLED_BASELINE = 269`. OpenAPI làm giàu từ metadata của guard. Route có `@RequirePermission` thì không cần dòng ở `route-verdicts.ts` |
| M15 | Khuôn int-spec | `T/integration/s16-filedisposition-storage.int-spec.ts:53,70,137` · `T/integration/task-files-access.int-spec.ts:92-177,302-306,429-476` | Spec mới dựng qua `applyMainPipeline`, cổng `hasDb && LANE_DB`. Spec tệp TASK cũ có fixture tốt nhưng TỰ dựng pipeline; ca tải hiện chỉ phủ scan, chưa có ca chưa `Uploaded` hay tệp đã xoá trên đường tải |
| M16 | Tài liệu | `docs/API Design/API-06_TASK_API_Design.md:2341-2353` · `openapi/paths/task.paths.yaml:1360-1378` · `openapi/README.md:23-34` · `docs/SPEC/SPEC-06 TASK.md:2195-2201` | API-06 ĐÃ thiết kế đúng route JSON này (`TASK.TASK.VIEW`, TTL ngắn, `file_access_logs`). OpenAPI có `taskGetTaskFileDownloadUrl` nhưng thiếu 409. `enterprise-api.yaml` = nối base + 8 fragment. SPEC-06 §16.5 mới có 401–403; grep `docs/`: `TASK-API-404` chưa dùng. **Route 302 mới là độ lệch so với thiết kế** |
| M17 | FE spec sẽ đỏ khi đổi | `W/lib/task-file-api.spec.ts:153-161` · `A/routes/tasks/TaskFilePanel.spec.tsx:17-33,180-193` · `TaskDetailPage.spec.tsx:38-43` | Ghim `apiFetchBlob(".../download")` + `triggerBlobDownload`. Mock thay cả object `taskFileApi` |
| M18 | Lời gọi khác tới route 302 | grep `apps/` `packages/` | FE: chỉ M1. API: chỉ test + sổ (`task-files-access.int-spec.ts` · `task-files-param-uuid.int-spec.ts:7,238-245` · `param-uuid-verdicts.ts:1415-1428` · census). `apps/console`, `apps/lms` **CHƯA grep** (L1 làm) |
| M19 | **CHƯA ĐO** | — | Lỗi console nguyên văn của đường cũ trên R2 · tab trắng có còn lại sau khi tải `attachment` trong tab mới không · tên tệp có dấu khi tải qua điều hướng — đo ở L5 |

## 2. Quyết định owner đã có

| Ngày | Nguyên văn | Hệ quả |
| --- | --- | --- |
| 09–14/10 | Chuỗi lựa chọn của `S19-OPS-STORAGEPUBLIC-1` (đi hướng R2) | WO này là tiền đề của C7 bên đó (D7 + `notes`) |
| 14/10 (sau 10:48) | «Làm tới khi mở PR (Recommended)», sau khi được báo ước 250–400 USD | plan → thi công → FULL gate → mở PR; KHÔNG merge, KHÔNG deploy |

### 2.1 Hợp đồng sửa ở commit này (khác bản seed ở nhánh `fix/s19-ops-storagepublic-1`)

- `paths`: `docs/API/**` không tồn tại ⇒ đổi thành `docs/API Design/**`. Thêm `docs/SPEC/SPEC-06 TASK.md` (mã API, D5) và
  `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` (regen census, D12). Thêm đúng 6 tệp FE của D8 (dời helper mở URL ký
  sang `lib/` + 4 dòng import trong payroll), ghi TỪNG tệp thay vì glob để không mở rộng quyền sửa vào payroll.
- `done_when[0]`: thêm ba nhánh từ chối mà chuỗi kiểm có thật (M5): task ngoài phạm vi dữ liệu · task đã xoá · scan-guard.
  Thêm ca parity đếm nhật ký trên cả hai route. `done_when[2]`: ghi đúng mã `TASK-API-404` và đúng thư mục tài liệu.
  `done_when[3]`: ghi rõ trình duyệt là Chromium qua Playwright. Không nới điều kiện nào.

## 3. Bất biến phải giữ

| # | Bất biến | Cách giữ |
| --- | --- | --- |
| B1 | MỘT hàm kiểm: cả hai route gọi `TaskFileService.getDownloadUrl` (`Ts/task-file.service.ts:143`); cấm chép chuỗi kiểm | D1 · U-1(b) · ★2 |
| B2 | Cùng cổng `read:task` ở hai route; cổng màn hình (`canView`) khớp cổng đường tải (M13) | U-1(a) · ★1 · F-6 |
| B3 | `company_id`: mọi đọc qua `withTenant` + RLS (M5); không đổi repository | không sửa `Ts/task-file.repository.ts` |
| B4 | Nhánh từ chối KHÔNG phát URL: mọi `throw` nằm trước `storage.get` (`Fs/files.service.ts:543`); body lỗi không chứa URL ký | assert trong mọi ca deny (§6) |
| B5 | Nhật ký truy cập y như route 302 — không thêm, không bớt dòng nào (M6) | J-10 · N6 |
| B6 | TTL không đổi (`S3_PRESIGN_TTL_SEC`) · kiểu trả + `inline`/`attachment` + tên tệp do server ép (M9) | không chạm `apps/api/src/storage/**` |
| B7 | URL ký không bị cache, không vào log, không lưu ở state lâu dài (helper chỉ giữ trong biến cục bộ) | D2 · ★8 |
| B8 | Không gửi token Bearer tới storage: điều hướng không mang `Authorization` | D7 |
| B9 | Route 302 giữ nguyên mã và hành vi | D3; ca 302 cũ ở `task-files-access.int-spec.ts` giữ xanh |
| B10 | Không migration · không dependency · không DTO mới · không đổi `Fs/**` hay `apps/api/src/storage/**` | phạm vi |

## 4. Thiết kế

| D | Quyết định | Lý do | Phương án đã loại |
| --- | --- | --- | --- |
| D1 | Handler MỚI `downloadUrl` trong `TaskFilesController`, đặt ngay sau `download` (`:72`): `@Get(":fileId/download-url")` · `@RequirePermission("read", "task")` · `@Header("Cache-Control", "no-store")` · 2 `ParseUUIDPipe` · `return this.svc.getDownloadUrl(req.user, taskId, fileId)` kiểu `Promise<DownloadUrlDto>`. Trả data thô, envelope do interceptor toàn cục dựng | B1 + `done_when[0]`; đúng khuôn `Fs/files.controller.ts:95-117`. `:fileId` chỉ khớp một đoạn nên không đụng `@Get(":fileId")` | Chép chuỗi kiểm sang hàm mới (hai nguồn sẽ trôi) · gọi thẳng `FileService.getDownloadUrl` (mất scope + liên kết task + scan-guard — ★2) |
| D2 | `Cache-Control: no-store` trên route JSON | Body mang URL ký dùng được tới khi hết hạn; khuôn `payroll-pdf.controllers.ts:36,48` | Chỉ dựa vào TTL |
| D3 | GIỮ route 302 nguyên mã + hành vi. Docblock thêm một đoạn: FE không còn dùng; client trình duyệt đọc body sau redirect sẽ hỏng với storage không trả CORS có credentials; client không phải trình duyệt (Bearer + theo redirect) vẫn chạy. Gỡ = N1 | `done_when[2]`. Gỡ kéo theo census · param-uuid · 2 int-spec · tài liệu; bán kính đó lớn hơn lợi ích trong một WO tiền đề | Gỡ ngay trong WO này |
| D4 | DTO: tái dùng `downloadUrlSchema` / `DownloadUrlDto` (`packages/contracts/src/files.ts:193-199`). Không thêm trường cờ `inline`/`attachment` | Khớp đúng hình; ca chống lộ khoá đã có | DTO riêng cho TASK (trôi) · thêm `disposition` (xem D7 + O3) |
| D5 | Mã API: thêm `TASK-API-404` vào SPEC-06 §16.5 (`GET /api/v1/tasks/{id}/files/{file_id}/download-url` · «Lấy URL tải file» · `TASK.TASK.VIEW`). Route 302 KHÔNG nhận mã; API-06 ghi nó là route phụ | grep `docs/`: mã 404 còn trống; SPEC là hợp đồng nghiệp vụ, route 302 chỉ là chi tiết triển khai | Cấp mã cho route 302 (biến độ lệch thành hợp đồng) |
| D6 | web-core: GIỮ tên `downloadTaskFile(taskId, fileId)`, đổi ruột thành `apiFetch(`/tasks/${taskId}/files/${fileId}/download-url`, downloadUrlSchema)` trả `Promise<DownloadUrlDto>`. Bỏ import `apiFetchBlob` / `ApiBlobResult` (`no-unused-vars` bật — `eslint.config.mjs:35`). Thay chú thích nợ `:24-36` bằng 3 dòng mô tả hiện trạng | `done_when[1]` gọi đúng tên này; mock ở `TaskDetailPage.spec.tsx:38-43` giữ nguyên khoá | Đổi tên thành `getTaskFileDownloadUrl` (thêm sửa mock) · để web-core tự điều hướng (web-core chạy env node, không có DOM — `packages/web-core/vitest.config.ts:8`) |
| D7 | Cách mở: LUÔN mở tab mới qua `openSignedUrlInNewTab`, gọi TRỰC TIẾP trong `onClick`, KHÔNG qua `useMutation` (M12). Trạng thái lấy theo `MePayslipsPage.tsx:43-55`, dùng `useState`: `pending` (nút disabled + `Loader2` + nhãn `downloading` như nay) · `error` (span `role="alert"` + `mapApiErrorToUi(error).message` như nay; không thêm khoá i18n). Server quyết `inline`/`attachment` (M9): ảnh/video mở ở tab mới, app giữ nguyên; PDF và kiểu khác tải về với tên do server ép | Đây là khuôn ĐÚNG duy nhất có trong repo; một hành vi cho mọi kiểu; FE không chép danh sách MIME | Cùng tab (`location.assign` / `<a href>`): ảnh/video sẽ thay SPA, rời app · rẽ nhánh theo `mimeType` (chép `INLINE_SERVE_MIME_TYPES` sang FE, sẽ trôi) · `<a download>` (bị bỏ qua khi khác origin) · `window.open` sau `await` (Safari chặn; test trên Chrome xanh giả) · cờ `noopener` (bẫy M11) |
| D8 | Dời helper `A/routes/payroll/open-signed-url.ts` → `A/lib/open-signed-url.ts` bằng `git mv`, NỘI DUNG KHÔNG ĐỔI (chỉ thêm một dòng docblock «dùng chung payroll + TASK»). Sửa đúng 4 dòng import (`MePayslipsPage.tsx:12` · `PayslipDetailPage.tsx:8` · `PayslipPdfBatchControl.tsx:8` · `payroll-track-d-pdf.spec.tsx:64`) | `lib/` là hạ tầng trung lập, repo đã gom helper chéo feature về đây (`A/lib/download-blob.ts:8-10`, S15-PAYROLL-DEBT-1) | `routes/tasks` import chéo từ `routes/payroll` · chép một bản thứ hai · đưa vào web-core (không có DOM) |
| D9 | KHÔNG ẩn hay disable nút theo `uploadStatus`/`scanStatus`. Server quyết: 409 ⇒ đóng tab trắng + hiện `role="alert"` | Không nhân bản luật scan-guard sang FE | Disable theo trạng thái (O4) |
| D10 | Int-spec MỚI `T/integration/s19-task-file-download-url.int-spec.ts`, dựng qua `applyMainPipeline`, cổng `runDb = hasDb && Boolean(process.env.LANE_DB)`. Fixture dùng chung: dời 5 hàm cục bộ (`grant` · `seedEmployee` · `seedTask` · `seedFile` · `seedTaskLink`, `task-files-access.int-spec.ts:92-177`) sang `T/helpers/task-file-seed.ts`, cho spec cũ import lại (chỉ đổi chỗ khai báo, thân hàm giữ nguyên). Không dùng `Promise.all`; nếu buộc phải dùng thì `await app.listen(0)` ngay sau `init()` + `close()` ở `afterAll`. Không cần storage thật: ký URL là tính toán cục bộ, cùng điều kiện với ca 302 đang chạy | `done_when[2]` + pipeline-parity; DRY | Thêm ca vào spec cũ đang tự dựng pipeline · chép 5 hàm sang spec mới |
| D11 | param-uuid: thêm 2 dòng `tasks/task-files.controller.ts#downloadUrl:taskId` / `#downloadUrl:fileId`, `decision: "piped"`. `before` dùng hằng MỚI `BORN_PIPED` = «không có "trước": route SINH RA đã gắn `ParseUUIDPipe` (S19-OPS-TASKFILEURL-1) — không có bản chưa vá để đo; 400 đo ở task-files-param-uuid.int-spec», kèm chú thích cạnh hằng vì sao không dùng `BEFORE_500`. `PARAM_UUID_MEASURED_SIZE` 183 → 185. `task-files-param-uuid.int-spec.ts`: thêm 2 `CASES`, header «11 tham số» → 13, thêm dòng route | Ratchet (5) đòi song ánh; cột `before` cấm suy ra, nên ghi đúng sự thật | Dựng route không pipe chỉ để đo (một commit chứa route không pipe) · ghi `BEFORE_500` (sai sự thật) |
| D12 | Census: regen artifact bằng `ROUTE_CENSUS_WRITE=1`. `route-http-coverage`: nâng `MIN_COVERED_COUNT` theo SỐ IN RA (luật `:340-377`, không cộng tay) + một dòng chú thích S19-OPS-TASKFILEURL-1 | M14 | — |
| D13 | Tài liệu: SPEC-06 §16.5 +1 dòng (D5). API-06 mục `download-url`: mã `TASK-API-404`; bảng lỗi (403 thiếu quyền · 404 `TASK-ERR-TASK-NOT-FOUND` / `TASK-ERR-FILE-NOT-FOUND` · 409 `NOT_DOWNLOADABLE`); `Cache-Control: no-store`; câu nhật ký sửa theo đúng M6 (bỏ «nếu file nhạy cảm»); FE điều hướng, không đọc body; một đoạn về route 302 phụ. OpenAPI: thêm `'409'` vào `task.paths.yaml:1378` VÀ đúng dòng đó trong `enterprise-api.yaml` (sửa tay CÙNG một dòng). Trước khi sửa, đo `cat base + 8 fragment | diff - enterprise-api.yaml`: nếu bản build đã lệch fragment thì KHÔNG build lại cả file, ghi N8. Docblock controller `:30-38` cập nhật | `done_when[2]` | Sửa RELEASE-02 (KI-084 đã thuộc STORAGEPUBLIC; RELEASE-02 là tệp xung đột của nhiều PR) · BACKEND-08 / FRONTEND-11 (ngoài `paths` — N5) |

## 5. Triển khai — owner (agent không merge, không chạm PROD)

FE tự lên Pages ~13 phút sau merge; API deploy tay. Nếu FE mới lên trước API, FE sẽ gọi route JSON chưa tồn tại ⇒ 404 ⇒
mất tải tệp TASK trong khoảng hở đó.

| # | Bước | ĐO là đã đạt | Đường lùi |
| --- | --- | --- | --- |
| T0 | Trước merge: ghi commit PROD (`GET /api/v1/health`) | ghi §9.3 | — |
| T1 | Merge PR → NGAY `m prod-update api` (route thêm, tương thích ngược: FE cũ vẫn dùng route 302) | health mang commit mới TRƯỚC khi Pages deploy xong | `m prod-rollback` |
| T2 | `GET /api/v1/tasks/<uuid ngẫu nhiên>/files/<uuid ngẫu nhiên>/download-url` KHÔNG token | **401** (route tồn tại, guard xác thực chặn); 404 = API chưa có route ⇒ dừng, chưa cho Pages chạy tiếp | — |
| T3 | Sau khi Pages xong: trên máy chủ (storage PROD hiện chỉ tới được từ đó) bấm tải một PDF tên có dấu + một ảnh của một task | PDF tải về đúng tên; ảnh mở ở tab mới; tab app giữ nguyên | lùi Pages về bản trước + giữ API (route 302 vẫn còn) |
| T4 | Chỉ sau T3 mới cho `S19-OPS-STORAGEPUBLIC-1` chạy C7 | — | — |

Lùi API sau khi FE mới đã lên ⇒ tải tệp TASK hỏng ⇒ phải lùi CẢ Pages.

## 6. Ca test viết TRƯỚC (TỪ CHỐI đứng cạnh CHO PHÉP) + mutant ★

**Bẫy xanh giả trên mã hôm nay:** route JSON chưa tồn tại thì router trả 404. Ca từ chối nào chỉ chờ «404» sẽ XANH
trên mã chưa vá. Vì vậy MỌI ca deny assert theo thứ tự: status → `error.code` → body không có `data` và không khớp
`/X-Amz-(Signature|Credential)/`. Đỏ kỳ vọng ghi theo đó.

Fixture (D10): công ty A + B. Người dùng: `hr` (read + file-upload + file-delete:task @Company) · `reader` (chỉ
read:task @Company) · `emp` (read + file-upload @Own, assignee taskA) · `noPerm` (không grant task) · `fndOnly` (chỉ
download:foundation-file). Task: taskA · taskOther (A, assignee khác) · taskB (B) · taskDel (A, xoá mềm giữa ca).
Tệp: `cleanA` (Clean/Uploaded) · `nrA` (NotRequired) · `pendScanA` / `failA` / `infA` (scan Pending / Failed / Infected) ·
`pendUpA` (upload Pending + scan NotRequired) · `cleanOther` (trên taskOther) · `fileB` (trên taskB) · `delA` (trên taskA,
xoá qua route DELETE thật) · `fileDel` (trên taskDel).

| Ca | `done_when` | Tầng · file | TỪ CHỐI ⇄ CHO PHÉP | Đỏ kỳ vọng trên mã hôm nay |
| --- | --- | --- | --- | --- |
| J-1 | [0] | int · `T/integration/s19-task-file-download-url.int-spec.ts` | `noPerm` → 403, 0 dòng nhật ký ⇄ `reader` (cùng tệp `cleanA`) → 200; `data` qua `downloadUrlSchema.parse`; header `Cache-Control: no-store`; `expiresAt` nằm trong (now, now + TTL + 5 s]; +1 dòng `Download` granted, actor = reader | deny: `expected 404 to be 403`; allow: `expected 404 to be 200` |
| J-2 | [0] | như trên | `fndOnly` → 403 (không leo thang từ quyền foundation) ⇄ `hr` cùng tệp → 200 | `expected 404 to be 403` |
| J-3 | [0] | như trên | `hr`(A) taskB/fileB → 404 `TASK-ERR-TASK-NOT-FOUND` ⇄ `hr` taskA/cleanA → 200 | mã: `expected '<mã 404 của router>' to be 'TASK-ERR-TASK-NOT-FOUND'` (chép vế trái nguyên văn) |
| J-4 | [0] | như trên | IDOR: `hr` taskA/cleanOther → 404 `TASK-ERR-FILE-NOT-FOUND` ⇄ `hr` taskOther/cleanOther → 200 | như J-3, mã `TASK-ERR-FILE-NOT-FOUND` |
| J-5 | [0] | như trên | ngoài scope: `emp` taskOther/cleanOther → 404 `TASK-ERR-TASK-NOT-FOUND` ⇄ `emp` taskA/cleanA → 200 | như J-3 |
| J-6 | [0] | như trên | `hr` → 200 trên `delA` (vế CHO PHÉP chạy TRƯỚC) ⇄ sau `DELETE /tasks/taskA/files/delA` (204) → 404 `TASK-ERR-FILE-NOT-FOUND` | allow `expected 404 to be 200` |
| J-7 | [0] | như trên | `hr` → 200 trên taskDel/fileDel ⇄ sau khi đặt `tasks.deleted_at` → 404 `TASK-ERR-TASK-NOT-FOUND` | như J-6 |
| J-8 | [0] | như trên | `pendScanA` · `failA` · `infA` → 409 `NOT_DOWNLOADABLE`, 0 dòng nhật ký ⇄ `cleanA` · `nrA` → 200 | `expected 404 to be 409` |
| J-9 | [0] | như trên | `pendUpA` → 409 `NOT_DOWNLOADABLE` + ĐÚNG 1 dòng deny (`access_granted = false`) ⇄ `nrA` → 200 + 1 dòng grant | `expected 404 to be 409` |
| J-10 | [0] | như trên | **parity** — với mỗi cặp (người gọi, task, tệp) của J-1…J-9, gọi route JSON rồi route 302 trên CÙNG dữ liệu: cho phép = 200 ⇔ 302; từ chối = cùng status + cùng `error.code`; số dòng `file_access_logs` tăng BẰNG NHAU cho từng route; `origin + pathname` của `url` JSON = của `Location`; tham số `response-content-disposition` giống nhau. Cặp J-6/J-7 đo trước khi xoá | `expected 404 to be 302` (JSON chưa có) |
| P-1 | [2] | int · `T/integration/task-files-param-uuid.int-spec.ts` (2 `CASES` mới) | `JUNK` → 400 đơn trị + neo `error.type` ⇄ `randomUUID()` → không 400, không 500 | `expected 404 to be 400` |
| U-1 | [0] | unit · `Ts/task-files.controller.spec.ts` (colocated) | (a) metadata `REQUIRE_PERMISSION` (`apps/api/src/permission/require-permission.decorator.ts:23`) của `downloadUrl` DEEP-EQUAL của `download` · (b) `downloadUrl` gọi `svc.getDownloadUrl(user, taskId, fileId)` đúng 1 lần, trả nguyên giá trị · (c) `download` redirect 302 tới đúng `url` đó | `expected undefined to deeply equal { action: 'read', resourceType: 'task' }` (chép hình metadata nguyên văn) |
| F-1 | [1] | unit · `W/lib/task-file-api.spec.ts:153-161` (viết lại) | `downloadTaskFile` → `apiFetch("/tasks/task-1/files/file-1/download-url", downloadUrlSchema)`, trả DTO; `apiFetchBlob` KHÔNG được gọi ⇄ `apiFetch` reject ⇒ lỗi lan ra (`rejects.toThrow`) | `to be called with arguments: [ '/tasks/task-1/files/file-1/download-url', … ]` · `Number of calls: 0` (chép tên spy nguyên văn) |
| F-2 | [1] | unit · `A/routes/tasks/TaskFilePanel.spec.tsx:180-193` (viết lại, `fakeTab` như `payroll-track-d-pdf.spec.tsx:95-99`, `afterEach(vi.restoreAllMocks)`) | CHO PHÉP: click ⇒ `open` được gọi với `("", "_blank")` NGAY sau `fireEvent.click`, trước mọi `await`; sau đó `tab.location.href === SIGNED`, `tab.opener === null`, `downloadTaskFile("task-1", "file-1")` | `expected "open" to be called with arguments: [ '', '_blank' ]` · `Number of calls: 0` |
| F-3 | [1] | như trên | TỪ CHỐI: `downloadTaskFile` reject (409 `NOT_DOWNLOADABLE`) ⇒ `tab.close` được gọi + `role="alert"` mang thông điệp của `mapApiErrorToUi` + nút bật lại ⇄ F-2 | `tab.close`: `expected "spy" to be called at least once` |
| F-4 | [1] | như trên | popup bị chặn (`open` trả `null`) ⇒ `location.assign(SIGNED)` (spy getter như `payroll-track-d-pdf.spec.tsx:256-262`) ⇄ F-2 | `assign` 0 lần gọi |
| F-5 | [1] | như trên | đang chờ (promise treo) ⇒ nút disabled + nhãn «Đang tải…»; xong ⇒ bật lại | ca nền — hôm nay đã đúng, ghim để giữ hành vi |
| F-6 | [0] | như trên | không có `read:task` ⇒ không có nút tải, `open` không được gọi ⇄ F-2 | ca nền |
| F-7 | — | `A/routes/payroll/payroll-track-d-pdf.spec.tsx` | dời helper (D8) không đổi hành vi payroll | ca nền (xanh trước và sau) |

- Báo cáo verify chép NGUYÊN VĂN dòng `Test Files … / Tests N passed | M skipped` của từng file. Thiếu dòng `Test Files`
  nghĩa là file không nạp được, không phải xanh. Int-spec bị `skip` thì không được tính là chạy.
- **Mutant ★** (cấy SAU khi lát đã commit; `cp` bản sao trước khi cấy, khôi phục từ bản sao chứ KHÔNG dùng `git checkout --`;
  đỏ phải khớp THÔNG ĐIỆP, đỏ vì 500 hoặc lỗi biên dịch không tính):

| ★ | Mutant | Ca giết + thông điệp |
| --- | --- | --- |
| ★1 | bỏ `@RequirePermission` trên `downloadUrl` | U-1(a) `expected undefined to deeply equal { action: 'read', … }` + census `route-guard-coverage` đỏ (route mở không có verdict). J-1 deny VẪN 403 nhờ lớp `resolveAndAssert` — ghi đúng như vậy, không coi là thiếu ca |
| ★2 | `downloadUrl` inject `FileService` rồi gọi thẳng `files.getDownloadUrl(user, fileId)` | J-4 `expected 200 to be 404` + U-1(b) `getDownloadUrl` của service mock 0 lần gọi |
| ★3 | bỏ `await this.assertScope(...)` trong `TaskFileService.getDownloadUrl` | J-5 `expected 403 to be 404` (resolver chặn + ghi deny) trên CẢ hai route |
| ★4 | `findLinkedFileTx` bỏ điều kiện `entity_id = taskId` | J-4 `expected 200 to be 404` |
| ★5 | `findLinkedFileTx` bỏ hai điều kiện `deleted_at IS NULL` | J-6: `expected '<mã 404 của FileService>' to be 'TASK-ERR-FILE-NOT-FOUND'`, hoặc `expected 403 to be 404` nếu `findByIdTx` không lọc xoá mềm — chép nguyên văn vế xảy ra vào §9.3 |
| ★6 | `DOWNLOADABLE_SCAN` thêm `"Pending"` | J-8 `expected 200 to be 409` |
| ★7 | (tạm, `Fs/file-download-state.ts`) bỏ nhánh `not-uploaded` | J-9 `expected 200 to be 409` |
| ★8 | bỏ `@Header("Cache-Control", "no-store")` | J-1 `expected undefined to be 'no-store'` |
| ★9 | `TaskFilePanel` gọi helper bên trong `mutationFn` của `useMutation` | F-2 `expected "open" to be called with arguments: [ '', '_blank' ]` · `Number of calls: 0` |
| ★10 | helper truyền `"noopener,noreferrer"` cho `window.open` | F-2 + `payroll-track-d-pdf.spec.tsx` — diff đối số của `toHaveBeenCalledWith` |
| ★11 | helper bỏ `tab?.close()` trong `catch` | F-3 `expected "spy" to be called at least once` |
| ★12 | `downloadTaskFile` vẫn gọi `apiFetchBlob(".../download")` | F-1 (thông điệp như cột đỏ) |

Mutant SỐNG có chủ đích (không cấy, ghi lý do): bỏ `company_id` khỏi `isTaskInScopeTx` vẫn bị RLS + FORCE chặn. RLS là
tường cuối theo thiết kế (CLAUDE.md §2.1), không phải lỗ.

## 7. Lát thi công · verify · gate

Tuần tự, mỗi lát MỘT commit, RED → GREEN: chạy ca trên mã trước lát và chép thông điệp đỏ THẬT vào §9.3.

| Lát | Làm gì | Ca |
| --- | --- | --- |
| L0 | (commit này) plan + mục WO đã sửa (§2.1) | — |
| L1 | grep `apps/console` + `apps/lms` (M18). Dời fixture sang `T/helpers/task-file-seed.ts`, chạy `task-files-access.int-spec.ts` (phải xanh y như trước). Viết int-spec mới + U-1 + 2 `CASES` param ⇒ ĐỎ. Thêm handler D1 + D2 + docblock D3 ⇒ chạy ratchet param-uuid (kỳ vọng `expected 185 to be 183`) ⇒ thêm 2 dòng verdict + `BORN_PIPED` + SIZE 185 ⇒ regen census ⇒ nâng `MIN_COVERED_COUNT` theo số in ra | J-1…J-10 · P-1 · U-1 |
| L2 | `git mv` helper (D8) + 4 import ⇒ F-7 xanh. web-core D6, `TaskFilePanel` D7, viết lại spec ⇒ RED → GREEN. Xoá mock `@/lib/download-blob` khỏi `TaskFilePanel.spec.tsx` nếu component không còn import | F-1…F-7 |
| L3 | Tài liệu D5 + D13 | — |
| L4 | Mutant ★1…★12 (kho phải sạch sau mỗi lượt khôi phục) | §6 |
| L5 | **Trình duyệt thật trên bucket thử** (dưới đây) | `done_when[3]` |
| L6 | Seed nợ §9 vào backlog (chữ trung tính) nếu owner đồng ý (O6) | — |

**L5 — phép đo trình duyệt** (công cụ để NGOÀI kho, trong scratchpad của phiên): chép `stpub/bin/l4-server.mjs` thành
`tfu/bin/l5-server.mjs` rồi thêm:
- origin «API» (`127.0.0.1:5174`) thêm `/download-url?key=…`, trả JSON `{ data: { url, expiresAt } }` với CÙNG header CORS
  có credentials như `/download` (giống API thật);
- `/seed` ghi phía server (SDK, không cần CORS) 2 object dưới tiền tố `l4/`: một PDF tên có dấu và một PNG. URL ký GET mang
  `response-content-type` + `response-content-disposition` theo đúng luật của `content-serving.ts` (PDF `attachment` kèm tên,
  PNG `inline`);
- trang «app» (`localhost:5173`) có hai nút. Nút «cũ» tái hiện ĐÚNG `apiFetchBlob`: `fetch` kèm `credentials: "include"` +
  `Authorization` tới `/download` → 302 → `blob()`. Nút «mới» tái hiện ĐÚNG `openSignedUrlInNewTab`: mở tab trắng đồng bộ,
  `opener = null`, `fetch` `/download-url` kèm credentials, rồi gán `tab.location.href`.

Lượt đo bằng Playwright MCP (Chromium): (1) TRƯỚC — bấm «cũ» với PDF, chép `browser_console_messages` NGUYÊN VĂN vào §9.3
(kỳ vọng là lỗi CORS ở lượt sau redirect **[SUY RA]**). (2) SAU — bấm «mới» với PDF: bắt sự kiện `download` qua
`browser_run_code` (`page.context().waitForEvent('download')`), `suggestedFilename` = đúng tên có dấu; đếm tab sau khi tải
xong (có tab trắng còn lại không — O3). (3) SAU — bấm «mới» với PNG: tab mới hiện ảnh (chụp màn hình), tab «app» vẫn ở
trang cũ. (4) `/cleanup`. Ghi kèm trạng thái CORS của bucket thử lúc đo. Các phép đo này không phụ thuộc CORS: điều
hướng không cần CORS, còn đường cũ hỏng vì thiếu credentials (M2). Không lưu URL ký hay ảnh chụp chứa URL vào kho.

**Verify** (chạy từ `C:/dev 2/MediaOS-s19`; mỗi lúc MỘT lệnh nặng qua khoá chung; KHÔNG `source .env`, KHÔNG in `.env`):
1. `pnpm --filter @mediaos/contracts build` → `pnpm --filter @mediaos/web-core build` (dist trong worktree có thể đã cũ).
2. `bash scripts/lane-db-setup.sh tfu` (lane mới `mediaos_tfu`).
3. API: `bash <scratchpad>/tfu/bin/lane-vitest.sh <tên> 2 test/integration/s19-task-file-download-url.int-spec.ts test/integration/task-files-access.int-spec.ts test/integration/task-files-param-uuid.int-spec.ts src/tasks/task-files.controller.spec.ts test/foundation/param-uuid-ratchet.unit-spec.ts test/foundation/route-guard-coverage.e2e-spec.ts test/foundation/route-http-coverage.e2e-spec.ts test/foundation/pipeline-parity.unit-spec.ts test/foundation/supertest-listen-ratchet.unit-spec.ts test/foundation/openapi-contract.e2e-spec.ts`
   (regen census: thêm `ROUTE_CENSUS_WRITE=1` trước lệnh, chỉ với `route-guard-coverage.e2e-spec.ts`). Tuỳ chọn:
   `STORAGE=r2` chạy int-spec mới ⇒ J-10 trên URL ký R2.
4. FE: `pnpm --filter @mediaos/web-core exec vitest run src/lib/task-file-api.spec.ts` ·
   `pnpm --filter @mediaos/app exec vitest run src/routes/tasks src/routes/payroll/payroll-track-d-pdf.spec.tsx`
   (KHÔNG `pnpm test -- <path>`: lệnh đó chạy cả suite).
5. Trước khi mở PR: `bash harness/check.sh --all --lane-db=tfu` — phải XANH, không phải «XANH KHÔNG ĐỦ BẰNG CHỨNG».
6. Sau khi mở PR: log job `api.yml` phải có tên int-spec mới + dòng đếm.

**Gate:** plan qua `plan-reviewer` TRƯỚC khi viết mã. **FULL gate** sau L5, TRƯỚC khi mở PR: `security-reviewer` →
`silent-failure-hunter` → `typescript-reviewer` → `react-reviewer` (FE), mỗi agent có ngân sách lượt công cụ ghi trong
prompt. Không migration, không đổi repository ⇒ không cần `database-reviewer`.

**Bẫy áp vào WO này:** route chưa tồn tại trả 404 ⇒ ca deny chỉ chờ 404 sẽ xanh giả (§6) · int-spec mới phải dùng
`applyMainPipeline` · int-spec bị skip khi thiếu `LANE_DB` · khoá giả trong spec phải ghép chuỗi (gitleaks) ·
`window.open` với `noopener` trả `null` · `useMutation` lùi `mutationFn` qua microtask ·
`task-files-access.int-spec.ts` đang 596 dòng, int-spec mới nhắm ≤ 400 dòng · hai bản seed của cùng WO (§9 rủi ro 1).

## 8. Bảng [OWNER]

| # | Câu hỏi | Mặc định an toàn | CHẶN? |
| --- | --- | --- | --- |
| **O1** | Thứ tự deploy (§5): FE tự lên ~13 phút sau merge, API deploy tay | Chỉ merge khi owner sẵn sàng `m prod-update api` NGAY sau merge và đo T2 (401, không phải 404) | **CÓ — chặn MERGE** (không chặn mã) |
| O2 | Giữ route 302 (D3)? | Giữ; gỡ = N1 sau khi R2 chạy ổn định | Không |
| O3 | Nếu L5 cho thấy tải `attachment` trong tab mới để lại tab trắng: chấp nhận như phiếu lương PDF hôm nay? | Chấp nhận + ghi N. Nếu không chấp nhận: thêm cờ cách phục vụ vào DTO (đổi contracts) — WO riêng | Không |
| O4 | Ẩn/disable nút tải với tệp chưa sạch / chưa `Uploaded` (D9)? | Không — server quyết, 409 hiện lỗi | Không |
| O5 | Đo thêm bằng app thật + API cục bộ trên bucket thử (nặng)? | Không — C7 của STORAGEPUBLIC đo app thật trên PROD | Không |
| O6 | Seed WO nợ N2 (CV ứng viên, `noopener`) + N3 (HR mở tab sau `await`)? | Seed ở L6, chữ trung tính | Không |

## 9. Ngoài phạm vi / nợ · rủi ro + đường lùi

**Không làm:**
- N1 — gỡ route 302 sau khi R2 chạy ổn định (cần grep lại mọi client trước khi gỡ).
- N2 — `CandidateCvTab.tsx:71,74`: `noopener` khiến tab trắng không được điều hướng **[SUY RA từ chuẩn HTML + chú thích
  `open-signed-url.ts:8-9`; chưa đo bằng trình duyệt]**.
- N3 — `EmployeeFilesTab.tsx:67-71` · `EmployeeContractsPage.tsx:58-62`: `window.open` gọi sau `await` (Safari có thể chặn)
  **[SUY RA]**.
- N4 — route 302 tệp nhân sự (`apps/api/src/employees/employee-file.controller.ts:67-81`): FE HR không gọi (grep web-core),
  nên không cần vá trước R2.
- N5 — BACKEND-08 / FRONTEND-11 nhắc route mới (ngoài `paths`).
- N6 — nhật ký truy cập không đồng đều giữa các nhánh từ chối (404 và 409 scan không ghi). Đây là hiện trạng chung với
  route 302; thêm log là đổi hành vi CẢ hai route ⇒ WO riêng nếu owner muốn.
- N7 — `docs/permission-matrix-spec.md` chưa có hàng nào cho tệp TASK.
- N8 — `enterprise-api.yaml` lệch fragment (chỉ khi L3 đo thấy).

| Rủi ro | Giảm bằng | Đường lùi |
| --- | --- | --- |
| **Hai bản seed của CÙNG mục WO**: nhánh `fix/s19-ops-storagepublic-1` (đã push) cũng chèn `S19-OPS-TASKFILEURL-1` vào backlog ⇒ PR merge sau sẽ xung đột hoặc trùng id (ca `id-uniqueness` đỏ) | PR nào merge SAU phải bỏ bản seed của mình khi rebase, giữ bản ĐÃ SỬA ở commit này (§2.1); ghi vào mô tả cả hai PR | rebase |
| FE lên Pages trước API ⇒ 404 khi tải | O1 · T1–T2 | deploy API, hoặc lùi Pages |
| Lùi API sau khi FE mới đã lên ⇒ tải hỏng | lùi CẢ Pages (§5) | — |
| Safari chặn popup nếu helper bị gọi sau `await` | D7 · F-2 · ★9 | — |
| Popup bị chặn ⇒ `location.assign` rời app khi tệp là ảnh | chấp nhận: người dùng vẫn nhận tệp, payroll hành xử y vậy | — |
| Fixture «upload Pending + scan NotRequired» bị CHECK của bảng `files` chặn **[CHƯA ĐO]** | dùng tổ hợp khác thoả CHECK mà vẫn qua scan-guard TASK; ghi lại §9.3 | — |
| dist cũ của contracts / web-core ⇒ typecheck đỏ oan | build theo thứ tự (Verify 1) | — |
| URL ký trong JSON bị cache trung gian | D2 · ★8 | — |

### 9.3 Sổ vết

| Bước | Ngày | Kết quả |
| --- | --- | --- |
| Plan v1 | 14/10/2026 | commit này, trên `b9e437f2`; ba bản đồ đọc-hiểu U1 · U2 · U3 |
| Plan-review | | |
| L1 … L6 | | |
| Mutant ★1 … ★12 | | |
| L5 — trình duyệt (TRƯỚC: lỗi console nguyên văn · SAU: tên tệp + số tab) | | |
| FULL gate | | |
| Verify (`check.sh --all --lane-db=tfu`) | | |
| PR | | |
| T0 … T4 (owner) | | |
