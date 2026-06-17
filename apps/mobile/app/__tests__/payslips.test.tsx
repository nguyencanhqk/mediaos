import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { renderWithProviders } from "../../src/test-utils/render";
import { makePayslipSummary, makePayslipDetail } from "../../src/test-utils/fixtures";
import { ApiError } from "../../src/api/client";
import { payslipApi } from "../../src/api/payslip-api";
import PayslipsScreen from "../(tabs)/payslips";

// jest hoists these mock factories above the imports; only `mock`-prefixed vars are referenceable inside.
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));
jest.mock("../../src/api/payslip-api", () => ({
  payslipApi: { listOwn: jest.fn(), reauthOwn: jest.fn(), getOwn: jest.fn() },
}));

const listOwn = payslipApi.listOwn as jest.Mock;
const reauthOwn = payslipApi.reauthOwn as jest.Mock;
const getOwn = payslipApi.getOwn as jest.Mock;

beforeEach(() => {
  listOwn.mockReset();
  reauthOwn.mockReset();
  getOwn.mockReset();
});

describe("Payslips (own) — money-free list", () => {
  it("renders only money-free summary fields; no money is shown before re-auth", async () => {
    listOwn.mockResolvedValue([makePayslipSummary({ id: "p1" })]);
    renderWithProviders(<PayslipsScreen />);

    // The kỳ/loại bản ghi appear; no net/gross numbers leak onto the list.
    expect(await screen.findByText("Xem chi tiết")).toBeTruthy();
    // getOwn / reauthOwn must NOT have been called just to render the list.
    expect(reauthOwn).not.toHaveBeenCalled();
    expect(getOwn).not.toHaveBeenCalled();
  });

  it("shows an empty state when the caller has no payslips", async () => {
    listOwn.mockResolvedValue([]);
    renderWithProviders(<PayslipsScreen />);
    expect(await screen.findByText("Bạn chưa có phiếu lương nào.")).toBeTruthy();
  });
});

describe("Payslips (own) — re-auth gate (CROWN)", () => {
  it("does NOT fetch detail until the password re-auth succeeds", async () => {
    listOwn.mockResolvedValue([makePayslipSummary({ id: "p1" })]);
    renderWithProviders(<PayslipsScreen />);

    // Open the re-auth prompt for the payslip.
    fireEvent.press(await screen.findByText("Xem chi tiết"));

    // Re-auth modal visible; detail not fetched yet (gate closed).
    expect(await screen.findByLabelText("Mật khẩu")).toBeTruthy();
    expect(getOwn).not.toHaveBeenCalled();
  });

  it("reveals money ONLY after reauthOwn → getOwn, and never stores a token", async () => {
    listOwn.mockResolvedValue([makePayslipSummary({ id: "p1" })]);
    reauthOwn.mockResolvedValue({ expiresAt: "2026-06-17T10:05:00.000Z" });
    getOwn.mockResolvedValue(makePayslipDetail({ id: "p1", net: 12345678, currency: "VND" }));

    renderWithProviders(<PayslipsScreen />);
    fireEvent.press(await screen.findByText("Xem chi tiết"));

    const input = await screen.findByLabelText("Mật khẩu");
    fireEvent.changeText(input, "correct horse");
    fireEvent.press(screen.getByText("Xác nhận"));

    // reauthOwn called BEFORE getOwn (window opened first), and money appears only after both.
    await waitFor(() => expect(getOwn).toHaveBeenCalledWith("p1"));
    expect(reauthOwn).toHaveBeenCalledWith("p1", "correct horse");
    expect(reauthOwn.mock.invocationCallOrder[0]).toBeLessThan(getOwn.mock.invocationCallOrder[0]);
    // Net (money) is now visible — but only inside the reveal, after the gate.
    expect(await screen.findByText(/12.345.678/)).toBeTruthy();
  });

  it("surfaces a GENERIC permission message (no leak) when the re-auth window lapsed → getOwn 403", async () => {
    listOwn.mockResolvedValue([makePayslipSummary({ id: "p1" })]);
    reauthOwn.mockResolvedValue({ expiresAt: "2026-06-17T10:05:00.000Z" });
    // Window expired by the time detail is fetched — server denies with a generic 403.
    getOwn.mockRejectedValue(new ApiError(403, "FORBIDDEN", "internal: deny-reauth-required user=abc"));

    renderWithProviders(<PayslipsScreen />);
    fireEvent.press(await screen.findByText("Xem chi tiết"));
    fireEvent.changeText(await screen.findByLabelText("Mật khẩu"), "correct horse");
    fireEvent.press(screen.getByText("Xác nhận"));

    // Generic message — the raw server detail is NEVER shown.
    expect(await screen.findByText("Bạn không có quyền thực hiện thao tác này.")).toBeTruthy();
    expect(screen.queryByText(/deny-reauth-required/)).toBeNull();
    expect(screen.queryByText(/user=abc/)).toBeNull();
  });

  it("shows a re-auth error and does NOT fetch detail when the password is wrong (401)", async () => {
    listOwn.mockResolvedValue([makePayslipSummary({ id: "p1" })]);
    reauthOwn.mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "Re-authentication failed."));

    renderWithProviders(<PayslipsScreen />);
    fireEvent.press(await screen.findByText("Xem chi tiết"));
    fireEvent.changeText(await screen.findByLabelText("Mật khẩu"), "wrong");
    fireEvent.press(screen.getByText("Xác nhận"));

    await waitFor(() => expect(reauthOwn).toHaveBeenCalled());
    // Gate stays closed: detail is never fetched on a failed step-up.
    expect(getOwn).not.toHaveBeenCalled();
  });
});
