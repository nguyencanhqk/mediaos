# DEVOPS-11: SECURITY HARDENING & RUNTIME PROTECTION
# SECURITY HARDENING & RUNTIME PROTECTION
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DEVOPS-11 |
| Tên tài liệu | Security Hardening & Runtime Protection |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | DevOps, Deployment & Release Operations - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-10, DEVOPS-01 -> DEVOPS-10 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

DEVOPS-11 định nghĩa các biện pháp hardening bảo mật hạ tầng và runtime cho MVP.

Tài liệu này dùng để:

1. Chốt baseline bảo mật cho network, reverse proxy, TLS, headers và CORS.
2. Chốt bảo vệ secret, container, dependency, image và server runtime.
3. Chốt rate limiting, brute-force protection và runtime access control.
4. Chốt logging/audit cho sự kiện bảo mật.
5. Chốt checklist hardening trước go-live production.

## 3. Vị trí tài liệu trong chuỗi DevOps

Tài liệu **DEVOPS-11** nằm trong nhánh DevOps sau khi hệ thống đã có PRD, SPEC, Database Design, API Design, UI/UX, Frontend, Backend và QA readiness.

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

## 5. Security boundary

| Layer | Trách nhiệm |
| --- | --- |
| Browser/frontend | Không chứa secret, route guard UX, CSP compatible |
| Reverse proxy | TLS, routing, security headers, compression, rate limit cơ bản |
| Backend API | Auth, permission, data scope, validation, audit, business rule |
| Database | Private network, least privilege credential, backup security |
| Storage | Private file, signed URL, access log |
| CI/CD | Secret protection, scan, approval, traceability |
| Infrastructure | Firewall, patching, non-root runtime, monitoring |

Frontend không phải lớp bảo mật cuối cùng; backend/API luôn là trust boundary.

## 6. Network hardening

### 6.1 Public/private exposure

| Thành phần | Public internet | Rule |
| --- | --- | --- |
| Frontend | Có | HTTPS only |
| API | Có qua reverse proxy | HTTPS, rate limit, CORS |
| Database | Không | Private network/firewall |
| Valkey | Không | Private network |
| Metrics | Không | Internal/VPN/auth |
| Admin panel infra | Không | Internal/VPN/auth |
| SSH | Hạn chế | IP allowlist/key only |

### 6.2 Firewall baseline

1. Chỉ mở 80/443 public.
2. SSH chỉ mở cho IP/VPN tin cậy.
3. Database/Valkey chỉ internal.
4. Không expose Docker socket ra public.
5. Security group/firewall rule cần được review trước go-live.

## 7. TLS/HTTPS

Production và staging/UAT phải dùng HTTPS.

Checklist:

- [ ] HTTP redirect HTTPS.
- [ ] TLS certificate hợp lệ.
- [ ] Auto renew certificate.
- [ ] Alert trước khi certificate hết hạn.
- [ ] Không dùng self-signed cert cho UAT business user.
- [ ] Bật HSTS production sau khi domain ổn định.

## 8. Security headers

| Header | Production | Ghi chú |
| --- | --- | --- |
| `Strict-Transport-Security` | Có | Sau khi HTTPS ổn định |
| `X-Content-Type-Options` | Có | `nosniff` |
| `X-Frame-Options` hoặc CSP frame | Có | Chống clickjacking |
| `Referrer-Policy` | Có | `strict-origin-when-cross-origin` |
| `Content-Security-Policy` | Nên có | Cần test với frontend |
| `Permissions-Policy` | Nên có | Hạn chế browser features |

CSP cần kiểm thử kỹ để không chặn asset/API/error tracking hợp lệ.

## 9. CORS và cookie

### 9.1 CORS

1. Không dùng `*` cho production nếu gửi credential.
2. Allowed origins theo environment.
3. Allowed methods whitelist.
4. Allowed headers whitelist, bao gồm `Authorization`, `Content-Type`, `X-Request-Id`, `Idempotency-Key` nếu dùng.
5. Preflight cache hợp lý.

### 9.2 Cookie/session

Nếu dùng cookie:

| Attribute | Production |
| --- | --- |
| `HttpOnly` | Có cho refresh/session cookie |
| `Secure` | Có |
| `SameSite` | `Lax` hoặc `Strict` tùy flow |
| `Domain` | Đúng production domain |
| `Path` | Giới hạn phù hợp |

## 10. Rate limiting và brute-force protection

| Endpoint | Rule gợi ý |
| --- | --- |
| Login | Giới hạn theo IP + account/email |
| Forgot password | Giới hạn theo IP + email |
| Reset password | Giới hạn theo token/IP |
| File upload | Giới hạn size/rate |
| General API | Rate limit theo IP/user/token |
| Notification mark all | Rate limit nhẹ |
| Export | Rate limit/async job |

Login failure spike cần alert security.

## 11. Secret protection

1. Không commit secret vào repo.
2. Không log secret.
3. Không dùng chung secret giữa environments.
4. Production secret chỉ cho người cần thiết.
5. Rotate secret khi leak hoặc theo policy.
6. CI/CD secret không accessible từ PR fork.
7. Server env file permission chặt nếu dùng file.
8. JWT access/refresh secret tách nhau.
9. Storage key production tách staging.
10. Backup config/secret phải mã hóa.

## 12. Container/runtime hardening

| Biện pháp | MVP |
| --- | --- |
| Non-root user | Nên/Có |
| Minimal base image | Có |
| Không cài debug tool dư thừa | Có |
| Read-only filesystem | Nếu phù hợp |
| Resource limit | Có |
| Restart policy | Có |
| Health check | Có |
| Image scan | Có |
| Không mount Docker socket vào app | Có |
| Không mount secret dưới dạng public volume | Có |

## 13. Dependency và image scanning

Pipeline cần có:

1. Dependency vulnerability scan.
2. Docker image scan.
3. Secret scan.
4. Dockerfile lint cơ bản nếu có.
5. License check nếu sản phẩm yêu cầu.
6. Rule chặn production nếu critical vulnerability chưa được chấp nhận.

## 14. Database security

1. Database không public internet.
2. App user DB dùng least privilege, không dùng superuser.
3. Migration user có quyền riêng nếu có thể.
4. Backup DB private/encrypted.
5. Production DB credential rotate theo policy.
6. Query log/slow log không chứa dữ liệu nhạy cảm quá mức.
7. Không copy production DB sang staging nếu chưa anonymize.
8. Audit thao tác dữ liệu quan trọng qua app audit log.

## 15. File storage security

1. File private mặc định.
2. Download qua signed URL hoặc backend kiểm quyền.
3. Signed URL TTL ngắn.
4. Không public bucket production.
5. Giới hạn MIME type/size upload.
6. Scan file nếu có yêu cầu hoặc phase sau.
7. File nhạy cảm có access log.
8. Xóa mềm/retention theo policy.

## 16. Application runtime protection

| Nhóm | Biện pháp |
| --- | --- |
| Auth | Token TTL, refresh rotation nếu có, account lock |
| Permission | Backend guard, data scope, field-level masking |
| Input | Validation DTO/schema, sanitize search/filter/sort |
| Upload | Size/MIME limit, private storage |
| Export | Permission + rate limit + background job nếu lớn |
| Audit | Ghi thao tác nhạy cảm |
| Idempotency | API quan trọng tránh xử lý trùng |
| Error response | Không leak stack trace production |

## 17. Production access hardening

| Access | Rule |
| --- | --- |
| SSH | Key-based, no password, IP allowlist/VPN |
| Production secret | Least privilege, approval/log |
| Deploy | Qua CI/CD, không SSH sửa tay nếu tránh được |
| Database console | Hạn chế, audit nếu có |
| Backup access | Hạn chế, mã hóa |
| Monitoring | Auth/VPN, không public |

## 18. Security logging

Cần log/audit:

1. Login success/failure.
2. Account locked/unlocked.
3. Password reset requested/completed.
4. Role/permission changed.
5. User status changed.
6. Sensitive file accessed/downloaded.
7. Production deploy started/completed/failed.
8. Secret rotation/change nếu có log an toàn.
9. Rate limit exceeded nhiều lần.
10. Suspicious access pattern nếu có.

## 19. Pre-go-live hardening checklist

### 19.1 Network/TLS

- [ ] HTTPS production hoạt động.
- [ ] HTTP redirect HTTPS.
- [ ] DB/Valkey không public.
- [ ] SSH restricted.
- [ ] Metrics/admin không public.
- [ ] SSL expiry alert.

### 19.2 App/API

- [ ] Security headers bật.
- [ ] CORS production whitelist.
- [ ] Rate limit login/forgot/export/upload.
- [ ] Error response không leak stack trace.
- [ ] Backend permission guard hoạt động.
- [ ] Audit log thao tác nhạy cảm.

### 19.3 Secret/runtime

- [ ] Không có secret trong repo/image/bundle.
- [ ] Production secret tách staging.
- [ ] Env file permission chặt hoặc secret manager.
- [ ] Container không root nếu có thể.
- [ ] Image scan pass hoặc exception được duyệt.
- [ ] Dependency scan pass hoặc exception được duyệt.

### 19.4 Data/file

- [ ] Backup private.
- [ ] File bucket private.
- [ ] Signed URL TTL hợp lý.
- [ ] Production DB không dùng dữ liệu demo.
- [ ] Staging/UAT không chứa production data chưa anonymize.

## 20. Security exception process

Nếu phải go-live với một điểm chưa đạt:

1. Ghi rõ exception.
2. Nêu rủi ro và tác động.
3. Có owner chịu trách nhiệm.
4. Có deadline xử lý.
5. Có biện pháp giảm nhẹ tạm thời.
6. Được Tech Lead/Product/Security owner chấp thuận.

## 21. Rủi ro và kiểm soát

| Rủi ro | Tác động | Kiểm soát |
| --- | --- | --- |
| DB public | Mất dữ liệu | Firewall/private network |
| Secret leak | Chiếm quyền | Secret scan/rotate/least privilege |
| CORS mở quá rộng | CSRF/data risk | Whitelist origin |
| Không rate limit login | Brute force | Rate limit + account lock |
| File public | Lộ hồ sơ | Private bucket + signed URL |
| Critical CVE | Bị khai thác | Scan + patch gate |
| Stack trace production | Lộ nội bộ | Error masking |

## 22. Open questions

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| DO11-OQ-001 | Có yêu cầu VPN/IP allowlist cho admin/monitoring không? | DevOps/Security | Cao |
| DO11-OQ-002 | CSP strict đến mức nào cho MVP? | FE/Security | Trung bình |
| DO11-OQ-003 | Có cần malware scan cho file upload ngay MVP không? | Product/Security | Trung bình |
| DO11-OQ-004 | Critical vulnerability có được exception khi go-live không? | Tech Lead/Security | Cao |
| DO11-OQ-005 | Chính sách retention security log là bao lâu? | Security/Product | Trung bình |

## 99. Tiêu chí nghiệm thu DEVOPS-11

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

**DEVOPS-11** hoàn thiện một phần quan trọng trong chuỗi DevOps MVP. Tài liệu này cần được dùng làm căn cứ khi viết script, pipeline, Dockerfile, cấu hình môi trường, checklist release và runbook vận hành thực tế.
