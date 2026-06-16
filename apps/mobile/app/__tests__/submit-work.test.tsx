import React from "react";
import { screen } from "@testing-library/react-native";
import { renderWithProviders } from "../../src/test-utils/render";
import { makeTask } from "../../src/test-utils/fixtures";
import { useAuth } from "../../src/auth/auth-context";
import { tasksApi } from "../../src/api/tasks-api";
import SubmitWorkScreen from "../submit/[id]";

// jest hoists these factories above the imports above, so useAuth / tasksApi resolve to the mocks.
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: "office-1" }),
  Stack: { Screen: () => null },
}));
jest.mock("../../src/auth/auth-context", () => ({ useAuth: jest.fn() }));
jest.mock("../../src/api/tasks-api", () => ({
  tasksApi: { getMyTasks: jest.fn(), updateTaskStatus: jest.fn() },
}));
jest.mock("../../src/api/workflow-api", () => ({
  workflowApi: { startStep: jest.fn(), submitStep: jest.fn() },
}));

const getMyTasks = tasksApi.getMyTasks as jest.Mock;
const useAuthMock = useAuth as jest.Mock;

function setCapabilities(capabilities: Record<string, boolean>) {
  useAuthMock.mockReturnValue({
    user: { id: "u", companyId: "c", email: "e@x.com", fullName: "U", status: "active", capabilities, mustSetupTwoFactor: false },
    isLoading: false,
    onLoginSuccess: jest.fn(),
    logout: jest.fn(),
  });
}

beforeEach(() => {
  getMyTasks.mockReset();
  useAuthMock.mockReset();
  // The office task whose detail the submit screen reads from the my-tasks cache.
  getMyTasks.mockResolvedValue([makeTask({ id: "office-1", taskType: "office", stepId: null, status: "in_progress" })]);
});

describe("Submit Work — office status deny-path (server-driven permission gate)", () => {
  it("HIDES the status controls and shows a deny message without update:task", async () => {
    setCapabilities({}); // no capabilities → PermissionGate fallback
    renderWithProviders(<SubmitWorkScreen />);

    expect(await screen.findByText("Bạn không có quyền cập nhật công việc này.")).toBeTruthy();
    // The "Hoàn thành" status control must NOT render for an unauthorized user.
    expect(screen.queryByText("Hoàn thành")).toBeNull();
  });

  it("SHOWS the status controls when the user has update:task", async () => {
    setCapabilities({ "update:task": true });
    renderWithProviders(<SubmitWorkScreen />);

    expect(await screen.findByText("Hoàn thành")).toBeTruthy();
    expect(screen.queryByText("Bạn không có quyền cập nhật công việc này.")).toBeNull();
  });

  it("respects the *:* wildcard capability", async () => {
    setCapabilities({ "*:*": true });
    renderWithProviders(<SubmitWorkScreen />);
    expect(await screen.findByText("Hoàn thành")).toBeTruthy();
  });
});
