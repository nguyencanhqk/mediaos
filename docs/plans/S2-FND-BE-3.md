```yaml
wo: S2-FND-BE-3
zone: red
generated_by: auto-loop
reconciled_at: "cd7c8d3"
lanes:
  - id: L1-audit-objtype
    task: "[db-migration · SERIAL FIRST · crown] Thêm object_type 'retention_policy' vào CHECK audit_logs (DO-block UNION ADD-only, clone mẫu 0440/0446 — idempotent, KHÔNG rewrite cứng, KHÔNG đụng RLS/grant/FORCE) tại mig 0456, journal idx nối tiếp ĐƠN ĐIỆU sau head 0455. Sync mảng AUDIT_OBJECT_TYPES (schema/audit.ts) thêm 'retention_policy' CÙNG commit. Mở đường cho retention PATCH audit-in-tx (L3) mà KHÔNG vỡ audit_logs_object_type_chk trên Postgres thật. BẤT BIẾN #2 nguyên vẹn: chỉ MỞ RỘNG tập giá trị hợp lệ, KHÔNG cấp UPDATE/DELETE cho app role."
    builder: db-migration
    paths:
      - "apps/api/migrations/0456_s2_fndbe3_retention_audit_object_type.sql"
      - "apps/api/src/db/schema/audit.ts"
  - id: L2-contracts
    task: "[backend-builder · contracts] Zod DTO nguồn-sự-thật: (a) retention — retentionPolicyViewSchema (id/moduleCode/entityType/retentionDays/cleanupAction/archiveAfterDays/deleteAfterDays/isLegalHoldSupported/isEnabled/description/updatedAt; KHÔNG secret) + patchRetentionPolicySchema (chỉ field mutable, cleanupAction ∈ None/Archive/Delete/Anonymize, retentionDays>=0). (b) file-access-log — listFileAccessLogsQuerySchema (z.coerce page/limit + filter fileId/actorUserId/action/from/to) + fileAccessLogViewSchema WHITELIST an toàn (id/fileId/action/accessGranted/deniedReason/actorUserId/moduleCode/entityType/entityId/permissionCode/requestId/createdAt) — TUYỆT ĐỐI KHÔNG ip_address/user_agent/metadata/storage_path/signed_url. Re-export ở foundation/index.ts (hot-file append)."
    builder: backend-builder
    paths:
      - "packages/contracts/src/foundation/retention.ts"
      - "packages/contracts/src/foundation/file-access-log.ts"
      - "packages/contracts/src/foundation/index.ts"
  - id: L3-retention-api
    task: "[backend-builder · crown · depends L1,L2] RetentionController (@Controller('foundation'), PermissionGuard opt-in, ZodValidationPipe): GET /foundation/retention-policies (@RequirePermission('view','foundation-retention')) → listPolicies (thêm method: mọi policy deleted_at IS NULL của tenant, cả disabled) + PATCH /foundation/retention-policies/:id (@RequirePermission('manage','foundation-retention') — System-scope/sensitive). Sửa updatePolicy: fail-closed NotFound khi 0 row (KHÔNG NPE/500), ghi AuditService.record CÙNG tx (object_type='retention_policy', action CONFIG_UPDATE/RetentionPolicyUpdated, old/new = snapshot config, permissionCode FOUNDATION.RETENTION.MANAGE) → inject AuditService (import EventsModule vào RetentionModule). MỞ RỘNG PROTECTED_TABLES phủ ĐỦ tập append-only/ledger (BẤT BIẾN #2): thêm file_access_logs, login_logs, user_security_events, api_key_usages, security_alerts, attendance_logs, leave_balance_transactions, task_activity_logs, notification_delivery_logs, employee_status_histories. Tạo RetentionModule (DatabaseModule/PermissionModule/EventsModule) + wire vào FoundationModule (ADDITIVE, hot-file append)."
    builder: backend-builder
    paths:
      - "apps/api/src/foundation/retention/**"
      - "apps/api/src/foundation/foundation.module.ts"
  - id: L4-file-access-log-viewer
    task: "[backend-builder · crown · depends L2] FileAccessLogController (@Controller('foundation/file-access-logs'), PermissionGuard opt-in): GET (@RequirePermission('view','foundation-file-access-log')) → list masked + pagination (paginated()/toPagination) + filter fileId/actorUserId/action/from-to; đọc qua withTenant (RLS tenant-isolation). Thêm read/list method (service riêng file-access-log-read.service.ts hoặc mở rộng FileAccessLogService) map row → fileAccessLogViewSchema (WHITELIST — KHÔNG ip/user_agent/metadata/secret). APPEND-ONLY: TUYỆT ĐỐI KHÔNG endpoint POST/PATCH/DELETE trên file_access_logs. Wire controller vào FilesModule (files.module.ts append controllers[])."
    builder: backend-builder
    paths:
      - "apps/api/src/foundation/files/**"
acceptanceChecks:
  - "GET /api/v1/foundation/retention-policies trả danh sách policy (deleted_at IS NULL, gồm cả disabled) của tenant qua withTenant; gate view:foundation-retention; thiếu quyền → 403."
  - "PATCH /api/v1/foundation/retention-policies/:id gate manage:foundation-retention (is_sensitive=true, System-scope — company-admin có view NHƯNG KHÔNG có manage ⇒ PATCH 403); cập nhật đúng field mutable; 0 row → NotFound (KHÔNG 500/NPE)."
  - "updatePolicy ghi audit CÙNG tx (object_type='retention_policy' ∈ AUDIT_OBJECT_TYPES + CHECK DB sau mig 0456; old/new = snapshot config; changed_fields auto; masker áp) — verify integration INSERT audit KHÔNG vỡ audit_logs_object_type_chk trên Postgres thật."
  - "runCleanup TUYỆT ĐỐI KHÔNG xóa bảng append-only: với entityType ∈ {audit_logs, file_access_logs, login_logs, user_security_events, api_key_usages, security_alerts, leave_balance_transactions, attendance_logs, task_activity_logs, notification_delivery_logs, employee_status_histories, payslips, seed_batches...} → deletedRecords=0 kể cả isEnabled=true + action=Delete + dryRun=false (PROTECTED_TABLES mở rộng đủ, BẤT BIẾN #2)."
  - "runCleanup vẫn giữ safety cũ: !isEnabled → skippedDisabled=true deletedRecords=0 (§17.4.1); dryRun mặc định true; entity_type validate regex chống SQL-injection."
  - "GET /api/v1/foundation/file-access-logs trả list masked + pagination block (page/per_page/total) + filter fileId/actorUserId/action/from-to; gate view:foundation-file-access-log; thiếu quyền → 403."
  - "Response file-access-log WHITELIST: KHÔNG chứa ip_address/user_agent/metadata/storage_path/signed_url/secret (assert field-absence trong DTO test)."
  - "file_access_logs APPEND-ONLY: KHÔNG tồn tại route POST/PATCH/DELETE trên /foundation/file-access-logs (chỉ GET) — REVOKE UPDATE/DELETE ở mig 0433 giữ nguyên."
  - "2-tenant isolation (withTenant + RLS+FORCE): tenant A KHÔNG thấy/không sửa retention-policy & file-access-log của tenant B (BẤT BIẾN #1)."
  - "Contracts: retentionPolicyViewSchema/patchRetentionPolicySchema + listFileAccessLogsQuerySchema/fileAccessLogViewSchema build sạch (dual ESM/CJS) + re-export ở foundation/index; controller parse qua ZodValidationPipe; không lộ secret trong DTO."
  - "DoD §8: RetentionModule + FileAccessLogController wired vào app (FoundationModule/FilesModule ADDITIVE), FE loading/error/empty do S2-FE-FND-6 xử lý (BE unblock), test có, audit-on-CONFIG cho PATCH, không phá luồng chính, cập nhật backlog.mjs."
testTasks:
  - "RED deny-path (viết TRƯỚC, permission) — retention: user có view thiếu manage → GET 200, PATCH /retention-policies/:id → 403; user không quyền → cả GET+PATCH 403 (gate FOUNDATION.RETENTION.VIEW/MANAGE)."
  - "RED deny-path (viết TRƯỚC, permission) — file-access-log: user thiếu view:foundation-file-access-log → GET /file-access-logs 403; khẳng định KHÔNG có route mutate (append-only)."
  - "Integration DB cô lập (LANE_DB, CLAUDE.md §9.5) 2-tenant RLS: seed policy + file_access_logs cho tenant A & B; assert GET của A KHÔNG trả row của B; PATCH policy B từ ngữ cảnh A → NotFound/deny (withTenant+RLS+FORCE)."
  - "Integration audit-in-tx: PATCH retention-policy trên Postgres thật (sau mig 0456) → 1 row audit_logs object_type='retention_policy', old/new snapshot đúng, changed_fields chỉ tên field, KHÔNG secret; INSERT KHÔNG vỡ CHECK."
  - "Unit retention (mở rộng retention.service.spec): runCleanup trên MỌI bảng append-only mới trong PROTECTED_TABLES → deletedRecords=0 dù isEnabled=true+action=Delete+dryRun=false; giữ case !isEnabled/dryRun cũ."
  - "Contract/masking test — file-access-log: fileAccessLogViewSchema.parse(row) loại bỏ ip_address/user_agent/metadata; assert response GET không chứa các key nhạy cảm (no-secret-log)."
  - "QA đối chiếu: happy-path GET list + PATCH cho admin có đủ quyền (view+manage cấp per-user vì manage is_sensitive KHÔNG seed theo role); coverage ≥80% cho module nhạy cảm (retention purge governance)."
steps:
  - "Thứ tự thi công 2 wave. WAVE 0 (song song, độc lập): L1 (db-migration nối tiếp — mig 0456 thêm 'retention_policy' vào CHECK + sync AUDIT_OBJECT_TYPES) ‖ L2 (contracts DTO retention + file-access-log + index re-export). WAVE 1 (song song, sau khi wave 0 xanh): L3 (retention API — cần L1 cho object_type audit + L2 cho DTO) ‖ L4 (file-access-log viewer — cần L2 cho DTO)."
  - "L1: soạn 0456_s2_fndbe3_retention_audit_object_type.sql theo DO-block UNION ADD-only (clone 0440), lấy idx journal kế tiếp sau head 0455 từ meta/_journal.json; thêm 'retention_policy' vào mảng AUDIT_OBJECT_TYPES trong schema/audit.ts CÙNG commit; verify `pnpm db:migrate` trên LANE_DB cô lập (CLAUDE.md §9.5) — INSERT audit object_type='retention_policy' KHÔNG vỡ CHECK."
  - "L2: viết retention.ts + file-access-log.ts (z.coerce cho query-string; patch schema chỉ field mutable; view schema WHITELIST), append re-export vào foundation/index.ts; `pnpm --filter @mediaos/contracts build` (turbo dual-build) TRƯỚC khi L3/L4 consume."
  - "L3 (RED→GREEN): viết deny-path test TRƯỚC (thiếu manage → PATCH 403; có view thiếu manage → GET 200 PATCH 403; 2-tenant RLS deny); rồi RetentionController + RetentionModule + listPolicies + audit-in-tx updatePolicy (fail-closed NotFound) + mở rộng PROTECTED_TABLES + wire FoundationModule; chạy retention.service.spec bổ sung case runCleanup trên các bảng append-only mới → deletedRecords=0 kể cả enabled+Delete."
  - "L4 (RED→GREEN): viết deny-path test TRƯỚC (thiếu view:foundation-file-access-log → 403; 2-tenant RLS không thấy log tenant khác); rồi FileAccessLogController + read/list method masked + wire FilesModule; test khẳng định response KHÔNG chứa ip_address/user_agent/metadata/storage_path/signed_url và KHÔNG có route mutate."
  - "Gate: FULL (security-reviewer — retention purge governance + access-log no-secret-leak + silent-failure-hunter nếu có; database-reviewer cho L1; typescript-reviewer baseline) + santa-method cho L3 (crown). Người chốt red-zone TRƯỚC merge; cập nhật harness/backlog.mjs done_when."
```

## GAP-ANALYSIS (code hiện tại vs done_when)

1. **RetentionService MỒ CÔI** — không Controller/Module, không wire vào bất kỳ NestJS module nào (chỉ import ở schema + spec). Cần tạo RetentionController + RetentionModule + wire FoundationModule (ADDITIVE). FoundationModule doc-comment ghi rõ 'retention/seed/sequences = service-only mồ côi, CHƯA gom (YAGNI)' — WO này chính là consumer làm nó có endpoint.

2. **THIẾU listPolicies** — service chỉ có getPolicy (single) + listEnabledPolicies (chỉ enabled). GET cần LIST mọi policy non-deleted (cả disabled). Thêm method mới.

3. **updatePolicy KHÔNG ghi audit** (done_when yêu cầu 'thay đổi ghi audit trong tx'). Cần inject AuditService (EventsModule đã export @Global) + record CÙNG tx theo mẫu CompanyService.updateCompany (fail-closed NotFound khi 0 row, snapshot old/new, masker+changed_fields auto).

4. **object_type 'retention_policy' CHƯA có trong AUDIT_OBJECT_TYPES/CHECK** — audit INSERT sẽ vỡ audit_logs_object_type_chk trên Postgres thật (TIỀN LỆ 'sequence_counter' đã cảnh báo y hệt trong schema/audit.ts). BẮT BUỘC lane db-migration 0456 (DO-block UNION ADD clone 0440/0446) + sync mảng CÙNG commit. Đây là điều kiện chặn L3.

5. **PROTECTED_TABLES hiện thiếu** file_access_logs/login_logs/user_security_events/api_key_usages/security_alerts + ledger set (leave_balance_transactions/attendance_logs/task_activity_logs/notification_delivery_logs/employee_status_histories). done_when 'KHÔNG cho purge bảng append-only (audit/ledger/access-log)' + BẤT BIẾN #2 (CLAUDE.md §2.2) yêu cầu mở rộng đủ tập.

6. **FileAccessLogService INSERT-only** (record). Cần thêm read/list masked. file_access_logs LƯU ip_address/user_agent/metadata (schema files.ts L167-170) → view DTO phải WHITELIST, loại các cột này (done_when: no storage_path/signed_url/secret; +PII ip/ua).

## ĐÃ CÓ (không làm lại)

- Permissions seed mig 0435 — view/manage:foundation-retention (manage is_sensitive=true, System-scope, KHÔNG seed theo role → cấp per-user) + view:foundation-file-access-log (đã grant company-admin qua LIKE 'foundation-%' AND is_sensitive=false). KHÔNG cần migration permission.
- Bảng data_retention_policies (0435) + file_access_logs (0433, RLS+FORCE+REVOKE UPDATE/DELETE) đã tồn tại.
- Pattern route/guard = CompanyController (@RequirePermission(action,'foundation-*'), PermissionGuard opt-in fail-closed).
- paginated()/toPagination() có sẵn ở common/pagination.

## INVARIANTS

- **#1** mọi read/write qua withTenant(companyId) (RLS+FORCE).
- **#2** audit/file_access_logs append-only (KHÔNG mutate route, KHÔNG cấp UPDATE/DELETE, CHECK object_type chỉ UNION-tăng); retention KHÔNG hard-delete policy (soft-delete) + KHÔNG purge bảng bảo vệ.
- **#3** KHÔNG secret/PII/storage_path/signed_url/ip/user_agent vào DTO hay audit before/after (masker + whitelist).

## VERIFY

Chạy test trên DB cô lập LANE_DB (`bash scripts/lane-db-setup.sh` + `export LANE_DB=...`) vì drizzle migrator áp đơn điệu — DB chung bỏ qua band thấp gây xanh/đỏ-giả. Integration audit + object_type CHECK phải chạy trên Postgres thật (không mock) để bắt lỗi vỡ CHECK.

## GATE

FULL — security-reviewer (retention purge governance + access-log no-secret-leak) + database-reviewer (L1 migration/CHECK/RLS) + silent-failure-hunter + typescript-reviewer baseline + santa-method cho L3 (crown). Người chốt red-zone TRƯỚC merge (WO zone=red).

## SCOPE-EXTENSION FLAG (cần owner ack)

done_when 'audit trong tx' buộc mở rộng paths NGOÀI khai báo WO — thêm `apps/api/migrations/0456_*.sql` + `apps/api/src/db/schema/audit.ts` (L1) và `apps/api/src/foundation/foundation.module.ts` (L3 wire). guard-scope sẽ cảnh báo; đề nghị bổ sung 3 path này vào WO.paths. Phương án thay thế (nếu owner từ chối mở rộng): GATE integration audit-test theo sự hiện diện 'retention_policy' trong CHECK (skip có chú thích, KHÔNG xanh-giả) — theo tiền lệ sequence_counter; nhưng như vậy done_when 'ghi audit trong tx' KHÔNG đạt đủ trên prod. ƯU TIÊN phương án migration.

## OUT-OF-SCOPE

- RetentionCleanupJob wiring BullMQ/cron (nợ lane BE-9/job).
- Endpoint run/simulate cleanup (foundation-job perms tách riêng).
- FE màn hình (S2-FE-FND-6 consume).
- GET single policy /:id (chỉ cần list+patch theo done_when — có thể thêm nếu FE cần).
