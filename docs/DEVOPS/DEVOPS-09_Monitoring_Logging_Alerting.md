# DEVOPS-09: MONITORING, LOGGING & ALERTING
# MONITORING, LOGGING & ALERTING
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DEVOPS-09 |
| Tên tài liệu | Monitoring, Logging & Alerting |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | DevOps, Deployment & Release Operations - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-10, DEVOPS-01 -> DEVOPS-08 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

DEVOPS-09 định nghĩa chiến lược logging, monitoring, alerting và observability cho hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này dùng để:

1. Chốt log format và correlation id/request id.
2. Chốt health check, metrics và dashboard vận hành tối thiểu.
3. Chốt alert cho API error, downtime, database, disk, backup, queue và job lỗi.
4. Chốt retention log và bảo vệ dữ liệu nhạy cảm trong log.
5. Chốt quy trình xử lý alert/incident ở MVP.

## 3. Vị trí tài liệu trong chuỗi DevOps

Tài liệu **DEVOPS-09** nằm trong nhánh DevOps sau khi hệ thống đã có PRD, SPEC, Database Design, API Design, UI/UX, Frontend, Backend và QA readiness.

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

## 5. Mục tiêu observability MVP

Hệ thống cần trả lời được các câu hỏi:

1. App có đang sống không?
2. App có sẵn sàng nhận request không?
3. Version nào đang chạy?
4. API nào lỗi nhiều?
5. Database có chậm hoặc mất kết nối không?
6. Worker/job có lỗi không?
7. User có gặp lỗi frontend không?
8. Backup có chạy thành công không?
9. Deploy mới có làm tăng lỗi không?
10. Có dấu hiệu bất thường về bảo mật/runtime không?

## 6. Logging strategy

### 6.1 Log format

Khuyến nghị dùng structured JSON log cho backend:

```json
{
  "timestamp": "2026-06-21T10:00:00+07:00",
  "level": "info",
  "service": "backend-api",
  "environment": "production",
  "request_id": "req_abc123",
  "user_id": "user-uuid-if-authenticated",
  "company_id": "company-uuid-if-known",
  "method": "GET",
  "path": "/api/v1/dashboard/me",
  "status_code": 200,
  "duration_ms": 120,
  "message": "request completed"
}
```

### 6.2 Log level

| Level | Khi dùng | Production |
| --- | --- | --- |
| `debug` | Debug chi tiết | Tắt mặc định |
| `info` | Request, app lifecycle, job success | Bật |
| `warn` | Business warning, retry, degraded | Bật |
| `error` | Exception, API 5xx, job failure | Bật + alert nếu vượt ngưỡng |
| `fatal` | App crash, cannot start | Bật + alert ngay |

### 6.3 Không được log

1. Password, password reset token.
2. JWT access/refresh token.
3. Cookie/session secret.
4. Full Authorization header.
5. Private key, API key, storage secret.
6. Nội dung file nhạy cảm.
7. Thông tin cá nhân nhạy cảm quá mức nếu không cần.
8. Full request body của API chứa hồ sơ nhân sự, hợp đồng, bảng công nếu không mask.

## 7. Request correlation

Mọi request cần có `request_id`.

Nguồn:

1. Frontend gửi `X-Request-Id` nếu có.
2. Backend tạo nếu thiếu.
3. Reverse proxy truyền tiếp header.
4. Log backend/worker/DB slow query liên quan cần chứa request/job id nếu có.

Header khuyến nghị:

```text
X-Request-Id
X-Client-Type
X-Client-Version
```

## 8. Health check

| Endpoint | Mục đích | Public |
| --- | --- | --- |
| `/health/live` | Process sống | Có thể public qua proxy hoặc internal |
| `/health/ready` | DB/Valkey/storage sẵn sàng | Nên internal/restricted |
| `/health/version` | Version/commit/build time | Có thể public nếu không lộ thông tin nhạy cảm |
| `/metrics` | Metrics Prometheus | Không public, cần auth/internal |

## 9. Metrics tối thiểu

### 9.1 Application metrics

| Metric | Ý nghĩa |
| --- | --- |
| Request count by route/status | Tải và lỗi API |
| Request duration p50/p95/p99 | Latency |
| Error rate 4xx/5xx | Sức khỏe API |
| Login success/failure | Auth health/security |
| Active sessions count | Sử dụng hệ thống |
| File upload error count | File service |
| Notification create/delivery count | NOTI health |
| Dashboard widget error count | DASH health |

### 9.2 Infrastructure metrics

| Metric | Ý nghĩa |
| --- | --- |
| CPU usage | Tải server/container |
| Memory usage | Leak/thiếu RAM |
| Disk usage | Rủi ro đầy disk |
| Network in/out | Tải network |
| Container restart count | Stability |
| DB connection count | Pool/DB pressure |
| DB slow query count | Performance |
| Valkey memory/connection | Cache/queue health |

### 9.3 Business/runtime metrics MVP

| Metric | Module |
| --- | --- |
| Check-in/check-out API error | ATT |
| Leave submit/approve error | LEAVE |
| Task update/comment error | TASK |
| Notification unread query latency | NOTI |
| Dashboard load latency | DASH |
| Profile change approval error | HR |

## 10. Alerting strategy

### 10.1 Alert severity

| Severity | Ý nghĩa | Response |
| --- | --- | --- |
| P1 | Production down/data loss/security incident | Xử lý ngay |
| P2 | Chức năng lõi lỗi nghiêm trọng | Xử lý trong ngày/giờ làm việc tùy policy |
| P3 | Lỗi không ảnh hưởng toàn hệ thống | Tạo ticket xử lý |
| P4 | Warning/optimization | Theo dõi backlog |

### 10.2 Alert tối thiểu production

| Alert | Điều kiện gợi ý | Severity |
| --- | --- | --- |
| API down | `/health/ready` fail 3 lần liên tiếp | P1 |
| Frontend down | HTTP 5xx/timeout liên tục | P1 |
| API 5xx tăng | 5xx > 2-5% trong 5-10 phút | P2/P1 |
| DB connection fail | App không kết nối DB | P1 |
| Disk usage cao | > 80% warning, > 90% critical | P2/P1 |
| Backup fail | Backup production fail | P1/P2 |
| Worker job fail nhiều | Job critical fail liên tục | P2 |
| Queue backlog cao | Backlog vượt ngưỡng | P2 |
| Login failure spike | Tăng bất thường | P2/security |
| SSL cert gần hết hạn | < 14 ngày | P2 |

## 11. Monitoring dashboard MVP

### 11.1 Dashboard vận hành tổng quan

Các panel nên có:

1. Uptime frontend/API.
2. API request rate.
3. API latency p95.
4. API error rate.
5. Top 10 routes lỗi.
6. DB connection/slow query.
7. CPU/memory/disk.
8. Container restart.
9. Worker job success/failure.
10. Backup status.

### 11.2 Dashboard release monitoring

Dùng trong 30-60 phút sau deploy:

1. Error rate trước/sau deploy.
2. Latency trước/sau deploy.
3. Login error.
4. Dashboard load error.
5. Check-in/leave/task API error.
6. Frontend JS error.
7. Container restart.
8. DB slow query.

## 12. Error tracking frontend/backend

Nếu dùng Sentry hoặc công cụ tương tự:

| Thuộc tính | Cần có |
| --- | --- |
| Environment | local/dev/staging/production |
| Release version | `v1.0.0` hoặc commit SHA |
| Service | frontend/backend/worker |
| Request id | Link log backend |
| User id | Chỉ ID, không PII thừa |
| Company id | Nếu cần phân tích tenant |
| Breadcrumb | Không chứa secret/PII nhạy cảm |

## 13. Log retention

| Log | Local/dev | Staging | Production |
| --- | --- | --- | --- |
| App request log | Ngắn | 7-14 ngày | 30-90 ngày tùy policy |
| Error log | Ngắn | 14-30 ngày | 90 ngày hoặc hơn |
| Audit log nghiệp vụ | DB retention riêng | Theo policy | Theo policy dài hơn |
| Security log | 14-30 ngày | 90 ngày | 180 ngày+ nếu cần |
| Backup log | N/A | 30 ngày | 180 ngày+ |

Audit log nghiệp vụ trong database không thay thế app log vận hành.

## 14. Alert routing

| Alert | Kênh |
| --- | --- |
| P1 production down | Phone/on-call + incident channel |
| P2 production degraded | DevOps/Tech channel |
| Staging failure | Dev/QA channel |
| Backup fail | DevOps + Tech Lead |
| Security suspicious | Security/DevOps/Tech Lead |
| Release monitoring anomaly | Release channel |

## 15. Incident workflow MVP

```text
alert triggered
  -> acknowledge
  -> classify severity
  -> assign owner
  -> investigate logs/metrics/recent deploy
  -> mitigate: rollback/disable flag/restart/fix
  -> verify recovery
  -> communicate status
  -> write incident note if P1/P2
  -> create follow-up tasks
```

## 16. Logging cho module nghiệp vụ

| Module | Log cần có |
| --- | --- |
| AUTH | Login success/fail, token refresh fail, account locked |
| HR | Profile create/update/status change, profile change approval |
| ATT | Check-in/out error, adjustment approval, auto attendance job |
| LEAVE | Submit/approve/reject/cancel, balance adjustment |
| TASK | Assign/update/status/comment/mention failures |
| NOTI | Event consumed, notification created, delivery failure |
| DASH | Widget query fail, cache refresh fail |
| FOUNDATION | File upload/download/delete error, setting change |

## 17. Checklist DEVOPS-09

### 17.1 Logging checklist

- [ ] Backend log JSON structured.
- [ ] Mỗi request có request_id.
- [ ] Không log secret/token/password.
- [ ] Log có service/environment/version.
- [ ] Error log có stack trace ở dev/staging; production kiểm soát phù hợp.
- [ ] Worker job có log start/success/failure.

### 17.2 Monitoring checklist

- [ ] Health endpoint hoạt động.
- [ ] Metrics API latency/error rate.
- [ ] Metrics CPU/memory/disk.
- [ ] DB connection/slow query monitoring.
- [ ] Worker/job monitoring.
- [ ] Backup status monitoring.
- [ ] Frontend error tracking nếu có.

### 17.3 Alert checklist

- [ ] API down alert.
- [ ] Frontend down alert.
- [ ] DB connection fail alert.
- [ ] API 5xx high alert.
- [ ] Disk high alert.
- [ ] Backup fail alert.
- [ ] SSL expiry alert.
- [ ] Alert routing rõ người nhận.

## 18. Rủi ro và kiểm soát

| Rủi ro | Tác động | Kiểm soát |
| --- | --- | --- |
| Không có alert | Lỗi kéo dài | Alert tối thiểu production |
| Log chứa PII/secret | Rò rỉ dữ liệu | Mask/redact + review |
| Không có request_id | Khó debug | Correlation ID bắt buộc |
| Log retention quá ngắn | Không điều tra được | Retention policy |
| Alert quá nhiều | Alert fatigue | Threshold hợp lý + grouping |
| Monitoring không theo release | Không phát hiện regression | Release dashboard |

## 19. Open questions

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| DO09-OQ-001 | Stack monitoring dùng Grafana/Prometheus, cloud monitoring hay hosted service? | DevOps | Cao |
| DO09-OQ-002 | Có dùng Sentry/error tracking cho frontend/backend không? | DevOps/FE/BE | Cao |
| DO09-OQ-003 | Log retention production chính thức bao lâu? | Product/Security | Trung bình |
| DO09-OQ-004 | Ai là on-call hoặc owner nhận P1 trong MVP? | Tech Lead | Cao |
| DO09-OQ-005 | Có cần audit log export cho compliance không? | Product | Thấp/Trung bình |

## 99. Tiêu chí nghiệm thu DEVOPS-09

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

**DEVOPS-09** hoàn thiện một phần quan trọng trong chuỗi DevOps MVP. Tài liệu này cần được dùng làm căn cứ khi viết script, pipeline, Dockerfile, cấu hình môi trường, checklist release và runbook vận hành thực tế.
