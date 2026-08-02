# Micro-plan — `S7-CHAT-BE-5` (🔴 red · FULL gate) — rev 2 (02/08/2026 — vá BLOCK rev 1)

> **WO:** phòng chat tự động theo phòng ban + dự án — tạo/đóng phòng, đồng bộ thành viên tại sự kiện HR/TASK
> (đường THU HỒI chạy TRONG tx nguồn, cửa sổ lệch = 0), job đối soát định kỳ idempotent sửa lệch.
> **Nguồn sự thật:** [SPEC-15 §3.1 · §13.3 (kèm "Làm rõ 02/08/2026") · §12](<../SPEC/SPEC-15 CHAT.md>) ·
> [DB-12 §6.1 · §6.2 · §9 bước A](<../DB/DB-12 CHAT Database Design.md>) · `harness/backlog.mjs` (khối
> `S7-CHAT-BE-5`, `done_when` bản 02/08).
> **Nhánh:** `wave/s7-chat` (KHÔNG `master` — WAVE §4).
>
> ⚠️ **rev 1 bị `plan-reviewer` chấm BLOCK (6 CRITICAL).** rev 2 này vá đúng 10 điều kiện owner + reviewer
> chốt (C1-C6, H1-H3, H5) — xem §1 cho từng điều kiện đã vá ở đâu. **KHÔNG code cho tới khi rev 2 này PASS.**

## 0. Commit-sha đã đo (02/08/2026, đầu phiên viết rev 2)

```text
54b4d8cd feat(chat): S7-CHAT-BE-2 — tin nhắn (CHAT-API-009..014, 016)   ← ĐÃ COMMIT
c77f48e0 feat(chat): S7-CHAT-BE-1 — ChatAccessService + phòng/thành viên (CHAT-API-001..008)  ← ĐÃ COMMIT
```

`S7-CHAT-BE-1` VÀ `S7-CHAT-BE-2` đều **đã commit lên `wave/s7-chat`** — không còn "đang chạy song song,
chưa commit" như rev 1 mô tả. `apps/api/src/chat/` hiện có 16 file (không phải 5-6 file của lúc BE-1 vừa
xong): `chat.module.ts`, `chat.errors.ts`, `chat.mapper.ts`, `chat.dto.ts`, `chat-access.service.ts`,
`chat-room-rules.ts`, `chat-message-rules.ts`, `chat-room-code.service.ts`, `chat-rooms.repository.ts`,
`chat-rooms.service.ts`, `chat-members.service.ts`, `chat-rooms.controller.ts`, `chat-messages.repository.ts`,
`chat-messages.service.ts`, `chat-message-moderation.service.ts`, `chat-messages.controller.ts`.

`ChatModule` (`chat.module.ts:35-50`) hiện có **8 provider, 2 controller**:

```text
providers: ChatAccessService, ChatRoomsService, ChatMembersService, ChatRoomsRepository,
           ChatRoomCodeService, ChatMessagesService, ChatMessageModerationService, ChatMessagesRepository
controllers: ChatRoomsController, ChatMessagesController
exports: ChatAccessService, ChatRoomsRepository, ChatMessagesRepository
```

`chat.errors.ts` `CHAT_AUDIT` đã có khối `// ── S7-CHAT-BE-2 ──` (dòng 136-148: `MESSAGE_RECALLED` ·
`MESSAGE_PINNED` · `MESSAGE_UNPINNED`). **Câu "KHÔNG sửa bất kỳ file nào trong phạm vi BE-2" của rev 1 là
SAI** — `chat.module.ts` và `chat.errors.ts` là file **CHUNG** của cả module, WO này chắc chắn phải append
vào cả hai (thêm provider mới, thêm audit action mới) cạnh khối BE-2 đã có, không phải file "cấm đụng".
**Trước khi code thật: `git log --oneline -3 -- apps/api/src/chat/` một lần nữa** — nếu có WO khác (BE-3/
BE-4/BE-6/BE-7/RT-1) đã chạy tiếp trong lúc chờ duyệt plan này, số dòng ở §1 dưới có thể đã trôi thêm.

---

## 1. Owner chốt 02/08/2026 (SPEC-15 §13.3, khối "Làm rõ 02/08/2026", dòng 397-403) — tóm tắt ràng buộc

1. **"Đêm" là chữ sai** — đã sửa "định kỳ" ở cả SPEC lẫn `harness/backlog.mjs`. Không có cron; mọi
   `@SystemJobHandler` chạy chung 1 `setInterval`. PROD: `SYSTEM_JOBS_POLL_MS=900000` (**15 phút** —
   `.env.prod:9` VÀ `.env:9`, đo trực tiếp 02/08; `.env.example:141` vẫn để `60000` — KHÔNG phải giá trị
   PROD dùng).
2. **Đường THU HỒI quyền chạy TRONG cùng transaction nguồn** — rời phòng khi đổi phòng ban · nghỉ việc ·
   unlink · bớt `project_members`. Cửa sổ lệch = **0**. Hỏng ở nhánh này phải **LOUD** (log ERROR + audit
   `resultStatus='Failure'`), **cấm** nuốt bằng `logger.warn`.
3. **Đường TẠO PHÒNG được phép ngoài tx** — `ChatRoomCodeService.allocate()` gọi
   `SequenceService.nextCode()` tự mở `withTenant` riêng (`chat-room-code.service.ts:43-48`, xác nhận lại
   02/08), **không lồng được** vào tx nghiệp vụ. Cấp mã TRƯỚC khi mở tx tạo phòng, chấp nhận phí số khi
   rollback. "Thiếu 1 phòng ≠ rò quyền đọc" — đánh đổi này AN TOÀN, khác hẳn mục 2.
4. `OrgRepository.createOrgUnit` **không nhận `tx`** (`org.repository.ts:89-114`, xác nhận lại 02/08, tự mở
   `withTenant` bên trong `updateOrgUnit`-adjacent code path) ⇒ **chọn "ghi rõ writer này ngoài tx"**
   (không nới chữ ký repo — xem §2.3 lý do).
5. Vị từ "tập thành viên mong muốn" phải **DUY NHẤT**, dùng chung cho hook lẫn job. Phòng `project` bắt
   buộc kèm `employee_profiles.status='active' AND deleted_at IS NULL` — thiếu vế này thì nhịp job kế tiếp
   **join lại người vừa nghỉ việc** (`changeStatus` không chạm `project_members`).

---

## 2. Đo thêm (02/08/2026, phục vụ vá 10 điều kiện BLOCK)

| # | Thứ | Đo được | Nguồn |
| --- | --- | --- | --- |
| 1 | `SYSTEM_JOBS_POLL_MS` PROD thật | `900000` (15 phút) ở CẢ `.env.prod:9` và `.env:9`; default code khi thiếu biến là `60_000` (`worker-scheduler.config.ts:23`) | đọc trực tiếp 2 file .env (gitignored, không lên git) |
| 2 | Mọi `@SystemJobHandler` chạy TUẦN TỰ trong 1 nhịp | `WorkerSchedulerService.runSystemJobs` là vòng `for...of` gọi `runner.runJob` từng cái, try/catch RIÊNG mỗi handler (1 handler lỗi không chặn handler kế, nhưng KHÔNG chạy song song) | `worker-scheduler.service.ts:117-132` |
| 3 | `JobRunner` lock TTL mặc định | `DEFAULT_LOCK_TTL_MS = 10 * 60_000` = **10 phút** — "vòng chạy PHẢI < TTL để lock không hết hạn giữa chừng" | `job-runner.ts:14-15,46` |
| 4 | `JobRunContext` chỉ có `companyId` | `interface JobRunContext { companyId: string }` — không có `tx`; handler tự mở `withTenant` bên trong `run()` | `job-handler.ts:23-25` |
| 5 | `GoalReconciliationJobHandler` KHÔNG cấp mã | `run()` chỉ mở 1 `withTenant` gọi `engine.reconcileCompanyTx` — không có bước allocate sequence nào, nên **không đụng bẫy lồng-tx-cấp-mã** mà job CHAT chắc chắn gặp. Không mirror được 1-1. | `goal-reconciliation.job-handler.ts:50-54` |
| 6 | `insertRoom` hiện tại — CHƯA sửa | `values` không có `orgUnitId`/`refId`, hard-code `syncSource: "manual"` trong `.values({...values, syncSource: "manual"})`; `createdBy: string` (TS non-null dù DB cột nullable) | `chat-rooms.repository.ts:183-200` |
| 7 | `chat_rooms` — cột nullable ở DB nhưng TS ép non-null | `createdBy` (dòng 171, KHÔNG `.notNull()`), `archivedBy`/`archivedAt` (184-185, nullable) — TS `archiveRoom(actorUserId: string)` (225-229) và `insertMember(addedBy: string)` (302-310) đang hẹp hơn DB | `chat-rooms.repository.ts:171,184-185,225-229,302-310` · `communication.ts:171,184-185` |
| 8 | Unique idempotency phòng dẫn xuất | `chat_rooms_org_unit_uq` (company_id, org_unit_id WHERE NOT NULL, dòng 200-202) · `chat_rooms_project_uq` (company_id, ref_id WHERE NOT NULL, dòng 194-196) — **không lọc `deleted_at`** | `communication.ts:194-196,200-202` |
| 9 | `chat_rooms.synced_at` tồn tại, chưa từng ghi | Cột `syncedAt` (dòng 179) không xuất hiện trong bất kỳ `.set()`/`.values()` nào ở `chat-rooms.repository.ts` hiện tại — rev 2 CHỐT dùng nó (§4.4), không ghi nợ tiếp | `communication.ts:179` |
| 10 | `chk_chat_rooms_sync_source` ràng buộc CHÉO field | `syncSource` phải khớp `roomType` (comment dòng 177: "manual \| department \| project — ràng buộc theo room_type") — `orgUnitId`/`refId`/`directKey` cũng phải khớp đúng `roomType` tương ứng (footgun nếu API nhận rời rạc, xem §4.4) | `communication.ts:161-179` |
| 11 | `org_units.type` — ĐÚNG 5 giá trị | CHECK `org_units_type_check`: `'department','division','unit','office','branch'` | `db/schema/org.ts:41-43` |
| 12 | `OrgService.createOrgUnit` mặc định `type` | `dto.type ?? "department"` — route KHÔNG bắt buộc client gửi `type` | `org.service.ts:48-58` |
| 13 | `project_members.memberStatus` NULLABLE | `text("member_status")` — KHÔNG `.notNull()` (mig 0478 §7); CHECK `chk_project_members_member_status`: `member_status IS NULL OR member_status IN ('Active','Inactive','Removed')` — hàng cũ/legacy có thể `member_status IS NULL` | `db/schema/media.ts:496,535-536` |
| 14 | Khuôn predicate desired-set project ĐÃ CÓ SẴN, tái dùng được | `ProjectsRepository.buildScopeExists` dùng ĐÚNG `memberStatus = 'Active' AND deletedAt IS NULL` (3 chỗ lặp lại y hệt trong file: dòng 158-159, 181-182, 200-201) — đây là khuôn CHUẨN đã chứng minh đúng cho "member đang hoạt động", KHÔNG viết bản mới | `tasks/projects.repository.ts:148-163,171-192,194-203` |
| 15 | `TERMINAL_STATUSES` project | `new Set(["Completed", "Cancelled", "Archived"])` — chỉ `"Completed"` (qua `closeProjectTx`) thực sự có writer; `Cancelled`/`Archived` chưa ai gán (đã ghi nợ ở rev 1 §5, GIỮ NGUYÊN kết luận) | `tasks/projects.service.ts:54` |
| 16 | `createProject` chèn owner vào `project_members` NGAY trong tx tạo project | Dòng 246-255, `insertMemberTx` bên trong `this.db.withTenant(...)` của chính `createProject` — TRƯỚC KHI hàm return. Đây là NGUỒN của H1 (rev 1 chỉ tạo phòng rỗng, không sync membership hiện có) | `tasks/projects.service.ts:211-289` |
| 17 | `addMember`/`removeMember` phạm vi dòng chính xác | `addMember`: 480-555 (insertMemberTx dòng 505-512, outbox.enqueue dòng 540); `removeMember`: 610-645 (softRemoveMemberTx dòng 624) | `tasks/projects.service.ts` |
| 18 | `outbox.enqueue` CÓ SẴN trong 2 file WO này phải sửa | `hr-write.service.ts:222` (`auth.user_created`) · `projects.service.ts:540` (`project.member_added`) — rev 1 dùng câu này để bác bỏ outbox nhưng KHÔNG cần outbox cho WO này nữa (§4.2 lý do khác) | grep trực tiếp |
| 19 | `SAVEPOINT` (`tx.transaction(sp => …)`) là idiom ĐÃ CÓ trong repo, an toàn trên PgBouncer transaction-mode | Dùng ở `leave-accrual.service.ts:191`, `leave-carryover.service.ts:180`, `sequence.repository.ts:104`, `notification-event.repository.ts:149`, `notification-template.repository.ts:155` — cô lập lỗi 1 nhánh phụ mà KHÔNG poison tx cha (không mở connection mới, chỉ `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` trên CÙNG connection) | grep `tx.transaction(` |
| 20 | `withTenant` LỒNG (mở tx MỚI trong callback của tx khác) = TREO trên PgBouncer transaction-mode | `withTenant` = `db.transaction(...)` xin **connection mới** từ pool; gọi nó lần 2 TRƯỚC KHI callback đầu return/reject có thể chờ connection trong khi connection đầu đang giữ ⇒ đây là lớp lỗi khác ARCHIVE-BIẾT (`avatar-presign.service.ts:48`, `goal-reconciliation.job-handler.ts:21-23`) — **PHẢI tránh** khi thiết kế "ghi audit Failure ở kênh riêng" (§4.3) | `db.service.ts:74-92` |
| 21 | `restoreEmployeeTx` chỉ `.returning({id})` | KHÔNG trả `orgUnitId`/`userId`/`status` — `RecycleBinService.restoreEmployee` hiện KHÔNG có dữ liệu để biết join phòng nào | `recycle-bin.repository.ts:59-72` |
| 22 | `deleteEmployee` (họ 2) mở tx Ở TẦNG REPO, không phải SERVICE | `EmployeesService.deleteEmployee` (`employees.service.ts:378-381`) gọi thẳng `this.repo.softDeleteEmployee(companyId, id)`; hàm đó tự `this.db.withTenant(...)` bên trong (`employees.repository.ts:210-224`) — KHÁC với `createEmployee`/`updateEmployee` trong CÙNG file (tx mở ở service, dòng 234/307) | `employees/employees.service.ts:378-381` · `employees/employees.repository.ts:210-224` |
| 23 | `HrEmployeeStatus` — đúng 4 giá trị, statuses "rời" | `STATUS_TRANSITIONS` key: `active/inactive/resigned/terminated`; "rời mọi phòng dẫn xuất" (SPEC-15 §13.3) áp cho MỌI status khác `"active"` (`inactive`/`resigned`/`terminated`) — `LOCKING_STATUSES = {resigned, terminated}` là tập KHÁC (chỉ dùng cho khoá tài khoản), KHÔNG dùng nhầm cho CHAT | `hr-write.service.ts:69-76` |
| 24 | Dòng chính xác 2 họ writer (đủ 14 điểm, không phải 12) | Họ 1 (`HrWriteService`): `createEmployee:150` · `updateEmployee:350` · `changeStatus:437` · `linkUser:530` · `unlinkUser:565`. Họ 2 (`EmployeesService`, route `employees.controller.ts`): `createEmployee:218` (`@Post():45`) · `updateEmployee:303` (`@Patch(":id"):58`) · `deleteEmployee:378` (`@Delete(":id"):68`). `RecycleBinService.restoreEmployee:73-87` | đọc trực tiếp từng file |
| 25 | `RecycleBinModule`/`org.module.ts`/`employees.module.ts`/`tasks.module.ts`/`SchedulerModule` — CHƯA import `ChatModule` | `recycle-bin.module.ts` imports `[DatabaseModule, PermissionModule]`; `org.module.ts` imports `[DatabaseModule, PermissionModule]`; `employees.module.ts`/`tasks.module.ts` tương tự không có `ChatModule`; `scheduler.module.ts` imports `[DiscoveryModule, RetentionModule, FilesModule]` | đọc trực tiếp 5 file |
| 26 | `findUsableUserIds` — khuôn "user dùng được" ĐÃ CÓ Ở BE-1, đừng viết lại | `users.deletedAt IS NULL AND users.status='active'` | `chat-rooms.repository.ts:385-405` |
| 27 | `AUDIT_OBJECT_TYPES` có `chat_room` | Dòng 137 — không cần migration cho audit của WO này | `db/schema/audit.ts:137` |
| 28 | `audit.record` chấp nhận `resultStatus` | Cột `varchar("result_status", {length:50})`, dùng optional ở NHIỀU service (`profile-change-request.service.ts` dùng `'Denied'`, `lms-user-sync.job-handler.ts` dùng `'Failure'`/`'Error'` cho audit TÓM TẮT của 1 lần job chạy — KHÔNG phải audit atomic-trong-tx-nghiệp-vụ) | `db/schema/audit.ts:50` · grep `resultStatus` |

---

## 3. Lựa chọn thiết kế — 10 điều kiện BLOCK đã vá thế nào

### 3.1 C1 — Danh sách WRITER đầy đủ (14 điểm, 2 họ + recycle-bin)

**GẤP ĐÔI** rev 1: rev 1 chỉ liệt kê họ `HrWriteService` (W8-W12), bỏ sót HOÀN TOÀN họ
`EmployeesService`/`employees.controller.ts` (route `PATCH /employees/:id` sống ở đây, KHÔNG phải
`HrWriteController`) và `RecycleBinService.restoreEmployee`. Bảng đầy đủ:

| # | Writer | File:dòng | Route | Sự kiện CHAT | Hình |
| --- | --- | --- | --- | --- | --- |
| W1 | `OrgService.createOrgUnit` | `org.service.ts:48-69`→`org.repository.ts:89-114` (no tx) | `POST /org/units`, alias `POST /org/departments` | tạo phòng `department` | **CREATE**, ngoài tx |
| W2 | `HrDepartmentService.createDepartment` | `hr-department.service.ts:62-120` (có tx) | `POST /hr/departments` | tạo phòng `department` | **CREATE**, ngoài tx (nhất quán W1) |
| W3 | `ProjectsService.createProject` | `projects.service.ts:211-289` | `POST /projects` | tạo phòng `project` + seed owner-membership | **CREATE**, ngoài tx |
| W4 | `ProjectsService.closeProject` | `projects.service.ts:407-448` | close project | archive phòng | **CREATE-side** (archive), ngoài tx |
| W5 | `ProjectsService.deleteProject` | `projects.service.ts:450-476` | delete project | archive phòng | ngoài tx |
| W6 | `ProjectsService.addMember` | `projects.service.ts:480-555` | add project member | join phòng project | **GRANT**, trong tx + SAVEPOINT |
| W7 | `ProjectsService.removeMember` | `projects.service.ts:610-645` | remove project member | leave phòng project | **REVOKE**, trong tx, LOUD |
| W8a | `HrWriteService.createEmployee` | `hr-write.service.ts:150-~275` | tạo NV (họ 1) | join phòng department nếu có `orgUnitId`+`userId` | **GRANT**, trong tx + SAVEPOINT |
| W8b | `EmployeesService.createEmployee` | `employees.service.ts:218-301` | tạo NV (họ 2, legacy) | như trên | **GRANT**, trong tx + SAVEPOINT |
| W9a | `HrWriteService.updateEmployee` | `hr-write.service.ts:350-433` | sửa hồ sơ, `orgUnitId` đổi | rời cũ (LOUD) + vào mới (best-effort) | **REVOKE+GRANT**, trong tx |
| W9b | `EmployeesService.updateEmployee` | `employees.service.ts:303-376` | `PATCH /employees/:id`, `orgUnitId` đổi | như trên — **đúng ca C1 done_when#2** | **REVOKE+GRANT**, trong tx |
| W10 | `HrWriteService.linkUser` | `hr-write.service.ts:530-563` | gắn tài khoản | join phòng department theo `orgUnitId` hiện có | **GRANT**, trong tx + SAVEPOINT |
| W11 | `HrWriteService.unlinkUser` | `hr-write.service.ts:565-599` | gỡ tài khoản | rời phòng department | **REVOKE**, trong tx, LOUD |
| W12 | `HrWriteService.changeStatus` | `hr-write.service.ts:437-488` | `newStatus !== 'active'` | rời **MỌI** phòng dẫn xuất | **REVOKE**, trong tx, LOUD |
| W13 | `RecycleBinService.restoreEmployee` | `recycle-bin.service.ts:73-87` | khôi phục từ thùng rác | join lại phòng department (nếu `status='active'` + `orgUnitId`+`userId`) | **GRANT**, trong tx + SAVEPOINT |
| W14 | `EmployeesService.deleteEmployee` (MỚI, không có ở rev 1) | `employees.service.ts:378-381` (refactor tx lên service, §3.5) | `DELETE /employees/:id` | rời **MỌI** phòng dẫn xuất | **REVOKE**, trong tx, LOUD |

**Vì sao thêm W14**: `deleteEmployee` soft-delete `employee_profiles.deleted_at` — vị từ desired-set DUY NHẤT
(§3.6) là `status='active' AND deleted_at IS NULL`, nên xoá mềm cũng đưa người đó RA khỏi tập mong muốn y hệt
`changeStatus`. Không hook writer này thì `DELETE /employees/:id` mở đúng cửa sổ-lệch-thu-hồi mà owner vừa
ra lệnh phải bằng 0 (giữ nguyên logic của C1, không phải scope creep — nó là hệ quả trực tiếp của vị từ đã
chốt).

**KHÔNG hook** (đã kiểm, không đổi so với rev 1): `OrgService.updateOrgUnit`/`deleteOrgUnit`,
`HrDepartmentService.updateDepartment`/`deleteDepartment` (rename/deactivate không đồng bộ lại — nợ §6),
`ProjectsService.updateProject` (đổi tên không đổi tên phòng), `ProjectsService.updateMemberRole` (phòng
dẫn xuất không có admin, §5 #7 rev1 giữ nguyên).

### 3.2 C6 + C2 — Đường THU HỒI trong tx nguồn, LOUD, KHÔNG lồng `withTenant`

**Vấn đề kỹ thuật rev 1 không thấy**: nếu bọc sync-call bằng `try { … } catch { logger.warn }` NGAY TRONG
callback của `db.withTenant(...)` nghiệp vụ, và statement bên trong THẬT SỰ lỗi ở tầng Postgres (không phải
lỗi JS thuần), **toàn bộ transaction Postgres đã bị ABORT** — mọi câu SAU đó (kể cả audit ghi ngay sau) ném
`25P02: current transaction is aborted`. Nuốt lỗi bằng try/catch KHÔNG cứu được tx đã aborted trừ khi bọc
`SAVEPOINT` (§2 #19). Rev 2 tách 2 hình dạng rõ ràng:

**(a) REVOKE (W7, W9a, W9b, W11, W12, W14) — KHÔNG bọc `SAVEPOINT`, để lỗi propagate tự nhiên:**

```text
async updateEmployee(user, id, dto) {
  try {
    const updated = await this.db.withTenant(user.companyId, async (tx) => {
      … (logic hiện có) …
      if (orgUnitIdChanging) {
        // KHÔNG catch ở đây — lỗi tự nhiên làm Postgres abort tx, callback reject,
        // withTenant() rollback + trả connection về pool.
        await this.chatSync.leaveOrgUnitRoomTx(tx, user.companyId, row.userId, oldOrgUnitId);
        await this.chatSync.tryJoinOrgUnitRoomTx(tx, user.companyId, row.userId, newOrgUnitId); // SAVEPOINT bên trong, xem (b)
      }
      … return row;
    });
    return maskSalary(updated, false);
  } catch (err) {
    if (isUniqueViolation(err)) { … } // giữ nguyên logic cũ
    if (err instanceof ChatSyncRevokeError) {
      // tx GỐC đã rollback xong (callback đã reject) — AN TOÀN mở tx MỚI ở đây, KHÔNG lồng (§2 #20).
      this.logger.error(`CHAT sync thu hồi THẤT BẠI — updateEmployee id=${id}: ${err.message}`, err.stack);
      await this.chatSync
        .recordRevokeFailureAudit(user.companyId, { action: "orgUnitChanged", actorUserId: user.id, targetId: id, cause: err })
        .catch((e2) => this.logger.error("Ghi audit Failure cũng lỗi (best-effort)", e2));
    }
    throw err; // LUÔN rethrow — HTTP caller nhận 500, KHÔNG có state nào commit nửa vời.
  }
}
```

- `ChatSyncRevokeError` (lớp lỗi RIÊNG, export từ `chat-derived-rooms-sync.service.ts`) bọc lỗi gốc — caller
  phân biệt được "lỗi tới từ nhánh sync thu hồi" (cần ghi Failure-audit) với lỗi nghiệp vụ khác của chính
  `updateEmployee` (không ghi audit sai ngữ cảnh).
- `recordRevokeFailureAudit` mở `this.db.withTenant(companyId, tx2 => this.audit.record(tx2, {…}))` **SAU KHI**
  tx gốc đã reject hẳn (đang ở nhánh `catch` NGOÀI `await this.db.withTenant(...)`, không phải trong callback)
  — không vi phạm §2 #20. Action `chat.room.member_sync_failed` (§3.7), `resultStatus: 'Failure'`.
- Kết quả: (1) `updateEmployee` THẤT BẠI TOÀN BỘ nếu rời phòng cũ lỗi — không có "orgUnitId đã đổi nhưng vẫn
  còn trong phòng cũ" (đúng "cửa sổ = 0"); (2) có audit `Failure` độc lập cho điều tra; (3) log ERROR ngay
  lập tức — không phải `warn` bị bỏ qua trong dashboard log-level mặc định INFO+.

**(b) GRANT gắn kèm REVOKE cùng sự kiện (nửa "join mới" của W9a/W9b) — CÓ bọc `SAVEPOINT`:**

```text
async tryJoinOrgUnitRoomTx(tx, companyId, userId, orgUnitId) {
  try {
    await tx.transaction((sp) => this.joinOrgUnitRoomTx(sp, companyId, userId, orgUnitId));
  } catch (err) {
    this.logger.warn(`CHAT: join phòng mới thất bại (không chặn thu hồi) — org=${orgUnitId} user=${userId}: ${msg(err)}`);
    // KHÔNG rethrow — đây là GRANT, chấp nhận lệch tới nhịp job kế (owner điểm 3: "thiếu 1 phòng ≠ rò quyền").
  }
}
```

Nếu phòng đích CHƯA tồn tại (org_unit vừa tạo, job chưa kịp chạy) — `joinOrgUnitRoomTx` NO-OP (log DEBUG,
KHÔNG throw): đây không phải "lỗi", là trạng thái chờ-job-tạo-phòng bình thường.

**(c) W6/W8a/W8b/W10/W13 (GRANT thuần, không đi kèm REVOKE nào)** — cùng mẫu SAVEPOINT như (b), gọi trực
tiếp trong callback `withTenant` hiện có của method, KHÔNG cần try/catch ở tầng ngoài (lỗi đã bị nuốt trong
SAVEPOINT, không propagate).

### 3.3 C3 — Vị từ "tập mong muốn" DUY NHẤT, dùng chung hook + job

Một file `chat-derived-rooms-predicates.ts` (mới, cùng thư mục `apps/api/src/chat/`) export 2 hằng SQL
fragment (dùng `sql` của drizzle), KHÔNG viết lặp ở 3+ nơi:

```text
DESIRED_DEPARTMENT_MEMBER =
  employee_profiles.status = 'active'
  AND employee_profiles.deleted_at IS NULL
  AND employee_profiles.user_id IS NOT NULL
  AND employee_profiles.org_unit_id = <room.orgUnitId>

DESIRED_PROJECT_MEMBER =                      -- COPY nguyên khuôn projects.repository.ts:158-159 (§2 #14)
  project_members.member_status = 'Active'
  AND project_members.deleted_at IS NULL
  AND project_members.project_id = <room.refId>
```

Dùng bởi: (1) `leaveOrgUnitRoomTx`/`joinOrgUnitRoomTx`/`leaveProjectRoomTx`/`joinProjectRoomTx` (hook), (2)
Phase 1 SCAN của job (§3.5), (3) Phase 3 DIFF-WRITE của job (§3.5, tái kiểm NGAY TRONG WHERE — H3). Sửa vị
từ 1 chỗ ⇒ hook và job đồng bộ theo — đúng yêu cầu owner điểm 5 và ca RED (a) mới (§5).

`DESIRED_PROJECT_MEMBER` GIẢI QUYẾT LUÔN H2 (`member_status IS NULL` không bị coi là "Active" — vị từ đòi
`= 'Active'` tường minh, hàng `NULL` tự động rơi vào nhóm "không mong muốn" một cách ĐÚNG Ý — KHÔNG bị job
đuổi lầm vì job sẽ KHÔNG BAO GIỜ join một hàng `NULL` làm "actual" nếu nó chưa từng ở trong `chat_room_members`;
rủi ro DUY NHẤT của H2 là chiều ngược: một `chat_room_members` đang active của user có `member_status IS NULL`
ở project (data cũ trước mig 0478) sẽ bị coi "thừa" và bị leave — **ĐÂY LÀ ĐÚNG HÀNH VI, KHÔNG PHẢI BUG**: nếu
`member_status` chưa từng được set (`NULL`), người đó **không** được xác nhận là thành viên "Active" bởi BẤT
KỲ đường đọc nào khác trong hệ (chính `buildScopeExists`/`myProjectRoleSql`/`memberCountSql` của
`projects.repository.ts` cũng loại `NULL` ra khỏi "Active" — panel TASK của họ CŨNG không thấy họ là active
member). Đồng bộ hành vi với phần còn lại của hệ thống, không tạo luật riêng cho CHAT.

### 3.4 C4 — Job 3-pha, KHÔNG lồng tx, KHÔNG mirror Goal mù

`ChatDerivedRoomsReconcileJobHandler.run(ctx)`:

```text
Pha 1 — SCAN (tx#1, withTenant, ĐÓNG trước khi allocate mã):
  SELECT org_units cần phòng (type ∈ {'department'} — §3.8 — status='active', deletedAt IS NULL,
         CHƯA có chat_rooms.org_unit_id tương ứng)
  SELECT projects cần phòng (projectStatus NOT IN TERMINAL_STATUSES, deletedAt IS NULL, chưa có phòng)
  SELECT projects terminal/xoá mềm mà phòng CHƯA archived
  → materialize 3 danh sách id thuần (KHÔNG materialize danh sách member — đó là Pha 3, đọc-mới TẠI ĐÓ).
  RETURN — tx#1 đóng ở đây.

Pha 2 — ALLOCATE + INSERT (NGOÀI tx, mỗi phòng 1 tx riêng, best-effort):
  for each org_unit thiếu phòng: roomCode.allocate(companyId) rồi gọi ensureOrgUnitRoom(companyId, id, name)
    (public wrapper, tự mở tx riêng, 3-lớp chống trùng mirror openDirect, SEED thành viên hiện tại
     TRONG CÙNG tx của chính nó — đóng H1 cho path job luôn, không chỉ path real-time)
  for each project thiếu phòng: tương tự ensureProjectRoom(...)
  for each project cần archive: archiveProjectRoom(...) (public wrapper riêng tx)
  Lỗi 1 phòng KHÔNG chặn phòng khác (catch per-item, log WARN, tiếp tục vòng lặp).

Pha 3 — DIFF THÀNH VIÊN (tx#2, withTenant MỚI, set-based, KHÔNG đụng sequence):
  -- Thiếu (JOIN): INSERT INTO chat_room_members (…)
  --   SELECT … FROM employee_profiles ep JOIN chat_rooms r ON r.org_unit_id = ep.org_unit_id
  --   WHERE <DESIRED_DEPARTMENT_MEMBER predicate — TÁI KIỂM tại đây, KHÔNG dùng danh sách Pha 1>
  --     AND NOT EXISTS (SELECT 1 FROM chat_room_members m WHERE m.room_id=r.id AND m.user_id=ep.user_id AND m.left_at IS NULL)
  --   ON CONFLICT (room_id, user_id) DO UPDATE SET left_at = NULL   -- tái dùng hàng cũ nếu đã rời trước đó
  -- Thừa (LEAVE): UPDATE chat_room_members m SET left_at = now()
  --   FROM chat_rooms r WHERE m.room_id = r.id AND r.sync_source='department' AND m.left_at IS NULL
  --     AND NOT EXISTS (SELECT 1 FROM employee_profiles ep WHERE <DESIRED_DEPARTMENT_MEMBER với ep.user_id = m.user_id>)
  -- Lặp lại y hệt cho phòng project với DESIRED_PROJECT_MEMBER.
  Đếm số hàng ảnh hưởng mỗi câu (drizzle trả rowCount) → log WARN nếu tổng > 0, DEBUG nếu 0.
```

**Vì sao KHÔNG "mirror Goal 1-`withTenant`-duy-nhất"**: `GoalReconciliationJobHandler` (§2 #5) không cấp mã
gì cả — 1 tx bọc trọn vòng là AN TOÀN cho nó. Job CHAT phải allocate `room_code` (không lồng được vào tx —
owner điểm 3), nên buộc phải tách pha. 3 pha riêng KHÔNG vi phạm "idempotent" của `JobHandler`: chạy lại từ
đầu ở nhịp sau chỉ thấy ít việc hơn (phòng đã tạo ở Pha 2 lần trước không xuất hiện lại ở Pha 1 lần sau).

**H3 giải quyết bằng chính Pha 3**: câu ghi KHÔNG dùng danh sách "ai thiếu/ai thừa" đã đọc ở Pha 1 (đó chỉ
cho phòng, không phải cho thành viên) — Pha 3 tự đọc-và-ghi trong CÙNG một câu SQL
(`INSERT…SELECT…WHERE NOT EXISTS` / `UPDATE…WHERE NOT EXISTS`), vị từ nguồn được **tái kiểm NGAY TRONG
`WHERE` của câu ghi**, nên nếu một hook real-time đã sửa đúng ngay TRƯỚC khi Pha 3 chạy, câu SQL sẽ thấy
trạng thái MỚI NHẤT tại thời điểm ghi — không có khoảng hở "đọc cũ, ghi đè lên thay đổi mới hơn".

**Ngân sách thời gian dưới TTL 10 phút (§2 #3)**: Pha 1 + Pha 3 là truy vấn tập hợp (không N+1); Pha 2 tuần
tự per-phòng-thiếu nhưng chỉ chạy cho phòng CHƯA có (ổn định sau lần chạy đầu, gần như luôn rỗng ở steady
state). `done_when` yêu cầu ca test đo thời gian job chạy trên tập dữ liệu mô phỏng "company cũ" (§5 ca 12)
và khẳng định < TTL bằng buffer thời gian thực đo, KHÔNG assert số tuyệt đối cứng.

### 3.5 Refactor tx cho W14 (`EmployeesService.deleteEmployee`)

`EmployeesRepository.softDeleteEmployee(companyId, id)` hiện tự mở `withTenant` (§2 #22). Tách:

```text
softDeleteEmployeeTx(tx, companyId, id) { … UPDATE …, returning() }   // core, nhận tx từ ngoài
softDeleteEmployee(companyId, id) { return this.db.withTenant(companyId, tx => this.softDeleteEmployeeTx(tx, companyId, id)); }
  // GIỮ hàm public cũ cho caller khác (nếu có) không đổi chữ ký — additive, không breaking.
```

`EmployeesService.deleteEmployee` đổi sang tự mở `this.db.withTenant(...)` (mirror CHÍNH `createEmployee`/
`updateEmployee` trong CÙNG file, KHÔNG phải pattern lạ), gọi `repo.softDeleteEmployeeTx(tx, …)` rồi
`chatSync.leaveAllDerivedRoomsTx(tx, companyId, row.userId)` (REVOKE, không SAVEPOINT, mẫu §3.2(a)), bọc
try/catch NGOÀI để bắt `ChatSyncRevokeError` → ghi Failure-audit, giữ nguyên `NotFoundException` cũ.

### 3.6 C1 done_when#2 — `PATCH /employees/:id` có hook

Giải quyết bởi W9b (§3.1) — `EmployeesService.updateEmployee` (`employees.service.ts:303-376`) hiện chỉ ghi
`orgUnitId`/`status`/... qua `updateEmployeeTx` mà KHÔNG có nhánh sync nào. Thêm: đọc `before.orgUnitId` (đã
có sẵn ở biến `before` khi `changingSalary` — MỞ RỘNG điều kiện đọc `before` thành `dto.orgUnitId !== undefined
&& dto.orgUnitId !== row.orgUnitId` sau khi có `row` từ `updateEmployeeTx`, so với giá trị CŨ đọc trước UPDATE
— cần đọc thêm 1 lần TRƯỚC update hoặc dùng `before`/`after` diff giống cách `changingSalary` đã làm) rồi gọi
sync REVOKE+GRANT y hệt W9a.

### 3.7 C6 — Audit: 5 action, có kênh Failure riêng

```text
ROOM_AUTO_CREATED · ROOM_AUTO_ARCHIVED · MEMBER_AUTO_ADDED · MEMBER_AUTO_REMOVED   -- CREATE/GRANT/REVOKE thành công
MEMBER_SYNC_FAILED                                                                  -- REVOKE thất bại (§3.2a), resultStatus='Failure'
```

Real-time hook thành công: `actorType: "System"`, `actorUserId` = actor gây ra sync HR/TASK. Job: `actorType:
"Job"`, `actorUserId` bỏ trống. `MEMBER_SYNC_FAILED`: `actorType: "System"`, ghi trong tx MỚI riêng (§3.2a),
`after: { reason: <message KHÔNG PII>, targetKind: 'department'|'project' }`. `objectType: "chat_room"`
(§2 #27, không cần migration), `moduleCode: "CHAT"`.

### 3.8 "Cũng nên vá" — chốt tập `org_units.type` được có phòng

5 loại tồn tại (§2 #11): `department, division, unit, office, branch`. SPEC-15 §13.3 nói nguyên văn "tạo
phòng **department**" — CHỐT: chỉ `type = 'department'` sinh phòng chat, 4 loại còn lại (node phân cấp
`division`/`unit`/`office`/`branch` dùng để nhóm cây tổ chức, thường 0 nhân viên gán trực tiếp) KHÔNG tự tạo
phòng — tránh "đẻ phòng rỗng hàng loạt" (đúng lo ngại đã nêu). Hằng số DÙNG CHUNG:
`CHAT_ROOM_ELIGIBLE_ORG_UNIT_TYPES = new Set(['department'])` — 1 nơi, dùng ở CẢ hook (W1/W2, kiểm
`dto.type`/`created.type` trước khi gọi sync) LẪN job Pha 1 SCAN (`WHERE type = ANY(...)`). Ghi nợ (§6): nếu
owner sau này cần phòng cho `division` (vd. phòng cấp miền), mở rộng tập này — KHÔNG scope creep bây giờ.

### 3.9 "Cũng nên vá" — `insertRoom` discriminated union, `syncSource` SUY bên trong

Thay 3 field optional rời rạc (footgun CHECK chéo, §2 #10) bằng discriminated union theo `roomType`, hàm TỰ
SUY `syncSource` (không nhận làm tham số free-form):

```typescript
type InsertRoomValues =
  | { roomType: "direct"; directKey: string; name: null; description: string | null; roomCode: string; createdBy: string }
  | { roomType: "group"; directKey: null; name: string; description: string | null; roomCode: string; createdBy: string }
  | { roomType: "department"; orgUnitId: string; name: string; description: string | null; roomCode: string; createdBy: string | null }
  | { roomType: "project"; refId: string; name: string; description: string | null; roomCode: string; createdBy: string | null };

// bên trong insertRoom: const syncSource = values.roomType === "department" ? "department"
//   : values.roomType === "project" ? "project" : "manual";
```

`createdBy: string | null` cho 2 nhánh dẫn xuất (job gọi không có actor người — cột DB vốn đã nullable, xem
§2 mục 7) — nới ĐÚNG NHÁNH TS cần nới, giữ `direct`/`group` (do người tạo qua API cũ) vẫn `string` bắt buộc,
KHÔNG nới tràn lan. TypeScript tự chặn caller quên field bắt buộc theo `roomType` — an toàn hơn 3 optional
rời rạc của rev 1 (compiler không bắt được tổ hợp sai, phải tự nhớ luật CHECK).

### 3.10 "Cũng nên vá" — `synced_at`, PCR, import, `Optional()`, composite FK (giữ kết luận ĐÚNG)

- `chat_rooms.synced_at`: SET `now()` trong `insertRoom` khi tạo phòng dẫn xuất (department/project) — dùng
  làm "lần đồng bộ gần nhất" ở mức tạo-phòng; KHÔNG update lại mỗi lần Pha 3 diff (tránh write-amplification
  vô ích) — ghi rõ scope này trong code comment, không mở rộng thêm ở v1.
- `ChatDerivedRoomsSyncService`/job handler **KHÔNG inject** `OrgRepository`/`ProjectsRepository`/
  `HrWriteRepository` — Pha 1/Pha 3 của job đọc trực tiếp bảng `orgUnits`/`employeeProfiles` (từ
  `../db/schema` — đã dùng ở `org.repository.ts:4`) và `projects`/`projectMembers` (từ `../db/schema/media`
  — đã dùng ở `projects.repository.ts:6`) bằng drizzle schema objects, KHÔNG qua class Repository của module
  khác ⇒ không cycle ngược `ChatModule → OrgModule/TasksModule/EmployeesModule`.
- `createFromImportTx` (`hr-write.service.ts:276`) luôn `userId: null` (UNLINKED, never-provision) — KHÔNG
  cần hook (giữ kết luận rev 1, xác nhận lại 02/08 qua `hr-employee-import.service.spec.ts:170-175`).
  `ChatSyncService` không inject vào `HrEmployeeImportService`.
- PCR (`profile-change-request.service.ts`) — grep `orgUnitId` = 0 hit (xác nhận lại 02/08) — không ghi
  `orgUnitId`, không cần hook.
- Job handler chỉ nhận `ChatDerivedRoomsSyncService` + `DatabaseService` (2 Nest provider bình thường, KHÔNG
  `Database`/`workerDb` thô) — **KHÔNG cần `@Optional()`** (mirror `RetentionCleanupJobHandler`, §2 #10 rev
  1 giữ nguyên, memory `systemjobhandler-optional-dbw-di`).
- Composite tenant FK cho `org_unit_id`/`ref_id` trên `chat_rooms` đã có sẵn (indexes §2 #8 dùng
  `(company_id, org_unit_id)`/`(company_id, ref_id)`) — KHÔNG cần migration mới cho WO này.

---

## 4. Thi công — phạm vi file

**Mới** (`apps/api/src/chat/`):

- `chat-derived-rooms-predicates.ts` — 2 SQL fragment DUY NHẤT (§3.3).
- `chat-derived-rooms-sync.service.ts` — hàm `...Tx` (leave/join theo department + project), `ChatSyncRevokeError`,
  `recordRevokeFailureAudit`, wrapper public CREATE (`ensureOrgUnitRoom`/`ensureProjectRoom`/`archiveProjectRoom`).
- `chat-derived-rooms-reconcile.job-handler.ts` — `@SystemJobHandler()`, 3 pha (§3.4).

**Sửa** (append/extend):

- `chat-rooms.repository.ts` — `insertRoom` discriminated union (§3.9); `archiveRoom(actorUserId: string |
  null)`, `insertMember(addedBy: string | null)`; thêm `findRoomByOrgUnitId`/`findRoomByRefId` (mirror
  `findRoomByDirectKey`); `insertRoom` SET `syncedAt: new Date()` cho 2 nhánh dẫn xuất.
- `chat.errors.ts` — `CHAT_AUDIT` += 5 action (§3.7), additive, KHÔNG đụng khối BE-2.
- `chat.module.ts` — providers += `ChatDerivedRoomsSyncService`, `ChatDerivedRoomsReconcileJobHandler`;
  exports += `ChatDerivedRoomsSyncService` (KHÔNG export job handler, mirror `SystemJobRunsRetentionJobHandler`).
- `scheduler/scheduler.module.ts` — imports += `ChatModule`.
- `org/org.module.ts` — imports += `ChatModule`.
- `org/org.service.ts` — `createOrgUnit`: nếu `type` thuộc `CHAT_ROOM_ELIGIBLE_ORG_UNIT_TYPES` (§3.8), gọi
  `ensureOrgUnitRoom` SAU KHI `unit` đã return từ try/catch (ngoài tx của chính `createOrgUnit`).
- `org/hr-department.service.ts` — `createDepartment`: gọi `ensureOrgUnitRoom` SAU khi `this.db.withTenant(...)`
  của chính nó resolve (KHÔNG dùng `tx` sẵn có — nhất quán với W1, §3.1 lý do).
- `employees/employees.module.ts` — imports += `ChatModule`.
- `employees/employees.repository.ts` — tách `softDeleteEmployeeTx` (§3.5), additive.
- `employees/employees.service.ts` — `createEmployee` (W8b, GRANT+SAVEPOINT), `updateEmployee` (W9b,
  REVOKE+GRANT, §3.6), `deleteEmployee` (W14, refactor tx + REVOKE).
- `employees/hr-write.service.ts` — `createEmployee`/`updateEmployee`/`linkUser`/`unlinkUser`/`changeStatus`
  (W8a/W9a/W10/W11/W12).
- `recycle-bin/recycle-bin.module.ts` — imports += `ChatModule`.
- `recycle-bin/recycle-bin.repository.ts` — `restoreEmployeeTx` `.returning()` += `orgUnitId`, `userId`,
  `status` (additive, không đổi hành vi UPDATE).
- `recycle-bin/recycle-bin.service.ts` — `restoreEmployee` (W13, GRANT+SAVEPOINT).
- `tasks/tasks.module.ts` — imports += `ChatModule`.
- `tasks/projects.service.ts` — `createProject`/`closeProject`/`deleteProject`/`addMember`/`removeMember`
  (W3-W7).

**Test** — `apps/api/test/integration/chat-be5-derived-rooms.int-spec.ts` (mới), mẫu `chat-be1-*.int-spec.ts`.

**KHÔNG sửa**: `packages/contracts/src/chat.ts`, `config/openapi-modules.ts` (không route mới, §2 rev 1 #19
giữ nguyên), `chat-message*.ts` (phạm vi BE-2, không liên quan tin nhắn).

---

## 5. KHÔNG làm trong WO này

- ❌ `OrgService.updateOrgUnit`/`deleteOrgUnit`, `HrDepartmentService.updateDepartment`/`deleteDepartment` —
  rename/deactivate/xoá org_unit không đồng bộ lại phòng. Nợ §6.
- ❌ `ProjectsService.updateProject` đổi tên — tên phòng KHÔNG đổi theo (snapshot lúc tạo). Nợ §6.
- ❌ `ProjectsService.updateMemberRole` — phòng dẫn xuất không có admin.
- ❌ Tái kích hoạt nhân viên (`inactive→active`) — KHÔNG có hook real-time (GRANT, dựa job ~15 phút/lần).
  Nợ §6.
- ❌ Phòng cho `org_units.type` ngoài `department` (§3.8) — nợ §6, mở rộng khi owner cần.
- ❌ Tin nhắn/tệp/tìm kiếm (BE-2/3/4). Đọc-vượt Super Admin (BE-7). WebSocket push (RT-0/RT-1). NOTI
  "vừa được thêm vào phòng" (BE-6).
- ❌ Cặp quyền mới, route mới, `PermissionGuard` mới — WO này không có controller.
- ❌ `room_type='channel'`, migration schema.

---

## 6. Test RED-trước

⚠️ Chủ thể KHÔNG phải Super Admin. `LANE_DB` (`bash scripts/lane-db-setup.sh chatbe5` →
`export LANE_DB=mediaos_chatbe5` → `bash harness/check.sh --lane-db`).

**Ba ca BẮT BUỘC theo yêu cầu chung (a)(b)(c):**

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| a | Nghỉ việc (`changeStatus`→`resigned`, employee đang member 1 dept + 2 project) → chạy job Pha 3 ngay sau | Job KHÔNG join lại — người này vẫn KHÔNG phải member của bất kỳ phòng nào (đã rời NGAY lúc `changeStatus` qua W12, job chỉ xác nhận 0 thay đổi) |
| b | `PATCH /employees/:id` đổi `orgUnitId` A→B (W9b, employee có `userId`) | TRONG CÙNG response: rời phòng A (`left_at` set) + vào phòng B (member mới/tái dùng); `ChatAccessService.assertMember` phòng A cho user này → 404 NGAY (không chờ job) |
| c | Khôi phục hồ sơ từ thùng rác (`RecycleBinService.restoreEmployee`, hồ sơ có `orgUnitId`+`userId`, `status='active'`) | User vào lại ĐÚNG phòng department NGAY trong response khôi phục (không chờ job) |

**Còn lại (đánh số tiếp, renumber từ rev 1 + bổ sung):**

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| 1 | Tạo org_unit `type='department'` qua `POST /org/units` | 1 phòng `department`, `syncSource='department'`, `roomCode` hợp lệ, `syncedAt` NOT NULL |
| 2 | Tạo org_unit `type='division'` | KHÔNG tạo phòng nào (§3.8) |
| 3 | Tạo org_unit qua `POST /hr/departments` (W2, writer khác cùng bảng) | Cũng tạo đúng 1 phòng — cả W1 và W2 đều hook |
| 4 | Gọi `ensureOrgUnitRoomTx` 2 lần liên tiếp cùng `orgUnitId` | Vẫn đúng 1 phòng, không `23505` văng ra ngoài |
| 5 | Tạo project (đã có owner mapping) | 1 phòng `project`; **owner đọc được phòng NGAY** (đóng H1) — `ChatAccessService.assertMember` thành công không cần job |
| 6 | Nhân viên KHÔNG có `userId` đổi `orgUnitId` (W9a hoặc W9b) | Không hàng `chat_room_members` nào bị đụng — no-op im lặng |
| 7 | `linkUser` (W10) gán tài khoản cho NV đã có `orgUnitId` | User join đúng phòng department, SAVEPOINT không ảnh hưởng phần còn lại của `linkUser` |
| 8 | `unlinkUser` (W11) | User rời phòng department NGAY, LOUD nếu lỗi (ca 15) |
| 9 | `changeStatus`→`inactive` (W12), NV đang member 1 dept + 2 project | Cả 3 hàng `left_at` set trong CÙNG 1 lần gọi |
| 10 | `addMember`/`removeMember` project (W6/W7) | Join/leave đúng phòng, không đụng phòng khác |
| 11 | `closeProject`/`deleteProject` (W4/W5) | Phòng `isArchived=true`, `chat_messages` không bị đụng |
| 12 | Company có sẵn org_unit(`department`) + project TRƯỚC khi job chạy lần đầu; đo thời gian chạy | Job Pha 1-3 tạo đủ phòng + member, roomCode hợp lệ không trùng, **tổng thời gian < TTL lock 10 phút** (đo thực, không giả định) |
| 13 | Gieo lệch thủ công: 1 hàng `chat_room_members` thừa (user không thuộc org_unit) + 1 hàng thiếu (set `left_at` cho hàng lẽ ra active) | Job: thừa bị leave, thiếu được join, log WARN đúng số lệch |
| 14 | Chạy job LẦN 2 ngay sau ca 13 | 0 thay đổi, log DEBUG — idempotent |
| 15 | `unlinkUser`/`changeStatus`/`removeMember` (bất kỳ 1 REVOKE writer) — mock `chatSync.leave*Tx` throw lỗi giả lập | Method nghiệp vụ REJECT (500), `employee_profiles`/`project_members` KHÔNG đổi (rollback toàn bộ, window=0), audit `MEMBER_SYNC_FAILED` `resultStatus='Failure'` được ghi ở tx RIÊNG, log chứa `ERROR` (không phải `WARN`) |
| 16 | Cross-tenant: company A tạo org_unit/project, company B chạy job | Company B không có phòng/thành viên mới nào bị chạm |
| 17 | Grep sau khi code (checklist, KHÔNG phải RED-trước): đúng MỘT nơi gọi `insertRoom` với `roomType` `department`/`project` (trong `chat-derived-rooms-sync.service.ts`) | Không route/service khác tự viết INSERT phòng dẫn xuất thứ hai |
| 18 | H2: seed 1 hàng `project_members` với `member_status IS NULL, deleted_at IS NULL` (data cũ trước 0478) đang có `chat_room_members` active tương ứng | Job leave hàng này khỏi phòng (đúng theo predicate `='Active'` tường minh — xem §3.3 lý do đây là ĐÚNG hành vi, không phải oan) |
| 19 | W9a/W9b: đổi `orgUnitId` sang phòng ĐÍCH CHƯA TỒN TẠI (org_unit mới tạo, job chưa chạy) | Rời phòng cũ vẫn thành công (LOUD path không kích hoạt vì không lỗi thật), join mới NO-OP êm (log DEBUG), `updateEmployee` vẫn trả 200 — chứng minh SAVEPOINT không lây lỗi "phòng chưa có" thành lỗi cứng |
| 20 | `EmployeesService.deleteEmployee` (W14) — NV đang member 1 dept + 1 project | Rời MỌI phòng dẫn xuất, response 204 như cũ (không đổi hợp đồng API) |

---

## 7. Nợ/rủi ro chuyển WO sau

1. Rename/deactivate/xoá org_unit hoặc project không đồng bộ ngược lại phòng (tên đứng yên, không tự
   archive) — SPEC §13.3 chỉ liệt kê CREATE, không liệt kê update/delete; cờ cho owner nếu cần WO riêng.
2. Tái kích hoạt nhân viên (`inactive→active`) không có hook real-time — dựa job (~15 phút/lần thực tế PROD,
   §2 #1). Nếu owner cần tức thời, cần WO bổ sung hook `changeStatus` nhánh `→active` (GRANT, chấp nhận được
   theo owner điểm 3 nhưng CHƯA làm ở đây).
3. `TERMINAL_STATUSES` "Cancelled"/"Archived" chưa từng được ghi bởi writer nào — logic archive-on-terminal
   viết TỔNG QUÁT nhưng không test được bằng writer thật hôm nay (giữ nguyên nợ rev 1).
4. Chỉ `org_units.type='department'` có phòng (§3.8) — mở rộng cho `division`/`unit`/`office`/`branch` là
   quyết định sản phẩm, KHÔNG tự ý mở rộng ở đây.
5. Hai writer tạo org_unit (W1/W2) — nếu có writer THỨ BA tương lai (import hàng loạt phòng ban), phải nhớ
   hook thêm; không có ràng buộc DB nào tự ép "mọi org_unit phải có phòng" ngoài job đối soát.
6. `chat_rooms.synced_at` chỉ set lúc TẠO phòng, không cập nhật mỗi lần Pha 3 diff thành viên — nếu sau này
   cần "lần đồng bộ MEMBER gần nhất" (khác với "lúc tạo phòng"), cần thêm cột hoặc đổi ý nghĩa cột này.
7. Diễn giải SPEC-15 §13.3 câu chữ gốc ("cùng transaction khi rẻ, nếu không thì outbox") ĐÃ ĐƯỢC OWNER SỬA
   TRỰC TIẾP TRONG SPEC (§13.3, khối "Làm rõ 02/08/2026") — rev 2 không còn cờ mục này là "diễn giải cần xác
   nhận" như rev 1, vì owner đã chốt bằng văn bản.
8. Chưa có NOTI "bạn vừa được thêm vào phòng ban/dự án" — BE-6 (outbox riêng), ngoài phạm vi.
9. `recordRevokeFailureAudit` (§3.2a) là ĐƯỜNG GHI THỨ HAI ngoài audit atomic-trong-tx chuẩn của hệ (khác
   với mọi service khác trong repo, nơi audit LUÔN cùng tx với hành động) — chấp nhận vì đây là audit của
   MỘT THẤT BẠI (hành động chính đã rollback, không có gì để atomic CÙNG với), nhưng cần review kỹ ở FULL
   gate để xác nhận đây không mở lại lỗ "audit ngoài tx nghiệp vụ" mà `ChatAccessService`/toàn hệ đang tránh.

---

## 8. Definition of Done

- [ ] 14 writer (§3.1, W1-W14, cả 2 họ + recycle-bin) đều gọi đúng hàm sync — REVOKE trong tx không
      SAVEPOINT (LOUD, rollback toàn bộ khi lỗi), GRANT trong tx CÓ SAVEPOINT hoặc ngoài tx (best-effort)
- [ ] `insertRoom` discriminated union theo `roomType`, `syncSource` suy nội bộ — không nhận free-form
- [ ] Vị từ desired-set DUY NHẤT (`chat-derived-rooms-predicates.ts`) dùng bởi CẢ hook lẫn job Pha 1/Pha 3
- [ ] Job 3 pha: Pha 1 SCAN đóng trước allocate mã · Pha 2 ngoài tx tạo phòng (seed member TRONG tx của
      chính nó) · Pha 3 set-based, tái kiểm predicate NGAY TRONG WHERE (không dùng danh sách Pha 1 để ghi)
- [ ] Job handler constructor chỉ Nest provider thật — verify bằng 1 int-spec dựng AppModule
- [ ] `SchedulerModule`/`org.module.ts`/`employees.module.ts`/`tasks.module.ts`/`recycle-bin.module.ts` wiring
      đúng, KHÔNG cycle, boot AppModule xanh
- [ ] Audit: 5 action, `MEMBER_SYNC_FAILED` ghi ở tx RIÊNG (không lồng `withTenant`), `resultStatus='Failure'`
- [ ] REVOKE lỗi ⇒ TOÀN BỘ business write rollback (window=0) — ca 15 chứng minh bằng dữ liệu KHÔNG đổi
- [ ] GRANT lỗi (phòng đích chưa tồn tại) ⇒ KHÔNG chặn business write — ca 19
- [ ] Job idempotent (ca 14), không N+1 (Pha 1/Pha 3 set-based), cross-tenant cô lập (ca 16)
- [ ] `org_units.type` chỉ `department` có phòng (ca 2)
- [ ] H1 đóng: creator/owner đọc được phòng project NGAY (ca 5), người khôi phục thùng rác vào lại phòng
      NGAY (ca c)
- [ ] Không route/DTO/openapi-modules mới
- [ ] 20+3 ca RED-trước xanh trên `LANE_DB`, có bằng chứng RED trước GREEN
- [ ] `harness/check.sh --lane-db=chatbe5` XANH — không phải xanh-do-skip
- [ ] FULL gate (security-reviewer + database-reviewer + silent-failure-hunter) PASS — đặc biệt xác nhận
      §7 nợ #9 (kênh audit-Failure ngoài-tx) KHÔNG mở lỗ mới
- [ ] lane DB `mediaos_chatbe5` drop sau khi xong
