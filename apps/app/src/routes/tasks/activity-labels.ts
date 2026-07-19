/**
 * S5-TASK-WORKSPACE-1 — bảng nhãn action activity dùng CHUNG cho timeline cấp task
 * (TaskActivityTimeline) + cấp dự án (ProjectActivityTimeline). Tách từ TaskActivityTimeline
 * (S4-FE-TASK-3) và bổ sung nhóm PROJECT_* · MEMBER_* · TASK_STATE_CHANGED · TASK_FILE_* — feed dự án
 * (TASK-API-601) trả CẢ sự kiện project-level. Action lạ (chưa có nhãn) → component fallback in
 * thẳng mã action, KHÔNG vỡ UI (mirror hành vi cũ).
 *
 * Key i18n sống ở namespace tasks: `tasks.detail.activity.actions.*` — GIỮ nguyên key cũ (không
 * churn bản dịch đã có), chỉ THÊM key mới cho nhóm project.
 */
export const ACTIVITY_ACTION_LABEL_KEYS: Record<string, string> = {
  // ── Project-level (SPEC-06 §14.19 — feed dự án) ──
  PROJECT_CREATED: "tasks.detail.activity.actions.projectCreated",
  PROJECT_UPDATED: "tasks.detail.activity.actions.projectUpdated",
  PROJECT_CLOSED: "tasks.detail.activity.actions.projectClosed",
  PROJECT_DELETED: "tasks.detail.activity.actions.projectDeleted",
  MEMBER_ADDED: "tasks.detail.activity.actions.memberAdded",
  MEMBER_ROLE_CHANGED: "tasks.detail.activity.actions.memberRoleChanged",
  MEMBER_REMOVED: "tasks.detail.activity.actions.memberRemoved",
  // ── Task lifecycle ──
  TASK_CREATED: "tasks.detail.activity.actions.taskCreated",
  TASK_UPDATED: "tasks.detail.activity.actions.taskUpdated",
  TASK_DELETED: "tasks.detail.activity.actions.taskDeleted",
  TASK_ASSIGNED: "tasks.detail.activity.actions.taskAssigned",
  TASK_ASSIGNEE_CHANGED: "tasks.detail.activity.actions.taskAssigneeChanged",
  TASK_STATUS_CHANGED: "tasks.detail.activity.actions.taskStatusChanged",
  TASK_STATE_CHANGED: "tasks.detail.activity.actions.taskStateChanged",
  TASK_PRIORITY_CHANGED: "tasks.detail.activity.actions.taskPriorityChanged",
  TASK_DUE_DATE_CHANGED: "tasks.detail.activity.actions.taskDueDateChanged",
  TASK_WATCHER_ADDED: "tasks.detail.activity.actions.taskWatcherAdded",
  TASK_WATCHER_REMOVED: "tasks.detail.activity.actions.taskWatcherRemoved",
  TASK_FILE_UPLOADED: "tasks.detail.activity.actions.taskFileUploaded",
  TASK_FILE_DELETED: "tasks.detail.activity.actions.taskFileDeleted",
  // ── Comment / checklist ──
  COMMENT_CREATED: "tasks.detail.activity.actions.commentCreated",
  COMMENT_UPDATED: "tasks.detail.activity.actions.commentUpdated",
  COMMENT_DELETED: "tasks.detail.activity.actions.commentDeleted",
  CHECKLIST_CREATED: "tasks.detail.activity.actions.checklistCreated",
  CHECKLIST_UPDATED: "tasks.detail.activity.actions.checklistUpdated",
  CHECKLIST_DELETED: "tasks.detail.activity.actions.checklistDeleted",
  CHECKLIST_ITEM_CREATED: "tasks.detail.activity.actions.checklistItemCreated",
  CHECKLIST_ITEM_UPDATED: "tasks.detail.activity.actions.checklistItemUpdated",
  CHECKLIST_ITEM_DONE: "tasks.detail.activity.actions.checklistItemDone",
  CHECKLIST_ITEM_DELETED: "tasks.detail.activity.actions.checklistItemDeleted",
};
