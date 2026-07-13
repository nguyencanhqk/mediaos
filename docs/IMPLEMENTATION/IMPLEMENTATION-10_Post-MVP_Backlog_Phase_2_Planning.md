# IMPLEMENTATION-10: POST-MVP BACKLOG & PHASE 2 PLANNING
# KẾ HOẠCH BACKLOG SAU MVP & LẬP KẾ HOẠCH PHASE 2

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | IMPLEMENTATION-10 |
| Tên tài liệu | Post-MVP Backlog & Phase 2 Planning |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | Post-MVP / Phase 2 Planning |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-04, BACKEND/QA/DEVOPS/IMPLEMENTATION trước đó |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

Tài liệu này dùng để lập kế hoạch sau khi MVP Version 1.0 đã được release/go-live hoặc đã hoàn tất giai đoạn release candidate.

IMPLEMENTATION-10 tập trung vào 5 mục tiêu chính:

1. Tổng hợp backlog còn lại sau MVP.
2. Phân loại backlog theo nhóm sản phẩm, kỹ thuật, vận hành, bảo mật, dữ liệu và trải nghiệm người dùng.
3. Xác định phạm vi Phase 2 ưu tiên.
4. Lập kế hoạch chuẩn bị tài liệu, thiết kế, triển khai và kiểm thử cho Phase 2.
5. Tạo cơ chế quản lý backlog liên tục để tránh mở rộng phạm vi không kiểm soát.

Tài liệu này không thay thế SPEC/API/DB/UI chi tiết cho module Phase 2. Sau khi tài liệu này được chốt, các tài liệu chi tiết như `SPEC-09 PAYROLL`, `SPEC-10 RECRUIT`, `DB Phase 2`, `API Phase 2`, `UI Phase 2`, `BACKEND Phase 2`, `FRONTEND Phase 2` và `QA Phase 2` sẽ được triển khai riêng.

---

## 3. Vị trí của IMPLEMENTATION-10 trong chuỗi triển khai

Chuỗi IMPLEMENTATION đề xuất:

```text
IMPLEMENTATION-01: MVP Implementation Roadmap & Sprint Plan
IMPLEMENTATION-02: Detailed Product Backlog & Epic Breakdown
IMPLEMENTATION-03: Sprint 0 Execution Plan & Issue Board Setup
IMPLEMENTATION-04: Sprint 1 Foundation, Environment & Core Infrastructure Execution Plan
IMPLEMENTATION-05: Sprint 2 Auth & HR Core Execution Plan
IMPLEMENTATION-06: Sprint 3 Attendance & Leave Core Execution Plan
IMPLEMENTATION-07: Sprint 4 Task, Notification & Dashboard Execution Plan
IMPLEMENTATION-08: Sprint 5 Integration, QA Hardening & UAT Execution Plan
IMPLEMENTATION-09: Sprint 6 Stabilization, Release Candidate & Go-live Execution Plan
IMPLEMENTATION-10: Post-MVP Backlog & Phase 2 Planning
```

IMPLEMENTATION-10 là bước chuyển tiếp từ:

```text
MVP delivery
  -> Stabilization
  -> Go-live
  -> Post-MVP backlog review
  -> Phase 2 product planning
```

---

## 4. Căn cứ lập kế hoạch

### 4.1 Căn cứ sản phẩm

Theo PRD và SPEC tổng quan, MVP Version 1.0 tập trung vào các module lõi:

| Module | Vai trò trong MVP |
| --- | --- |
| AUTH | Tài khoản, đăng nhập, phân quyền, data scope |
| HR | Hồ sơ nhân viên, phòng ban, chức vụ, hợp đồng |
| ATT | Chấm công, bảng công, ca làm, rule, điều chỉnh công |
| LEAVE | Nghỉ phép, số dư phép, duyệt nghỉ, lịch nghỉ |
| TASK | Dự án, task, giao việc, kanban, comment, file |
| DASH | Dashboard theo vai trò |
| NOTI | Thông báo in-app |

Các module chưa thuộc MVP nhưng cần chuẩn bị mở rộng:

| Module | Giai đoạn theo roadmap |
| --- | --- |
| PAYROLL | Phase 2 |
| RECRUIT | Phase 2 |
| ASSET | Phase 3 |
| ROOM | Phase 3 |
| CHAT | Phase 4 |
| SOCIAL | Phase 4 |
| MOBILE | Phase 5 |
| AI | Phase 5 |

### 4.2 Căn cứ kỹ thuật

Phase 2 phải kế thừa các nguyên tắc đã chốt trong MVP:

1. Thiết kế theo module.
2. PostgreSQL là database chính.
3. UUID cho primary key.
4. Multi-tenant ready thông qua `company_id`.
5. AUTH/RBAC là nền tảng phân quyền.
6. Permission + data scope là nguồn kiểm soát chính, không hard-code theo role.
7. Backend là lớp kiểm soát quyền cuối cùng.
8. Audit log cho thao tác quan trọng.
9. Soft delete cho dữ liệu nghiệp vụ quan trọng.
10. File service, settings, sequence, notification và dashboard dùng foundation chung.

### 4.3 Căn cứ vận hành

Sau MVP, backlog Phase 2 phải được chốt dựa trên dữ liệu thực tế từ:

1. UAT feedback.
2. Go-live feedback.
3. Production incidents.
4. Bug report.
5. Support tickets.
6. Nhu cầu nghiệp vụ HR/Manager/Admin.
7. Nhu cầu triển khai payroll/recruitment.
8. Rủi ro kỹ thuật hoặc bảo mật phát hiện sau release.
9. Dữ liệu usage analytics nếu có.
10. Khả năng của team triển khai.

---

## 5. Nguyên tắc Post-MVP

### 5.1 Không mở Phase 2 khi MVP chưa ổn định

Phase 2 chỉ nên bắt đầu khi MVP đạt tối thiểu:

| Nhóm | Điều kiện |
| --- | --- |
| Sản phẩm | Các flow P0/P1 của MVP chạy được end-to-end |
| QA | Không còn blocker/critical bug mở |
| Dữ liệu | Migration/seed ổn định trên staging/production |
| Phân quyền | Role, permission, data scope đã được kiểm thử |
| Bảo mật | Không có lỗi nghiêm trọng chưa xử lý |
| Vận hành | Monitoring, backup, rollback, support process đã sẵn sàng |
| Người dùng | Có kênh tiếp nhận feedback và issue sau go-live |

### 5.2 Không biến Phase 2 thành nơi gom mọi yêu cầu

Phase 2 không phải là “làm tất cả thứ còn thiếu”. Phase 2 chỉ tập trung vào nhóm giá trị tiếp theo có ưu tiên cao nhất.

Định hướng Phase 2:

```text
Phase 2 = Payroll + Recruitment + các cải tiến nền cần thiết để Payroll/Recruitment chạy đúng.
```

Các nhóm Asset, Room, Chat, Social, Mobile, AI chỉ được ghi nhận trong backlog phase sau, trừ khi có dependency bắt buộc cho PAYROLL hoặc RECRUIT.

### 5.3 Ưu tiên dữ liệu đúng hơn tính năng nhiều

PAYROLL và RECRUIT đều là module nhạy cảm. Phase 2 cần ưu tiên:

1. Dữ liệu đúng.
2. Quyền truy cập đúng.
3. Audit log đầy đủ.
4. Quy trình có trạng thái rõ ràng.
5. Có khả năng kiểm tra và đối soát.
6. Có export/report để kiểm chứng.

Không nên ưu tiên UI đẹp hoặc automation phức tạp trước khi dữ liệu nghiệp vụ chính ổn định.

---

## 6. Nguồn backlog sau MVP

Backlog sau MVP được thu từ các nguồn sau:

| Nguồn | Mô tả | Owner đề xuất |
| --- | --- | --- |
| UAT feedback | Góp ý từ người dùng thử nghiệm | Product Owner |
| Production feedback | Góp ý sau go-live | Product Owner / Support Lead |
| Bug backlog | Bug chưa chặn release nhưng cần xử lý | QA Lead |
| Technical debt | Code, DB, API, FE, DevOps cần cải thiện | Tech Lead |
| Security findings | Lỗ hổng hoặc điểm cần hardening | Security Owner / Tech Lead |
| Performance findings | API/query/page load chậm | Backend Lead / Frontend Lead |
| UX improvements | Trải nghiệm chưa thuận tiện | UI/UX Lead |
| Operational needs | Backup, monitoring, alert, support process | DevOps Lead |
| Business expansion | Payroll, recruitment, asset, room, chat | Product Owner |
| Compliance/data | Dữ liệu nhạy cảm, log, retention, export | Product Owner / Tech Lead |

---

## 7. Phân loại backlog sau MVP

### 7.1 Nhóm backlog chính

| Nhóm | Mã prefix | Mục tiêu |
| --- | --- | --- |
| Product enhancement | `PMVP-PROD` | Cải tiến nghiệp vụ MVP |
| User experience | `PMVP-UX` | Cải thiện UI/UX sau feedback |
| Technical debt | `PMVP-TECH` | Giảm nợ kỹ thuật |
| Security hardening | `PMVP-SEC` | Tăng bảo mật |
| Performance | `PMVP-PERF` | Tối ưu hiệu năng |
| Data quality | `PMVP-DATA` | Làm sạch/chuẩn hóa dữ liệu |
| Reporting | `PMVP-RPT` | Báo cáo/export nâng cao |
| Operations | `PMVP-OPS` | Vận hành, support, monitoring |
| Phase 2 payroll | `P2-PAY` | Tính lương |
| Phase 2 recruit | `P2-REC` | Tuyển dụng |
| Phase 3+ parking lot | `PARK` | Chờ phase sau |

### 7.2 Trạng thái backlog

| Trạng thái | Ý nghĩa |
| --- | --- |
| New | Mới ghi nhận, chưa phân tích |
| Triage | Đang phân loại |
| Need clarification | Cần làm rõ yêu cầu |
| Ready for discovery | Sẵn sàng phân tích sâu |
| Ready for design | Sẵn sàng viết SPEC/API/DB/UI |
| Ready for delivery | Sẵn sàng đưa vào sprint |
| In progress | Đang triển khai |
| Blocked | Bị chặn bởi dependency |
| Done | Hoàn tất |
| Rejected | Không làm |
| Parked | Đưa vào phase sau |

---

## 8. Mô hình ưu tiên backlog

### 8.1 Tiêu chí scoring

Mỗi backlog item được chấm theo thang 1-5:

| Tiêu chí | Câu hỏi đánh giá |
| --- | --- |
| Business value | Có tạo giá trị nghiệp vụ rõ ràng không? |
| User impact | Có ảnh hưởng nhiều người dùng không? |
| Risk reduction | Có giảm rủi ro vận hành/bảo mật/dữ liệu không? |
| Revenue/strategic fit | Có phục vụ định hướng thương mại/SaaS/khách hàng không? |
| Dependency unlock | Có mở khóa module hoặc luồng khác không? |
| Urgency | Có cần làm sớm vì deadline hoặc rủi ro không? |
| Effort | Ước lượng effort cao hay thấp? |
| Complexity | Có nhiều dependency hoặc rủi ro kỹ thuật không? |

Công thức gợi ý:

```text
Priority Score = (Business Value + User Impact + Risk Reduction + Strategic Fit + Dependency Unlock + Urgency) - (Effort + Complexity)
```

### 8.2 Nhóm ưu tiên

| Priority | Ý nghĩa | SLA xử lý |
| --- | --- | --- |
| P0 | Bắt buộc xử lý ngay, ảnh hưởng release/production | Ngay trong hotfix hoặc sprint gần nhất |
| P1 | Rất quan trọng, cần đưa vào Phase 2 hoặc hardening sprint | Trong 1-2 sprint |
| P2 | Có giá trị nhưng không chặn Phase 2 | Đưa vào backlog ưu tiên sau |
| P3 | Nice-to-have | Chỉ làm nếu còn capacity |
| P4 | Parking lot | Chưa làm trong 3-6 tháng tới |

---

## 9. Tổng quan phạm vi Phase 2

### 9.1 Trọng tâm Phase 2

Phase 2 tập trung vào 2 module chính:

```text
PAYROLL - Tiền lương
RECRUIT - Tuyển dụng
```

Ngoài 2 module này, Phase 2 cần một số cải tiến bắt buộc ở module MVP để hỗ trợ dữ liệu:

| Module nền | Cải tiến phục vụ Phase 2 |
| --- | --- |
| AUTH | Role/permission cho Payroll Officer, Recruiter, dữ liệu lương nhạy cảm |
| HR | Bổ sung dữ liệu lương cơ bản, tài khoản ngân hàng nếu đưa vào payroll, trạng thái tuyển dụng -> nhân viên |
| ATT | Đối soát bảng công, khóa kỳ công, dữ liệu ngày công cho payroll |
| LEAVE | Dữ liệu nghỉ phép có lương/không lương phục vụ payroll |
| NOTI | Thông báo bảng lương, phiếu lương, phỏng vấn, offer |
| DASH | Widget payroll/recruit cho đúng vai trò |
| FOUNDATION | Module registry, settings, audit, file, sequence cho PAYROLL/RECRUIT |
| DEVOPS | Environment, monitoring, backup cho dữ liệu nhạy cảm hơn |
| QA | Test payroll calculation, permission, data scope, export, security |

### 9.2 Không thuộc Phase 2 mặc định

Các nhóm sau không thuộc Phase 2, chỉ đưa vào parking lot nếu không có quyết định ưu tiên mới:

| Module/Nhóm | Giai đoạn đề xuất |
| --- | --- |
| ASSET | Phase 3 |
| ROOM | Phase 3 |
| CHAT | Phase 4 |
| SOCIAL | Phase 4 |
| MOBILE native app | Phase 5 hoặc track riêng |
| AI assistant | Phase 5 |
| Advanced BI/Data warehouse | Phase sau |
| Marketplace/App store | Phase sau |
| Complex workflow engine | Phase sau, trừ khi cần cho payroll/recruit |

---

## 10. Phase 2 Epic Breakdown

### 10.1 PAYROLL Epic Overview

PAYROLL là module nhạy cảm cao vì liên quan đến dữ liệu lương, khấu trừ, phụ cấp, ngày công, nghỉ phép và phiếu lương.

### PAYROLL MVP Phase 2 scope

| Epic ID | Epic | Priority | Dependency |
| --- | --- | --- | --- |
| P2-PAY-01 | Payroll foundation & permission model | P0 | AUTH, HR, FOUNDATION |
| P2-PAY-02 | Salary profile & compensation components | P0 | HR |
| P2-PAY-03 | Payroll period & payroll lock | P0 | FOUNDATION, ATT |
| P2-PAY-04 | Attendance/Leave payroll input | P0 | ATT, LEAVE |
| P2-PAY-05 | Payroll calculation draft | P0 | PAY-01 -> PAY-04 |
| P2-PAY-06 | Payroll review, adjustment & approval | P1 | PAY-05, AUTH |
| P2-PAY-07 | Payslip generation & employee view | P1 | PAY-05, NOTI |
| P2-PAY-08 | Payroll export & reporting | P1 | PAY-05, FILE/EXPORT |
| P2-PAY-09 | Payroll audit, security & sensitive field masking | P0 | AUTH, AUDIT |
| P2-PAY-10 | Payroll dashboard widgets | P2 | DASH, PAY-05 |

### P2-PAY-01: Payroll foundation & permission model

**Mục tiêu:** Tạo nền phân quyền, module registry và cấu hình cơ bản cho PAYROLL.

**Backlog items:**

| ID | Nội dung | Priority | Acceptance Criteria |
| --- | --- | --- | --- |
| P2-PAY-01-001 | Bổ sung module `PAYROLL` active trong module catalog khi Phase 2 bật | P0 | Admin có thể bật/tắt PAYROLL theo company setting |
| P2-PAY-01-002 | Seed permission PAYROLL | P0 | Có nhóm quyền view/create/update/approve/export/lock/view-sensitive |
| P2-PAY-01-003 | Seed role `PAYROLL_OFFICER` | P0 | Role có quyền payroll theo Company scope mặc định |
| P2-PAY-01-004 | Cấu hình field-level permission cho dữ liệu lương nhạy cảm | P0 | User thiếu quyền không thấy lương, tài khoản ngân hàng, khoản khấu trừ |
| P2-PAY-01-005 | Audit log cho mọi thao tác payroll quan trọng | P0 | Tạo/sửa/duyệt/xuất/khóa kỳ đều có audit log |

### P2-PAY-02: Salary profile & compensation components

**Mục tiêu:** Quản lý thông tin đầu vào lương của nhân viên.

**Backlog items:**

| ID | Nội dung | Priority | Acceptance Criteria |
| --- | --- | --- | --- |
| P2-PAY-02-001 | Thiết kế salary profile theo employee | P0 | Mỗi employee active có thể có salary profile hiện hành |
| P2-PAY-02-002 | Quản lý lương cơ bản | P0 | Có effective date, currency, status, audit log |
| P2-PAY-02-003 | Quản lý phụ cấp | P1 | Có loại phụ cấp, số tiền, chu kỳ áp dụng |
| P2-PAY-02-004 | Quản lý thưởng/phạt/khấu trừ thủ công | P1 | Có lý do, người tạo, kỳ áp dụng, trạng thái duyệt |
| P2-PAY-02-005 | Lưu lịch sử thay đổi salary profile | P0 | Mọi thay đổi có version/history |
| P2-PAY-02-006 | Mask dữ liệu lương trong HR profile nếu thiếu quyền | P0 | HR không có quyền lương sẽ không xem được field nhạy cảm |

### P2-PAY-03: Payroll period & payroll lock

**Mục tiêu:** Quản lý kỳ lương và trạng thái khóa dữ liệu.

**Backlog items:**

| ID | Nội dung | Priority | Acceptance Criteria |
| --- | --- | --- | --- |
| P2-PAY-03-001 | Tạo payroll period theo tháng/kỳ | P0 | Có start date, end date, pay date, status |
| P2-PAY-03-002 | Trạng thái kỳ lương | P0 | Draft, Collecting Data, Calculated, Reviewing, Approved, Paid, Locked |
| P2-PAY-03-003 | Khóa dữ liệu bảng công khi payroll period được lock | P0 | ATT không cho chỉnh dữ liệu đã khóa nếu thiếu quyền override |
| P2-PAY-03-004 | Cơ chế reopen payroll period | P1 | Chỉ role có quyền đặc biệt được mở lại, bắt buộc audit reason |
| P2-PAY-03-005 | Cảnh báo dữ liệu thiếu trước khi tính lương | P0 | Hiển thị nhân viên thiếu bảng công/salary profile/contract |

### P2-PAY-04: Attendance/Leave payroll input

**Mục tiêu:** Chuẩn hóa dữ liệu ATT/LEAVE làm đầu vào tính lương.

**Backlog items:**

| ID | Nội dung | Priority | Acceptance Criteria |
| --- | --- | --- | --- |
| P2-PAY-04-001 | Tổng hợp ngày công theo kỳ | P0 | Có total work days, paid leave, unpaid leave, late/early/missing |
| P2-PAY-04-002 | Đối soát bảng công trước payroll | P0 | Payroll Officer/HR thấy danh sách bất thường cần xử lý |
| P2-PAY-04-003 | Đồng bộ leave type có lương/không lương | P0 | Leave type có flag ảnh hưởng payroll |
| P2-PAY-04-004 | Tính remote/work trip theo rule payroll | P1 | Remote approved được tính công theo cấu hình |
| P2-PAY-04-005 | Recalculate payroll input khi ATT/LEAVE thay đổi trước lock | P0 | Dữ liệu payroll input cập nhật hoặc cảnh báo stale |

### P2-PAY-05: Payroll calculation draft

**Mục tiêu:** Tính bảng lương nháp từ salary profile, attendance, leave và adjustment.

**Backlog items:**

| ID | Nội dung | Priority | Acceptance Criteria |
| --- | --- | --- | --- |
| P2-PAY-05-001 | Tạo payroll run cho period | P0 | Có thể tạo bảng lương nháp cho toàn công ty hoặc phòng ban |
| P2-PAY-05-002 | Tính gross salary cơ bản | P0 | Gross = salary base + allowance + bonus theo config |
| P2-PAY-05-003 | Tính deduction cơ bản | P0 | Có unpaid leave, late/early penalty nếu bật rule |
| P2-PAY-05-004 | Tính net salary | P0 | Net = gross - deduction |
| P2-PAY-05-005 | Lưu calculation snapshot | P0 | Kết quả không thay đổi ngoài ý muốn khi dữ liệu nguồn thay đổi sau lock |
| P2-PAY-05-006 | Hiển thị công thức tính ở mức giải thích được | P1 | Payroll Officer xem được breakdown từng khoản |

### P2-PAY-06: Payroll review, adjustment & approval

**Mục tiêu:** Cho phép kiểm tra, điều chỉnh và duyệt bảng lương.

| ID | Nội dung | Priority | Acceptance Criteria |
| --- | --- | --- | --- |
| P2-PAY-06-001 | Màn review payroll run | P1 | Xem danh sách nhân viên, gross, deduction, net, status |
| P2-PAY-06-002 | Điều chỉnh dòng lương thủ công | P1 | Có reason, attachment nếu cần, audit log |
| P2-PAY-06-003 | Submit payroll for approval | P1 | Chuyển trạng thái Reviewing/Submitted |
| P2-PAY-06-004 | Approve/Reject payroll | P1 | Người có quyền duyệt hoặc từ chối, có comment |
| P2-PAY-06-005 | Lock payroll sau khi approve/paid | P0 | Không cho sửa nếu không reopen đúng quyền |

### P2-PAY-07: Payslip generation & employee view

**Mục tiêu:** Tạo phiếu lương và cho Employee xem theo quyền.

| ID | Nội dung | Priority | Acceptance Criteria |
| --- | --- | --- | --- |
| P2-PAY-07-001 | Generate payslip từ payroll approved | P1 | Mỗi employee có một payslip cho period |
| P2-PAY-07-002 | Employee xem phiếu lương của chính mình | P1 | Scope Own, không xem được của người khác |
| P2-PAY-07-003 | Download payslip PDF | P2 | File private, kiểm tra quyền trước khi tải |
| P2-PAY-07-004 | Notification khi phiếu lương sẵn sàng | P2 | NOTI gửi in-app cho employee |

### P2-PAY-08: Payroll export & reporting

| ID | Nội dung | Priority | Acceptance Criteria |
| --- | --- | --- | --- |
| P2-PAY-08-001 | Export payroll summary Excel | P1 | Có kiểm tra quyền export và audit log |
| P2-PAY-08-002 | Export payslip batch | P2 | Có file private và expiry nếu dùng signed URL |
| P2-PAY-08-003 | Payroll report theo phòng ban | P2 | Tổng gross/net/deduction theo department |
| P2-PAY-08-004 | Payroll variance report | P2 | So sánh kỳ hiện tại với kỳ trước nếu có dữ liệu |

### P2-PAY-09: Payroll audit, security & sensitive data

| ID | Nội dung | Priority | Acceptance Criteria |
| --- | --- | --- | --- |
| P2-PAY-09-001 | Audit log xem dữ liệu lương nhạy cảm | P0 | View/export/download đều có log nếu policy yêu cầu |
| P2-PAY-09-002 | Field masking cho salary/bank/deduction | P0 | Không có permission thì trả masked/null |
| P2-PAY-09-003 | Permission riêng cho payroll export | P0 | Export không dùng chung quyền view |
| P2-PAY-09-004 | Security test cho payroll | P0 | Không truy cập chéo employee/company |

---

### 10.2 RECRUIT Epic Overview

RECRUIT là module quản lý tuyển dụng từ job opening đến candidate pipeline và chuyển ứng viên trúng tuyển thành nhân viên.

### RECRUIT MVP Phase 2 scope

| Epic ID | Epic | Priority | Dependency |
| --- | --- | --- | --- |
| P2-REC-01 | Recruitment foundation & permission model | P0 | AUTH, FOUNDATION |
| P2-REC-02 | Job opening management | P0 | HR department/position |
| P2-REC-03 | Candidate profile management | P0 | FILE, AUDIT |
| P2-REC-04 | Recruitment pipeline & candidate stages | P0 | REC-02, REC-03 |
| P2-REC-05 | Interview scheduling & feedback | P1 | NOTI, Calendar integration optional |
| P2-REC-06 | Offer & hiring decision | P1 | HR, AUTH |
| P2-REC-07 | Convert candidate to employee | P0 | HR employee creation, employee code config |
| P2-REC-08 | Recruitment dashboard & reporting | P2 | DASH |
| P2-REC-09 | Candidate privacy & audit | P0 | AUTH, AUDIT |

### P2-REC-01: Recruitment foundation & permission model

| ID | Nội dung | Priority | Acceptance Criteria |
| --- | --- | --- | --- |
| P2-REC-01-001 | Bật module `RECRUIT` trong module catalog | P0 | App hiện theo feature flag/permission |
| P2-REC-01-002 | Seed permission RECRUIT | P0 | Có quyền job, candidate, interview, offer, export |
| P2-REC-01-003 | Seed role `RECRUITER` | P0 | Recruiter có scope Company hoặc Department theo cấu hình |
| P2-REC-01-004 | Candidate data privacy rule | P0 | Dữ liệu ứng viên không hiển thị cho user thiếu quyền |
| P2-REC-01-005 | Audit log tuyển dụng | P0 | Tạo/sửa/xóa/chuyển stage/offer/hire đều có log |

### P2-REC-02: Job opening management

| ID | Nội dung | Priority | Acceptance Criteria |
| --- | --- | --- | --- |
| P2-REC-02-001 | Tạo job opening | P0 | Có title, department, position, headcount, status |
| P2-REC-02-002 | Cập nhật job opening | P0 | Có audit log thay đổi |
| P2-REC-02-003 | Đóng/tạm dừng job opening | P1 | Không cho thêm candidate mới nếu Closed |
| P2-REC-02-004 | Danh sách job openings | P0 | Search/filter theo status, department, recruiter |
| P2-REC-02-005 | Gán recruiter phụ trách | P1 | Recruiter nhận thông báo khi được assign |

### P2-REC-03: Candidate profile management

| ID | Nội dung | Priority | Acceptance Criteria |
| --- | --- | --- | --- |
| P2-REC-03-001 | Tạo candidate profile | P0 | Có tên, email/phone, source, job opening |
| P2-REC-03-002 | Upload CV/file ứng viên | P1 | File private, kiểm tra quyền trước khi tải |
| P2-REC-03-003 | Kiểm tra trùng candidate cơ bản | P1 | Cảnh báo trùng email/phone trong company |
| P2-REC-03-004 | Candidate detail | P0 | Hiển thị thông tin, stage, history, files |
| P2-REC-03-005 | Candidate notes/comments | P1 | Có người tạo, thời gian, permission |

### P2-REC-04: Recruitment pipeline & candidate stages

| ID | Nội dung | Priority | Acceptance Criteria |
| --- | --- | --- | --- |
| P2-REC-04-001 | Pipeline stage mặc định | P0 | New, Screening, Interview, Offer, Hired, Rejected |
| P2-REC-04-002 | Chuyển stage candidate | P0 | Có reason/comment và history |
| P2-REC-04-003 | Kanban recruitment board | P1 | Kéo/thả stage nếu có quyền |
| P2-REC-04-004 | Candidate status rule | P0 | Hired/Rejected là trạng thái cuối nếu không reopen |
| P2-REC-04-005 | Notification khi candidate cần xử lý | P2 | Gửi cho recruiter/hiring manager |

### P2-REC-05: Interview scheduling & feedback

| ID | Nội dung | Priority | Acceptance Criteria |
| --- | --- | --- | --- |
| P2-REC-05-001 | Tạo lịch phỏng vấn | P1 | Có candidate, interviewer, time, location/link |
| P2-REC-05-002 | Gửi thông báo phỏng vấn | P1 | NOTI gửi cho interviewer/recruiter |
| P2-REC-05-003 | Ghi feedback phỏng vấn | P1 | Có rating/comment/recommendation |
| P2-REC-05-004 | Lịch sử interview | P1 | Candidate detail hiển thị timeline |
| P2-REC-05-005 | Calendar integration placeholder | P3 | Chỉ chừa thiết kế, chưa bắt buộc tích hợp Google/Microsoft |

### P2-REC-06: Offer & hiring decision

| ID | Nội dung | Priority | Acceptance Criteria |
| --- | --- | --- | --- |
| P2-REC-06-001 | Tạo offer draft | P1 | Có vị trí, start date, salary expectation/offer nếu có quyền |
| P2-REC-06-002 | Approve offer nội bộ | P2 | Có workflow đơn giản nếu bật cấu hình |
| P2-REC-06-003 | Candidate accept/reject offer manual status | P1 | Recruiter cập nhật kết quả |
| P2-REC-06-004 | Chuyển candidate sang Ready to Hire | P0 | Chỉ candidate offer accepted mới chuyển sang hire |

### P2-REC-07: Convert candidate to employee

| ID | Nội dung | Priority | Acceptance Criteria |
| --- | --- | --- | --- |
| P2-REC-07-001 | Convert candidate to employee draft | P0 | Tạo employee từ thông tin candidate |
| P2-REC-07-002 | Map candidate fields sang HR employee fields | P0 | Có mapping rõ: name, phone, email, department, position |
| P2-REC-07-003 | Sinh employee code theo cấu hình HR | P0 | Dùng sequence/code config hiện có |
| P2-REC-07-004 | Tạo user account khi onboard nếu chọn | P1 | AUTH tạo user và gửi notification |
| P2-REC-07-005 | Link candidate -> employee | P0 | Không tạo trùng employee nếu candidate đã hired |

### P2-REC-08: Recruitment dashboard & reporting

| ID | Nội dung | Priority | Acceptance Criteria |
| --- | --- | --- | --- |
| P2-REC-08-001 | Widget job opening đang tuyển | P2 | Dashboard hiển thị theo quyền |
| P2-REC-08-002 | Widget candidate theo stage | P2 | Tổng số candidate theo pipeline |
| P2-REC-08-003 | Report source effectiveness cơ bản | P3 | Candidate count theo source |
| P2-REC-08-004 | Export candidate list | P2 | Có quyền export và audit log |

### P2-REC-09: Candidate privacy & audit

| ID | Nội dung | Priority | Acceptance Criteria |
| --- | --- | --- | --- |
| P2-REC-09-001 | Mask dữ liệu nhạy cảm ứng viên | P0 | Email/phone/CV có thể hạn chế theo quyền |
| P2-REC-09-002 | Audit khi tải CV | P0 | File access log hoặc audit log được ghi |
| P2-REC-09-003 | Chống truy cập candidate ngoài scope | P0 | API trả 403/404 an toàn |
| P2-REC-09-004 | Data retention candidate | P2 | Có policy lưu trữ/xóa mềm candidate rejected |

---

## 11. Backlog cải tiến module MVP phục vụ Phase 2

### 11.1 AUTH/RBAC backlog

| ID | Nội dung | Priority | Phục vụ |
| --- | --- | --- | --- |
| PMVP-AUTH-001 | Bổ sung role `PAYROLL_OFFICER` và `RECRUITER` | P0 | PAYROLL, RECRUIT |
| PMVP-AUTH-002 | Bổ sung permission group PAYROLL | P0 | PAYROLL |
| PMVP-AUTH-003 | Bổ sung permission group RECRUIT | P0 | RECRUIT |
| PMVP-AUTH-004 | Field-level permission cho dữ liệu lương | P0 | PAYROLL |
| PMVP-AUTH-005 | Field-level permission cho dữ liệu ứng viên | P1 | RECRUIT |
| PMVP-AUTH-006 | Audit log cho quyền export/download dữ liệu nhạy cảm | P0 | PAYROLL, RECRUIT |

### 11.2 HR backlog

| ID | Nội dung | Priority | Phục vụ |
| --- | --- | --- | --- |
| PMVP-HR-001 | Bổ sung salary profile extension hoặc bảng riêng Payroll | P0 | PAYROLL |
| PMVP-HR-002 | Bổ sung bank account field với permission riêng nếu cần | P1 | PAYROLL |
| PMVP-HR-003 | Chuẩn hóa contract effective date cho payroll | P0 | PAYROLL |
| PMVP-HR-004 | Convert candidate to employee API/service contract | P0 | RECRUIT |
| PMVP-HR-005 | Onboarding basic status sau khi candidate hired | P2 | RECRUIT |
| PMVP-HR-006 | Import Excel nhân viên — **ĐÃ KÉO VÀO MVP 2026-07-13** (→ IMP02-STORY-122, WO S5-HR-IMPORT-BE-1/FE-1) | P2 | Data migration/HR ops |
| PMVP-HR-007 | Org chart nâng cao — **phần biểu đồ trực quan + cây nhân sự theo quản lý ĐÃ KÉO VÀO MVP 2026-07-13** (→ IMP02-STORY-123, WO S5-HR-ORGCHART-BE-1/FE-1); phần nâng cao còn lại (drag-drop tái cơ cấu, lịch sử thay đổi cơ cấu, export ảnh) giữ Phase sau | P3 | Phase sau |

### 11.3 ATT backlog

| ID | Nội dung | Priority | Phục vụ |
| --- | --- | --- | --- |
| PMVP-ATT-001 | Attendance period lock | P0 | PAYROLL |
| PMVP-ATT-002 | Payroll-ready attendance summary | P0 | PAYROLL |
| PMVP-ATT-003 | Đối soát bảng công trước payroll | P0 | PAYROLL |
| PMVP-ATT-004 | Export bảng công có kiểm quyền | P1 | PAYROLL |
| PMVP-ATT-005 | Import log chấm công CSV/Excel | P2 | Phase sau |
| PMVP-ATT-006 | Tích hợp máy chấm công vật lý | P3 | Phase sau |
| PMVP-ATT-007 | Overtime workflow | P2 | Payroll nâng cao |

### 11.4 LEAVE backlog

| ID | Nội dung | Priority | Phục vụ |
| --- | --- | --- | --- |
| PMVP-LEAVE-001 | Flag leave type: paid/unpaid/payroll impact | P0 | PAYROLL |
| PMVP-LEAVE-002 | Leave summary by payroll period | P0 | PAYROLL |
| PMVP-LEAVE-003 | Lock leave changes affecting closed payroll | P0 | PAYROLL |
| PMVP-LEAVE-004 | Recalculate attendance/payroll input khi revoke leave | P1 | PAYROLL |
| PMVP-LEAVE-005 | Accrual job nâng cao | P2 | Phase sau |
| PMVP-LEAVE-006 | Multi-level approval | P2 | Phase sau |

### 11.5 NOTI backlog

| ID | Nội dung | Priority | Phục vụ |
| --- | --- | --- | --- |
| PMVP-NOTI-001 | Event payroll generated | P1 | PAYROLL |
| PMVP-NOTI-002 | Event payslip available | P1 | PAYROLL |
| PMVP-NOTI-003 | Event payroll approval required | P1 | PAYROLL |
| PMVP-NOTI-004 | Event candidate assigned | P2 | RECRUIT |
| PMVP-NOTI-005 | Event interview scheduled | P1 | RECRUIT |
| PMVP-NOTI-006 | Event candidate hired | P1 | RECRUIT/HR |
| PMVP-NOTI-007 | Email notification channel | P2 | Phase sau/Recruit |

### 11.6 DASH backlog

| ID | Nội dung | Priority | Phục vụ |
| --- | --- | --- | --- |
| PMVP-DASH-001 | Payroll pending approval widget | P2 | PAYROLL |
| PMVP-DASH-002 | Payroll period status widget | P2 | PAYROLL |
| PMVP-DASH-003 | Recruitment pipeline widget | P2 | RECRUIT |
| PMVP-DASH-004 | Candidate interview today widget | P2 | RECRUIT |
| PMVP-DASH-005 | Executive dashboard placeholder | P3 | Phase sau |

### 11.7 FOUNDATION backlog

| ID | Nội dung | Priority | Phục vụ |
| --- | --- | --- | --- |
| PMVP-FND-001 | Module registry activation for Phase 2 modules | P0 | PAYROLL, RECRUIT |
| PMVP-FND-002 | Sequence counters cho payroll run, payslip, candidate, job opening | P0 | PAYROLL, RECRUIT |
| PMVP-FND-003 | File category cho payslip/CV/offer | P1 | PAYROLL, RECRUIT |
| PMVP-FND-004 | Data retention policy cho payslip/candidate/CV | P1 | PAYROLL, RECRUIT |
| PMVP-FND-005 | Export job framework | P2 | Payroll/Recruit export |

---

## 12. Technical Debt & Hardening Backlog sau MVP

### 12.1 Backend/API

| ID | Nội dung | Priority | Ghi chú |
| --- | --- | --- | --- |
| PMVP-TECH-BE-001 | Chuẩn hóa service contract giữa module | P1 | Cần cho PAYROLL đọc ATT/LEAVE/HR ổn định |
| PMVP-TECH-BE-002 | Tối ưu query list lớn | P1 | HR/ATT/LEAVE/TASK |
| PMVP-TECH-BE-003 | Batch job framework | P1 | Payroll calculation, notification digest, export |
| PMVP-TECH-BE-004 | Idempotency middleware mở rộng | P1 | Payroll run, candidate convert |
| PMVP-TECH-BE-005 | Audit middleware reusable | P0 | Dữ liệu nhạy cảm Phase 2 |

### 12.2 Frontend

| ID | Nội dung | Priority | Ghi chú |
| --- | --- | --- | --- |
| PMVP-TECH-FE-001 | App/module registry support cho Phase 2 | P0 | PAYROLL/RECRUIT app visibility |
| PMVP-TECH-FE-002 | Field masking component | P0 | Salary/candidate sensitive fields |
| PMVP-TECH-FE-003 | Export/download state handling | P1 | Payroll/Recruit export |
| PMVP-TECH-FE-004 | Large table virtualization nếu cần | P2 | Payroll/candidate lists |
| PMVP-TECH-FE-005 | Form dirty-state guard chuẩn hóa | P2 | Payroll/recruit multi-step forms |

### 12.3 Database

| ID | Nội dung | Priority | Ghi chú |
| --- | --- | --- | --- |
| PMVP-TECH-DB-001 | Review index cho ATT/LEAVE payroll queries | P0 | Chặn query chậm khi tính lương |
| PMVP-TECH-DB-002 | Partition strategy cho audit/log lớn | P2 | Phase scale |
| PMVP-TECH-DB-003 | Migration template cho module mới | P0 | PAYROLL/RECRUIT |
| PMVP-TECH-DB-004 | Data retention policy enforcement | P2 | Candidate/CV/log |
| PMVP-TECH-DB-005 | Seed permission idempotent mở rộng | P0 | Phase 2 roles/permissions |

### 12.4 DevOps/Operations

| ID | Nội dung | Priority | Ghi chú |
| --- | --- | --- | --- |
| PMVP-OPS-001 | Monitoring sensitive API access | P1 | Payroll/candidate data |
| PMVP-OPS-002 | Backup restore drill sau MVP | P0 | Trước Phase 2 |
| PMVP-OPS-003 | Alert cho failed background jobs | P1 | Payroll calculation/export |
| PMVP-OPS-004 | Release toggle/feature flag per module | P0 | Bật PAYROLL/RECRUIT an toàn |
| PMVP-OPS-005 | Support runbook cập nhật Phase 2 | P1 | Helpdesk/CS |

---

## 13. Phase 2 Documentation Plan

Trước khi code Phase 2, cần triển khai bộ tài liệu sau:

### 13.1 Product/SPEC

| Tài liệu | Mục tiêu | Priority |
| --- | --- | --- |
| PRD-01 Phase 2 Product Requirements | Chốt mục tiêu Phase 2 | P0 |
| SPEC-09 PAYROLL | Đặc tả nghiệp vụ tiền lương | P0 |
| SPEC-10 RECRUIT | Đặc tả nghiệp vụ tuyển dụng | P0 |
| SPEC-11 Phase 2 Cross-module Integration | Tích hợp HR/ATT/LEAVE/AUTH/DASH/NOTI | P1 |

### 13.2 Database

| Tài liệu | Mục tiêu | Priority |
| --- | --- | --- |
| DB-11 Phase 2 Database Overview | Tổng quan database Phase 2 | P0 |
| DB-12 PAYROLL Database Design | Bảng payroll, payslip, salary components | P0 |
| DB-13 RECRUIT Database Design | Bảng job, candidate, pipeline, interview | P0 |
| DB-14 Phase 2 Index & Performance | Index/query cho payroll/recruit | P1 |
| DB-15 Phase 2 Migration & Seed | Migration/seed role/permission/module | P0 |

### 13.3 API

| Tài liệu | Mục tiêu | Priority |
| --- | --- | --- |
| API-09 FOUNDATION/API bổ sung | Module registry, settings, file, audit nếu chưa có | P0 |
| API-10 PAYROLL API Design | API payroll period, run, payslip, export | P0 |
| API-11 RECRUIT API Design | API job, candidate, pipeline, interview, hire | P0 |
| API-12 Phase 2 Internal Contracts | Contract HR/ATT/LEAVE -> PAYROLL, RECRUIT -> HR | P1 |

### 13.4 UI/UX

| Tài liệu | Mục tiêu | Priority |
| --- | --- | --- |
| UI-11 Payroll UI Design | Màn payroll period, payroll run, payslip | P0 |
| UI-12 Recruitment UI Design | Màn job, candidate, pipeline, interview | P0 |
| UI-13 Phase 2 Dashboard/Notification UI | Widget/event Phase 2 | P2 |
| UI-14 Phase 2 Prototype & Handoff | Prototype/handoff frontend | P1 |

### 13.5 Implementation/Delivery

| Tài liệu | Mục tiêu | Priority |
| --- | --- | --- |
| BACKEND-15 Phase 2 Backend Architecture | Cách mở module payroll/recruit | P0 |
| BACKEND-16 Payroll Backend | Triển khai backend payroll | P0 |
| BACKEND-17 Recruitment Backend | Triển khai backend recruitment | P0 |
| FRONTEND-15 Payroll Frontend | Triển khai giao diện payroll | P0 |
| FRONTEND-16 Recruitment Frontend | Triển khai giao diện recruitment | P0 |
| QA-11 Phase 2 Test Strategy | Kế hoạch test Phase 2 | P0 |
| QA-12 Payroll Test Matrix | Test tính lương, quyền, export | P0 |
| QA-13 Recruitment Test Matrix | Test tuyển dụng, candidate, hire | P0 |
| DEVOPS-13 Phase 2 Release Plan | Feature flag, deployment, rollback | P1 |

---

## 14. Phase 2 Milestone Plan

### 14.1 Milestone tổng quan

| Milestone | Tên | Mục tiêu | Output |
| --- | --- | --- | --- |
| M0 | Post-MVP Review | Chốt feedback, bug, tech debt | Backlog đã phân loại |
| M1 | Phase 2 Discovery | Làm rõ PAYROLL/RECRUIT | PRD-01, scope, risk |
| M2 | Phase 2 Design | Viết SPEC/DB/API/UI | Tài liệu thiết kế chốt |
| M3 | Foundation Upgrade | Role, permission, module registry, settings | Nền tảng Phase 2 |
| M4 | Payroll Core | Salary, period, payroll run | Payroll MVP nội bộ |
| M5 | Recruitment Core | Job, candidate, pipeline | Recruit MVP nội bộ |
| M6 | Integration & QA | Tích hợp HR/ATT/LEAVE/NOTI/DASH | Test pass |
| M7 | UAT Phase 2 | Người dùng kiểm thử | UAT sign-off |
| M8 | Phase 2 Release | Go-live PAYROLL/RECRUIT | Release notes, support runbook |

### 14.2 Gợi ý sprint Phase 2

| Sprint | Trọng tâm | Kết quả mong muốn |
| --- | --- | --- |
| Sprint 0 | Discovery, design, backlog grooming | Scope Phase 2 rõ ràng, backlog ready |
| Sprint 1 | Foundation Phase 2 | Roles, permissions, module registry, DB/API skeleton |
| Sprint 2 | Payroll data foundation | Salary profile, payroll period, attendance/leave input |
| Sprint 3 | Payroll run & payslip | Tính lương nháp, review, payslip |
| Sprint 4 | Recruitment foundation | Job opening, candidate profile, files, pipeline |
| Sprint 5 | Recruitment workflow | Interview, offer, convert candidate to employee |
| Sprint 6 | Integration, QA, UAT | E2E payroll/recruit, permission, security, performance |
| Sprint 7 | Stabilization & release | Bugfix, migration rehearsal, release candidate |

---

## 15. Definition of Ready cho backlog Phase 2

Một item chỉ được kéo vào sprint khi đạt:

| Điều kiện | Bắt buộc |
| --- | --- |
| Có mô tả nghiệp vụ rõ ràng | Có |
| Có owner | Có |
| Có priority | Có |
| Có acceptance criteria | Có |
| Có dependency rõ | Có |
| Có thiết kế UI nếu là màn hình | Có |
| Có API contract nếu gọi backend | Có |
| Có DB impact nếu thay schema | Có |
| Có permission/data scope | Có |
| Có test case chính | Có |
| Không còn câu hỏi blocker | Có |

---

## 16. Definition of Done cho Phase 2 item

Một item được xem là hoàn tất khi:

1. Code đã merge vào nhánh chính theo quy trình.
2. Unit test/integration test liên quan pass.
3. API contract cập nhật nếu có.
4. Migration/seed chạy được trên local/staging.
5. Permission/data scope được kiểm thử.
6. Audit log được ghi nếu là thao tác nhạy cảm.
7. UI có loading/empty/error/forbidden state.
8. QA đã xác nhận acceptance criteria.
9. Không tạo regression cho MVP.
10. Tài liệu liên quan được cập nhật.

---

## 17. Rủi ro Phase 2 và biện pháp giảm thiểu

| Rủi ro | Mức độ | Tác động | Biện pháp |
| --- | --- | --- | --- |
| Tính lương sai | Cao | Mất niềm tin, rủi ro tài chính | Calculation snapshot, review, approval, test matrix lớn |
| Lộ dữ liệu lương | Cao | Rủi ro bảo mật nghiêm trọng | Field-level permission, masking, audit, security test |
| Dữ liệu ATT/LEAVE chưa sạch | Cao | Payroll input sai | Đối soát bảng công, period lock, anomaly report |
| Candidate data bị lộ | Trung bình/Cao | Rủi ro privacy | Scope, masking, file access log |
| Phase 2 scope creep | Cao | Trễ deadline | Scope gate, parking lot, change control |
| Module mới phá MVP | Cao | Regression production | Feature flag, regression test, staged rollout |
| Query payroll chậm | Trung bình | Timeout tính lương | Index, background job, caching, batch processing |
| Convert candidate tạo trùng employee | Trung bình | Dữ liệu HR sai | Duplicate check, unique constraint, review step |
| Export dữ liệu nhạy cảm không kiểm soát | Cao | Rủi ro compliance | Export permission riêng, audit log, watermark nếu cần |

---

## 18. Phase 2 Quality Gate

### 18.1 Product Gate

- [ ] PRD-01 Phase 2 được duyệt.
- [ ] SPEC-09 PAYROLL được duyệt.
- [ ] SPEC-10 RECRUIT được duyệt.
- [ ] Scope Phase 2 có danh sách in/out rõ ràng.
- [ ] Backlog P0/P1 có acceptance criteria.

### 18.2 Design Gate

- [ ] DB Phase 2 được review.
- [ ] API Phase 2 có contract rõ.
- [ ] UI/UX Phase 2 có wireframe/prototype cho P0/P1.
- [ ] Permission/data scope matrix hoàn tất.
- [ ] Notification event/dashboard widget Phase 2 được xác định.

### 18.3 Engineering Gate

- [ ] Migration/seed Phase 2 chạy được trên database trống và database đã có MVP.
- [ ] Feature flag/module flag hoạt động.
- [ ] Backend guard kiểm tra permission/scope.
- [ ] Frontend app registry hiển thị PAYROLL/RECRUIT đúng quyền.
- [ ] Background job/export framework sẵn sàng nếu cần.

### 18.4 QA Gate

- [ ] Payroll calculation test matrix pass.
- [ ] Recruitment workflow test matrix pass.
- [ ] Permission/data scope test pass.
- [ ] Security test dữ liệu lương/candidate pass.
- [ ] Regression MVP pass.
- [ ] UAT sign-off.

### 18.5 Release Gate

- [ ] Backup trước release.
- [ ] Migration rehearsal pass.
- [ ] Rollback plan có thể thực thi.
- [ ] Monitoring/alert cập nhật.
- [ ] Support runbook cập nhật.
- [ ] Release notes hoàn tất.

---

## 19. Backlog Board đề xuất

### 19.1 Board columns

```text
New
Triage
Discovery
Ready for Design
Designing
Ready for Development
In Development
Code Review
Ready for QA
QA Testing
UAT
Ready for Release
Done
Parked
Rejected
```

### 19.2 Required fields trên ticket

| Field | Bắt buộc | Ghi chú |
| --- | --- | --- |
| Backlog ID | Có | Ví dụ `P2-PAY-05-001` |
| Title | Có | Ngắn gọn |
| Module | Có | PAYROLL/RECRUIT/AUTH/HR/ATT/LEAVE/... |
| Type | Có | Feature/Bug/Tech debt/Security/UX/Ops |
| Priority | Có | P0-P4 |
| Owner | Có | PO/Tech/QA/Design |
| Description | Có | Mô tả nghiệp vụ |
| Acceptance Criteria | Có | Điều kiện nghiệm thu |
| Dependency | Có nếu có | Ticket/module/tài liệu liên quan |
| Permission/Data scope | Có nếu liên quan dữ liệu | Bắt buộc cho API/screen |
| Test notes | Có | Unit/API/E2E/UAT |
| Release note needed | Có/Không | Để chuẩn bị release |

---

## 20. Metrics theo dõi sau MVP và Phase 2

### 20.1 Product metrics

| Metric | Mục tiêu |
| --- | --- |
| Active users weekly | Đo mức sử dụng MVP |
| Check-in/check-out success rate | Đánh giá ATT core |
| Leave approval turnaround time | Đánh giá LEAVE workflow |
| Task completion/overdue ratio | Đánh giá TASK usage |
| Notification read rate | Đánh giá NOTI hiệu quả |
| Dashboard visit rate | Đánh giá DASH có hữu ích không |
| Payroll run accuracy | Đánh giá Phase 2 payroll |
| Payslip view rate | Đánh giá adoption payroll |
| Candidate stage conversion | Đánh giá recruitment funnel |
| Candidate-to-employee conversion success | Đánh giá tích hợp RECRUIT -> HR |

### 20.2 Engineering metrics

| Metric | Mục tiêu |
| --- | --- |
| P0/P1 bug count | Giảm dần sau release |
| API latency P95 | Không vượt ngưỡng đã đặt |
| Error rate | Theo dõi theo module |
| Failed background jobs | Cảnh báo ngay |
| DB slow queries | Theo dõi query payroll/report |
| Permission test pass rate | 100% cho flows nhạy cảm |
| Regression pass rate | 100% trước release Phase 2 |
| Deployment rollback count | Theo dõi release stability |

---

## 21. Change Control cho Phase 2

### 21.1 Quy tắc thêm scope mới

Một yêu cầu mới chỉ được thêm vào Phase 2 nếu đáp ứng ít nhất một điều kiện:

1. Chặn PAYROLL hoặc RECRUIT.
2. Là lỗi bảo mật hoặc dữ liệu nghiêm trọng.
3. Là yêu cầu pháp lý/compliance bắt buộc.
4. Có giá trị nghiệp vụ rất cao và effort thấp.
5. Được Product Owner và Tech Lead đồng ý đổi scope.

### 21.2 Quy tắc đưa vào parking lot

Đưa vào parking lot nếu:

1. Không liên quan trực tiếp PAYROLL/RECRUIT.
2. Không chặn go-live Phase 2.
3. Effort cao nhưng giá trị chưa rõ.
4. Cần thêm nghiên cứu nghiệp vụ.
5. Thuộc roadmap Phase 3+.

### 21.3 Quy tắc đổi priority

Priority chỉ được đổi khi có bằng chứng mới:

1. Feedback từ người dùng thật.
2. Dữ liệu usage/support.
3. Bug hoặc incident production.
4. Thay đổi deadline kinh doanh.
5. Rủi ro bảo mật/kỹ thuật mới phát hiện.

---

## 22. Parking Lot Phase 3+

| ID | Module | Nội dung | Phase đề xuất | Ghi chú |
| --- | --- | --- | --- | --- |
| PARK-ASSET-001 | ASSET | Quản lý danh sách tài sản | Phase 3 | Gắn employee/department |
| PARK-ASSET-002 | ASSET | Cấp phát/thu hồi tài sản | Phase 3 | Cần HR integration |
| PARK-ROOM-001 | ROOM | Quản lý phòng họp | Phase 3 | Cần calendar/booking |
| PARK-ROOM-002 | ROOM | Đặt phòng và kiểm tra trùng lịch | Phase 3 | Có thể tích hợp Google Calendar sau |
| PARK-CHAT-001 | CHAT | Chat cá nhân/nhóm | Phase 4 | Cần realtime infrastructure |
| PARK-SOCIAL-001 | SOCIAL | Newsfeed nội bộ | Phase 4 | Cần moderation/notification |
| PARK-MOBILE-001 | MOBILE | Mobile app check-in/leave/task/noti | Phase 5 hoặc track riêng | Cần API ổn định |
| PARK-AI-001 | AI | AI summary dashboard | Phase 5 | Cần dữ liệu sạch và policy rõ |
| PARK-AI-002 | AI | AI anomaly detection chấm công | Phase 5 | Cần historical data |
| PARK-INTEG-001 | INTEGRATION | Máy chấm công vật lý | Phase sau | Có thể ưu tiên nếu khách hàng cần |
| PARK-INTEG-002 | INTEGRATION | Email/calendar integration | Phase sau | Có thể hỗ trợ recruit/room |
| PARK-BI-001 | REPORTING | BI/report nâng cao | Phase sau | Có thể tách reporting service |

---

## 23. Kế hoạch họp và nghi thức vận hành backlog

### 23.1 Post-MVP Review Meeting

| Nội dung | Người tham gia |
| --- | --- |
| Review kết quả MVP | PO, Tech Lead, QA Lead, DevOps, Stakeholders |
| Review bug/incident/support | QA, Support, Tech Lead |
| Review UAT feedback | PO, Business, UI/UX |
| Review technical debt | Backend, Frontend, DevOps |
| Chốt backlog P0/P1 | PO, Tech Lead, QA Lead |

### 23.2 Phase 2 Discovery Workshop

| Nội dung | Người tham gia |
| --- | --- |
| Quy trình tính lương hiện tại | HR, Payroll, PO |
| Quy trình tuyển dụng hiện tại | HR, Recruiter, PO |
| Dữ liệu đầu vào/đầu ra | HR, Payroll, Backend, DB |
| Quyền truy cập dữ liệu nhạy cảm | Admin, HR, Payroll, Tech Lead |
| Báo cáo/export cần thiết | HR, Payroll, Recruiter |
| UAT scenario Phase 2 | QA, Business |

### 23.3 Backlog Grooming định kỳ

Tần suất đề xuất:

```text
1 lần/tuần trong giai đoạn discovery/design
2 lần/tuần khi vào sprint delivery Phase 2
```

Agenda:

1. Review ticket mới.
2. Gán type/priority/owner.
3. Làm rõ acceptance criteria.
4. Xác định dependency.
5. Đưa ticket vào ready/parked/rejected.

---

## 24. Deliverables sau khi chốt IMPLEMENTATION-10

Sau tài liệu này, các deliverables cần có:

| Deliverable | Owner | Deadline đề xuất |
| --- | --- | --- |
| Post-MVP backlog board | Product Owner | Trước Phase 2 discovery |
| Bug/tech debt shortlist | QA Lead + Tech Lead | Trước Phase 2 discovery |
| PRD-01 Phase 2 | Product Owner | Sprint 0 |
| SPEC-09 PAYROLL | Product Owner/BA | Sprint 0 |
| SPEC-10 RECRUIT | Product Owner/BA | Sprint 0 |
| DB/API/UI design Phase 2 | Tech/Design Leads | Sprint 0-1 |
| QA Phase 2 strategy | QA Lead | Sprint 0-1 |
| DevOps Phase 2 release plan | DevOps Lead | Sprint 1 |

---

## 25. Checklist chốt tài liệu IMPLEMENTATION-10

- [ ] Xác nhận MVP đã release hoặc đủ điều kiện post-MVP review.
- [ ] Xác nhận Phase 2 ưu tiên PAYROLL và RECRUIT.
- [ ] Xác nhận module ngoài Phase 2 được đưa vào parking lot.
- [ ] Xác nhận backlog categories và ticket fields.
- [ ] Xác nhận scoring/priority model.
- [ ] Xác nhận Phase 2 epics.
- [ ] Xác nhận dependency từ MVP sang Phase 2.
- [ ] Xác nhận documentation plan Phase 2.
- [ ] Xác nhận quality gate và release gate.
- [ ] Xác nhận owner cho các bước tiếp theo.

---

## 26. Kết luận

IMPLEMENTATION-10 là tài liệu cầu nối giữa MVP và Phase 2.

MVP đã xây nền tảng gồm AUTH, HR, ATT, LEAVE, TASK, DASH và NOTI. Phase 2 nên tiếp tục mở rộng theo hướng có giá trị nghiệp vụ cao nhất: PAYROLL và RECRUIT. Hai module này tận dụng trực tiếp dữ liệu HR, ATT, LEAVE, AUTH, NOTI và DASH đã có trong MVP, đồng thời yêu cầu tăng cường bảo mật, audit log, data scope, export, background job và quy trình đối soát dữ liệu.

Nguyên tắc quan trọng nhất khi bước sang Phase 2:

```text
Ổn định MVP trước.
Chốt backlog rõ trước.
Thiết kế dữ liệu và quyền thật chắc trước.
Sau đó mới triển khai PAYROLL và RECRUIT.
```

Bước tiếp theo khuyến nghị:

```text
PRD-01: Phase 2 Product Requirements
SPEC-09: PAYROLL
SPEC-10: RECRUIT
DB-11: Phase 2 Database Overview
API-10: PAYROLL API Design
API-11: RECRUIT API Design
UI-11: Payroll UI Design
UI-12: Recruitment UI Design
QA-11: Phase 2 Test Strategy
```
