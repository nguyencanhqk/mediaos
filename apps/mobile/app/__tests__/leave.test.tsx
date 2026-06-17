import React from "react";
import { Alert } from "react-native";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { renderWithProviders } from "../../src/test-utils/render";
import { makeLeaveRequest, makeLeaveType } from "../../src/test-utils/fixtures";
import { ApiError } from "../../src/api/client";
import { leaveApi } from "../../src/api/leave-api";
import LeaveScreen from "../(tabs)/leave";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));
jest.mock("../../src/api/leave-api", () => ({
  leaveApi: {
    listRequests: jest.fn(),
    listBalances: jest.fn(),
    listTypes: jest.fn(),
    createRequest: jest.fn(),
  },
}));

const listRequests = leaveApi.listRequests as jest.Mock;
const listBalances = leaveApi.listBalances as jest.Mock;
const listTypes = leaveApi.listTypes as jest.Mock;
const createRequest = leaveApi.createRequest as jest.Mock;

beforeEach(() => {
  listRequests.mockReset();
  listBalances.mockReset();
  listTypes.mockReset();
  createRequest.mockReset();
  listBalances.mockResolvedValue([]);
  listTypes.mockResolvedValue([
    makeLeaveType({ id: "11111111-1111-1111-1111-111111111111", name: "Nghỉ phép năm" }),
  ]);
});

describe("Leave — list own requests", () => {
  it("renders the caller's own leave requests", async () => {
    listRequests.mockResolvedValue([
      makeLeaveRequest({ id: "r1", leaveTypeName: "Nghỉ phép năm", status: "pending" }),
    ]);
    renderWithProviders(<LeaveScreen />);
    expect(await screen.findByText("Nghỉ phép năm")).toBeTruthy();
    expect(screen.getByText("Chờ duyệt")).toBeTruthy();
  });

  it("shows an empty state when there are no requests", async () => {
    listRequests.mockResolvedValue([]);
    renderWithProviders(<LeaveScreen />);
    expect(await screen.findByText("Bạn chưa có đơn nghỉ nào.")).toBeTruthy();
  });

  it("surfaces a generic message when create is denied (403)", async () => {
    listRequests.mockResolvedValue([]);
    createRequest.mockRejectedValue(new ApiError(403, "FORBIDDEN", "internal leak detail"));
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});

    renderWithProviders(<LeaveScreen />);
    // Open the create form, fill required dates, submit.
    fireEvent.press(await screen.findByText("Tạo đơn nghỉ"));
    fireEvent.changeText(await screen.findByLabelText("Từ ngày"), "2026-07-01");
    fireEvent.changeText(screen.getByLabelText("Đến ngày"), "2026-07-02");
    fireEvent.press(screen.getByText("Gửi đơn"));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        "Không gửi được đơn",
        "Bạn không có quyền thực hiện thao tác này.",
      ),
    );
    alertSpy.mockRestore();
  });

  it("validates date range client-side before any network call", async () => {
    listRequests.mockResolvedValue([]);
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});

    renderWithProviders(<LeaveScreen />);
    fireEvent.press(await screen.findByText("Tạo đơn nghỉ"));
    // endDate before startDate → Zod refine fails BEFORE hitting the API.
    fireEvent.changeText(await screen.findByLabelText("Từ ngày"), "2026-07-10");
    fireEvent.changeText(screen.getByLabelText("Đến ngày"), "2026-07-01");
    fireEvent.press(screen.getByText("Gửi đơn"));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(createRequest).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
