# S19-OPS-STORAGEPUBLIC-1 — endpoint KÝ công khai tách khỏi endpoint nội bộ + đường vào riêng cho storage

> Trạng thái: **plan v1 (09/10/2026) — chờ plan-review** · đo trên `dd02788c` (worktree `MediaOS-stpub`, nhánh
> `fix/s19-ops-storagepublic-1`). Zone ĐỎ · DEVOPS + tầng storage của API · không migration.
> Nguồn: mục WO trong `harness/backlog.mjs` (7 `done_when` = hợp đồng, đánh số `[0]`–`[6]`) · ba bản đồ đọc-hiểu
> SU1 (bề mặt ký + bán kính) · SU2 (hạ tầng · script · tài liệu) · SU3 (dữ kiện bên ngoài).
> Bước lập plan KHÔNG chạy test/build/tsc, KHÔNG gọi storage, KHÔNG đọc `.env*`, KHÔNG chạm PROD. Mọi dòng «ĐO» là
> đọc mã / tài liệu có `file:dòng`; hành vi runtime của storage và của đường vào là **SUY RA** tới khi L4 / owner đo.
> Kho PUBLIC — plan, commit, PR chỉ nói hiện trạng và yêu cầu ở mức trung tính; hostname viết `<nhãn>.$Domain`.
> **Bảng [OWNER] ở §8 — 3 mục CHẶN phần hạ tầng (O1 · O2 · O3); 0 mục chặn phần mã.**

Viết tắt: `St/` = `apps/api/src/storage/` · `Cf/` = `apps/api/src/config/` · `T/` = `apps/api/test/` ·
`Sw/` = `scripts/windows/` · `W/` = `packages/web-core/src/` · `D03` = `docs/DEVOPS/DEVOPS-03_Docker_Containerization.md`.

## 1. Bối cảnh + phép đo

Storage của PROD chỉ nghe ở địa chỉ nội bộ của máy chủ và không có đường vào nào từ ngoài trỏ tới nó, trong khi API ký
URL bằng chính endpoint nội bộ đó ⇒ URL ký phát cho trình duyệt (tải lên · xem · tải về) chỉ dùng được trên máy chủ.
Smoke cục bộ không thấy vì người thử ngồi ngay trên máy chủ.

| # | Đo gì | Bằng gì | Kết quả | Ngày |
| --- | --- | --- | --- | --- |
| M1 | Cổng storage publish ở đâu | `docker ps` | container storage chỉ publish `127.0.0.1:9000-9001` (khớp `docker-compose.yml:126-128`) | 09/10 |
| M2 | Máy chủ nghe cổng 9000 ở địa chỉ nào | `netstat` | chỉ `127.0.0.1:9000` | 09/10 |
| M3 | Đường vào từ ngoài có trỏ tới storage | đọc cấu hình tunnel đang chạy (luồng chính) | 9 hostname, 0 cái trỏ cổng 9000 | 09/10 |
| M4 | API ký bằng client nào | `St/object-storage.service.ts:93,130-141` | MỘT `S3Client` dựng từ `S3_ENDPOINT`, cache trọn đời tiến trình; dùng cho 2 lời gọi ký (`:194`, `:284`) VÀ 4 thao tác server (`:238`, `:249`, `:306`, `:334`). Script cài ghi `S3_ENDPOINT=http://localhost:9000` (`Sw/01-setup-env.ps1:78`) | 09/10 |
| M5 | Bán kính | SU1 §B (đọc mã) + plan kiểm lại hai hàm ký | Mọi URL ký đi qua đúng HAI hàm: `createUploadUrl` (`:179-200`) · `createDownloadUrl` (`:269-289`). 10 lời gọi trực tiếp (FILES · tệp server sinh · avatar nhân viên · ảnh bìa task · đính kèm + avatar phòng CHAT · đính kèm SOCIAL · TASK) + mọi module đi qua `FileService` (HR · recruit · branding · phiếu lương · avatar cá nhân). 3 route đặt URL ký vào `Location` của 302. Không mã server nào tự gọi URL ký | 09/10 |
| M6 | Service đọc cấu hình thế nào | `St/object-storage.service.ts:95-118` · `Cf/load-env.ts:35,37` | Đọc THẲNG `process.env` trong constructor (đổi env ⇒ phải khởi động lại). `.env` chỉ điền khoá CHƯA có trong `process.env` và gán cả giá trị rỗng | 09/10 |
| M7 | Luật env hiện có cho `S3_*` | `Cf/env.schema.ts:23-27,202-209,404-451` | `S3_ENDPOINT: optionalUrl()` (rỗng ⇒ chưa set); KHÔNG luật production nào cho `S3_*`; khuôn luật production = `:434-441`. Schema không `.strict()` (grep = 0) ⇒ bản mã cũ bỏ qua khoá lạ trong `.env` (rollback mã an toàn khi biến mới còn đó) | 09/10 |
| M8 | Lớp tự kiểm sau ký của #578 nhìn gì | `St/presign-invariants.ts:58,76-82,106-116` | Chỉ đọc query của URL — KHÔNG nhìn host · scheme · path | 09/10 |
| M9 | Thứ nằm trong chữ ký | SU3 câu 1 (đọc mã SDK đã cài) · `pnpm-lock.yaml:719,771` | SDK `client-s3` + `s3-request-presigner` `3.1068.0`. Header `host` LUÔN được ký = `hostname[:port]` của endpoint (cổng nằm trong chuỗi ký); path (`/<bucket>/<key>` khi path-style) nằm trong chữ ký; ký là phép tính cục bộ, không cần mạng | 09/10 |
| M10 | Storage kiểm chữ ký và CORS thế nào | SU3 câu 4–5 (mã nguồn đúng tag đang chạy) · SU2 §G (tài liệu) | Kiểm chữ ký theo `Host` NHẬN ĐƯỢC; bản đang chạy KHÔNG có CORS theo bucket — CORS là thiết lập toàn dịch vụ, mặc định nhận mọi origin | 09/10 |
| M11 | Đường vào có giữ `Host` gốc | `docs/DEVOPS/evidence/S10-AUTH-IPTRUST-1-headers-20260818-105920.txt:14` + SU3 câu 2 (mã nguồn tunnel) | Origin sau chính tunnel này nhận `Host` công khai nguyên vẹn khi ingress không đặt `httpHostHeader` | 18/08 |
| M12 | FE gọi storage thế nào | `W/lib/storage-upload.ts:30-35` · `W/lib/task-file-api.ts:189-190` | PUT bằng `fetch` kèm header `Content-Type`, `credentials: "omit"`, chỉ đọc mã trạng thái. Riêng tệp TASK tải về bằng `fetch` đi theo 302 sang storage | 09/10 |
| M13 | Trần cỡ một lượt tải lên | `packages/contracts/src/task.ts:260` · `St/object-storage.service.ts:157-162` | 50 MB, ép TRƯỚC mọi lượt ký PUT ⇒ dưới trần thân yêu cầu 100 MB của lớp biên (SU3 câu 2, tài liệu nhà cung cấp) | 09/10 |
| M14 | CI | `.github/workflows/api.yml:101,104,208` · `D03:420-421` | `S3_ENDPOINT=http://localhost:9000`, bucket `mediaos-test`, storage CI publish `-p 9000:9000`; CI chạy bản storage KHÁC PROD, không TLS | 09/10 |
| M15 | Hạ tầng test | `apps/api/vitest.config.ts:10-11,95` · `T/global-setup.ts:21-22` · `T/helpers/storage-test-target.ts:31,34` | `test.env` của vitest áp cho WORKER và thắng `process.env`; globalSetup chạy ở tiến trình chính. Ca storage thật chỉ chạy trên đúng tên bucket thử (cục bộ `mediaos-fdisp-test`, CI `mediaos-test`) | 09/10 |
| M16 | Ràng buộc vận hành | `D03:372-376,422-423` · SU2 §A | PROD + dev-online dùng CHUNG một container storage; bản storage đang chạy không còn kênh nhận bản vá và image chỉ còn trong cache máy này. Biến env mới phải vào CẢ `.env` (service đọc) lẫn `.env.prod` (bản lưu, bị chép đè lên `.env`). `Sw/01-setup-env.ps1` không chạy lại được trên máy đang chạy (`-Force` sinh lại mọi secret). `Sw/05-tunnel.ps1:49-52` ghi đè cấu hình bằng 1 hostname — không phải nguồn của file đang chạy | 09/10 |
| M17 | **SUY RA** — hai cách viết `localhost` / `127.0.0.1` cùng tới storage từ tiến trình test | `localhost` đã chạy ở int-spec của #578 (cục bộ + CI); `127.0.0.1` chưa | Đo ở L4 bằng ca H-0 trước khi coi cặp này là cổng | — |
| M18 | **SUY RA** — storage tôn trọng `response-cache-control` đã ký và mặc định không gửi `Cache-Control` | SU3 câu 3 | Đo ở L4: ca H-3 đọc header phản hồi thật | — |
| M19 | **SUY RA** — sau redirect khác origin, lượt `fetch` thứ hai mang `Origin: null` | chuẩn Fetch (SU1 §C) | Owner đo bằng DevTools ở bước H8 | — |
| M20 | **CHƯA ĐO (chỉ owner đo được)** | — | Hiện trạng từ thiết bị ngoài (`done_when[0]`) · bucket PROD có riêng tư thật không · phạm vi quyền của khoá ký · gói dịch vụ lớp biên (số luật, trường dùng được) · lớp biên có cache phản hồi GET · dev-online dùng bucket nào | — |

## 2. Quyết định owner đã có + ba hướng

Owner chọn **hướng (a)** qua hộp hỏi ~13:55 ngày 09/10/2026: «Làm thẳng hướng (a) tới khi mở PR» (`done_when[1]`).
Mọi thay đổi trên PROD do owner tự chạy theo §5; agent không chạm PROD. Lưu ý: dữ kiện ở §8 O1 có SAU quyết định này.

| | (a) đường vào riêng + endpoint KÝ công khai | (b) API tự nhận / phục vụ byte | (c) object storage S3-compatible được quản lý |
| --- | --- | --- | --- |
| Đổi mã | nhỏ: một file service + luật env | lớn: route nhận / phát byte, phân quyền từng lượt, Range, trần cỡ | nhỏ ở SDK; LỚN ở vận hành (di trú dữ liệu, đối chiếu `storage_key`, khoá mới) |
| Đổi hạ tầng | 1 hostname qua tunnel + luật ở lớp biên | không | bucket mới, CORS theo bucket, di trú |
| Bề mặt mở thêm | cổng API của storage tới được từ ngoài (chỉ tiền tố bucket) | không mở gì | do nhà cung cấp vận hành |
| Giới hạn | thân yêu cầu ≤ 100 MB ở lớp biên (trần ứng dụng 50 MB — M13) | byte đi qua tiến trình API (RAM · CPU · timeout proxy) | URL ký nằm trên tên miền của nhà cung cấp |
| Bất biến #578 | giữ nguyên cơ chế | phải viết lại (không còn URL ký) | giữ nguyên cơ chế |
| Đường lùi | bỏ biến + khởi động lại API (1 lệnh); gỡ ingress | rollback mã | khó sau khi đã di trú |

## 3. Bất biến phải giữ

| # | Bất biến | Nguồn |
| --- | --- | --- |
| B1 | URL PUT: `content-type` nằm trong chữ ký; ghi lệch kiểu ⇒ storage từ chối | #578 · `St/object-storage.service.ts:196` |
| B2 | URL GET: kiểu trả + cách phục vụ do server ép bằng hai tham số `response-*` đã ký, mỗi tham số đúng một lần | #578 · `:281-282` |
| B3 | Tự kiểm sau ký là fail-closed: không đạt ⇒ log mức error KHÔNG chứa URL / khoá / chữ ký, ném lỗi, không phát URL | #578 · `:208-217` |
| B4 | `validateKey` + `assertUploadAllowed` TRƯỚC khi ký PUT; `assertKeyInTenant` trước khi ký GET và trước mọi thao tác server (cô lập theo `company_id`) | CLAUDE.md §2.1 · `:186-187,276` |
| B5 | TTL URL ký giữ nguyên (`S3_PRESIGN_TTL_SEC`, trần 3600) — và hạn THỰC không bị một lớp cache dùng chung kéo dài | `done_when[3]` |
| B6 | Không secret plaintext: không thêm khoá mới; URL ký · host · khoá object không vào log / thông điệp lỗi; lỗi env không in GIÁ TRỊ biến | CLAUDE.md §2.3 |
| B7 | **Vắng biến mới ⇒ hành vi y như hôm nay** cho dev · CI · lane: vẫn MỘT client, URL cùng host + cùng tập tham số; không sửa `api.yml` | `done_when[2]` |
| B8 | Thao tác phía server (HEAD · GET byte · PUT · DELETE) chỉ đi endpoint nội bộ; client ký không bao giờ gửi yêu cầu | `done_when[2]` |
| B9 | Bucket giữ riêng tư; cổng console của storage không được đưa ra ngoài; cổng host của container vẫn loopback | `done_when[3]` · `D03:359` |
| B10 | Bề mặt PORT / adapter / DTO và mọi nơi gọi ở M5 không đổi; không migration; không dependency mới | phạm vi |

## 4. Thiết kế phần mã

| D | Quyết định | Lý do | Phương án đã loại |
| --- | --- | --- | --- |
| D1 | Biến env mới **`S3_PUBLIC_ENDPOINT`** = origin mà TRÌNH DUYỆT dùng để tới storage; CHỈ dùng để ký | Đặt cạnh `S3_ENDPOINT`, đọc là hiểu «địa chỉ công khai» | `S3_PRESIGN_ENDPOINT` (tả cơ chế, không tả ai dùng); đổi thẳng `S3_ENDPOINT` sang tên công khai (thao tác server đi vòng ra ngoài: chậm, dính trần thân yêu cầu, phụ thuộc Internet) |
| D2 | Trong service: biến vắng / rỗng / toàn khoảng trắng ⇒ `publicEndpoint = null` ⇒ `getSigningClient()` trả CHÍNH instance của `getClient()`. Giá trị có mặt mà không phân tích được ⇒ constructor ném lỗi nêu TÊN biến (không rơi về endpoint nội bộ trong im lặng) | Service đọc env thô (M6) nên phải tự coi rỗng = vắng; «cùng instance» làm B7 chứng minh được bằng một phép so | Luôn dựng hai client (B7 khó chứng minh); nuốt giá trị hỏng rồi ký bằng endpoint nội bộ (hỏng kín — đúng lỗi của WO) |
| D3 | Tách `buildClient(endpoint)` từ `:133-138`; hai client chỉ KHÁC `endpoint` — cùng region · cặp khoá · `forcePathStyle` | Ba thứ đó nằm trong chữ ký / hình dạng URL; dựng từ một hàm thì không trôi | Hai khối tuỳ chọn viết riêng |
| D4 | MỘT phương thức riêng tư `presign(command, options)` là nơi DUY NHẤT chạm client ký; `:194` và `:284` gọi nó. Bốn chỗ `.send()` giữ `getClient()` | Đổi đúng hai dòng dùng client; B8 đo được bằng ca C-2 + mutant ★2 | Gắn cho client ký một bộ xử lý luôn-từ-chối (thêm một khác biệt tuỳ chọn giữa hai client — trái D3); để làm cứng thêm nếu gate yêu cầu (§9 N7) |
| D5 | Luật trong `superRefine` của `Cf/env.schema.ts` (khuôn `:434-441`), chỉ xét khi biến có giá trị; thông điệp nêu tên biến + luật, KHÔNG in giá trị. **E1** production ⇒ phải bắt đầu `https://`. **E2** mọi môi trường ⇒ giá trị phải BẰNG `new URL(giá trị).origin`. **E3** production ⇒ hostname là tên miền (có dấu chấm, không phải địa chỉ IP, không thuộc `.localhost`). **E4** có biến ⇒ `S3_FORCE_PATH_STYLE` phải `true` | E1 = `done_when[2]` (trang https không nạp được nội dung http). E2 là MỘT quy tắc dương loại cùng lúc path · query · userinfo · dấu `/` cuối · cổng mặc định viết tường minh · chữ hoa — host[:port] và path nằm trong chữ ký (M9), userinfo sẽ lọt vào mọi URL. E3 chặn việc tái lập đúng lỗi của WO trong im lặng (lưới chống gõ nhầm, không phải ranh giới bảo mật). E4: đường vào là một hostname 1 cấp; kiểu virtual-host cần DNS + chứng chỉ theo từng bucket | «Có biến mà thiếu `S3_ENDPOINT` ⇒ lỗi» (khi đó storage chưa cấu hình và đã nổ to lúc dùng); chuẩn hoá giá trị thay vì từ chối (hai bộ chuẩn hoá ở schema và service) |
| D6 | Tự kiểm sau ký mở rộng (`St/presign-invariants.ts`), CHỈ khi có endpoint ký riêng: `assertPresignedUrlOrigin` — origin của URL vừa ký phải BẰNG origin của `S3_PUBLIC_ENDPOINT`; lệch ⇒ `StoragePresignInvariantError` qua `verifyPresigned` sẵn có (B3) | Lớp của #578 mù host (M8); bắt «dùng nhầm client» và việc SDK đổi cách dựng URL | Chỉ dựa vào test (một lần nâng SDK sẽ phát URL không tới được mà không ai biết); chạy cả khi vắng biến (kiểu virtual-host hợp lệ có host khác endpoint — phá B7) |
| D7 | Khi ký GET bằng endpoint ký riêng: thêm `ResponseCacheControl: "private"` (thành tham số `response-cache-control` đã ký — cùng cơ chế với hai `response-*` của #578) + tự kiểm đòi tham số này đúng một lần, đúng giá trị | Đường công khai đi qua một lớp cache dùng chung có khoá là URL đầy đủ; không có chỉ thị thì phản hồi có thể được phát lại sau khi chữ ký hết hạn hoặc sau khi tệp bị thu hồi (B5). `private` chỉ loại cache dùng chung — trình duyệt hành xử như hôm nay. Hành vi storage là SUY RA tới L4 (M18) | Chỉ dựa vào luật ở lớp biên (nằm ngoài git, trôi không ai thấy) — vẫn làm CẢ HAI (§5 H3); `no-store` (ảnh / avatar tải lại mỗi lượt); thêm cả khi vắng biến (phá B7) |
| D8 | Không dòng log / thông điệp mới nào chứa URL, host công khai hay khoá object; `publicEndpoint` không được nội suy vào lỗi | B6. Hiện trạng: các module phát URL ký không có dòng log nào in URL (SU1 §E2, grep = 0) | — |
| D9 | Hàng rào test: thêm `S3_PUBLIC_ENDPOINT: ""` vào `test.env` của vitest (`apps/api/vitest.config.ts`, hàm `laneDbEnv`) ⇒ `.env` của checkout không thể đẩy endpoint công khai vào bất kỳ spec nào (M6, M15); chỉ các ca host tự đặt rồi khôi phục. File này NGOÀI `paths` ⇒ L0 thêm nó vào `paths` của WO (ngoại lệ phạm vi một dòng, nêu ở đầu PR) | SUY RA: sau khi `.env` của máy chủ có biến mới, 17 int-spec storage + spec ký sẽ ký theo host công khai và `fetch` ra ngoài tới storage dùng chung | `T/global-setup.ts` (chạy ở tiến trình chính, không tới worker — `:21-22`); đặt trong từng spec (file thứ 18 sẽ quên) |
| D10 | Script: `Sw/01-setup-env.ps1` thêm tham số `-StorageSubdomain` (rỗng ⇒ KHÔNG ghi dòng; có ⇒ ghi `S3_PUBLIC_ENDPOINT=https://<nhãn>.$Domain` sau `:83`) — chỉ phục vụ máy MỚI. Mới: `Sw/13-tunnel-storage.ps1` theo khuôn `Sw/07-tunnel-dev.ps1:33,53,73-75` (dò file service đang đọc · route dns · chèn TRƯỚC catch-all · bỏ qua nếu đã có) + backup có dấu thời gian → `ingress validate` → `ingress rule` → đỏ thì khôi phục backup và KHÔNG khởi động lại (`Sw/cloudflared-new-machine.ps1:497-502`), có `-DryRun`. Mới: `Sw/14-storage-public-probe.ps1` — các phép đo chỉ-đọc của §5, in ĐẠT / KHÔNG ĐẠT, không in giá trị env. `Sw/05-tunnel.ps1`: chỉ thêm một dòng chú thích trỏ sang 13. `docker-compose.yml:126-128`: chỉ chú thích (cổng host vẫn loopback, cổng console không bao giờ được định tuyến) | `done_when[5]`. Máy đang chạy = sửa tay theo §5 (M16) | Sửa 05 (ghi đè mọi hostname đang chạy); đổi `INFRA_BIND_ADDR` (một biến chung cho 4 dịch vụ — mở luôn DB và cache); sửa `mediaos.ps1` (ngoài `paths` ⇒ §9 N3) |
| D11 | `.env.example`: thêm biến mới vào khối S3 (theo SU2: `.env.example:60-73`; plan không đọc file `.env*` nào), giá trị mẫu RỖNG + chú thích «vắng = hành vi cũ; production đòi https» | Phải qua `Cf/env-example-boots.spec.ts` (nạp file mẫu thật qua `loadEnv`) | Giá trị mẫu là một hostname |
| D12 | Tài liệu: `D03` tiểu mục mới §13.5 (đường vào storage · thứ tự PROD rồi dev-online · đường lùi) + ghi chú cạnh `:375-376`; DEVOPS-11 §6.1 (`:89`) + §9.1 (`:137`) mỗi nơi một dòng; RELEASE-08 (`:20-21` + mục triển khai / lùi); RELEASE-02 mở **KI-084** ở CUỐI bảng (rebase ngay trước khi mở PR — file hay xung đột) | `done_when[5]`. Căn cứ không đổi: «không public bucket production» (DEVOPS-11 `:226`) — hướng (a) giữ bucket riêng tư | Sửa DECISIONS (không cần ADR mới) |

Kích thước sau WO (ước): `object-storage.service.ts` 356 → ~400 · `presign-invariants.ts` 117 → ~165 · `env.schema.ts` 464 → ~500 dòng.

## 5. Phần hạ tầng — checklist owner tự chạy (PROD trước, dev-online sau)

**Điều kiện mở:** không bước nào từ H3 trở đi được chạy khi O1 · O2 · O3 (§8) chưa có câu trả lời. H3 → H5 làm trong MỘT
lượt ngồi máy. Không bước nào tạo lại container storage hay chạm dữ liệu trong volume.
**CORS:** bản storage đang chạy không có CORS theo bucket (M10) ⇒ vế «CORS của bucket» ở `done_when[3]` được thực hiện
bằng danh sách origin ở lớp biên (H3): yêu cầu mang `Origin` lạ bị TỪ CHỐI HẲN. Mức thật của lớp này: với URL ký, chữ ký
là hàng rào; danh sách origin chỉ ngăn trang lạ dùng trình duyệt của người dùng.

| # | Bước (lệnh / chỗ sửa) | ĐO là đã đạt | Gián đoạn | Đường lùi |
| --- | --- | --- | --- | --- |
| H0 | Ghi commit PROD đang chạy (`GET /api/v1/health`). Từ một thiết bị KHÁC máy chủ: gửi một tệp qua chat + xem một avatar | Ghi kết quả vào §9.3 (`done_when[0]`) | không | — |
| H1 | Merge PR → kéo mã về checkout chính → `m dev-online-stop` → `m prod-update api` (biến CHƯA đặt) | health mang commit mới; tệp trên máy chủ vẫn chạy như cũ | API khởi động lại | `m prod-rollback` |
| H2 | Đo qua loopback (owner): GET / LIST không chữ ký vào bucket; phạm vi quyền của khoá ký; image storage còn trong cache; gói dịch vụ lớp biên | bị từ chối ⇒ bucket riêng tư (`done_when[3]`, ghi evidence); các số còn lại ghi vào §9.3 | không | — |
| H3 | Lớp biên, đặt TRƯỚC khi hostname có đường đi: (i) bỏ qua cache cho hostname storage; (ii) MỘT luật dương — chặn mọi yêu cầu KHÔNG thoả cả ba: method ∈ GET · HEAD · PUT · OPTIONS, path dưới tiền tố bucket, `Origin` vắng hoặc thuộc danh sách O3; (iii) các điều kiện biên của O1 (ghi chú vận hành ngoài kho) | luật hiện trên bảng điều khiển; đo thật ở H5 | không | tắt luật |
| H4 | `Sw/13-tunnel-storage.ps1 -DryRun` rồi chạy thật: bản ghi DNS + một ingress `hostname: <nhãn>.$Domain` · `path: ^/<bucket>/` · `service: http://localhost:9000`, chèn trước catch-all, KHÔNG đặt `httpHostHeader` (M11); backup → validate → ingress rule → khởi động lại dịch vụ tunnel | script in ĐẠT ở cả hai phép kiểm | MỌI hostname của tunnel rớt vài giây (API PROD · LMS · dev-online; kết nối realtime tự nối lại) ⇒ chọn giờ vắng | chép lại backup + khởi động lại tunnel (rớt thêm vài giây); xoá bản ghi DNS |
| H5 | NGAY sau H4 — `Sw/14-storage-public-probe.ps1` + thiết bị ngoài | (1) GET không chữ ký vào đường dẫn bucket ⇒ bị STORAGE từ chối (không phải 404 của tunnel); (2) đường dẫn ngoài bucket ⇒ 404; (3) cổng console không tới được; (4) method ngoài danh sách ⇒ bị chặn; (5) `Origin` lạ ⇒ bị chặn, preflight PUT + `content-type` từ origin FE ⇒ qua; (6) phản hồi GET không mang dấu «phát từ cache» | không | một phép KHÔNG ĐẠT ⇒ lùi H4 ngay |
| H6 | Thêm `S3_PUBLIC_ENDPOINT=https://<nhãn>.$Domain` (đúng dạng: không `/` cuối, không path, không cổng) vào CẢ `.env.prod` lẫn `.env` → `m prod-restart api` | health 200. API không lên ⇒ đọc `logs\api.err.log` (lỗi nêu tên biến + luật) | API khởi động lại | xoá dòng ở cả hai file → `m prod-restart api` ⇒ về hành vi cũ |
| H7 | Smoke TRÊN máy chủ (nay cũng đi đường công khai): gửi + xem một tệp | tệp lên, ảnh hiện | không | H6 |
| H8 | Smoke của owner từ thiết bị NGOÀI (`done_when[6]`): ảnh + pdf tên có dấu qua chat (và ô soạn bài SOCIAL sau khi FE-2D lát A merge); avatar. Trong DevTools: header `cache-control` của ảnh, dấu cache của lớp biên; thử tải một tệp TASK và ghi `Origin` của lượt thứ hai (M19) | ảnh hiện · pdf tải về đúng tên · avatar hiện · `cache-control: private` · không phát từ cache. Ghi cả kết quả tệp TASK | không | H6 |
| H9 | dev-online (SAU khi PROD đạt): xác định bucket của dev-online — khác bucket PROD ⇒ chạy lại script 13 với danh sách bucket mới (thêm một lần tunnel khởi động lại) + thêm origin dev vào luật H3; thêm biến vào file env của dev-online → `m dev-online` | smoke trên các origin dev | chỉ dev-online (+ tunnel nếu đổi `path`) | xoá dòng, chạy lại `m dev-online` |
| H10 | Gỡ điều kiện «chưa merge» ở PR của FE-2D lát A; đóng KI-084; ghi evidence | — | không | — |

Lùi toàn bộ (thứ tự ngược): biến ở hai file env + khởi động lại API → khôi phục cấu hình tunnel → bản ghi DNS → luật lớp
biên. URL công khai đã phát chết theo hostname (hạn ngắn).
**KHÔNG kiểm được trước khi owner đổi hạ tầng:** chữ ký còn hợp lệ khi đi hết đường công khai (đường vào giữ nguyên
`Host` + path) · hành vi cache / luật của lớp biên · preflight qua lớp biên · nội dung hỗn hợp · `Origin` sau redirect.
Int-spec chỉ chứng minh «chữ ký gắn với host» trên storage thật; phần còn lại là H5 + H8.

## 6. Ca test viết TRƯỚC (mỗi ca TỪ CHỐI đứng cạnh ca CHO PHÉP) + mutant ★

| Ca | `done_when` | Tầng · file | TỪ CHỐI ⇄ CHO PHÉP | Đỏ kỳ vọng trên mã hôm nay |
| --- | --- | --- | --- | --- |
| F-1 | [2] | unit hạ tầng · `T/foundation/storage-public-endpoint-fence.unit-spec.ts` | — ⇄ `process.env.S3_PUBLIC_ENDPOINT === ""` ngay đầu worker | `expected undefined to be ''` |
| E-1 | [2] | unit · `Cf/env.schema.spec.ts` (khung env production ĐỦ hợp lệ, mượn của ca KI-029 `:168-190`, để lỗi chỉ đến từ luật mới) | production + `http://files.example.test` ⇒ ném, thông điệp có tên biến ⇄ production + `https://files.example.test` qua; ngoài production + `http://127.0.0.1:9000` qua | `expected [Function] to throw an error` |
| E-2 | [2] | như trên | `https://h.example.test/x` · `…/` · `…?a=1` · URL có phần userinfo (dựng bằng ghép chuỗi trong spec) · `https://h.example.test:443` · `HTTPS://H.example.test` ⇒ ném, thông điệp KHÔNG chứa giá trị ⇄ `https://h.example.test` · `http://localhost:9000` qua | như E-1 |
| E-3 | — | như trên | production + `https://localhost` · `https://127.0.0.1` · `https://[::1]` · `https://x.localhost` ⇒ ném ⇄ production + `https://files.example.test` qua; ngoài production + `http://localhost:9000` qua | như E-1 |
| E-4 | — | như trên | có biến + `S3_FORCE_PATH_STYLE=false` ⇒ ném ⇄ có biến + `true` qua; VẮNG biến + `false` qua (B7) | như E-1 |
| E-5 | [2] | như trên (danh sách `:32-39`) + `Cf/env-example-boots.spec.ts` sẵn có | — ⇄ `""` / toàn khoảng trắng ⇒ `undefined`; file mẫu có dòng mới vẫn nạp được | ca nền (xanh trước và sau: hôm nay schema bỏ khoá lạ) — đo bằng ★13 |
| P-1 | [2] | unit · `St/presign-invariants.spec.ts` | origin URL khác kỳ vọng ở host · ở cổng · ở scheme ⇒ ném, thông điệp không chứa URL / host ⇄ bằng ⇒ không ném | hàm chưa có (đỏ nạp — CHỈ chấp nhận ở L2, ghi §9.3) |
| P-2 | [3] | như trên | URL GET thiếu `response-cache-control` · khác giá trị · xuất hiện hai lần ⇒ ném ⇄ đúng một lần = `private` ⇒ không ném | như P-1 |
| G-1 | [2] | unit ký THẬT ngoại tuyến · `St/object-storage.presign.spec.ts` (thêm khoá vào `:29-37`) | — ⇄ VẮNG biến: host URL PUT + GET = host `S3_ENDPOINT`; URL GET KHÔNG có `response-cache-control` | ca nền (xanh trước và sau) — đo bằng ★1 · ★8 |
| G-2 | [2] | như trên | — ⇄ biến = `https://files.example.test` ⇒ origin của URL PUT và GET = đúng origin đó | `expected 'http://storage.invalid:9000' to be 'https://files.example.test'` |
| G-3 | [4] | như trên | — ⇄ có biến: `X-Amz-SignedHeaders` của PUT vẫn có `content-type` + `host`; GET vẫn mang hai `response-*` đúng giá trị server + `response-cache-control=private`; path giống hệt lúc vắng biến | như G-2 |
| G-4 | [2] | như trên | biến = `"không phải url"` ⇒ dựng service ném, thông điệp có tên biến ⇄ biến = `""` / `"   "` ⇒ như G-1 | `expected [Function] to throw an error` |
| G-5 | [2] | như trên (fake timer) | cùng khoá · kiểu · thời điểm: chữ ký CÓ biến ≠ chữ ký VẮNG biến ⇄ hai lượt cùng biến ⇒ chữ ký giống | `expected '<sig>' not to be '<sig>'` |
| C-1 | [2] | unit SDK giả, `send` theo từng instance · `St/object-storage.signing-client.spec.ts` (mới) | — ⇄ có biến: dựng HAI client, cùng region · khoá · path-style, khác endpoint; cả hai hàm ký gọi presigner với instance CÔNG KHAI. Vắng biến: dựng MỘT client, presigner nhận chính nó | `expected "spy" to be called 2 times, but got 1 times` |
| C-2 | [2] | như trên | có biến: `putObject` · `deleteObject` · `statObject` · `getObjectBytes` ⇒ instance công khai nhận 0 lượt `send` ⇄ instance nội bộ nhận đủ 4 | ca nền sau L3 — đo bằng ★2 |
| C-3 | [2] | như trên | presigner giả trả URL khác origin ⇒ `StoragePresignInvariantError`, `logger.error` đúng 1 lần, không chứa URL ⇄ đúng origin ⇒ trả URL | `promise resolved … instead of rejecting` |
| H-0 | — | int · storage thật + DB · `T/integration/s19-storagepublic-signing-host.int-spec.ts` (mới; `applyMainPipeline`; `resolveStorageTestTarget`; cổng `hasDb && LANE_DB`) | ca nền: GET không chữ ký tới CẢ hai cách viết host đều nhận phản hồi HTTP (M17). Hostname của `S3_ENDPOINT` ngoài {`localhost`, `127.0.0.1`}, hoặc một cách viết không tới ⇒ CI ném / cục bộ bỏ qua KÈM cảnh báo | — |
| H-1 | [2] | như trên — endpoint ký = `S3_ENDPOINT` đổi hostname `localhost ⇄ 127.0.0.1` | chép URL PUT, CHỈ đổi host về cách viết nội bộ ⇒ **403**, thân chứa `SignatureDoesNotMatch`, HEAD qua client nội bộ ⇒ object VẮNG ⇄ URL nguyên (host = host ký) ⇒ 200 | `expected '<host nội bộ>' to be '<host ký>'` |
| H-2 | [2] | như trên | — ⇄ sau H-1: confirm-upload (HEAD + GET byte qua SDK) ⇒ 200 `Uploaded` trong khi URL phát ra mang host ký (thao tác server vẫn nội bộ) | như H-1 |
| H-3 | [2][3] | như trên | URL GET đổi host ⇒ 403 `SignatureDoesNotMatch` ⇄ URL nguyên ⇒ 200, `content-type` + `content-disposition` đúng giá trị server ép, `cache-control: private` | như H-1 |
| R | [4] | int · `T/integration/s16-filedisposition-storage.int-spec.ts` | nhóm S1–S9 của #578 chạy HAI lượt bằng `describe…each` trên `:137`: «endpoint nội bộ» · «endpoint ký riêng» — mỗi lượt dựng app RIÊNG (đặt biến trước `:383`, khôi phục ở `:455`) | lượt «endpoint ký riêng» đỏ ở phép so host (thêm 1 assert host vào ca PUT đầu) |

- Báo cáo verify PHẢI chép dòng đếm `Tests N passed | M skipped` của từng file int-spec, nói rõ «ca storage thật: CHẠY / BỎ QUA» cho CẢ hai lượt của R.
- **Mutant ★** (cấy SAU khi lát đã commit; `cp` bản sao trước khi cấy; đỏ phải khớp THÔNG ĐIỆP):

| ★ | Điểm gác | Mutant | Ca giết + thông điệp |
| --- | --- | --- | --- |
| ★1 | D2/D4 client ký | `getSigningClient()` luôn trả `getClient()` | G-2 `expected 'http://storage.invalid:9000' to be 'https://files.example.test'` |
| ★2 | B8 | `statObject` dùng client ký | C-2 `expected "spy" to not be called` (instance công khai nhận 1 lượt) |
| ★3 | D6 | gỡ lời gọi kiểm origin | C-3 `promise resolved … instead of rejecting` |
| ★4 | E1 | bỏ luật https | E-1 `expected [Function] to throw an error` |
| ★5 | E2 | thay phép so bằng `startsWith("http")` | E-2 đỏ ở ca `…/x` |
| ★6 · ★7 | E3 · E4 | bỏ từng luật (hai lượt riêng) | E-3 · E-4 `expected [Function] to throw an error` |
| ★8 | D7 / B7 | luôn thêm `ResponseCacheControl` | G-1 `expected 'private' to be null` |
| ★9a · ★9b | D7 | 9a chỉ bỏ tham số ⇒ G-3 đỏ vì `StoragePresignInvariantError`; 9b bỏ tham số + lời gọi kiểm ⇒ G-3 `expected null to be 'private'` | hai lượt, mỗi lượt MỘT thông điệp |
| ★10 | D2 | coi chuỗi toàn khoảng trắng là có giá trị | G-4 đỏ ở vế CHO PHÉP (ném thay vì ký như G-1) |
| ★11 | D9 | gỡ dòng hàng rào khỏi `vitest.config.ts` | F-1 `expected undefined to be ''` |
| ★12 | storage thật | ký bằng endpoint nội bộ + tắt D6 | H-1 đỏ ở phép so host; lượt «endpoint ký riêng» của R đỏ cùng thông điệp |
| ★13 | D5 khai báo | khai biến bằng `z.string().url().optional()` thay `optionalUrl()` | E-5 đỏ ở ca `""`: ném `Invalid environment variables` |

Thông điệp trong hai bảng là DẠNG kỳ vọng; lượt chạy thật chép thông điệp nguyên văn vào §9.3 — lệch dạng (vd đỏ vì 500
hoặc vì lỗi biên dịch) thì ca chưa chứng minh được gì.

## 7. Lát thi công · verify · gate

Tuần tự, mỗi lát MỘT commit, RED → GREEN (chạy spec trên mã trước lát, chép thông điệp đỏ THẬT vào §9.3, rồi mới viết mã).

| Lát | Làm gì | Ca |
| --- | --- | --- |
| L0 | `harness/backlog.mjs`: thêm `apps/api/vitest.config.ts` vào `paths`; hàng rào D9 + spec F-1 | F-1 |
| L1 | `Cf/env.schema.ts` (biến + E1–E4) · spec · dòng mới ở `.env.example` (D11) | E-1…E-5 |
| L2 | `St/presign-invariants.ts`: kiểm origin + kiểm `response-cache-control` (hàm thuần) · spec | P-1 · P-2 |
| L3 | `St/object-storage.service.ts`: D2 · D3 · D4 · nối D6 + D7 · spec ký thật + spec SDK giả | G-1…G-5 · C-1…C-3 |
| L4 | Int-spec storage thật: file mới H-0…H-3 + `describe…each` cho nhóm của #578 | H-0…H-3 · R |
| L5 | Script 01 / 13 / 14 + chú thích 05 và compose (D10) · tài liệu (D12) · sổ + nợ §9 vào backlog | đọc lại bằng `-DryRun` (script không chạy thật ở máy này) |

**Verify** (chạy từ `C:/dev 2/MediaOS-stpub`; mỗi lúc MỘT lệnh nặng; KHÔNG `source .env`, KHÔNG in `.env`; biến DB + storage do phiên điều phối cấp như ở #578):
1. `pnpm --filter @mediaos/contracts build` (worktree mới chưa có dist).
2. `bash harness/check.sh --quick`.
3. `bash scripts/lane-db-setup.sh stpub` rồi
   `LANE_DB=mediaos_stpub S3_BUCKET=mediaos-fdisp-test pnpm --filter @mediaos/api exec vitest run src/storage src/config test/foundation/storage-public-endpoint-fence.unit-spec.ts test/integration/s19-storagepublic-signing-host.int-spec.ts test/integration/s16-filedisposition-storage.int-spec.ts --maxWorkers=4`
   — đọc dòng tổng kết NGUYÊN VĂN (không lọc bằng grep); ca storage thật phải báo ĐÃ CHẠY rồi mới sang bước 4.
4. Trước khi mở PR: `S3_BUCKET=mediaos-fdisp-test bash harness/check.sh --all --lane-db=stpub` (vùng đỏ; không đặt `CHUNK_RUNNER=0`).
5. Sau khi mở PR: job `api.yml` là phép đo trên storage của CI — đọc log tìm tên HAI file int-spec + dòng đếm.

**Gate:** plan qua `plan-reviewer` TRƯỚC khi viết mã. **FULL gate** tuần tự sau L5, TRƯỚC khi mở PR:
`security-reviewer` → `ecc:silent-failure-hunter` → `ecc:typescript-reviewer`. KHÔNG có migration, không đổi schema ⇒
KHÔNG gọi `database-reviewer`. PASS vòng 1 ⇒ dừng; mức LOW ⇒ ghi nợ §9.

**Bẫy áp vào WO này:** khoá giả trong spec phải ghép chuỗi (gitleaks) · spec unit đặt cạnh nguồn, unit hạ tầng đặt
`test/**/*.unit-spec.ts` · int-spec mới dựng app qua `applyMainPipeline` · ca storage «xanh» mà bị bỏ qua đọc y hệt đã
chạy ⇒ dòng đếm · 403 vì lệch host đọc giống 403 vì hết hạn ⇒ assert thân có `SignatureDoesNotMatch` · mỗi cấu hình env
một app riêng (service đọc env trong constructor) · file `.ps1` có tiếng Việt cần UTF-8 BOM; không dùng `catch [Kiểu]` của
PS7; không để stdout lệnh native lọt vào giá trị trả · `s16-filedisposition-storage.int-spec.ts` đang 776 dòng — phần
thêm ≤ 20 dòng, không vượt 800.

## 8. Bảng [OWNER]

| # | Câu hỏi | Mặc định an toàn (builder theo nếu owner chưa trả lời) | CHẶN? |
| --- | --- | --- | --- |
| **O1** | Bản storage đang chạy phát hành 09/2025 và không còn kênh nhận bản vá (`D03:372-373`); hướng (a) đưa cổng API của nó ra ngoài. Dữ kiện này có SAU quyết định 13:55. Owner giữ (a) kèm các điều kiện biên bắt buộc (ghi chú vận hành ngoài kho, phiên điều phối giữ), hay chỉ mở sau khi storage được nâng / thay, hay đổi sang (b) / (c)? | Phần MÃ làm tiếp tới khi mở PR (vắng biến thì không đổi hành vi; dùng lại được với mọi storage có địa chỉ công khai riêng). **KHÔNG bước hạ tầng nào từ H3 trở đi** được chạy khi chưa có câu trả lời | **CÓ — chặn H3+** |
| **O2** | Nhãn hostname cho storage + khung giờ cho lần khởi động lại tunnel ở H4 | Không có — owner đặt; script nhận tham số, tài liệu viết `<nhãn>.$Domain` | **CÓ — chặn H4** |
| **O3** | Danh sách origin cho H3: 3 origin FE của PROD (`Sw/01-setup-env.ps1:36-37`); origin dev thêm ở H9. Có nhận `Origin: null` cho GET không (đường tải tệp TASK bằng `fetch` qua 302 — M19)? | KHÔNG nhận `null` (đúng chữ `done_when[3]`). Tệp TASK với người dùng ở máy khác giữ nguyên như hôm nay cho tới WO kế (§9 N1); đo ở H8 | **CÓ — chặn H3** |
| O4 | Danh sách origin đặt ở đâu: luật lớp biên (không tạo lại container, lùi tức thì, nằm ngoài git ⇒ đo bằng script 14) hay biến env của container storage (trong git; phải tạo lại container dùng chung mà image chỉ còn trong cache)? | Lớp biên. Gói dịch vụ không đủ loại luật cần ⇒ quay lại hỏi owner | Không |
| O5 | Khoá mà API dùng để ký có phạm vi quyền hẹp không (CHƯA đo — H2)? Nếu rộng: thu hẹp TRƯỚC H4, hay nhận ở WO này và mở WO riêng? | Đo ở H2; nếu rộng ⇒ coi là một điều kiện biên của O1 (thu hẹp trước H4) | Không (đi theo O1) |
| O6 | dev-online có dùng đường mới trong WO này không; nó dùng bucket nào? | Chỉ PROD trước; dev-online ở H9 sau khi PROD đạt | Không |
| O7 | Thời điểm merge + `m prod-update api` (PR không đổi hành vi khi vắng biến; `m prod-update` cần dừng dev-online trước) | Phiên điều phối KHÔNG tự merge; owner chọn lúc | Không |
| O8 | Đưa các phép đo của script 14 vào `m prod-status` (`mediaos.ps1` ngoài `paths`)? | Không trong WO này — §9 N3 | Không |

## 9. Ngoài phạm vi / nợ · rủi ro + đường lùi

**Không làm (seed vào backlog ở L5, chữ trung tính):**
- N1 — tải tệp TASK bằng `fetch` qua 302 (`W/lib/task-file-api.ts:189-190`): đổi sang lấy URL dạng JSON rồi điều hướng (chạm `packages/web-core` + `apps/api/src/tasks`, ngoài `paths`).
- N2 — thu hẹp phạm vi quyền của khoá ký (nếu O5 không làm ở WO này) · nguồn bản vá / thay thế cho storage (`S19-OPS-MINIOMIRROR-1`, `D03:372-373`).
- N3 — nối các phép đo của `Sw/14-storage-public-probe.ps1` vào `m prod-status`.
- N4 — danh sách origin ở phía storage (O4 phương án hai).
- N5 — câu về `Host` sau tunnel ở DEVOPS-14 `:64` và `Sw/cloudflared-new-machine.ps1:567` lệch với bằng chứng đo M11.
- N6 — dòng mẫu cho dev-online trong `.env.dev-online.example` (ngoài `paths`).
- N7 — làm cứng thêm client ký (bộ xử lý luôn-từ-chối) nếu gate yêu cầu.
- N8 — nếu sau này nâng trần 50 MB (M13) thì phải đối chiếu trần thân yêu cầu của lớp biên.

| Rủi ro | Giảm bằng | Đường lùi |
| --- | --- | --- |
| Giá trị biến sai dạng ⇒ API PROD không lên sau H6 | E1–E4 nêu tên biến + luật; H6 ghi đúng dạng | xoá dòng ở hai file env → `m prod-restart api` |
| Biến chỉ vào `.env` mà thiếu `.env.prod` ⇒ mất ở lần chép đè kế tiếp, URL lặng lẽ quay về host nội bộ | H6 ghi CẢ HAI file; script 14 đo sự có mặt của TÊN biến | thêm lại dòng |
| Vá nhầm cấu hình tunnel ⇒ rớt mọi hostname | script 13: backup → validate → ingress rule → đỏ thì khôi phục, không khởi động lại | chép lại backup |
| Đường vào đổi `Host` / path ⇒ mọi URL công khai bị từ chối | không đặt `httpHostHeader`; `path` chỉ lọc, không viết lại; H7 + H8 đo ngay sau H6 | H6 |
| Lớp cache dùng chung giữ phản hồi quá hạn chữ ký | D7 (trong mã, có test) + H3 (i) | — |
| `.env` có biến mới đổ vào test ⇒ spec gọi ra đường công khai | D9 + F-1 + ★11 | — |
| Luật lớp biên nằm ngoài git ⇒ trôi | script 14 đo lại; `D03` §13.5 ghi từng luật ở mức yêu cầu | — |
| CI xanh không chứng minh nhánh https lẫn hành vi lớp biên (M14) | E-1 là unit; H5 + H8 là phép đo của owner | — |

### 9.3 Sổ vết

| Bước | Ngày | Kết quả |
| --- | --- | --- |
| Plan v1 | 09/10/2026 | viết trên `dd02788c`; chưa chạy lệnh nặng nào |
| Plan-review | | |
| L0 … L5 (thông điệp RED thật từng ca) | | |
| Mutant ★1 … ★12 | | |
| FULL gate | | |
| Verify bước 3 · 4 (dòng đếm nguyên văn) | | |
| H0 (hiện trạng từ thiết bị ngoài) | | |
| H2 · H5 · H8 (evidence) | | |
