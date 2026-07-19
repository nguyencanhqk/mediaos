```yaml
wo: S5-TASK-PIPELINE-1
zone: red
generated_by: session 2026-07-18 (owner benchmark MISA AMIS)
revision: 7 — lane pipeline-adr đang thi công; +2 quyết định owner (nhóm state review · tên cột tiếng Việt); sửa mô tả CHECK sai của bản 6
lanes:
  - id: pipeline-adr
    task: "ADR + sửa spec TRƯỚC KHI CODE (CLAUDE.md §1: docs/spec là nguồn sự thật, code lệch spec thì spec thắng). (1) docs/DECISIONS/ADR mới: cột Kanban = project_state (pipeline tuỳ biến) thay vì task_status; state_group → status auto-map qua FSM; NỚI FSM cho phép mở lại từ Done. Ghi rõ lý do nghiệp vụ (sản xuất video trả-về-sửa là bình thường) + phương án rollback. (2) SPEC-06: §6.8, §6.10 (bảng chuyển FSM), §13.8, §14.13, tiêu chí nghiệm thu 15-16, TASK-TC-025, §21 rủi ro. (3) API-06: route move-state. (4) DB-06: ngữ nghĩa state_id + quan hệ với task_status. KHÔNG code khi lane này chưa xong."
    builder: doc-updater
    paths: ["docs/DECISIONS/**", "docs/SPEC/SPEC-06 TASK.md", "docs/API Design/API-06_TASK_API_Design.md", "docs/DB/DB-06 TASK Database Design.md"]
  - id: pipeline-fsm
    task: "NỚI FSM cho task văn phòng + tách changeStatusTx (CROWN — đổi luật workflow). (1) task-fsm.ts TRANSITIONS mới — cho nhảy cấp MỌI HƯỚNG giữa 4 status hoạt động: Todo/In Progress/In Review/Done mỗi cái → 3 cái còn lại + Cancelled; Cancelled → {Todo, In Progress} (khôi phục). (2) BỎ early-return `if (from === 'Cancelled') return 422` ở evaluateTransition:67-69 — phải TRA BẢNG thay vì chặn trước, nếu không mục Cancelled là code chết (bẫy M4). (3) loadMutable (task-actions.service.ts:460-464) ném 422 cho task Cancelled TRƯỚC evaluateTransition và DÙNG CHUNG cho assign/change-priority/change-deadline — chỉ nới cho ĐƯỜNG changeStatus (tham số/nhánh riêng), TUYỆT ĐỐI không mở luôn quyền sửa task đã huỷ. (4) TÁCH `changeStatusTx(tx, user, taskId, dto, scope)` làm lõi + `changeStatus` thành wrapper withTenant mỏng (khuôn HrTasksService — mọi method nhận TenantTx). BẮT BUỘC: changeStatus hiện TỰ MỞ tx (task-actions.service.ts:176 → db.service.ts:83 db.transaction) nên gọi nó trong tx sẵn có = 2 connection ⇒ TỰ DEADLOCK trên chính row đang khoá (bẫy M1). (5) completedAt/cancelledAt: repo đã hỗ trợ 'clear' (task-actions.repository.ts:70-77) nhưng chưa ai dùng — rời Done ⇒ completedAt:'clear' + completedBy null; rời Cancelled ⇒ cancelledAt:'clear'. (5b) `checklistBlocksDone` gọi SettingService.resolveSetting, mà hàm này TỰ MỞ withTenant (setting.service.ts:99) và KHÔNG nhận tx ⇒ chuỗi move-state tx → changeStatusTx → connection THỨ HAI. Không deadlock (khác bảng, không tranh lock tasks) nhưng cạn pool dưới tải thì inner chờ mãi trong khi outer không nhả. Sửa: đọc setting TRƯỚC khi mở tx và truyền xuống, HOẶC thêm resolveSettingTx(tx,...). LƯU Ý: test NO-DEADLOCK chạy 1 request trên pool rảnh sẽ KHÔNG bắt được lỗi này — phải sửa theo cấu trúc, không dựa vào test. (6) Thêm hằng STATE_GROUP_TO_STATUS 5 dòng: backlog|unstarted→'Todo', started→'In Progress', review→'In Review', completed→'Done', cancelled→'Cancelled'. (6b) ĐỒNG BỘ NGƯỢC (D-21): changeStatusTx sau khi đổi status THÀNH CÔNG phải chuyển state_id sang cột thuộc nhóm tương ứng TRONG CÙNG TX — TRỪ KHI thẻ ĐÃ ở cột đúng nhóm (không thì đặt In Progress cho thẻ ở cột 'Hậu Kỳ' sẽ GIẬT thẻ về cột 'Quay'). Chọn cột theo bậc thang D-20 (is_default → sort_order nhỏ nhất, tie-break sort_order/created_at/id) vì ánh xạ ngược KHÔNG đơn trị. (6c) Khai tử POST /tasks/:id/move + PATCH /tasks/:id/status theo expand-contract 2 đợt (đợt này đánh dấu ngừng dùng + chuyển FE; đợt sau mới gỡ) — /move gate chỉ update-status nên là CỬA VÒNG QUA cổng update-state. (7) Cập nhật task-fsm.spec + MỌI spec đang assert Done→{} là 409 — ĐỔI LUẬT có chủ đích, không phải sửa test cho qua."
    builder: backend-builder
    paths: ["apps/api/src/tasks/**"]  # mở rộng: testTask đòi task-actions.service.spec.ts CHƯA TỒN TẠI + spec mới phải colocated trong src/** mới được vitest chạy (memory vitest-unit-specs-must-be-colocated)
  - id: pipeline-migration
    task: "LANE NỐI TIẾP — 2 migration, đánh số tiếp head 0498. (1) 0499: seed permission pair MỚI `update-state:task` theo khuôn DO-block per-(role,pair) của 0485:114-235 (DELETE-wrong-scope + INSERT ON CONFLICT) — TUYỆT ĐỐI KHÔNG INSERT...SELECT blanket theo role_id (bẫy permissions-0005-bulk-grant-trap). MA TRẬN GRANT TƯỜNG MINH (mirror ĐÚNG update-status:task để không lệch quyền với auto-map — xem lane be-write 4b): employee=Own · manager=Team · hr=Company · company-admin=Company. Sửa CÙNG COMMIT trong foundation/seed/task-permissions.const.ts: TASK_PERMISSION_COUNT 23→24 · thêm dòng vào TASK_GRANT_MATRIX · TASK_EXPECTED_GRANT_COUNTS employee 7→8, manager 19→20, hr 18→19, company-admin 23→24 (bẫy canonical-seed-pin-regression — pin lệch là int-spec đỏ). (2) 0500 (TÁCH RIÊNG — đổi DỮ LIỆU nghiệp vụ, owner đã duyệt), 2 bước theo THỨ TỰ: [bước a] seed 5 state cho MỌI project đang có 0 state (mirror 0420:230-241, ON CONFLICT DO NOTHING) — project tạo SAU 0420 chưa từng được seed, không có bước này thì acceptance 'không task nào còn state_id NULL' KHÔNG THỂ đạt (bẫy M6); [bước b] map tasks.state_id từ task_status cho task có project_id, deleted_at IS NULL. Map theo state_group với BẬC THANG fallback (project có state tự tạo có thể THIẾU nhóm đích, bước a chỉ seed cho project 0 state): nhóm đích → nếu không có thì state is_default → nếu không có nữa thì sort_order nhỏ nhất. Tie-break XÁC ĐỊNH `ORDER BY sort_order, created_at, id` (createStateTx mặc định sortOrder ?? 0 — tasks.repository.ts:564 — nên nhiều state cùng nhóm có thể trùng 0, 'nhỏ nhất' không đơn trị ⇒ migration phải tái lập được). KHÔNG map theo TÊN state (PATCH /states/:id cho đổi tên và POST states đã live ⇒ tên không còn ổn định như thời 0420): Todo→'unstarted', In Progress→'started', In Review→'review' (KHÔNG phải 'started' — nếu map về started thì cột 'Chờ duyệt' vừa thêm ở bước a3 SINH RA ĐÃ RỖNG, đúng thứ a3 lập ra để tránh), Done→'completed', Cancelled→'cancelled'. TUYỆT ĐỐI: task_status IS NULL ⇒ GIỮ NGUYÊN state_id hiện có (task trước 0478 có task_status NULL nhưng 0420 ĐÃ set state_id đúng từ status legacy — quy tắc 'NULL → is_default' của bản 2 sẽ ĐẨY task đã hoàn thành hợp lệ về cột Todo, đúng lỗi mất-dữ-liệu-thị-giác mà WO này sinh ra để tránh, bẫy M2); chỉ gán is_default khi state_id IS NULL VÀ task_status IS NULL. Idempotent bằng WHERE tường minh, KHÔNG dùng mệnh đề 'lệch nhóm' mơ hồ. RLS+FORCE của project_states/tasks đã có từ 0420 — KHÔNG tạo lại. (3) CÙNG 0499: ALTER CHECK `state_group` trên `project_states` để THÊM giá trị `review` (owner chốt 18/07 — không có nhóm này thì không thao tác board nào sinh ra được trạng thái In Review, báo cáo 'chờ duyệt' chết). APPEND giá trị, KHÔNG rewrite danh sách (hot-file). Ánh xạ đầy đủ: backlog|unstarted→Todo · started→In Progress · review→In Review · completed→Done · cancelled→Cancelled. (4) 0500 thêm bước (a2): ĐỔI TÊN 5 cột mặc định đã seed bằng tiếng Anh sang tiếng Việt (Todo→Cần làm · In Progress→Đang làm · Done→Hoàn thành · Cancelled→Đã huỷ; Backlog giữ nguyên) VÀ bước (a3): THÊM cột 'Chờ duyệt' (nhóm review, sort_order chèn giữa Đang làm và Hoàn thành) cho MỌI dự án chưa có cột nhóm review — bộ mặc định nay là 6 cột phủ đủ 6 nhóm; thiếu bước a3 thì task đang In Review rơi vào 'Đang làm' theo bậc thang fallback (đúng luật nhưng MẤT thông tin chờ duyệt) — unique index là (company_id, project_id, name) nên seed đè KHÔNG bị chặn, phải UPDATE tên chứ không INSERT thêm, nếu không dự án sẽ có 10 cột."
    builder: db-migration
    paths: ["apps/api/migrations/**", "apps/api/src/foundation/seed/task-permissions.const.ts", "apps/api/src/foundation/seed/**", "apps/api/src/db/schema/task-activity.ts", "apps/api/src/db/schema/workflow.ts"]  # workflow.ts: CHECK project_states_group_check cung 5 nhom, phai them review
  - id: pipeline-contracts
    task: "packages/contracts/src/task.ts + task-collab.ts. (1) taskCoreResponseSchema += stateId (uuid nullable) + stateName/stateColor/stateGroup (resolved, read-only). (2) createTaskCoreSchema/updateTaskCoreSchema += stateId optional (ĐƯỜNG GHI — bản 1 bỏ sót). (3) projectStateGroupSchema (task.ts:57-65) THEM gia tri 'review' (dang cung 5) — dong bo voi CHECK o workflow.ts. (3b) taskKanbanColumnSchema → discriminated union theo columnMode: {mode:'state', stateId, name, color, stateGroup, sortOrder, taskCount, tasks[]} | {mode:'status', status, tasks[]} — giữ được nhánh status cho dự án 0 state, KHÔNG tuyên bố 'tương thích FE cũ' (bản 1 tự mâu thuẫn). (4) moveTaskStateRequestSchema {stateId: uuid}. (5) Ghi chú vì sao KHÔNG hợp nhất với taskSchema/boardTaskSchema legacy (đã có stateId/stateName — họ DTO PM-1 khác, FE không dùng)."
    builder: backend-builder
    paths: ["packages/contracts/src/task.ts", "packages/contracts/src/task-collab.ts"]
  - id: pipeline-be-write
    task: "MỘT đường ghi state_id duy nhất. (1) task-core.repository.insertTaskCoreTx: task có project_id ⇒ ghi state_id = state is_default của project (findDefaultStateTx trong CÙNG tx); không có default ⇒ state sortOrder nhỏ nhất; project không state ⇒ NULL. (2) TaskCoreService.updateTask nhận stateId. (3) Route POST /tasks/:taskId/move-state = SUGAR gọi lại chính TaskCoreService (mirror cách moveTask gọi changeStatus) — KHÔNG viết guard thứ hai. (3b) GATE + AUTO-MAP ĐẶT Ở METHOD DÙNG CHUNG, KHÔNG Ở ROUTE: `PATCH /tasks/:taskId` gated `update:task` (tasks.controller.ts:204-213) — KHÁC pair `update-state:task`. Nếu chỉ đặc tả gate/auto-map cho route move-state thì PATCH thành CỬA THỨ HAI đổi cột: không qua update-state (pair mới không còn là cổng duy nhất) và không auto-map (thẻ nằm cột 'Hoàn thành' nhưng task_status vẫn In Progress) ⇒ TÁI TẠO ĐÚNG trạng thái lệch pha mà migration 0500 sinh ra để dọn. ⇒ Bất kể vào từ đường nào, hễ payload có stateId KHÁC giá trị hiện tại thì method dùng chung PHẢI: (a) resolveAndAssert('update-state','task'); (b) chạy đúng bậc thang auto-map + changeStatusTx ở mục (5). Leo thang quyền thực tế hiện ≈ 0 (chỉ hr + company-admin có update:task, và cả hai đều sẽ có update-state@Company) nhưng DESYNC dữ liệu áp cho mọi lời gọi. (3c) ÁP DỤNG CHO CẢ NHÁNH TẠO MỚI: `POST /tasks` nhận stateId (contracts lane 2) nhưng lúc tạo KHÔNG có 'giá trị hiện tại' nên điều kiện ở 3b không kích hoạt ⇒ tạo thẻ thẳng vào cột nhóm started/completed (chính là nút '+ Thêm công việc' ở đáy mỗi cột trên board — đường tạo CHÍNH, không phải ca hiếm) sẽ sinh thẻ nằm cột Hậu Kỳ nhưng task_status='Todo' do insertTaskCoreTx hardcode (task-core.repository.ts:376) ⇒ desync NGAY TỪ LÚC SINH. Nếu payload tạo có stateId tường minh thì phải (a) resolveAndAssert('update-state','task') như đường cập nhật, và (b) suy task_status khởi tạo từ STATE_GROUP_TO_STATUS[state.state_group] thay vì hardcode 'Todo'. KHÔNG truyền stateId ⇒ giữ nguyên hành vi mục (1): is_default + 'Todo' (đã nhất quán by construction — is_default của 0420 là Todo/unstarted và fallback sort_order nhỏ nhất là Backlog/backlog, cả hai đều map về 'Todo'). (4) move-state PHẢI double-gate như mọi mutate task khác: PermissionGuard(update-state:task) + dataScope.resolveAndAssert + assertInScopeForWrite (ngoài scope ⇒ 404) + loadWorkflowChecked (task workflow-driven ⇒ 400) — mirror task-actions.service.ts:452-514. (4b) HAI SCOPE RIÊNG — CHỐNG BYPASS QUYỀN: `resolveAndAssert` là cổng 403 DUY NHẤT của đường đổi status và nó nằm NGOÀI withTenant (task-actions.service.ts:169-175); tách changeStatusTx ra là MẤT cổng đó. Vì vậy move-state phải resolve RIÊNG BIỆT: scopeState = resolveAndAssert('update-state','task') cho việc đổi cột; và CHỈ KHI auto-map thực sự phải đổi status mới resolve tiếp scopeStatus = resolveAndAssert('update-status','task') rồi truyền ĐÚNG scopeStatus vào changeStatusTx. TUYỆT ĐỐI KHÔNG truyền scopeState vào changeStatusTx (actor update-state@Company + update-status@Own sẽ thao tác status ở phạm vi rộng hơn grant thật = scope confusion). Kéo sang cột CÙNG nhóm ⇒ không đổi status ⇒ KHÔNG đòi update-status. (5) Sau khi đổi state THÀNH CÔNG: map state_group → status; nếu KHÁC status hiện tại thì gọi `changeStatusTx(tx, ...)` (lõi đã tách ở lane fsm — KHÔNG gọi changeStatus wrapper, nó tự mở tx ⇒ deadlock) trong CÙNG tx ⇒ atomic thật. Nếu TRÙNG thì bỏ qua (không phát event rác). Sau khi FSM đã nới cho nhảy cấp mọi hướng, nhánh 'FSM từ chối' chỉ còn xảy ra với task Cancelled ⇒ khi đó CẢ move-state fail (không để cột và status lệch nhau). (6) audit: move-state ghi action RIÊNG `TASK_STATE_CHANGED`; auto-map sinh thêm `TaskStatusChanged` do changeStatusTx ghi ⇒ 1 lần kéo = 1 TASK_STATE_CHANGED + (0 hoặc 1) TaskStatusChanged. KHÔNG ghi trùng audit/activity cho cùng một việc. (6b) `task_activity_logs` ĐÃ ĐỦ TRƯỜNG để dựng lịch sử 'Chuyển đến cột' kiểu MISA (actor_user_id/actor_employee_id · created_at · old_values/new_values jsonb · action · target_type — task-activity.ts:32-46) ⇒ KHÔNG cần thêm cột. NHƯNG old_values/new_values PHẢI mang cả stateId VÀ stateName (tên cột tại thời điểm đó — cột có thể bị đổi tên sau qua PATCH /states/:id, nếu chỉ lưu id thì lịch sử render sai tên về sau). (6c) ĐÃ KIỂM CHỨNG (sửa mô tả sai của bản trước): CHECK `chk_task_activity_target_type` (task-activity.ts:58-61) chỉ ràng buộc cột `target_type`; cột `action` KHÔNG có CHECK nào. ⇒ Nếu bản ghi đổi cột dùng `target_type='Task'` thì KHÔNG cần ALTER gì. Chỉ ALTER (kiểu UNION, append — CLAUDE.md §9 hot-file) NẾU chọn target_type mới. Cặp (action, target_type) phải ghim trong DB-06 trước khi code, KHÔNG để lane tự đoán."
    builder: backend-builder
    paths: ["apps/api/src/tasks/**"]  # mở rộng: 4 int-spec mới (bypass quyền, scope-confusion, cửa thứ hai PATCH, atomic Cancelled) phải colocated trong src/**
  - id: pipeline-be-read
    task: "Kanban đọc theo project_states. (0) LỌC TASK CON: board CHỈ hiện task cha ⇒ thêm điều kiện `parent_task_id IS NULL` vào truy vấn board NGAY ĐỢT NÀY, dù subtask chưa được build (cột parent_task_id đã có từ mig 0478, hiện 0 code dùng ⇒ mệnh đề này vô hại lúc này). Owner chốt 2026-07-18: việc con ẩn khỏi board, chỉ hiện trong task cha (khớp ảnh tham chiếu — KB 14 là 1 thẻ chứa 8 việc con). KHÔNG thêm bây giờ = ngày subtask lên thì board phình gấp nhiều lần và phải sửa lại truy vấn đã qua review. (1) getBoard: project có state active ⇒ columnMode:'state', dựng cột theo sortOrder, nhóm task theo state_id, task state_id NULL rơi vào cột is_default (KHÔNG biến mất khỏi board); project 0 state (chỉ dự án tạo SAU 0420 — xem §Sửa sai) ⇒ columnMode:'status' y hệt hành vi cũ. (2) TASK_CORE_SELECT/mapper: LEFT JOIN project_states trả stateName/stateColor/stateGroup. (3) Giữ nguyên buildReadScopeExists + KANBAN_TASK_LIMIT + pair view-kanban:task."
    builder: backend-builder
    paths: ["apps/api/src/tasks/task-kanban.service.ts", "apps/api/src/tasks/task-core.mapper.ts"]
  - id: pipeline-be-seed
    task: "Dự án mới có pipeline mặc định. ProjectsService.createProject: seed 5 project_states mặc định TRONG CÙNG tx tạo project (audit-in-tx), khớp khuôn 0420 (Backlog/Todo/In Progress/Done/Cancelled + state_group + màu + is_default='Todo'). Rollback tx ⇒ 0 state mồ côi."
    builder: backend-builder
    paths: ["apps/api/src/tasks/projects.service.ts", "apps/api/src/tasks/tasks.repository.ts"]
  - id: pipeline-fe
    task: "FE nối project_states. (1) web-core: client task-states-api (list/create/update/delete — 4 route đã có) + moveTaskState. (2) TaskKanbanPage: dựng cột từ board.columns theo discriminated union; màu/tên/đếm từ column; DnD gọi move-state, giữ optimistic + rollback khi 4xx. (3) columnMode:'status' render như cũ. (4) Thẻ hiển thị badge task_status BÊN CẠNH cột (người dùng thấy được auto-map đã chạy). (5) Quản lý cột (thêm/đổi tên/màu/sắp xếp) gate create/update/delete:project_state. (6) i18n vi."
    builder: frontend-builder
    paths: ["apps/app/src/routes/tasks/**", "packages/web-core/src/lib/**", "apps/app/src/i18n/**"]
acceptanceChecks:
  - "ADR + SPEC-06/API-06/DB-06 cập nhật XONG TRƯỚC khi merge code (spec là nguồn sự thật — không để code thành spec ngầm)."
  - "Migration 0500 bước a: MỌI project (kể cả tạo sau 0420) có đủ 5 state, không nhân đôi state cho project đã có (ON CONFLICT)."
  - "Migration 0500 bước b: task có project_id + task_status='Done' ⇒ state_id trỏ state nhóm 'completed'; 'In Review' ⇒ nhóm 'review' (KHÔNG phải 'started'); 0 task có project_id còn state_id NULL. Đếm TRƯỚC/SAU trên lane DB."
  - "0500 KHÔNG đụng task có task_status IS NULL mà state_id đã đúng (task trước 0478) — assert số task nhóm 'completed' KHÔNG GIẢM sau migration."
  - "Dự án backfill 0420 (100% dự án hiện hữu): board trả columnMode:'state', thẻ nằm ĐÚNG cột theo task_status thật — KHÔNG dồn hết về một cột. Đây là regression quan trọng nhất."
  - "Kéo thẻ sang cột nhóm 'completed' ⇒ task_status='Done' + completed_at set + 1 TASK_STATE_CHANGED + 1 TaskStatusChanged + event phát. Kéo sang cột CÙNG nhóm ⇒ chỉ 1 TASK_STATE_CHANGED, KHÔNG event status rác."
  - "Kéo VƯỢT CẤP (cột nhóm 'unstarted' → thẳng nhóm 'completed', tức Todo→Done) ⇒ THÀNH CÔNG sau khi nới FSM — đây là thao tác hằng ngày trên board 7 cột, KHÔNG được 409."
  - "Kéo NGƯỢC từ 'completed' về 'started' ⇒ THÀNH CÔNG; task_status về In Progress; completed_at + completed_by RESET VỀ NULL (dùng nhánh 'clear' của repo); audit ghi rõ hành vi mở lại."
  - "Task Cancelled: kéo ra khỏi cột huỷ ⇒ được (khôi phục, có audit); nhưng assign/change-priority/change-deadline trên task Cancelled VẪN 422 (chỉ nới đường changeStatus, không mở quyền sửa task đã huỷ)."
  - "move-state double-gate: actor update-state@Own kéo thẻ của người khác ⇒ 404; task workflow-driven (workflow_step_id != null) ⇒ 400; state của project khác/tenant khác ⇒ 4xx, KHÔNG ghi."
  - "Atomic: FSM từ chối mapping ⇒ state_id KHÔNG đổi (không lệch cột-vs-status)."
  - "Task tạo mới trong dự án có pipeline ⇒ state_id = state is_default (không NULL)."
  - "Permission pair update-state:task seed đúng per-(role,pair) theo ma trận employee=Own · manager=Team · hr=Company · company-admin=Company (mirror update-status:task); TASK_PERMISSION_COUNT=24 + TASK_GRANT_MATRIX + TASK_EXPECTED_GRANT_COUNTS (employee 8 · manager 20 · hr 19 · company-admin 24) cập nhật CÙNG COMMIT; task-permissions-seed.int.spec xanh; grant verify theo từng role bằng query DB THẬT (không grep)."
  - "Auto-map KHÔNG bypass quyền: kéo thẻ làm đổi status vẫn đòi update-status:task, và chạy ở ĐÚNG scope của pair đó (không mượn scope của update-state)."
  - "Dự án chỉ còn ĐÚNG 1 state: board render bình thường (1 cột), không crash, không mất thẻ."
  - "Board CHỈ hiện task cha: truy vấn có `parent_task_id IS NULL`. Test dựng task con thủ công (INSERT trực tiếp, vì CRUD subtask chưa có ở đợt này) ⇒ con KHÔNG lên board, đếm cột KHÔNG tính con."
  - "Lịch sử 'Chuyển đến cột' dựng được từ task_activity_logs: mỗi lần kéo ghi 1 dòng có actor + thời điểm + old/new mang CẢ stateId VÀ stateName; đổi tên cột sau đó KHÔNG làm sai lịch sử cũ."
  - "CHECK chk_task_activity_target_type đã ALTER kiểu UNION trước khi move-state chạy (thiếu ⇒ mọi lần kéo thẻ 500 dù logic đúng)."
  - "check.sh --lane-db XANH; coverage ≥80% cho task-fsm.ts + task-core.service.ts — LƯU Ý: script `test:cov:sensitive` KHÔNG tồn tại (apps/api/package.json:12 chỉ có test:cov hardcode src/workflow) ⇒ WO này phải THÊM script hoặc chạy vitest --coverage.include tường minh; không viết acceptance dựa vào script không có."
testTasks:
  - "RED deny-path (int, LANE_DB): actor có update-state:task@Own kéo thẻ của người khác ⇒ 404, state_id nguyên vẹn."
  - "RED deny-path (int): actor thiếu update-state:task ⇒ 403 (chứng minh pair mới thật sự gate, KHÔNG lọt qua update-status:task)."
  - "RED deny-path (int): stateId thuộc project khác ⇒ 4xx; cross-tenant (state của company B) ⇒ 404, RLS không rò."
  - "RED (int): task workflow-driven ⇒ move-state 400 (không lách FSM studio qua đường mới)."
  - "RED (unit, task-fsm.spec): SAU khi nới — Todo→Done, Todo→In Review, Done→In Progress, In Progress→Todo, In Review→Todo đều HỢP LỆ (đỏ trước khi sửa bảng); Cancelled→Todo hợp lệ (chứng minh đã BỎ early-return 422 ở evaluateTransition:67, nếu không mục Cancelled là code chết)."
  - "RED (unit): rời Done ⇒ completedAt/completedBy clear; rời Cancelled ⇒ cancelledAt clear (nhánh 'clear' của task-actions.repository.ts:70-77 hiện chưa ai dùng)."
  - "RED deny-path (int): task Cancelled ⇒ assign / change-priority / change-deadline VẪN 422 (loadMutable chỉ nới cho đường changeStatus)."
  - "Int NO-DEADLOCK: move-state có auto-map chạy trong 1 tx qua changeStatusTx — assert hoàn tất dưới timeout (nếu gọi nhầm wrapper changeStatus sẽ treo tới lock timeout, test này bắt được)."
  - "Int REGRESSION QUAN TRỌNG NHẤT (LANE_DB): dựng dữ liệu giống production — (i) task task_status='Done', state_id NULL (tạo sau 0420); (ii) task task_status NULL nhưng state_id ĐÃ trỏ nhóm completed (trước 0478); (iii) task cũ state_id trỏ 'Todo' — chạy 0500 → assert (i) nhảy sang cột completed, (ii) GIỮ NGUYÊN cột completed (không bị đẩy về Todo — bẫy M2), (iii) đúng theo task_status. Fixture TUYỆT ĐỐI KHÔNG tự set state_id cho nhóm (i)."
  - "Int: project tạo SAU 0420 (0 state) — sau 0500 bước a có đủ 5 state; project đã có state không nhân đôi."
  - "Int: kéo sang cột completed ⇒ task_status Done + completed_at NOT NULL + 1 event TASK_STATUS_CHANGED + audit_logs ĐÚNG 2 dòng (1 TASK_STATE_CHANGED + 1 TaskStatusChanged, action phân biệt)."
  - "Int: kéo giữa 2 cột CÙNG state_group ⇒ task_status không đổi, chỉ 1 TASK_STATE_CHANGED, 0 event status (chống rác)."
  - "Int: kéo ngược completed → started thành công; completed_at VÀ completed_by RESET VỀ NULL (một chiều, không có vế 'hoặc giữ')."
  - "RED bypass quyền (int): actor CÓ update-state:task nhưng THIẾU update-status:task — (a) kéo sang cột KHÁC nhóm ⇒ 403 VÀ state_id KHÔNG đổi (atomic, không được đổi cột rồi mới 403); (b) kéo sang cột CÙNG nhóm ⇒ THÀNH CÔNG (không đổi status thì không cần quyền status). Đây là deny-path quan trọng nhất của WO."
  - "RED scope confusion (int): actor update-state@Company + update-status@Own ⇒ thao tác status chạy ở phạm vi Own, KHÔNG mượn scope Company của update-state. PIN MÃ HTTP: với scopeStatus=Own thì assertInScopeForWrite trả 404 (KHÔNG phải 403) — assert đúng 404 + state_id không đổi."
  - "RED cửa thứ hai (int): PATCH /tasks/:taskId {stateId} bởi actor có update:task nhưng THIẾU update-state:task ⇒ 403, state_id KHÔNG đổi (gate nằm ở method dùng chung, không ở route)."
  - "Int: PATCH /tasks/:taskId đổi stateId sang cột KHÁC nhóm ⇒ task_status auto-map Y HỆT move-state (cùng method dùng chung, không có đường vòng bỏ qua auto-map)."
  - "RED desync-lúc-sinh (int): POST /tasks {stateId} của cột nhóm 'started' ⇒ task_status khởi tạo = 'In Progress' (KHÔNG phải 'Todo' hardcode); actor thiếu update-state:task ⇒ 403. Đây là đường tạo CHÍNH trên board (nút '+ Thêm công việc' đáy cột), không phải ca hiếm."
  - "Int: POST /tasks KHÔNG truyền stateId ⇒ state_id = is_default VÀ task_status = 'Todo' (nhất quán, giữ hành vi cũ)."
  - "Int LỌC CON: INSERT trực tiếp 1 task có parent_task_id trỏ task cha trong cùng project ⇒ GET /projects/:id/kanban KHÔNG trả task con, taskCount của cột KHÔNG tính con. (CRUD subtask thuộc WO S5-TASK-SUBTASK-1; test này chỉ chốt bộ lọc để board không phình khi WO đó land.)"
  - "LƯU Ý dựng role cho 2 deny-path bypass/scope-confusion: 4 role canonical đều có update-status VÀ update-state cùng scope (ma trận mirror nhau) ⇒ phải dựng ROLE TUỲ BIẾN trong test, không dùng role chuẩn."
  - "Int ATOMIC: task đang Cancelled kéo thẳng sang cột nhóm completed ⇒ FSM từ chối (Cancelled → {Todo, In Progress}) ⇒ state_id KHÔNG đổi. Dùng kịch bản THẬT, KHÔNG mock FSM trong int test."
  - "Int: tạo task trong dự án có pipeline ⇒ state_id = is_default; trong dự án 0 state ⇒ NULL, board vẫn hiện thẻ ở cột status."
  - "Int: dự án 0 state ⇒ columnMode:'status', 5 cột FSM."
  - "Seed pin: task-permissions-seed.int.spec assert 24 pair; grant-count theo role thật (chạy CÔ LẬP — memory super-admin-bootstrap-flaky)."
  - "FE spec: union 'state' kéo gọi move-state + rollback khi 4xx; union 'status' render cũ, không kéo; badge status hiển thị cạnh cột."
steps:
  - "pipeline-adr TRƯỚC TIÊN — không code khi spec chưa sửa (BLOCKING #7 của plan-reviewer)."
  - "pipeline-fsm (nới FSM + hằng map) — crown, RED trước ở task-fsm.spec."
  - "pipeline-migration NỐI TIẾP (0499 perm + pin catalog, rồi 0500 backfill dữ liệu). Chạy trên lane DB, đếm trước/sau."
  - "pipeline-contracts, rồi BUILD contracts + web-core (memory stale-contracts-dist-typecheck-false-red)."
  - "pipeline-be-write → pipeline-be-read → pipeline-be-seed TUẦN TỰ (paths chồng nhau ở tasks/** — bản 1 khai song song là SAI)."
  - "pipeline-fe SAU khi BE xanh (cần payload thật, không đoán shape)."
  - "RED deny-path TRƯỚC → GREEN → FULL gate (security-reviewer + database-reviewer) → check.sh --lane-db → NGƯỜI CHỐT (crown: đổi luật FSM + đổi dữ liệu)."
```

---

## §Sửa sai — bản 1 bị BLOCK vì 2/3 tiền đề hiện trạng SAI

`plan-reviewer` kiểm chứng bản 1 và tôi đã tự xác nhận lại từng điểm:

| Bản 1 nói | Thực tế | Bằng chứng |
| --- | --- | --- |
| "Dự án hiện hữu KHÔNG có project_states ⇒ cần fallback" | **NGƯỢC**: mig 0420 backfill 5 state cho **MỌI** project qua `CROSS JOIN` | `0420_pm_foundation.sql:230-241` |
| "`state_id` sẵn sàng, chỉ cần nhóm theo nó" | `state_id` backfill từ cột **`status` legacy** (0420 chạy TRƯỚC 0478 tạo `task_status`); task tạo sau 0420 có `state_id = NULL` | `0420:244-260` · `task-core.repository.ts:365-385` |
| "`tasks.state_id` đã tồn tại, không cần migration cho cột" | ✅ **ĐÚNG** — cột thật + index `tasks_company_state_active_idx`, `project_states` có RLS + FORCE | `0420:153,164-166,52-58` |

**Hệ quả nếu code theo bản 1:** Kanban đang đọc `task_status` (`task-core.repository.ts:123`) nhưng `state_id` lệch pha với nó ⇒ chuyển board sang nhóm theo `state_id` sẽ **dồn toàn bộ task gần đây về một cột**. Fixture test tự set `state_id` sẽ không bao giờ bắt được — nên testTask regression ở bản 2 **cấm** fixture tự set.

## §Sửa sai vòng 2 — bản 2 bị REVISE vì quyết định nới FSM sinh rủi ro mới

Bản 2 gỡ được 7/8 blocking của bản 1, nhưng `plan-reviewer` chỉ ra 6 rủi ro mới; tôi tự xác minh 3 cái nặng nhất:

| Mã | Vấn đề | Xác minh |
| --- | --- | --- |
| **M1** | `changeStatus` **tự mở transaction** ⇒ gọi trong tx sẵn có = 2 connection, tx con chờ row lock của tx cha ⇒ **tự deadlock**. Câu "gọi trong cùng tx" của bản 2 là bất khả thi. | `task-actions.service.ts:176` → `db.service.ts:83` `db.transaction(...)` |
| **M4** | `evaluateTransition` trả 422 cho `Cancelled` **trước khi tra bảng** ⇒ thêm `Cancelled: {Todo}` là **code chết**. Và `loadMutable` chặn Cancelled dùng chung cho assign/priority/deadline ⇒ nới bừa sẽ mở luôn quyền sửa task đã huỷ. | `task-fsm.ts:67-69` · `task-actions.service.ts:460-464` |
| **M3** | `TRANSITIONS.Todo = {In Progress, Cancelled}` — **không có `Done`** ⇒ kéo *Ý Tưởng* → *SEO* (thao tác hằng ngày trên board 7 cột) sẽ **409 và bật thẻ về chỗ cũ**. | `task-fsm.ts:22` |

Ngoài ra: **M2** (0500 đẩy task đã hoàn thành hợp lệ về cột đầu) · **M5** (`completed_at`/`cancelled_at` không bao giờ reset khi mở lại ⇒ lead-time sai) · **M6** (project tạo sau 0420 không bao giờ có state ⇒ 2 acceptance phủ định nhau). Tất cả đã vá ở bản 3.

## §Sửa sai vòng 3 — bản 3 bị REVISE vì BYPASS QUYỀN

| Mã | Vấn đề | Xác minh |
| --- | --- | --- |
| **B1** | `resolveAndAssert('update-status','task')` là **cổng 403 duy nhất** của đường đổi status và nó nằm **ngoài** `withTenant` ⇒ tách `changeStatusTx` ra là **mất cổng**. Actor có `update-state` nhưng **không có** `update-status` vẫn set được `Done` + `completed_at` + phát event. Đó là **bypass quyền**. Kèm theo: truyền nhầm scope của `update-state` vào lõi ⇒ **scope confusion** (thao tác status chạy rộng hơn grant thật). | `task-actions.service.ts:169-175` |
| **B2** | Lane migration nói "mirror khuôn 0485" nhưng **không liệt kê role/scope nào** — phần quan trọng nhất của một migration vùng đỏ. `0485` an toàn chính vì liệt kê từng dòng + verify exact-count. Không có ma trận thì implementer tự đoán, rơi đúng bẫy `blanket-grant-migration-role-drift`. | `task-permissions.const.ts:81,147` |

## §Sửa sai vòng 4 — bản 4 bị REVISE vì CỬA THỨ HAI

**B3.** Bản 4 thêm `stateId` vào `updateTaskCoreSchema` (DTO của `PATCH /tasks/:taskId`, gated `update:task`) nhưng đặc tả gate hai-scope + auto-map **chỉ viết cho route `move-state`**. Hệ quả: `PATCH` thành cửa thứ hai đổi cột — không qua `update-state:task` (pair mới không còn là cổng duy nhất như acceptance tuyên bố) và không auto-map ⇒ thẻ nằm cột "Hoàn thành" trong khi `task_status` vẫn `In Progress`. Đó **chính là** trạng thái lệch pha mà migration 0500 sinh ra để dọn — ship xong là tự tạo lại nợ.

Leo thang quyền thực tế ≈ 0 (chỉ `hr` + `company-admin` có `update:task`, và cả hai đều sẽ có `update-state@Company`), nhưng **desync dữ liệu áp cho mọi lời gọi** và không test nào phủ.

Vá bản 5: chuyển gate + auto-map vào **method dùng chung** của `TaskCoreService` thay vì gắn ở route — hễ payload có `stateId` khác giá trị hiện tại thì luôn resolve `update-state` và chạy auto-map, bất kể vào từ `PATCH` hay `move-state`. Thêm 2 test (deny-path PATCH thiếu `update-state` ⇒ 403 · PATCH đổi nhóm ⇒ auto-map y hệt). Kèm 2 chỉnh cơ học: pin **404** (không phải 403) cho ca scope-confusion vì `assertInScopeForWrite` trả 404 khi scope hẹp; mở `paths` hai lane thành `apps/api/src/tasks/**` vì spec mới phải colocated trong `src/**` mới được vitest chạy.

---

Vá bản 4: move-state resolve **hai scope riêng biệt**, chỉ đòi `update-status` khi auto-map thực sự đổi status; ma trận grant liệt kê tường minh (mirror `update-status:task`) + cập nhật cả `TASK_GRANT_MATRIX` và `TASK_EXPECTED_GRANT_COUNTS`, không chỉ `TASK_PERMISSION_COUNT`. Thêm 2 deny-path RED cho bypass + scope confusion. Cộng W1 (pool-exhaustion do `SettingService` tự mở tx), W2/W3 (bậc thang fallback + tie-break xác định cho 0500), W4–W6 (gỡ mâu thuẫn acceptance↔test), W7 (ADR ghi FSM gần no-op).

## Ba quyết định của owner (2026-07-18)

**1. Nới FSM + auto-map.** Kéo thẻ sang cột nhóm `completed` ⇒ gọi `TaskActionsService.changeStatus` theo đúng FSM (audit + notification đầy đủ), đồng thời **nới luật `Done → {}`** để kéo ngược được.

*Lý do:* với board 7 cột kiểu MISA, người dùng sống trong board và sẽ không bao giờ bấm nút đổi trạng thái riêng. Nếu tách hoàn toàn thì `task_status` đóng băng ở `Todo` ⇒ `countsByStatus` sai, `mv_dashboard_task_status` sai, `isOverdue` **luôn true** (tính theo `task_status NOT IN ('Done','Cancelled')` — `task-core.repository.ts:136-137`), `completed_at` luôn NULL. Và trong sản xuất video, trả-về-sửa là chuyện thường ngày — luật cấm mở lại là sai với nghiệp vụ thật.

*Phạm vi:* chỉ đổi FSM của task văn phòng (`task_status`). Task HR duyệt đơn dùng cột `status` legacy riêng ⇒ **không ảnh hưởng** luồng phê duyệt nghỉ phép / điều chỉnh công.

**2. Migration backfill `state_id` từ `task_status`.** Owner duyệt việc đổi dữ liệu. Tách thành migration RIÊNG (0500) để rollback độc lập với 0499.

**3. Nới FSM cho task văn phòng: CHO NHẢY CẤP MỌI HƯỚNG.** Bảng transition mới cho phép mọi cặp giữa 4 status hoạt động (Todo · In Progress · In Review · Done), cộng `Cancelled` là đích hợp lệ từ mọi nơi và `Cancelled → {Todo, In Progress}` để khôi phục.

*Lý do:* trên board pipeline, **quy trình đã nằm ở thứ tự cột**, không còn ở bảng FSM. Cột *Duyệt Video* chính là bước review — kỷ luật không mất mà chuyển chỗ, và nó hiển thị được cho người dùng thay vì ẩn trong enum. Giữ FSM chặt sẽ khiến thao tác kéo hằng ngày trả 409 (M3), tức là đánh nhau với chính mục tiêu của WO.

*FSM còn giữ vai trò gì:* (a) chặn sửa task đã huỷ ở các đường KHÁC changeStatus (assign/priority/deadline vẫn 422); (b) sinh audit + event `TASK_STATUS_CHANGED` chuẩn cho mọi lần đổi; (c) giữ nguyên luật cho task workflow-driven (`WORKFLOW_TASK_TYPES`) — board pipeline không áp cho nhóm đó.

*Không tạo permission pair mới cho khôi phục:* dùng chính `update-status:task`, audit ghi phân biệt hành vi. Thêm pair thứ hai làm phình catalog (đã 23→24 vì `update-state:task`) mà không thêm khả năng kiểm soát thực chất — nếu owner muốn tách quyền khôi phục, đưa vào ADR như quyết định riêng.

## Rủi ro còn lại

**R1 — Đổi luật FSM là crown.** `Done → {}` đang được nhiều spec assert. Sửa chúng là **đổi luật có chủ đích**, không phải sửa test cho qua — phải nêu trong ADR và người chốt duyệt. Cần grep toàn bộ nơi đang dựa vào "Done là terminal" trước khi sửa.

**R2 — `completed_at`/`cancelled_at` khi mở lại — ĐÃ CHỐT:** rời `Done` ⇒ `completedAt:'clear'` + `completedBy` null; rời `Cancelled` ⇒ `cancelledAt:'clear'`. Repo đã hỗ trợ nhánh `'clear'` (`task-actions.repository.ts:70-77`) nhưng **chưa ai dùng** — hiện `changeStatus` chỉ truyền `'now' | 'keep'` (`task-actions.service.ts:196-199`). Không chốt thì task mở lại vẫn mang `completed_at` cũ ⇒ lead-time và báo cáo sai.

**R6 — Task HR không bị ảnh hưởng, nhưng KHÔNG tuyệt đối.** `HrTasksService` chỉ ghi cột `status` legacy nên FSM `task_status` không đụng luồng duyệt đơn. Tuy nhiên `'hr'` **không** nằm trong `WORKFLOW_TASK_TYPES` (`task-actions.service.ts:41`) nên task HR vẫn gọi được change-status; `project_id` NULL nên không lên board ⇒ rủi ro thấp. ADR **không được** khẳng định tuyệt đối.

**R8 — FSM sau khi nới gần như no-op.** Nhánh `409 TASK-ERR-WORKFLOW-INVALID` trở nên gần-không-với-tới (ca từ chối thật duy nhất còn lại: task đang `Cancelled` kéo sang đích ngoài `{Todo, In Progress}`). ADR phải ghi rõ điều này, và mọi spec cũ đang assert 409 phải **viết lại theo ca Cancelled** — KHÔNG xoá assert (mất luôn lưới an toàn). Hệ quả quản trị: kỷ luật quy trình giờ nằm ở **thứ tự cột + quyền cấu hình cột**, nếu sau này cần ép duyệt cứng cho một loại việc thì phải làm bằng cơ chế khác (ví dụ khoá cột theo quyền), không quay lại dựa vào FSM.

**R7 — Cột `Backlog` sẽ luôn rỗng sau backfill.** 0420 tạo state tên `Backlog` nhưng `task_status` không có giá trị tương ứng. Không mất dữ liệu, nhưng phải nói rõ trong ADR/ghi chú phát hành, nếu không người dùng tưởng board hỏng.

**R10 — Nguồn phần trăm tiến độ trên thẻ (owner chốt mô hình việc con 2026-07-18).** Ảnh tham chiếu cho thấy `%` trên thẻ CHÍNH LÀ tỉ lệ việc con hoàn thành — kiểm chứng số học khớp tuyệt đối: `4/5=80` · `1/3=33` · `1/4=25` · `5/6=83` · `7/8=88` · `6/7=86`. Owner chốt việc con = **subtask thật** (`parent_task_id`), ẩn khỏi board.

Hệ quả cho đợt A: thẻ kanban hiện có `checklistDone/checklistTotal` (ship PR #207) — **KHÔNG** phải nguồn tiến độ theo mô hình mới. Nhưng CRUD subtask chưa build, nên:
- **Đợt A GIỮ NGUYÊN** badge checklist như hiện tại, **KHÔNG** thêm `%` từ checklist (nếu thêm rồi sau đổi sang subtask thì đổi ngữ nghĩa cùng một con số trước mắt người dùng — tệ hơn là chưa có).
- `%` tiến độ = tỉ lệ **subtask** hoàn thành, thuộc WO `S5-TASK-SUBTASK-1`. Task không có subtask ⇒ **không hiện `%`** (một nguồn duy nhất, không fallback hai nguồn cùng hình thức — fallback là bẫy mơ hồ).
- Đợt A **chỉ** phải làm 1 việc cho tương lai: bộ lọc `parent_task_id IS NULL` ở truy vấn board (lane be-read mục 0).

**R9 — Hai writer `state_id` ungated còn sót trong cây (không chặn, nhưng ADR phải ghi).** `tasks.repository.ts:393` (`createTask(data.stateId)`, chỉ đến từ `TasksService.createHubTask`) và `tasks.repository.ts:453` (`updateTaskFieldsTx(fields.stateId)`, chỉ đến từ `updateTaskFields` — không route nào tới, xem R3). Cả hai **không gate, không auto-map**. Hôm nay vô hại vì không route nào set `stateId` qua đó (`POST /tasks` đi `taskCore.createTask`; `createMeetingActionTask` truyền `projectId: null`). ADR phải ghi một dòng: *"đây là 2 writer `state_id` ungated cuối cùng — KHÔNG được nối route vào nếu chưa áp quy tắc 3b/3c"*, và gắn cảnh báo này vào WO dọn code chết.

**R3 — Đường ghi `state_id` thứ ba.** `TasksService.updateTaskFields` (`tasks.service.ts:308-359`) đã guard `stateInProjectTx` + có test, **nhưng không route nào tới** (`PATCH /tasks/:taskId` đi `taskCore.updateTask`) ⇒ code chết. Bản 2 chốt: **một** đường ghi qua `TaskCoreService`; `updateTaskFields` để WO dọn code chết xử lý (cùng loại với `S5-LEAVE-DEADCODE-1`). KHÔNG để hai nơi guard khác nhau cho cùng một cột.

**R4 — Pin catalog quyền.** `TASK_PERMISSION_COUNT = 23` (`task-permissions.const.ts:51`) + int-spec assert 23. Thêm pair thứ 24 phải sửa CÙNG COMMIT, và `foundation/seed/**` phải nằm trong `paths` (bản 1 bỏ sót ⇒ `guard-scope` cảnh báo + pin drift).

**R5 — Cột duy nhất / state bị xoá hết.** Dự án còn đúng 1 state ⇒ board 1 cột không kéo đi đâu được. `deleteState` đã chặn xoá khi còn task sống nhưng `countTasksByStateTx` chỉ đếm `deleted_at IS NULL` ⇒ task đã soft-delete vẫn giữ tham chiếu mồ côi. Ghi rõ hành vi kỳ vọng trong ADR.

## Ngoài phạm vi

Tab Gantt/Lịch/Tài liệu/Biểu mẫu (đợt D2–D5) · sidebar cây phòng ban (đợt B) · quyền per-project (đợt C) · template pipeline lúc tạo dự án (owner hỏi mở — WO riêng) · automation per-column · WIP limit · swimlane · dọn `updateTaskFields` chết.
