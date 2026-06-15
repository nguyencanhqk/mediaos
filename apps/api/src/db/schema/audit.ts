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

/** object_type cho phép (đồng bộ CHECK ở 0003+0011+0014+0020+0033+0060+0070+0081+0090+0084+0093). Mở rộng = thêm ở cả hai nơi. */
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
] as const;
export type AuditObjectType = (typeof AUDIT_OBJECT_TYPES)[number];
