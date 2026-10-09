# S16-SOCIAL-QA-1 — QA SOCIAL (ma trận cặp quyền · IDOR · chéo công ty · race counter · xoá mềm · census mã lỗi)

> **Đo trên `a3283ce3`** (nhánh `test/s16-social-qa-1`, lane DB `mediaos_qa1`, 09/10/2026). Zone 🟡 (backlog ghi `amber`).
> Mức «bản gọn»: plan + 1 vòng plan-review (đã vá — §9) → 9 lát test TUẦN TỰ → 1 lượt kiểm toán mutant độc lập → gate theo diff → verify có `LANE_DB` → MỘT PR.
> Nguồn nghiệm thu: tiêu đề + 3 `done_when` của WO (`harness/backlog.mjs:19382` trở đi). Khuôn: `docs/plans/S15-PAYROLL-QA-1.md`.
> Nguồn đo: tám bản đồ U1…U6 của phiên điều phối (ngoài kho) + các dòng «tự đo» ở §2. Mọi `file:dòng` tính từ gốc kho.
> Kho PUBLIC: nghi vấn hiển thị / đầu vào CHƯA vá chỉ ghi ở đây bằng mã + một dòng trung tính; chi tiết (tiền đề · hệ quả · `file:dòng`) nằm ở bản đồ ngoài kho `REV-held-details.md` (gọi tắt «sổ ngoài kho»).
> Viết tắt: `S/` = `apps/api/src/social/` · `T/` = `apps/api/test/integration/` · `H/` = `apps/api/test/helpers/`.

## 0. Chữ ký & quyết định

### 0.1 Bảng [OWNER] — không mục nào CHẶN; builder làm theo cột «mặc định an toàn» nếu owner im lặng

| #   | Loại | Câu hỏi | Phương án | Khuyến nghị | Mặc định an toàn |
| --- | ---- | ------- | --------- | ----------- | ---------------- |
| O1  | lệch done_when[1] | «widget» là 1 trong 6 bề mặt xoá mềm, nhưng BE chưa có widget SOCIAL nào ở DASH (`S/social-stats.service.ts:89` chưa có caller; chờ `S16-SOCIAL-DASH-1`). Đo «widget» bằng gì? | (a) nguồn dữ liệu của widget tương tác: hàng tuần hiện tại của 052 + gọi thẳng `weeklyEngagementForWidget` (số tin chưa xác nhận đã thuộc bề mặt «đếm») · (b) hoãn bề mặt này sang DASH-1 | (a) | (a); ghi vào notes: DASH-1 phải tự thêm ca xoá mềm cho widget thật |
| O2  | lệch done_when[0] | «mọi SOCIAL-ERR có ≥1 ca»: 3 khoá không tới được qua HTTP (006 và 008 bị Zod chặn ⇒ 400; `POST_TYPE_PAIR_DESYNC` là chân fail-closed) + 2 khoá không bao giờ ném. SPEC-16 §12 vẫn ghi 422 cho 006/008 | (a) liệt kê tường minh `HTTP_UNREACHABLE` + ca ghim 400 ở biên + ca unit gọi thẳng service · (b) gỡ Zod để mã ra dây | (a) | (a); đính chính SPEC-16 §12 ghi nợ cho `S16-SOCIAL-DOC-3` (`docs/spec/**` ngoài `paths`) |
| O3  | hiển thị | 024 (danh sách thẻ): phạm vi tổng hợp của danh sách — docblock ghi «chủ ý», API-19 im lặng | (a) thiết kế — ghim · (b) thu hẹp (WO riêng, vùng đỏ) | (a) | D23: ca I-L-4 ĐO rồi GIỮ NGOÀI KHO, báo số đo cho owner; KHÔNG vá. Bề mặt «tag» của xoá mềm = `usageCount` giảm + `feed?tag=` hết trả bài (ca này commit bình thường) |
| O4  | hiển thị | 035/036: cổng vào của hai route thành viên khác cổng của 032 — thiết kế (luồng chờ duyệt cần thế) hay cần hợp nhất? | (a) thiết kế — ghim · (b) hợp nhất (vùng đỏ, WO riêng) | (a) cho 035; hỏi riêng 036 | D23: I-G-5/6 đo rồi giữ ngoài kho; KHÔNG vá |
| O5  | hiển thị | Bài trong nhóm đã xoá: quy tắc «tác giả luôn thấy bài mình» và docblock của route xoá nhóm nói khác nhau — bên nào đúng? | (a) quy tắc tác giả thắng · (b) docblock thắng (đổi vị từ audience, FULL gate, WO riêng) | hỏi owner | D23: vế TÁC GIẢ của S-G đo rồi giữ ngoài kho; vế người KHÁC tác giả assert «biến mất» và commit như thường |
| O6  | hiển thị | Mention thêm vào bài KHÔNG ở trạng thái `published`: có sinh thông báo không — tài liệu im lặng | (a) chấp nhận hiện trạng · (b) siết (WO riêng) | (b), WO riêng | D23: F-O6 đo 1 ca rồi giữ ngoài kho + đề xuất WO nợ; KHÔNG vá |
| O7  | phạm vi vá | NẾU ca QA1-F-1 xác nhận một lớp ký tự điều khiển trong chuỗi đầu vào ra sai LỚP status (lớp lỗi nhiều khả năng CHUNG mọi module): vá ở đâu? | (a) biên chung toàn API (ngoài `paths`, WO riêng) · (b) vá hẹp trong `S/social.dto.ts` ⇒ 400 · (c) không vá, tách WO | (b) trong WO này + (a) thành WO kế | (b) — vùng vàng, LIGHT gate + `security-reviewer` hẹp trên hunk vá; ca F-1 chỉ commit CÙNG bản vá |
| O8  | phạm vi vá | Lỗi lộ ra mà GỐC nằm ngoài `S/` (nghi vấn S3 — bộ lọc lỗi toàn cục; S5 — `src/notifications/**`): vá ở đâu? Vá tại gốc là đổi hành vi của MỌI module trong một WO QA của SOCIAL | (a) không vá trong WO, tách WO kế · (b) vá tại gốc trong WO này (mở rộng `paths`, gate theo vùng của file gốc) | (a) | (a): ca KHÔNG để `it.fails`; chuyển thành ca nhãn `[O8]` chỉ assert bất biến YẾU đang đúng (không dữ liệu nào được ghi · thân lỗi có hình dạng chuẩn) + ghi status thật vào evidence + đề xuất WO kế. Lỗi gốc ngoài `S/` mà thuộc vùng đỏ ⇒ theo D23 (không commit ca) |

O3–O6 là «tài liệu im lặng / docblock tự mâu thuẫn» ⇒ theo K11 KHÔNG mặc nhiên là lỗi sản phẩm và KHÔNG tính vào hạn mức «quá 3 lỗi vùng đỏ thì dừng» — trừ khi owner trả lời (b). Chi tiết từng mục: sổ ngoài kho. Owner trả lời (a) cho mục nào thì ca giữ ngoài kho của mục đó được commit như ca ghim thiết kế (nhãn `[On]`).

### 0.2 Bảng quyết định của plan (builder cứ thế làm)

| D   | Từ K | Quyết định |
| --- | ---- | ---------- |
| D1  | K1 (sửa) | File mới `T/s16-social-qa1-<cụm>.int-spec.ts`, dựng app qua `applyMainPipeline`, `describe.skipIf(!(hasDb && LANE_DB))`, mỗi file < 800 dòng. Helper của WO = **HAI** file (không phải một — xem §0.3): `H/social-qa1-kit.ts` (L0) và `H/social-qa1-routes.ts` (L1); dựng xong là ĐÓNG BĂNG (lát sau chỉ thêm hàm mới). Khai TRƯỚC hai file phụ được phép: `H/social-qa1-seed.ts` (tách bộ gieo khỏi bảng route nếu `-routes.ts` vượt 700 dòng) và `H/social-qa1-code-cases.ts` (bảng `CODE_CASES`, L5 — D6) |
| D2  | K2 | Ba bảng LITERAL viết tay từ TÀI LIỆU: (i) route → cặp tầng 1 theo API-19 §5.1; (ii) vai → cặp theo `docs/permission-matrix-spec.md:707-721`; (iii) kỳ vọng route × vai. Ca «neo» đối chiếu (i) với hằng sản phẩm `SOCIAL_ROUTE_PAIRS` — hai nguồn độc lập, lệch là ĐỎ. Mã thành công `ok` của route là literal (POST = 201 trừ 054 · 055 · 058 = 200; còn lại 200) |
| D3  | K2 | Ca KIỂM ĐỦ (trong L1, chạy trên app đã boot): tập `METHOD path` của `collectRoutes(app)` (`apps/api/test/foundation/route-census.ts:136`) lọc theo TIỀN TỐ `/api/v1/social/` + `/api/v1/recycle-bin/feed-posts` == tập của bảng route (`toBe(59)`); cặp ở DECORATOR lúc chạy (`RouteInfo.permission`) của từng route == cặp trong bảng tay; tập key của bảng == `Object.keys(SOCIAL_ROUTE_PAIRS)`. Lọc theo tiền tố nên controller mới ngoài danh sách trắng của census cũ cũng bị bắt |
| D4  | K3 | Ô nào §3 trích `file:dòng` thì KHÔNG viết lại; ô đánh dấu `y` (chỉ status · uuid lạ thay cho «tồn tại mà không thấy» · assert lỏng 2 status) coi như CHƯA có. Ma trận cặp quyền vẫn phủ ĐỦ 59 route trong một bảng |
| D5  | K4 | Mỗi ca từ chối đứng cạnh ca cho phép cùng fixture + cùng request; ca cho phép assert mã CHÍNH XÁC. Deny tầng 1 assert `error.code === "AUTH-ERR-FORBIDDEN"` VÀ `error.message` khớp `/^Permission denied: /`; deny sàn scope assert message bắt đầu `AUTH-ERR-SCOPE-DENIED`; deny tầng 2 mang mã SOCIAL assert bằng `expectSocial` (code + message) |
| D6  | K5 | Bảng `CODE_CASES: Record<keyof typeof SOCIAL_ERROR_CODES, …>` (thiếu khoá = lỗi typecheck) đặt ở `H/social-qa1-code-cases.ts` — thư mục `H/` NẰM NGOÀI bề mặt mà census quét (`S/social-error-code-census.spec.ts:150-154` chỉ đọc `S/` · `T/` · `test/foundation/`, khớp bằng `includes` trên toàn văn) ⇒ chữ trong bảng không thể tự thoả tầng D. Mỗi mục chỉ là `{ file, anchor }` dạng CHUỖI (tên file int-spec + tên ca), không nhắc hằng. Tầng D tĩnh thêm vào `S/social-error-code-census.spec.ts` (chạy không cần DB): mọi khoá ĐƯỢC NÉM, ngoài `HTTP_UNREACHABLE`, phải có `SOCIAL_ERROR_CODES.<KHOÁ>` trong một `T/*social*.int-spec.ts`. Ca neo trong `T/s16-social-qa1-error-codes.int-spec.ts`: với mỗi mục, `file` tồn tại, chứa `anchor` VÀ chứa `SOCIAL_ERROR_CODES.<KHOÁ>`. 27 khoá đang ở mức «assert thông điệp» có fixture đắt ⇒ NÂNG TẠI CHỖ (thêm 1 dòng assert `error.code` vào đúng ca đang có), không dựng lại fixture |
| D7  | K6 | Đua TẤT ĐỊNH: giữ `FOR UPDATE` trên hàng cha (bài · bình luận · nhóm · poll) bằng pool RIÊNG → phóng N request → `waitForBlockedBy(pool, pid, N, {exact:true})` (`H/lock-wait.ts:61`) → nhả. N = 5 (pool app `max: 20`, `apps/api/src/db/index.ts:18`); riêng đường ghi poll N = 3 vì sản phẩm đặt `lock_timeout` 3 s (`S/social-polls.repository.ts:15, 123`): hâm nóng mỗi actor 1 request TRƯỚC khi giữ khoá, `waitForBlockedBy` timeout ≤ 1,5 s; hết giờ ⇒ ném lỗi mang nhãn «harness không kịp» (nhả khoá, chạy lại ca) — TÁCH khỏi assert sản phẩm, không được đọc thành 409 của sản phẩm. Helper `reconcileSocialCounters(direct, companyIds)` so **7** cột (code có 7, SPEC-16 §13.6 liệt 6) với `COUNT(*)` theo đúng phạm vi ở §6-B7, chỉ trong công ty của spec; gọi ở cuối spec race, xoá mềm, fuzz. Chính helper có ca tự-kiểm (làm lệch một cột ⇒ helper PHẢI báo) |
| D8  | K7 | Một bài duy nhất đi qua 6 bề mặt với cặp assert «THẤY trước» → «KHÔNG thấy sau»; thêm vòng ẩn (006) và khôi phục (058). «Tag» theo O3, «widget» theo O1 |
| D9  | K8 (sửa) | Sinh nhật đúng K8. Poll: bộ dò danh tính quét MỌI bề mặt người khác đọc được; vế đối chứng đổi cách (§0.3) |
| D10 | K9 | Hai spec riêng: `-idor` (cùng công ty) và `-cross-tenant` (bảng điều khiển trên mọi route nhận id + route danh sách) |
| D11 | K10 | Bộ sinh `mulberry32` hạt giống cố định (khuôn `T/s15-payroll-qa1-formula.int-spec.ts:99-140`), ≤ 260 request, `mapLimit` 4. Lớp ký tự điều khiển của nghi vấn S2 tách thành ca riêng QA1-F-1 (ngoài corpus) để một nghi vấn không nhuộm đỏ cả bất biến «không 5xx» |
| D12 | K11 | Giao thức lỗi sản phẩm ở §5. Builder KHÔNG sửa `src/` — trừ `S/social-error-code-census.spec.ts` (file test đặt cạnh nguồn) ở L5 |
| D13 | K12 | Ngân sách < 5 phút cộng dồn: mỗi file MỘT app ở `beforeAll`; dự kiến ≈ 2.000 request. Kit có HÀNG RÀO cặp quyền: chỉ nhận key thuộc 15 cặp `feed*` literal + danh sách cho phép ngoài feed (`view:chat-room` · `view:foundation-file` · `download:foundation-file`), key lạ ⇒ ném TRƯỚC khi chạm catalog (pin 15 cặp ở `T/s16-social-db1-invariants.int-spec.ts:923-928`). Cấm wildcard mang resource `feed*`; cấm sửa `role_permissions` của vai hệ thống |
| D14 | K13 (sửa) | `test:cov:social` thêm 15 int-spec cũ còn thiếu + mọi spec mới (bước Z). Chỉ số «≥ 85 %» = dòng «All files · % Stmts» của script chạy có `LANE_DB`; nền đã 98,16 % ⇒ KHÔNG có «lát bù coverage», khoảng trống thật được lấp bằng ca theo route / mã (§2). Không thêm ngưỡng mới (`apps/api/vitest.config.ts` ngoài `paths`) |
| D15 | K14 | Một PR; không migration; không dependency; không chạm FE |
| D16 | K15 | Mutant ★ ghi ở từng lát (§4); hoàn tác bằng `cp` bản sao lưu; đỏ phải khớp THÔNG ĐIỆP kỳ vọng |
| D17 | K17 | Nợ đã có WO: ca ghim hành vi hiện tại + chú thích mã WO (danh sách ở §5.3) |
| D18 | K18 | Tài liệu theo §8. QA-02: theo tiền lệ CHAT (`docs/QA/QA-02_Test_Case_Matrix_theo_module.md:68-85`) + một mục «Ma trận SOCIAL» GỌN theo nhóm; bảng 59 route × vai nằm ở file evidence (không nhân bản — CLAUDE.md §1) |
| D19 | — | Thêm cột 401 (không token) cho cả 59 route — QA-05 §19 mục 3; một `it.each`, gần như miễn phí |
| D20 | — | Vai đưa vào ma trận: `employee` · `manager` · `hr` · `company-admin` (đủ 59 route, mỗi vai một lát dữ liệu riêng) · `payroll-officer` · `recruiter` (đủ 59 route, đều 403) · `asset-manager` · `office-admin` · `hr-manager` (0 cặp feed ở cả seed 0578/0590 lẫn permission-matrix-spec ⇒ đều 403) · hai tổ hợp `payroll-officer + employee`, `recruiter + employee` (phải BẰNG cột employee — đúng nghĩa «không thêm gì»). Gắn vai bằng `SELECT … company_id IS NULL` + `seedUserRole` (khuôn `T/s15-payroll-qa1-roles.int-spec.ts:164-174`). `super-admin` không vào ma trận (không phải vai canonical; `*:*` đã có ca ở `T/social-be1b-reports.int-spec.ts:533`) |
| D21 | — | «WS payload = DTO» đọc theo hợp đồng thật: WS HẸP HƠN DTO REST, không bao giờ rộng hơn (`packages/contracts/src/realtime.ts:328`). Đo trên DÂY bằng socket thật. Thước CHÍNH = TẬP KHOÁ của payload (cả các object lồng `author` · `attachments[]` · `reactions[]`) đúng-BẰNG một bảng literal viết tay từ API-19 §6.1 + §7 (`feed:reaction.changed` = đúng 5 khoá §7 liệt kê) — khoá mới lọt vào schema mà chưa vào bảng ⇒ ĐỎ. Parse lại bằng schema WS strict chỉ là kiểm PHỤ: emitter đã `.parse()` bằng chính schema đó rồi mới phát (`apps/api/src/realtime/realtime-emitter.service.ts:633-634, 650, 659`) nên vế này không thể đỏ. Khoá API-19 không liệt kê tường minh ⇒ builder ghim theo payload quan sát được và GHI danh sách đó vào kết quả lát (không lặng lẽ coi là nguồn). Giá trị khoá chung với DTO REST bằng nhau; khoá theo-người-xem vắng mặt |
| D23 | — (kho public) | Lỗi / nghi vấn vùng đỏ (quyền · IDOR · PII · chéo công ty · hiển thị O3–O6) CHƯA vá thì KHÔNG commit ca tái lập, kể cả ở dạng `it.fails` hay ca «ghim»: builder viết ca vào thư mục ngoài kho (`…/scratchpad/qa1/held/`), chép vào `T/` để CHẠY, xoá bản chép trước khi commit (cây sạch), trả số đo cho phiên điều phối. Ca chỉ vào kho khi (i) owner xác nhận đó là THIẾT KẾ, hoặc (ii) đi CÙNG bản vá trong PR này, hoặc (iii) bản vá của WO kế đã deploy. Plan · tên ca · commit message · evidence chỉ ghi mã + một dòng trung tính |
| D22 | — | «Vote đôi» tuần tự = ĐỔI phiếu (200, đúng 1 hàng phiếu) theo SPEC-16 :384 và 3 spec đã ghim; 409 `ERR-017` chỉ khi gửi > 1 lựa chọn cho poll một-lựa-chọn. Câu chữ ERR-017 ở SPEC-16 §12 lệch ⇒ nợ DOC-2. Không ghim `status` của 043 cho poll quá hạn mà job chưa đóng |

### 0.3 K bị bác / sửa (kèm bằng chứng)

- **K1 «MỘT file helper»** ⇒ hai file (+ hai file phụ khai trước ở D1). Bảng 59 route + lát dữ liệu ≈ 650 dòng, cộng kit ≈ 450 dòng vượt trần 800 dòng/file (CLAUDE.md §5); tiền lệ: riêng bảng route của S15 đã 708 dòng cho 50 route (`H/payroll-qa1-routes.ts`).
- **K8 vế «poll KHÔNG ẩn danh thì danh tính CÓ xuất hiện»** ⇒ không dựng được: API không trả danh tính cử tri ở BẤT KỲ poll nào, kể cả `isAnonymous:false` (`S/social-polls.service.ts:389-395`; không có route danh sách cử tri; đã ghim ở `T/social-be2b1-polls-counters.int-spec.ts:326-327`). Thay bằng: (1) neo dương «phiếu ĐÃ ghi» (người đọc khác thấy `totalVoters = 1`); (2) tự-kiểm bộ dò: cùng hàm dò áp lên thẻ bài do chính cử tri đăng PHẢI tìm thấy `employeeId` của họ.
- **K13 «ĐỦ mọi int-spec»** ⇒ trừ `T/s16-filedisposition-storage.int-spec.ts`: cụm MinIO trên máy thi công là của PROD, và khi `S3_BUCKET` mang ĐÚNG tên cho phép thì file này dò rồi TỰ TẠO bucket đó nếu chưa có (`T/s16-filedisposition-storage.int-spec.ts:193, 204`) và ghi object thật; tên không khớp thì S1–S6 bỏ qua có cảnh báo, chỉ còn S7/S8 ký ngoại tuyến (`:21-26, 396`). WO này không chạm storage, và file gần như không thêm coverage `src/social` ⇒ không đưa vào script.

## 1. Phạm vi · không-làm · ngoại lệ

**Làm:** 12 int-spec mới + 2 helper (+ tối đa 2 helper phụ, D1) (§4; ước ≈ 5.300 dòng, ≈ 850 dòng `it` — phần lớn là hàng `it.each` một request — ≈ 2.000 request) · nâng assert `error.code` tại chỗ ở ≤ 9 int-spec cũ (L5) · tầng D của census mã lỗi · vá lỗi sản phẩm lộ ra theo §5 (pha riêng của phiên điều phối) · tài liệu §8.

**Không làm:** FE · migration · dependency · chuyển 18 int-spec dựng tay sang `applyMainPipeline` (ratchet 269 giữ nguyên) · sửa `docs/spec/**`, `docs/API Design/**`, `packages/contracts/**` (ngoài `paths`) · ca «chặn người dùng» (module không có tính năng này: grep `feed_user_blocks|blockedUser|mute` trên `S/` = 0) · widget DASH (O1) · vá O3–O6 khi owner chưa trả lời · vá lỗi có gốc ngoài `S/` (O8) · commit ca tái lập của nghi vấn vùng đỏ chưa vá (D23).

**Ngoại lệ phạm vi** (ngoài `paths` của WO, `harness/backlog.mjs:19389-19397`): `apps/api/package.json` (chỉ dòng `test:cov:social`, bước Z — tiền lệ S13/S15 có file này trong `paths`; bước Z bổ sung nó vào `paths` của WO). Bản vá sản phẩm nếu rơi vào `apps/api/src/recycle-bin/**` (controller 057/058) cũng là ngoại lệ — phải nêu trong PR. Mọi file gốc KHÁC ngoài `S/` (bộ lọc lỗi toàn cục, `src/notifications/**`, …) KHÔNG phải ngoại lệ: theo O8, mặc định không vá trong WO.

## 2. Sự thật đã đo

| Điều | Giá trị | Nguồn |
| ---- | ------- | ----- |
| Route HTTP SOCIAL | **59** (57 dưới `/social`, 2 dưới `/recycle-bin/feed-posts`) = 59 mã API-19 = số ghim census (`apps/api/test/foundation/social-two-layer-guard-census.unit-spec.ts:512`) | U1 |
| Cặp quyền `feed*` | **15** (14 ở mig 0578 + `restore:feed-post` ở mig 0590), đều không nhạy cảm; 12 cặp có route gác ở decorator (42 route `view:feed` + 17 route khác) | U1 · tự đếm |
| Grant vai hệ thống | 45 = employee 7 · manager 8 · hr 15 · company-admin 15; duy nhất một grant hẹp hơn Company: manager `view:feed-report` @Department; 5 vai còn lại 0 cặp | U1 · U2b |
| Route không sàn Company | 3 (028 · 052 · 053) | U1 |
| Mã lỗi | 57 khoá → 51 mã trên dây (22 số + 29 sentinel); 55 khoá được ném; chỉ 12 có ca HTTP assert `error.code`; 27 assert thông điệp; 9 chỉ chuỗi số; 3 chỉ status; 4 không ca HTTP | U3 |
| Test hiện có | 34 int-spec (≈ 712 `it(` đếm tĩnh) + 30 spec unit cạnh nguồn; lượt nền 66 file · 1.366 ca · 0 đỏ · 0 skip · 62–81 s | U2a · U2b · U6 |
| Vai canonical qua HTTP | **0/34** int-spec đăng nhập bằng vai hệ thống | U1 · U2a · U2b |
| Coverage nền `src/social/**` | statements 98,16 · branches 90,75 · functions 99,31 · lines 98,16 (đã vượt 85 % trước khi viết ca nào) | U6 |
| Lỗ mà coverage che | route 019 chưa có ca BE nào tới handler; `feed?tag=`, `sort=latest`, sinh nhật `range=week`, sửa bài bỏ hashtag, `POLL_WRITE_BUSY` đều 0 lượt chạy | U6 |
| Dựng app | 18/34 int-spec dựng pipeline TAY (không `ZodValidationPipe`); ratchet `HAND_ROLLED_BASELINE = 269` | U4 |
| `test:cov:social` | chỉ ĐO, không cổng nào gọi; thiếu 16/34 int-spec | U4 · U6 |
| Mã thành công | `@HttpCode(200)` chỉ ở 054 · 055 (`S/social-files.controller.ts:65,80`) và 058 (`apps/api/src/recycle-bin/recycle-bin-feed-posts.controller.ts:61`); POST khác = 201. API-19 §5.1 chỉ nêu status cho 058 | tự đo |
| Dấu vân con trỏ feed | gồm `sort · type · audience · status · authorUserId · orgUnitId · tag · groupId · canManagePosts · orgUnitIds` (`S/social-posts.service.ts:870-885`) ⇒ đổi `type` hoặc `sort` là kích được `CURSOR_FILTER_MISMATCH` | tự đo |
| Khoá hàng trên đường đua | 035/036 khoá hàng nhóm trước (`S/social-groups.service.ts:269, 312`); 041/042 khoá hàng poll, `lock_timeout` 3 s; cảm xúc / lượt xem cộng cột trên hàng bài ⇒ cả ba dùng được harness giữ khoá | U5a · tự đo |
| Lệch tài liệu ↔ code | đề WO «53 route · 14 cặp» (nay 59 · 15) · SPEC-16 §12: 006/008 = 422 (thật 400), «22 mã» (thật 51) · API-19 ghi `AUTH-ERR-SCOPE-DENIED` như MÃ (thật là tiền tố message, `error.code` = `AUTH-ERR-FORBIDDEN`) · SPEC-16 §13.6 «6 cột đếm» (code 7) · tiêu đề WO «WS payload = DTO» (hợp đồng: hẹp hơn) · QA-02 :64 còn ghi SOCIAL «Coming Soon» | U1 · U3 · U4 · U5a |

## 3. Ma trận lỗ hổng

**Quy ước mã ca mới.** Mọi route có sẵn bốn ca nền, KHÔNG lặp lại trong bảng: `QA1-M-A-<mã>` (đủ 15 cặp ⇒ đúng mã `ok`, L1) · `QA1-M-U-<mã>` (không token ⇒ 401, L1) · `QA1-M-F-<mã>` (đủ cặp nhưng @Department ⇒ 403 sàn scope; 046 ⇒ `SOCIAL-ERR-020`; 028 · 052 · 053 ⇒ 200, L1) · `QA1-M-R-<vai>-<mã>` (vai canonical, L2). «M-P» = `QA1-M-P-<cặp>`: thiếu ĐÚNG cặp decorator của route ⇒ 403 tầng 1 (L1). M-T = cặp kiểm ở tầng 2 (L2) · M-S = scope của manager (L2) · I-… = IDOR (L3) · T-… = chéo công ty (L4).

**Ca đã có** (theo bản đồ U2a/U2b — đọc code, chưa chạy lại từng ca): `tên:dòng` với tên file rút gọn, đường dẫn `T/social-<tên>.int-spec.ts`: scp=be1-scope · vis=be1-visibility · cnt=be1-content · att=be1-attachments · dsc=be1b-discovery · nws=be1b-news · rp1=be1b-reports · door=be1c-file-door · men=be1d-mentions · fg=be2a-feed-group · mem=be2a-group-members · grp=be2a-groups · ag=attgate-1-update-attach · av=avatarpresign-1 · pol=be2b1-polls · pcn=be2b1-polls-counters · pis=be2b1-polls-isolation · ide=be2b2-ideas · kud=be2b2-kudos · rms=be2c-group-rooms · blk=be2d-blocks-recipients · kbd=be3a-kudos-badges · rp3=be3a-report-actions · sts=be3b-engagement-stats · rcl=be3c-recycle-list · rcr=be3c-recycle-restore · ger=grouperr1-wire-codes · toc=grouptoctou-race. Hậu tố `y` = ca yếu, coi như chưa có (D4). «→» = ca mới sẽ viết.

### Bảng 1 — route × bốn loại ca

| Mã  | Route | Cặp tầng 1 | allow (đã có) | deny-cặp | deny-scope / IDOR | chéo công ty |
| --- | ----- | ---------- | ------------- | -------- | ----------------- | ------------ |
| 001 | GET /social/feed | view:feed | scp:185 | scp:192y → M-P | vis:318 · fg:217 · scp:422y → I-L-1 | scp:477y → T-L-001 |
| 002 | POST /social/posts | create:feed-post | scp:204 | ag:442 · scp:198y → M-P; theo loại bài: scp:224 · pis:251 · ide:314 · kud:390,526 → M-T-1…5 | vis:307 · vis:335 · att:169 → I-G-7 | kud:432,508 → T-B-1…6 |
| 003 | GET /social/posts/{id} | view:feed | scp:471 | → M-P | vis:226 · vis:280 · rcr:851 · vis:253y · men:359y → I-P-003 | scp:466y → T-003 |
| 004 | PATCH /social/posts/{id} | view:feed | vis:364 | ag:258 (gắn tệp) → M-P | vis:350 · scp:432 → I-P-004 · I-O-1 | → T-004 |
| 005 | DELETE /social/posts/{id} | view:feed | cnt:760 · vis:396 | → M-P | scp:440y → I-P-005 · I-O-2 | → T-005 |
| 006 | PATCH /social/posts/{id}/moderation | manage:feed-post | scp:267,275 | scp:289 · scp:257y → M-P · M-T-6,7 | scp:445y → I-P-006 (ô «bài ẩn» là ca ALLOW — scp:267,275) | → T-006 |
| 007 | POST /social/posts/{id}/view | view:feed | cnt:677 | → M-P | → I-P-007 | → T-007 |
| 008 | POST /social/posts/{id}/save | view:feed | cnt:1003 | → M-P | cnt:1055y → I-P-008 | → T-008 |
| 009 | DELETE /social/posts/{id}/save | view:feed | cnt:1045 | → M-P | → I-P-009 | → T-009 |
| 010 | GET /social/saved | view:feed | cnt:1007 · fg:228 | → M-P | cnt:1011 → I-L-2 | → T-L-010 |
| 011 | PUT /social/posts/{id}/reaction | view:feed | vis:449 | → M-P | vis:423 · vis:437 → I-P-011 | vis:410 · scp:484y → T-011 |
| 012 | DELETE /social/posts/{id}/reaction | view:feed | cnt:659 | → M-P | → I-P-012 | → T-012 |
| 013 | GET /social/posts/{id}/reactions | view:feed | cnt:1090 | → M-P | cnt:1104y → I-P-013 | → T-013 |
| 014 | GET /social/posts/{id}/comments | view:feed | men:383 · av:155 | → M-P | → I-P-014 | → T-014 |
| 015 | POST /social/posts/{id}/comments | create:feed-comment | scp:215 | ag:454 · scp:209y → M-P | vis:471y · cnt:184y → I-P-015 · I-C-5 | → T-015 · T-B-7 |
| 016 | PATCH /social/comments/{id} | view:feed | cnt:604 | ag:273 (gắn tệp) → M-P | att:466 → I-C-016 · I-O-3 | → T-016 |
| 017 | DELETE /social/comments/{id} | view:feed | cnt:732 | → M-P | vis:371y → I-C-017 · I-O-4 | → T-017 |
| 018 | PUT /social/comments/{id}/reaction | view:feed | cnt:729 · vis:556 | → M-P | → I-C-018 | → T-018 |
| 019 | DELETE /social/comments/{id}/reaction | view:feed | **0 ca BE** → M-A-019 | → M-P | → I-C-019 | → T-019 |
| 020 | GET /social/news | view:feed | nws:205 | nws:214y → M-P | nws:356 → I-L-3 | → T-L-020 |
| 021 | POST /social/posts/{id}/ack | view:feed | nws:371 | → M-P | nws:464 · nws:403y → I-P-021 · I-A-1…3 | → T-021 |
| 022 | GET /social/posts/{id}/acks | manage:feed-news | nws:479 | nws:476y → M-P | nws:536 → I-P-022 | → T-022 |
| 023 | GET /social/search | view:feed | dsc:246 | dsc:233y → M-P | dsc:246-255 | dsc:255 → T-L-023 |
| 024 | GET /social/tags | view:feed | dsc:286 | dsc:295y → M-P | n/a theo thiết kế (O3) → I-L-4 | dsc:309 → T-L-024 |
| 025 | GET /social/profiles/{eid}/posts | view:feed | dsc:327 | → M-P | dsc:333 | dsc:356 → T-025 |
| 026 | GET /social/birthdays | view:feed | dsc:386 | dsc:374y → M-P | n/a (preference ⇒ P-B) | dsc:451 → T-L-026 |
| 027 | POST /social/reports | view:feed | rp1:246 | → M-P | rp1:282 | rp1:270 → T-B-8 |
| 028 | GET /social/reports | view:feed-report | rp1:338 | rp1:347y → M-P | rp1:372-419 · rp1:433 → M-S-1 | rp1:360 → T-L-028 |
| 029 | PATCH /social/reports/{id} | manage:feed-report | rp1:523 | rp3:252 · rp1:354y → M-P · M-T-8 | rp1:505 · rp3:336 | → T-029 |
| 030 | GET /social/groups | view:feed | grp:168 | → M-P | grp:183 | → T-L-030 |
| 031 | POST /social/groups | create:feed-group | grp:268 | → M-P | n/a | n/a (không nhận id) |
| 032 | GET /social/groups/{id} | view:feed | grp:254 | → M-P | grp:261 · rms:444 → I-G-1 | → T-032 |
| 033 | PATCH /social/groups/{id} | view:feed | grp:304 | → M-P · M-T-9 | toc:585,634 → I-G-2 | → T-033 |
| 034 | DELETE /social/groups/{id} | view:feed | grp:332 | → M-P · M-T-9 | grp:328 · toc:561 → I-G-2 | → T-034 |
| 035 | POST /social/groups/{id}/join | view:feed | mem:182 | → M-P | grp:428y → I-G-5 `[O4]` | → T-035 |
| 036 | POST /social/groups/{id}/leave | view:feed | mem:207 | → M-P | mem:211y → I-G-6 `[O4]` | → T-036 |
| 037 | GET /social/groups/{id}/members | view:feed | grp:394 | → M-P · M-T-9 | grp:401y · grp:404y → I-G-3 | → T-037 |
| 038 | PATCH /social/groups/{id}/members/{uid} | view:feed | mem:259 | → M-P · M-T-9 | mem:251 · mem:579 · toc:608 → I-G-4 | → T-038 |
| 039 | DELETE /social/groups/{id}/members/{uid} | view:feed | mem:283 | → M-P · M-T-9 | ger:205 · toc D-1/D-2 → I-G-4 | → T-039 |
| 040 | GET /social/polls | view:feed | pol:415 · pis:275 | → M-P | pis:288-291 | pis:347-350 → T-L-040 |
| 041 | PUT /social/posts/{id}/poll/vote | view:feed | pol:225 · pcn:171 | → M-P | pis:297 · vote đôi / poll đóng ĐÃ CÓ: pol:300,326,349 · pcn:240 → I-P-041 | pis:338y → T-041 · T-B-9 |
| 042 | DELETE /social/posts/{id}/poll/vote | view:feed | pol:263 | → M-P | pis:300 → I-P-042 | pis:341y → T-042 |
| 043 | GET /social/posts/{id}/poll/results | view:feed | pol:396 | → M-P | pis:296 → I-P-043 | pis:337y → T-043 |
| 044 | POST /social/posts/{id}/poll/close | view:feed | pol:298,440 | → M-P | pis:301 · pol:435y → I-P-044 · I-O-5 | pis:342y → T-044 |
| 045 | GET /social/ideas | view:feed | ide:643 | → M-P | ide:639-660 · ide:690-720 | → T-L-045 |
| 046 | PATCH /social/posts/{id}/idea/review | approve:feed-idea | ide:382 | ide:370 · ger:335 → M-P | ide:391 · ger:322 · ide:569 → I-P-046 | ide:591y → T-046 |
| 047 | GET /social/kudos | view:feed | kud:276 · av:216 | → M-P | kud:678-697 | → T-L-047 |
| 048 | GET /social/kudos-badges | view:feed | kud:837 · kbd:197 | → M-P | n/a | kud:853-860 → T-L-048 |
| 049 | POST /social/kudos-badges | manage:feed-kudos | kbd:203 | kbd:244y → M-P | n/a | n/a (không nhận id; kbd:323) |
| 050 | PATCH /social/kudos-badges/{id} | manage:feed-kudos | kbd:397 | kbd:246y → M-P | n/a | kbd:272 → T-050 |
| 051 | DELETE /social/kudos-badges/{id} | manage:feed-kudos | kbd:432 | kbd:250y → M-P | n/a | kbd:278 → T-051 |
| 052 | GET /social/stats/engagement | view:feed-report | sts:417 | sts:426y → M-P | sts:454,480,492 → M-S-2 | sts:504 → T-052 |
| 053 | GET /social/stats/engagement/export | view:feed-report | sts:466 | sts:436y → M-P | sts:454 → M-S-3 | → T-053 |
| 054 | POST /social/files/upload-url | view:feed | door:204 | door:233,246 · door:269y → M-P · M-T-10 | n/a | n/a (không nhận id) |
| 055 | POST /social/files/{id}/confirm | view:feed | door:306 | door:314 → M-P · M-T-10 | door:294 | → T-055 |
| 056 | GET /social/kudos-badges/manage | manage:feed-kudos | kbd:191 | kbd:252y → M-P | n/a | → T-L-056 |
| 057 | GET /recycle-bin/feed-posts | restore:feed-post | rcl:344 · rcr:463 | rcr:453y → M-P | rcr:475,545 | rcr:576 → T-L-057 |
| 058 | POST /recycle-bin/feed-posts/{id}/restore | restore:feed-post | rcr:466 | rcr:455y → M-P | rcr:479,549 | rcr:566 → T-058 |
| 059 | GET /social/kudos/recipients | create:feed-kudos | blk:711 · av:227 | blk:709y → M-P | blk:723 | blk:765 → T-L-059 |

**Kỳ vọng theo vai** (bảng tay của L2, ghép permission-matrix-spec × API-19 §5.1; mỗi vai thao tác trên dữ liệu của CHÍNH mình): `employee` cho phép ở 46 route (42 route `view:feed` + 002 · 015 · 031 · 059), từ chối tầng 1 ở 13 route (006 · 022 · 028 · 029 · 046 · 049 · 050 · 051 · 052 · 053 · 056 · 057 · 058) · `manager` = employee + 028 · 052 · 053 (49 cho phép / 10 từ chối) · `hr` = `company-admin` = cho phép cả 59 · năm vai 0-cặp = từ chối tầng 1 cả 59 · hai tổ hợp «+ employee» = đúng cột employee.

### Bảng 2 — mã lỗi → ca theo MÃ qua HTTP

| Nhóm | Khoá `SOCIAL_ERR` | Việc |
| ---- | ----------------- | ---- |
| A · đã assert `error.code` (12) | POST_NOT_FOUND · REPLY_DEPTH · GROUP_NOT_FOUND · GROUP_MEMBERSHIP_EXISTS · GROUP_ROLE_REQUIRED · GROUP_LAST_OWNER · GROUP_NAME_TAKEN · GROUP_MEMBER_NOT_FOUND · POLL_CREATE_REQUIRED · IDEA_APPROVE_REQUIRED · CURSOR_INVALID · PIN_NEWS_ONLY | trích `ger` W1–W12 (`T/social-grouperr1-wire-codes.int-spec.ts:190-329`); không viết lại |
| B · mới assert thông điệp (27) | FILE_TARGET_POST_DENIED · FILE_TARGET_COMMENT_DENIED · FILE_NOT_OWNED (door) · GROUP_MEMBER_STATE_MISMATCH (mem:307) · POLL_CLOSED · POLL_VOTE_DUPLICATE · POLL_OPTIONS_RANGE · POLL_OPTION_NOT_FOUND · POLL_CLOSES_AT_PAST (pol) · IDEA_TRANSITION · IDEA_CREATE_REQUIRED · IDEA_REJECT_NOTE_REQUIRED (ide) · KUDOS_CREATE_REQUIRED · KUDOS_BADGE_INVALID · KUDOS_SELF_RECIPIENT · KUDOS_RECIPIENT_LIMIT · KUDOS_RECIPIENT_INVALID · KUDOS_OFFICIAL_DENIED (kud) · REPORT_ACTION_DENIED · REPORT_ACTION_INVALID_FOR_TARGET · REPORT_ACTION_TARGET_UNAVAILABLE · REPORT_BUSY · REPORT_ALREADY_DECIDED (rp3) · KUDOS_BADGE_CODE_TAKEN · KUDOS_BADGE_NOT_FOUND (kbd) · STATS_UNIT_OUT_OF_SCOPE (sts) · RESTORE_GROUP_DELETED (rcr) | QA1-E-U-01…27: NÂNG TẠI CHỖ — thêm `expect(res.body.error?.code).toBe(SOCIAL_ERROR_CODES.<KHOÁ>)` vào đúng MỘT ca đang có của mỗi khoá (≤ 9 file cũ; không đổi fixture, không đổi khâu boot) |
| C · chuỗi số / chỉ status / chưa có ca (13) | WRITE_OUT_OF_AUDIENCE (2 nhánh: đơn vị khác · nhóm mà chưa là thành viên active) · NOT_CONTENT_OWNER · COMMENTS_LOCKED · ATTACHMENT_LIMIT (11 ảnh · 2 video · > 20 MB) · ATTACHMENT_INVALID (tệp người khác · tệp không tồn tại) · NEWS_MANAGE_REQUIRED · MODERATION_FIELD_DENIED (2 nhánh: 006 · `feed?status=hidden`) · ACK_NOT_APPLICABLE · REPORT_NOT_FOUND · COMMENT_NOT_FOUND (id lạ · cha thuộc bài khác) · REPORT_DUPLICATE_OPEN · POLL_WRITE_BUSY · CURSOR_FILTER_MISMATCH | QA1-E-01…13 (đánh số theo thứ tự liệt kê) ca MỚI bằng `expectSocial` (code + message — message là thứ tách các khoá chung số 001 · 007 · 010 · 013); hai khoá được ca của lát TRƯỚC gánh (mục `CODE_CASES` trỏ `{file, anchor}`): NOT_CONTENT_OWNER ← I-O-1 (L3), NEWS_MANAGE_REQUIRED ← M-T-1 (L2). POLL_WRITE_BUSY có ca RIÊNG ngay ở L5 (QA1-E-12: giữ khoá hàng poll quá `lock_timeout` ⇒ 409 theo MÃ, 0 hàng phiếu; nhả khoá ⇒ cùng request 200) — không được trỏ sang lát sau, vì tầng D bật ở L5 |
| D · không tới được qua HTTP (3) | REACTION_EMOJI_INVALID (006) · AUDIENCE_KEY_MISSING (008) · POST_TYPE_PAIR_DESYNC | `HTTP_UNREACHABLE` kèm lý do; QA1-E-X1/X2 ghim ĐÚNG 400 `VALIDATION-ERR-001` + `details[].field` + 0 hàng ghi; 006 thêm QA1-E-X5: gọi THẲNG service thật qua `app.get(SocialReactionsService)` (không mock, không qua pipe) ⇒ ném 422 mang đúng mã (008 đã có ca unit `S/social-access.service.spec.ts:263`) — theo O2 |
| E · không bao giờ ném (2) | AUDIENCE_GROUP_NOT_AVAILABLE · MENTION_DROPPED_NOT_AN_ERROR | giữ trong `NEVER_THROWN` của census; 009 kiểm bằng ca 201 + `droppedMentions[]` (F-M) |
| F · mã ngoài SOCIAL trên route SOCIAL | `AUTH-ERR-UNAUTHENTICATED` (M-U) · `AUTH-ERR-FORBIDDEN` (M-P, M-F) · `VALIDATION-ERR-001` (X1, X2; id không phải UUID — ger W13b) · `RESOURCE-ERR-NOT-FOUND` của 055 (T-055) · idempotency: cùng khoá khác thân ⇒ 409 theo MÃ (QA1-E-X4) · thân quá cỡ (QA1-E-X3, nghi vấn S3: tài liệu đòi 4xx; nếu code lệch thì gốc nằm ngoài `S/` ⇒ xử theo O8, không `it.fails`) | ca mới như ghi |

Ratchet: `Object.keys(CODE_CASES)` == `Object.keys(SOCIAL_ERROR_CODES)` (57; kiểu `Record` làm thiếu khoá thành lỗi typecheck) + ca neo `{file, anchor}` + tầng D tĩnh (D6). Sentinel 404: QA1-E-14 so THÂN phản hồi (bỏ `meta`) giữa bốn nguồn «id bịa · công ty khác · đã xoá mềm · đang ẩn» ⇒ bằng nhau.

### Bảng 3 — các cụm còn lại của tiêu đề WO

| Mã ca | Assert chính | Vế đối chứng chống xanh-rỗng |
| ----- | ------------ | ---------------------------- |
| **PII sinh nhật** P-B1 | (`today` / `month` với regex năm ĐÃ CÓ `dsc:386-410` ⇒ trích) ca MỚI với NĂM ĐẶC TRƯNG trên 026 `range=week·month`: mỗi dòng đúng 5 khoá; chuỗi hoá TOÀN thân rồi bỏ UUID + mốc ISO ⇒ không chứa năm sinh đặc trưng của fixture, không chứa ngày đầy đủ, không có khoá `dateOfBirth`/`userId` | người đó CÓ MẶT với đúng `day`/`month`; bộ dò tự-kiểm trên một object cố ý chứa ngày sinh đầy đủ PHẢI báo |
| P-B2 | `range=week` (0 ca hôm nay): ngày sinh hôm nay + 3 có mặt, hôm nay + 8 vắng. Offset tính bằng MỘT hàm thuần `birthdayAt(today, +n)` (giờ cục bộ; trả `{day, month}`; né 29/02 bằng cách dịch thêm 1 ngày cho CẢ hai mốc) có ca tự-kiểm với mốc cố định: 28/12 (vắt năm) · 29/01 (vắt tháng) · 26/02 năm nhuận và năm thường | đổi ngày sinh của người «+ 8» về «+ 3» ⇒ có mặt (không dựa vào `range=month` — vế đó phụ thuộc ngày chạy) |
| P-B3 | ẩn theo preference ĐÃ CÓ và đáng tin (`dsc:464-502`, có neo dương) ⇒ TRÍCH; ca mới chỉ thêm vế «chưa có hàng preference ⇒ có mặt» | một người khác vẫn có mặt trong CÙNG response |
| P-B4 | `resigned` ĐÃ CÓ (`dsc:423-448`) ⇒ trích; ca mới: `terminated` ⇒ vắng | trước khi đổi trạng thái: có mặt |
| P-B5 | người có tài khoản bị khoá: ghim hiện trạng (dòng còn, tên + ảnh `null`) — nợ `S16-SOCIAL-BDAYMASKED-1` | — (ca ghim nợ, có chú thích mã WO) |
| **PII poll** P-V1 | (riêng 043 ĐÃ CÓ `pol:395-403` · `pcn:326-327` ⇒ trích) ca MỚI mở rộng ra MỌI bề mặt: poll `isAnonymous:true`, cử tri V bỏ phiếu; người đọc R gọi 043 · 003 · 001 · 040 · 041 · 042 ⇒ chuỗi hoá từng thân không chứa `userId` / `employeeId` của V, không có khoá `voters` / `userId`. Ở route DANH SÁCH (001 · 040) chỉ chuỗi hoá ĐÚNG thẻ của bài poll (tìm theo `postId`), không cả thân. Fixture: V KHÔNG là tác giả / người bình luận / người được nhắc ở bài poll; bài tự-kiểm của V được tạo SAU mọi lượt đọc của R | R thấy `totalVoters = 1` và `voteCount = 1`; bộ dò áp lên thẻ bài do V đăng (tạo sau cùng) PHẢI thấy `employeeId` của V |
| P-V2 | như P-V1 với `isAnonymous:false` và người đọc là company-admin canonical ⇒ vẫn không có danh tính | như trên |
| P-V3 | (payload outbox của sự kiện đóng poll ĐÃ CÓ `pis:511-516` ⇒ trích) mới: sau 041 · 042 · 044 spy `emitFeed*` 0 lần mang id của V; `audit_logs` không có hàng nào của V gắn bài đó | neo dương: 044 CÓ đúng 1 hàng audit của người đóng; một sự kiện WS khác (bình luận) phát SAU vẫn tới |
| **Race** R-0 | tự-kiểm harness: `waitForBlockedBy` chỉ trả `true` khi có đúng N phiên bị chính holder chặn; lượt đối chứng không giữ khoá cho cùng kết quả cuối | — |
| R-1 | 5 người khác nhau thả cảm xúc cùng một bài dưới khoá hàng bài ⇒ 5 × 200; cột `like_count` (đọc từ DB) == `COUNT` == 5 | đọc CỘT, không đọc `likeCount` của response (response là COUNT thật) |
| R-2 | CÙNG một người, 2 request cùng emoji ⇒ 200 + 200, đúng 1 hàng, cột +1 | trước đó cột = 0 |
| R-3 | 5 người thả cảm xúc cùng một BÌNH LUẬN ⇒ `feed_comments.like_count` == COUNT == 5 | — |
| R-4 | cùng người xem 2 lần đồng thời ⇒ `view_count` +1; lượt hai KHÔNG có khoá `viewCount` | lượt đầu có khoá |
| R-5 | poll một-lựa-chọn: **3** cử tri (đã hâm nóng — D7), mỗi người một lựa chọn bất kỳ, dưới khoá hàng poll (nhả ≤ 1,5 s) ⇒ 3 × 200; TỪNG lựa chọn `vote_count` == COUNT; Σ == 3 | so từng lựa chọn, không chỉ Σ |
| R-6 | CÙNG cử tri, 2 request hai lựa chọn khác nhau ⇒ mọi status < 500, cuối cùng đúng 1 hàng phiếu, đối soát rỗng | — |
| R-7 | (đã có ở L5 — QA1-E-12 ⇒ TRÍCH, không viết lại) | — |
| R-8 | nhóm public: 5 người tham gia đồng thời dưới khoá hàng nhóm ⇒ 5 × 201; `member_count` == COUNT active == trước + 5 | — |
| R-9 | CÙNG người tham gia 2 lần đồng thời ⇒ đúng một 201 + một 409 `GROUP_MEMBERSHIP_EXISTS` theo MÃ; cột +1 | — |
| R-10 | nhóm kín: 3 yêu cầu đồng thời ⇒ 3 hàng `pending`, `member_count` KHÔNG đổi | sau khi duyệt 1 ⇒ +1 |
| R-11 | xoá cùng một bài 2 lần đồng thời ⇒ không 5xx; `usage_count` của thẻ −1 đúng MỘT lần | — |
| R-12 | cuối spec: `reconcileSocialCounters` ⇒ `[]` | L0 đã chứng minh helper báo được lệch |
| **Xoá mềm** S-1…S-6 | MỘT bài `news` + `requiresAck`, có từ khoá riêng + hashtag riêng, được người xem lưu / thích / bình luận. Sáu bề mặt: (1) feed 001 + chi tiết 003 · (2) đếm: `unackedCount` của 020 (cả dạng `countOnly=true`) · (3) tìm kiếm 023 · (4) tag: `feed?tag=` + `usageCount` ở 024 · (5) saved 010 · (6) widget theo O1 = hàng tuần của 052 + gọi thẳng hàm (KHÁC phép đo của (2) — sáu bề mặt là sáu phép đo rời nhau). Sau 005: cả sáu «không thấy / giảm đúng 1». Đã có rời rạc — trích, không lặp: thống kê sau xoá `sts:539-585` · danh sách 045 / 047 `ide:897-905` · `kud:753-761` | mỗi bề mặt có assert «THẤY / đếm = n» TRƯỚC khi xoá trên CHÍNH bài đó |
| S-7 | 014 · 008 · 011 · 021 trên bài đã xoá ⇒ 404 `SOCIAL-ERR-001` | trước khi xoá: đúng mã `ok` |
| S-8 | người kiểm duyệt xoá bài đang `published` → 058 ⇒ bài về `published`, sáu bề mặt thấy lại, counter đếm lại đúng | — |
| S-9 | TÁC GIẢ tự xoá → 058 ⇒ bài về `hidden`: tác giả + người có `manage:feed-post` thấy, đồng nghiệp KHÔNG | đồng nghiệp đó thấy bài ở S-8 |
| S-H | ẩn bài (006): người thường mất ở feed / tìm kiếm / saved / `feed?tag=` / `unackedCount`; `usageCount` KHÔNG đổi; thống kê vẫn tính | tác giả vẫn thấy ở cả các bề mặt đó |
| S-G | xoá NHÓM (034): thành viên khác tác giả mất bài nhóm ở `feed?groupId=` · 003 · 010 · 020; vế TÁC GIẢ `[O5]` — ca giữ ngoài kho (D23) | trước khi xoá nhóm: thấy |
| S-C | xoá bình luận (017): 014 hết trả, `comment_count` −1, cảm xúc của nó bị dọn | trước: có |
| S-X | cuối spec: đối soát counter ⇒ `[]` | — |
| **Fuzz** F-1 | thân bài chứa lớp ký tự điều khiển của nghi vấn S2 (ca RIÊNG; đầu vào cụ thể ở sổ ngoài kho) ⇒ kỳ vọng 4xx có hình dạng lỗi chuẩn; ca chỉ commit cùng bản vá (O7) | ca đối chứng: cùng thân bỏ ký tự đó ⇒ 201 |
| F-B | ≈ 80 thân bài sinh có hạt giống (emoji astral · ZWJ · RTL · NBSP · zero-width · HTML · 4000/4001 đơn vị · chỉ khoảng trắng) ⇒ luôn 201 hoặc 4xx chuẩn; bài 201 đọc lại ĐÚNG chuỗi đã gửi (sau `trim`) | assert chạm CẢ HAI nhánh: ≥ 1 ca 201 và ≥ 1 ca 400 |
| F-H | ≈ 60 thân chứa hashtag (hoa/thường · có dấu · 64/65 ký tự · 21 thẻ · `#a#b` · `abc#def` · fullwidth) ⇒ không 5xx; gửi cùng thân 2 lần cho cùng tập thẻ; sau mỗi mẻ đối soát `usage_count` rỗng; sửa bài A→B→A (004) và xoá ⇒ đối soát rỗng | ≥ 1 thẻ thật sự được tạo (`usageCount ≥ 1`) |
| F-M | ≈ 60 mảng `mentionedUserIds` (id bịa · của công ty B · tài khoản khoá · người đã nghỉ · chính mình · trùng lặp · 50/51 phần tử) ⇒ 201/400; id công ty B LUÔN nằm trong `droppedMentions`, 0 hàng `feed_mentions`, 0 sự kiện outbox cho người công ty B; response «id bịa» và «id công ty B» bằng nhau trừ chính id | ≥ 1 mention hợp lệ thật sự được ghi (1 hàng + 1 sự kiện) |
| F-E | ≈ 40 giá trị emoji cho 011/018 (ký tự emoji thật · sai hoa thường · rỗng · `null` · khoá thừa) ⇒ 6 giá trị hợp lệ 200, còn lại ĐÚNG 400; 0 hàng ghi khi 400 | cả hai nhánh đều được chạm |
| F-O6 | `[O6]` mention thêm vào bài không `published` — đo số sự kiện outbox; ca giữ ngoài kho (D23) | mention trên bài `published` ⇒ 1 sự kiện |
| **WS** W-1 | (bài NHÓM ĐÃ CÓ `T/social-be2c-group-fanout.int-spec.ts:232-261` ⇒ trích) bài `company` mới: TẬP KHOÁ của payload `feed:post.created` TRÊN DÂY (cả `author` · `attachments[]` lồng) đúng-BẰNG bảng literal viết tay (D21) — bài fixture có ≥ 1 tệp đính kèm để nhánh lồng không rỗng; giá trị khoá chung với DTO của 003 bằng nhau; `myReaction · savedByMe · isMine · mentions · attachments[].url` vắng, `author.avatarUrl === null`; parse strict bằng `wsFeedPostCreatedEventSchema` là kiểm phụ | socket thật đã sẵn sàng (đang ở room) trước khi đăng bài; tự-kiểm bộ so: thêm một khoá lạ vào bản sao payload ⇒ bộ so PHẢI báo |
| W-2 | `feed:comment.created` trên bài `company`: như W-1 với bảng khoá của bình luận | — |
| W-3 | `feed:reaction.changed`: tập khoá == đúng 5 khoá của API-19 §7 (`targetType · targetId · postId · likeCount · reactions[]`), khoá của phần tử `reactions[]` == bảng tay; `likeCount` == COUNT thật; không có `mine`, không có id người thả | — |
| W-4 | ĐỔI emoji (thích → yêu thích) ⇒ đúng 1 sự kiện với `reactions[]` mới (nghi vấn S1) | lượt thả ĐẦU đã phát 1 sự kiện trên cùng socket |
| W-5 | bài ẩn / bài `org_unit` / bình luận + cảm xúc trên bài NHÓM ⇒ 0 sự kiện (bài nhóm: nợ `S16-SOCIAL-RTGROUPCR-1`, ghim) | một sự kiện «neo» phát SAU đó trên cùng socket vẫn tới |
| W-6 | socket của công ty B nhận 0 sự kiện của công ty A | sự kiện của chính B phát sau vẫn tới |
| W-7 | socket của người KHÔNG có `view:feed` không nằm trong room feed — builder soát `social-be2c-group-fanout` / `-group-rooms` (actor không `view:feed`) TRƯỚC: đã có và đáng tin thì trích, không viết | người có cặp thì nằm trong room |

### Bảng 4 — IDOR theo `post_id` (QA1-I-P): 19 route × 4 trạng thái, LITERAL

Trạng thái: **G** = bài trong nhóm kín mà người gọi không là thành viên `active` · **H** = bài `hidden` của người khác · **D** = bài đã xoá mềm · **U** = bài `org_unit` của đơn vị người gọi không thuộc. Nguồn kỳ vọng: API-19 §6.5 + docblock cổng đọc (`S/social-access.service.ts:478-487, 508-512`): (a) «chưa xoá» KHÔNG có ngoại lệ; (b) `hidden` chỉ tác giả hoặc `manage:feed-post` @Company; (c) nhóm / đơn vị KHÔNG có ngoại lệ theo cặp `manage:*` (`S/social-audience.predicate.ts:23-28`). Mọi ô 404 = `POST_NOT_FOUND` theo MÃ, thân bằng thân của «id bịa».

| Route | Người gọi (vai tuỳ biến @Company) | G | H | D | U |
| ----- | --------------------------------- | - | - | - | - |
| 003 · 007 · 008 · 009 · 011 · 012 · 013 · 014 · 015 | 7 cặp của employee (KHÔNG `manage:feed-post`) | 404 | 404 | 404 | 404 |
| 004 · 005 · 044 (đòi chủ sở hữu hoặc `manage:feed-post`) | cột H · D: như trên; cột G · U: + `manage:feed-post` (cặp này KHÔNG mở được nhóm / đơn vị — vế (c)) | 404 | 404 | 404 | 404 |
| 021 (bài `news` + `requiresAck`) · 041 · 042 · 043 (bài `poll`) | như trên | 404 | 404 | 404 | 404 |
| 022 (bài `news` + `requiresAck`) | + `manage:feed-news`, KHÔNG `manage:feed-post` | 404 | 404 | 404 | 404 |
| 046 (bài `idea`) | + `approve:feed-idea`, KHÔNG `manage:feed-post` | 404 | 404 | 404 | 404 |
| 006 | + `manage:feed-post` | 404 | **n/a-deny: 200** — người giữ cặp tầng 1 đọc được bài ẩn (`S/social.controllers.ts:128-133` · `S/social-access.service.ts:495-497`); ô này là ca ALLOW đã có (scp:267,275). Deny cạnh nó = thiếu cặp ⇒ 403 tầng 1 (M-P) và @Department ⇒ 403 sàn scope (M-F) | 404 | 404 |

**Song sinh cho phép của từng cột** (cùng request, cùng object; ra đúng `ok` của route): **G** = một thành viên `active` của nhóm giữ CÙNG bộ cặp với người gọi · **H** = tác giả của bài (022 / 046: tác giả giữ thêm cặp tầng 1 của route; hoặc người gọi có thêm `manage:feed-post`) · **U** = người thuộc đúng đơn vị đó, cùng bộ cặp · **D** = KHÔNG ai thấy bài đã xoá ⇒ song sinh là CHÍNH người sẽ nhận 404, CÙNG request, chạy TRƯỚC lệnh xoá và ra `ok`; người đó phải là người mà route cho phép khi bài còn sống: tác giả với 004 · 005 · 044, người gọi của dòng với các route còn lại. Riêng 005: lượt một của tác giả CHÍNH LÀ phép xoá (`ok`), lượt hai ⇒ 404. Thiếu vế trước thì ô D rỗng (id gõ sai cũng 404). Với 004 · 005 · 044 ở cột G · U, song sinh là thành viên / người thuộc đơn vị CŨNG giữ `manage:feed-post` (không dùng tác giả làm song sinh ở hai cột này: tác giả thấy bài mình ở mọi audience nên không tách được nhánh nhóm / đơn vị).

Bài của cột D là bài `company` · `published` (trước khi xoá ai cũng thấy), xoá QUA route 005.

**Thứ tự chạy** (mọi route không phải GET — 13/19): với ba cột G · H · U chạy HẾT vế từ chối → chụp «0 hàng ghi» (số hàng + `updated_at` của các object đích) → rồi mới vế song sinh trên CHÍNH object đó; bất biến «0 hàng ghi» chỉ tính trên lát từ chối. Route phá huỷ dùng object RIÊNG cho từng ô (không dùng chung bài với ô khác).

**Dựng fixture đúng LOẠI:** hợp đồng tạo bài không ràng `type` với `audience` (`packages/contracts/src/social-api.ts:457-497` chỉ ràng `audience` ⇄ khoá) ⇒ SUY RA dựng được `news` · `poll` · `idea` trong nhóm kín và trong đơn vị. Bộ gieo của L3 xác nhận bằng 201 TRƯỚC khi vào ca; loại nào service từ chối ⇒ ô đó ghi «n/a + mã service trả» trong evidence và báo phiên điều phối — KHÔNG đổi kỳ vọng, KHÔNG mở QA1-BUG. Song sinh ra khác `ok` vì lý do KHÔNG phải tầm nhìn (vd FSM) ⇒ báo, không sửa bảng theo code.

## 4. Lát thi công TUẦN TỰ (9 lát test L0–L8 + bước đóng Z)

Cuối MỖI lát: spec của lát XANH (ca chạm lỗi sản phẩm ở dạng §5.1) · `pnpm --filter @mediaos/api typecheck` xanh · chạy kèm bốn ratchet rẻ (`pipeline-parity` · `supertest-listen-ratchet` · `coverage-thresholds-ratchet` · `social-error-code-census`) · commit. Lệnh kiểm NHẸ = khuôn §7.1 với mẫu file của lát. Số dòng là ƯỚC LƯỢNG.

**L0 — bộ đồ nghề + ca khói.** File: `H/social-qa1-kit.ts` (≈ 450) · `T/s16-social-qa1-smoke.int-spec.ts` (≈ 140). Kit (thế giới TỰ CHỨA theo khuôn `H/social-avatar-world.ts:140` — đọc luật helper ở `apps/api/test/foundation/supertest-listen-ratchet.unit-spec.ts:81-93` trước khi viết): `bootQa1World(label)` (2 công ty, `applyMainPipeline`, `listen(0)`, `close()`); `actor(tenant, label, {pairs | canonical, scopes, orgUnitId, profile})` có hàng rào D13; `FEED_PAIRS` (15) · `CANONICAL_ROLES` (9); `expectSocial` (chữ ký như `T/social-grouperr1-wire-codes.int-spec.ts:142-151` — nhận HẰNG để census tầng A tính) · `expectGuardDenied` · `expectScopeFloorDenied` · `sameErrorBody`; `reconcileSocialCounters`; `holdRowLock` / `fireUnderLock` (pool riêng, `end()` trong `finally`); `mulberry32` · `mapLimit`; `stripVolatile` · `findIdentity`. Ca: QA1-K-1…8 — boot 2 công ty; gắn đủ 9 vai canonical (`rows.length === 1`); hàng rào cặp ném với key gõ sai; đối soát rỗng sau «đăng + thích + bình luận + xem»; đối soát BÁO lệch khi tự làm lệch từng cột trong công ty mình (7 cột); `expectGuardDenied` đỏ với 403 tầng 2. Mutant ★: `S/social-counters.ts` `bumpPostCounter` cộng 0 thay vì delta ⇒ K-4 đỏ, thông điệp nêu `feed_posts.like_count`. Commit: `test(social): S16-SOCIAL-QA-1 L0 — bộ đồ nghề QA + ca khói`.

**L1 — bảng route + ma trận «thiếu đúng một cặp».** File: `H/social-qa1-routes.ts` (≈ 650: `QA1_ROUTES` 59 dòng `{code, key, verb, path(slice), body(slice), ok, pair}` · `seedQa1Slice(world, tenant, owner, { privileged })` dựng dữ liệu QUA API — `owner` dựng mọi thứ cặp của nó cho phép, `privileged` (actor đủ 15 cặp) dựng phần `owner` KHÔNG được phép dựng (tin `requiresAck` · huy hiệu · bài để kiểm duyệt · báo cáo · bài trong thùng rác); chữ ký này ĐÓNG BĂNG ở L1 và phải đủ cho L2 · `callQa1Route(http, route, slice, token)`; nhận `http` từ world, KHÔNG import supertest; vượt 700 dòng ⇒ tách bộ gieo sang `H/social-qa1-seed.ts`, D1) · `T/s16-social-qa1-pair-matrix.int-spec.ts` (≈ 280). Ca: QA1-M-K-1 (khói TRƯỚC khi đóng băng: gieo một lát với `owner` chỉ giữ 7 cặp của employee + `privileged` ⇒ lát đủ khoá cho cả 59 route) · QA1-M-A-001…059 · M-U-001…059 · M-P ×12 cặp (mỗi cặp: ca neo «số route của cặp khớp bảng tay» + vòng trong có nhãn) · M-F-001…059 · 3 ca kiểm đủ (D3) · ca neo bảng tay ↔ `SOCIAL_ROUTE_PAIRS`. 055 dựng theo kỹ thuật của `T/social-be1c-file-door.int-spec.ts:27, 306-311` (không cần storage). Mutant ★: (1) gỡ `@RequirePermission` ở handler 019 (`S/social.controllers.ts:225`) ⇒ ca kiểm đủ đỏ ở vế «cặp decorator lúc chạy» (và M-P của 019 đỏ vì message không còn `Permission denied` nếu guard cho qua khi vắng metadata); (2) `S/social-access.service.ts:192` bỏ nhánh sàn scope ⇒ M-F đỏ «expected 403». Commit: `test(social): S16-SOCIAL-QA-1 L1 — bảng 59 route + ma trận thiếu-một-cặp + sàn scope`.

**L2 — vai canonical + cặp tầng 2.** File: `T/s16-social-qa1-roles.int-spec.ts` (≈ 330) · `T/s16-social-qa1-tier2-pairs.int-spec.ts` (≈ 340). Ca: QA1-M-R cho employee · manager · hr · company-admin (`describe.each(vai)` × `it.each(route)`, mỗi vai một lát dữ liệu từ `seedQa1Slice(…, owner = vai đó, { privileged })` — không sửa helper đã đóng băng) · payroll-officer, recruiter, asset-manager, office-admin, hr-manager (mỗi vai một ca lặp 59 route ⇒ 403 tầng 1, kèm đếm) · hai tổ hợp «+ employee» == cột employee · `/auth/me` đúng số cặp feed 7/8/15/15/0 · ca «bảng đủ 59 mã, mỗi route có ≥ 1 ô cho phép và ≥ 1 ô từ chối». QA1-M-T-1…10 (vai tuỳ biến, mỗi ca có ca cho phép song sinh): tin tức ⇐ `manage:feed-news` · poll / sáng kiến / vinh danh ⇐ `create:feed-<loại>` · cờ chính thức ⇐ `manage:feed-kudos` · 006: M-T-6 = có `manage:feed-news`, THIẾU `manage:feed-post`, chỉ gửi `pinned` ⇒ `expectGuardDenied` (403 tầng 1 — cặp decorator là SÀN, không tới được cổng theo trường; `S/social.controllers.ts:128-133`); M-T-7 = có `manage:feed-post`, thiếu `manage:feed-news`, gửi `pinned` ⇒ 403 `MODERATION_FIELD_DENIED` theo MÃ; song sinh chung: đủ hai cặp ⇒ 200 · 029 hành động kèm ⇐ `manage:feed-post` · nhóm 033/034/037/038/039 qua `manage:feed-group` (thấy nhóm kín nhưng KHÔNG đọc được bài nhóm) · 054/055 theo `target`. QA1-M-S-1…3: manager canonical ở 028 · 052 · 053 chỉ thấy đơn vị mình (fixture: bài `org_unit` trong đơn vị + bài ngoài đơn vị + bài `company`); hr thấy đủ. Mutant ★: (1) `S/social-access.service.ts` `assertCreatablePostType` bỏ nhánh `news` ⇒ M-R-employee-002 (biến thể tin tức) + M-T-1 đỏ «expected 403»; (2) `S/social-posts-moderation.service.ts:149` bỏ kiểm trường ⇒ M-T-7 đỏ. Commit: `test(social): S16-SOCIAL-QA-1 L2 — 9 vai canonical × 59 route + cặp tầng 2`.

**L3 — IDOR (cùng công ty).** File: `T/s16-social-qa1-idor.int-spec.ts` (≈ 650). Ca: QA1-I-P-<mã>-<G|H|D|U> — đúng theo **Bảng 4** (75 ô từ chối + 1 ô allow; người gọi, song sinh, thứ tự chạy và cách dựng loại bài đều ghi ở đó — builder KHÔNG tự suy ô nào từ code) + ca neo: tập route của Bảng 4 == tập route trong `QA1_ROUTES` có tham số `post_id` trừ 058 (route `post_id` thêm sau này mà thiếu dòng ⇒ đỏ). I-C-016…019 + I-C-5 (bình luận trên bài không thấy · bình luận đã xoá · cha thuộc bài khác). I-O-1…5 (sửa / xoá bài · bình luận, đóng poll của NGƯỜI KHÁC ⇒ 403 `NOT_CONTENT_OWNER` theo MÃ, DB không đổi; chủ ⇒ `ok`; hr canonical ⇒ `ok` + 1 hàng audit; chủ BÀI không xoá được bình luận của người khác). I-A-1…3 (thân lạ gửi kèm ack bị bỏ qua: hàng ack chỉ của người gọi · ack lặp giữ mốc cũ · ack tin không yêu cầu ⇒ 409 theo MÃ). Vote đôi + poll đóng: ĐÃ CÓ và đáng tin (`pol:300-304, 326-330, 349-353, 536-557` · `pcn:240, 278`) ⇒ TRÍCH + nâng `error.code` tại chỗ ở L5 (nhóm B), KHÔNG viết lại. I-G-1…7 (nhóm kín: 032 · 037 ⇒ 404; `pending` không phải thành viên; thành viên thường ở 033/034/038/039 ⇒ 403 `ERR-014`; nhóm public mà chưa tham gia ở 037 ⇒ 403; I-G-5/6 `[O4]` giữ ngoài kho — D23; đăng bài vào nhóm khi `pending` / chưa tham gia ⇒ 403 `ERR-002`). I-L-1…4 (người bị gỡ khỏi nhóm: bài nhóm đã lưu biến khỏi 010 và 020; `feed?groupId=` nhóm kín ⇒ rỗng cạnh neo dương; I-L-4 `[O3]` giữ ngoài kho — D23). Các ca I-C · I-O · I-G trên route phá huỷ theo CÙNG luật thứ tự của Bảng 4 (từ chối → chụp «DB không đổi» → cho phép). Mutant ★: (1) `visiblePostCondition` (`S/social-access.service.ts:492-505`) bỏ vế «chưa xoá» ⇒ các ca I-P trạng thái «đã xoá» đỏ «expected 404»; (2) `assertCanMutateContent` (`:758-764`) luôn cho qua ⇒ I-O-1…5 đỏ. Commit: `test(social): S16-SOCIAL-QA-1 L3 — IDOR cùng công ty`.

**L4 — chéo công ty.** File: `T/s16-social-qa1-cross-tenant.int-spec.ts` (≈ 480). Bảng điều khiển literal: 39 dòng QA1-T-<mã> (37 route nhận id ở đường dẫn + 052/053 nhận `orgUnitId`) — company-admin canonical của B gọi với id THẬT của A ⇒ status + mã ghi tay từng dòng (404 `SOCIAL-ERR-001` / `-012` / `KUDOS_BADGE_NOT_FOUND` / 055 `RESOURCE-ERR-NOT-FOUND`; 025 ⇒ 200 rỗng bằng thân của id bịa; 052/053 `orgUnitId` của A ⇒ 403 `STATS_UNIT_OUT_OF_SCOPE`), không bao giờ 2xx có dữ liệu, không 5xx. Ca neo: tập mã của bảng T == tập route trong `QA1_ROUTES` có tham số đường dẫn + 052 · 053 (route nhận id thêm sau này mà thiếu dòng ⇒ đỏ). T-B-1…9: id của A đặt trong THÂN request của B (nhóm · đơn vị · huy hiệu · người nhận vinh danh · tệp đính kèm · người được nhắc · bình luận cha · đích báo cáo · lựa chọn poll) ⇒ đúng mã ghi tay, 0 hàng ghi sang A. T-L-<mã> cho 15 route danh sách (3 route còn lại — 031 · 049 · 054 — không nhận id nào, ghi «n/a» ở Bảng 1): thân của B không chứa «dấu riêng» gieo trong dữ liệu A; neo dương: A thấy dấu đó trên cùng route. **Ba pha, đúng thứ tự** (một `describe` tuần tự): (1) TOÀN BỘ vế từ chối của B (T · T-B · T-L); (2) «A nguyên vẹn» — số hàng + `updated_at` của mọi hàng A đã gieo không đổi (bất biến này CHỈ tính trên pha 1); (3) vế cho phép: company-admin canonical của A gọi CÙNG request trên CHÍNH object đó ⇒ đúng `ok` — route chỉ-đọc trước, route đổi trạng thái sau, route xoá (005 · 017 · 034 · 036 · 039 · 051) cuối cùng; object nào bị một route pha 3 làm mất thì route khác dùng object riêng. Pha 3 đỏ ⇒ dòng 404 tương ứng ở pha 1 là rỗng — không được bỏ. Ghi chú: cô lập tenant có HAI lớp (vị từ ứng dụng + RLS) nên mutant một lớp ở ứng dụng không đổi kết quả — đó là thiết kế, không phải lưới thủng. Mutant ★ (đo độ CHÍNH XÁC của mã): (1) `S/social-recycle-bin.service.ts:85` đổi 404 thành 403 ⇒ T-058 đỏ; (2) `S/social-files.service.ts:148` đổi 404 thành 403 ⇒ T-055 đỏ. Commit: `test(social): S16-SOCIAL-QA-1 L4 — chéo công ty trên mọi route nhận id`.

**L5 — census mã lỗi theo MÃ.** File: `T/s16-social-qa1-error-codes.int-spec.ts` (≈ 520) · `H/social-qa1-code-cases.ts` (≈ 120, bảng `CODE_CASES` — D6) · sửa `S/social-error-code-census.spec.ts` (+ ≈ 50, tầng D + `HTTP_UNREACHABLE`) · ≤ 9 int-spec cũ (+ 1 dòng / khoá, nhóm B). Ca: QA1-E-01…14 (E-12 = `POLL_WRITE_BUSY` bằng `holdRowLock` của kit, ca chậm ≈ 3 s, timeout riêng 30 s) · E-U-01…27 · E-X1…X5 (E-X3 theo O8) · QA1-E-N1 (nghi vấn S5: báo cáo một bài → giữ khoá worker + `drainOutboxUntilSettled` ⇒ có hàng thông báo cho người kiểm duyệt, không lỗi intake; khuôn `T/social-be2b2-ideas.int-spec.ts:256, 271`; đỏ mà gốc ngoài `S/` ⇒ O8) · QA1-E-G1 (039 gỡ một owner khi còn owner khác ⇒ 200; gỡ owner duy nhất ⇒ 409 theo MÃ) · 3 ca ratchet. Mutant ★: (1) `S/social-reports.service.ts:118` bỏ bọc `socialError(` ⇒ E-11 đỏ ở `error.code`; (2) `S/social-comments.service.ts:137` ném nhầm khoá anh em (`REPLY_DEPTH` thay `COMMENTS_LOCKED`) ⇒ E-03 đỏ ở cả code lẫn message. Tự-kiểm ratchet (phía test, không tính ★): gỡ một khoá khỏi `CODE_CASES` ⇒ typecheck đỏ; gỡ dòng assert `SOCIAL_ERROR_CODES.<KHOÁ>` của một khoá nhóm B ⇒ tầng D đỏ «thiếu ca theo MÃ». Commit: `test(social): S16-SOCIAL-QA-1 L5 — census mã lỗi theo MÃ qua HTTP + ratchet`.

**L6 — race + đối soát counter.** File: `T/s16-social-qa1-race.int-spec.ts` (≈ 540). Ca: QA1-R-0…6 · R-8…12 (Bảng 3; R-7 đã nằm ở L5 dưới mã E-12 — trích). `it` của ca giữ khoá nhận timeout riêng 30 s; ca poll theo D7 (N = 3, hâm nóng, nhả ≤ 1,5 s). Mutant ★: (1) `S/social-reactions.service.ts:196` bỏ lời gọi cộng `like_count` ⇒ R-1 đỏ, đối soát nêu `feed_posts.like_count`; (2) `groupMemberCountDelta` (`S/social-counters.ts:327-333`) trả 0 cho «chưa có → active» ⇒ R-8 đỏ. Commit: `test(social): S16-SOCIAL-QA-1 L6 — đua tất định like · vote · tham gia nhóm + đối soát 7 cột đếm`.

**L7 — xoá mềm 6 bề mặt + PII.** File: `T/s16-social-qa1-softdelete.int-spec.ts` (≈ 450) · `T/s16-social-qa1-pii.int-spec.ts` (≈ 300). Ca: QA1-S-1…9 · S-H · S-G · S-C · S-X · QA1-P-B1…5 · P-V1…3. Luôn xoá QUA route 005 (xoá tay bằng SQL làm lệch `usage_count` khi khôi phục). Ngày sinh fixture tính theo giờ CỤC BỘ của tiến trình API. Mutant ★: (1) `softDeletePostTx` (`S/social-counters.ts:265-274`) bỏ vòng trừ `usage_count` ⇒ S-4 đỏ + đối soát nêu `feed_tags.usage_count`; (2) `S/social-discovery.service.ts:152-155` đảo điều kiện `showBirthday` ⇒ P-B3 đỏ. Commit: `test(social): S16-SOCIAL-QA-1 L7 — xoá mềm 6 bề mặt + PII sinh nhật / bình chọn`.

**L8 — WS trên dây + fuzz.** File: `T/s16-social-qa1-ws.int-spec.ts` (≈ 320) · `T/s16-social-qa1-fuzz.int-spec.ts` (≈ 380). Ca: QA1-W-1…7 (socket thật qua `H/social-group-rooms-fixture.ts:156-259`; actor cần thêm `view:chat-room` để có tín hiệu sẵn sàng; tự `socket.on` cho hai sự kiện mà `FeedRecorder` không ghi) · QA1-F-1 (commit cùng bản vá — O7) · F-B · F-H · F-M · F-E · F-O6 (giữ ngoài kho — D23) + đối soát counter cuối spec. Mutant ★: (1) `S/social-reactions.service.ts:250` bỏ lưới «chỉ bài published» ⇒ W-5 đỏ (nhận sự kiện của bài ẩn); (2) `parseHashtags` (`S/social-mentions.ts:51-64`) bỏ hạ chữ thường ⇒ F-H đỏ «cùng thẻ khác hoa thường phải là MỘT thẻ». Commit: `test(social): S16-SOCIAL-QA-1 L8 — WS trên dây + fuzz có hạt giống`.

**Z — đóng WO (không thêm ca).** `apps/api/package.json` dòng `test:cov:social` (D14) → đo coverage (§7.2 bước 3) → `docs/QA/evidence/S16-SOCIAL-QA-1-ACCEPTANCE.md` → QA-02 + TESTABLE-FEATURES (§8) → notes + `paths` của WO trong `harness/backlog.mjs` → §9 của plan này. Commit: `docs(qa): S16-SOCIAL-QA-1 — nghiệm thu + QA-02 + TESTABLE-FEATURES + test:cov:social`.

**Điểm gác đáng cấy cho lượt kiểm toán mutant độc lập cuối PR** (ngoài các ★ trên): `resolveActor` nhánh thiếu grant (`S/social-access.service.ts:185`) · cờ `canManagePosts` ép sàn Company (`:212-215`) · `visibleGroupPostExists` vế «thành viên active» (`S/social-group-predicates.ts:73-95`) · `assertGroupRoleTx` (`S/social-group-access.service.ts:129-135`) · `scopeCondition` của báo cáo (`S/social-reports.repository.ts:173-185`) · `statsScopeFilter` · `countUnackedFor` (`S/social-news.repository.ts:92-111`) · `resolveMentions` vế cùng công ty + `active` (`S/social-mentions.ts:347-354`) · cắt năm sinh ở SQL (`S/social-discovery.repository.ts:102-103`) · `bumpPollOptionVotes` · `restorePostTx` đếm lại 3 cột.

## 5. Lỗi sản phẩm

### 5.1 Giao thức (K11)

1. Ca viết theo TÀI LIỆU mà đỏ trên code hiện tại ⇒ builder xác nhận đỏ đúng lý do (in status + thân; loại trừ fixture bằng ca đối chứng xanh).
2. Vùng VÀNG, gốc trong `S/`: giữ ca ở dạng `it.fails("QA1-BUG-n · <mô tả trung tính>", …)` — sản phẩm được vá thì `it.fails` tự đỏ, ép lật về `it`. Vùng ĐỎ: KHÔNG commit ca (D23) — giữ ngoài kho tới pha vá. Gốc ngoài `S/`: theo O8 (ca nhãn `[O8]`, không `it.fails`).
3. Trả về phiên điều phối: mã · ca · bằng chứng · nguyên nhân gốc nghi ngờ (`file:dòng`) · vùng (đỏ = quyền / IDOR / PII / chéo công ty; vàng = còn lại). Builder KHÔNG sửa `src/`.
4. Pha VÁ (phiên điều phối, tuần tự từng lỗi): `it.fails` → `it` (thấy ĐỎ) → vá gốc → XANH → chạy spec lân cận. Vùng đỏ ⇒ FULL gate trên phần vá. Quá 3 lỗi vùng đỏ ⇒ dừng, báo owner.
5. Khi mở PR không còn `it.fails`, trừ lỗi vùng VÀNG mà owner quyết định tách WO (danh sách owner đã duyệt — §7.2 bước 0 đếm bằng máy). Lỗi vùng đỏ tách WO thì ca tái lập Ở NGOÀI KHO tới khi bản vá đã deploy (D23). Tài liệu im lặng / tự mâu thuẫn ⇒ bảng [OWNER], không phải lỗi mặc nhiên.

### 5.2 Bảng QA1-BUG khởi tạo — nghi vấn TĨNH (chưa chạy)

Chi tiết (cơ chế nghi ngờ · `file:dòng`) của cả bảng: sổ ngoài kho — kho public chỉ giữ mã + một dòng.

| #   | Nghi vấn (một dòng trung tính) | Ca đo | Vùng · cách xử | Trạng thái sau khi chạy (09/10/2026) |
| --- | ------------------------------ | ----- | -------------- | ------------------------------------ |
| S1  | Sự kiện realtime khi ĐỔI loại cảm xúc có thể không phát | W-4 | vàng, gốc trong `S/` ⇒ `it.fails` → vá trong WO (LIGHT) | ĐÃ VÁ = QA1-BUG-1 (`aad82bb7`); W-4 lật `it.fails` → `it`, thêm W-4a · W-4b |
| S2  | Một lớp ký tự điều khiển trong chuỗi đầu vào: nghi trả sai lớp status | F-1 | vàng — O7 (vá hẹp trong `S/`, ca commit cùng bản vá) | ĐÃ VÁ hẹp trong SOCIAL = QA1-BUG-2 (`4c96fa4a` · `853f0eb1`); biên chung ⇒ WO `S1-FND-NULINPUT-1` |
| S3  | Thân request quá cỡ: nghi trả sai lớp status | E-X3 | vàng, gốc NGOÀI `S/` ⇒ O8 (mặc định không vá) | XÁC NHẬN = QA1-BUG-3; không vá (O8-a), ca `[O8]` assert bất biến yếu ⇒ WO `S1-FND-BODYLIMIT-1` |
| S4  | Thẻ không còn bài nào vẫn nằm trong danh sách thẻ | S-4 | vàng — đi cùng O3 (ghim; vá nếu owner chọn) | đã đo — chờ owner (đi cùng O3) |
| S5  | Thông báo của sự kiện «bài bị báo cáo» thất bại KHÔNG tất định ở lượt nền — đua lúc dọn test hay lỗi thật? | E-N1 | vàng; gốc trong `S/` ⇒ vá trong WO, gốc ngoài ⇒ O8 | KHÔNG phải lỗi sản phẩm: E-N1 xanh 6/6 lượt một-file, cụm tuần tự 0 dòng lỗi; chỉ lộ khi nhiều file chạy song song (đua giữa bước dọn của một spec và worker của file khác) |
| S6  | = O4 | I-G-5/6 | đỏ nếu owner chọn (b); ca giữ ngoài kho (D23) | đã đo — chờ owner; ca giữ ngoài kho |
| S7  | = O5 | S-G (vế tác giả) | như trên | đã đo — chờ owner; ca giữ ngoài kho |
| S8  | = O6 | F-O6 | như trên | đã đo — chờ owner; ca giữ ngoài kho |
| S9  | = O3 | I-L-4 | như trên | đã đo — chờ owner; ca giữ ngoài kho |

Ghi nhận mức thấp, KHÔNG đo trong WO (7 mục — không tái lập tất định hoặc chỉ là hiển thị; danh sách ở sổ ngoài kho). Fuzz chỉ ép bất biến chung trên các đầu vào đó, không ghim hành vi đáng ngờ.

### 5.3 Nợ ĐÃ CÓ WO — ghim hiện trạng, không báo lại (K17)

`S16-SOCIAL-SCOPEDENIEDCODE-1` (sàn scope trả `error.code = AUTH-ERR-FORBIDDEN`) · `-RTGROUPCR-1` (bình luận / cảm xúc bài nhóm chưa phát WS) · `-BDAYMASKED-1` · `-IDENTITYLIVE-1` · `-GROUPMOD-1` · `-ATTERRSPLIT-1` (007 gộp hai lỗi) · `-GROUPPOSTDEL-1` · `-POSTGROUPTOCTOU-1` · `-GROUPDELRACE-1` · `-GROUPLOCKTIMEOUT-1` (route nhóm chờ khoá không cận trên — ca đua nhóm PHẢI nhả khoá trong `finally`) · `-RESNOTEMASK-1` · `-ATTMETAMASK-1` · `-REPORTSNAPSHOT-1`. Đã ghim bằng test từ trước, không phải phát hiện mới: duyệt người đã nghỉ vào nhóm vẫn +1 `member_count` (`T/social-be2a-group-members.int-spec.ts:421-429`).

## 6. Bẫy đã biết áp vào WO này

**A. Ba kiểu «xanh mà rỗng» (ba ghi chú WO gọi tên)**
1. Coverage cao che mã lỗi không có ca (đo ở ASSET: 97,5 % mà một mã 0 ca) → không dùng % làm thước; census theo MÃ có ratchet (D6); nhánh bị mã khác chặn trước phải tìm ĐƯỜNG THẬT tới mã.
2. Nhánh quyền không có ca cho phép thì mọi ca từ chối của nó rỗng → đếm NHÁNH: mỗi dòng bảng PHẢI có ô cho phép, soạn trước khi soạn ô từ chối (D5) — «trước» là thứ tự SOẠN, không phải thứ tự CHẠY: trên route phá huỷ / đổi trạng thái thì lúc chạy vế từ chối đi trước, vế cho phép đi sau trên chính object đó (Bảng 4 · L4); người thiếu tư cách không dựng nổi dữ liệu thì gửi giá trị bất kỳ + assert MÃ.
3. Spy / `toHaveBeenCalledWith` xanh nhờ lời gọi KHÁC gánh hộ → WS đo trên DÂY (D21); khi buộc dùng spy thì thu MỌI lời gọi rồi lọc theo id, assert trên tất cả.

**B. Hạ tầng test**
1. Chép khâu boot của spec cũ ⇒ `pipeline-parity` đỏ (269 → 270), chỉ lộ ở lượt cả suite → chỉ `applyMainPipeline`, không đăng ký thêm khâu nào.
2. `Promise.all` chạm supertest mà thiếu `listen(0)` ⇒ `ECONNRESET` + ratchet đỏ → kit luôn `listen(0)` và `close()`; `H/social-qa1-routes.ts` không import supertest.
3. Key cặp gõ sai chèn một hàng catalog `feed*` TOÀN CỤC ⇒ pin «15 cặp» đỏ ở spec KHÁC, dính tới khi reset lane → hàng rào D13.
4. Ba loại 403 cùng `error.code = AUTH-ERR-FORBIDDEN` → phân biệt bằng `error.message` (D5); vai thiếu cặp luôn dừng ở tầng 1 nên KHÔNG BAO GIỜ thấy mã SOCIAL (kể cả 046).
5. Nhiều khoá chung một số (001 ×3 · 007 ×2 · 010 ×2 · 013 ×2) → assert cả code lẫn message bằng HẰNG; chuỗi `"SOCIAL-ERR-001"` trần không phân biệt được.
6. `likeCount` trong response của route cảm xúc và trong WS là COUNT thật → đối soát phải đọc CỘT từ DB.
7. Phạm vi đối soát: 3 cột của bài chỉ trên bài chưa xoá · `feed_comments.like_count` chỉ trên bình luận chưa xoá · `usage_count` qua bài chưa xoá, KHÔNG lọc trạng thái / nhóm · `member_count` chỉ đếm `active`, không lọc nhóm đã xoá · `vote_count` theo TỪNG lựa chọn · luôn lọc `company_id` của spec (CI chạy mọi file song song trên MỘT DB).
8. Kỳ vọng khi đua: tham gia nhóm ×2 = 201 + 409; bỏ phiếu ×2 và thả cảm xúc ×2 = 200 + 200; xem lặp thì thân KHÔNG có `viewCount`; xoá bài lần hai TUẦN TỰ = 404.
9. Feed / tìm kiếm / trang cá nhân LOẠI bài nhóm (kể cả nhóm public); news và saved thì GỒM → bài dùng cho 6 bề mặt phải là bài `company`.
10. Tác giả luôn thấy bài mình (ẩn, nhóm đã rời) → ca từ chối dùng người xem KHÁC tác giả; cờ `manage:*` chỉ có hiệu lực ở scope Company.
11. Bài tác giả tự xoá khôi phục về `hidden` → ca «đồng nghiệp thấy lại» phải do người kiểm duyệt xoá.
12. Regex năm khớp đoạn UUID / mốc thời gian → bỏ UUID + mốc ISO trước khi dò; chọn năm sinh không trùng năm hiện tại.
13. Sinh nhật tính theo múi giờ TIẾN TRÌNH API → fixture tính bằng giờ cục bộ; tránh 29/02.
14. «Nhận 0 sự kiện WS» chỉ có nghĩa sau một neo dương phát SAU trên cùng socket; spy ở emitter thấy payload TRƯỚC khi parse, parse ném thì bị nuốt.
15. `directPool()` chỉ có 4 kết nối → harness giữ khoá dùng pool riêng; `pg_blocking_pids` lấy khoá toàn instance (instance này cũng phục vụ PROD) → không poll dày hơn 25 ms, không nhân số ca đua.
16. Poll «quá hạn còn open» phải lùi CẢ `created_at` lẫn `closes_at` (CHECK phủ UPDATE).
17. Assert hàng `notifications` cần giữ khoá worker outbox + drain; assert `outbox_events` thì không.
18. Fixture gieo thẳng DB bỏ qua counter / thẻ / outbox → dữ liệu của ca đối soát và xoá mềm phải tạo QUA API.
19. Tên file phải chứa `social` thì census mã lỗi mới tính; ca viết chỉ bằng `SOCIAL_ERROR_CODES.K` không được tầng A tính → `expectSocial` nhận cả hai hằng.
20. Mật khẩu fixture = `loginPasswordFixture("<tag riêng của file>")`; không literal giống-secret (gitleaks quét cả lịch sử nhánh).
21. Lượt vitest chết `Channel closed` mà không ca nào đỏ (đo: 2/4 lượt nền) → tiêu chí xanh = có dòng `Test Files` VÀ exit 0; thiếu dòng đó thì chạy lại, không kết luận.
22. `pnpm test -- <đường dẫn>` KHÔNG lọc ⇒ chạy cả suite → luôn `pnpm --filter @mediaos/api exec vitest run <đường dẫn>`.
23. Mutant: sao lưu bằng `cp` ra ngoài kho trước khi cấy, hoàn tác bằng `cp` (không `git checkout --`); đỏ phải khớp thông điệp kỳ vọng (đỏ vì 500 / lỗi biên dịch đọc y hệt đỏ vì assert).
24. Có `LANE_DB` thì `lane-db-guard` không nhìn số skip → tự đọc `skipped` trong log lượt xanh (kỳ vọng 0 ở các spec của WO).

## 7. Gate & verify

### 7.1 Lệnh kiểm nhẹ theo lát (Git Bash, MỘT dòng; `L` = thư mục log NGOÀI kho)

```bash
cd "/c/dev 2/MediaOS-qa1" && . scripts/lib/db-secrets.sh && db_secrets_load && db_secrets_require SUPERUSER_DB_PASSWORD APP_DB_PASSWORD WORKER_DB_PASSWORD && export SUPERUSER_DB_PASSWORD APP_DB_PASSWORD WORKER_DB_PASSWORD && unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL && export LANE_DB=mediaos_qa1 && pnpm --filter @mediaos/api exec vitest run <mẫu-file-của-lát> test/foundation/pipeline-parity test/foundation/supertest-listen-ratchet test/foundation/coverage-thresholds-ratchet src/social/social-error-code-census --maxWorkers=2 > "$L/<lát>.log" 2>&1; echo "exit=$?"; sed 's/\x1b\[[0-9;]*m//g' "$L/<lát>.log" | grep -E "Test Files|Tests |Unhandled" | tail -8
```

Rồi `pnpm --filter @mediaos/api typecheck`. Không bao giờ in / grep `.env`; script `db-secrets.sh` tự nạp, không in.

### 7.2 Thứ tự verify trước khi mở PR (mỗi lúc MỘT lệnh nặng)

0. Cổng kho public (hai lệnh chỉ-đọc, TRƯỚC khi push): (i) `git grep -nE "it\.fails\(" -- "apps/api/test/integration/s16-social-qa1-*"` ⇒ tập kết quả phải BẰNG danh sách owner đã duyệt (mặc định: rỗng); `git status --short` sạch (không sót bản chép của ca giữ ngoài kho — D23). (ii) Lịch sử nhánh cũng lên public: phiên điều phối GỘP các commit plan trước lượt review này (`e708452a` · `985fbf21` còn nguyên văn chi tiết O3–O7 / S1–S9) với commit vá thành MỘT commit trước khi push; kiểm bằng `git log -p origin/master..HEAD -- docs/plans/S16-SOCIAL-QA-1.md` không còn các `file:dòng` đã rút.
1. `bash harness/check.sh --quick`
2. Toàn bộ spec của WO + cụm SOCIAL trên lane: khuôn 7.1 với mẫu `src/social test/foundation/social- test/integration/social- test/integration/s16-social- src/notifications/social-noti-bridge`, `--maxWorkers=4`. Kỳ vọng: 0 đỏ, 0 skip, tổng thời gian các file `s16-social-qa1-*` < 5 phút.
3. Coverage: `pnpm --filter @mediaos/api run test:cov:social > "$L/cov.log" 2>&1` (đã đặt `LANE_DB` như 7.1). Ghi 4 chỉ số «All files» vào §9 + evidence; kỳ vọng statements ≥ 85 % (nền 98,16 %) và không tụt quá 0,5 điểm so với nền.
4. `bash harness/check.sh --all --lane-db=qa1` — XANH, không banner «không đủ bằng chứng». KHÔNG đặt `S3_BUCKET=mediaos-fdisp-test`: owner đã cho xoá bucket đó (09/10), và spec storage sẽ TỰ TẠO LẠI nó trên cụm MinIO của PROD nếu tên khớp (§0.3). WO này không chạm storage ⇒ S1–S6 của spec storage bỏ qua CÓ cảnh báo là kết quả ĐÚNG; log mà có dòng «VỪA ĐƯỢC TẠO» hay «ĐÃ TỒN TẠI — ca storage thật CHẠY» ⇒ dừng, báo owner.

### 7.3 Gate theo diff

- Chỉ-test (+ dòng script coverage + tài liệu) ⇒ **LIGHT**: `ecc:typescript-reviewer` + lượt kiểm toán mutant độc lập. PASS vòng 1 thì dừng; LOW ghi nợ.
- Có vá `src/` vùng quyền / hiển thị / PII / chéo công ty ⇒ **FULL tuần tự** trên phần vá: `security-reviewer` → `ecc:silent-failure-hunter`.
- Vá vùng vàng có gốc TRONG `S/` (S1 · S2 theo O7 · S5 nếu gốc ở `S/`) ⇒ LIGHT; riêng bản vá xử lý đầu vào (S2) thêm `security-reviewer` HẸP trên đúng hunk.
- Gốc NGOÀI `S/` (S3; S5 nếu gốc ở `src/notifications/**`) ⇒ KHÔNG vá trong WO (O8 mặc định (a)). Owner chọn O8 (b) thì gate theo vùng của FILE GỐC (bộ lọc lỗi toàn cục = FULL), không theo vùng của WO.

## 8. Tài liệu phải cập nhật (bước Z) + nợ

| File | Thêm gì |
| ---- | ------- |
| `docs/QA/evidence/S16-SOCIAL-QA-1-ACCEPTANCE.md` (mới) | truy vết 3 `done_when` → ca · ma trận 59 route × 9 vai (nguồn duy nhất) · bảng mã lỗi → ca · lỗi sản phẩm đã vá / đã tách · bảng mutant · số đo (ca, thời gian, coverage) · lệch có chủ đích (O1…O8). File này cũng lên public ⇒ theo D23: nghi vấn vùng đỏ chưa vá chỉ ghi mã + một dòng trung tính |
| `docs/QA/QA-02_Test_Case_Matrix_theo_module.md` | gỡ dòng SOCIAL khỏi bảng §3.2 (`:64`) + khối trích dẫn theo tiền lệ CHAT (`:68-85`); thêm `SOCIAL` vào bảng mã module §4.2 và bảng tổng §5; mục «Ma trận test SOCIAL» GỌN: ≈ 14 dòng theo nhóm (`QA02-SOCIAL-<NHÓM>-NNN` ↔ dải mã QA1-… ↔ file), trỏ evidence cho bảng chi tiết |
| `docs/TESTABLE-FEATURES.md` | mục mới trước §6, tên tránh nhầm với «5b. App vệ tinh SOCIAL» (fbpost): «SOCIAL — Bảng tin nội bộ (wave S16, nghiệm thu QA)»: tóm tắt 59 route · bảng Quyền theo vai (7 / 8 / 15 / 15 / 0) · bảng Việc · Cách kiểm · Kỳ vọng (≈ 15 dòng, kèm mã lỗi) |
| `harness/backlog.mjs` | notes của WO (số ca · coverage · lỗi đã vá · lệch O1…O8, chữ trung tính) + thêm `apps/api/package.json` vào `paths`. KHÔNG sửa tay `docs/STATUS.md` |
| `apps/api/package.json` | `test:cov:social`: + 15 int-spec cũ + 12 int-spec mới (D14) |

**Đề xuất WO nợ (chữ trung tính; tên do phiên điều phối đặt):** đính chính SPEC-16 (§11 «14 cặp» · §12 006/008 · «22 mã» · câu chữ ERR-017 · §13.6 «6 cột») và API-19 (dòng tự lệch số route; `AUTH-ERR-SCOPE-DENIED` như mã) → `S16-SOCIAL-DOC-3` · chuyển 18 int-spec SOCIAL dựng tay sang `applyMainPipeline` · O3–O6 nếu owner chọn (b) · biên chung cho lớp ký tự điều khiển (O7-a) · lỗi có gốc ngoài `S/` (O8: S3 · S5 nếu xác nhận) · các ghi nhận mức thấp ở sổ ngoài kho · dọn `tagFilterExists` · widget DASH phải có ca xoá mềm riêng (`S16-SOCIAL-DASH-1`) · `test:cov:social` chưa có cổng máy nào gọi.

## 9. Sổ vết

| Bước | Ngày | Commit | Ca mới (đỏ → xanh) | Ghi chú / lệch plan |
| ---- | ---- | ------ | ------------------ | ------------------- |
| Plan | 09/10/2026 | | — | |
| Plan-review | 09/10/2026 | (commit này) | — | plan-review lượt 1: PASS_WITH_FIXES (0 BLOCKER · 1 HIGH · 7 MEDIUM · 5 LOW) — nhận 13 · bác 0. PR-07 nhận nhưng LỆCH cách vá: không amend (agent vá plan không được viết lại lịch sử) ⇒ thêm §7.2 bước 0 (gộp commit plan trước khi push). Thêm O8 · D23 · Bảng 4 |
| L0 | 09/10/2026 | 9687d609 | 15 (QA1-K-1…8) | kit tách thêm `-kit-race` · `-kit-counters`; mutant ★ đỏ đúng cột (`feed_posts.like_count`) |
| L1 | 09/10/2026 | b91484c0 | 196 | bộ gieo tách sang `H/social-qa1-seed.ts` (D1); guard ĐÓNG khi route vắng decorator (plan giả định mở) — 2/2 ★ đỏ |
| L2 | 09/10/2026 | ee3bed2d | 277 (roles 261 · tier2 16) | xanh ngay lượt đầu, 0 literal phải sửa; 2/2 ★ đỏ |
| L3 | 09/10/2026 | 5ae4b792 | 120 (idor-posts 96 · idor-content 24) | tách HAI file + helper `-idor-util`; thêm 19 ca «-cũ» vì ★1 theo plan không đỏ (hai lớp chặn trùng nhau); đăng bài vào nhóm kín khi chờ duyệt ⇒ 404 theo API-19 (plan ghi 403); 3 ca O3 / O4 giữ ngoài kho |
| L4 | 09/10/2026 | a4627fba | 133 | thêm T-Q-1…4 (bộ lọc bảng tin) · pha «A nguyên vẹn» băm toàn bộ hàng; 2/2 ★ đỏ đúng 1 ca |
| L5 | 09/10/2026 | debf0114 | 77 (+ tầng D census · 27 khoá nâng tại chỗ ở 9 file cũ) | E-02 · E-06 phải có ca riêng; lộ QA1-BUG-3 ⇒ E-X3 dạng `[O8]`; 2/2 ★ + 2 tự-kiểm ratchet đỏ |
| L6 | 09/10/2026 | 2570fc3b | 12 | hàm bọc `race()` tách lỗi harness khỏi lỗi sản phẩm; 2/2 ★ đỏ |
| L7 | 09/10/2026 | 8ad6ab2c | 27 (softdelete 16 · pii 11) | S-4 dùng hai thẻ; 2 ca O5 / S4 giữ ngoài kho; 2/2 ★ đỏ |
| L8 | 09/10/2026 | 48b6fc9a | 15 (ws 9 · fuzz 6) | lộ QA1-BUG-1 (W-4 `it.fails`) + QA1-BUG-2 (F-1 giữ ngoài kho tới bản vá); F-O6 giữ ngoài kho; 2/2 ★ đỏ |
| Pha vá (QA1-BUG-n) | 09/10/2026 | aad82bb7 · 4c96fa4a | +31 (`input-ctrl`) + 19 ca unit pipe; W-4 đỏ → xanh | BUG-1 vá ở repository (một câu lệnh); BUG-2 vá bằng pipe cấp class trên 12 controller (O7-b) — rộng hơn «`S/social.dto.ts`» của plan vì đo được cả query; BUG-3 không vá (O8-a) |
| Kiểm toán mutant | 09/10/2026 | 8fb87e99 | +4 (QA1-G-1…4) | 11 điểm gác: 8 bị bắt · 2 sống sót (M02 · M11) đã bù ca · 1 không áp dụng (M01) |
| Gate | 09/10/2026 | 853f0eb1 · 648e569c | +2 (W-4b · 1 ca `input-ctrl`) + 5 ca unit pipe ⇒ 909 | `ecc:typescript-reviewer` PASS_WITH_FIXES (1 MEDIUM · 6 LOW) · `security-reviewer` hẹp PASS_WITH_FIXES (1 MEDIUM · 3 LOW); 10/11 finding đã vá, G1-07 ghi nợ; 2 mutant của bước vá đỏ đúng thông điệp |
| Z · coverage | 09/10/2026 | (commit này) | — (không thêm ca) | `test:cov:social` đủ 48 int-spec SOCIAL (thêm 15 cũ + 15 mới; trừ `s16-filedisposition-storage`). Coverage `src/social/**` trên lane, 81 file · 2.335 ca: statements 98,66 · branches 92,65 · functions 99,77 · lines 98,66 (nền 98,16 · 90,75 · 99,31 · 98,16). LỆCH: lượt một tiến trình chết `Channel closed` 3/3 ⇒ đo theo 6 mảnh tuần tự rồi gộp báo cáo. Seed 4 WO nợ: `S16-SOCIAL-DOC-3` (không phải DOC-2 — id đó đã có chủ) · `S1-FND-BODYLIMIT-1` · `S1-FND-NULINPUT-1` · `S16-SOCIAL-QADEBT-1` |
| verify 7.2 (bước 0–4) | 09/10/2026 | (commit này) | — | Bước 0: 0 `it.fails` · 0 file ca giữ ngoài kho · lịch sử nhánh không còn chi tiết đã rút (ba commit plan đầu đã gộp thành một trước khi dựng test). Bước 1 + 4: `bash harness/check.sh --all --lane-db=qa1` trên lane vừa `--reset` ⇒ XANH 9/9 (api 844/844 file, 5 lần chạy lại vì crash hạ tầng `Channel closed`, 0 ca đỏ · app 397 · contracts 45 · web-core 50 · ui 24 · console 22 · auth 4 · build xanh); spec storage bỏ qua S1–S6 CÓ cảnh báo đúng như §7.2 (không bucket nào được tạo). Bước 2: cụm SOCIAL tuần tự 78 file / 2.274 ca xanh (trước pha vá) + 15 file QA1 909/909 (sau vá gate). Bước 3: số coverage ở hàng «Z · coverage». gitleaks v8.30.1 trên `origin/master..nhánh`: sạch. Id WO tài liệu trong §0.1 / §8 sửa thành `S16-SOCIAL-DOC-3` (`DOC-2` đã là WO khác). |
| PR | | | | |
