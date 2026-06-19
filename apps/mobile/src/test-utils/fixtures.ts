import type {
  ApprovalRequestDto,
  AttendanceRecordDto,
  AttendanceTodayDto,
  KpiDefinitionDto,
  KpiResultDto,
  LeaveRequestDto,
  LeaveTypeDto,
  PayslipDto,
  PayslipSummaryDto,
  TaskDto,
} from "@mediaos/contracts";

const ISO = "2026-06-16T10:00:00.000Z";
const DATE = "2026-06-16";
const UUID = "00000000-0000-0000-0000-000000000001";

/** Build a TaskDto fixture with sane defaults; override only what the test cares about. */
export function makeTask(partial: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "task-1",
    companyId: "company-1",
    taskType: "office",
    title: "Viết kịch bản tập 1",
    status: "in_progress",
    origin: "initial",
    revisionRound: 0,
    dueDate: null,
    createdAt: ISO,
    updatedAt: ISO,
    assigneeUserId: "user-1",
    stepId: null,
    stepCode: null,
    stepName: null,
    stepStatus: null,
    submissionUrl: null,
    submissionNote: null,
    workflowInstanceId: null,
    contentItemId: null,
    contentTitle: null,
    projectId: null,
    projectName: null,
    // PM-1 (mig 0420) — work item kiểu Plane (ADDITIVE; giữ fixture khớp TaskDto).
    priority: "none",
    description: null,
    startDate: null,
    sequence: null,
    displayId: null,
    projectIdentifier: null,
    stateId: null,
    stateName: null,
    stateGroup: null,
    stateColor: null,
    ...partial,
  };
}

/** Build an ApprovalRequestDto fixture. */
export function makeApprovalRequest(partial: Partial<ApprovalRequestDto> = {}): ApprovalRequestDto {
  return {
    id: "req-1",
    companyId: "company-1",
    workflowStepId: "step-1",
    requestedBy: "user-2",
    assigneeId: "user-2",
    status: "pending",
    currentLevel: 1,
    maxLevel: 1,
    decidedAt: null,
    comment: null,
    createdAt: ISO,
    ...partial,
  };
}

/** Build an AttendanceRecordDto fixture. */
export function makeAttendanceRecord(partial: Partial<AttendanceRecordDto> = {}): AttendanceRecordDto {
  return {
    id: "att-1",
    userId: "user-1",
    userFullName: "Nguyễn Văn A",
    workDate: DATE,
    workScheduleId: null,
    checkInAt: null,
    checkOutAt: null,
    checkInMethod: null,
    checkOutMethod: null,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    status: "present",
    note: null,
    ...partial,
  };
}

/** Build an AttendanceTodayDto fixture. */
export function makeAttendanceToday(partial: Partial<AttendanceTodayDto> = {}): AttendanceTodayDto {
  return {
    workDate: DATE,
    record: null,
    schedule: null,
    periodLocked: false,
    ...partial,
  };
}

/** Build a LeaveTypeDto fixture. */
export function makeLeaveType(partial: Partial<LeaveTypeDto> = {}): LeaveTypeDto {
  return {
    id: UUID,
    name: "Nghỉ phép năm",
    code: "annual",
    paid: true,
    annualQuota: 12,
    status: "active",
    ...partial,
  };
}

/** Build a LeaveRequestDto fixture. */
export function makeLeaveRequest(partial: Partial<LeaveRequestDto> = {}): LeaveRequestDto {
  return {
    id: "leave-1",
    userId: "user-1",
    userFullName: "Nguyễn Văn A",
    leaveTypeId: UUID,
    leaveTypeName: "Nghỉ phép năm",
    startDate: "2026-07-01",
    endDate: "2026-07-02",
    totalDays: 2,
    reason: null,
    status: "pending",
    taskId: null,
    approvedBy: null,
    approvedAt: null,
    reviewNote: null,
    createdAt: ISO,
    ...partial,
  };
}

/** Build a money-FREE PayslipSummaryDto fixture (list view — carries NO monetary field). */
export function makePayslipSummary(partial: Partial<PayslipSummaryDto> = {}): PayslipSummaryDto {
  return {
    id: "pay-1",
    payrollPeriodId: UUID,
    userId: "user-1",
    entryKind: "original",
    replacesPayslipId: null,
    createdAt: ISO,
    ...partial,
  };
}

/** Build a full PayslipDto fixture (money — only obtained via re-auth → getOwn). */
export function makePayslipDetail(partial: Partial<PayslipDto> = {}): PayslipDto {
  return {
    id: "pay-1",
    companyId: "company-1",
    payrollPeriodId: UUID,
    userId: "user-1",
    salaryProfileId: null,
    baseSalary: 10000000,
    totalAllowances: 1000000,
    gross: 11000000,
    net: 9500000,
    currency: "VND",
    workDays: 22,
    presentDays: 22,
    lateMinutes: 0,
    kpiAmount: null,
    bonusAmount: null,
    penaltyAmount: null,
    entryKind: "original",
    replacesPayslipId: null,
    createdBy: "user-2",
    createdAt: ISO,
    ...partial,
  };
}

/** Build a KpiDefinitionDto fixture. */
export function makeKpiDefinition(partial: Partial<KpiDefinitionDto> = {}): KpiDefinitionDto {
  return {
    id: UUID,
    companyId: "company-1",
    name: "KPI Sản xuất",
    description: null,
    weights: {
      tasksDone: 20,
      onTimeRate: 20,
      evaluationScore: 20,
      defectScore: 20,
      firstPassApprovalRate: 20,
    },
    isActive: true,
    createdAt: ISO,
    updatedAt: ISO,
    ...partial,
  };
}

/** Build a KpiResultDto fixture. */
export function makeKpiResult(partial: Partial<KpiResultDto> = {}): KpiResultDto {
  return {
    id: "kpi-1",
    companyId: "company-1",
    definitionId: UUID,
    subjectUserId: "me-1",
    subjectTeamId: null,
    periodStart: ISO,
    periodEnd: ISO,
    components: {
      tasksDone: 90,
      onTimeRate: 85,
      evaluationScore: 88,
      defectScore: 95,
      firstPassApprovalRate: 80,
    },
    totalScore: 87,
    confirmedBy: null,
    confirmedAt: null,
    computedBy: "me-1",
    createdAt: ISO,
    ...partial,
  };
}
