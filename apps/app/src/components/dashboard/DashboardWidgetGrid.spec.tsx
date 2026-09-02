// @vitest-environment jsdom
/**
 * DashboardWidgetGrid tests (S4-FE-DASH-1/2). Phủ: sắp theo layout.order · bỏ qua widget_code chưa wire vào
 * Grid (KHÔNG render placeholder gãy) · truyền đúng dashboardType xuống từng widget con · S4-FE-DASH-2 wire
 * 3 widget P1 (ATTENDANCE_TODAY/PENDING_LEAVE/HR_OVERVIEW — viewer-independent, KHÔNG cần projectId).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DashboardWidgetSummaryDto } from "@mediaos/contracts";
import { DASH_WIDGET_SLUG } from "@mediaos/web-core";
import { DashboardWidgetGrid } from "./DashboardWidgetGrid";
import { DASH_WIDGET_CODE } from "@/routes/dashboard/constants";

vi.mock("./MyTasksWidget", () => ({
  MyTasksWidget: ({ dashboardType }: { dashboardType?: string }) => (
    <div data-testid="widget-MY_TASKS">MY_TASKS:{dashboardType}</div>
  ),
}));
vi.mock("./TaskAlertsWidget", () => ({
  TaskAlertsWidget: ({ dashboardType }: { dashboardType?: string }) => (
    <div data-testid="widget-TASK_ALERTS">TASK_ALERTS:{dashboardType}</div>
  ),
}));
vi.mock("./NotificationsWidget", () => ({
  NotificationsWidget: ({ dashboardType }: { dashboardType?: string }) => (
    <div data-testid="widget-NOTIFICATIONS">NOTIFICATIONS:{dashboardType}</div>
  ),
}));
vi.mock("./AttendanceTodayWidget", () => ({
  AttendanceTodayWidget: ({ dashboardType }: { dashboardType?: string }) => (
    <div data-testid="widget-ATTENDANCE_TODAY">ATTENDANCE_TODAY:{dashboardType}</div>
  ),
}));
vi.mock("./PendingLeaveWidget", () => ({
  PendingLeaveWidget: ({ dashboardType }: { dashboardType?: string }) => (
    <div data-testid="widget-PENDING_LEAVE">PENDING_LEAVE:{dashboardType}</div>
  ),
}));
vi.mock("./HrOverviewWidget", () => ({
  HrOverviewWidget: ({ dashboardType }: { dashboardType?: string }) => (
    <div data-testid="widget-HR_OVERVIEW">HR_OVERVIEW:{dashboardType}</div>
  ),
}));
vi.mock("./RoomTodayWidget", () => ({
  RoomTodayWidget: ({ dashboardType }: { dashboardType?: string }) => (
    <div data-testid="widget-ROOM_TODAY">ROOM_TODAY:{dashboardType}</div>
  ),
}));
vi.mock("./AssetSummaryWidget", () => ({
  AssetSummaryWidget: ({ dashboardType }: { dashboardType?: string }) => (
    <div data-testid="widget-ASSET_SUMMARY">ASSET_SUMMARY:{dashboardType}</div>
  ),
}));
vi.mock("./RecruitFunnelWidget", () => ({
  RecruitFunnelWidget: ({ dashboardType }: { dashboardType?: string }) => (
    <div data-testid="widget-RECRUIT_FUNNEL">RECRUIT_FUNNEL:{dashboardType}</div>
  ),
}));
vi.mock("./PayrollCostWidget", () => ({
  PayrollCostWidget: ({ dashboardType }: { dashboardType?: string }) => (
    <div data-testid="widget-PAYROLL_COST">PAYROLL_COST:{dashboardType}</div>
  ),
}));

function widget(code: string, order: number): DashboardWidgetSummaryDto {
  return {
    widget_code: code,
    widget_name: code,
    widget_type: "List",
    source_modules: ["TASK"],
    data_scope: "Own",
    layout: { order },
    data: null,
    last_updated_at: null,
  };
}

describe("DashboardWidgetGrid", () => {
  it("sắp widget theo layout.order (KHÔNG theo thứ tự mảng input)", () => {
    const widgets = [
      widget("NOTIFICATIONS", 50),
      widget("MY_TASKS", 20),
      widget("TASK_ALERTS", 30),
    ];
    render(<DashboardWidgetGrid widgets={widgets} dashboardType="Employee" />);
    const order = screen.getAllByTestId(/^widget-/).map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual(["widget-MY_TASKS", "widget-TASK_ALERTS", "widget-NOTIFICATIONS"]);
  });

  it("bỏ qua widget_code chưa wire vào Grid (vd PROJECT_PROGRESS — cần project context) — KHÔNG render, KHÔNG crash", () => {
    const widgets = [widget("MY_TASKS", 10), widget("PROJECT_PROGRESS", 5)];
    render(<DashboardWidgetGrid widgets={widgets} dashboardType="Employee" />);
    expect(screen.getByTestId("widget-MY_TASKS")).toBeInTheDocument();
    expect(screen.queryByText(/PROJECT_PROGRESS/)).not.toBeInTheDocument();
  });

  it("truyền đúng dashboardType xuống widget con", () => {
    render(<DashboardWidgetGrid widgets={[widget("MY_TASKS", 10)]} dashboardType="Manager" />);
    expect(screen.getByText("MY_TASKS:Manager")).toBeInTheDocument();
  });

  it("S4-FE-DASH-2 — wire đúng 3 widget P1 (ATTENDANCE_TODAY/PENDING_LEAVE/HR_OVERVIEW)", () => {
    const widgets = [
      widget("ATTENDANCE_TODAY", 10),
      widget("PENDING_LEAVE", 20),
      widget("HR_OVERVIEW", 30),
    ];
    render(<DashboardWidgetGrid widgets={widgets} dashboardType="HR" />);
    expect(screen.getByTestId("widget-ATTENDANCE_TODAY")).toHaveTextContent("ATTENDANCE_TODAY:HR");
    expect(screen.getByTestId("widget-PENDING_LEAVE")).toHaveTextContent("PENDING_LEAVE:HR");
    expect(screen.getByTestId("widget-HR_OVERVIEW")).toHaveTextContent("HR_OVERVIEW:HR");
  });

  it("S11-OFFICE-DASH-1 — wire đúng 2 widget wave OFFICE (ROOM_TODAY/ASSET_SUMMARY)", () => {
    const widgets = [widget("ROOM_TODAY", 70), widget("ASSET_SUMMARY", 80)];
    render(<DashboardWidgetGrid widgets={widgets} dashboardType="Admin" />);
    expect(screen.getByTestId("widget-ROOM_TODAY")).toHaveTextContent("ROOM_TODAY:Admin");
    expect(screen.getByTestId("widget-ASSET_SUMMARY")).toHaveTextContent("ASSET_SUMMARY:Admin");
  });

  it("S12-RECRUIT-DASH-1 — wire widget RECRUIT_FUNNEL", () => {
    render(<DashboardWidgetGrid widgets={[widget("RECRUIT_FUNNEL", 90)]} dashboardType="HR" />);
    expect(screen.getByTestId("widget-RECRUIT_FUNNEL")).toHaveTextContent("RECRUIT_FUNNEL:HR");
  });

  it("S13-PAYROLL-DASH-1 — wire widget PAYROLL_COST", () => {
    render(<DashboardWidgetGrid widgets={[widget("PAYROLL_COST", 100)]} dashboardType="Admin" />);
    expect(screen.getByTestId("widget-PAYROLL_COST")).toHaveTextContent("PAYROLL_COST:Admin");
  });

  /**
   * RATCHET (S11-OFFICE-DASH-1) — mọi mã widget FE biết PHẢI có slug trong DASH_WIDGET_SLUG của web-core,
   * nếu không `dashboardApi.getWidgetData` ném "widget chưa có FE slug mapping" ở RUNTIME.
   *
   * Ca này sinh ra từ một lỗi THẬT: S5-GOAL-DASH-1 thêm GOAL_PROGRESS vào DASH_WIDGET_CODE + Grid nhưng
   * QUÊN dòng slug ⇒ widget hỏng mọi lần mở, mà mọi spec component vẫn xanh (chúng mock thẳng
   * dashboardApi nên không bao giờ chạm map). Thêm widget mà quên slug từ nay là ĐỎ ở đây.
   */
  it("mọi DASH_WIDGET_CODE đều có slug trong DASH_WIDGET_SLUG (chống lỗ GOAL_PROGRESS)", () => {
    const missing = Object.values(DASH_WIDGET_CODE).filter((code) => !DASH_WIDGET_SLUG[code]);
    expect(missing, `widget thiếu slug mapping: ${missing.join(", ")}`).toEqual([]);
  });
});
