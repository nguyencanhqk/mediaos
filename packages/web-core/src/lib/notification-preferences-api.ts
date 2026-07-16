import { z } from "zod";
import {
  notificationPreferenceSchema,
  type NotificationPreferenceDto,
  type UpsertNotificationPreferenceDto,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * S5-ME-FE-3 — Notification preferences API client (opt-in/out per type, ME-SCREEN-013). Mirror BE
 * `NotificationsController` (apps/api/src/notifications/notifications.controller.ts): GET/PUT
 * `/notifications/preferences`, own-scope THUẦN (server khoá `req.user.id` — client KHÔNG truyền
 * user_id, chống IDOR §14.4).
 *
 * NOTI-002 (mandatory): `upsert(enabled=false)` cho loại `mandatory=true` bị BE chặn — 400
 * BadRequestException("mandatory notification cannot be disabled"). Client KHÔNG tự nuốt lỗi này — để
 * nguyên `apiFetch` ném `ApiError` (status 400) cho caller (UI) xử lý (revert toggle + hiển thị lý do).
 *
 * QUIRK BE (repo `.returning()`): PUT trả VỀ MẢNG 1 phần tử (kết quả insert/upsert thô của Drizzle),
 * KHÔNG phải object đơn — validate mảng rồi lấy phần tử đầu, KHÔNG dùng non-null assertion (mảng rỗng =
 * contract drift, ném lỗi tường minh thay vì im lặng trả undefined).
 */
export const notificationPreferencesApi = {
  /** GET /notifications/preferences — danh sách preference hiện tại của user (own). */
  list: (): Promise<NotificationPreferenceDto[]> =>
    apiFetch("/notifications/preferences", z.array(notificationPreferenceSchema)),

  /**
   * PUT /notifications/preferences — upsert 1 preference (opt-in/opt-out). BE trả mảng 1 phần tử (xem
   * QUIRK ở trên) — hàm này bóc ra 1 record cho tiện dùng ở caller.
   */
  upsert: async (body: UpsertNotificationPreferenceDto): Promise<NotificationPreferenceDto> => {
    const rows = await apiFetch(
      "/notifications/preferences",
      z.array(notificationPreferenceSchema),
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    );
    const [row] = rows;
    if (!row) {
      throw new Error(
        "notification-preferences-api: PUT /notifications/preferences trả mảng rỗng (contract drift)",
      );
    }
    return row;
  },
};
