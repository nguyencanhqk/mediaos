import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { EventContext } from "../events/event-bus";
import { DatabaseService } from "../db/db.service";
import { OutboxNotificationBridge } from "./outbox-notification-bridge.service";
import { RecruitAudienceReader } from "./recruit-audience.reader";

const SOURCE_MODULE_RECRUIT = "RECRUIT";

function strField(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Khoá NEO/dedupe thiếu ⇒ NÉM (mirror AssetNotiBridgeRegistrar — nhánh nuốt câm là bug-class đã vá). */
function requireField(payload: Record<string, unknown>, key: string): string {
  const v = strField(payload, key);
  if (!v) {
    throw new Error(
      `RecruitNotiBridgeRegistrar: payload outbox thiếu khoá bắt buộc '${key}' — hợp đồng recruit-noti.payload.ts lệch.`,
    );
  }
  return v;
}

/**
 * S12-RECRUIT-BE-1 — RecruitNotiBridgeRegistrar: 4 mapping RECRUIT → NOTI (SPEC-12 §17, seed 0561)
 * lên `OutboxNotificationBridge` tại boot. KHÔNG import `RecruitModule` (acyclic — tiền lệ
 * GOAL/ASSET/ROOM). KHÔNG `@SystemJobHandler` — cả 4 event đều event-driven.
 *
 * ⚠️ `dedupeKeyOf` BẮT BUỘC cả 4 (catalog 0561 `dedupe_strategy='DedupeKey'`; quên = fallback
 * `ctx.eventId` luôn khác ⇒ dedupe biến mất câm — bug-class ASSET). Khoá 016 content-derived
 * `${jobOpeningId}:${newRecruiterUserId}:${assignedAtIso}` — KHÔNG dựa `auditLogId`
 * (`AuditService.record` trả void, plan §8); `assignedAtIso` = RETURNING `updated_at` của CHÍNH câu
 * UPDATE gán recruiter ⇒ A(t1)→B→A(t2) vẫn báo lại A (2 khoá khác nhau).
 *
 * Actor-exclusion: engine (`NotificationRecipientResolverService`) tự loại actor — không lặp ở đây.
 */
@Injectable()
export class RecruitNotiBridgeRegistrar implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly reader: RecruitAudienceReader,
    private readonly bridge: OutboxNotificationBridge,
  ) {}

  onModuleInit(): void {
    this.registerJobAssigned();
    this.registerInterviewScheduled();
    this.registerStageChanged();
    this.registerCandidateHired();
  }

  /** 016 — recipient = recruiter MỚI (từ payload, không đọc DB — giá trị tại thời điểm gán). */
  private registerJobAssigned(): void {
    this.bridge.registerSource({
      eventType: "recruit.job_assigned",
      eventCode: "RECRUIT_JOB_ASSIGNED",
      sourceModule: SOURCE_MODULE_RECRUIT,
      sourceEntityType: "job_opening",
      sourceEntityIdOf: (ctx) => requireField(ctx.payload, "jobOpeningId"),
      resolveRecipients: (ctx) =>
        Promise.resolve([requireField(ctx.payload, "newRecruiterUserId")]),
      dedupeKeyOf: (ctx) =>
        `${requireField(ctx.payload, "jobOpeningId")}:${requireField(ctx.payload, "newRecruiterUserId")}:${requireField(ctx.payload, "assignedAtIso")}`,
    });
  }

  /** 017 — mọi participant của lượt (đọc HIỆN TẠI); dedupe theo lượt (once-ever). */
  private registerInterviewScheduled(): void {
    this.bridge.registerSource({
      eventType: "recruit.interview_scheduled",
      eventCode: "RECRUIT_INTERVIEW_SCHEDULED",
      sourceModule: SOURCE_MODULE_RECRUIT,
      sourceEntityType: "interview",
      sourceEntityIdOf: (ctx) => requireField(ctx.payload, "interviewId"),
      resolveRecipients: (ctx) => this.participantsOf(ctx),
      dedupeKeyOf: (ctx) => requireField(ctx.payload, "interviewId"),
    });
  }

  /** 018 — recruiter phụ trách vị trí (CHỈ move tay — convert dùng event riêng 019). */
  private registerStageChanged(): void {
    this.bridge.registerSource({
      eventType: "recruit.stage_changed",
      eventCode: "RECRUIT_STAGE_CHANGED",
      sourceModule: SOURCE_MODULE_RECRUIT,
      sourceEntityType: "candidate",
      sourceEntityIdOf: (ctx) => requireField(ctx.payload, "candidateId"),
      resolveRecipients: async (ctx) => {
        const jobOpeningId = requireField(ctx.payload, "jobOpeningId");
        const userId = await this.db.withTenant(ctx.companyId, (tx) =>
          this.reader.jobRecruiterUserId(tx, ctx.companyId, jobOpeningId),
        );
        return userId ? [userId] : [];
      },
      dedupeKeyOf: (ctx) => requireField(ctx.payload, "stageEventId"),
    });
  }

  /** 019 — user giữ role `RECRUIT_HR_ROLE_NAME` (KHÔNG `hr-manager` — B6 DB-1); dedupe theo ứng viên. */
  private registerCandidateHired(): void {
    this.bridge.registerSource({
      eventType: "recruit.candidate_hired",
      eventCode: "RECRUIT_CANDIDATE_HIRED",
      sourceModule: SOURCE_MODULE_RECRUIT,
      sourceEntityType: "candidate",
      sourceEntityIdOf: (ctx) => requireField(ctx.payload, "candidateId"),
      resolveRecipients: (ctx) =>
        this.db.withTenant(ctx.companyId, (tx) => this.reader.hrRoleUserIds(tx, ctx.companyId)),
      dedupeKeyOf: (ctx) => requireField(ctx.payload, "candidateId"),
    });
  }

  private async participantsOf(ctx: EventContext): Promise<string[]> {
    const interviewId = requireField(ctx.payload, "interviewId");
    return this.db.withTenant(ctx.companyId, (tx) =>
      this.reader.interviewParticipantUserIds(tx, ctx.companyId, interviewId),
    );
  }
}
