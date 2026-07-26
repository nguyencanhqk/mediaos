# RELEASE-05 — SCOPE FREEZE & RELEASE GOVERNANCE (Sprint 6 · WS1)

> Sinh trong `S6-GOV-1`. Khung: `IMPLEMENTATION-09` §8 · §10 (WS1) · §11.2 · §16.2 ·
> `DEVOPS-02` §6 · `DEVOPS-12` §6–§7 · `QA-08` §9–§10.
> **Hiệu lực từ: 2026-07-26** · build tham chiếu `master` `dcf85eb0` · migration head `0529` (197 file).
>
> Tài liệu này là **luật** cho 5 Work Order còn lại của Sprint 6
> (`S6-STAB-1` · `S6-QA-FINAL-1` · `S6-SEC-1` · `S6-PERF-DB-1` · `S6-REL-1` · `S6-GOLIVE-1`).
> Phủ deliverable `IMP09-DEL-WS1-001…005`.

---

## 1. Scope freeze có nghĩa là gì ở dự án này

Từ **2026-07-26**, phạm vi MVP **đóng**. Mọi thay đổi vào release phải lọt qua §4 (change control).
Freeze **không** đóng băng repo — vẫn commit, vẫn merge; nó đóng băng **cái được coi là MVP** và
**cái được phép chặn release**.

Ba thứ trước freeze đang trôi và được đóng ở đây:

| Trôi cái gì | Đóng ở |
| --- | --- |
| 4 nhánh ship ngoài 7 module MVP gốc (ME · GOAL · LMS · BRAND) chưa ai quyết in/out | §2 |
| Hai hệ tên severity song song (`S0…S4` của QA-08 vs `P0…P4` của IMPL-09 §11.2) | §5 |
| Chưa có version/tag policy — repo chỉ có 6 tag `archive/*`, `backup/*`, không có mốc release nào | §6 |

---

## 2. IMP09-DEL-WS1-001 — SCOPE FREEZE NOTE

### 2.1 Quyết định của owner (2026-07-26)

> 7 module lõi + Foundation ở mức **P0/P1** · **ME** ở mức **P1** · **GOAL · LMS · BRAND** nằm trong
> release nhưng ở mức **P2** — lỗi của chúng **không chặn RC**, chỉ ghi known-issue.

Quyết định này đóng dòng "Scope" đang treo ở `RELEASE-04` §3 và một phần `IMP09-IN-001`.

### 2.2 Ba tầng phạm vi

| Tầng | Nhánh | Mức chặn tối thiểu | Chặn RC? | Chặn sign-off nghiệp vụ? |
| --- | --- | --- | --- | --- |
| **T1 — MVP core** | AUTH · HR · ATT · LEAVE · TASK · NOTI · DASH · FOUNDATION/SYSTEM | flow **P0/P1** | ✅ có | ✅ có |
| **T2 — MVP mở rộng** | **ME** (`/me` Personal Hub, SPEC-09) | flow **P1** | ✅ có | ❌ không (không nằm trong 7 module ký nghiệm thu) |
| **T3 — Trong release, ngoài gate** | **GOAL** (SPEC-10) · **LMS** (`apps/lms` + điểm nối) · **BRAND** (logo/favicon) | **P2** | ❌ không | ❌ không |

Quy đổi sang bug: defect **T1/T2** mức `S0`/`S1` ⇒ **chặn RC**. Defect **T3** mức `S0` (lộ dữ liệu,
mất dữ liệu, sập hệ thống) vẫn chặn — vì `S0` là chặn theo bản chất, không theo tầng; `S1` trở xuống ở
T3 ghi vào `RELEASE-02` và đi tiếp.

> **Không hạ mức kịch bản đã gán.** `S5-UAT-1-UAT-KIT` §5 đã gán mức cho từng kịch bản (ví dụ
> `UAT-EMP-05` mở `/me` = P0). Freeze **giữ nguyên** các mức đó; tầng ở bảng trên chỉ định **mức chặn
> tối thiểu của nhánh**, không dùng để hạ kịch bản xuống.

### 2.3 Trong phạm vi MVP (đóng băng)

| Nhánh | Cái được coi là "xong" cho MVP | Spec |
| --- | --- | --- |
| AUTH | Đăng nhập/đăng xuất · phiên + refresh · đổi/đặt lại mật khẩu · 2FA · khoá tài khoản · vai trò + ma trận quyền + phạm vi dữ liệu · nhật ký đăng nhập | SPEC-02 |
| HR | Hồ sơ nhân viên (CRUD + mã tự sinh) · phòng ban/chức vụ/cấp bậc · hợp đồng · sơ đồ tổ chức · yêu cầu sửa hồ sơ · nhập hàng loạt · che dữ liệu nhạy cảm | SPEC-03 |
| ATT | Chấm công vào/ra theo giờ máy chủ · bảng công cá nhân/nhóm/công ty · đơn điều chỉnh công · đơn làm từ xa · báo cáo · xuất file | SPEC-04 |
| LEAVE | Số dư + sổ giao dịch · tạo/gửi/huỷ đơn · duyệt/từ chối theo phạm vi · đồng bộ sang ATT · loại phép/chính sách · lịch nghỉ · báo cáo | SPEC-05 |
| TASK | Dự án + thành viên + vai trò theo dự án · việc (CRUD, Kanban, việc con, checklist, bình luận, tệp) · việc của tôi · quá hạn · báo cáo dự án | SPEC-06 |
| NOTI | Chuông + đếm chưa đọc · danh sách + chi tiết + deep-link · đánh dấu đã đọc · tuỳ chọn nhận · mẫu + sự kiện · nhật ký gửi | SPEC-08 |
| DASH | Dashboard theo vai + widget theo quyền/phạm vi · quick action · suy giảm cục bộ khi widget lỗi | SPEC-07 |
| FOUNDATION | Cài đặt hệ thống/công ty · danh mục module bật/tắt · nhật ký kiểm toán (append-only) · tệp riêng tư mặc định · bộ đếm mã · ngày lễ · job nền · chính sách lưu trữ | SPEC-01 |
| ME *(T2)* | Trang cá nhân hợp nhất: hồ sơ · công · phép · việc · đào tạo · thông báo · bảo mật · tuỳ chọn | SPEC-09 |
| GOAL *(T3)* | Mục tiêu + phân rã + check-in + việc mẫu | SPEC-10 |
| LMS *(T3)* | Chỉ **điểm nối**: SSO-only · đồng bộ người dùng · tiến độ về `/me/training` · thông báo học tập về chuông | — |
| BRAND *(T3)* | Logo + favicon công ty áp lên toàn app | — |

### 2.4 Ngoài phạm vi MVP (không nhận vào release này)

PAYROLL · RECRUIT · ASSET · ROOM · CHAT · SOCIAL · mobile native · AI · INTEGRATION mở rộng ·
BI nâng cao · realtime WebSocket đầy đủ · đa-công-ty/SaaS · load test quy mô lớn ·
toàn bộ module **media/finance** (đã de-media-fy — code còn trong `apps/api` ở trạng thái **park**,
không phát triển, không tính vào MVP).

Danh sách defer chi tiết: `RELEASE-02` §4.

---

## 3. IMP09-DEL-WS1-003 — CRITICAL FLOW LIST (P0/P1)

Đây là danh sách **flow** (không phải kịch bản). Mỗi flow trỏ về kịch bản UAT nguồn ở
`S5-UAT-1-UAT-KIT` §5. **`S6-QA-FINAL-1` phải chạy hết CF-P0; CF-P1 ≥95%.**

### 3.1 P0 — không chạy được thì không go-live (18 flow)

| Mã | Flow | Vai | Kịch bản nguồn | Nhánh |
| --- | --- | --- | --- | --- |
| CF-01 | Đăng nhập · đăng xuất · phiên hết hạn không quay lại được | mọi vai | EMP-01, 02, 30 | AUTH |
| CF-02 | Home Portal chỉ hiện app được cấp quyền | mọi vai | EMP-03 | AUTH·FND |
| CF-03 | Gõ thẳng URL ngoài quyền → chặn 403, không lộ dữ liệu | Employee · Manager · HR | EMP-27 · MGR-17 · HR-19 | AUTH |
| CF-04 | Chấm công vào/ra theo giờ máy chủ, chặn chấm trùng | Employee | EMP-07, 08, 09 | ATT |
| CF-05 | Xem bảng công của mình, lọc theo kỳ | Employee | EMP-10 | ATT |
| CF-06 | Bảng công theo phạm vi (nhóm / công ty) | Manager · HR | MGR-06 · HR-11 | ATT |
| CF-07 | Duyệt đơn điều chỉnh công · **cấm tự duyệt đơn mình tạo** | Manager | MGR-07, 08 | ATT |
| CF-08 | Số dư phép hiển thị đúng | Employee · HR | EMP-11 · HR-13 | LEAVE |
| CF-09 | Tạo + gửi đơn nghỉ · chặn vượt số dư | Employee | EMP-12, 13, 14 | LEAVE |
| CF-10 | Duyệt / từ chối đơn nghỉ đúng phạm vi · **chặn duyệt người ngoài nhóm** · trừ/hoàn số dư · sinh thông báo | Manager | MGR-02, 03, 04, 05 | LEAVE |
| CF-11 | Việc của tôi + đổi trạng thái + ghi dòng thời gian | Employee | EMP-18, 19 | TASK |
| CF-12 | Giao việc + Kanban đổi cột giữ được sau tải lại | Manager | MGR-12, 13 | TASK |
| CF-13 | Chuông: đếm chưa đọc đúng · deep-link đúng đối tượng · đánh dấu đã đọc | Employee · Manager | EMP-21, 22, 23 · MGR-16 | NOTI |
| CF-14 | Dashboard theo vai, widget đúng quyền/phạm vi | mọi vai | EMP-06 · MGR-01 · HR-01 · ADM-01 | DASH |
| CF-15 | Hồ sơ nhân viên: danh sách/lọc · mở hồ sơ **che dữ liệu nhạy cảm** · thêm (mã tự sinh) · sửa (ghi audit) · duyệt yêu cầu sửa · xuất file **loại lương/CCCD** | HR | HR-02, 03, 04, 05, 08, 17, 18 | HR |
| CF-16 | Quản trị người dùng: tạo + cấp vai trò · khoá ⇒ không đăng nhập được · không lộ hash | Admin | ADM-02, 03, 04 | AUTH·FND |
| CF-17 | Sửa quyền vai trò ⇒ **đổi hành vi ngay** (menu + API) · audit ghi trước/sau | Admin | ADM-06, 07, 08 | AUTH |
| CF-18 | Cài đặt hệ thống che giá trị nhạy cảm · bật/tắt module ⇒ Home Portal đổi theo · **xoá là xoá mềm** | Admin | ADM-10, 12, 17 | FND |

### 3.2 P1 — nghiệp vụ chính, có workaround ngắn hạn (14 flow)

| Mã | Flow | Vai | Kịch bản nguồn | Nhánh |
| --- | --- | --- | --- | --- |
| CF-19 | App Switcher không mất dữ liệu màn đang xem | mọi vai | EMP-04 | AUTH |
| CF-20 | Huỷ đơn nghỉ đang chờ ⇒ trả số dư giữ chỗ | Employee | EMP-15 | LEAVE |
| CF-21 | Đơn điều chỉnh công + đơn làm từ xa: gửi → duyệt → sinh bản ghi công | Employee · Manager | EMP-16, 17 · MGR-09 | ATT |
| CF-22 | Bình luận + checklist trên việc, lưu ngay | Employee | EMP-20 | TASK |
| CF-23 | Yêu cầu sửa hồ sơ cá nhân — **tạo yêu cầu, KHÔNG sửa thẳng** | Employee | EMP-24 | HR·ME |
| CF-24 | Bảo mật cá nhân: đổi mật khẩu · xem + thu hồi phiên | Employee | EMP-25, 26 | AUTH·ME |
| CF-25 | Lịch nghỉ nhóm theo phạm vi | Manager | MGR-10 | LEAVE |
| CF-26 | Dự án: tạo · việc quá hạn · báo cáo tiến độ khớp bảng việc | Manager | MGR-11, 14, 15 | TASK |
| CF-27 | Vòng đời nhân sự: đổi trạng thái (ghi lịch sử) · hợp đồng + cảnh báo hết hạn · sơ đồ tổ chức · nhập hàng loạt | HR | HR-06, 07, 09, 10 | HR |
| CF-28 | Xuất bảng công không lộ trường vượt quyền | HR | HR-12 | ATT |
| CF-29 | Cấu hình loại phép/chính sách áp cho đơn mới · báo cáo nghỉ khớp danh sách đơn | HR | HR-15, 16 · HR-14 | LEAVE |
| CF-30 | Quản trị: đặt lại 2FA (thu hồi phiên) · nhật ký đăng nhập/sự kiện bảo mật · ngày lễ · sức khoẻ + job nền · mẫu thông báo | Admin | ADM-05, 09, 13, 14, 16 | AUTH·FND·NOTI |
| CF-31 | Thương hiệu: đổi logo/favicon áp toàn app *(T3 — không chặn RC)* | Admin | ADM-11 | BRAND |
| CF-32 | Trang cá nhân `/me`: đủ khối hồ sơ · công · phép · việc · đào tạo *(T2)* | Employee | EMP-05, 28 | ME |

### 3.3 P2 — không chặn release

`UAT-EMP-29` (giao diện sáng/tối) · `UAT-MGR-18` (GOAL tạo + phân rã) · `UAT-ADM-15` (lưu trữ + nhật ký
truy cập tệp) · toàn bộ luồng riêng của **GOAL · LMS** ngoài điểm nối đã liệt ở §2.3.

---

## 4. IMP09-DEL-WS1-004 — CHANGE CONTROL SAU FREEZE

### 4.1 Chỉ 5 nhóm được nhận (IMPL-09 §10.3)

| Nhóm | Điều kiện nhận | Ai duyệt |
| --- | --- | --- |
| **Bug fix** | Ảnh hưởng flow **CF-P0/CF-P1** ở §3, hoặc là UAT blocker | QA Lead + Tech Lead |
| **Security fix** | auth · permission · rò dữ liệu · tệp/dữ liệu riêng tư · secret | Security Owner (bắt buộc) + Tech Lead |
| **Data integrity fix** | Sai dữ liệu chấm công · nghỉ phép · task · audit · notification | Tech Lead + Backend Lead |
| **Operational fix** | backup · deployment · rollback · monitoring | DevOps Lead |
| **UX blocker** | User **không hoàn thành được** flow chính (không phải "xấu"/"khó dùng") | Product Owner |

### 4.2 Không nhận

1. Tính năng mới không bắt buộc cho MVP.
2. Thay đổi UI lớn không ảnh hưởng usability chính.
3. Refactor lớn không cần cho release.
4. Tối ưu hiệu năng **không có bằng chứng bottleneck** (số đo, không cảm tính).
5. Mở rộng scope của T3 (GOAL/LMS/BRAND) — đẩy sang post-MVP backlog (`IMPLEMENTATION-10`).

### 4.3 Mẫu Change Request

Ghi thành 1 mục trong `RELEASE-02` §1 (nếu là bug) hoặc 1 Work Order mới trong `harness/backlog.mjs`
(nếu là thay đổi). Không cần công cụ riêng.

```markdown
### CR-<nnn> — <tiêu đề một dòng>

- **Loại:** Bug fix | Security fix | Data integrity | Operational | UX blocker
- **Flow bị ảnh hưởng:** CF-xx (nếu không trỏ được về CF nào ⇒ **mặc định từ chối**)
- **Severity / Priority:** S? / P?   (theo §5)
- **Bằng chứng:** log · ảnh chụp · tên spec + tên `it()` · câu SQL đã chạy
- **Vùng chạm:** đường dẫn file dự kiến (quyết định gate FULL/LIGHT — CLAUDE.md §6)
- **Rủi ro nếu KHÔNG làm:** ...
- **Rủi ro khi làm (regression):** module nào phải chạy lại
- **Owner duyệt:** <vai trò ở §4.1> · **Ngày duyệt:**
- **Work Order:** S6-...
```

### 4.4 Quy tắc cứng

- CR **không trỏ được về CF nào ở §3** ⇒ từ chối, đẩy post-MVP. Không có ngoại lệ "tiện tay làm luôn".
- Mọi CR đã duyệt phải thành **1 Work Order** trong `harness/backlog.mjs` (có `paths`) — vì `paths` là
  cái lái review gate và lịch chạy (xem CLAUDE.md §6, §9).
- CR chạm `permission · RLS · secret · audit · auth · migration` ⇒ **FULL gate**, bất kể kích thước.

---

## 5. IMP09-DEL-WS1-005 — BUG SEVERITY MATRIX (thống nhất 1 thang)

### 5.1 Vấn đề: hai hệ tên đang chạy song song

`QA-08` §9 tuyên bố **`S0…S4` là thang chuẩn cho toàn bộ QA-01…QA-10**, và `RELEASE-01`/`RELEASE-02`
đang dùng đúng thang đó. Nhưng `IMPLEMENTATION-09` §11.2 lại gọi cùng khái niệm là `P0…P4`, trong khi
`P0/P1` ở `UAT-KIT` §2 và ở §3 tài liệu này lại nghĩa là **độ ưu tiên flow**. Cùng chữ "P1", ba nghĩa.

### 5.2 Chốt

> **Severity dùng `S0…S4` (QA-08 §9). Priority dùng `P0…P3` (QA-08 §10). Mức flow dùng `P0/P1/P2`
> (§3 tài liệu này).** Bảng `IMPLEMENTATION-09` §11.2 được đọc là **severity** và ánh xạ như dưới.

| IMPL-09 §11.2 | ⇒ Severity chuẩn | Tên | Luật release |
| --- | --- | --- | --- |
| P0 — Blocker | **S0** | Critical / Incident | **Không được release** |
| P1 — Critical | **S1** | High | **Phải fix trước RC** |
| P2 — Major | **S2** | Medium | Fix nếu còn capacity; nếu không ⇒ known issue có workaround + owner |
| P3 — Minor | **S3** | Low | Có thể đưa post-go-live backlog |
| P4 — Enhancement | **S4** | Cosmetic / Improvement | Không vào Sprint 6 trừ khi được duyệt theo §4 |

Quy tắc **nâng severity tự động** (`QA-08` §9.1) giữ nguyên hiệu lực — đáng chú ý ở Sprint 6:
lộ dữ liệu nhạy cảm · thao tác ngoài quyền · **không ghi audit cho thao tác nhạy cảm** ⇒ tối thiểu `S1`.

### 5.3 Ngưỡng chặn RC

| Severity | Ngưỡng cho phép khi tạo RC | Nguồn |
| --- | --- | --- |
| S0 | **0 open** | QA-08 §, IMPL-09 §16.3 (IMP09-RC-001) |
| S1 | **0 open** trong T1/T2 | IMP09-RC-002 |
| S2 | ≤3 open, mỗi mục có owner + workaround ghi ở `RELEASE-02` | QA-10 §17 |
| S3/S4 | không giới hạn cứng, phải có sổ | QA-10 §17 |

### 5.4 Nhịp triage (IMPL-09 §11.3)

| Thời điểm | Việc |
| --- | --- |
| Đầu ngày | Duyệt S0/S1 mới, gán owner + mốc fix |
| Giữa ngày | Kiểm blocker; dựng lại môi trường UAT nếu cần |
| Cuối ngày | Verify bug đã fix, cập nhật `RELEASE-02` + rủi ro release |
| Trước RC | Bug scrub toàn bộ S0/S1/S2 |

Bug **không được đóng** nếu thiếu 1 trong 4: link commit/PR (hoặc giải thích cấu hình) · môi trường đã
verify · kết quả QA · ghi chú regression nếu chạm module khác (IMPL-09 §11.4).

---

## 6. RELEASE GOVERNANCE — version · tag · branch

### 6.1 Version policy

Semantic versioning theo `DEVOPS-12` §6: `vMAJOR.MINOR.PATCH`. MVP go-live đầu tiên = **`v1.0.0`**.

| Loại | Khi tăng |
| --- | --- |
| MAJOR | Breaking change lớn |
| MINOR | Tính năng mới tương thích ngược |
| PATCH | Bugfix/hotfix |

### 6.2 Tag policy (MỚI — trước WO này repo chưa có tag release nào)

| Loại tag | Format | Khi tạo | Ai tạo |
| --- | --- | --- | --- |
| Release candidate | `v1.0.0-rc.<n>` | Khi đủ `IMP09-RC-001…008` (IMPL-09 §16.3) | `S6-REL-1` |
| Bản phát hành | `v1.0.0` | Sau Go/No-Go = Go | `S6-GOLIVE-1` |
| Hotfix sau go-live | `v1.0.<patch>` | Sau khi hotfix lên PROD | DevOps Lead |

Quy ước bắt buộc cho **mọi** tag release:

1. Tag **annotated** (`git tag -a`), đặt trên commit đã merge vào `master`, **không** tag nhánh làm việc.
2. Nội dung tag ghi tối thiểu: **migration head** (số + tên file cuối) · link release notes · danh sách
   CR đã nhận từ RC trước.
3. Monorepo ⇒ **một tag cho cả backend + frontend** (khác `IMPL-09` §16.2 vốn giả định 2 repo — xem §6.3).
4. Tag **không bao giờ move**. Sai thì tạo `-rc.<n+1>`.
5. Tag `archive/*`, `backup/*`, `tooling-*` hiện có là **tag lịch sử**, không phải release — không dùng
   để rollback.

### 6.3 Branch model — thực tế khác thiết kế, ghi rõ để không ai nhầm

`DEVOPS-02` §6.3 thiết kế luồng `feature/* → develop → release/* → main`. **Repo thực tế đang chạy
trunk-based:** một nhánh dài duy nhất là `master`, mọi thay đổi vào bằng PR + squash merge, có nhãn
`auto-merge` và branch protection.

| | Thiết kế `DEVOPS-02` | Thực tế đang chạy | Chốt cho Sprint 6 |
| --- | --- | --- | --- |
| Nhánh chính | `main` + `develop` | `master` | **Giữ `master`** — không dựng `develop` ở cuối dự án |
| Nhánh release | `release/v1.0.0` | không có | **Không tạo** — RC = **tag trên `master`** |
| Vào nhánh chính | PR → review → merge | PR + squash + branch protection | Giữ nguyên |
| Hotfix | `hotfix/*` → main + develop | — | `hotfix/<issue>` → PR vào `master` → tag `v1.0.<patch>` |

> Sai lệch này **có chủ ý** và chỉ áp cho MVP go-live: dựng thêm `develop`/`release/*` ở tuần cuối chỉ
> tạo rủi ro merge, không thêm an toàn khi chỉ có một dòng phát hành. `DEVOPS-02` **không sửa** —
> nó vẫn là thiết kế đích khi có nhiều dòng phát hành song song.

### 6.4 Điều kiện tạo RC (IMPL-09 §16.3 — nhắc lại để §4 tham chiếu được)

`IMP09-RC-001` không còn S0 · `-002` không còn S1 thiếu owner/ETA · `-003` regression CF-P0 pass trên
staging · `-004` migration/seed verified trên staging · `-005` security blocker = 0 · `-006` release
notes đủ module · `-007` monitoring/health chạy · `-008` rollback runbook đã review.

---

## 7. IMP09-DEL-WS1-002 — RELEASE BOARD & nhịp làm việc

Không dựng công cụ mới. Release board Sprint 6 = **hạ tầng harness sẵn có**:

| Vai trò của board | Nơi thật | Ghi chú |
| --- | --- | --- |
| Danh sách việc (WO) + phụ thuộc | `harness/backlog.mjs` (7 WO `S6-*`) | Nguồn máy-đọc duy nhất |
| Trạng thái đang ở đâu | `docs/STATUS.md` (tự sinh) + `harness/ledger.mjs` | **Không sửa tay** STATUS |
| Sổ bug / known issues | `docs/RELEASE/RELEASE-02_Known_Issues_MVP.md` | Mỗi mục có mức · owner · workaround |
| Điều kiện release + điểm số | `docs/RELEASE/RELEASE-01_MVP_Release_Readiness_Checklist.md` | |
| Chữ ký + Go/No-Go | `docs/RELEASE/RELEASE-04_UAT_Signoff_And_Go_NoGo.md` | Ô quyết định **chỉ người ký** |
| Luật (tài liệu này) | `RELEASE-05` | |

**Daily release sync (IMP09-WS1-007):** dự án chạy 1 người + agent, nên "standup" quy về **checkpoint
đầu phiên**: `bash harness/init.sh` → đọc `STATUS.md` → duyệt S0/S1 mới trong `RELEASE-02` → chọn đúng
**1 Work Order**. Không họp hình thức; nhưng **bắt buộc** cập nhật `RELEASE-02` cuối mỗi phiên có bug mới.

---

## 8. RÀ SOÁT ĐIỀU KIỆN ĐẦU VÀO SPRINT 6 (IMP09-IN-001…017)

Đo ngày **2026-07-26** trên `master` `dcf85eb0`.

### 8.1 Điều kiện sản phẩm

| Mã | Điều kiện | Trạng thái | Bằng chứng / Blocker |
| --- | --- | --- | --- |
| IMP09-IN-001 | Scope MVP đã chốt | ✅ **đóng hôm nay** | §2 tài liệu này (quyết định owner 2026-07-26) |
| IMP09-IN-002 | Danh sách flow P0/P1 đã xác định | ✅ **đóng hôm nay** | §3 — 18 CF-P0 + 14 CF-P1 |
| IMP09-IN-003 | UAT scenario chuẩn bị ở Sprint 5 | ✅ | `S5-UAT-1-UAT-KIT` §5 — 84 kịch bản / 4 vai |
| IMP09-IN-004 | Known issue đang mở đã phân loại | ✅ | `RELEASE-02` — 20 mục có mức/loại/workaround/chủ |
| IMP09-IN-005 | Không còn yêu cầu nghiệp vụ lớn chưa chốt | ✅ **có điều kiện** | §2 đóng 4 nhánh trôi; giữ được là nhờ §4 chặn CR mới |

### 8.2 Điều kiện kỹ thuật

| Mã | Điều kiện | Trạng thái | Bằng chứng / Blocker |
| --- | --- | --- | --- |
| IMP09-IN-006 | Staging ổn định | ⚠️ **một phần** | DB UAT `mediaos_dev` ở head `0529`, dữ liệu UAT sẵn (C1/C2 đóng 2026-07-26). **Blocker:** stack `:3200` chưa chạy thường trực và dùng chung `dist` với PROD (KI-016) ⇒ bật UAT có thể đụng PROD. Đóng bởi `S6-OPS-DISTSPLIT-1` (chưa mở) — điều kiện `C7` |
| IMP09-IN-007 | CI/CD build được BE + FE | ⚠️ **một phần** | `CI` · `API — CI` · `Apps — Frontend CI` **xanh** trên `dcf85eb0`. **Blocker:** workflow `Security` **ĐỎ** (job `dependency-scan`) trên cả `333494be` và `dcf85eb0` — KI-007, điều kiện `C6` |
| IMP09-IN-008 | Migration/seed chạy được ở staging | ✅ | PROD + UAT đều **197/197**; `migrate-from-empty` verify trong `api.yml` |
| IMP09-IN-009 | Core API 7 module hoạt động | ✅ | `RELEASE-01` §4.2 + bộ int-spec |
| IMP09-IN-010 | FE gọi API thật / contract khớp | ✅ | 3 SPA gọi API thật; `S5-BE-CONTRACT-1` đã đóng lệch contract |
| IMP09-IN-011 | QA có test case regression chính | ⚠️ **một phần** | `QA-02` ma trận + `S5-QA-REG-1-REGRESSION-SIGNOFF`. **Blocker vận hành:** suite crash khi chạy 1 tiến trình ⇒ phải chạy chia chunk (KI-014) |
| IMP09-IN-012 | DevOps có deployment path + rollback path | ⚠️ **một phần** | Có runbook `DEVOPS-06/10/12` + `m prod-update` migrate fail-closed (`S5-DEVOPS-DEPLOYMIG-1`) + `scripts/backup-restore-drill.sh`. **Blocker:** **chưa diễn tập khôi phục lần nào** (KI-008) — điều kiện `C5` |

### 8.3 Điều kiện tài liệu

| Mã | Điều kiện | Trạng thái | Bằng chứng / Blocker |
| --- | --- | --- | --- |
| IMP09-IN-013 | API/OpenAPI đủ cho module MVP | ✅ | `docs/API Design/API-01…12` + `openapi/enterprise-api.yaml` |
| IMP09-IN-014 | Permission matrix đủ để test role/scope | ✅ | `docs/permission-matrix-spec.md` + `API-10` + bộ `S5-SEC-1-PERM-SCOPE-SUITE` |
| IMP09-IN-015 | Release checklist **có owner** | ⚠️ **thiếu tên người** | `RELEASE-01` có checklist nhưng cột owner ghi chung ("Owner/DevOps"). **Blocker:** gán tên thật cho C3…C8 trước RC |
| IMP09-IN-016 | Go-live communication plan có người chịu trách nhiệm | ❌ **chưa** *(Nên có)* | Thuộc `S6-REL-1` (WS9) |
| IMP09-IN-017 | User/admin guide bản tối thiểu | ❌ **chưa** *(Nên có)* | Thuộc `S6-GOLIVE-1` (WS10) |

### 8.4 Kết luận vào Sprint 6

**5/5 điều kiện sản phẩm đạt** (2 đóng bởi chính tài liệu này). **7 điều kiện kỹ thuật: 4 đạt, 3 đạt một
phần.** **Tài liệu: 2 đạt, 1 thiếu tên người, 2 chưa làm (đều là "Nên có", đã có WO nhận).**

> **Không có điều kiện bắt buộc nào ở mức ❌.** Sprint 6 **được phép chạy tiếp** với `S6-STAB-1`
> (stabilization) — đúng như khuyến nghị Conditional Go ở `RELEASE-04` §4.2.
>
> **Nhưng KHÔNG được tạo RC (`S6-REL-1`)** khi 4 chặn sau còn mở:
>
> | # | Chặn | Vi phạm điều kiện RC |
> | --- | --- | --- |
> | B1 | `Security` workflow đỏ (`dependency-scan`) — C6 | `IMP09-RC-005` |
> | B2 | Chưa diễn tập khôi phục backup — C5 | `IMP09-RC-008` |
> | B3 | UAT Cycle 1 chưa chạy — C3 | `IMP09-RC-003` |
> | B4 | Staging dùng chung `dist` với PROD — C7 | `IMP09-RC-004` (không verify được độc lập) |

---

## 9. Cái tài liệu này KHÔNG làm

- **Không ký thay owner.** Ô sign-off module, rủi ro `D3`/`D1` vẫn nằm ở `RELEASE-04` §2/§3, vẫn trống.
- **Không tạo tag, không tạo RC** — chỉ ra luật. Việc tag thuộc `S6-REL-1` / `S6-GOLIVE-1`.
- **Không sửa `DEVOPS-02`/`DEVOPS-12`** — sai lệch branch model ghi đối chiếu ở §6.3.
- **Không mở WO mới** cho C5…C8 — gợi ý WO đã có sẵn ở `RELEASE-04` §6.2, owner quyết khi nào seed.
