# IMPLEMENTATION-03: SPRINT 0 EXECUTION PLAN & ISSUE BOARD SETUP
# KẾ HOẠCH THỰC THI SPRINT 0 & THIẾT LẬP ISSUE BOARD

> **Quan hệ:** Cấu trúc board (columns/label/template/DoR-DoD/backlog seed) lấy theo [ISSUE-BOARD-01](../ISSUE-BOARD/ISSUE-BOARD-01_MVP_Ticket_Board_Setup.md); tài liệu này tập trung vào quy trình thực thi Sprint 0. Sprint numbering: Sprint 0–6 theo bộ IMPLEMENTATION.

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | IMPLEMENTATION-03 |
| Tên tài liệu | Sprint 0 Execution Plan & Issue Board Setup |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | MVP Implementation |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-10, DEVOPS-01 -> DEVOPS-12, IMPLEMENTATION-01, IMPLEMENTATION-02 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

Tài liệu IMPLEMENTATION-03 mô tả cách **khởi động thực thi Sprint 0** cho dự án Enterprise Management System.

Sprint 0 không nhằm xây xong chức năng nghiệp vụ cho người dùng cuối. Sprint 0 là sprint nền tảng để biến roadmap và backlog đã phân rã thành một hệ thống vận hành phát triển rõ ràng, có issue board, quy ước issue, quy ước nhánh, tiêu chí sẵn sàng, tiêu chí hoàn thành, môi trường làm việc, checklist kỹ thuật và cơ chế kiểm soát tiến độ.

Tài liệu này dùng để:

1. Chốt mục tiêu và phạm vi Sprint 0.
2. Thiết lập issue board cho toàn bộ MVP.
3. Chuẩn hóa label, milestone, epic, story, task, bug và spike.
4. Chuẩn hóa workflow từ backlog -> refinement -> development -> review -> QA -> done.
5. Xác định danh sách việc cần hoàn thành trong Sprint 0.
6. Xác định tiêu chí sign-off để chuyển sang Sprint 1.
7. Làm cầu nối giữa Product, Tech Lead, Backend, Frontend, QA, DevOps và UI/UX.
8. Giảm rủi ro triển khai sai thứ tự, thiếu dependency hoặc thiếu tiêu chí nghiệm thu.

---

## 3. Vị trí của IMPLEMENTATION-03 trong chuỗi triển khai

Chuỗi tài liệu triển khai được đề xuất:

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

IMPLEMENTATION-03 nằm sau khi đã có roadmap và backlog tổng thể. Mục tiêu là chuẩn bị đủ nền để đội phát triển bắt đầu Sprint 1 một cách có kiểm soát.

```text
Roadmap đã rõ
-> Epic/backlog đã phân rã
-> Sprint 0 setup board + workflow + readiness
-> Sprint 1 bắt đầu implement foundation
```

---

## 4. Căn cứ triển khai

Sprint 0 phải bám theo các quyết định đã chốt trong toàn bộ bộ tài liệu dự án:

1. MVP gồm các module lõi: AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI.
2. AUTH/RBAC là nền tảng bắt buộc trước các module nghiệp vụ.
3. HR là nguồn dữ liệu nhân sự trung tâm cho ATT, LEAVE, TASK, DASH và NOTI.
4. ATT và LEAVE có dependency chặt vì nghỉ phép approved ảnh hưởng bảng công.
5. TASK liên kết HR, NOTI, DASH và có thể cảnh báo lịch nghỉ.
6. DASH chỉ tổng hợp, hiển thị và điều hướng, không xử lý nghiệp vụ gốc.
7. NOTI ưu tiên in-app notification trong MVP.
8. Backend là lớp kiểm tra quyền cuối cùng, frontend chỉ hỗ trợ UX bằng route guard, hide, disable hoặc masked field.
9. API dùng chuẩn `/api/v1`, response/error/pagination thống nhất.
10. Database dùng PostgreSQL, UUID primary key, multi-tenant ready bằng `company_id`, audit log và soft delete.
11. Frontend dùng Home Portal -> Module Workspace -> App Switcher.
12. QA cần kiểm thử theo module, permission, data scope, API contract, E2E, security và performance.
13. DevOps cần chuẩn hóa repository, CI/CD, Docker, env, secrets, migration, staging, monitoring, backup và release.
14. Tất cả issue triển khai phải trace được về epic, module, layer, tài liệu nguồn và acceptance criteria.

---

## 5. Định nghĩa Sprint 0

### 5.1 Sprint 0 là gì?

Sprint 0 là sprint chuẩn bị trước khi implement chức năng nghiệp vụ chính.

Sprint 0 tập trung vào:

1. Thiết lập quy trình làm việc.
2. Thiết lập issue board.
3. Tạo milestone và epic.
4. Chuẩn hóa template issue/PR/review.
5. Chuẩn hóa Definition of Ready và Definition of Done.
6. Thiết lập repository, branch, environment và CI baseline.
7. Chuẩn bị mock data, seed data, API contract baseline và UI handoff link.
8. Chốt danh sách open question quan trọng trước Sprint 1.

### 5.2 Sprint 0 không phải là gì?

Sprint 0 không phải sprint để:

1. Hoàn thiện toàn bộ AUTH/HR/ATT/LEAVE/TASK.
2. Viết toàn bộ API production-ready.
3. Dựng toàn bộ UI high-fidelity mới.
4. Kiểm thử UAT với người dùng cuối.
5. Go-live production.
6. Thay thế tài liệu SPEC/API/DB/UI/QA/DevOps đã có.

### 5.3 Thời lượng đề xuất

| Yếu tố | Đề xuất |
| --- | --- |
| Thời lượng | 1 tuần làm việc |
| Số ngày | 5 ngày |
| Nhịp họp | Daily sync 15 phút |
| Review cuối sprint | Sprint 0 Review + Readiness Sign-off |
| Output chính | Board sẵn sàng, repo sẵn sàng, backlog Sprint 1 ready, workflow rõ |

Nếu team nhỏ hoặc chưa có repository/CI/CD, Sprint 0 có thể kéo dài 7-10 ngày làm việc. Tuy nhiên không nên biến Sprint 0 thành một sprint nghiên cứu quá dài.

---

## 6. Mục tiêu Sprint 0

### 6.1 Mục tiêu tổng quát

Kết thúc Sprint 0, đội dự án phải có thể bắt đầu Sprint 1 với trạng thái:

```text
Backlog rõ
Issue board hoạt động
Repository sẵn sàng
Môi trường dev chạy được
CI baseline chạy được
Definition of Ready rõ
Definition of Done rõ
Issue template thống nhất
Open questions P0 được chốt hoặc có owner/deadline
```

### 6.2 Mục tiêu chi tiết

| Nhóm | Mục tiêu |
| --- | --- |
| Product | Backlog MVP được đưa vào issue board, có epic/story/task rõ |
| Engineering | Repository, branch strategy, PR workflow và coding convention sẵn sàng |
| Backend | Skeleton backend, env, health check, migration baseline và API convention sẵn sàng |
| Frontend | Skeleton frontend, app shell, routing shell, design token baseline và mock API strategy sẵn sàng |
| QA | Test strategy được chuyển thành issue/checklist, test management convention sẵn sàng |
| DevOps | CI baseline, Docker baseline, env strategy, secret convention và staging plan rõ |
| UI/UX | Handoff link, screen inventory, component mapping và open question được gắn vào board |
| Security | Permission/data scope/security checklist được đưa vào DoD và issue template |

---

## 7. Output bắt buộc của Sprint 0

| Mã | Output | Bắt buộc | Owner chính |
| --- | --- | --- | --- |
| IMP03-OUT-001 | Issue board MVP được tạo | Có | Product Owner / Project Manager |
| IMP03-OUT-002 | Epic/Milestone MVP được tạo | Có | Product Owner |
| IMP03-OUT-003 | Label taxonomy được tạo | Có | Project Manager |
| IMP03-OUT-004 | Issue templates được tạo | Có | Project Manager + Tech Lead |
| IMP03-OUT-005 | Definition of Ready được chốt | Có | Product Owner + Tech Lead + QA Lead |
| IMP03-OUT-006 | Definition of Done được chốt | Có | Tech Lead + QA Lead |
| IMP03-OUT-007 | Sprint 1 backlog ready | Có | Product Owner + Tech Lead |
| IMP03-OUT-008 | Repository structure baseline | Có | Tech Lead |
| IMP03-OUT-009 | Branching + PR convention | Có | Tech Lead |
| IMP03-OUT-010 | CI baseline chạy được | Có | DevOps |
| IMP03-OUT-011 | Local development guide | Có | Backend Lead + Frontend Lead |
| IMP03-OUT-012 | Environment variable convention | Có | DevOps |
| IMP03-OUT-013 | Mock/API contract strategy | Có | Backend Lead + Frontend Lead |
| IMP03-OUT-014 | QA test issue convention | Có | QA Lead |
| IMP03-OUT-015 | Sprint 0 review note + sign-off | Có | Project Manager |

---

## 8. Nguyên tắc vận hành issue board

### 8.1 Board name đề xuất

```text
EMS MVP Delivery Board
```

Tên thay thế nếu dùng theo môi trường hoặc team:

```text
Enterprise Management System - MVP Board
EMS Internal Platform - MVP Execution
EMS Product Delivery - MVP v1.0
```

### 8.2 Công cụ có thể dùng

| Công cụ | Phù hợp khi | Ghi chú |
| --- | --- | --- |
| GitHub Projects | Team code trên GitHub, muốn issue gắn trực tiếp repo/PR | Đề xuất nếu dự án dùng GitHub |
| Jira | Team cần Scrum board, release/version, workflow phức tạp | Phù hợp team trung bình/lớn |
| Linear | Team nhỏ, muốn workflow nhẹ và nhanh | Phù hợp startup/product team |
| GitLab Issues | Team code trên GitLab | Tích hợp CI/CD GitLab tốt |
| Azure Boards | Team dùng Azure DevOps | Phù hợp enterprise Microsoft stack |

Tài liệu này dùng cách mô tả trung lập. Nếu dùng GitHub Projects, các field ở mục 10 có thể tạo thành custom fields.

### 8.3 Nguyên tắc một issue tốt

Một issue được xem là tốt khi có:

1. Tiêu đề rõ module/layer/action.
2. Epic hoặc parent rõ.
3. Module rõ.
4. Layer rõ: Backend, Frontend, Database, API, QA, DevOps, UI/UX, Docs.
5. Priority rõ.
6. Acceptance criteria rõ.
7. Dependency rõ nếu có.
8. Tài liệu nguồn rõ.
9. Definition of Ready đạt trước khi vào Sprint Backlog.
10. Definition of Done đạt trước khi đóng Done.

---

## 9. Workflow board đề xuất

### 9.1 Column chính

| Thứ tự | Column | Ý nghĩa | Ai kéo issue vào |
| ---: | --- | --- | --- |
| 1 | Inbox | Nơi tiếp nhận issue mới/chưa phân loại | Bất kỳ thành viên nào |
| 2 | Backlog | Issue đã hợp lệ nhưng chưa sẵn sàng làm | Product Owner / PM |
| 3 | Refinement | Issue đang được làm rõ requirement, scope, AC, dependency | PO + Tech Lead + QA |
| 4 | Ready for Sprint | Issue đạt Definition of Ready, có thể đưa vào sprint | PO / Tech Lead |
| 5 | Sprint Backlog | Issue được chọn cho sprint hiện tại | PM / Scrum Master |
| 6 | In Progress | Đang triển khai | Assignee |
| 7 | In Review | Đã có PR hoặc output chờ review | Assignee / Reviewer |
| 8 | QA Ready | Đã merge/dev deploy, sẵn sàng QA | Dev / QA |
| 9 | QA Testing | QA đang kiểm thử | QA |
| 10 | Blocked | Bị chặn bởi dependency/quyết định/lỗi môi trường | Assignee |
| 11 | Done | Hoàn thành theo DoD | QA / PM |
| 12 | Deferred / Cancelled | Tạm hoãn hoặc hủy khỏi MVP | PO / PM |

### 9.2 WIP limit đề xuất

| Column | WIP limit | Lý do |
| --- | ---: | --- |
| Refinement | 10 | Tránh refine quá nhiều mà không làm |
| In Progress | 1-2 issue/người | Giảm context switching |
| In Review | 8 | Review không để dồn |
| QA Testing | 8 | QA không quá tải |
| Blocked | Không giới hạn, nhưng review hằng ngày | Phải xử lý blocker nhanh |

### 9.3 Quy tắc di chuyển issue

| Từ | Sang | Điều kiện |
| --- | --- | --- |
| Inbox | Backlog | Có title, mô tả ngắn, module/layer sơ bộ |
| Backlog | Refinement | PO/Tech/QA cần làm rõ để chuẩn bị sprint |
| Refinement | Ready for Sprint | Đạt Definition of Ready |
| Ready for Sprint | Sprint Backlog | Được chọn vào sprint hiện tại |
| Sprint Backlog | In Progress | Có assignee và branch/plan rõ |
| In Progress | In Review | Có PR/output review được |
| In Review | QA Ready | Review đạt, merge/deploy hoặc artifact sẵn sàng |
| QA Ready | QA Testing | QA bắt đầu test |
| QA Testing | Done | Đạt Definition of Done |
| Bất kỳ | Blocked | Có blocker rõ và owner xử lý |
| Blocked | Trạng thái trước đó | Blocker đã được gỡ |
| Bất kỳ | Deferred/Cancelled | PO xác nhận không còn làm trong scope hiện tại |

---

## 10. Custom fields cho issue board

### 10.1 Field bắt buộc

| Field | Kiểu | Giá trị đề xuất |
| --- | --- | --- |
| Type | Single select | Epic, Story, Task, Bug, Spike, Chore, Test, Docs |
| Module | Single select | AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI, FOUNDATION, CROSS, DEVOPS, QA, UIUX |
| Layer | Single select | Product, UI/UX, Frontend, Backend, Database, API, QA, DevOps, Security, Docs |
| Priority | Single select | P0, P1, P2, P3 |
| Sprint | Iteration | Sprint 0, Sprint 1, Sprint 2, ... |
| Milestone | Single select | MVP Foundation, MVP Daily Ops, MVP Manager/HR Ops, MVP Admin/System, MVP Hardening, MVP Release |
| Epic | Text/Relation | Epic code hoặc parent issue |
| Status | Board status | Theo column |
| Assignee | User | Người chịu trách nhiệm chính |
| Reviewer | User | Người review chính |
| QA Required | Boolean | Có/Không |
| Source Doc | Text | PRD/SPEC/API/DB/UI/QA/DEVOPS/IMPLEMENTATION |

### 10.2 Field khuyến nghị

| Field | Kiểu | Giá trị đề xuất |
| --- | --- | --- |
| Story Points | Number | 1, 2, 3, 5, 8, 13 |
| Risk Level | Single select | Low, Medium, High, Critical |
| Security Impact | Boolean | Có/Không |
| Data Scope Impact | Boolean | Có/Không |
| API Contract Impact | Boolean | Có/Không |
| DB Migration Impact | Boolean | Có/Không |
| Feature Flag | Text | Nếu cần bật/tắt chức năng |
| Blocked Reason | Text | Lý do bị block |
| Target Release | Single select | MVP v1.0, Phase 2, Phase 3 |
| Test Coverage | Single select | Unit, Integration, E2E, Manual, None |

---

## 11. Label taxonomy

### 11.1 Label theo loại issue

| Label | Ý nghĩa |
| --- | --- |
| `type:epic` | Epic lớn, chứa nhiều story/task |
| `type:story` | User story hoặc business story |
| `type:task` | Task kỹ thuật cụ thể |
| `type:bug` | Lỗi cần sửa |
| `type:spike` | Nghiên cứu / làm rõ kỹ thuật |
| `type:chore` | Việc vận hành, setup, refactor nhỏ |
| `type:test` | Test case/test automation/test plan |
| `type:docs` | Tài liệu hoặc cập nhật docs |

### 11.2 Label theo module

| Label | Module |
| --- | --- |
| `module:auth` | AUTH |
| `module:hr` | HR |
| `module:attendance` | ATT |
| `module:leave` | LEAVE |
| `module:task` | TASK |
| `module:dashboard` | DASH |
| `module:notification` | NOTI |
| `module:foundation` | FOUNDATION |
| `module:cross` | Cross-module |
| `module:devops` | DevOps |
| `module:qa` | QA |
| `module:uiux` | UI/UX |

### 11.3 Label theo layer

| Label | Layer |
| --- | --- |
| `layer:frontend` | Frontend |
| `layer:backend` | Backend |
| `layer:database` | Database |
| `layer:api` | API contract/OpenAPI |
| `layer:qa` | QA/Test |
| `layer:devops` | DevOps/CI/CD/Infra |
| `layer:security` | Security |
| `layer:docs` | Documentation |
| `layer:product` | Product/Requirement |
| `layer:uiux` | UI/UX |

### 11.4 Label theo priority

| Label | Ý nghĩa |
| --- | --- |
| `priority:p0` | Bắt buộc cho MVP / blocker |
| `priority:p1` | Rất quan trọng, nên có trong MVP |
| `priority:p2` | Quan trọng nhưng có thể giảm scope |
| `priority:p3` | Nice-to-have / phase sau |

### 11.5 Label theo trạng thái đặc biệt

| Label | Ý nghĩa |
| --- | --- |
| `status:blocked` | Bị chặn |
| `status:needs-refinement` | Cần làm rõ |
| `status:needs-design` | Cần UI/UX |
| `status:needs-api` | Cần API contract |
| `status:needs-db` | Cần DB migration/schema |
| `status:needs-qa` | Cần QA review |
| `status:ready` | Đã sẵn sàng làm |
| `status:deferred` | Tạm hoãn |

### 11.6 Label theo rủi ro

| Label | Ý nghĩa |
| --- | --- |
| `risk:security` | Có tác động bảo mật |
| `risk:permission` | Có tác động phân quyền/data scope |
| `risk:performance` | Có tác động hiệu năng |
| `risk:migration` | Có migration DB |
| `risk:breaking-change` | Có khả năng phá contract hiện có |
| `risk:external-dependency` | Phụ thuộc hệ thống/dịch vụ ngoài |

---

## 12. Milestone đề xuất

| Milestone | Mục tiêu | Module chính |
| --- | --- | --- |
| `M0 - Sprint 0 Setup` | Board, repo, workflow, CI baseline, Sprint 1 ready | CROSS |
| `M1 - MVP Foundation` | Foundation DB, AUTH/RBAC, HR core, audit/file/settings nền | AUTH, HR, FOUNDATION |
| `M2 - MVP Daily Operations` | Employee daily flows: check-in, leave request, my tasks, notification shell | ATT, LEAVE, TASK, NOTI |
| `M3 - MVP Manager & HR Operations` | Duyệt nghỉ, duyệt điều chỉnh công, team records, HR workflows | HR, ATT, LEAVE, TASK |
| `M4 - MVP Admin & System` | User/role/permission, settings, notification template, dashboard config | AUTH, FOUNDATION, NOTI, DASH |
| `M5 - MVP Hardening & UAT` | Regression, security, performance, UAT, bugfix | QA, SECURITY, DEVOPS |
| `M6 - MVP Release` | Release readiness, deployment, monitoring, rollback, go-live | DEVOPS, QA, PRODUCT |

---

## 13. Epic structure MVP

### 13.1 Epic cấp cao

| Epic code | Tên epic | Module | Milestone |
| --- | --- | --- | --- |
| EPIC-000 | Sprint 0 Setup & Delivery Workflow | CROSS | M0 |
| EPIC-001 | Foundation Platform & Shared Infrastructure | FOUNDATION | M1 |
| EPIC-002 | Auth, Session, RBAC & Permission Guard | AUTH | M1 |
| EPIC-003 | HR Core & Employee Profile Management | HR | M1/M3 |
| EPIC-004 | Attendance Core & Adjustment Workflow | ATT | M2/M3 |
| EPIC-005 | Leave Core, Balance & Approval Workflow | LEAVE | M2/M3 |
| EPIC-006 | Task & Project Core Workflow | TASK | M2/M3 |
| EPIC-007 | Notification In-app System | NOTI | M2/M4 |
| EPIC-008 | Dashboard & Widget Summary | DASH | M2/M4 |
| EPIC-009 | Frontend App Shell & Design System | FRONTEND | M1/M2 |
| EPIC-010 | API Contract & OpenAPI Documentation | API | M1/M4 |
| EPIC-011 | QA Automation, Regression & Release Quality | QA | M0/M5 |
| EPIC-012 | DevOps, Environments, CI/CD & Release | DEVOPS | M0/M6 |
| EPIC-013 | Security, Audit & Runtime Protection | SECURITY | M1/M5 |

### 13.2 Quy tắc tạo epic

Mỗi epic cần có:

1. Mục tiêu.
2. Phạm vi bao gồm.
3. Phạm vi không bao gồm.
4. User/business outcome.
5. Module/layer liên quan.
6. Dependency.
7. Danh sách story/task con.
8. Acceptance criteria cấp epic.
9. Definition of Done cấp epic.
10. Link tài liệu nguồn.

---

## 14. Quy ước đặt tên issue

### 14.1 Format title

```text
[MODULE][LAYER] Hành động / kết quả cần làm
```

Ví dụ:

```text
[AUTH][BE] Implement login API with session/token flow
[HR][FE] Build employee list page with permission-aware actions
[ATT][QA] Write E2E test for check-in blocked by approved leave
[DEVOPS][CI] Add lint/typecheck/test pipeline for frontend and backend
[CROSS][DOCS] Create issue templates and Definition of Done
```

### 14.2 Format issue code nội bộ

Nếu công cụ không có key tự động như Jira, có thể dùng mã nội bộ trong title hoặc custom field:

```text
IMP03-TASK-001
BE-AUTH-001
FE-HR-001
QA-ATT-001
DEVOPS-CI-001
```

### 14.3 Quy tắc viết title

Không nên:

```text
Làm login
Fix HR
Setup
Task page
```

Nên:

```text
[AUTH][BE] Implement login endpoint with refresh token support
[HR][BE] Add employee list API with search, filter, pagination and data scope
[TASK][FE] Build my task list with status filter and due date badge
```

---

## 15. Issue template

### 15.1 Epic template

```md
## Mục tiêu

Mô tả outcome của epic.

## Phạm vi bao gồm

- [ ] ...

## Không bao gồm

- ...

## Module / Layer

- Module:
- Layer:

## Tài liệu nguồn

- PRD/SPEC:
- DB:
- API:
- UI/UX:
- Frontend/Backend/QA/DevOps:

## Dependency

- ...

## Story / Task con

- [ ] ...

## Acceptance criteria

- [ ] ...

## Definition of Done

- [ ] Tất cả story/task con Done
- [ ] Không còn P0/P1 bug mở
- [ ] QA sign-off nếu có impact nghiệp vụ
- [ ] Docs/OpenAPI/changelog cập nhật nếu cần
```

### 15.2 Story template

```md
## User story

Là [actor], tôi muốn [khả năng] để [giá trị].

## Business context

Mô tả nghiệp vụ và lý do cần làm.

## Scope

- [ ] ...

## Out of scope

- ...

## Acceptance criteria

- [ ] Given ... When ... Then ...
- [ ] ...

## Permission / data scope

- Required permission:
- Data scope:
- Field masking:

## API / DB / UI mapping

- API:
- DB:
- UI screen:
- Component:

## Test notes

- Unit:
- Integration:
- E2E:
- Manual QA:

## Dependency / Blocker

- ...
```

### 15.3 Task template

```md
## Mục tiêu

Mô tả task kỹ thuật cần hoàn thành.

## Checklist

- [ ] ...

## Output mong muốn

- ...

## Acceptance criteria

- [ ] ...

## Test / Verify

- [ ] Lệnh kiểm tra:
- [ ] Evidence:

## Tài liệu nguồn

- ...
```

### 15.4 Bug template

```md
## Mô tả lỗi

Mô tả ngắn gọn lỗi.

## Môi trường

- Environment:
- Browser/device:
- User/role:
- Build version:

## Bước tái hiện

1. ...
2. ...

## Kết quả hiện tại

...

## Kết quả mong muốn

...

## Impact

- Module:
- Priority:
- Security/data impact:

## Evidence

- Screenshot/log/request id:

## Acceptance criteria

- [ ] Lỗi không còn tái hiện
- [ ] Có test/regression nếu phù hợp
```

### 15.5 Spike template

```md
## Câu hỏi cần trả lời

...

## Bối cảnh

...

## Phạm vi nghiên cứu

- [ ] ...

## Output bắt buộc

- [ ] Kết luận đề xuất
- [ ] Option đã so sánh
- [ ] Rủi ro
- [ ] Quyết định cần chốt
- [ ] Task follow-up nếu có

## Timebox

- Tối đa: ... giờ/ngày
```

---

## 16. Pull request template đề xuất

```md
## Mục tiêu PR

...

## Issue liên quan

Closes #...

## Thay đổi chính

- ...

## Loại thay đổi

- [ ] Feature
- [ ] Bugfix
- [ ] Refactor
- [ ] Test
- [ ] Docs
- [ ] Chore

## Checklist

- [ ] Code build được
- [ ] Lint/typecheck pass
- [ ] Test liên quan pass
- [ ] Không hard-code secret
- [ ] Không hard-code role nếu liên quan permission
- [ ] API error state được xử lý nếu có
- [ ] Loading/empty/error/forbidden state được xử lý nếu là UI
- [ ] Migration rollback hoặc note rollback nếu có DB change
- [ ] OpenAPI/docs cập nhật nếu API thay đổi
- [ ] Screenshot/evidence đính kèm nếu là UI

## QA notes

...

## Risk / rollback

...
```

---

## 17. Definition of Ready

Một issue chỉ được đưa vào `Ready for Sprint` khi đạt các điều kiện sau.

### 17.1 DoR cho story nghiệp vụ

| Điều kiện | Bắt buộc |
| --- | --- |
| Có user story hoặc business goal rõ | Có |
| Có acceptance criteria rõ | Có |
| Có module/layer/priority | Có |
| Có dependency đã xác định | Có |
| Có permission/data scope nếu liên quan | Có |
| Có API/DB/UI mapping sơ bộ nếu liên quan | Có |
| Có test note sơ bộ | Có |
| Không còn câu hỏi P0 chưa có owner | Có |

### 17.2 DoR cho task kỹ thuật

| Điều kiện | Bắt buộc |
| --- | --- |
| Output kỹ thuật rõ | Có |
| Có checklist công việc | Có |
| Có tiêu chí nghiệm thu | Có |
| Có cách verify | Có |
| Có dependency rõ | Có |
| Có owner/reviewer | Có |

### 17.3 DoR cho bug

| Điều kiện | Bắt buộc |
| --- | --- |
| Có bước tái hiện hoặc evidence | Có |
| Có expected vs actual | Có |
| Có môi trường xảy ra lỗi | Có |
| Có priority/impact | Có |
| Có module/layer | Có |

---

## 18. Definition of Done

Một issue chỉ được đóng `Done` khi đạt các điều kiện sau.

### 18.1 DoD chung

| Điều kiện | Bắt buộc |
| --- | --- |
| Acceptance criteria đạt | Có |
| Code/output đã được review | Có |
| Lint/typecheck/test liên quan pass | Có |
| Không còn blocker mở | Có |
| QA pass nếu issue có QA Required | Có |
| Docs/OpenAPI/changelog cập nhật nếu có thay đổi contract | Có |
| Không làm lộ dữ liệu nhạy cảm | Có |
| Không hard-code role/permission sai nguyên tắc | Có |
| Evidence được đính kèm nếu cần | Có |

### 18.2 DoD cho Backend/API

- [ ] Controller/route/service/repository có cấu trúc đúng convention.
- [ ] Authentication guard có áp dụng nếu API private.
- [ ] Permission/data scope guard có áp dụng nếu liên quan dữ liệu.
- [ ] Validation DTO/schema rõ.
- [ ] Error response đúng contract.
- [ ] Audit log có nếu nghiệp vụ yêu cầu.
- [ ] Notification event phát nếu nghiệp vụ yêu cầu.
- [ ] Idempotency key có nếu thao tác quan trọng/dễ retry.
- [ ] Unit/integration test pass.
- [ ] OpenAPI/Swagger cập nhật nếu endpoint public thay đổi.

### 18.3 DoD cho Frontend

- [ ] UI đúng layout/component convention.
- [ ] Có loading/empty/error/forbidden/disabled state nếu phù hợp.
- [ ] Không hard-code role.
- [ ] Action hiển thị theo permission/allowed_actions.
- [ ] Form có validation và không mất dữ liệu khi lỗi.
- [ ] API error được map đúng UI state.
- [ ] Responsive P0 không vỡ.
- [ ] Accessibility cơ bản đạt: keyboard, focus, aria-label.
- [ ] Component test hoặc interaction test nếu phù hợp.

### 18.4 DoD cho Database/Migration

- [ ] Migration chạy được từ database trống.
- [ ] Migration idempotent theo convention tool nếu có.
- [ ] FK/unique/check constraint đúng.
- [ ] Index quan trọng có theo query pattern.
- [ ] Soft delete/audit columns đúng nếu yêu cầu.
- [ ] Seed data không tạo trùng khi chạy lại.
- [ ] Rollback hoặc recovery note rõ.

### 18.5 DoD cho QA

- [ ] Test case được viết hoặc cập nhật.
- [ ] Regression impact được đánh giá.
- [ ] Permission/data scope test có nếu liên quan.
- [ ] Evidence test được lưu.
- [ ] Bug phát hiện đã được tạo issue và liên kết.

---

## 19. Sprint 0 timeline đề xuất

### 19.1 Tổng quan 5 ngày

| Ngày | Trọng tâm | Output chính |
| --- | --- | --- |
| Day 1 | Kickoff + Board setup | Board, columns, labels, milestones |
| Day 2 | Issue templates + backlog import | Epic/story/task template, MVP epic imported |
| Day 3 | Repo + branch + CI baseline | Repository ready, PR template, CI baseline |
| Day 4 | Environment + QA + DevOps readiness | Local guide, env convention, QA checklist |
| Day 5 | Sprint 1 readiness review | Sprint 1 backlog ready, sign-off Sprint 0 |

### 19.2 Day 1 - Kickoff & board foundation

| Mục | Công việc | Owner | Output |
| --- | --- | --- | --- |
| D1-01 | Sprint 0 kickoff | PM | Biên bản kickoff |
| D1-02 | Chốt công cụ quản lý issue | PM + Tech Lead | GitHub/Jira/Linear decision |
| D1-03 | Tạo MVP board | PM | Board hoạt động |
| D1-04 | Tạo columns workflow | PM | Column theo mục 9 |
| D1-05 | Tạo custom fields | PM | Field theo mục 10 |
| D1-06 | Tạo label taxonomy | PM | Label theo mục 11 |
| D1-07 | Tạo milestone | PO | Milestone theo mục 12 |
| D1-08 | Chốt nguyên tắc daily/update | PM | Working agreement |

### 19.3 Day 2 - Backlog import & issue templates

| Mục | Công việc | Owner | Output |
| --- | --- | --- | --- |
| D2-01 | Tạo epic cấp cao | PO | EPIC-000 -> EPIC-013 |
| D2-02 | Import backlog Sprint 1 candidates | PO + Tech Lead | Sprint 1 candidate list |
| D2-03 | Tạo issue templates | PM + Tech Lead | Epic/story/task/bug/spike templates |
| D2-04 | Chốt DoR/DoD | PO + Tech Lead + QA | DoR/DoD approved |
| D2-05 | Gắn source docs vào epic | PM | Traceability rõ |
| D2-06 | Review dependency map | Tech Lead | Dependency note |

### 19.4 Day 3 - Repo, branch, PR, CI baseline

| Mục | Công việc | Owner | Output |
| --- | --- | --- | --- |
| D3-01 | Tạo repository hoặc mono-repo structure | Tech Lead | Repo ready |
| D3-02 | Chốt branch strategy | Tech Lead | Branching doc |
| D3-03 | Tạo PR template | Tech Lead | PR template |
| D3-04 | Tạo CODEOWNERS nếu dùng GitHub/GitLab | Tech Lead | Review ownership |
| D3-05 | Setup lint/typecheck/test CI baseline | DevOps | CI pass |
| D3-06 | Setup Docker baseline nếu trong scope | DevOps | Docker build skeleton |
| D3-07 | Setup env example | DevOps | `.env.example` chuẩn |

### 19.5 Day 4 - Environment, QA, DevOps readiness

| Mục | Công việc | Owner | Output |
| --- | --- | --- | --- |
| D4-01 | Viết local development guide | FE/BE Lead | README dev ready |
| D4-02 | Chốt mock API strategy | FE + BE | Mock strategy note |
| D4-03 | Chốt database local strategy | BE + DevOps | DB local ready note |
| D4-04 | Tạo QA checklist Sprint 1 | QA Lead | QA checklist |
| D4-05 | Tạo test evidence convention | QA Lead | Evidence convention |
| D4-06 | Tạo security checklist issue/PR | Security/Tech Lead | Security checklist |
| D4-07 | Chốt staging/UAT sơ bộ | DevOps + QA | Env readiness note |

### 19.6 Day 5 - Sprint 1 readiness & sign-off

| Mục | Công việc | Owner | Output |
| --- | --- | --- | --- |
| D5-01 | Backlog refinement Sprint 1 | PO + Tech + QA | Sprint 1 backlog ready |
| D5-02 | Story point/estimate Sprint 1 | Team | Estimate completed |
| D5-03 | Review blocker/open question | PM | Blocker register |
| D5-04 | Sprint 0 demo/review | Team | Demo board/repo/CI |
| D5-05 | Sprint 0 retrospective nhẹ | PM | Improvement actions |
| D5-06 | Sign-off Sprint 0 | PO + Tech + QA + DevOps | Sign-off note |
| D5-07 | Publish Sprint 1 plan | PM | Sprint 1 plan |

---

## 20. Sprint 0 backlog chi tiết

### 20.1 Nhóm Product / Project Management

| Issue ID | Title | Type | Priority | Owner | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| IMP03-PM-001 | [CROSS][PM] Create EMS MVP Delivery Board | Task | P0 | PM | Board được tạo, có columns workflow, team truy cập được |
| IMP03-PM-002 | [CROSS][PM] Configure board custom fields | Task | P0 | PM | Có Type, Module, Layer, Priority, Sprint, Milestone, Epic, QA Required |
| IMP03-PM-003 | [CROSS][PM] Create label taxonomy | Task | P0 | PM | Labels theo type/module/layer/priority/status/risk được tạo |
| IMP03-PM-004 | [CROSS][PM] Create MVP milestones | Task | P0 | PO | M0-M6 được tạo và mô tả rõ |
| IMP03-PM-005 | [CROSS][PM] Create top-level epics | Task | P0 | PO | EPIC-000 đến EPIC-013 có mô tả và source docs |
| IMP03-PM-006 | [CROSS][PM] Define working agreement | Docs | P1 | PM | Có quy tắc daily, update, blocker, review, meeting |
| IMP03-PM-007 | [CROSS][PM] Publish Sprint 0 calendar | Task | P1 | PM | Lịch kickoff, daily, refinement, review được publish |

### 20.2 Nhóm Backlog / Product Refinement

| Issue ID | Title | Type | Priority | Owner | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| IMP03-PO-001 | [CROSS][PRODUCT] Map MVP backlog to epics | Task | P0 | PO | Backlog được gắn EPIC và module |
| IMP03-PO-002 | [CROSS][PRODUCT] Identify Sprint 1 candidate stories | Task | P0 | PO + Tech Lead | Danh sách candidate Sprint 1 được tạo |
| IMP03-PO-003 | [CROSS][PRODUCT] Define release scope boundaries | Docs | P1 | PO | MVP vs Phase 2 boundary rõ |
| IMP03-PO-004 | [CROSS][PRODUCT] Create open question register | Task | P0 | PO | Open questions có owner, priority, deadline |
| IMP03-PO-005 | [CROSS][PRODUCT] Review P0 user journeys | Task | P0 | PO + QA | Login, Home, check-in, leave, task, notification được xác nhận |

### 20.3 Nhóm Engineering / Repository

| Issue ID | Title | Type | Priority | Owner | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| IMP03-ENG-001 | [CROSS][ENG] Decide repo strategy | Spike | P0 | Tech Lead | Monorepo/multi-repo decision được ghi rõ |
| IMP03-ENG-002 | [CROSS][ENG] Create repository baseline | Task | P0 | Tech Lead | Repo có README, structure, license/private setting |
| IMP03-ENG-003 | [CROSS][ENG] Define branch strategy | Docs | P0 | Tech Lead | main/develop/feature/hotfix/release convention rõ |
| IMP03-ENG-004 | [CROSS][ENG] Add pull request template | Task | P0 | Tech Lead | PR template theo mục 16 tồn tại |
| IMP03-ENG-005 | [CROSS][ENG] Add issue templates | Task | P0 | PM + Tech Lead | Epic/story/task/bug/spike templates sẵn sàng |
| IMP03-ENG-006 | [CROSS][ENG] Configure CODEOWNERS/reviewers | Task | P1 | Tech Lead | Reviewer mặc định theo layer/module |
| IMP03-ENG-007 | [CROSS][ENG] Create coding convention note | Docs | P1 | Tech Lead | Naming, lint, format, commit convention rõ |

### 20.4 Nhóm Backend / Database

| Issue ID | Title | Type | Priority | Owner | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| IMP03-BE-001 | [BE][FOUNDATION] Create backend project skeleton | Task | P0 | BE Lead | Backend chạy local, có health check |
| IMP03-BE-002 | [DB][FOUNDATION] Setup local PostgreSQL strategy | Task | P0 | BE + DevOps | Docker/local DB guide có thể chạy |
| IMP03-BE-003 | [DB][FOUNDATION] Setup migration tool baseline | Task | P0 | BE Lead | Migration command chạy được trên DB trống |
| IMP03-BE-004 | [BE][API] Define API response/error base types | Task | P0 | BE Lead | Success/error/pagination contract có base implementation |
| IMP03-BE-005 | [BE][AUTH] Create auth middleware skeleton | Task | P1 | BE Lead | Middleware skeleton tồn tại, chưa cần full RBAC |
| IMP03-BE-006 | [BE][FOUNDATION] Create audit log interface skeleton | Task | P1 | BE Lead | Interface/service placeholder rõ |
| IMP03-BE-007 | [BE][DOCS] Create backend local dev README | Docs | P0 | BE Lead | Dev khác setup được backend local |

### 20.5 Nhóm Frontend

| Issue ID | Title | Type | Priority | Owner | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| IMP03-FE-001 | [FE][FOUNDATION] Create frontend project skeleton | Task | P0 | FE Lead | App chạy local |
| IMP03-FE-002 | [FE][FOUNDATION] Setup TypeScript/lint/format baseline | Task | P0 | FE Lead | lint/typecheck command pass |
| IMP03-FE-003 | [FE][FOUNDATION] Setup app providers skeleton | Task | P0 | FE Lead | Query/Auth/Theme/Toast provider skeleton |
| IMP03-FE-004 | [FE][ROUTING] Create route registry skeleton | Task | P1 | FE Lead | Route metadata type và sample routes có sẵn |
| IMP03-FE-005 | [FE][UI] Setup design token baseline | Task | P1 | FE Lead | token css/theme baseline có sẵn |
| IMP03-FE-006 | [FE][API] Define mock API strategy | Task | P0 | FE + BE | mock/API contract approach được chốt |
| IMP03-FE-007 | [FE][DOCS] Create frontend local dev README | Docs | P0 | FE Lead | Dev khác setup được frontend local |

### 20.6 Nhóm QA

| Issue ID | Title | Type | Priority | Owner | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| IMP03-QA-001 | [QA][CROSS] Define QA workflow on issue board | Task | P0 | QA Lead | QA Ready/QA Testing/Done rule rõ |
| IMP03-QA-002 | [QA][CROSS] Create test case naming convention | Docs | P0 | QA Lead | Convention theo module/flow/permission rõ |
| IMP03-QA-003 | [QA][CROSS] Create Sprint 1 test checklist | Task | P0 | QA Lead | Checklist cho foundation/auth/HR core có sẵn |
| IMP03-QA-004 | [QA][CROSS] Define bug severity and priority matrix | Docs | P0 | QA Lead | Severity/Priority rõ |
| IMP03-QA-005 | [QA][CROSS] Define evidence convention | Docs | P1 | QA Lead | Screenshot/video/log/request id convention rõ |
| IMP03-QA-006 | [QA][E2E] Create P0 E2E journey list | Task | P1 | QA Lead | Login/Home/check-in/leave/task/noti journey được liệt kê |

### 20.7 Nhóm DevOps / CI-CD

| Issue ID | Title | Type | Priority | Owner | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| IMP03-DEVOPS-001 | [DEVOPS][CI] Setup CI baseline | Task | P0 | DevOps | CI chạy lint/typecheck/test skeleton |
| IMP03-DEVOPS-002 | [DEVOPS][DOCKER] Create docker compose baseline | Task | P0 | DevOps | App/db/service skeleton chạy được local nếu cần |
| IMP03-DEVOPS-003 | [DEVOPS][ENV] Create env variable convention | Docs | P0 | DevOps | `.env.example` và naming convention rõ |
| IMP03-DEVOPS-004 | [DEVOPS][SECRETS] Define secrets handling rule | Docs | P0 | DevOps | Không commit secret, rule rõ |
| IMP03-DEVOPS-005 | [DEVOPS][DEPLOY] Define staging readiness checklist | Task | P1 | DevOps + QA | Checklist staging có sẵn |
| IMP03-DEVOPS-006 | [DEVOPS][OBS] Define logging/request id baseline | Task | P1 | DevOps + BE | Request id/log format baseline rõ |

### 20.8 Nhóm Security / Permission

| Issue ID | Title | Type | Priority | Owner | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| IMP03-SEC-001 | [SECURITY][CROSS] Add permission/data scope checklist to DoD | Task | P0 | Tech Lead + QA | DoD có checklist permission/scope |
| IMP03-SEC-002 | [SECURITY][AUTH] Define sensitive data handling baseline | Docs | P0 | Tech Lead | HR/ATT/LEAVE sensitive data note rõ |
| IMP03-SEC-003 | [SECURITY][CROSS] Define auth/token storage decision | Spike | P0 | Tech Lead | Quyết định lưu token/cookie/session rõ |
| IMP03-SEC-004 | [SECURITY][CROSS] Add security review label and process | Task | P1 | PM + Tech Lead | `risk:security` workflow rõ |

---

## 21. Sprint 1 readiness checklist

Sprint 1 chỉ nên bắt đầu khi các điều kiện sau đạt.

### 21.1 Product readiness

- [ ] Sprint 1 objective đã rõ.
- [ ] Sprint 1 backlog đã chọn.
- [ ] Tất cả issue Sprint 1 đạt Definition of Ready.
- [ ] P0 open questions đã được resolve hoặc có owner/deadline.
- [ ] Dependency giữa backend/frontend/database/QA đã được đánh dấu.
- [ ] Scope Sprint 1 không vượt capacity team.

### 21.2 Engineering readiness

- [ ] Repository sẵn sàng.
- [ ] Branch strategy sẵn sàng.
- [ ] PR template sẵn sàng.
- [ ] CI baseline chạy được.
- [ ] Local dev guide sẵn sàng.
- [ ] Backend skeleton chạy được.
- [ ] Frontend skeleton chạy được.
- [ ] Database local/migration baseline sẵn sàng.

### 21.3 QA readiness

- [ ] QA workflow trên board rõ.
- [ ] Test checklist Sprint 1 có sẵn.
- [ ] Bug template sẵn sàng.
- [ ] Severity/priority matrix rõ.
- [ ] Evidence convention rõ.
- [ ] QA biết build/môi trường nào để test.

### 21.4 DevOps readiness

- [ ] Env convention rõ.
- [ ] Secret convention rõ.
- [ ] Docker/local service guide rõ.
- [ ] CI pipeline tối thiểu pass.
- [ ] Staging readiness checklist có owner.
- [ ] Request id/logging baseline có hướng triển khai.

---

## 22. Sprint 1 backlog candidate đề xuất

Sprint 0 cần chốt candidate cho Sprint 1. Danh sách dưới đây là đề xuất ban đầu.

| Candidate | Module | Layer | Mục tiêu |
| --- | --- | --- | --- |
| S1-CAN-001 | FOUNDATION | DB/BE | Tạo migration foundation: companies, modules, settings, audit_logs baseline |
| S1-CAN-002 | AUTH | DB/BE | Tạo users, roles, permissions, user_roles, role_permissions baseline |
| S1-CAN-003 | AUTH | BE/API | Login/logout/me/refresh skeleton |
| S1-CAN-004 | HR | DB/BE | Tạo employees, departments, positions baseline |
| S1-CAN-005 | HR | BE/API | Employee list/detail API skeleton với pagination và data scope placeholder |
| S1-CAN-006 | FE | Frontend | AuthLayout, login page skeleton, protected route skeleton |
| S1-CAN-007 | FE | Frontend | HomePortalLayout + App registry mock |
| S1-CAN-008 | FE | Frontend | ModuleWorkspaceLayout skeleton |
| S1-CAN-009 | QA | QA | Test case foundation/auth/route guard baseline |
| S1-CAN-010 | DEVOPS | CI/CD | CI lint/typecheck/test + docker local hoàn thiện hơn |

Lưu ý: Sprint 1 chưa nên ôm toàn bộ nghiệp vụ ATT/LEAVE/TASK nếu nền AUTH/HR/FOUNDATION chưa ổn.

---

## 23. Dependency map Sprint 0 -> Sprint 1

```text
Issue board + DoR/DoD
  -> Sprint 1 planning

Repository + branch + PR template
  -> FE/BE development

CI baseline
  -> Safe PR merge

Database migration baseline
  -> Foundation/AUTH/HR schema

API response/error convention
  -> FE API client + BE endpoint consistency

Auth/session/token decision
  -> Login, protected route, API guard

App registry decision
  -> Home Portal + App Switcher

QA workflow
  -> Sprint 1 QA execution

Env/secrets convention
  -> Local dev + staging deploy
```

---

## 24. Branching strategy đề xuất

### 24.1 Branch chính

| Branch | Vai trò |
| --- | --- |
| `main` | Code ổn định, có thể release |
| `develop` | Tích hợp Sprint hiện tại |
| `feature/<issue-key>-short-name` | Tính năng/task mới |
| `bugfix/<issue-key>-short-name` | Sửa bug trong sprint |
| `hotfix/<issue-key>-short-name` | Sửa production khẩn cấp |
| `release/mvp-v1.0` | Chuẩn bị release MVP |

### 24.2 Quy tắc merge

1. Không push trực tiếp vào `main`.
2. Không push trực tiếp vào `develop` trừ maintainer nếu có quy định đặc biệt.
3. Mọi thay đổi qua Pull Request.
4. PR phải link issue.
5. CI phải pass trước merge.
6. Ít nhất 1 reviewer approve.
7. Thay đổi DB/API/security cần reviewer tương ứng.
8. Squash merge hoặc rebase merge theo convention team.

### 24.3 Commit convention đề xuất

```text
<type>(<scope>): <short summary>
```

Ví dụ:

```text
feat(auth): add login endpoint skeleton
chore(devops): add ci pipeline baseline
fix(leave): prevent submit when balance insufficient
```

Type đề xuất:

```text
feat, fix, docs, style, refactor, test, chore, ci, build, perf
```

---

## 25. Local development baseline

### 25.1 README local cần có

- [ ] Prerequisites: Node, package manager, Docker, database.
- [ ] Clone repository.
- [ ] Install dependencies.
- [ ] Copy `.env.example` -> `.env.local`.
- [ ] Start database.
- [ ] Run migration.
- [ ] Run seed.
- [ ] Start backend.
- [ ] Start frontend.
- [ ] Run test.
- [ ] Troubleshooting.

### 25.2 Lệnh mẫu cần chuẩn hóa

```bash
# frontend
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test

# backend
pnpm install
pnpm dev
pnpm lint
pnpm test
pnpm db:migrate
pnpm db:seed

# devops
make up
make down
make logs
```

Lệnh thực tế có thể thay đổi theo stack backend, nhưng Sprint 0 cần chốt tên lệnh chuẩn để giảm lỗi onboarding.

---

## 26. CI baseline Sprint 0

### 26.1 CI tối thiểu

| Job | Bắt buộc | Mục tiêu |
| --- | --- | --- |
| Install dependencies | Có | Đảm bảo lockfile hợp lệ |
| Lint frontend | Có | Chặn lỗi style/coding convention |
| Typecheck frontend | Có | Chặn lỗi TypeScript |
| Test frontend | Nên có | Unit/component baseline |
| Lint backend | Có | Chặn lỗi style/coding convention |
| Test backend | Nên có | Unit baseline |
| Build frontend | Nên có | Đảm bảo build không lỗi |
| Build backend | Nên có | Đảm bảo compile không lỗi |
| Docker build | Có thể sau Sprint 0 | Nên có nếu deployment dùng container |

### 26.2 Rule CI

1. CI phải chạy trên PR vào `develop` và `main`.
2. CI fail thì không merge.
3. Job nhanh chạy trước, job nặng chạy sau.
4. Cache dependency nếu công cụ hỗ trợ.
5. Không in secret ra log.
6. CI output cần dễ đọc để dev tự sửa.

---

## 27. QA workflow trong Sprint 0

### 27.1 QA tham gia từ refinement

QA không chỉ test sau khi dev xong. QA cần tham gia ở các bước:

1. Review acceptance criteria.
2. Review permission/data scope behavior.
3. Review state UI: loading, empty, error, forbidden, validation.
4. Review API contract impact.
5. Viết test checklist trước khi issue vào Sprint Backlog.
6. Tạo regression suite theo module.

### 27.2 Bug severity matrix

| Severity | Mô tả | Ví dụ |
| --- | --- | --- |
| S0 - Blocker | Không thể dùng hệ thống hoặc mất dữ liệu nghiêm trọng | Không login được toàn hệ thống, migration phá DB |
| S1 - Critical | Lỗi nghiệp vụ/bảo mật nghiêm trọng | Employee xem được dữ liệu HR nhạy cảm ngoài scope |
| S2 - Major | Lỗi ảnh hưởng chức năng chính nhưng có workaround | Không submit được đơn nghỉ với một loại nghỉ cụ thể |
| S3 - Minor | Lỗi nhỏ, không chặn flow chính | Sai label, layout lệch nhẹ |
| S4 - Trivial | Góp ý cải thiện | Copy text chưa tối ưu |

### 27.3 Priority matrix

| Priority | Ý nghĩa |
| --- | --- |
| P0 | Phải sửa ngay, chặn sprint/release |
| P1 | Sửa trong sprint hiện tại |
| P2 | Sửa trước UAT/release nếu còn capacity |
| P3 | Backlog/phase sau |

---

## 28. Open question register mẫu

| ID | Câu hỏi | Owner | Priority | Deadline | Status |
| --- | --- | --- | --- | --- | --- |
| OQ-001 | Backend stack chính thức là gì? | Tech Lead | P0 | Sprint 0 Day 2 | Open |
| OQ-002 | Repo dùng monorepo hay multi-repo? | Tech Lead | P0 | Sprint 0 Day 2 | Open |
| OQ-003 | App registry lấy từ backend hay FE config hybrid trong MVP? | FE Lead + BE Lead | P0 | Sprint 0 Day 3 | Open |
| OQ-004 | Token lưu bằng cookie httpOnly hay storage strategy nào? | Tech Lead | P0 | Sprint 0 Day 3 | Open |
| OQ-005 | Có dùng Storybook ngay trong MVP không? | FE Lead | P1 | Sprint 0 Day 4 | Open |
| OQ-006 | Staging deploy ngay từ Sprint 1 hay Sprint 2? | DevOps | P1 | Sprint 0 Day 5 | Open |
| OQ-007 | API mock dùng MSW/OpenAPI mock/custom mock? | FE + BE | P1 | Sprint 0 Day 4 | Open |
| OQ-008 | Test management dùng issue board hay công cụ riêng? | QA Lead | P1 | Sprint 0 Day 4 | Open |

---

## 29. Risk register Sprint 0

| Risk | Mức độ | Tác động | Giảm thiểu |
| --- | --- | --- | --- |
| Sprint 0 biến thành sprint nghiên cứu quá dài | Cao | Chậm bắt đầu implement | Timebox 5 ngày, mọi open question có owner/deadline |
| Backlog nhập board quá nhiều nhưng thiếu refinement | Cao | Sprint 1 nhiễu, dev không biết làm gì | Chỉ đưa issue đạt DoR vào Ready for Sprint |
| Không có DoD rõ | Cao | Issue đóng non, QA khó kiểm | Chốt DoD theo layer trong Sprint 0 |
| CI chưa chạy | Cao | Merge lỗi, khó kiểm soát chất lượng | CI baseline là output P0 |
| Không chốt token/session strategy | Cao | FE/BE auth làm lệch nhau | Spike P0 có deadline Day 3 |
| Permission/data scope bị xem nhẹ | Cao | Rủi ro bảo mật dữ liệu | Thêm checklist security/permission vào issue và PR |
| UI/API mapping không rõ | Trung bình | FE chờ BE hoặc mock sai | Chốt mock/API strategy và source doc mapping |
| DevOps/env chưa rõ | Trung bình | Dev setup local chậm | Local dev guide + env example bắt buộc |
| QA vào quá muộn | Trung bình | Bug phát hiện muộn | QA tham gia refinement và review AC |

---

## 30. Sprint 0 ceremonies

### 30.1 Kickoff

| Nội dung | Thời lượng đề xuất |
| --- | --- |
| Mục tiêu Sprint 0 | 10 phút |
| Review roadmap/backlog hiện có | 20 phút |
| Chốt công cụ board/repo | 15 phút |
| Chốt roles/responsibility | 15 phút |
| Review timeline 5 ngày | 10 phút |
| Q&A/open question | 20 phút |

### 30.2 Daily sync

Câu hỏi daily:

1. Hôm qua đã hoàn thành gì?
2. Hôm nay làm gì?
3. Có blocker nào không?
4. Issue nào cần review/refinement?
5. Open question nào cần quyết định?

### 30.3 Sprint 0 review

Demo cần có:

1. Issue board đã setup.
2. Labels/milestones/epics đã tạo.
3. Issue templates hoạt động.
4. Repository baseline.
5. CI baseline pass.
6. Local dev guide.
7. Sprint 1 backlog ready.

### 30.4 Sprint 0 retrospective

Câu hỏi retro:

1. Điều gì giúp team sẵn sàng hơn?
2. Điều gì còn gây mơ hồ?
3. Công cụ/workflow nào cần chỉnh trước Sprint 1?
4. Open question nào có nguy cơ kéo dài?
5. Action item nào cần hoàn thành trong 24-48h đầu Sprint 1?

---

## 31. RACI Sprint 0

| Công việc | PO | PM | Tech Lead | BE Lead | FE Lead | QA Lead | DevOps | UI/UX |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Chốt scope Sprint 0 | A | R | C | C | C | C | C | C |
| Tạo issue board | C | A/R | C | I | I | C | I | I |
| Tạo epic/milestone | A/R | R | C | C | C | C | I | C |
| Chốt DoR | A | R | A/R | C | C | C | I | C |
| Chốt DoD | C | R | A/R | C | C | A/R | C | C |
| Repo/branch/PR | I | C | A/R | C | C | I | C | I |
| CI baseline | I | C | A | C | C | I | R | I |
| Local dev guide | I | C | A | R | R | I | C | I |
| QA workflow | C | C | C | I | I | A/R | I | I |
| Sprint 1 readiness | A | R | A/R | C | C | C | C | C |

Ký hiệu:

```text
R = Responsible
A = Accountable
C = Consulted
I = Informed
```

---

## 32. Acceptance criteria Sprint 0

Sprint 0 được xem là đạt khi:

| Mã | Tiêu chí nghiệm thu |
| --- | --- |
| IMP03-AC-001 | Issue board MVP được tạo và team truy cập được |
| IMP03-AC-002 | Board có đầy đủ columns workflow từ Inbox đến Done/Deferred |
| IMP03-AC-003 | Board có custom fields bắt buộc: Type, Module, Layer, Priority, Sprint, Milestone, Epic, QA Required |
| IMP03-AC-004 | Label taxonomy theo type/module/layer/priority/status/risk được tạo |
| IMP03-AC-005 | Milestone M0-M6 được tạo |
| IMP03-AC-006 | Epic cấp cao EPIC-000 -> EPIC-013 được tạo hoặc nhập vào board |
| IMP03-AC-007 | Issue template cho epic/story/task/bug/spike được tạo |
| IMP03-AC-008 | PR template được tạo |
| IMP03-AC-009 | Definition of Ready được chốt và gắn vào workflow |
| IMP03-AC-010 | Definition of Done theo layer được chốt |
| IMP03-AC-011 | Repository baseline được tạo hoặc xác nhận có sẵn |
| IMP03-AC-012 | Branch strategy được chốt |
| IMP03-AC-013 | CI baseline chạy được ít nhất lint/typecheck/test skeleton |
| IMP03-AC-014 | Local development README có thể dùng để setup môi trường |
| IMP03-AC-015 | Env/secrets convention được chốt |
| IMP03-AC-016 | QA workflow, bug severity và evidence convention được chốt |
| IMP03-AC-017 | Open question register có owner/deadline |
| IMP03-AC-018 | Sprint 1 backlog candidate được chọn và đạt DoR |
| IMP03-AC-019 | Sprint 0 review được thực hiện và có sign-off note |
| IMP03-AC-020 | Không còn blocker P0 trước khi bắt đầu Sprint 1 |

---

## 33. Checklist thao tác nhanh nếu dùng GitHub Projects

### 33.1 Tạo project board

- [ ] Tạo GitHub Project tên `EMS MVP Delivery Board`.
- [ ] Chọn Table + Board view.
- [ ] Tạo field `Type`.
- [ ] Tạo field `Module`.
- [ ] Tạo field `Layer`.
- [ ] Tạo field `Priority`.
- [ ] Tạo field `Sprint` dạng Iteration.
- [ ] Tạo field `Milestone`.
- [ ] Tạo field `Epic`.
- [ ] Tạo field `QA Required`.
- [ ] Tạo field `Risk Level`.

### 33.2 Tạo labels trong repository

- [ ] Tạo labels `type:*`.
- [ ] Tạo labels `module:*`.
- [ ] Tạo labels `layer:*`.
- [ ] Tạo labels `priority:*`.
- [ ] Tạo labels `status:*`.
- [ ] Tạo labels `risk:*`.

### 33.3 Tạo templates

- [ ] `.github/ISSUE_TEMPLATE/epic.md`
- [ ] `.github/ISSUE_TEMPLATE/story.md`
- [ ] `.github/ISSUE_TEMPLATE/task.md`
- [ ] `.github/ISSUE_TEMPLATE/bug.md`
- [ ] `.github/ISSUE_TEMPLATE/spike.md`
- [ ] `.github/pull_request_template.md`
- [ ] `.github/CODEOWNERS` nếu cần

### 33.4 Tạo views

| View | Filter/Group |
| --- | --- |
| Board by Status | Group by Status |
| Backlog by Module | Group by Module |
| Sprint 0 | Filter Sprint = Sprint 0 |
| Sprint 1 Candidates | Filter Sprint = Sprint 1 hoặc label ready |
| Blockers | Filter status blocked hoặc label `status:blocked` |
| QA View | Filter QA Required = true |
| Security Review | Filter `risk:security` hoặc Security Impact = true |
| My Work | Filter assignee = @me |

---

## 34. Checklist thao tác nhanh nếu dùng Jira

### 34.1 Project setup

- [ ] Tạo Jira project `EMS MVP`.
- [ ] Issue types: Epic, Story, Task, Bug, Spike, Test.
- [ ] Workflow tương ứng mục 9.
- [ ] Components: AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI, FOUNDATION, DEVOPS, QA, UIUX.
- [ ] Versions/Releases: MVP v1.0, Phase 2.
- [ ] Sprint: Sprint 0, Sprint 1, Sprint 2...

### 34.2 Custom fields

- [ ] Module.
- [ ] Layer.
- [ ] Data Scope Impact.
- [ ] Security Impact.
- [ ] API Contract Impact.
- [ ] DB Migration Impact.
- [ ] Source Doc.
- [ ] QA Required.
- [ ] Blocked Reason.

### 34.3 Board views

- [ ] Scrum board theo sprint.
- [ ] Kanban support board cho bugs/blockers.
- [ ] Dashboard chart theo module/layer/priority.
- [ ] Filter `P0 blockers`.
- [ ] Filter `Sprint 1 Ready`.

---

## 35. Sprint 0 sign-off form

```md
# Sprint 0 Sign-off

## Thông tin

- Project:
- Sprint:
- Ngày review:
- Người tham gia:

## Output đã hoàn thành

- [ ] Issue board ready
- [ ] Labels ready
- [ ] Milestones ready
- [ ] Epics ready
- [ ] Issue templates ready
- [ ] PR template ready
- [ ] DoR approved
- [ ] DoD approved
- [ ] Repo ready
- [ ] CI baseline pass
- [ ] Local dev guide ready
- [ ] QA workflow ready
- [ ] Sprint 1 backlog ready

## Blocker còn lại

| Blocker | Owner | Deadline | Impact |
| --- | --- | --- | --- |
|  |  |  |  |

## Open questions còn lại

| Question | Owner | Deadline | Priority |
| --- | --- | --- | --- |
|  |  |  |  |

## Quyết định

- [ ] Approve chuyển sang Sprint 1
- [ ] Conditional approve, cần xử lý action item
- [ ] Không approve, cần kéo dài Sprint 0

## Người duyệt

- Product Owner:
- Tech Lead:
- QA Lead:
- DevOps:
- Project Manager:
```

---

## 36. Kết luận

IMPLEMENTATION-03 chốt cách chuyển từ kế hoạch và backlog sang vận hành triển khai thực tế.

Tư duy chính:

```text
Không bắt đầu code khi backlog còn mơ hồ
Không đóng issue nếu chưa có DoD
Không merge nếu CI/review chưa đạt
Không test muộn sau khi dev xong
Không hard-code permission theo role
Không bỏ qua traceability từ issue về tài liệu nguồn
```

Sau khi hoàn thành Sprint 0, bước tiếp theo là triển khai:

```text
IMPLEMENTATION-04: Sprint 1 Foundation, Environment & Core Infrastructure Execution Plan
```

Sprint 1 nên tập trung vào Foundation, AUTH/RBAC, HR core, frontend shell, API convention, migration baseline và QA foundation trước khi mở rộng sang ATT/LEAVE/TASK sâu hơn.
