# API-17: RECRUIT API DESIGN (Tuyển dụng — Vị trí · Ứng viên · Pipeline · Phỏng vấn · Offer · Convert)

**MODULE RECRUIT - TUYỂN DỤNG - API DESIGN**

> **📚 Bộ tài liệu API — Hệ thống Quản lý Doanh nghiệp**
> [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [API-02 AUTH](<API-02 AUTH API Design.md>) · [API-03 HR](<API-03_HR_API_Design.md>) · [API-04 ATT](<API-04_ATT_API_Design.md>) · [API-05 LEAVE](<API-05_LEAVE_API_Design.md>) · [API-06 TASK](<API-06_TASK_API_Design.md>) · [API-07 NOTI](<API-07_NOTI_API_Design.md>) · [API-08 DASH](<API-08_DASH_API_Design.md>) · [API-09 FOUNDATION](<API-09_FOUNDATION_API_Design.md>) · [API-10 Permission Matrix](<API-10 PERMISSION MATRIX.md>) · [API-11 ME](<API-11_ME_API_Design.md>) · [API-12 GOAL](<API-12_GOAL_API_Design.md>) · [API-13 CHAT](<API-13_CHAT_API_Design.md>) · [API-14 ASSET](<API-14_ASSET_API_Design.md>) · [API-15 ROOM](<API-15_ROOM_API_Design.md>) · **API-17 RECRUIT**
>
> **Nguồn & liên quan:** [Chuẩn API: API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [Đặc tả: SPEC-12 RECRUIT](<../SPEC/SPEC-12 RECRUIT.md>) · [Thiết kế DB: DB-14](<../DB/DB-14 RECRUIT Database Design.md>) · [DB-09 §8.18 Index](<../DB/DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 Seed RECRUIT](<../DB/DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>) · [Ma trận phân quyền §9f](<../permission-matrix-spec.md>) · [Chỉ mục tài liệu](<../README.md>)
>
> **Đánh số (REC-DEC-001):** RECRUIT nhận **API-17** — API-14/15 = ASSET/ROOM, **API-16 đã bị «PERMISSION AUDIT REPORT» chiếm** (không dồn số, không đè tài liệu sống).

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | API-17 |
| Tên tài liệu | RECRUIT API Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Module | RECRUIT - Tuyển dụng |
| Phiên bản | v0.1 |
| Trạng thái | **Stub — Approved** (owner duyệt gói wave S12-RECRUIT 31/08/2026, cùng SPEC-12 §1). Khung endpoint đã chốt; DTO chi tiết bổ sung ở WO backend `S12-RECRUIT-BE-1` |
| Giai đoạn | Phase 2 «HR nâng cao» · wave S12-RECRUIT — hậu go-live |
| Tài liệu nguồn | SPEC-12 RECRUIT, API-01 Tổng quan, DB-14, DB-09/10, permission-matrix-spec §9f |
| Ngày tạo / cập nhật | 31/08/2026 / 31/08/2026 |

> **Trạng thái Stub:** khoá **tên file + danh sách endpoint + cặp quyền + nguyên tắc bắt buộc** để README/SPEC-12 §15 trỏ nhất quán. DTO/schema đầy đủ, ví dụ payload và OpenAPI bổ sung ở `S12-RECRUIT-BE-1` — đồng bộ `packages/contracts/src/recruit.ts`.

---

## 2. Mục đích tài liệu

Mô tả thiết kế API cho module **RECRUIT** — vị trí tuyển dụng có FSM, ứng viên với PII mask ở server, pipeline 6 stage có sổ lịch sử, phỏng vấn own-scope theo participant, offer mask lương, convert một bước sang HR (SPEC-12 §2). API-17 dùng làm cơ sở cho:

1. Backend triển khai controller/service/DTO dưới prefix `/api/v1/job-openings`, `/api/v1/candidates`, `/api/v1/interviews`, `/api/v1/offers`.
2. Frontend triển khai 6 màn `REC-SCREEN-001..006` (`apps/app/src/routes/recruit/`).
3. QA viết ma trận allow/deny per-pair, IDOR/cross-tenant, FSM, race double-convert cho khu vực RECRUIT.

---

## 3. Căn cứ thiết kế

1. **API-01** — prefix `/api/v1`, envelope/lỗi/pagination chuẩn, header `X-Request-Id`/`Idempotency-Key`, authentication + permission + data scope + business validation + audit.
2. **SPEC-12 RECRUIT** — nguồn sự thật nghiệp vụ: nguyên tắc (§3), permission 16 cặp (§11), 15 mã lỗi (§12), 4 FSM + convert + data scope (§13), API (§15), sự kiện (§17), audit/masking (§18), REC-DEC-001..008 (§22).
3. **DB-14** — 8 bảng mới (RLS+FORCE, composite tenant FK), sổ stage append-only, chốt cuối UNIQUE (double-convert · 1 offer sống · 1 feedback/interviewer).
4. **DB-09 §8.18** — index RECRUIT; **DB-10** — seed role `recruiter` + 16 cặp + 42 grant + audit UNION-ADD + 4 event NOTI.
5. **permission-matrix-spec §9f** — ma trận data_scope per-(perm, role).
6. **API-03 HR** — convert tạo nhân viên qua service HR (SequenceService `employee_code` ensure-on-miss); interviewer là `employees`.
7. **API-09 FOUNDATION** — `audit_logs`; **tệp CV đi qua Foundation Files** (`file_links.entity_type='candidate'`, private, `file_access_logs`) — RECRUIT không có route file riêng.
8. **API-14 ASSET** — khuôn hiện thực gần nhất (FSM + masking + `@Idempotent()` + hình dạng `details` mảng `ErrorDetail`).

---

## 4. Phạm vi API-17

### 4.1 Bao gồm trong v1

| Nhóm API | Mô tả |
| --- | --- |
| Job Openings | CRUD + FSM Draft/Open/Paused/Closed + gán recruiter (NOTI) |
| Candidates | Danh sách/lọc (mask PII) · tạo (idempotent) · check-duplicate · chi tiết · sửa · export CSV (audit) · summary phễu |
| Pipeline | Move-stage kèm lý do (sổ append-only) · timeline · ghi chú |
| Interviews | Xếp lịch (NOTI interviewer) · sửa · Completed/Cancelled · feedback own-scope |
| Offers | Tạo/sửa/đổi trạng thái · lương mask theo `('manage','offer')` |
| Convert | Ứng viên trúng tuyển → nhân viên HR (1 bước, race-safe) |
| Pickers | Danh bạ chọn interviewer / user phụ trách — trường bó hẹp, gác bằng cặp GHI RECRUIT (role `recruiter` không có cặp HR/AUTH) |

### 4.2 Không bao gồm (ngoài phạm vi v1 — SPEC-12 §5.2)

- Route upload/tải tệp CV riêng (đi qua Foundation Files API-09) · custom stage · workflow duyệt offer · tạo tài khoản đăng nhập · calendar ngoài/booking ROOM · auto-purge ứng viên Rejected (PARK-RECRUIT-001) · endpoint xoá ứng viên/vị trí · report source effectiveness.

---

## 5. Endpoint tổng hợp RECRUIT (SPEC-12 §15)

Prefix: `/api/v1`

```http
GET    /api/v1/job-openings
POST   /api/v1/job-openings
GET    /api/v1/job-openings/{job_opening_id}
PATCH  /api/v1/job-openings/{job_opening_id}
POST   /api/v1/job-openings/{job_opening_id}/change-status

GET    /api/v1/candidates
POST   /api/v1/candidates
GET    /api/v1/candidates/check-duplicate
GET    /api/v1/candidates/summary
GET    /api/v1/candidates/export
GET    /api/v1/candidates/{candidate_id}
PATCH  /api/v1/candidates/{candidate_id}
POST   /api/v1/candidates/{candidate_id}/move-stage
GET    /api/v1/candidates/{candidate_id}/stage-events
GET    /api/v1/candidates/{candidate_id}/notes
POST   /api/v1/candidates/{candidate_id}/notes
PATCH  /api/v1/candidates/{candidate_id}/notes/{note_id}
POST   /api/v1/candidates/{candidate_id}/convert

GET    /api/v1/interviews
POST   /api/v1/interviews
GET    /api/v1/interviews/{interview_id}
PATCH  /api/v1/interviews/{interview_id}
POST   /api/v1/interviews/{interview_id}/change-status
POST   /api/v1/interviews/{interview_id}/feedback
PATCH  /api/v1/interviews/{interview_id}/feedback

GET    /api/v1/offers
POST   /api/v1/offers
GET    /api/v1/offers/{offer_id}
PATCH  /api/v1/offers/{offer_id}
POST   /api/v1/offers/{offer_id}/change-status

GET    /api/v1/recruit/pickers/employees
GET    /api/v1/recruit/pickers/recruiter-users
```

> Hai picker nằm dưới basePath `recruit/pickers` trong khi 30 route kia phẳng — controller riêng (`RecruitPickersController`, basePath `recruit/pickers`) vẫn khai chung `API_MODULE_TAGS` nhóm `RECRUIT` để OpenAPI + route-census (32) gom đúng module.

> **32 mã RECRUIT-API = 32 route HTTP** (không mã nào gói 2 route; `GET /offers/{offer_id}` = RECRUIT-API-030, hai picker = 031/032 — plan-review B4/B5). Route-census đếm route — WO BE regen census với 32, khai `API_MODULE_TAGS` cho `RECRUIT`. Ba route tĩnh `check-duplicate` / `summary` / `export` khai **TRƯỚC** `/candidates/{id}` (bài học `goals/tree`).

### 5.1 Bảng endpoint (stub — chi tiết DTO ở WO backend)

Bảng mã ↔ method/path ↔ cặp quyền ↔ audit/NOTI: xem **SPEC-12 §15** (nguồn sự thật, không nhân bản để tránh drift). Điểm buộc phải giữ khi hiện thực:

| Chủ đề | Ràng buộc |
| --- | --- |
| PII ứng viên | `email`/`phone` trả **dạng che** trừ khi caller giữ `('update','candidate')`; DTO kèm `piiMasked`; **check-duplicate không trả email/phone** của hồ sơ khớp; `full_name` là projection duy nhất được lộ trên đường `('view','interview')` + payload NOTI (SPEC-12 §18) |
| Lương offer | khoá `salary` **chỉ có mặt** khi caller giữ `('manage','offer')` — vắng khoá, không `null`; FE schema `.optional()` |
| Export | assert **cả hai cặp** `('export','candidate')` + `('view','candidate')`; > 10.000 dòng ⇒ 422 RECRUIT-ERR-015 (SPEC-12 §18) |
| FSM | 4 FSM ép ở service qua một hàm assert/loại (SPEC-12 §13.1–13.4); vi phạm → 409 đúng mã RECRUIT-ERR-001..004; `Hired` chỉ qua convert (014) — **Zod move-stage giữ enum ĐỦ 6 giá trị**, không cắt `Hired` ở biên (kẻo 014 thành mã chết — plan-review B2) |
| Convert | tiền điều kiện `stage='Offer'` + tồn tại offer `Accepted` + `employee_id IS NULL`; MỘT transaction, gọi **`HrWriteService.createEmployeeFromCandidateTx(tx, actor, input)`** — API nội bộ MỚI, KHÔNG gọi `createEmployee` (tự mint user + đòi scope employee/user + tự mở tx — plan-review B1); cổng duy nhất `('convert','candidate')` (SPEC-12 §13.5) |
| Picker danh tính | API-031/032 đi qua `RecruitPeopleRepository` — điểm chiếu danh tính DUY NHẤT, trường bó hẹp `{id, fullName, employeeCode?}` (SPEC-12 §18, khuôn ROOM `room-people.repository`) |
| Chốt cuối DB | race convert/offer/feedback → bóc `23505` từ `error.cause` (drizzle bọc) → 008/006/012, **không 500** |
| Own-scope interview | scope Own = `EXISTS interview_participants` theo employee của caller; ngoài scope → **404** RECRUIT-ERR-010 (không 403); feedback not-participant (thấy lượt ở Company) → **403** 011 |
| Idempotency | `@Idempotent()` dùng chung trên POST tạo (007/019/026/029); key **do client sinh khi mở form**; TTL 15′; replay + `Idempotency-Replayed: true` |
| Audit | mọi mutation quan trọng ghi `audit_logs` cùng transaction; export ghi audit; tải CV ghi `file_access_logs`; payload audit **không** PII/lương |
| NOTI | outbox bridge, 4 event catalog `DedupeKey` (SPEC-12 §17); seed (DB-14 §9C) merge trước khi registrar boot |
| UUID biên | mọi `{id}` qua pipe cấp method (không `@UsePipes` cấp class); ratchet param-uuid không tăng |
| Hai tầng guard | cặp quyền khai ở decorator route **và** service; census QA so từng route theo MÃ ở cả hai tầng |

### 5.2 Trạng thái hiện thực (đối chiếu code)

| Mã | Trạng thái | Ghi chú |
| --- | --- | --- |
| RECRUIT-API-001..032 | ✅ Đã hiện thực (S12-RECRUIT-BE-1, 31/08/2026) | 5 controller `apps/api/src/recruit/recruit.controllers.ts`; cặp quyền đọc từ bảng hằng `recruit-route-pairs.const.ts` (census 2 tầng `recruit-two-layer-guard-census.unit-spec.ts`); DTO = `packages/contracts/src/recruit.ts`; route census 539/500 gated |

> Lệch giữa thiết kế và code ⇒ **sửa code**, không sửa ngầm tài liệu (CLAUDE.md — docs/spec + docs/DB là chuẩn).

---

## 6. Chuẩn response, lỗi, pagination, idempotency (theo API-01)

### 6.1 Envelope thành công — ví dụ chi tiết ứng viên (caller CHỈ có `('view','candidate')`)

```json
{
  "success": true,
  "message": "Lấy dữ liệu thành công",
  "data": {
    "id": "…",
    "fullName": "Phạm Thị D",
    "email": "d***@***.com",
    "phone": "09** *** *45",
    "piiMasked": true,
    "source": "TopCV",
    "stage": "Interview",
    "jobOpening": { "id": "…", "title": "NV Kinh doanh", "status": "Open" },
    "employeeId": null,
    "openOffer": { "id": "…", "status": "Sent", "startDate": "2026-09-15" },
    "counts": { "stageEvents": 3, "interviews": 2, "notes": 1, "files": 1 }
  },
  "meta": { "request_id": "req_…", "timestamp": "2026-08-31T09:00:00+07:00" }
}
```

> Caller giữ `('update','candidate')` nhận `email`/`phone` **đầy đủ** + `piiMasked: false`. `openOffer` **không** có khoá `salary` trừ khi caller giữ `('manage','offer')`.

### 6.2 Envelope list + pagination

Chuẩn API-01 (`data[]` + `pagination { page, per_page, total, total_pages, has_next, has_prev }`) cho `GET /job-openings` · `/candidates` · `/candidates/{id}/stage-events` · `/candidates/{id}/notes` · `/interviews` · `/offers`.

### 6.3 Phễu tuyển dụng (`GET /candidates/summary`)

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "byStage": { "New": 6, "Screening": 4, "Interview": 3, "Offer": 2, "Hired": 5, "Rejected": 12 },
    "openJobOpenings": 4
  },
  "meta": { "request_id": "req_…", "timestamp": "…" }
}
```

### 6.4 Envelope lỗi + mã lỗi

Namespace `RECRUIT-ERR-001..015` — định nghĩa đầy đủ ở SPEC-12 §12. `error.details` là **mảng** `ErrorDetail {field, message, rule}`; `details.kind` = phần tử `field:"kind"`. Vế hình thức (thiếu `reason`, `rating` ngoài 1–5, khoá lạ `.strict()`, `:id` không UUID) chặn ở Zod ⇒ **400 `VALIDATION-ERR-001`**. Riêng `toStage='Hired'` **KHÔNG chặn ở Zod** — service trả 409 RECRUIT-ERR-014 (plan-review B2).

Ánh xạ HTTP:

| HTTP | Dùng cho |
| --- | --- |
| `400` | Body/param sai định dạng (`VALIDATION-ERR-001`) |
| `403` | Thiếu cặp quyền (`AUTH-ERR-FORBIDDEN`) · RECRUIT-ERR-011 (not-participant) |
| `404` | RECRUIT-ERR-009 (nhân viên/user không thuộc company) · 010 (sentinel not-found/ngoài scope — một phản hồi duy nhất) |
| `409` | RECRUIT-ERR-001..008 · 012 · 014 · mã idempotency chung `REQUEST-ERR-IDEMPOTENCY-*` |
| `422` | RECRUIT-ERR-009 (nhân viên không `active`) · 013 (khoảng thời gian/ngày) · 015 (export vượt trần 10.000 dòng) |

```json
{
  "success": false,
  "message": "Không thể chuyển ứng viên sang Hired bằng tay — dùng chức năng chuyển thành nhân viên",
  "error": { "code": "RECRUIT-ERR-014", "type": "ConflictException", "details": [ { "field": "kind", "message": "hired-via-convert-only", "rule": "recruit-fsm" }, { "field": "from", "message": "Offer", "rule": "recruit-fsm" } ] },
  "meta": { "request_id": "req_…", "timestamp": "…" }
}
```

### 6.5 Idempotency

`POST /candidates` · `POST /interviews` · `POST /offers` · `POST /candidates/{id}/convert` gắn `@Idempotent()` (interceptor dùng chung, BACKEND-12 §14.1): key **client sinh khi mở form**, khoá scope `company_id + user_id + method + path + key`, TTL 15′ (`IDEMPOTENCY_TTL_SEC = 900`), header không bắt buộc ở interceptor (back-compat), replay phát lại envelope nguyên trạng + `Idempotency-Replayed: true`. FE RECRUIT **luôn** gửi header. Chống trùng **nghiệp vụ** (double-convert, 2 offer sống, 2 feedback) là việc của UNIQUE ở DB, không phải idempotency.

---

## 7. Dữ liệu RECRUIT (SPEC-12 §16, DB-14)

- RECRUIT **không tạo lại**: `employees` (`employee_profiles`), `users`, `org_units`/`positions`, `audit_logs`, `files`/`file_links`/`file_access_logs`, `notification_*`, counter `employee_code` (HR).
- Bảng canonical do RECRUIT sở hữu: `job_openings` · `candidates` · `candidate_stage_events` · `candidate_notes` · `interviews` · `interview_participants` · `interview_feedbacks` · `offers`. RLS+FORCE mọi bảng; `candidate_stage_events` **append-only tuyệt đối**; không bảng nào có DELETE cho app role. Chi tiết cột: DB-14 §6; index: DB-09 §8.18; seed: DB-10.

---

## 8. Trạng thái tài liệu & việc còn nợ

| Hạng mục | Trạng thái |
| --- | --- |
| Tên file + prefix + danh sách endpoint §5 + cặp quyền | ✅ Khoá ở stub này |
| Nguyên tắc bắt buộc (FSM/chốt-cuối/masking/own-scope/audit/idempotency) | ✅ Ghi rõ (§5.1) |
| Cross-link SPEC-12 / DB-14 / DB-09 / DB-10 / §9f / API-01 | ✅ |
| DTO request/response chi tiết + `packages/contracts/src/recruit.ts` | ⏳ `S12-RECRUIT-BE-1` |
| Đối chiếu endpoint đã ship vs thiết kế (§5.2) | ⏳ cập nhật khi `S12-RECRUIT-BE-1` đóng |
| OpenAPI/Swagger nhóm RECRUIT (`API_MODULE_TAGS`) | ⏳ `S12-RECRUIT-BE-1` |
| Flip Stub → Approved | ✅ owner duyệt gói wave 31/08/2026 (đồng bộ SPEC-12 §1 + DB-14 §1) |

---

## 9. Liên quan

- **Đặc tả nghiệp vụ (nguồn sự thật):** [SPEC-12 RECRUIT](<../SPEC/SPEC-12 RECRUIT.md>) — §11 permission, §12 mã lỗi, §13 FSM/convert/scope, §15 API, §17 sự kiện, §18 audit/masking, §22 quyết định.
- **Chuẩn API:** [API-01 Tổng quan](<API-01 TỔNG QUAN.md>).
- **Thiết kế DB:** [DB-14 RECRUIT Database Design](<../DB/DB-14 RECRUIT Database Design.md>) · [DB-09 §8.18](<../DB/DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 seed RECRUIT](<../DB/DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>).
- **Phân quyền:** [Ma trận phân quyền §9f](<../permission-matrix-spec.md>).
- **Chỉ mục:** [README §9](<../README.md>).
