/**
 * S3-FE-LEAVE-1 — CreateLeaveRequestPage + LeaveRequestForm tests.
 * Covers: forbidden gate, form renders, Zod validation, submit/saveDraft, BE error mapping (overlap/balance),
 *         PreviewBox (calculate), dirty-form guard.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

// ── Hoisted stable mock for setDirtyFormState ────────────────────────────────
// Must be hoisted so it is available inside the vi.mock("@/stores/layout.store") factory below.
const mockSetDirtyFormState = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// Minimal layout store mock — hoisted stable fn so we can assert on it
vi.mock("@/stores/layout.store", () => ({
  useLayoutStore: (
    selector: (s: { setDirtyFormState: typeof mockSetDirtyFormState }) => unknown,
  ) => {
    const state = { setDirtyFormState: mockSetDirtyFormState };
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

/**
 * Fill the four fields required for Zod to pass (FullDay date range).
 *
 * Root cause of prior false-positive: `waitFor(() => getAllByRole("combobox"))` resolved before
 * the `listTypes` query resolved, so "lt-1" was not yet a valid <option> in the select. jsdom
 * ignores `select.value = "nonExistentOption"`, leaving it at "", which failed Zod min(1).
 *
 * Fix:
 *  1. Wait for the option text to confirm `listTypes` has resolved and the option is in the DOM.
 *  2. Use getByLabelText (aria-label) for date inputs — stable selector independent of DOM value.
 */
async function fillRequiredFields() {
  // Wait until the "Nghỉ phép năm" option is present, confirming listTypes query resolved
  await waitFor(() => screen.getByRole("option", { name: /nghỉ phép năm/i }));

  const [typeSelect, durationSelect] = screen.getAllByRole("combobox");
  fireEvent.change(typeSelect, { target: { value: "lt-1" } });
  fireEvent.change(durationSelect, { target: { value: "FullDay" } });

  // Find date inputs by aria-label — stable selector independent of DOM value or render timing.
  // t("form.fields.startDate") = "Ngày bắt đầu", t("form.fields.endDate") = "Ngày kết thúc"
  const startInput = screen.getByLabelText("Ngày bắt đầu");
  const endInput = screen.getByLabelText("Ngày kết thúc");
  fireEvent.change(startInput, { target: { value: "2026-07-10" } });
  fireEvent.change(endInput, { target: { value: "2026-07-11" } });
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
  // Re-set calculate mock after clearAllMocks (clearAllMocks resets mockResolvedValue state)
  (leaveApi.calculate as ReturnType<typeof vi.fn>).mockResolvedValue({
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
  });
});

// ── Gate ──────────────────────────────────────────────────────────────────────

describe("CreateLeaveRequestPage — gate", () => {
  it("shows forbidden state when useCan(create, leave) = false", () => {
    mockUseCan.mockReturnValue(false);
    renderPage(buildQC());
    expect(screen.getAllByText(/không có quyền tạo đơn/i).length).toBeGreaterThan(0);
  });
});

// ── Render ────────────────────────────────────────────────────────────────────

describe("LeaveRequestForm — render", () => {
  it("renders leave type select and duration type", async () => {
    renderPage(buildQC());
    await waitFor(() => {
      expect(screen.getAllByText(/loại nghỉ/i).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/hình thức nghỉ/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ngày bắt đầu/i).length).toBeGreaterThan(0);
  });

  it("shows Buổi nghỉ field when HalfDay is selected", async () => {
    renderPage(buildQC());
    await waitFor(() => screen.getAllByRole("combobox"));
    const selects = screen.getAllByRole("combobox");
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

// ── Validation (deny paths) ───────────────────────────────────────────────────

describe("LeaveRequestForm — validation (deny paths)", () => {
  it("shows validation error when submitting empty form", async () => {
    renderPage(buildQC());
    await waitFor(() => screen.getAllByRole("button"));
    const submitBtn = screen.getByRole("button", { name: /gửi đơn/i });
    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    });
  });
});

// ── BE error mapping ──────────────────────────────────────────────────────────

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
    await fillRequiredFields();

    const submitBtn = screen.getByRole("button", { name: /gửi đơn/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateDraft).toHaveBeenCalled();
    });
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  /**
   * Regression guard for FALSE POSITIVE (S3-FE-LEAVE-1-FIX-A):
   * The previous test did NOT fill startDate/endDate, so zodResolver blocked handleSubmit and
   * createDraft was never invoked. Alerts were Zod required-field errors, NOT the 409 mapping.
   *
   * This rewrite fills ALL required fields so Zod passes, then verifies:
   *   1. createDraft WAS called (proves the form submitted past Zod)
   *   2. The resulting role="alert" contains balance-related text (proves the 409 mapping ran)
   */
  it("maps 409 balance error onto form and shows alert containing balance text", async () => {
    mockCreateDraft.mockRejectedValue(
      new ApiError({
        message: "Số dư phép không đủ",
        status: 409,
        code: "LEAVE-ERR-BALANCE",
      }),
    );
    renderPage(buildQC());

    // Fill all required fields so zodResolver passes → handleSubmit calls onSubmit → createDraft invoked
    await fillRequiredFields();

    const submitBtn = screen.getByRole("button", { name: /gửi đơn/i });
    fireEvent.click(submitBtn);

    // KEY assertion: createDraft must have been invoked (Zod validation passed)
    await waitFor(() => {
      expect(mockCreateDraft).toHaveBeenCalled();
    });

    // BE error mapping: role="alert" must contain balance-related text from t("form.errors.insufficientBalance")
    const alertTexts = screen
      .getAllByRole("alert")
      .map((el) => el.textContent ?? "")
      .join(" ");
    expect(alertTexts).toMatch(/không đủ|số ngày phép|insufficientBalance/i);
  });
});

// ── PreviewBox via /leave/calculate ──────────────────────────────────────────

describe("LeaveRequestForm — PreviewBox", () => {
  /**
   * AC: preview box (số ngày/giờ + balance trước/sau qua /leave/calculate).
   * Fills all four fields that trigger isCalculateReady → useQuery runs → PreviewBox renders data.
   */
  it("renders PreviewBox with calculated_days, remaining_days, after_remaining_days from /leave/calculate", async () => {
    renderPage(buildQC());
    await fillRequiredFields();

    // Wait for React Query to resolve calculate mock and PreviewBox to render
    // t("form.preview.title") = "Xem trước"
    await waitFor(() => {
      expect(screen.getAllByText(/xem trước/i).length).toBeGreaterThan(0);
    });

    // Numeric values from the calculate mock response (calculated_days=2, calculated_hours=16, remaining_days=10, after_remaining_days=8)
    expect(screen.getByText("2")).toBeTruthy(); // calculated_days
    expect(screen.getByText("16")).toBeTruthy(); // calculated_hours
    expect(screen.getByText("10")).toBeTruthy(); // balance.remaining_days
    expect(screen.getByText("8")).toBeTruthy(); // balance.after_remaining_days
  });
});

// ── Dirty-form guard ──────────────────────────────────────────────────────────

describe("LeaveRequestForm — dirty-form guard", () => {
  /**
   * AC: dirty-form guard — useDirtyFormGuard is wired with routeKey from useCurrentRouteMeta.
   * When any field changes (form.formState.isDirty = true), setDirtyFormState must be called
   * with an object containing routeKey.
   *
   * Uses a register()-based date input (not Controller) and wraps in act() to flush all
   * pending React state updates and useEffect callbacks before asserting.
   */
  it("calls setDirtyFormState with routeKey when form becomes dirty", async () => {
    renderPage(buildQC());
    await waitFor(() => screen.getAllByRole("combobox"));

    // Change startDate (register()-based input) from default "" → "2026-07-10": makes isDirty=true.
    // act(async) flushes all state updates + useEffect callbacks so setDirtyFormState is called before assertion.
    const startInput = screen.getByLabelText("Ngày bắt đầu");
    await act(async () => {
      fireEvent.change(startInput, { target: { value: "2026-07-10" } });
    });

    // useDirtyFormGuard effect must have run: setDirtyFormState({ routeKey: "leave.my-requests", message: "..." })
    expect(mockSetDirtyFormState).toHaveBeenCalledWith(
      expect.objectContaining({ routeKey: expect.any(String) }),
    );
  });
});
