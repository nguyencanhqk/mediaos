# RELEASE-02 — KNOWN ISSUES & DEFER LIST (MVP)

> Sổ vấn đề đã biết tại thời điểm chốt cổng Sprint 5 → Sprint 6. Sinh trong `S5-UAT-1`.
> Chốt: **2026-07-26** · `master` `153e2101` · migration head **0529**.
> Thang mức: `QA-08 §9` (S0 Blocker · S1 Critical · S2 Major · S3 Minor · S4 Trivial).
>
> **Quy tắc của sổ này:** chỉ ghi vấn đề đã **kiểm chứng** (có lệnh/truy vấn/số đo/file:dòng). Không
> ghi nghi ngờ. Mỗi mục có **workaround** và **chủ** — không có mục nào "để đó xem sao".

---

## 1. Bảng tổng hợp

| ID | Vấn đề | Mức | Loại | Chặn UAT | Chặn go-live | Chủ |
| --- | --- | --- | --- | --- | --- | --- |
| KI-001 | 4 tài khoản `uat.*` chưa gắn hồ sơ nhân viên | S2 | Dữ liệu | ✅ | ❌ | Owner/HR |
| KI-002 | Chưa có số dư phép nào trong công ty `demo` | S2 | Dữ liệu | ✅ | ❌ | Owner/HR |
| KI-003 | Loại nghỉ phép có 3 bản trùng chữ thường | S3 | Dữ liệu | ❌ | ❌ | Owner/HR |
| KI-004 | Chưa nhập ngày lễ | S3 | Dữ liệu | ❌ | ⚠️ | Owner/HR |
| KI-005 | Widget "Thông báo" trên dashboard trễ tối đa ~10s | S3 | Sản phẩm | ❌ | ❌ | Sprint 6 |
| KI-006 | LMS→NOTI chưa hoạt động (thiếu migration `0529` ở PROD+UAT; NOTI-2 chưa deploy) | S2 | Vận hành | ✅ (phần LMS) | ✅ | Owner/DevOps |
| KI-007 | CI `Security / Dependency scan` đỏ do lỗi công cụ | S3 | CI | ❌ | ⚠️ | Owner/DevOps |
| KI-008 | Chưa có bằng chứng diễn tập **khôi phục** backup | S2 | Vận hành | ❌ | ✅ | Owner/DevOps |
| KI-009 | Log chưa có cấu trúc JSON | S3 | Quan sát | ❌ | ❌ | Sprint 6 |
| KI-010 | Endpoint cũ `GET /employees` chưa phân trang thật (mới chặn bằng cap 2000) | S3 | Sản phẩm | ❌ | ❌ | Sprint 6 |
| KI-011 | Chưa có cảnh báo tự động (5xx-rate, disk, backup-fail, SSL) | S2 | Vận hành | ❌ | ✅ | Owner/DevOps |
| KI-012 | Accepted-risk **D3**: widget headcount count-only xuyên phòng ban cho HR scope Department | S3 | Bảo mật (đã chấp nhận) | ❌ | ⚠️ cần chữ ký | Owner |
| KI-013 | `refresh` / `resetPassword` không throttle (theo thiết kế, có mitigation) | S3 | Bảo mật (theo thiết kế) | ❌ | ❌ | — |
| KI-014 | Chạy cả suite API trong 1 tiến trình bị crash `ERR_IPC_CHANNEL_CLOSED` | S2 | Hạ tầng test | ❌ | ⚠️ | Sprint 6 |
| KI-015 | Nhiễu log `OutboxNotificationBridge … intake THẤT BẠI` khi chạy test | S3 | Vệ sinh test | ❌ | ❌ | Sprint 6 |
| KI-016 | PROD dùng chung `apps/api/dist` với dev-online | S2 | Hạ tầng | ❌ | ✅ | Owner/DevOps |
| KI-017 | Refresh materialized view dashboard qua `workerDb` hỏng từ G14 ("must be owner") | S3 | Sản phẩm (ngủ) | ❌ | ⚠️ | Sprint 6 |
| KI-018 | Dữ liệu demo có trạng thái đơn nghỉ lẫn hoa/thường | S3 | Dữ liệu | ❌ | ❌ | Sprint 6 |
| KI-019 | Chỉ 1 ca làm việc + 1 quy tắc chấm công + 0 phân ca trong DB UAT | S3 | Dữ liệu | ❌ | ❌ | Owner/HR |
| KI-020 | Chưa có dữ liệu GOAL để nghiệm thu | S3 | Dữ liệu | ❌ | ❌ | Owner |

**Tổng: S0 = 0 · S1 = 0 · S2 = 6 · S3 = 14.** Không có defect sản phẩm mức S0/S1 nào đang mở.

---

## 2. Chi tiết

### KI-001 — Tài khoản UAT chưa gắn hồ sơ nhân viên · S2

**Kiểm chứng:** `SELECT u.email, e.employee_code FROM users u LEFT JOIN employee_profiles e ON e.user_id=u.id …`
→ cả 4 tài khoản `uat.*` trả `NULL`.
**Hệ quả:** `GET /attendance/today` trả rỗng kèm thông báo "chưa có hồ sơ"; `POST /attendance/check-in`
→ **403** (`attendance.service.ts:362-363`). Kéo theo chấm công · nghỉ phép · bảng công cá nhân · widget
Employee đều không chạy được.
**Workaround:** `/hr/employees` → tạo/chọn hồ sơ → **Liên kết tài khoản**; rồi `/hr/org-chart` đặt
`uat.manager` làm quản lý trực tiếp của `uat.employee`.

### KI-002 — Chưa có số dư phép · S2

**Kiểm chứng:** `SELECT count(*) FROM leave_balances` → **0**. `leave_types` `ANNUAL`/`SICK`/`COMPENSATORY`
có `deduct_balance = true`, `allow_negative_balance` NULL.
**Hệ quả:** tạo đơn nghỉ loại trừ phép → **422** "Số dư phép không đủ" (`leave-request.service.ts:545-552`).
**Workaround:** `/leave/balances` → cấp số dư phép năm (ghi giao dịch append-only).

### KI-003 — Loại nghỉ phép trùng bản chữ thường · S3

**Kiểm chứng:** `leave_types` có cả `ANNUAL/SICK/UNPAID` (chuẩn) lẫn `annual/sick/unpaid` (`deduct_balance`
NULL) → 11 dòng.
**Hệ quả:** danh sách chọn loại nghỉ hiện lặp; chọn nhầm bản chữ thường thì **không trừ phép**.
**Workaround:** xoá mềm 3 bản chữ thường ở `/leave/types` sau khi xác nhận không đơn nào tham chiếu.

### KI-004 — Chưa nhập ngày lễ · S3

`SELECT count(*) FROM public_holidays` → **0**. Số ngày nghỉ tính không trừ ngày lễ.
**Workaround:** `/system/public-holidays` nhập lịch lễ trước khi tính công/phép cho kỳ thật.

### KI-005 — Widget "Thông báo" trễ trong TTL · S3

Widget `NOTIFICATIONS` **không tự vô hiệu cache** khi có thông báo mới ⇒ số liệu cũ trong TTL ~10s rồi
tự lành. Đã có test khoá hành vi này: `qa2-e2e-task-noti-dash.int-spec.ts` (ca E3 — "known-issue
QA2-HIGH-001"). Chuông thông báo (không qua widget) **không** bị ảnh hưởng.

### KI-006 — LMS→NOTI chưa hoạt động · S2

**Kiểm chứng:** `mediaos_dev` **và** `mediaos` (PROD) đều áp **196/197** migration;
`SELECT event_code FROM notification_events WHERE event_code LIKE 'LMS%'` → **0 dòng** ở cả hai.
**Hệ quả:** 4 mã sự kiện `LMS_ENROLLMENT_APPROVED` · `LMS_COURSE_ASSIGNED` · `LMS_EXAM_GRADED` ·
`LMS_COURSE_DEADLINE_NEAR` chưa tồn tại ⇒ intake từ LMS sẽ **404 event không tồn tại**.
**Code đã xong cả hai phía** (`S5-LMS-NOTI-1` merged PR #291 · `S5-LMS-NOTI-2` + runbook deploy
`153e2101`); còn **thiếu bước vận hành**: (1) áp `0529`, (2) đặt `LMS_NOTI_TOKEN` vào **cả**
`.env.prod` lẫn `.env` phía MediaOS và `apps/lms/.env.production` phía LMS, (3) deploy đúng thứ tự
API → LMS.
**Workaround/cách đóng:** `m dev-online-db` (UAT) · `m prod-update` (PROD — đã ép migrate trước
restart) · làm theo `docs/plans/S5-LMS-NOTI-2.md` §4 (runbook).

### KI-007 — CI Dependency scan đỏ vì công cụ · S3

`Security` workflow: job gitleaks **xanh**, job `pnpm audit` **đỏ** với
`ERR_PNPM_AUDIT_BAD_RESPONSE` (endpoint advisory npm trả body gzip pnpm không parse được).
**Tái hiện y hệt khi chạy `pnpm audit --audit-level=high` ở local** ⇒ lỗi phía công cụ/registry, **chưa
chứng minh có lỗ hổng high/critical**. **Cảnh báo:** đừng dùng job này làm bằng chứng "sạch lỗ hổng" —
hiện nó không nói được gì cả.

### KI-008 — Chưa diễn tập khôi phục backup · S2

Có `scripts/backup-db.sh` + `scripts/backup-restore-drill.sh`, **không tìm thấy biên bản/log drill nào
trong repo**. Backup chưa restore-test thì chưa tính là backup.
**Việc:** chạy drill 1 lần trên bản sao PROD, lưu biên bản vào `docs/DEVOPS/` (Sprint 6 `S6-PERF-DB-1`).

### KI-009 / KI-010 / KI-011 — 3 khuyến nghị treo từ S5-PERF-1

Nguyên văn `DEVOPS-10_Performance_Smoke_Observability_Baseline_Report.md` §4.2: R1 log JSON có cấu trúc ·
R2 phân trang thật cho `GET /employees` (hiện chặn bằng cap **2000 dòng**, có warn-log khi chạm cap —
không cắt câm) · R3 cảnh báo tự động. **KI-011 là điều kiện go-live**, hai cái kia không.

### KI-012 / KI-013 — 2 quyết định bảo mật cần đóng sổ

- **D3 (KI-012):** widget `hr-overview` count-only, đã mask PII, gate bằng **quyền widget** chứ không
  theo data-scope ⇒ HR được cấp scope Department vẫn thấy **con số** headcount toàn công ty. Không lộ
  PII cá nhân. **Cần owner ký chấp nhận cho MVP** (`RELEASE-04` §3).
- **D1 (KI-013):** `refresh` không throttle nhưng có reuse-detection + `FOR UPDATE`; `resetPassword`
  không throttle nhưng token entropy cao, lưu hash, dùng-một-lần, hết hạn ngắn. Kết luận: giữ nguyên,
  không thêm throttle suy đoán vào `auth.service.ts` (crown).

### KI-014 — Suite API crash khi chạy 1 tiến trình · S2 (hạ tầng test)

Chạy cả `@mediaos/api` một lần → `Unhandled Rejection: Channel closed` / `ERR_IPC_CHANNEL_CLOSED`,
**0 ca test đỏ**, suite chết giữa chừng. `--no-file-parallelism` **không** cứu được (chết ở file thứ 61).
**Workaround duy nhất đang có: chia chunk** (6 lệnh vitest × ~75 file → 445 file / 7.113 test, 0 fail).
**Vì sao là S2:** nó làm `check.sh` in ĐỎ khi thực chất xanh ⇒ dễ dẫn tới bỏ qua đỏ THẬT.

### KI-015 — Nhiễu log outbox bridge trong test · S3

`OutboxNotificationBridge … intake THẤT BẠI` (6 lần trên lane sạch). Truy tới gốc: nhánh `no_recipient`
→ `recordSkip` → INSERT `audit_logs` vỡ **FK `audit_logs_actor_user_id_fkey`** vì outbox drain chạy sau
khi spec đã dọn user của mình. **Production không dính** (user là xoá mềm — BẤT BIẾN #2).
**Việc:** đợi outbox drain xong trước teardown, hoặc bỏ `actorUserId` khỏi audit skip.

### KI-016 — PROD dùng chung `dist` với dev-online · S2

Service PROD `MediaOS-API` chạy thẳng `apps/api/dist/main` của repo dev. Cả `m dev-online` lẫn
`m dev-online-fast` đều biên dịch lại thư mục đó ⇒ bật môi trường UAT có thể làm PROD nạp binary mới
trong khi DB PROD chưa áp migration tương ứng (đã từng gây PROD login 500 ngày 2026-07-08).
**Việc (go-live blocker):** cấp thư mục build riêng cho PROD.

### KI-017 — Refresh MV dashboard qua workerDb hỏng từ G14 · S3

`dashboard-refresh.service.ts:19-22` ghi rõ: REFRESH đòi role **owner** của materialized view (=`mediaos`),
nhưng `refreshDb` ưu tiên `workerDb` (`mediaos_worker`) ⇒ đường refresh runtime fail "must be owner" ở
mọi môi trường có `DATABASE_WORKER_URL`. Hiện **chưa consumer nào gọi tới** nên không lộ ra người dùng.
**Cấm sửa nhanh bằng `ALTER OWNER` cho worker** — worker không BYPASSRLS + `tasks` FORCE RLS ⇒ MV sẽ
**rỗng lặng lẽ**, tệ hơn lỗi hiện tại.

### KI-018 / KI-019 / KI-020 — 3 khoảng trống dữ liệu demo · S3

Trạng thái đơn nghỉ lẫn hoa/thường (`Pending` 1 · `pending` 2 · `approved` 1 · `Draft` 1) · chỉ 1 ca +
1 quy tắc chấm công + 0 phân ca (có fallback nên không chặn) · `goals` = 0.

---

## 3. Cái KHÔNG được defer

| Không được defer | Lý do |
| --- | --- |
| Bug lộ dữ liệu ngoài phạm vi quyền | Vi phạm BẤT BIẾN #1 |
| Hard-delete dữ liệu nghiệp vụ / ghi đè bảng append-only | Vi phạm BẤT BIẾN #2 |
| Secret dạng plaintext trong code/log/DTO | Vi phạm BẤT BIẾN #3 |
| Migration chưa áp ở PROD khi code đã yêu cầu | Chính là KI-006 — gây 500 hàng loạt |
| Bug chặn login / phiên / phân quyền | Không dùng được hệ thống |

---

## 4. Defer list — chuyển sang sau MVP

| Hạng mục | Chuyển tới | Lý do defer |
| --- | --- | --- |
| Throttle `refresh`/`resetPassword` | Phase sau (nếu nâng threat-model) | Đã có mitigation tương đương (KI-013) |
| Count theo Department cho widget `hr-overview` | Phase sau | Count-only, không lộ PII (KI-012) |
| Log JSON có cấu trúc (R1) | Sprint 6 `DEVOPS-MON-002` | Blast radius rộng, không phải rủi ro release |
| Phân trang thật `GET /employees` (R2) | WO `HR-PAGINATE-LEGACY` | Đã có cap 2000 chặn rủi ro |
| Realtime WebSocket đầy đủ | Post-MVP | MVP dùng polling/refresh thủ công |
| Load test quy mô lớn | Release phase | MVP chỉ smoke/baseline |
| Đa công ty (SaaS) | Post-MVP | Đang chạy N=1; hạ tầng RLS giữ nguyên để mở sau |
| Module Payroll · Recruit · Asset · Room · Chat · Social · Mobile | Phase 2–5 | Ngoài phạm vi MVP theo SPEC-01 §7 |
