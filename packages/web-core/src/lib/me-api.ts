import { meOverviewSchema, type MeOverview } from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * S5-ME-FE-1 — ME API client (Personal Hub, SPEC-09 §14.2 / API-11 §5). Mirror BE `MeController`
 * (apps/api/src/me/me.controller.ts): 6 route đọc-tổng-hợp own-scope, resolve user 100% từ token — client
 * KHÔNG gửi user_id/employee_id (chống IDOR, §14.4). WO này chỉ cần `getOverview` cho ME-SCREEN-001
 * (Tổng quan); 4 endpoint summary chuyên biệt + `getIdentity` để lại cho S5-ME-FE-2/FE-3 khi có consumer
 * thật (tránh code chết — YAGNI).
 *
 * MASKING là việc của SERVER: response ĐÃ mask theo module nguồn — client chỉ render field nhận được
 * (BẤT BIẾN CLAUDE.md §2/§5). Response validate Zod (meOverviewSchema) ở ranh giới — lỗi shape ném ngay,
 * KHÔNG âm thầm render dữ liệu sai.
 */
export const meApi = {
  /** GET /me/overview — identity + 5 section-envelope (hr/attendance/leave/task/notification), fail-soft. */
  getOverview: (): Promise<MeOverview> => apiFetch("/me/overview", meOverviewSchema),
};
