/**
 * Default config của dashboard (`DASH_DEFAULT_CONFIG`) — nguồn mà `DashboardConfigSeeder` seed vào
 * `dashboard_widget_configs` cho từng công ty.
 *
 * S16-SOCIAL-DASH-1 (K13): khối dưới đây được DỜI NGUYÊN từ `dashboard-widget-catalog.const.ts` (file đó
 * chạm trần 800 dòng của CLAUDE.md §5 khi thêm 2 widget SOCIAL). File cũ re-export hai tên này, nên
 * `import … from "./dashboard-widget-catalog.const"` ở seeder và các int-spec KHÔNG đổi. File này chỉ
 * `import type` ngược lại ⇒ không có vòng import lúc chạy.
 */
import type { DashboardType } from "./dashboard-widget-catalog.const";

export interface DashDefaultConfigEntry {
  readonly dashboardType: DashboardType;
  readonly widgetCode: string;
  readonly sortOrder: number;
}

/**
 * QUY TẮC (không phải khẩu vị):
 *   DASH_DEFAULT_CONFIG = ( DB-07 §14.3 ∩ 7 widget đã seed ) ∪ { NOTIFICATIONS cho MỌI dashboard type }
 *
 * Vế hai neo vào IMPLEMENTATION-07 §11.3: cột Dashboard của NOTIFICATIONS ghi "All".
 * sortOrder lấy nguyên từ DB-07 §14.3.
 *
 * PROJECT_PROGRESS có trong catalog nhưng KHÔNG có default config — §14.3 không đặt nó vào dashboard nào.
 *
 * S4-DASH-CATALOG-2 (APPEND-only): seed nốt DB-07 §14.3 cho 9 widget đợt 2. TEAM_TASKS_TODAY + CONFIG_WARNINGS
 * DEFER ⇒ KHÔNG default-config (không có row). ATTENDANCE_ALERTS xuất hiện ở CẢ Manager lẫn HR (khác
 * dashboard_type ⇒ khoá nghiệp vụ (company,widget,type,scope) không đụng). Dashboard Admin sau seed = 5 widget
 * (USER_SUMMARY@10 · EMPLOYEE_SUMMARY@20 · MODULE_STATUS@30 · SYSTEM_LOGS@50 + NOTIFICATIONS@50 đã có).
 */
export const DASH_DEFAULT_CONFIG: readonly DashDefaultConfigEntry[] = [
  { dashboardType: "Employee", widgetCode: "ATTENDANCE_TODAY", sortOrder: 10 },
  { dashboardType: "Employee", widgetCode: "MY_TASKS", sortOrder: 20 },
  { dashboardType: "Employee", widgetCode: "TASK_ALERTS", sortOrder: 30 },
  { dashboardType: "Employee", widgetCode: "NOTIFICATIONS", sortOrder: 50 },
  { dashboardType: "Manager", widgetCode: "PENDING_LEAVE", sortOrder: 10 },
  { dashboardType: "Manager", widgetCode: "TASK_ALERTS", sortOrder: 30 },
  { dashboardType: "Manager", widgetCode: "NOTIFICATIONS", sortOrder: 50 },
  { dashboardType: "HR", widgetCode: "HR_OVERVIEW", sortOrder: 10 },
  { dashboardType: "HR", widgetCode: "PENDING_LEAVE", sortOrder: 40 },
  { dashboardType: "HR", widgetCode: "NOTIFICATIONS", sortOrder: 50 },
  { dashboardType: "Admin", widgetCode: "NOTIFICATIONS", sortOrder: 50 },
  // ─── S4-DASH-CATALOG-2 (APPEND) — DB-07 §14.3 cho 9 widget đợt 2 (KHÔNG TEAM_TASKS_TODAY/CONFIG_WARNINGS) ───
  { dashboardType: "Employee", widgetCode: "LEAVE_BALANCE", sortOrder: 40 },
  { dashboardType: "Manager", widgetCode: "LEAVE_CALENDAR", sortOrder: 40 },
  { dashboardType: "Manager", widgetCode: "ATTENDANCE_ALERTS", sortOrder: 50 },
  { dashboardType: "HR", widgetCode: "NEW_EMPLOYEES", sortOrder: 20 },
  { dashboardType: "HR", widgetCode: "CONTRACT_EXPIRING", sortOrder: 30 },
  { dashboardType: "HR", widgetCode: "ATTENDANCE_ALERTS", sortOrder: 50 },
  { dashboardType: "Admin", widgetCode: "USER_SUMMARY", sortOrder: 10 },
  { dashboardType: "Admin", widgetCode: "EMPLOYEE_SUMMARY", sortOrder: 20 },
  { dashboardType: "Admin", widgetCode: "MODULE_STATUS", sortOrder: 30 },
  { dashboardType: "Admin", widgetCode: "SYSTEM_LOGS", sortOrder: 50 },
  // ─── S5-GOAL-DASH-1 (APPEND) — GOAL_PROGRESS mặc định ở Manager/HR/Admin (widget "theo phòng ban",
  // Employee KHÔNG có default vì GoalAccessService tự co scope Own→chỉ thấy dept mình khi có; đủ quyền
  // view:goal vẫn có thể mở qua trang Mục tiêu, KHÔNG cần widget mặc định trên dashboard cá nhân).
  { dashboardType: "Manager", widgetCode: "GOAL_PROGRESS", sortOrder: 60 },
  { dashboardType: "HR", widgetCode: "GOAL_PROGRESS", sortOrder: 60 },
  { dashboardType: "Admin", widgetCode: "GOAL_PROGRESS", sortOrder: 60 },
  // ─── S11-OFFICE-DASH-1 (APPEND) — 2 widget wave OFFICE trên CẢ 4 dashboard type ────────────────────
  // ROOM_TODAY@70: lịch họp CỦA CHÍNH người xem — ai cũng đặt/được mời được, 4 role canonical đều có
  // view:room@Company (mig 0554) ⇒ mặc định bật khắp nơi, KHÔNG sàn scope.
  { dashboardType: "Employee", widgetCode: "ROOM_TODAY", sortOrder: 70 },
  { dashboardType: "Manager", widgetCode: "ROOM_TODAY", sortOrder: 70 },
  { dashboardType: "HR", widgetCode: "ROOM_TODAY", sortOrder: 70 },
  { dashboardType: "Admin", widgetCode: "ROOM_TODAY", sortOrder: 70 },
  // ASSET_SUMMARY@80 CÓ MẶT ở dashboard 'Employee' là CỐ Ý — Asset Manager (view:asset@Company) dùng chung
  // dashboard type đó (role `asset-manager` không có cặp view-*:dashboard riêng, SPEC-13 §272). Nhân viên
  // thường bị loại bởi SÀN scope 'Department' (DASH_WIDGET_MIN_DATA_SCOPE), KHÔNG bởi việc vắng config —
  // lọc theo config sẽ giấu widget khỏi CHÍNH người đáng thấy nó (SPEC-13 §482).
  { dashboardType: "Employee", widgetCode: "ASSET_SUMMARY", sortOrder: 80 },
  { dashboardType: "Manager", widgetCode: "ASSET_SUMMARY", sortOrder: 80 },
  { dashboardType: "HR", widgetCode: "ASSET_SUMMARY", sortOrder: 80 },
  { dashboardType: "Admin", widgetCode: "ASSET_SUMMARY", sortOrder: 80 },
  // ─── S12-RECRUIT-DASH-1 (APPEND) — RECRUIT_FUNNEL@90 trên CẢ 4 dashboard type (mirror lý do
  // ASSET_SUMMARY@Employee): role `recruiter` KHÔNG có cặp view-*:dashboard riêng ⇒ resolve về dashboard
  // type của các role KHÁC user đó mang (thường 'Employee'). Ai không có view:candidate@Company bị loại
  // bởi CẶP + SÀN (filterByGatePair), KHÔNG bởi việc vắng config — lọc theo config sẽ giấu widget khỏi
  // chính người đáng thấy nó.
  { dashboardType: "Employee", widgetCode: "RECRUIT_FUNNEL", sortOrder: 90 },
  { dashboardType: "Manager", widgetCode: "RECRUIT_FUNNEL", sortOrder: 90 },
  { dashboardType: "HR", widgetCode: "RECRUIT_FUNNEL", sortOrder: 90 },
  { dashboardType: "Admin", widgetCode: "RECRUIT_FUNNEL", sortOrder: 90 },
  // ─── S13-PAYROLL-DASH-1 (APPEND) — PAYROLL_COST@100 trên CẢ 4 dashboard type (mirror lý do
  // ASSET_SUMMARY@Employee / RECRUIT_FUNNEL): role `payroll-officer` KHÔNG có cặp view-*:dashboard riêng
  // ⇒ resolve về dashboard type của các role KHÁC user đó mang (thường 'Employee'). Ai không có
  // view-line:payroll-period@Company bị loại bởi CẶP + SÀN (filterByGatePair), KHÔNG bởi việc vắng
  // config — lọc theo config sẽ giấu widget khỏi chính người đáng thấy nó.
  { dashboardType: "Employee", widgetCode: "PAYROLL_COST", sortOrder: 100 },
  { dashboardType: "Manager", widgetCode: "PAYROLL_COST", sortOrder: 100 },
  { dashboardType: "HR", widgetCode: "PAYROLL_COST", sortOrder: 100 },
  { dashboardType: "Admin", widgetCode: "PAYROLL_COST", sortOrder: 100 },
  // ─── S15-PAYROLL-DASH-1 (APPEND) — PAYROLL_BUDGET@110 · PAYROLL_ADVANCE_PENDING@120 trên CẢ 4
  // dashboard type (mirror lý do PAYROLL_COST@100): `payroll-officer` KHÔNG có cặp view-*:dashboard
  // riêng ⇒ resolve về dashboard type của role KHÁC user đó mang (thường 'Employee'). Ai không có cặp
  // + sàn Company bị loại bởi filterByGatePair, KHÔNG bởi việc vắng config — lọc theo config sẽ giấu
  // widget khỏi chính người đáng thấy nó.
  { dashboardType: "Employee", widgetCode: "PAYROLL_BUDGET", sortOrder: 110 },
  { dashboardType: "Manager", widgetCode: "PAYROLL_BUDGET", sortOrder: 110 },
  { dashboardType: "HR", widgetCode: "PAYROLL_BUDGET", sortOrder: 110 },
  { dashboardType: "Admin", widgetCode: "PAYROLL_BUDGET", sortOrder: 110 },
  { dashboardType: "Employee", widgetCode: "PAYROLL_ADVANCE_PENDING", sortOrder: 120 },
  { dashboardType: "Manager", widgetCode: "PAYROLL_ADVANCE_PENDING", sortOrder: 120 },
  { dashboardType: "HR", widgetCode: "PAYROLL_ADVANCE_PENDING", sortOrder: 120 },
  { dashboardType: "Admin", widgetCode: "PAYROLL_ADVANCE_PENDING", sortOrder: 120 },
  // ─── S16-SOCIAL-DASH-1 (APPEND) — SOCIAL_ENGAGEMENT_WEEK@130 · SOCIAL_NEWS_UNACKED@140 trên CẢ 4
  // dashboard type. Người xem được lọc bằng CẶP + SÀN scope (filterByGatePair), KHÔNG bằng việc vắng
  // config: vai tuỳ biến không có cặp view-*:dashboard riêng rơi về dashboard 'Employee', nên giấu
  // «Tương tác tuần» khỏi loại đó là giấu nó khỏi chính người có `view:feed-report` ở phạm vi đủ rộng.
  // Đổi thứ tự SAU khi đã seed cần câu UPDATE cho config đang có (seeder chỉ INSERT hàng thiếu).
  { dashboardType: "Employee", widgetCode: "SOCIAL_ENGAGEMENT_WEEK", sortOrder: 130 },
  { dashboardType: "Manager", widgetCode: "SOCIAL_ENGAGEMENT_WEEK", sortOrder: 130 },
  { dashboardType: "HR", widgetCode: "SOCIAL_ENGAGEMENT_WEEK", sortOrder: 130 },
  { dashboardType: "Admin", widgetCode: "SOCIAL_ENGAGEMENT_WEEK", sortOrder: 130 },
  { dashboardType: "Employee", widgetCode: "SOCIAL_NEWS_UNACKED", sortOrder: 140 },
  { dashboardType: "Manager", widgetCode: "SOCIAL_NEWS_UNACKED", sortOrder: 140 },
  { dashboardType: "HR", widgetCode: "SOCIAL_NEWS_UNACKED", sortOrder: 140 },
  { dashboardType: "Admin", widgetCode: "SOCIAL_NEWS_UNACKED", sortOrder: 140 },
] as const;
