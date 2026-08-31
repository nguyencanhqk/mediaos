# DEVOPS-15: PERFORMANCE SMOKE & OBSERVABILITY BASELINE REPORT
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

> **Work Order:** S5-PERF-1 · Workstream H (WS-H)
> **Nguồn:** IMPLEMENTATION-08 §17 · ISSUE-BOARD-01 (QA-PERF-001, DEVOPS-MON-001) · IMP02-STORY-110
> **Chuẩn thiết kế đối chiếu:** [DEVOPS-09 Monitoring/Logging/Alerting](DEVOPS-09_Monitoring_Logging_Alerting.md)
> **Đổi số 31/08/2026 (`S10-GOV-IDUNIQUE-1` nối tiếp):** tài liệu này **trước đây mang số `DEVOPS-10`**, trùng với
> [DEVOPS-10 Backup/Rollback/DR](DEVOPS-10_Backup_Rollback_Disaster_Recovery.md) vốn có từ bộ tài liệu gốc. Báo cáo này
> thêm sau ở `S5-PERF-1` (#286) nên nhận số kế tiếp `DEVOPS-15` — lớp lỗi **KI-079**.
> **Loại:** smoke/baseline — **KHÔNG phải load test sâu** (§17.2). Một client, ít vòng, đo p50/p95 để bắt điểm nghẽn thô + hồi quy rõ rệt.

---

## 1. Thông tin tài liệu

| Trường | Giá trị |
| --- | --- |
| Ngày đo | 2026-07-25 |
| Môi trường đo | DEV-ONLINE (`http://localhost:3200/api/v1`, DB `mediaos_dev`, company `demo`) |
| Công cụ | `scripts/perf-smoke.mjs` (chỉ-đọc, guard-skip khi không có server) |
| Tham số | 30 vòng/endpoint, warmup 3, timeout 10s |
| Phạm vi | 5 endpoint SLA lõi + checklist observability §17.3 |
| Gate | LIGHT (yellow zone) |

> **Cảnh báo dữ liệu:** số đo lấy trên DEV-ONLINE với dataset nhỏ (company `demo`). Đây là **baseline hình dạng truy vấn** (có index/pagination/không N+1), KHÔNG phải SLA sản xuất dưới tải. PROD (:3100, company `funtime` ~45 NV) cùng bậc độ lớn — mọi endpoint đều đã có pagination/limit nên độ trễ tăng chậm theo dữ liệu.

---

## 2. Performance smoke — §17.2

### 2.1 Số đo baseline (DEV-ONLINE, 30 vòng)

| Endpoint | Route | HTTP | p50 (ms) | p95 (ms) | max (ms) | request_id |
| --- | --- | --- | --- | --- | --- | --- |
| Employee list | `GET /hr/employees?page=1&pageSize=20` | 200 | 22.8 | 29.3 | 33.4 | ✓ |
| Attendance records | `GET /attendance/records?page=1&pageSize=20` | 200 | 9.9 | 14.2 | 17.6 | ✓ |
| Task board | `GET /tasks/board` | 200 | 6.3 | 9.6 | 10.3 | ✓ |
| Notification unread | `GET /notifications/unread-count` | 200 | 3.3 | 6.0 | 6.5 | ✓ |
| Dashboard me | `GET /dashboard/me` | 200 | 5.9 | 8.8 | 9.9 | ✓ |

**Kết luận:** tất cả 2xx · p95 ≤ 30ms (ngưỡng smoke MVP 800ms — dư xa) · request_id đầy đủ. Không endpoint nào chạm ngưỡng cảnh báo.

**Tái lập:**
```bash
node scripts/perf-smoke.mjs              # bảng người đọc
node scripts/perf-smoke.mjs --json       # JSON máy đọc
node scripts/perf-smoke.mjs --strict     # exit 1 nếu p95 vượt ngưỡng / có endpoint đỏ
# Trỏ nơi khác: PERF_BASE_URL=... PERF_EMAIL=... PERF_PASSWORD=... PERF_COMPANY_SLUG=...
```

### 2.2 Đối chiếu hình dạng truy vấn (§17.2 checklist)

| Nhóm (§17.2) | Kỳ vọng MVP | Cơ chế trong code | Đạt |
| --- | --- | --- | --- |
| Login/auth me | Không gọi lặp vô hạn | JWT stateless, `/auth/me` 1 query | ✅ |
| Employee list | Pagination/filter, không load toàn bộ | **Canonical** `GET /hr/employees`: `hrEmployeeListQuerySchema` (page/pageSize, clamp `.max`), `listScopedTx` trả `total`/`hasNext`/`hasPrev` ([hr-read.service.ts](../../apps/api/src/employees/hr-read.service.ts#L85)). **Legacy** `GET /employees`: xưa unbounded → **S5-PERF-1 thêm safety-cap** (xem §4.1) | ✅ |
| Attendance records | Query theo tháng/employee/scope có index | `attendanceRecordListQuerySchema` pageSize clamp; index `(company_id, employee_id, work_date)` | ✅ |
| Leave approvals | Pending list load được với filter/scope | Pagination + scope filter (LEAVE module) | ✅ |
| Task list/Kanban | Không N+1 employee/project summary | `GET /tasks/board` cap `BOARD_PAGE_LIMIT_MAX`; summary qua JOIN, không loop-per-row | ✅ |
| Notification unread | Không scan toàn bảng lớn | `unreadStatsTx` dùng literal `status='Unread'` để **hit partial index** `idx_notifications_unread WHERE status='Unread'` ([my-notifications.repository.ts](../../apps/api/src/notifications/my-notifications.repository.ts#L142)) | ✅ |
| Dashboard me | 5–8 widget ổn định/cache | `GET /dashboard/me`: widget fetch song song (`Promise.all`/`allSettled`, degraded per-widget, KHÔNG nuốt 403) + widget cache TTL + invalidation theo event | ✅ |
| Audit log | Filter/pagination, không trả toàn bộ | Audit viewer offset+limit clamp | ✅ |
| Export | Giới hạn hoặc background | `ATTENDANCE_EXPORT_MAX_ROWS = 10_000`; HR export scope-filtered | ✅ |

> **N+1:** rà `for/map(async)/Promise.all` trong 5 service lõi — dashboard dùng `Promise.all`/`allSettled` (song song, có chủ đích), attendance/task/employee list là JOIN đơn truy vấn. Điểm per-row duy nhất là **salary-audit INSERT tuần tự** trong `EmployeesService.listEmployees` (legacy) — bị bao bởi safety-cap ở §4.1.

---

## 3. Observability baseline — §17.3

| Mục §17.3 | Trạng thái | Bằng chứng |
| --- | --- | --- |
| Mỗi API response có request id | ✅ | `requestIdMiddleware` (whitelist charset, CRLF-safe, echo header `X-Request-Id`) → `meta.request_id` trong mọi envelope ([request-id.middleware.ts](../../apps/api/src/common/middleware/request-id.middleware.ts)) · smoke §2.1 xác nhận cả 5 endpoint |
| FE log error có route/screen code | ✅ | FE error boundary + route meta (mã màn hình SPEC-01 §9) |
| Backend log có user/company/request id mức an toàn | ⚠️ Một phần | `AllExceptionsFilter` log 5xx kèm `req=<request_id>` + method + PATH; **chưa** thêm user/company vào mọi log dòng (xem §4.2) |
| Không log token/password/secret/file private | ✅ | `AllExceptionsFilter` **STRIP query-string** khỏi URL + **KHÔNG log header** (Authorization/Cookie/CSRF) + 5xx không lộ stack ra client ([all-exceptions.filter.ts](../../apps/api/src/common/filters/all-exceptions.filter.ts)); DEVOPS-09 §6.3 danh mục cấm |
| Có healthcheck backend | ✅ | `GET /health` (liveness, no-DB) + `GET /health/db` (readiness, fail-soft) ([health.controller.ts](../../apps/api/src/health/health.controller.ts)); live cả :3100 và :3200 |
| Có log migration/seed | ✅ | drizzle migrator log; seed script log start/idempotent |
| Có log notification event failure | ✅ | outbox→bridge log delivery failure; `notification_delivery_logs` append-only |
| Cách truy vấn lỗi 500 trên staging/UAT | ✅ | 5xx server-side log (method + PATH + code + request_id) → grep theo request_id |
| Cách xem slow query / SQL log môi trường test | ⚠️ Một phần | Postgres `log_min_duration_statement` bật được ở môi trường test; chưa có dashboard chuyên (xem §4.2) |

### 3.1 Đối chiếu DEVOPS-09 §17

- **§17.1 Logging:** request_id ✅ · không log secret ✅ · error stack kiểm soát ✅ · worker job start/success/failure ✅ · **JSON structured log ⚠️** (khuyến nghị DEVOPS-09 §6.1 — hiện dùng NestJS `Logger` text, xem §4.2).
- **§17.2 Monitoring:** health endpoint ✅ · error-rate signal (5xx log + envelope) ✅ · DB readiness ping ✅ · metrics CPU/mem/disk + slow-query dashboard = hạ tầng vận hành (ngoài code app).
- **§17.3 Alerting:** health-based uptime khả dụng (canary `/health`); alert 5xx-high / disk / backup / SSL = cấu hình vận hành PROD (DEVOPS-09 §10.2) — baseline, chưa tự động hoá đầy đủ.

---

## 4. Findings & khuyến nghị

### 4.1 [ĐÃ XỬ LÝ trong WO này] Legacy employee list unbounded → safety-cap

- **Trước:** `EmployeesService.listEmployees` (`GET /employees`, legacy) gọi `listEmployeesTx` **không có LIMIT** → scan toàn bộ profile + **1 salary-audit INSERT tuần tự/row** (N round-trip). Endpoint canonical FE dùng (`GET /hr/employees`) đã paginate nên không ảnh hưởng, nhưng path legacy vẫn đăng ký.
- **Sau (S5-PERF-1):** thêm `EMPLOYEE_LIST_MAX_ROWS = 2000` + `.limit()` trong repo; service **warn-log khi chạm cap** (`result truncated; add real pagination`) — cap là rào chống scan chạy loạn, **không phải cắt cụt im lặng**. 2000 >> headcount 1-công-ty MVP nên không bao giờ cắt dữ liệu thật. Test: [employees.service.spec.ts](../../apps/api/src/employees/employees.service.spec.ts) (`safety cap` describe).

### 4.2 [KHUYẾN NGHỊ — follow-up, ngoài scope smoke WO]

| # | Khuyến nghị | Lý do hoãn | Đề xuất |
| --- | --- | --- | --- |
| R1 | **Structured JSON logging** (pino/nestjs-pino) thay `Logger` text, kèm `user_id`/`company_id`/`duration_ms` per-request (DEVOPS-09 §6.1) | Đổi hạ tầng log toàn app — blast radius rộng hơn LIGHT-gate smoke | WO Sprint 6 hardening (DEVOPS-MON-002) |
| R2 | **Real pagination cho legacy `GET /employees`** (page/pageSize + meta) hoặc gỡ hẳn nếu không còn consumer | Đổi contract + FE; cap ở §4.1 đã chặn rủi ro trước mắt | WO HR-PAGINATE-LEGACY |
| R3 | **Alerting tự động** (5xx-rate, disk, backup-fail, SSL-expiry) + slow-query dashboard | Cấu hình hạ tầng vận hành PROD, không phải code app | DEVOPS-MON-001 (phần vận hành) |

---

## 5. PROD infra reconciliation (§17.2 "đối chiếu hạ tầng PROD đang chạy")

- **API sống:** `GET /health` trả 200 trên cả **:3100 (PROD)** và **:3200 (DEV-ONLINE)** với `meta.request_id` — correlation ID hoạt động end-to-end.
- **Topology:** PROD API qua NSSM :3100 + Cloudflare tunnel; DEV-ONLINE :3200 dưới `nest --watch` (mediaos_dev). Cùng một Postgres, tách DB.
- **Readiness:** `GET /health/db` fail-soft (trả `status:"down"` thay vì throw) — an toàn cho uptime canary.

---

## 6. Definition of Done — S5-PERF-1

- [x] Perf smoke 5 endpoint SLA đạt ngưỡng MVP; **số đo ghi lại** (§2.1) — pagination có limit, không N+1, unread partial index đều xác nhận.
- [x] Observability baseline: request-id ✅, health ✅, secret-safe logging ✅, error-rate signal ✅; gap có chủ đích ghi rõ (§4.2).
- [x] Không load test sâu — chỉ smoke/baseline.
- [x] Công cụ tái lập (`scripts/perf-smoke.mjs`) + báo cáo (file này); LIGHT gate.
