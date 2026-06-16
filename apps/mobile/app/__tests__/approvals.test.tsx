import React from "react";
import { Alert } from "react-native";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { renderWithProviders } from "../../src/test-utils/render";
import { makeApprovalRequest } from "../../src/test-utils/fixtures";
import { ApiError } from "../../src/api/client";
import { workflowApi } from "../../src/api/workflow-api";
import ApprovalsScreen from "../(tabs)/approvals";

// jest hoists the jest.mock factory above the imports above, so `workflowApi` resolves to the mock;
// only `mock`-prefixed vars may be referenced inside a factory.
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn(), back: jest.fn() },
}));
jest.mock("../../src/api/workflow-api", () => ({
  workflowApi: { listApprovalRequests: jest.fn(), approve: jest.fn(), requestRevision: jest.fn() },
}));

const listApprovalRequests = workflowApi.listApprovalRequests as jest.Mock;
const approve = workflowApi.approve as jest.Mock;

beforeEach(() => {
  mockPush.mockClear();
  listApprovalRequests.mockReset();
  approve.mockReset();
});

describe("Approvals inbox — server-scoped gating", () => {
  it("shows the empty state (no approve controls) when the server returns no requests", async () => {
    // A non-reviewer receives an empty list from the server — so no Approve button can render.
    listApprovalRequests.mockResolvedValue([]);
    renderWithProviders(<ApprovalsScreen />);

    expect(await screen.findByText("Không có việc nào chờ bạn duyệt.")).toBeTruthy();
    expect(screen.queryByText("Duyệt")).toBeNull();
  });

  it("renders Approve/Revision controls for each pending request", async () => {
    listApprovalRequests.mockResolvedValue([makeApprovalRequest({ id: "req-9" })]);
    renderWithProviders(<ApprovalsScreen />);

    expect(await screen.findByText("Duyệt")).toBeTruthy();
    fireEvent.press(screen.getByText("Trả sửa"));
    expect(mockPush).toHaveBeenCalledWith("/revision/req-9");
  });

  it("surfaces a generic permission message (no data leak) when approve returns 403", async () => {
    listApprovalRequests.mockResolvedValue([makeApprovalRequest({ id: "req-9" })]);
    approve.mockRejectedValue(new ApiError(403, "FORBIDDEN", "permission denied"));
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});

    renderWithProviders(<ApprovalsScreen />);
    fireEvent.press(await screen.findByText("Duyệt"));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        "Không thể duyệt",
        "Bạn không có quyền thực hiện thao tác này.",
      ),
    );
    alertSpy.mockRestore();
  });
});
