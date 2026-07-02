// @vitest-environment jsdom
/**
 * CreateAdjustmentRequestPage + AdjustmentRequestForm tests (S3-FE-ATT-3, P0).
 * Phủ: deny-path (create-own:adjustment=false → forbidden, KHÔNG render form) · render field theo
 * requestType · validation (submit rỗng → alert, KHÔNG gọi API) · happy-path submit → navigate detail ·
 * lỗi 403 → thông điệp forbidden inline.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@mediaos/web-core", () => {
  class MockApiError extends Error {
    status: number;
    constructor(status: number, message = "") {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return {
    ApiError: MockApiError,
    useCan: vi.fn(() => true),
    attendanceApi: { createAdjustmentRequest: vi.fn() },
    attendanceKeys: { adjustments: { all: ["attendance", "adjustments"] } },
    attendanceInvalidation: { createAdjustment: () => [["attendance", "adjustments"]] },
  };
});

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({ title, children }: { title: string; children?: React.ReactNode }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        {children}
      </div>
    ),
  };
});

import { useCan, attendanceApi, ApiError } from "@mediaos/web-core";
import { CreateAdjustmentRequestPage } from "./CreateAdjustmentRequestPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockCreate = attendanceApi.createAdjustmentRequest as ReturnType<typeof vi.fn>;

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  const qc = buildQC();
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <CreateAdjustmentRequestPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCan.mockReturnValue(true);
});

describe("CreateAdjustmentRequestPage — deny-path", () => {
  it("useCan('create-own','adjustment')=false → forbidden EmptyState, form KHÔNG render", () => {
    mockUseCan.mockReturnValue(false);
    renderPage();
    expect(screen.getAllByText(/không có quyền tạo đơn/i).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/lý do/i)).not.toBeInTheDocument();
  });
});

describe("CreateAdjustmentRequestPage — render", () => {
  it("renders request type / work date / reason fields; hides check-in/out for OTHER (default)", () => {
    renderPage();
    expect(screen.getByLabelText(/loại yêu cầu/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ngày làm việc/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^lý do$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/giờ check-in đề nghị/i)).not.toBeInTheDocument();
  });

  it("shows requestedCheckInAt field when requestType=MISSING_CHECK_IN", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/loại yêu cầu/i), {
      target: { value: "MISSING_CHECK_IN" },
    });
    expect(screen.getByLabelText(/giờ check-in đề nghị/i)).toBeInTheDocument();
  });
});

describe("CreateAdjustmentRequestPage — validation (deny path)", () => {
  it("submit empty form → validation alert, createAdjustmentRequest KHÔNG được gọi", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /gửi đơn/i }));
    await waitFor(() => {
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("CreateAdjustmentRequestPage — happy path", () => {
  it("fills required fields (OTHER type) + submits → createAdjustmentRequest called, navigate tới detail", async () => {
    mockCreate.mockResolvedValue({ id: "adj-1" });
    renderPage();

    fireEvent.change(screen.getByLabelText(/ngày làm việc/i), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(screen.getByLabelText(/^lý do$/i), {
      target: { value: "Quên chấm công hôm đó" },
    });
    fireEvent.click(screen.getByRole("button", { name: /gửi đơn/i }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
    const body = mockCreate.mock.calls[0][0];
    expect(body.workDate).toBe("2026-07-01");
    expect(body.requestType).toBe("OTHER");
    expect(body.reason).toBe("Quên chấm công hôm đó");

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/attendance/adjustment-requests/adj-1" }),
      );
    });
  });

  it("403 khi submit → thông điệp forbidden inline", async () => {
    mockCreate.mockRejectedValue(new ApiError(403, "ERR", "forbidden"));
    renderPage();

    fireEvent.change(screen.getByLabelText(/ngày làm việc/i), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(screen.getByLabelText(/^lý do$/i), { target: { value: "Lý do hợp lệ" } });
    fireEvent.click(screen.getByRole("button", { name: /gửi đơn/i }));

    await waitFor(() => {
      expect(screen.getByText(/không có quyền thực hiện thao tác này/i)).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
