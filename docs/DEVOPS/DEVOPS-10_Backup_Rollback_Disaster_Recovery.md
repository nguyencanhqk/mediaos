# DEVOPS-10: BACKUP, ROLLBACK & DISASTER RECOVERY
# BACKUP, ROLLBACK & DISASTER RECOVERY
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DEVOPS-10 |
| Tên tài liệu | Backup, Rollback & Disaster Recovery |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | DevOps, Deployment & Release Operations - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-10, DEVOPS-01 -> DEVOPS-09 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

DEVOPS-10 định nghĩa chiến lược backup, restore, rollback và disaster recovery cho hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này dùng để:

1. Chốt phạm vi dữ liệu cần backup: database, file storage, config quan trọng, release artifact.
2. Chốt tần suất backup, retention và vị trí lưu backup.
3. Chốt quy trình restore drill và kiểm tra backup.
4. Chốt rollback app/frontend/backend/database theo từng tình huống.
5. Chốt disaster recovery runbook cho sự cố nghiêm trọng.
6. Đảm bảo production có khả năng phục hồi khi release lỗi hoặc hạ tầng gặp sự cố.

## 3. Vị trí tài liệu trong chuỗi DevOps

Tài liệu **DEVOPS-10** nằm trong nhánh DevOps sau khi hệ thống đã có PRD, SPEC, Database Design, API Design, UI/UX, Frontend, Backend và QA readiness.

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

## 5. Phạm vi backup

| Loại dữ liệu | Bắt buộc backup | Ghi chú |
| --- | --- | --- |
| PostgreSQL production | Có | Dữ liệu nghiệp vụ chính |
| File storage production | Có | Hồ sơ nhân viên, file task, file leave, tài liệu |
| ENV/config production quan trọng | Có | Lưu bảo mật/mã hóa |
| Reverse proxy/cert config | Nên có | Nếu self-managed |
| Release artifact/image tag | Có | Cần rollback |
| Audit/security log | Theo policy | Có retention riêng |
| Monitoring dashboard config | Nên có | Nếu tự host |

## 6. Backup objective

| Chỉ số | Định nghĩa | MVP đề xuất |
| --- | --- | --- |
| RPO | Mất dữ liệu tối đa chấp nhận được | 24h hoặc thấp hơn nếu có PITR |
| RTO | Thời gian phục hồi mục tiêu | 2-4h MVP nhỏ; cần chốt theo business |
| Retention | Thời gian giữ backup | 7 daily + 4 weekly + 3 monthly tùy chi phí |
| Restore drill | Kiểm tra khôi phục | Ít nhất trước go-live và định kỳ |

Nếu nghiệp vụ yêu cầu gần realtime, cần managed DB có Point-in-Time Recovery.

## 7. Database backup strategy

### 7.1 Backup loại

| Loại | Khi dùng |
| --- | --- |
| Full logical backup | MVP, dễ restore, dùng `pg_dump` |
| Physical backup | DB lớn hơn, restore nhanh hơn |
| PITR/WAL archive | Cần RPO thấp |
| Pre-release backup | Bắt buộc trước migration production |

### 7.2 Lịch backup đề xuất

| Thời điểm | Nội dung |
| --- | --- |
| Hằng ngày | Full DB backup production |
| Trước release có migration | Full DB backup bắt buộc |
| Sau go-live | Verify backup chạy định kỳ |
| Hằng tuần | Restore drill hoặc ít nhất verify backup |
| Hằng tháng | Review retention/cost/security |

### 7.3 Tên file backup

```text
ems_prod_db_daily_20260621_020000.dump
ems_prod_db_before_v1.0.0_20260621_230000.dump
```

## 8. File storage backup

File storage production cần backup vì các module HR/TASK/LEAVE có file đính kèm.

| Storage | Backup strategy |
| --- | --- |
| Local volume | Snapshot/rsync sang storage khác |
| S3-compatible | Versioning + lifecycle + cross-region nếu cần |
| Managed file storage | Snapshot/backup policy của provider |

Nguyên tắc:

1. File private không public bucket.
2. Backup file phải giữ metadata/link tương thích DB.
3. Restore DB và file storage cần cùng mốc thời gian càng gần càng tốt.
4. File delete nhầm nên có retention/versioning nếu chi phí cho phép.

## 9. Config backup

Config/secret production không backup dạng plaintext trong repo.

Cách làm:

1. Lưu trong secret manager nếu có.
2. Nếu dùng env file server, backup mã hóa và giới hạn quyền.
3. Ghi document danh sách biến bắt buộc nhưng không ghi giá trị secret.
4. Có runbook tái tạo môi trường từ secret store.

## 10. Backup security

1. Backup chứa dữ liệu thật nên phải bảo mật như production.
2. Backup phải mã hóa at rest nếu có thể.
3. Hạn chế người có quyền tải/xem backup.
4. Không gửi backup qua chat/email.
5. Có retention và deletion policy.
6. Test restore vào môi trường private, không public.
7. Khi dùng backup production cho staging, phải anonymize/mask dữ liệu nhạy cảm.

## 11. Restore drill

Restore drill là kiểm tra backup có dùng được thật.

Quy trình:

```text
select backup file
  -> create isolated restore environment
  -> restore database
  -> restore/link file storage sample
  -> run migration status check
  -> run application smoke test
  -> verify sample data count
  -> document result
```

Checklist:

- [ ] Restore DB thành công.
- [ ] App kết nối DB restore được.
- [ ] Login test account được hoặc tạo smoke account.
- [ ] Dữ liệu HR/ATT/LEAVE/TASK sample tồn tại.
- [ ] File link sample mở được theo quyền.
- [ ] Không public dữ liệu restore.
- [ ] Ghi thời gian restore để đánh giá RTO.

## 12. Application rollback

### 12.1 Backend rollback

```text
identify previous stable backend image
  -> deploy previous image tag
  -> restart backend-api/worker
  -> smoke test health/auth/core API
  -> monitor error rate
```

### 12.2 Frontend rollback

```text
identify previous frontend image/artifact
  -> deploy previous version
  -> clear/invalidate index.html cache if needed
  -> route smoke test
  -> monitor frontend errors
```

### 12.3 Worker rollback

Worker phải rollback cùng backend nếu dùng chung code version để tránh job logic lệch schema/API.

## 13. Database rollback

Database rollback là rủi ro cao.

| Tình huống | Ưu tiên |
| --- | --- |
| App lỗi, DB backward compatible | Rollback app |
| Migration thêm bảng/cột lỗi nhẹ | Forward-fix migration |
| Dữ liệu bị update sai có thể sửa | Data correction script |
| Dữ liệu mất/hỏng nghiêm trọng | Restore backup sau quyết định go/no-go |

Không tự động restore production nếu chưa đánh giá mất dữ liệu từ thời điểm backup đến hiện tại.

## 14. Disaster recovery scenarios

### 14.1 App server down

```text
alert server down
  -> verify provider/VM/container status
  -> restart service or provision replacement
  -> pull last stable image
  -> attach config/secret
  -> verify DB/storage connectivity
  -> smoke test
```

### 14.2 Database unavailable

```text
DB alert
  -> check managed DB status or host resources
  -> failover if managed provider supports
  -> if corruption/data loss: restore backup/PITR
  -> run consistency checks
  -> bring app back
```

### 14.3 File storage issue

```text
file access errors spike
  -> check storage provider/bucket permissions
  -> verify signed URL config
  -> restore missing file from backup/versioning if needed
  -> verify file_links sample
```

### 14.4 Bad release

```text
error rate spike after deploy
  -> classify: frontend/backend/db/config
  -> rollback app if possible
  -> disable feature flag if available
  -> forward-fix if rollback unsafe
  -> communicate status
```

## 15. DR runbook roles

| Vai trò | Trách nhiệm |
| --- | --- |
| Incident Commander | Điều phối, quyết định go/no-go |
| DevOps | Hạ tầng, deploy, backup/restore |
| Backend Lead | API, DB migration, data correction |
| Frontend Lead | Frontend rollback, UI issue |
| QA | Smoke/regression sau recovery |
| Product/Business | Chấp nhận downtime/data loss nếu cần |
| Communication owner | Thông báo stakeholder/user |

## 16. Rollback decision matrix

| Dấu hiệu | Hành động đề xuất |
| --- | --- |
| Frontend trắng/JS lỗi nhiều | Rollback frontend trước |
| API 5xx tăng sau backend deploy | Rollback backend nếu DB compatible |
| Login lỗi toàn bộ | Rollback backend/config, kiểm tra AUTH secret/cookie |
| Check-in/leave/task lỗi một module | Feature flag/forward-fix/rollback module nếu monolith deploy |
| Migration làm mất dữ liệu | Stop write nếu cần, đánh giá restore |
| Worker gửi notification trùng | Stop worker, fix idempotency, data cleanup |

## 17. Backup verification checklist

- [ ] Backup file tồn tại.
- [ ] Backup dung lượng hợp lý.
- [ ] Backup có timestamp/version.
- [ ] Backup lưu ngoài app server nếu có thể.
- [ ] Backup được mã hóa hoặc storage private.
- [ ] Có log backup success/failure.
- [ ] Có alert nếu backup fail.
- [ ] Restore drill đã chạy trước go-live.

## 18. Pre-release backup checklist

- [ ] Release có migration hay data script?
- [ ] Nếu có, backup production bắt buộc.
- [ ] Backup hoàn tất trước khi migration.
- [ ] Verify backup.
- [ ] Ghi đường dẫn/ID backup trong release log.
- [ ] Người chịu trách nhiệm xác nhận backup đã ký/approve.

## 19. Post-restore verification

| Nhóm | Kiểm tra |
| --- | --- |
| Auth | Login, token/session |
| HR | Employee list/detail |
| ATT | Attendance record sample |
| LEAVE | Leave request/balance sample |
| TASK | Project/task sample |
| NOTI | Notification unread/list |
| DASH | Dashboard load |
| File | File private sample download theo quyền |
| Audit | Audit logs còn truy vết |

## 20. Rủi ro và kiểm soát

| Rủi ro | Tác động | Kiểm soát |
| --- | --- | --- |
| Backup không restore được | Mất dữ liệu kéo dài | Restore drill |
| Backup chứa PII bị lộ | Rủi ro bảo mật | Encrypt/access control |
| Rollback app không tương thích DB | Downtime | Backward-compatible migration |
| Restore làm mất dữ liệu mới | Data loss | Đánh giá RPO/PITR trước restore |
| File backup lệch DB | File link lỗi | Backup DB/file cùng mốc |
| Không có owner khi incident | Chậm phục hồi | DR role matrix |

## 21. Open questions

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| DO10-OQ-001 | RPO/RTO chính thức cho MVP là bao nhiêu? | Product/Tech Lead | Cao |
| DO10-OQ-002 | Production DB có PITR không? | DevOps | Cao |
| DO10-OQ-003 | File storage có bật versioning/lifecycle không? | DevOps | Trung bình |
| DO10-OQ-004 | Backup retention chính thức bao lâu? | Product/Security | Trung bình |
| DO10-OQ-005 | Ai có quyền restore production? | Tech Lead/DevOps | Cao |

## 99. Tiêu chí nghiệm thu DEVOPS-10

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

**DEVOPS-10** hoàn thiện một phần quan trọng trong chuỗi DevOps MVP. Tài liệu này cần được dùng làm căn cứ khi viết script, pipeline, Dockerfile, cấu hình môi trường, checklist release và runbook vận hành thực tế.
