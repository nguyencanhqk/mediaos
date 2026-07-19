# DECISIONS-04: QUYỀN PER-PROJECT — PROJECT ROLE THÀNH NGUỒN QUYỀN

> **📚 Bộ tài liệu DECISIONS — Hệ thống Quản lý Doanh nghiệp**
> **DECISIONS-04 Quyền per-project (project role)** · (tiếp nối DECISIONS-01 Chốt câu hỏi mở · DECISIONS-02 Khoá stack & bất biến · DECISIONS-03 Cột Kanban & FSM)
>
> **Nguồn & liên quan:** [Chỉ mục: README](<../README.md>) · [Đặc tả: SPEC-06 TASK](<../SPEC/SPEC-06 TASK.md>) · [DB: DB-06](<../DB/DB-06 TASK Database Design.md>) · [DB: DB-02 §4.7 (D-22)](<../DB/DB-02 AUTH RBAC Database Design.md>) · [API: API-06 §6.3](<../API Design/API-06_TASK_API_Design.md>) · [Kế hoạch thi công: S5-TASK-PROJROLE-1](<../plans/S5-TASK-PROJROLE-1.md>)

---

## 1. Thông tin tài liệu

| Trường        | Nội dung                                                          |
| ------------- | ----------------------------------------------------------------- |
| Mã tài liệu   | DECISIONS-04                                                       |
| Tên tài liệu  | Quyền per-project: projectRole thành nguồn quyền membership-based  |
| Tên dự án     | Hệ thống quản lý doanh nghiệp nội bộ                               |
| Tên sản phẩm  | Enterprise Management System                                       |
| Phiên bản     | v1.0                                                               |
| Trạng thái    | 6 quyết định đề xuất — **D-26 · D-27 cần OWNER-CONFIRM tại PR**    |
| Giai đoạn     | Sprint 5 — đợt C chuỗi redesign TASK (sau A #234-241 · B #242 · D1 #243) |
| Ngày tạo      | 19/07/2026                                                         |
| Ngày cập nhật | 19/07/2026                                                         |
| Người duyệt   | Cian (Product Owner) — chốt khi merge PR (crown)                   |

---

## 2. Bối cảnh

Product Owner chốt 18/07/2026 (chuẩn tham chiếu MISA AMIS): **"Quyền per-project THẬT SỰ: `projectRole` (Owner/Manager/Member/Viewer) trở thành nguồn quyền, không chỉ nới read-scope như hiện nay."**

Ràng buộc nền đã chốt trước đó — **D-22** (DECISIONS-01, 02/07/2026): GIỮ 5 bậc `data_scope` (`Own/Team/Department/Company/System`); TASK định phạm vi dự án qua **project-membership ở service layer**, KHÔNG thêm bậc `'Project'` engine-level. API-06 §6.3 cũng đã đặc tả sẵn mô hình 2 lớp: *"Backend phải kiểm tra RBAC trước, sau đó kiểm tra project role"* — nhưng **code chưa hiện thực lớp thứ hai**.

### 2.1 Hiện trạng đã kiểm chứng (19/07/2026)

| Hạ tầng | Trạng thái | Vị trí |
| --- | --- | --- |
| `project_members.project_role` (CHECK Owner/Manager/Member/Viewer, NULLABLE) | ✅ có (0478 additive) | `db/schema/media.ts:495,530-533` |
| Rule last-Owner (không gỡ/hạ Owner cuối) | ✅ có | `projects.service.ts:518-521,565-568` |
| Creator seed thành Owner-member khi tạo project | ✅ có | `projects.service.ts:217-226` |
| Governance (close/delete/manage-member) | ⚠️ neo `projects.owner_employee_id` **1 người**, KHÔNG đọc `project_role` | `projects.service.ts:628-651` (`assertGovern`) |
| Membership trong authorization | ⚠️ chỉ là nhánh OR trong `buildReadScopeExists`, KHÔNG đọc role — áp cho CẢ write | `task-core.repository.ts:198-224` |
| Đổi chủ dự án (PATCH `ownerEmployeeId`) | ❌ KHÔNG sync `project_members` — chủ mới có thể không phải member | `projects.service.ts:301-310` |
| Grant `create/update:task` cho employee/manager | ❌ HOÃN có điều kiện (chờ enforcement scope+membership) | `task-permissions.const.ts:80-83,153-157` |
| Tầng role cho CRUD cột pipeline | ❌ không có (SPEC-06 §9 note xác nhận) | `project-states.controller.ts` |

⇒ `project_role` là dữ liệu **nằm ngủ**: đã lưu, đã hiển thị, đã có rule bảo toàn (last-Owner) — nhưng **chưa từng quyết định cho/chặn hành động nào**. Đợt C cắm nó vào authorization đúng chỗ spec đã đặc tả.

---

## 3. Chi tiết các quyết định

### D-23 — projectRole là nguồn quyền per-project, ở SERVICE LAYER

- **Câu hỏi:** Hiện thực "quyền per-project thật" bằng cách nào — thêm bậc `data_scope='Project'` vào engine, hay tầng kiểm tra membership+role ở service layer TASK?
- **Quyết định:** **Service layer** (giữ nguyên D-22). Một `ProjectAccessService` đọc `project_members` (Active, chưa xoá) trả role của actor; các đường authorization TASK tiêu thụ nó theo ma trận D-24. Data-scope engine 5 bậc KHÔNG đổi.
- **Lý do:** Project là quan hệ THÀNH VIÊN (xuyên phòng ban), không xếp được vào trục tuyến tính của `resolveStrongestScope` (nguyên văn D-22). Toàn bộ nhu cầu của đợt C phủ được bằng service layer — chưa xuất hiện "nhu cầu thật" để mở lại đường engine-level mà D-22 dự phòng.
- **Hệ quả:** Mô hình 2 lớp đúng như API-06 §6.3: lớp 1 = pair + data_scope (PermissionGuard + resolver — không đổi); lớp 2 = membership + role khi đích nằm trong dự án và tầm với của actor KHÔNG đến từ org-scope.

### D-24 — Ma trận role×action (ghim cứng, nguồn duy nhất)

- **Câu hỏi:** Từng `projectRole` được làm gì trong dự án?
- **Quyết định:** Bảng dưới là **nguồn duy nhất** — SPEC-06 §14.6 và API-06 §6.3 mirror về đây. Áp dụng KHI actor với tới tài nguyên **chỉ nhờ membership** (data_scope của pair < Company). Scope `Company/System` **bypass** tầng role (SPEC-06 §18.6.8: permission hệ thống là lớp kiểm soát cao nhất). Nhánh **assignee** (task được giao cho chính mình) KHÔNG bị role cap — đó là đường Own truyền thống.

| Hành động trong dự án | Viewer | Member | Manager | Owner |
| --- | --- | --- | --- | --- |
| Xem project/task/board/members/comments/files/checklist | ✓ | ✓ | ✓ | ✓ |
| Watch (tự theo dõi) | ✓ | ✓ | ✓ | ✓ |
| Viết comment · tick checklist · upload file task | ✗ | ✓ | ✓ | ✓ |
| Sửa task ĐƯỢC GIAO cho mình (update/status/state) | (nhánh assignee — role không cap) | ✓ | ✓ | ✓ |
| Sửa/move/assign/priority/deadline task NGƯỜI KHÁC | ✗ | ✗ | ✓ | ✓ |
| Tạo task trong dự án | ✗ | ✗ | ✓ | ✓ |
| Quản lý cột pipeline (`project_state` CUD) | ✗ | ✗ | ✓ | ✓ |
| Sửa thông tin dự án (field thường) | ✗ | ✗ | ✓ | ✓ |
| Quản lý thành viên · đổi chủ · close/archive/delete dự án | ✗ | ✗ | ✗ | ✓ |

- **Quy ước `project_role` NULL** (member legacy media-era, hàng `user_id`-only trước mig 0478): coi là **Member** cho read/collab; KHÔNG write-rộng, KHÔNG govern. Lý do: member cũ đang dùng bình thường — hạ xuống Viewer là đổi hành vi người đang dùng; rủi ro "user legacy có thể không còn là employee active" chấp nhận được vì lớp 1 (pair hệ thống) vẫn chặn trước.
- **Thi hành:** predicate `buildReadScopeExists` nhận mode `read` / `collab` / `write`; mode **thread theo từng operation** (helper phục vụ cả đọc lẫn ghi nhận mode từ caller — chi tiết plan lane be-core).

### D-25 — Governance re-anchor: từ `owner_employee_id` (1 người) sang role Owner (n người)

- **Câu hỏi:** Cổng governance (manage-member/close/archive/delete/đổi-chủ) tiếp tục so `actorEmpId === projects.owner_employee_id` hay chuyển sang `project_role='Owner'`?
- **Quyết định:** Chuyển sang **Active member role Owner** — nhiều Owner hợp lệ (SPEC-06 §14.6: Owner = toàn quyền trong dự án). `owner_employee_id` GIỮ làm "chủ nhiệm chính" (hiển thị/notification/mặc định), KHÔNG còn là cổng quyền.
- **Slug lỗi phân biệt:** project CÓ Owner-member nhưng actor không phải ⇒ 403 `TASK-ERR-PROJECT-NOT-OWNER`; project **0 Owner-member** ⇒ 403 `TASK-ERR-PROJECT-OWNER-REQUIRED` (fail-closed, giữ slug cũ).
- **Đồng bộ dữ liệu:** (a) PATCH đổi `ownerEmployeeId` phải **upsert chủ mới thành Active member Owner trong CÙNG tx** (đã member ⇒ nâng role; chưa ⇒ insert; KHÔNG tự hạ chủ cũ — nhiều Owner hợp lệ); (b) **backfill migration 0501 phần B** cho dữ liệu cũ: mọi project có `owner_employee_id` chưa là Owner-member ⇒ UPDATE-nâng-role/INSERT (guard employee không có account: SKIP + RAISE NOTICE — họ không đăng nhập được nên không bị lockout thêm). Thiếu backfill = chủ-được-reassign-trước-đợt-C bị khoá khỏi chính dự án mình.
- **Bất biến kèm theo:** rule last-Owner (đã có) trở thành bất biến sống còn — dự án luôn ≥1 Owner-member một khi đã có.

### D-26 — Quản lý thành viên: Owner-only (reconcile xung đột spec) ⚠️ OWNER-CONFIRM

- **Xung đột:** SPEC-06 §14.6 ghi Manager = "Quản lý task **và thành viên**"; nhưng §9 ma trận (":583-584 Quản lý thành viên: Có nếu là owner") + API-06 §6.3 (Manager = "Tạo/giao/cập nhật task", KHÔNG member) nói **Owner-only**.
- **Quyết định (đề xuất):** **Owner-only** — least-privilege, khớp hành vi `assertGovern` hiện hành, khớp §9 + API-06; sửa §14.6 theo. Manager quản TASK trong dự án, không quản người.
- **Đây là đổi phát biểu sản phẩm** ⇒ đánh dấu **OWNER-CONFIRM**: owner phê duyệt khi chốt merge PR (crown luôn cần người chốt). Nếu owner muốn Manager quản thành viên: đổi 1 hàng ma trận D-24 + 1 tập allowedRoles trong `assertGovern` — không đổi kiến trúc.

### D-27 — Un-defer `create:task` + `update:task` (emp@Own · mgr@Team) + đóng SPEC-06 §24 Q1/Q5 ⚠️ OWNER-CONFIRM

- **Bối cảnh:** 5 grant bị HOÃN từ S4 với điều kiện ghi ngay trong source (`task-permissions.const.ts:80-83`): *"grant trong migration CÙNG release với enforcement scope+membership"*. Đợt C chính là release đó: `update` đã có `assertInScopeForWrite` + nay có role-cap; `create` được thiết kế create-scope trong đợt này.
- **Quyết định (đề xuất):**
  1. **Flip 4 grant:** `create:task` + `update:task` cho employee@Own và manager@Team (migration 0501 phần A, cùng PR với enforcement — cấm tách release).
  2. **`delete:task` mgr@Team GIỮ HOÃN** — SPEC-06 §9 đòi "nếu là creator/owner" = relation-check theo creator chưa thiết kế; mở lại khi có WO thiết kế relation-check.
  3. **Create-scope semantics:** scope Own/Team — không `projectId` ⇒ `mainAssignee` bắt buộc và trong scope (Own = chính mình; Team = nhân viên trong team); có `projectId` ⇒ actor phải là member Owner/Manager, assignee (nếu có) phải là Active member cùng dự án (400 `TASK-ERR-ASSIGNEE-INVALID`). Scope Company/System giữ nguyên hành vi cũ (kể cả warning-only assignee ngoài dự án).
  4. **Đóng 2 câu hỏi mở SPEC-06 §24:** Q1 *"MVP có cho Employee tự tạo task cá nhân không?"* ⇒ **CÓ** (self-assigned, `create:task@Own`); Q5 *"Có cho tạo task ngoài project không?"* ⇒ **CÓ** (task cá nhân/không dự án). Khớp chuẩn MISA + chủ đích "quyền per-project thật" của owner (Manager dự án là org-employee phải tạo được task).
  5. **Cổng `TASK-ERR-TASK-PERSONAL-DISABLED`** ("nếu cấu hình cho phép" — SPEC-06 §6/§18.2): **DEFER** — MVP chưa có setting ⇒ mặc định CHO; ghi đường thêm setting company-level sau (SettingService, cùng khuôn checklist-gate).
- **Đây là mở quyền công-ty-rộng cho employee/manager (trước: 403)** ⇒ **OWNER-CONFIRM tại PR**. Deferral cũ chỉ là sequencing kỹ thuật, KHÔNG phải phê duyệt policy sẵn — nên đợt này đưa owner quyết tường minh.
- **Còn để mở (KHÔNG tự quyết đợt này):** `assign` / `update-priority` / `update-deadline`:task cho employee — hệ quả: Manager-dự-án là org-employee CHƯA reassign được task người khác (thiếu pair lớp 1). Ghi thành câu hỏi mở cho owner; khi chốt CÓ thì chỉ thêm grant @Own + ma trận D-24 đã sẵn hàng Manager.

### D-28 — Tầng role cho CRUD cột pipeline (project_state)

- **Bối cảnh:** SPEC-06 §9 note (":599") xác nhận route quản trị cột **không có kiểm tra owner dự án** và yêu cầu: muốn thêm ràng buộc phải qua sổ quyết định. Đây là quyết định đó.
- **Quyết định:** scope<Company của pair `project_state` ⇒ actor phải là **Owner/Manager member của ĐÚNG project** chứa state; `Company/System` bypass như cũ. GET list giữ membership read.
- **Ghi rõ:** với seed hiện tại mọi grant `project_state` đều ở Company ⇒ tầng này **DORMANT** cho role thật (defense-in-depth); chỉ kích hoạt khi tương lai có grant scope hẹp. Reviewer không nên hiểu nhầm nó gate user thật hôm nay.

### D-29 — Tách gate lịch sử nghiệp vụ task: người liên quan xem được (S5-TASK-DETAIL-1)

- **Bối cảnh:** `GET /tasks/:id/activity` (TASK-API-602) gate `view:task-audit-log` — pair SENSITIVE seed 0485 CHỈ hr/company-admin @Company ⇒ người thực hiện KHÔNG thấy lịch sử task của chính mình (trái chuẩn tham chiếu MISA + SPEC-06 §13.12 màn chi tiết có mục Lịch sử). Backlog S5-TASK-DETAIL-1 GAP 2 yêu cầu tách: *lịch sử NGHIỆP VỤ cho người liên quan · audit-log ĐẦY ĐỦ giữ gate sensitive.*
- **Quyết định:** tách theo **NGỮ NGHĨA UỶ QUYỀN**, không lọc nội dung:
  1. Route task-level đổi guard `view:task-audit-log` → **`read:task`** (base — phải đọc được task mới bàn tới lịch sử). Service cho qua khi actor **(a)** giữ `view:task-audit-log` (mọi scope; override đầy đủ — hr/company-admin như cũ, kể cả task soft-deleted) **HOẶC (b)** là **NGƯỜI LIÊN QUAN** của đúng task đó: main-assignee · creator (`creator_user_id`/`created_by`/`assignee_user_id`) · reporter (`reporter_employee_id`) · watcher Active/Muted. Không thuộc cả hai → **403 `TASK-ERR-042`** (giữ mã lỗi cũ); task không tồn tại/cross-tenant → **404** (kiểm tra TRƯỚC involvement).
  2. **KHÔNG lọc bớt loại sự kiện** cho người liên quan: mọi dòng `task_activity_logs` của task đều là sự kiện nghiệp vụ trên chính task mà họ đã đọc được (comment/checklist/file họ vốn xem được qua route riêng gate `read:task`). Khác biệt giữa 2 cổng là **PHẠM VI TASK** (mình liên quan vs mọi task), không phải loại dữ liệu.
  3. **Giữ nguyên sensitive:** feed DỰ ÁN `GET /projects/:id/activity` (TASK-API-601 — nhìn chéo mọi task trong dự án) + audit viewer foundation (`audit_logs`). Tab "Hoạt động" workspace dự án vẫn ẩn theo `useCanExact`.
  4. **Hệ quả chấp nhận:** actor giữ `view:task-audit-log` mà THIẾU `read:task` sẽ 403 ở guard — seed 0485 luôn cấp cả hai cho hr/company-admin nên không có user thật rơi vào; int-spec tự chế grant lẻ phải cấp kèm `read:task`. Manager @Team KHÔNG liên quan task → vẫn 403 như cũ (backlog chỉ mở cho người liên quan; mở @Team là câu hỏi mở cho owner).
- **Kéo theo:** deny-matrix `task-qa1-permission-matrix` GỠ pair `view:task-audit-log` khỏi LIVE_PAIRS (route không còn là "403 CHỈ từ PermissionGuard" — employee được 200 trên task được giao dù không có pair); phủ lại bằng int-spec chuyên biệt involvement (S5-TASK-DETAIL-1).
- **Rollback:** revert controller + service (không đụng schema/data/seed).

---

## 4. Rollback

- D-23/D-24 (tầng role): revert code service layer — không đụng schema/data.
- D-25: `assertGovern` quay lại so `owner_employee_id`; backfill 0501 phần B là additive (thêm/nâng role member) — không cần down-migration, dữ liệu member Owner thêm ra vẫn hợp lệ với model cũ.
- D-27: revert grant bằng migration DELETE per-(role,pair) đúng bộ (khuôn 0499) + hạ `TASK_EXPECTED_GRANT_COUNTS`; theo expand-contract 2 release nếu đã có client dựa vào.

## 5. Câu hỏi mở còn lại (cho owner)

1. Grant `assign`/`update-priority`/`update-deadline`:task @Own cho employee để Manager-dự-án full thao tác? (D-27 mục "còn để mở")
2. Setting company bật/tắt task cá nhân (kích hoạt lại cổng PERSONAL-DISABLED)?
3. Per-project permission OVERRIDE matrix (tuỳ biến quyền từng dự án — MISA có)? Đợt C chỉ ship member+role+chú giải.
4. `delete:task` mgr@Team + relation-check creator/owner (đường mở lại của D-27.2).
