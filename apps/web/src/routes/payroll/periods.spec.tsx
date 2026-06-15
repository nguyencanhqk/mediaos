import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PayrollPeriodsPage } from "./periods";

const UUID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // người chạy lương
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"; // người duyệt (khác USER_A)
const ISO = "2026-06-15T08:00:00.000Z";

function makePeriod(overrides: object = {}) {
  return {
    id: UUID,
    companyId: UUID,
    periodMonth: "2026-06",
    status: "draft",
    attendancePeriodId: null,
    kpiLocked: false,
    createdBy: USER_A,
    approvedBy: null,
    approvedAt: null,
    publishedBy: null,
    publishedAt: null,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { client };
}

// Mock payrollPeriodApi
const mockList = vi.fn();
const mockApprove = vi.fn();
const mockPublish = vi.fn();

vi.mock("@/lib/payroll-period-api", () => ({
  payrollPeriodApi: {
    list: (...args: unknown[]) => mockList(...args),
    create: vi.fn(),
    approve: (...args: unknown[]) => mockApprove(...args),
    publish: (...args: unknown[]) => mockPublish(...args),
    remove: vi.fn(),
  },
}));

// Mock auth store — expose currentUserId via user.id + empty capabilities (no PermissionGate leak)
const mockCurrentUser = vi.fn(() => USER_B);
vi.mock("@/stores/auth", () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null; capabilities: Record<string, boolean> }) => unknown) =>
    selector({ user: { id: mockCurrentUser() }, capabilities: {} }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PayrollPeriodsPage — FSM button states", () => {
  it("renders 'Duyệt' button for draft period", async () => {
    mockList.mockResolvedValue([makePeriod({ status: "draft" })]);
    wrap(<PayrollPeriodsPage />);
    expect(await screen.findByRole("button", { name: /duyệt/i })).toBeInTheDocument();
  });

  it("renders 'Phát hành' button for approved period (not draft)", async () => {
    mockList.mockResolvedValue([makePeriod({ status: "approved", approvedBy: USER_B, approvedAt: ISO })]);
    wrap(<PayrollPeriodsPage />);
    expect(await screen.findByRole("button", { name: /phát hành/i })).toBeInTheDocument();
    // Duyệt button should not be present for approved period
    expect(screen.queryByRole("button", { name: /^duyệt$/i })).not.toBeInTheDocument();
  });

  it("renders no approve/publish button for published period", async () => {
    mockList.mockResolvedValue([
      makePeriod({ status: "published", approvedBy: USER_B, approvedAt: ISO, publishedBy: USER_B, publishedAt: ISO }),
    ]);
    wrap(<PayrollPeriodsPage />);
    await waitFor(() => expect(screen.queryByText(/đang tải/i)).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /duyệt|phát hành/i })).not.toBeInTheDocument();
  });
});

describe("PayrollPeriodsPage — SoD guard", () => {
  it("shows SoD warning and disables 'Duyệt' when currentUser === createdBy", async () => {
    // currentUser = USER_A, createdBy = USER_A → SoD violation
    mockCurrentUser.mockReturnValue(USER_A);
    mockList.mockResolvedValue([makePeriod({ status: "draft", createdBy: USER_A })]);
    wrap(<PayrollPeriodsPage />);

    await waitFor(() => expect(screen.queryByText(/đang tải/i)).not.toBeInTheDocument());

    // SoD warning should appear
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Duyệt button should be disabled
    const approveBtn = screen.getByRole("button", { name: /duyệt/i });
    expect(approveBtn).toBeDisabled();
  });

  it("enables 'Duyệt' when currentUser !== createdBy (proper SoD)", async () => {
    mockCurrentUser.mockReturnValue(USER_B);
    mockList.mockResolvedValue([makePeriod({ status: "draft", createdBy: USER_A })]);
    wrap(<PayrollPeriodsPage />);

    const btn = await screen.findByRole("button", { name: /duyệt/i });
    expect(btn).not.toBeDisabled();
  });
});

describe("PayrollPeriodsPage — optimistic approve (server fail-closed)", () => {
  it("calls approve api on click and shows server error when 403", async () => {
    mockCurrentUser.mockReturnValue(USER_B);
    mockList.mockResolvedValue([makePeriod({ status: "draft", createdBy: USER_A })]);
    mockApprove.mockRejectedValue(Object.assign(new Error("Người duyệt không được là người chạy lương"), { status: 403 }));
    wrap(<PayrollPeriodsPage />);

    const btn = await screen.findByRole("button", { name: /duyệt/i });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/người duyệt|forbidden|403/i),
    );
  });
});
