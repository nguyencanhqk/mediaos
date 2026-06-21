# ISSUE-BOARD-01: MVP Ticket Board Setup

> **📚 Bộ tài liệu — Hệ thống Quản lý Doanh nghiệp (Enterprise Management System)**
> **Nguồn & liên quan:** [Chỉ mục: README](../README.md) · [Trước: PROJECT-BASELINE-01](../PROJECT-BASELINE/PROJECT-BASELINE-01_MVP_Documentation_Baseline_Freeze_Checklist.md) · [Backlog chi tiết: IMPLEMENTATION-02](../IMPLEMENTATION/IMPLEMENTATION-02_Detailed_Product_Backlog_Epic_Breakdown.md) · [Sprint 0 execution: IMPLEMENTATION-03](../IMPLEMENTATION/IMPLEMENTATION-03_Sprint_0_Execution_Plan_Issue_Board_Setup.md)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | ISSUE-BOARD-01 |
| Tên tài liệu | MVP Ticket Board Setup |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | Pre-Development / Sprint Board Setup |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Người viết |  |
| Người duyệt |  |
| Tài liệu nguồn | PROJECT-BASELINE-01, PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-10, DEVOPS-01 -> DEVOPS-12, IMPLEMENTATION-01 -> IMPLEMENTATION-10 |

---

## 2. Mục đích tài liệu

Tài liệu này dùng để thiết lập **Issue Board / Ticket Board** cho giai đoạn triển khai MVP của hệ thống quản lý doanh nghiệp nội bộ.

Sau khi đã chốt baseline tài liệu ở `PROJECT-BASELINE-01`, đội dự án cần chuyển toàn bộ phạm vi MVP thành ticket có thể giao việc, theo dõi, kiểm thử và nghiệm thu. `ISSUE-BOARD-01` là tài liệu cầu nối giữa bộ tài liệu thiết kế và quá trình coding thực tế.

Tài liệu này giúp:

1. Chuẩn hóa cấu trúc issue board.
2. Chuẩn hóa loại ticket, workflow, trạng thái và rule chuyển trạng thái.
3. Chuẩn hóa field bắt buộc trong mỗi ticket.
4. Chuẩn hóa cách đặt mã ticket, label, priority, severity và sprint.
5. Chuẩn hóa template cho Epic, Story, Task, Bug, Spike, QA và DevOps ticket.
6. Chuyển phạm vi MVP thành backlog theo module và sprint.
7. Đảm bảo mỗi ticket đều trace được về tài liệu nguồn: PRD, SPEC, DB, API, UI, Frontend, Backend, QA, DevOps hoặc Implementation.
8. Giúp Product, UI/UX, Backend, Frontend, QA và DevOps cùng nhìn một board thống nhất.
9. Giảm rủi ro làm sai scope, thiếu acceptance criteria hoặc code không bám tài liệu.
10. Làm đầu vào trực tiếp cho Sprint 0 và Sprint 1 coding.

---

## 3. Vị trí của ISSUE-BOARD-01 trong chuỗi triển khai

```text
PRD / SPEC
  -> Database Design
  -> API Design
  -> UI/UX Design
  -> Frontend / Backend / QA / DevOps Plan
  -> Implementation Roadmap
  -> PROJECT-BASELINE-01: MVP Documentation Baseline & Freeze Checklist
  -> ISSUE-BOARD-01: MVP Ticket Board Setup
  -> SPRINT-00: Repository, Environment & Bootstrap Execution
  -> SPRINT-01: Foundation + AUTH + HR Core Coding
  -> Sprint Execution
  -> QA / UAT / Release Candidate
  -> Go-live
```

`ISSUE-BOARD-01` không tạo nghiệp vụ mới. Tài liệu này chỉ chuyển phạm vi đã chốt thành hệ thống ticket có thể triển khai.

> **Quan hệ với IMPLEMENTATION-02 / IMPLEMENTATION-03 (tránh trùng lặp):**
>
> - `ISSUE-BOARD-01` là **nguồn chính** cho *cấu trúc board*: columns, workflow, label, field bắt buộc, board views, ticket template, Definition of Ready/Done và backlog seed nhập board. Mã epic cấp board dùng dạng `EPIC-<MODULE>-NN`.
> - `IMPLEMENTATION-02` vẫn là **nguồn chi tiết** cho *Product Backlog & phân rã Epic/Story* (mã `IMP02-EPIC/STORY/TASK`, Acceptance Criteria chi tiết). Khi nhập story vào board, lấy nội dung/AC từ IMPLEMENTATION-02; epic `EPIC-AUTH-01` (board) ánh xạ tới `IMP02-EPIC-02` (backlog).
> - `IMPLEMENTATION-03` vẫn là **nguồn quy trình thực thi Sprint 0** (readiness, branching, sign-off chuyển Sprint 1).
> - **Sprint numbering theo bộ IMPLEMENTATION (Sprint 0–6)**; xem mục 17 để ánh xạ sang IMPLEMENTATION-03 → IMPLEMENTATION-09.

---

## 4. Công cụ quản lý issue đề xuất

Dự án có thể dùng một trong các công cụ sau:

| Công cụ | Phù hợp khi | Ghi chú |
| --- | --- | --- |
| Jira | Có team nhiều vai trò, cần workflow phức tạp, reporting mạnh | Phù hợp nhất nếu team chuyên nghiệp |
| Linear | Team nhỏ/trung bình, cần board nhanh, UX tốt, tracking gọn | Phù hợp nếu muốn triển khai nhanh |
| GitHub Projects | Source code đặt trên GitHub, muốn issue gắn trực tiếp repo/PR | Phù hợp nếu team kỹ thuật là chính |
| Notion Database | Team nhỏ, chưa cần workflow dev phức tạp | Dễ dùng nhưng cần discipline cao |
| GitLab Issues | Source code đặt trên GitLab, muốn CI/CD tích hợp | Phù hợp nếu dùng GitLab end-to-end |

Khuyến nghị cho MVP:

```text
Nếu code trên GitHub: dùng GitHub Projects + GitHub Issues.
Nếu có đội sản phẩm/QA riêng: dùng Jira.
Nếu làm nhanh, team nhỏ: dùng Linear.
```

---

## 5. Nguyên tắc thiết lập board

### 5.1 Một ticket phải có mục tiêu rõ ràng

Mỗi ticket chỉ nên đại diện cho một đơn vị công việc có thể hoàn thành, review và test được.

Không tạo ticket kiểu quá rộng:

```text
Sai:
- Làm module HR
- Làm backend
- Làm UI
```

Nên tách thành ticket cụ thể:

```text
Đúng:
- HR-BE-001: Create employee table migration and indexes
- HR-BE-002: Implement employee list API with search/filter/pagination
- HR-FE-003: Build employee list screen with permission-based actions
- HR-QA-004: Write test cases for employee list permission and data scope
```

### 5.2 Mọi ticket phải trace được về tài liệu nguồn

Ticket không có tài liệu nguồn thì không được kéo vào Sprint.

Mỗi ticket cần ghi rõ:

```text
Source docs:
- SPEC-03 HR
- DB-03 HR Database Design
- API-03 HR API Design
- UI-09 Module UI Design
- FRONTEND-08 HR Frontend
- BACKEND-05 HR Backend
- QA-02 Test Case Matrix
```

### 5.3 Không hard-code theo role nếu tài liệu yêu cầu permission

Với các ticket liên quan UI, route, API, button, menu, widget, data list, export hoặc field nhạy cảm, ticket phải ghi rõ permission và data scope.

Nguyên tắc:

```text
Role chỉ là seed mặc định.
Permission + data scope mới là cơ sở kiểm tra chính.
Backend là lớp kiểm soát quyền cuối cùng.
```

### 5.4 Ticket phải đủ điều kiện trước khi vào Sprint

Không đưa ticket vào Sprint nếu chưa có:

1. Mục tiêu rõ ràng.
2. Acceptance criteria.
3. Tài liệu nguồn.
4. Module/layer rõ ràng.
5. Dependency rõ ràng.
6. Permission/data scope nếu có.
7. Test expectation tối thiểu.
8. Definition of Done rõ ràng.

### 5.5 Ticket hoàn thành không chỉ là code xong

Một ticket được xem là `Done` khi:

1. Code đã merge.
2. Không còn lỗi lint/type/build.
3. Có test phù hợp.
4. QA hoặc reviewer xác nhận.
5. Acceptance criteria đạt.
6. Không phá vỡ flow/module liên quan.
7. Tài liệu hoặc OpenAPI được cập nhật nếu contract thay đổi.
8. Không còn bug blocker/critical liên quan trực tiếp.

---

## 6. Cấu trúc board chính

### 6.1 Board columns

Issue board MVP sử dụng các cột sau:

| Cột | Ý nghĩa | Ai chịu trách nhiệm chính |
| --- | --- | --- |
| Backlog | Ticket đã ghi nhận nhưng chưa sẵn sàng làm | Product / Tech Lead |
| Refinement | Ticket đang được làm rõ yêu cầu, AC, dependency | Product / BA / Lead |
| Ready | Ticket đã đủ Definition of Ready, có thể đưa vào Sprint | Product / Lead |
| Selected for Sprint | Ticket đã được chọn cho Sprint hiện tại | Scrum Master / Lead |
| In Progress | Đang thực hiện | Assignee |
| Blocked | Bị chặn do thiếu thông tin, dependency, lỗi môi trường hoặc quyết định | Assignee / Lead |
| Code Review | Có PR/MR đang chờ review | Reviewer / Tech Lead |
| QA Ready | Code đã merge hoặc deploy môi trường test, sẵn sàng QA | Dev / QA |
| QA Testing | QA đang test ticket | QA |
| UAT Ready | Đã qua QA nội bộ, sẵn sàng cho UAT nếu là flow nghiệp vụ | Product / QA |
| UAT Testing | Stakeholder/user đại diện đang nghiệm thu | Product / Business |
| Done | Hoàn thành theo Definition of Done | Product / QA / Lead |
| Reopened | Đã Done nhưng phát hiện lỗi hoặc thiếu AC | QA / Product / Lead |
| Cancelled | Không làm nữa hoặc chuyển Phase sau | Product / Lead |

### 6.2 Workflow chuyển trạng thái

```text
Backlog
  -> Refinement
  -> Ready
  -> Selected for Sprint
  -> In Progress
  -> Code Review
  -> QA Ready
  -> QA Testing
  -> UAT Ready
  -> UAT Testing
  -> Done
```

Trạng thái phụ:

```text
In Progress -> Blocked -> In Progress
QA Testing -> Reopened -> In Progress
UAT Testing -> Reopened -> In Progress
Backlog/Ready -> Cancelled
```

### 6.3 Rule chuyển trạng thái

| Từ trạng thái | Sang trạng thái | Điều kiện |
| --- | --- | --- |
| Backlog -> Refinement | Có nhu cầu làm rõ ticket | Product/Lead đưa vào grooming |
| Refinement -> Ready | Đủ DoR | Có AC, source docs, dependency, estimate |
| Ready -> Selected for Sprint | Sprint Planning chọn | Có capacity và ưu tiên phù hợp |
| Selected -> In Progress | Dev bắt đầu làm | Có assignee |
| In Progress -> Code Review | Có PR/MR | PR có mô tả, test note, linked ticket |
| Code Review -> QA Ready | PR merge hoặc deploy test | Không fail CI/build |
| QA Ready -> QA Testing | QA bắt đầu test | Có test environment/data |
| QA Testing -> Done | QA pass và không cần UAT | AC đạt |
| QA Testing -> UAT Ready | Flow cần user/business nghiệm thu | QA pass nội bộ |
| UAT Testing -> Done | UAT pass | Product/Business xác nhận |
| QA/UAT -> Reopened | Fail test hoặc thiếu AC | Ghi rõ lỗi và expected behavior |
| Any -> Blocked | Bị chặn | Phải ghi blocker reason |
| Blocked -> In Progress | Đã gỡ blocker | Cập nhật cách xử lý |

---

## 7. Loại ticket

### 7.1 Ticket hierarchy

```text
Initiative
  -> Epic
      -> Story
          -> Task / Sub-task
      -> Bug
      -> Spike
      -> Chore
```

### 7.2 Định nghĩa loại ticket

| Loại | Ý nghĩa | Ví dụ |
| --- | --- | --- |
| Initiative | Nhóm mục tiêu lớn cấp dự án | MVP Core Delivery |
| Epic | Nhóm chức năng lớn theo module/layer/sprint | AUTH Core Backend |
| Story | Nhu cầu người dùng hoặc nghiệp vụ có thể nghiệm thu | Employee can view own profile |
| Task | Công việc kỹ thuật cụ thể | Create employees migration |
| Sub-task | Việc nhỏ bên trong Story/Task | Add index for employee_code |
| Bug | Lỗi so với AC hoặc behavior đã chốt | Employee list returns data outside scope |
| Spike | Nghiên cứu kỹ thuật/ra quyết định | Evaluate file storage provider |
| Chore | Việc không trực tiếp tạo feature | Update dependencies, clean code |
| QA Task | Viết/chạy test case, regression, UAT support | Test leave approval state transition |
| DevOps Task | CI/CD, environment, deployment, monitoring | Setup staging database backup |

---

## 8. Mã ticket và quy ước đặt tên

### 8.1 Format mã ticket

```text
<MODULE>-<LAYER>-<NUMBER>
```

Ví dụ:

```text
AUTH-BE-001
AUTH-FE-001
AUTH-QA-001
HR-DB-001
ATT-API-001
LEAVE-BE-001
TASK-FE-001
NOTI-BE-001
DASH-QA-001
DEVOPS-CI-001
FOUNDATION-DB-001
```

### 8.2 Module code

| Module code | Ý nghĩa |
| --- | --- |
| PROJECT | Quản trị dự án, board, backlog, baseline |
| FOUNDATION | Company, module catalog, settings, audit, files, sequence, holidays |
| AUTH | Tài khoản, đăng nhập, session, RBAC, permission |
| HR | Nhân sự |
| ATT | Chấm công |
| LEAVE | Nghỉ phép |
| TASK | Công việc & dự án |
| NOTI | Thông báo |
| DASH | Dashboard |
| FRONTEND | Frontend common |
| BACKEND | Backend common |
| QA | QA chung |
| DEVOPS | DevOps chung |
| RELEASE | Release, go-live, UAT, stabilization |

### 8.3 Layer code

| Layer code | Ý nghĩa |
| --- | --- |
| DOC | Documentation |
| DB | Database / migration / seed |
| API | API contract / OpenAPI |
| BE | Backend implementation |
| FE | Frontend implementation |
| UI | UI/UX / prototype / handoff |
| QA | Test case / manual test / automation |
| DEVOPS | Infra / CI/CD / deploy |
| SEC | Security |
| PERF | Performance |
| INT | Integration |
| REL | Release |

### 8.4 Tên ticket

Format tên ticket:

```text
[MODULE][LAYER] Verb + object + expected outcome
```

Ví dụ:

```text
[AUTH][BE] Implement login API with session and audit log
[HR][FE] Build employee list screen with search, filter and pagination
[LEAVE][QA] Test leave approval state transition and balance update
[DEVOPS][CI] Setup backend CI pipeline with lint, test and build
```

---

## 9. Field bắt buộc trong mỗi ticket

### 9.1 Field chung

| Field | Bắt buộc | Ghi chú |
| --- | --- | --- |
| Issue ID | Có | Theo format mã ticket |
| Title | Có | Rõ hành động và kết quả |
| Issue type | Có | Epic, Story, Task, Bug, Spike, Chore |
| Module | Có | AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH... |
| Layer | Có | DB, API, BE, FE, QA, DEVOPS... |
| Priority | Có | P0, P1, P2, P3 |
| Severity | Với Bug | Blocker, Critical, Major, Minor, Trivial |
| Sprint | Khi đưa vào Sprint | Sprint 0, Sprint 1... |
| Assignee | Khi vào In Progress | Người xử lý |
| Reviewer | Nên có | Dev review hoặc QA reviewer |
| Source docs | Có | Tài liệu nguồn |
| Description | Có | Mô tả mục tiêu |
| Acceptance Criteria | Có | Điều kiện nghiệm thu |
| Dependencies | Nếu có | Ticket/module/tài liệu phụ thuộc |
| Test Notes | Có | QA cần test gì |
| Data Scope | Nếu có | Own, Team, Department, Company, System |
| Permission | Nếu có | Permission code hoặc mô tả quyền |
| API Contract | Nếu có | Endpoint liên quan |
| UI Screen | Nếu có | Screen code/route liên quan |
| DB Objects | Nếu có | Table/index/migration liên quan |
| Risk | Nên có | Rủi ro kỹ thuật/nghiệp vụ |
| Definition of Done | Có | Checklist Done cụ thể |

### 9.2 Field riêng cho Bug

| Field | Bắt buộc | Ghi chú |
| --- | --- | --- |
| Environment | Có | Local, Dev, Staging, UAT, Production |
| Build/Commit | Nên có | Version phát hiện lỗi |
| Steps to Reproduce | Có | Các bước tái hiện |
| Actual Result | Có | Kết quả hiện tại |
| Expected Result | Có | Kết quả đúng |
| Evidence | Nên có | Screenshot/log/video |
| Severity | Có | Blocker/Critical/Major/Minor/Trivial |
| Regression? | Có | Có phải lỗi hồi quy không |
| Related Ticket | Nếu có | Ticket gây ra hoặc liên quan |

### 9.3 Field riêng cho API/Backend ticket

| Field | Bắt buộc | Ghi chú |
| --- | --- | --- |
| Endpoint | Nếu có | Method + path |
| Request DTO | Nếu có | Body/query/param |
| Response DTO | Nếu có | Success/error format |
| Permission guard | Có nếu API protected | Permission + data scope |
| Business rule | Có | Rule từ SPEC |
| Audit log | Nếu thao tác quan trọng | Có/không + event |
| Notification event | Nếu có | Event phát sang NOTI |
| Transaction boundary | Nếu có | Khi cần xử lý nhiều bảng |
| Idempotency | Nếu có | Với thao tác nhạy cảm |
| Error codes | Có | Validation/business/auth errors |

### 9.4 Field riêng cho Frontend ticket

| Field | Bắt buộc | Ghi chú |
| --- | --- | --- |
| Route | Nếu có | Route screen |
| Layout | Có | AuthLayout, HomePortalLayout, ModuleWorkspaceLayout |
| Component | Có | Component chính |
| API hook | Nếu có | Query/mutation liên quan |
| Permission UI | Nếu có | Hide/disable/mask/forbidden |
| State | Có | Loading/empty/error/forbidden/disabled/success |
| Responsive | Nên có | Desktop/tablet/mobile |
| Form validation | Nếu có | Rule frontend không thay backend |
| Dirty form guard | Nếu có | Khi có form chưa lưu |
| Accessibility note | Nên có | Focus, keyboard, aria nếu cần |

### 9.5 Field riêng cho QA ticket

| Field | Bắt buộc | Ghi chú |
| --- | --- | --- |
| Test scope | Có | Module/flow/API/screen |
| Test type | Có | API, E2E, regression, permission, performance, security |
| Test data | Có | User/role/employee/sample data |
| Expected result | Có | Kết quả cần đạt |
| Related AC | Có | AC nào được kiểm thử |
| Blocking criteria | Có | Fail thế nào thì block release |
| Evidence required | Nên có | Screenshot/log/report |

---

## 10. Priority, severity và estimate

### 10.1 Priority

| Priority | Ý nghĩa | Ví dụ |
| --- | --- | --- |
| P0 | Bắt buộc cho MVP, không có thì không release được | Login, permission guard, HR employee core, check-in, leave approval |
| P1 | Rất quan trọng, nên có trong MVP | Dashboard widget, notification dropdown, export cơ bản |
| P2 | Có giá trị nhưng có thể lùi nếu thiếu thời gian | UI polish, advanced filter, bulk action |
| P3 | Nice-to-have hoặc Phase sau | Personalization, advanced report, AI summary |

### 10.2 Bug severity

| Severity | Ý nghĩa | SLA xử lý gợi ý |
| --- | --- | --- |
| Blocker | Chặn toàn bộ test/release hoặc mất dữ liệu nghiêm trọng | Xử lý ngay |
| Critical | Lỗi bảo mật, sai quyền, sai dữ liệu nghiệp vụ lõi | Xử lý trong Sprint hiện tại |
| Major | Lỗi chức năng quan trọng nhưng có workaround | Xử lý trước release |
| Minor | Lỗi nhỏ không ảnh hưởng nghiệp vụ chính | Có thể gom fix |
| Trivial | Chính tả/UI nhỏ | Fix khi có thời gian |

### 10.3 Estimate

Có thể dùng Story Point:

| Point | Ý nghĩa |
| --- | --- |
| 1 | Rất nhỏ, dưới nửa ngày |
| 2 | Nhỏ, rõ ràng |
| 3 | Trung bình, có vài bước |
| 5 | Khá lớn, có nhiều dependency |
| 8 | Lớn, cần chia nhỏ nếu có thể |
| 13 | Quá lớn, bắt buộc tách ticket |

Nguyên tắc:

```text
Ticket > 8 point nên tách nhỏ trước khi đưa vào Sprint.
```

---

## 11. Label taxonomy

### 11.1 Module labels

```text
module:foundation
module:auth
module:hr
module:attendance
module:leave
module:task
module:notification
module:dashboard
module:frontend
module:backend
module:qa
module:devops
module:release
```

### 11.2 Layer labels

```text
layer:doc
layer:db
layer:api
layer:backend
layer:frontend
layer:ui
layer:qa
layer:devops
layer:security
layer:performance
layer:integration
layer:release
```

### 11.3 Type labels

```text
type:epic
type:story
type:task
type:bug
type:spike
type:chore
type:qa
type:devops
```

### 11.4 Priority labels

```text
priority:p0
priority:p1
priority:p2
priority:p3
```

### 11.5 Status/risk labels

```text
risk:blocked
risk:dependency
risk:scope-creep
risk:security
risk:data-loss
risk:performance
risk:integration
risk:uat
```

### 11.6 Sprint labels

```text
sprint:0
sprint:1
sprint:2
sprint:3
sprint:4
sprint:5
sprint:6
```

### 11.7 Scope labels

```text
scope:own
scope:team
scope:department
scope:company
scope:system
scope:project
```

---

## 12. Board views cần tạo

### 12.1 Main Sprint Board

Dùng để theo dõi công việc Sprint hiện tại.

Filter:

```text
Sprint = current
Status != Cancelled
```

Group by:

```text
Status
```

### 12.2 Backlog by Module

Dùng để refine backlog theo module.

Group by:

```text
Module
```

Sort:

```text
Priority -> Dependency -> Estimate
```

### 12.3 Backend Board

Filter:

```text
Layer in (DB, API, BE, SEC, PERF)
```

### 12.4 Frontend Board

Filter:

```text
Layer in (FE, UI)
```

### 12.5 QA Board

Filter:

```text
Layer = QA OR Type = Bug
```

### 12.6 DevOps Board

Filter:

```text
Layer = DEVOPS OR Module = DEVOPS
```

### 12.7 Release Readiness Board

Filter:

```text
Priority in (P0, P1)
AND Status not in (Done, Cancelled)
```

### 12.8 Blocker Board

Filter:

```text
Status = Blocked
OR Severity in (Blocker, Critical)
OR label = risk:blocked
```

---

## 13. Definition of Ready

Một ticket được đưa vào `Ready` khi đáp ứng đủ:

- [ ] Có title rõ ràng.
- [ ] Có issue type.
- [ ] Có module và layer.
- [ ] Có priority.
- [ ] Có mô tả mục tiêu.
- [ ] Có tài liệu nguồn.
- [ ] Có acceptance criteria.
- [ ] Có dependency nếu liên quan.
- [ ] Có permission/data scope nếu liên quan.
- [ ] Có API/screen/table liên quan nếu ticket chạm API/UI/DB.
- [ ] Có test note tối thiểu.
- [ ] Có estimate.
- [ ] Không còn câu hỏi blocker.
- [ ] Không mở rộng scope ngoài MVP.

---

## 14. Definition of Done

Một ticket được chuyển `Done` khi đáp ứng đủ:

- [ ] Hoàn thành đúng acceptance criteria.
- [ ] Code đã review và merge nếu là ticket code.
- [ ] CI/build/test không fail.
- [ ] Không còn lỗi lint/type.
- [ ] Unit/integration test liên quan đã cập nhật nếu cần.
- [ ] API contract/OpenAPI cập nhật nếu endpoint thay đổi.
- [ ] Migration/seed đã chạy được từ database trống nếu có DB change.
- [ ] UI state loading/empty/error/forbidden/disabled có xử lý nếu là frontend ticket.
- [ ] Backend guard kiểm tra authentication/permission/data scope nếu là API protected.
- [ ] Audit log/notification event được xử lý nếu tài liệu yêu cầu.
- [ ] QA pass hoặc có xác nhận không cần QA riêng.
- [ ] Không còn bug blocker/critical liên quan trực tiếp.
- [ ] Tài liệu ghi chú thay đổi đã cập nhật nếu cần.

---

## 15. Template ticket

### 15.1 Epic template

```markdown
# [MODULE] Epic name

## Objective

## Scope

## Out of scope

## Source docs

## Child tickets

## Dependencies

## Success criteria

## Risks

## Sign-off
```

### 15.2 Story template

```markdown
# [MODULE][LAYER] Story title

## User story

As a ...
I want ...
So that ...

## Context

## Source docs

## Scope

## Out of scope

## Acceptance criteria

- [ ] AC-01:
- [ ] AC-02:
- [ ] AC-03:

## Permission & data scope

## API / UI / DB mapping

## Dependencies

## Test notes

## Definition of Done
```

### 15.3 Backend/API task template

```markdown
# [MODULE][BE/API] Task title

## Objective

## Source docs

## Endpoint / service / job

## Business rules

## Permission guard

## Data scope

## Request / response

## Database objects

## Audit log

## Notification event

## Error cases

## Acceptance criteria

## Test notes

## Definition of Done
```

### 15.4 Frontend task template

```markdown
# [MODULE][FE] Task title

## Objective

## Source docs

## Route / screen

## Layout

## Components

## API hooks

## Permission UI

## States

- Loading:
- Empty:
- Error:
- Forbidden:
- Disabled:
- Success:

## Responsive notes

## Acceptance criteria

## Test notes

## Definition of Done
```

### 15.5 Bug template

```markdown
# [BUG][MODULE] Bug title

## Environment

## Build / commit

## Severity

## Priority

## Related ticket

## Steps to reproduce

1.
2.
3.

## Actual result

## Expected result

## Evidence

## Impact

## Suspected cause

## Acceptance criteria for fix

## Regression test notes
```

### 15.6 Spike template

```markdown
# [SPIKE][MODULE] Research title

## Question to answer

## Context

## Options to evaluate

## Constraints

## Timebox

## Output expected

## Decision needed

## Follow-up tickets
```

### 15.7 QA ticket template

```markdown
# [QA][MODULE] Test scope title

## Test objective

## Source docs

## Test type

## Test data

## Scope

## Out of scope

## Test scenarios

## Acceptance criteria mapping

## Bug reporting rule

## Evidence required

## Exit criteria
```

### 15.8 DevOps ticket template

```markdown
# [DEVOPS] Task title

## Objective

## Environment

## Source docs

## Scope

## Config/secrets affected

## Pipeline/deployment affected

## Rollback plan

## Monitoring/logging impact

## Acceptance criteria

## Verification steps

## Definition of Done
```

---

## 16. Epic structure cho MVP

### 16.1 Project/Foundation epics

| Epic ID | Tên Epic | Mục tiêu | Priority |
| --- | --- | --- | --- |
| EPIC-PROJECT-01 | Board, baseline and project governance | Thiết lập board, rule, ticket, sprint process | P0 |
| EPIC-FOUNDATION-01 | Foundation database and seed | Company, module, setting, audit, file, sequence, holiday | P0 |
| EPIC-FOUNDATION-02 | Shared backend infrastructure | Config, error, logging, auth context, audit middleware | P0 |
| EPIC-FOUNDATION-03 | Shared frontend infrastructure | App shell, layout, API client, route guard, design system | P0 |

### 16.2 Module epics

| Epic ID | Module | Tên Epic | Priority |
| --- | --- | --- | --- |
| EPIC-AUTH-01 | AUTH | Authentication, session and account core | P0 |
| EPIC-AUTH-02 | AUTH | RBAC, permission and data scope | P0 |
| EPIC-HR-01 | HR | Employee master data and organization core | P0 |
| EPIC-HR-02 | HR | Employee self-service profile change | P1 |
| EPIC-ATT-01 | ATT | Today attendance and check-in/out | P0 |
| EPIC-ATT-02 | ATT | Attendance records, adjustment and remote work | P0 |
| EPIC-LEAVE-01 | LEAVE | Leave request, approval and balance | P0 |
| EPIC-LEAVE-02 | LEAVE | Leave calendar, policy and ATT sync | P1 |
| EPIC-TASK-01 | TASK | Project and task core workflow | P0 |
| EPIC-TASK-02 | TASK | Kanban, comment, checklist and files | P1 |
| EPIC-NOTI-01 | NOTI | Notification event, message and unread count | P0 |
| EPIC-DASH-01 | DASH | Role-based dashboard and widgets | P1 |

### 16.3 QA/DevOps/Release epics

| Epic ID | Tên Epic | Mục tiêu | Priority |
| --- | --- | --- | --- |
| EPIC-QA-01 | QA strategy and test case matrix | Chuẩn hóa test case MVP | P0 |
| EPIC-QA-02 | Integration, regression and UAT | Kiểm thử end-to-end và nghiệm thu | P0 |
| EPIC-DEVOPS-01 | Local/dev/staging environment | Dựng môi trường chạy được | P0 |
| EPIC-DEVOPS-02 | CI/CD, monitoring and rollback | Pipeline, deploy, log, rollback | P0 |
| EPIC-RELEASE-01 | Release candidate and go-live | RC, UAT sign-off, production readiness | P0 |

---

## 17. Sprint mapping đề xuất

> Sprint numbering theo bộ IMPLEMENTATION (Sprint 0–6). Ánh xạ trực tiếp: Sprint 0 = IMPLEMENTATION-03, Sprint 1 = IMPLEMENTATION-04, Sprint 2 = IMPLEMENTATION-05, Sprint 3 = IMPLEMENTATION-06, Sprint 4 = IMPLEMENTATION-07, Sprint 5 = IMPLEMENTATION-08, Sprint 6 = IMPLEMENTATION-09.

### 17.1 Sprint 0: Repository, environment and bootstrap (IMPLEMENTATION-03)

Mục tiêu:

```text
Dựng nền tảng để team có thể code, build, test và deploy dev environment.
```

Nhóm ticket chính:

| Ticket group | Nội dung |
| --- | --- |
| PROJECT | Tạo board, label, workflow, template, backlog |
| DEVOPS | Repo, branching, CI basic, Docker local, env |
| FOUNDATION-DB | Migration base, extensions, companies, modules, settings, audit |
| AUTH-DB | Users, roles, permissions, sessions, seed role/permission |
| BACKEND | Project setup, config, logger, error handling, health check |
| FRONTEND | Project setup, design system skeleton, API client skeleton, route skeleton |
| QA | Test strategy, smoke test checklist, test data plan |

### 17.2 Sprint 1: Foundation, environment and core infrastructure (IMPLEMENTATION-04)

Mục tiêu:

```text
Có foundation service, auth context, app shell và layout nền để sẵn sàng code module nghiệp vụ.
```

Nhóm ticket chính:

| Ticket group | Nội dung |
| --- | --- |
| FOUNDATION | Audit middleware, file metadata service, settings/sequence skeleton |
| BACKEND | Auth context middleware, config, error/logging, health check hoàn chỉnh |
| FRONTEND | Home Portal shell, App Switcher shell, Module Workspace layout |
| QA | Smoke test foundation, verify migration/seed từ DB trống |

### 17.3 Sprint 2: AUTH and HR core (IMPLEMENTATION-05)

Mục tiêu:

```text
Có login, session, permission framework và employee master data cơ bản.
```

Nhóm ticket chính:

| Ticket group | Nội dung |
| --- | --- |
| AUTH | Login/logout/current user, session, password, RBAC, route/API guard |
| HR | Employee list/detail/create/update, department, position |
| FRONTEND | Login UI, protected route, account/profile screen |
| QA | Auth permission test, HR CRUD test, data scope test |

### 17.4 Sprint 3: Attendance and Leave core (IMPLEMENTATION-06)

Mục tiêu:

```text
Có check-in/out, bảng công cơ bản, tạo và duyệt đơn nghỉ.
```

Nhóm ticket chính:

| Ticket group | Nội dung |
| --- | --- |
| ATT | Today attendance, check-in/out, attendance records, adjustment |
| LEAVE | Leave balance, leave request, approval, leave type/policy |
| NOTI | Event nền cho ATT/LEAVE |
| QA | Attendance/leave workflow test, ATT-LEAVE sync test |

### 17.5 Sprint 4: Task, Notification and Dashboard core (IMPLEMENTATION-07)

Mục tiêu:

```text
Có project/task core, thông báo in-app và dashboard vai trò cơ bản.
```

Nhóm ticket chính:

| Ticket group | Nội dung |
| --- | --- |
| TASK | Project, task, assignee, status, Kanban basic |
| NOTI | Notification dropdown, list, unread count, mark read |
| DASH | Employee/Manager/HR/Admin dashboard basic widgets |
| QA | Task workflow, notification, dashboard permission test |

### 17.6 Sprint 5: Integration, QA hardening and UAT (IMPLEMENTATION-08)

Mục tiêu:

```text
Hoàn thiện liên kết module, sửa lỗi integration, tăng độ ổn định và chạy UAT.
```

Nhóm ticket chính:

| Ticket group | Nội dung |
| --- | --- |
| INT | AUTH-HR, ATT-LEAVE, TASK-NOTI, DASH aggregation |
| QA | E2E, regression, permission, API contract |
| PERF | Query/index review, dashboard cache, unread count |
| SEC | Security test, field-level sensitive data, access guard |
| UAT | UAT scenarios, user acceptance, sign-off |

### 17.7 Sprint 6: Stabilization, release candidate and go-live (IMPLEMENTATION-09)

Mục tiêu:

```text
Ổn định hệ thống, chốt release candidate và go-live.
```

Nhóm ticket chính:

| Ticket group | Nội dung |
| --- | --- |
| DEVOPS | Staging, backup, rollback, monitoring |
| RELEASE | RC checklist, release notes, go-live plan |
| QA | Final regression, release readiness checklist |

---

## 18. Initial MVP backlog seed

### 18.1 Project / board setup tickets

| Ticket ID | Title | Type | Priority | Sprint |
| --- | --- | --- | --- | --- |
| PROJECT-DOC-001 | Create MVP issue board workflow, labels and templates | Task | P0 | Sprint 0 |
| PROJECT-DOC-002 | Import MVP epic structure into board | Task | P0 | Sprint 0 |
| PROJECT-DOC-003 | Convert implementation plan into sprint backlog | Task | P0 | Sprint 0 |
| PROJECT-DOC-004 | Create Definition of Ready and Definition of Done checklist in board | Task | P0 | Sprint 0 |
| PROJECT-DOC-005 | Create change request process for post-baseline scope changes | Task | P1 | Sprint 0 |

### 18.2 Foundation tickets

| Ticket ID | Title | Type | Priority | Sprint |
| --- | --- | --- | --- | --- |
| FOUNDATION-DB-001 | Setup PostgreSQL extensions and base migration structure | Task | P0 | Sprint 0 |
| FOUNDATION-DB-002 | Create companies, modules, settings and sequence tables | Task | P0 | Sprint 0 |
| FOUNDATION-DB-003 | Create audit log, files, file links and public holidays tables | Task | P0 | Sprint 0 |
| FOUNDATION-DB-004 | Seed module catalog and default company settings | Task | P0 | Sprint 0 |
| FOUNDATION-BE-001 | Implement shared config, logger and error response format | Task | P0 | Sprint 0 |
| FOUNDATION-BE-002 | Implement audit log service and middleware skeleton | Task | P0 | Sprint 1 |
| FOUNDATION-BE-003 | Implement file metadata service skeleton | Task | P1 | Sprint 1 |
| FOUNDATION-QA-001 | Verify foundation migration and seed from empty database | QA Task | P0 | Sprint 0 |

### 18.3 AUTH tickets

| Ticket ID | Title | Type | Priority | Sprint |
| --- | --- | --- | --- | --- |
| AUTH-DB-001 | Create users, sessions, password reset and login log tables | Task | P0 | Sprint 0 |
| AUTH-DB-002 | Create roles, permissions, user roles and role permissions tables | Task | P0 | Sprint 0 |
| AUTH-DB-003 | Seed default permissions, roles and role-permission matrix | Task | P0 | Sprint 0 |
| AUTH-API-001 | Define OpenAPI contract for login, logout and current user | Task | P0 | Sprint 2 |
| AUTH-BE-001 | Implement login API with password verification and session creation | Story | P0 | Sprint 2 |
| AUTH-BE-002 | Implement logout and refresh session handling | Story | P0 | Sprint 2 |
| AUTH-BE-003 | Implement current user API with roles, permissions and data scope | Story | P0 | Sprint 2 |
| AUTH-BE-004 | Implement backend permission guard and data scope helper | Story | P0 | Sprint 2 |
| AUTH-FE-001 | Build login screen and auth state bootstrap | Story | P0 | Sprint 2 |
| AUTH-FE-002 | Build protected route guard and forbidden route behavior | Story | P0 | Sprint 2 |
| AUTH-FE-003 | Build user account profile and change password screen | Story | P1 | Sprint 2 |
| AUTH-QA-001 | Test login, logout, token expiry and locked account scenarios | QA Task | P0 | Sprint 2 |
| AUTH-QA-002 | Test permission and route guard behavior | QA Task | P0 | Sprint 2 |

### 18.4 Frontend common tickets

| Ticket ID | Title | Type | Priority | Sprint |
| --- | --- | --- | --- | --- |
| FRONTEND-FE-001 | Setup frontend project structure, scripts and environment config | Task | P0 | Sprint 0 |
| FRONTEND-FE-002 | Implement design token and base component skeleton | Task | P0 | Sprint 0 |
| FRONTEND-FE-003 | Implement API client, query layer and error handling skeleton | Task | P0 | Sprint 0 |
| FRONTEND-FE-004 | Implement Home Portal layout shell | Story | P0 | Sprint 1 |
| FRONTEND-FE-005 | Implement App Switcher shell with permission-based app visibility | Story | P0 | Sprint 1 |
| FRONTEND-FE-006 | Implement Module Workspace layout with topbar and sidebar | Story | P0 | Sprint 1 |
| FRONTEND-QA-001 | Verify responsive shell layout and protected route state | QA Task | P1 | Sprint 1 |

### 18.5 HR tickets

| Ticket ID | Title | Type | Priority | Sprint |
| --- | --- | --- | --- | --- |
| HR-DB-001 | Create HR organization and employee core tables | Task | P0 | Sprint 2 |
| HR-DB-002 | Create employee contract and profile change request tables | Task | P0 | Sprint 2 |
| HR-DB-003 | Create employee code config and sequence integration | Task | P1 | Sprint 2 |
| HR-API-001 | Define OpenAPI contract for employee list, detail, create and update | Task | P0 | Sprint 2 |
| HR-BE-001 | Implement employee list API with search, filter and pagination | Story | P0 | Sprint 2 |
| HR-BE-002 | Implement employee detail API with field-level permission handling | Story | P0 | Sprint 2 |
| HR-BE-003 | Implement create employee flow with auto employee code | Story | P0 | Sprint 2 |
| HR-BE-004 | Implement update employee and status change with audit log | Story | P0 | Sprint 2 |
| HR-BE-005 | Implement department and position CRUD APIs | Story | P0 | Sprint 2 |
| HR-FE-001 | Build employee list screen with filter and pagination | Story | P0 | Sprint 2 |
| HR-FE-002 | Build employee detail screen with sensitive field masking | Story | P0 | Sprint 2 |
| HR-FE-003 | Build employee create/edit form | Story | P0 | Sprint 2 |
| HR-FE-004 | Build department and position management screens | Story | P1 | Sprint 2 |
| HR-FE-005 | Build my profile and profile change request screen | Story | P1 | Sprint 3 |
| HR-QA-001 | Test HR employee CRUD, search, filter and pagination | QA Task | P0 | Sprint 2 |
| HR-QA-002 | Test HR permission, data scope and sensitive field masking | QA Task | P0 | Sprint 2 |
| HR-QA-003 | Test profile change request approval flow | QA Task | P1 | Sprint 3 |

### 18.6 Attendance tickets

| Ticket ID | Title | Type | Priority | Sprint |
| --- | --- | --- | --- | --- |
| ATT-DB-001 | Create shifts, shift assignments and attendance rules tables | Task | P0 | Sprint 3 |
| ATT-DB-002 | Create attendance records and attendance logs tables | Task | P0 | Sprint 3 |
| ATT-DB-003 | Create attendance adjustment and remote work request tables | Task | P0 | Sprint 3 |
| ATT-API-001 | Define OpenAPI contract for today attendance and check-in/out | Task | P0 | Sprint 3 |
| ATT-BE-001 | Implement today attendance status API | Story | P0 | Sprint 3 |
| ATT-BE-002 | Implement check-in API with rule validation and audit log | Story | P0 | Sprint 3 |
| ATT-BE-003 | Implement check-out API with rule validation and audit log | Story | P0 | Sprint 3 |
| ATT-BE-004 | Implement attendance record list and detail API | Story | P0 | Sprint 3 |
| ATT-BE-005 | Implement attendance adjustment request and approval flow | Story | P0 | Sprint 3 |
| ATT-BE-006 | Implement remote work request flow | Story | P1 | Sprint 3 |
| ATT-FE-001 | Build today attendance screen with check-in/out actions | Story | P0 | Sprint 3 |
| ATT-FE-002 | Build personal attendance record screen | Story | P0 | Sprint 3 |
| ATT-FE-003 | Build team/company attendance record screen by permission | Story | P1 | Sprint 3 |
| ATT-FE-004 | Build attendance adjustment request form and approval screen | Story | P0 | Sprint 3 |
| ATT-QA-001 | Test check-in/out rule and blocked leave day scenarios | QA Task | P0 | Sprint 3 |
| ATT-QA-002 | Test attendance adjustment approval and data scope | QA Task | P0 | Sprint 3 |

### 18.7 Leave tickets

| Ticket ID | Title | Type | Priority | Sprint |
| --- | --- | --- | --- | --- |
| LEAVE-DB-001 | Create leave type, policy, balance and transaction tables | Task | P0 | Sprint 3 |
| LEAVE-DB-002 | Create leave request, leave request days and approval tables | Task | P0 | Sprint 3 |
| LEAVE-API-001 | Define OpenAPI contract for leave request and approval APIs | Task | P0 | Sprint 3 |
| LEAVE-BE-001 | Implement my leave balance API | Story | P0 | Sprint 3 |
| LEAVE-BE-002 | Implement leave calculation preview API | Story | P0 | Sprint 3 |
| LEAVE-BE-003 | Implement create draft and submit leave request flow | Story | P0 | Sprint 3 |
| LEAVE-BE-004 | Implement approve/reject leave request flow with balance update | Story | P0 | Sprint 3 |
| LEAVE-BE-005 | Implement leave cancellation and ATT sync trigger | Story | P0 | Sprint 3 |
| LEAVE-BE-006 | Implement leave type and policy management APIs | Story | P1 | Sprint 3 |
| LEAVE-FE-001 | Build my leave balance and my leave request list screen | Story | P0 | Sprint 3 |
| LEAVE-FE-002 | Build create leave request form with calculation preview | Story | P0 | Sprint 3 |
| LEAVE-FE-003 | Build leave request approval screen | Story | P0 | Sprint 3 |
| LEAVE-FE-004 | Build leave calendar screen | Story | P1 | Sprint 4 |
| LEAVE-QA-001 | Test leave request draft, submit, approve, reject and cancel states | QA Task | P0 | Sprint 3 |
| LEAVE-QA-002 | Test leave balance update and ATT sync regression | QA Task | P0 | Sprint 3 |

### 18.8 Task tickets

| Ticket ID | Title | Type | Priority | Sprint |
| --- | --- | --- | --- | --- |
| TASK-DB-001 | Create project, project member and project file tables | Task | P0 | Sprint 4 |
| TASK-DB-002 | Create task, assignee, watcher, comment and checklist tables | Task | P0 | Sprint 4 |
| TASK-DB-003 | Create task activity log and task file tables | Task | P1 | Sprint 4 |
| TASK-API-001 | Define OpenAPI contract for project and task core APIs | Task | P0 | Sprint 4 |
| TASK-BE-001 | Implement project list, detail and create/update APIs | Story | P0 | Sprint 4 |
| TASK-BE-002 | Implement project member management APIs | Story | P0 | Sprint 4 |
| TASK-BE-003 | Implement task list, detail and create/update APIs | Story | P0 | Sprint 4 |
| TASK-BE-004 | Implement task assignment and status transition APIs | Story | P0 | Sprint 4 |
| TASK-BE-005 | Implement task comment, mention and checklist APIs | Story | P1 | Sprint 4 |
| TASK-FE-001 | Build project list and project detail screens | Story | P0 | Sprint 4 |
| TASK-FE-002 | Build task list, my task and task detail screens | Story | P0 | Sprint 4 |
| TASK-FE-003 | Build Kanban board with status update | Story | P1 | Sprint 4 |
| TASK-FE-004 | Build task comment, checklist and attachment UI | Story | P1 | Sprint 4 |
| TASK-QA-001 | Test project/task CRUD, assignment and status transition | QA Task | P0 | Sprint 4 |
| TASK-QA-002 | Test task permission, project member scope and notification events | QA Task | P1 | Sprint 4 |

### 18.9 Notification tickets

| Ticket ID | Title | Type | Priority | Sprint |
| --- | --- | --- | --- | --- |
| NOTI-DB-001 | Create notification event, template, notification and delivery log tables | Task | P0 | Sprint 4 |
| NOTI-DB-002 | Seed notification events and templates for MVP modules | Task | P0 | Sprint 4 |
| NOTI-API-001 | Define OpenAPI contract for my notification APIs | Task | P0 | Sprint 4 |
| NOTI-BE-001 | Implement notification event producer/consumer skeleton | Story | P0 | Sprint 4 |
| NOTI-BE-002 | Implement create notification from business event | Story | P0 | Sprint 4 |
| NOTI-BE-003 | Implement notification list, detail, unread count and dropdown APIs | Story | P0 | Sprint 4 |
| NOTI-BE-004 | Implement mark read, mark all read and hide notification APIs | Story | P0 | Sprint 4 |
| NOTI-FE-001 | Build notification badge and dropdown | Story | P0 | Sprint 4 |
| NOTI-FE-002 | Build notification list and detail screens | Story | P0 | Sprint 4 |
| NOTI-FE-003 | Implement notification deep link handling | Story | P0 | Sprint 4 |
| NOTI-QA-001 | Test unread count, mark read and notification target deep link | QA Task | P0 | Sprint 4 |
| NOTI-QA-002 | Test notification events from ATT, LEAVE and TASK | QA Task | P1 | Sprint 5 |

### 18.10 Dashboard tickets

| Ticket ID | Title | Type | Priority | Sprint |
| --- | --- | --- | --- | --- |
| DASH-DB-001 | Create dashboard widget, config and cache tables | Task | P1 | Sprint 4 |
| DASH-DB-002 | Seed dashboard widgets and default configs by role | Task | P1 | Sprint 4 |
| DASH-API-001 | Define OpenAPI contract for dashboard me and widget APIs | Task | P1 | Sprint 4 |
| DASH-BE-001 | Implement dashboard me API by role and permission | Story | P1 | Sprint 4 |
| DASH-BE-002 | Implement attendance, leave, task and notification widget data APIs | Story | P1 | Sprint 4 |
| DASH-BE-003 | Implement dashboard cache invalidate/refresh skeleton | Story | P2 | Sprint 5 |
| DASH-FE-001 | Build dashboard shell and dashboard type switcher | Story | P1 | Sprint 4 |
| DASH-FE-002 | Build employee dashboard widgets | Story | P1 | Sprint 4 |
| DASH-FE-003 | Build manager, HR and admin dashboard widgets | Story | P1 | Sprint 5 |
| DASH-QA-001 | Test dashboard widget visibility by permission and data scope | QA Task | P1 | Sprint 5 |
| DASH-QA-002 | Test dashboard degraded state when source module fails | QA Task | P2 | Sprint 5 |

### 18.11 QA, integration and release tickets

| Ticket ID | Title | Type | Priority | Sprint |
| --- | --- | --- | --- | --- |
| QA-DOC-001 | Create MVP test case matrix by module and flow | QA Task | P0 | Sprint 0 |
| QA-API-001 | Create API smoke test checklist for AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH | QA Task | P0 | Sprint 2 |
| QA-E2E-001 | Create E2E test for login -> Home Portal -> Module Workspace | QA Task | P0 | Sprint 2 |
| QA-E2E-002 | Create E2E test for check-in, leave request and task update flows | QA Task | P0 | Sprint 5 |
| QA-PERM-001 | Create permission and data scope regression suite | QA Task | P0 | Sprint 5 |
| QA-SEC-001 | Run security testing for auth, permission and sensitive data | QA Task | P0 | Sprint 5 |
| QA-PERF-001 | Run performance test for employee list, attendance record and dashboard APIs | QA Task | P1 | Sprint 5 |
| DEVOPS-CI-001 | Setup backend lint, test and build pipeline | DevOps Task | P0 | Sprint 0 |
| DEVOPS-CI-002 | Setup frontend lint, typecheck and build pipeline | DevOps Task | P0 | Sprint 0 |
| DEVOPS-ENV-001 | Setup local Docker compose for backend, frontend and PostgreSQL | DevOps Task | P0 | Sprint 0 |
| DEVOPS-ENV-002 | Setup staging environment and deployment pipeline | DevOps Task | P0 | Sprint 5 |
| DEVOPS-MON-001 | Setup logging, monitoring and alerting baseline | DevOps Task | P1 | Sprint 5 |
| RELEASE-REL-001 | Prepare release candidate checklist | Release Task | P0 | Sprint 6 |
| RELEASE-UAT-001 | Prepare UAT scenarios and sign-off form | Release Task | P0 | Sprint 5 |
| RELEASE-GO-001 | Prepare go-live, rollback and post-release monitoring checklist | Release Task | P0 | Sprint 6 |

---

## 19. Change request process

Sau khi `PROJECT-BASELINE-01` đã được chốt, mọi yêu cầu mới hoặc thay đổi lớn phải đi qua change request.

### 19.1 Khi nào cần change request

Cần tạo change request nếu:

1. Thêm module mới vào MVP.
2. Thêm flow nghiệp vụ mới chưa có trong SPEC.
3. Đổi rule phê duyệt, permission hoặc data scope.
4. Đổi database schema ảnh hưởng nhiều module.
5. Đổi API contract đã được frontend/QA dùng.
6. Đổi UI flow P0 đã được chốt.
7. Thêm tích hợp ngoài MVP như SSO, máy chấm công thật, payroll, mobile native.
8. Yêu cầu làm lại sprint plan hoặc release scope.

### 19.2 Template change request

```markdown
# CR-YYYY-NNN: Change request title

## Request summary

## Reason

## Current baseline

## Proposed change

## Impacted modules

## Impacted documents

## Impacted tickets

## Impact analysis

- Product:
- Database:
- API:
- Backend:
- Frontend:
- QA:
- DevOps:
- Timeline:

## Decision

- [ ] Approved for MVP
- [ ] Approved for Phase 2
- [ ] Rejected
- [ ] Need more analysis

## Sign-off
```

### 19.3 Label cho change request

```text
type:change-request
risk:scope-creep
```

---

## 20. Board governance

### 20.1 Daily triage

Mỗi ngày kiểm tra:

- [ ] Ticket `Blocked`.
- [ ] Bug `Blocker` hoặc `Critical`.
- [ ] Ticket đang `In Progress` quá lâu.
- [ ] PR chờ review quá lâu.
- [ ] QA Testing bị kẹt do thiếu môi trường/test data.
- [ ] Ticket không có assignee.
- [ ] Ticket thiếu AC hoặc source docs.

### 20.2 Backlog refinement

Mỗi tuần hoặc trước Sprint Planning:

- [ ] Rà soát ticket P0/P1.
- [ ] Tách ticket quá lớn.
- [ ] Bổ sung acceptance criteria.
- [ ] Bổ sung source docs.
- [ ] Gắn dependency.
- [ ] Chốt estimate.
- [ ] Đưa ticket đủ điều kiện sang `Ready`.
- [ ] Đưa ticket ngoài scope sang Phase 2 backlog.

### 20.3 Sprint planning

Trước khi bắt đầu Sprint:

- [ ] Chỉ chọn ticket `Ready`.
- [ ] Không chọn ticket thiếu AC.
- [ ] Không chọn ticket có dependency chưa xong, trừ khi có kế hoạch rõ.
- [ ] Cân bằng Backend, Frontend, QA, DevOps capacity.
- [ ] Ưu tiên vertical slice có thể test end-to-end.
- [ ] Đảm bảo QA có ticket test song song.

### 20.4 Sprint review

Cuối Sprint:

- [ ] Demo flow hoàn thành.
- [ ] Kiểm tra ticket Done có đủ DoD.
- [ ] Ghi bug còn tồn.
- [ ] Ghi scope bị lùi.
- [ ] Cập nhật release readiness.
- [ ] Cập nhật backlog Sprint tiếp theo.

### 20.5 Sprint retrospective

Cuối Sprint:

- [ ] Ticket nào bị estimate sai?
- [ ] Dependency nào gây blocker?
- [ ] AC nào chưa đủ rõ?
- [ ] Test data/môi trường có gây chậm?
- [ ] Có cần đổi workflow board không?
- [ ] Có scope creep không?

---

## 21. Quy tắc dependency

### 21.1 Dependency giữa module

| Module | Phụ thuộc chính |
| --- | --- |
| AUTH | FOUNDATION |
| HR | FOUNDATION, AUTH |
| ATT | FOUNDATION, AUTH, HR, LEAVE |
| LEAVE | FOUNDATION, AUTH, HR, ATT |
| TASK | FOUNDATION, AUTH, HR, LEAVE, NOTI |
| NOTI | FOUNDATION, AUTH, HR, ATT, LEAVE, TASK |
| DASH | FOUNDATION, AUTH, HR, ATT, LEAVE, TASK, NOTI |

### 21.2 Dependency triển khai theo layer

```text
DB migration
  -> Seed
  -> Backend model/repository
  -> Backend service/controller
  -> OpenAPI/contract update
  -> Frontend API client/hook
  -> Frontend screen/component
  -> QA test
  -> UAT
```

Không nên làm frontend nghiệp vụ sâu nếu API contract chưa đủ ổn định. Có thể dùng mock tạm thời nhưng ticket phải ghi rõ `uses mock`.

---

## 22. Risk management trên board

### 22.1 Risk category

| Risk | Dấu hiệu | Cách xử lý |
| --- | --- | --- |
| Scope creep | Ticket thêm tính năng ngoài MVP | Tạo change request hoặc đưa Phase 2 |
| Permission risk | Không rõ ai được xem/làm gì | Quay lại SPEC/API/AUTH |
| Data scope risk | Không rõ Own/Team/Company/System | Bổ sung AC và test case |
| Migration risk | FK vòng, seed không idempotent | Tách migration, test DB trống |
| Integration risk | Module này phụ thuộc module khác chưa xong | Tạo mock/contract và dependency ticket |
| Performance risk | Query list/dashboard/log có nguy cơ chậm | Thêm index/query review ticket |
| Security risk | Dữ liệu nhạy cảm hoặc token/session | Đẩy lên P0/P1, bắt buộc review |
| QA risk | Không có test data hoặc môi trường | Tạo QA/DevOps blocker ticket |

### 22.2 Rule cho Blocked ticket

Ticket ở `Blocked` phải có:

- [ ] Lý do bị block.
- [ ] Ai cần gỡ block.
- [ ] Ticket/document quyết định liên quan.
- [ ] Ngày phát hiện block.
- [ ] Hướng xử lý đề xuất.
- [ ] Ngày cần review lại.

---

## 23. Acceptance criteria cho việc setup board

Board được xem là setup đạt khi:

- [ ] Đã tạo đủ columns theo mục 6.
- [ ] Đã tạo đủ issue types.
- [ ] Đã tạo đủ labels module/layer/type/priority/scope/risk.
- [ ] Đã tạo đủ custom fields bắt buộc hoặc field tương đương trong công cụ đang dùng.
- [ ] Đã tạo Epic structure cho MVP.
- [ ] Đã import backlog seed tối thiểu cho Sprint 0 và Sprint 1.
- [ ] Đã có template cho Story, Task, Bug, Spike, QA, DevOps.
- [ ] Đã cấu hình view theo Main Sprint, Backlog by Module, Backend, Frontend, QA, DevOps, Release Readiness, Blocker.
- [ ] Đã có Definition of Ready và Definition of Done.
- [ ] Đã có change request process.
- [ ] Đã có rule quản lý blocker, bug severity và scope creep.
- [ ] Product/Tech Lead/QA/DevOps đã review board.
- [ ] Board sẵn sàng để bắt đầu Sprint 0.

---

## 24. Checklist tạo board thực tế

### 24.1 Tạo project board

- [ ] Tạo board/project tên: `Enterprise Management System - MVP`.
- [ ] Chọn template Kanban hoặc Scrum.
- [ ] Tạo columns theo mục 6.
- [ ] Bật field Sprint nếu dùng Scrum.
- [ ] Bật field estimate/story point nếu công cụ hỗ trợ.
- [ ] Bật field priority/severity.
- [ ] Bật field module/layer/scope nếu công cụ hỗ trợ custom field.

### 24.2 Tạo labels

- [ ] Tạo module labels.
- [ ] Tạo layer labels.
- [ ] Tạo type labels.
- [ ] Tạo priority labels.
- [ ] Tạo risk labels.
- [ ] Tạo scope labels.
- [ ] Tạo sprint labels nếu cần.

### 24.3 Tạo templates

- [ ] Epic template.
- [ ] Story template.
- [ ] Backend/API task template.
- [ ] Frontend task template.
- [ ] Bug template.
- [ ] Spike template.
- [ ] QA task template.
- [ ] DevOps task template.
- [ ] Change request template.

### 24.4 Import epics

- [ ] Import Project/Foundation epics.
- [ ] Import AUTH epics.
- [ ] Import HR epics.
- [ ] Import ATT epics.
- [ ] Import LEAVE epics.
- [ ] Import TASK epics.
- [ ] Import NOTI epics.
- [ ] Import DASH epics.
- [ ] Import QA/DevOps/Release epics.

### 24.5 Import backlog seed

- [ ] Import Sprint 0 tickets.
- [ ] Import Sprint 1 tickets.
- [ ] Import P0 tickets cho Sprint 2/3 ở trạng thái Backlog.
- [ ] Gắn dependency cơ bản.
- [ ] Gắn source docs.
- [ ] Gắn priority.
- [ ] Gắn module/layer.
- [ ] Gắn estimate sau refinement.

### 24.6 Board validation

- [ ] Lọc được ticket theo module.
- [ ] Lọc được ticket theo sprint.
- [ ] Lọc được ticket theo priority.
- [ ] Lọc được blocker/critical bug.
- [ ] Nhìn được release readiness P0/P1.
- [ ] Mỗi ticket Ready đều đủ DoR.
- [ ] Mỗi ticket Done đều có DoD.

---

## 25. Sign-off

| Vai trò | Người duyệt | Trạng thái | Ngày duyệt | Ghi chú |
| --- | --- | --- | --- | --- |
| Product Owner |  | [ ] Pending / [ ] Approved / [ ] Rejected |  |  |
| Project Manager / Scrum Master |  | [ ] Pending / [ ] Approved / [ ] Rejected |  |  |
| Tech Lead Backend |  | [ ] Pending / [ ] Approved / [ ] Rejected |  |  |
| Tech Lead Frontend |  | [ ] Pending / [ ] Approved / [ ] Rejected |  |  |
| QA Lead |  | [ ] Pending / [ ] Approved / [ ] Rejected |  |  |
| DevOps Lead |  | [ ] Pending / [ ] Approved / [ ] Rejected |  |  |
| Business Representative |  | [ ] Pending / [ ] Approved / [ ] Rejected |  |  |

---

## 26. Kết luận

`ISSUE-BOARD-01` là tài liệu chuyển MVP từ trạng thái **đã có tài liệu** sang trạng thái **có thể quản lý bằng ticket và Sprint thực tế**.

Sau khi hoàn thành tài liệu này, bước tiếp theo là:

```text
SPRINT-00: Repository, Environment & Bootstrap Execution
```

Hoặc nếu chưa tạo board thực tế trên công cụ quản lý việc:

```text
Tạo board thật -> import labels/templates/epics/backlog -> refinement Sprint 0 -> bắt đầu Sprint 0.
```
