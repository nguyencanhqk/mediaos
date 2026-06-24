# QA-08: BUG TRACKING, REGRESSION & RELEASE CRITERIA
# QUẢN LÝ LỖI, KIỂM THỬ HỒI QUY & TIÊU CHÍ PHÁT HÀNH

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | QA-08 |
| Tên tài liệu | Bug Tracking, Regression & Release Criteria |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | QA & Release Readiness - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-07 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

Tài liệu QA-08 định nghĩa quy trình **quản lý bug**, **kiểm thử hồi quy** và **tiêu chí phát hành** cho hệ thống quản lý doanh nghiệp nội bộ ở giai đoạn MVP Version 1.0.

QA-08 dùng để:

1. Chuẩn hóa cách ghi nhận, phân loại, xử lý và đóng bug.
2. Chuẩn hóa vòng đời bug từ khi phát hiện đến khi xác nhận đã sửa.
3. Đảm bảo mọi bug quan trọng đều có bằng chứng, bước tái hiện, môi trường, mức độ ảnh hưởng và liên kết với test case.
4. Xác định bộ regression test bắt buộc trước mỗi lần release.
5. Xác định tiêu chí release, tiêu chí no-go, tiêu chí rollback và tiêu chí hotfix.
6. Giúp Product, QA, Frontend, Backend, DevOps và Stakeholder có cùng chuẩn ra quyết định phát hành.
7. Làm cơ sở cho release checklist, QA sign-off, UAT sign-off và production deployment.

QA-08 không thay thế QA-01 đến QA-07. Tài liệu này đóng vai trò là lớp kiểm soát cuối cùng trước release, tổng hợp kết quả từ test plan, test case matrix, E2E, API, permission, security và performance testing.

---

## 3. Vị trí QA-08 trong chuỗi tài liệu QA

```text
QA-01: QA Strategy & Test Plan
QA-02: Test Case Matrix theo module
QA-03: End-to-End Flow Testing
QA-04: API Testing & Contract Testing
QA-05: Permission, Role & Data Scope Testing
QA-06: Security Testing
QA-07: Performance & Load Testing
QA-08: Bug Tracking, Regression & Release Criteria
QA-09: UAT Plan & Business Acceptance
QA-10: MVP Release Readiness Checklist
```

QA-08 là lớp kiểm soát chất lượng bug/regression/release của nhóm QA MVP (sau QA-08 còn QA-09 UAT và QA-10 Release Checklist), tập trung vào:

```text
Bug lifecycle
-> Triage
-> Fix verification
-> Regression planning
-> Release gate
-> Go/No-Go decision
-> Post-release monitoring
-> Hotfix/rollback criteria
```

---

## 4. Căn cứ triển khai

QA-08 bám theo các quyết định đã chốt trong toàn bộ bộ tài liệu dự án:

1. MVP gồm các module lõi: `AUTH`, `HR`, `ATT`, `LEAVE`, `TASK`, `DASH`, `NOTI` và lớp `FOUNDATION/SYSTEM`.
2. Hệ thống cần có phân quyền theo vai trò và data scope: Own, Team, Department, Company, System; riêng TASK có thêm Project scope.
3. Backend là nguồn kiểm soát quyền cuối cùng, không chỉ dựa vào frontend guard.
4. Dữ liệu nhạy cảm như hồ sơ nhân sự, hợp đồng, dữ liệu chấm công, dữ liệu nghỉ phép, log hệ thống phải được bảo vệ theo quyền.
5. Nghiệp vụ quan trọng cần có trạng thái, lịch sử, audit log và khả năng truy vết.
6. API dùng chuẩn response/error/pagination thống nhất và phải xử lý các lỗi 401, 403, 404, 409, 422, 500 rõ ràng.
7. Dashboard, Home Portal và App Switcher chỉ tổng hợp/điều hướng, không xử lý nghiệp vụ gốc.
8. Notification deep link phải điều hướng về module gốc để module gốc kiểm tra lại quyền, data scope và business rule.
9. Chấm công, nghỉ phép, task, notification và dashboard có liên kết nghiệp vụ chặt chẽ nên cần regression cross-module trước release.
10. Release MVP chỉ được phát hành khi đáp ứng đủ tiêu chí chức năng, bảo mật, hiệu năng, dữ liệu, permission và vận hành.

---

## 5. Phạm vi QA-08

### 5.1 Bao gồm

| Nhóm | Nội dung |
| --- | --- |
| Bug tracking | Quy trình ghi nhận, phân loại, assign, fix, verify và close bug |
| Bug metadata | Trường bắt buộc khi tạo bug, format title, module, severity, priority, environment |
| Bug lifecycle | New, Triaged, In Progress, Fixed, Ready for QA, Reopened, Closed, Deferred |
| Bug severity | Định nghĩa S0, S1, S2, S3, S4 |
| Bug priority | Định nghĩa P0, P1, P2, P3 |
| Triage | Quy trình họp bug triage, owner, SLA và quyết định xử lý |
| Fix verification | Cách QA xác minh bug đã được sửa |
| Regression | Chiến lược hồi quy theo smoke, critical, targeted, full, hotfix |
| Release criteria | Điều kiện pass/fail cho release candidate |
| No-go criteria | Điều kiện chặn release |
| Rollback criteria | Điều kiện rollback sau deploy |
| Metrics | Bug leakage, reopen rate, pass rate, defect density, release readiness score |
| Sign-off | QA sign-off, Product sign-off, Tech sign-off, DevOps sign-off |
| Template | Mẫu bug report, regression report, release checklist, go/no-go note |

### 5.2 Không bao gồm

| Nội dung | Tài liệu xử lý |
| --- | --- |
| Chiến lược QA tổng thể | QA-01 |
| Ma trận test case chi tiết theo module | QA-02 |
| Kịch bản E2E chi tiết | QA-03 |
| API contract test chi tiết | QA-04 |
| Permission/data scope test chi tiết | QA-05 |
| Security test chi tiết | QA-06 |
| Performance/load test chi tiết | QA-07 |
| CI/CD deployment pipeline chi tiết | DevOps/Release tài liệu riêng nếu có |
| Monitoring production chi tiết | SRE/Operations tài liệu riêng nếu có |

---

## 6. Nguyên tắc quản lý bug

### 6.1 Bug phải có đủ ngữ cảnh để tái hiện

Một bug hợp lệ phải giúp developer tái hiện được lỗi mà không cần hỏi lại quá nhiều lần.

Bug tối thiểu cần có:

1. Module/màn hình/API liên quan.
2. Môi trường phát hiện lỗi.
3. Tài khoản/role/data scope dùng để test.
4. Dữ liệu test liên quan.
5. Bước tái hiện.
6. Kết quả thực tế.
7. Kết quả mong đợi.
8. Mức độ ảnh hưởng.
9. Bằng chứng: ảnh, video, log, request/response, console error, network trace.
10. Build version, commit hoặc release candidate nếu có.

### 6.2 Bug phải được phân loại theo tác động người dùng

Không chỉ phân loại theo lỗi kỹ thuật. Mỗi bug phải trả lời:

```text
Ai bị ảnh hưởng?
Ảnh hưởng đến nghiệp vụ nào?
Có làm mất dữ liệu, lộ dữ liệu hoặc sai dữ liệu không?
Có workaround tạm thời không?
Có chặn release không?
```

### 6.3 Bug liên quan quyền, bảo mật và dữ liệu phải ưu tiên cao

Các bug sau mặc định không được xem là bug nhỏ:

1. User thấy dữ liệu không thuộc scope.
2. User thao tác được API không có permission.
3. Dữ liệu nhạy cảm bị lộ trên UI/API/export/log.
4. Token/session xử lý sai.
5. Audit log không ghi lại thao tác quan trọng.
6. Chấm công/nghỉ phép/tính số dư/tính trạng thái sai.
7. Dashboard hiển thị dữ liệu trái quyền.
8. Notification deep link bỏ qua permission của module gốc.

### 6.4 Bug không được đóng nếu chưa có xác minh QA

Developer có thể chuyển bug sang `Fixed` hoặc `Ready for QA`, nhưng bug chỉ được đóng khi QA xác minh:

1. Lỗi không còn tái hiện trên build mới.
2. Không phát sinh lỗi phụ trong phạm vi ảnh hưởng.
3. Regression test liên quan đã pass.
4. Kết quả fix khớp acceptance criteria hoặc business rule.
5. Có ghi chú build/version đã verify.

---

## 7. Bug tracking system

### 7.1 Công cụ đề xuất

Có thể sử dụng một trong các công cụ:

| Công cụ | Ghi chú |
| --- | --- |
| Jira | Phù hợp nếu team dùng sprint, workflow, release version, dashboard |
| Linear | Phù hợp team nhỏ, tốc độ nhanh |
| GitHub Issues | Phù hợp nếu repo nằm trên GitHub và team muốn liên kết PR trực tiếp |
| GitLab Issues | Phù hợp nếu code/CI nằm trên GitLab |
| Azure DevOps Boards | Phù hợp team enterprise dùng Azure ecosystem |
| Notion/Trello | Chỉ nên dùng tạm, không khuyến nghị cho release nghiêm túc |

Khuyến nghị MVP:

```text
Nếu có Jira/Linear/GitHub Issues: dùng làm nguồn bug chính.
Không quản lý bug production/release bằng chat rời rạc.
```

### 7.2 Cấu trúc project bug

| Nhóm | Giá trị đề xuất |
| --- | --- |
| Project/Board | EMS QA / EMS MVP |
| Issue type | Bug, Regression Bug, Security Bug, Performance Bug, UX Bug, Data Bug |
| Epic/Component | AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI, FOUNDATION, FRONTEND, BACKEND, DATABASE |
| Release version | MVP-RC1, MVP-RC2, MVP-v1.0.0 |
| Environment | Local, Dev, Test, Staging, UAT, Production |
| Labels | `qa-found`, `uat-found`, `prod-found`, `regression`, `permission`, `security`, `performance`, `data`, `release-blocker` |

---

## 8. Bug fields bắt buộc

### 8.1 Trường bắt buộc khi tạo bug

| Field | Bắt buộc | Mô tả |
| --- | --- | --- |
| Title | Có | Tiêu đề ngắn, rõ module và lỗi |
| Module | Có | AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI/SYSTEM |
| Issue type | Có | Bug, Regression Bug, Security Bug... |
| Severity | Có | S0/S1/S2/S3/S4 |
| Priority | Có | P0/P1/P2/P3 |
| Environment | Có | Dev/Test/Staging/UAT/Production |
| Build version | Có | Version, branch, commit hoặc release candidate |
| Actor/Role | Có | Employee/Manager/HR/Admin/Super Admin |
| Data scope | Nếu liên quan | Own/Team/Department/Company/System/Project |
| Precondition | Có | Dữ liệu hoặc cấu hình trước khi tái hiện |
| Steps to reproduce | Có | Các bước tái hiện rõ ràng |
| Actual result | Có | Kết quả thực tế |
| Expected result | Có | Kết quả đúng theo spec |
| Evidence | Có | Screenshot/video/log/request id |
| Impact | Có | Tác động nghiệp vụ/người dùng |
| Linked test case | Nên có | Mã test case QA-02/QA-03/QA-04/QA-05 |
| Linked API/screen | Nên có | API endpoint hoặc screen code |
| Assignee | Sau triage | Người phụ trách fix |
| Fix version | Sau triage | Release version dự kiến sửa |
| Root cause | Khi fix | Nguyên nhân gốc |
| QA verification note | Khi verify | Kết quả verify của QA |

### 8.2 Quy tắc đặt tiêu đề bug

Format:

```text
[MODULE][AREA] Mô tả lỗi ngắn gọn
```

Ví dụ:

```text
[AUTH][Login] User locked vẫn đăng nhập được
[HR][Employee Detail] Employee thấy field CCCD khi không có quyền
[ATT][Check-in] User có leave full-day vẫn check-in được
[LEAVE][Approval] Approve đơn nghỉ không trừ balance
[TASK][Kanban] Drag task sang Done nhưng list không refresh
[DASH][Widget] Manager thấy task của department ngoài scope
[NOTI][Deep Link] Click notification mở được đơn nghỉ ngoài scope
```

### 8.3 Template bug report

```markdown
## Summary

[Mô tả ngắn gọn lỗi]

## Environment

- Environment:
- Build/Commit:
- Browser/Device:
- User/Role:
- Data scope:
- Company/Tenant:
- Module/Screen/API:

## Preconditions

1.
2.

## Steps to reproduce

1.
2.
3.

## Actual result

[Mô tả kết quả thực tế]

## Expected result

[Mô tả kết quả mong đợi theo spec/API/UI]

## Impact

- Affected users:
- Affected module:
- Business impact:
- Data/security impact:
- Workaround:

## Evidence

- Screenshot/video:
- Console log:
- Network request/response:
- Request ID / trace ID:
- Server log if available:

## Linked items

- Test case:
- Spec/API/UI:
- Related bug/PR:
```

---

## 9. Severity definition

Severity thể hiện mức độ nghiêm trọng về tác động hệ thống/nghiệp vụ.

| Severity | Tên | Định nghĩa | Ví dụ |
| --- | --- | --- | --- |
| S0 | Critical / Incident | Hệ thống không sử dụng được, mất dữ liệu, lộ dữ liệu nghiêm trọng, lỗi bảo mật nghiêm trọng, production incident | Không login được toàn hệ thống; user xem dữ liệu toàn công ty trái quyền; approve leave làm sai hàng loạt balance |
| S1 | High | Chặn flow P0/P1, ảnh hưởng nhiều user, không có workaround hợp lý | Employee không check-in được; Manager không duyệt đơn nghỉ; API trả sai data scope |
| S2 | Medium | Ảnh hưởng chức năng quan trọng nhưng có workaround hoặc phạm vi hạn chế | Filter bảng công sai trong một điều kiện; notification không cập nhật unread count ngay |
| S3 | Low | Lỗi nhỏ, không chặn nghiệp vụ chính | Sai label, layout lệch nhẹ, toast copy chưa rõ |
| S4 | Cosmetic / Improvement | Cải thiện trải nghiệm, không phải lỗi chức năng | Icon chưa đồng nhất, spacing chưa đúng hoàn toàn, đề xuất UX improvement |

> **Đây là thang severity chuẩn cho toàn bộ bộ tài liệu QA (QA-01 → QA-10).** Các tài liệu dùng tên severity theo lĩnh vực (Critical/High/Medium/Low/Info ở QA-06; Blocker/Critical/Major/Minor/Improvement ở QA-07; Blocker/Critical/Major/Minor/Trivial ở QA-09) đều ánh xạ về thang **S0–S4** này khi ghi nhận bug vào bug tracker.

### 9.1 Quy tắc nâng severity tự động

Bug phải nâng ít nhất lên S1 nếu có một trong các điều kiện:

1. Có nguy cơ lộ dữ liệu nhạy cảm.
2. Có nguy cơ sai dữ liệu nghiệp vụ quan trọng.
3. User thao tác được ngoài quyền.
4. Không ghi audit log cho thao tác nhạy cảm.
5. Chặn flow P0 của Employee, Manager, HR hoặc Admin.
6. Gây crash ứng dụng trong flow chính.
7. Không có workaround phù hợp.

Bug phải nâng lên S0 nếu có một trong các điều kiện:

1. Production không thể sử dụng cho nhóm user lớn.
2. Dữ liệu bị mất hoặc bị sửa sai hàng loạt.
3. Dữ liệu nhạy cảm bị lộ cho người không có quyền.
4. Lỗi bảo mật có thể bị khai thác trực tiếp.
5. Migration/seed làm hỏng dữ liệu hoặc không thể rollback.

---

## 10. Priority definition

Priority thể hiện mức độ cần xử lý theo kế hoạch release.

| Priority | Tên | Định nghĩa | SLA đề xuất |
| --- | --- | --- | --- |
| P0 | Immediate | Phải xử lý ngay, chặn release hoặc production incident | Bắt đầu xử lý trong ngày |
| P1 | High | Cần xử lý trước release hiện tại | Trong 1-2 ngày làm việc |
| P2 | Normal | Có thể xử lý trong sprint/release gần nhất | Theo sprint |
| P3 | Low | Có thể đưa vào backlog sau MVP | Khi có capacity |

### 10.1 Quan hệ severity và priority

| Severity | Priority mặc định | Có thể hạ priority khi |
| --- | --- | --- |
| S0 | P0 | Không nên hạ |
| S1 | P0/P1 | Chỉ khi chưa thuộc release scope hoặc có feature flag tắt |
| S2 | P1/P2 | Có workaround rõ và không chặn release |
| S3 | P2/P3 | Không ảnh hưởng acceptance criteria |
| S4 | P3 | Chỉ là cải thiện |

Priority có thể khác severity nếu Product quyết định scope release, nhưng mọi thay đổi priority của bug S0/S1 phải có ghi chú triage rõ ràng.

---

## 11. Bug lifecycle

### 11.1 Trạng thái bug

| Status | Ý nghĩa | Người chuyển |
| --- | --- | --- |
| New | Bug mới được tạo, chưa triage | QA/UAT/User |
| Need Info | Thiếu thông tin tái hiện hoặc evidence | QA/Dev/PM |
| Triaged | Đã xác nhận bug hợp lệ, có severity/priority/owner | QA Lead/PM/Tech Lead |
| In Progress | Developer đang xử lý | Developer |
| Fixed | Developer đã fix và merge hoặc build xong | Developer |
| Ready for QA | Build chứa fix đã sẵn sàng để QA verify | Developer/Release Manager |
| Reopened | QA verify fail hoặc lỗi tái hiện lại | QA |
| Verified | QA xác nhận bug đã sửa trên build cụ thể | QA |
| Closed | Bug hoàn tất, không cần theo dõi thêm | QA Lead/PM |
| Deferred | Bug hợp lệ nhưng dời release sau | PM/QA Lead/Tech Lead |
| Duplicate | Trùng với bug khác | QA Lead |
| Won't Fix | Không sửa vì không phải lỗi hoặc thay đổi quyết định sản phẩm | PM/Tech Lead |
| Cannot Reproduce | Không tái hiện được sau khi kiểm tra đủ | QA Lead/Dev |

### 11.2 Luồng chuẩn

```text
New
-> Triaged
-> In Progress
-> Fixed
-> Ready for QA
-> Verified
-> Closed
```

### 11.3 Luồng reopen

```text
Ready for QA
-> QA verify fail
-> Reopened
-> In Progress
-> Fixed
-> Ready for QA
-> Verified
-> Closed
```

### 11.4 Luồng deferred

```text
New/Triaged
-> Deferred
-> Backlog release sau
```

Điều kiện deferred:

1. Không thuộc release scope hiện tại.
2. Không phải S0/S1.
3. Không vi phạm bảo mật, permission hoặc dữ liệu.
4. Có workaround hoặc tác động thấp.
5. Được Product/QA/Tech Lead đồng ý.

---

## 12. Bug triage process

### 12.1 Mục tiêu triage

Bug triage dùng để:

1. Xác nhận bug có hợp lệ hay không.
2. Xác định severity, priority và owner.
3. Quyết định bug có chặn release không.
4. Quyết định bug cần fix ngay, fix trong sprint, deferred hay won't fix.
5. Xác định phạm vi regression sau khi fix.

### 12.2 Thành phần tham gia

| Vai trò | Trách nhiệm |
| --- | --- |
| QA Lead | Điều phối triage, xác nhận severity, regression scope |
| Product Owner/BA | Xác định impact nghiệp vụ và release scope |
| Tech Lead | Đánh giá nguyên nhân kỹ thuật, rủi ro fix, owner |
| Developer | Cung cấp phân tích kỹ thuật, estimate fix |
| DevOps/Release Manager | Đánh giá rủi ro deployment, rollback, environment |
| Security owner | Tham gia nếu bug liên quan bảo mật/permission/data leak |

### 12.3 Tần suất triage

| Giai đoạn | Tần suất |
| --- | --- |
| Sprint thường | 2-3 lần/tuần |
| Giai đoạn stabilization | Hằng ngày |
| Trước release candidate | Hằng ngày hoặc sau mỗi build |
| Production incident/hotfix | Ngay khi phát hiện |

### 12.4 Quyết định triage bắt buộc ghi lại

Mỗi bug sau triage phải có:

1. Severity.
2. Priority.
3. Owner.
4. Fix version.
5. Release blocker: Yes/No.
6. Regression scope.
7. Decision note nếu deferred/won't fix/duplicate.
8. Target verification build nếu có.

---

## 13. SLA xử lý bug

### 13.1 SLA đề xuất trong giai đoạn QA/UAT

| Severity | Triage SLA | Fix target | Verify target |
| --- | ---: | ---: | ---: |
| S0 | Trong ngày / ngay lập tức | Cùng ngày hoặc hotfix build | Ngay khi có build |
| S1 | Trong 1 ngày làm việc | 1-2 ngày làm việc | Trong 1 ngày sau build |
| S2 | 1-2 ngày làm việc | Theo sprint hoặc trước release nếu in-scope | Theo regression cycle |
| S3 | Theo sprint | Khi có capacity | Smoke/targeted nếu sửa |
| S4 | Backlog | Không bắt buộc MVP | Không bắt buộc |

### 13.2 SLA production incident

| Mức | Điều kiện | Phản ứng |
| --- | --- | --- |
| Incident P0 | Sập hệ thống, lộ dữ liệu, mất dữ liệu, sai dữ liệu hàng loạt | War room, freeze release, hotfix/rollback |
| Incident P1 | Chặn nghiệp vụ chính cho nhiều user | Hotfix hoặc rollback theo quyết định go/no-go |
| Incident P2 | Ảnh hưởng hạn chế, có workaround | Patch trong release gần nhất |
| Incident P3 | Cosmetic/minor | Backlog |

---

## 14. Fix verification

### 14.1 Điều kiện bug sẵn sàng để QA verify

Bug chỉ chuyển sang `Ready for QA` khi:

1. Code fix đã merge vào branch release/test.
2. Build đã deploy lên môi trường QA/UAT.
3. Developer có note mô tả thay đổi.
4. Developer có note phạm vi ảnh hưởng hoặc test đã chạy.
5. Nếu có migration/seed/cache invalidation, đã ghi rõ cách kiểm tra.
6. Nếu bug liên quan API, có request/response mới hoặc contract update nếu cần.
7. Nếu bug liên quan UI, đã có screenshot/video nếu thay đổi lớn.

### 14.2 QA verify checklist

Khi verify bug, QA cần kiểm tra:

1. Bug gốc không còn tái hiện.
2. Dữ liệu cũ không bị ảnh hưởng.
3. Các role/scope liên quan hoạt động đúng.
4. API/UI state liên quan hoạt động đúng.
5. Không phát sinh lỗi mới trong flow xung quanh.
6. Regression targeted đã pass.
7. Audit log/notification/cache nếu liên quan đã đúng.
8. Verify trên đúng environment/build.

### 14.3 Kết quả verify

| Kết quả | Hành động |
| --- | --- |
| Pass | Chuyển `Verified`, ghi build verify và evidence |
| Fail | Chuyển `Reopened`, ghi bước tái hiện mới và evidence |
| Partial pass | Giữ `Ready for QA` hoặc `Reopened` tùy lỗi còn lại |
| Cannot verify | Chuyển `Need Info` nếu thiếu environment/data/build |

---

## 15. Regression testing strategy

### 15.1 Mục tiêu regression

Regression testing nhằm đảm bảo:

1. Fix bug không làm hỏng chức năng đã pass.
2. Module liên quan vẫn hoạt động đúng sau thay đổi.
3. Permission/data scope không bị phá vỡ.
4. Cross-module flow vẫn đúng.
5. Release candidate đủ ổn định để UAT hoặc production.

### 15.2 Các loại regression

| Loại regression | Khi chạy | Phạm vi |
| --- | --- | --- |
| Smoke regression | Sau mỗi build QA/UAT | Login, Home Portal, mở app, API health, flow P0 |
| Targeted regression | Sau mỗi bug fix | Module/flow bị ảnh hưởng bởi fix |
| Critical path regression | Trước RC/UAT/release | Flow P0/P1: login, check-in, leave, approve, task, notification |
| Full regression | Trước release lớn | Toàn bộ MVP module theo QA-02 |
| Permission regression | Sau thay đổi RBAC/API guard | Role, permission, data scope, field masking, export |
| Security regression | Sau fix bảo mật hoặc trước release | Auth/session, access control, sensitive data |
| Performance regression | Sau thay đổi query/cache/index | API/list/dashboard/notification/attendance logs |
| Hotfix regression | Trước deploy hotfix | Bug gốc + vùng ảnh hưởng nhỏ nhất + smoke |
| Migration regression | Sau migration/seed | Migration up/down nếu có, seed, data integrity |
| UI regression | Sau thay đổi layout/component | Loading, empty, error, forbidden, responsive, accessibility cơ bản |

---

## 16. Regression suite levels

### 16.1 Level R0 - Build smoke

Chạy cho mọi build QA/UAT.

| Nhóm | Test bắt buộc |
| --- | --- |
| AUTH | Login thành công, token/session hợp lệ, logout |
| HOME | Vào Home Portal sau login, app registry load được |
| APP | Mở một module từ Home Portal/App Switcher |
| API | Health check, current user, permission context |
| NOTI | Notification badge/dropdown không crash |
| DASH | Dashboard mặc định load được hoặc degraded state đúng |
| Error handling | 401/403/500 hiển thị state đúng |
| Basic responsive | Desktop viewport không vỡ layout P0 |

Pass R0 là điều kiện tối thiểu để build được nhận vào QA sâu.

### 16.2 Level R1 - Critical path regression

Chạy trước mỗi release candidate.

| Module | Flow bắt buộc |
| --- | --- |
| AUTH | Login, logout, token expired, forbidden route |
| HR | Employee list/detail, My Profile, profile change request nếu scope MVP |
| ATT | Today attendance, check-in, check-out, blocked by leave, adjustment request cơ bản |
| LEAVE | My balance, create request, submit, approve, reject, cancel nếu được phép |
| TASK | My tasks, task detail, update status, comment/mention |
| DASH | Employee/Manager/HR/Admin dashboard theo quyền |
| NOTI | Unread count, dropdown, mark read, deep link sang module gốc |
| SYSTEM | Role/permission guard, company/module setting cơ bản |
| Cross-module | Leave approved -> ATT update/block; Task assigned -> NOTI; Dashboard reflects source data |

### 16.3 Level R2 - Full MVP regression

Chạy trước release chính thức hoặc sau thay đổi lớn.

| Nhóm | Nội dung |
| --- | --- |
| Functional | Toàn bộ test case P0/P1/P2 trong QA-02 |
| E2E | Toàn bộ flow QA-03 |
| API | Contract/API test QA-04 |
| Permission | Permission/scope/field masking/export QA-05 |
| Security | Test bảo mật QA-06 |
| Performance | Test hiệu năng QA-07 |
| Data | Migration/seed/data integrity/cross-module consistency |
| UI | Responsive/state/accessibility cơ bản |
| Integration | Notification, dashboard cache, audit log, file upload/download |

### 16.4 Level R3 - Hotfix regression

Chạy cho hotfix khẩn cấp.

| Nhóm | Nội dung |
| --- | --- |
| Bug gốc | Tái hiện bug trước fix nếu có thể, sau đó verify bug đã hết |
| Vùng ảnh hưởng trực tiếp | Service/API/component liên quan |
| Permission liên quan | Nếu bug liên quan role/scope |
| Data liên quan | Nếu bug liên quan update/delete/transaction |
| Smoke | R0 tối thiểu |
| Production risk | Rollback/hotfix note bắt buộc |

---

## 17. Regression matrix theo module

### 17.1 AUTH regression

| Nhóm | Cần kiểm tra |
| --- | --- |
| Login/logout | Thành công, sai mật khẩu, account locked, inactive user |
| Token/session | Refresh token, expired token, logout clear cache |
| RBAC | Role, permission, multiple roles |
| Data scope | Own/Team/Department/Company/System |
| Forbidden | Direct URL trái quyền, API 403 |
| Security | Password reset, password change, session invalidation |
| Audit | Login log, security event, role/permission change |

### 17.2 HR regression

| Nhóm | Cần kiểm tra |
| --- | --- |
| Employee | List, search, filter, detail, create, update, soft delete |
| Sensitive fields | Masking/hide theo quyền |
| Employee code | Auto generate, preview, unique theo company |
| Profile change | Employee submit, HR approve/reject, diff old/new |
| Department/position | CRUD, hierarchy nếu có |
| Contract/file | Upload/download/delete permission |
| Data scope | Employee chỉ xem own, Manager xem team, HR xem company |
| Audit/notification | Profile update/change request event |

### 17.3 ATT regression

| Nhóm | Cần kiểm tra |
| --- | --- |
| Today attendance | Can check-in, can check-out, already checked-in/out |
| Leave block | Full-day approved leave chặn check-in/out |
| Remote work | Rule remote, auto attendance, self check-in |
| Records | My/team/company attendance list theo scope |
| Adjustment | Create, approve/reject, direct adjustment |
| Shift/rule | Fixed/flexible shift, assignment by company/department/employee |
| Calculation | Late, early leave, missing hours, working minutes |
| Audit/notification | Adjustment event, missing checkout, direct edit log |

### 17.4 LEAVE regression

| Nhóm | Cần kiểm tra |
| --- | --- |
| Balance | View, reserve, deduct, refund, adjust |
| Request | Draft, submit, detail, cancel |
| Approval | Manager/HR approve/reject theo scope |
| Calculation | Full day, half day, hourly, multiple days |
| ATT sync | Approved/cancelled/revoked sync sang attendance |
| Calendar | Own/team/department/company theo quyền |
| Conflict | Insufficient balance, overlapping leave, already processed |
| Audit/notification | Submit/approve/reject/cancel event |

### 17.5 TASK regression

| Nhóm | Cần kiểm tra |
| --- | --- |
| Project | List, create, update, member management |
| Task | Create, detail, update, soft delete |
| Assignment | Assignee, watcher, project role |
| Status | Todo, In Progress, In Review, Done, Cancelled |
| Kanban | Drag/drop, permission, order |
| Comment/mention | Create, edit, delete, mention notification |
| Checklist/file | Add/update/delete, upload/download permission |
| Data scope | Own/team/project/company rules |
| Leave warning | Assign/deadline trùng kỳ nghỉ approved nếu có |

### 17.6 DASH regression

| Nhóm | Cần kiểm tra |
| --- | --- |
| Dashboard type | Employee/Manager/HR/Admin theo quyền |
| Widget visibility | Permission, data scope, company config |
| Widget data | Attendance today, tasks, leave approvals, HR summary, notification |
| Cache | Refresh, stale, invalidation sau event |
| Degraded state | Module nguồn lỗi nhưng dashboard không crash |
| Quick action | Điều hướng module gốc, không xử lý nghiệp vụ gốc |
| Data leak | Không trả/hiển thị dữ liệu ngoài scope |

### 17.7 NOTI regression

| Nhóm | Cần kiểm tra |
| --- | --- |
| Notification list | My notifications, pagination, filter read/unread |
| Badge/dropdown | Unread count, latest notification |
| Read state | Mark read, mark all read |
| Deep link | Điều hướng module gốc và kiểm tra quyền lại |
| Event/template | Event mapping, template render, target payload |
| Delivery log | In-app delivery, retry nếu có |
| Preference | Nếu MVP có cấu hình nhận thông báo |
| Data scope | User chỉ xem notification của mình |

### 17.8 SYSTEM/FOUNDATION regression

| Nhóm | Cần kiểm tra |
| --- | --- |
| Company/module setting | Active/inactive module, feature flag |
| Files | Upload, private file, download permission, access log |
| Audit logs | Actor, action, entity, diff, sensitive action |
| Sequence | Sinh mã employee/leave/project nếu dùng |
| Public holiday | ATT/LEAVE calculation |
| Seeds | Permission, role, notification event, dashboard widget |
| Migration | Up migration, seed idempotent, rollback strategy nếu có |

---

## 18. Release candidate process

### 18.1 Release candidate naming

Format đề xuất:

```text
MVP-RC1
MVP-RC2
MVP-RC3
MVP-v1.0.0
```

Hoặc theo semantic version:

```text
v1.0.0-rc.1
v1.0.0-rc.2
v1.0.0
```

### 18.2 Điều kiện tạo release candidate

Một build chỉ được đóng gói thành RC khi:

1. Feature scope của release đã code complete.
2. Unit/integration test trong CI pass.
3. Build frontend/backend thành công.
4. Migration chạy được trên môi trường test/staging.
5. Seed data bắt buộc chạy được.
6. Không còn bug S0/S1 open trong scope hiện tại.
7. API contract không còn mismatch nghiêm trọng.
8. Environment config đã sẵn sàng.
9. Release note draft đã có.
10. Rollback plan draft đã có.

### 18.3 RC test cycle

```text
Build RC
-> Deploy Staging/UAT
-> R0 Smoke
-> R1 Critical path regression
-> Targeted regression cho bug đã fix
-> Security/performance checklist nếu có thay đổi liên quan
-> Bug triage
-> Fix blockers
-> Build RC tiếp theo nếu cần
-> QA sign-off
-> UAT/Product sign-off
-> Go/No-Go meeting
```

---

## 19. Release criteria

### 19.1 Functional criteria

Release chỉ đạt nếu:

| Tiêu chí | Yêu cầu |
| --- | --- |
| MVP scope | Các module AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI hoạt động theo scope đã chốt |
| P0 flow | 100% P0 flow pass |
| P1 flow | >= 95% P1 flow pass hoặc bug còn lại được Product chấp nhận |
| Test case critical | 100% critical test case pass |
| E2E | Các flow login, check-in, leave, approve, task, notification pass |
| Cross-module | Leave -> ATT, TASK -> NOTI, NOTI -> module gốc, DASH -> source data pass |
| Error handling | 401/403/404/409/422/500 hiển thị đúng |
| Data integrity | Không có sai lệch dữ liệu nghiêm trọng |

### 19.2 Bug criteria

| Nhóm | Release requirement |
| --- | --- |
| S0 | 0 open |
| S1 | 0 open trong release scope |
| S2 | Không còn S2 chặn flow P0/P1; số lượng còn lại phải được Product/QA chấp nhận |
| S3/S4 | Có thể deferred nếu không ảnh hưởng release |
| Reopened | Không có reopened S0/S1 |
| Regression bug | Không có regression bug S0/S1 |
| Known issues | Có danh sách rõ nếu còn bug deferred |

### 19.3 Permission/security criteria

Release chỉ đạt nếu:

1. Không có bug user truy cập dữ liệu ngoài scope.
2. Không có bug API cho phép thao tác không có permission.
3. Không có dữ liệu nhạy cảm bị lộ ở UI/API/export/log.
4. Auth/session/token flow pass.
5. Password reset/change không có lỗi nghiêm trọng.
6. Direct URL trái quyền bị chặn.
7. Backend guard hoạt động độc lập với frontend.
8. Audit log ghi thao tác nhạy cảm theo yêu cầu.

### 19.4 API criteria

Release chỉ đạt nếu:

1. API contract chính khớp tài liệu API.
2. Response success/error/pagination thống nhất.
3. Validation error trả đúng field.
4. Idempotency hoạt động với nghiệp vụ quan trọng nếu đã triển khai.
5. API list có pagination/filter/sort đúng.
6. API không trả `company_id`/data ngoài context trái quyền.
7. Internal event/sync không làm mất dữ liệu.
8. OpenAPI/Swagger được cập nhật nếu dùng.

### 19.5 Database/data criteria

Release chỉ đạt nếu:

1. Migration chạy từ database trống thành công.
2. Migration chạy trên database có dữ liệu mẫu thành công.
3. Seed idempotent, chạy lại không tạo trùng dữ liệu.
4. Index quan trọng đã có cho query list/dashboard/notification/attendance.
5. Transaction quan trọng không gây sai lệch dữ liệu.
6. Audit log/file metadata/sequence/public holiday hoạt động nếu liên quan.
7. Backup/rollback database có kế hoạch rõ trước production deploy.

### 19.6 Frontend/UI criteria

Release chỉ đạt nếu:

1. Các màn P0/P1 không crash.
2. Loading, empty, error, forbidden, disabled, validation, success state hoạt động.
3. Permission UI không làm lộ dữ liệu.
4. Responsive desktop/tablet/mobile web đạt mức chấp nhận cho P0 flow.
5. Dirty form guard hoạt động ở flow quan trọng.
6. Notification badge/dropdown không phá layout.
7. Dashboard degraded state hoạt động khi module nguồn lỗi.
8. Không còn console error nghiêm trọng trong flow chính.

### 19.7 Performance criteria

Release chỉ đạt nếu:

1. API P0/P1 đạt ngưỡng hiệu năng đã chốt trong QA-07.
2. Dashboard không timeout trong dữ liệu mẫu/staging.
3. Notification unread count và dropdown phản hồi chấp nhận được.
4. Attendance/leave/task list pagination hoạt động tốt.
5. Không có query N+1 nghiêm trọng đã biết trong flow P0.
6. Không có memory leak/frontend freeze nghiêm trọng trong smoke test.

### 19.8 Operational criteria

Release chỉ đạt nếu:

1. Environment staging/UAT/prod config sẵn sàng.
2. Secrets/env không hard-code.
3. Logging đủ để debug production issue.
4. Monitoring/health check cơ bản sẵn sàng.
5. Release note có danh sách thay đổi và known issues.
6. Rollback plan được xác nhận.
7. Người trực release/on-call được phân công.
8. Stakeholder đã sign-off nếu cần.

---

## 20. No-Go criteria

Release phải bị chặn nếu có một trong các điều kiện:

1. Còn bug S0 open.
2. Còn bug S1 open trong release scope.
3. Còn bug permission/data scope/security nghiêm trọng.
4. Có nguy cơ mất dữ liệu hoặc sai dữ liệu hàng loạt.
5. Migration không chạy ổn định hoặc không có rollback plan.
6. Không login được hoặc session/token lỗi trên staging/UAT.
7. Flow P0 như check-in, tạo đơn nghỉ, duyệt đơn, task của tôi, notification cơ bản bị lỗi.
8. Dashboard hoặc module gốc hiển thị dữ liệu trái quyền.
9. API production config chưa an toàn.
10. Performance test phát hiện bottleneck nghiêm trọng chưa có mitigation.
11. QA chưa hoàn tất R0/R1 hoặc chưa có sign-off.
12. Product chưa chấp nhận known issues.
13. DevOps chưa xác nhận deployment/rollback.
14. Có thay đổi lớn sau QA sign-off nhưng chưa regression lại.
15. Có lỗi không thể debug vì thiếu log/request id trong flow quan trọng.

---

## 21. Go criteria

Release có thể go nếu:

1. Tất cả No-Go criteria đều không còn.
2. QA sign-off đã hoàn tất.
3. Product/UAT sign-off đã hoàn tất nếu yêu cầu.
4. Tech Lead xác nhận code/migration/config ổn định.
5. DevOps/Release Manager xác nhận deployment plan.
6. Known issues được ghi rõ và được chấp nhận.
7. Rollback/hotfix owner đã rõ.
8. Release note đã sẵn sàng.
9. Monitoring sau release đã có người theo dõi.
10. Stakeholder đồng ý phát hành.

---

## 22. Rollback criteria

Sau deploy, cần rollback nếu có một trong các điều kiện:

1. Hệ thống không thể login hoặc không thể sử dụng flow chính.
2. API lỗi diện rộng do deployment/config/migration.
3. Dữ liệu bị sai, mất hoặc lộ.
4. Permission guard bị bypass trong production.
5. Performance suy giảm nghiêm trọng khiến hệ thống không dùng được.
6. Migration gây lỗi không thể hotfix nhanh.
7. Bug S0 production không thể xử lý bằng feature flag/hotfix ngắn.
8. Monitoring cho thấy error rate tăng vượt ngưỡng chấp nhận.
9. Người dùng không thể thao tác nghiệp vụ core: check-in, xin nghỉ, duyệt nghỉ, xem task.
10. Release owner/Tech Lead/DevOps thống nhất rollback an toàn hơn hotfix.

### 22.1 Rollback checklist

| Hạng mục | Cần xác nhận |
| --- | --- |
| App version | Version trước đó còn deploy được |
| Database | Migration có thể rollback hoặc có backup restore |
| Config | Env/feature flag có thể revert |
| Cache | Cache có thể clear/invalidate |
| File/storage | Không làm mất file upload mới |
| Notification/event | Outbox/job có thể pause/retry |
| User communication | Có thông báo nội bộ nếu cần |
| Incident log | Ghi lại timeline và quyết định rollback |

---

## 23. Hotfix process

### 23.1 Khi nào dùng hotfix

Dùng hotfix khi:

1. Production có bug S0/S1.
2. Bug ảnh hưởng flow chính nhưng có thể sửa phạm vi nhỏ.
3. Không cần rollback toàn bộ release.
4. Có thể kiểm thử targeted regression trong thời gian ngắn.
5. Tech Lead/QA/DevOps đồng ý rủi ro hotfix thấp hơn rollback.

### 23.2 Hotfix flow

```text
Detect production bug
-> Create incident/bug
-> Triage severity
-> Assign owner
-> Create hotfix branch
-> Fix + code review
-> Deploy hotfix to staging
-> R3 Hotfix regression
-> QA sign-off hotfix
-> Deploy production
-> Monitor
-> Close incident with RCA
```

### 23.3 Hotfix release criteria

1. Bug gốc đã được verify trên staging.
2. R3 hotfix regression pass.
3. Không có lỗi permission/security/data mới.
4. Rollback plan hotfix sẵn sàng.
5. Release note hotfix có nội dung thay đổi.
6. Production monitoring được theo dõi sau deploy.

---

## 24. Release readiness score

Có thể dùng điểm release readiness để ra quyết định go/no-go.

| Nhóm | Trọng số | Điều kiện đạt |
| --- | ---: | --- |
| Functional readiness | 25% | P0/P1 flow pass theo ngưỡng |
| Bug readiness | 20% | Không còn S0/S1 open |
| Security/permission readiness | 20% | Không còn bug access control/data leak |
| Performance readiness | 10% | QA-07 pass ngưỡng tối thiểu |
| Data/migration readiness | 10% | Migration/seed/data integrity pass |
| Operational readiness | 10% | Deployment/rollback/logging/monitoring sẵn sàng |
| Documentation/sign-off | 5% | Release note, known issues, sign-off đủ |

Gợi ý đánh giá:

| Score | Ý nghĩa |
| ---: | --- |
| 90-100 | Ready to release |
| 80-89 | Có thể release nếu không có No-Go và known issues được chấp nhận |
| 70-79 | Cần cân nhắc, thường chưa nên release |
| < 70 | No-Go |

Lưu ý: Điểm số không được dùng để bỏ qua No-Go criteria. Nếu có một lỗi No-Go thì release vẫn phải bị chặn dù score cao.

---

## 25. Bug metrics cần theo dõi

| Metric | Ý nghĩa |
| --- | --- |
| Open bugs by severity | Số bug còn mở theo S0/S1/S2/S3/S4 |
| Open release blockers | Số bug đang chặn release |
| Bug aging | Bug tồn tại quá SLA |
| Reopen rate | Tỷ lệ bug bị reopen sau khi fix |
| Regression bug count | Số bug phát sinh do sửa bug/tính năng khác |
| Escaped defect | Bug lọt ra UAT/Production |
| Defect density by module | Bug theo module để thấy vùng rủi ro |
| Fix verification pass rate | Tỷ lệ bug verify pass lần đầu |
| Test pass rate | Tỷ lệ test case pass trong regression |
| Production incident count | Số incident sau release |
| Mean time to triage | Thời gian từ New đến Triaged |
| Mean time to fix | Thời gian từ Triaged đến Fixed |
| Mean time to verify | Thời gian từ Ready for QA đến Verified |

### 25.1 Ngưỡng cảnh báo trước release

| Metric | Cảnh báo |
| --- | --- |
| Reopen rate > 15% | Chất lượng fix thấp, cần review root cause |
| Regression bug tăng sau mỗi RC | Có rủi ro code churn cao |
| S2 open tăng liên tục | Có thể chưa ổn định nghiệp vụ |
| Escaped defect từ QA sang UAT cao | Test case thiếu hoặc test data chưa đủ |
| Bug aging S1 > SLA | Có nguy cơ chặn release |
| Permission bug xuất hiện muộn | Cần chạy lại QA-05 full hoặc targeted sâu |

---

## 26. Root cause analysis

### 26.1 Khi nào cần RCA

Bắt buộc RCA cho:

1. Bug S0.
2. Bug S1 production.
3. Bug security/permission/data leak.
4. Bug làm sai dữ liệu chấm công/nghỉ phép/task hàng loạt.
5. Bug bị reopen nhiều lần.
6. Bug regression lặp lại ở cùng module.
7. Incident cần hotfix/rollback.

### 26.2 RCA template

```markdown
## RCA - [BUG-ID] [Title]

### 1. Summary

[Mô tả ngắn incident/bug]

### 2. Timeline

- Detected at:
- Triaged at:
- Fix started at:
- Fix deployed at:
- Verified at:

### 3. Impact

- Affected users:
- Affected modules:
- Data impact:
- Security impact:
- Business impact:

### 4. Root cause

[Nguyên nhân gốc]

### 5. Why it was not caught earlier

[Test gap, review gap, monitoring gap, requirement gap]

### 6. Fix implemented

[Thay đổi đã làm]

### 7. Regression added

[Test case mới hoặc regression suite cập nhật]

### 8. Prevention actions

[Action để không lặp lại]

### 9. Owner and due date

[Owner, deadline]
```

---

## 27. Regression report template

```markdown
# Regression Report - [Release Candidate]

## 1. Summary

| Field | Value |
| --- | --- |
| Release candidate |  |
| Environment |  |
| Build/Commit |  |
| Test window |  |
| QA owner |  |
| Overall status | Pass / Conditional Pass / Fail |

## 2. Scope

- Smoke:
- Critical path:
- Targeted regression:
- Full regression:
- Excluded scope:

## 3. Result summary

| Suite | Total | Pass | Fail | Blocked | Skipped | Pass rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| R0 Smoke |  |  |  |  |  |  |
| R1 Critical |  |  |  |  |  |  |
| Permission |  |  |  |  |  |  |
| API |  |  |  |  |  |  |
| E2E |  |  |  |  |  |  |
| Targeted |  |  |  |  |  |  |

## 4. Open bugs

| Bug ID | Module | Severity | Priority | Status | Release blocker |
| --- | --- | --- | --- | --- | --- |

## 5. Known issues

| Issue | Impact | Workaround | Decision |
| --- | --- | --- | --- |

## 6. QA recommendation

Go / No-Go / Conditional Go

## 7. Notes

[QA note]
```

---

## 28. Release checklist

### 28.1 Pre-release checklist

| Nhóm | Checklist | Trạng thái |
| --- | --- | --- |
| Scope | Release scope đã freeze | Chưa/Có |
| Code | Code complete, PR merged | Chưa/Có |
| CI | Build/test/lint pass | Chưa/Có |
| Migration | Migration tested | Chưa/Có |
| Seed | Seed idempotent tested | Chưa/Có |
| API | API contract updated | Chưa/Có |
| UI | P0/P1 screen states pass | Chưa/Có |
| QA | R0/R1/R2 phù hợp đã chạy | Chưa/Có |
| Security | QA-06 pass hoặc no critical issue | Chưa/Có |
| Performance | QA-07 pass ngưỡng tối thiểu | Chưa/Có |
| Bugs | Không còn S0/S1 open | Chưa/Có |
| Known issues | Known issues được Product chấp nhận | Chưa/Có |
| Release note | Release note sẵn sàng | Chưa/Có |
| Rollback | Rollback plan sẵn sàng | Chưa/Có |
| Monitoring | Monitoring/logging/health check sẵn sàng | Chưa/Có |
| Sign-off | QA/Product/Tech/DevOps sign-off | Chưa/Có |

### 28.2 Production deploy checklist

| Bước | Owner | Ghi chú |
| --- | --- | --- |
| Confirm release version | Release Manager |  |
| Confirm maintenance window nếu cần | DevOps |  |
| Backup database nếu cần | DevOps/DBA |  |
| Deploy backend | DevOps |  |
| Run migration | DevOps/Backend |  |
| Deploy frontend | DevOps |  |
| Clear/invalidate cache nếu cần | DevOps/Backend |  |
| Run production smoke test | QA/Release Manager |  |
| Monitor logs/error rate | DevOps/Tech Lead |  |
| Confirm go-live | Product/Release Manager |  |
| Send release note | Product/Release Manager |  |

### 28.3 Post-release checklist

| Nhóm | Checklist |
| --- | --- |
| Smoke | Login, Home Portal, module open, API health |
| Core flow | Check-in, leave request, task, notification, dashboard |
| Permission | Sample role/scope access check |
| Logs | Error logs không tăng bất thường |
| Metrics | API latency/error rate ổn định |
| Bugs | Theo dõi bug phát sinh sau release |
| Communication | Thông báo hoàn tất release |
| Retrospective | Ghi bài học nếu có incident |

---

## 29. Go/No-Go meeting

### 29.1 Mục tiêu

Go/No-Go meeting dùng để ra quyết định cuối cùng trước production release.

### 29.2 Thành phần

| Vai trò | Trách nhiệm |
| --- | --- |
| Product Owner | Xác nhận scope, business risk, known issues |
| QA Lead | Báo cáo regression, bug status, recommendation |
| Tech Lead | Xác nhận technical readiness |
| DevOps/Release Manager | Xác nhận deployment/rollback readiness |
| Backend Lead | Xác nhận API/database/migration |
| Frontend Lead | Xác nhận UI/build/environment |
| Security owner | Xác nhận nếu có issue security |
| Stakeholder | Phê duyệt nếu release cần business approval |

### 29.3 Agenda

1. Xác nhận release version.
2. Xác nhận scope và thay đổi chính.
3. QA trình bày regression result.
4. QA trình bày bug status và release blockers.
5. Security/performance/data readiness.
6. Migration/deployment/rollback readiness.
7. Known issues và workaround.
8. Quyết định Go/No-Go/Conditional Go.
9. Owner cho action còn lại.
10. Thời gian deploy và post-release monitoring.

### 29.4 Decision format

```markdown
# Go/No-Go Decision - [Release Version]

## Decision

Go / No-Go / Conditional Go

## Release version

[Version]

## Environment

[Production/Staging/UAT]

## Summary

[Ngắn gọn tình trạng release]

## QA status

- Regression:
- Open bugs:
- Release blockers:
- QA recommendation:

## Known issues accepted

1.
2.

## Conditions if Conditional Go

1.
2.

## Rollback owner

[Name/team]

## Sign-off

| Role | Name | Decision | Date |
| --- | --- | --- | --- |
| Product |  |  |  |
| QA |  |  |  |
| Tech Lead |  |  |  |
| DevOps |  |  |  |
```

---

## 30. Known issues policy

### 30.1 Known issue được phép release khi

1. Không phải S0/S1.
2. Không ảnh hưởng bảo mật, permission, data leak.
3. Không gây mất/sai dữ liệu nghiêm trọng.
4. Có workaround rõ ràng nếu ảnh hưởng user.
5. Product chấp nhận bằng văn bản.
6. Được ghi trong release note hoặc internal known issue list.
7. Có owner và target release để xử lý.

### 30.2 Known issue không được phép release

1. Bug có thể làm user thấy dữ liệu trái quyền.
2. Bug gây sai dữ liệu chấm công/nghỉ phép/task quan trọng.
3. Bug làm mất audit trail.
4. Bug làm crash flow P0.
5. Bug không có workaround nhưng ảnh hưởng nhiều user.
6. Bug có rủi ro security chưa đánh giá.
7. Bug làm migration hoặc rollback không an toàn.

---

## 31. Traceability

### 31.1 Bug phải liên kết với nguồn yêu cầu

Mỗi bug nên liên kết tối thiểu một trong các nguồn:

| Nguồn | Ví dụ |
| --- | --- |
| PRD | Requirement cấp sản phẩm |
| SPEC | Nghiệp vụ module |
| API | Endpoint contract |
| DB | Table/constraint/migration |
| UI | Screen/state/flow |
| Frontend | Component/route/query |
| Backend | Service/controller/repository |
| QA | Test case/test suite |
| Release | RC/release version |

### 31.2 Traceability format

```text
Bug ID
-> Module
-> Screen/API
-> Test Case
-> Requirement
-> Fix PR
-> Verification Build
-> Regression Suite
```

---

## 32. Defect prevention

### 32.1 Biện pháp giảm bug trước QA

| Nhóm | Biện pháp |
| --- | --- |
| Requirement | Review SPEC/API/UI trước khi code |
| API | Contract test, schema validation |
| Permission | Unit/integration test guard |
| Data | Constraint, transaction, idempotency |
| UI | Component state story, visual check |
| Regression | Automated smoke/critical suite |
| Code review | Checklist permission, error handling, audit, transaction |
| Logging | Request id, trace id, structured logs |
| Test data | Seed role/user/scope chuẩn |
| Documentation | Update known behavior và edge case |

### 32.2 Checklist developer trước khi chuyển QA

Developer cần tự kiểm:

1. Flow chính chạy được trên local/dev.
2. API success/error đúng contract.
3. Permission guard backend đúng.
4. Frontend hide/disable/masked state đúng.
5. Không có console/server error nghiêm trọng.
6. Unit/integration test liên quan pass.
7. Migration/seed nếu có đã chạy thử.
8. Log/audit/event nếu liên quan đã kiểm tra.
9. PR mô tả vùng ảnh hưởng.
10. Test note cho QA rõ ràng.

---

## 33. Acceptance criteria QA-08

| Mã | Tiêu chí nghiệm thu |
| --- | --- |
| QA08-AC-001 | Có định nghĩa đầy đủ bug lifecycle từ New đến Closed |
| QA08-AC-002 | Có severity matrix S0-S4 và priority matrix P0-P3 |
| QA08-AC-003 | Có quy tắc bắt buộc cho bug report, evidence, environment, actor, scope và build version |
| QA08-AC-004 | Có quy trình bug triage, SLA và owner theo vai trò |
| QA08-AC-005 | Có quy trình fix verification và reopen |
| QA08-AC-006 | Có chiến lược regression theo smoke, critical, targeted, full và hotfix |
| QA08-AC-007 | Có regression matrix cho AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI và SYSTEM |
| QA08-AC-008 | Có release criteria theo functional, bug, permission/security, API, data, frontend, performance và operation |
| QA08-AC-009 | Có No-Go criteria rõ ràng cho lỗi chặn release |
| QA08-AC-010 | Có rollback criteria và hotfix process |
| QA08-AC-011 | Có release checklist trước, trong và sau production deploy |
| QA08-AC-012 | Có template bug report, regression report và go/no-go decision |
| QA08-AC-013 | Có metrics theo dõi chất lượng bug và release readiness |
| QA08-AC-014 | Có chính sách known issues và điều kiện chấp nhận deferred bug |
| QA08-AC-015 | Tài liệu đủ làm cơ sở để QA Lead điều phối release sign-off MVP |

---

## 34. Kết luận

QA-08 chốt lớp kiểm soát cuối cùng của giai đoạn QA MVP:

```text
Bug phải được ghi nhận có cấu trúc
-> Bug phải được triage theo impact và release risk
-> Fix phải được QA verify và regression đúng phạm vi
-> Release phải qua criteria rõ ràng
-> No-Go không được bỏ qua
-> Rollback/hotfix phải có kế hoạch trước khi deploy
```

Sau QA-08, bước tiếp theo nên là:

```text
QA-09: UAT Plan & Business Acceptance
QA-10: MVP Release Readiness Checklist
```

QA-09 tổ chức nghiệm thu nghiệp vụ với stakeholder; QA-10 là checklist release gate tổng hợp cuối cùng. Sau khi qua QA-10, có thể triển khai tài liệu **RELEASE-01: MVP Release Plan & Deployment Runbook**, sử dụng tiêu chí từ QA-08/QA-10 để chi tiết lịch phát hành, owner, deployment window, rollback runbook, post-release monitoring và communication plan.

---

## 35. Tài liệu liên quan

| Mã | Tài liệu | Quan hệ |
| --- | --- | --- |
| [QA-01](QA-01_QA_Strategy_And_Test_Plan.md) | QA Strategy & Test Plan | Tài liệu nền: bug/severity/release criteria tổng quan |
| [QA-02](QA-02_Test_Case_Matrix_theo_module.md) | Test Case Matrix theo module | Nguồn test case cho full regression |
| [QA-03](QA-03_End-to-End_Flow_Testing.md) | End-to-End Flow Testing | Flow E2E cho critical-path regression |
| [QA-04](QA-04_API_Testing_Contract_Testing.md) | API Testing & Contract Testing | API contract regression |
| [QA-05](QA-05_Permission_Role_Data_Scope_Testing.md) | Permission, Role & Data Scope Testing | Permission regression |
| [QA-06](QA-06_Security_Testing.md) | Security Testing | Security regression |
| [QA-07](QA-07_Performance_Load_Testing.md) | Performance & Load Testing | Performance regression |
| **QA-08 (tài liệu này)** | Bug Tracking, Regression & Release Criteria | **Chuẩn severity (S0–S4)**, bug lifecycle, release gate |
| [QA-09](QA-09_UAT_Plan_Business_Acceptance.md) | UAT Plan & Business Acceptance | Nghiệm thu nghiệp vụ với stakeholder |
| [QA-10](QA-10_MVP_Release_Readiness_Checklist.md) | MVP Release Readiness Checklist | Checklist release gate cuối |
