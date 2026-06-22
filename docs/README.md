# 📚 Chỉ mục tài liệu — Hệ thống Quản lý Doanh nghiệp (Enterprise Management System)

Đây là **mục lục trung tâm** của toàn bộ bộ tài liệu dự án. Tài liệu được tổ chức thành 8 nhóm:

- **PRD** — Yêu cầu sản phẩm cấp cao (định hướng).
- **SPEC** — Đặc tả nghiệp vụ chi tiết theo từng module.
- **DB** — Thiết kế cơ sở dữ liệu.
- **API** — Thiết kế API theo từng module.
- **UI** — Thiết kế giao diện & bàn giao frontend.
- **FRONTEND** — Triển khai frontend: kiến trúc, design system, routing/permission, API client, layout & module.
- **BACKEND** — Triển khai backend: kiến trúc, migration/ORM/seed, auth/RBAC, foundation, các module nghiệp vụ, kiểm thử/bảo mật/hiệu năng & sẵn sàng phát hành.
- **QA** — Đảm bảo chất lượng: chiến lược test, ma trận test case, E2E, API/contract, permission/data-scope, security, performance, bug/regression, UAT & sẵn sàng phát hành.

Mọi tài liệu đều liên kết chéo với nhau: mỗi file có breadcrumb điều hướng trong nhóm + khối "Liên quan / Nguồn" trỏ sang nhóm khác.

> Phiên bản: **MVP v1.0** · Trạng thái: **Draft** · Cập nhật: **21/06/2026**

---

## 1. Tài liệu sản phẩm (PRD)

| Mã | Tên tài liệu | Vai trò |
| -- | ------------ | ------- |
| PRD-00 | [Product Requirements Document](<PRD/PRD-00 Enterprise Management System .md>) | Định hướng sản phẩm tổng thể, phạm vi MVP |

---

## 2. Đặc tả nghiệp vụ (SPEC)

| Mã | Tên tài liệu | Module |
| -- | ------------ | ------ |
| SPEC-01 | [Tổng quan hệ thống](<SPEC/SPEC-01 Tổng quan.md>) | Spec mẹ — quy ước mã hóa, phân quyền, trạng thái |
| SPEC-02 | [Tài khoản, đăng nhập & phân quyền](<SPEC/SPEC-02 AUTH.md>) | AUTH |
| SPEC-03 | [Quản lý nhân sự](<SPEC/SPEC-03 HR.md>) | HR |
| SPEC-04 | [Chấm công](<SPEC/SPEC-04 ATT.md>) | ATT |
| SPEC-05 | [Nghỉ phép](<SPEC/SPEC-05 LEAVE.md>) | LEAVE |
| SPEC-06 | [Công việc & dự án](<SPEC/SPEC-06 TASK.md>) | TASK |
| SPEC-07 | [Dashboard](<SPEC/SPEC-07 DASH.md>) | DASH |
| SPEC-08 | [Thông báo hệ thống](<SPEC/SPEC-08 NOTI.md>) | NOTI |

---

## 3. Thiết kế cơ sở dữ liệu (DB)

| Mã | Tên tài liệu | Phạm vi |
| -- | ------------ | ------- |
| DB-01 | [Database Design tổng quan + ERD cấp cao](<DB/DB-01 DATABASE DESIGN TỔNG QUAN.md>) | Kiến trúc dữ liệu, quy ước, ERD |
| DB-02 | [AUTH & RBAC Database Design](<DB/DB-02 AUTH RBAC Database Design.md>) | AUTH |
| DB-03 | [HR Database Design](<DB/DB-03_HR Database Design.md>) | HR |
| DB-04 | [ATT Database Design](<DB/DB-04_ATT Database Design.md>) | ATT |
| DB-05 | [LEAVE Database Design](<DB/DB-05 LEAVE Database Design.md>) | LEAVE |
| DB-06 | [TASK Database Design](<DB/DB-06 TASK Database Design.md>) | TASK |
| DB-07 | [NOTI & DASH Database Design](<DB/DB-07 NOTI DASH Database Design.md>) | NOTI + DASH |
| DB-08 | [Audit, Files, Settings, Seeds Database Design](<DB/DB-08 Audit Files Settings Seeds Database Design.md>) | Foundation / Shared |
| DB-09 | [Index, Query Pattern & Performance Design](<DB/DB-09 Database Index Query Pattern Performance Design.md>) | Hiệu năng |
| DB-10 | [Migration Plan & Initial Seed Data](<DB/DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>) | Migration / Seed |

---

## 4. Thiết kế API (API)

| Mã | Tên tài liệu | Module / Phạm vi |
| -- | ------------ | ---------------- |
| API-01 | [API Design tổng quan](<API Design/API-01 TỔNG QUAN.md>) | Chuẩn API chung: auth, response, lỗi, pagination, idempotency |
| API-02 | [AUTH API Design](<API Design/API-02 AUTH API Design.md>) | AUTH |
| API-03 | [HR API Design](<API Design/API-03_HR_API_Design.md>) | HR |
| API-04 | [ATT API Design](<API Design/API-04_ATT_API_Design.md>) | ATT |
| API-05 | [LEAVE API Design](<API Design/API-05_LEAVE_API_Design.md>) | LEAVE |
| API-06 | [TASK API Design](<API Design/API-06_TASK_API_Design.md>) | TASK |
| API-07 | [NOTI API Design](<API Design/API-07_NOTI_API_Design.md>) | NOTI |
| API-08 | [DASH API Design](<API Design/API-08_DASH_API_Design.md>) | DASH |
| API-09 | [FOUNDATION API Design](<API Design/API-09_FOUNDATION_API_Design.md>) | Foundation / Shared |

> Tham khảo thêm: [API-10 Permission Matrix](<API Design/API-10 PERMISSION MATRIX.md>) · [API-10 Permission Audit Report](<API Design/API-10 PERMISSION AUDIT REPORT.md>) · [OpenAPI](<API Design/openapi/README.md>)

---

## 5. Thiết kế giao diện (UI)

| Mã | Tên tài liệu | Phạm vi |
| -- | ------------ | ------- |
| UI-01 | [UI/UX Design — Tổng quan](<UI/UI-01_UIUX_Design_Tong_Quan.md>) | Mô hình trải nghiệm: Home Portal → Module Workspace → App Switcher |
| UI-02 | [Information Architecture & Sitemap](<UI/UI-02_Information_Architecture_Sitemap.md>) | Sitemap, route convention, sidebar, topbar, quyền hiển thị menu |
| UI-03 | [User Flow MVP](<UI/UI-03_User_Flow_MVP.md>) | Luồng người dùng: login, mở/đổi app, check-in, xin nghỉ, duyệt, task, noti |
| UI-04 | [Screen List & Wireframe Plan](<UI/UI-04_Screen_List_Wireframe_Plan.md>) | Danh sách màn hình MVP, screen code, ưu tiên wireframe |
| UI-05 | [Design System & Component Library](<UI/UI-05_Design_System_Component_Library.md>) | Token, component library, state foundation |
| UI-06 | [Home Portal & App Switcher UI Design](<UI/UI-06_Home_Portal_App_Switcher_UI_Design.md>) | Thiết kế chi tiết Home Portal & App Switcher |
| UI-07 | [Module Workspace Template Design](<UI/UI-07_Module_Workspace_Template_Design.md>) | Template workspace theo module (topbar / sidebar / content) |
| UI-08 | [Dashboard UI/UX Design](<UI/UI-08_Dashboard_UIUX_Design.md>) | Dashboard theo vai trò, widget, quick action, cảnh báo |
| UI-09 | [Module UI Design](<UI/UI-09_Module_UI_Design.md>) | Thiết kế chi tiết màn hình nghiệp vụ theo module |
| UI-10 | [Prototype & Frontend Handoff Guide](<UI/UI-10_Prototype_Frontend_Handoff_Guide.md>) | Prototype, annotation interaction, bàn giao FE / QA |

> Tài liệu UI nền tảng (UI-02 IA, UI-03 Flow, UI-04 Screen list, UI-05 Design System, UI-06 Home/App Switcher, UI-07 Workspace, UI-10 Handoff) áp dụng xuyên suốt mọi module; thiết kế màn hình theo từng module nằm ở UI-09, dashboard nằm ở UI-08.

---

## 6. Triển khai Frontend (FRONTEND)

| Mã | Tên tài liệu | Phạm vi |
| -- | ------------ | ------- |
| FRONTEND-01 | [Frontend Architecture & Project Setup](<FRONTEND/FRONTEND-01_Frontend_Architecture_Project_Setup.md>) | Kiến trúc FE, stack, cấu trúc thư mục, route/layout/registry, chiến lược auth/permission/API/state |
| FRONTEND-02 | [Design System Implementation](<FRONTEND/FRONTEND-02_Design_System_Implementation.md>) | Token & component library (hiện thực hóa UI-05) |
| FRONTEND-03 | [Routing, Auth Guard & Permission Framework](<FRONTEND/FRONTEND-03_Routing_Auth_Guard_Permission_Framework.md>) | Route table, auth guard, session/token, permission & data-scope |
| FRONTEND-04 | [API Client, Query Layer & Error Handling](<FRONTEND/FRONTEND-04_API_Client_Query_Layer_Error_Handling.md>) | API client, query/cache, error envelope, upload, retry/idempotency |
| FRONTEND-05 | [Layout Implementation](<FRONTEND/FRONTEND-05_Layout_Implementation.md>) | Home Portal, App Switcher, Module Workspace, content shell |
| FRONTEND-06 | [AUTH & Account Frontend](<FRONTEND/FRONTEND-06_AUTH_Account_Frontend.md>) | AUTH |
| FRONTEND-07 | [Dashboard Frontend](<FRONTEND/FRONTEND-07_Dashboard_Frontend.md>) | DASH |
| FRONTEND-08 | [HR Frontend](<FRONTEND/FRONTEND-08_HR_Frontend.md>) | HR |
| FRONTEND-09 | [Attendance Frontend](<FRONTEND/FRONTEND-09_Attendance_Frontend.md>) | ATT |
| FRONTEND-10 | [Leave Frontend](<FRONTEND/FRONTEND-10_Leave_Frontend.md>) | LEAVE |
| FRONTEND-11 | [Task Frontend](<FRONTEND/FRONTEND-11_Task_Frontend.md>) | TASK |
| FRONTEND-12 | [Notification Frontend](<FRONTEND/FRONTEND-12_Notification_Frontend.md>) | NOTI |
| FRONTEND-13 | [System / Foundation Frontend](<FRONTEND/FRONTEND-13_System_Foundation_Frontend.md>) | Foundation / Shared |
| FRONTEND-14 | [QA, Performance & Release Readiness](<FRONTEND/FRONTEND-14_QA_Performance_Release_Readiness.md>) | QA / hiệu năng / phát hành |

> FRONTEND-01 → 05 là nền tảng xuyên suốt (kiến trúc, design system, routing/permission, API client, layout); FRONTEND-06 → 13 triển khai theo từng module nghiệp vụ; FRONTEND-14 chốt QA & phát hành.

---

## 7. Triển khai Backend (BACKEND)

| Mã | Tên tài liệu | Phạm vi |
| -- | ------------ | ------- |
| BACKEND-01 | [Backend Architecture & Project Setup](<BACKEND/BACKEND-01_Backend_Architecture_Project_Setup.md>) | Kiến trúc BE, stack, cấu trúc thư mục, chuẩn API/response/error, auth context, multi-tenant `company_id` |
| BACKEND-02 | [Database Migration, ORM & Seed Implementation](<BACKEND/BACKEND-02_Database_Migration_ORM_Seed_Implementation.md>) | Migration, ORM entity, thứ tự migration, seed idempotent (hiện thực hóa DB-10) |
| BACKEND-03 | [Auth, Session, RBAC & Permission Guard](<BACKEND/BACKEND-03_Auth_Session_RBAC_Permission_Guard.md>) | Login/session/token, RBAC, permission resolve/cache, data scope guard |
| BACKEND-04 | [Foundation Backend](<BACKEND/BACKEND-04_Foundation_Backend.md>) | Company, modules/app registry, settings, audit, file service, sequence, public holiday, seed tracking, job nền |
| BACKEND-05 | [HR Backend](<BACKEND/BACKEND-05_HR_Backend.md>) | HR |
| BACKEND-06 | [Attendance Backend](<BACKEND/BACKEND-06_Attendance_Backend.md>) | ATT |
| BACKEND-07 | [Leave Backend](<BACKEND/BACKEND-07_Leave_Backend.md>) | LEAVE |
| BACKEND-08 | [Task Backend](<BACKEND/BACKEND-08_Task_Backend.md>) | TASK |
| BACKEND-09 | [Notification Backend](<BACKEND/BACKEND-09_Notification_Backend.md>) | NOTI |
| BACKEND-10 | [Dashboard Backend](<BACKEND/BACKEND-10_Dashboard_Backend.md>) | DASH |
| BACKEND-11 | [File, Audit, Settings & System Jobs](<BACKEND/BACKEND-11_File_Audit_Settings_System_Jobs.md>) | Triển khai sâu Foundation: file service, audit, settings, module catalog, sequence, holiday, retention, system jobs (mở rộng BACKEND-04) |
| BACKEND-12 | [API Integration Contract & OpenAPI/Swagger](<BACKEND/BACKEND-12_API_Integration_Contract_OpenAPI_Swagger.md>) | Hợp đồng API, OpenAPI/Swagger, `x-*` extension (permission/scope/audit/event/idempotency), contract test, breaking-change detection |
| BACKEND-13 | [Backend Testing, Security & Performance](<BACKEND/BACKEND-13_Backend_Testing_Security_Performance.md>) | Kiểm thử, bảo mật, hiệu năng (QA/hardening) |
| BACKEND-14 | [Backend Release Readiness](<BACKEND/BACKEND-14_Backend_Release_Readiness.md>) | Release gate, go/no-go, deploy/rollback, smoke test, incident runbook |

> BACKEND-01 → 04 là nền tảng xuyên suốt (kiến trúc, migration/ORM/seed, auth/RBAC, foundation); BACKEND-05 → 10 triển khai theo từng module nghiệp vụ; BACKEND-13 chốt QA/bảo mật/hiệu năng và BACKEND-14 chốt sẵn sàng phát hành.
>
> ℹ️ **BACKEND-11 & BACKEND-12 đã được bổ sung** (đủ chuỗi 01–14). Roadmap §3, tiêu đề slot 11–14, cùng các permission/enum/endpoint/event đã được rà soát chéo và đồng bộ giữa SPEC/DB/API/UI/FRONTEND/BACKEND (cập nhật 20/06/2026). BACKEND-11 là bản triển khai sâu của Foundation (mở rộng BACKEND-04).

---

## 8. Đảm bảo chất lượng (QA)

| Mã | Tên tài liệu | Phạm vi |
| -- | ------------ | ------- |
| QA-01 | [QA Strategy & Test Plan](<QA/QA-01_QA_Strategy_And_Test_Plan.md>) | Chiến lược QA tổng thể, kim tự tháp test, phạm vi/exit criteria, vai trò & quy trình |
| QA-02 | [Test Case Matrix theo module](<QA/QA-02_Test_Case_Matrix_theo_module.md>) | Ma trận test case chi tiết theo từng module (AUTH → NOTI), truy vết về SPEC |
| QA-03 | [End-to-End Flow Testing](<QA/QA-03_End-to-End_Flow_Testing.md>) | Test E2E các luồng tới hạn: login, check-in, xin/duyệt nghỉ, task, thông báo |
| QA-04 | [API Testing & Contract Testing](<QA/QA-04_API_Testing_Contract_Testing.md>) | Test API & hợp đồng (contract), response envelope, mã lỗi, idempotency |
| QA-05 | [Permission, Role & Data Scope Testing](<QA/QA-05_Permission_Role_Data_Scope_Testing.md>) | Test phân quyền/vai trò & data-scope, deny-path, cô lập tenant `company_id` |
| QA-06 | [Security Testing](<QA/QA-06_Security_Testing.md>) | Test bảo mật theo OWASP, secret, masking, audit, RLS |
| QA-07 | [Performance & Load Testing](<QA/QA-07_Performance_Load_Testing.md>) | Test hiệu năng & tải, ngưỡng SLO, index/query pattern |
| QA-08 | [Bug Tracking, Regression & Release Criteria](<QA/QA-08_Bug_Tracking_Regression_Release_Criteria.md>) | Quy trình bug/severity, regression, tiêu chí phát hành |
| QA-09 | [UAT Plan & Business Acceptance](<QA/QA-09_UAT_Plan_Business_Acceptance.md>) | Kế hoạch UAT & nghiệm thu nghiệp vụ |
| QA-10 | [MVP Release Readiness Checklist](<QA/QA-10_MVP_Release_Readiness_Checklist.md>) | Checklist sẵn sàng phát hành MVP, go/no-go |

> QA-01 đặt chiến lược & exit criteria xuyên suốt; QA-02 → 07 là các lớp kiểm thử (theo module · E2E · API/contract · permission/data-scope · security · performance); QA-08 → 10 chốt quy trình bug/regression, UAT và sẵn sàng phát hành. Bộ QA bổ sung góc nhìn kiểm thử cho [FRONTEND-14](<FRONTEND/FRONTEND-14_QA_Performance_Release_Readiness.md>) và [BACKEND-13](<BACKEND/BACKEND-13_Backend_Testing_Security_Performance.md>) / [BACKEND-14](<BACKEND/BACKEND-14_Backend_Release_Readiness.md>).

---

## 9. Bản đồ ghép cặp theo module

Mỗi module nghiệp vụ được mô tả xuyên suốt qua 5 nhóm tài liệu:

| Module | PRD (mục) | SPEC | DB | API | UI | FRONTEND | BACKEND |
| ------ | --------- | ---- | -- | --- | -- | -------- | ------- |
| Tổng quan | [PRD-00](<PRD/PRD-00 Enterprise Management System .md>) | [SPEC-01](<SPEC/SPEC-01 Tổng quan.md>) | [DB-01](<DB/DB-01 DATABASE DESIGN TỔNG QUAN.md>) | [API-01](<API Design/API-01 TỔNG QUAN.md>) | [UI-01](<UI/UI-01_UIUX_Design_Tong_Quan.md>) | [FRONTEND-01](<FRONTEND/FRONTEND-01_Frontend_Architecture_Project_Setup.md>) | [BACKEND-01](<BACKEND/BACKEND-01_Backend_Architecture_Project_Setup.md>) |
| **AUTH** | PRD §9.1 | [SPEC-02](<SPEC/SPEC-02 AUTH.md>) | [DB-02](<DB/DB-02 AUTH RBAC Database Design.md>) | [API-02](<API Design/API-02 AUTH API Design.md>) | [UI-09](<UI/UI-09_Module_UI_Design.md>) | [FRONTEND-06](<FRONTEND/FRONTEND-06_AUTH_Account_Frontend.md>) | [BACKEND-03](<BACKEND/BACKEND-03_Auth_Session_RBAC_Permission_Guard.md>) |
| **HR** | PRD §9.2 | [SPEC-03](<SPEC/SPEC-03 HR.md>) | [DB-03](<DB/DB-03_HR Database Design.md>) | [API-03](<API Design/API-03_HR_API_Design.md>) | [UI-09](<UI/UI-09_Module_UI_Design.md>) | [FRONTEND-08](<FRONTEND/FRONTEND-08_HR_Frontend.md>) | [BACKEND-05](<BACKEND/BACKEND-05_HR_Backend.md>) |
| **ATT** | PRD §9.3 | [SPEC-04](<SPEC/SPEC-04 ATT.md>) | [DB-04](<DB/DB-04_ATT Database Design.md>) | [API-04](<API Design/API-04_ATT_API_Design.md>) | [UI-09](<UI/UI-09_Module_UI_Design.md>) | [FRONTEND-09](<FRONTEND/FRONTEND-09_Attendance_Frontend.md>) | [BACKEND-06](<BACKEND/BACKEND-06_Attendance_Backend.md>) |
| **LEAVE** | PRD §9.4 | [SPEC-05](<SPEC/SPEC-05 LEAVE.md>) | [DB-05](<DB/DB-05 LEAVE Database Design.md>) | [API-05](<API Design/API-05_LEAVE_API_Design.md>) | [UI-09](<UI/UI-09_Module_UI_Design.md>) | [FRONTEND-10](<FRONTEND/FRONTEND-10_Leave_Frontend.md>) | [BACKEND-07](<BACKEND/BACKEND-07_Leave_Backend.md>) |
| **TASK** | PRD §9.5 | [SPEC-06](<SPEC/SPEC-06 TASK.md>) | [DB-06](<DB/DB-06 TASK Database Design.md>) | [API-06](<API Design/API-06_TASK_API_Design.md>) | [UI-09](<UI/UI-09_Module_UI_Design.md>) | [FRONTEND-11](<FRONTEND/FRONTEND-11_Task_Frontend.md>) | [BACKEND-08](<BACKEND/BACKEND-08_Task_Backend.md>) |
| **DASH** | PRD §9.6 | [SPEC-07](<SPEC/SPEC-07 DASH.md>) | [DB-07](<DB/DB-07 NOTI DASH Database Design.md>) | [API-08](<API Design/API-08_DASH_API_Design.md>) | [UI-08](<UI/UI-08_Dashboard_UIUX_Design.md>) | [FRONTEND-07](<FRONTEND/FRONTEND-07_Dashboard_Frontend.md>) | [BACKEND-10](<BACKEND/BACKEND-10_Dashboard_Backend.md>) |
| **NOTI** | PRD §9.7 | [SPEC-08](<SPEC/SPEC-08 NOTI.md>) | [DB-07](<DB/DB-07 NOTI DASH Database Design.md>) | [API-07](<API Design/API-07_NOTI_API_Design.md>) | [UI-09](<UI/UI-09_Module_UI_Design.md>) | [FRONTEND-12](<FRONTEND/FRONTEND-12_Notification_Frontend.md>) | [BACKEND-09](<BACKEND/BACKEND-09_Notification_Backend.md>) |
| Audit / Files / Settings | PRD §12.4 | SPEC-01 §16 | [DB-08](<DB/DB-08 Audit Files Settings Seeds Database Design.md>) | [API-09](<API Design/API-09_FOUNDATION_API_Design.md>) | [UI-09](<UI/UI-09_Module_UI_Design.md>) | [FRONTEND-13](<FRONTEND/FRONTEND-13_System_Foundation_Frontend.md>) | [BACKEND-04](<BACKEND/BACKEND-04_Foundation_Backend.md>) · [BACKEND-11](<BACKEND/BACKEND-11_File_Audit_Settings_System_Jobs.md>) |
| Home Portal / App Switcher | PRD §9 | SPEC-01 | — | [API-09](<API Design/API-09_FOUNDATION_API_Design.md>) | [UI-06](<UI/UI-06_Home_Portal_App_Switcher_UI_Design.md>) · [UI-07](<UI/UI-07_Module_Workspace_Template_Design.md>) | [FRONTEND-05](<FRONTEND/FRONTEND-05_Layout_Implementation.md>) | [BACKEND-04](<BACKEND/BACKEND-04_Foundation_Backend.md>) · [BACKEND-11](<BACKEND/BACKEND-11_File_Audit_Settings_System_Jobs.md>) |
| Hiệu năng / Index | PRD §12.2 | SPEC-01 §23 | [DB-09](<DB/DB-09 Database Index Query Pattern Performance Design.md>) | [API-01 §16,21,22](<API Design/API-01 TỔNG QUAN.md>) | — | [FRONTEND-14](<FRONTEND/FRONTEND-14_QA_Performance_Release_Readiness.md>) | [BACKEND-13](<BACKEND/BACKEND-13_Backend_Testing_Security_Performance.md>) |
| Migration / Seed | PRD §18 | SPEC-01 §25 | [DB-10](<DB/DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>) | — | — | — | [BACKEND-02](<BACKEND/BACKEND-02_Database_Migration_ORM_Seed_Implementation.md>) |
| QA / Release | PRD §18 | — | — | — | — | [FRONTEND-14](<FRONTEND/FRONTEND-14_QA_Performance_Release_Readiness.md>) | [BACKEND-13](<BACKEND/BACKEND-13_Backend_Testing_Security_Performance.md>) · [BACKEND-14](<BACKEND/BACKEND-14_Backend_Release_Readiness.md>) |

> Lưu ý: NOTI và DASH dùng chung tài liệu thiết kế DB-07. Thiết kế màn hình nghiệp vụ của AUTH/HR/ATT/LEAVE/TASK/NOTI nằm trong cùng tài liệu UI-09 (chia theo section module). Cột FRONTEND ánh xạ phần triển khai theo module; các tài liệu nền tảng FRONTEND-02 (Design System), FRONTEND-03 (Routing/Auth/Permission) và FRONTEND-04 (API Client) là xuyên suốt mọi module nên không gắn vào một dòng module cụ thể.
>
> Lớp kiểm thử xuyên suốt mọi module nằm ở nhóm **QA** (QA-01 → QA-10, mục 8) — test case theo module ([QA-02](<QA/QA-02_Test_Case_Matrix_theo_module.md>)), E2E ([QA-03](<QA/QA-03_End-to-End_Flow_Testing.md>)), API/contract ([QA-04](<QA/QA-04_API_Testing_Contract_Testing.md>)), permission/data-scope ([QA-05](<QA/QA-05_Permission_Role_Data_Scope_Testing.md>)), security ([QA-06](<QA/QA-06_Security_Testing.md>)), performance ([QA-07](<QA/QA-07_Performance_Load_Testing.md>)) — nên không gắn vào một dòng module cụ thể.
>
> Cột BACKEND ánh xạ phần triển khai backend theo module; các tài liệu nền tảng BACKEND-01 (Kiến trúc), BACKEND-02 (Migration/ORM/Seed) và BACKEND-03 (Auth/RBAC) là xuyên suốt mọi module nên không gắn vào một dòng module cụ thể. BACKEND-04 (Foundation) phục vụ cả nhóm "Audit/Files/Settings" lẫn "Home Portal/App Switcher" (module/app registry).

---

## 10. Thứ tự đọc đề xuất

1. **[PRD-00](<PRD/PRD-00 Enterprise Management System .md>)** — nắm mục tiêu, phạm vi, vai trò người dùng.
2. **[SPEC-01](<SPEC/SPEC-01 Tổng quan.md>)** — quy ước mã hóa, phân quyền, trạng thái, ma trận liên kết module.
3. **SPEC module** theo thứ tự ưu tiên triển khai: AUTH → HR → ATT → LEAVE → TASK → DASH → NOTI.
4. **[DB-01](<DB/DB-01 DATABASE DESIGN TỔNG QUAN.md>)** — kiến trúc & quy ước dữ liệu, rồi các DB module tương ứng.
5. **[DB-10](<DB/DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>)** — kế hoạch migration & seed khi bắt tay triển khai.
6. **[API-01](<API Design/API-01 TỔNG QUAN.md>)** — chuẩn API chung, rồi các API module (API-02 → API-09) đọc song song với SPEC/DB cùng module.
7. **[UI-01](<UI/UI-01_UIUX_Design_Tong_Quan.md>)** — mô hình trải nghiệm, sau đó IA/route ([UI-02](<UI/UI-02_Information_Architecture_Sitemap.md>)), flow ([UI-03](<UI/UI-03_User_Flow_MVP.md>)), danh sách màn hình ([UI-04](<UI/UI-04_Screen_List_Wireframe_Plan.md>)), design system ([UI-05](<UI/UI-05_Design_System_Component_Library.md>)), rồi các thiết kế chi tiết UI-06 → UI-09; cuối cùng **[UI-10](<UI/UI-10_Prototype_Frontend_Handoff_Guide.md>)** để bàn giao FE/QA.
8. **[FRONTEND-01](<FRONTEND/FRONTEND-01_Frontend_Architecture_Project_Setup.md>)** — sau khi nắm UI, đọc nền tảng FE theo thứ tự: FRONTEND-01 (kiến trúc) → [FRONTEND-02](<FRONTEND/FRONTEND-02_Design_System_Implementation.md>) (design system) → [FRONTEND-03](<FRONTEND/FRONTEND-03_Routing_Auth_Guard_Permission_Framework.md>) (routing/permission) → [FRONTEND-04](<FRONTEND/FRONTEND-04_API_Client_Query_Layer_Error_Handling.md>) (API client) → [FRONTEND-05](<FRONTEND/FRONTEND-05_Layout_Implementation.md>) (layout); rồi các FRONTEND module 06 → 13 đọc song song với SPEC/API/UI cùng module; cuối cùng **[FRONTEND-14](<FRONTEND/FRONTEND-14_QA_Performance_Release_Readiness.md>)** cho QA & phát hành.
9. **[BACKEND-01](<BACKEND/BACKEND-01_Backend_Architecture_Project_Setup.md>)** — đọc nền tảng BE theo thứ tự: BACKEND-01 (kiến trúc/chuẩn API) → [BACKEND-02](<BACKEND/BACKEND-02_Database_Migration_ORM_Seed_Implementation.md>) (migration/ORM/seed) → [BACKEND-03](<BACKEND/BACKEND-03_Auth_Session_RBAC_Permission_Guard.md>) (auth/RBAC/permission guard) → [BACKEND-04](<BACKEND/BACKEND-04_Foundation_Backend.md>) (foundation); rồi các BACKEND module 05 → 10 đọc song song với SPEC/DB/API cùng module; tiếp theo [BACKEND-11](<BACKEND/BACKEND-11_File_Audit_Settings_System_Jobs.md>) (foundation sâu: file/audit/settings/sequence/holiday/jobs) và [BACKEND-12](<BACKEND/BACKEND-12_API_Integration_Contract_OpenAPI_Swagger.md>) (hợp đồng API & OpenAPI) để khóa contract; cuối cùng [BACKEND-13](<BACKEND/BACKEND-13_Backend_Testing_Security_Performance.md>) (kiểm thử/bảo mật/hiệu năng) và **[BACKEND-14](<BACKEND/BACKEND-14_Backend_Release_Readiness.md>)** (sẵn sàng phát hành).

---

## 11. Tài liệu vận hành, quản trị & quyết định

| Mã | Tên tài liệu | Phạm vi | Trạng thái |
| -- | ------------ | ------- | ---------- |
| DEVOPS-01 → 12 | [DevOps Architecture & Environment Strategy](<DEVOPS/DEVOPS-01_DevOps_Architecture_Environment_Strategy.md>) | Bộ 12 tài liệu DevOps: kiến trúc/môi trường, CI/CD, Docker, secrets, deploy BE/FE, staging/prod, monitoring, backup/DR, hardening, release — kèm [DEVOPS-00 Traceability Matrix](<DEVOPS/DEVOPS-00_DevOps_QA_Traceability_Matrix.md>) | Đã có |
| COMPLIANCE-01 | [Bảo vệ Dữ liệu Cá nhân & Backup/DR](<COMPLIANCE/COMPLIANCE-01_Personal_Data_Protection_Backup_DR.md>) | Tuân thủ NĐ 13/2023, retention, breach 72h, RPO/RTO, DR runbook | Đã có (mới) |
| DECISIONS-01 | [Sổ Quyết định — Chốt câu hỏi mở trước triển khai](<DECISIONS/DECISIONS-01_Open_Decisions_Lock.md>) | Chốt 15 câu hỏi mở SPEC-01 §29 (D-01 → D-15) trước khi code | Đã có (mới) |
| DECISIONS-02 | [Khóa Stack & Hiện thực 3 Bất biến](<DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md>) | **ĐÃ CHỐT** — ghi đè mọi nhắc Next.js/Prisma/Redis/Jest; bổ sung DDL RLS+FORCE / audit append-only / outbox + `withTenant`/`set_config` | Đã có (mới) |

> ℹ️ **Rà soát 2026-06-21:** phân tích keep/delete code + drift bộ docs ở [`_review/`](<_review/REVIEW-FINDINGS.md>) (REVIEW-FINDINGS · CODE-CLEANUP-PLAN · SPEC-DRIFT-MATRIX). [DECISIONS-02](<DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md>) là đính chính bắt buộc đọc trước khi code.
>
> DEVOPS-01 lấp tài liệu DevOps/Infrastructure mà BACKEND-13/14 tham chiếu. COMPLIANCE-01 trả lời câu hỏi mở RPO/RTO (BE14-OQ-006) và audit xem dữ liệu nhạy cảm (SPEC-01 §29 #15). DECISIONS-01 cần được duyệt (chuyển trạng thái "Đề xuất" → "Đã chốt") trước khi khóa scope triển khai.

## 12. Kế hoạch triển khai, Baseline & Issue Board

| Mã | Tên tài liệu | Vai trò | Trạng thái |
| -- | ------------ | ------- | ---------- |
| IMPLEMENTATION-01 | [MVP Implementation Roadmap & Sprint Plan](<IMPLEMENTATION/IMPLEMENTATION-01_MVP_Implementation_Roadmap_Sprint_Plan.md>) | Roadmap tổng thể & sprint plan (Sprint 0–6) | Draft |
| IMPLEMENTATION-02 | [Detailed Product Backlog & Epic Breakdown](<IMPLEMENTATION/IMPLEMENTATION-02_Detailed_Product_Backlog_Epic_Breakdown.md>) | Backlog chi tiết, phân rã Epic/Story (`IMP02-EPIC/STORY`) | Draft |
| IMPLEMENTATION-03 | [Sprint 0 Execution Plan & Issue Board Setup](<IMPLEMENTATION/IMPLEMENTATION-03_Sprint_0_Execution_Plan_Issue_Board_Setup.md>) | Thực thi Sprint 0 | Draft |
| IMPLEMENTATION-04 → 09 | Sprint 1 → 6 Execution Plans | Kế hoạch thực thi từng sprint (Foundation → Go-live) | Draft |
| IMPLEMENTATION-10 | Post-MVP Backlog & Phase 2 Planning | Backlog sau MVP | Draft |
| PROJECT-BASELINE-01 | [MVP Documentation Baseline & Freeze Checklist](<PROJECT-BASELINE/PROJECT-BASELINE-01_MVP_Documentation_Baseline_Freeze_Checklist.md>) | Chốt & freeze baseline tài liệu trước khi code | Draft |
| ISSUE-BOARD-01 | [MVP Ticket Board Setup](<ISSUE-BOARD/ISSUE-BOARD-01_MVP_Ticket_Board_Setup.md>) | Thiết lập board/label/template/backlog seed (`EPIC-<MODULE>-NN`) | Draft |

> Thứ tự: bộ tài liệu thiết kế đã chốt → **PROJECT-BASELINE-01** (freeze) → **ISSUE-BOARD-01** (dựng board) → **IMPLEMENTATION-03 → 09** (thực thi Sprint 0 → 6). Sprint numbering thống nhất theo IMPLEMENTATION (Sprint 0–6). ISSUE-BOARD-01 là nguồn chính cho cấu trúc board; IMPLEMENTATION-02 là nguồn chi tiết backlog/Epic/Story.

