import type { BoardTaskDto, ProjectStateDto } from "@mediaos/contracts";

const COMPANY = "00000000-0000-0000-0000-0000000000c0";
const PROJECT = "00000000-0000-0000-0000-0000000000a1";

let seq = 1;
function uuid(): string {
  return `00000000-0000-0000-0000-${String(seq++).padStart(12, "0")}`;
}

/** State giả lập cho test board-group. */
export function makeState(over: Partial<ProjectStateDto> = {}): ProjectStateDto {
  return {
    id: uuid(),
    companyId: COMPANY,
    projectId: PROJECT,
    name: "Trạng thái",
    stateGroup: "unstarted",
    color: "#64748b",
    isDefault: false,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/** Work item giả lập (BoardTaskDto) cho test. */
export function makeTask(over: Partial<BoardTaskDto> = {}): BoardTaskDto {
  return {
    id: uuid(),
    companyId: COMPANY,
    taskType: "office",
    title: "Công việc",
    status: "not_started",
    origin: "initial",
    revisionRound: 0,
    dueDate: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    assigneeUserId: null,
    stepId: null,
    stepCode: null,
    stepName: null,
    stepStatus: null,
    submissionUrl: null,
    submissionNote: null,
    workflowInstanceId: null,
    contentItemId: null,
    contentTitle: null,
    projectId: PROJECT,
    projectName: "Dự án",
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
    labels: [],
    ...over,
  };
}
