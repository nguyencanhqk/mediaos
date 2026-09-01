import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  PAYROLL_EVENT_PAYSLIP_PUBLISHED,
  PAYROLL_EVENT_PERIOD_APPROVED,
  PAYROLL_EVENT_PERIOD_REJECTED,
  PAYROLL_EVENT_PERIOD_SUBMITTED,
} from "../payroll/payroll-noti.payload";
import { OutboxNotificationBridge } from "./outbox-notification-bridge.service";

const SOURCE_MODULE_PAYROLL = "PAYROLL";

/** Khoá NEO/dedupe thiếu ⇒ **NÉM** (khuôn `RecruitNotiBridgeRegistrar`; nuốt câm là bug-class đã vá). */
function requireField(payload: Record<string, unknown>, key: string): string {
  const v = payload[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(
      `PayrollNotiBridgeRegistrar: payload outbox thiếu khoá bắt buộc '${key}' — hợp đồng ` +
        `payroll/payroll-noti.payload.ts lệch.`,
    );
  }
  return v;
}

/** Danh sách người nhận bắt buộc — rỗng/không phải mảng chuỗi ⇒ NÉM (không im lặng gửi 0 người). */
function requireUserIds(payload: Record<string, unknown>, key: string): string[] {
  const v = payload[key];
  if (!Array.isArray(v) || v.length === 0 || v.some((x) => typeof x !== "string" || !x)) {
    throw new Error(
      `PayrollNotiBridgeRegistrar: payload outbox thiếu/hỏng '${key}' — cổng PAYROLL-ERR-017 ở ` +
        `submit đã bảo đảm danh sách này KHÁC RỖNG, nên tới đây là hợp đồng payload lệch.`,
    );
  }
  return v as string[];
}

/**
 * S13-PAYROLL-BE-2 — 4 mapping PAYROLL → NOTI (`NOTI-EVENT-020..023`, seed mig `0566`) đăng ký lên
 * `OutboxNotificationBridge` lúc boot. KHÔNG import `PayrollModule` (giữ acyclic — tiền lệ
 * GOAL/ASSET/ROOM/RECRUIT). KHÔNG `@SystemJobHandler`: PAYROLL v1 không có system job, cả 4 event đều
 * event-driven.
 *
 * ── NGƯỜI NHẬN LẤY TỪ PAYLOAD, KHÔNG ĐỌC LẠI DB ──
 * `resolveRecipients` ở đây thuần đọc payload. Chủ ý:
 *  · **020** — người duyệt hợp lệ do `PayrollApproverReader` sinh **tại `submit`**, cùng lượt với cổng
 *    `PAYROLL-ERR-017`. Đọc lại DB lúc giao là dựng **bộ giải thứ hai**; hai bộ giải lệch nhau đẻ đúng
 *    cái thất bại mà 017 sinh ra để chặn (mig `0566` chốt "CÙNG bộ giải").
 *  · **021/022** — `submitted_by`, đọc TRƯỚC `applyTransitionTx` (vì `TRAIL_RESET.reject` xoá cột đó).
 *  · **023** — chủ phiếu; `publish` phát MỘT event cho MỖI phiếu, chèn theo lô.
 * Hệ quả phụ: registrar không cần provider nào của `PayrollModule` ⇒ không có cạnh phụ thuộc mới.
 *
 * ── `dedupeKeyOf` BẮT BUỘC CẢ BỐN ──
 * Catalog `0566` đặt `dedupe_strategy = 'DedupeKey'`; quên `dedupeKeyOf` thì rơi về `ctx.eventId` —
 * luôn khác nhau ⇒ **tầng dedupe biến mất CÂM** (bug-class ASSET/0479/0507/0538).
 *
 * ⚠️ **KHÔNG tự tiền tố `eventCode` vào khoá**: `NotificationDedupeService.computeKey` đã ghép
 * `${eventCode}:${dedupeKey}` (`notification-dedupe.service.ts:78`), nên khoá tự-tiền-tố sẽ thành
 * `PAYROLL_PERIOD_SUBMITTED:PAYROLL_PERIOD_SUBMITTED:…` — chạy vẫn đúng nhưng là hai nguồn tiền tố,
 * và int-spec neo khoá sẽ đỏ. (Plan §D5 viết khoá kèm tiền tố vì chưa đo tầng engine.)
 *
 * Khoá **content-derived**, KHÔNG dùng `auditLogId`: `AuditService.record` trả `void` (comment gợi ý
 * `{auditLogId}` trong `0566` viết trước khi đo ra điều đó). Nửa sau của khoá là mốc thời gian
 * `RETURNING` từ CHÍNH câu UPDATE đổi trạng thái ⇒ giữ đúng tính chất «mỗi LẦN gửi là một sự kiện»:
 * gửi → từ chối → sửa → gửi lại sinh `submitted_at` MỚI ⇒ khoá khác ⇒ **vẫn báo lại**.
 *
 * Actor-exclusion do engine (`NotificationRecipientResolverService`) lo — không lặp ở đây.
 */
@Injectable()
export class PayrollNotiBridgeRegistrar implements OnModuleInit {
  constructor(private readonly bridge: OutboxNotificationBridge) {}

  onModuleInit(): void {
    this.registerPeriodSubmitted();
    this.registerPeriodApproved();
    this.registerPeriodRejected();
    this.registerPayslipPublished();
  }

  /** 020 — người nhận = tập người duyệt hợp lệ tại thời điểm gửi. */
  private registerPeriodSubmitted(): void {
    this.bridge.registerSource({
      eventType: PAYROLL_EVENT_PERIOD_SUBMITTED,
      eventCode: "PAYROLL_PERIOD_SUBMITTED",
      sourceModule: SOURCE_MODULE_PAYROLL,
      sourceEntityType: "payroll_period",
      sourceEntityIdOf: (ctx) => requireField(ctx.payload, "periodId"),
      resolveRecipients: (ctx) => Promise.resolve(requireUserIds(ctx.payload, "approverUserIds")),
      dedupeKeyOf: (ctx) =>
        `${requireField(ctx.payload, "periodId")}:${requireField(ctx.payload, "submittedAtIso")}`,
    });
  }

  /** 021 — người nhận = người đã gửi duyệt. */
  private registerPeriodApproved(): void {
    this.bridge.registerSource({
      eventType: PAYROLL_EVENT_PERIOD_APPROVED,
      eventCode: "PAYROLL_PERIOD_APPROVED",
      sourceModule: SOURCE_MODULE_PAYROLL,
      sourceEntityType: "payroll_period",
      sourceEntityIdOf: (ctx) => requireField(ctx.payload, "periodId"),
      resolveRecipients: (ctx) => Promise.resolve([requireField(ctx.payload, "recipientUserId")]),
      dedupeKeyOf: (ctx) =>
        `${requireField(ctx.payload, "periodId")}:${requireField(ctx.payload, "approvedAtIso")}`,
    });
  }

  /** 022 — người nhận = người đã gửi duyệt (đọc TRƯỚC khi `reject` xoá `submitted_*`). */
  private registerPeriodRejected(): void {
    this.bridge.registerSource({
      eventType: PAYROLL_EVENT_PERIOD_REJECTED,
      eventCode: "PAYROLL_PERIOD_REJECTED",
      sourceModule: SOURCE_MODULE_PAYROLL,
      sourceEntityType: "payroll_period",
      sourceEntityIdOf: (ctx) => requireField(ctx.payload, "periodId"),
      resolveRecipients: (ctx) => Promise.resolve([requireField(ctx.payload, "recipientUserId")]),
      // `reject` KHÔNG có cột `rejected_at` ⇒ nửa sau khoá là `updated_at` của chính câu UPDATE.
      dedupeKeyOf: (ctx) =>
        `${requireField(ctx.payload, "periodId")}:${requireField(ctx.payload, "updatedAtIso")}`,
    });
  }

  /** 023 — một event / một phiếu; người nhận = chủ phiếu. Khoá theo `payslipId` (once-ever). */
  private registerPayslipPublished(): void {
    this.bridge.registerSource({
      eventType: PAYROLL_EVENT_PAYSLIP_PUBLISHED,
      eventCode: "PAYSLIP_PUBLISHED",
      sourceModule: SOURCE_MODULE_PAYROLL,
      sourceEntityType: "payslip",
      sourceEntityIdOf: (ctx) => requireField(ctx.payload, "payslipId"),
      resolveRecipients: (ctx) => Promise.resolve([requireField(ctx.payload, "recipientUserId")]),
      dedupeKeyOf: (ctx) => requireField(ctx.payload, "payslipId"),
    });
  }
}
