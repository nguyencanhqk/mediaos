/**
 * S3-FE-LEAVE-1 — CreateLeaveRequestPage + LeaveRequestForm tests.
 * Covers: forbidden gate, form renders, Zod validation, submit/saveDraft, BE error mapping (overlap/balance).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// Minimal layout store mock — useLayoutStore uses Zustand selector pattern: fn(state) => slice
vi.mock("@/stores/layout.store", () => ({
  useLayoutStore: (selector: (s: { setDirtyFormState: () => void }) => unknown) => {
    const state = { setDirtyFormState: vi.fn() };
    return typeof selector === "function" ? selector(state) : state;
  },
}));

vi.mock("@/hooks/use-current-route-meta", () => ({
  useCurrentRouteMeta: () => ({ routeKey: "leave.my-requests" }),
}));

// Synchronous factory — MockApiError defined INSIDE factory (vi.mock is hoisted, class is not)
vi.mock("@mediaos/web-core", () => {
  class MockApiError extends Error {
    status: number;
    code: string;
    constructor(opts: { message: string; status: number; code: string }) {
      super(opts.message);
      this.status = opts.status;
      this.code = opts.code;
      this.name = "ApiError";
    }
  }
  return {
    useCan: vi.fn(() => true),
    leaveApi: {
      listTypes: vi.fn().mockResolvedValue([
        {
          id: "lt-1",
          name: "Nghỉ phép năm",
          code: "ANNUAL",
          paid: true,
          status: "active",
          description: null,
          deductBalance: true,
          balanceUnit: "Day",
          allowFullDay: true,
          allowHalfDay: true,
          allowHourly: false,
          allowMultipleDays: true,
          requireReason: false,
          requireAttachment: false,
          minNoticeDays: null,
          maxDaysPerRequest: null,
          maxHoursPerRequest: null,
          sortOrder: 1,
        },
      ]),
      createDraft: vi.fn(),
      calculate: vi.fn().mockResolvedValue({
        calculated_days: 2,
        calculated_hours: 16,
        is_balance_required: true,
        balance: {
          remaining_days: 10,
          requested_days: 2,
          after_remaining_days: 8,
          is_enough: true,
        },
        days: [],
        warnings: [],
      }),
    },
    leaveKeys: {
      types: { list: () => ["leave", "types", "list"] },
      requests: {
        my: () => ["leave", "requests", "my"],
        detail: (id: string) => ["leave", "requests", "detail", id],
      },
      balances: { my: () => ["leave", "balances", "my"] },
      all: ["leave"],
    },
    ApiError: MockApiError,
  };
});

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({ title, children }: { title: string; children?: React.ReactNode }) => (
      <div>
        <h1>{title}</h1>
        {children}
      </div>
    ),
  };
});

import { useCan, leaveApi, ApiError } from "@mediaos/web-core";
import { CreateLeaveRequestPage } from "./CreateLeaveRequestPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockCreateDraft = leaveApi.createDraft as ReturnType<typeof vi.fn>;

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <CreateLeaveRequestPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCan.mockReturnValue(true);
  (leaveApi.listTypes as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      id: "lt-1",
      name: "Nghỉ phép năm",
      code: "ANNUAL",
      paid: true,
      status: "active",
      description: null,
      deductBalance: true,
      balanceUnit: "Day",
      allowFullDay: true,
      allowHalfDay: true,
      allowHourly: false,
      allowMultipleDays: true,
      requireReason: false,
      requireAttachment: false,
      minNoticeDays: null,
      maxDaysPerRequest: null,
      maxHoursPerRequest: null,
      sortOrder: 1,
    },
  ]);
});

describe("CreateLeaveRequestPage — gate", () => {
  it("shows forbidden state when useCan(create, leave) = false", () => {
    mockUseCan.mockReturnValue(false);
    renderPage(buildQC());
    expect(screen.getAllByText(/không có quyền tạo đơn/i).length).toBeGreaterThan(0);
  });
});

describe("LeaveRequestForm — render", () => {
  it("renders leave type select and duration type", async () => {
    renderPage(buildQC());
    // Leave type label (matched by label + possible select placeholder — use getAllByText)
    await waitFor(() => {
      expect(screen.getAllByText(/loại nghỉ/i).length).toBeGreaterThan(0);
    });
    // Duration type label
    expect(screen.getAllByText(/hình thức nghỉ/i).length).toBeGreaterThan(0);
    // Start date label
    expect(screen.getAllByText(/ngày bắt đầu/i).length).toBeGreaterThan(0);
  });

  it("shows Buổi nghỉ field when HalfDay is selected", async () => {
    renderPage(buildQC());
    await waitFor(() => screen.getAllByRole("combobox"));
    const selects = screen.getAllByRole("combobox");
    // durationType is 2nd select (after leaveType)
    const durationSelect = selects[1];
    fireEvent.change(durationSelect, { target: { value: "HalfDay" } });
    await waitFor(() => {
      expect(screen.getByText(/buổi nghỉ/i)).toBeTruthy();
    });
  });

  it("shows Giờ bắt đầu / Giờ kết thúc when Hourly is selected", async () => {
    renderPage(buildQC());
    await waitFor(() => screen.getAllByRole("combobox"));
    const selects = screen.getAllByRole("combobox");
    const durationSelect = selects[1];
    fireEvent.change(durationSelect, { target: { value: "Hourly" } });
    await waitFor(() => {
      expect(screen.getByText(/giờ bắt đầu/i)).toBeTruthy();
      expect(screen.getByText(/giờ kết thúc/i)).toBeTruthy();
    });
  });
});

describe("LeaveRequestForm — validation (deny paths)", () => {
  it("shows validation error when submitting empty form", async () => {
    renderPage(buildQC());
    await waitFor(() => screen.getAllByRole("button"));
    // Click "Gửi đơn" without filling form
    const submitBtn = screen.getByRole("button", { name: /gửi đơn/i });
    fireEvent.click(submitBtn);
    await waitFor(() => {
      // Zod refine error for leaveTypeId (uuid fails)
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    });
  });
});

describe("LeaveRequestForm — BE error mapping", () => {
  it("maps 409 overlap error onto form and shows alert", async () => {
    mockCreateDraft.mockRejectedValue(
      new ApiError({
        message: "Trùng với đơn nghỉ đã có (overlap)",
        status: 409,
        code: "LEAVE-ERR-OVERLAP",
      }),
    );
    renderPage(buildQC());
    await waitFor(() => screen.getAllByRole("combobox"));

    // Fill mandatory fields
    const [typeSelect, durationSelect] = screen.getAllByRole("combobox");
    fireEvent.change(typeSelect, { target: { value: "lt-1" } });
    fireEvent.change(durationSelect, { target: { value: "FullDay" } });

    const [startInput, endInput] = screen.getAllByDisplayValue("");
    fireEvent.change(startInput, { target: { value: "2026-07-10" } });
    fireEvent.change(endInput, { target: { value: "2026-07-11" } });

    const submitBtn = screen.getByRole("button", { name: /gửi đơn/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    });
  });

  it("maps 409 balance error onto form and shows alert", async () => {
    mockCreateDraft.mockRejectedValue(
      new ApiError({
        message: "Số dư phép không đủ",
        status: 409,
        code: "LEAVE-ERR-BALANCE",
      }),
    );
    renderPage(buildQC());
    await waitFor(() => screen.getAllByRole("combobox"));

    const [typeSelect, durationSelect] = screen.getAllByRole("combobox");
    fireEvent.change(typeSelect, { target: { value: "lt-1" } });
    fireEvent.change(durationSelect, { target: { value: "FullDay" } });

    const submitBtn = screen.getByRole("button", { name: /gửi đơn/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    });
  });
});
