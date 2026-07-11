/**
 * S4-DASH-BE-2-FIX-2 — QUICK ACTION metadata registry (API-08 §8.4 + BACKEND-10 §20).
 *
 * DASH CHỈ phát METADATA điều hướng cho FE — KHÔNG tự thực thi nghiệp vụ gốc (§20.1.1/3). Mỗi action ghim 1
 * cặp engine `gate` (action:resourceType) đã SEED THẬT ở module nguồn; service tính `enabled`/`disabled_reason`
 * bằng PermissionService.can() của NGƯỜI XEM (§20.1.5 — KHÔNG hard-code role). Action thật do FE gọi module gốc
 * qua `api_endpoint` (API_CALL) / `target_url` (NAVIGATE).
 *
 * ⚠ Chống pair-drift (đã cắn nhiều lần): mọi `gate` dưới đây là cặp CÓ THẬT trong seed —
 *   check-in/check-out:attendance (0454/att-seed) · create:task, read:task (0005) · read:notification (0005) ·
 *   approve:leave (0455/leave-seed) · read:project (0005) · read:employee (0019). Reviewer FULL gate đối chiếu.
 */
import type { QuickActionDto, QuickActionMethod } from "@mediaos/contracts";
import type { EnginePair } from "./dashboard-widget-catalog.const";

export interface DashWidgetQuickActionDef {
  readonly actionCode: string;
  readonly label: string;
  /** Mã module GỐC (BACKEND-10 §11.3): ATT/LEAVE/TASK/HR/NOTI/AUTH/DASH. */
  readonly targetModule: string;
  readonly method: QuickActionMethod;
  /** Đường FE navigate (NAVIGATE/OPEN_*). null cho API_CALL thuần. */
  readonly targetUrl: string | null;
  /** Endpoint module GỐC khi method=API_CALL (§20.1.2). null cho NAVIGATE. DASH KHÔNG tự gọi. */
  readonly apiEndpoint: string | null;
  /** Cặp engine gate `enabled` — tính từ permission NGƯỜI XEM (§20.1.5). KHÔNG hard-code role. */
  readonly gate: EnginePair;
  /** true ⇒ targetUrl nối `/${projectId}` khi ctx có project_id (PROJECT_PROGRESS deep-link đúng dự án). */
  readonly projectScoped?: boolean;
}

/**
 * Quick action theo widgetCode (7 widget in-sprint). [] ⇒ widget không có quick action. Danh sách metadata
 * điều hướng — thêm action = thêm dòng ở đây (curated), KHÔNG rải rác trong handler.
 */
export const DASH_WIDGET_QUICK_ACTIONS: Readonly<
  Record<string, readonly DashWidgetQuickActionDef[]>
> = {
  ATTENDANCE_TODAY: [
    {
      actionCode: "CHECK_IN",
      label: "Check-in",
      targetModule: "ATT",
      method: "API_CALL",
      targetUrl: null,
      apiEndpoint: "/api/v1/attendance/check-in",
      gate: { action: "check-in", resourceType: "attendance" },
    },
    {
      actionCode: "CHECK_OUT",
      label: "Check-out",
      targetModule: "ATT",
      method: "API_CALL",
      targetUrl: null,
      apiEndpoint: "/api/v1/attendance/check-out",
      gate: { action: "check-out", resourceType: "attendance" },
    },
  ],
  MY_TASKS: [
    {
      actionCode: "CREATE_TASK",
      label: "Tạo task",
      targetModule: "TASK",
      method: "NAVIGATE",
      targetUrl: "/tasks/new",
      apiEndpoint: null,
      gate: { action: "create", resourceType: "task" },
    },
    {
      actionCode: "OPEN_MY_TASKS",
      label: "Xem tất cả task",
      targetModule: "TASK",
      method: "NAVIGATE",
      targetUrl: "/tasks/my",
      apiEndpoint: null,
      gate: { action: "read", resourceType: "task" },
    },
  ],
  TASK_ALERTS: [
    {
      actionCode: "OPEN_TASK_ALERTS",
      label: "Xem task cần chú ý",
      targetModule: "TASK",
      method: "NAVIGATE",
      targetUrl: "/tasks?filter=due-soon",
      apiEndpoint: null,
      gate: { action: "read", resourceType: "task" },
    },
  ],
  NOTIFICATIONS: [
    {
      actionCode: "OPEN_NOTIFICATIONS",
      label: "Xem tất cả thông báo",
      targetModule: "NOTI",
      method: "NAVIGATE",
      targetUrl: "/notifications",
      apiEndpoint: null,
      gate: { action: "read", resourceType: "notification" },
    },
  ],
  PENDING_LEAVE: [
    {
      actionCode: "OPEN_PENDING_LEAVE_APPROVAL",
      label: "Duyệt đơn",
      targetModule: "LEAVE",
      method: "NAVIGATE",
      targetUrl: "/leave/approvals?status=Pending",
      apiEndpoint: null,
      gate: { action: "approve", resourceType: "leave" },
    },
  ],
  PROJECT_PROGRESS: [
    {
      actionCode: "OPEN_PROJECT",
      label: "Mở dự án",
      targetModule: "TASK",
      method: "NAVIGATE",
      targetUrl: "/projects",
      apiEndpoint: null,
      gate: { action: "read", resourceType: "project" },
      projectScoped: true,
    },
  ],
  HR_OVERVIEW: [
    {
      actionCode: "OPEN_HR_DIRECTORY",
      label: "Danh bạ nhân sự",
      targetModule: "HR",
      method: "NAVIGATE",
      targetUrl: "/hr/employees",
      apiEndpoint: null,
      gate: { action: "read", resourceType: "employee" },
    },
  ],
};

/** Tra danh sách quick action def theo widgetCode. [] ⇒ widget không có quick action (không map). */
export function quickActionDefsFor(widgetCode: string): readonly DashWidgetQuickActionDef[] {
  return DASH_WIDGET_QUICK_ACTIONS[widgetCode] ?? [];
}

/**
 * Dựng 1 QuickActionDto từ def + quyết định `allowed` (service đã can()). PURE — không I/O, dễ unit-test.
 * enabled=allowed; disabled_reason=null khi enabled, ngược lại nêu cặp quyền thiếu (§20.1.4 — FE không tự đoán).
 * projectScoped + projectId ⇒ targetUrl nối `/${projectId}` (deep-link đúng dự án đang xem).
 */
export function buildQuickAction(
  def: DashWidgetQuickActionDef,
  allowed: boolean,
  projectId?: string | null,
): QuickActionDto {
  const targetUrl =
    def.projectScoped && projectId && def.targetUrl
      ? `${def.targetUrl}/${projectId}`
      : def.targetUrl;
  return {
    action_code: def.actionCode,
    label: def.label,
    target_module: def.targetModule,
    method: def.method,
    target_url: targetUrl,
    api_endpoint: def.apiEndpoint,
    enabled: allowed,
    disabled_reason: allowed ? null : `Thiếu quyền ${def.gate.action}:${def.gate.resourceType}`,
  };
}
