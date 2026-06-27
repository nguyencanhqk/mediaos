import { describe, expect, it } from "vitest";
import {
  createTaskSchema,
  taskSchema,
  taskTypeSchema,
  updateTaskStatusSchema,
} from "./task";

/**
 * G9-1 — Contract test (Definition of Done): the unified `tasks` hub must accept a
 * NON-VIDEO task (`task_type='office'`) WITHOUT `content_item_id` / `workflow_instance_id` /
 * `project_id`. Written RED-first: these symbols/fields do not exist until G9-1 lands.
 */

describe("taskTypeSchema (G9-1: 7 spec types + workflow_step back-compat)", () => {
  it.each([
    "production",
    "review",
    "revision",
    "meeting_action",
    "office",
    "finance",
    "hr",
  ])("accepts spec task_type %s", (t) => {
    expect(taskTypeSchema.parse(t)).toBe(t);
  });

  it("keeps workflow_step for backward-compat (G4/G7 emit this)", () => {
    expect(taskTypeSchema.parse("workflow_step")).toBe("workflow_step");
  });

  it("rejects an unknown task_type", () => {
    expect(() => taskTypeSchema.parse("totally_made_up")).toThrow();
  });
});

describe("createTaskSchema (G9-2 manual office task)", () => {
  it("creates a non-video office task with ONLY a title (no content/workflow/project)", () => {
    const parsed = createTaskSchema.parse({ title: "Đặt vé công tác Đà Nẵng" });
    expect(parsed.title).toBe("Đặt vé công tác Đà Nẵng");
    expect(parsed.taskType).toBe("office"); // default — manual tasks are office
    // Crucially: no contentItemId / workflowInstanceId required.
    expect("contentItemId" in parsed).toBe(false);
    expect("workflowInstanceId" in parsed).toBe(false);
  });

  it("accepts optional assignee / project / due date", () => {
    const parsed = createTaskSchema.parse({
      title: "Chuẩn bị phòng họp",
      assigneeUserId: "11111111-1111-1111-1111-111111111111",
      projectId: "22222222-2222-2222-2222-222222222222",
      dueDate: "2026-07-01T09:00:00.000Z",
    });
    expect(parsed.assigneeUserId).toBe("11111111-1111-1111-1111-111111111111");
    expect(parsed.projectId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("rejects an empty title", () => {
    expect(() => createTaskSchema.parse({ title: "" })).toThrow();
  });

  it("rejects a non-manual task_type (workflow tasks are emitted, not hand-created)", () => {
    expect(() => createTaskSchema.parse({ title: "x", taskType: "workflow_step" })).toThrow();
  });
});

describe("updateTaskStatusSchema (G9-3 shortened office flow)", () => {
  it.each(["not_started", "in_progress", "completed"])(
    "accepts shortened-flow status %s",
    (s) => {
      expect(updateTaskStatusSchema.parse({ status: s }).status).toBe(s);
    },
  );

  it("rejects review-cycle statuses (those belong to the workflow FSM)", () => {
    expect(() => updateTaskStatusSchema.parse({ status: "waiting_review" })).toThrow();
    expect(() => updateTaskStatusSchema.parse({ status: "approved" })).toThrow();
  });
});

describe("taskSchema (DTO shape for a non-video office task)", () => {
  it("validates an office task row with null content/workflow/project context", () => {
    const officeTask = {
      id: "33333333-3333-3333-3333-333333333333",
      companyId: "44444444-4444-4444-4444-444444444444",
      taskType: "office" as const,
      title: "Đặt vé công tác",
      status: "not_started" as const,
      origin: "initial" as const,
      revisionRound: 0,
      dueDate: null,
      createdAt: "2026-06-12T00:00:00.000Z",
      updatedAt: "2026-06-12T00:00:00.000Z",
      assigneeUserId: null,
      // Workflow context — all null for an office task
      stepId: null,
      stepCode: null,
      stepName: null,
      stepStatus: null,
      submissionUrl: null,
      submissionNote: null,
      workflowInstanceId: null,
      // Content / project context — all null for an office task
      contentItemId: null,
      contentTitle: null,
      projectId: null,
      projectName: null,
      // PM-1 (mig 0420) work-item fields — office task: priority 'none', rest null (no project/state).
      priority: "none" as const,
      description: null,
      startDate: null,
      sequence: null,
      displayId: null,
      projectIdentifier: null,
      stateId: null,
      stateName: null,
      stateGroup: null,
      stateColor: null,
    };
    const parsed = taskSchema.parse(officeTask);
    expect(parsed.taskType).toBe("office");
    expect(parsed.contentItemId).toBeNull();
    expect(parsed.workflowInstanceId).toBeNull();
    expect(parsed.priority).toBe("none");
    expect(parsed.stateId).toBeNull();
  });

  it("validates a project-scoped work item with PM fields populated", () => {
    const issue = {
      id: "33333333-3333-3333-3333-333333333333",
      companyId: "44444444-4444-4444-4444-444444444444",
      taskType: "office" as const,
      title: "Thiết kế trang chủ",
      status: "in_progress" as const,
      origin: "initial" as const,
      revisionRound: 0,
      dueDate: null,
      createdAt: "2026-06-12T00:00:00.000Z",
      updatedAt: "2026-06-12T00:00:00.000Z",
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
      projectId: "55555555-5555-5555-5555-555555555555",
      projectName: "Website",
      priority: "high" as const,
      description: "Mô tả",
      startDate: null,
      sequence: 12,
      displayId: "WEB-12",
      projectIdentifier: "WEB",
      stateId: "66666666-6666-6666-6666-666666666666",
      stateName: "In Progress",
      stateGroup: "started" as const,
      stateColor: "#3b82f6",
    };
    const parsed = taskSchema.parse(issue);
    expect(parsed.displayId).toBe("WEB-12");
    expect(parsed.priority).toBe("high");
    expect(parsed.stateGroup).toBe("started");
  });
});
