# Micro-plan — `S7-CHAT-BE-5` (🔴 red · FULL gate) — rev 1 (02/08/2026)

> **WO:** phòng chat tự động theo phòng ban + dự án — tạo/đóng phòng, đồng bộ thành viên tại sự kiện HR/TASK, job đối soát idempotent sửa lệch.
> **Nguồn sự thật:** [SPEC-15 §3.1 · §13.3 · §12](<../SPEC/SPEC-15 CHAT.md>) · [DB-12 §6.1 · §6.2 · §9 bước A](<../DB/DB-12 CHAT Database Design.md>) · [`harness/backlog.mjs:9662-9694`]
> **Nền:** `S7-CHAT-BE-1` — `ChatAccessService.assertMember` + `ChatRoomsRepository` (export ở `chat.module.ts:40`). **CHƯA qua FULL gate, đang trong working tree chưa commit.**
> **Nhánh:** commit lên `wave/s7-chat` (KHÔNG `master` — WAVE §4).
>
> ⚠️ **Trạng thái working tree lúc lập plan (02/08, ~22:50) — biến động, phải đo lại trước khi code:** ngoài BE-1, một tiến trình KHÁC đang code song song `S7-CHAT-BE-2` ngay trong `apps/api/src/chat/` — `chat-message-rules.ts` · `chat-messages.repository.ts` · `chat-messages.service.ts` xuất hiện (`?? ` trong git status) với mtime 22:46-22:50, CHƯA wire vào `chat.module.ts` (module vẫn chỉ có 5 provider của BE-1). Plan này **không phụ thuộc BE-2** (chỉ `depends_on: ["S7-CHAT-BE-1"]` theo backlog) và không chạm file nào của BE-2, nhưng **trước khi code thật, đọc lại `apps/api/src/chat/**` một lần nữa** — số dòng/trạng thái export trong §0 dưới đây có thể đã trôi do BE-2 chạy song song.

---

## 0. Đo thật trước khi thiết kế

| # | Thứ | Đo được 02/08/2026 | Nguồn |
| --- | --- | --- | --- |
| 1 | Bề mặt BE-1 dùng được (ổn định, đã export) | `ChatModule.exports = [ChatAccessService, ChatRoomsRepository]`; `ChatRoomCodeService`/`ChatRoomsService`/`ChatMembersService` **KHÔNG export** (chỉ dùng nội bộ module) | `chat.module.ts:30-42` |
| 2 | **`insertRoom` KHÔNG tạo được phòng dẫn xuất** | `ChatRoomsRepository.insertRoom` hard-code `syncSource: "manual"` trong `.values({...values, syncSource: "manual"})`, và kiểu `values` **không có** `orgUnitId`/`refId` — phòng `department`/`project` không tạo được qua hàm này ở dạng hiện tại | `chat-rooms.repository.ts:183-200` |
| 3 | Unique idempotency đã có sẵn từ DB-1 | `chat_rooms_org_unit_uq` (company_id, org_unit_id) WHERE org_unit_id NOT NULL · `chat_rooms_project_uq` (company_id, ref_id) WHERE ref_id NOT NULL — **không lọc `deleted_at`** (không vấn đề vì WO này không bao giờ soft-delete phòng dẫn xuất, chỉ archive) | `communication.ts:194-199` |
| 4 | Mẫu idempotent-create đã có, copy được | `ChatRoomsService.openDirect` — 3 lớp: tra trước khi cấp mã → tra lại trong tx → bắt `23505` **đúng tên constraint** rồi SELECT lại | `chat-rooms.service.ts:159-225` |
| 5 | `room_code` — cấp qua `ChatRoomCodeService.allocate` | **Tự lazy-create counter**, gọi **NGOÀI** tx nghiệp vụ (retry đúng 1 lần) — dùng lại nguyên vẹn cho phòng dẫn xuất | `chat-room-code.service.ts:50-102` |
| 6 | `archiveRoom`/`insertMember` — chữ ký TS hẹp hơn DB | `actorUserId`/`addedBy` **không nullable** trong TS dù cột DB `archived_by`/`added_by` đều **nullable** — cần nới kiểu để job (không có actor người) gọi được | `chat-rooms.repository.ts:225-238,302-313` · `communication.ts:185,305` |
| 7 | Phòng dẫn xuất không có "admin" | `assertManualMembership`/`assertManualEdit`/`assertLeavable` chặn MỌI thao tác quản trị thủ công trên phòng `department`/`project` (CHAT-ERR-012/013) ⇒ `chat_room_members.role` không có tác dụng phân quyền cho các hàng này, an toàn để luôn ghi `"member"` | `chat-room-rules.ts:22-54` |
| 8 | Hợp đồng `JobHandler` | `JobRunContext` **chỉ có `companyId`, KHÔNG có `tx`** — handler PHẢI tự mở `withTenant` bên trong; JobRunner materialize danh sách company **rồi đóng tx enumerate TRƯỚC** khi gọi `handler.run` (không nested-context) | `scheduler/job-handler.ts:16-46` · `scheduler/job-runner.ts:69-96` |
| 9 | KHÔNG có lịch "chạy ban đêm" trong hạ tầng | Mọi `@SystemJobHandler` chạy CHUNG một nhịp `setInterval`, mặc định **60 giây** (`SYSTEM_JOBS_POLL_MS`, clamp 1s–1h), không có cấu hình cron/giờ riêng cho từng job | `worker-scheduler.config.ts:23-41` · `worker-scheduler.service.ts:76-86` |
| 10 | Bẫy `@Optional()` **CÓ ĐIỀU KIỆN**, không phải luôn luôn | So sánh 2 handler thật: `RetentionCleanupJobHandler` chỉ nhận `RetentionCleanupJob` (Nest provider bình thường) → **KHÔNG cần `@Optional()`**. `SystemJobRunsRetentionJobHandler` nhận `Database` thô (không phải Nest provider) → **BẮT BUỘC `@Optional()`** nếu không Nest ném "can't resolve dependencies" → sập AppModule. Job của WO này chỉ đọc bảng nghiệp vụ thường qua `DatabaseService.withTenant` — giống mẫu Retention (an toàn), KHÔNG giống mẫu SystemJobRunsRetention | `retention-cleanup.job-handler.ts:39-45` (mẫu ĐÚNG) vs `system-job-runs-retention.job-handler.ts:86-92` (mẫu SAI cho WO này) |
| 11 | Mẫu job "đối soát" gần nhất, ĐÚNG hình dạng cần copy | `GoalReconciliationJobHandler.run` mở **ĐÚNG MỘT** `withTenant` bọc toàn bộ vòng đối soát 1 tenant, gọi `engine.reconcileCompanyTx(tx, companyId, ...)` — **KHÔNG catch** (lỗi propagate cho JobRunner finalize `Failed`); hàm `...Tx` được TÁI DÙNG (không chỉ job gọi) | `goal-reconciliation.job-handler.ts:50-54,44-45` |
| 12 | `SchedulerModule` thiếu `ChatModule` | Hiện chỉ import `[DiscoveryModule, RetentionModule, FilesModule]` — cần **+ChatModule** (done_when yêu cầu tường minh); không cycle: `ChatModule` chỉ phụ thuộc `PermissionModule`+`SequenceModule`, cả hai không import ngược `SchedulerModule` | `scheduler.module.ts:24-25` |
| 13 | Tiền lệ cross-module TƯƠNG TỰ đã có trong repo | `GoalsModule.imports` gồm `TasksModule` (module tiêu-thụ import module cần tái dùng) · **và tiền lệ LỊCH SỬ ngược chiều**: `org.module.ts` còn giữ comment "(de-media-fy CLEAN-DECOUPLE-1: gỡ ChatModule — auto group-chat phòng ban G10-2 thuộc cụm chat out-of-scope.)" — ORG **từng** import ChatModule cho đúng mục đích "auto-room theo phòng ban" trước khi bị gỡ vì lý do phạm vi, không phải kỹ thuật | `goals.module.ts:51` · `org.module.ts:16` |
| 14 | Danh sách WRITER phải hook | Đo bằng grep+đọc code, KHÔNG suy diễn — bảng đầy đủ ở §1.1: 12 điểm ghi, 3 module (`org`, `employees`, `tasks`), 4 service khác nhau | xem §1.1 |
| 15 | `OrgService.createOrgUnit` KHÔNG nhận `tx` từ ngoài | `OrgRepository.createOrgUnit` tự mở `withTenant` riêng, không có tham số `tx` | `org.repository.ts:100-113` |
| 16 | `HrDepartmentService.createDepartment` CÓ threading `tx` | Route KHÁC, cùng bảng `org_units`, nhưng nhận/truyền `tx` tường minh | `hr-department.service.ts:64-93` |
| 17 | Hệ quả trực tiếp của #15+#16 | Hai writer "tạo org_unit" có HAI HÌNH DẠNG transaction khác nhau — không thể chốt một điểm hook DÙNG CHUNG "trong cùng tx" cho cả hai; đồng bộ CHAT bắt buộc chạy **ngoài** tx của cả hai, thống nhất một cách | suy từ #15+#16 |
| 18 | Không có outbox event sẵn để tái dùng | Grep `outbox.enqueue`: `hr-write.service.ts` chỉ có `auth.user_created` (dòng 222-223); `org.service.ts`/`hr-department.service.ts` = 0 hit; `projects.service.ts` chỉ có `project.member_added` (dòng 540-541) | grep trực tiếp |
| 19 | `AuditEntry.actorUserId` optional | `actorType` chấp nhận `'System'`/`'Job'` — dùng được cho audit của job (không có actor người) | `audit.service.ts:15-19,59` |
| 20 | WO này KHÔNG thêm route HTTP nào | `done_when` không có endpoint nào; `SystemJobsController` chỉ có 2 route generic `:jobName` (không sinh route mới theo từng jobCode) | `system-jobs.controller.ts:31-55` |
| 21 | `AUDIT_OBJECT_TYPES` đã có `chat_room` | Không cần migration cho audit của WO này | `apps/api/src/db/schema/audit.ts:137` |
| 22 | org_unit có thể `inactive` mà không xoá | `CHECK org_units_status_check` cho phép `active`/`inactive`; `deletedAt` soft-delete riêng — **không route nào** trong `done_when` yêu cầu xử lý case deactivate | `db/schema/org.ts:26,29,44` |
| 23 | `projects.projectStatus` — chỉ 2 giá trị THỰC SỰ được ghi hôm nay | `"Completed"` (qua `closeProjectTx`) và `deletedAt` (qua `softDeleteProjectTx`). `"Cancelled"`/`"Archived"` có trong `TERMINAL_STATUSES` nhưng **0 writer nào gán** giá trị đó (grep toàn `apps/api/src/tasks` = 0 hit ghi) | `projects.service.ts:54,407-476` · `projects.repository.ts:521-561` |

---

## 1. Lựa chọn thiết kế — chốt ở đây

### 1.1 Danh sách WRITER phải hook (bài học DECISIONS-05 — chốt ở method dùng chung, liệt kê hết)

| # | Writer | File:dòng | Route | Kích hoạt |
| --- | --- | --- | --- | --- |
| W1 | `OrgService.createOrgUnit` | `org.service.ts:48-69` → `org.repository.ts:100-113` | `POST /org/units` **và** alias `POST /org/departments` (`org.controller.ts:91-96,124-129` — CÙNG method) | tạo phòng `department` |
| W2 | `HrDepartmentService.createDepartment` | `hr-department.service.ts:62-120` | `POST /hr/departments` (`hr-department.controller.ts:54`) | tạo phòng `department` |
| W3 | `ProjectsService.createProject` | `projects.service.ts:211-289` | `POST /projects` (`projects.controller.ts:51`) | tạo phòng `project` |
| W4 | `ProjectsService.closeProject` | `projects.service.ts:407-448` | close project | archive phòng `project` |
| W5 | `ProjectsService.deleteProject` | `projects.service.ts:450-476` | delete project | archive phòng `project` |
| W6 | `ProjectsService.addMember` | `projects.service.ts:480-555` | add project member | join phòng `project` |
| W7 | `ProjectsService.removeMember` | `projects.service.ts:610-645` | remove project member | leave phòng `project` |
| W8 | `HrWriteService.createEmployee` | `hr-write.service.ts:150-~275` | tạo nhân viên (kèm tài khoản mới **hoặc** link tài khoản có sẵn qua `dto.userId`) | join phòng `department` nếu có `orgUnitId` + `userId` |
| W9 | `HrWriteService.updateEmployee` | `hr-write.service.ts:350-433` | sửa hồ sơ — khi `structural.changedFields` chứa `"orgUnitId"` | rời phòng cũ + vào phòng mới |
| W10 | `HrWriteService.linkUser` | `hr-write.service.ts:530-556` | gắn tài khoản cho hồ sơ đã có | join phòng `department` theo `orgUnitId` hiện có |
| W11 | `HrWriteService.unlinkUser` | `hr-write.service.ts:565-~598` | gỡ tài khoản khỏi hồ sơ | rời phòng `department` |
| W12 | `HrWriteService.changeStatus` | `hr-write.service.ts:437-488` | đổi trạng thái nhân viên | status → `inactive`/`resigned`/`terminated` ⇒ rời **MỌI** phòng dẫn xuất |

**KHÔNG hook** (đã kiểm, không nằm trong `done_when`): `OrgService.updateOrgUnit`/`deleteOrgUnit` (org.service.ts:71-95), `HrDepartmentService.updateDepartment`/`deleteDepartment` (hr-department.service.ts:122+,205), `ProjectsService.updateProject` (đổi tên/departmentId của project — không đổi phòng), `ProjectsService.updateMemberRole` (chỉ đổi `projectRole` trong TASK, không map sang chat vì phòng dẫn xuất không có admin — xem #7 §0). Ghi rõ ở §3 + §5 (nợ).

### 1.2 KHÔNG chạy trong cùng transaction nghiệp vụ nguồn — lệch có chủ đích với câu chữ SPEC

SPEC-15 §13.3 viết "đồng bộ chạy trong CÙNG transaction khi rẻ, nếu không thì qua outbox". Chốt ở đây: **luôn chạy SAU khi tx nguồn đã commit, trong tx RIÊNG của CHAT, best-effort, không outbox**. Lý do:

1. **Không nhất quán được dù muốn** — W1 (`OrgService.createOrgUnit`) không nhận `tx` từ ngoài (§0 #15), còn W2 (`HrDepartmentService.createDepartment`) có (§0 #16). Không có một điểm "trong tx" áp dụng đều cho cả hai writer của CÙNG một hành động nghiệp vụ.
2. **Tạo phòng cần `room_code`** — `ChatRoomCodeService.allocate()` gọi `SequenceService.nextCode()` tự mở `withTenant` riêng (đã ghi nhận ở BE-1 §1.3), **không lồng được** vào bất kỳ tx nào khác. Mọi đường tạo phòng (kể cả manual ở BE-1) đã chấp nhận chạy code-allocation ngoài tx.
3. **Blast-radius**: nếu lồng sync CHAT vào tx của `HrWriteService.changeStatus`/`ProjectsService.addMember`, một lỗi bên CHAT (bug, race, thiếu counter) sẽ **rollback luôn thao tác HR/TASK** — biến một module Phase-4 phụ thành điểm chặn của nghiệp vụ lõi Phase-1/2. Không chấp nhận được.
4. **Outbox không rẻ hơn** — không writer nào trong 12 writer ở §1.1 đã có sẵn outbox event dùng lại được (§0 #17); phải thêm `enqueue` mới ở ~10 chỗ, tốn ngang bằng thêm lời gọi trực tiếp nhưng lại kéo theo cần viết consumer/bridge riêng — không xứng với quy mô 45 người dùng của hệ thống này (YAGNI).

**Hệ quả chấp nhận**: cửa sổ rất hẹp giữa "tx nguồn commit" và "lời gọi sync chạy xong" nơi phòng/thành viên chưa khớp thật; job đối soát (§1.6, chạy ~60s/lần — không phải hàng đêm, xem §0 #9) là lưới an toàn cho đúng cửa sổ này VÀ cho mọi lỗi khiến lời gọi sync thất bại. Mọi lời gọi sync ở writer bọc `try/catch`, lỗi chỉ `logger.warn`, **không bao giờ** ném lại cho HTTP caller.

### 1.3 Kiến trúc: 1 service `*Tx` dùng chung cho cả real-time lẫn job (mẫu Goal, §0 #11)

`ChatDerivedRoomsSyncService` (mới, `apps/api/src/chat/chat-derived-rooms-sync.service.ts`, **export** từ `ChatModule`) — mỗi nghiệp vụ có 2 hàm: bản `...Tx(tx, ...)` nhận tx có sẵn (job dùng, mở đúng 1 `withTenant` cho cả lượt đối soát — mẫu §0 #11) và bản public `...( companyId, ...)` tự mở `withTenant` riêng rồi gọi bản `Tx` (real-time hook dùng, luôn ở NGOÀI tx nguồn — §1.2).

| Hàm `...Tx` | Việc làm | Idempotent bằng |
| --- | --- | --- |
| `ensureOrgUnitRoomTx` | Tạo phòng `department` nếu chưa có (role="member" không áp — phòng mới 0 thành viên) | `chat_rooms_org_unit_uq` + mẫu 3-lớp §0 #4 |
| `ensureProjectRoomTx` | Tạo phòng `project` nếu chưa có | `chat_rooms_project_uq` + mẫu 3-lớp |
| `archiveProjectRoomTx` | `archiveRoom` cho phòng ứng với `projectId` nếu đang tồn tại và chưa archived; phòng chưa tồn tại ⇒ bỏ qua (job sẽ tạo+archive ở lượt sau) | đọc `isArchived` trước khi ghi |
| `syncEmployeeDepartmentMembershipTx` | Đọc **CURRENT** hàng `employee_profiles` active theo `userId` (không theo employeeId — vì W11 unlink cần tính trên `userId` đang bị gỡ). Có hàng active + `orgUnitId` + phòng tồn tại ⇒ đảm bảo là member ĐANG hoạt động của ĐÚNG phòng đó, rời mọi phòng `department` khác đang là member. Không có hàng hợp lệ ⇒ rời **mọi** phòng `department` | `findMemberRow`/`reactivateMember`/`setMemberLeft` đã có (BE-1) |
| `syncProjectMembershipTx(projectId, userId, joining)` | `joining=true` ⇒ join (tái dùng hàng cũ nếu đã rời); `false` ⇒ leave | idem |
| `leaveAllDerivedRoomsTx` | SET `left_at` cho **mọi** hàng `chat_room_members` đang active của `userId` mà phòng có `sync_source <> 'manual'` — **không cần đọc `project_members`**, tự đóng kín trên chính bảng CHAT | `WHERE left_at IS NULL` |

Role của mọi hàng insert do service này tạo **luôn `"member"`** (§0 #7). `addedBy`/`archivedBy` = `actorUserId` truyền vào, **cho phép `null`** khi job gọi (không có actor người) — nới kiểu TS ở `ChatRoomsRepository.insertMember`/`archiveRoom` (§0 #6), KHÔNG đổi cột DB (đã nullable).

### 1.4 Đường tạo phòng: mirror `openDirect`, KHÔNG viết lại `insertRoom` của BE-1 sai cách

Extend **tại chỗ** `ChatRoomsRepository.insertRoom` — thêm 3 field optional vào kiểu `values` (`orgUnitId?`, `refId?`, `syncSource?`, default giữ nguyên hành vi cũ `"manual"`/`null`/`null` khi không truyền) thay vì viết một hàm INSERT thứ hai. Lý do DRY (CLAUDE.md §5, coding-style): một câu INSERT duy nhất cho `chat_rooms` là điểm neo duy nhất khi cột bảng đổi sau này; hai hàm INSERT song song là hai luật sẽ trôi (đúng lớp lỗi DECISIONS-05). ⚠️ Đây là sửa vào file của BE-1 (`chat-rooms.repository.ts`) — CHƯA qua FULL gate; người code phải re-chạy 16 ca RED-trước của BE-1 (nếu đã có) sau khi sửa, không chỉ ca mới của BE-5.

`ensureOrgUnitRoomTx`/`ensureProjectRoomTx` gọi `roomCode.allocate(companyId)` (NGOÀI tx của chính chúng, cùng mẫu BE-1 §1.3), rồi mở tx riêng để INSERT — 3 lớp chống trùng y hệt `openDirect` (tra trước → tra lại trong tx → bắt `23505` theo ĐÚNG tên constraint `chat_rooms_org_unit_uq`/`chat_rooms_project_uq` rồi SELECT lại).

**Tên phòng**: snapshot `orgUnit.name`/`project.name` tại thời điểm tạo (bắt buộc — `chk_chat_rooms_name` ép NOT NULL cho phòng không phải `direct`, DB-12 §6.1). Đổi tên org_unit/project SAU đó **không** đồng bộ lại — ghi nợ ở §5 (không nằm trong `done_when`, tránh scope creep).

### 1.5 Job đối soát — KHÔNG phải "đêm", chạy theo nhịp `system-jobs` hiện có

`ChatDerivedRoomsReconcileJobHandler` (`apps/api/src/chat/chat-derived-rooms-reconcile.job-handler.ts`), `@Injectable() @SystemJobHandler()`, constructor **chỉ** nhận `ChatDerivedRoomsSyncService` + `DatabaseService` (2 Nest provider bình thường) — **KHÔNG** nhận `Database`/`workerDb` ⇒ **không cần `@Optional()`** (§0 #10, mirror `RetentionCleanupJobHandler`, TUYỆT ĐỐI không mirror `SystemJobRunsRetentionJobHandler`).

`run({companyId})` mở **ĐÚNG MỘT** `this.db.withTenant(companyId, tx => ...)` bọc trọn vòng đối soát (mirror Goal, §0 #11), KHÔNG catch (lỗi propagate cho `JobRunner` finalize `'Failed'` per-tenant, không chặn tenant khác):

1. Mọi `org_units` `status='active' AND deletedAt IS NULL` chưa có phòng ⇒ `ensureOrgUnitRoomTx`.
2. Mọi `projects` không terminal (`projectStatus` NOT IN TERMINAL_STATUSES) `AND deletedAt IS NULL` chưa có phòng ⇒ `ensureProjectRoomTx`.
3. Mọi `projects` terminal HOẶC đã xoá mềm mà phòng tồn tại và `isArchived=false` ⇒ `archiveProjectRoomTx`.
4. **Diff thành viên department**: mong muốn = `{(orgUnitId, userId) | employee_profiles WHERE status='active' AND deletedAt IS NULL AND userId IS NOT NULL AND orgUnitId IS NOT NULL}`; thực tế = `{(chat_rooms.orgUnitId, userId) | chat_room_members JOIN chat_rooms WHERE sync_source='department' AND leftAt IS NULL}`. Thiếu ⇒ join; thừa ⇒ leave. Hai câu SELECT (không N+1), diff bằng SQL anti-join hoặc tập hợp trong service — cấm vòng lặp truy vấn theo từng user.
5. **Diff thành viên project**: mong muốn từ `project_members WHERE memberStatus='Active' AND deletedAt IS NULL`, thực tế từ `chat_room_members JOIN chat_rooms WHERE sync_source='project'` — cùng khuôn.
6. Log `WARN` số phòng tạo mới + số thành viên thêm/bớt nếu > 0 (`done_when`: "lệch > 0 → log cảnh báo"); log `DEBUG` khi = 0.

`SchedulerModule.imports` += `ChatModule` (append, `scheduler.module.ts:24-25`). `ChatModule.providers`/`exports` += `ChatDerivedRoomsSyncService` (export, để Org/Employees/Tasks module dùng); += `ChatDerivedRoomsReconcileJobHandler` (**chỉ providers, KHÔNG export** — mirror `SystemJobRunsRetentionJobHandler`, không consumer nào ngoài scheduler cần inject nó trực tiếp).

### 1.6 Wiring cross-module: 3 module thêm `ChatModule` vào `imports`

`org.module.ts`, `employees.module.ts`, `tasks.module.ts` — mỗi file thêm `ChatModule` vào mảng `imports` (append, có tiền lệ `goals.module.ts:51` GoalsModule→TasksModule + tiền lệ lịch sử `org.module.ts:16`). Không cycle (đã kiểm §0 #12). Service tương ứng (`OrgService`, `HrDepartmentService`, `ProjectsService`, `HrWriteService`) inject `ChatDerivedRoomsSyncService` qua constructor, gọi SAU khi `this.db.withTenant(...)` của method nghiệp vụ đã `return`/resolve, bọc try/catch, KHÔNG await bên trong tx nghiệp vụ.

⚠️ **Bắt buộc**: sau khi thêm provider mới, chạy **1 int-spec dựng AppModule thật** trước khi tin là xong (memory `systemjobhandler-optional-dbw-di` — thiếu export ở `TasksModule` từng khiến `GoalDecomposeService` không resolve được, sập AppModule, đỏ dây chuyền >100 int-spec; đúng lớp lỗi này áp dụng cho MỌI provider mới, không riêng job handler).

### 1.7 Audit

Action mới trong `CHAT_AUDIT` (`chat.errors.ts`), TÁCH RIÊNG khỏi action thủ công đã có (BE-1's `ROOM_CREATED`/`MEMBER_ADDED`/`MEMBER_REMOVED` mang nghĩa "người dùng tự làm" — dùng lại cho hành động hệ thống là sai ngữ nghĩa của dòng audit):

```text
ROOM_AUTO_CREATED · ROOM_AUTO_ARCHIVED · MEMBER_AUTO_ADDED · MEMBER_AUTO_REMOVED
```

Real-time hook: `actorType: "System"`, `actorUserId` = actor của hành động HR/TASK gây ra sync (có sẵn ở call site). Job: `actorType: "Job"`, `actorUserId` bỏ trống (optional — §0 #18). `objectType: "chat_room"`, `moduleCode: "CHAT"`, nội dung `newValues` chỉ chứa id/tên phòng + userId liên quan (không nội dung tin nhắn — WO này không chạm bảng tin nhắn).

### 1.8 Nhân viên chưa có `userId` liên kết ⇒ no-op im lặng (log DEBUG, không WARN)

`employee_profiles.userId` nullable (§0, `employees.ts:44`); nhân viên import hàng loạt (`createFromImportTx`) luôn UNLINKED. Không có `userId` ⇒ không có gì để đồng bộ ở CHAT (thành viên phòng chat khoá theo `userId`) — mọi hàm `syncEmployee...Tx` phải kiểm `userId !== null` trước khi làm gì, trả về sớm.

---

## 2. Thi công — phạm vi file

**Mới** (`apps/api/src/chat/`):

- `chat-derived-rooms-sync.service.ts` — 6 hàm `...Tx` + wrapper public (§1.3).
- `chat-derived-rooms-reconcile.job-handler.ts` — `@SystemJobHandler()` (§1.5).

**Sửa** (append/extend, không rewrite):

- `chat-rooms.repository.ts` — mở rộng kiểu `values` của `insertRoom` (3 field optional, §1.4); nới `archiveRoom`/`insertMember` nhận `actorUserId`/`addedBy: string | null`; thêm `findRoomByOrgUnitId`/`findRoomByRefId` (mirror `findRoomByDirectKey`).
- `chat.errors.ts` — 4 action mới trong `CHAT_AUDIT` (§1.7), additive.
- `chat.module.ts` — providers += 2, exports += `ChatDerivedRoomsSyncService`.
- `scheduler/scheduler.module.ts` — imports += `ChatModule`.
- `org/org.module.ts` — imports += `ChatModule`.
- `org/org.service.ts` — `createOrgUnit` gọi sync sau `return`.
- `org/hr-department.service.ts` — `createDepartment` gọi sync sau khi tx resolve.
- `employees/employees.module.ts` — imports += `ChatModule`.
- `employees/hr-write.service.ts` — `createEmployee`/`updateEmployee`/`linkUser`/`unlinkUser`/`changeStatus` gọi sync tương ứng (W8-W12, §1.1).
- `tasks/tasks.module.ts` — imports += `ChatModule`.
- `tasks/projects.service.ts` — `createProject`/`closeProject`/`deleteProject`/`addMember`/`removeMember` gọi sync (W3-W7).

**Test** — `apps/api/test/integration/chat-be5-derived-rooms.int-spec.ts` (mới), đặt theo mẫu `chat-be1-*.int-spec.ts` đã có.

**KHÔNG sửa**: `packages/contracts/src/chat.ts` (không DTO/route mới), `config/openapi-modules.ts` (không route mới, mục `CHAT` đã có sẵn — §0 #19), bất kỳ file nào trong phạm vi BE-2 (`chat-message*.ts`).

---

## 3. KHÔNG làm trong WO này

- ❌ `OrgService.updateOrgUnit`/`deleteOrgUnit`, `HrDepartmentService.updateDepartment`/`deleteDepartment` — rename/deactivate/xoá org_unit **không** đồng bộ lại phòng (tên phòng đứng yên, phòng không tự archive). Ghi nợ §5.
- ❌ `ProjectsService.updateProject` đổi tên dự án — tên phòng chat KHÔNG đổi theo (snapshot lúc tạo, §1.4). Ghi nợ §5.
- ❌ `ProjectsService.updateMemberRole` — đổi `projectRole` trong TASK không map sang chat (phòng dẫn xuất không có admin, §0 #7).
- ❌ Tái kích hoạt nhân viên (`inactive→active`) **không** có hook real-time tự động vào lại phòng — dựa vào job đối soát (chạy lại mỗi ~60s theo nhịp hệ thống, không phải chờ qua đêm). Ghi nợ §5.
- ❌ Tin nhắn/tệp/tìm kiếm (BE-2/3/4) — job/service của WO này không đọc/ghi `chat_messages`.
- ❌ Đọc-vượt Super Admin (BE-7), WebSocket push khi phòng mới/thành viên đổi (RT-1), thông báo "bạn vừa được thêm vào phòng" (BE-6 — outbox riêng, ngoài phạm vi).
- ❌ Cặp quyền mới, route mới, thay đổi `PermissionGuard`/`RequirePermission` — WO này không có controller.
- ❌ Xử lý `room_type='channel'` cũ hay migration schema — không đụng migration.

---

## 4. Test RED-trước

⚠️ Chủ thể mọi ca KHÔNG được là Super Admin (không liên quan trực tiếp vì WO không có route, nhưng job/sync chạy dưới `withTenant` — verify company_id cô lập đúng, không phải verify permission). Chạy trên `LANE_DB` (`bash scripts/lane-db-setup.sh chatbe5` → `export LANE_DB=mediaos_chatbe5` → `bash harness/check.sh --lane-db`).

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| 1 | Tạo org_unit qua `POST /org/units` | Đúng 1 phòng `department`, `syncSource='department'`, `orgUnitId` khớp, `roomCode` hợp lệ |
| 2 | Tạo org_unit qua `POST /hr/departments` (writer KHÁC, cùng bảng) | Cũng tạo đúng 1 phòng — chứng minh CẢ HAI writer W1/W2 đều hook |
| 3 | Gọi `ensureOrgUnitRoomTx` 2 lần liên tiếp cho cùng `orgUnitId` | Vẫn đúng 1 phòng, không `23505` văng ra ngoài |
| 4 | Tạo project | Đúng 1 phòng `project`, `refId` khớp |
| 5 | Đổi `employees.orgUnitId` từ A sang B (nhân viên có `userId`) | `chat_room_members` phòng A: `left_at` set; phòng B: hàng active mới/tái-dùng; `ChatAccessService.assertMember` cho phòng A với user này ⇒ 404 |
| 6 | Nhân viên KHÔNG có `userId` đổi `orgUnitId` | Không hàng `chat_room_members` nào được tạo/sửa (no-op im lặng) |
| 7 | `linkUser` gán tài khoản cho nhân viên đã có `orgUnitId` sẵn | User join đúng phòng department tương ứng |
| 8 | `unlinkUser` gỡ tài khoản | User rời phòng department (nếu đang là member) |
| 9 | `changeStatus` → `inactive`: nhân viên đang là member 1 phòng department + 2 phòng project | Cả 3 hàng `chat_room_members` đều `left_at` set trong CÙNG một lần gọi |
| 10 | `addMember`/`removeMember` project | Join/leave đúng phòng project tương ứng, không đụng phòng khác |
| 11 | `closeProject` / `deleteProject` | Phòng project `isArchived=true`, **`chat_messages` không bị đụng** (không có route xoá/sửa tin trong WO này để test trực tiếp — assert phòng vẫn tồn tại, `deletedAt IS NULL`) |
| 12 | Company có sẵn org_unit + project TRƯỚC khi job chạy lần đầu (mô phỏng company cũ trước khi WO ship) | Chạy job → phòng được tạo đủ, roomCode hợp lệ, không trùng khi company đã/chưa có counter |
| 13 | Gieo lệch thủ công: insert trực tiếp 1 hàng `chat_room_members` thừa vào phòng department (user không thuộc org_unit đó) + xoá (set left_at) 1 hàng lẽ ra phải có | Chạy job → thừa bị leave, thiếu được join, log WARN đúng số lệch |
| 14 | Chạy job LẦN 2 ngay sau ca 13 | 0 thay đổi, log ở mức DEBUG (không WARN) — idempotent |
| 15 | Sync CHAT ném lỗi giả lập (mock/throw trong `ChatDerivedRoomsSyncService`) khi `HrWriteService.changeStatus` gọi nó | `changeStatus` vẫn trả về thành công, dòng `employee_profiles.status` vẫn đổi, KHÔNG rollback — chứng minh §1.2 |
| 16 | Cross-tenant: company A tạo org_unit | Company B **không** có phòng nào mới; job chạy cho company A không chạm phòng/thành viên company B |
| 17 | Grep sau khi code xong `apps/api/src/chat/**` | Đúng MỘT nơi gọi `insertRoom` với `syncSource !== "manual"` (trong `chat-derived-rooms-sync.service.ts`) — không route/service nào khác tự viết INSERT phòng dẫn xuất thứ hai |

### 4.1 Bằng chứng RED (vá tạm, chạy, hoàn nguyên)

| Vá tạm | Ca ĐỎ kỳ vọng |
| --- | --- |
| Bỏ điều kiện `userId IS NOT NULL` khỏi `syncEmployeeDepartmentMembershipTx` | ca 6 |
| Job không chạy diff thành viên (chỉ tạo phòng) | ca 13 |
| Sync gọi trong CÙNG tx với `changeStatus` (nhét vào bên trong `withTenant`) rồi throw | ca 15 (business write cũng rollback theo — sai) |

---

## 5. Nợ/rủi ro chuyển WO sau

1. **Rename/deactivate/delete org_unit hoặc project không đồng bộ ngược lại phòng** — tên phòng đứng yên (staleness chấp nhận, §1.4); org_unit bị soft-delete/`status='inactive'` không tự archive phòng department tương ứng (SPEC §13.3 chỉ liệt kê org_unit CREATE, không liệt kê update/delete — có thể là thiếu sót của spec, KHÔNG tự ý mở rộng phạm vi, cờ cho owner xem lại nếu cần WO riêng).
2. **Tái kích hoạt nhân viên không có hook real-time** — dựa job (~60s/lần thực tế, không phải "đêm" như tên gọi trong backlog/SPEC — xem §0 #9). Nếu owner cần tức thời, cần WO bổ sung hook `changeStatus` nhánh `→active`.
3. **`TERMINAL_STATUSES` "Cancelled"/"Archived" của project chưa từng được ghi bởi bất kỳ writer nào hiện có** (§0 #22) — logic archive-on-terminal của job viết TỔNG QUÁT cho tương lai nhưng KHÔNG test được bằng writer thật hôm nay; khi TASK module thêm đường ghi 2 trạng thái này, phải verify lại nhánh job tương ứng chạy đúng (không có ca test nào pin được điều này ngay bây giờ).
4. **Hai writer tạo org_unit (W1/W2) là rủi ro cấu trúc lâu dài** — nếu tương lai có writer THỨ BA (import hàng loạt phòng ban chẳng hạn), phải nhớ hook thêm; không có cơ chế nào ở tầng DB/schema tự ép "mọi org_unit phải có phòng" ngoài job đối soát.
5. **Lệch giữa câu chữ SPEC-15 §13.3 ("cùng transaction khi rẻ") và thiết kế thực tế (§1.2, luôn ngoài tx)** — quyết định có lý do vững (blast-radius + writer W1 không nhận tx), nhưng là một diễn giải, không phải tuân thủ chữ đúng nghĩa đen. Cờ cho FULL-gate reviewer xác nhận đây là diễn giải chấp nhận được, không phải lỗ hổng.
6. **Chưa có NOTI "bạn vừa được thêm vào phòng ban/dự án"** — nằm ở BE-6 (outbox riêng), WO này chỉ ghi `chat_room_members`, không phát sự kiện thông báo.
7. **Working tree đang chạy song song BE-2** (đầu file) — mọi con số dòng ở §0/§1 phải đo lại ngay trước khi code nếu khoảng cách thời gian giữa lập plan và thi công lớn.

---

## 6. Definition of Done

- [ ] 12 writer (§1.1) đều gọi đúng hàm sync tương ứng, SAU khi tx nghiệp vụ nguồn đã resolve — có bằng chứng bằng test (không chỉ đọc code)
- [ ] `insertRoom` mở rộng (không nhân bản), 3 lớp chống trùng cho phòng department/project (mirror `openDirect`)
- [ ] `ChatDerivedRoomsSyncService` — mọi hàm nghiệp vụ có cặp `...Tx` (job dùng) + wrapper public (real-time dùng) — MỘT nguồn logic
- [ ] Job handler constructor chỉ nhận Nest provider thật (không `Database`/`workerDb` thô) — verify bằng 1 int-spec dựng AppModule
- [ ] `SchedulerModule`/`org.module.ts`/`employees.module.ts`/`tasks.module.ts` wiring đúng, KHÔNG cycle, boot AppModule xanh
- [ ] Audit: 4 action mới, `actorType` System/Job đúng ngữ cảnh, KHÔNG chứa nội dung tin nhắn
- [ ] Lỗi trong sync KHÔNG BAO GIỜ rollback/ném lỗi ra writer nghiệp vụ nguồn (ca test 15)
- [ ] Job idempotent — chạy 2 lần liên tiếp, lần 2 không đổi gì (ca 14)
- [ ] Job không N+1 — diff thành viên bằng SELECT theo tập hợp, không loop query theo user
- [ ] Cross-tenant cô lập — company khác không bị chạm (ca 16)
- [ ] Nhân viên không có `userId` — no-op an toàn (ca 6)
- [ ] Không route/DTO/openapi-modules mới — verify `route-guard-coverage` vẫn xanh KHÔNG cần regen census
- [ ] 17 ca RED-trước xanh trên `LANE_DB`, có bằng chứng RED trước GREEN
- [ ] `harness/check.sh --lane-db=chatbe5` XANH — không phải xanh-do-skip
- [ ] FULL gate (security-reviewer + database-reviewer + silent-failure-hunter) — CHƯA chạy, chờ chốt sau khi code
- [ ] lane DB `mediaos_chatbe5` drop sau khi xong
