import type { LeaveManagementListItemView } from "@mediaos/contracts";
import { numOrNull } from "./leave-request.logic";

/**
 * S3-LEAVE-BE-3 — row → DTO view mapper for the management (approval) list. snake_case DB rows →
 * camelCase FE view; numeric strings → numbers; Date → ISO string. No I/O. requester enrichment
 * (employeeCode/fullName/department) comes from the employee_profiles/users/org_units joins.
 */

/** Shape of a row from LeaveApprovalRepository.listPendingScopedTx. */
export interface PendingListRow {
  id: string;
  leaveTypeId: string;
  leaveTypeCode: string | null;
  leaveTypeName: string | null;
  startDate: string;
  endDate: string;
  durationType: string | null;
  totalDays: string;
  totalHours: string | null;
  status: string;
  reason: string | null;
  balanceEffectStatus: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectedBy: string | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  requesterUserId: string;
  requesterEmployeeCode: string | null;
  requesterFullName: string | null;
  requesterDepartment: string | null;
}

export function toManagementListItemView(row: PendingListRow): LeaveManagementListItemView {
  return {
    id: row.id,
    leaveTypeId: row.leaveTypeId,
    leaveTypeCode: row.leaveTypeCode,
    leaveTypeName: row.leaveTypeName,
    startDate: row.startDate,
    endDate: row.endDate,
    durationType: row.durationType,
    totalDays: Number(row.totalDays),
    totalHours: numOrNull(row.totalHours),
    status: row.status,
    reason: row.reason,
    balanceEffectStatus: row.balanceEffectStatus,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    requester: {
      userId: row.requesterUserId,
      employeeCode: row.requesterEmployeeCode,
      fullName: row.requesterFullName,
      department: row.requesterDepartment,
    },
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    rejectedBy: row.rejectedBy,
    rejectedAt: row.rejectedAt ? row.rejectedAt.toISOString() : null,
    rejectionReason: row.rejectionReason,
  };
}
