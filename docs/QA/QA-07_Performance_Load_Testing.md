# QA-07: PERFORMANCE & LOAD TESTING
# KIỂM THỬ HIỆU NĂNG, TẢI, STRESS, SOAK VÀ KHẢ NĂNG MỞ RỘNG
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | QA-07 |
| Tên tài liệu | Performance & Load Testing |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | QA / Testing - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-06 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

QA-07 định nghĩa chiến lược, phạm vi, kịch bản, dữ liệu, công cụ, ngưỡng đánh giá và quy trình báo cáo cho kiểm thử hiệu năng của hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này dùng để:

1. Kiểm chứng hệ thống có đáp ứng được tải sử dụng MVP hay không.
2. Phát hiện API chậm, query database chậm, N+1 query, thiếu index, cache sai hoặc contention transaction.
3. Đánh giá khả năng chịu tải của các flow nghiệp vụ quan trọng như login, dashboard, chấm công, nghỉ phép, task và notification.
4. Kiểm tra hiệu năng frontend: thời gian tải trang, lazy load widget, cache query, bundle size và tương tác người dùng.
5. Chuẩn hóa các loại test: baseline, load, stress, spike, soak, scalability và regression performance.
6. Xác định SLA/SLO/SLO gate cho release MVP.
7. Làm căn cứ cho Backend, Frontend, DevOps và QA phối hợp tối ưu hiệu năng trước khi release.

---

## 3. Vị trí của QA-07 trong roadmap QA

```text
QA-01: QA Strategy & Test Plan
QA-02: Test Case Matrix theo module
QA-03: End-to-End Flow Testing
QA-04: API Testing & Contract Testing
QA-05: Permission, Role & Data Scope Testing
QA-06: Security Testing
QA-07: Performance & Load Testing
QA-08: Bug Tracking, Regression & Release Criteria
QA-09: UAT Plan & Business Acceptance
QA-10: MVP Release Readiness Checklist
```

QA-07 được thực hiện sau khi các API chính đã ổn định contract, các flow E2E P0 chạy được và môi trường staging có dữ liệu giả lập đủ lớn.

---

## 4. Căn cứ triển khai

QA-07 bám theo các quyết định đã chốt:

1. API public sử dụng prefix `/api/v1` và response/error/pagination thống nhất.
2. Backend luôn là nguồn kiểm soát authentication, permission, data scope, business rule, audit log và notification event.
3. Database dùng PostgreSQL, thiết kế sẵn multi-tenant qua `company_id`.
4. Mọi query nghiệp vụ cần filter theo `company_id` và tránh query vượt scope.
5. Các query lớn cần index, keyset pagination, cache hoặc background job nếu phù hợp.
6. Dashboard không xử lý nghiệp vụ gốc; dashboard đọc dữ liệu từ module nguồn và có thể dùng cache widget.
7. Notification unread count, dashboard widget, attendance today, leave approved lookup và task list là nhóm query cần ưu tiên tối ưu.
8. Frontend dùng API client chung, TanStack Query, query key factory, cache/invalidation và degraded state cho dashboard widget.
9. Frontend không được cache hoặc hiển thị dữ liệu nhạy cảm sai user sau logout hoặc đổi session.
10. File upload/download, audit log, notification delivery log và attendance log có nguy cơ tăng nhanh, cần đo hiệu năng và retention.

---

## 5. Phạm vi QA-07

### 5.1 Bao gồm

| Nhóm | Nội dung kiểm thử |
| --- | --- |
| API performance | Response time, throughput, error rate, timeout, retry, rate limit |
| Load testing | Mô phỏng nhiều user đồng thời theo workload thực tế |
| Stress testing | Tăng tải vượt ngưỡng để tìm điểm nghẽn và điểm gãy |
| Spike testing | Tải tăng đột ngột tại giờ cao điểm như check-in buổi sáng |
| Soak testing | Chạy tải vừa phải trong thời gian dài để phát hiện memory leak, connection leak, cache leak |
| Database performance | Index usage, EXPLAIN ANALYZE, slow query, lock, transaction contention |
| Dashboard performance | Lazy load widget, cache hit/miss, invalidation, degraded state |
| Notification performance | Unread count, dropdown, mark read, delivery log, dedupe event |
| Frontend performance | LCP, INP, CLS, bundle size, route transition, query cache |
| Background jobs | Attendance recalculation, dashboard cache warmup, notification event handling, cleanup job |
| Export performance | HR/ATT/LEAVE/TASK export theo dữ liệu lớn, không ảnh hưởng realtime API |
| Multi-tenant safety under load | Không rò dữ liệu giữa company/user khi hệ thống có tải cao |

### 5.2 Không bao gồm sâu trong QA-07

| Nội dung | Tài liệu hoặc giai đoạn xử lý |
| --- | --- |
| Security penetration test chuyên sâu | QA-06 Security Testing |
| Functional correctness chi tiết từng module | QA-02, QA-03, QA-04 |
| Permission matrix đầy đủ | QA-05 |
| UAT với người dùng cuối | QA-09 |
| Infrastructure capacity planning cloud chi tiết | DevOps / SRE Plan |
| Performance mobile native app | Phase Mobile |
| BI/data warehouse benchmark nâng cao | Phase Reporting / BI |

---

## 6. Nguyên tắc kiểm thử hiệu năng

### 6.1 Test theo journey, không chỉ test endpoint riêng lẻ

Một endpoint có thể nhanh khi test riêng, nhưng chậm khi đi trong journey thật vì frontend gọi nhiều API, cache miss, permission resolve, dashboard widget load đồng thời hoặc notification badge polling.

Do đó QA-07 cần test cả:

1. Single endpoint benchmark.
2. Business flow benchmark.
3. Mixed workload benchmark.
4. Frontend route/page benchmark.

### 6.2 Test bằng dữ liệu gần thực tế

Performance test không có giá trị nếu dữ liệu quá nhỏ. Dữ liệu staging cần mô phỏng:

1. Nhiều employee.
2. Nhiều attendance record theo tháng.
3. Nhiều leave request và leave request day.
4. Nhiều task/project/comment/checklist.
5. Nhiều notification theo user.
6. Nhiều audit log và login log.
7. Nhiều file metadata và file link.

### 6.3 Không dùng production data nhạy cảm

Dữ liệu performance phải là fake/anonymized data. Không copy dữ liệu nhân sự thật, hợp đồng, giấy tờ, bảng công thật hoặc file nhạy cảm sang môi trường test nếu chưa có quy trình masking và phê duyệt.

### 6.4 Performance gate phải chạy lặp lại được

Mỗi test cần có:

1. Test script versioned trong repository.
2. Seed data version rõ ràng.
3. Environment config rõ ràng.
4. Threshold rõ ràng.
5. Báo cáo kết quả lưu lại theo build/release.

### 6.5 Performance issue phải có bằng chứng

Mỗi bug hiệu năng cần đính kèm:

1. Endpoint/flow bị ảnh hưởng.
2. Tải test.
3. p50/p95/p99 response time.
4. Error rate.
5. Throughput.
6. DB slow query hoặc EXPLAIN ANALYZE nếu có.
7. Screenshot/trace/log/metric liên quan.
8. Build version và commit nếu có.

---

## 7. Môi trường kiểm thử

### 7.1 Môi trường bắt buộc

| Môi trường | Mục đích |
| --- | --- |
| Local | Dev tự chạy smoke performance nhỏ, kiểm tra script |
| Development | Test nhanh khi tối ưu endpoint/module |
| Staging | Môi trường chính để chạy load/stress/soak trước release |
| Production | Chỉ chạy synthetic monitoring nhẹ, không stress test trực tiếp nếu chưa được phê duyệt |

### 7.2 Yêu cầu staging

Staging cần càng giống production càng tốt:

1. Cùng cấu hình backend runtime chính.
2. Cùng database engine/version.
3. Cùng cache/queue nếu production dùng.
4. Cùng cơ chế auth/session.
5. Cùng CDN/object storage giả lập hoặc tương đương.
6. Có monitoring, logging và tracing bật sẵn.
7. Có khả năng reset seed data trước mỗi đợt test lớn.

### 7.3 Không chạy stress test trên production

Production chỉ được phép chạy:

1. Health check.
2. Synthetic test nhẹ.
3. Monitoring real user performance.
4. Canary traffic nếu có cơ chế rollback.

Stress/spike/soak test phải chạy trên staging hoặc môi trường performance riêng.

---

## 8. Dữ liệu test hiệu năng

### 8.1 Cấu hình dataset đề xuất

| Dataset | Mục tiêu | Quy mô gợi ý |
| --- | --- | --- |
| Small | Smoke performance local/dev | 1 company, 100 users, 100 employees |
| Medium | MVP staging baseline | 1 company, 1.000 employees, 12 tháng attendance, 20.000 tasks, 100.000 notifications |
| Large | Stress/scalability chuẩn bị SaaS | 3-5 companies, 10.000 employees tổng, 24 tháng attendance, 200.000 tasks, 1.000.000 notifications |

Quy mô trên là gợi ý ban đầu. Khi có số liệu thực tế của doanh nghiệp, cần cập nhật workload theo usage thật.

### 8.2 Dữ liệu theo module

| Module | Dữ liệu cần seed |
| --- | --- |
| AUTH | Users, roles, permissions, user_roles, sessions giả lập |
| HR | Employees, departments, positions, job levels, contracts |
| ATT | Shifts, rules, attendance_records, attendance_logs, adjustment requests, remote requests |
| LEAVE | Leave types, policies, balances, requests, request_days, approvals |
| TASK | Projects, members, tasks, assignees, comments, checklist, activity logs |
| NOTI | notification_events, notifications, delivery_logs, unread/read mix |
| DASH | widgets, widget_configs, widget_cache, cache invalidation records |
| FOUNDATION | companies, settings, audit_logs, files, file_links, public_holidays |

### 8.3 Nguyên tắc phân bố dữ liệu

Dữ liệu cần phân bố không đều để giống thực tế:

1. Một số phòng ban lớn hơn phòng ban khác.
2. Một số manager có nhiều nhân viên hơn.
3. Một số user có rất nhiều notification chưa đọc.
4. Một số project có 1.000+ task.
5. Attendance records tập trung ở tháng hiện tại và 12 tháng gần nhất.
6. Dashboard HR/Admin có workload lớn hơn Employee dashboard.
7. Task comment/activity log tập trung vào task active.

---

## 9. Công cụ đề xuất

### 9.1 Load/API testing

| Công cụ | Vai trò |
| --- | --- |
| k6 | Tool chính cho load/stress/spike/soak API |
| JMeter | Có thể dùng nếu team quen GUI hoặc cần test phức tạp |
| Postman/Newman | Smoke API performance nhỏ, không thay k6 cho load lớn |
| Artillery | Lựa chọn thay thế cho k6 nếu cần scenario JS/Node |

Khuyến nghị MVP: dùng `k6` làm chuẩn chính vì script version được, chạy CI dễ và threshold rõ.

### 9.2 Frontend performance

| Công cụ | Vai trò |
| --- | --- |
| Lighthouse CI | Đo LCP, CLS, TBT, performance score cho route chính |
| Playwright | Đo navigation timing, route transition, E2E under network throttling |
| Web Vitals | Theo dõi LCP, INP, CLS ở runtime |
| Bundle analyzer | Kiểm soát bundle size và chunk splitting |

### 9.3 Database performance

| Công cụ | Vai trò |
| --- | --- |
| EXPLAIN ANALYZE | Kiểm tra query plan, index usage, buffers |
| pg_stat_statements | Theo dõi slow query và query tốn tài nguyên |
| PostgreSQL logs | Slow query log, lock wait, deadlock |
| APM/Tracing | Liên kết API latency với query latency |

### 9.4 Monitoring/observability

| Nhóm | Metric cần theo dõi |
| --- | --- |
| API | request count, p95/p99 latency, error rate, throughput |
| DB | query time, slow query, lock wait, connection pool usage, CPU, IO |
| Cache | hit rate, miss rate, eviction, stale cache |
| Queue/job | queue length, processing time, retry count, failure count |
| Frontend | LCP, INP, CLS, JS errors, route transition time |
| Infra | CPU, RAM, disk IO, network, container restart, memory leak |

---

## 10. SLA/SLO đề xuất cho MVP

### 10.1 API latency target

| Nhóm API | Target p95 | Target p99 | Ghi chú |
| --- | ---: | ---: | --- |
| Health check | <= 100ms | <= 200ms | Không phụ thuộc DB nặng |
| Auth `/auth/me` | <= 300ms | <= 700ms | Có permission/session resolve |
| Login | <= 800ms | <= 1.500ms | Có hash password, session write |
| List thường | <= 800ms | <= 1.500ms | HR/Leave/Task list có filter/pagination |
| Detail thường | <= 500ms | <= 1.000ms | Không join quá sâu |
| Write action P0 | <= 1.000ms | <= 2.000ms | Check-in, create leave, update task |
| Dashboard `/dashboard/me` | <= 1.200ms | <= 2.500ms | Có thể trả shell/config trước, widget lazy load |
| Dashboard widget cached | <= 400ms | <= 800ms | Cache hit |
| Dashboard widget uncached | <= 1.500ms | <= 3.000ms | Không áp dụng cho báo cáo nặng |
| Notification unread count | <= 150ms | <= 300ms | Cần partial index/cache nếu lớn |
| Notification dropdown | <= 500ms | <= 1.000ms | Dùng keyset/cursor nếu list lớn |
| Export trigger | <= 1.000ms | <= 2.000ms | Chỉ enqueue job, không export sync dữ liệu lớn |

### 10.2 API reliability target

| Metric | Target MVP |
| --- | ---: |
| Error rate do hệ thống | < 1% trong load test chuẩn |
| 5xx rate | < 0.5% trong load test chuẩn |
| Timeout rate | < 0.5% trong load test chuẩn |
| Failed login do test data sai | Tách khỏi system error |
| Data leakage / wrong scope | 0 case |
| Duplicate write do retry | 0 case với action có idempotency |

### 10.3 Database query target

| Nhóm query | Target |
| --- | ---: |
| Query realtime nhỏ | <= 100ms - 300ms |
| Query list có filter/pagination | <= 500ms |
| Dashboard aggregate cached | <= 100ms - 300ms |
| Dashboard aggregate uncached | <= 500ms - 1.500ms tùy widget |
| Export/report lớn | Chạy background, không block API realtime |
| Sequential scan trên bảng lớn | Không chấp nhận nếu có index phù hợp |
| N+1 query trên list P0 | Không chấp nhận |

### 10.4 Frontend performance target

| Metric | Target MVP |
| --- | ---: |
| LCP route protected chính | <= 2.5s trên desktop staging |
| INP | <= 200ms cho thao tác P0 |
| CLS | <= 0.1 |
| First route shell render | <= 1.5s |
| App Switcher open | <= 200ms sau khi data cached |
| Dashboard skeleton hiện | <= 500ms |
| Widget lazy load hoàn tất | Theo SLA API widget |
| Route transition cached | <= 500ms |
| JS error blocking P0 flow | 0 |

---

## 11. Workload profile

### 11.1 Profile theo thời điểm sử dụng

| Thời điểm | Hành vi tải chính |
| --- | --- |
| Đầu giờ sáng | Login, `/auth/me`, Home Portal, Dashboard, check-in, notification badge |
| Trong ngày | Task list/detail/comment/status, leave request, dashboard refresh, notification dropdown |
| Cuối ngày | Check-out, bảng công hôm nay, task status update |
| Cuối tháng | Attendance report, HR export, leave balance, dashboard HR/Admin |
| Khi có chiến dịch HR | Employee list/search, contract expiry dashboard, notification bulk |

### 11.2 User mix đề xuất cho load test chuẩn

| Nhóm user | Tỷ lệ | Hành vi chính |
| --- | ---: | --- |
| Employee | 70% | Login, dashboard, check-in/out, my tasks, leave, notifications |
| Manager | 15% | Dashboard Manager, approve leave, team attendance, team tasks |
| HR | 10% | Employee list, attendance company, leave admin, reports |
| Admin/System | 5% | User/role/config/audit/dashboard admin |

### 11.3 Request mix đề xuất

| Nhóm request | Tỷ lệ gần đúng |
| --- | ---: |
| Read API | 75% |
| Write API | 15% |
| Notification polling/dropdown | 5% |
| Export/job trigger/admin | 5% |

---

## 12. Loại kiểm thử hiệu năng

### 12.1 Baseline test

Mục tiêu: đo hiệu năng cơ sở khi tải thấp.

| Thuộc tính | Giá trị đề xuất |
| --- | --- |
| Virtual users | 5 - 20 |
| Thời lượng | 5 - 10 phút |
| Dữ liệu | Small hoặc Medium |
| Kết quả mong muốn | Xác định latency nền, không lỗi 5xx, không slow query bất thường |

### 12.2 Load test

Mục tiêu: kiểm tra hệ thống với tải sử dụng kỳ vọng MVP.

| Thuộc tính | Giá trị đề xuất |
| --- | --- |
| Virtual users | 100 - 300 |
| Thời lượng | 30 - 60 phút |
| Ramp-up | 5 - 10 phút |
| Dữ liệu | Medium |
| Kết quả mong muốn | Đạt SLA p95/p99, error rate dưới ngưỡng, không rò dữ liệu/sai scope |

### 12.3 Stress test

Mục tiêu: tìm điểm hệ thống bắt đầu suy giảm hoặc gãy.

| Thuộc tính | Giá trị đề xuất |
| --- | --- |
| Virtual users | Tăng dần 100 -> 300 -> 500 -> 1.000+ |
| Thời lượng | 30 - 90 phút |
| Dữ liệu | Medium hoặc Large |
| Kết quả mong muốn | Biết bottleneck, biết giới hạn hiện tại, hệ thống fail có kiểm soát |

### 12.4 Spike test

Mục tiêu: mô phỏng tải tăng đột ngột, đặc biệt check-in đầu giờ.

| Thuộc tính | Giá trị đề xuất |
| --- | --- |
| Pattern | 20 VU -> 500 VU trong 1-2 phút -> giảm về 50 VU |
| Flow chính | Login, `/auth/me`, dashboard, attendance today, check-in |
| Kết quả mong muốn | Không timeout hàng loạt, không duplicate check-in, queue/log không nghẽn |

### 12.5 Soak test

Mục tiêu: phát hiện memory leak, connection leak, queue backlog, cache phình to.

| Thuộc tính | Giá trị đề xuất |
| --- | --- |
| Virtual users | 50 - 150 |
| Thời lượng | 4 - 8 giờ cho MVP; 12 - 24 giờ trước production lớn |
| Dữ liệu | Medium |
| Kết quả mong muốn | Latency không tăng dần bất thường, memory ổn định, DB connection ổn định |

### 12.6 Scalability test

Mục tiêu: đo khi tăng tài nguyên hoặc tăng dữ liệu.

| Kiểu scale | Câu hỏi cần trả lời |
| --- | --- |
| Scale users | Khi tăng CCU, p95 tăng như thế nào? |
| Scale data | Khi notifications 100k -> 1M, unread count còn đạt SLA không? |
| Scale module | Dashboard nhiều widget có ảnh hưởng shell không? |
| Scale tenant | Nhiều company có giữ đúng `company_id` filter và index không? |

---

## 13. Flow performance P0/P1

### 13.1 P0 - Bắt buộc test trước release

| Mã | Flow | Module | Mục tiêu |
| --- | --- | --- | --- |
| QA07-PERF-P0-001 | Login -> Home Portal -> `/auth/me` | AUTH/FOUNDATION | Session boot nhanh, không nghẽn permission resolve |
| QA07-PERF-P0-002 | Employee Dashboard load | DASH/ATT/LEAVE/TASK/NOTI | Dashboard shell + widget load đạt SLA |
| QA07-PERF-P0-003 | Check-in đầu giờ | ATT | Không duplicate, latency ổn, transaction an toàn |
| QA07-PERF-P0-004 | Check-out cuối ngày | ATT | Không duplicate, cập nhật attendance record đúng |
| QA07-PERF-P0-005 | My Tasks list + detail | TASK | Task list phân trang/lọc/sort nhanh |
| QA07-PERF-P0-006 | Create/submit leave request | LEAVE | Tính phép, kiểm tra conflict và ghi transaction ổn |
| QA07-PERF-P0-007 | Manager approve leave | LEAVE/ATT/NOTI | Duyệt, sync ATT, phát notification không nghẽn |
| QA07-PERF-P0-008 | Notification unread count/dropdown | NOTI | Badge/dropdown nhanh khi notification lớn |
| QA07-PERF-P0-009 | HR employee list/search | HR | Search/filter/pagination đạt SLA |
| QA07-PERF-P0-010 | Dashboard HR/Admin overview | DASH/HR/ATT/LEAVE/TASK | Không timeout khi dữ liệu tổng hợp lớn |

### 13.2 P1 - Nên test trước release

| Mã | Flow | Module | Mục tiêu |
| --- | --- | --- | --- |
| QA07-PERF-P1-001 | Attendance monthly records | ATT | Query bảng công tháng theo employee/team/company nhanh |
| QA07-PERF-P1-002 | Attendance adjustment submit/approve | ATT/NOTI | Flow điều chỉnh công ổn định dưới tải vừa |
| QA07-PERF-P1-003 | Leave calendar team/company | LEAVE | Lịch nghỉ không query quá nặng |
| QA07-PERF-P1-004 | Kanban board 1.000 tasks | TASK | Board load và đổi trạng thái ổn định |
| QA07-PERF-P1-005 | Task comment/mention | TASK/NOTI | Comment tạo event notification không spam/lỗi |
| QA07-PERF-P1-006 | App Switcher/Home Portal | FOUNDATION/AUTH | App registry/menu permission load nhanh |
| QA07-PERF-P1-007 | File upload metadata/link | FOUNDATION/HR/TASK/LEAVE | Upload không block API khác |
| QA07-PERF-P1-008 | Audit log filter | FOUNDATION | Query audit theo module/time không scan quá lớn |

### 13.3 P2 - Test theo nhu cầu

| Mã | Flow | Module | Ghi chú |
| --- | --- | --- | --- |
| QA07-PERF-P2-001 | Export HR employee list lớn | HR | Có thể chạy background |
| QA07-PERF-P2-002 | Export attendance monthly company | ATT | Ưu tiên job async |
| QA07-PERF-P2-003 | Notification delivery retry | NOTI | Phase email/push cần test sâu hơn |
| QA07-PERF-P2-004 | Dashboard cache warmup | DASH | Khi triển khai cache precompute |
| QA07-PERF-P2-005 | Data retention cleanup | FOUNDATION | Khi log/file/cache lớn |

---

## 14. Test case matrix hiệu năng

### 14.1 AUTH / Session

| Test ID | Kịch bản | Loại test | Điều kiện đạt |
| --- | --- | --- | --- |
| QA07-AUTH-001 | 200 users login trong 5 phút | Load | p95 <= 800ms, 5xx < 0.5% |
| QA07-AUTH-002 | 500 users gọi `/auth/me` sau login | Load | p95 <= 300ms, không lỗi scope |
| QA07-AUTH-003 | Refresh token đồng thời khi access token hết hạn | Spike | Không refresh storm, không logout nhầm hàng loạt |
| QA07-AUTH-004 | Permission resolve cho user nhiều role | Baseline | Không N+1 query, p95 <= 500ms |
| QA07-AUTH-005 | Logout clear cache/query state | Frontend perf/security | Không thấy data user cũ sau logout/login user khác |

### 14.2 DASH

| Test ID | Kịch bản | Loại test | Điều kiện đạt |
| --- | --- | --- | --- |
| QA07-DASH-001 | Load `/dashboard/me` cho Employee | Load | p95 <= 1.2s |
| QA07-DASH-002 | 10 widget lazy load đồng thời | Load | Widget lỗi không làm sập dashboard |
| QA07-DASH-003 | Cache hit dashboard widget | Baseline | p95 <= 400ms |
| QA07-DASH-004 | Cache miss dashboard widget | Load | p95 <= 1.5s hoặc có degraded state |
| QA07-DASH-005 | Invalidate cache khi task đổi trạng thái | Regression perf | Cache stale được refresh đúng, không query storm |
| QA07-DASH-006 | HR dashboard với 10.000 employees | Stress | Không timeout toàn trang, widget nặng có fallback |

### 14.3 ATT

| Test ID | Kịch bản | Loại test | Điều kiện đạt |
| --- | --- | --- | --- |
| QA07-ATT-001 | 500 users check-in trong 2 phút | Spike | Không duplicate, p95 <= 1s, 5xx < 1% |
| QA07-ATT-002 | Check-in idempotency retry | Load/regression | Một user chỉ có một attendance record hợp lệ |
| QA07-ATT-003 | Attendance today lookup | Load | p95 <= 300ms |
| QA07-ATT-004 | Bảng công cá nhân 12 tháng | Baseline | p95 <= 800ms |
| QA07-ATT-005 | Bảng công team 1 tháng | Load | p95 <= 1s |
| QA07-ATT-006 | Bảng công company có filter tháng/phòng ban | Stress | Không ảnh hưởng check-in realtime |
| QA07-ATT-007 | Remote work rule lookup | Load | p95 <= 500ms |
| QA07-ATT-008 | Attendance recalculation job | Soak/job | Job không lock bảng quá lâu |

### 14.4 LEAVE

| Test ID | Kịch bản | Loại test | Điều kiện đạt |
| --- | --- | --- | --- |
| QA07-LEAVE-001 | My leave balance | Load | p95 <= 400ms |
| QA07-LEAVE-002 | Create draft leave request | Load | p95 <= 800ms |
| QA07-LEAVE-003 | Submit leave request có tính ngày nghỉ | Load | p95 <= 1s |
| QA07-LEAVE-004 | Manager xem pending approvals | Load | p95 <= 800ms |
| QA07-LEAVE-005 | Approve leave + sync ATT + NOTI | Load | p95 <= 1.5s hoặc event async rõ ràng |
| QA07-LEAVE-006 | Leave calendar team/company | Stress | Có pagination/range limit/cache nếu dữ liệu lớn |
| QA07-LEAVE-007 | Approved leave lookup trong ATT check-in | Spike | Không làm chậm check-in vượt SLA |

### 14.5 TASK

| Test ID | Kịch bản | Loại test | Điều kiện đạt |
| --- | --- | --- | --- |
| QA07-TASK-001 | My tasks sort due date | Load | p95 <= 800ms |
| QA07-TASK-002 | Project Kanban 1.000 tasks | Load | p95 <= 1.5s, không render treo frontend |
| QA07-TASK-003 | Update task status đồng thời | Load | Không lost update, p95 <= 1s |
| QA07-TASK-004 | Create task + assign + notification | Load | Event tạo đúng, không spam duplicate |
| QA07-TASK-005 | Comment + mention nhiều user | Stress | Không timeout, NOTI queue không backlog lớn |
| QA07-TASK-006 | Task detail có comment/checklist/file | Baseline | Không N+1 query |

### 14.6 NOTI

| Test ID | Kịch bản | Loại test | Điều kiện đạt |
| --- | --- | --- | --- |
| QA07-NOTI-001 | Unread count với 1M notifications | Stress/data scale | p95 <= 150ms hoặc có cache count |
| QA07-NOTI-002 | Dropdown latest notifications | Load | p95 <= 500ms |
| QA07-NOTI-003 | Mark one read | Load | p95 <= 500ms, chỉ update notification của user đó |
| QA07-NOTI-004 | Mark all read user có 10k unread | Stress | Không lock rộng, có batch/job nếu cần |
| QA07-NOTI-005 | Notification event dedupe | Load | Không tạo trùng khi retry event |
| QA07-NOTI-006 | Delivery log tăng nhanh | Soak | Không làm chậm unread/dropdown |

### 14.7 HR

| Test ID | Kịch bản | Loại test | Điều kiện đạt |
| --- | --- | --- | --- |
| QA07-HR-001 | Employee list 10.000 records pagination | Load | p95 <= 800ms |
| QA07-HR-002 | Search employee tiếng Việt không dấu | Load | p95 <= 1s nếu bật trigram/unaccent |
| QA07-HR-003 | Filter department/status/position | Load | Query dùng index đúng |
| QA07-HR-004 | Employee detail | Baseline | p95 <= 500ms, không trả field nhạy cảm sai quyền |
| QA07-HR-005 | Profile change request list pending | Load | p95 <= 800ms |
| QA07-HR-006 | Export employee list lớn | Stress/job | Trigger nhanh, export async nếu lớn |

### 14.8 FOUNDATION / File / Audit / Settings

| Test ID | Kịch bản | Loại test | Điều kiện đạt |
| --- | --- | --- | --- |
| QA07-FND-001 | App registry/Home Portal load | Load | p95 <= 500ms khi cached |
| QA07-FND-002 | Company settings lookup | Baseline | Không query lặp quá nhiều lần/request |
| QA07-FND-003 | Audit log write dưới tải cao | Load | Không block action P0 quá SLA |
| QA07-FND-004 | Audit log filter module/time | Load | Query dùng index/partition |
| QA07-FND-005 | File metadata list by entity | Load | p95 <= 800ms |
| QA07-FND-006 | File access log write | Soak | Không làm chậm download đáng kể |

---

## 15. Kịch bản k6 mẫu

### 15.1 Cấu trúc thư mục đề xuất

```text
tests/performance/
  k6/
    config/
      env.local.json
      env.staging.json
    data/
      users.employee.json
      users.manager.json
      users.hr.json
    lib/
      auth.js
      http.js
      random.js
      thresholds.js
    scenarios/
      auth-login.js
      dashboard-employee.js
      attendance-checkin-spike.js
      leave-approval.js
      task-kanban.js
      notification-unread.js
      mixed-workload.js
    reports/
      .gitkeep
```

### 15.2 Threshold mẫu

```js
export const defaultThresholds = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<1000', 'p(99)<2500'],
};

export const strictReadThresholds = {
  http_req_failed: ['rate<0.005'],
  http_req_duration: ['p(95)<500', 'p(99)<1000'],
};

export const notificationUnreadThresholds = {
  http_req_failed: ['rate<0.005'],
  http_req_duration: ['p(95)<150', 'p(99)<300'],
};
```

### 15.3 Script check-in spike mẫu

```js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const users = new SharedArray('employee users', function () {
  return JSON.parse(open('../data/users.employee.json'));
});

export const options = {
  scenarios: {
    checkin_spike: {
      executor: 'ramping-vus',
      stages: [
        { duration: '1m', target: 50 },
        { duration: '2m', target: 500 },
        { duration: '5m', target: 500 },
        { duration: '2m', target: 50 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'https://staging-api.example.com/api/v1';

function login(user) {
  const res = http.post(`${BASE_URL}/auth/login`, JSON.stringify({
    email: user.email,
    password: user.password,
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Client-Type': 'web',
      'X-Client-Version': 'perf-test',
    },
  });

  check(res, {
    'login success': (r) => r.status === 200,
  });

  const body = res.json();
  return body?.data?.access_token;
}

export default function () {
  const user = users[__VU % users.length];
  const token = login(user);

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Client-Type': 'web',
    'X-Client-Version': 'perf-test',
    'Idempotency-Key': `${user.email}-${Date.now()}-${__ITER}`,
  };

  const todayRes = http.get(`${BASE_URL}/attendance/today`, { headers });
  check(todayRes, {
    'today status ok': (r) => r.status === 200,
  });

  const checkinRes = http.post(`${BASE_URL}/attendance/check-in`, JSON.stringify({
    client_time: new Date().toISOString(),
    source: 'web',
  }), { headers });

  check(checkinRes, {
    'checkin ok or already checked in': (r) => [200, 201, 409, 422].includes(r.status),
  });

  sleep(1);
}
```

### 15.4 Lưu ý về script

1. Không hard-code tài khoản thật trong repository.
2. Tài khoản test phải được seed riêng.
3. Token/log không được in ra console trong CI public.
4. Idempotency key cần ổn định theo action cần test.
5. Kịch bản write action cần cleanup/reset data hoặc dùng ngày test riêng.
6. Với check-in/check-out, cần tránh chạy lặp làm sai dữ liệu bảng công nếu không reset dataset.

---

## 16. Database performance checklist

### 16.1 Query bắt buộc kiểm tra EXPLAIN ANALYZE

| Query/API | Lý do |
| --- | --- |
| Employee list/search/filter | Bảng HR lớn, search tiếng Việt |
| Attendance today | Gọi thường xuyên trong dashboard/check-in |
| Attendance monthly/team/company | Bảng công tăng theo thời gian |
| Leave pending approval | Manager/HR dùng thường xuyên |
| Leave approved day lookup | ATT cần check khi chấm công |
| My tasks / Kanban | TASK có nhiều filter/sort/status |
| Notification unread count | Gọi thường xuyên trên topbar |
| Notification dropdown | Query latest notifications lớn |
| Dashboard widgets | Aggregate nhiều module |
| Audit log filter | Bảng log tăng nhanh |

### 16.2 Checklist EXPLAIN ANALYZE

- [ ] Query có filter `company_id`.
- [ ] Query có filter `deleted_at IS NULL` nếu bảng soft delete.
- [ ] Query dùng đúng index composite.
- [ ] Không sequential scan trên bảng lớn khi không hợp lý.
- [ ] Không sort lớn không dùng index.
- [ ] Không nested loop bất thường với số row lớn.
- [ ] Không join thiếu điều kiện tenant/company.
- [ ] Không N+1 query khi trả list.
- [ ] Không offset quá lớn trên bảng rất lớn; dùng keyset/cursor nếu cần.
- [ ] Không trả quá nhiều cột không cần thiết.
- [ ] Không filter JSONB thiếu index.
- [ ] Dashboard query nặng có cache/TTL/invalidation.
- [ ] Notification unread count có partial index hoặc cache.

### 16.3 Slow query threshold

| Mức | Ngưỡng | Hành động |
| --- | ---: | --- |
| Warning | > 500ms | Review query plan nếu là API P0/P1 |
| Critical | > 1s | Bắt buộc phân tích trước release nếu query realtime |
| Blocker | > 3s | Không release nếu ảnh hưởng flow P0 |
| Export/report | > 3s | Chuyển background job hoặc optimize riêng |

---

## 17. Frontend performance checklist

### 17.1 Route cần đo

| Route/Màn | Metric chính |
| --- | --- |
| Login | Form interactive, login response, redirect time |
| Home Portal | App registry load, app card render, App Switcher open |
| Dashboard Employee | Shell render, widget skeleton, widget complete |
| Dashboard Manager/HR/Admin | Widget lazy load, degraded state, cache refresh |
| HR Employee List | Table render, filter/search debounce, pagination |
| ATT Today | Attendance status card, check-in/out button response |
| ATT Records | Table render với filter tháng |
| LEAVE Create Request | Form load, date picker, calculation preview |
| LEAVE Approval | Detail render, approve/reject action response |
| TASK Kanban | Board render, drag/drop, update status latency |
| TASK Detail | Comment/checklist render, optimistic update |
| NOTI Dropdown/List | Badge, dropdown open, mark read update |

### 17.2 Frontend checklist

- [ ] Bundle được split theo module/route.
- [ ] Dashboard widget lazy load, không block toàn trang.
- [ ] Error của một widget không làm crash dashboard.
- [ ] Query key có user/tenant boundary, không leak cache.
- [ ] Logout clear sensitive query cache.
- [ ] Search input debounce hợp lý.
- [ ] Table có pagination/virtualization nếu list lớn.
- [ ] Image/avatar/file preview có lazy load.
- [ ] Không render lại toàn bộ Kanban khi đổi một task nếu có thể tối ưu.
- [ ] Không gọi API trùng lặp do effect dependency sai.
- [ ] Không polling quá dày cho notification unread.
- [ ] App Switcher mở nhanh khi app registry đã cached.
- [ ] Loading/empty/error/forbidden/degraded state rõ ràng.

### 17.3 Bundle budget đề xuất

| Nhóm | Budget MVP đề xuất |
| --- | ---: |
| Initial JS critical shell | <= 250KB gzip |
| Module route chunk | <= 300KB gzip/module chính |
| Dashboard charts/vendor lazy chunk | Lazy load, không vào shell nếu chưa cần |
| Image/icon assets | Optimize, dùng sprite/icon library có tree-shaking |
| CSS critical | Không vượt quá nhu cầu design system MVP |

Budget thực tế cần cập nhật theo stack frontend cuối cùng.

---

## 18. Background job và async performance

### 18.1 Job cần kiểm thử

| Job | Kịch bản cần test |
| --- | --- |
| Attendance recalculation | Recalculate khi leave approved/cancelled/revoked |
| Missing checkout detection | Quét employee quên check-out và tạo notification |
| Task due/overdue scan | Tạo notification task sắp đến hạn/quá hạn |
| Dashboard cache invalidation | Invalidate khi ATT/LEAVE/TASK/NOTI thay đổi |
| Dashboard cache warmup | Precompute widget phổ biến nếu bật |
| Notification delivery retry | Retry kênh ngoài nếu có email/push phase sau |
| Audit/log cleanup | Theo retention policy |
| File temporary cleanup | Xóa file tạm không còn link |

### 18.2 Nguyên tắc job performance

1. Job phải có batch size.
2. Job phải idempotent nếu có thể.
3. Job phải có retry limit.
4. Job không được lock bảng lớn quá lâu.
5. Job phải ghi log thành công/thất bại.
6. Job nặng không chạy cùng giờ cao điểm nếu không cần.
7. Job lỗi không được làm sập API realtime.
8. Job phải có dashboard/metric theo dõi queue length và processing time.

---

## 19. Export/report performance

### 19.1 Nguyên tắc export

1. Export dữ liệu nhỏ có thể trả sync nếu dưới ngưỡng cấu hình.
2. Export dữ liệu lớn nên chạy background job.
3. API export lớn chỉ nên tạo job và trả `job_id`.
4. Người dùng nhận notification khi file export sẵn sàng.
5. File export lưu qua file service dùng chung và kiểm tra quyền khi tải.
6. Export phải ghi audit log.
7. Export phải tôn trọng permission và data scope.

### 19.2 Test case export

| Test ID | Kịch bản | Điều kiện đạt |
| --- | --- | --- |
| QA07-EXPORT-001 | HR export 1.000 employees | Hoàn thành trong ngưỡng hoặc enqueue job |
| QA07-EXPORT-002 | ATT export company 12 tháng | Không làm chậm check-in/check-out realtime |
| QA07-EXPORT-003 | LEAVE export request history | Tôn trọng data scope, không trả dữ liệu sai |
| QA07-EXPORT-004 | TASK export project report | Không query N+1 task/comment/assignee |
| QA07-EXPORT-005 | Download export file | Kiểm tra permission, ghi file_access_log |

---

## 20. Monitoring khi chạy test

### 20.1 Metric cần thu thập

| Lớp | Metric |
| --- | --- |
| Load tool | VU, RPS, p50, p90, p95, p99, error rate, iteration duration |
| API | Endpoint latency, status code, request count, timeout, rate limit |
| Backend | CPU, memory, event loop/thread pool, GC, container restart |
| DB | CPU, connection pool, slow query, lock wait, deadlock, IO, buffer hit ratio |
| Cache | Hit/miss, memory, eviction, stale key |
| Queue | Backlog, processing time, retry, dead-letter |
| Frontend | LCP, INP, CLS, JS error, route transition |
| Business | Duplicate check-in, duplicate notification, wrong scope, stale dashboard |

### 20.2 Log/trace correlation

Mỗi request load test nên gửi:

```http
X-Request-Id: req_perf_<uuid>
X-Client-Type: perf-test
X-Client-Version: qa-07
```

Backend log cần cho phép truy vết theo:

1. `request_id`.
2. `correlation_id`.
3. `company_id`.
4. `user_id`.
5. `module_code`.
6. Endpoint/action.

---

## 21. Báo cáo kết quả performance test

### 21.1 Template báo cáo

```text
Performance Test Report

1. Thông tin chung
- Build/version:
- Môi trường:
- Ngày chạy:
- Người chạy:
- Dataset:
- Script version:

2. Mục tiêu test
- Loại test:
- Flow/API:
- Tải mục tiêu:
- SLA/threshold:

3. Kết quả tổng quan
- Tổng request:
- RPS trung bình/peak:
- p50/p95/p99:
- Error rate:
- Timeout rate:
- 5xx rate:

4. Kết quả theo endpoint/flow
- Endpoint:
- p95/p99:
- Error:
- Nhận xét:

5. Database/infra observations
- Slow query:
- CPU/RAM/DB connection:
- Lock/wait:
- Queue backlog:

6. Vấn đề phát hiện
- Bug ID:
- Severity:
- Bằng chứng:
- Owner:
- ETA fix:

7. Kết luận
- Pass/Fail:
- Release impact:
- Khuyến nghị:
```

### 21.2 Lưu trữ báo cáo

Báo cáo cần lưu theo cấu trúc:

```text
qa-reports/performance/
  2026-06-20/
    build-xxx/
      summary.md
      k6-result.json
      k6-result.html
      slow-query.log
      explain-analyze/
      screenshots/
```

---

## 22. Phân loại lỗi hiệu năng

| Severity | Điều kiện |
| --- | --- |
| Blocker | Flow P0 không đạt SLA nghiêm trọng, 5xx cao, sai dữ liệu/sai scope, duplicate write nghiêm trọng |
| Critical | p95/p99 vượt ngưỡng lớn ở P0/P1, slow query gây timeout, memory/connection leak rõ |
| Major | API P1 chậm, frontend route chậm, dashboard widget hay degraded nhưng có workaround |
| Minor | Một số API P2/report chậm, chưa ảnh hưởng MVP chính |
| Improvement | Tối ưu thêm cache/index/bundle nhưng chưa gây lỗi release |

> **Ánh xạ về thang severity chuẩn S0–S4 ([QA-08 §9](QA-08_Bug_Tracking_Regression_Release_Criteria.md)):** Blocker → **S0**; Critical → **S1**; Major → **S2**; Minor → **S3**; Improvement → **S4**. Khi ghi nhận bug hiệu năng vào bug tracker, dùng S0–S4 theo QA-08.

### 22.1 Ví dụ Blocker

1. 500 user check-in tạo duplicate attendance record.
2. Notification unread count timeout khi user có nhiều notification.
3. Dashboard HR timeout toàn trang do một widget lỗi.
4. API list thiếu `company_id` filter và trả nhầm dữ liệu tenant khác.
5. Logout/login user khác vẫn thấy cache dữ liệu user cũ.

---

## 23. Performance release gate

Một build MVP chỉ được pass QA-07 khi:

1. Tất cả flow P0 performance đạt target hoặc có exception được phê duyệt.
2. Không có Blocker/Critical performance bug mở.
3. Error rate load test chuẩn dưới ngưỡng.
4. Không phát hiện data leakage hoặc wrong scope dưới tải.
5. Không có duplicate write ở action có idempotency.
6. Các query P0 đã được kiểm tra EXPLAIN ANALYZE.
7. Notification unread count/dropdown đạt SLA với dataset lớn tương ứng.
8. Dashboard widget có cache/lazy/degraded state đúng.
9. Frontend route P0 đạt Web Vitals target hoặc có kế hoạch tối ưu rõ.
10. Báo cáo performance test được lưu và review bởi QA + Backend + Frontend + DevOps.

---

## 24. Checklist chạy QA-07

### 24.1 Trước khi chạy

- [ ] Staging deploy đúng build cần test.
- [ ] Database đã seed dataset đúng quy mô.
- [ ] Test users đã có đủ role và permission.
- [ ] Monitoring/logging/tracing đã bật.
- [ ] k6 scripts đã cập nhật base URL và env.
- [ ] Không dùng tài khoản hoặc dữ liệu production nhạy cảm.
- [ ] Team Backend/DevOps biết thời điểm chạy load/stress.
- [ ] Có kế hoạch rollback/reset data nếu test write action.
- [ ] Threshold được thống nhất trước khi chạy.

### 24.2 Trong khi chạy

- [ ] Theo dõi RPS, p95, p99, error rate.
- [ ] Theo dõi CPU/RAM backend.
- [ ] Theo dõi DB connection pool và slow query.
- [ ] Theo dõi queue/job backlog nếu có.
- [ ] Ghi nhận thời điểm latency tăng bất thường.
- [ ] Không can thiệp môi trường trừ khi test gây nguy cơ nghiêm trọng.

### 24.3 Sau khi chạy

- [ ] Export kết quả k6/Lighthouse/APM.
- [ ] Tổng hợp endpoint/flow vượt ngưỡng.
- [ ] Thu thập slow query và EXPLAIN ANALYZE.
- [ ] Tạo bug với bằng chứng đầy đủ.
- [ ] So sánh với lần chạy trước.
- [ ] Cập nhật trend performance theo build.
- [ ] Review với Backend/Frontend/DevOps.
- [ ] Chốt Pass/Fail cho release gate.

---

## 25. Rủi ro và hướng xử lý

| Rủi ro | Mức độ | Hướng xử lý |
| --- | --- | --- |
| Dataset quá nhỏ làm kết quả ảo | Cao | Seed Medium/Large dataset trước khi sign-off |
| Load test làm bẩn dữ liệu nghiệp vụ | Trung bình | Dùng test date/test tenant/reset script |
| Check-in/check-out bị duplicate dưới tải | Cao | Idempotency key, unique constraint, transaction lock |
| Dashboard query quá nặng | Cao | Lazy load widget, cache TTL, invalidate theo event |
| Notification unread count chậm | Cao | Partial index/cache count/keyset pagination |
| Export lớn làm nghẽn API realtime | Cao | Chạy background job, giới hạn sync export |
| Permission resolve N+1 | Cao | Cache permission theo session/context, batch query |
| Frontend cache leak user khác | Cao | Query key có tenant/user boundary, clear cache khi logout |
| Stress test gây quá tải staging chung | Trung bình | Có lịch chạy riêng, cô lập môi trường performance |
| Không có baseline để so sánh | Trung bình | Lưu report mỗi build và theo dõi trend |

---

## 26. Definition of Done cho QA-07

QA-07 được xem là hoàn thành khi:

1. Có tài liệu chiến lược performance/load testing hoàn chỉnh.
2. Có danh sách flow P0/P1/P2 cần test.
3. Có SLA/SLO target cho API, DB, frontend và job.
4. Có dataset strategy Small/Medium/Large.
5. Có toolchain đề xuất cho k6, Lighthouse, Playwright, EXPLAIN ANALYZE và monitoring.
6. Có test case matrix theo module AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH, FOUNDATION.
7. Có k6 script skeleton cho ít nhất một flow P0.
8. Có checklist database/frontend/job/export performance.
9. Có bug severity và release gate rõ ràng.
10. Có report template để lưu kết quả test.
11. Có checklist trước/trong/sau khi chạy test.
12. Có rủi ro và hướng giảm thiểu.
13. Có bước tiếp theo rõ cho QA-08 hoặc performance automation trong CI/CD.

---

## 27. Việc cần làm tiếp theo

Sau QA-07, nên triển khai:

```text
QA-08: Bug Tracking, Regression & Release Criteria
```

QA-08 chuẩn hóa quản lý bug, thang severity (S0–S4), regression suite và tiêu chí release/no-go/rollback.

Sau đó là **QA-09: UAT Plan & Business Acceptance**, tập trung vào:

1. Kịch bản UAT theo vai trò Employee, Manager, HR, Admin.
2. Tiêu chí nghiệm thu nghiệp vụ MVP.
3. Checklist dữ liệu mẫu cho UAT.
4. Quy trình ghi nhận feedback và phân loại bug/change request.
5. Sign-off theo module trước release.

Song song, team kỹ thuật nên bắt đầu tạo repository script:

```text
tests/performance/k6
```

và chạy baseline định kỳ cho các flow P0 sau mỗi lần thay đổi lớn ở backend, database index hoặc frontend query layer.

---

## 28. Kết luận

QA-07 hoàn thiện lớp kiểm thử hiệu năng cho hệ thống quản lý doanh nghiệp nội bộ.

Trọng tâm của QA-07 không chỉ là đo hệ thống chịu được bao nhiêu user, mà còn đảm bảo:

1. API P0 đạt SLA khi có tải thực tế.
2. Database query dùng đúng index, tránh N+1 và không scan bảng lớn bất hợp lý.
3. Dashboard và Notification không trở thành điểm nghẽn do được gọi thường xuyên.
4. Check-in/check-out, nghỉ phép, task và notification vẫn đúng dữ liệu khi nhiều user thao tác đồng thời.
5. Frontend có trải nghiệm nhanh, không crash khi widget lỗi và không leak cache nhạy cảm.
6. Release MVP có performance gate rõ ràng, có bằng chứng và có khả năng lặp lại ở các build sau.

---

## 29. Tài liệu liên quan

| Mã | Tài liệu | Quan hệ |
| --- | --- | --- |
| [QA-01](QA-01_QA_Strategy_And_Test_Plan.md) | QA Strategy & Test Plan | Tài liệu nền: performance testing strategy, ngưỡng SLA |
| [QA-02](QA-02_Test_Case_Matrix_theo_module.md) | Test Case Matrix theo module | Ma trận test case (gồm nhóm performance) |
| [QA-03](QA-03_End-to-End_Flow_Testing.md) | End-to-End Flow Testing | Flow nghiệp vụ xuyên module |
| [QA-04](QA-04_API_Testing_Contract_Testing.md) | API Testing & Contract Testing | Kiểm thử API contract/response/error |
| [QA-05](QA-05_Permission_Role_Data_Scope_Testing.md) | Permission, Role & Data Scope Testing | RBAC, data scope, field/route guard |
| [QA-06](QA-06_Security_Testing.md) | Security Testing | Bảo mật, OWASP, multi-tenant isolation |
| **QA-07 (tài liệu này)** | Performance & Load Testing | Hiệu năng, tải, SLA/SLO |
| [QA-08](QA-08_Bug_Tracking_Regression_Release_Criteria.md) | Bug Tracking, Regression & Release Criteria | **Chuẩn severity (S0–S4)**, bug lifecycle, release gate |
| [QA-09](QA-09_UAT_Plan_Business_Acceptance.md) | UAT Plan & Business Acceptance | Nghiệm thu nghiệp vụ với stakeholder |
| [QA-10](QA-10_MVP_Release_Readiness_Checklist.md) | MVP Release Readiness Checklist | Checklist release gate cuối |
