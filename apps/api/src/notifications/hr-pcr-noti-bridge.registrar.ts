import { Injectable, OnModuleInit } from "@nestjs/common";
import type { EventContext } from "../events/event-bus";
import { DatabaseService } from "../db/db.service";
import { PCR_EVENT_TYPE } from "../employees/profile-change-request.service";
import { OutboxNotificationBridge } from "./outbox-notification-bridge.service";
import { PcrApproverAudienceReader } from "./pcr-approver-audience.reader";

const SOURCE_MODULE_HR = "HR";
const SOURCE_ENTITY_PCR = "profile_change_request";

function strField(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * HrPcrNotiBridgeRegistrar — đăng ký 3 mapping "yêu cầu cập nhật hồ sơ" (SPEC-08 §15) lên
 * `OutboxNotificationBridge` (core GENERIC của INT-1 — TÁI DÙNG, KHÔNG bridge/consumer mới), mirror
 * `LeaveNotiBridgeRegistrar`. Import CHỈ `notifications/**` + `db/**` + hằng eventType từ producer —
 * KHÔNG import EmployeesModule (giữ acyclic; đọc thẳng bảng qua reader raw-SQL).
 *
 * BỐI CẢNH: catalog `notification_events` + template IN_APP cho cả 3 mã ĐÃ được seed từ trước, nhưng
 * KHÔNG có producer phát event và KHÔNG có mapping ở bridge ⇒ duyệt/từ chối xong không ai nhận được gì.
 * Đợt S4-INT chỉ wiring LEAVE/ATT/AUTH (9 mã lõi NOTI-EVENT-001..009); 3 mã HR này là phần mở rộng §15
 * nên bị bỏ lại.
 *
 * eventType (hằng `PCR_EVENT_TYPE` dùng CHUNG với producer) → eventCode catalog VERBATIM:
 *   hr.profile_change.submitted → HR_PROFILE_CHANGE_SUBMITTED
 *   hr.profile_change.approved  → HR_PROFILE_CHANGE_APPROVED
 *   hr.profile_change.rejected  → HR_PROFILE_CHANGE_REJECTED
 *
 * Recipient (SPEC-08 §15):
 *   SUBMITTED = mọi user có CẶP QUYỀN `approve:profile-change-request` (KHÔNG hard-code role — role được
 *     cấp/thu quyền duyệt về sau tự vào/ra danh sách).
 *   APPROVED/REJECTED = chủ hồ sơ (đọc lại từ bảng, không tin payload).
 * Bridge KHÔNG tự loại actor: engine `NotificationRecipientResolverService` loại `payload.actorUserId` +
 * lọc active/same-company — tránh lặp logic 2 nơi. Nhờ vậy HR tự duyệt hồ sơ CỦA CHÍNH MÌNH sẽ không
 * nhận thông báo do chính mình gây ra.
 *
 * Payload hỏng / không tìm được người nhận ⇒ trả [] (fail-soft đọc, engine log Skipped) — KHÔNG throw,
 * để một yêu cầu lỗi dữ liệu không làm kẹt outbox worker.
 */
@Injectable()
export class HrPcrNotiBridgeRegistrar implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly reader: PcrApproverAudienceReader,
    private readonly bridge: OutboxNotificationBridge,
  ) {}

  onModuleInit(): void {
    this.registerSubmitted();
    this.registerApproved();
    this.registerRejected();
  }

  /** Chủ hồ sơ của yêu cầu — recipient của APPROVED/REJECTED. */
  private async requesterOf(ctx: EventContext): Promise<string[]> {
    const requestId = strField(ctx.payload, "requestId");
    if (!requestId) return [];
    const userId = await this.db.withTenant(ctx.companyId, (tx) =>
      this.reader.resolveRequesterUserId(tx, ctx.companyId, requestId),
    );
    return userId ? [userId] : [];
  }

  private registerSubmitted(): void {
    this.bridge.registerSource({
      eventType: PCR_EVENT_TYPE.SUBMITTED,
      eventCode: "HR_PROFILE_CHANGE_SUBMITTED",
      sourceModule: SOURCE_MODULE_HR,
      sourceEntityType: SOURCE_ENTITY_PCR,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "requestId"),
      resolveRecipients: (ctx) =>
        this.db.withTenant(ctx.companyId, (tx) => this.reader.resolveApprovers(tx, ctx.companyId)),
    });
  }

  private registerApproved(): void {
    this.bridge.registerSource({
      eventType: PCR_EVENT_TYPE.APPROVED,
      eventCode: "HR_PROFILE_CHANGE_APPROVED",
      sourceModule: SOURCE_MODULE_HR,
      sourceEntityType: SOURCE_ENTITY_PCR,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "requestId"),
      resolveRecipients: (ctx) => this.requesterOf(ctx),
    });
  }

  private registerRejected(): void {
    this.bridge.registerSource({
      eventType: PCR_EVENT_TYPE.REJECTED,
      eventCode: "HR_PROFILE_CHANGE_REJECTED",
      sourceModule: SOURCE_MODULE_HR,
      sourceEntityType: SOURCE_ENTITY_PCR,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "requestId"),
      resolveRecipients: (ctx) => this.requesterOf(ctx),
    });
  }
}
