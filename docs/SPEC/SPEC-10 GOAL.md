# SPEC-10: GOAL - MỤC TIÊU (PHÒNG BAN · DỰ ÁN · NHÂN VIÊN)

> **📚 Bộ tài liệu SPEC — Hệ thống Quản lý Doanh nghiệp**
> [SPEC-01 Tổng quan](<SPEC-01 Tổng quan.md>) · [SPEC-02 AUTH](<SPEC-02 AUTH.md>) · [SPEC-03 HR](<SPEC-03 HR.md>) · [SPEC-04 ATT](<SPEC-04 ATT.md>) · [SPEC-05 LEAVE](<SPEC-05 LEAVE.md>) · [SPEC-06 TASK](<SPEC-06 TASK.md>) · [SPEC-07 DASH](<SPEC-07 DASH.md>) · [SPEC-08 NOTI](<SPEC-08 NOTI.md>) · [SPEC-09 ME](<SPEC-09 ME.md>) · **SPEC-10 GOAL**
>
> **Liên quan:** [Chỉ mục tài liệu](<../README.md>) · [DB-11 GOAL Database Design](<../DB/DB-11 GOAL Database Design.md>) · [Ma trận phân quyền](<../permission-matrix-spec.md>)

---

## 1. Thông tin tài liệu

| Trường                     | Nội dung                                                 |
| -------------------------- | -------------------------------------------------------- |
| Mã tài liệu                | SPEC-10                                                   |
| Tên tài liệu               | GOAL - Mục tiêu (Phòng ban · Dự án · Nhân viên)           |
| Module code                | GOAL                                                      |
| Tài liệu cha               | SPEC-01: Tổng quan hệ thống                               |
| Module phụ thuộc trực tiếp | AUTH (RBAC), HR (departments/employees), TASK (projects/tasks) |
| Module liên quan           | NOTI, DASH, ME, FOUNDATION; PERF/KPI (Phase 2 — tương lai) |
| Phiên bản                  | v1.0                                                      |
| Trạng thái                 | Draft (chờ owner duyệt PR S5-GOAL-DOC-1 → Approved)       |
| Giai đoạn                  | MVP Version 1.0 - bổ sung (sau SPEC-09 ME)                |
| Ngày tạo                   | 20/07/2026                                                |
| Ngày cập nhật              | 20/07/2026                                                |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả module **GOAL - Mục tiêu**: nơi công ty đặt và theo dõi mục tiêu theo **kỳ** (quý/năm) ở 3 cấp — **phòng ban → dự án → nhân viên** — và liên kết mục tiêu xuống **công việc (task)** để đo tiến độ hoàn thành một cách khách quan.

GOAL trả lời các câu hỏi:

```text
Kỳ này phòng ban tôi phải đạt gì? Đang đạt bao nhiêu %?
Dự án X phục vụ mục tiêu nào của phòng?
Nhân viên A kỳ này có những mục tiêu gì, tiến độ ra sao?
Con số % đó lấy từ đâu — nhập tay, từ dự án, hay từ số task đã Done?
Cuối kỳ, kết quả nào được "chốt" để sau này đánh giá hiệu quả nhân viên?
```

GOAL **không sở hữu** dữ liệu công việc: task vẫn thuộc TASK, nhân sự vẫn thuộc HR. GOAL chỉ sở hữu **cây mục tiêu + sổ check-in + con số tiến độ đã chốt**.

**Định vị cho tương lai (Phase 2 — PERF/KPI):** mục tiêu cấp nhân viên đã **chốt kỳ** là nguồn dữ liệu đầu vào cho module đánh giá hiệu quả sau này (`kpi_results` tham chiếu `goal_id` + snapshot điểm, read-only — không copy ngược, không tính lại).

---

## 3. Định nghĩa và nguyên tắc kiến trúc

### 3.1 Cây mục tiêu 4 cấp (MVP làm 3)

```text
(company)     — chừa sẵn trong schema, MVP KHÔNG làm UI
 └─ department — mục tiêu PHÒNG BAN theo kỳ
     ├─ project  — mục tiêu DỰ ÁN (thuộc đúng 1 project)
     └─ employee — mục tiêu NHÂN VIÊN (chủ thể = employee, không phải user)
          └─ tasks — công việc gắn vào mục tiêu qua `tasks.goal_id`
```

Quy tắc cha-con: `parent_goal_id` chỉ được trỏ lên goal **cấp cao hơn** trong cùng company:

- `employee` → cha là `project` HOẶC `department` (nhân viên có việc ngoài dự án).
- `project` → cha là `department`.
- `department` → cha là `company` (khi cấp company được bật, phase sau).
- Cấm vòng lặp, cấm cha-con khác cấp sai chiều. Cha là tùy chọn (goal có thể đứng độc lập).

### 3.2 Một goal — một nguồn đo (progress_mode độc quyền)

Mỗi goal chọn **đúng 1** nguồn đo tiến độ, không trộn để không đếm trùng:

| `progress_mode` | Liên kết vật lý | Công thức |
| --- | --- | --- |
| `manual` | check-in `goal_updates` | `current_value / target_value` (hoặc % nhập trực tiếp) |
| `project` | `goals.project_id` | đếm-lá task của dự án (cùng nguồn DECISIONS-05 — KHÔNG đọc cột `projects.progress_percent`) |
| `tasks` | `tasks.goal_id` | % task gắn vào goal có trạng thái Done (loại Cancelled) |
| `children` | `parent_goal_id` | `Σ(progress_con × weight) / Σ(weight)` |

Chi tiết công thức, recompute và quy tắc biên: **§13** (phần lõi của spec này).

### 3.3 Không sao chép dữ liệu nguồn

- GOAL không lưu lại tên phòng ban, tên dự án, tên nhân viên — join/hiển thị từ module nguồn.
- Task gắn goal bằng `tasks.goal_id` (TASK sở hữu cột, GOAL sở hữu nghiệp vụ gắn/tháo).
- Tiến độ dự án dẫn xuất bằng **đếm-lá** task của dự án qua service TASK dùng chung (`ProjectsService.countsByStatusLeaf` — DECISIONS-05 D-35, cùng nguồn số với widget project-progress). ⚠️ Cột `projects.progress_percent` tồn tại trong schema (0478) nhưng là **cột chết không writer nào nuôi** (xác minh code 2026-07-20) — CẤM đọc.

### 3.4 Điểm kiểm soát duy nhất = CHỐT KỲ (finalize)

MVP **không có luồng phê duyệt** khi tạo/sửa goal (GOAL-DEC-003). Kiểm soát chất lượng số liệu nằm ở bước **chốt kỳ**: quản lý bấm chốt → goal đóng băng (`finalized_at`), cấm mọi sửa đổi/check-in/recompute. Số đã chốt là số mà module đánh giá tương lai được phép tin.

---

## 4. Mục tiêu module

### 4.1 Mục tiêu nghiệp vụ

1. Phòng ban/dự án/nhân viên có mục tiêu rõ ràng theo kỳ, nhìn thấy được trên một cây duy nhất.
2. Tiến độ mục tiêu **khách quan** — dẫn xuất từ công việc thật khi có thể, nhập tay khi chỉ tiêu ngoài hệ thống.
3. Mục tiêu phân rã được thành task cụ thể (qua template, có màn hình duyệt trước khi tạo).
4. Kết quả cuối kỳ chốt được, làm nền cho đánh giá hiệu quả nhân viên (Phase 2).

### 4.2 Mục tiêu kỹ thuật

1. 1 bảng `goals` duy nhất cho cả 3 cấp (cây thuần — GOAL-DEC-001), RLS + FORCE theo `company_id`.
2. Sổ check-in `goal_updates` **append-only** (mở rộng danh sách bất biến #2).
3. Tiến độ là **dẫn xuất + cache** (`progress_percent`), recompute sync trong transaction + job đối soát đêm.
4. Permission `GOAL.*` per-pair data_scope theo chuẩn §13 permission matrix hiện hành.

---

## 5. Phạm vi module

### 5.1 Trong MVP (wave S5-GOAL)

| Nhóm | Nội dung |
| --- | --- |
| Cây mục tiêu | CRUD goal 3 cấp department/project/employee, cha-con, kỳ quý/năm/tùy chọn |
| Đo tiến độ | 4 progress_mode + rollup + cache + job đối soát |
| Check-in | Cập nhật `current_value` + confidence + ghi chú, sổ append-only |
| Chốt kỳ | finalize/reopen có quyền riêng + audit |
| Liên kết task | Gắn/tháo task↔goal từ panel task và từ trang goal (bulk) |
| Phân rã | Wizard tạo bulk task từ **task template** (GOAL-DEC-004 — KHÔNG có AI) |
| Thông báo | `GOAL_ASSIGNED` · `GOAL_FINALIZED` qua OutboxNotificationBridge |
| ME | Khối "Mục tiêu của tôi" trong /me |

### 5.2 Ngoài MVP (chừa thiết kế, KHÔNG làm đợt này)

| Nhóm | Ghi chú |
| --- | --- |
| Cấp company | `level='company'` đã có trong CHECK, service chặn tạo; bật ở phase sau |
| Key Results tách bảng | Nếu cần OKR chuẩn → thêm `level='kr'`, không đổi schema |
| Luồng phê duyệt goal | FSM duyệt khi tạo/sửa — chỉ thêm nếu thực tế vận hành đòi hỏi |
| AI phân rã | Gợi ý task bằng LLM — ngoài scope (owner chốt 2026-07-20) |
| Check-in reminder định kỳ | Cần scheduler; phase sau |
| Đánh giá/KPI | Phase 2 — đọc goal đã chốt, thuộc spec PERF tương lai |

---

## 6. Nhóm người dùng

| Nhóm | Nhu cầu chính |
| --- | --- |
| BOD / Admin | Nhìn toàn cảnh mục tiêu mọi phòng ban; chốt/mở kỳ ở mọi phạm vi |
| Trưởng đơn vị (phòng ban) | Tạo mục tiêu phòng; giao mục tiêu cho nhân viên; theo dõi + chốt kỳ trong phòng |
| Quản lý dự án (project Owner/Manager) | Tạo mục tiêu dự án, gắn task, phân rã từ template |
| Nhân viên | Xem mục tiêu phòng/dự án liên quan; tự tạo + check-in mục tiêu cá nhân |

---

## 7. Mối liên kết với các module khác

| Module | GOAL dùng gì | Chiều |
| --- | --- | --- |
| AUTH | permission `GOAL.*` per-pair data_scope; actor = user | GOAL ← AUTH |
| HR | `departments` (goal phòng ban), `employees` (owner + goal nhân viên) | GOAL ← HR |
| TASK | `projects` (goal dự án + mode `project`), `tasks.goal_id` (mode `tasks`), task template khi phân rã | GOAL ↔ TASK |
| NOTI | phát `GOAL_ASSIGNED` / `GOAL_FINALIZED` qua outbox bridge | GOAL → NOTI |
| DASH | widget "Mục tiêu kỳ này" đọc cache tiến độ | GOAL → DASH |
| ME | khối "Mục tiêu của tôi" (own-scope, resolve từ token) | GOAL → ME |
| FOUNDATION | `audit_logs`, `sequence_counters` (sinh `goal_code`) | GOAL ← FOUNDATION |
| PERF/KPI (Phase 2) | đọc goal nhân viên đã chốt kỳ làm đầu vào đánh giá | GOAL → PERF |

---

## 8. Cấu trúc thông tin mục tiêu

Một goal gồm các nhóm trường (chi tiết cột/kiểu/constraint: [DB-11](<../DB/DB-11 GOAL Database Design.md>)):

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Định danh | `goal_code`, `name`, `description` | code sinh qua `sequence_counters`, unique theo company |
| Cấp & neo | `level` + đúng 1 neo theo cấp (`department_id` / `project_id` / `employee_id`) + `parent_goal_id` | CHECK ràng buộc level↔neo |
| Chủ sở hữu | `owner_employee_id` | goal nhân viên: owner = chính employee đó |
| Kỳ | `period_type` (quarter/year/custom) + `period_start` + `period_end` | bắt buộc |
| Đo lường | `measure_type` (percent/number/boolean) + `target_value` + `current_value` + `unit` | dùng khi mode `manual` |
| Tiến độ | `progress_mode` + `progress_percent` (cache) + `weight` | weight > 0, mặc định 1 |
| Trạng thái | `status`: Draft / Active / Completed / Cancelled | **"At Risk" là dẫn xuất** — không lưu cứng (cùng triết lý overdue DB-06 §4.9) |
| Chốt kỳ | `finalized_at` + `finalized_by` | đóng băng mọi số liệu |

---

## 9. Danh sách màn hình

| Mã | Màn hình | Ghi chú |
| --- | --- | --- |
| GOAL-SCREEN-001 | Trang Mục tiêu (menu riêng) — cây/danh sách theo kỳ + phòng ban | filter: kỳ, cấp, phòng ban, trạng thái, owner |
| GOAL-SCREEN-002 | Chi tiết mục tiêu | tab: Tổng quan · Công việc gắn · Mục tiêu con · Lịch sử check-in |
| GOAL-SCREEN-003 | Form tạo/sửa mục tiêu | chọn cấp → hiện đúng field neo; chọn mode đo |
| GOAL-SCREEN-004 | Wizard phân rã từ template | chọn template → preview sửa/xóa/thêm/gán người/cột board → áp dụng |
| GOAL-SCREEN-005 | Khối "Mục tiêu của tôi" trong /me | own-scope, có nút check-in nhanh |
| GOAL-SCREEN-006 | Danh mục task template | CRUD template + items (quyền manage riêng) |

---

## 10. Chi tiết chức năng

| Mã | Chức năng | Mô tả ngắn |
| --- | --- | --- |
| GOAL-FUNC-001 | CRUD mục tiêu 3 cấp | tạo/sửa/xóa mềm; validate level↔neo↔parent (§12) |
| GOAL-FUNC-002 | Cây mục tiêu theo kỳ | query tree tối đa 3 tầng, kèm % từng nút |
| GOAL-FUNC-003 | Check-in | cập nhật current_value/confidence/note → ghi `goal_updates` append-only |
| GOAL-FUNC-004 | Đo tiến độ 4 mode + rollup | §13 |
| GOAL-FUNC-005 | Chốt kỳ / mở lại | finalize/reopen, quyền riêng, audit log bắt buộc |
| GOAL-FUNC-006 | Gắn/tháo task↔goal | từ panel task (picker) hoặc trang goal (bulk) |
| GOAL-FUNC-007 | Phân rã từ template | tạo bulk task trong 1 transaction, task tự mang `goal_id` |
| GOAL-FUNC-008 | Quản lý task template | CRUD template + items |
| GOAL-FUNC-009 | Thông báo | phát event khi giao goal + khi chốt kỳ |

---

## 11. Permission đề xuất

Theo chuẩn per-pair `(action, resource)` + data_scope per-(permission, role) hiện hành. Module `GOAL` đứng riêng (GOAL-DEC-002).

| Cặp quyền | Ý nghĩa | Đề xuất scope theo nhóm vai trò |
| --- | --- | --- |
| `('access','goal')` | cổng nav menu Mục tiêu | mọi role: có |
| `('view','goal')` | xem mục tiêu | Nhân viên: **department** (minh bạch trong phòng — thấy goal phòng + goal cá nhân mình + goal dự án mình là member) · Trưởng đơn vị: department · BOD/Admin: all |
| `('create','goal')` | tạo mục tiêu | Nhân viên: **own** (chỉ goal cấp employee của chính mình) · Trưởng đơn vị: department (cả 3 cấp trong phòng) · BOD/Admin: all |
| `('update','goal')` | sửa mục tiêu | Nhân viên: own · Trưởng đơn vị: department · BOD/Admin: all |
| `('delete','goal')` | xóa mềm | Nhân viên: own · Trưởng đơn vị: department · BOD/Admin: all |
| `('checkin','goal')` | check-in tiến độ | Nhân viên: own · Trưởng đơn vị: department · BOD/Admin: all |
| `('finalize','goal')` | chốt kỳ + mở lại | Nhân viên: **không** · Trưởng đơn vị: department · BOD/Admin: all |
| `('manage','task-template')` | danh mục template | Trưởng đơn vị: department · BOD/Admin: all · Nhân viên: không |

Ghi chú:

- Goal **cấp dự án**: ngoài data_scope trên, quyền ghi đi qua vai trò dự án (ProjectAccessService — DECISIONS-04): Owner/Manager của project được tạo/sửa goal dự án đó kể cả khi khác phòng ban.
- `is_sensitive` đề xuất `false` cho tất cả; riêng `('finalize','goal')` **PHẢI chốt với owner NGAY trong plan S5-GOAL-DB-1** (không để mở sau seed — flip sau sẽ đụng pin canonical-seed); nếu chốt `true` → cập nhật đồng thời allowlist sensitive FE + pin `auth-seed-canonical-roles` trong CÙNG WO.
- Scope cụ thể cho 4 role canonical chốt tại migration seed (per-pair DELETE-wrong-scope + INSERT ON CONFLICT, mirror 0466/0476).

---

## 12. Quy tắc nghiệp vụ và mã lỗi

| Mã lỗi | Quy tắc |
| --- | --- |
| GOAL-ERR-001 | Level↔neo không khớp: **đúng 1 cột neo theo cấp, mọi cột neo khác phải NULL** — `department` → chỉ `department_id`; `project` → chỉ `project_id`; `employee` → chỉ `employee_id` (phòng/dự án suy ra từ neo + parent, không denormalize). Sai → 422 |
| GOAL-ERR-002 | `parent_goal_id` không hợp lệ: cha phải cùng company, cấp cao hơn đúng chiều (§3.1), không tạo vòng lặp |
| GOAL-ERR-003 | Kỳ không hợp lệ: thiếu `period_start/period_end` hoặc end < start |
| GOAL-ERR-004 | `level='company'` bị chặn ở MVP (service chặn, CHECK vẫn cho phép để phase sau bật) |
| GOAL-ERR-005 | Goal đã chốt kỳ (`finalized_at`): cấm sửa/xóa/check-in/gắn-tháo task/phân rã. Muốn sửa → reopen trước (cần quyền finalize) |
| GOAL-ERR-006 | Check-in chỉ hợp lệ khi status `Active` và trong data_scope của actor |
| GOAL-ERR-007 | Xóa goal còn goal con active → chặn (xóa/di dời con trước; KHÔNG xóa lan) |
| GOAL-ERR-008 | Gắn task sai neo: goal `employee` → task phải có assignee = employee đó; goal `project` → task phải thuộc project đó; goal `department` → cảnh báo mềm nếu task không liên quan phòng (không chặn) |
| GOAL-ERR-009 | Phân rã bị chặn: goal `Cancelled`/đã chốt, template rỗng, hoặc vượt giới hạn 50 task/lần |
| GOAL-ERR-010 | Goal nhân viên: employee phải Active cùng company; `owner_employee_id` = `employee_id` |
| GOAL-ERR-011 | `weight` ≤ 0 |
| GOAL-ERR-012 | `progress_mode='project'` chỉ hợp lệ với goal `level='project'` |
| GOAL-ERR-013 | Đổi `progress_mode` khi đã có dữ liệu: cho phép, nhưng recompute lại ngay + ghi audit; cấm khi đã chốt kỳ |
| GOAL-ERR-014 | Finalize chỉ hợp lệ khi status `Active` hoặc `Completed`; reopen ghi audit + `goal_updates` type `reopen` |
| GOAL-ERR-015 | `target_value` bắt buộc khi `measure_type='number'` và mode `manual` |

Quy tắc bổ sung (không cần mã lỗi riêng):

- Goal con có kỳ nằm ngoài kỳ cha → **cảnh báo mềm** trên UI, không chặn (thực tế kỳ có thể lệch nhau).
- Status `Completed` set tay hoặc gợi ý khi progress đạt 100%; không auto-flip (người quyết).
- Mọi thay đổi quan trọng (create/update/delete/finalize/reopen/decompose/link-unlink) ghi `audit_logs`.

---

## 13. Đo tiến độ và liên kết (lõi nghiệp vụ)

### 13.1 Công thức theo mode

- **manual**: `measure_type='percent'` → progress = giá trị check-in gần nhất; `number` → `clamp(current_value / target_value × 100, 0..100)`; `boolean` → 0 hoặc 100.
- **project**: progress = `done / total × 100` trên tập **lá** của toàn dự án theo đúng đếm-lá DECISIONS-05 — reuse `ProjectsService.countsByStatusLeaf` (một nguồn số duy nhất với widget dashboard, tránh "hai con số"). **CẤM đọc cột `projects.progress_percent`** — cột chết không writer (§3.3).
- **tasks**: progress = `done / total × 100` trong đó tập = task có `goal_id` = goal này, `deleted_at IS NULL`, loại `Cancelled` khỏi cả tử và mẫu; task được đếm **chính nó** (Done hay chưa), KHÔNG kéo cây con vào (GOAL-DEC-006 — muốn đếm việc con thì gắn việc con).
- **children**: progress = `Σ(progress_percent_con × weight_con) / Σ(weight_con)` trên các goal con `deleted_at IS NULL` và status ≠ `Cancelled`. Con chưa đo được (null) → loại khỏi cả tử và mẫu.

### 13.2 "Chưa đo" khác "0%"

Mode `tasks` với 0 task gắn, hoặc `children` với 0 con đo được → `progress_percent = NULL`, UI hiển thị "—" + cảnh báo "chưa gắn việc/chưa có dữ liệu". **Cấm hiển thị 0%** trong trường hợp này (0% là thông tin sai).

### 13.3 Recompute — sync trong transaction + đối soát đêm

```text
Task đổi trạng thái/gắn/tháo/Cancelled → recompute goal mode=tasks liên quan
  (cùng trigger, task THUỘC dự án)     → recompute goal mode=project của dự án đó (đếm-lá — KHÔNG có sự kiện "cột progress_percent đổi" vì cột đó chết)
Check-in (manual)                     → cập nhật current_value → progress
        └── mỗi lần progress_percent đổi → bubble lên cha mode=children (tối đa 3 tầng)
```

- Recompute chạy **sync cùng transaction** tại service (cây nông, rẻ); goal đã chốt kỳ bị **bỏ qua** mọi recompute.
- **Job đối soát đêm** tính lại toàn bộ goal chưa chốt của kỳ đang chạy, sửa drift cache; lệch >0.01 → log warn.
- Task đổi dự án mà đang gắn goal của dự án cũ → giữ liên kết + cảnh báo trên UI (nối luồng vá đổi-dự-án PR #248).

### 13.4 Chốt kỳ (finalize)

- Chốt = set `finalized_at/finalized_by`, ghi `goal_updates` type `finalize` (snapshot old/new progress), audit log.
- Sau chốt: mọi đường ghi (update/check-in/link/decompose/recompute/bubble) từ chối với GOAL-ERR-005. Goal cha `children` khi rollup vẫn **đọc** số đã chốt của con.
- Reopen: quyền finalize, ghi `goal_updates` type `reopen` + audit; goal quay lại nhận recompute.

---

## 14. Trạng thái UI bắt buộc

Mọi màn hình GOAL phải xử lý: **loading** (skeleton) · **error** (thông điệp + retry) · **empty** ("chưa có mục tiêu kỳ này" + CTA tạo nếu có quyền) · **chưa đo** ("—", không phải 0%) · **đã chốt kỳ** (badge khóa + disable mọi nút ghi) · **không có quyền** (ẩn bằng `<PermissionGate>` — không hard-code).

---

## 15. Yêu cầu API cấp SPEC

Envelope/error/pagination theo API-01. Chi tiết request/response: API-12 (stub tạo ở S5-GOAL-DOC-1).

| Mã | Endpoint | Ghi chú |
| --- | --- | --- |
| GOAL-API-001 | `GET /goals` | filter: level, departmentId, projectId, employeeId, periodStart/End, status, parentGoalId; pagination |
| GOAL-API-002 | `POST /goals` | validate §12 |
| GOAL-API-003 | `GET /goals/:id` | kèm breadcrumb cha + đếm con |
| GOAL-API-004 | `PATCH /goals/:id` | chặn khi finalized |
| GOAL-API-005 | `DELETE /goals/:id` | soft, chặn khi còn con active |
| GOAL-API-006 | `GET /goals/tree` | cây theo kỳ + phòng ban, kèm progress từng nút |
| GOAL-API-007 | `POST /goals/:id/check-in` | body: currentValue?/progressPercent?/confidence?/note |
| GOAL-API-008 | `GET /goals/:id/updates` | lịch sử check-in, pagination |
| GOAL-API-009 | `POST /goals/:id/finalize` · `POST /goals/:id/reopen` | quyền finalize |
| GOAL-API-010 | `GET /goals/:id/tasks` · `POST /goals/:id/tasks` (bulk link) · `DELETE /goals/:id/tasks/:taskId` (unlink) | validate GOAL-ERR-008 |
| GOAL-API-011 | `POST /goals/:id/decompose` | body: templateId + items đã sửa ở preview; tạo bulk task 1 transaction |
| GOAL-API-012 | `GET/POST/PATCH/DELETE /task-templates` (+ items) | quyền manage |
| GOAL-API-013 | `GET /me/goals` | own-scope cho /me, resolve từ token (chuẩn SPEC-09 §14.4 — không nhận employee_id từ client) |

---

## 16. Dữ liệu và lưu trữ

Nguồn chuẩn: [DB-11](<../DB/DB-11 GOAL Database Design.md>). Tóm tắt:

- Bảng mới: `goals` · `goal_updates` (append-only) · `task_templates` · `task_template_items`.
- Sửa bảng: `tasks` thêm cột `goal_id` (nullable FK, index partial).
- RLS + FORCE mọi bảng mới; `goal_updates` app role **không có** UPDATE/DELETE.
- Migration nối tiếp head thật (khảo sát 2026-07-20: idx 183 / 0503 ⇒ 0504+), lane DB tuần tự.
- **Seed đi kèm BẮT BUỘC** (bài học 0498/0474 — thiếu là 500 ngay bản ghi đầu): counter `sequence_counters` cho `goal_code` (mirror 0498 — bug QA2-CRIT-002 task_code lặp lại nếu quên) · UNION-ADD `'goal'` vào CHECK `audit_logs.object_type` (DO-block idempotent mẫu 0474) · catalog + template 2 event GOAL (§17). Chi tiết: DB-11 §9.

---

## 17. Sự kiện và thông báo

| Event code | Khi nào | Người nhận |
| --- | --- | --- |
| `GOAL_ASSIGNED` | tạo/cập nhật goal cấp employee mà owner ≠ actor (trưởng phòng giao) | employee được giao |
| `GOAL_FINALIZED` | chốt kỳ goal | owner goal (+ trưởng đơn vị nếu khác actor) |

Phát qua **OutboxNotificationBridge** (bridge lõi ĐÃ ship — `outbox-notification-bridge.service.ts`): enqueue trong transaction, map eventCode verbatim, dedupe + delivery log, cùng company.

> ⚠️ **Bẫy boot:** `registerSource()` của bridge **fail-loud NGAY LÚC BOOT** nếu eventCode chưa nằm trong catalog với `isEnabled=true`. Vì vậy 2 event code trên PHẢI được seed TRƯỚC (const `notification-event-catalog.const.ts` + migration seed `notification_events` + template — mirror 0481/0490, thuộc S5-GOAL-DB-1) rồi BE-2 mới được đăng ký registrar.

Check-in reminder định kỳ: phase sau (§5.2).

---

## 18. Audit và bảo mật

- **RLS + FORCE** theo `company_id` trên `goals`/`goal_updates`/`task_templates`/`task_template_items` (bất biến #1).
- `goal_updates` **append-only** — bổ sung vào danh sách bảng ledger của bất biến #2.
- Audit log (`audit_logs`) cho create/update/delete/finalize/reopen/decompose/link-unlink; `object_types` CHECK mở rộng theo kiểu **append/UNION** (hot-file rule CLAUDE.md §9.3).
- Data scope ép ở **service layer** (buildReadScopeExists pattern); FE chỉ ẩn/hiện bằng PermissionGate.
- Payload notification không chứa số liệu nhạy cảm — chỉ goal name + link.
- `GET /me/goals` resolve employee từ token — không nhận id từ client.

---

## 19. Non-functional requirements

- Cây goal 1 phòng ban 1 kỳ (≤ ~200 nút) trả về < 500ms; index theo `(company_id, level, period)` — chi tiết DB-11.
- Recompute 1 chuỗi bubble (task → employee-goal → dept-goal) < 50ms trong transaction.
- Job đối soát đêm = **system-jobs handler** (`@SystemJobHandler` + DiscoveryService — mẫu `retention-cleanup.job-handler.ts`; code KHÔNG dùng BullMQ trực tiếp), idempotent. Lưu ý: SchedulerModule import tường minh module chứa handler để init trước DiscoveryService — xác minh khi làm BE-2, cần thì thêm import GoalsModule.
- i18n: toàn bộ nhãn tiếng Việt qua react-i18next namespace `goals`.

---

## 20. Tiêu chí nghiệm thu tổng quát

1. Trưởng phòng tạo được mục tiêu phòng kỳ Q3, giao 2 mục tiêu cho nhân viên, gắn 1 dự án qua goal con mode `project`.
2. Nhân viên thấy goal phòng + goal của mình trong /me, check-in được, KHÔNG sửa được goal người khác (403 + deny-path test).
3. Task Done → % goal mode `tasks` đổi ngay không cần F5 dashboard đêm; số khớp công thức §13.1.
4. Chốt kỳ → mọi đường ghi trả GOAL-ERR-005; reopen bởi trưởng phòng khôi phục được.
5. Phân rã từ template 10 items → 10 task tạo trong 1 transaction, đều mang `goal_id`, có activity log.
6. Cross-tenant: mọi endpoint deny dữ liệu company khác (int-spec bắt buộc).

---

## 21. Test scenario cấp cao

| Nhóm | Scenario |
| --- | --- |
| Deny-path (RED trước) | nhân viên sửa/xóa/check-in goal người khác · nhân viên finalize · xem goal phòng khác (scope department) · cross-tenant mọi endpoint · client gửi employee_id lạ vào /me/goals |
| Validate | 15 mã lỗi §12, mỗi mã ≥ 1 case |
| Tiến độ | 4 mode đúng công thức · null-vs-0% · Cancelled loại khỏi mẫu số · bubble 3 tầng · con null bị loại khỏi rollup · finalized bỏ qua recompute · đối soát đêm sửa drift |
| Chốt kỳ | freeze toàn bộ đường ghi · reopen · ledger goal_updates không UPDATE/DELETE được bằng app role |
| Phân rã | transactional (fail giữa chừng → rollback hết) · giới hạn 50 · template thuộc company khác → deny |
| Tích hợp | task đổi trạng thái → recompute · task đổi dự án → cảnh báo · notification enqueue cùng transaction |

---

## 22. Quyết định nghiệp vụ đã chốt (owner 2026-07-20)

| Mã | Quyết định | Chốt |
| --- | --- | --- |
| GOAL-DEC-001 | Cây thuần 1 bảng `goals`, đo lường nằm trên goal; KHÔNG tách Key Results (cần thì thêm `level='kr'` sau, không đổi schema) | ✅ 20/07/2026 |
| GOAL-DEC-002 | GOAL là module riêng: SPEC-10, menu "Mục tiêu" riêng, mã quyền `GOAL.*` | ✅ 20/07/2026 |
| GOAL-DEC-003 | MVP KHÔNG có luồng phê duyệt goal; điểm kiểm soát = chốt kỳ (finalize) bởi quản lý | ✅ 20/07/2026 |
| GOAL-DEC-004 | Phân rã CHỈ bằng task template; AI ngoài scope | ✅ 20/07/2026 |
| GOAL-DEC-005 | `progress_mode` độc quyền 4 kiểu manual/project/tasks/children; "At Risk" dẫn xuất không lưu | ✅ 20/07/2026 (đề xuất kèm phương án đã duyệt) |
| GOAL-DEC-006 | `tasks.goal_id` n-1 (1 task ↔ 1 goal); đếm task được gắn chính nó, không kéo cây con | ✅ 20/07/2026 (nt) |
| GOAL-DEC-007 | `goal_updates` là ledger append-only — mở rộng bất biến #2 | ✅ 20/07/2026 (nt) |
| GOAL-DEC-008 | Finalize đóng băng số liệu; PERF/KPI Phase 2 tham chiếu read-only qua `goal_id` | ✅ 20/07/2026 (nt) |
| GOAL-DEC-009 | `weight` mặc định 1, chỉnh tay khi cần; sau này là trọng số chấm điểm | ✅ 20/07/2026 (nt) |
| GOAL-DEC-010 | Parent chỉ trỏ lên cấp cao hơn (employee→project/department; project→department); cấp company chừa schema, chưa làm UI | ✅ 20/07/2026 (nt) |

---

## 23. Tác động đến bộ tài liệu hiện tại (WO S5-GOAL-DOC-1)

1. SPEC-01: thêm GOAL vào danh sách module + sơ đồ phụ thuộc; header nav 9 file SPEC cũ thêm link SPEC-10.
2. PRD-00: thêm Mục tiêu vào phạm vi MVP bổ sung.
3. DB-01: ghi nhận nhóm bảng GOAL + ERD cấp cao; DB-09: index; DB-10: seed module GOAL.
4. Tạo **API-12 GOAL API Design** stub theo §15.
5. `docs/permission-matrix-spec.md`: thêm 8 cặp quyền GOAL (§11).
6. SPEC-06/DB-06: ghi chú `tasks.goal_id` + task_templates chuyển từ "phase sau" sang "đã kích hoạt bởi SPEC-10" (trỏ về DB-11, không nhân bản).
7. docs/README.md §2/§3/§8: dòng GOAL (đã seed cùng PR spec này).

---

## 24. Definition of Done cho SPEC-10

- [ ] Owner duyệt PR docs → flip Trạng thái Draft → Approved
- [ ] DB-11 + API-12 + permission-matrix đồng bộ, không mâu thuẫn SPEC-10
- [ ] Wave S5-GOAL trong `harness/backlog.mjs` trace về đúng mã GOAL-FUNC/API/ERR của spec này
- [ ] Mọi WO code của wave lấy SPEC-10 + DB-11 làm nguồn sự thật; lệch → sửa code, không sửa ngầm spec

---

## 25. Kết luận

GOAL bổ sung tầng "vì sao làm việc này" lên trên TASK: mục tiêu rõ theo kỳ ở 3 cấp, tiến độ dẫn xuất từ công việc thật, kết quả chốt kỳ làm nền đánh giá nhân viên ở Phase 2 — với đúng 2 cột liên kết (`goals.project_id`, `tasks.goal_id`), 1 sổ ledger và 1 bộ quy tắc đo minh bạch, không sao chép dữ liệu của module nào.
