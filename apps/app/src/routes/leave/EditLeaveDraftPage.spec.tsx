/**
 * S3-FE-LEAVE-3 — EditLeaveDraftPage tests (LEAVE-SCREEN-002E, sửa đơn nháp).
 *
 * Covers:
 *  - gate: update-draft:leave=false → forbidden mềm + KHÔNG gọi getMyRequest.
 *  - loading skeleton.
 *  - error / not-found (404) states.
 *  - business rule: đơn không còn Draft → "không thể sửa" + KHÔNG render form.
 *  - happy path: đơn Draft → form hiện, prefill leaveType, submit gọi updateDraft(id, body KHÔNG có submitNow).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockSetDirtyFormState = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

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
      getMyRequest: vi.fn(),
      updateDraft: vi.fn(),
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
      calculate: vi.fn().mockResolvedValue({
        calculated_days: 2,
        calculated_hours: 16,
        is_balance_required: false,
        balance: null,
        days: [],
        warnings: [],
      }),
    },
    leaveKeys: {
      all: ["leave"],
      requests: {
        my: () => ["leave", "requests", "my"],
        detail: (id: string) => ["leave", "requests", "detail", id],
      },
      balances: { my: () => ["leave", "balances", "my"] },
      types: { list: () => ["leave", "types", "list"] },
    },
    ApiError: MockApiError,
  };
});

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({ title, description }: { title: string; description?: string }) => (
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
    ),
  };
});

import { useCan, leaveApi, ApiError } from "@mediaos/web-core";
import { EditLeaveDraftPage } from "./EditLeaveDraftPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockGetMyRequest = leaveApi.getMyRequest as ReturnType<typeof vi.fn>;
const mockUpdateDraft = leaveApi.updateDraft as ReturnType<typeof vi.fn>;

const DRAFT_REQUEST = {
  id: "req-1",
  leaveTypeId: "lt-1",
  leaveTypeCode: "ANNUAL",
  leaveTypeName: "Nghỉ phép năm",
  startDate: "2026-07-10",
  endDate: "2026-07-11",
  durationType: "FullDay",
  totalDays: 2,
  totalHours: null,
  status: "Draft",
  reason: "Việc gia đình",
  handoverNote: null,
  contactDuringLeave: null,
  balanceEffectStatus: null,
  submittedAt: null,
  createdAt: "2026-07-01T08:50:00.000Z",
  employeeId: "emp-1",
  leavePolicyId: null,
  halfDaySession: null,
  startTime: null,
  endTime: null,
  cancelReason: null,
  cancelledAt: null,
  days: [],
  approvals: [],
};

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient, requestId = "req-1") {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <EditLeaveDraftPage requestId={requestId} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCan.mockReturnValue(true);
});

// ── Gate ──────────────────────────────────────────────────────────────────────

describe("EditLeaveDraftPage — gate update-draft:leave", () => {
  it("forbidden mềm + KHÔNG gọi getMyRequest khi update-draft:leave=false", () => {
    mockUseCan.mockReturnValue(false);
    renderPage(buildQC());
    expect(screen.getAllByText(/không có quyền/i).length).toBeGreaterThan(0);
    expect(mockGetMyRequest).not.toHaveBeenCalled();
  });

  it("anti-false-green: gate gọi ĐÚNG cặp update-draft:leave", async () => {
    mockGetMyRequest.mockResolvedValue(DRAFT_REQUEST);
    renderPage(buildQC());
    await waitFor(() => expect(mockGetMyRequest).toHaveBeenCalled());
    expect(mockUseCan).toHaveBeenCalledWith("update-draft", "leave");
  });
});

// ── Data states ────────────────────────────────────────────────────────────────

describe("EditLeaveDraftPage — data states", () => {
  it("hiện lỗi khi getMyRequest thất bại (không phải 404)", async () => {
    // Lỗi non-404 → query.retry (count<2) THỰC SỰ retry trước khi fail (retry fn của trang override
    // client default retry:false) → cần timeout dài hơn mặc định của waitFor (1000ms).
    mockGetMyRequest.mockRejectedValue(new Error("network"));
    renderPage(buildQC());
    await waitFor(() => expect(screen.getByText(/không thể tải đơn nghỉ/i)).toBeTruthy(), {
      timeout: 5000,
    });
  }, 10000);

  it("hiện not-found khi 404", async () => {
    mockGetMyRequest.mockRejectedValue(
      new ApiError({ message: "not found", status: 404, code: "LEAVE-ERR-404" }),
    );
    renderPage(buildQC());
    await waitFor(() => expect(screen.getByText(/không tìm thấy đơn nghỉ/i)).toBeTruthy());
  });
});

// ── Business rule: chỉ sửa được Draft ─────────────────────────────────────────

describe("EditLeaveDraftPage — business rule (chỉ Draft)", () => {
  it("đơn KHÔNG còn Draft → hiện 'không thể sửa', KHÔNG render form", async () => {
    mockGetMyRequest.mockResolvedValue({ ...DRAFT_REQUEST, status: "Pending" });
    renderPage(buildQC());
    await waitFor(() => expect(screen.getByText(/không thể sửa đơn này/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /lưu thay đổi/i })).not.toBeInTheDocument();
  });
});

// ── Happy path ─────────────────────────────────────────────────────────────────

describe("EditLeaveDraftPage — happy path", () => {
  it("đơn Draft → form hiện với dữ liệu prefill, submit gọi updateDraft (KHÔNG có submitNow)", async () => {
    mockGetMyRequest.mockResolvedValue(DRAFT_REQUEST);
    mockUpdateDraft.mockResolvedValue({ ...DRAFT_REQUEST, reason: "Lý do mới" });
    renderPage(buildQC());

    // Prefill: option loại nghỉ đã chọn đúng lt-1 (chờ listTypes + detail đều resolve)
    await waitFor(() => expect(screen.getByRole("button", { name: /lưu thay đổi/i })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /lưu thay đổi/i }));

    await waitFor(() => expect(mockUpdateDraft).toHaveBeenCalledTimes(1));
    const [calledId, calledBody] = mockUpdateDraft.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(calledId).toBe("req-1");
    expect(calledBody).not.toHaveProperty("submitNow");
    expect(calledBody.leaveTypeId).toBe("lt-1");
  });

  it("chỉ hiện DUY NHẤT nút 'Lưu thay đổi' — KHÔNG có nút 'Gửi đơn' (PATCH không hỗ trợ submitNow)", async () => {
    mockGetMyRequest.mockResolvedValue(DRAFT_REQUEST);
    renderPage(buildQC());
    await waitFor(() => expect(screen.getByRole("button", { name: /lưu thay đổi/i })).toBeTruthy());
    expect(screen.queryByRole("button", { name: /^gửi đơn$/i })).not.toBeInTheDocument();
  });
});
