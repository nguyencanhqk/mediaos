# RELEASE-02 — KNOWN ISSUES & DEFER LIST (MVP)

> Sổ vấn đề đã biết tại thời điểm chốt cổng Sprint 5 → Sprint 6. Sinh trong `S5-UAT-1`.
> Chốt: **2026-07-26** · `master` `153e2101` · migration head **0529**.
> Cập nhật: `S6-STAB-1` (KI-021…023) · **`S6-QA-FINAL-1` (KI-024…026)** — `master` `c845a777`.
> Thang mức: `QA-08 §9` (S0 Blocker · S1 Critical · S2 Major · S3 Minor · S4 Trivial).
>
> **Quy tắc của sổ này:** chỉ ghi vấn đề đã **kiểm chứng** (có lệnh/truy vấn/số đo/file:dòng). Không
> ghi nghi ngờ. Mỗi mục có **workaround** và **chủ** — không có mục nào "để đó xem sao".

---

## 1. Bảng tổng hợp

| ID | Vấn đề | Mức | Loại | Chặn UAT | Chặn go-live | Chủ |
| --- | --- | --- | --- | --- | --- | --- |
| ~~KI-001~~ | ~~Tài khoản `uat.*` chưa gắn hồ sơ nhân viên~~ — **ĐÃ ĐÓNG 2026-07-26** | S2 | Dữ liệu | — | — | ✔ xong |
| ~~KI-002~~ | ~~Chưa có số dư phép trong công ty `demo`~~ — **ĐÃ ĐÓNG 2026-07-26** | S2 | Dữ liệu | — | — | ✔ xong |
| KI-003 | Loại nghỉ phép có 3 bản trùng chữ thường | S3 | Dữ liệu | ❌ | ❌ | Owner/HR |
| KI-004 | Chưa nhập ngày lễ | S3 | Dữ liệu | ❌ | ⚠️ | Owner/HR |
| KI-005 | Widget "Thông báo" trên dashboard trễ tối đa ~10s | S3 | Sản phẩm | ❌ | ❌ | Sprint 6 |
| KI-006 | LMS→NOTI chưa hoạt động — **migration `0529` ĐÃ áp cho cả PROD+UAT 2026-07-26**; còn thiếu `LMS_NOTI_TOKEN` + deploy | S2→S3 | Vận hành | ❌ | ✅ | Owner/DevOps |
| KI-007 | CI `Security / Dependency scan` đỏ do lỗi công cụ | S3 | CI | ❌ | ⚠️ | Owner/DevOps |
| KI-008 | Chưa có bằng chứng diễn tập **khôi phục** backup | S2 | Vận hành | ❌ | ✅ | Owner/DevOps |
| KI-009 | Log chưa có cấu trúc JSON | S3 | Quan sát | ❌ | ❌ | Sprint 6 |
| KI-010 | Endpoint cũ `GET /employees` chưa phân trang thật (mới chặn bằng cap 2000) | S3 | Sản phẩm | ❌ | ❌ | Sprint 6 |
| KI-011 | Chưa có cảnh báo tự động (5xx-rate, disk, backup-fail, SSL) | S2 | Vận hành | ❌ | ✅ | Owner/DevOps |
| KI-012 | Accepted-risk **D3**: widget headcount count-only xuyên phòng ban cho HR scope Department | S3 | Bảo mật (đã chấp nhận) | ❌ | ⚠️ cần chữ ký | Owner |
| KI-013 | `refresh` / `resetPassword` không throttle (theo thiết kế, có mitigation) | S3 | Bảo mật (theo thiết kế) | ❌ | ❌ | — |
| KI-014 | Chạy cả suite trong 1 tiến trình bị crash `ERR_IPC_CHANNEL_CLOSED` — **cập nhật 2026-07-26: chạm CẢ `@mediaos/app`, và CHỈ ở máy local Windows (CI ubuntu xanh)** | S2 | Hạ tầng test (local) | ❌ | ❌ | Sprint 6 |
| KI-015 | Nhiễu log `OutboxNotificationBridge … intake THẤT BẠI` khi chạy test | S3 | Vệ sinh test | ❌ | ❌ | Sprint 6 |
| KI-016 | PROD dùng chung `apps/api/dist` với dev-online | S2 | Hạ tầng | ❌ | ✅ | Owner/DevOps |
| KI-017 | Refresh materialized view dashboard qua `workerDb` hỏng từ G14 ("must be owner") | S3 | Sản phẩm (ngủ) | ❌ | ⚠️ | Sprint 6 |
| KI-018 | Dữ liệu demo có trạng thái đơn nghỉ lẫn hoa/thường | S3 | Dữ liệu | ❌ | ❌ | Sprint 6 |
| KI-019 | Chỉ 1 ca làm việc + 1 quy tắc chấm công + 0 phân ca trong DB UAT | S3 | Dữ liệu | ❌ | ❌ | Owner/HR |
| KI-020 | Chưa có dữ liệu GOAL để nghiệm thu | S3 | Dữ liệu | ❌ | ❌ | Owner |
| KI-021 | 3 sự kiện NOTI của ATT bật trong danh mục nhưng **không có producer** (`ATT_MISSING_CHECKOUT` · `ATT_LATE_DETECTED` · `ATT_ABSENT_DETECTED`) | S2 | Sản phẩm | ❌ | ❌ | Sau MVP |
| ~~KI-022~~ | ~~`outboxOf` trong `goal-be2-link.int-spec` không lọc `company_id` ⇒ đỏ-giả ngẫu nhiên~~ — **ĐÃ ĐÓNG 2026-07-26** (`S6-STAB-1`) | S1 | Hạ tầng test | — | — | ✔ xong |
| ~~KI-023~~ | ~~Đua teardown `audit_logs → companies` trong `cleanupTenants` ⇒ đỏ-giả ngẫu nhiên~~ — **ĐÃ ĐÓNG 2026-07-26** (`S6-STAB-1`) | S1 | Hạ tầng test | — | — | ✔ xong |
| ~~KI-024~~ | ~~`foundation-audit.e2e-spec` dùng `action` cố định + đếm tuyệt đối ở System scope ⇒ đỏ-giả **vĩnh viễn** sau một lần chạy bị ngắt~~ — **ĐÃ ĐÓNG 2026-07-26** (`S6-QA-FINAL-1`) | S1 | Hạ tầng test | — | — | ✔ xong |
| KI-025 | **98/346 đường dẫn API (28%) không có test HTTP nào chạm** — phủ ở tầng service (`T-svc`) nên guard/DTO/envelope của route chưa từng chạy. Nặng nhất: `user-invites` (`/users/invite`, `/users/:id/approve`…) + `POST/GET /hr/profile-change-requests` | S2 | Độ phủ test | ❌ | ❌ | Sau MVP |
| ~~KI-026~~ | ~~Nhãn `[BLOCKED — service.ts bug]` + chú thích "KNOWN BROKEN" nằm trên một test ĐANG XANH (`attendance-adjustment.int.spec.ts`) — bug đã sửa cùng PR #81 nhưng chú thích không gỡ~~ — **ĐÃ ĐÓNG 2026-07-26** (`S6-QA-FINAL-1`) | S3 | Vệ sinh test | — | — | ✔ xong |

**Tổng (cập nhật 2026-07-26 sau `S6-QA-FINAL-1`): S0 = 0 · S1 = 0 mở (3 phát hiện + đóng trong ngày) ·
S2 = 6 mở (KI-008 · KI-011 · KI-014 · KI-016 · KI-021 · **KI-025**) · S3 = 16 (KI-026 đóng ngay).**
Không có defect sản phẩm mức S0/S1 nào đang mở. KI-001/KI-002 **đã đóng**; KI-006 hạ xuống S3 (chỉ còn
bước cấu hình token + deploy). Giữ nguyên số hiệu KI để tài liệu khác trỏ tới không bị gãy.

> **Ngưỡng RC** (`RELEASE-05` §5.3) cho phép **≤3** mục S2 mở, mỗi mục có owner + workaround. Hiện
> **6** ⇒ trước khi tạo RC phải đóng bớt hoặc owner ký waiver tường minh cho phần vượt. Hai mục nằm
> trong tầm đóng được ở Sprint 6: **KI-008** (diễn tập restore — `S6-PERF-DB-1`) và **KI-016** (tách
> `dist` — cần mở `S6-OPS-DISTSPLIT-1`).

---

## 2. Chi tiết

### KI-001 — Tài khoản UAT chưa gắn hồ sơ nhân viên · S2 · ✅ ĐÃ ĐÓNG 2026-07-26

> **Đã đóng:** tạo `UAT-EMP-01` (phòng Nội Dung, quản lý trực tiếp = `uat.manager`) · `UAT-MGR-01` ·
> `UAT-HR-01` (phòng Nhân Sự) trong `mediaos_dev`, set **cả** `direct_manager_id` **lẫn**
> `employee_manager_relations`. Bơm bằng SQL idempotent ⇒ **không có vết `audit_logs`** (đánh đổi đã
> ghi rõ ở `S5-UAT-1-UAT-CYCLE0-DRYRUN.md` §0).

**Kiểm chứng:** `SELECT u.email, e.employee_code FROM users u LEFT JOIN employee_profiles e ON e.user_id=u.id …`
→ cả 4 tài khoản `uat.*` trả `NULL`.
**Hệ quả:** `GET /attendance/today` trả rỗng kèm thông báo "chưa có hồ sơ"; `POST /attendance/check-in`
→ **403** (`attendance.service.ts:362-363`). Kéo theo chấm công · nghỉ phép · bảng công cá nhân · widget
Employee đều không chạy được.
**Workaround:** `/hr/employees` → tạo/chọn hồ sơ → **Liên kết tài khoản**; rồi `/hr/org-chart` đặt
`uat.manager` làm quản lý trực tiếp của `uat.employee`.

### KI-002 — Chưa có số dư phép · S2 · ✅ ĐÃ ĐÓNG 2026-07-26

> **Đã đóng:** số dư 2026 — `uat.employee` ANNUAL 12 + SICK 5 · `uat.manager` ANNUAL 12
> (`remaining_days` là cột GENERATED `total_days - used_days`, không ghi tay).

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

### KI-006 — LMS→NOTI chưa hoạt động · S2 → S3 (một nửa đã đóng 2026-07-26)

> **Đã đóng phần migration:** `m migrate` (PROD `mediaos`) + `m dev-online-migrate` (UAT
> `mediaos_dev`) ⇒ **cả hai 197/197**, 4 mã `LMS_*` có mặt. PROD health 200 sau migrate — 0529 chỉ
> nới CHECK + INSERT catalog nên **không cần restart** service. **Còn lại:** đặt `LMS_NOTI_TOKEN`
> hai phía + deploy theo `docs/plans/S5-LMS-NOTI-2.md` §4.

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

**Cập nhật 2026-07-26 (`S6-STAB-1` — 2 đính chính, chi tiết `RELEASE-06` §4.4):**

1. **Không riêng API.** `@mediaos/app` cũng chết y hệt (`ERR_IPC_CHANNEL_CLOSED`; qua pnpm còn thấy
   exit `3221225477` = `0xC0000005` ACCESS_VIOLATION). Chia nhỏ → **199/199 file spec xanh**. Crash phụ
   thuộc **kích thước chunk**, không gắn với file nào: gộp `routes/{tasks,hr,goals}` (64 file) chết,
   tách từng cái thì xanh.
2. **CI KHÔNG dính — đây là chuyện máy local Windows.** CI chạy `ubuntu-latest`: `ci.yml:140` gọi
   `pnpm test` toàn workspace **một lần**, `apps-frontend.yml:95` chạy từng app; cả `CI` · `API — CI` ·
   `Apps — Frontend CI` đều **success** trên `dcf85eb0`. `api.yml` cũng đã set `LANE_DB: mediaos` ở
   bước Test (từ 2026-07-10) ⇒ deny-path/IDOR **có chạy thật** trong CI.

⇒ **Hạ "chặn go-live" từ ⚠️ xuống ❌**: không chặn release (CI vẫn là cổng thật). Cái nó chặn là **cổng
verify local** — `harness/check.sh` mọi tier không thể xanh trên máy Windows này.

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

### KI-021 — 3 sự kiện NOTI của ATT không có producer · S2 · phát hiện 2026-07-26 (`S6-STAB-1`)

`ATT_MISSING_CHECKOUT` · `ATT_LATE_DETECTED` · `ATT_ABSENT_DETECTED` được seed `isEnabled: true` trong
`notification-event-catalog.const.ts:82-84`, nhưng **không có nơi nào phát chúng** — toàn hệ chỉ đăng ký
**3** `@SystemJobHandler` (dọn file tạm · dọn theo chính sách lưu trữ · dọn `system_job_runs`), **không
có job ATT cuối ngày**. Chính code cũng ghi nhận: `dashboard-cache-invalidation.const.ts:43` — *"KHÔNG
có producer nào"*.

**Hệ quả:** người dùng bật/tắt được 3 loại thông báo không bao giờ tới; admin thấy chúng trong danh mục
sự kiện. **KHÔNG sai dữ liệu** — cờ `is_missing_check_out` đặt **đồng bộ** ngay lúc check-in/check-out
(`attendance.builders.ts:63,104`), không chờ job. **Workaround:** đơn điều chỉnh công
(`MISSING_CHECK_OUT`) đã chạy được.

**Defer** vì làm job mới là **tính năng**, bị `RELEASE-05` §4.2 từ chối sau freeze. Sau MVP chọn một
trong hai: build job ATT cuối ngày, **hoặc** đặt `isEnabled: false` cho 3 mã để UI không hứa cái không
có — đúng mẫu `ATT_CHECKIN_REMINDER`/`ATT_CHECKOUT_REMINDER` đang dùng. Chi tiết: `RELEASE-06` §4.1.

### KI-022 / KI-023 — 2 nguồn ĐỎ-GIẢ trong suite · S1 · ✅ ĐÃ ĐÓNG 2026-07-26 (`S6-STAB-1`)

Cả hai đều **không phải lỗi sản phẩm**, nhưng làm suite đỏ **ngẫu nhiên** rồi xanh lại khi chạy đơn lẻ —
dạng nguy hiểm nhất vì dẫn tới thói quen "chạy lại cho xanh".

- **KI-022:** `outboxOf` trong `goal-be2-link.int-spec` truy vấn `outbox_events` **không lọc
  `company_id`** ⇒ đếm cả sự kiện của spec chạy song song. Đây là chỗ **duy nhất** sót; mọi spec outbox
  khác đã lọc.
- **KI-023:** `cleanupTenants` quét lại `audit_logs` trước `DELETE users` nhưng **không** trước
  `DELETE companies` ⇒ outbox worker còn sống ghi thêm audit trong cửa sổ đó làm vỡ FK
  `audit_logs_company_id_fkey`.

Verify: chạy lại **nguyên chunk `f–l`** (tái tạo đúng điều kiện tranh chấp) → **44/44 file ·
1.022/1.022 test xanh**. Chi tiết: `RELEASE-06` §4.2/§4.3.

### KI-024 — `foundation-audit.e2e-spec` đỏ-giả **vĩnh viễn** · S1 · ✅ ĐÃ ĐÓNG 2026-07-26 (`S6-QA-FINAL-1`)

Cùng họ với KI-022/023 nhưng **nặng hơn**: nó **không** tự khỏi khi chạy lại. `ACTION_A`/`ACTION_B` là
hằng cố định (`BE3SecretLeakA/B`) trong khi case `3f` đọc ở **System scope** (chéo tenant, RLS không
khoanh) và assert `length === 1`. `audit_logs` **append-only** ⇒ chỉ cần một lần chạy bị ngắt (Ctrl-C
hoặc crash worker KI-014) là hàng của lần đó nằm lại DB lane **vĩnh viễn**, mọi lần sau đếm ra 2 → đỏ.

Fix: gắn `RUN_TAG = randomUUID().slice(0,8)` vào `action`, đúng idiom sẵn có
(`audit-permission-deny.int-spec.ts:66`). Verify: chạy file đó **2 lần liên tiếp không dọn gì ở giữa** →
8/8 xanh cả hai lần, `count(*) … LIKE 'BE3SecretLeak%'` = 0. Chi tiết: `S6-QA-FINAL-1-FINAL-QA-PASS` §8.1.

### KI-025 — 98/346 đường dẫn API không có test HTTP nào chạm · S2 · phát hiện 2026-07-26 (`S6-QA-FINAL-1`)

**Đo, không phải ước lượng:** 452 route thật (decorator NestJS) / 346 đường dẫn phân biệt, đối chiếu với
mọi URL literal trong 446 file spec ⇒ **72% đường dẫn có test chạm, 28% không**.

**Rủi ro thật là gì:** guard · `ZodValidationPipe` · response envelope của các route đó **chưa từng chạy
trong test**. Hai bề mặt nghiệp vụ thật nằm trong nhóm này — `user-invites` (`/users/invite`,
`/users/pending`, `/users/:id/approve|reject|suspend|reactivate`) và `POST/GET /hr/profile-change-requests`
— đều được test **rất kỹ ở tầng service** (`new UserInvitesService(...)`, `profile-change-request.int-spec`)
nên nhìn bảng coverage sẽ tưởng đã phủ.

**Rủi ro KHÔNG phải là gì:** không phải "route bỏ ngỏ quyền". Trong 134 route chưa-test chỉ **9** route
vừa thiếu `@RequirePermission` vừa thiếu `@Public()`, và đều thuộc nhóm self-scoped có chủ đích
(`/auth/2fa/*`, `/auth/sessions/*`, `/me/*`) hoặc module CONTENT đã park — nhóm sau đã bị
`route-guard-coverage.e2e-spec.ts` chặn hồi quy.

**Workaround:** sweep tĩnh `route-guard-coverage.e2e-spec.ts` bắt được route MỚI quên gate.
**Chủ:** Sau MVP (thêm test = việc mới, `RELEASE-05` §4.2 chặn sau freeze).
**Bàn giao:** phán quyết từng dòng trong 35 route không-`@RequirePermission` thuộc `S6-SEC-1` (WS4 §13.2).

### KI-026 — Nhãn `[BLOCKED]` trên test ĐANG XANH · S3 · ✅ ĐÃ ĐÓNG 2026-07-26 (`S6-QA-FINAL-1`)

`attendance-adjustment.int.spec.ts` mang 9 dòng chú thích "KNOWN BROKEN" + tên test
`… → 200 [BLOCKED — see comment above, service.ts bug]`, mô tả `detailInScope()` hard-code
`orgUnitId/directManagerUserId = null`. **Bug đã sửa trong CHÍNH commit đưa test vào** (`80a1bcd5`,
PR #81, 2026-07-02 — `detailInScope()` nạp employee thật qua `resolveRequestEmployee()`); chú thích
không được gỡ. Test XANH suốt từ đó.

Không phải defect, nhưng đủ để làm người đọc kết luận sai là ATT còn lỗi mở — đúng lớp rủi ro mà
`RELEASE-06` §1 cảnh báo, chỉ theo chiều ngược lại: **"code đọc có vẻ hỏng" cũng không phải bằng chứng**.
Fix: thay bằng ghi chú lịch sử + bỏ nhãn.

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
