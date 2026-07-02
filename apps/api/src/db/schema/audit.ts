import { desc } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { users } from "./users";

/**
 * audit_logs — append-only (BẤT BIẾN #2). DDL/RLS/grant ở migration 0003. app role chỉ INSERT/SELECT
 * (không UPDATE/DELETE). Cột chốt theo plan G2-4. KHÔNG ghi secret/hash vào before/after (bất biến #3).
 *
 * FOUNDATION-DB-2 (mig 0432) NÂNG về DB-08 §8.5 ADDITIVE: thêm cột module_code/entity_type/entity_id/
 * actor_type/old_values/new_values/changed_fields/sensitivity_level/result_status/request_id/
 * correlation_id/ip_address (đều nullable — writer cũ KHÔNG vỡ). CHECK actor_type/sensitivity_level/
 * result_status (cho phép NULL) ở DB; KHÔNG biểu diễn được bằng Drizzle schema → chỉ sống trong SQL.
 * Cột cũ object_type/object_id/before/after/ip/user_agent GIỮ NGUYÊN (AuditService v1 vẫn dùng);
 * AuditService v2 (FOUNDATION-BE-3) điền cột mới + tự tính changed_fields từ old/new.
 *
 * S0-FND-DB-1 (mig 0438) HOÀN TẤT §8.5 shape ADDITIVE: thêm nốt 11 cột còn thiếu actor_employee_id/
 * action_group/entity_id_text/entity_code/permission_code/data_scope/device_info/diff_summary/
 * error_code/error_message/metadata (đều nullable). company_id GIỮ NOT NULL (lệch có chủ đích vs spec
 * nullable — N=1, bất biến #1 mạnh hơn). data_scope KHÔNG CHECK (spec §8.5 không định nghĩa) — ép enum
 * Own/Team/Department/Company/System ở tầng app (S1-FND-AUDIT-1).
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    // ── shape G2-4 cũ (GIỮ — writer v1) ──
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    // ── DB-08 §8.5 ADDITIVE (mig 0432, nullable — writer v2 FOUNDATION-BE-3 điền) ──
    moduleCode: varchar("module_code", { length: 50 }),
    entityType: varchar("entity_type", { length: 100 }),
    entityId: uuid("entity_id"),
    actorType: varchar("actor_type", { length: 50 }),
    oldValues: jsonb("old_values"),
    newValues: jsonb("new_values"),
    changedFields: jsonb("changed_fields"),
    sensitivityLevel: varchar("sensitivity_level", { length: 50 }),
    resultStatus: varchar("result_status", { length: 50 }),
    requestId: varchar("request_id", { length: 100 }),
    correlationId: varchar("correlation_id", { length: 100 }),
    ipAddress: varchar("ip_address", { length: 45 }),
    // ── DB-08 §8.5 ADDITIVE (mig 0438 — 11 cột còn thiếu, nullable; writer v2 S1-FND-AUDIT-1 điền) ──
    // actorEmployeeId: uuid KHÔNG FK (HR dùng employee_profiles) — theo tiền lệ file_access_logs.
    actorEmployeeId: uuid("actor_employee_id"),
    actionGroup: varchar("action_group", { length: 100 }),
    entityIdText: varchar("entity_id_text", { length: 255 }),
    entityCode: varchar("entity_code", { length: 255 }),
    permissionCode: varchar("permission_code", { length: 150 }),
    dataScope: varchar("data_scope", { length: 50 }),
    deviceInfo: jsonb("device_info"),
    diffSummary: text("diff_summary"),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_company_object_idx").on(t.companyId, t.objectType, t.objectId),
    // DB-08 §8.5 index (mig 0432) — parity với SQL.
    index("idx_audit_logs_company_created").on(t.companyId, desc(t.createdAt)),
    index("idx_audit_logs_entity").on(t.moduleCode, t.entityType, t.entityId),
    index("idx_audit_logs_request").on(t.requestId),
    index("idx_audit_logs_correlation").on(t.correlationId),
    // DB-08 §8.5 index (mig 0438) — parity với SQL.
    index("idx_audit_logs_actor_created").on(t.actorUserId, desc(t.createdAt)),
    index("idx_audit_logs_action").on(t.companyId, t.moduleCode, t.action, desc(t.createdAt)),
  ],
);

// CHECK constraint actor_type/sensitivity_level/result_status sống ở SQL (mig 0432) — Drizzle pg-core
// không biểu diễn enum-nullable tiện; allowed (NULL hợp lệ, additive): actor_type ∈ User/System/Job/
// Integration · sensitivity_level ∈ Normal/Sensitive/HighlySensitive · result_status ∈ Success/Failure/
// Denied/Error.

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

/** object_type cho phép (đồng bộ CHECK ở 0003+0011+0014+0020+0033+0060+0070+0081+0090+0084+0093+0099+0121+0132+0140+0150+0170+0190+0200+0300+0310+0320+0390+0410+0420+0437+0439+0440+0446+0451+0456+0457+0459+0460+0461+0462). Mở rộng = thêm ở cả hai nơi. */
export const AUDIT_OBJECT_TYPES = [
  "company",
  "user",
  "auth",
  "outbox_event",
  "workflow_instance",
  "workflow_step",
  "task",
  "approval_request",
  "employee",
  "position",
  "org_unit",
  "team",
  // G6 media
  "channel",
  "platform_account",
  "channel_account",
  "channel_member",
  // G6 project
  "project",
  "project_team",
  "project_member",
  // G6 content
  "content",
  "content_channel",
  "content_asset",
  "content_type",
  // G7 workflow builder (gom audit step/dep/checklist dưới aggregate template, objectId=templateId)
  "workflow_template",
  // G11 HR attendance/leave
  "work_schedule",
  "attendance_record",
  "attendance_adjustment_request",
  "attendance_period",
  "leave_type",
  "leave_request",
  "leave_balance",
  // G10 communication (chat realtime / notification center / meeting)
  "chat_room",
  "chat_message",
  "notification",
  "notification_rule",
  "notification_preference",
  "meeting",
  "meeting_room",
  "meeting_note",
  // G13 finance — sổ cái append-only + phân bổ + chốt lợi nhuận + đề xuất chi (xem migration 0070).
  // Quyết định duyệt chi audit trên `expense_request` (KHÔNG thêm type cho bảng log `expense_approvals`).
  "revenue_record",
  "cost_record",
  "cost_allocation",
  "profit_snapshot",
  "expense_request",
  // G8 approval (multi-level rules — ApprovalLevelApproved/ApprovalRejected dùng 'approval_request')
  "approval_rule",
  // G12 payroll (salary profile — lương nhạy cảm, ADR-0010)
  "salary_profile",
  // G8-3 evaluation (chấm điểm gắn workflow step — recordScores ghi 'evaluation_result' cùng tx)
  "evaluation_template",
  "evaluation_result",
  // (de-media-fy CLEAN-BE-1: gỡ orphan 'defect' khỏi mảng TS — module defect đã gỡ ở 892f208, không còn caller.
  //  DB CHECK GIỮ NGUYÊN 'defect' (append-only #2 — union chỉ-tăng, KHÔNG sửa CHECK); TS array = subset hợp lệ.)
  // G8-4 KPI (compute + confirm ghi 'kpi_result'; tạo/sửa định nghĩa ghi 'kpi_definition')
  "kpi_definition",
  "kpi_result",
  // G12-2 payroll period + payslip snapshot (append-only) — runPayroll/lock ghi cùng tx
  "payroll_period",
  "payslip",
  "payslip_item",
  // G12-3 bonus/penalty (thưởng/phạt — create/approve/reject ghi 'bonus_penalty' cùng tx)
  "bonus_penalty",
  // G12-4 nhân viên xác nhận/khiếu nại bảng lương (acknowledge/dispute/resolve ghi 'payslip_acknowledgement')
  "payslip_acknowledgement",
  // G3 mutation-path runtime permission mgmt (gán/thu role ghi 'user_role'; set/xoá object-permission ghi 'object_permission')
  "user_role",
  "object_permission",
  // G2-4 alerting (dead-letter threshold breach — DeadLetterAlertMonitor ghi 'dead_letter_alert' khi vượt ngưỡng)
  "dead_letter_alert",
  // G6-2 PR-A KMS provisioning. encryption_keys là registry GLOBAL no-RLS (no tenant) → provision/rewrap audit
  // qua Logger (mirror SecretRotationService), KHÔNG vào audit_logs tenant-scoped. 'encryption_key' nạp vào
  // CHECK superset (mig 0150) cho đường app-tenant-context tương lai; chỉ kms_key_id+version, KHÔNG key material.
  "encryption_key",
  // G16-1b security alerting (SecurityAlertService ghi audit 'security_alert' khi phát alert — mig 0121).
  // read-path audit (payslip/channel-health) TÁI DÙNG object_type sẵn có ('payslip'/'channel') — chỉ action mới.
  "security_alert",
  // G6-2 PR-B break-glass (mig 0200) — request/approve/activate/revoke/deny break-glass ghi 'break_glass_access'
  // audit-in-tx app-tenant (BreakGlassGrantService). KHÔNG secret/key material vào before/after (BẤT BIẾN #3).
  "break_glass_access",
  // B4 task attachments (real file upload — upload ghi 'task_attachment' TaskAttachmentUploaded,
  // soft-delete ghi TaskAttachmentDeleted; cùng tx withTenant. KHÔNG ghi storage key/secret material).
  "task_attachment",
  // G16-3 SaaS scaffold (subscription/feature-flag/usage — set plan/flag/limit ghi audit cùng tx; mig 0231).
  // Lifecycle công ty ở tầng platform (create/suspend/provision) TÁI DÙNG 'company' (chỉ action mới).
  "company_subscription",
  "feature_flag",
  "usage_limit",
  // AC-5 API key / PAT (create/revoke ghi 'api_key' audit-in-tx app-tenant; KHÔNG ghi token material — mig 0310).
  "api_key",
  // AC-4 UI config (PUT branding/navigation/i18n ghi audit-in-tx app-tenant — metadata công khai, KHÔNG secret; mig 0300).
  "tenant_branding",
  "ui_navigation",
  "i18n_override",
  // AC-6 Webhooks (create/update/delete endpoint ghi 'webhook_endpoint'; delivery lifecycle ghi 'webhook_delivery'
  // audit-in-tx app-tenant. KHÔNG ghi secret/plaintext/envelope vào before/after — chỉ id/url/active — mig 0320).
  "webhook_endpoint",
  "webhook_delivery",
  // CS-8 mail config (upsert/test SMTP ghi 'mail_config' audit-in-tx app-tenant. KHÔNG ghi SMTP password/
  // envelope vào before/after — chỉ host/port/username/scope/secure/from + hasPassword — mig 0380).
  "mail_config",
  // CS-9 security policy (PATCH /settings/security-policy ghi 'security_policy' audit-in-tx app-tenant —
  // chỉ cấu hình cờ/allowlist, KHÔNG secret/PII vào before/after — mig 0390).
  "security_policy",
  // CS-10 user invite (invite/accept/approve/reject ghi 'user_invite' audit-in-tx app-tenant — chỉ
  // email/status/id, KHÔNG token/token_hash/password_hash vào before/after — mig 0410).
  "user_invite",
  // PM-1 apps/projects (mig 0420): project_states CRUD ghi 'project_state'; labels CRUD ghi 'label'
  // audit-in-tx app-tenant. Sửa work-item (priority/state/desc/nhãn) TÁI DÙNG 'task' (chỉ action mới).
  "project_state",
  "label",
  // FOUNDATION-BE-2 sequence_counters: admin PATCH cấu hình counter ghi 'sequence_counter'/SequenceUpdated
  // audit-in-tx app-tenant (before/after = cấu hình mã, KHÔNG current_value/secret/PII). ⚠️ DB CHECK
  // object_type CHƯA chứa 'sequence_counter' (head mig 0420 thêm tới 'project_state'/'label' — 0432 KHÔNG
  // đụng CHECK). Cần lane DB (band foundation-db) thêm 'sequence_counter' vào CHECK DO-block UNION + sync
  // mảng này CÙNG commit. Tới khi đó, updateSequence ghi audit sẽ vỡ CHECK trên Postgres thật ⇒ integration
  // test updateSequence GATE theo sự hiện diện 'sequence_counter' trong CHECK (skip có chú thích, KHÔNG xanh-giả).
  "sequence_counter",
  // S1-FND-SETTING-1 settings (mig 0439): SettingService.updateCompanySetting (admin PATCH
  // /foundation/company-settings/:key) ghi audit CONFIG_UPDATE object_type='company_setting' audit-in-tx
  // app-tenant (old/new_values ĐÃ mask, KHÔNG secret_ref/secret material vào before/after — BẤT BIẾN #3).
  // 'system_setting' cho nhánh system-manage PATCH (system-setting). Bảng settings/permission seed ĐÃ ở
  // 0431/0435 — 0439 CHỈ mở rộng CHECK object_type (UNION ADD-only, append-only #2 nguyên vẹn).
  "company_setting",
  "system_setting",
  // S1-FND-FILE-1 (mig 0440): upload/link/unlink/delete file ghi audit object_type 'file' (Upload/Delete) / 'file_link' (Link/Unlink) audit-in-tx; masker che storage_path/signed_url. UNION ADD-only.
  "file",
  "file_link",
  // S2-HR-BE-3 (mig 0446): HR master-data CRUD ghi audit create/update/delete object_type 'job_level'
  // (job_levels) / 'contract_type' (contract_types) audit-in-tx app-tenant — KHÔNG secret/PII vào
  // before/after (chỉ name/code/active). 0446 UNION ADD-only vào CHECK (clone 0440), append-only #2
  // nguyên vẹn; INSERT audit KHÔNG còn vỡ CHECK trên Postgres thật.
  "job_level",
  "contract_type",
  // S2-HR-BE-4 (mig 0451): profile change request lifecycle — create/approve/reject/cancel ghi
  // 'profile_change_request' audit-in-tx app-tenant. UNION ADD-only (BẤT BIẾN #2). KHÔNG ghi
  // identity_number/bank_account/secret vào before/after (BẤT BIẾN #3 — masker che).
  "profile_change_request",
  // S2-FND-BE-3 (mig 0456): data-retention governance — admin PATCH /foundation/retention-policies/:id
  // (RetentionService.updatePolicy) ghi audit CONFIG_UPDATE object_type='retention_policy' audit-in-tx
  // app-tenant. old/new = snapshot cấu hình policy (entity_type/retention_days/action/is_enabled/dry_run…),
  // KHÔNG secret/PII vào before/after (BẤT BIẾN #3 — masker che). 0456 UNION ADD-only vào CHECK (clone
  // 0446/0440), append-only #2 nguyên vẹn; INSERT audit KHÔNG vỡ audit_logs_object_type_chk trên Postgres thật.
  "retention_policy",
  // S3-ATT-BE-3 (mig 0457): ATT shift/rule/assignment config governance — HR/Admin CRUD shift
  // (AttendanceShiftService.createShift/updateShift), attendance rule (createRule/updateRule) và
  // shift assignment (createShiftAssignment) ghi audit CREATE/CONFIG_UPDATE object_type='shift'/
  // 'attendance_rule'/'shift_assignment' audit-in-tx app-tenant. old/new = snapshot cấu hình
  // (name/code/start_time/end_time/rule params/effective range/assignment target), KHÔNG secret/PII
  // vào before/after (BẤT BIẾN #3 — masker che). Config đổi cách tính công toàn công ty = hành động
  // quan trọng (SPEC-01 §16.3). 0457 UNION ADD-only vào CHECK (clone 0456/0446/0440), append-only #2
  // nguyên vẹn; INSERT audit KHÔNG vỡ audit_logs_object_type_chk trên Postgres thật.
  "shift",
  "attendance_rule",
  "shift_assignment",
  // S2-HR-BE-7 (mig 0459, renumbered from 0457 on rescue merge): employee-code config admin — HR
  // PATCH /hr/employee-code-config (EmployeeCodeConfigService.update — API-03 §10.10 HR-API-902)
  // ghi audit CONFIG_UPDATE object_type='employee_code_config' audit-in-tx app-tenant. old/new =
  // snapshot cấu hình (prefix/pattern/number_length/allow_manual_override/status), KHÔNG
  // current_value/counter/secret/PII vào before/after (BẤT BIẾN #3 — masker che). 0459 UNION
  // ADD-only vào CHECK (clone 0458/0457/0456/0446/0440), append-only #2 nguyên vẹn; INSERT audit
  // KHÔNG vỡ audit_logs_object_type_chk trên Postgres thật.
  "employee_code_config",
  // S2-AUTH-BE-6 (mig 0460): Role write API — RoleAdminService.createRole/updateRole ghi audit
  // RoleCreated/RoleUpdated object_type='role' objectId=role.id; assignPermissionToRole/
  // revokePermissionFromRole ghi audit PermissionAssigned/PermissionRevoked object_type=
  // 'role_permission' objectId=role.id (role_permissions KHÔNG có uuid PK riêng — key hợp thành
  // role_id/permission_id/effect, dùng role.id làm objectId để truy vết được, KHÔNG NULL).
  // before/after CHỈ {action,resourceType,effect,dataScope} đã mask (BẤT BIẾN #3 — KHÔNG salary/
  // secret). 0460 UNION ADD-only vào CHECK (clone 0459/0458/0457/0456/0446/0440), append-only #2
  // nguyên vẹn; INSERT audit KHÔNG vỡ audit_logs_object_type_chk trên Postgres thật.
  "role",
  "role_permission",
  // S2-AUTH-BE-7 (mig 0461): session self-service — AuthService.revokeSession/revokeOtherSessions ghi
  // audit SessionRevoked object_type='user_session' objectId=session.id (single) hoặc objectId=userId
  // (scope='others', bulk). after CHỈ {scope,count?} — KHÔNG refresh_token_hash/access_token_jti/ip/
  // user_agent thô (BẤT BIẾN #3 — masker che nếu lọt). 0461 UNION ADD-only vào CHECK (clone 0460/0459/
  // 0458/0457/0456/0446/0440), append-only #2 nguyên vẹn; INSERT audit KHÔNG vỡ
  // audit_logs_object_type_chk trên Postgres thật.
  "user_session",
  // S2-HR-BE-6 (mig 0462): employee_contracts CRUD — HR/company-admin create/update/link/delete ghi audit
  // create/update/FileLinked/delete object_type='employee_contract' audit-in-tx app-tenant. before/after =
  // snapshot hợp đồng KHÔNG lộ PII chưa mask (note/title/metadata không chứa lương/identity — masker che nếu
  // lọt, BẤT BIẾN #3). 0462 UNION ADD-only vào CHECK (clone 0461/0460/0459/0458/0457/0456/0446/0440),
  // append-only #2 nguyên vẹn; INSERT audit KHÔNG vỡ audit_logs_object_type_chk trên Postgres thật.
  "employee_contract",
] as const;
export type AuditObjectType = (typeof AUDIT_OBJECT_TYPES)[number];
