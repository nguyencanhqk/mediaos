# S5-UAT-1 — UAT KIT (bộ chạy nghiệm thu MVP)

> Deliverable **A** của Work Order `S5-UAT-1`. Phủ đủ 9 deliverable bắt buộc
> `IMPLEMENTATION-08 §19.2` (UAT-DEL-001…009), khung theo `QA-09`.
> Ngày lập: **2026-07-26** · build tham chiếu: master `153e2101` · migration head **0529** (197 file).
>
> **Cách dùng:** owner/business user in §5 ra chạy tuần tự theo vai; ghi kết quả vào §7; bug thì
> theo §8; ký ở §10. Cycle 0 (dry-run kỹ thuật) **đã chạy sẵn** — kết quả ở
> [S5-UAT-1-UAT-CYCLE0-DRYRUN.md](S5-UAT-1-UAT-CYCLE0-DRYRUN.md), **đọc trước khi bắt đầu Cycle 1**.

---

## 1. UAT-DEL-001 — Phạm vi & mục tiêu

**Mục tiêu:** business owner xác nhận 7 module MVP (AUTH · HR · ATT · LEAVE · TASK · NOTI · DASH)
**dùng được thật cho công việc hằng ngày**, đúng quyền, đúng phạm vi dữ liệu — trước khi mở Sprint 6
(stabilization → RC → go-live).

### Trong phạm vi UAT

| Nhóm | Nội dung |
| --- | --- |
| AUTH / Home | Đăng nhập · đăng xuất · đổi mật khẩu · phiên hết hạn · Home Portal chỉ hiện app được phép · App Switcher |
| ME (`/me`) | Trang cá nhân hợp nhất: hồ sơ · công · phép · việc · đào tạo · thông báo · bảo mật |
| HR | Danh sách/hồ sơ nhân viên · sơ đồ tổ chức · hợp đồng · yêu cầu sửa hồ sơ · nhập nhân viên hàng loạt |
| ATT | Hôm nay/chấm công vào-ra · bảng công cá nhân/nhóm/công ty · đơn điều chỉnh công · đơn làm từ xa · báo cáo |
| LEAVE | Số dư phép · tạo/gửi/huỷ đơn · duyệt/từ chối · lịch nghỉ · loại phép/chính sách (admin) · báo cáo |
| TASK | Dự án · bảng Kanban · danh sách việc · chi tiết việc (bình luận/checklist/việc con/tệp) · việc quá hạn |
| NOTI | Chuông + đếm chưa đọc · danh sách · chi tiết + deep-link · đánh dấu đã đọc · tuỳ chọn nhận thông báo |
| DASH | Dashboard theo vai + widget + quick action |
| SYSTEM | Người dùng · vai trò · ma trận quyền · nhật ký kiểm toán · cài đặt hệ thống · module |
| GOAL | Mục tiêu + phân rã + check-in (module mới Sprint 5 — nghiệm thu **P2**, xem §2) |

### Ngoài phạm vi UAT MVP

Payroll · Recruit · Asset · Room · Chat · Social · mobile native · BI nâng cao · load test quy mô lớn ·
realtime WebSocket đầy đủ · module media/finance (đã de-media-fy, out-of-scope).
**LMS** chạy như app riêng (`/lms` → `apps/lms`), chỉ nghiệm thu **điểm nối**: SSO + tiến độ học hiện ở
`/me/training` + thông báo học tập về chuông MediaOS.

---

## 2. Mức ưu tiên scenario

| Mức | Nghĩa | Ngưỡng exit (IMPL-08 §24.1 · QA-09 §12) |
| --- | --- | --- |
| **P0** | Không chạy được thì không go-live | 100% đã chạy · **100% pass** |
| **P1** | Nghiệp vụ chính, có thể workaround ngắn hạn | ≥95% đã chạy · ≥95% pass hoặc có waiver |
| **P2** | Bổ trợ / module mới ngoài 7 module lõi | best-effort, không chặn release |

---

## 3. UAT-DEL-002 — Ma trận tài khoản

**Đã tồn tại thật** trong DB UAT `mediaos_dev` (kiểm ngày 2026-07-26 — xem Cycle-0 §3):

| Tài khoản | Vai trò (role seed) | Scope | Dùng để test | Trạng thái dữ liệu |
| --- | --- | --- | --- | --- |
| `uat.employee@demo.local` | `employee` | Own | Chấm công · xin nghỉ · việc cá nhân · thông báo | ⚠️ **chưa gắn hồ sơ nhân viên** — xem KI-001 |
| `uat.manager@demo.local` | `manager` | Team | Duyệt nghỉ/điều chỉnh công · việc của nhóm | ⚠️ **chưa gắn hồ sơ + chưa có cấp dưới** — KI-001 |
| `uat.hr@demo.local` | `hr` | Company | Hồ sơ · bảng công · phép · hợp đồng | ⚠️ **chưa gắn hồ sơ nhân viên** — KI-001 |
| `uat.admin@demo.local` | `company-admin` | Company | Người dùng · vai trò · quyền · cài đặt · audit | ✅ dùng được ngay |
| `sa@demo.local` | `super-admin` | System | Kiểm tra cấp hệ thống (N=1 nên ≡ Company) | ✅ dùng được ngay |
| `admin@demo.local` | `company-admin` | Company | Tài khoản demo cũ (dự phòng) | ✅ |

> **Mật khẩu KHÔNG ghi trong tài liệu.** Nguồn: biến `STAGING_SEED_{EMPLOYEE,MANAGER,HR,ADMIN}_PASSWORD`
> trong `.env` của môi trường UAT. Tạo lại/đặt lại tài khoản: `m seed-staging`
> (`scripts/seed-staging-accounts.mjs` — idempotent, KHÔNG xoá dữ liệu).
> Công ty UAT: slug **`demo`**.

---

## 4. UAT-DEL-003 — Bộ dữ liệu UAT

Đối chiếu `QA-09 §10.3` với dữ liệu THẬT trong `mediaos_dev` (đo 2026-07-26, read-only):

| Nhóm QA-09 §10.3 | Yêu cầu | Thực tế | Đủ để UAT? |
| --- | --- | --- | --- |
| Company | 1 công ty active, TZ Asia/Ho_Chi_Minh | 1 (`demo`) | ✅ |
| Phòng ban | ≥3 | 7 `org_units` | ✅ |
| Vị trí | ≥4 | 9 `positions` | ✅ |
| Nhân viên | nhiều trạng thái | 11 hồ sơ, **11/11 đã gắn user** | ⚠️ nhưng **không** gồm 4 tài khoản `uat.*` — KI-001 |
| Quan hệ quản lý | có cấp dưới cho Manager | 4 quan hệ | ⚠️ không thuộc `uat.manager` — KI-001 |
| Ca làm việc | ≥2 (hành chính + linh hoạt) | **1** | ⚠️ P1 — check-in vẫn chạy (fallback ca mặc định) |
| Quy tắc chấm công | mặc định + remote | **1** | ⚠️ P1 — fallback `DEFAULT_OFFICE_RULE` |
| Phân ca | có | **0** | ℹ️ không chặn (đã có fallback) |
| Loại nghỉ phép | ≥3 | 11 (8 chuẩn + **3 bản trùng chữ thường** — KI-003) | ⚠️ |
| Số dư phép | đủ / sắp hết / không đủ | **0 dòng** | ❌ **CHẶN tạo đơn nghỉ trừ phép** — KI-002 |
| Đơn nghỉ | nhiều trạng thái | 5 (Draft 1 · Pending 1 · pending 2 · approved 1) | ✅ đủ để xem, chưa đủ để duyệt-mới |
| Bản ghi chấm công | có | 21 | ✅ |
| Việc/dự án | nhiều trạng thái | 8 dự án · 34 việc (Todo 15 · In Progress 10 · In Review 5 · Done 2 · Cancelled 1) | ✅ |
| Thông báo | đọc + chưa đọc | 38 (29 chưa đọc · 9 đã đọc) | ✅ |
| Ngày lễ | có | **0** | ⚠️ P1 — tính ngày nghỉ coi mọi ngày là ngày làm |
| Mục tiêu (GOAL) | — | **0** | ℹ️ P2 — cần tạo trong UAT nếu muốn nghiệm thu |

**Việc phải làm TRƯỚC Cycle 1** (chi tiết + cách làm: `RELEASE-02` KI-001/KI-002):

1. Gắn hồ sơ nhân viên cho `uat.employee` · `uat.manager` · `uat.hr`, đặt `uat.manager` làm quản lý
   trực tiếp của `uat.employee`.
2. Cấp số dư phép năm cho `uat.employee` (và `uat.manager` nếu muốn test chéo).

---

## 5. UAT-DEL-004 — Script theo vai

> Route lấy trực tiếp từ `apps/app/src/router.tsx` (build `153e2101`) — nếu Sprint 6 đổi route thì
> cập nhật lại bảng này. Ký hiệu kết quả: **P** pass · **PO** pass-with-observation · **F** fail ·
> **B** blocked · **NR** not run (QA-09 §14).

### 5.1 Employee — `uat.employee@demo.local`

| # | ID | Bước | Màn hình | Kỳ vọng | Ưu tiên |
| --- | --- | --- | --- | --- | --- |
| 1 | UAT-EMP-01 | Đăng nhập | auth app | Vào được, hiển thị đúng tên | P0 |
| 2 | UAT-EMP-02 | Sai mật khẩu 1 lần | auth app | Lỗi chung chung, **không** tiết lộ email có tồn tại | P0 |
| 3 | UAT-EMP-03 | Xem Home Portal | `/home` | **Chỉ** thấy app được phép (không thấy app quản trị) | P0 |
| 4 | UAT-EMP-04 | Mở App Switcher | mọi màn | Overlay mở, không mất dữ liệu màn đang xem | P1 |
| 5 | UAT-EMP-05 | Mở trang cá nhân | `/me` | Thấy đủ khối: hồ sơ · công · phép · việc · đào tạo | P0 |
| 6 | UAT-EMP-06 | Xem dashboard cá nhân | `/dashboard` | Widget theo vai Employee, không widget quản trị | P0 |
| 7 | UAT-EMP-07 | Chấm công vào | `/attendance/today` | Ghi nhận giờ vào + trạng thái (đúng/muộn) | P0 |
| 8 | UAT-EMP-08 | Chấm công ra | `/attendance/today` | Ghi giờ ra + tổng giờ công | P0 |
| 9 | UAT-EMP-09 | Chấm công vào lần 2 cùng ngày | `/attendance/today` | **Bị chặn** có thông báo rõ (không tạo bản ghi trùng) | P0 |
| 10 | UAT-EMP-10 | Xem bảng công của mình | `/attendance/my-records` · `/me/attendance` | Chỉ dữ liệu của mình, lọc theo tháng chạy đúng | P0 |
| 11 | UAT-EMP-11 | Xem số dư phép | `/leave/me/balances` · `/me/leave` | Số dư đúng, hiển thị đã dùng / còn lại | P0 |
| 12 | UAT-EMP-12 | Tạo đơn nghỉ (nghỉ phép năm, 1 ngày) | `/leave/me/requests/new` | Tạo + gửi được, trạng thái **Chờ duyệt** | P0 |
| 13 | UAT-EMP-13 | Tạo đơn vượt số dư | `/leave/me/requests/new` | Bị chặn, báo lỗi số dư rõ ràng | P0 |
| 14 | UAT-EMP-14 | Xem đơn đã gửi | `/leave/me/requests` | Thấy đơn vừa tạo + trạng thái | P0 |
| 15 | UAT-EMP-15 | Huỷ đơn đang chờ | `/leave/me/requests/$id` | Huỷ được, số dư giữ chỗ được trả lại | P1 |
| 16 | UAT-EMP-16 | Tạo đơn điều chỉnh công | `/attendance/adjustment-requests/new` | Gửi được, vào danh sách chờ duyệt | P1 |
| 17 | UAT-EMP-17 | Tạo đơn làm từ xa | `/attendance/remote-work-requests/new` | Gửi được | P1 |
| 18 | UAT-EMP-18 | Xem việc của tôi | `/tasks/my-tasks` · `/me/tasks` | Chỉ việc được giao cho mình | P0 |
| 19 | UAT-EMP-19 | Đổi trạng thái 1 việc | `/tasks/$taskId` | Trạng thái đổi + ghi vào dòng thời gian hoạt động | P0 |
| 20 | UAT-EMP-20 | Bình luận + tick checklist | `/tasks/$taskId` | Lưu được, hiện ngay | P1 |
| 21 | UAT-EMP-21 | Mở chuông thông báo | topbar | Đếm chưa đọc đúng | P0 |
| 22 | UAT-EMP-22 | Bấm 1 thông báo | `/notifications/$id` | Đi **đúng** đối tượng nguồn (deep-link) | P0 |
| 23 | UAT-EMP-23 | Đánh dấu đã đọc | `/notifications` | Đếm chưa đọc giảm | P0 |
| 24 | UAT-EMP-24 | Gửi yêu cầu sửa hồ sơ cá nhân | `/me/profile/edit` → `/hr/me/change-request` | Tạo **yêu cầu chờ duyệt**, KHÔNG sửa thẳng hồ sơ | P1 |
| 25 | UAT-EMP-25 | Đổi mật khẩu | `/me/security/password` | Đổi được, phiên cũ xử lý đúng | P1 |
| 26 | UAT-EMP-26 | Xem phiên đăng nhập | `/me/security/sessions` | Thấy phiên của mình, thu hồi được | P1 |
| 27 | UAT-EMP-27 | Vào thẳng URL quản trị `/system/users` | gõ URL | **Chặn 403** (`/403`), không lộ dữ liệu | P0 |
| 28 | UAT-EMP-28 | Xem đào tạo | `/me/training` · `/lms` | Thấy tiến độ khoá học của mình, mở LMS không cần đăng nhập lại | P1 |
| 29 | UAT-EMP-29 | Đổi giao diện sáng/tối | `/me/preferences/appearance` | Đổi được, giữ sau khi tải lại | P2 |
| 30 | UAT-EMP-30 | Đăng xuất | topbar | Về màn đăng nhập, quay lại URL cũ **không** vào được | P0 |

### 5.2 Manager — `uat.manager@demo.local`

| # | ID | Bước | Màn hình | Kỳ vọng | Ưu tiên |
| --- | --- | --- | --- | --- | --- |
| 1 | UAT-MGR-01 | Đăng nhập + dashboard | `/dashboard` | Widget vai Manager (nhóm/duyệt) | P0 |
| 2 | UAT-MGR-02 | Xem đơn nghỉ chờ duyệt | `/leave/approvals` | **Chỉ** đơn của cấp dưới trực tiếp | P0 |
| 3 | UAT-MGR-03 | Duyệt 1 đơn nghỉ | `/leave/me/requests/$id` (từ danh sách duyệt) | Đơn → Đã duyệt, **trừ phép**, nhân viên nhận thông báo | P0 |
| 4 | UAT-MGR-04 | Từ chối 1 đơn nghỉ (có lý do) | như trên | Đơn → Từ chối, số dư giữ chỗ được trả lại | P0 |
| 5 | UAT-MGR-05 | Thử duyệt đơn của người **ngoài** nhóm | deep-link đơn ngoài phạm vi | **Bị chặn 403/404** — không duyệt được | P0 |
| 6 | UAT-MGR-06 | Xem bảng công nhóm | `/attendance/team-records` | Chỉ nhân sự trong nhóm | P0 |
| 7 | UAT-MGR-07 | Duyệt đơn điều chỉnh công | `/attendance/adjustment-requests` → `$requestId` | Duyệt được, bản ghi công cập nhật trạng thái Đã điều chỉnh | P0 |
| 8 | UAT-MGR-08 | Thử tự duyệt đơn do chính mình tạo | như trên | **Bị chặn** (không tự phê duyệt) | P0 |
| 9 | UAT-MGR-09 | Duyệt đơn làm từ xa | `/attendance/remote-work-requests/$requestId` | Duyệt được, sinh bản ghi công tương ứng | P1 |
| 10 | UAT-MGR-10 | Xem lịch nghỉ nhóm | `/leave/calendar` | Hiển thị đúng người/ngày trong phạm vi | P1 |
| 11 | UAT-MGR-11 | Tạo dự án | `/tasks/projects` | Tạo được, mình là chủ dự án | P1 |
| 12 | UAT-MGR-12 | Tạo việc + giao cho nhân viên | `/tasks` (Kanban) | Giao được, người nhận có thông báo | P0 |
| 13 | UAT-MGR-13 | Kéo thẻ đổi cột Kanban | `/tasks` | Trạng thái đổi, lưu lại sau khi tải lại | P0 |
| 14 | UAT-MGR-14 | Xem việc quá hạn | `/tasks/overdue` | Đúng danh sách quá hạn trong phạm vi | P1 |
| 15 | UAT-MGR-15 | Xem báo cáo dự án | `/tasks/projects/$projectId/report` | Số liệu tiến độ khớp bảng việc | P1 |
| 16 | UAT-MGR-16 | Kiểm tra thông báo sau các thao tác trên | chuông | Có thông báo đúng loại, không trùng lặp | P0 |
| 17 | UAT-MGR-17 | Vào `/hr/employees` | gõ URL | Theo quyền: hoặc 403, hoặc chỉ thấy nhân sự trong phạm vi | P0 |
| 18 | UAT-MGR-18 | Tạo mục tiêu + phân rã | `/goals/new` | Tạo được, cây mục tiêu → việc hiển thị đúng | P2 |

### 5.3 HR — `uat.hr@demo.local`

| # | ID | Bước | Màn hình | Kỳ vọng | Ưu tiên |
| --- | --- | --- | --- | --- | --- |
| 1 | UAT-HR-01 | Đăng nhập + dashboard HR | `/dashboard` | Widget HR (headcount, hợp đồng sắp hết hạn…) | P0 |
| 2 | UAT-HR-02 | Danh sách nhân viên + lọc/tìm | `/hr/employees` | Phân trang, lọc, tìm chạy đúng | P0 |
| 3 | UAT-HR-03 | Mở hồ sơ 1 nhân viên | `/hr/employees/$id` | Đủ tab; **dữ liệu nhạy cảm che đúng theo quyền** | P0 |
| 4 | UAT-HR-04 | Thêm nhân viên mới | `/hr/employees/new` | Tạo được, mã nhân viên tự sinh liên tục | P0 |
| 5 | UAT-HR-05 | Sửa thông tin nhân viên | `/hr/employees/$id/edit` | Lưu được + ghi nhật ký kiểm toán | P0 |
| 6 | UAT-HR-06 | Đổi trạng thái nhân viên (thử việc → chính thức) | hồ sơ | Đổi được, lịch sử trạng thái ghi lại | P1 |
| 7 | UAT-HR-07 | Quản lý hợp đồng | `/hr/employees/$id/contracts` · `/hr/contracts` | Thêm/xem được, cảnh báo hợp đồng sắp hết hạn | P1 |
| 8 | UAT-HR-08 | Duyệt yêu cầu sửa hồ sơ | `/hr/profile-change-requests` | Duyệt/từ chối được; duyệt thì hồ sơ đổi theo | P0 |
| 9 | UAT-HR-09 | Sơ đồ tổ chức | `/hr/org-chart` | Cây phòng ban đúng, đổi phòng/quản lý được | P1 |
| 10 | UAT-HR-10 | Nhập nhân viên hàng loạt | `/hr/employees/import` | Xem trước → báo lỗi từng dòng → nhập thành công | P1 |
| 11 | UAT-HR-11 | Bảng công toàn công ty | `/attendance/records` | Xem theo phạm vi được cấp | P0 |
| 12 | UAT-HR-12 | Xuất bảng công | `/attendance/records` (nút xuất) | Tải được; **không** lộ trường vượt quyền | P1 |
| 13 | UAT-HR-13 | Số dư phép toàn công ty | `/leave/balances` | Xem + điều chỉnh có ghi giao dịch | P0 |
| 14 | UAT-HR-14 | Tất cả đơn nghỉ | `/leave/requests` | Lọc theo phòng ban/trạng thái đúng | P0 |
| 15 | UAT-HR-15 | Cấu hình loại phép / chính sách | `/leave/types` · `/leave/policies` | Sửa được, áp dụng cho đơn mới | P1 |
| 16 | UAT-HR-16 | Báo cáo nghỉ phép | `/leave/reports` | Số liệu khớp danh sách đơn | P1 |
| 17 | UAT-HR-17 | Nhật ký kiểm toán HR | `/hr/audit-logs` | Thấy đúng thao tác vừa làm ở bước 5 | P0 |
| 18 | UAT-HR-18 | Xuất danh sách nhân viên | `/hr/employees` (nút xuất) | **Lương/CCCD bị loại bỏ** trong file xuất | P0 |
| 19 | UAT-HR-19 | Vào `/system/roles` | gõ URL | 403 nếu không được cấp quyền quản trị | P0 |

### 5.4 Admin — `uat.admin@demo.local`

| # | ID | Bước | Màn hình | Kỳ vọng | Ưu tiên |
| --- | --- | --- | --- | --- | --- |
| 1 | UAT-ADM-01 | Đăng nhập + tổng quan hệ thống | `/system` | Trang tổng quan tải được | P0 |
| 2 | UAT-ADM-02 | Danh sách người dùng | `/system/users` | Phân trang/lọc; **không** lộ hash mật khẩu | P0 |
| 3 | UAT-ADM-03 | Tạo người dùng + cấp vai trò | `/system/users/new` → `$userId/roles` | Tạo được, người dùng mới đăng nhập được | P0 |
| 4 | UAT-ADM-04 | Khoá / mở khoá người dùng | `/system/users/$userId` | Khoá xong tài khoản đó **không** đăng nhập được | P0 |
| 5 | UAT-ADM-05 | Đặt lại 2FA cho 1 người dùng | `/system/users/$userId` | Thu hồi phiên + thông báo số phiên bị thu hồi | P1 |
| 6 | UAT-ADM-06 | Xem vai trò + ma trận quyền | `/system/roles` · `/system/permissions` | Ma trận hiển thị đúng cặp quyền + phạm vi dữ liệu | P0 |
| 7 | UAT-ADM-07 | Sửa quyền 1 vai trò rồi kiểm chứng | `/system/roles/$roleId/permissions` | Người dùng thuộc vai trò đó **đổi hành vi ngay** (menu + API) | P0 |
| 8 | UAT-ADM-08 | Nhật ký kiểm toán | `/system/audit-logs` | Thấy thao tác bước 7, có chi tiết trước/sau | P0 |
| 9 | UAT-ADM-09 | Nhật ký đăng nhập + sự kiện bảo mật | `/system/login-logs` · `/system/security-events` | Thấy lần đăng nhập sai ở UAT-EMP-02 | P1 |
| 10 | UAT-ADM-10 | Cài đặt hệ thống | `/system/settings` | Sửa được; **giá trị nhạy cảm hiển thị dạng che** | P0 |
| 11 | UAT-ADM-11 | Hồ sơ công ty + thương hiệu (logo/favicon) | `/system/company` · `/system/company/settings` | Đổi logo → hiện trên toàn app | P1 |
| 12 | UAT-ADM-12 | Danh mục module + bật/tắt | `/system` → `/system/modules/$code` | Tắt module ⇒ app biến mất khỏi Home Portal | P0 |
| 13 | UAT-ADM-13 | Ngày lễ | `/system/public-holidays` | Thêm được; ảnh hưởng tính ngày nghỉ | P1 |
| 14 | UAT-ADM-14 | Sức khoẻ hệ thống + job nền | `/system/health` · `/system/jobs` | Trạng thái xanh, lịch sử chạy job hiển thị | P1 |
| 15 | UAT-ADM-15 | Chính sách lưu trữ + nhật ký truy cập tệp | `/system/retention` · `/system/file-access-logs` | Xem được | P2 |
| 16 | UAT-ADM-16 | Mẫu thông báo + sự kiện | `/notifications/templates` · `/notifications/events` | Xem/sửa mẫu, không phá thông báo đang chạy | P1 |
| 17 | UAT-ADM-17 | Thử xoá dữ liệu quan trọng | mọi màn | Xoá là **xoá mềm** — dữ liệu vẫn truy vết được | P0 |

---

## 6. UAT-DEL-007 — Ghi chú hướng dẫn nhanh cho người dùng

1. **Chỉ thấy cái mình có quyền** — thiếu menu/nút thường là **đúng thiết kế**, không phải lỗi. Nghi
   ngờ thì ghi lại vai + màn hình, đội kỹ thuật đối chiếu ma trận quyền.
2. **Không dùng dữ liệu cá nhân thật** trên môi trường UAT.
3. **Xoá là xoá mềm** — không sợ mất dữ liệu, nhưng cũng đừng kỳ vọng "biến mất khỏi hệ thống".
4. Mọi thao tác quan trọng đều vào **nhật ký kiểm toán** — dùng nó để đối chứng khi thấy lạ.
5. Số liệu dashboard có **bộ đệm ngắn** — lệch vài giây sau thao tác là bình thường; lệch kéo dài là lỗi.
6. Thời gian hiển thị theo múi giờ **Asia/Ho_Chi_Minh**; dữ liệu lưu theo UTC.

---

## 7. UAT-DEL-005 — Phiếu ghi kết quả

Mỗi dòng script ở §5 ghi 1 dòng:

| UAT ID | Người chạy | Ngày | Kết quả (P/PO/F/B/NR) | Bằng chứng (ảnh/URL) | Ghi chú |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

Tổng kết mỗi cycle:

| Chỉ số | Số |
| --- | --- |
| P0 đã chạy / tổng P0 | / |
| P0 pass | |
| P1 đã chạy / tổng P1 | / |
| P1 pass | |
| Bug Blocker (S0) mở | |
| Bug Critical (S1) mở | |
| Bug Major (S2) mở | |
| Khuyến nghị | Go / Conditional Go / No-Go |

---

## 8. UAT-DEL-006 — Hướng dẫn phân loại mức độ

| Mức UAT | ≙ QA-08 | Nghĩa | Xử lý |
| --- | --- | --- | --- |
| Blocker | S0 | Không dùng được hệ thống / chặn cả cycle | Dừng flow liên quan, fix ngay |
| Critical | S1 | Sai nghiệp vụ nghiêm trọng, rủi ro dữ liệu/bảo mật (ví dụ: thấy dữ liệu ngoài phạm vi) | Fix trước sign-off |
| Major | S2 | Ảnh hưởng nghiệp vụ chính nhưng có cách làm vòng | Fix trước RC hoặc có waiver |
| Minor | S3 | Lỗi nhỏ không chặn | Backlog |
| Trivial | S4 | Góp ý thẩm mỹ | Backlog |

**Bug hay Change Request?** (QA-09 §16)
Hệ thống **khác tài liệu đã chốt** ⇒ **bug**. Người dùng **muốn thêm/khác** so với phạm vi đã chốt ⇒
**change request** → Post-MVP backlog, **không** chặn release.

Mẫu báo lỗi: `Vai trò · Màn hình/URL · Các bước · Kỳ vọng · Thực tế · Mức độ · Ảnh chụp · Thời điểm`.

---

## 9. UAT-DEL-008 — Giới hạn đã biết (nói trước khi test)

Danh sách đầy đủ + workaround: [`RELEASE-02_Known_Issues_MVP.md`](../../RELEASE/RELEASE-02_Known_Issues_MVP.md).
Tóm tắt cái người dùng sẽ **gặp trực tiếp**:

| # | Giới hạn | Ảnh hưởng khi UAT |
| --- | --- | --- |
| 1 | 4 tài khoản `uat.*` chưa gắn hồ sơ nhân viên (KI-001) | Chấm công / xin nghỉ / bảng công cá nhân **chưa chạy được** cho tới khi gắn |
| 2 | Chưa có số dư phép (KI-002) | Tạo đơn nghỉ phép năm sẽ báo "không đủ số dư" |
| 3 | Loại nghỉ phép có 3 bản trùng chữ thường (KI-003) | Danh sách chọn loại nghỉ nhìn bị lặp |
| 4 | Chưa nhập ngày lễ (KI-004) | Số ngày nghỉ tính không trừ ngày lễ |
| 5 | Widget "Thông báo" trên dashboard có độ trễ tới ~10s (KI-005) | Số đếm có thể chậm vài giây sau thao tác |
| 6 | Thông báo học tập từ LMS chưa bật ở PROD (KI-006) | Sự kiện học tập chưa hiện ở chuông MediaOS |
| 7 | Realtime chưa đầy đủ | Vài màn cần tải lại để thấy thay đổi của người khác |

---

## 10. UAT-DEL-009 — Mẫu ký nghiệm thu

Bản ký theo **từng module** + ký cấp release: xem
[`RELEASE-04_UAT_Signoff_And_Go_NoGo.md`](../../RELEASE/RELEASE-04_UAT_Signoff_And_Go_NoGo.md) §2–§4.
Kết luận UAT chỉ hợp lệ khi đủ **Exit criteria QA-09 §12** (QA09-EXIT-001…010).
