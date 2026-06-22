# FRONTEND-14: QA, PERFORMANCE & RELEASE READINESS

> **📚 Bộ tài liệu FRONTEND — Hệ thống Quản lý Doanh nghiệp**
> [FRONTEND-01 Kiến trúc & Setup](<FRONTEND-01_Frontend_Architecture_Project_Setup.md>) · [FRONTEND-02 Design System](<FRONTEND-02_Design_System_Implementation.md>) · [FRONTEND-03 Routing/Auth/Permission](<FRONTEND-03_Routing_Auth_Guard_Permission_Framework.md>) · [FRONTEND-04 API Client](<FRONTEND-04_API_Client_Query_Layer_Error_Handling.md>) · [FRONTEND-05 Layout](<FRONTEND-05_Layout_Implementation.md>) · [FRONTEND-06 AUTH/Account](<FRONTEND-06_AUTH_Account_Frontend.md>) · [FRONTEND-07 Dashboard](<FRONTEND-07_Dashboard_Frontend.md>) · [FRONTEND-08 HR](<FRONTEND-08_HR_Frontend.md>) · [FRONTEND-09 Attendance](<FRONTEND-09_Attendance_Frontend.md>) · [FRONTEND-10 Leave](<FRONTEND-10_Leave_Frontend.md>) · [FRONTEND-11 Task](<FRONTEND-11_Task_Frontend.md>) · [FRONTEND-12 Notification](<FRONTEND-12_Notification_Frontend.md>) · [FRONTEND-13 System/Foundation](<FRONTEND-13_System_Foundation_Frontend.md>) · **FRONTEND-14 QA & Release**
>
> **Liên quan:** [Hiệu năng/Index: DB-09](<../DB/DB-09 Database Index Query Pattern Performance Design.md>) · [Chuẩn API: API-01](<../API Design/API-01 TỔNG QUAN.md>) · [Prototype/Handoff: UI-10](<../UI/UI-10_Prototype_Frontend_Handoff_Guide.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | FRONTEND-14 |
| Tên tài liệu | QA, Performance & Release Readiness |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | Frontend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-13 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

FRONTEND-14 là tài liệu chốt cuối của nhánh **Frontend Implementation** cho MVP.

Tài liệu này dùng để:

1. Chuẩn hóa chiến lược kiểm thử frontend trước khi release.
2. Xác định test pyramid cho unit test, component test, integration test, E2E test, visual test, accessibility test và performance test.
3. Định nghĩa test matrix theo module MVP: AUTH, HOME, DASH, HR, ATT, LEAVE, TASK, NOTI, SYSTEM/FOUNDATION.
4. Chốt các flow P0/P1 bắt buộc phải qua kiểm thử trước khi release.
5. Định nghĩa performance budget cho route, bundle, API interaction, table/list, dashboard widget và notification.
6. Định nghĩa tiêu chí kiểm tra responsive, accessibility, permission/data scope, error handling và state handling.
7. Chuẩn hóa quality gate trong CI/CD: lint, typecheck, test, build, E2E smoke, bundle analysis và release checklist.
8. Định nghĩa quy trình release candidate, UAT, sign-off, rollback và post-release monitoring.
9. Tạo checklist “go/no-go” để quyết định frontend MVP đã sẵn sàng phát hành hay chưa.
10. Giúp Product, UI/UX, Frontend, Backend, QA và DevOps có cùng tiêu chuẩn nghiệm thu.

FRONTEND-14 không thay thế test case chi tiết của QA. Tài liệu này là **khung kiểm thử và sẵn sàng phát hành**. Test case cụ thể có thể được tách thành test suite hoặc test management tool riêng.

---

## 3. Vị trí FRONTEND-14 trong roadmap frontend

```text
FRONTEND-01: Frontend Architecture & Project Setup
FRONTEND-02: Design System Implementation
FRONTEND-03: Routing, Auth Guard & Permission Framework
FRONTEND-04: API Client, Query Layer & Error Handling
FRONTEND-05: Layout Implementation
FRONTEND-06: AUTH & Account Frontend
FRONTEND-07: Dashboard Frontend
FRONTEND-08: HR Frontend
FRONTEND-09: Attendance Frontend
FRONTEND-10: Leave Frontend
FRONTEND-11: Task Frontend
FRONTEND-12: Notification Frontend
FRONTEND-13: System/Foundation Frontend
FRONTEND-14: QA, Performance & Release Readiness
```

FRONTEND-14 nằm sau khi các lớp nền và module frontend MVP đã được triển khai. Đây là bước tổng hợp để:

```text
Kiểm thử toàn hệ thống
-> Đánh giá hiệu năng
-> Kiểm tra accessibility/responsive/security
-> Chốt release candidate
-> UAT/sign-off
-> Phát hành MVP
-> Theo dõi sau release
```

---

## 4. Căn cứ triển khai

FRONTEND-14 bám theo các quyết định đã chốt:

1. Frontend được xây theo kiến trúc enterprise web platform, gồm App Runtime, App Shell, Design System, Navigation/Registry, Auth/Permission, API/State và Feature Module.
2. Stack MVP mặc định: Vite + React 19 SPA + TanStack Router, TypeScript, Tailwind CSS/CSS Variables, TanStack Query, React Hook Form, Zod, TanStack Table, Zustand, Vitest, Testing Library, Playwright và Storybook.
3. Sau đăng nhập, user vào **Home Portal** trước, sau đó mở module bằng Home Portal hoặc App Switcher.
4. Mọi màn protected phải đi qua route guard, permission guard, module status và feature flag nếu có.
5. Frontend không được hard-code theo role name; phải dựa trên permission, data scope, route metadata, action metadata và allowed actions từ backend.
6. Frontend guard chỉ là lớp UX; backend vẫn là nguồn kiểm soát cuối cùng cho authentication, permission, data scope và business rule.
7. Dashboard, Home Portal và App Switcher chỉ tổng hợp/điều hướng, không xử lý nghiệp vụ gốc.
8. Notification deep link và Dashboard quick action phải điều hướng về module gốc để kiểm tra quyền và business rule lại.
9. API client dùng chung phải xử lý response, error, 401 refresh, validation error, cache invalidation, upload/download và clear cache khi logout.
10. Mọi màn nghiệp vụ phải có đủ state: loading, empty, error, forbidden, disabled, validation, success và stale nếu phù hợp.
11. UI/UX handoff yêu cầu có prototype, component mapping, API mapping, route metadata, permission/data scope matrix, responsive annotation, state annotation và QA acceptance checklist.
12. Release chỉ được phép thực hiện khi P0 flow, permission behavior, API integration, responsive, accessibility và performance budget đạt tiêu chí tối thiểu.

---

## 5. Phạm vi FRONTEND-14

### 5.1 Bao gồm

| Nhóm | Nội dung |
| --- | --- |
| QA strategy | Test pyramid, test scope, quality gates, defect severity |
| Unit test | Utility, formatter, permission checker, route guard, schema, error mapper |
| Component test | Design System, layout, form, table, state component, domain component |
| Integration test | API hook, mutation, cache invalidation, form submit, workflow state |
| E2E test | Login, Home Portal, App Switcher, check-in/out, leave, approval, task, notification |
| Visual test | Layout shell, responsive, theme, component regression |
| Accessibility test | Keyboard, focus, aria, contrast, screen reader basics |
| Responsive test | Desktop, tablet, mobile web cho P0/P1 screens |
| Performance | Bundle budget, Core UX metrics, route load, table/render, dashboard widget, API latency UX |
| Security frontend | Token handling, cache clear, XSS basics, sensitive data display, file URL handling |
| Release readiness | RC checklist, UAT checklist, environment checklist, rollback plan |
| Monitoring | Error tracking, web vitals, frontend logs, release health dashboard |
| Go/no-go | Tiêu chí quyết định phát hành MVP |

### 5.2 Không bao gồm

| Nội dung | Chuyển sang |
| --- | --- |
| Backend unit/integration test | Backend QA/API test plan |
| Database migration test chi tiết | DB release checklist |
| Load test backend/API chuyên sâu | Backend/DevOps performance plan |
| Native mobile app test | Mobile phase riêng |
| Security penetration test toàn hệ thống | Security audit riêng |
| Payroll/recruit/asset/room/chat/social/AI test | Phase sau |
| Test case manual chi tiết từng field | QA test case repository |

---

## 6. Nguyên tắc QA tổng thể

### 6.1 Test theo rủi ro nghiệp vụ

Không test mọi thứ với cùng mức độ. MVP cần ưu tiên theo rủi ro:

| Mức | Ý nghĩa | Ví dụ |
| --- | --- | --- |
| P0 | Hỏng là không thể release | Login, route guard, permission, check-in, xin nghỉ, duyệt nghỉ, task status, notification deep link |
| P1 | Hỏng ảnh hưởng lớn nhưng có workaround | HR list, bảng công, leave calendar, task filter, dashboard widget |
| P2 | Hỏng ảnh hưởng vừa | Sort/filter phụ, empty copy, một số report, system config ít dùng |
| P3 | Cosmetic/minor | Spacing nhỏ, icon lệch nhẹ, copy chưa tối ưu |

### 6.2 Test theo user journey thay vì chỉ theo màn hình

MVP là hệ thống đa module, nên QA không chỉ kiểm tra từng screen độc lập. Bắt buộc test các journey liên module:

```text
Login
-> Home Portal
-> Chấm công hôm nay
-> Notification
-> Dashboard cập nhật trạng thái
```

```text
Employee tạo đơn nghỉ
-> Manager duyệt
-> ATT chặn/tính lại công
-> NOTI gửi thông báo
-> DASH cập nhật widget
```

```text
Task được giao
-> Assignee nhận notification
-> Mở task detail từ deep link
-> Cập nhật trạng thái
-> Dashboard task cập nhật
```

### 6.3 Frontend test cả UX guard và backend error

Vì backend là guard cuối cùng, frontend phải test cả 2 lớp:

1. Khi user thiếu quyền, UI phải ẩn/disable/menu/route đúng.
2. Nếu backend vẫn trả 403/409/422, frontend phải hiển thị state đúng, không crash và không lộ dữ liệu.

### 6.4 Không bỏ qua state rỗng/lỗi

Mỗi màn P0/P1 phải có ít nhất các state sau:

| State | Yêu cầu QA |
| --- | --- |
| Loading | Skeleton/spinner đúng vị trí, không layout shift quá lớn |
| Empty | Có message rõ, CTA nếu phù hợp |
| Error | Có retry hoặc hướng xử lý, hiển thị request id nếu có |
| Forbidden | Không lộ dữ liệu nhạy cảm |
| Disabled | Có lý do hoặc tooltip/alert |
| Validation | Field error + form error summary nếu form dài |
| Success | Toast/inline success + dữ liệu được refetch/invalidate |
| Stale/degraded | Dùng cho dashboard/widget khi module nguồn lỗi hoặc cache cũ |

---

## 7. Test pyramid đề xuất

```text
E2E Critical Flow
  -> ít nhưng bắt buộc, chạy trên staging/RC

Integration Test
  -> hooks + form + API mock + cache invalidation

Component Test
  -> UI behavior, permission state, responsive basics

Unit Test
  -> logic thuần, schema, utility, permission checker
```

### 7.1 Tỷ lệ test định hướng

| Loại test | Tỷ lệ định hướng | Công cụ đề xuất | Mục tiêu |
| --- | --- | --- | --- |
| Unit | 40% | Vitest | Logic nhanh, ổn định |
| Component | 25% | Testing Library / Storybook test | Component behavior |
| Integration | 20% | Vitest + MSW + Testing Library | API hook, form, cache |
| E2E | 10% | Playwright | Journey P0/P1 |
| Visual/a11y/performance | 5% | Playwright, Lighthouse/axe, bundle analyzer | Regression và release gate |

Tỷ lệ này là định hướng, không phải quy tắc cứng. Với MVP, ưu tiên đạt độ tin cậy ở P0 flow hơn là chạy theo con số coverage đẹp.

---

## 8. Công cụ kiểm thử đề xuất

| Nhóm | Công cụ | Vai trò |
| --- | --- | --- |
| Unit test | Vitest | Test utility, schema, permission, formatter |
| Component test | Testing Library | Test hành vi component theo user interaction |
| API mock | MSW | Mock API contract theo API-01/API module |
| E2E | Playwright | Test flow login, app switcher, nghiệp vụ lõi |
| Accessibility | axe hoặc Playwright accessibility checks | Bắt lỗi a11y cơ bản |
| Visual review | Storybook + visual baseline nếu có | Review component/layout regression |
| Bundle analysis | Next bundle analyzer hoặc build analyzer tương đương | Kiểm tra bundle size |
| Performance | Lighthouse CI hoặc Playwright trace/web vitals | Đo route performance |
| Error tracking | Sentry hoặc service tương đương | Theo dõi lỗi production |
| Logging | Frontend telemetry nhẹ | Build version, route, screen code, request id |

---

## 9. Scripts đề xuất trong `package.json`

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "test:e2e:smoke": "playwright test --project=chromium --grep @smoke",
    "test:e2e:critical": "playwright test --grep @critical",
    "test:a11y": "playwright test --grep @a11y",
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build",
    "analyze": "ANALYZE=true next build",
    "qa:pr": "pnpm lint && pnpm typecheck && pnpm test:run && pnpm build",
    "qa:rc": "pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build && pnpm test:e2e:critical"
  }
}
```

---

## 10. Quality gate theo giai đoạn

### 10.1 Gate khi tạo Pull Request

Một PR frontend chỉ được merge khi đạt:

| Gate | Bắt buộc | Ghi chú |
| --- | --- | --- |
| Lint pass | Có | Không warning nghiêm trọng |
| Typecheck pass | Có | Không dùng `any` tùy tiện cho DTO/API quan trọng |
| Unit test pass | Có | Test liên quan thay đổi phải có |
| Component/integration test pass | Có nếu có thay đổi UI/API hook | Không bắt buộc mọi PR nhỏ |
| Build pass | Có | Không lỗi Next build |
| Storybook build pass | Nên có | Bắt buộc nếu thay Design System |
| Visual review | Có nếu đổi UI lớn | Designer/FE review |
| No secret in code | Có | Không hard-code token/domain nhạy cảm |
| QA note | Có nếu thay flow | Ghi màn/flow bị ảnh hưởng |

### 10.2 Gate nightly/dev

Chạy hằng ngày hoặc sau khi merge vào branch dev:

| Gate | Mục tiêu |
| --- | --- |
| Full unit/component/integration | Phát hiện regression sớm |
| E2E smoke | Đảm bảo app boot, login, Home, module mở được |
| Bundle report | Theo dõi bundle tăng bất thường |
| Storybook build | Đảm bảo component docs không vỡ |
| Mock API contract check | Đảm bảo mock không lệch API contract |

### 10.3 Gate release candidate

Trước khi tạo RC:

| Gate | Mục tiêu |
| --- | --- |
| Full critical E2E | Tất cả P0 flow pass |
| Regression manual P0/P1 | QA xác nhận |
| A11y baseline | Không có lỗi blocker |
| Responsive baseline | Desktop/tablet/mobile P0 pass |
| Performance budget | Không vượt ngưỡng nghiêm trọng |
| Security frontend checklist | Pass |
| UAT checklist | Product/Stakeholder xác nhận |
| Rollback plan | Có và đã thử ở staging nếu cần |

---

## 11. Test environment strategy

### 11.1 Môi trường test

| Môi trường | Mục đích | Dữ liệu |
| --- | --- | --- |
| Local | Dev test cá nhân | Mock/MSW hoặc dev API |
| Development | Tích hợp FE/BE hằng ngày | Seed dev |
| Staging | QA/UAT/release candidate | Seed gần production, không dùng dữ liệu thật nhạy cảm |
| Production | Người dùng thật | Dữ liệu thật |

### 11.2 Nguyên tắc dữ liệu test

1. Không dùng dữ liệu cá nhân thật trong local/dev nếu không được phép.
2. Staging cần có bộ seed đủ role/permission/scope: Employee, Manager, HR, Admin, Super Admin.
3. Mỗi module cần có dữ liệu trạng thái đầy đủ: empty, normal, pending, approved, rejected, conflict, out-of-scope.
4. E2E test nên dùng test user riêng, có prefix rõ để cleanup.
5. Không để E2E test phụ thuộc vào dữ liệu ngày giờ không kiểm soát. Với ATT/LEAVE cần seed ngày/ca/rule phù hợp.
6. Test data phải có employee thuộc nhiều phòng ban/team để kiểm thử data scope.

### 11.3 Test account matrix

| Actor | Role seed | Scope cần có | Dùng để test |
| --- | --- | --- | --- |
| Employee A | EMPLOYEE | Own | Login, profile, check-in, leave, my task, notification |
| Employee B | EMPLOYEE | Own | Dữ liệu khác scope của Employee A |
| Manager A | MANAGER | Team | Approve leave team, team attendance, task team |
| HR A | HR | Company | Employee management, leave company, attendance company |
| Admin A | ADMIN | Company/System tùy MVP | User/role/system config |
| Locked User | EMPLOYEE locked | None | Login/account locked behavior |
| No Permission User | Custom role rỗng | None | Forbidden/empty app behavior |

---

## 12. Defect severity

| Severity | Định nghĩa | Ví dụ | Release rule |
| --- | --- | --- | --- |
| S1 - Blocker | Không thể dùng chức năng lõi hoặc lộ dữ liệu | Không login được, user xem dữ liệu ngoài scope, check-in sai, approve sai người | Không release |
| S2 - Critical | Lỗi lớn ở P0/P1 có workaround khó | Tạo leave bị lỗi với một loại nghỉ, notification deep link sai route | Không release trừ khi có waiver rõ |
| S3 - Major | Lỗi ảnh hưởng nhưng có workaround | Filter sai ở màn P1, toast thiếu rõ, table pagination lỗi phụ | Có thể release nếu được Product/QA chấp thuận |
| S4 - Minor | Lỗi nhỏ/cosmetic | Spacing, label, icon, text chưa tối ưu | Có thể release |
| S5 - Enhancement | Đề xuất cải tiến | Thêm shortcut, tối ưu UX | Backlog |

---

## 13. Unit test strategy

### 13.1 Phạm vi unit test bắt buộc

| Nhóm | Cần test |
| --- | --- |
| Permission utility | `can`, `canAny`, `canAll`, `hasScope`, `checkRequirement` |
| Route guard logic | Public/protected, missing permission, missing scope, disabled module |
| App/sidebar/action registry filter | Ẩn/hiện app/menu/action theo permission |
| Error mapper | 401/403/404/409/422/500 -> UI behavior |
| API response parser | Success/error/validation/pagination |
| Query key factory | Key ổn định, không lẫn user/company/module |
| Form schema | Zod schema cho login, leave request, task, HR form |
| Formatter | Date/time, status label, employee name, file size |
| Business UI helper | allowed action mapping, status transition label |

### 13.2 Ví dụ unit test cần có

```text
permissionChecker
  -> returns true when user has exact permission
  -> returns false when permission missing
  -> returns true when any permission matches
  -> returns false when scope does not intersect
  -> does not treat role name as permission
```

```text
errorMapper
  -> maps 401 to auth expired behavior
  -> maps 403 to forbidden state
  -> maps 409 to conflict alert
  -> maps 422 to validation field errors
  -> maps 500 to retryable error state
```

---

## 14. Component test strategy

### 14.1 Component foundation

| Component | Test chính |
| --- | --- |
| Button | loading, disabled, keyboard, aria |
| Input/FormField | label, error, helper, required |
| Select/Combobox | search, keyboard, empty |
| DataTable | loading, empty, pagination, sort, row action |
| Modal/Drawer | open/close, focus trap, escape, confirm |
| Toast/Alert | message, variant, close |
| PermissionGate | hide/disable/forbidden behavior |
| MaskedField | mask khi thiếu quyền, raw khi có quyền |
| EmptyState/ErrorState/Skeleton | state render đúng |

### 14.2 Layout component

| Layout | Test chính |
| --- | --- |
| AuthLayout | render form, responsive, build env indicator ở dev nếu có |
| HomePortalLayout | app grid, recent/favorite, app search, empty apps |
| ModuleWorkspaceLayout | topbar, sidebar, breadcrumb, content shell, app switcher |
| GlobalTopbar | notification badge, user menu, app switcher button |
| Sidebar | active state, collapse, badge, permission filter |
| AppSwitcher | open/close, search, locked app, dirty form confirm |

### 14.3 Domain component

| Module | Component | Test chính |
| --- | --- | --- |
| ATT | AttendanceStatusCard | can check-in/out, blocked by leave, missing checkout |
| LEAVE | LeaveRequestForm | validation, balance preview, file upload, dirty guard |
| LEAVE | ApprovalBox | approve/reject visible/disabled by status/permission |
| TASK | TaskCard | priority, deadline, overdue, assignee |
| TASK | CommentThread | create comment, mention display, empty state |
| NOTI | NotificationDropdown | unread/read, mark read, target link |
| HR | EmployeeProfileHeader | sensitive field mask, status badge |
| SYSTEM | RolePermissionMatrix | dirty state, scope select, diff preview |

---

## 15. Integration test strategy

Integration test tập trung vào tương tác giữa component, form, API mock, query cache và route state.

### 15.1 Phạm vi integration test bắt buộc

| Flow | Cần test |
| --- | --- |
| Login success | Submit -> call API -> load `/auth/me` -> redirect `/home` |
| Login fail | 401/locked account -> error message đúng |
| Logout | call API -> clear auth context -> clear query cache -> redirect login |
| Home app load | load app registry/modules -> filter by permission -> open app |
| Check-in | mutation success -> invalidate today attendance + dashboard if needed |
| Leave request submit | validation -> preview -> submit -> success redirect/detail |
| Leave approve/reject | mutation -> update list/detail/badge |
| Task update status | mutation -> invalidate task list/detail/dashboard |
| Notification mark read | mutation -> update unread count/dropdown |
| Forbidden API | 403 -> ForbiddenState, không hiển thị dữ liệu cũ |
| Validation API | 422 -> map field errors vào form |
| Conflict API | 409 -> alert conflict + refetch target record |

### 15.2 MSW handler convention

Mỗi module nên có mock handler riêng:

```text
src/modules/auth/mocks/auth.handlers.ts
src/modules/dashboard/mocks/dashboard.handlers.ts
src/modules/hr/mocks/hr.handlers.ts
src/modules/attendance/mocks/attendance.handlers.ts
src/modules/leave/mocks/leave.handlers.ts
src/modules/tasks/mocks/tasks.handlers.ts
src/modules/notifications/mocks/notifications.handlers.ts
src/modules/system/mocks/system.handlers.ts
```

Mỗi handler cần hỗ trợ:

1. Success response.
2. 401 unauthenticated.
3. 403 forbidden.
4. 409 conflict nếu workflow có state transition.
5. 422 validation nếu là form.
6. 500 server error cho ErrorState.
7. Empty list nếu là màn danh sách.

---

## 16. E2E test strategy

### 16.1 Nguyên tắc E2E

1. E2E chỉ test flow quan trọng, không thay thế unit/component test.
2. E2E nên chạy trên staging/RC với backend thật hoặc mock API ổn định tùy giai đoạn.
3. E2E phải có test data setup/teardown rõ.
4. E2E cần dùng selector ổn định, ưu tiên `data-testid` có screen/action code.
5. Không assert theo layout quá chi tiết nếu đã có visual test riêng.
6. Mỗi E2E phải ghi rõ actor, permission, entry route, expected output.

### 16.2 Data-testid convention

Format:

```text
[screen-code]__[element-name]
```

Ví dụ:

```text
AUTH-LOGIN__email-input
AUTH-LOGIN__password-input
AUTH-LOGIN__submit-button
HOME-PORTAL__app-card-attendance
ATT-TODAY__check-in-button
LEAVE-CREATE__submit-button
LEAVE-APPROVALS__approve-button
TASK-DETAIL__status-select
NOTI-DROPDOWN__mark-all-read-button
SYSTEM-ROLE-PERMISSIONS__save-button
```

### 16.3 E2E critical suite P0

| Mã | Flow | Actor | Tag |
| --- | --- | --- | --- |
| FE14-E2E-001 | Login success -> Home Portal | Employee | `@critical @smoke` |
| FE14-E2E-002 | Login fail / locked account | Locked User | `@critical` |
| FE14-E2E-003 | Home Portal -> mở app Chấm công | Employee | `@critical @smoke` |
| FE14-E2E-004 | App Switcher đổi module | Employee | `@critical` |
| FE14-E2E-005 | Direct URL trái quyền -> Forbidden | No Permission User | `@critical @security` |
| FE14-E2E-006 | Check-in thành công | Employee | `@critical` |
| FE14-E2E-007 | Check-in bị chặn do nghỉ phép approved | Employee | `@critical` |
| FE14-E2E-008 | Tạo và gửi đơn nghỉ phép | Employee | `@critical` |
| FE14-E2E-009 | Manager duyệt đơn nghỉ | Manager | `@critical` |
| FE14-E2E-010 | Manager từ chối đơn nghỉ | Manager | `@critical` |
| FE14-E2E-011 | Xem task của tôi -> cập nhật trạng thái | Employee | `@critical` |
| FE14-E2E-012 | Notification dropdown -> mark read -> deep link | Employee/Manager | `@critical` |
| FE14-E2E-013 | Logout clear session/cache | Employee | `@critical @security` |

### 16.4 E2E P1 regression suite

| Mã | Flow | Actor |
| --- | --- | --- |
| FE14-E2E-101 | HR xem danh sách nhân viên + filter | HR |
| FE14-E2E-102 | HR xem employee detail có field nhạy cảm | HR |
| FE14-E2E-103 | Employee xem My Profile + gửi profile change request | Employee |
| FE14-E2E-104 | Manager xem bảng công team | Manager |
| FE14-E2E-105 | Employee gửi attendance adjustment request | Employee |
| FE14-E2E-106 | Manager duyệt attendance adjustment | Manager |
| FE14-E2E-107 | Leave calendar team/company theo quyền | Manager/HR |
| FE14-E2E-108 | Task comment + mention | Employee |
| FE14-E2E-109 | Dashboard Employee load widget | Employee |
| FE14-E2E-110 | Dashboard Manager load pending approvals/task team | Manager |
| FE14-E2E-111 | System user list/role list accessible by Admin | Admin |
| FE14-E2E-112 | Role-permission matrix save diff | Admin |

---

## 17. Test matrix theo module

### 17.1 AUTH & Account

| Nhóm | Test bắt buộc |
| --- | --- |
| Login | Success, wrong password, locked account, inactive company, loading, validation |
| Session | App reload, expired token, refresh success, refresh fail |
| Logout | Clear auth context, query cache, redirect login |
| Forgot/reset password | Request reset, invalid token, expired token, success |
| Account profile | View/update allowed fields, validation |
| Change password | Old password wrong, weak password, success |
| Sessions | List active sessions, revoke session nếu MVP có |
| Permission | Không hard-code role, route/action by permission |

### 17.2 Home Portal & App Switcher

| Nhóm | Test bắt buộc |
| --- | --- |
| App registry | Chỉ hiện app có quyền/module active |
| App search | Search tên tiếng Việt, tiếng Anh, module code, no result |
| Recent/favorite | Add/remove favorite nếu MVP có |
| Locked/coming soon | Không lộ dữ liệu nghiệp vụ |
| Open app | Vào default route đúng quyền |
| App Switcher | Open/close, search, switch app, dirty form guard |
| Responsive | Desktop overlay, tablet drawer, mobile fullscreen |
| Forbidden | User không có app -> empty/forbidden phù hợp |

### 17.3 Dashboard

| Nhóm | Test bắt buộc |
| --- | --- |
| Dashboard type | Employee, Manager, HR, Admin theo quyền |
| Widget visibility | Theo permission/data scope |
| Widget data | Load/lazy load/refresh/cache/stale |
| Quick action | Điều hướng module gốc, không xử lý nghiệp vụ trực tiếp |
| Source error | Degraded state khi module nguồn lỗi |
| Notification widget | Unread count/list cập nhật |
| Responsive | 12 cột desktop, 2 cột tablet, 1 cột mobile nếu theo thiết kế |

### 17.4 HR

| Nhóm | Test bắt buộc |
| --- | --- |
| Employee list | Search/filter/sort/pagination/scope |
| Employee detail | Field visible/masked theo quyền |
| Create/update employee | Validation, duplicate, employee code auto/manual rule |
| Status change | Active/probation/resigned/inactive behavior |
| My Profile | Own data only |
| Profile change request | Employee submit, HR approve/reject, dữ liệu chính chỉ đổi sau approve |
| Department/position | CRUD, tree/list, duplicate validation |
| Contract/file | Upload/download/delete permission |
| Org chart | Scope + empty state |

### 17.5 Attendance

| Nhóm | Test bắt buộc |
| --- | --- |
| Today attendance | Can check-in/out, already checked, missing checkout, blocked by leave |
| Check-in/out | Idempotency, double click, success, business error |
| Records | My/team/company, filter by date/employee/status |
| Adjustment request | Submit, validation, file proof, approve/reject |
| Manual adjustment | HR/Admin permission only |
| Shift/rule | Create/update, assignment company/department/employee |
| Remote work | Create/approve/reject, auto attendance or remote check-in rule |
| Dashboard sync | Widget trạng thái cập nhật sau mutation |

### 17.6 Leave

| Nhóm | Test bắt buộc |
| --- | --- |
| Balance | My balance, admin balance, empty/no policy |
| Create request | Full-day, half-day, hourly, multi-day, file, validation |
| Calculation preview | Balance, public holiday, conflict, insufficient balance |
| Draft/submit/cancel | State transition đúng |
| Approval | Manager/HR scope, approve/reject reason, conflict already processed |
| Calendar | Own/team/company scope |
| Type/policy | CRUD, disabled type, validation |
| ATT sync UX | Approved leave làm ATT blocked/updated |
| Notification | Submit/approved/rejected/cancelled events hiển thị |

### 17.7 Task

| Nhóm | Test bắt buộc |
| --- | --- |
| Project list/detail | Scope, members, status |
| Task list/my tasks | Filter, sort, status, priority, due date |
| Task detail | Summary, assignee, watcher, file, comment, checklist |
| Status update | Permission, business state, optimistic/loading |
| Assignment | Assignee active employee, warning if on leave |
| Kanban | Load board, change status, permission |
| Comment/mention | Create/edit/delete, mention notification |
| Checklist | Add/update/complete/delete item |
| File | Upload/download/delete permission |

### 17.8 Notification

| Nhóm | Test bắt buộc |
| --- | --- |
| Dropdown | Unread count, latest list, loading/empty/error |
| List | Filter read/unread/type, pagination |
| Detail | Mark read, target link |
| Mark read/all read | Count update, no flicker |
| Deep link | Route module gốc, guard lại permission |
| Target unavailable | Disabled/error state |
| Admin config | Event/template/channel nếu MVP có |
| Polling/realtime | Unread count update strategy theo cấu hình |

### 17.9 System/Foundation

| Nhóm | Test bắt buộc |
| --- | --- |
| Users | List/create/update/lock/unlock/scope |
| Roles | List/detail/create/update |
| Permissions | Matrix, scope assignment, diff preview |
| Settings | Company/system settings, validation, feature flag |
| Module catalog | Active/disabled/coming soon behavior |
| Audit logs | Filter, detail, sensitive masking |
| Files | Metadata, download permission, access error |
| Public holidays | CRUD nếu MVP có UI |

---

## 18. Permission & data scope QA

### 18.1 Permission test rule

Mỗi màn/action quan trọng phải test ít nhất 3 actor:

```text
1. User có quyền và đúng scope
2. User có quyền nhưng sai scope
3. User không có quyền
```

### 18.2 Permission matrix QA tối thiểu

| Khu vực | Có quyền | Sai scope | Không quyền |
| --- | --- | --- | --- |
| App card | Hiện | Có thể hiện nhưng dữ liệu empty hoặc theo policy | Ẩn/locked theo policy |
| Sidebar item | Hiện | Hiện nếu route có quyền nhưng dữ liệu scope rỗng | Ẩn |
| Direct URL | Render page | Forbidden/empty due to scope | Forbidden/redirect |
| Button/action | Enabled nếu business rule cho phép | Disabled/hidden | Hidden/disabled |
| Field nhạy cảm | Raw value | Masked/hidden nếu không đủ field permission | Masked/hidden |
| API 403 | Không xảy ra nếu UI đúng | Phải hiển thị Forbidden/empty an toàn | Forbidden, clear stale data |

### 18.3 Các lỗi permission bị cấm release

1. User xem được dữ liệu employee ngoài scope.
2. User thao tác approve/reject leave ngoài scope.
3. User thấy raw field nhạy cảm qua network dù UI mask.
4. User truy cập direct URL trái quyền và thấy dữ liệu trước khi redirect.
5. Cache sau logout vẫn hiển thị dữ liệu user trước.
6. Notification deep link bỏ qua module guard.
7. Role name bị hard-code làm sai quyền khi admin đổi role-permission.

---

## 19. Error handling QA

### 19.1 HTTP/API error matrix

| Error | UI bắt buộc |
| --- | --- |
| 400 | Hiển thị error message chung hoặc field nếu có details |
| 401 | Refresh token một lần, fail thì logout/redirect login |
| 403 | ForbiddenState, không lộ dữ liệu cũ |
| 404 | NotFoundState hoặc record not found |
| 409 | Conflict alert, refetch record/list nếu cần |
| 422 | Inline validation + error summary |
| 429 | Rate limit message, retry after nếu backend trả |
| 500 | ErrorState + retry + request id |
| Network error | Offline/network message + retry |
| Timeout | Retry CTA hoặc message rõ |

### 19.2 Query stale/error behavior

| Case | UI behavior |
| --- | --- |
| Initial load fail | ErrorState full section/page |
| Refetch fail nhưng có data cũ | Stale/degraded badge + giữ data cũ nếu an toàn |
| Mutation fail | Không update UI sai, rollback optimistic nếu có |
| 403 sau refetch | Clear sensitive data và show Forbidden |
| Logout | Clear toàn bộ sensitive query cache |

---

## 20. Form QA

### 20.1 Form behavior chung

Mọi form P0/P1 phải test:

1. Required field.
2. Invalid format.
3. Min/max length.
4. Date/time invalid.
5. Server validation 422.
6. Submit loading state.
7. Double submit prevention.
8. Dirty form guard khi rời màn/đổi app.
9. Save success và navigation sau success.
10. Error không làm mất dữ liệu đã nhập.
11. File upload progress/error nếu có file.
12. Permission làm field hidden/disabled/masked đúng.

### 20.2 Form theo module

| Module | Form quan trọng |
| --- | --- |
| AUTH | Login, forgot password, reset password, change password |
| HR | Employee form, profile change request, contract, department, position |
| ATT | Adjustment request, remote work request, shift, rule |
| LEAVE | Leave request, leave approval reject reason, policy, balance adjustment |
| TASK | Project form, task form, comment, checklist item |
| NOTI | Template/event/channel config nếu MVP có |
| SYSTEM | User, role, permission matrix, company settings |

---

## 21. Responsive QA

### 21.1 Breakpoint tối thiểu

| Viewport | Mục tiêu test |
| --- | --- |
| Desktop large | 1440px trở lên |
| Desktop normal | 1280px |
| Tablet | 768px - 1024px |
| Mobile web | 375px - 430px |

### 21.2 Responsive rule

| Khu vực | Desktop | Tablet | Mobile web |
| --- | --- | --- | --- |
| Home Portal | App grid nhiều cột | 2-3 cột | 1 cột / grid compact |
| App Switcher | Overlay/modal lớn | Drawer hoặc modal | Fullscreen |
| Module Workspace | Sidebar đầy đủ/collapsible | Sidebar collapsed/drawer | Bottom/top nav hoặc drawer theo thiết kế |
| DataTable | Table đầy đủ | Table compact/horizontal scroll | Card list hoặc horizontal scroll an toàn |
| Form | 2 cột nếu phù hợp | 1-2 cột | 1 cột |
| Dashboard | 12 cột | 2 cột | 1 cột |
| Kanban | Multi-column | Horizontal scroll | Column stack/horizontal scroll |
| Modal/Drawer | Center/drawer | Drawer | Fullscreen hoặc bottom sheet |

### 21.3 Responsive release blocker

1. Mobile P0 flow không thể hoàn thành.
2. Button quan trọng bị che hoặc không bấm được.
3. Modal không scroll được.
4. Table/list làm tràn viewport không kiểm soát.
5. App Switcher không dùng được trên mobile.
6. Form submit bị che bởi keyboard hoặc footer sticky sai.

---

## 22. Accessibility QA

### 22.1 A11y baseline MVP

MVP tối thiểu phải đạt:

1. Tất cả button/input/select có accessible name.
2. Form field có label rõ.
3. Error message liên kết với field nếu có thể.
4. Modal/drawer có focus trap và close bằng Escape nếu phù hợp.
5. Dropdown/menu có keyboard navigation cơ bản.
6. Focus visible rõ.
7. Không chỉ dùng màu để truyền trạng thái.
8. Status badge có text label.
9. Icon-only button có `aria-label`.
10. Heading hierarchy không lộn xộn nghiêm trọng.
11. Contrast đủ dùng cho text/action chính.
12. Toast/alert quan trọng có role phù hợp.

### 22.2 A11y test target P0

| Flow | A11y cần test |
| --- | --- |
| Login | Keyboard submit, label, error |
| Home Portal | App card focus, search, keyboard open app |
| App Switcher | Focus trap, search, close, select app |
| Attendance Today | Button focus, alert state |
| Leave Create | Form label/error, date picker keyboard cơ bản |
| Leave Approval | Modal confirm/reject reason focus |
| Task Detail | Comment input, status select, checklist |
| Notification Dropdown | Keyboard open/close, unread item label |

---

## 23. Performance strategy

### 23.1 Performance goals MVP

Performance của frontend MVP cần hướng tới:

1. User vào được Home Portal nhanh sau login.
2. Module Workspace không bị trắng màn lâu.
3. Dashboard widget load theo từng phần, không chờ tất cả module nguồn.
4. DataTable lớn không làm treo UI.
5. App Switcher mở gần như tức thời.
6. Notification badge/dropdown nhẹ, không gây refetch quá mức.
7. Route chunk được lazy load theo module.
8. Không bundle toàn bộ HR/ATT/LEAVE/TASK/NOTI vào initial load nếu không cần.

### 23.2 Performance budget đề xuất

| Khu vực | Budget đề xuất MVP | Ghi chú |
| --- | --- | --- |
| Initial JS shared bundle | Không tăng bất thường qua từng sprint; cần review khi vượt ngưỡng nội bộ | Đặt budget cụ thể sau khi có baseline build đầu tiên |
| Route chunk module | Lazy load theo module; tránh import chéo nặng | HR/ATT/LEAVE/TASK không nên kéo nhau vào cùng chunk |
| Home Portal load | Hiển thị skeleton/app shell nhanh, app registry load riêng | Không chờ dashboard/widget |
| App Switcher open | Không gọi API blocking khi mở nếu registry đã có cache | Có thể refetch nền |
| Dashboard | Widget lazy load, mỗi widget có state riêng | Module nguồn lỗi không làm hỏng toàn dashboard |
| DataTable | Pagination server-side, không render hàng nghìn row cùng lúc | Virtualization nếu danh sách rất lớn |
| Search/filter | Debounce input, query params whitelist | Không refetch từng ký tự ngay lập tức |
| Mutation action | Button loading ngay, chống double submit | Có idempotency key cho action quan trọng |
| Notification unread | Polling hợp lý hoặc realtime phase sau | Không poll quá dày |

### 23.3 Web UX metrics nội bộ

| Metric | Target nội bộ MVP | Áp dụng |
| --- | --- | --- |
| LCP-like | Trang P0 nên có nội dung chính hiển thị nhanh, ưu tiên skeleton + shell | Login, Home, Dashboard, Attendance Today |
| CLS-like | Không layout shift lớn khi load widget/table | Home, Dashboard, Table pages |
| INP-like | Click/input/action quan trọng phản hồi nhanh | App Switcher, form, check-in/out, approve |
| Route transition | Chuyển module có loading state rõ, không trắng màn | Home -> Module, App Switcher -> Module |
| API perceived latency | Nếu chậm phải có loading/skeleton/progress | List, dashboard, form submit |

Không dùng các con số này như cam kết production tuyệt đối khi chưa có dữ liệu thực tế. Sau sprint đầu tiên có build thật, cần đo baseline rồi cập nhật budget cụ thể.

### 23.4 Performance test route P0

| Route/Flow | Cần đo |
| --- | --- |
| `/login` | Load form, submit feedback |
| `/home` | App registry load, app grid render |
| `/dashboard` | Shell load, widget lazy load, degraded state |
| `/attendance/today` | Today status, check-in/out mutation feedback |
| `/leave/requests/new` | Form render, date picker, calculation preview |
| `/leave/approvals` | List + detail + approve/reject |
| `/tasks/my-tasks` | List/filter, task detail |
| `/notifications` + dropdown | Unread count, list render |
| `/system/roles/:id/permissions` | Permission matrix render/save |

### 23.5 Bundle optimization checklist

1. Route-level code splitting theo module.
2. Dynamic import cho chart/large table/kanban/permission matrix nếu nặng.
3. Không import toàn bộ icon library nếu có thể tree-shake.
4. Không import utility library lớn cho một hàm nhỏ.
5. Tách mock/dev tool khỏi production bundle.
6. Không bundle Storybook/dev-only vào production.
7. Lazy load editor/rich text nếu comment/task cần.
8. Lazy load chart library cho dashboard/report.
9. Dùng server-side pagination thay vì load toàn bộ list.
10. Bundle report phải được review trước RC.

### 23.6 Render performance checklist

1. DataTable dùng pagination server-side.
2. Filter/search debounce.
3. Memo hóa column definition nếu cần.
4. Không set state vòng lặp trong render.
5. Không refetch toàn bộ dashboard sau mỗi mutation nhỏ nếu chỉ cần invalidate widget liên quan.
6. Query key ổn định, không chứa object mới mỗi render.
7. Tránh prop drilling quá sâu cho table/list lớn.
8. Virtualization cho list/permission matrix lớn nếu render chậm.
9. Skeleton thay vì spinner toàn trang khi có thể.
10. Error boundary cho module/widget nặng.

---

## 24. API/query performance QA

### 24.1 Query behavior cần kiểm tra

| Case | Yêu cầu |
| --- | --- |
| Load list | Có pagination, filter, sort đúng query params |
| Search | Debounce, không spam API |
| Refresh dashboard | Chỉ refresh widget/endpoint cần thiết |
| Notification unread | Không polling quá dày, không tạo race condition |
| Mutation success | Invalidate query đúng scope, không refetch toàn app |
| Logout | Clear cache nhạy cảm |
| User switch | Không hiển thị dữ liệu user trước |
| Tab/window reload | Session bootstrap đúng |

### 24.2 Query anti-pattern bị cấm

1. Gọi API trực tiếp bằng `fetch` rời rạc trong module, bỏ qua API client chung.
2. Dùng query key không ổn định gây refetch liên tục.
3. Refetch toàn bộ dashboard sau mọi mutation.
4. Cache dữ liệu nhạy cảm sau logout.
5. Gửi `company_id`, `user_id`, `employee_id` từ frontend khi backend có thể resolve từ auth context.
6. Gọi API list không pagination cho bảng lớn.
7. Search không debounce.
8. Swallow error khiến user không biết request lỗi.

---

## 25. Frontend security checklist

### 25.1 Token/session

| Checklist | Bắt buộc |
| --- | --- |
| Không lưu token nhạy cảm trong localStorage nếu có thể tránh | Có |
| Refresh token ưu tiên HttpOnly Secure SameSite cookie | Có nếu backend hỗ trợ |
| Nếu dùng memory token, clear khi logout/tab close theo strategy | Có |
| 401 chỉ refresh một lần bằng refresh lock | Có |
| Logout clear auth context và query cache | Có |
| Không log token, cookie, Authorization header | Có |

### 25.2 Sensitive data

| Checklist | Bắt buộc |
| --- | --- |
| Field nhạy cảm chỉ hiển thị khi backend cho phép | Có |
| MaskedField không được xem là bảo mật cuối cùng | Có |
| 403 phải clear dữ liệu cũ khỏi màn nếu dữ liệu nhạy cảm | Có |
| Không lưu employee profile/permission nhạy cảm vào localStorage | Có |
| Không gửi dữ liệu nhạy cảm vào analytics/log frontend | Có |
| File private không expose permanent URL | Có |

### 25.3 XSS/basic web safety

| Checklist | Bắt buộc |
| --- | --- |
| Không render HTML raw từ API nếu chưa sanitize | Có |
| Comment/task description nếu hỗ trợ rich text phải sanitize | Có |
| URL target từ notification phải resolve qua route registry, không redirect tùy tiện | Có |
| File name hiển thị phải escape an toàn | Có |
| Không dùng `dangerouslySetInnerHTML` trừ khi có lý do và review | Có |
| CSP/security headers phối hợp với backend/DevOps | Nên có |

### 25.4 Permission/data scope security

| Checklist | Bắt buộc |
| --- | --- |
| Không hard-code role | Có |
| Route/action/menu theo permission metadata | Có |
| Direct URL trái quyền bị chặn | Có |
| Notification deep link qua module guard | Có |
| Dashboard quick action qua module gốc | Có |
| API 403/409/422 xử lý an toàn | Có |

---

## 26. Release branch & versioning

### 26.1 Branching đề xuất

| Branch | Vai trò |
| --- | --- |
| `main` | Production-ready |
| `develop` | Tích hợp hằng ngày |
| `feature/*` | Feature branch |
| `bugfix/*` | Fix lỗi trước release |
| `release/mvp-1.0.0` | Release candidate |
| `hotfix/*` | Sửa production khẩn cấp |

### 26.2 Versioning

MVP frontend dùng semantic version:

```text
MAJOR.MINOR.PATCH
```

Ví dụ:

```text
1.0.0-rc.1
1.0.0-rc.2
1.0.0
1.0.1
```

### 26.3 Build metadata

Mỗi build nên có:

| Metadata | Ví dụ |
| --- | --- |
| App version | `1.0.0-rc.1` |
| Build commit | Git SHA |
| Build time | ISO datetime |
| Environment | local/dev/staging/production |
| API base URL | Không hiển thị public nếu nhạy cảm; chỉ trong debug/dev |
| Feature flags | Snapshot config nếu cần debug |

Build metadata có thể hiển thị ở:

```text
/system/about
debug panel local/dev
error report payload
```

---

## 27. Environment readiness checklist

### 27.1 `.env.example`

Bắt buộc có `.env.example` cập nhật:

```env
VITE_APP_NAME="Enterprise Management System"
VITE_APP_ENV="local"
VITE_API_BASE_URL="http://localhost:3000/api/v1"
VITE_INTERNAL_BUILD_VERSION="0.1.0"
VITE_ENABLE_MOCK_API="false"
VITE_ENABLE_DEBUG_PANEL="true"
VITE_ENABLE_TELEMETRY="false"
VITE_ENABLE_E2E_TEST_MODE="false"
```

### 27.2 Env validation

Frontend build phải validate env tối thiểu:

1. `VITE_API_BASE_URL` có giá trị.
2. `VITE_APP_ENV` thuộc enum hợp lệ.
3. Production không bật mock API.
4. Production không bật debug panel công khai.
5. Không có secret trong biến `VITE_`.
6. API base URL đúng môi trường.

### 27.3 Staging readiness

| Checklist | Bắt buộc |
| --- | --- |
| Staging API ổn định | Có |
| Seed test data đủ actor/scope | Có |
| Email/reset password sandbox nếu có | Có |
| File upload/download sandbox | Có nếu test file |
| Notification event seed/template | Có |
| Public holidays/shift/leave policy seed | Có |
| Feature flags khớp MVP | Có |
| Error tracking staging | Nên có |

---

## 28. Release candidate process

### 28.1 Các bước tạo RC

```text
1. Freeze scope MVP
2. Merge các feature đã được review vào develop
3. Tạo branch release/mvp-1.0.0
4. Cập nhật version/build metadata
5. Chạy qa:rc
6. Deploy staging RC
7. Chạy E2E critical trên staging
8. QA manual regression P0/P1
9. Product/UAT review
10. Fix blocker/critical nếu có
11. Tạo RC tiếp theo nếu cần
12. Sign-off go/no-go
13. Deploy production
14. Monitor sau release
```

### 28.2 RC naming

```text
1.0.0-rc.1
1.0.0-rc.2
1.0.0-rc.3
```

Mỗi RC cần có changelog:

| Mục | Nội dung |
| --- | --- |
| Version | `1.0.0-rc.1` |
| Commit | Git SHA |
| Feature included | Danh sách feature |
| Known issues | Lỗi còn lại |
| Test result | Pass/fail summary |
| Owner sign-off | FE/QA/Product/BE/DevOps |

---

## 29. UAT checklist

### 29.1 UAT theo actor

| Actor | Flow UAT bắt buộc |
| --- | --- |
| Employee | Login, Home, check-in/out, my attendance, create leave, my task, notification |
| Manager | Team dashboard, approve leave, team attendance, task team, notification deep link |
| HR | Employee management, profile change approval, attendance company, leave company |
| Admin | User/role/permission, module/settings, audit logs |

### 29.2 UAT acceptance

UAT được xem là đạt khi:

1. Actor hoàn thành các flow P0 không cần hỗ trợ kỹ thuật.
2. Không có S1/S2 mở.
3. Các lỗi S3 có workaround hoặc được Product chấp nhận.
4. Copy/label chính ở P0 rõ ràng.
5. Responsive P0 đủ dùng cho mobile web nếu thuộc phạm vi MVP.
6. Stakeholder đồng ý release MVP với known issues hiện tại.

---

## 30. Go/no-go criteria

### 30.1 Go criteria

Chỉ được release khi đạt toàn bộ điều kiện sau:

| Nhóm | Tiêu chí |
| --- | --- |
| Build | Production build pass |
| Lint/typecheck | Pass |
| Unit/component/integration | Pass hoặc chỉ còn lỗi không liên quan và được approve |
| E2E P0 | 100% pass |
| Manual regression P0 | 100% pass |
| Manual regression P1 | >= 95% pass hoặc lỗi còn lại có workaround |
| Security frontend | Không có lỗi blocker |
| Permission/data scope | Không có lỗi lộ dữ liệu/sai quyền |
| Accessibility baseline | Không có blocker ở P0 |
| Responsive P0 | Pass desktop + mobile/tablet theo scope |
| Performance | Không có regression nghiêm trọng so với baseline |
| UAT | Product/Stakeholder sign-off |
| Rollback | Có kế hoạch rollback rõ |
| Monitoring | Error tracking/logging release ready |

### 30.2 No-go criteria

Không release nếu có bất kỳ điều kiện nào:

1. Không login được hoặc session/refresh lỗi nghiêm trọng.
2. User có thể xem dữ liệu ngoài quyền/scope.
3. Check-in/check-out sai trạng thái hoặc double submit gây sai nghiệp vụ.
4. Leave approve/reject sai scope hoặc sai state transition.
5. Notification deep link bỏ qua guard và lộ dữ liệu.
6. Logout không clear dữ liệu nhạy cảm.
7. Production build fail.
8. E2E P0 fail chưa có workaround được Product chấp thuận.
9. Mobile P0 không thể hoàn thành nếu mobile web nằm trong scope release.
10. Không có rollback plan.

---

## 31. Rollback plan

### 31.1 Nguyên tắc rollback

1. Frontend release phải có version/tag rõ.
2. Có thể rollback về bản production trước trong thời gian ngắn.
3. Feature flag nên dùng cho tính năng rủi ro cao.
4. Không deploy frontend phụ thuộc API chưa backward-compatible.
5. Nếu API thay đổi breaking, phải có kế hoạch phối hợp backend.

### 31.2 Khi nào rollback

Rollback nếu sau production phát hiện:

| Case | Hành động |
| --- | --- |
| S1 security/data leak | Rollback ngay + khóa feature nếu cần |
| Login toàn hệ thống lỗi | Rollback ngay |
| Route guard/permission lỗi nghiêm trọng | Rollback hoặc disable module |
| Check-in/leave/task P0 lỗi diện rộng | Rollback hoặc feature flag off |
| UI cosmetic lỗi nhỏ | Không rollback, hotfix sau |
| Performance chậm nhưng dùng được | Hotfix nếu không ảnh hưởng nghiêm trọng |

### 31.3 Rollback checklist

```text
1. Xác định version hiện tại và version ổn định trước đó
2. Thông báo team/owner
3. Kiểm tra có migration/API dependency không
4. Deploy lại frontend artifact/tag trước đó
5. Verify login/home/module P0
6. Theo dõi error rate
7. Ghi incident report
8. Tạo hotfix/backlog xử lý nguyên nhân gốc
```

---

## 32. Post-release monitoring

### 32.1 Chỉ số cần theo dõi

| Nhóm | Metric |
| --- | --- |
| Stability | JS error rate, unhandled promise rejection, route crash |
| API UX | 401/403/409/422/500 rate theo route/module |
| Performance | Route load, web vitals nội bộ, slow interaction |
| Usage | Login count, module open, key action success |
| Notification | Unread dropdown load, mark read success/fail |
| Form | Validation error rate, submit fail rate |
| Permission | Forbidden route count, direct URL deny count |
| Release | Error theo version/build SHA |

### 32.2 Error payload nên có

Không log dữ liệu nhạy cảm. Payload nên có:

```json
{
  "app_version": "1.0.0",
  "build_sha": "abc123",
  "environment": "production",
  "route": "/leave/approvals",
  "screen_code": "LEAVE-SCREEN-APPROVALS",
  "module_code": "LEAVE",
  "error_code": "API_FORBIDDEN",
  "request_id": "req_xxx",
  "timestamp": "2026-06-20T10:00:00Z"
}
```

Không gửi:

1. Access token.
2. Refresh token.
3. Password.
4. Full employee profile nhạy cảm.
5. File private URL.
6. Raw API response chứa dữ liệu cá nhân.

### 32.3 Hypercare sau release

Trong 1-3 ngày đầu sau MVP release:

1. Theo dõi error dashboard thường xuyên.
2. Ưu tiên xử lý lỗi S1/S2 ngay.
3. Tổng hợp feedback từ Employee/Manager/HR/Admin.
4. Ghi known issues và workaround.
5. Tạo hotfix nếu lỗi ảnh hưởng flow P0.
6. Cập nhật test case nếu phát hiện lỗ hổng QA.

---

## 33. Checklist release tổng hợp

### 33.1 Code readiness

| Checklist | Done |
| --- | --- |
| Lint pass |  |
| Typecheck pass |  |
| Unit test pass |  |
| Component/integration test pass |  |
| E2E critical pass |  |
| Build production pass |  |
| Storybook build pass nếu release component lớn |  |
| No console/debug log production |  |
| No secret in frontend code/env |  |
| Version/build metadata đúng |  |

### 33.2 Functional readiness

| Checklist | Done |
| --- | --- |
| Login/logout/session refresh pass |  |
| Home Portal pass |  |
| App Switcher pass |  |
| Dashboard P0 widgets pass |  |
| HR P0 screens pass |  |
| Attendance P0 flow pass |  |
| Leave P0 flow pass |  |
| Task P0 flow pass |  |
| Notification P0 flow pass |  |
| System/Foundation P0 screens pass |  |
| Permission/data scope pass |  |
| Error states pass |  |

### 33.3 UX readiness

| Checklist | Done |
| --- | --- |
| Loading/empty/error/forbidden/validation states pass |  |
| Dirty form guard pass |  |
| Toast/alert copy acceptable |  |
| Responsive desktop pass |  |
| Responsive tablet pass cho P0 |  |
| Responsive mobile pass cho P0 |  |
| Accessibility baseline pass |  |
| Visual regression reviewed |  |

### 33.4 Performance readiness

| Checklist | Done |
| --- | --- |
| Bundle report reviewed |  |
| Initial load không tăng bất thường |  |
| Route chunk lazy load theo module |  |
| Dashboard lazy widget/fallback pass |  |
| DataTable pagination pass |  |
| Search debounce pass |  |
| App Switcher open không blocking |  |
| No excessive refetch/polling |  |

### 33.5 Security readiness

| Checklist | Done |
| --- | --- |
| Token handling reviewed |  |
| Logout clears auth/query cache |  |
| Direct URL forbidden pass |  |
| Sensitive field mask/backend behavior reviewed |  |
| File URL/private download reviewed |  |
| Notification deep link guard pass |  |
| Dashboard quick action guard pass |  |
| No raw HTML unsafe render |  |

### 33.6 Release readiness

| Checklist | Done |
| --- | --- |
| Staging deployed |  |
| UAT completed |  |
| Known issues documented |  |
| Product sign-off |  |
| QA sign-off |  |
| FE sign-off |  |
| BE/API compatibility sign-off |  |
| DevOps sign-off |  |
| Rollback plan ready |  |
| Monitoring ready |  |

---

## 34. Definition of Done cho FRONTEND-14

FRONTEND-14 được xem là hoàn thành khi:

1. Có QA strategy tổng thể cho frontend MVP.
2. Có test pyramid rõ ràng.
3. Có toolchain đề xuất cho unit, component, integration, E2E, accessibility, visual và performance.
4. Có quality gate cho PR, nightly/dev và release candidate.
5. Có test environment và test data strategy.
6. Có defect severity và release rule.
7. Có unit/component/integration/E2E strategy cụ thể.
8. Có E2E critical suite P0.
9. Có test matrix theo module AUTH, HOME, DASH, HR, ATT, LEAVE, TASK, NOTI, SYSTEM.
10. Có permission/data scope QA checklist.
11. Có error handling/form/responsive/accessibility QA checklist.
12. Có performance budget và performance checklist.
13. Có frontend security checklist.
14. Có release candidate process.
15. Có UAT checklist.
16. Có go/no-go criteria.
17. Có rollback plan.
18. Có post-release monitoring và hypercare guideline.
19. Có release checklist tổng hợp đủ để đội QA/FE/Product/DevOps dùng ngay.

---

## 35. Open questions cần chốt

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| FE14-OQ-001 | E2E test chạy với backend thật trên staging hay mock API có kiểm soát? | QA/FE/BE | Cao |
| FE14-OQ-002 | Dùng công cụ error tracking nào cho MVP? | DevOps/FE | Cao |
| FE14-OQ-003 | Có bắt buộc Lighthouse CI hoặc performance gate trong CI MVP không? | DevOps/FE | Trung bình |
| FE14-OQ-004 | Visual regression dùng tool nào, hay chỉ manual review trong MVP? | FE/UI/QA | Trung bình |
| FE14-OQ-005 | Mobile web P0 áp dụng cho toàn bộ actor hay ưu tiên Employee/Manager? | Product/QA | Cao |
| FE14-OQ-006 | Coverage threshold tối thiểu cho MVP là bao nhiêu? | QA/FE Lead | Trung bình |
| FE14-OQ-007 | Test data staging sẽ reset theo lịch hay giữ liên tục cho UAT? | QA/BE/DevOps | Cao |
| FE14-OQ-008 | Release approval cần chữ ký của những vai trò nào? | Product/Tech Lead | Trung bình |
| FE14-OQ-009 | Rollback frontend có thể thực hiện độc lập với backend trong bao nhiêu phút? | DevOps | Cao |
| FE14-OQ-010 | Có cần audit frontend event cho các action nhạy cảm hay chỉ dựa backend audit? | Product/Security | Thấp |

---

## 36. Kết luận

FRONTEND-14 chốt tiêu chuẩn kiểm thử, hiệu năng và sẵn sàng phát hành cho frontend MVP.

Tư duy triển khai chính:

```text
Test theo rủi ro nghiệp vụ
-> P0 journey phải pass tuyệt đối
-> Permission/data scope không được sai
-> Error/state/responsive/a11y phải đủ dùng
-> Performance có budget và baseline
-> Release có RC, UAT, sign-off, rollback
-> Production có monitoring và hypercare
```

Sau FRONTEND-14, dự án có thể chuyển sang một trong các hướng tiếp theo:

```text
1. Tạo QA test case chi tiết theo từng module
2. Thiết lập CI/CD pipeline thực tế
3. Dựng staging/UAT environment
4. Bắt đầu sprint implementation frontend
5. Chuẩn bị release MVP 1.0.0
```
