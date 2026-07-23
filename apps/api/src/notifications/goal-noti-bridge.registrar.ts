import { Injectable, OnModuleInit } from "@nestjs/common";
import type { EventContext } from "../events/event-bus";
import { DatabaseService } from "../db/db.service";
import { OutboxNotificationBridge } from "./outbox-notification-bridge.service";
import { GoalAudienceReader, type GoalAudience } from "./goal-audience.reader";

const SOURCE_MODULE_GOAL = "GOAL";
const SOURCE_ENTITY_GOAL = "goal";
const EMPTY_AUDIENCE: GoalAudience = { ownerUserId: null, headUserIds: [] };

function strField(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * S5-GOAL-BE-2 — GoalNotiBridgeRegistrar: đăng ký 2 mapping GOAL → NOTI (SPEC-10 §17) lên
 * `OutboxNotificationBridge` ĐÃ SHIP, TẠI BOOT (OnModuleInit, mirror `TaskNotiBridgeRegistrar`).
 * KHÔNG dựng bridge mới, KHÔNG import `GoalsModule` (giữ acyclic).
 *
 *   GOAL_ASSIGNED  = người phụ trách mục tiêu (goal cấp nhân viên: owner = chính nhân viên đó).
 *   GOAL_FINALIZED = người phụ trách ∪ trưởng đơn vị neo.
 *
 * ⚠️ `eventCode` phải VERBATIM khớp catalog seed 0507 — `registerSource()` FAIL-LOUD NGAY LÚC BOOT nếu
 * lệch (không có event enabled trong catalog). Đó là chủ ý: thà không boot còn hơn chạy im lặng và
 * không ai nhận được thông báo nào.
 *
 * Actor-exclusion KHÔNG làm ở đây — bridge truyền nguyên `actorUserId`, engine
 * (`NotificationRecipientResolverService`) tự loại actor + dedupe. Lặp lại logic ở 2 nơi là cách chắc
 * chắn để hai nơi trôi khỏi nhau.
 */
@Injectable()
export class GoalNotiBridgeRegistrar implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly reader: GoalAudienceReader,
    private readonly bridge: OutboxNotificationBridge,
  ) {}

  onModuleInit(): void {
    this.registerGoalAssigned();
    this.registerGoalFinalized();
  }

  /** Audience HIỆN TẠI của goal trong payload — mở tx đọc RIÊNG. Payload hỏng ⇒ rỗng, KHÔNG throw. */
  private async audienceOf(ctx: EventContext): Promise<GoalAudience> {
    const goalId = strField(ctx.payload, "goalId");
    if (!goalId) return EMPTY_AUDIENCE;
    return this.db.withTenant(ctx.companyId, (tx) =>
      this.reader.resolve(tx, ctx.companyId, goalId),
    );
  }

  private registerGoalAssigned(): void {
    this.bridge.registerSource({
      eventType: "goal.assigned",
      eventCode: "GOAL_ASSIGNED",
      sourceModule: SOURCE_MODULE_GOAL,
      sourceEntityType: SOURCE_ENTITY_GOAL,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "goalId"),
      resolveRecipients: async (ctx) => {
        const a = await this.audienceOf(ctx);
        return a.ownerUserId ? [a.ownerUserId] : [];
      },
    });
  }

  private registerGoalFinalized(): void {
    this.bridge.registerSource({
      eventType: "goal.finalized",
      eventCode: "GOAL_FINALIZED",
      sourceModule: SOURCE_MODULE_GOAL,
      sourceEntityType: SOURCE_ENTITY_GOAL,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "goalId"),
      resolveRecipients: async (ctx) => {
        const a = await this.audienceOf(ctx);
        return [a.ownerUserId, ...a.headUserIds].filter((x): x is string => Boolean(x));
      },
    });
  }
}
