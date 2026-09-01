# API-18: PAYROLL API DESIGN (Tiền lương — Hồ sơ lương · Thưởng/phạt · Kỳ lương · Tính · Duyệt · Phiếu lương)

**MODULE PAYROLL - TIỀN LƯƠNG - API DESIGN**

> **📚 Bộ tài liệu API — Hệ thống Quản lý Doanh nghiệp**
> [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [API-02 AUTH](<API-02 AUTH API Design.md>) · [API-03 HR](<API-03_HR_API_Design.md>) · [API-04 ATT](<API-04_ATT_API_Design.md>) · [API-05 LEAVE](<API-05_LEAVE_API_Design.md>) · [API-06 TASK](<API-06_TASK_API_Design.md>) · [API-07 NOTI](<API-07_NOTI_API_Design.md>) · [API-08 DASH](<API-08_DASH_API_Design.md>) · [API-09 FOUNDATION](<API-09_FOUNDATION_API_Design.md>) · [API-10 Permission Matrix](<API-10 PERMISSION MATRIX.md>) · [API-11 ME](<API-11_ME_API_Design.md>) · [API-12 GOAL](<API-12_GOAL_API_Design.md>) · [API-13 CHAT](<API-13_CHAT_API_Design.md>) · [API-14 ASSET](<API-14_ASSET_API_Design.md>) · [API-15 ROOM](<API-15_ROOM_API_Design.md>) · [API-17 RECRUIT](<API-17_RECRUIT_API_Design.md>) · **API-18 PAYROLL**
>
> **Nguồn & liên quan:** [Chuẩn API: API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [Đặc tả: SPEC-11 PAYROLL](<../SPEC/SPEC-11 PAYROLL.md>) · [Thiết kế DB: DB-13](<../DB/DB-13 PAYROLL Database Design.md>) · [DB-09 §8.19 Index](<../DB/DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 Seed PAYROLL](<../DB/DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>) · [Ma trận phân quyền §9g](<../permission-matrix-spec.md>) · [Chỉ mục tài liệu](<../README.md>)
>
> **Đánh số (PAY-DEC-001):** PAYROLL nhận **API-18** — **API-13 vốn dự định cho PAYROLL đã bị CHAT chiếm**, API-14/15 = ASSET/ROOM, **API-16 = «PERMISSION AUDIT REPORT»**, API-17 = RECRUIT. Không dồn số, không đè tài liệu sống.

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | API-18 |
| Tên tài liệu | PAYROLL API Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Module | PAYROLL - Tiền lương |
| Phiên bản | v0.1 |
| Trạng thái | **Stub — Approved** (owner duyệt gói wave S13-PAYROLL 31/08/2026, cùng SPEC-11 §1). Khung endpoint đã chốt; DTO chi tiết bổ sung ở WO backend `S13-PAYROLL-BE-1`/`BE-2` |
| Giai đoạn | Phase 2 «HR nâng cao» · wave S13-PAYROLL — hậu go-live |
| Tài liệu nguồn | SPEC-11 PAYROLL, API-01 Tổng quan, DB-13, DB-09/10, permission-matrix-spec §9g |
| Ngày tạo / cập nhật | 31/08/2026 / 31/08/2026 |

> **Trạng thái Stub:** khoá **tên file + danh sách endpoint + cặp quyền + nguyên tắc bắt buộc** để README/SPEC-11 §15 trỏ nhất quán. DTO/schema đầy đủ, ví dụ payload và OpenAPI bổ sung ở WO backend — đồng bộ `packages/contracts/src/payroll.ts` (**file đã tồn tại với DTO hướng cũ, phải VIẾT LẠI** — DB-13 §7 enum, kế hoạch ở §10).

---

## 2. Mục đích tài liệu

Mô tả thiết kế API cho module **PAYROLL** — hồ sơ lương versioned, thưởng/phạt theo kỳ, kỳ lương 7 trạng thái với four-eyes, máy tính lương snapshot-đóng-băng, phiếu lương append-only + «phiếu của tôi» (SPEC-11 §2). API-18 dùng làm cơ sở cho:

1. Backend triển khai controller/service/DTO dưới prefix `/api/v1/payroll-periods`, `/api/v1/salary-profiles`, `/api/v1/bonus-penalties`, `/api/v1/payslips`, `/api/v1/me/payslips`, `/api/v1/payroll/pickers`.
2. Frontend triển khai 6 màn `PAY-SCREEN-001..006` (`apps/app/src/routes/payroll/` + màn ME).
3. QA viết ma trận allow/deny per-pair (17 cặp), IDOR cross-employee, FSM 7 trạng thái, race double-generate **và `generate ‖ reopen`**, đối soát số cho khu vực PAYROLL.

---

## 3. Căn cứ thiết kế

1. **API-01** — prefix `/api/v1`, envelope/lỗi/pagination chuẩn, header `X-Request-Id`/`Idempotency-Key`, authentication + permission + data scope + business validation + audit.
2. **SPEC-11 PAYROLL** — nguồn sự thật nghiệp vụ: nguyên tắc (§3), permission **17 cặp** + **bản đồ thu hồi 19 cặp di sản** (§11), **17 mã lỗi** (§12), FSM + **bảng RESET vết duyệt** + máy tính lương + data scope (§13), API (§15), sự kiện (§17), audit/masking (§18), PAY-DEC-001..010 + tinh chỉnh sau plan-review (§22).
3. **DB-13** — **bản đồ reconcile 6 bảng di sản G12** (§5) + 1 bảng mới `payroll_period_lines`; append-only `payslips`/`payslip_items`/`payslip_acknowledgements`; chốt cuối UNIQUE + CHECK four-eyes.
4. **DB-09 §8.19** — index PAYROLL; **DB-10** — seed role `payroll-officer` (2FA) + thu hồi 16 cặp di sản + **17 cặp mới + 32 grant** + 4 event NOTI.
5. **permission-matrix-spec §9g** — ma trận data_scope per-(perm, role).
6. **API-04 ATT** — `attendance_periods` phải `locked` trước khi tính (điều kiện của `calculate`); `companies.working_days_json` + `public_holidays.is_paid_holiday` là nguồn mẫu số `work_days`. PAYROLL **không** dựng cổng khoá ngược và **không** viện dẫn `ATT-ERR-024` (SPEC-11 §3.5).
7. **API-05 LEAVE** — `leave_types.paid` tách phép có lương / không lương.
8. **API-03 HR** — danh tính hiển thị (không dùng `employee_profiles.base_salary` để tính — PAY-DEC-003).
9. **API-17 RECRUIT** — khuôn hiện thực gần nhất (guard 2 tầng theo bảng hằng route→pair, masking ở mapper, `@Idempotent()`, điểm chiếu danh tính duy nhất, hình dạng `details` mảng `ErrorDetail`).

---

## 4. Phạm vi API-18

### 4.1 Bao gồm trong v1

| Nhóm API | Mô tả |
| --- | --- |
| Payroll Periods | CRUD + FSM 7 trạng thái · gom đầu vào · cảnh báo dữ liệu thiếu · tính · đọc/điều chỉnh dòng · gửi duyệt · duyệt/từ chối (four-eyes) · sinh phiếu · phát hành · khoá · mở lại · export XLSX · summary (widget DASH) |
| Pickers | Danh bạ nhân sự **và** danh sách kỳ công — trường bó hẹp, gác bằng cặp PAYROLL (officer không có cặp HR/ATT/AUTH nào) |
| Salary Profiles | Danh sách/chi tiết (mask + **audit lượt đọc**) · tạo phiên bản mới theo `effective_date` · sửa · xoá mềm |
| Bonus / Penalties | Danh sách/chi tiết · tạo (lý do bắt buộc) · sửa khi `Pending` · duyệt/từ chối (chặn tự duyệt) |
| Payslips | Danh sách/chi tiết phiếu của người khác (**audit lượt đọc**) |
| Me / Payslips | «Phiếu lương của tôi» (Own) · breakdown · xác nhận |

### 4.2 Không bao gồm (ngoài phạm vi v1 — SPEC-11 §5.2, PARK-PAYROLL-001)

- Engine BHXH/BHYT/BHTN/TNCN luỹ tiến · PDF phiếu lương · export payslip batch / signed-URL · variance report · report theo phòng ban · **khiếu nại phiếu lương (dispute/resolve)** · multi-currency · chu kỳ trả ngoài tháng · loại lương giờ/khoán · workflow duyệt nhiều cấp · sửa/huỷ phiếu lương đã phát hành (xử lý bằng thưởng/phạt kỳ SAU).

---

## 5. Endpoint tổng hợp PAYROLL (SPEC-11 §15)

Prefix: `/api/v1`

```http
GET    /api/v1/payroll-periods
POST   /api/v1/payroll-periods
GET    /api/v1/payroll-periods/summary
GET    /api/v1/payroll-periods/{payroll_period_id}
PATCH  /api/v1/payroll-periods/{payroll_period_id}
POST   /api/v1/payroll-periods/{payroll_period_id}/collect
GET    /api/v1/payroll-periods/{payroll_period_id}/readiness
POST   /api/v1/payroll-periods/{payroll_period_id}/calculate
GET    /api/v1/payroll-periods/{payroll_period_id}/lines
PATCH  /api/v1/payroll-periods/{payroll_period_id}/lines/{line_id}
POST   /api/v1/payroll-periods/{payroll_period_id}/submit
POST   /api/v1/payroll-periods/{payroll_period_id}/approve
POST   /api/v1/payroll-periods/{payroll_period_id}/reject
POST   /api/v1/payroll-periods/{payroll_period_id}/generate-payslips
POST   /api/v1/payroll-periods/{payroll_period_id}/publish
POST   /api/v1/payroll-periods/{payroll_period_id}/lock
POST   /api/v1/payroll-periods/{payroll_period_id}/reopen
GET    /api/v1/payroll-periods/{payroll_period_id}/export

GET    /api/v1/salary-profiles
POST   /api/v1/salary-profiles
GET    /api/v1/salary-profiles/{salary_profile_id}
PATCH  /api/v1/salary-profiles/{salary_profile_id}

GET    /api/v1/bonus-penalties
POST   /api/v1/bonus-penalties
GET    /api/v1/bonus-penalties/{bonus_penalty_id}
PATCH  /api/v1/bonus-penalties/{bonus_penalty_id}
POST   /api/v1/bonus-penalties/{bonus_penalty_id}/approve
POST   /api/v1/bonus-penalties/{bonus_penalty_id}/reject

GET    /api/v1/payslips
GET    /api/v1/payslips/{payslip_id}

GET    /api/v1/me/payslips
GET    /api/v1/me/payslips/{payslip_id}
POST   /api/v1/me/payslips/{payslip_id}/acknowledge

GET    /api/v1/payroll/pickers/people
GET    /api/v1/payroll/pickers/attendance-periods
```

> **35 mã PAYROLL-API = 35 route HTTP** (không mã nào gói 2 route). Route-census đếm route — WO BE regen census với 35, khai `API_MODULE_TAGS` cho `PAYROLL`.
>
> ⚠️ **Route-census KHÔNG phải cổng duy nhất.** `apps/api/test/foundation/route-http-coverage.e2e-spec.ts` đặt `MAX_UNCOVERED_TOTAL = 0` và `MIN_COVERED_COUNT` là **SÀN**; từ khoá `salary`/`payslip` xếp nhóm PAYROLL vào rủi ro cao ⇒ **mỗi route mới phải có file test chạm đúng literal path**, và phải **siết `MIN_COVERED_COUNT` cùng commit** với WO BE.
>
> ⚠️ **`GET /payroll-periods/summary` PHẢI khai TRƯỚC `GET /payroll-periods/{id}`** — nếu không, `summary` bị nuốt thành `:id` rồi trả 400 «không phải UUID» (bài học `goals/tree`). Ba route dưới `{id}` (`readiness`, `lines`, `export`) không có rủi ro này.
>
> Hai picker nằm dưới basePath `payroll/pickers` trong khi 33 route kia phẳng — controller riêng (`PayrollPickersController`) vẫn khai chung `API_MODULE_TAGS` nhóm `PAYROLL` để OpenAPI + route-census gom đúng module (khuôn `RecruitPickersController`). **Cả hai picker là BẮT BUỘC, không phải tiện nghi**: `payroll-officer` giữ **0 cặp ngoài PAYROLL** ⇒ không gọi được `GET /attendance/periods` (`('read','attendance')`) lẫn API-03 HR — thiếu picker thì `PAYROLL-API-002/004` và màn thưởng/phạt **không dùng được** (đúng lớp lỗi RECRUIT B4).

### 5.1 Bảng endpoint (stub — chi tiết DTO ở WO backend)

Bảng mã ↔ method/path ↔ cặp quyền ↔ audit/NOTI: xem **SPEC-11 §15** (nguồn sự thật, không nhân bản để tránh drift). Điểm buộc phải giữ khi hiện thực:

| Chủ đề | Ràng buộc |
| --- | --- |
| **Masking tiền** | Mọi trường tiền (`baseSalary`, `allowances`, `gross`, `net`, `deduction*`, `bonus*`, `penalty*`, `amount`) **chỉ có mặt** khi caller giữ cặp tương ứng — **vắng khoá**, không `null`, không `0`; FE schema `.optional()`. DTO danh sách kỳ (`view:payroll-period`, không nhạy cảm) **không chở số tiền nào, kể cả tổng** (SPEC-11 §18) |
| **Đọc dòng bảng lương** | `GET /payroll-periods/{id}/lines` · `summary` (018) · export (vế đọc) · widget DASH đều gác bằng **`('view-line','payroll-period')`** — **cặp ĐỌC thuần, TÁCH khỏi cặp ghi `calculate`**. Không dùng `('view','payroll-period')` (cố ý `is_sensitive=false`, không được chở tiền) và không dùng `calculate` (người chỉ có `approve` sẽ duyệt mù; ai thấy widget đều ghi được lương). `summary`/widget thêm **SÀN scope `Company`** |
| **Export** | assert **cả hai cặp** `('export','payroll')` **+** `('view-line','payroll-period')`; > 10.000 dòng ⇒ **422 PAYROLL-ERR-016**; audit một hàng, payload **không có số tiền** (SPEC-11 §18) |
| **Audit lượt ĐỌC** | **7 đường** đọc lương của người khác ghi `audit_logs` **trong cùng transaction** với lượt đọc (khuôn reveal+audit atomic của `hr-read.service`; rollback ⇒ 0 audit): `lines` · `summary` · `export` · `GET /payslips` · `GET /payslips/{id}` · `GET /salary-profiles` · `GET /salary-profiles/{id}`. **`/me/payslips*` KHÔNG ghi** — tự xem lương của mình không phải sự kiện an ninh |
| **FSM kỳ** | 7 trạng thái ép ở service qua **một hàm** `assertPeriodTransition` (SPEC-11 §13.1); vi phạm → **409 PAYROLL-ERR-001**. **MỌI hành động đổi trạng thái mở tx bắt đầu bằng `SELECT … FROM payroll_periods … FOR UPDATE`** — không chỉ `calculate`. `reopen`/`publish` đọc cờ **`payslips_generated_at`** trên chính hàng kỳ (KHÔNG đếm bảng `payslips`). Hai hành động chạy **tại chỗ**: `calculate` lại ở `Calculated`, `generate-payslips` ở `Approved`. `Locked` là terminal tuyệt đối |
| **Reset vết duyệt** | `reject` xoá `submitted_*`; **`reopen` xoá `calculated_*` + `submitted_*` + `approved_*`** (bảng RESET SPEC-11 §13.1). Không reset ⇒ `approve → reopen → cùng người submit lại` vi phạm CHECK four-eyes ⇒ `23514` = **500**. Service **phải map `23514`**: four-eyes → 409 **PAYROLL-ERR-005**, adjustment-check → 400 `VALIDATION-ERR-001` |
| **Four-eyes** | `('approve','payroll-period')` **không grant** cho `payroll-officer` (tầng quyền) **và** service so `submitted_by ≠ approved_by` ⇒ **409 PAYROLL-ERR-005** (tầng logic) **và** CHECK `payroll_periods_four_eyes_check` ở DB (chốt cuối). Ba tầng, không bỏ tầng nào. **`submit` kiểm trước có người duyệt hợp lệ khác actor** ⇒ **422 PAYROLL-ERR-017** — công ty một-người-duyệt không kẹt vĩnh viễn ở `Reviewing` |
| **Tiền tính ở SQL** | pro-rate · cộng/trừ · làm tròn · `GREATEST(gross − deduction, 0)` làm **trong câu lệnh SQL** set-based cho cả kỳ; **cấm số thực JS**, cấm vòng lặp per-người (`clamp-must-be-sql-not-js`) |
| **Snapshot đóng băng** | `calculate` ghi `input_snapshot_json`; `generate-payslips` copy đóng băng sang `payslips`. Đổi ATT/LEAVE/hồ sơ lương sau đó **không** làm đổi số đã tính |
| **Chốt cuối DB** | race `generate-payslips`/tạo kỳ/xác nhận/tạo phiên bản lương → bóc `23505` từ `error.cause` (drizzle bọc) → **006/008/015/014**, **không 500** |
| **Own-scope phiếu lương** | `/me/payslips*` lọc `payslips.user_id` = user của caller **và** kỳ ∈ `Paid`/`Locked` (§13.2 — phiếu `Generated` chưa phát hành thì nhân viên không thấy); phiếu người khác → **404 PAYROLL-ERR-010** (không 403); caller không có phiếu → danh sách **rỗng**, không lỗi |
| **Trạng thái phiếu là DẪN XUẤT** | `Generated`/`Published`/`Acknowledged` server tính trong DTO từ `payroll_periods.status` + sự tồn tại hàng ack — **không có cột**, không có CHECK (SPEC-11 §13.2) |
| **Idempotency** | `@Idempotent()` trên POST tạo (002/020/024) và hành động nặng (007 `calculate`, 013 `generate-payslips`); key **do client sinh** khi mở form / bấm nút; TTL 15′; replay + `Idempotency-Replayed: true`. Chống trùng **nghiệp vụ** là việc của UNIQUE ở DB |
| **Nối ATT** | `calculate` đòi `attendance_periods` của tháng đó `locked` ⇒ **409 PAYROLL-ERR-002**. **PAYROLL KHÔNG dựng cổng khoá ngược** — kỳ công đã bất biến từ lúc `locked` (trigger `0064` chặn `locked → open`), và **không viện dẫn `ATT-ERR-024`**: mã đó không tồn tại trong `apps/api/**` và SPEC-04 vs API-04 đang mô tả nó khác nhau (SPEC-11 §3.5, §23 mục 12) |
| **Picker** | `PAYROLL-API-034` (nhân sự) đi qua `PayrollPeopleRepository` — điểm chiếu danh tính DUY NHẤT, trường bó hẹp `{ userId, fullName, employeeCode?, orgUnitName? }` (SPEC-11 §18). `PAYROLL-API-035` (kỳ công) trả `{ id, periodMonth, status }`, gác `('manage','payroll-period')` |
| **Object-permission** | `view-own-payslip` / `acknowledge-own-payslip` khai **`objectGrantRequired = false`** tường minh (chốt của `0180`) — để mặc định thì nhân viên có company-grant vẫn **403 trên phiếu của chính mình** |
| **Tính lại giữ điều chỉnh tay** | `calculate` lại **UPSERT** dòng nháp và **GIỮ `adjustment_amount`/`adjustment_reason`**; dòng của nhân sự không còn đủ điều kiện thì xoá mềm. Xoá trắng là mất tiền người dùng nhập, im lặng (SPEC-11 §13.4) |
| **UUID biên** | mọi `{id}` qua pipe cấp method (không `@UsePipes` cấp class — `nestjs-zod-class-level-pipe-does-nothing`); ratchet param-uuid không tăng |
| **Hai tầng guard** | cặp quyền khai ở decorator route **và** service; census QA so **từng route theo MÃ cặp** ở cả hai tầng (bài học ASSET coverage 97.5% vẫn lọt) |
| **2FA** | role `payroll-officer` có `requires_two_factor = true` ⇒ mọi automation/script chạy bằng tài khoản mang role này **phải đi bước-2** (`prod-2fa-blocks-headless-automation`) |

### 5.2 Trạng thái hiện thực (đối chiếu code)

| Mã | Trạng thái | Ghi chú |
| --- | --- | --- |
| PAYROLL-API-001..006 · 019..028 · 034..035 | ✅ **Đã hiện thực** | `S13-PAYROLL-BE-1` (#456) — nền: hồ sơ lương · thưởng/phạt · FSM kỳ · gom đầu vào công/phép |
| PAYROLL-API-007..018 · 029..033 | ✅ **Đã hiện thực** | `S13-PAYROLL-BE-2` — máy tính lương (set-based SQL) · duyệt four-eyes · phiếu lương + breakdown · export XLSX · NOTI 020–023. **35/35 route** đã lên dây; census 2 tầng phủ đủ (`PAYROLL_PENDING_BE2` rỗng) |

> Lệch giữa thiết kế và code ⇒ **sửa code**, không sửa ngầm tài liệu (CLAUDE.md — docs/spec + docs/DB là chuẩn).

---

## 6. Chuẩn response, lỗi, pagination, idempotency (theo API-01)

### 6.1 Envelope thành công — chi tiết kỳ lương (caller CHỈ có `('view','payroll-period')`)

```json
{
  "success": true,
  "message": "Lấy dữ liệu thành công",
  "data": {
    "id": "…",
    "periodMonth": "2026-09",
    "payDate": "2026-10-05",
    "status": "Reviewing",
    "attendancePeriod": { "id": "…", "periodMonth": "2026-09", "status": "locked" },
    "headcount": 42,
    "trail": {
      "createdBy": { "id": "…", "fullName": "Nguyễn Văn A" },
      "calculatedAt": "2026-10-01T02:10:00+07:00",
      "submittedBy": { "id": "…", "fullName": "Nguyễn Văn A" },
      "submittedAt": "2026-10-01T02:12:00+07:00",
      "approvedBy": null, "approvedAt": null,
      "publishedAt": null, "lockedAt": null
    }
  },
  "meta": { "request_id": "req_…", "timestamp": "2026-10-01T09:00:00+07:00" }
}
```

> **Không có khoá tiền nào** trong DTO này — kể cả `totalGross`. Tổng đi qua `GET /payroll-periods/summary` (gác bằng cặp ĐỌC nhạy cảm **`('view-line','payroll-period')`**).
>
> Cùng nguyên tắc, **ba route GHI `collect` (005) · `calculate` (007) · `adjust-line` (009) cũng KHÔNG chở khoá tiền nào** — trả `{ id, status, affectedLines, warnings[] }`; FE tải số qua `GET …/lines`. Để chúng trả `gross`/`net` là mở đường đọc tiền cho role chỉ có `calculate` mà không `view-line` (SPEC-11 §11.1).

### 6.2 Envelope list + pagination

Chuẩn API-01 (`data[]` + `pagination { page, per_page, total, total_pages, has_next, has_prev }`) cho `GET /payroll-periods` · `/payroll-periods/{id}/lines` · `/salary-profiles` · `/bonus-penalties` · `/payslips` · `/me/payslips`.

### 6.3 Chi phí lương kỳ (`GET /payroll-periods/summary`) — nguồn widget DASH

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "periodMonth": "2026-09",
    "status": "Paid",
    "headcount": 42,
    "totalGross": 512400000,
    "totalNet": 486180000
  },
  "meta": { "request_id": "req_…", "timestamp": "…" }
}
```

> Cặp gác `('view-line','payroll-period')` **+ SÀN scope `Company`** (`DASH_WIDGET_MIN_DATA_SCOPE`) — payload CHỨA SỐ TIỀN và cộng toàn công ty, nên grant hẹp hơn `Company` **không được serve** (`dash-widget-gate-needs-scope-floor`).
>
> ⚠️ **ĐẢO QUYẾT ĐỊNH 01/09/2026 (S13-PAYROLL-BE-2), thay cho ghi chú «số tiền trả về dạng chuỗi» ở bản trước.** `totalGross`/`totalNet` là **`number`**, không phải chuỗi. Lý do: cả module (dòng bảng lương · phiếu lương · `payslip_items`) đã trả `number`; riêng `summary` trả chuỗi thì FE phải mang **hai** cách đọc tiền trong cùng một màn. Rủi ro mất chính xác không tồn tại ở thang này: tổng VND một kỳ (~10¹²) còn cách `Number.MAX_SAFE_INTEGER` (~9×10¹⁵) bốn bậc. Lúc đảo chưa có consumer nào parse chuỗi (`S13-PAYROLL-FE-1` còn `todo`).
>
> Công ty **chưa có kỳ lương nào** ⇒ **200** với `data: null`, KHÔNG 404: widget DASH phải phân biệt được «chưa có kỳ» với «không có quyền».

### 6.4 Cảnh báo dữ liệu thiếu (`GET /payroll-periods/{id}/readiness`)

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "eligibleCount": 40,
    "warnings": [
      { "userId": "…", "fullName": "Trần Thị B", "kind": "missing-salary-profile" },
      { "userId": "…", "fullName": "Lê Văn C",  "kind": "missing-attendance" }
    ]
  },
  "meta": { "request_id": "req_…", "timestamp": "…" }
}
```

> Cảnh báo là **mềm** — không chặn `calculate` (PAYROLL-FUNC-005). Chỉ khi `eligibleCount = 0` thì `calculate` trả **422 PAYROLL-ERR-009**.

### 6.5 Envelope lỗi + mã lỗi

Namespace `PAYROLL-ERR-001..017` — định nghĩa đầy đủ ở SPEC-11 §12. `error.details` là **mảng** `ErrorDetail {field, message, rule}`; `details.kind` = phần tử `field:"kind"`. Vế hình thức (thiếu `reason`, `amount ≤ 0`, `periodMonth` sai định dạng, khoá lạ `.strict()`, `{id}` không UUID) chặn ở Zod ⇒ **400 `VALIDATION-ERR-001`**.

Ánh xạ HTTP:

| HTTP | Dùng cho |
| --- | --- |
| `400` | Body/param sai định dạng (`VALIDATION-ERR-001`) |
| `403` | Thiếu cặp quyền (`AUTH-ERR-FORBIDDEN`) — gồm cả officer gọi `approve` và `hr-manager` gọi mọi route PAYROLL sau thu hồi |
| `404` | PAYROLL-ERR-010 (sentinel not-found / ngoài scope — **một phản hồi duy nhất**, không 403) |
| `409` | PAYROLL-ERR-001..008 · 011 · 012 · 013 · 014 · 015 · mã idempotency chung `REQUEST-ERR-IDEMPOTENCY-*` |
| `422` | PAYROLL-ERR-009 (không có nhân sự đủ điều kiện) · 016 (export vượt trần 10.000 dòng) · **017 (không có người duyệt hợp lệ — chặn ở `submit`)** |

```json
{
  "success": false,
  "message": "Người duyệt phải khác người gửi duyệt",
  "error": {
    "code": "PAYROLL-ERR-005",
    "type": "ConflictException",
    "details": [
      { "field": "kind", "message": "same-actor-approval", "rule": "payroll-four-eyes" },
      { "field": "submittedBy", "message": "…", "rule": "payroll-four-eyes" }
    ]
  },
  "meta": { "request_id": "req_…", "timestamp": "…" }
}
```

> Thông điệp lỗi **không bao giờ chứa số tiền** — kể cả trong `details`.

### 6.6 Idempotency

`POST /payroll-periods` · `POST /salary-profiles` · `POST /bonus-penalties` · `POST /payroll-periods/{id}/calculate` · `POST /payroll-periods/{id}/generate-payslips` gắn `@Idempotent()` (interceptor dùng chung, BACKEND-12 §14.1): key **client sinh khi mở form / bấm nút**, khoá scope `company_id + user_id + method + path + key`, TTL 15′ (`IDEMPOTENCY_TTL_SEC = 900`), header không bắt buộc ở interceptor (back-compat), replay phát lại envelope nguyên trạng + `Idempotency-Replayed: true`. FE PAYROLL **luôn** gửi header.

Chống trùng **nghiệp vụ** là việc của UNIQUE ở DB, không phải idempotency: kỳ trùng tháng (`payroll_periods_company_month_uq` → 008) · phiếu sinh hai lần (`payslips_period_user_uq` → 006) · phiên bản lương trùng ngày (`salary_profiles_company_user_effective_uq` → 014) · xác nhận hai lần (`payslip_acknowledgements_payslip_user_uq` → 015). **Server KHÔNG tự suy khoá idempotency từ payload** (`period-key-idempotency-needs-frozen-source`).

---

## 7. Dữ liệu PAYROLL (SPEC-11 §16, DB-13)

- PAYROLL **không tạo lại**: `users`, `employee_profiles`, `attendance_periods`/`attendance_records`, `leave_requests`/`leave_types`, `companies.payroll_config_json`, `audit_logs`, `notification_*`.
- Bảng canonical do PAYROLL sở hữu: `salary_profiles` · `payroll_periods` · **`payroll_period_lines` (MỚI)** · `payslips` · `payslip_items` · `bonus_penalties` · `payslip_acknowledgements`. RLS+FORCE mọi bảng; **`payslips`/`payslip_items`/`payslip_acknowledgements` append-only**; không bảng nào có DELETE cho app role. Chi tiết cột + **bản đồ reconcile 6 bảng di sản**: DB-13 §5/§6; index: DB-09 §8.19; seed + thu hồi quyền: DB-10.

---

## 8. Trạng thái tài liệu & việc còn nợ

| Hạng mục | Trạng thái |
| --- | --- |
| Tên file + prefix + danh sách endpoint §5 + cặp quyền | ✅ Khoá ở stub này |
| Nguyên tắc bắt buộc (FSM/four-eyes/chốt-cuối/masking/audit-lượt-đọc/idempotency) | ✅ Ghi rõ (§5.1) |
| Cross-link SPEC-11 / DB-13 / DB-09 / DB-10 / §9g / API-01 / API-04 | ✅ |
| DTO request/response chi tiết + **viết lại** `packages/contracts/src/payroll.ts` | ⏳ `S13-PAYROLL-DB-1` (enum/mirror CHECK) → `BE-1`/`BE-2` (DTO đầy đủ) |
| Đối chiếu endpoint đã ship vs thiết kế (§5.2) | ⏳ cập nhật khi `S13-PAYROLL-BE-2` đóng |
| OpenAPI/Swagger nhóm PAYROLL (`API_MODULE_TAGS`) | ⏳ `S13-PAYROLL-BE-1` |
| Flip Stub → Approved | ✅ owner duyệt gói wave 31/08/2026 (đồng bộ SPEC-11 §1 + DB-13 §1) |

---

## 9. Liên quan

- **Đặc tả nghiệp vụ (nguồn sự thật):** [SPEC-11 PAYROLL](<../SPEC/SPEC-11 PAYROLL.md>) — §11 permission (+ §11.2 bản đồ 19 cặp di sản), §12 mã lỗi, §13 FSM/máy tính lương/scope, §15 API, §17 sự kiện, §18 audit/masking, §22 quyết định.
- **Chuẩn API:** [API-01 Tổng quan](<API-01 TỔNG QUAN.md>).
- **Thiết kế DB:** [DB-13 PAYROLL Database Design](<../DB/DB-13 PAYROLL Database Design.md>) (§5 bản đồ reconcile) · [DB-09 §8.19](<../DB/DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 seed PAYROLL](<../DB/DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>).
- **Phân quyền:** [Ma trận phân quyền §9g](<../permission-matrix-spec.md>).
- **Module nối:** [API-04 ATT](<API-04_ATT_API_Design.md>) (kỳ công `locked` là điều kiện của `calculate`) · [API-05 LEAVE](<API-05_LEAVE_API_Design.md>) (`leave_types.paid`) · [API-07 NOTI](<API-07_NOTI_API_Design.md>) · [API-08 DASH](<API-08_DASH_API_Design.md>) · [API-11 ME](<API-11_ME_API_Design.md>).
- **Chỉ mục:** [README §4](<../README.md>).
