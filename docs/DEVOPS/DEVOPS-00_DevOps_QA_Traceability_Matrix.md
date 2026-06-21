# DEVOPS-00: DEVOPS ↔ QA TRACEABILITY MATRIX
# MA TRẬN TRUY VẾT DEVOPS ↔ QA / RELEASE READINESS
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DEVOPS-00 |
| Tên tài liệu | DevOps ↔ QA Traceability Matrix |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | DevOps, Deployment & Release Operations - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | DEVOPS-01 -> DEVOPS-12, QA-01 -> QA-10 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

DEVOPS-00 là tài liệu phụ trợ (cross-cutting) ánh xạ từng tài liệu DevOps (DEVOPS-01 -> DEVOPS-12) với các tài liệu QA & release readiness (QA-01 -> QA-10).

Tài liệu này dùng để:

1. Lấp đầy tiêu chí "Có mapping với QA/release readiness" trong bảng nghiệm thu của các tài liệu DEVOPS.
2. Cho biết mỗi tài liệu DevOps phụ thuộc/được kiểm chứng bởi tài liệu QA nào.
3. Cho biết mỗi tài liệu QA được "tiêu thụ" bởi tài liệu DevOps nào (chiều ngược).
4. Gắn các release gate của DevOps với tiêu chí release của QA-08/QA-10.
5. Chỉ ra khoảng trống cần chốt giữa DevOps và QA trước go-live.

Tài liệu này **không** thay thế nội dung QA; nó chỉ là lớp liên kết truy vết.

---

## 3. Danh mục tài liệu QA tham chiếu

| Mã | Tên tài liệu | File |
| --- | --- | --- |
| QA-01 | QA Strategy & Test Plan | [QA-01](../QA/QA-01_QA_Strategy_And_Test_Plan.md) |
| QA-02 | Test Case Matrix theo module | [QA-02](../QA/QA-02_Test_Case_Matrix_theo_module.md) |
| QA-03 | End-to-End Flow Testing | [QA-03](../QA/QA-03_End-to-End_Flow_Testing.md) |
| QA-04 | API Testing & Contract Testing | [QA-04](../QA/QA-04_API_Testing_Contract_Testing.md) |
| QA-05 | Permission, Role & Data Scope Testing | [QA-05](../QA/QA-05_Permission_Role_Data_Scope_Testing.md) |
| QA-06 | Security Testing | [QA-06](../QA/QA-06_Security_Testing.md) |
| QA-07 | Performance & Load Testing | [QA-07](../QA/QA-07_Performance_Load_Testing.md) |
| QA-08 | Bug Tracking, Regression & Release Criteria | [QA-08](../QA/QA-08_Bug_Tracking_Regression_Release_Criteria.md) |
| QA-09 | UAT Plan & Business Acceptance | [QA-09](../QA/QA-09_UAT_Plan_Business_Acceptance.md) |
| QA-10 | MVP Release Readiness Checklist | [QA-10](../QA/QA-10_MVP_Release_Readiness_Checklist.md) |

---

## 4. Ma trận tổng hợp DEVOPS × QA

Ký hiệu: **P** = liên quan chính (primary), **S** = liên quan phụ (secondary), `-` = không liên quan trực tiếp.

| DEVOPS \ QA | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **01** Architecture & Env | P | - | - | - | - | S | S | S | S | P |
| **02** Repo, Branching & CI | P | S | - | S | - | - | - | P | - | S |
| **03** Docker & Container | - | - | S | - | - | - | P | - | - | S |
| **04** Config & Secrets | S | - | - | - | S | P | - | - | - | - |
| **05** DB Migration & Seed | - | P | S | - | P | - | - | S | - | S |
| **06** Backend Deploy | - | - | S | P | S | - | S | P | - | P |
| **07** Frontend Deploy | - | S | P | - | - | S | - | - | - | P |
| **08** Staging/UAT/Prod | S | - | - | - | S | - | - | S | P | P |
| **09** Monitoring/Logging | - | - | - | - | - | S | P | P | - | S |
| **10** Backup/Rollback/DR | - | - | S | - | S | - | - | S | - | P |
| **11** Security Hardening | - | - | - | S | P | P | - | - | - | S |
| **12** Release & Go-live | S | - | S | - | S | S | S | P | P | P |

---

## 5. Mapping chi tiết theo từng tài liệu DEVOPS

Cột "Tham chiếu trực tiếp" đánh dấu nơi tài liệu DEVOPS đã nêu đích danh QA tương ứng.

### 5.1 DEVOPS-01 — Architecture & Environment Strategy

| QA | Mức | Lý do liên kết | Section DEVOPS-01 | Tham chiếu trực tiếp |
| --- | --- | --- | --- | --- |
| QA-01 | P | Chiến lược môi trường là nền cho test plan; staging/UAT phải production-like để QA chạy được | §7.1, §9 | |
| QA-10 | P | Release gate staging->prod là đầu vào của release readiness | §16.3, §20 | |
| QA-06 | S | Baseline bảo mật hạ tầng làm tiền đề security testing | §18 | |
| QA-07 | S | Sizing service/runtime cần kết quả load test | §8.3, §15 | |
| QA-08 | S | Release gate gắn tiêu chí regression/release | §16.3 | |
| QA-09 | S | Yêu cầu môi trường UAT gần production | §9.5 | |

### 5.2 DEVOPS-02 — Repository, Branching & CI Pipeline

| QA | Mức | Lý do liên kết | Section DEVOPS-02 | Tham chiếu trực tiếp |
| --- | --- | --- | --- | --- |
| QA-01 | P | CI quality gate + coverage threshold dựa trên test plan | §9, §11, OQ DO02-OQ-004 | |
| QA-08 | P | Merge rule/CI gate là cơ chế chặn regression vào release | §8.3, §11, §18 | |
| QA-02 | S | Unit test trong CI bám test case matrix theo module | §9.2, §11 | |
| QA-04 | S | PR kiểm tra thay đổi API contract -> cập nhật OpenAPI | §8.1, §9.2 | |
| QA-10 | S | Traceability build/image phục vụ readiness | §12, §17.3 | |

### 5.3 DEVOPS-03 — Docker & Containerization

| QA | Mức | Lý do liên kết | Section DEVOPS-03 | Tham chiếu trực tiếp |
| --- | --- | --- | --- | --- |
| QA-07 | P | Resource limit container điều chỉnh sau load test | §18 | ✅ "sau load test ở QA-07" |
| QA-03 | S | Health check + smoke local hỗ trợ E2E flow | §16, §19 | |
| QA-10 | S | Image tag/scan phục vụ readiness | §13, §20.3 | |

### 5.4 DEVOPS-04 — Environment Configuration & Secrets

| QA | Mức | Lý do liên kết | Section DEVOPS-04 | Tham chiếu trực tiếp |
| --- | --- | --- | --- | --- |
| QA-06 | P | CORS, cookie, security headers, secret là đối tượng security testing | §8.3, §8.4, §11 | |
| QA-05 | S | Feature flag không thay permission -> kiểm tra cùng data scope | §12.2 | |
| QA-01 | S | Config theo môi trường ảnh hưởng test environment | §6, §8 | |

### 5.5 DEVOPS-05 — Database Migration & Seed Deployment

| QA | Mức | Lý do liên kết | Section DEVOPS-05 | Tham chiếu trực tiếp |
| --- | --- | --- | --- | --- |
| QA-05 | P | Seed role/permission/role-permission là dữ liệu nền cho permission testing | §9.1, §16 | |
| QA-02 | P | Demo/test seed cung cấp dữ liệu cho test case matrix | §9.1, §10 | |
| QA-03 | S | Verification sau migration mở các flow chính (login, HR, ATT...) | §17 | |
| QA-08 | S | Migration fail/forward-fix gắn tiêu chí release | §15, §19 | |
| QA-10 | S | Backup-before-migration là mục readiness | §14, §18 | |

### 5.6 DEVOPS-06 — Backend Deployment Pipeline

| QA | Mức | Lý do liên kết | Section DEVOPS-06 | Tham chiếu trực tiếp |
| --- | --- | --- | --- | --- |
| QA-04 | P | Smoke API `/auth/me`, contract check trong gate | §8, §14 | |
| QA-08 | P | Deployment gate yêu cầu QA regression pass | §17 | ✅ "QA regression chưa pass" |
| QA-10 | P | Production gate là một phần readiness | §17 | |
| QA-03 | S | Smoke backend nối với E2E flow | §14 | |
| QA-05 | S | Smoke endpoint có auth/permission | §14 | |
| QA-07 | S | Monitor latency sau deploy | §13 | |

### 5.7 DEVOPS-07 — Frontend Deployment Pipeline

| QA | Mức | Lý do liên kết | Section DEVOPS-07 | Tham chiếu trực tiếp |
| --- | --- | --- | --- | --- |
| QA-03 | P | Route smoke login/home/dashboard là E2E flow rút gọn | §12, §15 | |
| QA-10 | P | Smoke route/config đúng môi trường phục vụ readiness | §12, §19 | |
| QA-02 | S | UI test case theo module | §12 | |
| QA-06 | S | Source map policy, security headers, không log token | §14, §18 | |

### 5.8 DEVOPS-08 — Staging, UAT & Production Environment

| QA | Mức | Lý do liên kết | Section DEVOPS-08 | Tham chiếu trực tiếp |
| --- | --- | --- | --- | --- |
| QA-09 | P | UAT checklist theo QA-09; môi trường UAT ổn định trong window | §9.1 | ✅ "checklist UAT theo QA-09" |
| QA-10 | P | Environment readiness checklist là đầu vào readiness | §17 | |
| QA-01 | S | Mô hình môi trường khớp test strategy | §5, §7 | |
| QA-05 | S | Dữ liệu test theo role cho data scope test | §14 | |
| QA-08 | S | Regression scope khi deploy lại trong UAT | §9.2 | |

### 5.9 DEVOPS-09 — Monitoring, Logging & Alerting

| QA | Mức | Lý do liên kết | Section DEVOPS-09 | Tham chiếu trực tiếp |
| --- | --- | --- | --- | --- |
| QA-07 | P | Metric latency p95/p99, error rate là chỉ số performance | §9.1, §11.2 | |
| QA-08 | P | Release monitoring dashboard phát hiện regression/bug sau deploy | §11.2, §15 | |
| QA-06 | S | Security logging, login failure spike, alert security | §6.3, §10.2, §16 | |
| QA-10 | S | Monitoring ready là mục readiness | §17 | |

### 5.10 DEVOPS-10 — Backup, Rollback & Disaster Recovery

| QA | Mức | Lý do liên kết | Section DEVOPS-10 | Tham chiếu trực tiếp |
| --- | --- | --- | --- | --- |
| QA-10 | P | Restore drill trước go-live là điều kiện readiness | §11, §17 | |
| QA-03 | S | Application smoke test trong restore drill | §11 | |
| QA-05 | S | Post-restore verify quyền truy cập file/dữ liệu | §19 | |
| QA-08 | S | Rollback decision gắn severity/incident | §16 | |

### 5.11 DEVOPS-11 — Security Hardening & Runtime Protection

| QA | Mức | Lý do liên kết | Section DEVOPS-11 | Tham chiếu trực tiếp |
| --- | --- | --- | --- | --- |
| QA-06 | P | Hardening (TLS, headers, CORS, rate limit, secret, scan) là đối tượng chính của security testing | §7-§16, §19 | |
| QA-05 | P | Backend guard, data scope, field-level masking | §5, §16 | |
| QA-04 | S | API auth/error response không leak | §16 | |
| QA-10 | S | Pre-go-live hardening checklist phục vụ readiness | §19 | |

### 5.12 DEVOPS-12 — Release Management & Go-live Plan

| QA | Mức | Lý do liên kết | Section DEVOPS-12 | Tham chiếu trực tiếp |
| --- | --- | --- | --- | --- |
| QA-10 | P | Go-live gate = MVP release readiness checklist | §9, §12.2 | ✅ "QA-10 release readiness pass" |
| QA-09 | P | UAT sign-off là gate bắt buộc | §9, §12.1 | ✅ "UAT pass theo QA-09" |
| QA-08 | P | Release criteria/regression P0-P1, no-go khi regression fail | §9, §15.2 | |
| QA-03 | S | E2E smoke login/home/check-in/leave/task/notification | §12.2, §14 | |
| QA-07 | S | Performance/load threshold MVP trong pre-go-live | §12.2 | |
| QA-05 | S | Permission/data scope test critical pass | §12.2 | |
| QA-06 | S | Security checklist gate | §9 | |
| QA-01 | S | Quy trình release bám test strategy | §5 | |

---

## 6. Chiều ngược: mỗi tài liệu QA được tiêu thụ ở đâu

| QA | DEVOPS liên quan chính (P) | DEVOPS liên quan phụ (S) |
| --- | --- | --- |
| QA-01 Strategy & Test Plan | 01, 02 | 04, 08, 12 |
| QA-02 Test Case Matrix | 05 | 02, 07 |
| QA-03 E2E Flow Testing | 07 | 03, 05, 06, 10, 12 |
| QA-04 API & Contract Testing | 06 | 02, 11 |
| QA-05 Permission/Role/Data Scope | 05, 11 | 04, 06, 08, 10, 12 |
| QA-06 Security Testing | 04, 11 | 01, 07, 09, 12 |
| QA-07 Performance & Load | 03, 09 | 01, 06, 12 |
| QA-08 Bug/Regression/Release Criteria | 02, 06, 09, 12 | 01, 05, 08, 10 |
| QA-09 UAT Plan & Business Acceptance | 08, 12 | 01 |
| QA-10 MVP Release Readiness | 01, 06, 07, 08, 10, 12 | 02, 03, 05, 09, 11 |

---

## 7. Release readiness gate mapping

Gắn các "gate" của DevOps với tiêu chí QA tương ứng. Đây là phần quan trọng nhất cho quyết định go/no-go.

| Gate (nguồn) | Điều kiện | QA liên quan |
| --- | --- | --- |
| CI quality gate (DEVOPS-02 §11) | Lint/typecheck/unit test/coverage pass | QA-01, QA-02 |
| Backend production gate (DEVOPS-06 §17) | CI + image scan + migration staging + QA regression + UAT | QA-04, QA-08, QA-09, QA-10 |
| Frontend smoke gate (DEVOPS-07 §12) | Route P0 + config + auth flow | QA-03, QA-10 |
| Environment readiness (DEVOPS-08 §17) | Domain/SSL/DB/secret/monitoring sẵn sàng | QA-10 |
| Pre-release backup gate (DEVOPS-05 §18, DEVOPS-10 §18) | Backup verified trước migration | QA-10 |
| Pre-go-live hardening (DEVOPS-11 §19) | TLS/headers/CORS/rate limit/secret/scan | QA-06, QA-05, QA-10 |
| Release gates tổng (DEVOPS-12 §9) | Toàn bộ gate bắt buộc | QA-08, QA-09, QA-10 (+ QA-03/05/06/07) |
| No-go criteria (DEVOPS-12 §15.2) | Migration fail / regression P0 fail / UAT chưa sign-off / security critical | QA-05, QA-06, QA-08, QA-09, QA-10 |

---

## 8. Khoảng trống / điểm cần chốt giữa DevOps và QA

| # | Vấn đề | DEVOPS liên quan | QA liên quan | Ghi chú |
| --- | --- | --- | --- | --- |
| 1 | Coverage threshold MVP chưa chốt | DEVOPS-02 (DO02-OQ-004) | QA-01 | CI gate cần con số từ test plan |
| 2 | Smoke account/test tenant production | DEVOPS-06/07/12 | QA-03, QA-10 | Smoke test có auth phụ thuộc tài khoản này |
| 3 | Performance threshold MVP | DEVOPS-09, DEVOPS-12 §12.2 | QA-07 | Alert ngưỡng latency/error cần khớp QA-07 |
| 4 | Security exception khi go-live | DEVOPS-11 §20, DEVOPS-12 §15.2 | QA-06 | Quy trình exception cần QA-06 xác nhận rủi ro |
| 5 | Dữ liệu UAT synthetic vs anonymized | DEVOPS-08 (DO08-OQ-005) | QA-09, QA-05 | Ảnh hưởng kịch bản UAT và data scope test |
| 6 | Regression scope khi redeploy trong UAT window | DEVOPS-08 §9.2 | QA-08 | Cần định nghĩa scope tối thiểu chạy lại |

---

## 9. Cách dùng tài liệu

1. Khi review một tài liệu DEVOPS, mở §5 để biết QA nào kiểm chứng nó.
2. Khi lập kế hoạch test/UAT, mở §6 để biết tài liệu QA phục vụ những phần DevOps nào.
3. Khi chuẩn bị go/no-go, dùng §7 + §8 làm checklist liên kết DevOps ↔ QA.
4. Khi cập nhật QA hoặc DEVOPS, cập nhật lại ô tương ứng trong §4 để giữ matrix đồng bộ.

---

## 10. Kết luận

DEVOPS-00 cung cấp lớp truy vết hai chiều giữa **DevOps (DEVOPS-01 -> 12)** và **QA/release readiness (QA-01 -> 10)**, làm rõ cơ sở cho tiêu chí "Có mapping với QA/release readiness" trong bảng nghiệm thu của từng tài liệu DevOps. Các điểm còn trống ở §8 cần được chốt trước go-live cùng QA và Product.
