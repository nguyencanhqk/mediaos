import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { renderWithProviders } from "../../src/test-utils/render";
import { makeTask } from "../../src/test-utils/fixtures";
import { tasksApi } from "../../src/api/tasks-api";
import MyTasksScreen from "../(tabs)/tasks";

// Navigation + api boundary are mocked; no network is ever hit. jest hoists these jest.mock factories
// above the imports above, so `tasksApi` resolves to the mock; only `mock`-prefixed vars may be
// referenced inside a factory.
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn(), back: jest.fn() },
}));
jest.mock("../../src/api/tasks-api", () => ({
  tasksApi: { getMyTasks: jest.fn() },
}));

const getMyTasks = tasksApi.getMyTasks as jest.Mock;

beforeEach(() => {
  mockPush.mockClear();
  getMyTasks.mockReset();
});

describe("My Tasks screen", () => {
  it("renders the caller's tasks from the API", async () => {
    getMyTasks.mockResolvedValue([
      makeTask({ id: "a", title: "Quay video sản phẩm" }),
      makeTask({ id: "b", title: "Dựng phụ đề" }),
    ]);

    renderWithProviders(<MyTasksScreen />);

    expect(await screen.findByText("Quay video sản phẩm")).toBeTruthy();
    expect(screen.getByText("Dựng phụ đề")).toBeTruthy();
  });

  it("filters by status when a chip is tapped", async () => {
    getMyTasks.mockResolvedValue([
      makeTask({ id: "a", title: "Đang làm task", status: "in_progress" }),
      makeTask({ id: "b", title: "Chưa bắt đầu task", status: "not_started" }),
    ]);

    renderWithProviders(<MyTasksScreen />);
    await screen.findByText("Đang làm task");

    // "Chưa bắt đầu" appears as both the filter chip and the not_started row's status badge.
    // The chip renders first (filter bar precedes the list), so press the first match.
    fireEvent.press(screen.getAllByText("Chưa bắt đầu")[0]);

    await waitFor(() => expect(screen.queryByText("Đang làm task")).toBeNull());
    expect(screen.getByText("Chưa bắt đầu task")).toBeTruthy();
  });

  it("navigates to task detail on row press", async () => {
    getMyTasks.mockResolvedValue([makeTask({ id: "xyz", title: "Mở chi tiết" })]);

    renderWithProviders(<MyTasksScreen />);
    fireEvent.press(await screen.findByText("Mở chi tiết"));

    expect(mockPush).toHaveBeenCalledWith("/task/xyz");
  });

  it("shows an empty state when there are no tasks", async () => {
    getMyTasks.mockResolvedValue([]);
    renderWithProviders(<MyTasksScreen />);
    expect(await screen.findByText("Bạn chưa có công việc nào.")).toBeTruthy();
  });
});
