import React from "react";
import { Alert } from "react-native";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { renderWithProviders } from "../../src/test-utils/render";
import { makeAttendanceToday, makeAttendanceRecord } from "../../src/test-utils/fixtures";
import { ApiError } from "../../src/api/client";
import { attendanceApi } from "../../src/api/attendance-api";
import AttendanceScreen from "../(tabs)/attendance";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));
jest.mock("../../src/api/attendance-api", () => ({
  attendanceApi: {
    getToday: jest.fn(),
    listMonthly: jest.fn(),
    checkIn: jest.fn(),
    checkOut: jest.fn(),
  },
}));

const getToday = attendanceApi.getToday as jest.Mock;
const listMonthly = attendanceApi.listMonthly as jest.Mock;
const checkIn = attendanceApi.checkIn as jest.Mock;
const checkOut = attendanceApi.checkOut as jest.Mock;

beforeEach(() => {
  getToday.mockReset();
  listMonthly.mockReset();
  checkIn.mockReset();
  checkOut.mockReset();
  listMonthly.mockResolvedValue([]);
});

describe("Attendance — check-in/out + history", () => {
  it("offers Check-in when there is no record yet today", async () => {
    getToday.mockResolvedValue(makeAttendanceToday({ record: null }));
    renderWithProviders(<AttendanceScreen />);
    expect(await screen.findByText("Chấm công vào")).toBeTruthy();
  });

  it("sends method=mobile on check-in and refreshes today", async () => {
    getToday.mockResolvedValue(makeAttendanceToday({ record: null }));
    checkIn.mockResolvedValue(makeAttendanceRecord({ checkInAt: "2026-06-17T01:00:00.000Z" }));

    renderWithProviders(<AttendanceScreen />);
    fireEvent.press(await screen.findByText("Chấm công vào"));

    await waitFor(() => expect(checkIn).toHaveBeenCalledWith({ method: "mobile" }));
  });

  it("offers Check-out once checked in, before checkout", async () => {
    getToday.mockResolvedValue(
      makeAttendanceToday({
        record: makeAttendanceRecord({ checkInAt: "2026-06-17T01:00:00.000Z", checkOutAt: null }),
      }),
    );
    renderWithProviders(<AttendanceScreen />);
    expect(await screen.findByText("Chấm công ra")).toBeTruthy();
  });

  it("surfaces a generic message when check-in is denied (403)", async () => {
    getToday.mockResolvedValue(makeAttendanceToday({ record: null }));
    checkIn.mockRejectedValue(new ApiError(403, "FORBIDDEN", "rls denied internal detail"));
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});

    renderWithProviders(<AttendanceScreen />);
    fireEvent.press(await screen.findByText("Chấm công vào"));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        "Không chấm công được",
        "Bạn không có quyền thực hiện thao tác này.",
      ),
    );
    alertSpy.mockRestore();
  });
});
