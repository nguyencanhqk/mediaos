// @vitest-environment jsdom
/**
 * DashboardWidgetGrid tests (S4-FE-DASH-1/2). Phủ: sắp theo layout.order · bỏ qua widget_code chưa wire vào
 * Grid (KHÔNG render placeholder gãy) · truyền đúng dashboardType xuống từng widget con · S4-FE-DASH-2 wire
 * 3 widget P1 (ATTENDANCE_TODAY/PENDING_LEAVE/HR_OVERVIEW — viewer-independent, KHÔNG cần projectId).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DashboardWidgetSummaryDto } from "@mediaos/contracts";
import { DashboardWidgetGrid } from "./DashboardWidgetGrid";

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
});
