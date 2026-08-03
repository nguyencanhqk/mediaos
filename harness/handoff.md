# Bàn giao phiên — Memory tầng 2 (phiên trước → phiên sau)

> `harness/finish.sh` nhắc ghi vào đây cuối phiên; `harness/init.sh` đọc đầu phiên.
> Ghi NGẮN gọn. Cũ đẩy xuống "Lịch sử". Quyết định kiến trúc → ghi vào `docs/DECISIONS/`, không nhồi vào đây.
> Ô **Friction**: ghi cái gì làm tay/khó lặp lại — cùng một friction xuất hiện **≥2 lần** ⇒ gọi skill `skill-smith` để đóng băng thành skill.

## Phiên 2026-08-03 (session 56e133e4) — FULL gate `S7-CHAT-BE-GATE-3` + 6 vá 🔴 · **26 FILE CHƯA COMMIT**

> ⛔ **ĐỌC Ô NÀY TRƯỚC KHI CHẠY BẤT KỲ LỆNH GIT NÀO.** Cây `wave/s7-chat` đang có **26 file dirty** là
> công việc đã hoàn thành + verify của phiên này, **chưa commit**. Chỉ có MỘT worktree ⇒ phiên sau đứng
> đúng trên cây này. **CẤM `git add -A`, cấm `git checkout`/`git stash`/đổi nhánh** khi chưa chốt. Đây
> đúng bẫy đã dính với phiên `69de512c` (xem ô Friction phiên 2026-08-01).
> Chốt nhanh: `git checkout -b wo/s7-chat-be-gate-3 && git add <đúng path của mình> && git commit`.

**Đã làm:** chạy FULL gate 5 lane trên TOÀN bề mặt CHAT (`master...HEAD`: 62 file, +12.747 dòng) rồi vá
hết CRITICAL + 5 HIGH. Lý do gate: 5 WO **chưa từng qua gate** (`DB-2`, `BE-7`, `RT-0`, `RT-1`, và `BE-6`
mới có 1/3 reviewer), cộng với việc gate cũ đã TRÔI — `chat-access.service.ts` (file 3-bất-biến) bị +69
dòng SAU khi được bless ở `631d683e`.

- **Verdict:** L1 PASS · L2/L3/L4/L5 BLOCK. **L2 và L4 độc lập tìm ra CÙNG một CRITICAL** — tín hiệu mạnh
  hơn bất kỳ verdict đơn lẻ nào. L1 thì **bác bỏ** giả thuyết trôi-gate tôi đưa cho nó (phần +69 dòng là
  siết chặt, không nới) — giữ được cách làm này: đưa giả thuyết cho reviewer và chấp nhận nó nói "sai".
- **CRITICAL đã vá:** `sendMessage` dựng DTO bằng `readMessage(actor,…)` = **đã ký cho NGƯỜI GỬI** rồi
  `emitChatMessage` phát nguyên object đó cho CẢ PHÒNG; `wsChatMessageEventSchema = chatMessageSchema` giữ
  nguyên `attachments[].url`. URL presign là **bearer** ⇒ ai cầm cũng tải được, 0 dòng `file_access_logs`.
  Vá: khai `wsChatAttachmentSchema` KHÔNG có `url`/`thumbnailUrl` (khai LẠI, không `.omit()`).
- **5 HIGH đã vá:** cắt phiên WS khi thu hồi phiên (SPEC-15 §18, chốt ở `revokeAllSessionsForUserTx`) ·
  `LEAST(${x}::int)` trên cột **bigint** ⇒ `seq ≥ 2^31` trả **500** thay vì kẹp trần · `removeMember` đồng
  bộ theo `pm.user_id` legacy trong khi vị từ phòng chat đi qua `employee_profiles.user_id` ·
  `S7-FND-LINKFALLBACK-1` · phần im-lặng của tệp đa-link.
- **KI-059 ĐÓNG** (`S7-INT-OUTBOX-FIFO-1`) kèm **phạm vi bảo đảm nói chính xác**: chỉ đúng trong MỘT lô
  claim của MỘT worker — không với tới ties trong cùng tx, retry-backoff, và đa-instance.

### Ba bài học đắt nhất phiên này

1. **Đề xuất của reviewer có thể là VECTOR LEO THANG — phải tự thẩm định trước khi làm.** L4 đề nghị nới
   luật AND của `decideForLinkedFile` để "người có quyền ở phòng mình vẫn tải được". Làm nguyên văn thì kẻ
   tấn công chỉ cần link tệp của phòng nó KHÔNG thuộc vào tin nhắn của CHÍNH NÓ là được cấp quyền — và đó
   đúng là lỗ `S5-TASK-COVER-1` đã đóng. **Giữ AND**, chỉ vá phần khuyết tật thật (sự im lặng) bằng
   `deniedByLink` (chẩn đoán, CẤM dùng để phân quyền).
2. **Spec lái worker thật trên lane DB dùng chung vừa ăn cắp vừa bị cướp.** Spec bằng chứng ĐẦU TIÊN của
   tôi cho KI-059 dùng `processBatch(50)` + gieo probe `available_at` lùi 1 giờ (= già nhất DB) ⇒ worker
   spec khác nhặt trước (tất định, vì `ORDER BY available_at`), còn worker của tôi đánh `'done'` im lặng
   mọi event không có consumer trong bus. LIGHT gate bắt được. Luật đã có sẵn ở
   `dead-letter-alert-threshold.int-spec.ts:12-15` và `test/helpers/outbox-drain.ts` — **đọc trước khi viết
   spec đụng outbox**. Bản viết lại: probe lùi ~600ms, batch đúng bằng N, TRẢ LẠI event lỡ nuốt, và tách
   bạch "bị cướp probe" khỏi "vá hỏng" bằng assert riêng có thông điệp chẩn đoán.
3. **Đổi chữ ký thành BẮT BUỘC để TypeScript chỉ mặt caller.** `revokeAllForUserTx(+companyId)` và
   `decideForLinkedFile(+everLinked)` — không dùng tham số optional-mặc-định-false, vì caller mới quên là
   lỗ mở lại IM LẶNG. Cách này lôi ra 5 + 15 điểm gọi mà grep sẽ sót.
   Kèm: **census nguồn bắt được 2 lỗ mà reviewer không thấy** — `self_revoke` và `self_revoke_others` thu
   hồi phiên ở DB nhưng không cắt socket (thiết bị vừa bị "đăng xuất từ xa" vẫn nhận tin). Nhánh `rotated`
   CỐ Ý không cắt và census khoá luôn ngoại lệ đó.

### Số đo (LANE_DB=mediaos_outboxfifo)

Unit **1217/1220** · int-spec 5 module resolver **139/139** · CHAT int-spec **164/164** (chạy 2 lô) ·
typecheck workspace **10/10** · lint **0 error**. **Mọi vá đều có RED-proof thật** (lật ngược bản vá,
xác nhận đỏ, khôi phục) — không có vá nào chỉ "xanh sau khi sửa".

### 3 mục CHỜ OWNER (chưa ai chốt)

1. **`update:project` là `is_sensitive` nhưng NGOÀI `SENSITIVE_CAPABILITY_ALLOWLIST`** ⇒ 3 ca
   `auth-me-capabilities.int.spec.ts` ĐỎ. **Đã chứng minh KHÔNG do wave CHAT**: stash sạch toàn bộ thay
   đổi, chạy lại trên CÙNG lane DB — đỏ y hệt. Đúng khuôn KI-058 (màn quản trị ẩn với người có quyền).
   Cần WO riêng.
2. **Hành vi gửi lại tệp sang phòng thứ hai** làm mất `url` ở phòng thứ nhất — quyết định SẢN PHẨM: chấp
   nhận (an toàn, gây bất ngờ) hay đổi tầng GHI để gửi-lại tạo **bản sao tệp** thay vì link thứ hai.
3. **~15 MEDIUM** còn tồn. Đáng gom nhất: 4 mục least-privilege của L3 — `GRANT UPDATE(visible_from_seq)`
   là quyền CHẾT đang gác bất biến CHAT-DEC-008 bằng *một unit test*; `users` còn DELETE ⇒ cascade xoá
   CỨNG `chat_messages` (bảng append-only). Một migration expand-contract là gọn.

### Chưa xong / chưa chắc

- **Chưa commit, chưa PR, chưa lên master.**
- Lô int-spec thứ hai **đỏ 1 lần trong 4 lượt**, KHÔNG bắt được tên ca; 3 lượt sau xanh sạch. Chưa kết
  luận được — đừng đọc thành "đã ổn định".
- Lệnh chạy lại: `set -a; . ./.env; set +a; unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL;
  export LANE_DB=mediaos_outboxfifo` (lane này còn sống, nhớ `DROP DATABASE` khi xong — pgdata từng phình).

## Phiên 2026-08-02 (session b817bc82) — chuỗi cổng G4→G6 + NGHIỆM THU engine phép ĐẠT

> Bằng chứng đầy đủ: **`docs/_review/S6-GOLIVE-G4-G6-EVIDENCE-2026-08-02.md`**. `RELEASE-10` §6 đã thêm cột Trạng thái.

- **G4 hoá ra ĐÃ XONG từ trước — cái hỏng là CHỈ BÁO.** `nssm get MediaOS-API AppParameters` = `apps\api\releases\current\main.js`, nhưng `m prod-status` vẫn in "service VAN tro thang apps\api\dist". Gốc: `Show-ReleaseStatus` đọc `ImagePath` của service rồi thử `-match "releases"` — với **service NSSM, `ImagePath` LUÔN là đường dẫn `nssm.exe`**, mục tiêu thật nằm ở subkey `Parameters\Application`+`AppParameters` ⇒ phép thử **không bao giờ đúng** ⇒ ô KI-016 báo "chưa đóng" VĨNH VIỄN. **Đây là một tín hiệu NO-GO GIẢ đã tính vào phán quyết NO-GO 2026-07-31.** Vá ở #324.
- **Chứng minh cutover bằng HÀNH VI, không bằng cấu hình:** `m dev-online-fast` biên dịch lại `apps/api/dist` → dist đổi sang `43237f5b` trong khi `:3100/health` **vẫn** trả `969f330c-dirty`. Trước cutover, đúng chuỗi này tái tạo sự cố 2026-07-08.
- **NGHIỆM THU ĐẠT — số đúng là 245, KHÔNG phải 295** (owner chốt trong phiên; plan §1.1 F1 đã đính chính từ trước, chỉ handoff/WO còn giữ số ngây thơ). Preview **245 ngày / 41 NV**, phân bố `30×7 · 2×5 · 3×4 · 3×3 · 1×2 · 2×1`. Job chạy thật: `total=success=245, failed=0`. **Ba nguồn khớp tuyệt đối**: preview 245 = `leave_balances` 245.0 = sổ cái `ACCRUAL` 245.00 (41 NV). **Idempotent đã chứng minh** (preview ngay sau khi cấp: `pendingTotal=0, alreadyGranted=245`). 45 quét = 41 cấp + 3 nghỉ trước 2026 (`1111`/`1119`/`1129`, đúng phần chênh so với 295) + 1 thiếu `start_date` (`1136`, bỏ qua **kèm báo cáo**).
- **Công tắc đúng là công tắc:** `accrual_method='None'` ⇒ `policies: []`, `totalDays: 0`. Merge PR thật sự = 0 thay đổi dữ liệu.
- **G6 `--strict`: 10 PASS · 0 FAIL · 0 SKIP** trên staging dữ liệu thật. Seed 4 tài khoản UAT trước nên **không ca nào SKIP ngầm**.
- **Seed demo KHÔNG nghiệm thu được** — 245 là hàm của `start_date`/`end_date` của 45 hồ sơ `funtime`. Phải clone PROD. **Bẫy: `backup-db.sh` dump `--no-owner --no-privileges`** ⇒ restore bản đó thì `mediaos_app` mất sạch grant, API chết `28P01`/permission denied. Clone cho staging phải `pg_dump --format=custom` **CÓ** owner+ACL (verify sau restore: 463 grant · 155 FORCE RLS · 172 policy).
- **Hai lệch cấu hình staging sẽ gặp lại:** (1) role Postgres là **CỤM-rộng** — `mediaos_app` chỉ có MỘT mật khẩu (theo `.env` PROD), `.env.dev-online` giữ bản cũ ⇒ `FATAL 28P01`; (2) `PLATFORM_SUPERADMIN_COMPANY_SLUG`/`STAGING_SEED_COMPANY_SLUG` = `demo` trong khi clone là `funtime` ⇒ `SuperAdminBootstrapService` sập lúc boot.
- **`RC-004` KHÔNG áp dụng được** (nói rõ để không ai đọc thành đã diễn tập): PROD đã ở head `0537` nên **không còn migration nào đang chờ** để diễn tập. G6 chỉ đóng `RC-003`.
- **Đã dừng staging sau khi lấy xong bằng chứng** — clone mang PII thật, `cian-dev.*` trả 200 công khai, và `.env.dev-online` có `TWO_FACTOR_ENFORCEMENT_ENABLED=false` ⇒ staging là **đường vòng qua 2FA của PROD**. `m dev-online-stop` ⇒ 502. **DB `mediaos_dev` vẫn giữ dữ liệu thật** — dựng lại là lộ lại.
- **#324 (chờ owner merge):** 2 lỗi ĐANG SỐNG trên PROD — `leave-type-form.ts` còn regex lowercase-only ⇒ **mọi loại nghỉ đã seed không lưu được** (cùng họ cửa-một-chiều với #323); key i18n `codeInvalid` treo (được `leave-policy-form.ts` đã ship ở #323 tham chiếu nhưng chưa từng tồn tại).
- **G9 xong nhưng phải cắt HAI tag — bài học thứ tự.** `v1.0.0-rc.1` bị cắt tại `6f160b9a` **trước** lần build lại cuối, PROD sau đó chạy `a968fcfe` ⇒ tag không trỏ bản đang chạy, mà phần chênh đúng bằng #324 nên **rollback về `rc.1` = đưa FE về đúng bản lỗi màn Loại nghỉ vừa vá**. Tag không bao giờ move (`RELEASE-05` §6.2 quy tắc 4) ⇒ đã cắt **`v1.0.0-rc.2` @ `a968fcfe`**, xác minh `RC-BUILD-MATCH` ✓. **Mốc rollback đúng = `rc.2`.** Luật rút ra, đã bake vào `RELEASE-08` §2: **deploy → `--expect-commit` → MỚI tag**. Kèm bẫy đọc số: `data.build.version` lấy từ `package.json` nên **không đổi** giữa các rc (cả rc.1 lẫn rc.2 đều in `1.0.0-rc.1`) — định danh có thẩm quyền là `data.build.commit`.
- **PROD hiện tại:** `a968fcfe` · builtAt 2026-08-02T02:33:15Z · head `0537` (205/205) · release `20260802-023315__1.0.0-rc.1__a968fcfe` (**hết `-dirty`**). Bản vá FE của #324 đã **xác minh live trong bundle thật** (`LeaveTypesPage-CxkNjNmC.js` có `A-Za-z0-9_-`, 0 dấu vết regex thường-only; `master-data-fields-DXdSbJVm.js` có `codeInvalid`) — không tin workflow xanh, kiểm bundle.
- **`KI-058` — lỗi TO nhất phiên, tìm ra chỉ vì owner hỏi "màn đó ở đâu": 4 màn QUẢN TRỊ LEAVE không vào được từ UI** dù quyền trong DB có đủ (PR #325, đã deploy `30540ab0`). Cơ chế: `getCapabilities()` lọc bỏ **toàn bộ** cặp `is_sensitive`; chỉ cặp trong `SENSITIVE_CAPABILITY_ALLOWLIST` mới được `getAllowlistedSensitiveCapabilities()` trả lại FE. 10 cặp gác LEAVE-SCREEN-010/011/012 + Giao dịch số dư chưa bao giờ được thêm ⇒ `/auth/me` không trả ⇒ **màn ẩn với đúng vai được cấp quyền**, im lặng hoàn toàn. **Chặn go-live** vì SCREEN-011 là đường DUY NHẤT bật `accrual_method`. **Vì sao không lộ sớm:** chỉ `SA` dùng được, và chỉ nhờ TAI NẠN — `SA` có `*:*` (`is_sensitive=false`) nên lọt fallback wildcard của `useCan()`; màn dùng `useCanExact()` thì SA cũng trượt. Đây là **lần lặp thứ 8+** ⇒ đã kèm **test khoá** `SENSITIVE_SCREEN_GATE_PAIRS` ⊆ allowlist để CI đỏ thay vì ẩn im lặng. **Bài học phương pháp:** "quyền có trong DB" KHÔNG kết luận được "người dùng thấy màn" — phải kiểm **đường CAPABILITY tới FE**, không chỉ `role_permissions`.
- **RED-proof của chính tôi từng vô hiệu:** `sed 's/^  "view:leave-policy",$//'` khớp **CẢ HAI** chỗ (allowlist lẫn `SCREEN_GATE_PAIRS`) ⇒ test vẫn xanh = xanh giả. Gỡ đúng MỘT vế mới đỏ. Khi RED-proof bằng sed trên file có hằng lặp lại: **đếm số match trước khi tin**.
- **Deploy lệch định danh 2 LẦN LIÊN TIẾP, cùng một gốc: `m prod-update` build từ CÂY ĐANG CHECKOUT.** Lần 1 deploy ngay sau merge mà chưa `git pull` ⇒ PROD mang `6f160b9a` (tổ tiên master). Lần 2 tệ hơn: còn đang đứng trên nhánh feature ⇒ PROD mang `f2795ab4` = **commit CHỈ có trên nhánh**, xoá nhánh là sha mồ côi. Nội dung cả 2 lần đều đúng (verify `git diff` toàn cây rỗng) nên không lỗi runtime — nhưng định danh sạch, không `-dirty`, **không có tín hiệu cảnh báo nào**. **Luật: `git checkout master && git pull` TRƯỚC `m prod-update`, rồi `--expect-commit` sau.**
- **Tag: đã đi tới `v1.0.0-rc.3` @ `30540ab0`** (khớp PROD, `RC-BUILD-MATCH ✓`). `rc.1`/`rc.2` **CẤM dùng rollback** — rc.1 thiếu #324 (loại nghỉ không lưu được), rc.2 thiếu #325 (4 màn admin biến mất). Tag không move được nên mỗi lần lệch là một rc mới; **đừng cắt tag trước khi deploy xong**.
- **✅ ACCRUAL ĐÃ CHẠY THẬT TRÊN PROD (07:10Z) — chặn go-live về phép ĐÃ GỠ.** Owner bật `Monthly` lúc 06:58:50Z qua `/leave/policies`; job cấp **245 ngày / 41 NV, failed=0**; ba nguồn khớp tuyệt đối (job 245 = `leave_balances` 41 dòng/245.0 = sổ cái 245 dòng/245.00) — **đúng bằng số nghiệm thu đo trước trên staging**, kể cả phân bố `30×7·2×5·3×4·3×3·1×2·2×1` và 4 hồ sơ không được cấp (`1111`/`1119`/`1129` nghỉ trước 2026 + `1136` thiếu `start_date`). Còn lại cho HR: điền `start_date` cho `1136`.
- **Bẫy khi chờ job — suýt kết luận sai là "engine hỏng":** 3 lần chạy 06:15/06:30/06:45 trả `total=0` vì chúng chạy **TRƯỚC** lúc bật công tắc (06:58:50Z). Và **nhịp 15 phút reset theo lần KHỞI ĐỘNG API**, không phải chạy đều theo đồng hồ: API restart 06:55:54Z ⇒ nhịp đầu rơi vào 07:10:54Z chứ không phải 07:00. **Tính nhịp từ giờ boot, đừng suy từ lần chạy trước.**
- **CÒN TREO:** ① HR điền `start_date` cho `1136` (engine tự bù nhịp sau). ② rotate 3 mật khẩu DB (từ phiên trước). ③ `S7-CHAT-DOC-1` WIP ảo. ④ **G1 · G7 · G8 · G10** cần người/Administrator. ⑤ DB `mediaos_dev` vẫn giữ bản sao dữ liệu PROD thật — dựng lại staging là lộ lại PII kèm đường vòng qua 2FA; xoá bằng `DROP DATABASE mediaos_dev WITH (FORCE)` khi không còn cần cho UAT.
- **Friction:** (1) `.env` có giá trị chứa **khoảng trắng không trích dẫn** (dòng 51/79) ⇒ `set -a; . ./.env` in `command not found` — vô hại cho biến khác nhưng gây hoang mang; (2) cột `system_job_runs` là `total_items/success_items/failed_items` (KHÔNG phải `*_count`) — poll sai tên cột thì `2>/dev/null` nuốt lỗi và vòng lặp **im lặng mãi mãi**, trông hệt như "job chưa chạy"; (3) scheduler system-jobs chạy **mỗi 15 phút**, không phải 60s, và **không chạy ngay lúc boot** ⇒ phải chờ đúng một nhịp; (4) `jq` KHÔNG có trong Git Bash của máy này.

## Phiên 2026-08-01 (session 402e3d7c) — cửa sổ go-live: 4 WO SHIPPED (#317 · #320 · #321 · #322) + 4 quyết định owner

> Vào phiên để "kiểm tra tình hình", ra khỏi phiên với **module LEAVE được cứu khỏi chết ngày đầu go-live**. Master `3929e31a`. **HẾT item code** — còn lại thuần triển khai.

- **Phát hiện chặn go-live mà không doc nào ghi:** `leave_balances` = **0 dòng / 45 NV**, trong khi `ANNUAL`·`COMPENSATORY`·`SICK` đều `deduct_balance=true` và `allow_negative_balance` NULL(⇒false) ⇒ `available=0` ⇒ **MỌI đơn nghỉ 3 loại đó bị 422** ngay ngày đầu (`leave-request.service.ts:545`). `KI-002` từng đóng lỗ này **cho company `demo`** — công ty thật `funtime` chưa bao giờ được nhập.
- **Owner chốt 4 quyết định cơ chế phép (D-A1…D-A4)** + chọn **làm ĐỦ cả hai engine TRƯỚC go-live** (dời ~3-5 ngày) thay vì vá tạm: cộng dồn vào **ngày cuối tháng** · bù kỳ đã qua **theo ngày vào làm** · mốc hết hạn + trần chuyển tiếp **cấu hình được, mặc định 31/03** · bật/tắt **theo từng chính sách**. Thêm **S-1** (SICK bỏ trừ quỹ — chạy được trên bản PROD hiện tại, KHÔNG cần deploy) và **C-1** (COMPENSATORY giữ trừ quỹ, HR cấp tay; số dư 0 ngày đầu là ĐÚNG, cần một câu trong thông báo go-live).
- **Số nghiệm thu tính TRƯỚC khi viết code — dùng nó chấm engine:** backfill 2026 phải ra **đúng 295 ngày**, phân bố `40 NV×7 · 2×5 · 1×4 · 1×1`; `employee_code 1136` (thiếu `start_date`) phải **bị bỏ qua kèm báo cáo**, không được bịa. Engine ra số khác ⇒ engine sai, không phải số sai.
- **Bẫy lớn nhất phiên này — ghi memory `ui-promises-backend-never-reads`:** cột cấu hình có đủ mọi tầng TRỪ tầng thi hành. Bắt được **2 lần cùng module**: `accrual_method` (form cho chọn `Monthly`, 0 engine đọc) và `max_negative_days` (form cho nhập trần, `leave-request.service.ts` không hề nhắc tới ⇒ cho-âm = **vô hạn**). Kiểm bằng grep **ĐƯỜNG QUYẾT ĐỊNH**, không phải grep toàn repo — toàn repo luôn có hit từ repo/mapper/DTO/form và chính đám đó tạo cảm giác "đã dùng rồi".
- **Và phải kiểm CẢ HAI đầu luồng:** vá `submit` xong mới lộ `approve` chặn cứng ở `used + delta <= total`, không đọc trần ⇒ đơn nợ phép **nộp được nhưng không bao giờ duyệt được**. Vá một đầu = để lại tính năng bấm-không-chạy.
- **Doc vs thực tế lệch 3 chỗ, 1 chỗ chặn go-live OAN — CHƯA SỬA:** `RELEASE-10` ô #8 nói PROD tồn đọng `0535` (thực tế DB **203/203, ở head**) · **`KI-006` đánh dấu chặn go-live** nhưng `LMS_NOTI_TOKEN` **đã đặt** ở cả `.env` lẫn `.env.prod` và có notification `LMS_ENROLLMENT_APPROVED` thật 31/07 ⇒ nên ĐÓNG · `KI-003` (3 loại nghỉ trùng chữ thường) thực tế 8 loại code HOA, sạch.
- **`ops-alert-check` từng trả CRIT GIẢ:** gate bằng mtime file rồi đếm mọi chữ `ERROR` trong 2MB cuối, không nhìn timestamp dòng ⇒ 5 ngày lịch sử thành "1787 lỗi trong 60 phút". Đã vá ở #321 (đếm theo timestamp từng dòng + xoay log; `api.out.log` từng phình **721 MB**).
- **Bổ sung 2026-08-02 — hai quyết định phép ĐÃ ÁP THẬT trên PROD, kèm một lần đổi ý:** `SICK` bỏ trừ quỹ (**S-1**, đúng kế hoạch) · `COMPENSATORY` **cũng bỏ trừ quỹ** — tức phương án **C-2**, KHÔNG phải C-1 như chốt ban đầu. Owner chốt giữ nguyên ⇒ ghi thành **`KI-057`** (`S3` 19→20). Hệ quả phải nhớ: **không còn cơ chế nào đối chiếu nghỉ bù với giờ làm thêm**, chốt chặn duy nhất là bước DUYỆT của quản lý — thông báo go-live phải nói rõ điều này. Gỡ về C-1 bằng 1 thao tác: `/leave/types` → `COMPENSATORY` → tick lại *Trừ số dư phép*.
- **Bổ sung 2026-08-02 — `S6-LEAVE-TYPEADMIN-1` (#323) đã ship và ĐÃ CỨU đúng tình huống nó sinh ra để cứu:** màn Loại nghỉ trước đó là **cửa một chiều** (đặt `inactive` xong không bật lại được vì màn quản trị đọc route active-only). Sự cố thật: `SICK` + `COMPENSATORY` bị đặt `inactive` lúc 13:54Z, nhân viên mất luôn quyền xin nghỉ ốm. Sau khi #323 lên PROD, owner **bật lại bằng chính màn hình vừa vá** lúc 18:38Z — có vết `LeaveTypeUpdated` chuẩn, không phải vá tay DB. **Bẫy CI kèm theo:** thêm route ⇒ ĐỎ cổng kiểm kê (`route MỚI chưa có trong artifact`); phải `ROUTE_CENSUS_WRITE=1` regen `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json`. Chạy `src/**` KHÔNG bắt được — cổng này nằm ở `test/foundation/**`.
- **CÒN TREO — đọc trước khi làm tiếp:**
  1. **PROD chưa nhận gì cả**: vẫn `14306b8a` / `migrationHead 0535` / `leave_balances` = 0. Bốn WO chỉ nằm trong repo.
  2. **Rotate 3 mật khẩu DB** (`APP_/WORKER_/SUPERUSER_DB_PASSWORD`) — phiên này lỡ in ra transcript do lỗi quoting. `scripts/rotate-db-roles.mjs`, **verify TỪ HOST** (qua `docker exec` rơi vào `pg_hba` trust nên mật khẩu nào cũng qua).
  3. **`S7-CHAT-DOC-1` đang hiện `in_progress` là WIP ẢO** — start-on-touch bắt nhầm vì WO này khai `harness/backlog.mjs` trong `paths`, mà cả hai phiên đều sửa file đó. Nội dung của nó có vẻ đã land ở #319. **Đừng tin dấu này**, verify `done_when` rồi mới đóng tay.
  4. Ca đua song song cho trần nợ phép chưa có test (vị từ nằm trong `WHERE` của `UPDATE` nên nguyên tắc là atomic, nhưng chưa chứng minh).
  5. Chuỗi còn lại: **G4** cutover 🛡️ → **G5** staging → **nghiệm thu 295 ngày** → **G6** → deploy PROD sạch → **G9** tag → G7/G8/G10.
- **Friction:** (1) **Có phiên thứ hai (`69de512c`) làm việc trong CÙNG worktree** — nó seed 16 WO `S7-*` và build PROD lúc 00:03/00:11Z trong khi phiên này đang chạy. Luôn `claim.mjs list` + đối chiếu `git status` trước khi tin cây làm việc là của mình; commit phải **stage đúng path của mình**, cấm `git add -A`. (2) **Chạy int-spec với LANE_DB lặp lại 2 lần vấp:** nạp `.env` thì `DATABASE_URL` trỏ DB PROD **đè** `LANE_DB` và bị `S6-SEC-DBFENCE-1` chặn (đúng). Câu đúng: `set -a; . ./.env; set +a; unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL; export LANE_DB=mediaos_<lane>`. Friction này đã xuất hiện ≥2 lần ⇒ **ứng viên `skill-smith`**. (3) Nhớ `DROP DATABASE mediaos_<lane>` sau khi xong (pgdata từng phình vì 325 lane DB).

## Phiên 2026-07-20 (session dc2add15) — S5-TASK-SUBTASK-1 🔴 SHIPPED (#247 MERGED → master `1cf12a45`)

> Owner chốt trong phiên ("ok chốt") = duyệt **D-31** (đóng SPEC-06 §24 Q#14: CÓ subtask, checklist giữ song song) + **D-40** (rail avatar CÓ tính việc con) và uỷ quyền merge → squash --admin. Nhánh local/remote đã dọn, backlog `done`, ledger `finished`. **DEPLOY CÒN CHỜ: dev-online cần `m dev-online-db` (CÓ mig 0503) — owner tự chạy.** Các mục dưới viết lúc PR còn mở, vẫn đúng nội dung.

- **Ship (PR #247, nhánh `feat/s5-task-subtask-1`, 9 commit):** việc con THẬT qua `parent_task_id` (cột có sẵn 0478 ⇒ KHÔNG migration cột) — cây ĐÚNG 1 cấp + **khoá hàng MỘT LẦN** (`SELECT … ORDER BY id FOR UPDATE` trên TOÀN BỘ tập hàng chạm, id tăng dần, mọi đường ghi) · ẩn khỏi board & `state_id` NULL chốt ở **CẢ BA** writer · xoá lan tất-cả-hoặc-không (D-38) · **đếm-lá** (D-34) áp 3 nơi CÙNG release (MV mig 0503 · báo cáo dự án · widget project-progress) · TASK-API-701/702 · FE panel + badge + ghi chú quy tắc đếm. ADR **DECISIONS-05** (D-31…D-41 + D-36a).
- **Plan qua 3 vòng plan-reviewer đối kháng: 9 → 3 → 2 → PASS.** Mọi claim tự xác minh lại trên code thật trước khi vá. Vòng nào cũng tìm ra lỗi CÙNG MỘT HỌ ⇒ bài học ghi ở đầu ADR: **bất biến phải kèm DANH SÁCH WRITER, chốt ở method dùng chung, không rải ở route**.
- **Int-spec bắt lỗi CRITICAL mà typecheck + 255 unit test đều mù:** bind mảng SQL sai (`${arr}` sinh record thay vì mảng) ⇒ **500 hàng loạt** trên `DELETE /tasks/:id`, `GET /tasks/:id`, kanban mọi dự án — tức phá tính năng ĐÃ SHIP. Xem memory `drizzle-array-bind-sql-param`.
- **Lỗ trong bằng chứng của chính mình:** đã báo "255/255 xanh" khi MỚI chạy `src/**` mà CHƯA chạy `test/integration/**` — nơi chứa deny-path/IDOR/board thật. Memory `src-green-is-not-integration-green`.
- **FULL gate 3 reviewer đều BLOCK → vá 8 finding:** oracle dò trạng thái ở `createTask` (kiểm cấu trúc trước kiểm quyền ⇒ đoán UUID đọc được nhiều bit ngoài phạm vi) · **mapper THỨ BA** (`TaskActionsService.toDto`) ⇒ đã HỢP NHẤT cả ba · FK `ON DELETE SET NULL` thiếu danh sách cột ⇒ null hoá cả `company_id` (NOT NULL), hiện bị che bởi thứ tự trigger RI phụ thuộc OID · 409 "unreachable" thật ra với tới được + trả thông điệp QUYỀN cho ca ĐUA (tách `TASK-ERR-048`) · reorder ghi `updated_by` lên con ngoài phạm vi · filter toàn cục ép kiểu `details` mù · index lá thành partial (769→4 buffer).
- **Verify:** API **6398/6398** tuần tự (`LANE_DB=mediaos_check`) · int-spec việc con + kanban regression 46/46 · app 1265 · web-core 587 · lint/typecheck xanh.
- **Friction:** (1) `check.sh --lane-db` ĐỎ **2 lần liên tiếp** vì crash worker vitest `ERR_IPC_CHANNEL_CLOSED` — **0 ca test đỏ** trong log, suite chết giữa chừng; phải chạy tuần tự mới có số xác định (memory `vitest-worker-crash-chunked-runs` áp nguyên văn, nhưng nay xảy ra ở CẢ api LẪN app). (2) `git push` SSH fail "Could not read from remote" trong khi `ssh -T git@github.com` OK ⇒ retry với `GIT_SSH_COMMAND="ssh -o BatchMode=yes"` là qua; `gh auth status` báo token keyring hỏng nhưng `gh pr create` vẫn chạy. (3) Lệnh `git commit -m` với nội dung chứa `$1`/`(` bị shell nuốt — dùng `-F -` + heredoc trích dẫn đơn.

## Phiên 2026-07-20 (session b83a39b8 tiếp) — S5-DASH-TASKSTATUS-FIX-1 🔴 SHIPPED (#246 MERGED → master `880c7642`)

> Owner ra lệnh "merge luôn 246" → squash --admin (= chốt D-30). Nhánh dọn sạch, ledger done. **Deploy còn chờ: dev-online cần `m dev-online-db` (CÓ migration 0502) — owner tự chạy.** Các mục dưới viết lúc PR còn mở.

- **Ship (PR #246, nhánh `feat/s5-dash-taskstatus-fix-1`):** mig **0502** — `mv_dashboard_task_status` đếm trạng thái CANONICAL `COALESCE(task_status, map(status legacy))` (**ADR DECISIONS-03 D-30**, map not_started→Todo · in_progress/revision→In Progress · waiting_review→In Review · approved/completed→Done; GROUP BY positional BẮT BUỘC; WITH DATA populate ngay trong migrate; GRANT lại đúng trạng thái cuối 0103). Số liệu thật đo trước: dev 22/22 task hiện đại sai, prod 114 task legacy "đúng tình cờ". Vá kèm `dashboard-refresh.service`: CONCURRENTLY CHỈ task_status (output = index BIỂU THỨC, không bao giờ CONCURRENTLY được — lộ ngay lần đầu sau 0502).
- **RED-first đúng nghĩa:** spec chạy ở head 0501 → 3 fail đúng lý do → 0502 → 6/6; C6 RED→GREEN cho nhánh refresh-lặp. FULL gate 4 reviewer PASS (plan/security/DB/silent-failure). CI #246 10/10 (Migrate·Test chạy 0502 thật).
- **NỢ KIẾN TRÚC G14 phát hiện (chưa sửa — ứng viên WO `S5-DASH-REFRESH-ROLE-1`):** refresh qua workerDb hỏng TỪ G14 ("must be owner"); CẤM vá bằng ALTER OWNER cho worker — worker không BYPASSRLS + tasks FORCE RLS ⇒ MV RỖNG LẶNG LẼ (đã kiểm chứng pg_roles/pg_class; ghi jsdoc chống vá mù).
- **Chờ owner:** chốt D-30 + `gh pr merge 246 --squash --admin`. Deploy: CÓ migration ⇒ dev-online cần `m dev-online-db`.
- **Bẫy gặp lại đúng memory:** vitest full-suite IPC crash → 4 shard; foundation-audit đỏ trên lane BẨN từ run crash → reset lane sạch là xanh (vitest-worker-crash-chunked-runs áp nguyên văn); `pnpm db:migrate` mặc định trỏ DB dùng chung — CHỈ migrate lane.

## Phiên 2026-07-20 (session 09a26423) — 6 WO SHIPPED qua 2 PR (#248 `6d9b245f`, #249 `239d7b69`)

- **Owner giao 1 WO (`S5-TASK-COVER-1`), thực tế phải xử lý 6.** Vào phiên thì phát hiện **~1055 dòng của 5 WO nằm trần trên `master` cục bộ: chưa commit, chưa PR, không có dòng ledger nào** — gồm chính `S5-TASK-AVATAR-1` mà COVER-1 `depends_on`. Owner chốt ship trước.
- **PR #248** (S5-TASK-BOARD-UX-1 · INLINE-1 · AVATAR-1 · CARDSUB-1 · MOVEPROJ-1): FULL gate trả **BLOCK 4 HIGH**, tự xác minh từng cái rồi vá + 9 test khoá. Đáng nhớ: (1) `useTaskActionMutation.onSuccess` GHI ĐÈ cache chi tiết bằng `result.task` mà `respond()` không mang `subtaskTotal` ⇒ mất thanh tiến độ VÀ mở khoá nút đổi dự án cho task có việc con ⇒ bấm là 400; (2)+(3) 4 route action và `DeleteTaskFileDialog` không invalidate `taskKeys.kanban`; (4) MOVEPROJ-1 **vẫn để lọt đúng bug nó sinh ra để vá** qua 3 cửa (option "Không thuộc dự án" · dự án đích 0 cột · đua tải cột).
- **PR #249 (`S5-TASK-COVER-1`, 🔴 red, KHÔNG migration).** **Tiền đề WO SAI:** `linkType='Cover'` không tồn tại (CHECK `chk_file_links_link_type` mig 0433:159 + `FILE_LINK_TYPE_VALUES` đều không có) nên "dùng Cover" mâu thuẫn với chính lời hứa "KHÔNG CẦN MIGRATION". Owner chốt phương án thật: **ảnh bìa = dòng `Attachment` của task được bật `is_primary`**; unique index `uq_file_links_primary_per_entity_type` ép sẵn 1 bìa/task. Backlog `src[]`/`done_when[]`/`paths[]` đã sửa **trọn 4 câu sai**.
- **Chốt an toàn = VỊ TỪ ĐỘC QUYỀN** ở đường ĐỌC (`findVerifiedTaskCoversTx`): tệp còn link sống ở entity KHÁC thì KHÔNG BAO GIỜ được ký. Vì đường tải thật đi qua `FilePolicy.decideForLinkedFile` = AND-khắt-khe-nhất trên MỌI link, thiếu vị từ này thì ảnh CCCD/hợp đồng (link cả HR cả task, đang 403 khi tải) sẽ hiện làm bìa cho cả board. ⚠️ **CẤM thêm `fl2.company_id` vào `NOT EXISTS`** — ở `NOT EXISTS` mọi điều kiện thêm là **fail-OPEN**, ngược phản xạ "AND company_id tường minh" của repo này.
- **FULL gate #249: 2 reviewer độc lập đều BLOCK, 6 finding + 1 lỗi TỰ SOÁT.** Nặng nhất (không ai trong 3 vòng plan-review thấy): **board gate bằng cặp `view-kanban:task` còn đường TẢI gate bằng `read:task`**; `data_scope` là PER-(permission,role) nên `view-kanban@Company` + `read@Own` làm board ký ảnh GỐC full-res cho người KHÔNG tải được tệp. Seed 0485 hiện cấp cùng scope cho 4 role ⇒ chưa khai thác được, nhưng đó là **may mắn cấu hình**. `getBoard` giờ resolve RIÊNG `read:task`. Kèm: `onError` đặt `display:none` thẳng lên DOM + thẻ `key={task.id}` ⇒ React tái dùng `<img>` ⇒ **ảnh ẩn VĨNH VIỄN** sau 1 lần hết TTL; `23505→409` ghi trong DoD mà **chưa implement**; xoá tệp-đang-là-bìa không invalidate board (URL đã ký VẪN tải được vì soft-delete chỉ ở DB).
- **Bài học lặp lại 3 lần trong phiên — sửa một chỗ, để nguyên chỗ mâu thuẫn:** plan rev2 vá §5 nhưng §8 vẫn dặn ngược lại; rev3 grep toàn file bắt thêm 3 chỗ; sửa backlog grep tiếp bắt 4 câu (dự tính 3). **Luật:** sửa tài liệu/plan xong phải grep TOÀN file theo từ khoá vừa đổi.
- **Bẫy suýt gây xanh-giả:** plan rev1 đặt int-spec ở `apps/api/src/**/*.int-spec.ts` — KHÔNG khớp glob nào của `vitest.config.ts:47` (glob 1 cần `.spec.ts` chấm, file là `-spec.ts` gạch) ⇒ 18 ca deny-path chạy **0 ca** mà gate vẫn PASS. Memory `vitest-unit-specs-must-be-colocated` đã cập nhật cả chiều ngược.
- **Verify #249:** int-spec **21/21** lane `mediaos_cover1` (gồm ca bật `is_primary` VÒNG QUA service ⇒ đường đọc vẫn trả null, ca primary MỒ CÔI sau soft-delete, ca board fail-closed khi thiếu `read:task`) · API 16 file/312 test · app 177 file/1336 test · `TURBO_FORCE=1` typecheck 10/10 + lint 7/7 (0 cached) · CI 9/9 xác minh từng job.
- **Friction:** (1) CI #248 đỏ 1 lần do LỖI QUY TRÌNH của tôi — chạy typecheck TRƯỚC khi viết spec rồi chỉ chạy lint+test (lint không typecheck, vitest transpile chứ không type-check). (2) Flake `app.close-order` cắn #248: `cleanupTenants` chạy TRƯỚC `app.close()` ⇒ outbox worker còn sống ghi `audit_logs` mang `actor_user_id` giữa lúc xoá users ⇒ vỡ FK. Re-run xanh. int-spec mới của COVER-1 đã đóng app TRƯỚC cleanup để không nhân bản.
- **Nợ ghi nhận:** `is_primary` còn true nhưng tệp mất điều kiện về sau (scan lật Infected) ⇒ `isCover` false ⇒ nút gỡ ẩn, không có lối gỡ cờ trên UI (không nguy hiểm — đọc fail-closed, `clearCover` vẫn hạ được) · đổi bìa qua `/foundation/files/:id/links` không sinh activity TASK · WO dọn flake `app.close-order` cho các spec còn lại (`att-noti-e2e`, `att-core-tenant-deny`, `att-qa1-canonical-roles-gate`, `task-qa1-fsm-collab`).

## Phiên 2026-07-19g (session b83a39b8) — S5-TASK-DETAIL-1 SHIPPED (#245 MERGED → master `6489162a`)

> Owner review + ra lệnh merge trong phiên ("ok review 245 rồi merge") → squash --admin, master `6489162a`, nhánh local/remote đã dọn, ledger done (reconcile bởi gen-status). Các mục dưới viết lúc PR còn mở — vẫn đúng nội dung.

- **Ship (PR #245, nhánh `feat/s5-task-detail-1`, 2 commit):** 4 gap màn chi tiết task TRONG SPEC — (1) timeline "cũ → mới" §13.12 (`activity-change.ts` + enrich `assigneeName` server-side lúc đọc, batch IN, chỉ UUID hợp lệ); (2) **D-29** (DECISIONS-04): `GET /tasks/:id/activity` guard → `read:task`, service = pair-audit-override HOẶC người-liên-quan (assignee/creator/reporter/watcher), ngoài cuộc 403 TASK-ERR-042, 404-trước-403; feed dự án GIỮ sensitive; (3) `reporterName` (additive optional) — đủ 3 vai; (4) `GET /tasks/:id/watchers` (tách `TaskWatchersService`) + FE Theo dõi/Bỏ theo dõi self-only.
- **Gate:** security-reviewer PASS 0 CRIT/HIGH + 8 finder angle (code-review skill) → 8 finding vá ở commit 2 (ew.company_id watcher-branch · UUID-filter chống 500 · file <800 dòng · bỏ optimistic flag kẹt nút · invalidate `taskKeys.activityOf` · formatDateTime pin TZ · key i18n chết · test V11 biên guard). Verify: int-spec mới 15/15 (lane `mediaos_tdw1`) · chunk src/tasks+3 int-spec cũ 352/352 · app 1249 · web-core 584 · lint/typecheck xanh.
- **Spec cũ đổi theo D-29 (chủ đích, không phải regression):** qa1-fsm-collab §5 emp-assignee giờ 200; qa1-permission-matrix GỠ pair `view:task-audit-log` khỏi deny-matrix (premise "403 chỉ từ guard" vỡ — phủ thay bằng int-spec mới); kanban-move-activity admin thêm `read:task`.
- **Follow-up ghi nhận (chưa làm):** PATCH `TASK_UPDATED` không ghi oldValues ⇒ đường sửa-qua-form chưa có dòng cũ→mới · hợp nhất định nghĩa involvement (isUserInvolvedTx vs TaskAudienceReader vs findMyTasksTx) thành TaskRelationshipService · cân nhắc cờ `canViewActivity` trong DTO thay hide-on-403.
- **Kế:** owner merge #245 (classifier chặn self-merge — lệnh: `gh pr merge 245 --squash --admin`) → `S5-TASK-SUBTASK-1` (🔴 red, cần plan→plan-reviewer) · WO dọn follow-up · chuỗi QA S5. Dev-online xem được cần `m dev-online-fast` (không migration).
- **Friction:** (1) lặp lại — classifier chặn merge tự hành ⇒ flow PR+CI+đưa lệnh owner (lần ~5). (2) Nút disable theo `isFetching` làm FE spec phải chờ list settle trước khi click — pattern test cần nhớ.

## Phiên 2026-07-19f (session 45cf048b) — đợt D1 S5-TASK-WORKSPACE-1 SHIPPED (#243 → master `1cd45662`)

- **Ship:** vỏ workspace dự án — tab bar `?tab=` deep-link (validateSearch trên route, back/forward đúng; tab Báo cáo/Hoạt động ẩn theo useCanExact) + toolbar lọc chung Bảng↔Danh sách (state ở vỏ; 2 tab lọc qua CÙNG helper `workspace-constants` ⇒ parity theo cấu trúc) + rail avatar multi-select (`pinSelectedInSummary` ghim người đang chọn count-0). **BE build kèm TASK-API-601** GET /projects/:id/activity (sổ mã có sẵn, chưa ai build; int-spec lane DB 5/5) + vá 2 nguồn ghi activity thiếu `project_id` (TASK_WATCHER_REMOVED · TASK_FILE_*).
- **HOÃN "xuất khẩu"** (toolbar): chưa có cặp `export:task` + SPEC-06 §14.19 đòi ghi activity log khi export — CSV client-side sẽ lách log. Đã ghi backlog src; cần WO riêng nếu owner muốn.
- **Kế (thứ tự owner đã chốt trong task-ux-reference-benchmark):** 🔴 **đợt C quyền per-project** (data_scope Project chưa có trong engine — crown, cần plan→plan-reviewer) · `S5-TASK-DETAIL-1` · `S5-TASK-SUBTASK-1` · WO dọn follow-up (F1 orphan-state · 23505→409 · flake attendance-leave-sync app.close-order · S5-LEAVE-DEADCODE-1 🔴 · S5-SEQ-HARDEN-1 🔴) · chuỗi QA S5 (6 WO READY).
- **Friction:** (1) classifier CHẶN `gh pr merge --admin` cho phiên tự hành (lần ~4) — flow ổn định giờ là: PR + CI xanh + đưa lệnh merge cho owner. (2) vitest full-suite api segfault/IPC crash giữa run dài (máy này) — chạy CHUNK theo module là đủ bằng chứng local, CI là gate cuối. (3) Dev-online muốn thấy D1 cần owner chạy `m dev-online-fast` (không migration).

## Phiên 2026-07-02→03 (session eebe431a) — wave carry-over `feat/carryover-wave1`: 9 WO SHIPPED, 3 quyết định owner ĐÃ ÁP DỤNG

- **Shipped (merged vào feat/carryover-wave1, chưa lên master):** S3-FE-LEAVE-5 (#90) · S2-FE-AUTH-6 (#91) · S2-FND-DOC-1 (#92) · S2-AUTH-BE-8 (#93) · S2-AUTH-BE-9 (#95, resolve conflict với BE-8 giữ cả revoke+emit) · S2-AUTH-DOC-1 (#96) · S2-AUTH-BE-10 (#97) · S2-FE-FND-7 (#98) · S2-FND-BE-4 (#99). Việc kế: PR gộp `feat/carryover-wave1` → `master` (đi qua branch protection + review người).
- **Owner ĐÃ CHỐT + ĐÃ ÁP DỤNG (không còn pending):** (1) data_scope 'Project' = pin project-membership → D-22 DECISIONS-01 + DB-02 §4.7 (merged #96). (2) SENSITIVE_CAPABILITY_ALLOWLIST thêm 3 cặp export:leave · view:leave-audit-log · view:attendance-audit-log → WO mới S2-AUTH-CAP-1 (đã seed backlog, wave-1c đang chạy). (3) S2-FND-SEED-2 semantics: PATCH /hr/employee-code SYNC config→counter cùng tx, giữ current_value → bake vào re-run v3 wave-1c.
- **Pattern hiệu quả:** plan-block của plan-reviewer → bake nguyên văn điểm BLOCKING vào done_when qua args re-run (KHÔNG cần sửa backlog literal giữa wave). S3-FE-LEAVE-6 còn chờ S2-AUTH-CAP-1 merge rồi re-run (worktree ../mediaos-s3-fe-leave-6 đã sync base fdbcd36).
- **Bẫy lặp lại:** ship-agent fallback cắt branch từ wip HEAD → PR phồng + PR lạc base (#94 đã đóng) — xem memory harness-deploygate-pr-base (đã cập nhật cách cứu cherry-pick).

## Quyết định người-chốt chờ áp dụng (2026-07-02, session 1849d064) — auto-loop live nên CHƯA kịp bake vào retry đang chạy

- **S2-HR-BE-6** (Employee contracts): (1) GIỮ kỳ vọng ban đầu — seed grant RIÊNG Own cho employee + Team cho manager (không đổi QA-05 thành Company-only như plan-reviewer đề xuất phương án b). (2) Ngưỡng cảnh báo sắp hết hạn HĐ = company-configurable, mặc định 2 mốc: 30 ngày và 7 ngày (không phải 1 số cố định). ⚠️ Auto-loop đã retry S2-HR-BE-6 LẦN 2 (block khác: audit object_type 'employee_contract' thiếu trong AUDIT_OBJECT_TYPES/CHECK + permission pair chưa pin) — 2 quyết định trên CHƯA được bake vào round đó vì loop chạy live không có kênh inject giữa chừng. Áp dụng khi WO này tới điểm dừng (needs_human hoặc round kế).
- **S3-ATT-BE-5** (ATT Remote/Onsite): trạng thái khởi tạo = **Draft** (không phải default Pending hiện tại của bảng), cần action **submit** riêng (Draft→Pending) trong contract/API. Khi submit: người tạo chọn người duyệt trực tiếp HOẶC người duyệt thay thế, + danh sách người theo dõi (watcher) để nhận thông báo liên quan. Đây là thay đổi so với plan hiện có ở `docs/plans/S3-ATT-BE-5.md` (đang giả định create→Pending luôn, không có bước submit/watcher). WO chưa được auto-loop chạm lại trong phiên này — áp dụng khi pick up.
- **S2-AUTH-BE-7** (Session management API): CHỐT — KHÔNG seed permission pair riêng. Route GET/revoke sessions chỉ cần `Authenticated + owner-check` ở service layer (session.user_id === caller), giống pattern `/auth/me` + `/account/change-password` — không có phạm vi cross-user cần gate nên permission pair sẽ thừa. Route KHÔNG dùng `@RequirePermission`/`PermissionGuard` cho các endpoint self-service này.

## Phiên gần nhất (2026-06-20) — WAVE 2a fan-out 2 lane → merged master `2c1ac49`

- **Đã xong (Wave 2a, 2 lane song song)**:
  - **AUTH-FIX-1** (`67e7f2f`, 🔴 red→human-chốt): allow-list fail-closed `status==='active'` chặn CẢ 3 đường cấp token (login sau password.verify; refresh thu hồi family; **2FA step-2 — đường thứ 3 ask gốc bỏ sót**). 401 đồng nhất anti status-probing, reason chỉ vào audit_logs, không migration. Chạy qua **workflow** (Opus+plan+reviewer ĐỘC LẬP chạy ĐÚNG lần đầu nhờ fix pickReviewers — verdict LOW non-blocking). Verify: spec 10/10 + full api 2758 pass/0 fail.
  - **ACCT-2-FE** (`2c1ac49`, 🟡): UsersPage (TanStack Table + filter q/status + pagination + loading/error/empty) + suspend/delete/invite dialog; gating useCan/PermissionGate bằng hằng (manage/suspend/delete-user/invite:user); reuse `consoleInvitesApi` cho mời; api-client validate Zod. Verify master (web-core+ui rebuild): console **173/173** + typecheck OK.
  - Merge: FF authfix1 → rebase+FF acct2fe (khác vùng file, 0 conflict). Backlog: AUTH-FIX-1 + ACCT-2-FE = done.
- **Việc kế (Wave 2b)**: `PERM-UI-1` (③ phân quyền, crown — READY). Sau: `APP-MERGE-1` (cần PERM-UI-1). Solo: `TRIM-1`.
- **⚠️ Main tree đang GIỮA cuộc reframe lớn "de-media-fy" (83 file dirty, ADR 0022 mới, docs/spec/)** — diễn ra song song trong phiên, KHÔNG phải của lane agent. Harness bookkeeping Wave 2a (backlog status + STATUS regen + drop-lane fix `parallel-lanes.mjs`) CHƯA commit để tránh cuốn lẫn reframe → để owner commit cùng reframe HOẶC commit surgical theo lệnh.

## Friction / DEBT

1. ✅ **ĐÃ FIX (commit `3347358`)** — Reviewer ecc:* không tồn tại. `pickReviewers` giờ map vai-trò→agent CÓ THẬT (DB→rls-tenant-isolation-tester · security/silent-failure→general-purpose · react/typescript→completion-evaluator), gom theo agent (đa góc nhìn, không spawn trùng); reviewPrompt ép read-only mạnh hơn. Verified bằng dryRun. (Skills `ecc:santa-method`/`quality-gate` + build-resolver `ecc:*` vẫn là prompt-text, KHÔNG spawn nên không crash — để sau nếu cần.)
2. ✅ **ĐÃ FIX (Wave 2a, `parallel-lanes.mjs` CHƯA commit — xem cảnh báo reframe)** — workflow drop lane âm thầm khi stage1 (plan) trả `null` (lane skipPlan/non-crown): CONSOLE-1 ×2 + acct2fe (lần 3). Root-cause: pipeline drop item khi 1 stage trả falsy. Fix: stage1 trả sentinel `{__noPlan}` thay null (giữ item sống tới Implement), stage2 quy đổi sentinel→null cho prompt. Crown không ảnh hưởng (luôn có plan thật). Validate syntax OK (async-IIFE wrap). acct2fe Wave 2a dính bug TRƯỚC khi vá → cứu bằng Agent-tool workaround.
3. **Review agent `general-purpose` vượt quyền read-only**: đã Edit file acct2 dù dặn read-only (có quyền Edit). → dùng agent read-only (`Explore`/`rls-tenant-isolation-tester`) cho review, hoặc ràng buộc tool.
4. **DEBT — acct2 repo hardening CHƯA áp** (reviewer đề xuất, đã discard vì chưa review): thay `.select()`/`.returning()` → tập cột tường minh `ADMIN_USER_COLUMNS` + type `AdminUserRow` trong `admin-users.repository.ts` (+ chỉnh `service.ts`/`service.spec.ts`) → repo KHÔNG fetch `password_hash` (defense-in-depth #3). Master hiện dùng `select()`+toDto-strip — ĐÃ verify an toàn (test chứng minh không rò), nên đây chỉ là tăng cường. ~15', cần re-verify.
5. **AUTH-FIX-1** (backlog, red, sau ACCT-2): login chỉ lọc `deleted_at`, CHƯA chặn `status='suspended'` → user suspend vẫn đăng nhập (`auth.service.ts:302-306`).
6. baseline lint/typecheck ĐỎ (`@mediaos/api#lint`, `@mediaos/mobile#typecheck`) ⇒ Stop-gate `advisory`; dọn xanh rồi đổi `MODE='block'`.

## Bẫy đã biết (vận hành multi-lane)

- **Worktree mới**: cần `pnpm install` (chưa có node_modules) + build deps (`contracts/web-core/ui`) trước typecheck/test. Thiếu `.secrets/local-kek.bin` (gitignored) → 29 test crypto/2FA fail giả; main tree có sẵn, worktree mới phải regenerate.
- **DB cô lập**: verify trên DB lane riêng (`bash scripts/lane-db-setup.sh <lane>` + `export LANE_DB=mediaos_<lane>`), KHÔNG dùng `mediaos` chung (drift §9.6).
- **Xoá worktree trên Windows**: `git worktree remove` fail "Directory not empty" do node_modules → dùng `rm -rf <dir>` rồi `git worktree prune` + `git branch -d lane/*`.
- **Band migration**: lane v2 (acct2/ai1/console1) branch không khớp regex `g*`/`ac*` → `guard-migration-band` fail-open (không ép band); chỉ an toàn khi mỗi wave ≤1 lane sinh migration.

## Lịch sử

- Phiên 2026-06-19: FE-AUTH-1 (redesign login + 2FA) + ACCT-1 (self-service đổi mật khẩu/hồ sơ, wire route /settings/account) — đều land. Realign backlog v2 (auth·console·app).
- Phiên HARNESS-SPINE: dựng harness — backlog.mjs · gen-status.mjs · check.sh · init/finish.sh · handoff/policy/README · guard-scope (warn-only) · AGENTS.md.
