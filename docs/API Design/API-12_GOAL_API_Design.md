# API-12: GOAL API DESIGN (Mục tiêu — Phòng ban · Dự án · Nhân viên)

**MODULE GOAL - MỤC TIÊU - API DESIGN**

> **📚 Bộ tài liệu API — Hệ thống Quản lý Doanh nghiệp**
> [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [API-02 AUTH](<API-02 AUTH API Design.md>) · [API-03 HR](<API-03_HR_API_Design.md>) · [API-04 ATT](<API-04_ATT_API_Design.md>) · [API-05 LEAVE](<API-05_LEAVE_API_Design.md>) · [API-06 TASK](<API-06_TASK_API_Design.md>) · [API-07 NOTI](<API-07_NOTI_API_Design.md>) · [API-08 DASH](<API-08_DASH_API_Design.md>) · [API-09 FOUNDATION](<API-09_FOUNDATION_API_Design.md>) · [API-10 Permission Matrix](<API-10 PERMISSION MATRIX.md>) · [API-11 ME](<API-11_ME_API_Design.md>) · **API-12 GOAL**
>
> **Nguồn & liên quan:** [Chuẩn API: API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [Đặc tả: SPEC-10 GOAL](<../SPEC/SPEC-10 GOAL.md>) · [Thiết kế DB: DB-11 GOAL Database Design](<../DB/DB-11 GOAL Database Design.md>) · [DB-09 Index](<../DB/DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 Seed GOAL](<../DB/DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>) · [Ma trận phân quyền](<../permission-matrix-spec.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | API-12 |
| Tên tài liệu | GOAL API Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | GOAL - Mục tiêu (Phòng ban · Dự án · Nhân viên) |
| Phiên bản | v0.1 |
| Trạng thái | **Stub — Approved** (owner duyệt PR S5-GOAL-DOC-1, 23/07/2026, cùng SPEC-10 §1). Khung endpoint đã chốt; DTO chi tiết bổ sung ở WO backend GOAL |
| Giai đoạn | MVP Version 1.0 - bổ sung (sau SPEC-09 ME) |
| Tài liệu nguồn | SPEC-10 GOAL, API-01 Tổng quan, DB-11, DB-09/10, permission-matrix-spec |
| Ngày tạo | 23/07/2026 |
| Ngày cập nhật | 23/07/2026 |

> **Trạng thái Stub:** Tài liệu này khoá **tên file + danh sách endpoint + nguyên tắc bắt buộc** để README/SPEC-10 §15/§23 trỏ nhất quán. Chi tiết DTO/schema request-response, mã lỗi `GOAL-ERR-XXX` đầy đủ và ví dụ payload sẽ được bổ sung ở các WO backend GOAL (`S5-GOAL-BE-*`). GOAL sở hữu riêng dữ liệu cây mục tiêu + sổ check-in + template phân rã — không sở hữu task/employee/project.

---

## 2. Mục đích tài liệu

Tài liệu này mô tả thiết kế API cho module **GOAL (Mục tiêu)** — nơi công ty đặt và theo dõi mục tiêu theo kỳ (quý/năm) ở 3 cấp (phòng ban → dự án → nhân viên), liên kết xuống task để đo tiến độ khách quan (SPEC-10 §2–§3).

API-12 dùng làm cơ sở cho:

1. Backend triển khai controller/service/DTO cho module GOAL dưới prefix `/api/v1/goals` (+ `/api/v1/task-templates`, `/api/v1/me/goals`).
2. Frontend triển khai màn hình GOAL (cây mục tiêu theo kỳ, chi tiết goal, check-in, chốt kỳ, phân rã từ template).
3. QA viết test deny-path/IDOR/cross-tenant + chốt kỳ + đo tiến độ cho khu vực GOAL.

---

## 3. Căn cứ thiết kế

API-12 tuân thủ các quyết định đã chốt trong bộ tài liệu:

1. **API-01** — prefix `/api/v1`, envelope response/error thống nhất, pagination chuẩn, header `X-Request-Id` / `Idempotency-Key`, bắt buộc kiểm tra authentication + permission + data scope + business validation + audit.
2. **SPEC-10 GOAL** — nguồn sự thật nghiệp vụ: phạm vi (§3), permission (§11), quy tắc nghiệp vụ & mã lỗi (§12), đo tiến độ (§13), yêu cầu API (§15), sự kiện/thông báo (§17), audit & bảo mật (§18), GOAL-DEC-001..010 (§22).
3. **DB-11** — bảng `goals` (RLS+FORCE), `goal_updates` (append-only, không UPDATE/DELETE), `task_templates`/`task_template_items`, cột `tasks.goal_id`.
4. **DB-09 §8.14** — index GOAL (`idx_goals_company_level_period`, `idx_goals_company_parent`, `idx_goals_company_employee`, `idx_goals_company_project`, `idx_tasks_company_goal`, `idx_goal_updates_goal`).
5. **DB-10** — seed module `GOAL` + 7 cặp permission wave lõi + `sequence_counters` cho `goal_code` + UNION-ADD `'goal'` vào CHECK `audit_logs.object_type`.
6. **permission-matrix-spec §9b** — ánh xạ 8 cặp quyền GOAL sang tuple `(action, resource_type)` mà permission engine thực thi.
7. **API-06 TASK** — GOAL liên kết `tasks.goal_id`, gọi lại `ProjectsService.countsByStatusLeaf` cho mode `project` (DECISIONS-05, không đọc `projects.progress_percent`).
8. **API-09 FOUNDATION** — OutboxNotificationBridge phát `GOAL_ASSIGNED`/`GOAL_FINALIZED` (event catalog seed trước ở DB-11 §9 bước 0507).

---

## 4. Phạm vi API-12

### 4.1 Bao gồm trong MVP

| Nhóm API | Mô tả |
| --- | --- |
| GOAL CRUD | Tạo/sửa/xóa mềm/xem chi tiết/cây mục tiêu theo kỳ |
| GOAL Check-in | Ghi nhận tiến độ (manual), xem lịch sử check-in |
| GOAL Finalize | Chốt kỳ / mở lại (reopen) |
| GOAL Task linking | Gắn/tháo task vào goal (mode `tasks`) |
| GOAL Decompose | Phân rã mục tiêu thành nhiều task từ template (transaction) |
| Task Template | Danh mục template + item để phân rã |
| ME Goals | `GET /me/goals` — own-scope, resolve employee từ token (chuẩn SPEC-09 §14.4) |

### 4.2 Không bao gồm (ngoài phạm vi API-12 hiện tại)

- Cấp `company` (schema chừa sẵn, MVP không có UI — GOAL-ERR-004).
- Key Results tách bảng riêng (GOAL-DEC-001 — thêm `level='kr'` sau nếu cần).
- Luồng phê duyệt goal (GOAL-DEC-003 — điểm kiểm soát MVP = finalize).
- Phân rã bằng AI (GOAL-DEC-004 — ngoài scope).
- Check-in reminder định kỳ (SPEC-10 §17 — phase sau).
- PERF/KPI Phase 2 (đọc read-only qua `goal_id`, không thuộc API-12).

---

## 5. Endpoint tổng hợp GOAL (SPEC-10 §15)

Prefix: `/api/v1`

```http
GET    /api/v1/goals
POST   /api/v1/goals
GET    /api/v1/goals/{goal_id}
PATCH  /api/v1/goals/{goal_id}
DELETE /api/v1/goals/{goal_id}
GET    /api/v1/goals/tree
POST   /api/v1/goals/{goal_id}/check-in
GET    /api/v1/goals/{goal_id}/updates
POST   /api/v1/goals/{goal_id}/finalize
POST   /api/v1/goals/{goal_id}/reopen
GET    /api/v1/goals/{goal_id}/tasks
POST   /api/v1/goals/{goal_id}/tasks
DELETE /api/v1/goals/{goal_id}/tasks/{task_id}
POST   /api/v1/goals/{goal_id}/decompose
GET    /api/v1/task-templates
POST   /api/v1/task-templates
PATCH  /api/v1/task-templates/{template_id}
DELETE /api/v1/task-templates/{template_id}
GET    /api/v1/me/goals
```

### 5.1 Bảng endpoint (stub — chi tiết DTO ở WO backend)

| Mã | Method | Path | Chức năng | Permission GOAL (SPEC-10 §11) | Ghi audit |
| --- | --- | --- | --- | --- | --- |
| GOAL-API-001 | GET | `/api/v1/goals` | Danh sách mục tiêu — filter level/departmentId/projectId/employeeId/periodStart/End/status/parentGoalId; pagination | `('view','goal')` | — |
| GOAL-API-002 | POST | `/api/v1/goals` | Tạo mục tiêu (validate §12) | `('create','goal')` | ✅ |
| GOAL-API-003 | GET | `/api/v1/goals/{goal_id}` | Chi tiết goal kèm breadcrumb cha + đếm con | `('view','goal')` | — |
| GOAL-API-004 | PATCH | `/api/v1/goals/{goal_id}` | Sửa goal; chặn khi đã chốt kỳ (GOAL-ERR-005) | `('update','goal')` | ✅ |
| GOAL-API-005 | DELETE | `/api/v1/goals/{goal_id}` | Xóa mềm; chặn khi còn con active (GOAL-ERR-007) | `('delete','goal')` | ✅ |
| GOAL-API-006 | GET | `/api/v1/goals/tree` | Cây mục tiêu theo kỳ + phòng ban, kèm progress từng nút | `('view','goal')` | — |
| GOAL-API-007 | POST | `/api/v1/goals/{goal_id}/check-in` | Check-in tiến độ (currentValue?/progressPercent?/confidence?/note) | `('checkin','goal')` | ✅ |
| GOAL-API-008 | GET | `/api/v1/goals/{goal_id}/updates` | Lịch sử check-in/finalize/reopen, pagination | `('view','goal')` | — |
| GOAL-API-009 | POST | `/api/v1/goals/{goal_id}/finalize` · `/reopen` | Chốt kỳ / mở lại | `('finalize','goal')` | ✅ |
| GOAL-API-010 | GET/POST/DELETE | `/api/v1/goals/{goal_id}/tasks[/{task_id}]` | Xem/gắn (bulk)/tháo task khỏi goal; validate neo GOAL-ERR-008 | `('update','goal')` + permission nguồn TASK | ✅ (POST/DELETE) |
| GOAL-API-011 | POST | `/api/v1/goals/{goal_id}/decompose` | Phân rã từ template (bulk task, 1 transaction, giới hạn 50) | `('update','goal')` + `('manage','task-template')` để chọn template | ✅ |
| GOAL-API-012 | GET/POST/PATCH/DELETE | `/api/v1/task-templates[/{template_id}]` (+ items) | CRUD danh mục template phân rã | `('manage','task-template')` | ✅ (write) |
| GOAL-API-013 | GET | `/api/v1/me/goals` | Mục tiêu của tôi — own-scope, resolve employee từ token (không nhận employee_id từ client, chuẩn SPEC-09 §14.4) | `('view','goal')` scope Own | — |

> **Notation permission:** Chuỗi `('action','resource')` ở trên là **cặp engine thực thi** (permission-matrix-spec §9b + DB-10 seed) — không phải chuỗi dotted `MODULE.RESOURCE.ACTION` hiển thị FE.

### 5.2 Trạng thái hiện thực (đối chiếu code, cập nhật 23/07/2026)

Bảng §5.1 là **thiết kế đích**. Phần đã có code sống trong `apps/api/src/goals/` (S5-GOAL-BE-1, PR #263) — ghi ở đây để tài liệu không mâu thuẫn ngầm với runtime:

| Mã | Trạng thái | Ghi chú |
| --- | --- | --- |
| GOAL-API-001..006 | ✅ LIVE | `goals.controller.ts` — route `/goals/tree` khai **trước** `/goals/:id` (kẻo `tree` bị bắt làm id) |
| GOAL-API-013 | ✅ LIVE | `me-goals.controller.ts` — employee resolve từ token, DTO **không khai** `employeeId` |
| GOAL-API-007, 008 | ⏳ Chưa | Check-in + lịch sử — WO backend GOAL kế tiếp |
| GOAL-API-009 | ⏳ Chưa (một phần đã chặn) | Writer `finalized_at` chưa có; nhưng PATCH/DELETE **đã** guard GOAL-ERR-005 sẵn |
| GOAL-API-010, 011, 012 | ⏳ Chưa | Link task · decompose · task-template |

> Lệch giữa bảng này và code ⇒ **sửa code**, không sửa ngầm tài liệu (CLAUDE.md — docs/spec + docs/DB là chuẩn). Riêng cột "Trạng thái hiện thực" là ảnh chụp tiến độ, cập nhật khi WO backend đóng.

---

## 6. Nguyên tắc API BẮT BUỘC (SPEC-10 §14, §18)

1. **Trạng thái UI bắt buộc phía client, dữ liệu phía server** — mọi response phải đủ thông tin để FE dựng loading/error/empty/"chưa đo" (`progress_percent: null`, KHÔNG trả `0`)/"đã chốt kỳ" (SPEC-10 §14).
2. **Level↔neo đúng 1 cột** — service validate đúng 1 cột neo theo `level` (`department_id`/`project_id`/`employee_id`), các cột neo khác PHẢI NULL (GOAL-ERR-001); không denormalize phòng/dự án từ neo + parent.
3. **Chốt kỳ đóng băng toàn bộ đường ghi** — mọi update/check-in/link/decompose/recompute sau `finalized_at` trả GOAL-ERR-005; goal cha đọc số con đã chốt khi rollup.
4. **Data scope ép ở service layer**, không phải RLS (RLS chỉ cô lập tenant) — `buildReadScopeExists` pattern; FE chỉ ẩn/hiện bằng `<PermissionGate>`, không hard-code role.
5. **`/me/goals` resolve employee từ token** — không có tham số nào cho phép client truyền `employee_id` khác (chống IDOR, mirror ME-DEC).
6. **Recompute sync trong transaction + đối soát đêm** — task đổi trạng thái/gắn/tháo → recompute goal `tasks` liên quan → bubble `children` tối đa 3 tầng, cùng transaction; job đối soát đêm sửa drift, chỉ ghi audit khi CÓ THAY ĐỔI THẬT (mirror S5-LMS-BE-4).
7. **Mutation quan trọng ghi audit** — create/update/delete/finalize/reopen/decompose/link-unlink (`object_types` CHECK mở rộng theo UNION, hot-file rule).
8. **`company_id` ở mọi query** — mọi truy vấn đi qua `withTenant(companyId, fn)`.
9. **Notification qua OutboxNotificationBridge** — enqueue trong cùng transaction, KHÔNG `io.emit`/gọi thẳng; payload chỉ goal name + link, không số liệu nhạy cảm.

---

## 7. Chuẩn response, lỗi, pagination, idempotency (theo API-01)

### 7.1 Envelope thành công (object)

```json
{
  "success": true,
  "message": "Lấy dữ liệu thành công",
  "data": { "...": "..." },
  "meta": { "request_id": "req_...", "timestamp": "2026-07-23T10:00:00+07:00" }
}
```

### 7.2 Envelope list + pagination (vd. `GET /goals`, `GET /goals/{id}/updates`)

```json
{
  "success": true,
  "message": "Lấy danh sách thành công",
  "data": [ { "...": "..." } ],
  "pagination": { "page": 1, "per_page": 20, "total": 100, "total_pages": 5, "has_next": true, "has_prev": false },
  "meta": { "request_id": "req_...", "timestamp": "2026-07-23T10:00:00+07:00" }
}
```

### 7.3 Tiến độ "chưa đo" (SPEC-10 §13.2)

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "goal_id": "...",
    "progress_mode": "tasks",
    "progress_percent": null,
    "progress_state": "no_data"
  },
  "meta": { "request_id": "req_...", "timestamp": "2026-07-23T10:00:00+07:00" }
}
```

### 7.4 Envelope lỗi + mã lỗi

Mã lỗi theo format API-01 §13 `MODULE-ERR-CODE`. Namespace GOAL gồm **hai nhóm**:

- **Đánh số** `GOAL-ERR-001`..`GOAL-ERR-015` — vi phạm quy tắc nghiệp vụ, định nghĩa đầy đủ ở SPEC-10 §12.
- **Đặt tên** — nhóm sentinel chung của module (đúng quy ước sẵn có: `HR-ERR-CONTRACT-DATE`, `ATT-ERR-SELF-APPROVAL`…), KHÔNG chiếm số trong dãy §12:

| Mã sentinel | HTTP | Ý nghĩa | Nguồn |
| --- | ---: | --- | --- |
| `GOAL-ERR-NOT-FOUND` | 404 | Goal (hoặc department/project/employee/parent tham chiếu) không tồn tại **trong company** — chéo tenant trả 404 sạch, không vỡ FK thành 500 | `goals.errors.ts` (LIVE) |
| `GOAL-ERR-FORBIDDEN` | 403 | Ngoài data scope, hoặc ghi vào phòng/dự án/nhân viên ngoài phạm vi, hoặc parent ngoài scope | `goals.errors.ts` (LIVE) |
| `GOAL-ERR-TREE-TOO-LARGE` | 422 | `GET /goals/tree` vượt CAP nút trong một lần dựng → yêu cầu lọc hẹp lại (**không cắt câm**) | `goals.errors.ts` (LIVE) |

Dùng lại nhóm lỗi chung của API-01:

| Mã lỗi | HTTP | Ý nghĩa |
| --- | ---: | --- |
| `AUTH-ERR-UNAUTHENTICATED` | 401 | Chưa đăng nhập / token không hợp lệ |
| `AUTH-ERR-FORBIDDEN` | 403 | Không có permission GOAL cần thiết |
| `AUTH-ERR-SCOPE-DENIED` | 403 | Truy cập ngoài data scope (own/department) |
| `RESOURCE-ERR-NOT-FOUND` | 404 | Goal/template không tồn tại hoặc không thuộc company |
| `VALIDATION-ERR-001` | 400 | Body sai định dạng |
| `GOAL-ERR-001`..`GOAL-ERR-015` | 422/409 | Vi phạm quy tắc nghiệp vụ GOAL — chi tiết SPEC-10 §12 (stub, chốt DTO ở WO backend) |

```json
{
  "success": false,
  "message": "Mục tiêu đã chốt kỳ, không thể chỉnh sửa",
  "error": { "code": "GOAL-ERR-005", "type": "BusinessRuleError", "details": null },
  "meta": { "request_id": "req_...", "timestamp": "2026-07-23T10:00:00+07:00" }
}
```

### 7.5 Idempotency

`POST /goals/{id}/decompose` (bulk task) và `POST /goals/{id}/finalize` **nên** nhận header `Idempotency-Key` (API-01 §21). Khóa idempotency scope theo `company_id + user_id + method + path + idempotency_key`, TTL ví dụ 24 giờ; replay trả `meta.idempotent_replay: true`.

---

## 8. Dữ liệu GOAL (SPEC-10 §16, DB-11)

- GOAL **không tạo lại**: `tasks`, `employees`, `departments`, `projects` — chỉ thêm cột `tasks.goal_id` (nullable FK).
- Bảng canonical do GOAL sở hữu: `goals` · `goal_updates` (append-only) · `task_templates` · `task_template_items`. RLS+FORCE mọi bảng; `goal_updates` app role **không có** UPDATE/DELETE. Chi tiết cột: DB-11 §6; index: DB-09 §8.14; seed: DB-10.

---

## 9. Trạng thái tài liệu & việc còn nợ

| Hạng mục | Trạng thái |
| --- | --- |
| Tên file + prefix + danh sách endpoint §5 | ✅ Khoá ở stub này |
| Nguyên tắc bắt buộc (level-neo/chốt kỳ/scope/recompute/audit/tenant) | ✅ Ghi rõ (§6) |
| Cross-link SPEC-10 / DB-11 / DB-09 / DB-10 / permission-matrix / API-01 | ✅ |
| Đối chiếu endpoint đã ship vs thiết kế (§5.2) + sentinel `GOAL-ERR-*` đang phát (§7.4) | ✅ chốt tại S5-GOAL-BE-1 (PR #263) |
| DTO request/response chi tiết từng endpoint | ⏳ WO backend GOAL (`S5-GOAL-BE-*`) |
| Danh mục mã lỗi `GOAL-ERR-XXX` với ví dụ payload đầy đủ | ⏳ WO backend GOAL |
| OpenAPI/Swagger cho nhóm GOAL | ⏳ WO backend/devops GOAL |
| Flip Trạng thái Stub/Draft → Approved | ✅ owner duyệt PR S5-GOAL-DOC-1 (23/07/2026, đồng bộ SPEC-10 §1 + DB-11 §1) |

---

## 10. Liên quan

- **Đặc tả nghiệp vụ (nguồn sự thật):** [SPEC-10 GOAL](<../SPEC/SPEC-10 GOAL.md>) — §11 permission, §12 mã lỗi, §13 đo tiến độ, §15 API, §17 sự kiện, §18 audit/bảo mật, §22 GOAL-DEC.
- **Chuẩn API:** [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) — envelope, mã lỗi, pagination, idempotency.
- **Thiết kế DB:** [DB-11 GOAL Database Design](<../DB/DB-11 GOAL Database Design.md>) · [DB-09 §8.14 index](<../DB/DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 seed GOAL](<../DB/DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>).
- **Phân quyền:** [Ma trận phân quyền §9b](<../permission-matrix-spec.md>).
- **Chỉ mục:** [README §9](<../README.md>).
