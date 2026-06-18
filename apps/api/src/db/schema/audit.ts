import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { users } from "./users";

/**
 * audit_logs — append-only (BẤT BIẾN #2). DDL/RLS/grant ở migration 0003. app role chỉ INSERT/SELECT
 * (không UPDATE/DELETE). Cột chốt theo plan G2-4. KHÔNG ghi secret/hash vào before/after (bất biến #3).
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
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_company_object_idx").on(t.companyId, t.objectType, t.objectId)],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

/** object_type cho phép (đồng bộ CHECK ở 0003+0011+0014+0020+0033+0060+0070+0081+0090+0084+0093+0099+0121+0132+0140+0150+0170+0190+0200+0300+0310+0320+0390+0410+0420). Mở rộng = thêm ở cả hai nơi. */
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
  // G8-2 defect/revision (trả sửa — createDefect ghi 'defect' cùng tx với revision task)
  "defect",
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
] as const;
export type AuditObjectType = (typeof AUDIT_OBJECT_TYPES)[number];
