# Micro-plan — `S12-RECRUIT-BE-1` (🔴 red · crown · FULL gate · code-only, KHÔNG migration)

> **WO:** Module NestJS `recruit/`: vị trí tuyển + ứng viên (mask PII server) + pipeline FSM 6 stage + phỏng vấn/feedback own-scope + offer (mask lương theo `('manage','offer')`) + convert→employee tái dùng HR SequenceService. Guard per-pair §9f ở HAI tầng, audit log, outbox NOTI, `@Idempotent`, `:id`=UUID ở biên, `API_MODULE_TAGS` + route-census regen.
> **Nguồn sự thật:** [SPEC-12 RECRUIT](<../SPEC/SPEC-12 RECRUIT.md>) §11 (permission) · §12 (mã lỗi) · §13 (FSM/convert/scope) · §15 (API) · §17 (NOTI) · §18 (audit/masking) · §22 (REC-DEC) · [API-17 RECRUIT API Design](<../API Design/API-17_RECRUIT_API_Design.md>) · [DB-14 RECRUIT Database Design](<../DB/DB-14 RECRUIT Database Design.md>) · [permission-matrix §9f](<../permission-matrix-spec.md>) · [S12-RECRUIT-DB-1 (đã merge nhánh)](S12-RECRUIT-DB-1.md).
> **Nhánh:** `wo/s12-recruit-be-1` branch từ **`master` SAU KHI PR #448 (DB-1) đã merge** — KHÔNG stacked trên `feat/s12-recruit-db-1` nữa (tránh conflict/rebase-rối khi #448 đổi trong lúc BE-1 chạy). Nếu #448 CHƯA merge lúc bắt đầu BE-1 → chờ hoặc xin owner merge trước, không branch tạm trên nhánh DB-1. Vùng 🔴 ⇒ **người chốt merge**, KHÔNG nhãn auto-merge, **CẤM merge BE-1 trước khi CI xanh** (kể cả khi người chốt đã đọc code — `check.sh --all` phải PASS, không có ngoại lệ "xanh bằng mắt"). FULL gate: `security-reviewer` + `database-reviewer` + `silent-failure-hunter`.
> **Lane DB:** dựng lane MỚI `mediaos_recruitbe1` từ chain hiện tại (0000→0561) → `export LANE_DB=mediaos_recruitbe1` (memory `fresh-lane-db-exposes-teardown-ri-race` — KHÔNG tái dùng lane của DB-1).

---

## 0. Hiện trạng ĐO THẬT (31/08/2026)

| Thứ | Giá trị đo được | Nguồn |
| --- | --- | --- |
| Head migration | idx 228 · `0561_s12recruitdb1_noti_recruit.sql` — **WO này KHÔNG migration mới** | `apps/api/migrations/meta/_journal.json` |
| 8 bảng RECRUIT | `job_openings` · `candidates` · `candidate_stage_events` (append-only) · `candidate_notes` · `interviews` · `interview_participants` (chỉ-INSERT) · `interview_feedbacks` (UPDATE cấp cột) · `offers` (UPDATE cấp cột) — RLS+FORCE, composite tenant FK, đã seed | `apps/api/src/db/schema/recruit.ts`, migration 0559 |
| Chốt cuối DB đã có | `uq_candidates_company_employee` (partial `employee_id IS NOT NULL`, **KHÔNG** theo `deleted_at`) · `uq_offers_candidate_open` (partial `status IN ('Draft','Sent')`) · `uq_interview_feedbacks` (company,interview,interviewer) · `uq_interview_participants` | `recruit.ts:133-135,295,334,381-383` |
| CHECK tên chính xác | `chk_job_openings_status/_headcount` · `chk_candidates_stage` · `chk_cse_from/_to/_moved/_action` · `chk_interviews_status/_range/_round` · `chk_feedback_rating/_reco` · `chk_offers_status/_salary/_responded_pair` | `recruit.ts` |
| GRANT cấp-cột ĐO THẬT (mig 0559, không giả định) | `job_openings`: `GRANT SELECT,INSERT,UPDATE` **cấp BẢNG** (app tự loại field readonly khi PATCH) · `candidates`: `GRANT SELECT,INSERT,UPDATE` **cấp BẢNG** — CỐ Ý (H6 DB-1): `stage`/`employee_id` PHẢI ghi được ở DB vì move-stage/convert là UPDATE thường, ranh giới "không đổi qua PATCH 012" là do Zod `.strict()` + service, KHÔNG phải DB grant · `candidate_notes`: `GRANT SELECT,INSERT,UPDATE` cấp bảng, `deleted_at`/`deleted_by` CÓ tồn tại + CÓ grant (soft-delete qua UPDATE, không route DELETE) · `interviews`: `GRANT SELECT,INSERT,UPDATE` cấp bảng · `candidate_stage_events`/`interview_participants`: CHỈ `SELECT,INSERT` (append-only/chỉ-INSERT tuyệt đối, xác nhận lại) · `interview_feedbacks`: `UPDATE (rating, comment, recommendation, updated_at)` — cấp CỘT, đúng 4 cột · `offers`: `UPDATE (title, start_date, salary, note, status, responded_at, updated_at, updated_by)` — cấp CỘT, đúng 8 cột, **`salary`/`status`/`responded_at` ĐỀU ghi được** (không cần migration bổ sung — mọi field DTO PATCH/change-status của WO này đã có grant sẵn, đo xong ngày viết plan, KHÔNG hoãn) | `apps/api/migrations/0559_s12recruitdb1_recruit_ddl.sql:140-501` |
| 16 cặp quyền + role `recruiter` | id `…0014`, `is_system=true`, `requires_two_factor=false`, `company_id NULL`, KHÔNG canonical; **42 grant** đã seed; **7 cặp `candidate` `is_sensitive=true`** (offer/interview/job-opening pairs: `is_sensitive=false`, kể cả `manage:offer` — masking lương là tầng THỨ HAI tách khỏi cặp quyền, REC-DEC-004, permission-matrix §9f ghi chú). **15/16 cặp gate ÍT NHẤT 1 route** (§2); `('access','recruit')` là cặp NAV DUY NHẤT — KHÔNG route RECRUIT nào gate bằng nó, chỉ dùng cho menu/app-card FE (test deny-403 §9.1 chỉ chạy trên 15 cặp có route, `access:recruit` verify riêng qua `/auth/me` capabilities nếu cần, KHÔNG đếm chung vào ma trận 403-per-route) | mig 0560, permission-matrix §9f |
| `MODULE_APP_METADATA` (nav app-card) | Registry hiện tại (`module-app-metadata.ts`) CHỈ có 7 module MVP + `ME` — **ASSET/ROOM/GOAL BE-1 KHÔNG thêm entry** (đo 31/08/2026, registry rỗng cho 3 module đó). RECRUIT BE-1 theo ĐÚNG tiền lệ: **KHÔNG đụng file này** — quyết định nav-card (nếu cần) hoãn tới lúc FE-1 (hoặc registry được mở rộng chung cho mọi module Phase 2 ở một WO riêng, không phải BE-1 nào tự quyết) | `apps/api/src/foundation/module-catalog/module-app-metadata.ts` |
| Data scope theo §13.6 | Vị trí/ứng viên/offer: **CHỈ Company** (không Own/Department nào ở đường đọc lẫn ghi) · Lượt phỏng vấn: **Own** (participant) hoặc **Company** · Feedback: **Own cho MỌI role** (kiểm participant ở service) | SPEC-12 §13.6, §11 |
| 4 event NOTI đã seed | `RECRUIT_JOB_ASSIGNED` (016,Normal) · `RECRUIT_INTERVIEW_SCHEDULED` (017,High) · `RECRUIT_STAGE_CHANGED` (018,Normal) · `RECRUIT_CANDIDATE_HIRED` (019,Normal) — `dedupe_strategy='DedupeKey'` cả 4, `is_system_event=false` cả 4 (**KHÔNG job hệ thống nào** — mọi event là event-driven, không cần `@SystemJobHandler`) | mig 0561, SPEC-12 §17 |
| `AUDIT_OBJECT_TYPES` | Đã UNION-ADD `job_opening`/`candidate`/`interview`/`offer` ở mig 0560 | `schema/audit.ts` |
| `packages/contracts/src/recruit.ts` | Đã có (DB-1): 4 enum trạng thái (`JobOpeningStatus`/`CandidateStage`/`InterviewStatus`/`OfferStatus`) + hằng — **WO này MỞ RỘNG cùng file**, KHÔNG file mới | DB-1 §1, `packages/contracts/src/recruit.ts` |
| Route census hiện tại | **507 route / 92 controller / gated 468 / public 12 / ungated 27 / needVerdict 39**. 32 route RECRUIT mới, MỌI route gated ⇒ kỳ vọng sau regen **539 route / 97 controller / gated 500**, `ungated`/`needVerdict` KHÔNG đổi | `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` |
| Ratchet `:id` UUID | `UNPIPED_CEILING = 1` — KHÔNG được tăng; mọi `:id`/`:noteId`/`:itemId` PHẢI `ParseUUIDPipe` | `test/foundation/param-uuid-ratchet.unit-spec.ts:67` |
| `identity-projection` BASIS_CEILINGS hiện tại | `scoped-predicate: 23` · `self-bound-row: 4` · `identity-gated: 15` (mốc mới nhất = ROOM, "điểm chiếu DUY NHẤT của module") · các basis khác không đổi | `test/foundation/identity-projection-verdicts.ts:621-640` |
| `SENSITIVE_CAPABILITY_ALLOWLIST` / `SENSITIVE_SCREEN_GATE_PAIRS` | Mảng `"action:resourceType"` trong `permission.service.ts` (APPEND-only) — RECRUIT cần thêm **7 dòng** (7 cặp `candidate` sensitive) | `apps/api/src/permission/permission.service.ts:47,212` |
| `HrWriteService` | `createEmployee()` **KHÔNG dùng được cho convert** — tự mint user khi có `email`, đòi `create:employee`+`create:user`, tự mở `withTenant` RIÊNG. Đã export khỏi `EmployeesModule` (`exports: […, HrWriteService]`) ⇒ RecruitModule import `EmployeesModule` inject thẳng được | `apps/api/src/employees/hr-write.service.ts:170-294`, `employees.module.ts:156-162` |
| `SequenceService` | `nextCode(companyId, input)` **LUÔN tự mở `db.withTenant` RIÊNG** (không có tham số `tx`) — KHÔNG có biến thể tx-aware cho tăng giá trị. `ensureCounterTx(tx, companyId, key, defaults)` NHẬN `tx` của caller (chỉ để provision-nếu-thiếu, không tăng giá trị). **KHÔNG sửa file này** — convert dùng lại nguyên `HrWriteService.allocateEmployeeCode` (đổi `private`→`public`) NGOÀI tx nghiệp vụ, xem §1.1/§6.1 (quyết định đã chốt, không còn phương án mở) | `apps/api/src/foundation/sequences/sequence.service.ts:128-162,204-211` |
| File resolver pattern | `FileOwnerPermissionResolver` (`moduleCode`, `entityTypes?`, `canViewFile/canDownloadFile/canLinkFile/canDeleteFile/canUnlinkFile` → `Promise<boolean>`), đăng ký additive vào `FilePolicyService` (singleton, từ `FilesModule`) ở `onModuleInit` của module sở hữu. Khuôn: `HrContractFileResolver`/`EmployeeFileResolver` | `apps/api/src/employees/hr-contract-file.resolver.ts`, `employee-file.resolver.ts` |
| Identity-projection điểm chiếu DUY NHẤT | Khuôn `RoomPeopleRepository` (`apps/api/src/rooms/room-people.repository.ts`) — MỘT repo, MỘT phương thức `namesByUserIdsTx`, mọi nơi cần tên người (organizer/attendee/picker/NOTI payload) gọi lại nó; SPEC-12 §18 đòi y hệt cho RECRUIT (`RecruitPeopleRepository`) | `rooms/room-people.repository.ts` |
| `API_MODULE_TAGS` | Chưa có mục `RECRUIT`. Mẫu entry: `{code, tagPrefix, description, segments}` | `apps/api/src/config/openapi-modules.ts:38-115` |
| `app.module.ts` | Khối import cuối hiện tại (sau ASSET/ROOM/OFFICE-DASH) — additive: `RecruitModule` NGAY SAU | `app.module.ts` |
| `DataScopeService` | `resolveAndAssert(userId, companyId, action, resourceType, opts?)` → `DataScope`, ném 403 khi không có grant · `resolveOrNull(...)` không ném · `resolveContext(userId, companyId)` → `ScopeContext` · `buildEmployeeScopeCondition`/`isEmployeeInScope` là cho scope **HR** (org_unit/manager) — **KHÔNG dùng được cho own-scope interview** (own-scope interview = participant, KHÔNG theo cơ cấu tổ chức) — RECRUIT tự dựng `EXISTS interview_participants` | `apps/api/src/permission/data-scope.service.ts:53-133` |
| `pgErrorOf`/`isUniqueViolation` | `apps/api/src/common/db-error.ts` — `pgErrorCode(err)`, `pgErrorField(err,'constraint')`, `isUniqueViolation(err)`. Bóc tối đa 5 tầng `.cause` (drizzle bọc lỗi PG) | `common/db-error.ts` |
| `@Idempotent()` | Decorator method-level không tham số, interceptor toàn cục. TTL 900s. Header không bắt buộc (back-compat) | `common/idempotency/idempotency.decorator.ts` |
| `rls-registry.ts` (DB-1 đã làm) | 8 bảng RECRUIT đã đăng ký `seedRow` chain FK hợp lệ — WO này KHÔNG cần sửa | `test/integration/rls-registry.ts:2720-2794` |

---

## 1. Scope fence — việc KHÔNG làm ở WO này

- ❌ **KHÔNG migration mới, KHÔNG `db:generate`.** Thiếu cột/constraint so với code cần → sửa CODE, không sửa DB.
- ❌ **KHÔNG bật `modules.RECRUIT.is_active`** — việc của `S12-RECRUIT-FE-1`.
- ❌ **KHÔNG custom stage per-company** (REC-DEC-002 — 6 stage là hằng).
- ❌ **KHÔNG workflow duyệt offer** (REC-DEC-004).
- ❌ **KHÔNG tự tạo tài khoản đăng nhập** ở convert (REC-DEC-005) — `createEmployeeFromCandidateTx` KHÔNG có nhánh provision user.
- ❌ **KHÔNG endpoint xoá** ứng viên/vị trí (§5.2 — v1 chỉ soft-delete cột có sẵn, không route DELETE).
- ❌ **KHÔNG tích hợp calendar ngoài / booking ROOM** cho phỏng vấn (REC-DEC-006).
- ❌ **KHÔNG route upload/tải CV riêng** — đi qua Foundation Files API-09; RECRUIT chỉ đăng ký resolver quyền.
- ❌ **KHÔNG sửa `packages/web-core/src/lib/registry.ts`** (`PERMISSION_CODE_TO_PAIR`) — việc của FE-1.
- ❌ **KHÔNG hạ/tăng** `param-uuid` ratchet; mọi route RECRUIT có `@RequirePermission` (không thêm `route-verdicts.ts`).
- ❌ **KHÔNG sửa `apps/api/src/foundation/sequences/**`** — QUYẾT ĐỊNH CHỐT (không còn là lựa chọn mở, xem §1.1): cấp `employee_code` tái dùng NGUYÊN `HrWriteService.allocateEmployeeCode` hiện có, KHÔNG đụng `SequenceService`.

### 1.1 Quyết định đã chốt sau vòng plan-review (KHÔNG còn là điểm mở) + việc phải làm TRƯỚC khi code

**Vòng review trước đề xuất 2 phương án cho cấp `employee_code` trong convert (nested-tx HOẶC sửa `SequenceService`) — CẢ HAI ĐÃ BỊ BÁC.** Lý do bác: gọi `sequence.nextCode()` (tự mở `db.withTenant` riêng) TỪ BÊN TRONG tx convert đang giữ `SELECT...FOR UPDATE` = giữ 2 connection/lock đồng thời dưới PgBouncer transaction-mode ⇒ nguy cơ cạn pool/deadlock ở PROD dưới tải (bài học `S5-SEQ-HARDEN-1`, đã ghi rõ trong `apps/api/src/tasks/task-code.util.ts:78-81`) — KHÔNG phải rủi ro "đã chấp nhận ở nơi khác", đây là lớp lỗi ĐÃ TỪNG bị vá tường minh, không nên tái phạm. Sửa `SequenceService` cũng bị loại vì rủi ro lan sang mọi caller khác (HR/ASSET/GOAL) ngoài phạm vi WO.

**Quyết định CHỐT — mirror khuôn `GoalDecomposeService` (3 pha, `goal-decompose.service.ts:71-76`) và `allocateTaskCodeOutsideTx` (`tasks/task-code.util.ts`):**

1. **Đổi tầm nhìn `HrWriteService.allocateEmployeeCode`** từ `private` sang `public` (CHỈ đổi visibility, KHÔNG đổi thân hàm — hàm này đã tự đúng: `nextCode()` tự mở tx riêng ĐÃ COMMIT trước khi ensure-on-miss chạy ở tx riêng THỨ HAI cũng đã commit, rồi mới retry — không có vấn đề "ensure trong tx chưa commit" vì hàm này BẢN THÂN nó chưa từng chạy trong ngữ cảnh có tx cha đang mở). `RecruitConvertService` gọi thẳng `this.hrWrite.allocateEmployeeCode(companyId)` — KHÔNG viết lại logic ensure-on-miss, KHÔNG copy sang `recruit/`.
2. **Convert chia 3 PHA** (thay cho "MỘT transaction duy nhất mở luôn từ đầu" — vẫn đúng tinh thần REC-DEC-005 "atomic", chỉ tách bước CẤP MÃ ra khỏi tx khoá hàng, xem §6.1 viết lại):
   - Pha 1 (ĐỌC, tx nhẹ hoặc query trực tiếp): tải `candidates` + `offers` liên quan, kiểm SƠ BỘ 3 tiền điều kiện N1 để fail-fast KHÔNG tốn mã nếu request rõ ràng sai (chưa lock hàng).
   - Pha 2 (NGOÀI mọi tx nghiệp vụ): `employeeCode = await this.hrWrite.allocateEmployeeCode(companyId)`. Rollback ở Pha 3 ⇒ mã "đốt" (gap OK — SPEC-12 §13.5 bước 4 đã chấp nhận, đúng khuôn `allocateTaskCodeOutsideTx`).
   - Pha 3 (business tx `withTenant`): `SELECT...FOR UPDATE` khoá hàng `candidates` → **KIỂM LẠI TOÀN BỘ 3 tiền điều kiện N1 fail-closed** (trạng thái có thể đổi giữa Pha 1 và Pha 3) → gọi `createEmployeeFromCandidateTx(tx, actor, {...input, employeeCode})` (KHÔNG còn đụng `SequenceService` trong hàm này nữa — xem §6.2) → update `employee_id` (chốt cuối UNIQUE) → move stage → audit + outbox.
3. **Lỗi cấu hình mã (`SequenceNotFoundError`/`SequenceInactiveError`) đã có map sẵn TRONG `allocateEmployeeCode`** (`toCodeAllocationError` → `UnprocessableEntityException` 422 `HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID`, `hr-write.service.ts:753-760`) — tái dùng nguyên hàm ⇒ **KHÔNG cần viết map lỗi mới**, KHÔNG rơi vào `AllExceptionsFilter`/500. RECRUIT convert KHÔNG bắt lại lỗi này thành mã `RECRUIT-ERR-*` — để nguyên 422 HR lan ra (đây là lỗi hạ tầng cấu hình mã NV, không phải luật nghiệp vụ RECRUIT).
4. **`harness/backlog.mjs` `paths` của WO — sửa TRƯỚC khi code** (bước 0 của §10): thêm `apps/api/src/notifications/**` (registrar NOTI) · `apps/api/src/employees/**` (đổi visibility `allocateEmployeeCode` + thêm `createEmployeeFromCandidateTx`) · `apps/api/src/permission/**` (7 dòng `SENSITIVE_SCREEN_GATE_PAIRS`) · `docs/API Design/API-17*` (đóng dấu §5.2 khi xong) · `docs/erd-current.md` (cập nhật trạng thái đã-build BE). **KHÔNG thêm** `apps/api/src/events/**` (AuditService/OutboxService đã inject sẵn qua module `@Global`, không cần sửa file trong `events/**` — dedupeKey không còn dựa `auditLogId`, xem §8) và **KHÔNG cần** `apps/api/src/foundation/sequences/**` (quyết định #1 ở trên loại bỏ hẳn nhu cầu này).
5. **Rollback nếu WO cần revert:** WO này KHÔNG bật `modules.RECRUIT.is_active` (vẫn `inactive` từ mig 0435/0559) và KHÔNG có migration mới ⇒ đường lùi đơn giản là **revert PR** (không cần migration down, không ảnh hưởng module khác vì `RecruitModule` additive trong `app.module.ts`).

**Basis identity-projection cho `RecruitPeopleRepository` — ĐÃ SỬA (không còn `cond=true` giả), xem thiết kế thật ở §5.** Vẫn giữ MỘT điểm chiếu (`namesByUserIdsTx`), basis `"identity-gated"`, nâng `BASIS_CEILINGS['identity-gated']` 15 → 16.

---

## 2. Bảng endpoint (32 mã · 32 route HTTP, KHÔNG mã nào gộp 2 route)

Ký hiệu: **W** = write, chỉ Company (không role nào có cặp ghi RECRUIT ở scope hẹp hơn — §13.6) · **R@Company** = đọc, mọi grant đều Company · **R(Own/Company)** = đọc theo 2 tầng (chỉ `interview`). Idem = `@Idempotent()`.

**Query DTO cũng qua `ZodValidationPipe` — KHÔNG chỉ body.** Mọi route `GET` có tham số query (list/export/picker) khai `@Query(new ZodValidationPipe(querySchema)) query: ListXQueryDto` ở tham số (pipe áp CHO THAM SỐ, không phải `@UsePipes` cấp method — 2 cơ chế khác nhau, `body-validation-census.ts` chỉ đếm `@Body`; query không nằm trong census đó nhưng VẪN phải validate thật để tránh 500 khi `limit`/`status[]`/ngày sai định dạng). `querySchema` dùng `z.coerce.number()`/`z.preprocess` cho số/mảng CSV (memory `zod-query-param-double-pipe-idempotent` — KHÔNG `z.coerce.boolean()` trần cho cờ dạng chuỗi).

### 2.1 `JobOpeningsController` (`@Controller("job-openings")`) — 001–005

| Mã | Method · Path | Cặp quyền | Scope | DTO | Mã lỗi | Audit | Outbox |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 001 | `GET /job-openings` | `('view','job-opening')` | R@Company | `ListJobOpeningsQueryDto` (`status[]?`, `orgUnitId?`, `recruiterUserId?`, `q?`, phân trang) | 400 | — | — |
| 002 | `POST /job-openings` | `('create','job-opening')` | W | `CreateJobOpeningDto` | 400; 404 orgUnit/position ngoài tenant | ✅ `job_opening` | — |
| 003 | `GET /job-openings/:id` | `('view','job-opening')` | R@Company | — | 404 `010` | — | — |
| 004 | `PATCH /job-openings/:id` | `('update','job-opening')` | W | `UpdateJobOpeningDto` `.strict()` (**KHÔNG** `status` — đổi trạng thái đi qua 005) — gán/đổi `recruiterUserId` ⇒ NOTI-016 | 400 field lạ; 404 `010`; 404 `009` recruiter không phải user sống trong company | ✅ | `RECRUIT_JOB_ASSIGNED` (khi `recruiterUserId` đổi, trừ actor tự gán mình) |
| 005 | `POST /job-openings/:id/change-status` | `('update','job-opening')` | W | `ChangeJobOpeningStatusDto {toStatus, reason?}` | 409 `002` (FSM §13.2); 404 `010` | ✅ | — |

### 2.2 `CandidatesController` (`@Controller("candidates")`) — 006–017, 029

**Thứ tự khai báo BẮT BUỘC:** `check-duplicate` (008) · `summary` (009) · `export` (010) PHẢI đứng TRƯỚC `GET /candidates/:id` (011) — Nest nuốt segment tĩnh thành `:id` nếu khai sau (bài học `goals/tree`).

| Mã | Method · Path | Cặp quyền | Scope | DTO | Mã lỗi | Audit | Outbox | Idem |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 006 | `GET /candidates` | `('view','candidate')` | R@Company | `ListCandidatesQueryDto` (`jobOpeningId?`, `stage[]?`, `source?`, `q?`) | 400 | — | — | — |
| 007 | `POST /candidates` | `('create','candidate')` | W | `CreateCandidateDto {jobOpeningId, fullName, email?, phone?, source?, note?}` | 400; 409 `005` job Closed | ✅ `candidate` | — | ✅ |
| 008 | `GET /candidates/check-duplicate` | `('create','candidate')` | — | `CheckDuplicateQueryDto {email?, phone?}` — trả `{id,fullName,stage,jobOpeningTitle,deleted}[]`, **KHÔNG** email/phone của hồ sơ khớp | 400 (thiếu cả 2 tham số) | — | — | — |
| 009 | `GET /candidates/summary` | `('view','candidate')` | R@Company | `CandidateSummaryQueryDto` (rỗng) → `{byStage, openJobOpenings}` | — | — | — | — |
| 010 | `GET /candidates/export` | `('export','candidate')` **+ `('view','candidate')`** (§18 — CẢ HAI) | R@Company | `ExportCandidatesQueryDto = ListCandidatesQueryDto.omit({limit:true, offset:true}).strict()` — client gửi `limit`/`offset` ⇒ **400 Zod** (field lạ, chặn ở biên), KHÔNG âm thầm bỏ qua; export luôn xuất TOÀN BỘ tập khớp filter, không phân trang | 400 (limit/offset lạ); 403 thiếu 1 trong 2 cặp; **422 `015`** khi `COUNT(*) FROM candidates WHERE <cùng filter>` (câu COUNT riêng, chạy TRƯỚC khi mở stream) `> 10.000` — ngưỡng đọc từ hằng test-overridable (§9.1, chống mã chết: int-spec seed đủ hàng hoặc hạ hằng ngưỡng qua test-only override để có ca THẬT, không chỉ lý thuyết) | ✅ (payload = filter + số dòng, KHÔNG dữ liệu) | — | — |
| 011 | `GET /candidates/:id` | `('view','candidate')` | R@Company + masking email/phone | — | 404 `010` | — | — | — |
| 012 | `PATCH /candidates/:id` | `('update','candidate')` | W | `UpdateCandidateDto` `.strict()` (**KHÔNG** `stage`/`employeeId`) — người giữ cặp này thấy email/phone KHÔNG che | 400 field lạ; 409 `005` đổi `jobOpeningId` sang Closed; 404 `010` | ✅ | — | — |
| 013 | `POST /candidates/:id/move-stage` | `('move-stage','candidate')` | W | `MoveStageDto {toStage, reason (min 3)}` — enum `toStage` **ĐỦ 6 giá trị** (không cắt `Hired`) | 409 `001` (FSM §13.1, kể cả `→Hired` tay = `014`); 404 `010` | ✅ | `RECRUIT_STAGE_CHANGED` | — |
| 014 | `GET /candidates/:id/stage-events` | `('view','candidate')` | R@Company | phân trang, mới nhất trước | 404 `010` | — | — | — |
| 015 | `GET /candidates/:id/notes` | `('view','candidate')` | R@Company | phân trang | 404 `010` | — | — | — |
| 016 | `POST /candidates/:id/notes` | `('comment','candidate')` | W | `CreateNoteDto {body}` | 400; 404 `010` | ✅ (gói vào `object_type='candidate'`, payload kèm `noteId`) | — | — |
| 017 | `PATCH /candidates/:id/notes/:noteId` | `('comment','candidate')` | W (chỉ ghi chú CỦA MÌNH) | `UpdateNoteDto {body?, delete?: true}` | 400; 404 `010` (ghi chú người khác/không tồn tại — CÙNG mã, không lộ oracle) | ✅ | — | — |
| 029 | `POST /candidates/:id/convert` | `('convert','candidate')` | W | — (không body) | 409 `007` `not-in-offer-stage`; 409 `008` (`no-offer`/`offer-not-accepted`/`already-converted`); 404 `010` | ✅ `candidate` (+ audit HR `employee` trong `createEmployeeFromCandidateTx`) | `RECRUIT_CANDIDATE_HIRED` | ✅ |

### 2.3 `InterviewsController` (`@Controller("interviews")`) — 018–024

| Mã | Method · Path | Cặp quyền | Scope | DTO | Mã lỗi | Audit | Outbox | Idem |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 018 | `GET /interviews` | `('view','interview')` | R(Own/Company) — Own lọc **HÀNG** = `EXISTS interview_participants` theo employee của caller | `ListInterviewsQueryDto {candidateId?, from?, to?, status[]?}` | 400 | — | — | — |
| 019 | `POST /interviews` | `('manage','interview')` | W | `CreateInterviewDto {candidateId, round?, startsAt, endsAt, location?, note?, participantEmployeeIds[] (≥1)}` | 400; 422 `013` `invalid-time-range`; 409 `007` `not-in-interview-stage`; 404/422 `009` (employee không tồn tại/không active) | ✅ `interview` | `RECRUIT_INTERVIEW_SCHEDULED` | ✅ |
| 020 | `GET /interviews/:id` | `('view','interview')` | R(Own/Company) | chi tiết + participants (JOIN qua `RecruitPeopleRepository`) + feedbacks | 404 `010` (ngoài scope Own ⇒ CÙNG mã) | — | — | — |
| 021 | `PATCH /interviews/:id` | `('manage','interview')` | W | `UpdateInterviewDto {round?, startsAt?, endsAt?, location?, note?}` — chỉ khi `Scheduled` | 400; 409 `004`; 422 `013`; 404 `010` | ✅ | — | — |
| 022 | `POST /interviews/:id/change-status` | `('manage','interview')` | W | `ChangeInterviewStatusDto {toStatus: 'Completed'|'Cancelled', note?}` | 409 `004` (FSM §13.4); 404 `010` | ✅ | — | — |
| 023 | `POST /interviews/:id/feedback` | `('feedback','interview')` | **Own cho MỌI role** — phải là participant | `CreateFeedbackDto {rating (1-5), comment?, recommendation}` | 400; 403 `011` not-participant (thấy lượt ở Company mà không tham gia); 409 `012` trùng; 409 `004` lượt Cancelled; 404 `010` (ngoài scope Own) | ✅ `interview` (payload kèm `feedbackId`) | — | — |
| 024 | `PATCH /interviews/:id/feedback` | `('feedback','interview')` | Own — resolve theo employee của caller, KHÔNG nhận id feedback | `UpdateFeedbackDto {rating?, comment?, recommendation?}` | 400; 404 `010` (chưa có feedback của mình / lượt ngoài scope) | ✅ | — | — |

### 2.4 `OffersController` (`@Controller("offers")`) — 025–028, 030

| Mã | Method · Path | Cặp quyền | Scope | DTO | Mã lỗi | Audit | Outbox |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 025 | `GET /offers` | `('view','offer')` | R@Company; `salary` chỉ khi có thêm `('manage','offer')` | `ListOffersQueryDto {candidateId?, status[]?}` | 400 | — | — |
| 026 | `POST /offers` | `('manage','offer')` | W | `CreateOfferDto {candidateId, title?, startDate, salary, note?}` | 400; 422 `013` `invalid-start-date` (quá khứ); 409 `007` `not-in-offer-stage`; 409 `006` (1 offer sống); 404 `010` | ✅ `offer` |
| 027 | `PATCH /offers/:id` | `('manage','offer')` | W | `UpdateOfferDto {title?, startDate?, salary?, note?}` — chỉ khi `Draft` | 400; 409 `003` `not-draft`; 404 `010` | ✅ |
| 028 | `POST /offers/:id/change-status` | `('manage','offer')` | W | `ChangeOfferStatusDto {toStatus, note?}` | 409 `003` (FSM §13.3); 404 `010` | ✅ |
| 030 | `GET /offers/:id` | `('view','offer')` | R@Company; `salary` chỉ khi `('manage','offer')` | — | 404 `010` | — | — |

Idempotency: 007 (`POST /candidates`), 019 (`POST /interviews`), 026 (`POST /offers`), 029 (`POST /candidates/:id/convert`) — 4 route `@Idempotent()`.

### 2.5 `RecruitPickersController` (`@Controller("recruit/pickers")`) — 031–032

| Mã | Method · Path | Cặp quyền | Trả về | Mã lỗi |
| --- | --- | --- | --- | --- |
| 031 | `GET /recruit/pickers/employees` | `('manage','interview')` | `{id, fullName, employeeCode}[]` nhân viên `active` trong company, qua `RecruitPeopleRepository`, filter `?q=&limit=` | 400 |
| 032 | `GET /recruit/pickers/recruiter-users` | `('update','job-opening')` | `{id, fullName}[]` user sống trong company, qua `RecruitPeopleRepository`, filter `?q=&limit=` | 400 |

Cả 2 picker gate bằng cặp GHI tương ứng (role `recruiter` không có cặp HR/AUTH nào để gọi API-03 — SPEC-12 §15 ghi chú 031).

---

## 3. FSM ép ở service — `apps/api/src/recruit/recruit-fsm.ts`

**Một hàm thuần cho mỗi đối tượng** — unit-test 100% ma trận, KHÔNG controller nào tự kiểm chuyển tiếp.

### 3.1 `assertStageTransition(from: CandidateStage, to: CandidateStage, via: 'move' | 'convert')` (§13.1)

| from ↓ / to → | New | Screening | Interview | Offer | Hired | Rejected |
| --- | --- | --- | --- | --- | --- | --- |
| **New** | — | ✓ | ✗ | ✗ | ✗ | ✓ |
| **Screening** | ✗ | — | ✓ | ✗ | ✗ | ✓ |
| **Interview** | ✗ | ✓ (lùi) | — | ✓ | ✗ | ✓ |
| **Offer** | ✗ | ✗ | ✓ (lùi) | — | **CHỈ `via='convert'`** | ✓ |
| **Hired** | ✗ | ✗ | ✗ | ✗ | — | ✗ |
| **Rejected** | ✗ | ✓ (reopen) | ✗ | ✗ | ✗ | — |

Mọi ô ✗ ⇒ `ConflictException` **409 RECRUIT-ERR-001**. `Offer→Hired` với `via='move'` ⇒ **409 RECRUIT-ERR-014** (mã RIÊNG, không phải 001 — service phân biệt bằng nhánh trước khi rơi vào bảng ✗ chung). `from === to` (kể cả stage hiện tại) ⇒ 001.

### 3.2 `assertJobOpeningTransition(from, to)` (§13.2) — Draft→{Open,Closed}, Open→{Paused,Closed}, Paused→{Open,Closed}, Closed terminal. Ô ✗ ⇒ **409 RECRUIT-ERR-002**. **KHÔNG guard** "còn ứng viên sống" khi đóng (quyết định tường minh §13.2 — không chặn, không tự Reject hàng loạt).

### 3.3 `assertOfferTransition(from, to)` (§13.3) — Draft→{Sent,Withdrawn}, Sent→{Accepted,Declined,Withdrawn}, 3 kết quả terminal. Ô ✗ ⇒ **409 RECRUIT-ERR-003**. Sửa nội dung (PATCH 027) chỉ khi `Draft` (khác ⇒ 003 `kind=not-draft`).

### 3.4 `assertInterviewTransition(from, to)` (§13.4) — Scheduled→{Completed,Cancelled}, hai đích terminal. Ô ✗ ⇒ **409 RECRUIT-ERR-004**. Sửa giờ/địa điểm (PATCH 021) chỉ khi `Scheduled` (khác ⇒ 004).

### 3.5 Điều kiện tiền trạng (không phải chuyển tiếp, nhưng cùng "mã 007")

- `POST /interviews` (019): `candidates.stage` phải `= 'Interview'`, khác ⇒ **409 RECRUIT-ERR-007** `kind=not-in-interview-stage`.
- `POST /offers` (026): `candidates.stage` phải `= 'Offer'`, khác ⇒ **409 RECRUIT-ERR-007** `kind=not-in-offer-stage`.
- `POST /candidates/:id/convert` (029): xem §6 — dùng LẠI mã 007 `kind=not-in-offer-stage` cho vế stage.

### 3.6 Map lỗi PG → RECRUIT-ERR (`recruit.errors.ts` export `mapRecruitPgError(err: unknown)`, pure — unit-test bằng lỗi giả `.cause`)

| `code` | `constraint` | Map |
| --- | --- | --- |
| `23505` | `uq_offers_candidate_open` | 409 `RECRUIT-ERR-006` |
| `23505` | `uq_candidates_company_employee` | 409 `RECRUIT-ERR-008` `kind=already-converted` |
| `23505` | `uq_interview_feedbacks` | 409 `RECRUIT-ERR-012` |
| `23505` | `uq_interview_participants` | KHÔNG map riêng — participants dựng 1 lần lúc `POST /interviews`, list `participantEmployeeIds` de-dup Zod TRƯỚC insert (chặn ở biên, không rơi race) |
| `23514` | `chk_interviews_range` | 422 `RECRUIT-ERR-013` `kind=invalid-time-range` (lưới THỨ HAI — lưới thứ nhất là service kiểm TRƯỚC insert) |
| `23505` | `employee_profiles_company_code_active_uq` (và constraint link-user tương đương nếu mig HR có, đọc lại tên thật trước khi code) | **409 `RECRUIT-ERR-008` `kind=employee-code-conflict`** — chọn 008 (không phải mã HR riêng) vì đây là XUNG ĐỘT TRẠNG THÁI DỮ LIỆU trong luồng convert, cùng họ với `already-converted`. Xảy ra thật: HR cho phép nhập `employee_code` THỦ CÔNG (`manualCode`), nên mã kế tiếp do `allocateEmployeeCode` cấp (Pha 2, §6.1) có thể trùng một mã đã được ai đó gõ tay TRƯỚC. `createEmployeeFromCandidateTx` **KHÔNG kế thừa** khối `try/catch isUniqueViolation` của `createEmployee` (`hr-write.service.ts:282-293`) — RECRUIT convert PHẢI tự bóc `23505` ở constraint này (bên cạnh `uq_candidates_company_employee`) và map 008, KHÔNG để rơi vào `AllExceptionsFilter`/500. Đính chính 1 dòng vào SPEC-12 §12 CÙNG chỗ đính chính mã 009 (§6.2) — mã 008 mở rộng thêm 1 `kind` mới bên cạnh 3 kind đã có. **Ca int-spec bắt buộc** (`recruit-be1-convert.int-spec.ts`): gieo trước 1 `employee_profiles` với `employee_code` TRÙNG giá trị counter SẮP cấp (đọc counter hiện tại, tính trước giá trị kế tiếp, insert thủ công đúng mã đó) → convert phải trả **409 008 `employee-code-conflict`**, KHÔNG 500. |
| khác | — | KHÔNG map riêng — `AllExceptionsFilter` xử lý; test §9 chặn service thiếu cột đẻ 500 |

**Hình dạng lỗi (mirror ASSET §3.5 B1/B2):** mọi mã ném `{code:'RECRUIT-ERR-xxx', message, details}` — `details` là **MẢNG** `ErrorDetail{field,message,rule}`; `kind` = phần tử `{field:'kind', message:'<kind>', rule:'recruit'}`.

---

## 4. Data-scope + masking (server) — `apps/api/src/recruit/recruit-access.service.ts`

### 4.1 Job-opening / candidate / offer — CHỈ Company (§13.6), không EXISTS row-filter nào

`resolveAndAssert(user.id, companyId, action, resourceType)` chỉ dùng để **403 nếu thiếu grant** (mirror ASSET §0 "Hệ quả kiến trúc quan trọng" — không có `assertWriteAllowed`/`assertWriteTarget` kiểu GOAL, và **cũng không có `readScopeExists` kiểu ASSET** vì không có Own/Department nào ở các resource này). List/detail SELECT toàn bộ theo `company_id` (RLS + `withTenant`), KHÔNG EXISTS/JOIN lọc hàng thêm.

### 4.2 Interview own-scope — `EXISTS interview_participants` (KHÔNG dùng `buildEmployeeScopeCondition`)

```text
scope = await dataScope.resolveAndAssert(user.id, companyId, 'view', 'interview')
Company ⇒ không filter thêm.
Own ⇒ AND EXISTS (
  SELECT 1 FROM interview_participants ip
   JOIN employee_profiles ep ON ep.id = ip.employee_id AND ep.company_id = $companyId
  WHERE ip.company_id = $companyId AND ip.interview_id = interviews.id
    AND ep.user_id = $actorUserId AND ep.deleted_at IS NULL)
```

**Caller không có `employee_profiles` (plan-review M3 của DB-1, áp dụng lại ở BE):** `ep.user_id = actorUserId` không khớp hàng nào ⇒ danh sách Own **rỗng**, fail-closed, KHÔNG lỗi (mirror `/me/*`).

### 4.3 Feedback own-scope + `not-participant` (403 `011`) — chống mã CHẾT 011

**Tầm nhìn lượt resolve từ `('view','interview')` TRƯỚC** (đây là điều kiện quyết định 010 vs 011, không phải "có feedback grant hay không"):
- `scope = await dataScope.resolveOrNull(user.id, companyId, 'view', 'interview')`.
- `scope === null` (caller KHÔNG có `view:interview` — kể cả khi có `feedback:interview` Own, vì đó là 2 cặp KHÁC nhau) HOẶC `scope === 'Own'` mà lượt không nằm trong tập Own của caller ⇒ **404 `010`** (không thấy lượt ⇒ không thể phân biệt not-participant với not-found).
- `scope === 'Company'` (thấy lượt) mà caller KHÔNG phải participant (`NOT EXISTS interview_participants(interview_id, employee_id=caller)`) ⇒ **403 `011`**.
- Ba ca test bắt buộc (chống mã chết — §9.1): (i) role `recruiter`/`hr` (có `view:interview`@Company **và** `feedback:interview`@Own, participant KHÁC) → ghi feedback lượt mình không tham gia ⇒ **403 `011`**; (ii) role `manager` (chỉ `view:interview`@Own) mở lượt mình KHÔNG tham gia ⇒ **404 `010`**; (iii) role CHỈ có `feedback:interview`@Own nhưng **KHÔNG** có `view:interview` nào (giả lập bằng role test riêng, không phải 4 role seed chuẩn) → POST feedback vẫn ⇒ **404 `010`** (vì `resolveOrNull('view','interview')` trả `null` trước khi kịp xét participant — chứng minh nhánh "thấy lượt" thật sự cần `view:interview`, không suy diễn ngầm từ `feedback:interview`).

Kiểm `EXISTS interview_participants (interview_id, employee_id=caller)` CHỈ chạy SAU khi đã xác định `scope` không phải `null` và lượt nằm trong tầm nhìn.

### 4.4 Masking PII ứng viên — `recruit.mapper.ts#toCandidateDetailDto(row, callerHasUpdate)` — MỘT lối ra DUY NHẤT

**`recruit.mapper.ts` là ĐIỂM MASKING PII DUY NHẤT của toàn module** — mọi đường trả về hàng `candidates` (006 list · 011 detail · 010 export · 014/015 sub-resource nếu kèm tên · DTO nhúng candidate trong interview 018/020 · payload NOTI) đi qua CÙNG `toCandidateDetailDto`/`toCandidateListItemDto` (2 hàm, KHÔNG có đường thứ ba tự build object PII). Cấm bất kỳ repository/controller nào tự chọn `email`/`phone` ra response mà không qua mapper.

- `callerHasUpdate = await permission.can({action:'update', resourceType:'candidate', isSensitive: true, ...}).allow` — **`isSensitive: true` BẮT BUỘC truyền tường minh** (không dựa vào `grant.isSensitive` của hàng grant khớp): theo `permission.service.ts:257-258`, `effectivelySensitive = input.isSensitive OR grant.isSensitive`; nếu caller CHỈ có wildcard `*:*` (permission ROW `*:*` bản thân KHÔNG mang `is_sensitive=true` trong catalog dù resource đích là sensitive) thì thiếu `input.isSensitive:true` sẽ cho `effectivelySensitive=false` ⇒ wildcard tầng 4 thoả mãn ⇒ **PII mở khoá cho một role chỉ có `*:*`** — đúng lỗ đã cảnh báo. Áp dụng CHO CẢ 7 cặp `candidate` sensitive ở MỌI lời gọi `permission.can()` trong `recruit.mapper.ts`/`recruit-candidate-file.resolver.ts` (§7) — KHÔNG chỉ `update`.
- `callerHasUpdate === true` ⇒ `email`/`phone` trả NGUYÊN VẸN, `piiMasked:false`.
- `false` ⇒ mask: email `d***@***.com` kiểu (giữ ký tự đầu local-part + domain rút gọn), phone `09** *** *45` (giữ 2 số đầu + 2 số cuối) — **hàm THUẦN** `maskEmail`/`maskPhone`, unit-test riêng biên rỗng/null/độ dài lạ. `piiMasked:true`.
- `check-duplicate` (008): **KHÔNG BAO GIỜ** trả email/phone của hồ sơ khớp (chỉ `{id,fullName,stage,jobOpeningTitle,deleted}`), bất kể quyền caller.
- **Ca test bắt buộc (chống bypass wildcard):** role dựng test CHỈ có grant `('*','*')`@Company (không có `('update','candidate')` cụ thể) → GET candidate detail → `email`/`phone` VẪN phải ở dạng che, `piiMasked:true` (KHÔNG unmask qua wildcard) — §9.1.
- **Census masking PER ROUTE ĐỌC** (không chỉ 011): 006 (list), 010 (export), 011 (detail), 018/020 (embed trong interview — chỉ `fullName`, xem §4.6) đều phải có ca test `view-only` thấy che/vắng khoá — MỘT route quên gọi mapper là một lỗ PII độc lập, không suy được từ ca đã pass ở route khác.

### 4.5 Masking lương offer — `recruit.mapper.ts#toOfferDto(row, callerHasManageOffer)`

`callerHasManageOffer = await permission.can({action:'manage', resourceType:'offer', isSensitive: false, ...}).allow` — **`isSensitive: false` truyền TƯỜNG MINH** (không phải quên): cặp `manage:offer` **KHÔNG** nằm trong danh sách 7 cặp sensitive của seed (permission-matrix §9f — chỉ 7 cặp resource `candidate`; masking lương là tầng THỨ HAI tách khỏi cặp quyền theo REC-DEC-004, KHÔNG dựng cặp nhạy cảm riêng). Vì vậy một role chỉ có wildcard `*:*` **ĐƯỢC PHÉP** thấy `salary` — đây là hành vi ĐÚNG theo thiết kế, không phải lỗ; truyền `isSensitive:false` tường minh (thay vì bỏ mặc định) để khẳng định đây là lựa chọn có chủ đích, không phải quên áp `true` như candidate. `true` (từ `manage:offer`, wildcard hoặc exact) ⇒ giữ khoá `salary`. `false` ⇒ **VẮNG KHOÁ** `salary` (không `null` — memory `server-masking-needs-optional-fe-schema`, contract FE `.optional()`).

### 4.6 Projection `fullName` được phép lộ (§18, ngoại lệ tường minh)

`candidates.fullName` (**KHÔNG phải cột `users`** — không chạm identity-projection census) xuất hiện trong DTO interview (018/020) cho `('view','interview')`-only (Own) **KHÔNG kèm** email/phone/source/note. Đây là field CANDIDATE riêng, không phải chiếu từ `users` — không cần verdict identity-projection, nhưng cần **test masking riêng** khẳng định các trường khác vắng mặt (§9.1).

### 4.7 404-không-403 (RECRUIT-ERR-010)

Mọi đối tượng ngoài company / xoá mềm / ngoài scope Own (interview) ⇒ **404**, không 403 (chống dò tồn tại). 403 CHỈ khi: thiếu cặp quyền (`AUTH-ERR-FORBIDDEN`, PermissionGuard) hoặc vi phạm điều kiện participant khi ĐÃ thấy lượt (`011`).

---

## 5. Điểm chiếu danh tính DUY NHẤT — `apps/api/src/recruit/recruit-people.repository.ts`

Mirror `RoomPeopleRepository` — **MỘT** repository, mọi nơi cần tên người (recruiter phụ trách trong job-opening list/detail, interviewer/participant trong interview list/detail + feedback, 2 picker 031/032, `actor_name`/tên trong payload NOTI) gọi lại nó. **KHÔNG service nào khác trong `recruit/**` được `select` thẳng `users.fullName`/`users.email`** (identity-projection ratchet).

**Căn cứ THẬT (không phải `cond=true` giả) — dựng qua bảng hằng DÙNG CHUNG `RECRUIT_ROUTE_PAIRS`, KHÔNG tham số rời:** RECRUIT gọi `namesByUserIdsTx` từ 4 ngữ cảnh khác nhau (job-opening recruiter name · interview participant/interviewer name · picker 031 · picker 032), mỗi ngữ cảnh gate bằng một cặp KHÁC nhau — không có "cặp view chung" như ROOM. Thay vì truyền `servingPair` rời từng lời gọi (dễ lệch giữa nơi gọi và nơi gate route), **một bảng hằng DUY NHẤT** `apps/api/src/recruit/recruit-route-pairs.const.ts`:

```text
export const RECRUIT_ROUTE_PAIRS = {
  jobOpeningView:  { action: 'view',   resourceType: 'job-opening' },
  interviewView:   { action: 'view',   resourceType: 'interview' },
  interviewManage: { action: 'manage', resourceType: 'interview' },   // picker 031
  jobOpeningUpdate:{ action: 'update', resourceType: 'job-opening' }, // picker 032
  ... (đủ 32 route, key = tên route)
} as const;
```

**DÙNG CHUNG Ở BA NƠI** (không phải chỉ repository), mirror `RoomAccessService`/`RoomActor`:
1. `@RequirePermission(RECRUIT_ROUTE_PAIRS.xxx.action, RECRUIT_ROUTE_PAIRS.xxx.resourceType)` ở decorator route — đọc TỪ hằng, không gõ lại literal.
2. Assert tầng 2 trong service (§6.1 Pha 1, §4 mỗi service) — cũng đọc TỪ CÙNG hằng, không phải string riêng.
3. **`RecruitAccessService` tính `peopleVisibleCond` MỘT LẦN/request** (không phải mỗi lần gọi `namesByUserIdsTx`): resolve `dataScope.resolveOrNull(actor.userId, companyId, pair.action, pair.resourceType)` theo cặp CỦA ROUTE ĐANG XỬ LÝ (lấy từ `RECRUIT_ROUTE_PAIRS`), fail-closed `eq(users.id, actor.userId)` nếu `null`, rồi GẮN vào `RecruitActor { userId, companyId, peopleVisibleCond, ... }` — controller/service dựng `RecruitActor` MỘT LẦN đầu request (mirror `RoomActor`) và truyền xuống mọi tầng dưới.

```text
// RecruitPeopleRepository — KHÔNG nhận servingPair rời, chỉ nhận actor đã có cond sẵn:
namesByUserIdsTx(tx, actor: RecruitActor, userIds): Map<userId, {displayName, employeeCode}>
  - grant = fromScope(actor.peopleVisibleCond, 'identity-gated',
      'peopleVisibleCond đã tính 1 lần/request bởi RecruitAccessService theo cặp của route (RECRUIT_ROUTE_PAIRS) — RECRUIT không có Own/Department ở job-opening/candidate/offer nên mọi grant thật đều mở tên, chỉ 0 grant mới thu hẹp về self', users.id)
  - identityColumns(grant, {displayName: users.fullName}) — employeeCode = subquery TƯƠNG QUAN qua
    employee_profiles (KHÔNG LEFT JOIN có vị từ ở WHERE — nhân bản hàng khi user có nhiều hồ sơ lịch sử)
  - WHERE company_id = $companyId AND deleted_at IS NULL AND id IN (...)
```

**Vẫn ĐÚNG MỘT điểm chiếu** (`namesByUserIdsTx`) — tách `peopleVisibleCond` ra khỏi repository (tính ở `RecruitAccessService`, truyền qua `actor`) không làm phát sinh điểm chiếu thứ hai, vì `identityColumns` chỉ quan tâm CÓ một `IdentityGrant` hợp lệ tại điểm gọi. `resolveOrNull` trả `null` trong thực tế gần như không xảy ra (route đã có `@RequirePermission` chặn từ decorator) — nhánh fail-closed tồn tại như phòng thủ tầng hai (defense-in-depth), KHÔNG phải luồng chính.

Picker 031 (`employees`): SELECT trực tiếp `employee_profiles` (status='active') JOIN `users` qua CHÍNH `namesByUserIdsTx` hoặc một phương thức thứ hai `activeEmployeesTx(tx, q?, limit)` trong CÙNG repository (vẫn tính là 1 điểm chiếu nếu tái dùng `identityColumns` với CÙNG grant — nếu viết SELECT riêng cho picker thì đó là điểm chiếu THỨ HAI, cần dòng verdict thứ hai + nâng ceiling thêm 1; **quyết định thi công**: ưu tiên tái dùng `namesByUserIdsTx` bằng cách trước tiên SELECT danh sách `employeeId` khớp `q` KHÔNG chạm `users`, rồi gọi `namesByUserIdsTx` để lấy tên — giữ ĐÚNG MỘT điểm chiếu).

Picker 032 (`recruiter-users`): SELECT `users` (status sống, company) lọc `q` trên `full_name`/`email` — đây LÀ điểm chiếu (không tránh được, vì chính bảng `users` được liệt kê), dùng CHUNG `namesByUserIdsTx` bằng cách trước tiên lấy danh sách `userId` khớp filter qua một cột KHÔNG identity (vd tất cả active user id trong company), rồi gọi `namesByUserIdsTx`, HOẶC filter theo `q` áp dụng SAU khi đã bọc cột (an toàn hơn — filter trên giá trị ĐÃ qua `identityColumns`, không phải trên cột trần). Chốt cách làm cụ thể ở lúc code, ghi rõ trong file để reviewer soát.

---

## 6. Convert — `apps/api/src/recruit/recruit-convert.service.ts` + `HrWriteService.createEmployeeFromCandidateTx`

### 6.1 Trình tự 3 PHA (SPEC-12 §13.5 + quyết định §1.1 — KHÔNG còn "mở tx ngay từ đầu")

**Pha 1 — Guard + ĐỌC sơ bộ fail-fast (tx nhẹ hoặc SELECT trực tiếp qua `withTenant` ngắn, KHÔNG lock):**
1. **Tầng guard THỨ HAI CHẠY TRƯỚC TIÊN TRONG PHA NÀY** (dời từ Pha 3 lên đây, sau plan-review vòng 2 — luật "deny để lại ZERO side effect", mirror `HrWriteService.assertCanProvisionUser`/`assertWriteScope` chạy TRƯỚC mọi cấp phát/side-effect, `hr-write.service.ts:152`): `await permission.can({action: RECRUIT_ROUTE_PAIRS.candidateConvert.action, resourceType: RECRUIT_ROUTE_PAIRS.candidateConvert.resourceType, isSensitive:true, ...}).allow` phải `true` — deny ⇒ ném NGAY, KHÔNG cấp mã (Pha 2 chưa chạy), KHÔNG mở business tx. Đây là cổng THỨ HAI độc lập với decorator route (census §9.3 đo cả hai tầng qua CÙNG `RECRUIT_ROUTE_PAIRS`).
2. Tải `candidates` (404 `010` nếu không thấy/ngoài company) + `offers` liên quan; kiểm SƠ BỘ đúng thứ tự N1 (a→b→c, xem Pha 3) — sai ở bước nào ném NGAY, KHÔNG sang Pha 2 (tránh đốt mã cho request rõ ràng sai). **Đây CHỈ là fail-fast, KHÔNG lock hàng** — kết quả (kể cả các trường sẽ dùng để map sang employee) CÓ THỂ đã CŨ khi tới Pha 3 (race), nên **BỊ VỨT BỎ** sau bước này, không mang sang Pha 3.

**Pha 2 — Cấp mã NGOÀI mọi tx nghiệp vụ (CHỈ chạy khi Pha 1 đã pass cả guard lẫn fail-fast):** `const employeeCode = await this.hrWrite.allocateEmployeeCode(actor.companyId);` (method đổi `private`→`public`, KHÔNG đổi thân — §1.1). Lỗi cấu hình mã (`SequenceNotFoundError`/`SequenceInactiveError`) đã tự map 422 `HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID` bên trong hàm này — RECRUIT convert để lỗi lan ra nguyên trạng.

**Pha 3 — Business tx (`db.withTenant`, MỘT transaction, chốt cuối GHI) — CHỈ re-check NGHIỆP VỤ (N1 + offer Accepted), KHÔNG re-check quyền (đã xong ở Pha 1, quyền không đổi giữa 2 pha trong 1 request):**
1. `SELECT ... FROM candidates JOIN job_openings ON ... WHERE candidates.company_id AND candidates.id FOR UPDATE` — không thấy ⇒ 404 `010` (mã vừa cấp ở Pha 2 bị bỏ phí — gap chấp nhận được). **BẮT BUỘC JOIN `job_openings` NGAY TRONG câu này** (không tách 2 câu) vì `orgUnitId`/`positionId` là TRƯỜNG SẼ ĐEM GHI vào `employee_profiles` (§6.2) — đọc chúng ở Pha 1 rồi mang sang Pha 3 là TOCTOU thật (vị trí tuyển có thể bị PATCH đổi `orgUnitId` giữa 2 pha); mọi trường sẽ GHI (`fullName`/`email`/`phone` của candidate, `orgUnitId`/`positionId` của job-opening) phải đọc LẠI ở đây, KHÔNG tái sử dụng giá trị Pha 1.
2. **KIỂM LẠI TOÀN BỘ 3 tiền điều kiện N1** (fail-closed — trạng thái CÓ THỂ đổi giữa Pha 1 và đây, ví dụ request convert khác đã chạy xong):
   a. `employeeId IS NOT NULL` ⇒ 409 `008` `kind=already-converted` (kiểm TRƯỚC — sau convert stage luôn Hired, kiểm stage trước sẽ để 008 bị 007 "nuốt").
   b. `stage !== 'Offer'` ⇒ 409 `007` `kind=not-in-offer-stage`.
   c. Không có offer nào `status='Accepted'` (SELECT `offers WHERE candidate_id ORDER BY created_at DESC, id DESC`) ⇒ 409 `008` `kind=no-offer` (0 offer) hoặc `kind=offer-not-accepted` (có offer nhưng không cái nào Accepted).
3. Offer dùng để map = offer `Accepted` **mới nhất** (`created_at DESC, id DESC` — tiebreak, re-select trong CÙNG câu ở bước 2c, không dùng lại giá trị Pha 1).
4. `await this.hrWrite.createEmployeeFromCandidateTx(tx, actor, {...input, employeeCode})` — xem §6.2 (KHÔNG còn đụng `SequenceService`; `input.fullName/email/phone/orgUnitId/positionId` đều lấy từ hàng vừa đọc TRONG Pha 3 bước 1, KHÔNG từ Pha 1).
5. `UPDATE candidates SET employee_id = <new> WHERE company_id AND id AND employee_id IS NULL` — 0 hàng (race hiếm — 2 request cùng vượt qua bước 2a) ⇒ bóc `23505` từ `.cause` (`isUniqueViolation`) ⇒ 409 `008` `already-converted`, **rollback TOÀN BỘ tx** (employee vừa tạo cũng rollback, mã Pha 2 bỏ phí).
6. `UPDATE candidates SET stage='Hired'` + `INSERT candidate_stage_events (from_stage='Offer', to_stage='Hired', action='convert', reason=<cố định vd 'Chuyển thành nhân viên'>, acted_by=actor.id)` cùng tx (đã biết `Offer→Hired,via=convert` hợp lệ từ bước 2b — không cần gọi lại `assertStageTransition`).
7. Audit RECRUIT (`object_type='candidate'`, action `'convert'`, payload `{employeeId, jobOpeningId}` — KHÔNG lương/PII) + `outbox.enqueue(tx, {eventType:'recruit.candidate_hired', payload:{eventCode:'RECRUIT_CANDIDATE_HIRED', candidateId, employeeId}})`.

**Idempotency (`@Idempotent()` trên route 029, KHÔNG có body):** header `Idempotency-Key` chỉ chống REPLAY của CÙNG MỘT request (client bấm 2 lần) — chốt cuối chống DOUBLE-CONVERT thật (2 client/2 tab KHÁC nhau, hoặc key khác nhau) vẫn là **UNIQUE `employee_id`** ở Pha 3 bước 5, KHÔNG PHẢI idempotency. Test race 2-request-song-song (§9.1) PHẢI dùng 2 `Idempotency-Key` KHÁC NHAU (hoặc không gửi header) — dùng CÙNG key cho ca race sẽ biến nó thành ca replay (interceptor chặn request thứ 2 TRƯỚC khi chạm service), che mất đường UNIQUE thật cần chứng minh.

### 6.2 `HrWriteService.createEmployeeFromCandidateTx(tx: TenantTx, actor: {id,companyId}, input: CreateEmployeeFromCandidateInput): Promise<{employeeId: string, employeeCode: string}>`

**Viết MỚI trong `hr-write.service.ts`** (KHÔNG gọi `createEmployee` — B1 DB-1: tự mint user khi có email, đòi `create:user`, tự mở tx riêng). Hợp đồng:

- **Nhận `tx` từ caller** — KHÔNG tự `db.withTenant`. **KHÔNG nhận `SequenceService` trong luồng này nữa** — `input.employeeCode` đã được `RecruitConvertService` cấp SẴN ở Pha 2 (§6.1) và truyền vào; hàm này chỉ INSERT với mã có sẵn, KHÔNG tự gọi `sequence.nextCode()`/`ensureCounterTx` (loại bỏ hoàn toàn nguy cơ nested-tx).
- **KHÔNG nhánh provision user** — `employee_profiles.user_id = NULL` luôn (mirror `createFromImportTx` — UNLINKED).
- **Map trường tường minh** (KHÔNG suy đoán thêm): `fullName` → họ tên · `email` → email cá nhân (**nullable**) · `phone` → SĐT · `orgUnitId`/`positionId` — **RECRUIT service JOIN `job_openings` TRƯỚC khi gọi** và truyền `orgUnitId`/`positionId` sẵn vào `input` (`HrWriteService` không cần biết về bảng `job_openings`) · `startDate` = `offers.startDate` của offer Accepted dùng để convert · trạng thái nhân viên = mặc định luồng HR (`active`/`Probation` theo SPEC-03, KHÔNG hard-code khác default hiện có của `employees.repository.createTx`) · **KHÔNG map `salary`**.
- **Validate `orgUnitId`** phải active trong tenant (mirror `assertReferencesValid`): không active/không tồn tại ⇒ ném lỗi riêng biệt (vd `OrgUnitInvalidError`), **RECRUIT convert bắt lỗi này và map thành 422 `RECRUIT-ERR-009` `kind=org-unit-invalid`** (mở rộng nghĩa mã 009 "tham chiếu nhân sự/tổ chức không hợp lệ" — SPEC-12 §12 hiện chỉ liệt kê nhánh interviewer cho mã 009; convert dùng LẠI cùng mã cho tham chiếu tổ chức của vị trí tuyển, đính chính 1 dòng SPEC-12 §12 cùng PR để không lệch) — **KHÔNG PHẢI 409 `008`** (008 chỉ dành cho 3 kind đã định nghĩa ở §12: no-offer/offer-not-accepted/already-converted). Trường hợp này hiếm (chỉ xảy ra khi đơn vị bị xoá SAU khi vị trí tuyển tạo) nhưng PHẢI có mã đúng, không rơi 500.
- Ghi audit HR TRONG CÙNG tx: `objectType='employee'`, action `'create'`, `after` = structural snapshot (mirror `structuralSnapshot` — KHÔNG PII/lương).
- **KHÔNG** gọi `chatSync.syncUserDerivedMembershipTx` (nhân viên `userId=null` ⇒ bỏ hẳn lời gọi, convert không cần đồng bộ chat cho hồ sơ chưa có tài khoản).
- Trả `{employeeId, employeeCode}` cho RECRUIT service dùng ở Pha 3 bước 5/7.

**File đụng:** `apps/api/src/employees/hr-write.service.ts` (đổi `allocateEmployeeCode` sang `public` + thêm method `createEmployeeFromCandidateTx`) · có thể cần thêm 1 method nhỏ ở `hr-write.repository.ts` (`createUnlinkedFromCandidateTx` hoặc tái dùng `createTx` hiện có nếu chữ ký đã đủ tổng quát — kiểm tra `createTx` signature TRƯỚC khi thêm method mới, tránh trùng lặp) · types xuất từ `@mediaos/contracts` nếu `CreateEmployeeFromCandidateInput` cần là DTO dùng chung (khuyến nghị: type nội bộ TypeScript thuần trong `hr-write.service.ts`, KHÔNG cần Zod vì không phải input HTTP trực tiếp).

---

## 7. File CV — resolver `apps/api/src/recruit/recruit-candidate-file.resolver.ts`

Mirror `EmployeeFileResolver`/`HrContractFileResolver`. `moduleCode='RECRUIT'`, `entityTypes=['candidate']`.

- `canViewFile`/`canDownloadFile` → `permission.can({action:'view', resourceType:'candidate', isSensitive:true, ...}).allow` (KHÔNG cần `dataScope.resolveAndAssert` + `isEmployeeInScope` vì candidate KHÔNG có Own/Department — chỉ cần kiểm company qua `withTenant` khi load candidate theo `input.entityId`; not-found/cross-tenant ⇒ `false`). **`isSensitive:true` bắt buộc** — cùng lý do §4.4 (7 cặp `candidate` là sensitive theo catalog; thiếu cờ này wildcard `*:*` sẽ tải được CV của một role không thật sự có quyền đọc ứng viên).
- `canLinkFile` → `('create','candidate') OR ('update','candidate')`, cả hai truyền `isSensitive:true` (§18 — "lúc tạo" dùng create, "hồ sơ có sẵn" dùng update; resolver không phân biệt được NGỮ CẢNH gọi, nên OR cả hai theo đúng tinh thần §18, ghi rõ trong docblock).
- `canDeleteFile`/`canUnlinkFile` → cùng OR như `canLinkFile` (mirror link — không thể gỡ với quyền yếu hơn quyền đã đính), cùng `isSensitive:true`.
- Đăng ký additive vào `FilePolicyService` ở `RecruitModule.onModuleInit` (KHÔNG sửa `foundation/files/**`).
- **Tải CV ghi `file_access_logs`**: hành vi này là của Foundation Files (API-09) khi qua route download chuẩn — RECRUIT KHÔNG tự ghi, chỉ cần đăng ký đúng resolver để route download không rơi vào `deny-no-resolver`.

---

## 8. NOTI — registrar `apps/api/src/notifications/recruit-noti-bridge.registrar.ts` + `recruit-audience.reader.ts`

**KHÔNG có `@SystemJobHandler`** — cả 4 event đều event-driven (SPEC-12 §17), khác ASSET (có job `MAINTENANCE_DUE`). MỘT registrar, 4 `registerSource()` (mirror `GoalNotiBridgeRegistrar` 2-event) — sống ở `notifications/` để tránh `RecruitModule` import `NotificationsModule` (chiều phụ thuộc một-hướng, tiền lệ Goal/Asset/Chat/Att/Leave).

| Event | `eventType` nội bộ | `sourceEntityType` | `resolveRecipients` | `dedupeKeyOf` |
| --- | --- | --- | --- | --- |
| `RECRUIT_JOB_ASSIGNED` | `recruit.job_assigned` | `job_opening` | `recruiterUserId` mới (trừ actor) | `` `${jobOpeningId}:${newRecruiterUserId}:${jobOpening.updatedAt.toISOString()}` `` — **content-derived, KHÔNG dựa `auditLogId`** (sửa sau plan-review: `AuditService.record()` trả `void`, không trả id hàng vừa ghi; `apps/api/src/events/**` KHÔNG nằm trong `paths` của WO — dùng ID hàng audit đòi sửa `events/**` để trả id, ngoài phạm vi). Công thức mới ghép `updatedAt` của CHÍNH câu UPDATE gán recruiter — **câu UPDATE PHẢI SET `updated_at = now()` TƯỜNG MINH** (không dựa cột có default/trigger nào tự cập nhật — job-opening KHÔNG có trigger `updated_at`, thiếu SET tường minh thì `updatedAt` không đổi giữa 2 lần gán và khoá dedupe TRÙNG NHAU câm lặng, đúng lỗ mà công thức này sửa), đọc `RETURNING updated_at` ngay sau UPDATE (KHÔNG phải `now()` tính rời ở tầng JS) ⇒ **mỗi LẦN gán khác thời điểm là 1 khoá khác nhau** (A→B→A vẫn báo lại A vì `updatedAt` 2 lần gán A khác nhau — ca test §9.1 assert `updatedAt` tăng NGHIÊM NGẶT giữa 2 lần gán, không chỉ "khác nhau"); 2 request REPLAY cùng key idempotency (§10 chú thích idempotency — route 004 KHÔNG có `@Idempotent()` nên đây chỉ là bảo vệ tự nhiên của UPDATE) trong CÙNG millisecond lý thuyết vẫn có thể trùng — chấp nhận được vì đây là thao tác admin hiếm, không phải đường tần suất cao |
| `RECRUIT_INTERVIEW_SCHEDULED` | `recruit.interview_scheduled` | `interview` | user của mọi `interview_participants` (qua `RecruitPeopleRepository`/`RecruitAudienceReader` resolve employee→user; employee không có user ⇒ bỏ qua) | `` `${interviewId}` `` |
| `RECRUIT_STAGE_CHANGED` | `recruit.stage_changed` | `candidate` | `recruiterUserId` của job-opening (trừ actor) — **CHỈ move tay**, convert dùng event riêng | `` `${stageEventId}` `` |
| `RECRUIT_CANDIDATE_HIRED` | `recruit.candidate_hired` | `candidate` | user giữ role **`RECRUIT_HR_ROLE_NAME = 'hr'`** (hằng có tên, KHÔNG literal rải rác — xem dưới) còn hiệu lực trong company (tra `user_roles`, `recipient.mode='UserIds'`, trừ actor) — **KHÔNG** gửi `hr-manager` (role đó không có grant RECRUIT — B6 DB-1) | `` `${candidateId}` `` |

**Bắt buộc `dedupeKeyOf`** cho cả 4 (fallback = `ctx.eventId` luôn khác nhau ⇒ dedupe biến mất câm lặng — memory `outbox-notification-bridge` optional trap, đã gặp ở ASSET). Seed catalog (mig 0561) đã merge trước ⇒ `registerSource()` fail-loud lúc boot nếu sai `eventCode` — verify bằng cách boot app trong int-spec. **Int-spec bắt buộc cho 016** (thay cho "auditLogId"): gán recruiter A lúc t1 → noti A; gán lại A lúc t2 (>t1) → noti A THỨ HAI (2 hàng, không dedupe câm lặng); lặp CÙNG request (Idempotency replay nếu FE có gắn key ở tầng khác, hoặc gọi lại y hệt trong test) → dedupe về 1.

`RecruitAudienceReader` (raw SQL, KHÔNG qua Drizzle query builder nếu cần JOIN phức — nhưng PHẢI qualify `alias.column`, memory `drizzle-sql-template-renders-columns-unqualified`): `interview_participants.employee_id → employee_profiles.user_id` cho 017; `job_openings.recruiter_user_id` trực tiếp cho 016; `user_roles JOIN roles (name = RECRUIT_HR_ROLE_NAME, company_id IS NULL)` cho 019 — `RECRUIT_HR_ROLE_NAME` là hằng `export const RECRUIT_HR_ROLE_NAME = 'hr' as const;` khai TRONG `recruit-audience.reader.ts` (KHÔNG rải literal `'hr'` ở nhiều chỗ — memory `canonical-seed-pin-regression`). **Test drift-guard bắt buộc** (`recruit-be1-noti.int-spec.ts`): SELECT `roles WHERE name = RECRUIT_HR_ROLE_NAME AND company_id IS NULL AND is_system = true` phải trả ĐÚNG 1 hàng trên `LANE_DB` — nếu seed đổi tên role `hr` sau này mà quên cập nhật hằng, test này ĐỎ NGAY thay vì 019 âm thầm không gửi cho ai.

---

## 9. Test RED-trước

### 9.1 Int-spec (LANE_DB=mediaos_recruitbe1)

| File | Ca chính (mỗi DENY có ALLOW đối chứng) |
| --- | --- |
| `test/integration/recruit-be1-scope.int-spec.ts` | Deny 403 cho **15 cặp có route** (role dựng test, KHÔNG SA) + ALLOW đối chứng (`access:recruit` — cặp nav thứ 16 — verify riêng qua capabilities, KHÔNG có route 403 để test); cross-tenant → 404 mọi endpoint; masking email/phone (update:candidate thấy đủ, view-only thấy che, check-duplicate KHÔNG lộ) — **kiểm CẢ 006/010/011/018/020** (không chỉ 011, §4.4 single-exit); masking `salary` (manage:offer thấy, view-only vắng khoá); **role CHỈ có `*:*`@Company → GET candidate detail vẫn thấy email/phone CHE** (chống bypass wildcard, §4.4) — ca đối chứng đặt tên rõ **"role chỉ *:* VẪN thấy salary"** (`GET /offers/:id` VẪN trả `salary` cho role CHỈ có `*:*` — đúng thiết kế, offer KHÔNG nằm trong 7 cặp sensitive, trỏ **permission-matrix §9f:569** làm nguồn — §4.5); interview Own (manager thấy đúng lượt mình tham gia, không thấy lượt khác — 404); feedback: not-participant có `view:interview`@Company (403 `011`, dùng role recruiter/hr) vs ngoài scope Own (404 `010`, dùng role manager) vs **role CHỈ có `feedback:interview`@Own, KHÔNG có `view:interview` nào** (404 `010`, chống mã chết §4.3); caller không có `employee_profiles` ⇒ Own rỗng + feedback chặn (M3); **census 2 tầng**: mỗi route đối chiếu cặp khai ở `@RequirePermission` (decorator) ĐÚNG BẰNG cặp assert lại trong service (không lệch, không thiếu tầng 2 — §9.3) |
| `test/integration/recruit-be1-fsm.int-spec.ts` | 4 FSM đủ ô ✗ → đúng mã 001/002/003/004; `move-stage→Hired` tay → 014; `Rejected→Screening` reopen ✓; lùi 1 bậc (`Interview→Screening`, `Offer→Interview`) ✓; `job Closed` chặn tạo/chuyển candidate vào → 005 (chỉ ở 007 tạo candidate + 012 đổi `jobOpeningId`, KHÔNG ở 013 move-stage); census mã lỗi THEO MÃ — không mã nào 0 ca |
| `test/integration/recruit-be1-convert.int-spec.ts` | Convert khi offer `Sent` → 409 `008 offer-not-accepted`; 0 offer → 409 `008 no-offer`; ghi `Accepted` → convert OK (mã NV từ `allocateEmployeeCode`, `employee_id` set, stage `Hired`, stage event `action='convert'`, HR nhận `RECRUIT_CANDIDATE_HIRED`); convert lần 2 → 409 `008 already-converted`; **2 request convert song song, 2 `Idempotency-Key` KHÁC NHAU** → đúng 1 thắng qua UNIQUE (không 500, không phải ca idempotency replay — §6.1); convert khi `employee_id` đã set (trước cả kiểm stage) → 008 (thứ tự N1); `createEmployeeFromCandidateTx` KHÔNG tạo user (`employee_profiles.user_id IS NULL`), KHÔNG map `salary` vào audit HR; `orgUnitId` của job-opening trỏ đơn vị đã xoá mềm → **422 `009 org-unit-invalid`** (KHÔNG 409 `008`); counter `Inactive`/chưa cấu hình → **422 `HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID`** lan nguyên trạng (KHÔNG 500) |
| `test/integration/recruit-be1-interview-offer.int-spec.ts` | Xếp lịch khi stage ≠ Interview → 409 `007`; tạo offer khi stage ≠ Offer → 409 `007`; 2 offer song song → 1 sống (409 `006`, không 500); 2 feedback song song cùng interviewer → 1 hàng (409 `012`); `ends_at ≤ starts_at` → 422 `013`; employee interviewer không active → 422 `009`; employee ngoài tenant → 404 `009` |
| `test/integration/recruit-be1-noti.int-spec.ts` | 4 event đúng catalog dedupe thật (chạy job/route 2 lần → 0 phát lại với CÙNG khoá); 018 không phát cho actor; **016 gán A(t1)→B→A(t2) → 2 hàng noti A** (khoá `${jobOpeningId}:${userId}:${updatedAt}` — khác timestamp = khác khoá, KHÔNG dùng auditLogId) — **ca ASSERT THÊM: `updatedAt` đọc từ `RETURNING` của 2 câu UPDATE gán recruiter PHẢI tăng NGHIÊM NGẶT (t2 > t1)**, chứng minh khoá dedupe thật sự đổi giữa 2 lần gán (§8/§11 #7); 019 chỉ tới role `RECRUIT_HR_ROLE_NAME`, KHÔNG `hr-manager`; registrar boot không lỗi (`registerSource` khớp catalog); **drift-guard**: `roles WHERE name=RECRUIT_HR_ROLE_NAME AND company_id IS NULL` = đúng 1 hàng |
| `test/integration/recruit-be1-idempotency.int-spec.ts` | 4 route `@Idempotent()` (007/019/026/029): lặp cùng key → 1 bản ghi + `Idempotency-Replayed:true`; khác key → không phát lại chéo. **KHÔNG dùng file này để chứng minh race UNIQUE của convert** (đó là việc của `recruit-be1-convert.int-spec.ts` với 2 key khác nhau — §6.1) |
| `test/integration/recruit-be1-audit.int-spec.ts` | Mỗi mutation quan trọng +1 hàng `audit_logs` đúng `object_type` (4 aggregate — job_opening/candidate/interview/offer); payload KHÔNG chứa email/phone/salary; **export (010): `GET /candidates/export` seed >10.000 hàng khớp filter (hoặc hạ hằng ngưỡng test-only) → 422 `015` THẬT (không chỉ đơn vị test hàm tính COUNT); dưới ngưỡng → 200 + audit filter/count, KHÔNG dữ liệu**; append-only: app role UPDATE/DELETE `candidate_stage_events`/`interview_participants` bị từ chối ở DB |

### 9.2 Unit-spec colocated (không DB)

- `recruit-fsm.spec.ts` — 100% ma trận §3.1–3.4.
- `recruit.errors.spec.ts` — `mapRecruitPgError` với `.cause` 1–3 tầng.
- `recruit.mapper.spec.ts` — `maskEmail`/`maskPhone` biên (null/rỗng/độ dài lạ); `toOfferDto` vắng khoá `salary` khi không đủ quyền dù row "bẩn"; `toCandidateDetailDto` không lộ field khi `piiMasked:true`.

### 9.3 Ratchet/census cùng commit

- `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` — regen `ROUTE_CENSUS_WRITE=1`. **BẮT BUỘC đọc DIFF trước khi commit** (`git diff docs/_review/S6-SEC-ROUTEMAP-1-route-census.json`) — kỳ vọng `routes` 507→539, `gated` 468→500, **`ungated` và `needVerdict` KHÔNG đổi** (27/39). Diff động vào 2 số này ⇒ có route RECRUIT thiếu `@RequirePermission` hoặc rơi nhầm nhóm — DỪNG, không commit, tìm route thiếu guard trước.
- **Census 2 tầng theo TỪNG ROUTE × MÃ CẶP, so với CÙNG MỘT nguồn sự thật `RECRUIT_ROUTE_PAIRS` (§5):** file test mới `test/foundation/recruit-two-layer-guard-census.unit-spec.ts`. Với MỖI route trong 32 route RECRUIT: (a) **tầng decorator** đọc bằng `Reflector`/metadata lúc APP ĐÃ BOOT thật (khuôn `route-guard-coverage.e2e-spec.ts` — runtime, KHÔNG regex trên mã nguồn, tránh bẫy `@UsePipes` cấp class không validate ở lớp census khác) để lấy cặp `@RequirePermission` thật đã đăng ký; (b) **tầng service** đọc cặp assert lại TRONG service — CẢ HAI đối chiếu ĐÚNG BẰNG với `RECRUIT_ROUTE_PAIRS[routeKey]` (không so trực tiếp (a) với (b) — so cả hai với CÙNG nguồn hằng để một sửa nhầm ở MỘT tầng mà tầng kia vẫn "khớp nhau" do cùng sai không lọt lưới). Bao gồm convert 029 và 2 picker 031/032 — không được bỏ sót tầng 2 chỉ vì "đã gate ở decorator rồi".
- `identity-projection-verdicts.ts` — +1 dòng (`namesByUserIdsTx`, basis `identity-gated`, `cond` thật theo §5 — KHÔNG còn `cond=true`), `BASIS_CEILINGS['identity-gated']` 15→16.
- `permission.service.ts` `SENSITIVE_SCREEN_GATE_PAIRS` — +7 dòng (`view:candidate`, `create:candidate`, `update:candidate`, `move-stage:candidate`, `comment:candidate`, `export:candidate`, `convert:candidate`); `sensitive-screen-gate-allowlist.spec.ts` tự xanh khi allowlist theo kịp (KHÔNG sửa spec).
- `param-uuid-ratchet` — giữ `=== 1` (mọi `:id`/`:noteId` có `ParseUUIDPipe`).
- `body-validation-census` — mọi route ghi có `@UsePipes(ZodValidationPipe)` cấp METHOD + DTO `createZodDto`; route đọc có query — `ZodValidationPipe` tại tham số `@Query` (§2 đầu mục).

---

## 10. Thứ tự thi công + lệnh verify

0. **Sửa `harness/backlog.mjs` `paths` của `S12-RECRUIT-BE-1`** TRƯỚC khi code — danh sách đầy đủ ở §1.1 điểm 4 (thêm `notifications/**`, `employees/**`, `permission/**`, `docs/API Design/API-17*`, `docs/erd-current.md`; KHÔNG thêm `events/**`/`foundation/sequences/**`). Xác nhận nhánh `wo/s12-recruit-be-1` branch từ `master` (PR #448 đã merge — kiểm `git log master | grep DB-1` trước khi branch). **Ngay sau khi branch, TRƯỚC khi viết controller:** `rg "GRANT" apps/api/migrations/0559_s12recruitdb1_recruit_ddl.sql` — đối chiếu LẠI đúng 8 dòng GRANT cấp-cột đã đo ở §0 (job_openings/candidates/candidate_notes/interviews table-level; candidate_stage_events/interview_participants SELECT+INSERT; interview_feedbacks 4 cột; offers 8 cột). Lệch với §0 (kể cả 1 cột) ⇒ **DỪNG, báo owner** — WO này CẤM migration, một khác biệt nghĩa là schema đã đổi ngoài kiểm soát của plan.
1. Dựng lane: `bash scripts/lane-db-setup.sh recruitbe1` → `export LANE_DB=mediaos_recruitbe1`.
2. RED: viết đủ unit-spec + int-spec §9 trước (import module chưa tồn tại ⇒ đỏ tự nhiên).
3. Thi công theo thứ tự: `packages/contracts/src/recruit.ts` (mở rộng DTO, giữ 4 enum) → `recruit-fsm.ts` → `recruit.dto.ts` (kèm query schema cho list/export/picker) → `recruit.errors.ts` → `recruit-people.repository.ts` (§5, `servingPair` tham số hoá) → `recruit-access.service.ts` → `recruit.mapper.ts` (điểm masking DUY NHẤT, §4.4/4.5) → 4 repository (`job-openings`/`candidates`/`interviews`/`offers`) → 4 service (mỗi service tự re-assert cặp quyền — tầng 2, §6.1 bước Pha-3.2) → `hr-write.service.ts` (đổi `allocateEmployeeCode` → `public` + thêm `createEmployeeFromCandidateTx`, KHÔNG đụng `SequenceService`) → `recruit-convert.service.ts` (3 pha, §6.1) → 5 controller (query param qua `ZodValidationPipe`) → `recruit-candidate-file.resolver.ts` (isSensitive:true, §7) → `recruit.module.ts` → `app.module.ts` (additive) → `openapi-modules.ts` (entry `RECRUIT`, segments `job-openings`,`candidates`,`interviews`,`offers`,`recruit`) → `permission.service.ts` (+7 `SENSITIVE_SCREEN_GATE_PAIRS`) → `notifications/recruit-audience.reader.ts` (hằng `RECRUIT_HR_ROLE_NAME`) + `recruit-noti-bridge.registrar.ts` (đăng ký `notifications.module.ts` providers, dedupeKey content-derived §8).
4. `LANE_DB=mediaos_recruitbe1 pnpm --filter @mediaos/api exec vitest run test/integration/recruit-be1-*.int-spec.ts src/recruit` tới xanh.
5. `ROUTE_CENSUS_WRITE=1 pnpm --filter @mediaos/api exec vitest run test/foundation/route-guard-coverage.e2e-spec.ts` — **đọc diff JSON trước khi commit** (§9.3): kiểm `routes: 539`, `gated: 500`, `ungated`/`needVerdict` KHÔNG đổi.
6. Chạy đích danh: `param-uuid-ratchet` · `body-validation-ratchet` · `identity-projection-ratchet` · `sensitive-screen-gate-allowlist.spec.ts` · `recruit-two-layer-guard-census.unit-spec.ts` (mới, §9.3) · `openapi-contract.e2e-spec` (0 route RECRUIT UNCLASSIFIED) · `route-http-coverage.e2e-spec`.
7. `bash harness/check.sh --quick` (vòng lặp) → `bash harness/check.sh --all --lane-db=recruitbe1` trước PR.
8. FULL gate: `security-reviewer` + `database-reviewer` + `silent-failure-hunter`. Vá CRITICAL/HIGH. **CẤM merge trước khi `check.sh --all` xanh** (không có ngoại lệ đọc-code-bằng-mắt).
9. Docs cùng PR: API-17 §5.2 (32 mã ⏳→✅), SPEC-12 §12 (đính chính mã 009 mở rộng `kind=org-unit-invalid` — §6.2), `docs/erd-current.md` cập nhật trạng thái "đã build BE"; `harness/backlog.mjs` flip status.

---

## 11. Rủi ro còn lại & cách chặn

| Bẫy | Áp dụng | Cách chặn |
| --- | --- | --- |
| Gọi `nextCode`/`SequenceService` trong tx đang giữ FOR UPDATE ⇒ 2 connection/lock (S5-SEQ-HARDEN-1) | convert | ĐÃ LOẠI BỎ hoàn toàn — Pha 2 cấp mã qua `allocateEmployeeCode` NGOÀI mọi tx nghiệp vụ (§6.1); `createEmployeeFromCandidateTx` không còn đụng `SequenceService` |
| `createEmployee` mint user ngoài ý muốn | convert | TUYỆT ĐỐI không gọi — viết `createEmployeeFromCandidateTx` riêng, không nhánh provision |
| Thứ tự tiền điều kiện convert (N1) — kiểm 1 LẦN duy nhất, bỏ sót Pha 3 recheck | 029 | Pha 1 fail-fast (không lock) + Pha 3 KIỂM LẠI TOÀN BỘ trong tx khoá hàng (§6.1) — Pha 1 KHÔNG được coi là đủ |
| Zod move-stage cắt `Hired` ⇒ mã 014 chết | 013 | enum ĐỦ 6 giá trị ở Zod, chặn `Hired` ở SERVICE |
| `dedupeKeyOf` dựa API không tồn tại (`auditLogId` từ `AuditService.record` trả `void`) | registrar 016 | dùng công thức content-derived `${jobOpeningId}:${userId}:${updatedAt}` (§8), KHÔNG đụng `events/**` |
| `paths` WO thiếu `notifications/**`/`employees/**`/`permission/**`/`docs/API Design/**`/`erd-current.md` | mọi bước 0 | sửa backlog TRƯỚC khi code (§1.1 điểm 4) — KHÔNG thêm `events/**`/`foundation/sequences/**` |
| Identity-projection: `cond=sql\`true\`` trần = căn cứ giả, ratchet vẫn xanh vì chỉ grep `identityColumns(` | `RecruitPeopleRepository` | `peopleVisibleCond` dựng THẬT từ `dataScope.resolveOrNull(servingPair)` mỗi lần gọi, fallback fail-closed `users.id=actor` (§5) |
| Identity-projection: nhiều điểm chiếu rời rạc thay vì 1 | `RecruitPeopleRepository` | picker 032 lọc theo `q` SAU khi bọc cột, không SELECT trần; `servingPair` tham số hoá KHÔNG tách hàm |
| Wildcard `*:*` mở khoá PII vì thiếu `isSensitive:true` | `recruit.mapper.ts`, `recruit-candidate-file.resolver.ts` | MỌI `permission.can()` cho 7 cặp `candidate` truyền `isSensitive:true` tường minh (§4.4/§7); ca test role-chỉ-`*:*`-KHÔNG-unmask |
| `SENSITIVE_CAPABILITY_ALLOWLIST` thiếu ⇒ màn ẩn với chính role được cấp | 7 cặp `candidate` | append 7 dòng — verify bằng `sensitive-screen-gate-allowlist.spec.ts` (đã tồn tại, tự chạy) |
| Mã CHẾT ERR-011 (không ca nào rơi vào 403, mọi ca đều 404) | route 023/024 | resolve tầm nhìn từ `('view','interview')` TRƯỚC (§4.3) — 3 ca test tách bạch 010/011 + ca "có feedback không có view" |
| Mã CHẾT ERR-015 (chỉ có unit test hàm tính, không ca HTTP thật) | route 010 export | int-spec seed >10.000 hàng HOẶC hạ hằng ngưỡng test-only; COUNT(*) TRƯỚC stream, không nhận `limit` từ client (§2.2) |
| Tầng guard thứ hai bị bỏ ở convert/picker vì "decorator đã gate rồi" | 029, 031, 032 | assert lại TRONG service (Pha-3.2 §6.1; pickers tương tự) + census 2 tầng theo TỪNG route × mã cặp (§9.3) |
| 404-không-403 nhưng lại lộ tồn tại qua thông điệp khác nhau | mọi sentinel 010 | MỘT message chung cho not-found/cross-tenant/ngoài-scope |
| Trần Zod ≠ trần service ⇒ mã lỗi chết | `.strict()` các PATCH | test riêng: body có field lạ → 400 Zod, KHÔNG rơi vào nhánh service nào |
| Race check-then-act | convert/offer/feedback | UNIQUE ở DB là chốt cuối, service bóc `23505` — KHÔNG dựa SELECT-rồi-INSERT để chống trùng |
| Nhầm race UNIQUE thành ca idempotency replay (dùng CÙNG key cho 2 request song song) | convert 029 | ca race PHẢI dùng 2 `Idempotency-Key` khác nhau — §6.1, tách file test khỏi `recruit-be1-idempotency.int-spec.ts` |
| `interview_participants` chỉ-INSERT nhưng đổi người lại UPDATE nhầm | 021 | PATCH interview KHÔNG nhận `participantEmployeeIds` — đổi người ngoài phạm vi v1 (SPEC không có endpoint, nếu cần thì huỷ+tạo mới ở FE) |
| `orgUnitId` đóng/xoá SAU khi vị trí tạo → map lỗi sai (409 008 thay vì 422 009) | convert | `createEmployeeFromCandidateTx` ném lỗi riêng, RECRUIT convert map 422 `009 org-unit-invalid` (§6.2) |
| Test đóng đinh lỗ hổng | mọi ca DENY | mỗi ca DENY kèm ALLOW đối chứng |
| Mã trùng thủ công (`employee_code` gieo tay trùng giá trị counter kế tiếp) không được bắt | convert | §3.6 bổ sung map `23505`/`employee_profiles_company_code_active_uq` → 409 `008 employee-code-conflict`; ca int-spec gieo trước |
| TOCTOU: trường ĐEM GHI (fullName/email/phone/orgUnitId/positionId) đọc ở Pha 1 (chưa lock) rồi dùng thẳng ở Pha 3 | convert §6.1 | Pha 3 bước 1 PHẢI đọc LẠI `candidates JOIN job_openings` TRONG câu `FOR UPDATE`, vứt bỏ giá trị Pha 1 |
| Tầng guard thứ hai đặt SAU khi đã cấp mã (Pha 2) — deny vẫn để lại side-effect (mã bị đốt oan) | convert | Assert `('convert','candidate')` (isSensitive:true) chuyển lên ĐẦU Pha 1, TRƯỚC Pha 2 — deny = 0 side-effect (mirror `assertWriteScope`) |
| `RECRUIT_ROUTE_PAIRS` không tồn tại ⇒ 3 nơi (decorator/service/`RecruitAccessService`) tự gõ lại cặp, dễ lệch | mọi route | 1 bảng hằng DUY NHẤT dùng ở cả 3 nơi + census §9.3 so cả hai tầng với CÙNG hằng này (không so tầng-với-tầng) |

**Ghi chú cho FULL gate:** `security-reviewer`/`database-reviewer` sẽ soi lại các mục #2 (thứ tự Pha 1/2/3 + tầng guard trước cấp mã), #3 (`RECRUIT_ROUTE_PAIRS` dùng đúng ở cả 3 nơi, không lệch), #5 (TOCTOU Pha 3 đọc lại toàn bộ trường ghi) **trên DIFF THẬT** khi WO này có code — plan chỉ khoá THIẾT KẾ, không thay thế review lúc merge.

---

## 12. Definition of Done (khớp `done_when` backlog)

| `done_when` (backlog) | Verify cụ thể |
| --- | --- |
| Deny-path RED-trước cho mọi route nhạy cảm; `withTenant` mọi API; guard 2 tầng (decorator + service) | `recruit-be1-scope.int-spec.ts` (15 cặp có route × deny+allow, `access:recruit` verify riêng); mọi repo qua `db.withTenant`; `recruit-two-layer-guard-census.unit-spec.ts` đối chiếu decorator vs service TỪNG route × mã cặp |
| FSM: chuyển tiếp sai → 4xx đúng mã; `Hired` terminal qua convert; `Rejected` reopen→Screening; job Closed chặn thêm candidate; trần Zod≠service không đẻ mã chết | `recruit-be1-fsm.int-spec.ts` + `recruit-fsm.spec.ts` (100% ma trận) + test `.strict()` field lạ |
| Masking SERVER: email/phone theo `update:candidate` (isSensitive:true, chống bypass `*:*`); lương theo `manage:offer`; CV Foundation Files private + `file_access_logs`; export có audit | `recruit-be1-scope.int-spec.ts` masking cases (006/010/011/018/020 + ca wildcard) + `recruit.mapper.spec.ts` + resolver `recruit-candidate-file.resolver.ts` đăng ký đúng (isSensitive:true) + `recruit-be1-audit.int-spec.ts` export (015 ca THẬT) |
| Convert: 3 pha (cấp mã ngoài tx, kiểm lại fail-closed trong tx khoá hàng) + UNIQUE `employee_id` (race 1 thắng, 2 key khác nhau); mã NV từ `allocateEmployeeCode` (ensure-on-miss có sẵn) KHÔNG hard-code prefix; chỉ khi Offer=Accepted; `orgUnitId` hỏng → 422 009 | `recruit-be1-convert.int-spec.ts` (race 2 request 2 key, thứ tự N1 recheck Pha 3, mã sequence, org-unit-invalid, counter-inactive 422) |
| Outbox NOTI đúng catalog dedupeKey content-derived (KHÔNG dựa `auditLogId`); audit mọi hành động quan trọng; `@Idempotent` POST tạo (KHÔNG thay thế ca race UNIQUE) | `recruit-be1-noti.int-spec.ts` (dedupeKey theo `updatedAt`, drift-guard role `hr`) + `recruit-be1-idempotency.int-spec.ts` (replay, tách khỏi ca race) + `recruit-be1-audit.int-spec.ts` |
| `API_MODULE_TAGS` khai RECRUIT; route-census regen có chủ đích (đọc diff, `ungated`/`needVerdict` không đổi); `:id`=UUID biên; query DTO qua `ZodValidationPipe`; test trên LANE_DB | `openapi-modules.ts` entry + `ROUTE_CENSUS_WRITE=1` regen (539/gated 500, diff đã đọc) + `param-uuid-ratchet` giữ 1 + toàn bộ int-spec chạy với `LANE_DB=mediaos_recruitbe1` |
| FULL gate PASS, `check.sh --all` xanh, người chốt merge, CẤM merge trước CI xanh | security-reviewer/database-reviewer/silent-failure-hunter PASS (3-pha convert, isSensitive, identity-gated thật, census 2 tầng — không còn điểm mở, mọi quyết định đã chốt ở §1.1); `harness/check.sh --all --lane-db=recruitbe1` xanh TRƯỚC khi merge |
