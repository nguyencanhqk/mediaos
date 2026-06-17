import React from "react";
import { screen, waitFor } from "@testing-library/react-native";
import { renderWithProviders } from "../../src/test-utils/render";
import { makeKpiDefinition, makeKpiResult } from "../../src/test-utils/fixtures";
import { ApiError } from "../../src/api/client";
import { kpiApi } from "../../src/api/kpi-api";
import KpiScreen from "../(tabs)/kpi";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));
// Auth context is mocked so useKpiScreen can read the caller's own user id.
jest.mock("../../src/auth/auth-context", () => ({
  useAuth: () => ({ user: { id: "me-1", capabilities: { "read:kpi": true } }, isLoading: false }),
}));
jest.mock("../../src/api/kpi-api", () => ({
  kpiApi: { listDefinitions: jest.fn(), compute: jest.fn() },
}));

const listDefinitions = kpiApi.listDefinitions as jest.Mock;
const compute = kpiApi.compute as jest.Mock;

beforeEach(() => {
  listDefinitions.mockReset();
  compute.mockReset();
});

describe("Personal KPI — read-only own snapshot", () => {
  it("computes the OWN snapshot (subjectUserId = self) for the first definition", async () => {
    listDefinitions.mockResolvedValue([makeKpiDefinition({ id: "def-1", name: "KPI Sản xuất" })]);
    compute.mockResolvedValue(makeKpiResult({ totalScore: 87 }));

    renderWithProviders(<KpiScreen />);

    await waitFor(() => expect(compute).toHaveBeenCalled());
    const arg = compute.mock.calls[0][0];
    expect(arg.subjectUserId).toBe("me-1");
    expect(arg.definitionId).toBe("def-1");
    expect(arg.subjectTeamId).toBeUndefined();
    expect(await screen.findByText("87")).toBeTruthy();
  });

  it("shows an empty state when there are no KPI definitions", async () => {
    listDefinitions.mockResolvedValue([]);
    renderWithProviders(<KpiScreen />);
    expect(await screen.findByText("Chưa có chỉ số KPI nào.")).toBeTruthy();
    expect(compute).not.toHaveBeenCalled();
  });

  it("surfaces a generic permission message (no leak) when compute returns 403", async () => {
    listDefinitions.mockResolvedValue([makeKpiDefinition({ id: "def-1" })]);
    compute.mockRejectedValue(new ApiError(403, "FORBIDDEN", "internal: missing read:kpi grant detail"));

    renderWithProviders(<KpiScreen />);

    expect(await screen.findByText("Bạn không có quyền thực hiện thao tác này.")).toBeTruthy();
    expect(screen.queryByText(/missing read:kpi/)).toBeNull();
  });
});
