```yaml
wo: S4-TASK-RECON-1
zone: red
generated_by: auto-loop
reconciled_at: "dfdf3ce"
lanes: [{"id":"reconMig","task":"[NỐI TIẾP · crown] Migration reconcile TASK pair-drift + grant tồn dư (số kế tiếp head 0479 → 0480; chạy `ls apps/api/migrations/*.sql | tail -1` NGAY TRƯỚC khi tạo, KHÔNG hard-code). THUẦN ADDITIVE data, KHÔNG DDL/RLS/policy 0005. Nội-thứ-tự BẮT BUỘC: (1) INSERT (comment,'task') is_sensitive=false ON CONFLICT(action,resource_type) DO NOTHING — KHÔNG đụng is_sensitive row khác; (2) grant (comment,task) ALLOW cho role canonical đang GIỮ comment:comment (employee + company-admin) via ON CONFLICT(role_id,permission_id,effect) DO NOTHING, data_scope theo §6 (company-admin=Company, employee=Own); (4) PARK residual legacy TASK/PROJECT cho 4 role canonical bằng per-pair DELETE (resolve role_id+permission_id trong DO-block như 0444/0445, TUYỆT ĐỐI KHÔNG blanket theo role_id) — company-admin: gỡ (submit,task),(manage,task),(manage,project),(assign,project),(comment,comment); employee: gỡ (submit,task),(comment,comment); manager/hr: không có gì để gỡ. Idempotent bộ-ba, journal đơn điệu.","builder":"db-migration","paths":["apps/api/migrations/**"]},{"id":"controllerSwap","task":"[phụ thuộc reconMig] Đổi @RequirePermission('comment','comment') → ('comment','task') tại apps/api/src/tasks/tasks.controller.ts:206 (POST /tasks/:taskId/comments) — CHỈ đổi cặp, giữ nguyên PermissionGuard/UseGuards/comment JSDoc. Cập nhật unit spec colocated tasks.permissions.spec.ts: GUARDED_MUTATIONS addComment resourceType 'comment'→'task' + JSDoc L47-48. Grep xác nhận 'comment','comment' trong apps/api/src == 0 sau đổi. KHÔNG đụng foundation/seed/** (runtime seeder không seed RBAC role_permissions — đã xác minh; giữ ngoài lane này).","builder":"backend-builder","paths":["apps/api/src/tasks/**"]},{"id":"reconVerify","task":"[phụ thuộc reconMig; RED-trước] Int-spec đối soát grant + deny-path. File mới apps/api/test/integration/task-recon-grants.int-spec.ts mirror hr-seed-permissions.int-spec.ts, gate hasDb && !!process.env.LANE_DB: assert catalog (comment,task) is_sensitive=false; assert TẬP grant (action,resource) trên resource task+project của MỖI 4 role canonical == kỳ vọng (không dư/không thiếu); assert (comment,comment) đã gỡ khỏi employee+company-admin; assert FORBIDDEN residual (submit:task,manage:task,manage:project,assign:project) KHÔNG còn grant cho 4 role canonical. Deny-path (mirror task-core-tenant-deny): can(comment,task)=true cho employee/company-admin → route 2xx, role không grant → 403; engine can()=false cho employee {create,update,delete,close,archive}:project và hr {close,delete,archive,manage-member}:project + delete:task.","builder":"backend-builder","paths":["apps/api/test/integration/**"]}]
acceptanceChecks: ["Mapping table trong docs/plans/S4-TASK-RECON-1.md liệt kê HẾT 21 @RequirePermission decorator-site (thu gọn 13 cặp (action,resource) DUY NHẤT) của apps/api/src/tasks (read/create/update/delete:task ở tasks+attachments; comment:comment@tasks.controller.ts:206; project_state×4; label×4) + đích canonical DB-06 §12.1; xác nhận CHỈ (comment,comment) là legacy cần đổi → (comment,task); read/create/update/delete:task đã canonical (không đổi); project_state/label ngoài phạm vi (resource khác, không phải task/project).","Grep apps/api/src cho ('manage'|'assign'|'submit')×('project'|'task') trong @RequirePermission == 0 → 4 cặp này KHÔNG route nào enforce, ghi rõ 'residual grant, không đổi code' trong mapping table.","Catalog: permissions có đúng 1 row MỚI (comment,'task') is_sensitive=false; diff migration KHÔNG chứa UPDATE nào lên cột is_sensitive (bằng chứng: 'KHÔNG đụng is_sensitive' — thuộc S4-TASK-SEED-1).","tasks.controller.ts POST /tasks/:taskId/comments enforce ('comment','task'); grep 'comment', *'comment' (cặp legacy) trong apps/api/src == 0.","Migration dùng per-pair DELETE (resolve role_id+permission_id, KHÔNG blanket theo role_id — mirror DO-block 0444/0445), chạy lại 2 lần = no-op (idempotent bộ-ba role_id/permission_id/scope); role_permissions vẫn append-only qua DELETE+INSERT (BẤT BIẾN #2); RLS/FORCE/policy/grant của 0005 KHÔNG đụng (BẤT BIẾN #1).","int-spec (hasDb && LANE_DB) GREEN sau 0480: tập grant task+project của MỖI role canonical == kỳ vọng — company-admin={create,read,update,delete,assign,comment}:task ∪ {create,read,update,delete}:project; employee={read,comment}:task; manager=∅; hr=∅ (không dư/không thiếu); comment:comment đã gỡ khỏi employee+company-admin.","Engine can(): (comment,task)=true cho employee+company-admin → route comment 2xx; role không grant → 403; employee DENY {create,update,delete,close,archive}:project; hr DENY {close,delete,archive,manage-member}:project + delete:task (deny-by-default vì pair chưa granted/chưa có trong catalog).","Số migration nối tiếp head thực tế tại thời điểm tạo (verify bằng tail -1, KHÔNG hard-code), _journal.json đơn điệu; FULL gate security-reviewer+database-reviewer+silent-failure-hunter PASS; typecheck/lint/unit+int xanh (DoD §8)."]
testTasks: ["RED unit (cập nhật) apps/api/src/tasks/tasks.permissions.spec.ts: GUARDED_MUTATIONS.addComment resourceType 'comment'→'task'; giữ 3 assertion (declare @RequirePermission(comment,task) · DENY can()=deny→403 gọi đúng action/resource · ALLOW pass); OPEN_READS không đổi.","RED int-spec MỚI apps/api/test/integration/task-recon-grants.int-spec.ts (mirror hr-seed-permissions.int-spec.ts, gate hasDb && !!process.env.LANE_DB, directPool): (a) catalog (comment,task) is_sensitive=false; (b) EXACT grant-set task+project cho 4 role canonical == kỳ vọng, đếm không dư/thiếu; (c) FORBIDDEN residual {submit:task,manage:task,manage:project,assign:project,comment:comment} KHÔNG còn grant cho 4 role canonical; (d) idempotent bộ-ba.","Deny-path int-spec (mirror task-core-tenant-deny.int-spec.ts): seed user role employee + user role manager/hr; POST /tasks/:taskId/comments 2xx cho employee (comment:task) · 403 cho role không grant; engine can()=false cho employee {create,update,delete,close,archive}:project và hr {close,delete,archive,manage-member}:project + delete:task.","RED-first proof: chạy int-spec trên DB migrate tới TRƯỚC 0480 (head-1) → ĐỎ (thiếu comment:task + employee/company-admin còn comment:comment); sau apply 0480 → XANH. DB cô lập LANE_DB (memory integration-test-lane-db-gate: .env → hasDb=true nên phải gate thêm LANE_DB, tránh đỏ-giả trên DB dev chung)."]
steps: ["1. reconMig TRƯỚC (nối tiếp, không song song): lấy số migration kế tiếp bằng `ls apps/api/migrations/*.sql | tail -1` (head hiện 0479 → 0480, nhưng WO khác trong wave có thể đã land — KHÔNG hard-code). Viết migration theo NỘI-THỨ-TỰ (1) seed cặp (comment,task) → (2) grant cho employee+company-admin → (4) park residual per-pair DELETE. Bước (3) đổi decorator nằm ở lane controllerSwap, ship CÙNG release.","2. controllerSwap SAU reconMig: đổi tasks.controller.ts:206 sang ('comment','task') + cập nhật tasks.permissions.spec.ts. Ship trong CÙNG PR/release với migration để không mở cửa sổ 403 (single-node stop→migrate→start là atomic; nếu rolling-deploy phải tách park sang release sau — xem reconcileNotes).","3. reconVerify: chứng minh RED-trước (chạy int-spec trên DB migrate tới head-1/trước 0480 → ĐỎ vì thiếu comment:task + còn comment:comment) rồi GREEN sau 0480. Chạy DB cô lập: `bash scripts/lane-db-setup.sh <lane>` → `export LANE_DB=mediaos_<lane>` → `pnpm --filter @mediaos/api test`.","4. FULL gate (red-zone crown): security-reviewer + database-reviewer + silent-failure-hunter (+ santa-method cho logic park/grant). typecheck + lint + toàn bộ tasks.permissions.spec.ts xanh.","5. Cập nhật harness/backlog.mjs done_when checkboxes + lưu docs/plans/S4-TASK-RECON-1.md (mapping table + quyết định preserve-behavior). Người duyệt red-zone chốt trước merge."]
```

## GAP-ANALYSIS + MAPPING TABLE (đã xác minh bằng Read/Grep 2026-07-09 · re-đếm 2026-07-09 vòng-sửa)

### Quy ước đếm (đã đối soát lại — sửa con số "11" sai ở vòng trước)

Quét HẾT `@RequirePermission` DECORATOR (KHÔNG tính dòng JSDoc/comment nhắc tới decorator, KHÔNG tính file
`*.spec.ts`) trong `apps/api/src/tasks` = **21 decorator-site** trên **4 controller**, thu gọn về
**13 cặp (action, resource_type) DUY NHẤT**. (Con số "11" ở bản trước SAI dưới mọi quy ước — đây là lỗi
tài liệu về TỔNG + định dạng, KHÔNG phải lỗi chức năng; nội dung phân loại legacy/canonical/out-of-scope
KHÔNG đổi.) Bằng chứng đếm: `grep -n '@RequirePermission' apps/api/src/tasks/**` → 21 decorator (loại 3 dòng
JSDoc `labels.controller.ts:28`, `tasks.controller.ts:36`, `project-states.controller.ts:28`).

### Bảng ánh xạ tường minh — 13 cặp (action, resource) DUY NHẤT (done_when#2)

Quy ước đếm: **21 `@RequirePermission` decorator-site = 13 cặp (action, resource) DUY NHẤT** — cột `controller/route` liệt kê HẾT site của mỗi cặp; cột đích đối chiếu **DB-06 §12.1** (permission seed đề xuất). Verdict ∈ {ĐỔI · GIỮ-đã-canonical · NGOÀI-PHẠM-VI}.

| # | controller/route (site) | action | resource (legacy) | đích canonical DB-06 §12.1 | verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | `tasks.controller.ts:59,74,95` + `task-attachments.controller.ts:72,80` (GET tasks/attachments) | read | task | `read:task` = `TASK.TASK.VIEW` | GIỮ-đã-canonical |
| 2 | `tasks.controller.ts:111` (POST /tasks) | create | task | `create:task` = `TASK.TASK.CREATE` | GIỮ-đã-canonical |
| 3 | `tasks.controller.ts:119,138,163,180` (PATCH task/status/priority/deadline) | update | task | `update:task` = `TASK.TASK.UPDATE` (UPDATE_STATUS/PRIORITY/DEADLINE gộp về `update`) | GIỮ-đã-canonical |
| 4 | `tasks.controller.ts:155` + `task-attachments.controller.ts:97` (DELETE task/attachment) | delete | task | `delete:task` = `TASK.TASK.DELETE` | GIỮ-đã-canonical |
| 5 | `tasks.controller.ts:206` (POST /tasks/:taskId/comments) | comment | comment → task | `comment:task` = `TASK.TASK.COMMENT` | **ĐỔI** (decorator đã swap `comment:comment`→`comment:task` ở lane controllerSwap + seed/grant/park mig 0480) |
| 6 | `project-states.controller.ts:40` | read | project_state | seed mig 0420 (resource ≠ task/project) | NGOÀI-PHẠM-VI |
| 7 | `project-states.controller.ts:47` | create | project_state | seed mig 0420 | NGOÀI-PHẠM-VI |
| 8 | `project-states.controller.ts:58` | update | project_state | seed mig 0420 | NGOÀI-PHẠM-VI |
| 9 | `project-states.controller.ts:70` | delete | project_state | seed mig 0420 | NGOÀI-PHẠM-VI |
| 10 | `labels.controller.ts:40` | read | label | seed mig 0420 (resource ≠ task/project) | NGOÀI-PHẠM-VI |
| 11 | `labels.controller.ts:47` | create | label | seed mig 0420 | NGOÀI-PHẠM-VI |
| 12 | `labels.controller.ts:58` | update | label | seed mig 0420 | NGOÀI-PHẠM-VI |
| 13 | `labels.controller.ts:70` | delete | label | seed mig 0420 | NGOÀI-PHẠM-VI |

**Kết luận (KHÔNG đổi — Đội 3 đã xác nhận đúng+đầy đủ):** CHỈ cặp #5 `(comment, comment)@tasks.controller.ts:206` là LEGACY cần canonical-hoá → `(comment, task)`; 4 cặp `*:task` CRUD (#1–#4) đã canonical (GIỮ); `project_state`×4 + `label`×4 (#6–#13, seed mig 0420) là resource KHÁC task/project → NGOÀI-PHẠM-VI.

### Bảng phụ — 4 cặp RESIDUAL grant-only (grep enforcement == 0 → park grant, KHÔNG đổi code)

Grep `@RequirePermission` cho `('manage'|'assign'|'submit')×('project'|'task')` trong `apps/api/src` == **0 match** → 4 cặp dưới KHÔNG route nào enforce ⇒ chỉ **park grant** (mig 0480 per-pair DELETE), KHÔNG đổi code. `(assign,task)` = canonical `TASK.TASK.ASSIGN` (enforce chỗ khác) → KHÔNG park; `(assign,project)` KHÔNG có trong §12.1 → residual, park.

| # | cặp (action:resource) | grep `@RequirePermission` (enforcement) | nguồn grant tồn dư | hành động RECON |
| --- | --- | --- | --- | --- |
| R1 | `manage:task` | 0 match | seed 0005 blanket (company-admin) | residual grant → park (mig 0480), KHÔNG đổi code |
| R2 | `submit:task` | 0 match | seed 0005 (employee + company-admin) | residual grant → park (mig 0480), KHÔNG đổi code |
| R3 | `manage:project` | 0 match | seed 0005 blanket (company-admin) | residual grant → park (mig 0480), KHÔNG đổi code |
| R4 | `assign:project` | 0 match | seed 0005 blanket (company-admin) | residual grant → park (mig 0480), KHÔNG đổi code |

### Bảng bằng chứng 21 decorator-site (đếm chi tiết → 13 cặp)

| # | File:line | action:resource | Phân loại | Hành động RECON |
| --- | --- | --- | --- | --- |
| 1 | `tasks.controller.ts:59` | read:task | canonical (TASK.TASK.VIEW) | KHÔNG đổi |
| 2 | `tasks.controller.ts:74` | read:task | canonical | KHÔNG đổi |
| 3 | `tasks.controller.ts:95` | read:task | canonical | KHÔNG đổi |
| 4 | `tasks.controller.ts:111` | create:task | canonical (TASK.TASK.CREATE) | KHÔNG đổi |
| 5 | `tasks.controller.ts:119` | update:task | canonical (TASK.TASK.UPDATE) | KHÔNG đổi |
| 6 | `tasks.controller.ts:138` | update:task | canonical | KHÔNG đổi |
| 7 | `tasks.controller.ts:155` | delete:task | canonical (TASK.TASK.DELETE) | KHÔNG đổi |
| 8 | `tasks.controller.ts:163` | update:task | canonical | KHÔNG đổi |
| 9 | `tasks.controller.ts:180` | update:task | canonical | KHÔNG đổi |
| 10 | `tasks.controller.ts:206` | comment:task | **LEGACY→canonical** (was `comment:comment`) | **ĐỔI decorator (lane controllerSwap) + seed/grant/park (mig 0480)** |
| 11 | `task-attachments.controller.ts:72` | read:task | canonical | KHÔNG đổi |
| 12 | `task-attachments.controller.ts:80` | read:task | canonical | KHÔNG đổi |
| 13 | `task-attachments.controller.ts:97` | delete:task | canonical | KHÔNG đổi |
| 14 | `project-states.controller.ts:40` | read:project_state | OUT-OF-SCOPE (resource ≠ task/project) | KHÔNG đổi |
| 15 | `project-states.controller.ts:47` | create:project_state | OUT-OF-SCOPE | KHÔNG đổi |
| 16 | `project-states.controller.ts:58` | update:project_state | OUT-OF-SCOPE | KHÔNG đổi |
| 17 | `project-states.controller.ts:70` | delete:project_state | OUT-OF-SCOPE | KHÔNG đổi |
| 18 | `labels.controller.ts:40` | read:label | OUT-OF-SCOPE (resource ≠ task/project) | KHÔNG đổi |
| 19 | `labels.controller.ts:47` | create:label | OUT-OF-SCOPE | KHÔNG đổi |
| 20 | `labels.controller.ts:58` | update:label | OUT-OF-SCOPE | KHÔNG đổi |
| 21 | `labels.controller.ts:70` | delete:label | OUT-OF-SCOPE | KHÔNG đổi |

**13 cặp DUY NHẤT** = `task`×5 (`read,create,update,delete,comment`) ∪ `project_state`×4 (`read,create,update,delete`)
∪ `label`×4 (`read,create,update,delete`). **CHỈ 1 cặp** — `(comment,task)@tasks.controller.ts:206` — là LEGACY cần
canonical-hoá; 4 cặp `*:task` CRUD đã canonical; `project_state`/`label` (seed mig 0420) là resource KHÁC → NGOÀI phạm vi.
Ghi chú: `task-attachments.controller` route upload resolve quyền qua `PermissionService.can` (KHÔNG `@RequirePermission`) nên
KHÔNG nằm trong 21 decorator-site.

### Cặp RESIDUAL — xem "Bảng phụ — 4 cặp RESIDUAL grant-only" ở trên

4 cặp `(manage,task)/(submit,task)/(manage,project)/(assign,project)` = **RESIDUAL GRANT** (seed 0005 blanket) — KHÔNG có đích `@RequirePermission` (grep `apps/api/src` == 0) → **park grant, KHÔNG đổi code**. `(assign,task)` LÀ canonical (`TASK.TASK.ASSIGN`, enforce ở chỗ khác/giữ grant) → KHÔNG park. `(assign,project)` KHÔNG có trong §12.1 → residual, park.

### Catalog + role canonical

- Catalog: `(comment,task)` CHƯA tồn tại (grep migrations 0 match) → phải seed (mig 0480 bước 1, `is_sensitive=false`).
  `(comment,comment)` ở 0005 L266 (legacy). **KHÔNG đụng `is_sensitive` cặp khác** (thuộc S4-TASK-SEED-1).
- 4 role canonical (permission-matrix §1.1 + mig 0444): company-admin (0005 blanket `WHERE is_sensitive=false` → có
  TẤT CẢ task/project non-sensitive gồm residual), employee (0005 = read:task+submit:task+comment:comment+read:notification),
  manager & hr (mới ở 0444, CHỈ grant AUTH/HR — KHÔNG task/project). → residual thực tế chỉ ở company-admin (blanket) +
  employee (submit:task, comment:comment); manager/hr trống (deny trivially).
- Kỳ vọng reconciled (permission-matrix §6 + DB-06 §12.1): company-admin={create,read,update,delete,assign,comment}:task
  ∪ {create,read,update,delete}:project; employee={read,comment}:task; manager=∅; hr=∅.

## THỨ TỰ AN TOÀN (done_when#3, KHÔNG đảo)

Trong 1 migration 0480, nội-thứ-tự (1) seed (comment,task) → (2) grant employee+company-admin → (4) park residual per-pair DELETE; bước (3) đổi decorator ở lane controllerSwap ship CÙNG release. Vì grant(comment,task) tồn tại TRƯỚC khi app mới boot (migrator chạy trước app) nên code mới enforce comment:task tìm thấy grant → KHÔNG 403 window; gỡ comment:comment ở CUỐI migration an toàn vì sau swap không code nào enforce comment:comment. GIẢ ĐỊNH DEPLOY: single-node NSSM stop→migrate→start (atomic). Nếu rolling-deploy (2 instance chạy song song lúc migrate) → phải TÁCH park(comment:comment) sang release SAU (release N: seed+grant+swap; release N+1: park) để instance cũ (còn enforce comment:comment) không bị 403. Ghi rõ giả định này cho reviewer.

## QUYẾT ĐỊNH CẦN CHỐT (preserve-behavior, mặc định đề xuất)

Step-2 CHỈ grant (comment,task) cho role canonical ĐANG GIỮ comment:comment (employee+company-admin) để KHÔNG đổi hành vi — manager/hr theo §6 "comment nếu xem được task" cũng nên có comment:task NHƯNG đó là mở-rộng-năng-lực-mới = thuộc S4-TASK-SEED-1 (full §6 matrix), KHÔNG thuộc RECON. Giữ RECON đúng nghĩa "chỉ canonical-hoá tên cặp + dọn residual, KHÔNG thêm năng lực". Owner/database-reviewer chốt: nếu muốn grant manager/hr comment:task ngay → chuyển sang SEED-1 hoặc mở rộng WO này (ghi nhận).

## BẤT BIẾN & VERIFY

THUẦN ADDITIVE data (INSERT permission + INSERT/DELETE role_permissions per-pair) — KHÔNG DDL, KHÔNG đụng RLS/FORCE/policy/grant table của 0005 (BẤT BIẾN #1 N=1 giữ nguyên). role_permissions app role KHÔNG có UPDATE (0005) → đổi = DELETE+INSERT, append-only (BẤT BIẾN #2). data_scope (cột 0441, NOT NULL default Company) phải set khi INSERT grant mới. Per-pair DELETE resolve role_id+permission_id trong DO-block (mirror 0444 L149-183 / 0445) — TUYỆT ĐỐI KHÔNG blanket DELETE theo role_id (sẽ mất grant media/parked của company-admin). Idempotent: DELETE-wrong không khớp + INSERT trúng ON CONFLICT.

## GATE

FULL (red/crown — permission+seed+migration) = security-reviewer + database-reviewer + silent-failure-hunter (+ santa-method cho logic grant/park). Int-spec gate `hasDb && !!LANE_DB` (memory: .env → hasDb=true, chạy DB dev chung = đỏ-giả; bắt buộc DB cô lập mediaos_<lane>). RED-trước GREEN-sau.

## OUT-OF-SCOPE (ghi để KHÔNG scope-creep / KHÔNG bỏ sót)

- KHÔNG seed catalog canonical đầy đủ (close/archive/manage-member/update-status/file-upload/watch/view-kanban/export/view-report...) — thuộc S4-TASK-SEED-1. KHÔNG đụng is_sensitive.
- KHÔNG reconcile role MEDIA (project-manager/channel-manager/script-writer/editor/qa-reviewer/uploader) — chỉ 4 role canonical; media roles parked/deprecated, dọn riêng.
- project_state/label pairs (mig 0420) NGOÀI phạm vi (resource khác task/project).
- `apps/api/src/foundation/seed/**` = trong WO paths phòng thủ nhưng ĐÃ XÁC MINH runtime seeder KHÔNG seed RBAC role_permissions (chỉ master-data) → KHÔNG cần sửa; nếu builder tìm thấy nơi runtime re-grant task pair thì mới mirror.
- ⚠️ FE FOLLOW-UP (ngoài WO paths, PHẢI có WO em): nếu `MODULE_APP_METADATA.TASK` (apps/api) hoặc `packages/web-core` `PERMISSION_CODE_TO_PAIR` map nút "bình luận" sang cặp (comment,comment)/caps 'comment:comment', sau khi BE đổi sang comment:task + employee mất grant comment:comment → nút comment FE sẽ ẩn (`useCan` key 'comment:comment' = false). Cần WO sibling di chuyển FE gate sang comment:task. Flag để owner không bỏ sót (memory s3-fe-wave-pair-drift-blocker: pair-drift FE↔seed từng làm app ẩn).
</content>
</invoke>
