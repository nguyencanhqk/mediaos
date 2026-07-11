import { Injectable, OnModuleInit } from "@nestjs/common";
import type { EventContext } from "../events/event-bus";
import { DatabaseService } from "../db/db.service";
import { OutboxNotificationBridge } from "./outbox-notification-bridge.service";
import { TaskAudienceReader, type TaskAudience } from "./task-audience.reader";

const SOURCE_MODULE_TASK = "TASK";
const SOURCE_ENTITY_TASK = "task";
const SOURCE_ENTITY_PROJECT = "project";
const EMPTY_AUDIENCE: TaskAudience = {
  assigneeUserId: null,
  creatorUserId: null,
  watcherUserIds: [],
};

function strField(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function strArrayField(payload: Record<string, unknown>, key: string): string[] {
  const v = payload[key];
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
}

/**
 * S4-INT-1 — TaskNotiBridgeRegistrar: đăng ký 8 mapping TASK/PROJECT → NOTI (SPEC-06 §19 Producer, bảng
 * §9.4 nghiệm thu) lên `OutboxNotificationBridge` TẠI BOOT (OnModuleInit, mirror `attendance.module.ts`
 * `LeaveApprovedSyncRegistrar`). Import từ `notifications/**` — KHÔNG import `TasksModule` (giữ acyclic,
 * mirror `TaskReminderJobHandler` đọc thẳng bảng `tasks` thay vì gọi service của TasksModule).
 *
 * Recipient theo audience HIỆN TẠI (TaskAudienceReader đọc lại tasks/task_watchers tại thời điểm consumer
 * chạy — SAU commit của tx producer, KHÔNG dựa field rời rạc trong payload để tránh lệch tên cột giữa các
 * producer, vd payload comment mang `assigneeEmployeeId` — EMPLOYEE id — trong khi engine cần user_id):
 *   TASK_ASSIGNED           = assignee mới.
 *   TASK_ASSIGNEE_CHANGED   = assignee mới ∪ watchers (KHÔNG assignee cũ — audience đọc SAU khi đã đổi).
 *   TASK_STATUS_CHANGED     = reporter(creator) ∪ assignee ∪ watchers.
 *   TASK_PRIORITY_CHANGED   = assignee ∪ watchers.
 *   TASK_DUE_DATE_CHANGED   = assignee ∪ watchers.
 *   TASK_COMMENT_CREATED    = assignee ∪ reporter(creator) ∪ watchers.
 *   TASK_MENTIONED          = mentionedUserIds (đọc thẳng payload — producer đã resolve sẵn).
 *   PROJECT_MEMBER_ADDED    = memberUserId (đọc thẳng payload).
 * Actor-exclusion KHÔNG làm ở đây — bridge truyền nguyên `actorUserId`, engine (`NotificationRecipient-
 * ResolverService`) tự loại actor khỏi danh sách trên (BẤT BIẾN thiết kế — KHÔNG lặp logic 2 nơi).
 */
@Injectable()
export class TaskNotiBridgeRegistrar implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly reader: TaskAudienceReader,
    private readonly bridge: OutboxNotificationBridge,
  ) {}

  onModuleInit(): void {
    this.registerTaskAssigned();
    this.registerTaskAssigneeChanged();
    this.registerTaskStatusChanged();
    this.registerTaskPriorityChanged();
    this.registerTaskDueDateChanged();
    this.registerTaskCommentCreated();
    this.registerTaskMentioned();
    this.registerProjectMemberAdded();
  }

  /** Audience HIỆN TẠI của task trong payload (`taskId`) — mở tx đọc RIÊNG (KHÔNG chung tx với engine.intake,
   *  engine tự mở tx ghi của nó). Thiếu `taskId` (payload hỏng) ⇒ audience rỗng, KHÔNG throw (fail-soft đọc). */
  private async audienceOf(ctx: EventContext): Promise<TaskAudience> {
    const taskId = strField(ctx.payload, "taskId");
    if (!taskId) return EMPTY_AUDIENCE;
    return this.db.withTenant(ctx.companyId, (tx) =>
      this.reader.resolve(tx, ctx.companyId, taskId),
    );
  }

  private registerTaskAssigned(): void {
    this.bridge.registerSource({
      eventType: "task.assigned",
      eventCode: "TASK_ASSIGNED",
      sourceModule: SOURCE_MODULE_TASK,
      sourceEntityType: SOURCE_ENTITY_TASK,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "taskId"),
      resolveRecipients: async (ctx) => {
        const a = await this.audienceOf(ctx);
        return a.assigneeUserId ? [a.assigneeUserId] : [];
      },
    });
  }

  private registerTaskAssigneeChanged(): void {
    this.bridge.registerSource({
      eventType: "task.assignee_changed",
      eventCode: "TASK_ASSIGNEE_CHANGED",
      sourceModule: SOURCE_MODULE_TASK,
      sourceEntityType: SOURCE_ENTITY_TASK,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "taskId"),
      resolveRecipients: async (ctx) => {
        const a = await this.audienceOf(ctx);
        return [a.assigneeUserId, ...a.watcherUserIds].filter((x): x is string => Boolean(x));
      },
    });
  }

  private registerTaskStatusChanged(): void {
    this.bridge.registerSource({
      eventType: "task.status_changed",
      eventCode: "TASK_STATUS_CHANGED",
      sourceModule: SOURCE_MODULE_TASK,
      sourceEntityType: SOURCE_ENTITY_TASK,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "taskId"),
      resolveRecipients: async (ctx) => {
        const a = await this.audienceOf(ctx);
        return [a.creatorUserId, a.assigneeUserId, ...a.watcherUserIds].filter((x): x is string =>
          Boolean(x),
        );
      },
    });
  }

  private registerTaskPriorityChanged(): void {
    this.bridge.registerSource({
      eventType: "task.priority_changed",
      eventCode: "TASK_PRIORITY_CHANGED",
      sourceModule: SOURCE_MODULE_TASK,
      sourceEntityType: SOURCE_ENTITY_TASK,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "taskId"),
      resolveRecipients: async (ctx) => {
        const a = await this.audienceOf(ctx);
        return [a.assigneeUserId, ...a.watcherUserIds].filter((x): x is string => Boolean(x));
      },
    });
  }

  private registerTaskDueDateChanged(): void {
    this.bridge.registerSource({
      eventType: "task.due_date_changed",
      eventCode: "TASK_DUE_DATE_CHANGED",
      sourceModule: SOURCE_MODULE_TASK,
      sourceEntityType: SOURCE_ENTITY_TASK,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "taskId"),
      resolveRecipients: async (ctx) => {
        const a = await this.audienceOf(ctx);
        return [a.assigneeUserId, ...a.watcherUserIds].filter((x): x is string => Boolean(x));
      },
    });
  }

  private registerTaskCommentCreated(): void {
    this.bridge.registerSource({
      eventType: "task.comment_created",
      eventCode: "TASK_COMMENT_CREATED",
      sourceModule: SOURCE_MODULE_TASK,
      sourceEntityType: SOURCE_ENTITY_TASK,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "taskId"),
      resolveRecipients: async (ctx) => {
        const a = await this.audienceOf(ctx);
        return [a.assigneeUserId, a.creatorUserId, ...a.watcherUserIds].filter((x): x is string =>
          Boolean(x),
        );
      },
    });
  }

  private registerTaskMentioned(): void {
    this.bridge.registerSource({
      eventType: "task.mentioned",
      eventCode: "TASK_MENTIONED",
      sourceModule: SOURCE_MODULE_TASK,
      sourceEntityType: SOURCE_ENTITY_TASK,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "taskId"),
      resolveRecipients: (ctx) => Promise.resolve(strArrayField(ctx.payload, "mentionedUserIds")),
    });
  }

  private registerProjectMemberAdded(): void {
    this.bridge.registerSource({
      eventType: "project.member_added",
      eventCode: "PROJECT_MEMBER_ADDED",
      sourceModule: SOURCE_MODULE_TASK,
      sourceEntityType: SOURCE_ENTITY_PROJECT,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "projectId"),
      resolveRecipients: (ctx) => {
        const v = strField(ctx.payload, "memberUserId");
        return Promise.resolve(v ? [v] : []);
      },
    });
  }
}
