# DEVOPS-08: STAGING, UAT & PRODUCTION ENVIRONMENT
# STAGING, UAT & PRODUCTION ENVIRONMENT
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DEVOPS-08 |
| Tên tài liệu | Staging, UAT & Production Environment |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | DevOps, Deployment & Release Operations - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-10, DEVOPS-01 -> DEVOPS-07 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

DEVOPS-08 định nghĩa cách thiết lập và vận hành các môi trường staging, UAT và production cho MVP.

Tài liệu này dùng để:

1. Chốt vai trò của staging, UAT và production.
2. Chốt domain, network, SSL, database, storage, secret và monitoring cho từng môi trường.
3. Chốt quy trình promote release từ staging/UAT lên production.
4. Chốt quy tắc dữ liệu test, dữ liệu production và anonymization.
5. Chốt quyền truy cập môi trường.
6. Đảm bảo QA/UAT có môi trường đủ giống production trước go-live.

## 3. Vị trí tài liệu trong chuỗi DevOps

Tài liệu **DEVOPS-08** nằm trong nhánh DevOps sau khi hệ thống đã có PRD, SPEC, Database Design, API Design, UI/UX, Frontend, Backend và QA readiness.

Chuỗi DevOps MVP được tổ chức như sau:

```text
DEVOPS-01: DevOps Architecture & Environment Strategy
  -> DEVOPS-02: Repository, Branching & CI Pipeline
  -> DEVOPS-03: Docker & Containerization
  -> DEVOPS-04: Environment Configuration & Secrets Management
  -> DEVOPS-05: Database Migration & Seed Deployment
  -> DEVOPS-06: Backend Deployment Pipeline
  -> DEVOPS-07: Frontend Deployment Pipeline
  -> DEVOPS-08: Staging, UAT & Production Environment
  -> DEVOPS-09: Monitoring, Logging & Alerting
  -> DEVOPS-10: Backup, Rollback & Disaster Recovery
  -> DEVOPS-11: Security Hardening & Runtime Protection
  -> DEVOPS-12: Release Management & Go-live Plan
```

Mục tiêu của chuỗi này là biến mã nguồn, database migration, cấu hình môi trường, test result và checklist QA thành hệ thống có thể triển khai, giám sát, backup, rollback và go-live an toàn.

## 4. Nguyên tắc DevOps áp dụng chung

1. **Production-like từ sớm**: staging/UAT phải gần giống production về runtime, biến môi trường, SSL, reverse proxy, migration, logging và monitoring.
2. **Backend là trust boundary**: frontend có thể ẩn/hiện UI nhưng backend/API luôn kiểm tra authentication, permission, data scope và business rule.
3. **Mỗi môi trường tách biệt**: local, development, staging/UAT và production có database, secret, domain và storage riêng.
4. **Không deploy bằng `latest` ở production**: image phải có tag rõ ràng theo version hoặc commit SHA để rollback và truy vết.
5. **Migration phải được kiểm soát**: mọi migration cần chạy qua staging trước production và production phải backup trước migration.
6. **Deploy an toàn hơn deploy nhanh**: production deploy cần approval, smoke test, monitoring window và rollback plan.
7. **Secret không nằm trong source code**: secret chỉ được lưu trong secret store của CI/CD, server hoặc secret manager.
8. **Quan sát được hệ thống**: log, metric, health check, alert và audit vận hành phải có từ MVP.
9. **Tự động hóa phần lặp lại**: build, test, scan, migration, deploy và smoke test nên chuẩn hóa bằng pipeline/script.
10. **Có checklist rõ ràng**: mỗi bước release phải có điều kiện pass/fail để tránh quyết định cảm tính.

## 5. Mô hình môi trường

| Môi trường | Mục đích | Người dùng | Dữ liệu | Uptime |
| --- | --- | --- | --- | --- |
| Development | Tích hợp code thường xuyên | Dev/QA kỹ thuật | Test/demo | Thấp |
| Staging | Kiểm thử release candidate gần production | QA/Dev/Product | Test gần thật | Trung bình/Cao |
| UAT | Business acceptance | BA/Product/Key users | Kịch bản UAT | Cao trong UAT window |
| Production | Người dùng thật | Toàn công ty | Dữ liệu thật | Cao |

Staging và UAT có thể gộp trong MVP nếu team nhỏ, nhưng cần quản lý release window để không deploy liên tục khi UAT đang diễn ra.

## 6. Domain đề xuất

| Môi trường | Domain frontend | Domain API |
| --- | --- | --- |
| Development | `dev.ems.example.com` | `api.dev.ems.example.com` |
| Staging | `staging.ems.example.com` | `api.staging.ems.example.com` |
| UAT | `uat.ems.example.com` | `api.uat.ems.example.com` |
| Production | `app.ems.example.com` | `api.ems.example.com` |

Nếu staging/UAT gộp:

```text
staging.ems.example.com
api.staging.ems.example.com
```

## 7. Environment parity

| Thành phần | Staging/UAT | Production |
| --- | --- | --- |
| Runtime container | Giống production | Chuẩn production |
| Reverse proxy | Giống production | Có SSL/security header |
| SSL | SSL thật | SSL thật |
| Database engine | PostgreSQL cùng major version | PostgreSQL production |
| Valkey/cache | Cùng loại nếu production dùng | Production cache |
| Object storage | Bucket riêng | Bucket production |
| Env config | Tách riêng | Tách riêng |
| Secret | Secret riêng | Secret production |
| Monitoring | Bật cơ bản | Bật đầy đủ tối thiểu |
| Logging | Bật | Bật và retention rõ |

## 8. Staging environment

### 8.1 Vai trò

Staging là nơi kiểm thử release candidate trước production.

Staging cần:

1. Deploy từ `release/*` hoặc release candidate tag.
2. Có database riêng.
3. Có object storage riêng.
4. Có SSL và domain riêng.
5. Có migration chạy trước production.
6. Có log/monitoring cơ bản.
7. Có smoke test sau mỗi deploy.
8. Có dữ liệu test đủ để QA regression.

### 8.2 Không dùng staging cho

1. Test tính năng đang dev chưa vào release candidate.
2. Lưu production secret.
3. Lưu dữ liệu production chưa ẩn danh.
4. Deploy tự động liên tục trong UAT window nếu staging gộp UAT.

## 9. UAT environment

### 9.1 Vai trò

UAT dùng cho Product/Business/Key users nghiệm thu nghiệp vụ.

UAT cần:

1. Stable trong suốt UAT window.
2. Có version release candidate rõ.
3. Có checklist UAT theo QA-09.
4. Có dữ liệu test theo kịch bản business.
5. Có account cho Employee, Manager, HR, Admin.
6. Không chứa dữ liệu thật nhạy cảm nếu chưa anonymize.
7. Có cơ chế reset data nếu cần chạy lại kịch bản.

### 9.2 Nếu gộp UAT với staging

Quy tắc:

1. Trong UAT window, không auto deploy mọi commit.
2. Chỉ deploy bản fix được Release Manager duyệt.
3. Mỗi lần deploy lại phải thông báo QA/Product.
4. Sau deploy lại phải chạy smoke test và regression scope liên quan.

## 10. Production environment

Production là môi trường người dùng thật.

Production bắt buộc:

1. Deploy bằng image/artifact versioned.
2. Manual approval trước deploy.
3. Backup DB trước release có migration.
4. Production secret tách riêng.
5. Database không public internet.
6. File storage private và backup được.
7. HTTPS bắt buộc.
8. Security headers và rate limit cơ bản.
9. Monitoring/logging/alert tối thiểu.
10. Rollback plan và incident contact.

## 11. Network và firewall

### 11.1 Public access

| Thành phần | Public |
| --- | --- |
| Frontend | Có, qua HTTPS |
| API | Có, qua HTTPS/reverse proxy |
| Reverse proxy | Có |
| Database | Không |
| Valkey | Không |
| Internal admin port | Không |
| Metrics dashboard | Không public hoặc có auth/VPN |

### 11.2 Firewall rule tối thiểu

| Port | Mục đích | Public |
| --- | --- | --- |
| 80 | HTTP redirect HTTPS | Có |
| 443 | HTTPS | Có |
| 22 | SSH | Hạn chế IP/VPN |
| 5432 | PostgreSQL | Không public |
| 6379 | Valkey | Không public |

## 12. Database theo môi trường

| Environment | DB name ví dụ | Ghi chú |
| --- | --- | --- |
| Development | `ems_development` | Reset được |
| Staging | `ems_staging` | Release candidate test |
| UAT | `ems_uat` | Business test nếu tách |
| Production | `ems_production` | Dữ liệu thật |

Không dùng chung database giữa staging/UAT và production.

## 13. Storage theo môi trường

| Environment | Bucket/path | Ghi chú |
| --- | --- | --- |
| Local | local volume | File giả/test |
| Development | `ems-dev-files` | Test |
| Staging | `ems-staging-files` | Test/UAT |
| Production | `ems-prod-files` | Private, backup, retention |

Production file storage phải private; download qua signed URL hoặc backend proxy có kiểm quyền.

## 14. Dữ liệu staging/UAT

### 14.1 Nguồn dữ liệu

| Nguồn | Dùng được? | Điều kiện |
| --- | --- | --- |
| Demo seed | Có | Phù hợp QA flow |
| Synthetic data | Có | Khuyến nghị |
| Production copy | Hạn chế | Phải anonymize/mask dữ liệu nhạy cảm |
| Manual test data | Có | Có checklist reset |

### 14.2 Không đưa vào staging/UAT

1. Mật khẩu production thật.
2. Secret production.
3. File hồ sơ nhân sự thật chưa được phép.
4. Dữ liệu lương/thuế/bảo hiểm thật.
5. Token hoặc session production.

## 15. Access control môi trường

| Vai trò | Development | Staging/UAT | Production |
| --- | --- | --- | --- |
| Developer | Có | Có giới hạn | Không SSH/secret mặc định |
| QA | Có | Có | Không secret |
| Product/BA | Không cần | Có UAT | User thường nếu cần |
| DevOps | Có | Có | Có theo least privilege |
| Tech Lead | Có | Có | Có approval/log |
| Release Manager | Xem | Có | Approve deploy |

Mọi truy cập production hạ tầng cần có audit hoặc change log.

## 16. Promote release

```text
release branch created
  -> deploy staging
  -> migration staging
  -> smoke test staging
  -> QA regression
  -> UAT sign-off
  -> create release tag
  -> production approval
  -> backup production
  -> deploy production
  -> smoke test production
  -> monitor
```

Không promote nếu staging khác production quá nhiều về config/runtime.

## 17. Environment readiness checklist

### 17.1 Staging/UAT

- [ ] Domain hoạt động.
- [ ] HTTPS hoạt động.
- [ ] Frontend trỏ đúng staging/UAT API.
- [ ] Database riêng.
- [ ] Storage riêng.
- [ ] Secret riêng.
- [ ] Migration chạy được.
- [ ] Seed test đủ cho QA/UAT.
- [ ] Log/monitoring cơ bản.
- [ ] Smoke test pass.
- [ ] Account test theo role sẵn sàng.

### 17.2 Production

- [ ] Domain production sẵn sàng.
- [ ] SSL production sẵn sàng.
- [ ] Database production tạo và backup được.
- [ ] Storage production private.
- [ ] Secret production đã cấu hình.
- [ ] Reverse proxy/security headers/rate limit sẵn sàng.
- [ ] Monitoring/logging/alert sẵn sàng.
- [ ] Backup/restore runbook sẵn sàng.
- [ ] Rollback runbook sẵn sàng.
- [ ] Release checklist/go-live plan sẵn sàng.

## 18. Maintenance window

Production deploy có migration hoặc thay đổi rủi ro nên có maintenance window.

Cần xác định:

1. Thời gian bắt đầu/kết thúc.
2. Người trực DevOps/Backend/Frontend/QA/Product.
3. Điều kiện go/no-go.
4. Điều kiện rollback.
5. Kênh thông báo user nếu cần.
6. Post-release monitoring window.

## 19. Rủi ro và kiểm soát

| Rủi ro | Tác động | Kiểm soát |
| --- | --- | --- |
| Staging khác production | Lỗi lọt production | Environment parity checklist |
| UAT bị deploy đè | Nghiệm thu sai | Freeze UAT window |
| Dữ liệu thật lộ sang staging | Rủi ro pháp lý/bảo mật | Anonymize/mask data |
| Production secret bị dùng ở staging | Lộ secret | Secret per env |
| Database public | Bị tấn công | Firewall/private network |
| Không có monitoring prod | Không phát hiện lỗi | Alert tối thiểu |

## 20. Open questions

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| DO08-OQ-001 | Staging và UAT tách riêng hay dùng chung trong MVP? | Product/QA/DevOps | Cao |
| DO08-OQ-002 | Domain chính thức production là gì? | Product/DevOps | Cao |
| DO08-OQ-003 | Production hạ tầng là VM Compose, Kubernetes hay PaaS? | Tech Lead/DevOps | Cao |
| DO08-OQ-004 | Có cần VPN/IP allowlist cho staging/UAT không? | Security/DevOps | Trung bình |
| DO08-OQ-005 | Dữ liệu UAT dùng synthetic hay anonymized production? | QA/Product | Trung bình |

## 99. Tiêu chí nghiệm thu DEVOPS-08

| STT | Tiêu chí | Bắt buộc MVP |
| --- | --- | --- |
| 1 | Tài liệu nêu rõ mục tiêu, phạm vi và không phạm vi | Có |
| 2 | Có quy trình triển khai hoặc vận hành cụ thể | Có |
| 3 | Có checklist cho DevOps/Backend/Frontend/QA | Có |
| 4 | Có rule tách biệt môi trường local/dev/staging/production | Có |
| 5 | Có kiểm soát bảo mật, secret, permission hoặc access nếu liên quan | Có |
| 6 | Có rollback/fallback hoặc cách xử lý lỗi nếu liên quan | Có |
| 7 | Có mapping với QA/release readiness nếu liên quan | Có |
| 8 | Có open questions cần chốt trước production | Có |

---

## 100. Kết luận

**DEVOPS-08** hoàn thiện một phần quan trọng trong chuỗi DevOps MVP. Tài liệu này cần được dùng làm căn cứ khi viết script, pipeline, Dockerfile, cấu hình môi trường, checklist release và runbook vận hành thực tế.
