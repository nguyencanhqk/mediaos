# SPEC-12: RECRUIT — TUYỂN DỤNG (VỊ TRÍ · ỨNG VIÊN · PIPELINE · PHỎNG VẤN · OFFER · CONVERT)

> **📚 Bộ tài liệu SPEC — Hệ thống Quản lý Doanh nghiệp**
> [SPEC-01 Tổng quan](<SPEC-01 Tổng quan.md>) · [SPEC-02 AUTH](<SPEC-02 AUTH.md>) · [SPEC-03 HR](<SPEC-03 HR.md>) · [SPEC-04 ATT](<SPEC-04 ATT.md>) · [SPEC-05 LEAVE](<SPEC-05 LEAVE.md>) · [SPEC-06 TASK](<SPEC-06 TASK.md>) · [SPEC-07 DASH](<SPEC-07 DASH.md>) · [SPEC-08 NOTI](<SPEC-08 NOTI.md>) · [SPEC-09 ME](<SPEC-09 ME.md>) · [SPEC-10 GOAL](<SPEC-10 GOAL.md>) · **SPEC-12 RECRUIT** · [SPEC-13 ASSET](<SPEC-13 ASSET.md>) · [SPEC-14 ROOM](<SPEC-14 ROOM.md>) · [SPEC-15 CHAT](<SPEC-15 CHAT.md>)
>
> **Liên quan:** [Chỉ mục tài liệu](<../README.md>) · [DB-14 RECRUIT Database Design](<../DB/DB-14 RECRUIT Database Design.md>) · [Thiết kế API: API-17 RECRUIT](<../API Design/API-17_RECRUIT_API_Design.md>) · [Ma trận phân quyền §9f](<../permission-matrix-spec.md>) · [HR nền: SPEC-03](<SPEC-03 HR.md>) · [NOTI nền: SPEC-08](<SPEC-08 NOTI.md>) · [Kế hoạch wave: S12-RECRUIT](<../plans/S12-RECRUIT-WAVE.md>)
>
> **Đánh số (REC-DEC-001):** RECRUIT giữ đúng số **SPEC-12** đã khoá tại [SPEC-01 §7.2/§8](<SPEC-01 Tổng quan.md>). Tài liệu DB lấy **DB-14** (đúng chỗ IMPLEMENTATION-10 §13.2 giữ — OFFICE-DEC-001 đã tôn trọng khi ASSET/ROOM nhảy DB-15/16). Tài liệu API lấy **API-17** vì **API-16 đã bị «PERMISSION AUDIT REPORT» chiếm** (API-14/15 = ASSET/ROOM).

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | SPEC-12 |
| Tên tài liệu | RECRUIT - Tuyển dụng |
| Module code | RECRUIT |
| Tài liệu cha | SPEC-01: Tổng quan hệ thống (§12.9) |
| Module phụ thuộc trực tiếp | AUTH (RBAC), HR (org_units/positions/employees + SequenceService mã nhân viên), FOUNDATION (audit · files · file_access_logs) |
| Module liên quan | NOTI (gán phụ trách · lịch phỏng vấn · đổi stage · convert), DASH (widget «phễu tuyển dụng») |
| Phiên bản | v1.0 |
| Trạng thái | **Approved** — owner duyệt nguyên gói hồ sơ wave S12-RECRUIT ngày **31/08/2026**, ký REC-DEC-001..008 (§22) |
| Giai đoạn | **Phase 2 «HR nâng cao» · wave S12-RECRUIT** — hậu go-live |
| Ngày tạo | 31/08/2026 |
| Ngày cập nhật | 31/08/2026 |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả module **RECRUIT — Tuyển dụng**: nơi công ty quản lý từ **vị trí cần tuyển** → **hồ sơ ứng viên** → **pipeline 6 stage** → **lịch phỏng vấn + đánh giá** → **offer** → **chuyển ứng viên trúng tuyển thành nhân viên HR** trong một bước.

RECRUIT trả lời các câu hỏi:

```text
Công ty đang mở những vị trí nào, phòng ban nào, ai phụ trách, đã có bao nhiêu ứng viên?
Ứng viên A đang ở stage nào, đã qua những vòng gì, ai đánh giá thế nào?
Có ứng viên nào trùng email/phone với hồ sơ đã từng nộp không?
Lịch phỏng vấn tuần này của tôi (interviewer) là những lượt nào?
Offer của ứng viên B đã gửi chưa, kết quả ra sao, lương đề nghị bao nhiêu (nếu tôi có quyền)?
Ứng viên trúng tuyển đã được tạo hồ sơ nhân viên chưa, mã nhân viên là gì?
```

RECRUIT **không sở hữu** dữ liệu của module khác: nhân sự thuộc HR (convert chỉ **tạo qua service HR** rồi giữ link `candidates.employee_id`), tài khoản thuộc AUTH (**không** tự tạo user — REC-DEC-005), tệp CV thuộc FOUNDATION Files. RECRUIT chỉ sở hữu **vị trí tuyển · ứng viên · lịch sử stage · ghi chú · lượt phỏng vấn (+người tham gia) · feedback · offer**.

**Ứng viên là người NGOÀI hệ thống** — không có tài khoản, không FK sang `users`; mọi danh tính nội bộ (recruiter, interviewer, người thao tác) mới trỏ `users`/`employees`.

---

## 3. Định nghĩa và nguyên tắc kiến trúc

### 3.1 Pipeline cố định 6 stage — REC-DEC-002

```text
ứng viên      : New · Screening · Interview · Offer · Hired · Rejected
vị trí tuyển  : Draft · Open · Paused · Closed
lượt phỏng vấn: Scheduled · Completed · Cancelled
offer         : Draft · Sent · Accepted · Declined · Withdrawn
```

Bốn bộ giá trị này được **hợp thức tại SPEC-01 §17.11–17.14** (luật §17.7: module không tự thêm trạng thái). Chuyển tiếp hợp lệ ở §13.1–13.4; **service ép FSM**, DB chỉ CHECK tập giá trị (`check-cannot-enforce-fsm-transitions`). Custom stage per-company = Phase sau.

### 3.2 Stage hiện tại là cột, lịch sử là sổ append-only

`candidates.stage` giữ stage **hiện tại**; mỗi lần chuyển ghi thêm **một hàng `candidate_stage_events`** (from → to · lý do · người thao tác) trong **cùng transaction**. Sổ này **append-only** (app role không có UPDATE/DELETE — bất biến #2); timeline ở màn chi tiết ứng viên đọc từ đây.

### 3.3 PII ứng viên được bảo vệ ở SERVER — REC-DEC-003

Cả 7 cặp quyền resource `candidate` mang **`is_sensitive = true`**. Email/phone trả về ở **dạng che** (`d***@***.com` · `09** *** *45`) cho người chỉ có quyền đọc; **bản đầy đủ chỉ trả cho người giữ `('update','candidate')`**. CV lưu Foundation Files **private**, tải về ghi `file_access_logs`; export danh sách cần cặp `('export','candidate')` riêng + audit. Masking là việc của server — client không nhận được thì không render được.

### 3.4 Offer không có workflow duyệt; lương offer mask theo quyền — REC-DEC-004

Offer là FSM phẳng `Draft → Sent → Accepted / Declined / Withdrawn`, recruiter tự cập nhật kết quả (không dựng FSM phê duyệt crown ở v1). Trường **`salary` chỉ trả cho người giữ `('manage','offer')`**; `('view','offer')` nhận DTO **vắng khoá** `salary` (FE schema `.optional()`).

### 3.5 Convert MỘT bước, chốt cuối ở DB — REC-DEC-005

`POST /candidates/:id/convert` (cặp `('convert','candidate')`) chỉ chạy khi ứng viên **chưa có link nhân viên**, đang ở **stage `Offer`** và có offer **Accepted** (thứ tự kiểm + mã lỗi: §13.5). Trong **một transaction**: tạo `employee_profiles` qua **API nội bộ tx-aware MỚI của HR** `createEmployeeFromCandidateTx` (§13.5 — KHÔNG gọi `createEmployee` hiện có; mã nhân viên từ SequenceService `employee_code` **ensure-on-miss**, không hard-code prefix) → ghi `candidates.employee_id` (**UNIQUE** — chốt cuối chống double-convert khi 2 request song song) → chuyển stage `Offer → Hired` (ghi stage event) → NOTI + audit. **Không tạo tài khoản đăng nhập** — HR tạo qua luồng AUTH hiện có.

### 3.6 Phỏng vấn: địa điểm tự do, own-scope theo NGƯỜI THAM GIA — REC-DEC-006

Địa điểm/link là **text tự do** (không buộc booking ROOM, không tích hợp calendar ngoài — Phase sau). Interviewer là nhân viên nội bộ (`interview_participants` FK `employees`), nhận NOTI khi được xếp lịch. **Own-scope của interview bám theo participant** (người ĐƯỢC XẾP), không theo người tạo; feedback **mỗi interviewer chỉ ghi/sửa của mình** (unique per (interview, interviewer)).

### 3.7 Không sao chép dữ liệu nguồn

Tên phòng ban/vị trí/recruiter luôn **JOIN** từ HR/AUTH lúc đọc, không denormalize. Duy nhất ảnh chụp có chủ đích là **stage event** (from/to tại thời điểm chuyển) — vì lịch sử phải cố định, không trôi theo hiện tại.

---

## 4. Mục tiêu module

### 4.1 Mục tiêu nghiệp vụ

- Một nguồn sự thật về tuyển dụng: **vị trí nào mở · ứng viên nào ở đâu trong phễu · ai đánh giá gì · offer ra sao**.
- Ứng viên trúng tuyển thành nhân viên HR **một bước**, không nhập tay lại, không trùng hồ sơ.
- PII ứng viên (email/phone/CV/lương offer) được che theo quyền, có dấu vết khi xem tệp/export.

### 4.2 Mục tiêu kỹ thuật

- Tái dùng tối đa hạ tầng: RBAC per-pair + data_scope, `withTenant` + RLS, SequenceService, audit, outbox NOTI, Foundation Files, `@Idempotent()`.
- FSM ép ở **service**, chốt cuối ở **DB** (UNIQUE/partial unique), chuyển tiếp sai trả **4xx đúng mã `RECRUIT-ERR`**, không 500.
- Mọi `:id` là UUID ở biên ngay từ đầu; guard cặp quyền ở **hai tầng** (decorator route + service).

---

## 5. Phạm vi module

### 5.1 Trong v1 (wave S12-RECRUIT — SPEC-01 §12.9, IMP-10 §10.2 P0/P1)

| # | Hạng mục | Story (wave §4) |
| --- | --- | --- |
| 1 | **Vị trí tuyển dụng**: CRUD · FSM Draft/Open/Paused/Closed · gán recruiter phụ trách (NOTI) · Closed chặn thêm ứng viên | RC-01 |
| 2 | **Hồ sơ ứng viên**: CRUD + nguồn (source) + **cảnh báo trùng email/phone** trong company (không chặn cứng) | RC-02 |
| 3 | **CV/tệp ứng viên** qua Foundation Files — private, tải về ghi `file_access_logs` | RC-03 |
| 4 | **Pipeline kanban** 6 stage cố định: chuyển stage kèm lý do, lịch sử append-only | RC-04 |
| 5 | **Lịch phỏng vấn**: vòng · khung giờ · địa điểm/link tự do · interviewer nội bộ + NOTI | RC-05 |
| 6 | **Feedback phỏng vấn**: rating + recommendation, own-scope per interviewer | RC-06 |
| 7 | **Offer**: tạo/gửi/ghi kết quả; lương mask theo quyền | RC-07 |
| 8 | **Convert** ứng viên trúng tuyển → nhân viên HR (1 bước, link 1-1) | RC-08 |
| 9 | **Masking PII + deny-path + audit** export/tải CV | RC-09 |
| 10 | Widget DASH **«phễu tuyển dụng»** | RC-10 |

### 5.2 Ngoài v1 (chừa thiết kế, KHÔNG làm đợt này)

- **Custom stage per-company** (REC-DEC-002) — bộ 6 stage là hằng.
- **Workflow duyệt offer nội bộ** (P2-REC-06-002 — REC-DEC-004).
- **Tự tạo tài khoản đăng nhập khi onboard** (P2-REC-07-004 — REC-DEC-005): HR tạo user qua AUTH.
- **Tích hợp calendar Google/Microsoft** (P2-REC-05-005) · **buộc đặt phòng ROOM** cho phỏng vấn (REC-DEC-006).
- **Auto-purge/retention ứng viên Rejected** (P2-REC-09-004 — REC-DEC-007): v1 soft-delete chuẩn §16.2, chưa auto-purge; policy = **PARK-RECRUIT-001** (RELEASE-14 §5). v1 **không có endpoint xoá** ứng viên/vị trí — hồ sơ nhập nhầm dùng `Rejected`/`Closed` kèm lý do.
- **Report source effectiveness** (P3) · import/export Excel ngoài export danh sách ứng viên CSV.

### 5.3 Nền sạch — không có bảng di sản

Đo ngày 31/08/2026: quét `candidates / vacanc / applicant / job_opening` toàn schema + migrations = **0 bảng** (chỉ 2 giá trị enum trong `finance.ts`/`media.ts` thuộc cụm đã park, không đụng). Wave này **tạo mới 8 bảng**, không ALTER/DROP bảng nào có sẵn. Hàng `modules` RECRUIT **đã pre-seed inactive** từ mig `0435` (sort_order 9) — seed lại là NO-OP; chỉ bật `is_active` ở WO FE (khuôn `0556`/`0557`).

---

## 6. Nhóm người dùng

| Nhóm | Vai trò trong RECRUIT |
| --- | --- |
| **Recruiter** (SPEC-01 §10.7 — role hệ thống **mới** `recruiter`, REC-DEC-008) | Toàn quyền nghiệp vụ tuyển dụng: vị trí · ứng viên · pipeline · phỏng vấn · offer · convert, phạm vi **Company** |
| Company Admin | Như Recruiter (phạm vi Company) |
| HR | **Xem** vị trí/ứng viên/phỏng vấn/offer toàn company (offer **không** thấy lương) + **convert** ứng viên trúng tuyển + ghi feedback lượt mình tham gia |
| Hiring manager (role `manager` hiện có) | **Xem lượt phỏng vấn mình được xếp** (Own) + ghi feedback lượt của mình — **KHÔNG** phải role mới (REC-DEC-008) |
| Nhân viên (employee) | **Không grant** — RECRUIT không có mặt «của tôi» ở v1. Nhân viên thường muốn làm interviewer phải được cấp role có quyền interview (manager/hr/recruiter) |
| Super Admin | Nhận mọi cặp qua `SuperAdminBootstrapService` — **không** phải chủ thể để test (tautology) |

---

## 7. Mối liên kết với các module khác

| Module | RECRUIT đọc / gọi | Module kia đọc RECRUIT |
| --- | --- | --- |
| HR (SPEC-03) | `org_units`/`positions` (vị trí tuyển trỏ về); `employees` (interviewer, chỉ nhân viên `active`); service tạo nhân viên + SequenceService `employee_code` (convert) | Hồ sơ nhân viên tạo từ convert giữ được vết ngược qua `candidates.employee_id` |
| AUTH (SPEC-02) | RBAC per-pair + data_scope; `users` cho recruiter phụ trách + `*_by` | — |
| FOUNDATION | `audit_logs`, Files (`file_links` `entity_type='candidate'`, private) + `file_access_logs` khi tải CV | — |
| NOTI (SPEC-08) | Outbox bridge: `RECRUIT_JOB_ASSIGNED` · `RECRUIT_INTERVIEW_SCHEDULED` · `RECRUIT_STAGE_CHANGED` · `RECRUIT_CANDIDATE_HIRED` (§17) | — |
| DASH (SPEC-07) | — | Widget «phễu tuyển dụng» đọc `GET /candidates/summary` theo quyền (§15) |

---

## 8. Cấu trúc thông tin

Chi tiết cột/kiểu/constraint: [DB-14](<../DB/DB-14 RECRUIT Database Design.md>). Tám bảng, tất cả có `company_id` + RLS FORCE + composite tenant FK:

**Vị trí tuyển dụng (`job_openings`)**

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Định danh | `title`, `description` | |
| Tổ chức | `org_unit_id`, `position_id` | FK HR (position tuỳ chọn) |
| Tuyển | `headcount`, `recruiter_user_id` | recruiter phụ trách (FK `users`, nullable) — gán/đổi bắn NOTI-EVENT-016 |
| Trạng thái | `status` | `Draft` / `Open` / `Paused` / `Closed` (SPEC-01 §17.12); FSM §13.2 |
| Vòng đời | `deleted_at` | soft delete chuẩn — v1 không có endpoint xoá (§5.2) |

**Ứng viên (`candidates`)**

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Hồ sơ | `full_name`, `email`, `phone`, `source`, `note` | email/phone **mask ở server** (§18); `source` text tự do (TopCV, giới thiệu…) |
| Neo | `job_opening_id` | composite FK; vị trí `Closed` chặn thêm/chuyển vào (RECRUIT-ERR-005) |
| Pipeline | `stage` | 6 giá trị §3.1 (SPEC-01 §17.11), default `New`; lịch sử ở sổ stage events |
| Link HR | `employee_id` | nullable, **UNIQUE theo company khi NOT NULL** — chốt cuối chống double-convert (§3.5); composite FK → `employees` |
| Vòng đời | `deleted_at` | soft delete (REC-DEC-007); v1 không có endpoint xoá |

**Lịch sử stage (`candidate_stage_events`)** — sổ **append-only**, không UPDATE/DELETE

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Neo | `candidate_id` | composite FK |
| Chuyển | `from_stage`, `to_stage`, `reason`, `acted_by`, `acted_at` | `reason` bắt buộc; `acted_by` FK `users` |
| Nguồn | `action` | `move` / `convert` — convert ghi hàng `Offer → Hired` với action `convert` |

**Ghi chú (`candidate_notes`)**

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Nội dung | `candidate_id`, `body`, `created_by` | người tạo sửa/xoá mềm ghi chú **của mình** |

**Lượt phỏng vấn (`interviews`)** + **người tham gia (`interview_participants`)**

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Lượt | `candidate_id`, `round`, `starts_at`, `ends_at`, `location`, `note`, `status` | `location` = text/link tự do (§3.6); `status` `Scheduled`/`Completed`/`Cancelled` (SPEC-01 §17.13) |
| Người tham gia | `interview_id`, `employee_id` | chỉ INSERT — cố định lúc xếp lịch; đổi người ⇒ huỷ lượt + tạo lượt mới; chân NOTI-EVENT-017 + own-scope + feedback |

**Feedback (`interview_feedbacks`)**

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Đánh giá | `interview_id`, `interviewer_employee_id`, `rating`, `comment`, `recommendation` | unique per (interview, interviewer); `rating` 1–5; `recommendation` ∈ `Hire` / `No Hire` / `Consider`; own-scope ghi/sửa |

**Offer (`offers`)**

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Nội dung | `candidate_id`, `title`, `start_date`, `salary`, `note` | `salary` **chỉ trả cho `('manage','offer')`** (§18) |
| Trạng thái | `status`, `responded_at` | `Draft`/`Sent`/`Accepted`/`Declined`/`Withdrawn` (SPEC-01 §17.14); FSM §13.3; **partial unique 1 offer đang sống (Draft/Sent)/ứng viên** |

---

## 9. Danh sách màn hình

| Mã | Màn hình | Ghi chú |
| --- | --- | --- |
| REC-SCREEN-001 | Danh sách vị trí tuyển dụng (`/recruit/job-openings`) | Bảng + lọc phòng ban/trạng thái/tìm kiếm; chip trạng thái; đếm ứng viên theo vị trí; nút «+ Vị trí tuyển» + gán recruiter theo quyền |
| REC-SCREEN-002 | Kanban pipeline (`/recruit/pipeline`) | 6 cột stage cố định (Hired/Rejected thu gọn); kéo-thả = move-stage **kèm hộp lý do**; lọc theo vị trí; card hiện nguồn + việc kế tiếp |
| REC-SCREEN-003 | Chi tiết ứng viên (`/recruit/candidates/:id`) | 4 tab: **Hồ sơ** (email/phone mask theo quyền) ‖ **Timeline** (stage events + ghi chú) ‖ **Phỏng vấn** (lượt + feedback) ‖ **Tệp CV** (Foundation Files, tải ghi log) |
| REC-SCREEN-004 | Form ứng viên + upload CV | Cảnh báo trùng email/phone khi blur (gọi check-duplicate — không chặn cứng, link «xem hồ sơ cũ»); upload CV private |
| REC-SCREEN-005 | Lịch phỏng vấn + feedback | Tạo/sửa lượt (vòng · giờ · địa điểm/link · interviewer chọn qua **`RECRUIT-API-031`** — KHÔNG gọi API HR, role recruiter không có cặp HR); bảng feedback per-interviewer — chỉ sửa được **của mình**; interviewer thấy «lượt của tôi» qua view@Own |
| REC-SCREEN-006 | Offer & convert | Tạo/gửi offer, lương chỉ hiện với `('manage','offer')` (khoá 🔒 cho người khác); ghi kết quả; nút **Chuyển thành nhân viên** khoá khi offer chưa Accepted hoặc đã có employee link |

Mọi màn: `<PermissionGate>` + `useCan()`, trạng thái loading/error/empty (§14), i18n vi namespace `recruit`, nhãn trạng thái dùng constants chuẩn SPEC-01 §17.11–17.14.

---

## 10. Chi tiết chức năng

| Mã | Chức năng | Mô tả ngắn |
| --- | --- | --- |
| RECRUIT-FUNC-001 | Quản lý vị trí tuyển | CRUD + FSM §13.2; gán recruiter phụ trách ⇒ NOTI-EVENT-016; `Closed` chặn thêm/chuyển ứng viên vào (RECRUIT-ERR-005) |
| RECRUIT-FUNC-002 | Tạo / sửa hồ sơ ứng viên | tạo (idempotent theo `Idempotency-Key` FE sinh), sửa hồ sơ — **không** đổi `stage`/`employee_id` qua PATCH |
| RECRUIT-FUNC-003 | Cảnh báo trùng | `GET /candidates/check-duplicate?email=&phone=` trả các hồ sơ khớp (id · tên · stage · trạng thái sống/đã xoá mềm) — FE hiện cảnh báo, **không chặn** |
| RECRUIT-FUNC-004 | Move stage | chuyển theo FSM §13.1 kèm `reason` bắt buộc; ghi stage event cùng tx; NOTI-EVENT-018 cho recruiter phụ trách; `Hired` **chỉ** qua convert (RECRUIT-ERR-014) |
| RECRUIT-FUNC-005 | Ghi chú nội bộ | tạo/sửa/xoá mềm ghi chú **của mình** trên ứng viên |
| RECRUIT-FUNC-006 | Tệp CV | upload/list/tải qua Foundation Files (`entity_type='candidate'`, private); resolver quyền đọc tệp = **chính cặp đọc** `('view','candidate')` (luật `read-path-gate-pair`); tải ghi `file_access_logs` |
| RECRUIT-FUNC-007 | Xếp lịch phỏng vấn | tạo lượt + participants (nhân viên `active` cùng company — RECRUIT-ERR-009); chỉ khi ứng viên ở stage `Interview` (RECRUIT-ERR-007); NOTI-EVENT-017 |
| RECRUIT-FUNC-008 | Sửa / kết thúc lượt | sửa giờ/địa điểm khi `Scheduled`; `Completed`/`Cancelled` theo FSM §13.4; participants cố định (đổi người = huỷ + tạo mới) |
| RECRUIT-FUNC-009 | Feedback | interviewer tạo/sửa feedback **của mình** (own-scope theo participant — RECRUIT-ERR-011/012); đọc được bởi ai thấy lượt |
| RECRUIT-FUNC-010 | Offer | tạo (chỉ khi stage `Offer` — RECRUIT-ERR-007; 1 offer đang sống/ứng viên — RECRUIT-ERR-006), sửa khi `Draft`, đổi trạng thái theo FSM §13.3; lương mask (§18) |
| RECRUIT-FUNC-011 | Convert → nhân viên | §3.5 — một transaction, chốt cuối UNIQUE `employee_id`; NOTI-EVENT-019 |
| RECRUIT-FUNC-012 | Export danh sách ứng viên | CSV theo filter hiện hành, cặp `('export','candidate')` + **audit**; PII trong file theo đúng luật mask của caller (§18) |
| RECRUIT-FUNC-013 | Phễu tuyển dụng | đếm ứng viên theo stage + vị trí đang `Open` — nguồn widget DASH (`/candidates/summary`) |

### 10.1 Mã widget dashboard (SPEC-01 §9.9)

| Mã | widget_code | Tên | Nguồn | Gate |
| --- | --- | --- | --- | --- |
| **RECRUIT-WIDGET-001** | `RECRUIT_FUNNEL` | Phễu tuyển dụng (slug `recruit-funnel`, mig 0563 — ship `S12-RECRUIT-DASH-1`) | RECRUIT-FUNC-013 / RECRUIT-API-009 (`CandidatesService.summary` — một công thức, một con số) | cặp `('view','candidate')` **+ SÀN scope `Company`** (`DASH_WIDGET_MIN_DATA_SCOPE` — `summaryTx` đếm toàn company nên grant hẹp hơn không được serve); payload chỉ ĐẾM, không PII (§20.11) |

---

## 11. Permission đề xuất — **ĐÃ CHỐT cùng gói duyệt 31/08/2026**

Theo chuẩn per-pair `(action, resource)` + data_scope per-(permission, role). Module `RECRUIT` đứng riêng. Bảng dưới là **cặp engine thực thi**; mã dotted `RECRUIT.RESOURCE.ACTION` (SPEC-01 §9.5) chỉ là tên hiển thị. Đa-từ dùng **dash** theo quy ước engine hiện có (`update-status`, `assign-role` — đo 31/08/2026): `move-stage`, `job-opening`.

| Cặp quyền | Mã hiển thị | `is_sensitive` | Ý nghĩa | Nhân viên | Manager | HR | Recruiter · BOD/Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `('access','recruit')` | `RECRUIT.ACCESS` | false | cổng nav menu Tuyển dụng | — | có (Own) | có (Own) | có (Own) |
| `('view','job-opening')` | `RECRUIT.JOB.VIEW` | false | xem vị trí tuyển + đếm ứng viên | — | — | Company | Company |
| `('create','job-opening')` | `RECRUIT.JOB.CREATE` | false | tạo vị trí | — | — | — | Company |
| `('update','job-opening')` | `RECRUIT.JOB.UPDATE` | false | sửa · gán recruiter · đổi trạng thái FSM | — | — | — | Company |
| `('view','candidate')` | `RECRUIT.CANDIDATE.VIEW` | **true** | xem ứng viên · timeline · ghi chú · tệp CV (bản mask) | — | — | Company | Company |
| `('create','candidate')` | `RECRUIT.CANDIDATE.CREATE` | **true** | tạo hồ sơ + check-duplicate + upload CV | — | — | — | Company |
| `('update','candidate')` | `RECRUIT.CANDIDATE.UPDATE` | **true** | sửa hồ sơ; **người giữ cặp này thấy email/phone KHÔNG che** (§18) | — | — | — | Company |
| `('move-stage','candidate')` | `RECRUIT.CANDIDATE.MOVE-STAGE` | **true** | chuyển stage kèm lý do | — | — | — | Company |
| `('comment','candidate')` | `RECRUIT.CANDIDATE.COMMENT` | **true** | ghi chú nội bộ | — | — | — | Company |
| `('export','candidate')` | `RECRUIT.CANDIDATE.EXPORT` | **true** | export danh sách (audit bắt buộc) | — | — | — | Company |
| `('convert','candidate')` | `RECRUIT.CANDIDATE.CONVERT` | **true** | chuyển ứng viên trúng tuyển → nhân viên | — | — | Company | Company |
| `('view','interview')` | `RECRUIT.INTERVIEW.VIEW` | false | xem lượt phỏng vấn + feedback | — | **Own** (lượt mình được xếp) | Company | Company |
| `('manage','interview')` | `RECRUIT.INTERVIEW.MANAGE` | false | xếp/sửa/kết thúc/huỷ lượt | — | — | — | Company |
| `('feedback','interview')` | `RECRUIT.INTERVIEW.FEEDBACK` | false | ghi/sửa feedback **của mình** trên lượt mình tham gia | — | **Own** | **Own** | **Own** |
| `('view','offer')` | `RECRUIT.OFFER.VIEW` | false | xem offer (**không** lương) | — | — | Company | Company |
| `('manage','offer')` | `RECRUIT.OFFER.MANAGE` | false | tạo/sửa/đổi trạng thái offer + **thấy lương** | — | — | — | Company |

Ghi chú bắt buộc:

- **Đúng 16 cặp; 7 cặp resource `candidate` mang `is_sensitive = true`** (REC-DEC-003), 9 cặp còn lại `false` — chốt cùng seed, không flip sau (bẫy `canonical-seed-pin-regression`). Cặp sensitive **phải khai vào allowlist capability ở BACKEND cùng WO BE** — thiếu là màn quản trị biến mất với chính role được grant (`sensitive-capability-allowlist-hides-admin-screens`).
- **Lương offer KHÔNG dựng cặp riêng**: masking theo `('manage','offer')` ở server (§18) — cùng cách trường tài chính ASSET.
- **`('feedback','interview')` scope Own cho MỌI role** (kể cả admin/recruiter): feedback bản chất là "của tôi trên lượt tôi tham gia" — không ai ghi hộ người khác; điều kiện participant kiểm ở service (RECRUIT-ERR-011).
- **Đường đọc tệp CV dùng CHÍNH cặp đọc `('view','candidate')`** — không tách cặp FILE.VIEW riêng (họ lỗi `read-path-gate-pair-must-match-download-pair`).
- **Role `recruiter` là role hệ thống MỚI** (REC-DEC-008): `roles.company_id IS NULL` · `is_system = true` · `requires_two_factor = false` **tường minh** (tiền lệ `asset-manager`/`office-admin`); **KHÔNG canonical** — không vào `DashCanonicalRole`/`NOTI_CANONICAL_ROLES`/pin `auth-seed-canonical-roles`. Hiring manager = role `manager` hiện có, **không** role mới.
- **Grant cho role canonical `hr`** (hồ sơ duyệt ghi nhãn "hr-manager" theo nghĩa chức năng HR — grant vào role canonical `hr` như §9d/§9e; role hệ thống `hr-manager` không nhận grant RECRUIT ở v1). Đây là tinh chỉnh thi công, không đổi phạm vi.
- **Ma trận seed = 42 hàng** `role_permissions`: `employee` 0 · `manager` 3 (`access`@Own · `view:interview`@Own · `feedback:interview`@Own) · `hr` 7 (`access`@Own · 4 cặp view@Company · `convert`@Company · `feedback`@Own) · `company-admin` 16 · `recruiter` 16 (`access`@Own · `feedback`@Own · 14 cặp còn lại @Company). Migration verify fail-loud đúng số; `super-admin` không enumerate.
- Data scope ép ở **service layer** (pattern `buildReadScopeExists`), không phải RLS; scope Own của interview = `EXISTS` participant có `employee_id` = employee của caller.

---

## 12. Quy tắc nghiệp vụ và mã lỗi

`error.details` là **mảng** `ErrorDetail {field, message, rule}` (API-01; `details.kind` = phần tử `field:"kind"`). Vế "lỗi hình thức" (thiếu `reason`, `rating` ngoài 1–5, thiếu participant, khoá lạ trong PATCH `.strict()`, `:id` không phải UUID) chặn ở Zod ⇒ **400 `VALIDATION-ERR-001`** — không chiếm mã dưới đây (đính chính hiện thực ASSET áp từ đầu).

| Mã lỗi | HTTP | Quy tắc |
| --- | --- | --- |
| RECRUIT-ERR-001 | 409 | Chuyển **stage ứng viên** không hợp lệ theo FSM §13.1 (kể cả move tới chính stage hiện tại; `Hired`/`Rejected` sai đường). Thông điệp nêu from/to |
| RECRUIT-ERR-002 | 409 | Chuyển **trạng thái vị trí tuyển** không hợp lệ theo FSM §13.2 |
| RECRUIT-ERR-003 | 409 | Chuyển **trạng thái offer** không hợp lệ theo FSM §13.3 (gồm sửa nội dung offer không còn `Draft`) |
| RECRUIT-ERR-004 | 409 | **Lượt phỏng vấn**: sửa/kết thúc lượt đã `Completed`/`Cancelled` (FSM §13.4) |
| RECRUIT-ERR-005 | 409 | Tạo ứng viên vào / chuyển ứng viên sang vị trí **`Closed`** (`details.kind = job-closed`) |
| RECRUIT-ERR-006 | 409 | Tạo offer khi ứng viên **đã có offer đang sống** (`Draft`/`Sent`) — chốt cuối partial unique (race map `23505` → 006, không 500) |
| RECRUIT-ERR-007 | 409 | Hành động yêu cầu ứng viên ở **stage phù hợp**: xếp phỏng vấn khi stage ≠ `Interview` (`kind = not-in-interview-stage`) · tạo offer khi stage ≠ `Offer` (`kind = not-in-offer-stage`) · **convert khi stage ≠ `Offer`** (`kind = not-in-offer-stage` — §13.5 bước 2) |
| RECRUIT-ERR-008 | 409 | **Convert bị chặn**: ứng viên chưa có offer nào (`kind = no-offer`) · có offer nhưng không cái nào `Accepted` (`kind = offer-not-accepted`) · đã có employee link (`kind = already-converted` — chốt cuối UNIQUE `candidates.employee_id`, race 2 request đúng-1-thắng) · _đính chính S12-RECRUIT-BE-1 (31/08/2026, plan-review vòng 2 #1):_ mã NV auto-cấp **trùng mã đã nhập tay** (`23505` `employee_profiles_company_code_active_uq` → `kind = employee-code-conflict`, KHÔNG 500 — HR cho phép mã thủ công nên va thật sự xảy ra) |
| RECRUIT-ERR-009 | 404 / 422 | Interviewer/tham chiếu nhân sự: nhân viên **không tồn tại trong company** → **404** (`kind = employee-not-found` — giống không tồn tại, chống oracle chéo tenant); tồn tại nhưng **không `active`** → **422** (`kind = employee-inactive`); recruiter phụ trách không phải user sống trong company → **404** (`kind = recruiter-invalid`). _Đính chính S12-RECRUIT-BE-1 (31/08/2026):_ mã 009 dùng CHUNG cho tham chiếu **tổ chức** — `org_unit`/`position` của vị trí tuyển không tồn tại/không hoạt động lúc **tạo vị trí** hoặc lúc **convert** (đơn vị bị đóng SAU khi vị trí tạo) → **422** (`kind = org-unit-invalid` / `position-invalid`), KHÔNG rơi 409 `008`, KHÔNG 500 |
| RECRUIT-ERR-010 | 404 | Sentinel not-found: vị trí/ứng viên/lượt/offer/ghi chú **không thuộc company**, đã xoá mềm, hoặc **ngoài data scope** (manager mở lượt mình không tham gia) — **một phản hồi duy nhất** (chống dò sự tồn tại; không 403) |
| RECRUIT-ERR-011 | 403 | Ghi feedback trên lượt **mình không phải participant** trong khi vẫn thấy lượt (scope Company) — `kind = not-participant`. (Manager scope Own không thấy lượt ⇒ rơi vào 010 trước) |
| RECRUIT-ERR-012 | 409 | POST feedback lần 2 cho cùng (lượt, interviewer) — đã có thì **PATCH** (chốt cuối unique) |
| RECRUIT-ERR-013 | 422 | Thời gian/ngày không hợp lệ ở service: `ends_at ≤ starts_at` · `start_date` offer trong quá khứ (`kind = invalid-time-range` / `invalid-start-date`) |
| RECRUIT-ERR-014 | 409 | `move-stage` tới **`Hired` bằng tay** — `Hired` chỉ đạt được qua convert (`kind = hired-via-convert-only`). Zod của move-stage **không** cắt `Hired` (§13.1) — mã này phải SỐNG |
| RECRUIT-ERR-015 | 422 | Export vượt trần **10.000 dòng** theo filter hiện hành (`kind = export-too-large`) — thu hẹp filter rồi xuất lại (§19) |

Quy tắc bổ sung (không cần mã riêng):

- **Trùng email/phone KHÔNG phải lỗi** — check-duplicate là cảnh báo mềm (RECRUIT-FUNC-003); không unique ở DB.
- POST tạo (ứng viên · lượt phỏng vấn · offer · convert) nhận header `Idempotency-Key` **do client sinh khi mở form** qua **`@Idempotent()` dùng chung** (khoá `company_id + user_id + method + path + key`, TTL 15′, replay phát lại envelope + `Idempotency-Replayed: true`) — server **không** tự suy khoá từ payload (`period-key-idempotency-needs-frozen-source`). Chống trùng **nghiệp vụ** là việc của UNIQUE/partial unique, không phải idempotency.
- Mọi mutation quan trọng (CRUD vị trí · tạo/sửa ứng viên · move-stage · xếp/sửa/kết thúc lượt · offer · convert · export · tải CV) ghi `audit_logs`/`file_access_logs`; **payload audit không chứa email/phone/lương** (chỉ id + hành động + from/to).
- **Bản đồ `object_type` audit (đóng — plan-review H3, khớp UNION-ADD 4 giá trị DB-14 §9B):** mọi hành động gom về 4 aggregate — `job_opening` (CRUD vị trí · change-status · gán recruiter; `object_id = jobOpeningId`) · `candidate` (tạo/sửa hồ sơ · move-stage · **ghi chú** API-016/017 · **export** · convert vế RECRUIT; `object_id = candidateId` — ghi chú KHÔNG có object_type riêng, payload kèm `noteId`, tiền lệ `asset_inventory` gói item) · `interview` (tạo/sửa/change-status · **feedback** API-023/024; `object_id = interviewId`, payload kèm `feedbackId`/interviewer) · `offer` (tạo/sửa/change-status; `object_id = offerId`). Vế HR của convert audit riêng `object_type='employee'` (đã có sẵn trong CHECK). Ghi `object_type` ngoài bản đồ này = CHECK violation 500.
- Dùng lại nhóm lỗi chung API-01: `AUTH-ERR-UNAUTHENTICATED` 401 · `AUTH-ERR-FORBIDDEN` 403 (thiếu cặp) · `VALIDATION-ERR-001` 400 · mã idempotency `REQUEST-ERR-IDEMPOTENCY-*` 409.

---

## 13. Lõi nghiệp vụ

### 13.1 FSM stage ứng viên (REC-DEC-002)

| Từ ↓ / Tới → | `New` | `Screening` | `Interview` | `Offer` | `Hired` | `Rejected` |
| --- | --- | --- | --- | --- | --- | --- |
| **`New`** | — | move ✓ | ✗ (không nhảy cóc) | ✗ | ✗ | move ✓ (lý do) |
| **`Screening`** | ✗ | — | move ✓ | ✗ | ✗ | move ✓ |
| **`Interview`** | ✗ | move ✓ (quay lại sàng lọc) | — | move ✓ | ✗ | move ✓ |
| **`Offer`** | ✗ | ✗ | move ✓ (phỏng vấn thêm) | — | **chỉ qua convert** (move tay = ✗ RECRUIT-ERR-014) | move ✓ |
| **`Hired`** | ✗ | ✗ | ✗ | ✗ | — | ✗ |
| **`Rejected`** | ✗ | **reopen ✓** (REC-DEC-002, lý do) | ✗ | ✗ | ✗ | — |

- Mọi ô ✗ ⇒ **RECRUIT-ERR-001** (409), riêng `→ Hired` bằng tay ⇒ **014**. Service viết đúng **một hàm** `assertStageTransition(from, to, via)` — `via ∈ {move, convert}`; convert là đường duy nhất cho `Offer → Hired`. Không controller nào tự kiểm. **Zod của `move-stage` giữ enum ĐỦ 6 giá trị** (không cắt `Hired` ở biên — cắt là mã 014 thành mã CHẾT, bẫy `equal-caps-at-zod-and-service-make-dead-error-code`); chặn `Hired` là việc của service với mã 014.
- **`reason` bắt buộc cho mọi lần move** (Zod min 3 ký tự) — kanban kéo-thả luôn mở hộp lý do.
- `Rejected` xảy ra từ **mọi stage không-terminal** kèm lý do; `Hired` là terminal tuyệt đối (khoá cùng UNIQUE `employee_id` chống convert lần 2).
- Lùi một bậc (`Interview → Screening`, `Offer → Interview`) là **tinh chỉnh thi công trong phạm vi đã duyệt** (§22): DEC chốt **tập 6 stage cố định**, không cấm quay lại vòng trước; thực tế cần khi ứng viên phỏng vấn thêm vòng. Không nhảy cóc về phía trước.
- Mỗi move: UPDATE `candidates.stage` + INSERT `candidate_stage_events` **cùng transaction**; NOTI-EVENT-018 sau commit (outbox).

### 13.2 FSM vị trí tuyển dụng

| Từ ↓ / Tới → | `Draft` | `Open` | `Paused` | `Closed` |
| --- | --- | --- | --- | --- |
| **`Draft`** | — | mở tuyển ✓ | ✗ | huỷ nháp ✓ |
| **`Open`** | ✗ | — | tạm dừng ✓ | đóng ✓ |
| **`Paused`** | ✗ | mở lại ✓ | — | đóng ✓ |
| **`Closed`** | ✗ | ✗ | ✗ | — |

- Ô ✗ ⇒ **RECRUIT-ERR-002**. `Closed` là terminal v1 (mở tuyển lại = tạo vị trí mới); `Closed` chặn tạo/chuyển ứng viên vào (RECRUIT-ERR-005) — ứng viên **đang có** trong vị trí Closed vẫn đi tiếp pipeline bình thường (đóng tuyển ≠ huỷ ứng viên).
- **Quyết định tường minh (plan-review M7):** đóng vị trí (`Open/Paused/Draft → Closed`) **không có guard** "còn ứng viên sống" — không chặn, không tự Reject hàng loạt. Ứng viên trong vị trí Closed vẫn phỏng vấn/offer/convert được; convert dùng `org_unit_id`/`position_id` của vị trí **kể cả khi đã Closed** (đóng tuyển vì đủ người không làm sai đơn vị của người trúng tuyển cuối).
- `Draft`/`Paused` **không** chặn thêm ứng viên (chỉ `Closed` — RC-01); FE có thể cảnh báo mềm khi thêm vào vị trí chưa `Open`.

### 13.3 FSM offer (REC-DEC-004)

| Từ ↓ / Tới → | `Draft` | `Sent` | `Accepted` | `Declined` | `Withdrawn` |
| --- | --- | --- | --- | --- | --- |
| **`Draft`** | — | gửi ✓ | ✗ | ✗ | rút ✓ (huỷ nháp) |
| **`Sent`** | ✗ | — | ✓ | ✓ | ✓ |
| **`Accepted` / `Declined` / `Withdrawn`** | ✗ | ✗ | ✗ | ✗ | — |

- Ô ✗ ⇒ **RECRUIT-ERR-003**. Ba trạng thái kết quả là terminal; recruiter tự cập nhật (không có cổng cho ứng viên — ứng viên là người ngoài hệ thống). Sửa nội dung (`salary`/`start_date`/`title`) chỉ khi `Draft` (ngược ⇒ 003 `kind = not-draft`).
- Offer terminal **không** tự chuyển stage ứng viên: `Declined`/`Withdrawn` ⇒ recruiter chủ động move (`Offer → Rejected` hoặc `Offer → Interview`), hoặc tạo offer mới (partial unique chỉ đếm offer `Draft`/`Sent`).
- Điều kiện convert = **tồn tại** offer `Accepted` (KHÔNG phải "offer mới nhất là Accepted" — plan-review M1: tạo offer mới sau khi một offer đã Accepted không được khoá vĩnh viễn đường convert). Offer dùng để map trường = offer `Accepted` mới nhất, sắp theo `created_at DESC, id DESC` (tiebreak — `now()` per-statement làm ties là thật).

### 13.4 FSM lượt phỏng vấn

`Scheduled → Completed` · `Scheduled → Cancelled`; hai đích là terminal (✗ ⇒ **RECRUIT-ERR-004**). Sửa giờ/địa điểm chỉ khi `Scheduled`. Feedback ghi/sửa được khi lượt **không** `Cancelled` (cho phép ghi sau `Completed` — đánh giá thường viết sau buổi phỏng vấn). Participants cố định từ lúc tạo (§3.6).

### 13.5 Convert ứng viên → nhân viên (REC-DEC-005)

Thứ tự trong **MỘT transaction duy nhất** (mở ở RecruitService, bắt đầu bằng `SELECT … FOR UPDATE` hàng `candidates` — race 2 request serialize trên row lock, UNIQUE là chốt cuối):

1. Kiểm quyền `('convert','candidate')` + ứng viên thuộc company (RECRUIT-ERR-010).
2. Tiền điều kiện — kiểm trong tx, **theo thứ tự BẮT BUỘC**: **`employee_id IS NULL` TRƯỚC TIÊN** (ngược ⇒ 008 `already-converted` — phải đứng trước vế stage vì sau convert thành công stage luôn là `Hired`, kiểm stage trước là 008 bị 007 nuốt và convert-lần-2 trả sai mã, plan-review N1) · rồi **`stage` PHẢI = `Offer`** (ngược ⇒ **409 RECRUIT-ERR-007 `kind = not-in-offer-stage`** — cần thiết vì FSM cho lùi `Offer → Interview`, §13.1) · rồi **tồn tại offer `Accepted`** (0 offer ⇒ 008 `no-offer`; có offer nhưng không cái nào `Accepted` ⇒ 008 `offer-not-accepted`). Offer dùng cho map trường = offer `Accepted` mới nhất (`created_at DESC, id DESC` — tiebreak vì `now()` per-statement).
3. Tạo hồ sơ nhân viên qua **API nội bộ MỚI, tx-aware** của HR: `HrWriteService.createEmployeeFromCandidateTx(tx, actor, input)` — **BẮT BUỘC viết mới ở WO BE, KHÔNG gọi `createEmployee` hiện có** (đo 31/08/2026, plan-review B1: `createEmployee` (a) tự mint user account khi có `email` — vi phạm REC-DEC-005; (b) đòi scope `('create','employee')`+`('create','user')` mà role `recruiter` không có; (c) tự mở transaction riêng + cấp mã ở tx riêng ⇒ orphan employee khi race). Hợp đồng của hàm mới: **nhận `tx` từ convert** (không tự mở), **không có nhánh provision user**, cấp `employee_code` qua SequenceService ensure-on-miss **trong cùng tx**, ghi audit HR (`object_type='employee'`) trong cùng tx. **Map trường tường minh**: `email` → email cá nhân (`personal_email`, **nullable — ứng viên không email vẫn convert được**) · `phone` → SĐT · `job_openings.org_unit_id` → đơn vị · `job_openings.position_id` → vị trí · `offers.start_date` → ngày vào làm · trạng thái nhân viên = mặc định luồng HR. **Lương offer KHÔNG map**. _Đính chính S12-RECRUIT-BE-1 (31/08/2026):_ `full_name` **CHƯA map được** — `employee_profiles` hiện chưa có cột họ tên (DB-03 §7.2 thiết kế `employees.full_name` nhưng code chưa reconcile; WO BE cấm migration). Hồ sơ convert là UNLINKED **không tên**, CÙNG hình dạng với hồ sơ bulk-import đã ship; họ tên vẫn truy được qua `candidates.full_name` (link `candidates.employee_id`) và sẽ vào `users.full_name` khi HR tạo/link tài khoản. Map `full_name` bổ sung ở WO reconcile cột HR (ngoài phạm vi BE-1).
4. `UPDATE candidates SET employee_id = <new>` **trong cùng tx** — vi phạm UNIQUE (race lọt qua row-lock, ví dụ hai node) ⇒ bóc `23505` từ `cause`, map 008, **rollback TOÀN BỘ** (employee vừa INSERT cũng rollback — không orphan, không đốt hàng; số sequence đã cấp có thể trống lỗ, chấp nhận như mọi đường dùng SequenceService).
5. Move stage `Offer → Hired` với `action='convert'` (stage event ghi cùng tx).
6. Audit RECRUIT (`object_type='candidate'`) + outbox `RECRUIT_CANDIDATE_HIRED` (enqueue trong tx, phát sau commit).

**Mô hình quyền của convert (chốt tường minh — không để WO tự quyết):** cổng DUY NHẤT là `('convert','candidate')`; convert **cố ý KHÔNG** đòi `('create','employee')`/`('create','user')` — quyền tạo nhân viên được uỷ nhiệm qua đường convert có kiểm soát (tiền điều kiện offer Accepted + map trường đóng + audit hai hàng). **Không tạo user account** — bước AUTH là luồng riêng của HR (ngoài phạm vi v1).

### 13.6 Data scope

| Đối tượng | Own | Company |
| --- | --- | --- |
| Vị trí tuyển · ứng viên · offer | *(không dùng — mọi grant đọc đều Company)* | toàn bộ |
| Lượt phỏng vấn | lượt có participant là **employee của tôi** (`EXISTS interview_participants`) | toàn bộ |
| Feedback | ghi/sửa hàng `interviewer_employee_id` = employee của tôi | *(đọc theo scope của lượt)* |

Ngoài scope → **404 RECRUIT-ERR-010** (không 403). Own-scope interview theo **participant**, không theo người tạo (§3.6). `('feedback','interview')` là cặp scope Own cho mọi role — điều kiện participant kiểm thêm ở service (RECRUIT-ERR-011 cho người thấy lượt ở Company nhưng không tham gia).

**Caller không có hồ sơ nhân viên (plan-review M3):** own-scope resolve employee từ token; user không có `employee_profiles` ⇒ danh sách Own trả **rỗng** (fail-closed, không lỗi — chuẩn `/me/assets`), ghi feedback ⇒ không thể là participant ⇒ 404 (scope Own) / **403 RECRUIT-ERR-011** (scope Company). Có ca test riêng (§21).

---

## 14. Trạng thái UI bắt buộc

Mọi màn RECRUIT phải xử lý: **loading** (skeleton bảng/kanban) · **error** (thông điệp + thử lại) · **empty** («chưa có vị trí nào» / cột kanban rỗng) · **không có quyền** (ẩn bằng `<PermissionGate>`) · **hành động bị FSM chặn** (nút không hiện thay vì hiện rồi 409 — convert khoá khi offer chưa Accepted) · **409 từ server** (race: thông điệp + tải lại, không mất form) · **trường bị che** (lương offer vắng khoá ⇒ FE schema `.optional()`; email/phone dạng mask hiển thị nguyên trạng — `server-masking-needs-optional-fe-schema`).

---

## 15. Yêu cầu API cấp SPEC

Envelope/error/pagination theo API-01. Chi tiết: [API-17](<../API Design/API-17_RECRUIT_API_Design.md>). Mọi `:id` là **UUID** ở biên (pipe cấp method — `nestjs-zod-class-level-pipe-does-nothing`). Prefix `/api/v1`.

| Mã | Endpoint | Cặp quyền | Ghi chú |
| --- | --- | --- | --- |
| RECRUIT-API-001 | `GET /job-openings` | `('view','job-opening')` | filter `status[]` · `orgUnitId` · `recruiterUserId` · `q`; pagination; kèm đếm ứng viên theo stage |
| RECRUIT-API-002 | `POST /job-openings` | `('create','job-opening')` | tạo `Draft`; audit |
| RECRUIT-API-003 | `GET /job-openings/:id` | `('view','job-opening')` | chi tiết + JOIN org_unit/position/recruiter + đếm ứng viên |
| RECRUIT-API-004 | `PATCH /job-openings/:id` | `('update','job-opening')` | sửa mô tả/headcount/**gán recruiter** (đổi ⇒ NOTI-EVENT-016); **không** nhận `status`; audit |
| RECRUIT-API-005 | `POST /job-openings/:id/change-status` | `('update','job-opening')` | `{ toStatus, reason? }` theo FSM §13.2; audit |
| RECRUIT-API-006 | `GET /candidates` | `('view','candidate')` | filter `jobOpeningId` · `stage[]` · `source` · `q` (tên); pagination; email/phone mask (§18) |
| RECRUIT-API-007 | `POST /candidates` | `('create','candidate')` | `{ jobOpeningId, fullName, email?, phone?, source?, note? }`; `Idempotency-Key` FE sinh; vị trí Closed ⇒ 005; audit |
| RECRUIT-API-008 | `GET /candidates/check-duplicate` | `('create','candidate')` | `?email=&phone=` → hồ sơ khớp `{ id, fullName, stage, jobOpeningTitle, deleted }` — **không** trả email/phone của hồ sơ khớp; route khai **trước** `/candidates/:id` |
| RECRUIT-API-009 | `GET /candidates/summary` | `('view','candidate')` | đếm theo `stage` + số vị trí `Open` — nguồn widget DASH; route khai **trước** `/candidates/:id` |
| RECRUIT-API-010 | `GET /candidates/export` | `('export','candidate')` **+ `('view','candidate')`** (§18) | CSV theo filter của 006; **audit bắt buộc**; PII theo luật mask của caller; > 10.000 dòng ⇒ 422 RECRUIT-ERR-015; route khai **trước** `/candidates/:id` |
| RECRUIT-API-011 | `GET /candidates/:id` | `('view','candidate')` | chi tiết + stage + link employee (nếu Hired) + offer đang sống (không lương nếu thiếu quyền); mask §18 |
| RECRUIT-API-012 | `PATCH /candidates/:id` | `('update','candidate')` | sửa hồ sơ; **không** nhận `stage`/`employeeId` (`.strict()` ⇒ 400); đổi `jobOpeningId` sang vị trí Closed ⇒ 005; audit |
| RECRUIT-API-013 | `POST /candidates/:id/move-stage` | `('move-stage','candidate')` | `{ toStage, reason }`; FSM §13.1; NOTI-EVENT-018; audit |
| RECRUIT-API-014 | `GET /candidates/:id/stage-events` | `('view','candidate')` | timeline, pagination, mới nhất trước |
| RECRUIT-API-015 | `GET /candidates/:id/notes` | `('view','candidate')` | ghi chú, pagination |
| RECRUIT-API-016 | `POST /candidates/:id/notes` | `('comment','candidate')` | `{ body }` |
| RECRUIT-API-017 | `PATCH /candidates/:id/notes/:noteId` | `('comment','candidate')` | sửa/xoá mềm (`{ body? , delete?: true }`) — chỉ ghi chú **của mình** (khác ⇒ 404 RECRUIT-ERR-010) |
| RECRUIT-API-018 | `GET /interviews` | `('view','interview')` | filter `candidateId` · `from,to` · `status[]`; scope Own = participant (§13.6); pagination |
| RECRUIT-API-019 | `POST /interviews` | `('manage','interview')` | `{ candidateId, round, startsAt, endsAt, location?, note?, participantEmployeeIds[] }` (≥1, nhân viên `active` — 009); stage phải `Interview` (007); `Idempotency-Key`; NOTI-EVENT-017; audit |
| RECRUIT-API-020 | `GET /interviews/:id` | `('view','interview')` | chi tiết + participants (JOIN HR) + feedbacks; ngoài scope ⇒ 404 |
| RECRUIT-API-021 | `PATCH /interviews/:id` | `('manage','interview')` | sửa giờ/địa điểm/vòng/ghi chú — chỉ khi `Scheduled` (004); audit |
| RECRUIT-API-022 | `POST /interviews/:id/change-status` | `('manage','interview')` | `{ toStatus: 'Completed' \| 'Cancelled', note? }` FSM §13.4; audit |
| RECRUIT-API-023 | `POST /interviews/:id/feedback` | `('feedback','interview')` | `{ rating, comment?, recommendation }`; phải là participant (011); trùng ⇒ 012; lượt Cancelled ⇒ 004 |
| RECRUIT-API-024 | `PATCH /interviews/:id/feedback` | `('feedback','interview')` | sửa feedback **của mình** (resolve theo employee từ token — không nhận id feedback của người khác) |
| RECRUIT-API-025 | `GET /offers` | `('view','offer')` | filter `candidateId` · `status[]`; pagination; `salary` chỉ khi có `('manage','offer')` (§18) |
| RECRUIT-API-026 | `POST /offers` | `('manage','offer')` | `{ candidateId, title?, startDate, salary, note? }`; stage phải `Offer` (007); 1 offer sống (006); `Idempotency-Key`; audit |
| RECRUIT-API-027 | `PATCH /offers/:id` | `('manage','offer')` | sửa nội dung — chỉ khi `Draft` (003); audit |
| RECRUIT-API-028 | `POST /offers/:id/change-status` | `('manage','offer')` | `{ toStatus, note? }` FSM §13.3; ghi `responded_at` khi vào terminal; audit |
| RECRUIT-API-029 | `POST /candidates/:id/convert` | `('convert','candidate')` | §13.5; `Idempotency-Key`; NOTI-EVENT-019; audit |
| RECRUIT-API-030 | `GET /offers/:id` | `('view','offer')` | chi tiết offer; `salary` chỉ khi có `('manage','offer')` (§18) |
| RECRUIT-API-031 | `GET /recruit/pickers/employees` | `('manage','interview')` | danh bạ chọn interviewer: `?q=&limit=` → `{ id, fullName, employeeCode }` nhân viên `active` — qua **điểm chiếu danh tính duy nhất** (§18), KHÔNG lộ trường HR khác; role recruiter không có cặp HR nên KHÔNG dùng API-03 |
| RECRUIT-API-032 | `GET /recruit/pickers/recruiter-users` | `('update','job-opening')` | danh sách user chọn làm phụ trách vị trí: `?q=&limit=` → `{ id, fullName }` user sống trong company — qua điểm chiếu danh tính duy nhất (§18) |

> ⚠️ Tệp CV **không có route riêng trong RECRUIT** — upload/list/tải đi qua Foundation Files (API-09) với `file_links.entity_type = 'candidate'`, chế độ private; WO BE đăng ký **resolver quyền đọc tệp cho entity `candidate` = cặp `('view','candidate')`**, đường **GHI/đính tệp** gate bằng `('create','candidate')` (upload lúc tạo) / `('update','candidate')` (đính vào hồ sơ có sẵn), và bảo đảm tải về ghi `file_access_logs`. Thêm endpoint sau phải cấp mã `RECRUIT-API-033+` và đo lại dải bằng grep.
>
> **32 mã = 32 route HTTP** (không mã nào gói 2 route). Route-census đếm route — WO BE regen với 32.

---

## 16. Dữ liệu và lưu trữ

Nguồn chuẩn: [DB-14](<../DB/DB-14 RECRUIT Database Design.md>). Tóm tắt:

- **8 bảng mới**: `job_openings` · `candidates` · `candidate_stage_events` · `candidate_notes` · `interviews` · `interview_participants` · `interview_feedbacks` · `offers` — RLS + FORCE, policy literal-GUC, composite tenant FK cho **mọi** FK chéo (mẫu `0535`/`0549`), soft delete ở `job_openings`/`candidates`/`candidate_notes`.
- **2 bảng chỉ-INSERT**: `candidate_stage_events` (sổ lịch sử — bất biến #2, REVOKE UPDATE/DELETE) và `interview_participants` (cố định lúc xếp lịch). Các bảng còn lại **không có DELETE** cho app role (soft delete/terminal-status thay thế).
- **Chốt cuối ở DB**: UNIQUE partial `candidates.employee_id` (double-convert) · partial unique 1 offer `Draft`/`Sent`/ứng viên · unique feedback per (interview, interviewer) · unique participant per (interview, employee).
- Seed đi kèm (DB-14 §9): giữ hàng module `RECRUIT` **inactive** (bật ở WO FE) · role `recruiter` · 16 cặp §11 + 42 grant §9f · UNION-ADD 4 giá trị `job_opening` · `candidate` · `interview` · `offer` vào CHECK `audit_logs.object_type` (khuôn `0545`) · catalog + template 4 event NOTI §17 `dedupe_strategy='DedupeKey'` + nới CHECK `module_code`/`notification_type` trên **CẢ HAI bảng** `notification_events` và `notifications`.
- **Teardown test**: thêm 8 bảng vào `cleanupTenants()` theo thứ tự con→cha **cùng commit** với migration (`drop-table-must-clean-test-teardown`).
- Migration nối tiếp head **THẬT** lúc chạy (`_journal.json`; head lúc viết = idx 225 / `0558` ⇒ dự kiến `0559+`).

---

## 17. Sự kiện và thông báo

| Event code | Mã chuẩn (SPEC-01 §20.2 · SPEC-08 §15.0) | Khi nào | Người nhận | Dedupe |
| --- | --- | --- | --- | --- |
| `RECRUIT_JOB_ASSIGNED` | NOTI-EVENT-016 | gán/đổi recruiter phụ trách vị trí (commit) | `recruiter_user_id` mới (trừ actor tự gán mình) | `RECRUIT_JOB_ASSIGNED:{jobOpeningId}:{auditLogId}` — **mỗi LẦN gán là một sự kiện** (plan-review H2: khoá theo `{jobId}:{userId}` là "once-ever" — A→B→A thì A không bao giờ được báo lại; engine `DedupeKey` không có bucket thời gian). `auditLogId` = id hàng audit của chính lần PATCH gán, có sẵn trong tx |
| `RECRUIT_INTERVIEW_SCHEDULED` | NOTI-EVENT-017 | lượt phỏng vấn tạo xong | user của các `interview_participants` (resolve employee → user; employee không có user thì bỏ qua) | `RECRUIT_INTERVIEW_SCHEDULED:{interviewId}` (một lượt tạo đúng một lần — huỷ + tạo lượt mới là interviewId mới) |
| `RECRUIT_STAGE_CHANGED` | NOTI-EVENT-018 | ứng viên đổi stage (move tay — convert dùng 019) | `recruiter_user_id` của vị trí (trừ actor) | `RECRUIT_STAGE_CHANGED:{stageEventId}` |
| `RECRUIT_CANDIDATE_HIRED` | NOTI-EVENT-019 | convert thành công (commit) | user giữ role **`hr`** trong company (tra `user_roles` còn hiệu lực, `recipient.mode='UserIds'` — engine không có tra ngược cặp quyền, tiền lệ `ASSET_MAINTENANCE_DUE`), trừ actor. **KHÔNG gửi `hr-manager`** (plan-review B6: role đó không có grant RECRUIT ở v1 — nhận link là đâm vào 403) | `RECRUIT_CANDIDATE_HIRED:{candidateId}` |

- `notification_type = 'Recruit'`, `module_code = 'RECRUIT'`, `priority` Normal (016/018/019) · High (017), `isEnabled=true`, `isSystemEvent=false` cả 4 — **RECRUIT v1 không có system job** (mọi event đều event-driven; nhắc lịch phỏng vấn = Phase sau nếu cần).
- **`dedupe_strategy = 'DedupeKey'`** ngay seed đầu cho cả 4 (mặc định `'None'` biến dedupeKey thành chuỗi trang trí — bài học `0479`/`0507`).
- Payload chỉ chứa **tên ứng viên + tên vị trí + stage/giờ hẹn + liên kết** (`/recruit/candidates/:id`); **không** email/phone/lương (§18). **`candidates.full_name` được tuyên bố tường minh là projection ĐƯỢC PHÉP lộ** trong payload NOTI và trên đường đọc `('view','interview')` (interviewer cần biết mình phỏng vấn AI dù không có `('view','candidate')`) — chỉ họ tên, không trường PII nào khác (§18).
- Phát qua **OutboxNotificationBridge** (enqueue trong transaction). `registerSource()` fail-loud lúc boot ⇒ seed NOTI (DB-14 §9 bước C) phải merge **trước** khi WO BE đăng ký registrar.
- Đo dải mã chuẩn ngày 31/08/2026: SPEC-01 §20.2 dừng ở **NOTI-EVENT-015** (ASSET 010–012 · ROOM 013–015). RECRUIT cấp tiếp **016–019**; module sau lấy **020+** — đo lại bằng grep trước khi cấp.

---

## 18. Audit và bảo mật

- **RLS + FORCE** theo `company_id` trên cả 8 bảng, policy **trước** mọi INSERT; mọi repository qua `withTenant`.
- **Sổ append-only**: `candidate_stage_events` — app role **không** UPDATE/DELETE (bất biến #2); `interview_participants` chỉ INSERT. Không bảng RECRUIT nào có DELETE cho app role.
- **Che PII ở server (REC-DEC-003):**
  - `candidates.email`/`phone`: người giữ `('update','candidate')` thấy **đầy đủ**; người chỉ có `('view','candidate')` nhận **dạng che** (`d***@***.com` · `09** *** *45` — che ở server, key vẫn có mặt vì FE cần hiển thị dạng mask); DTO kèm `piiMasked: true/false`.
  - `offers.salary`: **chỉ có mặt** khi caller giữ `('manage','offer')`; ngược lại **vắng khoá** (không `null`) — FE schema `.optional()`.
  - Export: assert **CẢ HAI cặp** `('export','candidate')` **VÀ** `('view','candidate')` (plan-review H5 — cổng export đứng một mình là đường đọc PII **rộng hơn** đường đọc từng hàng); xuất đúng theo luật mask của caller; quá 10.000 dòng ⇒ **422 RECRUIT-ERR-015**; **audit** một hàng (`object_type='candidate'`, payload = filter + số dòng, **không** kèm dữ liệu).
  - CV: Foundation Files **private**; đường **đọc** gate bằng chính cặp `('view','candidate')`; đường **ghi/đính tệp** gate bằng `('create','candidate')` (lúc tạo) / `('update','candidate')` (hồ sơ có sẵn); mỗi lần tải ghi `file_access_logs`.
  - **Projection `full_name` (tuyên bố tường minh):** `candidates.full_name` được phép xuất hiện trong (a) DTO lượt phỏng vấn trả cho người chỉ có `('view','interview')` và (b) payload NOTI (§17) — CHỈ họ tên; email/phone/lương/nguồn/ghi chú tuyệt đối không đi theo hai đường này. Có ca test masking riêng (§21).
  - Payload NOTI + audit **không** chứa email/phone/lương.
- **Điểm chiếu danh tính DUY NHẤT (khuôn ROOM `room-people.repository`):** mọi JOIN/picker sang HR/AUTH (tên interviewer, tên recruiter, danh bạ picker API-031/032, `currentX` trong DTO) đi qua đúng **một** `RecruitPeopleRepository` — trường trả về giới hạn `{ id, fullName, employeeCode? }`; căn cứ chiếu = cặp của route đang phục vụ (picker = cặp GHI tương ứng §15). Không service nào tự JOIN `users`/`employee_profiles` lấy thêm trường.
- **404 chứ không 403** cho đối tượng ngoài scope/tenant (RECRUIT-ERR-010); **403** chỉ khi thiếu cặp quyền hoặc vi phạm điều kiện participant (011).
- Cặp sensitive (7 cặp `candidate`) khai **allowlist capability ở BACKEND** cùng WO BE (`capability-allowlist-hides-admin-screens`).
- Check-duplicate (API-008) là oracle "hồ sơ tồn tại" **có chủ đích** trong company — gate bằng `('create','candidate')` (sensitive) và **không** trả email/phone của hồ sơ khớp; cross-tenant vẫn tuyệt đối im lặng (RLS).
- Guard cặp quyền tồn tại ở **HAI tầng** (decorator route + service) — census QA so **TỪNG ROUTE theo MÃ cặp** ở cả hai tầng (bài học ASSET coverage 97.5% vẫn lọt).

---

## 19. Non-functional requirements

- Danh sách ứng viên 10k hàng lọc stage/vị trí < 300ms (index `(company_id, stage, job_opening_id)` — DB-14 §8); kanban đếm theo stage một `GROUP BY`.
- Chi tiết ứng viên (hồ sơ + offer sống + đếm timeline) **một truy vấn** chính (không N+1); check-duplicate đi qua index biểu-thức `lower(email)` / phone chuẩn hoá (DB-14 §6.2 — index KHÔNG partial theo `deleted_at` vì cảnh báo tính cả hồ sơ đã xoá mềm).
- Export CSV stream theo trang, chặn > 10.000 dòng/lần — **422 RECRUIT-ERR-015** gợi ý thu hẹp filter.
- i18n: nhãn qua react-i18next namespace `recruit`; trạng thái hiển thị từ constants chuẩn SPEC-01 §17.11–17.14.

---

## 20. Tiêu chí nghiệm thu tổng quát

1. Tạo vị trí «NV Kinh doanh» (Draft) → mở tuyển (Open) → gán recruiter Lan → Lan nhận `RECRUIT_JOB_ASSIGNED`; đóng (Closed) → thêm ứng viên vào ⇒ **409 RECRUIT-ERR-005**.
2. Tạo ứng viên với email đã tồn tại trong company → form hiện **cảnh báo trùng** (không chặn); hồ sơ vẫn lưu được.
3. HR mở chi tiết ứng viên → email/phone **dạng che**, recruiter (có `update`) thấy đầy đủ; kéo ứng viên `New → Interview` ⇒ **409 RECRUIT-ERR-001** (nhảy cóc); `New → Screening` kèm lý do ⇒ timeline +1 hàng.
4. Xếp lịch phỏng vấn khi ứng viên ở `Screening` ⇒ **409 RECRUIT-ERR-007**; ở `Interview` ⇒ interviewer (manager X) nhận `RECRUIT_INTERVIEW_SCHEDULED`; manager X thấy lượt trong danh sách (Own), manager Y không tham gia mở lượt ⇒ **404**.
5. Manager X ghi feedback lượt của mình ⇒ 200; ghi lần 2 ⇒ **409 RECRUIT-ERR-012** (sửa qua PATCH); recruiter (Company) ghi feedback lượt mình không tham gia ⇒ **403 RECRUIT-ERR-011**.
6. Tạo offer khi stage `Interview` ⇒ **409 007**; move sang `Offer` rồi tạo ⇒ 200; tạo offer thứ hai khi offer đầu `Sent` ⇒ **409 006**. `('view','offer')` không thấy khoá `salary`; `('manage','offer')` thấy.
7. Convert khi offer `Sent` ⇒ **409 008 `offer-not-accepted`**; ghi `Accepted` → convert ⇒ tạo nhân viên (mã từ sequence, không trùng), candidate `Hired` + timeline có hàng `convert`, HR nhận `RECRUIT_CANDIDATE_HIRED`; convert lần 2 ⇒ **409 008 `already-converted`**; **2 request convert song song ⇒ đúng 1 thắng** (int-spec race, UNIQUE là chốt cuối).
8. Move-stage tay tới `Hired` ⇒ **409 014**; ứng viên `Rejected` reopen về `Screening` kèm lý do ⇒ 200.
9. Deny-path: manager gọi `POST /candidates` ⇒ 403; employee thường gọi mọi route RECRUIT ⇒ 403; **chủ thể = role dựng trong test, không SA**. Cross-tenant: mọi `:id` của company khác ⇒ **404** (int-spec `LANE_DB`).
10. Tải CV → `file_access_logs` +1 hàng; `GET /candidates/export` → audit +1 hàng; caller thiếu `('export','candidate')` **hoặc** thiếu `('view','candidate')` ⇒ 403 (§18 — hai cặp đều bắt buộc); filter khớp > 10.000 dòng ⇒ **422 RECRUIT-ERR-015**.
11. Widget «phễu tuyển dụng» hiện đúng đếm theo stage cho recruiter/HR; employee không thấy widget (không gọi API).
12. Manager X (chỉ `view:interview`@Own) mở lượt của mình → thấy **`fullName`** ứng viên nhưng DTO **không có** email/phone/nguồn/ghi chú (projection §18); sau seed, `SuperAdminBootstrapService` giải được đúng **7 cặp sensitive** mới (wildcard `*:*` không thoả cổng sensitive — tiền lệ `leave-audit.service`).

---

## 21. Test scenario cấp cao

| Nhóm | Scenario |
| --- | --- |
| Deny-path (RED trước) | thiếu từng cặp trong 16 cặp → 403 trên endpoint tương ứng, **mỗi cặp có ca ALLOW đối chứng** (deny không rỗng nghĩa); cross-tenant mọi endpoint → 404; chủ thể = role dựng trong test |
| FSM | mọi ô ✗ ở §13.1–13.4 → đúng mã 001/002/003/004; `Hired` tay → 014; reopen Rejected→Screening ✓; **convert khi stage ≠ `Offer` → 409 007 `not-in-offer-stage`** và **convert lần 2 → 409 008 `already-converted`** (thứ tự kiểm §13.5 — N1); census mã lỗi **theo MÃ** — không mã nào 0 ca |
| Masking PII | HR (view) nhận email/phone che + không `salary`; recruiter nhận đầy đủ email/phone; chỉ `('manage','offer')` thấy `salary`; export theo đúng luật caller **và đòi đủ 2 cặp** (H5) + ca vượt trần 10k ⇒ **422 RECRUIT-ERR-015**; **DTO interview cho `view:interview`-only: có `fullName`, KHÔNG email/phone/nguồn/ghi chú** (projection §18); ca đối chứng ALLOW cho từng luật |
| Own-scope interview | manager thấy đúng tập lượt mình tham gia (Own) — có ca allow lẫn deny; feedback: not-participant → 403 (011), ngoài scope → 404 (010); **caller không có `employee_profiles`** → danh sách Own rỗng + feedback bị chặn (M3) |
| Race | 2 convert song song → 1 thắng (UNIQUE `employee_id`); 2 tạo offer song song → 1 sống (partial unique); 2 feedback song song → 1 hàng (unique) — đều map 409, không 500 (bóc `23505` từ `cause`) |
| Idempotent | POST tạo lặp cùng `Idempotency-Key` (15′) → 1 bản ghi + replay envelope + `Idempotency-Replayed: true`; `IN_PROGRESS`/`KEY_REUSED`/`INVALID_KEY` như chuẩn chung |
| Append-only | app role UPDATE/DELETE `candidate_stage_events` bị từ chối ở **DB**; participants không UPDATE/DELETE |
| Tenant | `rls-tenant-isolation-tester` xanh cho 8 bảng trên `LANE_DB` |
| NOTI | 4 event seed đúng catalog (`DedupeKey`); CHECK nới **cả hai bảng**; 018 không phát cho actor; 019 tra `user_roles` chỉ role `hr` (B6); 016 gán lại A→B→A vẫn báo A (khoá theo lần gán — H2) |
| Audit | mỗi mutation quan trọng +1 hàng đúng `object_type`; payload không PII/lương; tải CV ghi `file_access_logs` |
| Validate | Zod mirror CHECK DB **hai chiều đúng bằng** (stage/status/recommendation/rating); trần Zod ≠ trần service không đẻ mã chết |

---

## 22. Quyết định nghiệp vụ — **OWNER ĐÃ KÝ 31/08/2026**

> Owner duyệt nguyên gói hồ sơ [`docs/plans/S12-RECRUIT-WAVE-review.html`](<../plans/S12-RECRUIT-WAVE-review.html>) («ok tôi duyệt») ⇒ 8 mã dưới đây chốt **đúng cột «Đề xuất»** của [wave plan §3](<../plans/S12-RECRUIT-WAVE.md>). Bảng này là bản chép kết luận; không hỏi lại.

| Mã | Câu hỏi | Kết quả owner chốt | Trạng thái |
| --- | --- | --- | --- |
| REC-DEC-001 | Đánh số tài liệu khi API-16 đã bị chiếm | **SPEC-12 · DB-14** (đúng chỗ IMP-10 giữ) · **API-17** · permission-matrix **§9f** · IMPLEMENTATION-02 **EPIC-19 (§8.20)**, IMP02-STORY-171..180 · trạng thái SPEC-01 §17.11–17.14 · NOTI-EVENT-016..019 (đã đo lại dải — §17) | ✅ chốt |
| REC-DEC-002 | Pipeline cố định hay tuỳ biến | v1 **cố định 6 stage** `New → Screening → Interview → Offer → Hired / Rejected`; Rejected reopen về Screening kèm lý do; Hired terminal; custom stage Phase sau — §3.1, §13.1 | ✅ chốt |
| REC-DEC-003 | Bảo vệ PII ứng viên tới mức nào | Cặp `candidate` **is_sensitive=true**; email/phone **mask ở SERVER** theo quyền; CV Foundation Files **private** + `file_access_logs`; export cặp riêng + audit — §3.3, §18 | ✅ chốt |
| REC-DEC-004 | Offer: workflow duyệt · lương ai thấy | **Không workflow duyệt** (Phase sau). `Draft → Sent → Accepted/Declined/Withdrawn`, recruiter tự cập nhật; lương chỉ trả cho `('manage','offer')` — §3.4, §13.3 | ✅ chốt |
| REC-DEC-005 | Convert 1 bước hay wizard | **1 bước**, `('convert','candidate')`, chỉ khi offer Accepted; service HR + SequenceService ensure-on-miss; map trường tường minh; `employee_id` UNIQUE; **không tạo tài khoản** — §3.5, §13.5 | ✅ chốt |
| REC-DEC-006 | Phỏng vấn: ROOM · calendar ngoài | v1 địa điểm **text/link tự do**; không buộc ROOM, không calendar ngoài; interviewer nội bộ nhận NOTI; feedback **own-scope per interviewer** — §3.6 | ✅ chốt |
| REC-DEC-007 | Retention ứng viên Rejected | v1 **soft-delete** (§16.2), chưa auto-purge; policy = **PARK-RECRUIT-001** (RELEASE-14 §5) — §5.2 | ✅ chốt |
| REC-DEC-008 | Role seed | Role hệ thống **`recruiter`**: `company_id IS NULL` · `is_system=true` · `requires_two_factor=false` tường minh · **KHÔNG canonical**; hiring manager = role `manager` hiện có — §11 | ✅ chốt |

> **Tinh chỉnh thi công trong phạm vi đã duyệt (ghi để minh bạch, không phải DEC mới):** (a) đặt tên cặp theo quy ước dash của engine — `job-opening` · `move-stage` (hồ sơ HTML viết `job_opening`/`move_stage`); (b) thêm cặp `('feedback','interview')` scope Own — hồ sơ HTML gói feedback vào nhóm interview, tách cặp để ghi feedback không cần quyền đọc rộng; (c) grant "hr-manager" của hồ sơ đọc là role canonical **`hr`** (§11) — và NOTI-EVENT-019 chỉ gửi role `hr` cho khớp (plan-review B6); (d) FSM stage cho phép **lùi một bậc** (`Interview → Screening`, `Offer → Interview`) kèm lý do — DEC chốt tập 6 stage, không cấm quay lại vòng trước; **điều kiện đi kèm bắt buộc** (plan-review B3/H7): convert đòi `stage = 'Offer'` (§13.5 bước 2) để đường lùi không tạo ra trạng thái convert không-định-nghĩa; (e) v1 **không có endpoint xoá** ứng viên/vị trí (soft-delete cột có sẵn, đường xoá mở cùng PARK-RECRUIT-001); (f) `Hired` chỉ đạt qua convert (RECRUIT-ERR-014) — hệ quả trực tiếp của "Hired terminal, khoá chống convert lần 2"; (g) convert dùng **API nội bộ tx-aware mới** của HR thay vì `createEmployee` hiện có — bắt buộc kỹ thuật để giữ đúng REC-DEC-005 "không tạo tài khoản" + "một transaction" (§13.5, plan-review B1); (h) 2 route picker `RECRUIT-API-031/032` — bắt buộc để màn hình chạy được vì role `recruiter` không có cặp HR/AUTH nào (plan-review B4), trường trả về bó hẹp `{id, fullName, employeeCode?}`.
>
> Điều kiện mở WO code của track RECRUIT: 8 quyết định chốt (✅) · §1 = `Approved` (✅) · `plan-reviewer` đối kháng **PASS** trên SPEC-12 + DB-14 (làm ở cuối `S12-RECRUIT-DOC-1`, trước khi mở `S12-RECRUIT-DB-1`).

---

## 23. Tác động đến bộ tài liệu hiện tại (WO S12-RECRUIT-DOC-1)

1. **SPEC-01**: §7.2/§8 trỏ RECRUIT → SPEC-12; §12.9 liên kết; **§17.11–17.14** hợp thức 4 bộ trạng thái + ghi chú §17.7; §20.2 cấp NOTI-EVENT-016..019; thanh điều hướng các file SPEC thêm SPEC-12.
2. **SPEC-08**: §15.0 ánh xạ thêm 016–019; §15.9 RECRUIT events.
3. **docs/README.md** §2/§3/§4/§9: thêm SPEC-12 · DB-14 · API-17 và hàng module RECRUIT.
4. **docs/permission-matrix-spec.md**: **§9f RECRUIT** — 16 cặp + scope per-(perm, role) + role `recruiter`.
5. **DB-01** §3.2 + nhóm bảng §7.12 · **DB-09** §8.18 index RECRUIT · **DB-10** §10 seed module + §12.11 permission + §15 event.
6. Tạo **DB-14** và **API-17** (stub endpoint khoá theo §15).
7. **docs/erd-current.md**: Phụ lục A4 thêm nhóm RECRUIT (thiết kế có, code chưa build).
8. **RELEASE-14 §5**: RECRUIT có bộ tài liệu, wave `S12-RECRUIT` + ghi **PARK-RECRUIT-001** (retention ứng viên Rejected).
9. **IMPLEMENTATION-02** §8.20 **EPIC-19 RECRUIT** (IMP02-STORY-171..180) + §9 Sprint 12; **ISSUE-BOARD-01** §8.2 hàng RECRUIT/EPIC-19; **IMPLEMENTATION-10** §13.2 ghi chú DB-14 đã viết (API lấy API-17).
10. **harness**: `lib/stories.mjs` (`EPIC_MODULE[19]`, `sprintOfStory` S12, map story→WO) · `dashboard/server.mjs` (`MODULE_SPEC` RECRUIT — đặt **trước** HR/AUTH vì tiêu đề WO chứa "employee"/"permission") · `backlog.mjs` (DOC-1 đóng).
11. **Nợ để lại cho WO sau**: (a) `S12-RECRUIT-DB-1` — toàn bộ DB-14 §9 (+ cập nhật danh sách bảng append-only ở `erd-current` §9 khi build); (b) `S12-RECRUIT-BE-1` — khai **allowlist capability BACKEND** cho 7 cặp sensitive + đăng ký **resolver quyền đọc tệp** entity `candidate` = `('view','candidate')` (§15) + viết **`HrWriteService.createEmployeeFromCandidateTx`** (§13.5 — hợp đồng đã chốt, không gọi `createEmployee`) + **`RecruitPeopleRepository`** điểm chiếu danh tính duy nhất (§18); (c) `S12-RECRUIT-FE-1` — thêm **16 mã dotted `RECRUIT.*`** (§11) vào `PERMISSION_CODE_TO_PAIR` (`packages/web-core/src/lib/registry.ts`) — bảng fail-closed với mã lạ, thiếu là toàn bộ màn RECRUIT ẩn dù DB đã grant (`capability-allowlist-hides-admin-screens`); (d) `S12-RECRUIT-DASH-1` — **toàn bộ seed widget** «phễu tuyển dụng» (catalog BE + sàn scope `DASH_WIDGET_MIN_DATA_SCOPE` + slug FE, khuôn mig `0558`) — **cố ý KHÔNG nằm trong DB-14 §9** (plan-review M5).

---

## 24. Definition of Done cho SPEC-12

- [x] Owner ký REC-DEC-001..008 (31/08/2026) → §1 = **Approved**
- [x] DB-14 + API-17 + permission-matrix §9f đồng bộ, không mâu thuẫn SPEC-12
- [x] SPEC-01 §17.11–17.14 hợp thức 4 bộ trạng thái; §20.2/SPEC-08 §15.0 cấp NOTI-EVENT-016..019 sau khi **đo** (dải dừng ở 015)
- [ ] `plan-reviewer` đối kháng **PASS** trên SPEC-12 + DB-14 — cổng mở `S12-RECRUIT-DB-1`
- [ ] Mọi WO code của track RECRUIT lấy SPEC-12 + DB-14 làm nguồn sự thật; lệch → sửa code, không sửa ngầm spec

---

## 25. Kết luận

RECRUIT là module Phase 2 đầu tiên được xây: khép trục HR từ đầu vào (tuyển) tới hồ sơ nhân viên. Ba lựa chọn cứng — **pipeline 6 stage cố định với sổ lịch sử append-only**, **PII ứng viên là dữ liệu nhạy cảm ngay từ seed (7 cặp sensitive, mask ở server)**, **convert một bước trong một transaction với chốt cuối UNIQUE ở DB** — giữ v1 gọn về nghiệp vụ nhưng WO DB/BE vẫn là **🔴 red** (permission seed + RLS + append-only + PII masking — PMVP-AUTH-005/006). Phần thật sự mới chỉ là 8 bảng, 16 cặp quyền, 32 mã API, 15 mã lỗi, 1 API nội bộ HR tx-aware và 6 màn hình; phỏng vấn không đụng ROOM, offer không có FSM phê duyệt, convert không tạo tài khoản — mọi thứ còn lại tái dùng nền đã có.
