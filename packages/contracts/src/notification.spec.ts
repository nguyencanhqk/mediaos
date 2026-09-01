import { describe, expect, it } from "vitest";
import { notificationTypeEnumSchema } from "./notification";

/**
 * PIN HAI CHIỀU `notificationTypeEnumSchema` ↔ CHECK `chk_notifications_notification_type`
 * (0479 → +Goal 0507 → +Training 0529 → +Chat 0538 → +Asset 0551 → +Room 0555 → +Recruit 0561 → +Payroll 0566). Mảng LITERAL chép từ migration `0566`, cố ý
 * KHÔNG import từ `notification-event-catalog.const.ts` (assert hằng bằng chính nó = tautology).
 *
 * VÌ SAO: engine cast `ev.notificationType as NotificationTypeEnum` rồi ghi thẳng cột — enum lệch CHECK là
 * 23514 vô danh (hoặc 400 oan nếu Zod chặt hơn). "Chat" từng THIẾU ở enum này suốt từ 0538 tới 0551 mà không
 * gì đỏ — chính vì chưa có pin (silent-failure-hunter, S11-ASSET-DB-1). Nới CHECK ⇒ đổi cả đây lẫn enum, cùng commit.
 */
describe("contracts/notification — notificationTypeEnumSchema mirror CHECK notifications.notification_type", () => {
  it("== chk_notifications_notification_type sau mig 0566 (18 giá trị)", () => {
    expect([...notificationTypeEnumSchema.options].sort()).toEqual(
      [
        "System",
        "Account",
        "HR",
        "Attendance",
        "Leave",
        "Task",
        "Project",
        "Approval",
        "Reminder",
        "Warning",
        "Error",
        "Goal",
        "Training",
        "Chat",
        "Asset",
        "Room",
        "Recruit",
        "Payroll",
      ].sort(),
    );
  });
});
