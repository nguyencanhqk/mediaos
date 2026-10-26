// @vitest-environment jsdom
/**
 * S20-DASH-QUICKACTION-1 — badge «Hôm nay»/«Quá hạn» của section Công việc trên /me mở đúng nhóm của
 * «Việc của tôi» (`/tasks/my-tasks?group=today|overdue`, không lọc nguồn — số đếm của server gồm mọi
 * nguồn). Số 0 / thiếu `read:task` ⇒ badge tĩnh, không có link.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import type { MeTaskSummary } from "@mediaos/contracts";
import i18n from "@/i18n";
import { TaskSectionContent } from "./MeSectionContents";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigateMock }));

function login(capabilities: Record<string, boolean>) {
  useAuthStore.setState({ isAuthenticated: true, capabilities });
}

function renderSection(data: MeTaskSummary) {
  render(
    <I18nextProvider i18n={i18n}>
      <TaskSectionContent data={data} />
    </I18nextProvider>,
  );
}

describe("TaskSectionContent — badge số đếm dẫn đúng nhóm «Việc của tôi»", () => {
  beforeEach(() => {
    navigateMock.mockClear();
    useAuthStore.setState({ isAuthenticated: false, capabilities: {} });
  });

  it("Quá hạn = 3 ⇒ mở nhóm overdue; Hôm nay = 2 ⇒ mở nhóm today", () => {
    login({ "read:task": true });
    renderSection({ assignedCount: 5, dueTodayCount: 2, overdueCount: 3 });

    fireEvent.click(screen.getByTestId("me-task-overdue-link"));
    expect(navigateMock).toHaveBeenLastCalledWith({
      to: "/tasks/my-tasks",
      search: { group: "overdue" },
    });
    fireEvent.click(screen.getByTestId("me-task-today-link"));
    expect(navigateMock).toHaveBeenLastCalledWith({
      to: "/tasks/my-tasks",
      search: { group: "today" },
    });
  });

  it("số 0 ⇒ badge không bấm được", () => {
    login({ "read:task": true });
    renderSection({ assignedCount: 1, dueTodayCount: 0, overdueCount: 0 });
    expect(screen.queryByTestId("me-task-overdue-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("me-task-today-link")).not.toBeInTheDocument();
    expect(screen.getByText(/0 quá hạn/)).toBeInTheDocument();
  });

  it("thiếu read:task ⇒ không có link (màn đích sẽ từ chối)", () => {
    login({});
    renderSection({ assignedCount: 4, dueTodayCount: 2, overdueCount: 3 });
    expect(screen.queryByTestId("me-task-overdue-link")).not.toBeInTheDocument();
    expect(screen.getByText(/3 quá hạn/)).toBeInTheDocument();
  });
});
