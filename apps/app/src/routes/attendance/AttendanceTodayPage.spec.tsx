/**
 * AttendanceTodayPage tests — S3-FE-ATT-1.
 *
 * Phủ: loading · error · forbidden (deny-path) · check-in enabled · check-out enabled ·
 *      cả 2 disabled (full-day-leave / sau check-out) + disabled reason rõ.
 * BẤT BIẾN: useCan gate KHÔNG bao giờ hard-code role; allowedActions đến từ server mock.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => true),
  attendanceApi: {
    getToday: vi.fn(),
    checkIn: vi.fn(),
    checkOut: vi.fn(),
  },
  attendanceKeys: {
    myToday: () => ["attendance", "my", "today"],
    myRecords: (p?: unknown) => ["attendance", "my", "records", p],
  },
  attendanceInvalidation: {
    checkIn: () => [
      ["attendance", "my", "today"],
      ["attendance", "my", "records"],
    ],
    checkOut: () => [
      ["attendance", "my", "today"],
      ["attendance", "my", "records"],
    ],
  },
  showApiErrorToast: vi.fn(),
  formatDateTime: (v: string) => v,
  formatTime: (v: string) => v,
}));

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({
      title,
      description,
      children,
    }: {
      title: string;
      description?: string;
      children?: React.ReactNode;
    }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {children}
      </div>
    ),
    Skeleton: () => <div data-testid="skeleton" />,
  };
});

import { useCan, attendanceApi } from "@mediaos/web-core";
import { AttendanceTodayPage } from "./AttendanceTodayPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockGetToday = attendanceApi.getToday as ReturnType<typeof vi.fn>;
const mockCheckIn = attendanceApi.checkIn as ReturnType<typeof vi.fn>;

// ── Test data fixtures ────────────────────────────────────────────────────────

const TODAY_BASE = {
  workDate: "2026-07-01",
  employee: { id: "emp-1", status: "Official" },
  shift: {
    id: "shift-1",
    shiftCode: "OFFICE",
    name: "Ca hành chính",
    startTime: "08:00",
    endTime: "17:30",
    breakMinutes: 90,
    requiredWorkingMinutes: 480,
    graceLateMinutes: 5,
    graceEarlyLeaveMinutes: 5,
    crossDay: false,
    isDefault: true,
    timezone: "Asia/Ho_Chi_Minh",
  },
  rule: {
    id: "rule-1",
    ruleCode: "DEFAULT",
    requireCheckIn: true,
    requireCheckOut: true,
    blockWhenLeaveApproved: true,
  },
  periodLocked: false,
};

/** Chưa check-in — can_check_in=true, can_check_out=false */
const TODAY_NOT_CHECKED_IN = {
  ...TODAY_BASE,
  record: null,
  allowedActions: { canCheckIn: true, canCheckOut: false },
  disabledReason: null,
};

/** Đã check-in — can_check_in=false, can_check_out=true */
const TODAY_CHECKED_IN = {
  ...TODAY_BASE,
  record: {
    id: "rec-1",
    workDate: "2026-07-01",
    employeeId: "emp-1",
    shiftId: "shift-1",
    checkInAt: "2026-07-01T01:05:00.000Z",
    checkOutAt: null,
    checkInMethod: "web",
    checkOutMethod: null,
    lateMinutes: 5,
    earlyLeaveMinutes: 0,
    workingMinutes: null,
    requiredWorkingMinutes: 480,
    missingMinutes: null,
    breakMinutes: 90,
    status: "late",
    attendanceStatus: "Late",
    isLate: true,
    isEarlyLeave: false,
    isMissingCheckOut: false,
  },
  allowedActions: { canCheckIn: false, canCheckOut: true },
  disabledReason: null,
};

/** Nghỉ phép cả ngày — cả 2 disabled + disabledReason */
const TODAY_FULL_DAY_LEAVE = {
  ...TODAY_BASE,
  record: null,
  allowedActions: { canCheckIn: false, canCheckOut: false },
  disabledReason: "Bạn đã có đơn nghỉ phép được duyệt trong ngày hôm nay.",
};

/** Đã check-out — cả 2 disabled */
const TODAY_CHECKED_OUT = {
  ...TODAY_BASE,
  record: {
    id: "rec-2",
    workDate: "2026-07-01",
    employeeId: "emp-1",
    shiftId: "shift-1",
    checkInAt: "2026-07-01T01:05:00.000Z",
    checkOutAt: "2026-07-01T10:30:00.000Z",
    checkInMethod: "web",
    checkOutMethod: "web",
    lateMinutes: 5,
    earlyLeaveMinutes: 0,
    workingMinutes: 470,
    requiredWorkingMinutes: 480,
    missingMinutes: 10,
    breakMinutes: 90,
    status: "present",
    attendanceStatus: "Checked-out",
    isLate: false,
    isEarlyLeave: false,
    isMissingCheckOut: false,
  },
  allowedActions: { canCheckIn: false, canCheckOut: false },
  disabledReason: null,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <AttendanceTodayPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Mặc định: user có cả 3 quyền (view-own, check-in, check-out)
  mockUseCan.mockImplementation((action: string) => {
    return ["view-own", "check-in", "check-out"].includes(action);
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AttendanceTodayPage", () => {
  // ── Deny-path: forbidden ────────────────────────────────────────────────────
  it("shows forbidden state when useCan view-own:attendance returns false", () => {
    mockUseCan.mockReturnValue(false);
    renderPage(buildQC());
    // EmptyState renders forbidden.title (both title + description contain "quyền")
    expect(screen.getAllByText(/quyền/i).length).toBeGreaterThan(0);
    // Không gọi API khi không có quyền
    expect(mockGetToday).not.toHaveBeenCalled();
  });

  // ── Loading ─────────────────────────────────────────────────────────────────
  it("shows loading skeleton while query is pending", () => {
    mockGetToday.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage(buildQC());
    expect(screen.getByTestId("today-loading")).toBeInTheDocument();
  });

  // ── Error ───────────────────────────────────────────────────────────────────
  it("shows error state when API fails", async () => {
    mockGetToday.mockRejectedValue(new Error("Network error"));
    renderPage(buildQC());
    await waitFor(() => {
      expect(screen.getByText(/tải dữ liệu/i)).toBeInTheDocument();
    });
  });

  // ── Check-in enabled, check-out disabled ────────────────────────────────────
  it("enables Check-in button and disables Check-out when not yet checked in", async () => {
    mockGetToday.mockResolvedValue(TODAY_NOT_CHECKED_IN);
    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("btn-check-in")).toBeInTheDocument();
    });

    const checkInBtn = screen.getByTestId("btn-check-in");
    const checkOutBtn = screen.getByTestId("btn-check-out");

    expect(checkInBtn).not.toBeDisabled();
    expect(checkOutBtn).toBeDisabled();
  });

  // ── Check-out enabled, check-in disabled ────────────────────────────────────
  it("disables Check-in and enables Check-out after check-in", async () => {
    mockGetToday.mockResolvedValue(TODAY_CHECKED_IN);
    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("btn-check-out")).toBeInTheDocument();
    });

    const checkInBtn = screen.getByTestId("btn-check-in");
    const checkOutBtn = screen.getByTestId("btn-check-out");

    expect(checkInBtn).toBeDisabled();
    expect(checkOutBtn).not.toBeDisabled();
  });

  // ── Both disabled after check-out ───────────────────────────────────────────
  it("disables both buttons after check-out", async () => {
    mockGetToday.mockResolvedValue(TODAY_CHECKED_OUT);
    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("btn-check-in")).toBeInTheDocument();
    });

    expect(screen.getByTestId("btn-check-in")).toBeDisabled();
    expect(screen.getByTestId("btn-check-out")).toBeDisabled();
  });

  // ── Full-day leave: both disabled + disabled reason shown ────────────────────
  it("disables both buttons and shows disabledReason when full-day leave", async () => {
    mockGetToday.mockResolvedValue(TODAY_FULL_DAY_LEAVE);
    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("btn-check-in")).toBeInTheDocument();
    });

    expect(screen.getByTestId("btn-check-in")).toBeDisabled();
    expect(screen.getByTestId("btn-check-out")).toBeDisabled();
    // disabledReason shown
    expect(screen.getByText(/đơn nghỉ phép được duyệt/i)).toBeInTheDocument();
  });

  // ── Check-in mutation success ────────────────────────────────────────────────
  it("shows success feedback after check-in", async () => {
    mockGetToday.mockResolvedValue(TODAY_NOT_CHECKED_IN);
    mockCheckIn.mockResolvedValue({ id: "rec-new", checkInAt: "2026-07-01T01:10:00.000Z" });
    // After mutation, simulate today returning checked-in state
    mockGetToday.mockResolvedValueOnce(TODAY_NOT_CHECKED_IN).mockResolvedValue(TODAY_CHECKED_IN);

    renderPage(buildQC());

    await waitFor(() => expect(screen.getByTestId("btn-check-in")).not.toBeDisabled());

    fireEvent.click(screen.getByTestId("btn-check-in"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(mockCheckIn).toHaveBeenCalledTimes(1);
  });

  // ── Deny-path: no check-in permission → check-in button hidden ──────────────
  it("hides Check-in button when useCan check-in:attendance is false", async () => {
    mockUseCan.mockImplementation((action: string) => {
      // has view-own and check-out but NOT check-in
      return action === "view-own" || action === "check-out";
    });
    mockGetToday.mockResolvedValue(TODAY_NOT_CHECKED_IN);
    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("attendance-status-card")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("btn-check-in")).not.toBeInTheDocument();
    expect(screen.getByTestId("btn-check-out")).toBeInTheDocument();
  });

  // ── Status card renders ──────────────────────────────────────────────────────
  it("renders AttendanceStatusCard with shift name", async () => {
    mockGetToday.mockResolvedValue(TODAY_CHECKED_IN);
    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("attendance-status-card")).toBeInTheDocument();
    });
    expect(screen.getByText("Ca hành chính")).toBeInTheDocument();
  });
});
