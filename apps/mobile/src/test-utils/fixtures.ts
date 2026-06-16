import type { ApprovalRequestDto, TaskDto } from "@mediaos/contracts";

const ISO = "2026-06-16T10:00:00.000Z";

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
