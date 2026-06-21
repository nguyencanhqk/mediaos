# PROJECT-BASELINE-01: MVP Documentation Baseline & Freeze Checklist

> **📚 Bộ tài liệu — Hệ thống Quản lý Doanh nghiệp (Enterprise Management System)**
> **Nguồn & liên quan:** [Chỉ mục: README](../README.md) · [PRD-00](<../PRD/PRD-00 Enterprise Management System .md>) · [SPEC-01 Tổng quan](<../SPEC/SPEC-01 Tổng quan.md>) · [DECISIONS-01 Sổ Quyết định](../DECISIONS/DECISIONS-01_Open_Decisions_Lock.md) · [IMPLEMENTATION-01 Roadmap](../IMPLEMENTATION/IMPLEMENTATION-01_MVP_Implementation_Roadmap_Sprint_Plan.md) · [Kế tiếp: ISSUE-BOARD-01](../ISSUE-BOARD/ISSUE-BOARD-01_MVP_Ticket_Board_Setup.md)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | PROJECT-BASELINE-01 |
| Tên tài liệu | MVP Documentation Baseline & Freeze Checklist |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | Pre-Development / MVP Baseline Freeze |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Người viết |  |
| Người duyệt |  |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, API-10 (Permission Matrix/Audit), UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-10, DEVOPS-00 -> DEVOPS-12, IMPLEMENTATION-01 -> IMPLEMENTATION-10, DECISIONS-01, COMPLIANCE-01 |

---

## 2. Mục đích tài liệu

Tài liệu này dùng để **chốt baseline tài liệu MVP** trước khi chuyển từ giai đoạn phân tích, thiết kế và lập kế hoạch sang giai đoạn triển khai thật bằng source code, issue board, sprint execution, QA, UAT và release.

PROJECT-BASELINE-01 không tạo thêm nghiệp vụ mới. Tài liệu này có vai trò:

1. Kiểm kê toàn bộ bộ tài liệu đã có.
2. Xác định tài liệu nào là nguồn sự thật cho từng loại quyết định.
3. Chốt phạm vi MVP Version 1.0.
4. Chốt phạm vi chưa làm trong MVP và đưa sang Phase 2+.
5. Xác định các điểm phụ thuộc xuyên suốt giữa PRD, SPEC, DB, API, UI, Frontend, Backend, QA, DevOps và Implementation.
6. Phát hiện tài liệu còn thiếu, trùng lặp, mâu thuẫn hoặc cần cập nhật trước khi code.
7. Tạo checklist ký duyệt để khóa phạm vi tài liệu.
8. Làm đầu vào trực tiếp cho bước tạo issue board, sprint backlog, task assignment và coding.

Mục tiêu cuối cùng của tài liệu này là đảm bảo team không bắt đầu development trong trạng thái tài liệu mơ hồ, thiếu liên kết hoặc chưa thống nhất về phạm vi MVP.

---

## 3. Vị trí của PROJECT-BASELINE-01 trong chuỗi triển khai

Chuỗi tài liệu và triển khai của dự án được hiểu như sau:

```text
PRD / SPEC
  -> Database Design
  -> API Design
  -> UI/UX Design
  -> Frontend Design / Frontend Implementation Plan
  -> Backend Implementation Plan
  -> QA Plan
  -> DevOps Plan
  -> Implementation Roadmap
  -> PROJECT-BASELINE-01: Documentation Baseline & Freeze
  -> Issue Board Setup
  -> Sprint 0 / Sprint 1 Coding
  -> QA / UAT / Release Candidate
  -> Go-live
```

PROJECT-BASELINE-01 là điểm chặn trước khi tạo ticket và code thật. Nếu tài liệu này chưa được chốt, team chỉ nên tiếp tục rà soát tài liệu, không nên bắt đầu phát triển tính năng nghiệp vụ phức tạp.

---

## 4. Nguyên tắc baseline

### 4.1 Không mở rộng phạm vi khi freeze

Baseline không phải là lúc thêm module mới, thêm flow mới hoặc đổi định hướng lớn. Nếu phát hiện ý tưởng mới, cần ghi vào **Post-MVP / Phase 2 Backlog** thay vì đưa ngay vào MVP.

### 4.2 Tài liệu phải có nguồn sự thật rõ ràng

Mỗi nhóm quyết định cần có tài liệu nguồn chính:

| Loại quyết định | Nguồn sự thật chính | Ghi chú |
| --- | --- | --- |
| Mục tiêu sản phẩm, nhóm user, phạm vi MVP | PRD-00 | Không dùng UI hoặc Implementation để tự mở rộng scope sản phẩm |
| Nghiệp vụ module, rule, trạng thái, quyền nghiệp vụ | SPEC-01 -> SPEC-08 | SPEC là nguồn chính cho business logic |
| Bảng, field, quan hệ, index, migration, seed | DB-01 -> DB-10 | Database phải bám theo SPEC và API |
| Endpoint, request, response, error, permission API | API-01 -> API-09 | Backend và frontend phải bám theo API contract |
| Route, screen, flow, component, state UI | UI-01 -> UI-10 | UI không được bỏ qua business rule/backend guard |
| Cấu trúc frontend, route guard, API client, module implementation | FRONTEND-01 -> FRONTEND-14 | Frontend chỉ hỗ trợ UX, không thay backend security |
| Backend architecture, service, guard, job, integration | BACKEND-01 -> BACKEND-14 | Backend là lớp kiểm soát quyền cuối cùng |
| Test strategy, test case, UAT, release readiness | QA-01 -> QA-10 | QA dùng để nghiệm thu MVP |
| Environment, CI/CD, deployment, monitoring, rollback | DEVOPS-01 -> DEVOPS-12 | DevOps đảm bảo chạy được và release được |
| Sprint, backlog, execution, UAT, go-live | IMPLEMENTATION-01 -> IMPLEMENTATION-10 | Implementation dùng để tổ chức thực thi |

### 4.3 Nếu có mâu thuẫn tài liệu, xử lý theo thứ tự ưu tiên

Khi có mâu thuẫn giữa các tài liệu, áp dụng thứ tự ưu tiên sau:

```text
1. PRD: phạm vi và mục tiêu sản phẩm
2. SPEC: nghiệp vụ, rule, quyền, trạng thái
3. DB: mô hình dữ liệu và ràng buộc persistence
4. API: contract giao tiếp frontend/backend
5. UI: màn hình, flow, trạng thái và trải nghiệm
6. Backend/Frontend plan: cách triển khai kỹ thuật
7. QA/DevOps/Implementation: kiểm thử, vận hành, lập kế hoạch thực thi
```

Implementation plan không được tự ý thay đổi nghiệp vụ đã chốt trong SPEC. Nếu cần đổi, phải tạo change request và cập nhật ngược lại tài liệu nguồn.

### 4.4 Backend là nguồn kiểm soát quyền cuối cùng

Frontend được phép ẩn menu, disable button, mask field hoặc chặn route để cải thiện trải nghiệm. Tuy nhiên mọi API nghiệp vụ vẫn phải kiểm tra authentication, permission, data scope, business rule và audit log ở backend.

### 4.5 Dashboard và Home Portal không xử lý nghiệp vụ gốc

Home Portal, App Switcher và Dashboard chỉ tổng hợp, điều hướng, cảnh báo hoặc hiển thị nhanh. Các nghiệp vụ như check-in, xin nghỉ, duyệt đơn, giao task, cập nhật task, mark notification read phải gọi API module gốc.

---

## 5. Phạm vi MVP baseline

### 5.1 Module thuộc MVP Version 1.0

| Module code | Tên module | Vai trò trong MVP | Trạng thái baseline |
| --- | --- | --- | --- |
| AUTH | Tài khoản, đăng nhập & phân quyền | Xác thực, session, user, role, permission, data scope | In scope |
| FOUNDATION | Nền tảng hệ thống | Company, module catalog, settings, audit, files, sequence, public holidays, seed | In scope |
| HR | Quản lý nhân sự | Employee master data, phòng ban, chức vụ, hợp đồng, self-service profile change | In scope |
| ATT | Chấm công | Check-in/out, bảng công, ca làm, rule, điều chỉnh công, remote work | In scope |
| LEAVE | Nghỉ phép | Loại nghỉ, policy, balance, đơn nghỉ, duyệt, lịch nghỉ, sync ATT | In scope |
| TASK | Công việc & dự án | Project, task, assignee, Kanban, comment, checklist, file, activity | In scope |
| NOTI | Thông báo hệ thống | Notification event, template, in-app message, unread count, delivery log | In scope |
| DASH | Dashboard | Dashboard theo vai trò, widget, quick action, alert, cache | In scope |

### 5.2 Module không đi sâu trong MVP

| Module code | Tên module | Quyết định baseline |
| --- | --- | --- |
| PAYROLL | Tiền lương | Đưa sang Phase 2; MVP chỉ chừa dữ liệu và quyền mở rộng |
| RECRUIT | Tuyển dụng | Đưa sang Phase 2; có thể chừa app placeholder nếu cần |
| ASSET | Tài sản | Đưa sang Phase 3 |
| ROOM | Phòng họp | Đưa sang Phase 3 |
| CHAT | Chat nội bộ | Đưa sang Phase 4 |
| SOCIAL | Mạng xã hội nội bộ | Đưa sang Phase 4 |
| MOBILE | Mobile app native | Sau MVP web; MVP chỉ mobile web/responsive nếu cần |
| AI | AI & automation | Phase sau; không ảnh hưởng MVP core |

### 5.3 Quy tắc chống scope creep

Trong giai đoạn MVP, không thêm các nhóm sau nếu chưa có change request được duyệt:

1. Payroll calculation đầy đủ.
2. Tuyển dụng end-to-end.
3. Asset inventory đầy đủ.
4. Room booking đầy đủ.
5. Chat realtime.
6. Social feed.
7. Mobile app native.
8. AI assistant.
9. BI/reporting nâng cao.
10. Multi-tenant SaaS billing.
11. SSO/OAuth/MFA nâng cao, trừ khi bắt buộc cho bảo mật.
12. Device attendance integration thật, trừ khi đã có thiết bị và yêu cầu triển khai chính thức.

---

## 6. Danh mục tài liệu baseline

### 6.1 Product & Specification

| Mã tài liệu | Tên tài liệu | Vai trò | Trạng thái kiểm tra | Ghi chú |
| --- | --- | --- | --- | --- |
| PRD-00 | Product Requirements Document | Chốt mục tiêu, phạm vi sản phẩm, MVP và Phase 2+ | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| SPEC-01 | Tổng quan hệ thống | Spec mẹ, module map, nguyên tắc tổng thể | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| SPEC-02 | AUTH | Nghiệp vụ tài khoản, đăng nhập, phân quyền | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| SPEC-03 | HR | Nghiệp vụ nhân sự, self-service, mã nhân viên | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| SPEC-04 | ATT | Nghiệp vụ chấm công, remote, điều chỉnh công | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| SPEC-05 | LEAVE | Nghiệp vụ nghỉ phép, balance, approval, sync ATT | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| SPEC-06 | TASK | Nghiệp vụ project/task/comment/checklist/file | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| SPEC-07 | DASH | Dashboard theo vai trò, widget, cảnh báo | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| SPEC-08 | NOTI | Notification event, message, unread, delivery | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |

Checklist chốt nhóm PRD/SPEC:

- [ ] PRD đã chốt rõ mục tiêu sản phẩm.
- [ ] PRD đã chốt rõ module MVP và module Phase 2+.
- [ ] Mỗi SPEC có module code, phạm vi MVP, out of scope và module phụ thuộc.
- [ ] Mỗi SPEC có rule nghiệp vụ đủ rõ để backend code.
- [ ] Mỗi SPEC có permission/data scope chính.
- [ ] Mỗi SPEC có state transition chính.
- [ ] Mỗi SPEC có luồng lỗi hoặc trường hợp đặc biệt quan trọng.
- [ ] Không có mâu thuẫn lớn giữa SPEC các module.

### 6.2 Database Design

| Mã tài liệu | Tên tài liệu | Vai trò | Trạng thái kiểm tra | Ghi chú |
| --- | --- | --- | --- | --- |
| DB-01 | Database Design Tổng quan | Kiến trúc DB, ERD cấp cao, module table group | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DB-02 | AUTH & RBAC Database Design | User, role, permission, session, security log | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DB-03 | HR Database Design | Employee, department, contract, profile change | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DB-04 | ATT Database Design | Attendance, shift, rule, adjustment, remote work | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DB-05 | LEAVE Database Design | Leave type, policy, balance, request, approval | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DB-06 | TASK Database Design | Project, task, assignee, comment, checklist, activity | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DB-07 | NOTI & DASH Database Design | Notification, template, delivery, dashboard widget/cache | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DB-08 | Audit, Files, Settings, Seeds | Foundation tables, audit, file, settings, sequence, seeds | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DB-09 | Index, Query Pattern & Performance | Index, query, pagination, partition, dashboard cache | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DB-10 | Migration Plan & Initial Seed Data | Migration order, seed, bootstrap, verification | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |

Checklist chốt nhóm Database:

- [ ] Tất cả bảng chính dùng UUID primary key hoặc rule thống nhất đã chốt.
- [ ] Các bảng tenant-scoped có `company_id`.
- [ ] Các bảng cần soft delete đã có trường phù hợp.
- [ ] Các bảng nghiệp vụ quan trọng có audit trail hoặc liên kết audit log.
- [ ] Các bảng file dùng file service/foundation thay vì mỗi module tự lưu kiểu riêng.
- [ ] Có migration order rõ ràng từ Foundation -> AUTH -> HR -> ATT -> LEAVE -> TASK -> NOTI/DASH.
- [ ] Có seed module catalog, permission, role, role-permission, settings, notification events, dashboard widgets.
- [ ] Các FK liên module không tạo vòng khóa khó migration.
- [ ] Index cho query P0/P1 đã được xác định.
- [ ] Có checklist chạy migration từ database trống.

### 6.3 API Design

| Mã tài liệu | Tên tài liệu | Vai trò | Trạng thái kiểm tra | Ghi chú |
| --- | --- | --- | --- | --- |
| API-01 | API Design Tổng quan | Chuẩn prefix, response, error, auth, permission, pagination | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| API-02 | AUTH API Design | Login, logout, session, user, role, permission | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa | Cần gắn file nếu đang nằm riêng |
| API-03 | HR API Design | Employee, profile, department, contract, self-service | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| API-04 | ATT API Design | Today attendance, check-in/out, records, adjustment, remote | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| API-05 | LEAVE API Design | Leave balance, request, approval, policy, calendar | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| API-06 | TASK API Design | Project, task, Kanban, comment, checklist, file | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| API-07 | NOTI API Design | My notifications, unread, event/template, delivery | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| API-08 | DASH API Design | Dashboard me/type/widget/config/cache | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| API-09 | FOUNDATION API Design | Settings, files, audit, module catalog, company | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa | Cần gắn file nếu đang nằm riêng |
| API-10 | Permission Matrix & Permission Audit Report | Ma trận quyền tổng hợp và báo cáo rà soát quyền | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa | Gồm 2 file: PERMISSION MATRIX + PERMISSION AUDIT REPORT |

Checklist chốt nhóm API:

- [ ] Tất cả endpoint dùng prefix `/api/v1` hoặc convention đã chốt.
- [ ] Response success/error/pagination thống nhất.
- [ ] Mỗi API có permission yêu cầu.
- [ ] Mỗi API list có search/filter/sort/pagination theo whitelist.
- [ ] API không yêu cầu frontend truyền `company_id`, `user_id`, `employee_id` nếu backend resolve được từ auth context.
- [ ] API quan trọng có audit log.
- [ ] API quan trọng có notification event nếu nghiệp vụ yêu cầu.
- [ ] API có idempotency cho thao tác dễ bấm trùng hoặc xử lý trùng.
- [ ] API file upload/download dùng foundation file service.
- [ ] API Dashboard không xử lý nghiệp vụ gốc.
- [ ] API Notification có dedupe/retry/delivery log tối thiểu.
- [ ] Có kế hoạch xuất OpenAPI/Swagger để frontend và QA dùng.

### 6.4 UI/UX Design

| Mã tài liệu | Tên tài liệu | Vai trò | Trạng thái kiểm tra | Ghi chú |
| --- | --- | --- | --- | --- |
| UI-01 | UI/UX Design Tổng quan | Định hướng Home Portal -> Module Workspace -> App Switcher | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| UI-02 | Information Architecture & Sitemap | Sitemap, route, sidebar, topbar, menu permission | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| UI-03 | User Flow MVP | Login, app switch, check-in, xin nghỉ, task, noti | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| UI-04 | Screen List & Wireframe Plan | Screen inventory, route, actor, priority wireframe | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| UI-05 | Design System & Component Library | Token, component, state, permission UI | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| UI-06 | Home Portal & App Switcher UI | Home Portal, app grid, switcher, permission UX | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| UI-07 | Module Workspace Template | Topbar, sidebar, page template, state, responsive | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| UI-08 | Dashboard UI/UX Design | Dashboard role, widget, quick action, cache state | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| UI-09 | Module UI Design | Chi tiết màn nghiệp vụ AUTH/HR/ATT/LEAVE/TASK/NOTI/SYSTEM | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| UI-10 | Prototype & Frontend Handoff Guide | Prototype, annotation, API mapping, QA handoff | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |

Checklist chốt nhóm UI/UX:

- [ ] Sau login, user vào Home Portal trước.
- [ ] Từ Home Portal, user mở module workspace.
- [ ] App Switcher có thể mở từ mọi màn protected.
- [ ] Route và screen code đã thống nhất.
- [ ] Sidebar không hard-code theo role, phải theo permission.
- [ ] Màn P0/P1 có state loading/empty/error/forbidden/disabled/validation/success.
- [ ] Màn P0/P1 có responsive note desktop/tablet/mobile web.
- [ ] UI có dirty form guard khi đổi app hoặc rời màn.
- [ ] Notification deep link điều hướng sang module gốc.
- [ ] Dashboard quick action điều hướng sang module gốc.
- [ ] Component design system đủ để frontend bắt đầu code.

### 6.5 Frontend Documentation

| Mã tài liệu | Tên tài liệu | Vai trò | Trạng thái kiểm tra | Ghi chú |
| --- | --- | --- | --- | --- |
| FRONTEND-01 | Frontend Architecture & Project Setup | Stack, project structure, routing, module registry | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| FRONTEND-02 | Design System Implementation | Token, theme, component foundation, Storybook | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| FRONTEND-03 | Routing, Auth Guard & Permission Framework | Protected route, app registry, guard, permission utils | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| FRONTEND-04 | API Client, Query Layer & Error Handling | API client, query key, error mapping, cache | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| FRONTEND-05 | Layout Implementation | AuthLayout, HomePortalLayout, ModuleWorkspaceLayout | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| FRONTEND-06 | AUTH & Account Frontend | Login, profile, users, roles, permissions | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| FRONTEND-07 | Dashboard Frontend | Role dashboard, widget, quick actions | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| FRONTEND-08 | HR Frontend | Employee, department, profile change, contract | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| FRONTEND-09 | Attendance Frontend | Today, records, adjustment, remote, shift/rule | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| FRONTEND-10 | Leave Frontend | Balance, request, approval, calendar, policy | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| FRONTEND-11 | Task Frontend | Project, task, Kanban, comment, checklist, file | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| FRONTEND-12 | Notification Frontend | Dropdown, list, detail, config, delivery log | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| FRONTEND-13 | System/Foundation Frontend | Settings, module catalog, audit, file metadata | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| FRONTEND-14 | QA, Performance & Release Readiness | Frontend test, performance, accessibility, build readiness | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |

Checklist chốt nhóm Frontend:

- [ ] Project setup, env, scripts, lint, format, TypeScript convention đã chốt.
- [ ] API client dùng chung đã chốt.
- [ ] Query layer/cache/invalidation đã chốt.
- [ ] Auth guard và permission guard đã chốt.
- [ ] App registry/sidebar registry/action registry không hard-code theo role.
- [ ] Layout nền tảng đã chốt: AuthLayout, HomePortalLayout, ModuleWorkspaceLayout.
- [ ] Component foundation đủ để code màn nghiệp vụ.
- [ ] Các module frontend có thứ tự triển khai rõ.
- [ ] Có strategy xử lý 401/403/404/token expired/logout.
- [ ] Có checklist frontend QA/performance/accessibility.

### 6.6 Backend Documentation

| Mã tài liệu | Tên tài liệu | Vai trò | Trạng thái kiểm tra | Ghi chú |
| --- | --- | --- | --- | --- |
| BACKEND-01 | Backend Architecture & Project Setup | Stack, architecture, module structure, env | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| BACKEND-02 | Database Migration, ORM & Seed Implementation | Migration, ORM, seed, bootstrap | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| BACKEND-03 | Auth, Session, RBAC & Permission Guard | Auth, session, role, permission, data scope guard | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| BACKEND-04 | Foundation Backend | Company, settings, audit, files, sequence, holidays | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| BACKEND-05 | HR Backend | Employee, department, profile change, contract | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| BACKEND-06 | Attendance Backend | Check-in/out, records, rule, adjustment, remote | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| BACKEND-07 | Leave Backend | Leave request, balance, approval, sync ATT | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| BACKEND-08 | Task Backend | Project, task, comment, checklist, file, activity | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| BACKEND-09 | Notification Backend | Events, templates, notifications, delivery | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| BACKEND-10 | Dashboard Backend | Widget query, cache, config, data scope | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| BACKEND-11 | File, Audit, Settings & System Jobs | Shared services and scheduled jobs | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| BACKEND-12 | API Integration Contract & OpenAPI/Swagger | API contract, docs, compatibility | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| BACKEND-13 | Backend Testing, Security & Performance | Unit, integration, security, performance | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| BACKEND-14 | Backend Release Readiness | Release checklist, freeze, go-live support | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |

Checklist chốt nhóm Backend:

- [ ] Backend architecture đã chọn rõ stack và module boundary.
- [ ] Migration/seed chạy được từ database trống.
- [ ] Auth middleware và permission guard là bắt buộc cho protected API.
- [ ] Data scope guard áp dụng nhất quán Own/Team/Department/Company/System.
- [ ] Service layer không để controller xử lý nghiệp vụ phức tạp.
- [ ] Audit log áp dụng cho thao tác quan trọng.
- [ ] Notification event phát ở điểm nghiệp vụ đúng.
- [ ] Dashboard chỉ đọc/tổng hợp, không cập nhật nghiệp vụ gốc.
- [ ] Có job nền cho missing checkout, due task, notification retry, cache warmup nếu thuộc MVP.
- [ ] OpenAPI/Swagger được xuất và dùng bởi frontend/QA.

### 6.7 QA Documentation

| Mã tài liệu | Tên tài liệu | Vai trò | Trạng thái kiểm tra | Ghi chú |
| --- | --- | --- | --- | --- |
| QA-01 | QA Strategy & Test Plan | Chiến lược test tổng thể | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| QA-02 | Test Case Matrix theo module | Test case matrix AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| QA-03 | End-to-End Flow Testing | E2E login, check-in, leave, task, notification | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| QA-04 | API Testing & Contract Testing | API tests, OpenAPI contract, negative cases | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| QA-05 | Permission, Role & Data Scope Testing | RBAC/scope/security behavior | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| QA-06 | Security Testing | Auth, session, sensitive data, file access, injection | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| QA-07 | Performance & Load Testing | API, DB, dashboard, notification load | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| QA-08 | Bug Tracking, Regression & Release Criteria | Bug workflow, severity, regression gate | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| QA-09 | UAT Plan & Business Acceptance | UAT flow, actor, business sign-off | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| QA-10 | MVP Release Readiness Checklist | Final QA release gate | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |

Checklist chốt nhóm QA:

- [ ] Mỗi module MVP có test case P0/P1.
- [ ] E2E flow quan trọng đã có kịch bản.
- [ ] API contract test bám theo OpenAPI.
- [ ] Permission/data scope test bao phủ Employee/Manager/HR/Admin/Super Admin.
- [ ] Security test bao gồm auth/session/file/sensitive data.
- [ ] Performance test có mục tiêu tối thiểu cho API list, dashboard và notification unread.
- [ ] Bug severity và release blocking criteria đã chốt.
- [ ] UAT actor và UAT script đã chốt.
- [ ] Release readiness có tiêu chí pass/fail rõ ràng.

### 6.8 DevOps Documentation

| Mã tài liệu | Tên tài liệu | Vai trò | Trạng thái kiểm tra | Ghi chú |
| --- | --- | --- | --- | --- |
| DEVOPS-00 | DevOps & QA Traceability Matrix | Ma trận truy vết DevOps/QA theo module/sprint | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DEVOPS-01 | DevOps Architecture & Environment Strategy | Chiến lược môi trường, deployment, infra | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DEVOPS-02 | Repository, Branching & CI Pipeline | Repo, branch, CI, PR checks | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DEVOPS-03 | Docker & Containerization | Dockerfile, compose, image, container policy | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DEVOPS-04 | Environment Configuration & Secrets Management | Env, secret, config, rotation | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DEVOPS-05 | Database Migration & Seed Deployment | DB deploy, migration, rollback, seed | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DEVOPS-06 | Backend Deployment Pipeline | Backend build, test, deploy | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DEVOPS-07 | Frontend Deployment Pipeline | Frontend build, env, artifact, deploy | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DEVOPS-08 | Staging, UAT & Production Environment | Staging/UAT/prod topology | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DEVOPS-09 | Monitoring, Logging & Alerting | Logs, metrics, alert, dashboard | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DEVOPS-10 | Backup, Rollback & Disaster Recovery | Backup, restore, rollback, DR drill | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DEVOPS-11 | Security Hardening & Runtime Protection | Runtime security, headers, rate limit, hardening | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| DEVOPS-12 | Release Management & Go-live Plan | Release process, cutover, checklist | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |

Checklist chốt nhóm DevOps:

- [ ] Repository strategy và branching model đã chốt.
- [ ] CI chạy lint/test/build tối thiểu.
- [ ] Docker local chạy được backend/frontend/db.
- [ ] Environment dev/staging/UAT/prod có định nghĩa rõ.
- [ ] Secrets không commit vào repository.
- [ ] Migration/seed có quy trình deploy an toàn.
- [ ] Backup/restore có checklist kiểm thử.
- [ ] Monitoring/logging/alerting tối thiểu cho MVP.
- [ ] Rollback plan có thể thực hiện khi release lỗi.
- [ ] Release checklist có owner và thời điểm rõ.

### 6.9 Implementation Documentation

| Mã tài liệu | Tên tài liệu | Vai trò | Trạng thái kiểm tra | Ghi chú |
| --- | --- | --- | --- | --- |
| IMPLEMENTATION-01 | MVP Implementation Roadmap & Sprint Plan | Roadmap tổng thể và sprint plan | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| IMPLEMENTATION-02 | Detailed Product Backlog & Epic Breakdown | Epic, feature, backlog chi tiết | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| IMPLEMENTATION-03 | Sprint 0 Execution Plan & Issue Board Setup | Sprint 0, issue board, readiness | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| IMPLEMENTATION-04 | Sprint 1 Foundation, Environment & Core Infrastructure Execution Plan | Foundation, env, infra core | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| IMPLEMENTATION-05 | Sprint 2 Auth & HR Core Execution Plan | AUTH/HR core | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| IMPLEMENTATION-06 | Sprint 3 Attendance & Leave Core Execution Plan | ATT/LEAVE core | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| IMPLEMENTATION-07 | Sprint 4 Task, Notification & Dashboard Execution Plan | TASK/NOTI/DASH core | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| IMPLEMENTATION-08 | Sprint 5 Integration, QA Hardening & UAT Execution Plan | Integration, QA hardening, UAT | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| IMPLEMENTATION-09 | Sprint 6 Stabilization, Release Candidate & Go-live Execution Plan | Stabilization, RC, go-live | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |
| IMPLEMENTATION-10 | Post-MVP Backlog & Phase 2 Planning | Phase 2 backlog, post-MVP plan | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa |  |

Checklist chốt nhóm Implementation:

- [ ] Sprint order phù hợp với phụ thuộc kỹ thuật.
- [ ] Không có sprint nào làm module phụ thuộc trước module nền.
- [ ] Backlog có epic/feature/task rõ.
- [ ] Mỗi ticket có acceptance criteria.
- [ ] Mỗi ticket có tài liệu nguồn liên quan.
- [ ] Mỗi sprint có mục tiêu, phạm vi, output và DoD.
- [ ] Sprint integration có regression và UAT rõ.
- [ ] Release candidate có tiêu chí pass/fail rõ.
- [ ] Post-MVP backlog tách khỏi MVP scope.

### 6.10 Governance, Compliance & Decisions

| Mã tài liệu | Tên tài liệu | Vai trò | Trạng thái kiểm tra | Ghi chú |
| --- | --- | --- | --- | --- |
| DECISIONS-01 | Open Decisions Lock (Sổ Quyết định) | Chốt 15 câu hỏi mở (D-01 -> D-15) trước khi code | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa | Nguồn sự thật cho quyết định mở; xem §8 và §15 |
| COMPLIANCE-01 | Personal Data Protection & Backup/DR | Tuân thủ NĐ 13/2023, retention, breach 72h, RPO/RTO, DR | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa | Ràng buộc bảo mật/dữ liệu cá nhân cho MVP |
| DEVOPS-00 | DevOps & QA Traceability Matrix | Ma trận truy vết DevOps/QA theo module/sprint | [ ] Chưa rà soát / [ ] Đạt / [ ] Cần sửa | Liên kết DevOps/QA với module/sprint |

Checklist chốt nhóm Governance:

- [ ] DECISIONS-01 đã được duyệt (chuyển "Đề xuất" -> "Đã chốt") cho các quyết định mức Block code.
- [ ] COMPLIANCE-01 đã xác định retention, RPO/RTO và quy trình xử lý sự cố dữ liệu.
- [ ] Quyết định trong §8/§15 của tài liệu này không mâu thuẫn với DECISIONS-01.

---

## 7. Traceability matrix theo module

Mục tiêu của traceability matrix là đảm bảo mỗi module có đủ đường dẫn từ nghiệp vụ đến database, API, UI, frontend, backend và QA.

| Module | SPEC | DB | API | UI | Frontend | Backend | QA chính | Sprint đề xuất |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FOUNDATION | SPEC-01 / DB-08 context | DB-08, DB-10 | API-09 | UI-01, UI-02, UI-06, UI-09 | FRONTEND-01, 05, 13 | BACKEND-04, 11 | QA-04, QA-06, QA-10 | Sprint 1 |
| AUTH | SPEC-02 | DB-02 | API-02 | UI-02, UI-03, UI-09 | FRONTEND-03, 06 | BACKEND-03 | QA-03, QA-04, QA-05, QA-06 | Sprint 2 |
| HR | SPEC-03 | DB-03 | API-03 | UI-03, UI-04, UI-09 | FRONTEND-08 | BACKEND-05 | QA-02, QA-04, QA-05 | Sprint 2 |
| ATT | SPEC-04 | DB-04 | API-04 | UI-03, UI-04, UI-09 | FRONTEND-09 | BACKEND-06 | QA-02, QA-03, QA-04, QA-05 | Sprint 3 |
| LEAVE | SPEC-05 | DB-05 | API-05 | UI-03, UI-04, UI-09 | FRONTEND-10 | BACKEND-07 | QA-02, QA-03, QA-04, QA-05 | Sprint 3 |
| TASK | SPEC-06 | DB-06 | API-06 | UI-03, UI-04, UI-09 | FRONTEND-11 | BACKEND-08 | QA-02, QA-03, QA-04, QA-05 | Sprint 4 |
| NOTI | SPEC-08 | DB-07 | API-07 | UI-03, UI-09 | FRONTEND-12 | BACKEND-09 | QA-02, QA-03, QA-04 | Sprint 4 |
| DASH | SPEC-07 | DB-07 | API-08 | UI-08 | FRONTEND-07 | BACKEND-10 | QA-02, QA-03, QA-07 | Sprint 4 |

Freeze checklist cho traceability:

- [ ] Mỗi module có đủ SPEC.
- [ ] Mỗi module có đủ DB design.
- [ ] Mỗi module có đủ API design.
- [ ] Mỗi module có screen/flow tương ứng.
- [ ] Mỗi module có frontend implementation plan.
- [ ] Mỗi module có backend implementation plan.
- [ ] Mỗi module có test case hoặc QA mapping.
- [ ] Mỗi module đã được gán sprint phù hợp.

---

## 8. Baseline decision log

Các quyết định sau được xem là baseline của MVP. Nếu thay đổi, cần tạo change request.

> **Nguồn sự thật quyết định:** Sổ quyết định chính thức là `DECISIONS-01` (D-01 -> D-15). Bảng `BL-DEC-*` dưới đây là bản tóm tắt baseline ở cấp tài liệu; khi có khác biệt, lấy `DECISIONS-01` làm chuẩn và cập nhật ngược bảng này.

| ID | Quyết định | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| BL-DEC-001 | MVP tập trung vào AUTH, FOUNDATION, HR, ATT, LEAVE, TASK, NOTI, DASH | Locked | Không thêm module mới vào MVP nếu chưa duyệt |
| BL-DEC-002 | PostgreSQL là database chính | Locked | Thiết kế DB dùng UUID, company_id, audit, soft delete |
| BL-DEC-003 | AUTH/RBAC là nền tảng phân quyền toàn hệ thống | Locked | Backend guard là bắt buộc |
| BL-DEC-004 | HR là nguồn dữ liệu employee master | Locked | ATT/LEAVE/TASK/DASH/NOTI dùng HR để resolve employee |
| BL-DEC-005 | Employee self-service cập nhật hồ sơ cần HR/Admin duyệt | Locked | Dữ liệu không cập nhật trực tiếp vào hồ sơ chính |
| BL-DEC-006 | Mã nhân viên mặc định sinh tự động theo cấu hình | Locked | Có sequence/config riêng |
| BL-DEC-007 | ATT quản lý remote/công tác trong MVP | Locked | Vì remote/công tác là trạng thái làm việc, không phải nghỉ phép |
| BL-DEC-008 | LEAVE Approved có ưu tiên khi tính/chặn chấm công | Locked | ATT cần kiểm tra LEAVE |
| BL-DEC-009 | TASK không bắt buộc tính công theo task trong MVP | Locked | Chỉ cảnh báo/liên kết nhẹ nếu cần |
| BL-DEC-010 | NOTI là module dùng chung cho toàn hệ thống | Locked | Các module phát event sang NOTI |
| BL-DEC-011 | DASH chỉ tổng hợp/hiển thị/điều hướng, không xử lý nghiệp vụ gốc | Locked | Widget phải theo permission/data scope |
| BL-DEC-012 | Sau login, user vào Home Portal trước | Locked | Không đi thẳng vào dashboard nghiệp vụ |
| BL-DEC-013 | Từ Home Portal/App Switcher user mở Module Workspace | Locked | Module workspace có sidebar riêng |
| BL-DEC-014 | Frontend không hard-code menu theo role name | Locked | Dựa vào permission/data scope/backend context |
| BL-DEC-015 | OpenAPI/Swagger là contract để FE/BE/QA đồng bộ | Pending confirm | Cần triển khai khi bắt đầu Sprint 0/Sprint 1 |

---

## 9. Checklist kiểm tra mâu thuẫn tài liệu

### 9.1 Mâu thuẫn scope

- [ ] PRD và SPEC thống nhất module MVP.
- [ ] PRD và Implementation thống nhất module MVP.
- [ ] Implementation-10 đã đưa module Phase 2+ ra khỏi phạm vi MVP.
- [ ] UI không hiển thị module Phase 2+ như module active nếu chưa có backend/API.
- [ ] DevOps/QA không đặt tiêu chí release cho module ngoài MVP.

### 9.2 Mâu thuẫn nghiệp vụ

- [ ] AUTH permission/data scope thống nhất với API và UI.
- [ ] HR self-service thống nhất giữa SPEC, DB, API, UI.
- [ ] Employee code auto-generation thống nhất giữa SPEC, DB, API, Backend.
- [ ] ATT remote work nằm trong ATT, không nằm trong LEAVE.
- [ ] ATT chặn check-in khi có leave full-day Approved.
- [ ] LEAVE đồng bộ Approved/Cancelled/Revoked sang ATT.
- [ ] TASK chỉ cảnh báo khi giao việc trùng kỳ nghỉ, không bắt buộc chặn trong MVP.
- [ ] DASH không tự sửa dữ liệu module nguồn.
- [ ] NOTI không quyết định quyền nghiệp vụ thay module nguồn.

### 9.3 Mâu thuẫn kỹ thuật

- [ ] DB table và API response dùng naming nhất quán hoặc có mapping rõ.
- [ ] API endpoint prefix thống nhất.
- [ ] Frontend route map khớp với UI sitemap.
- [ ] Backend module boundary khớp với API module.
- [ ] Migration order khớp với DB dependency.
- [ ] Seed permission khớp với route/API/menu/widget permission.
- [ ] File service dùng chung, không phân mảnh giữa module.
- [ ] Audit log dùng chung, không mỗi module một kiểu khác nhau.

### 9.4 Mâu thuẫn release/sprint

- [ ] Sprint không yêu cầu test module chưa code.
- [ ] UAT không bao gồm Phase 2 feature.
- [ ] Go-live criteria chỉ áp dụng cho MVP.
- [ ] Release plan có rollback phù hợp với migration.
- [ ] QA performance target không vượt quá năng lực hạ tầng MVP nếu chưa chốt infra.

---

## 10. Checklist freeze trước khi tạo issue board

Chỉ tạo issue board chính thức khi các checklist sau đạt mức đủ dùng.

### 10.1 Documentation readiness

- [ ] Tất cả tài liệu nguồn đã được đưa vào thư mục `/docs` hoặc nơi quản lý tài liệu chính thức.
- [ ] Mỗi tài liệu có mã tài liệu, tên, phiên bản, trạng thái, ngày cập nhật.
- [ ] Tài liệu đã được nhóm theo folder rõ ràng.
- [ ] Tài liệu không còn tên trùng hoặc phiên bản mơ hồ.
- [ ] Tài liệu cũ/nháp không còn bị nhầm là bản mới.
- [ ] Có file index hoặc table of contents cho toàn bộ tài liệu.
- [ ] Có quy tắc đặt tên file tài liệu thống nhất.

### 10.2 Scope readiness

- [ ] MVP in-scope đã chốt.
- [ ] MVP out-of-scope đã chốt.
- [ ] Phase 2+ backlog đã tách riêng.
- [ ] Không còn module mới chen vào sprint MVP.
- [ ] Không còn business flow P0 bị bỏ quên.
- [ ] Không còn dependency blocker chưa ghi nhận.

### 10.3 Technical readiness

- [ ] Stack frontend đã chốt.
- [ ] Stack backend đã chốt.
- [ ] Database engine đã chốt.
- [ ] Migration tool đã chốt.
- [ ] API contract format đã chốt.
- [ ] Auth/session strategy đã chốt.
- [ ] File storage strategy đã chốt.
- [ ] Environment strategy đã chốt.
- [ ] CI/CD baseline đã chốt.

### 10.4 Delivery readiness

- [ ] Sprint order đã chốt.
- [ ] Epic breakdown đã chốt.
- [ ] Ticket template đã chốt.
- [ ] Definition of Ready đã chốt.
- [ ] Definition of Done đã chốt.
- [ ] Bug severity đã chốt.
- [ ] UAT criteria đã chốt.
- [ ] Release criteria đã chốt.

---

## 11. Ticket template chuẩn sau baseline

Sau khi baseline được duyệt, mọi ticket nên dùng format sau.

```text
Title:
  [MODULE] Short action/feature name

Type:
  Epic / Story / Task / Bug / Spike / Chore

Module:
  AUTH / FOUNDATION / HR / ATT / LEAVE / TASK / NOTI / DASH

Source documents:
  SPEC-xx:
  DB-xx:
  API-xx:
  UI-xx:
  FRONTEND-xx:
  BACKEND-xx:
  QA-xx:

Description:
  What needs to be implemented and why.

Scope included:
  - ...

Scope excluded:
  - ...

Acceptance criteria:
  - Given ... When ... Then ...

Permission / data scope:
  Required permission:
  Scope: Own / Team / Department / Company / System

API mapping:
  Endpoint(s):
  Request/response:

DB impact:
  Tables:
  Migration needed: Yes/No
  Seed needed: Yes/No

UI impact:
  Screen code:
  Route:
  State: loading / empty / error / forbidden / validation / success

Test checklist:
  Unit:
  Integration:
  API:
  E2E:
  Permission/scope:
  Regression:

Definition of Done:
  - Code complete
  - Tests pass
  - Permission checked
  - API documented
  - UI state complete
  - QA accepted
```

---

## 12. Definition of Ready cho ticket

Một ticket chỉ được kéo vào sprint nếu đạt các điều kiện sau:

- [ ] Có mô tả rõ.
- [ ] Có module rõ.
- [ ] Có tài liệu nguồn liên quan.
- [ ] Có acceptance criteria.
- [ ] Có permission/data scope nếu là nghiệp vụ protected.
- [ ] Có API mapping nếu liên quan frontend/backend.
- [ ] Có DB impact nếu cần migration/seed.
- [ ] Có UI state nếu liên quan màn hình.
- [ ] Có test checklist tối thiểu.
- [ ] Không phụ thuộc vào quyết định chưa chốt.
- [ ] Không thuộc Phase 2+ nhưng bị đưa nhầm vào MVP.

---

## 13. Definition of Done cho MVP feature

Một feature MVP được xem là Done khi:

- [ ] Backend API hoàn thành.
- [ ] Permission guard/backend guard hoàn thành.
- [ ] Data scope xử lý đúng.
- [ ] Validation và error handling hoàn thành.
- [ ] Audit log có nếu là thao tác quan trọng.
- [ ] Notification event có nếu nghiệp vụ yêu cầu.
- [ ] Migration/seed hoàn thành nếu có DB impact.
- [ ] Frontend screen hoàn thành.
- [ ] Loading/empty/error/forbidden/validation/success state hoàn thành.
- [ ] Responsive tối thiểu hoàn thành cho màn P0/P1.
- [ ] API contract cập nhật.
- [ ] Unit/integration/API test pass theo phạm vi.
- [ ] QA test pass.
- [ ] Không có bug blocker/critical/high chưa xử lý.
- [ ] Tài liệu liên quan được cập nhật nếu có thay đổi.

---

## 14. Risk register baseline

| ID | Rủi ro | Mức độ | Tác động | Cách kiểm soát |
| --- | --- | --- | --- | --- |
| RISK-001 | Tài liệu nhiều nhưng chưa khóa phiên bản | Cao | Team code theo bản khác nhau | Tạo baseline và freeze version |
| RISK-002 | Thiếu API-02/API-09 hoặc tài liệu không cùng naming | Trung bình | FE/BE/QA lệch contract | Chuẩn hóa API index và OpenAPI |
| RISK-003 | Permission/data scope không test đủ | Cao | Lộ dữ liệu nhạy cảm | QA-05 bắt buộc trước release |
| RISK-004 | DB migration phức tạp do FK liên module | Trung bình | Sprint 0/1 bị chậm | Chốt migration order và seed strategy |
| RISK-005 | Dashboard query chậm | Trung bình | UX kém, timeout | Dùng widget cache và index theo DB-09 |
| RISK-006 | Notification event trùng/lặp | Trung bình | User nhận nhiều thông báo sai | Dedupe key, delivery log, idempotency |
| RISK-007 | Scope creep thêm payroll/recruit/mobile | Cao | Trễ MVP | Tách Phase 2 backlog, chặn change không duyệt |
| RISK-008 | UI prototype chưa đủ nhưng frontend code sâu | Trung bình | Rework UI lớn | Chốt P0/P1 wireframe và handoff trước |
| RISK-009 | DevOps/CI/CD làm muộn | Cao | Release khó, QA khó deploy | Sprint 0 phải dựng pipeline tối thiểu |
| RISK-010 | Không có UAT script rõ | Trung bình | Business không ký nghiệm thu | QA-09 bắt buộc trước UAT |

---

## 15. Open questions cần đóng trước khi code sâu

> Một số câu hỏi dưới đây đã có khuyến nghị/quyết định trong `DECISIONS-01` (ví dụ file storage -> D-12, ngôn ngữ/i18n -> D-13, audit dữ liệu nhạy cảm -> D-15). Trước khi đánh dấu "Open", đối chiếu với `DECISIONS-01` để tránh mở lại câu đã chốt.

| ID | Câu hỏi | Nhóm ảnh hưởng | Owner | Deadline | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| OQ-001 | API-02 AUTH và API-09 FOUNDATION đã có file chính thức chưa? | API/Backend/Frontend/QA |  |  | Open |
| OQ-002 | Stack backend chính thức là gì? | Backend/DevOps |  |  | Open |
| OQ-003 | Stack frontend chính thức là gì? | Frontend/DevOps |  |  | Open |
| OQ-004 | Dùng monorepo hay split repo? | Frontend/Backend/DevOps |  |  | Open |
| OQ-005 | File storage MVP dùng local, S3-compatible hay cloud provider nào? | Backend/DevOps/Security |  |  | Có khuyến nghị D-12 (MinIO/S3), chờ chốt |
| OQ-006 | Có cần tenant/company thật trong MVP hay seed một company mặc định? | DB/Backend/Product |  |  | Open |
| OQ-007 | Có cần export Excel trong MVP cho HR/ATT/LEAVE không? | Product/Backend/Frontend/QA |  |  | Open |
| OQ-008 | Có cần email notification trong MVP hay chỉ in-app? | Product/NOTI/DevOps |  |  | Open |
| OQ-009 | Có cần mobile web check-in trong MVP hay chỉ web desktop? | Product/ATT/Frontend |  |  | Open |
| OQ-010 | UAT sẽ dùng dữ liệu demo hay dữ liệu thật đã ẩn danh? | QA/DevOps/Product |  |  | Open |

Ghi chú: Open question không nhất thiết phải chặn toàn bộ dự án. Cần phân loại câu hỏi nào là blocker cho Sprint 0/Sprint 1, câu hỏi nào có thể đóng trong sprint sau.

---

## 16. Baseline sign-off checklist

### 16.1 Product sign-off

- [ ] PRD scope được chấp nhận.
- [ ] MVP module list được chấp nhận.
- [ ] Phase 2+ backlog được tách riêng.
- [ ] UAT scope được chấp nhận.

Người duyệt Product: ____________________  Ngày: ____________

### 16.2 Technical sign-off

- [ ] Architecture frontend/backend/database được chấp nhận.
- [ ] API contract direction được chấp nhận.
- [ ] Migration/seed direction được chấp nhận.
- [ ] DevOps environment direction được chấp nhận.

Người duyệt Technical: ____________________  Ngày: ____________

### 16.3 UI/UX sign-off

- [ ] Home Portal -> Module Workspace -> App Switcher được chấp nhận.
- [ ] Screen list P0/P1 được chấp nhận.
- [ ] Design system baseline được chấp nhận.
- [ ] Prototype/handoff scope được chấp nhận.

Người duyệt UI/UX: ____________________  Ngày: ____________

### 16.4 QA sign-off

- [ ] Test strategy được chấp nhận.
- [ ] Test case matrix baseline được chấp nhận.
- [ ] Permission/data scope test được chấp nhận.
- [ ] Release readiness criteria được chấp nhận.

Người duyệt QA: ____________________  Ngày: ____________

### 16.5 DevOps sign-off

- [ ] Repository/branching/CI strategy được chấp nhận.
- [ ] Environment strategy được chấp nhận.
- [ ] Migration/backup/rollback strategy được chấp nhận.
- [ ] Monitoring/logging baseline được chấp nhận.

Người duyệt DevOps: ____________________  Ngày: ____________

---

## 17. Kết quả đầu ra sau khi baseline được duyệt

Sau khi PROJECT-BASELINE-01 được duyệt, team cần tạo các output thực thi sau:

1. **Issue board chính thức**.
2. **Epic list theo module**.
3. **Sprint backlog cho Sprint 0 và Sprint 1**.
4. **Repository structure**.
5. **Local dev environment**.
6. **OpenAPI/Swagger skeleton**.
7. **Database migration skeleton**.
8. **Seed skeleton**.
9. **Frontend app skeleton**.
10. **Backend app skeleton**.
11. **CI pipeline tối thiểu**.
12. **QA test repository hoặc test folder**.
13. **UAT data plan**.

---

## 18. Đề xuất hành động ngay sau tài liệu này

Sau khi hoàn tất baseline, thứ tự làm tiếp theo nên là (sprint numbering theo bộ IMPLEMENTATION):

```text
1. ISSUE-BOARD-01: MVP Ticket Board Setup
2. Sprint 0 (IMPLEMENTATION-03): Repository, Environment & Bootstrap Execution
3. Sprint 1 (IMPLEMENTATION-04): Foundation, Environment & Core Infrastructure
4. Sprint 2 (IMPLEMENTATION-05): AUTH & HR Core
5. Sprint 3 (IMPLEMENTATION-06): Attendance & Leave Core
6. Sprint 4 (IMPLEMENTATION-07): Task, Notification & Dashboard Core
7. Sprint 5 (IMPLEMENTATION-08): Integration, QA Hardening & UAT
8. Sprint 6 (IMPLEMENTATION-09): Stabilization, Release Candidate & Go-live
```

Nếu dự án đang đi theo bộ IMPLEMENTATION-01 -> IMPLEMENTATION-10 đã chốt, thì PROJECT-BASELINE-01 là điểm kiểm tra trước khi thực hiện nội dung của IMPLEMENTATION-03 và IMPLEMENTATION-04 ở cấp ticket/source code.

---

## 19. Acceptance criteria của PROJECT-BASELINE-01

Tài liệu PROJECT-BASELINE-01 được xem là đạt khi:

- [ ] Danh sách tài liệu nguồn đã được kiểm kê.
- [ ] Scope MVP đã chốt.
- [ ] Scope Phase 2+ đã tách riêng.
- [ ] Traceability matrix theo module đã có.
- [ ] Decision log baseline đã có.
- [ ] Checklist mâu thuẫn tài liệu đã có.
- [ ] Checklist trước khi tạo issue board đã có.
- [ ] Ticket template đã có.
- [ ] Definition of Ready và Definition of Done đã có.
- [ ] Risk register đã có.
- [ ] Open questions đã có.
- [ ] Sign-off checklist đã có.
- [ ] Next action sau baseline đã rõ.

---

## 20. Kết luận

PROJECT-BASELINE-01 là tài liệu khóa phạm vi và kiểm soát chất lượng tài liệu trước khi bắt đầu development. Sau khi tài liệu này được rà soát và ký duyệt, dự án nên dừng việc viết thêm tài liệu định hướng lớn, chuyển sang tạo issue board, dựng repo, dựng môi trường, tạo migration/seed skeleton, tạo OpenAPI skeleton và bắt đầu Sprint 0/Sprint 1.

Nguyên tắc quan trọng nhất sau baseline:

```text
Không code theo trí nhớ.
Không code theo suy đoán.
Không mở rộng MVP bằng ý tưởng mới.
Mọi ticket phải truy ngược được về tài liệu nguồn.
Mọi thay đổi lớn phải đi qua change request.
```
