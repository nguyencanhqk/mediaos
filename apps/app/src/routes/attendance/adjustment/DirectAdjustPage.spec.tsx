// @vitest-environment jsdom
/**
 * DirectAdjustPage tests (S3-FE-ATT-3, ATT-FUNC-021).
 * Phủ: loading · 403/404/error trên fetch record · submit KHÔNG đổi field nào → chặn client (KHÔNG gọi
 * API) · submit đổi checkInAt + lý do hợp lệ → gọi adjustRecordDirect với items[] đúng · 403 khi submit
 * → thông điệp forbidden inline.
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
    formatDateTime: (v: string) => v,
    attendanceApi: {
      getRecord: vi.fn(),
      adjustRecordDirect: vi.fn(),
    },
    attendanceKeys: {
      records: { detail: (id: string) => ["attendance", "records", "detail", id] },
      adjustments: { all: ["attendance", "adjustments"] },
    },
    attendanceInvalidation: {
      adjustDirect: (id: string) => [
        ["attendance", "adjustments"],
        ["attendance", "records"],
        ["attendance", "records", "detail", id],
      ],
    },
  };
});

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        {actions}
      </div>
    ),
  };
});

import { attendanceApi, ApiError } from "@mediaos/web-core";
import { DirectAdjustPage } from "./DirectAdjustPage";

const mockGetRecord = attendanceApi.getRecord as ReturnType<typeof vi.fn>;
const mockAdjustDirect = attendanceApi.adjustRecordDirect as ReturnType<typeof vi.fn>;

const RECORD = {
  id: "rec-1",
  workDate: "2026-07-01",
  employeeId: "emp-1",
  shiftId: null,
  checkInAt: "2026-07-01T01:00:00.000Z",
  checkOutAt: null,
  checkInMethod: "web",
  checkOutMethod: null,
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  workingMinutes: null,
  requiredWorkingMinutes: null,
  missingMinutes: null,
  breakMinutes: null,
  status: "present",
  attendanceStatus: "Present",
  isLate: false,
  isEarlyLeave: false,
  isMissingCheckOut: false,
  userId: "u-1",
  employeeCode: "EMP001",
  fullName: "Nguyen Van A",
  orgUnitId: null,
  orgUnitName: null,
  locationJson: null,
  workScheduleId: null,
  checkInStatus: null,
  checkOutStatus: null,
  attendanceSource: null,
  workMode: null,
  createdAt: "2026-07-01T01:00:00.000Z",
  updatedAt: "2026-07-01T01:00:00.000Z",
};

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  return render(
    <QueryClientProvider client={buildQC()}>
      <I18nextProvider i18n={i18n}>
        <DirectAdjustPage recordId="rec-1" />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DirectAdjustPage — states", () => {
  it("loading → direct-adjust-loading", () => {
    mockGetRecord.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId("direct-adjust-loading")).toBeInTheDocument();
  });

  it("403 khi tải bản ghi → forbidden", async () => {
    mockGetRecord.mockRejectedValue(new ApiError(403, "ERR", "forbidden"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không có quyền xem chi tiết bản ghi/i)).toBeInTheDocument();
    });
  });

  it("404 khi tải bản ghi → notFound", async () => {
    mockGetRecord.mockRejectedValue(new ApiError(404, "ERR", "not found"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/bản ghi chấm công không tồn tại/i)).toBeInTheDocument();
    });
  });
});

describe("DirectAdjustPage — validation (deny path)", () => {
  it("submit KHÔNG đổi check-in/out → chặn client, KHÔNG gọi adjustRecordDirect", async () => {
    mockGetRecord.mockResolvedValue(RECORD);
    renderPage();
    await waitFor(() => screen.getByLabelText(/lý do điều chỉnh/i));

    fireEvent.change(screen.getByLabelText(/lý do điều chỉnh/i), {
      target: { value: "Lý do hợp lệ dài" },
    });
    fireEvent.click(screen.getByRole("button", { name: /áp dụng điều chỉnh/i }));

    await waitFor(() => {
      expect(screen.getByText(/cần thay đổi ít nhất 1 giá trị/i)).toBeInTheDocument();
    });
    expect(mockAdjustDirect).not.toHaveBeenCalled();
  });
});

describe("DirectAdjustPage — happy path", () => {
  it("đổi check-in + lý do hợp lệ → gọi adjustRecordDirect với items[checkInAt]", async () => {
    mockGetRecord.mockResolvedValue(RECORD);
    mockAdjustDirect.mockResolvedValue({ id: "adj-99" });
    renderPage();
    await waitFor(() => screen.getByLabelText(/check-in mới/i));

    fireEvent.change(screen.getByLabelText(/check-in mới/i), {
      target: { value: "2026-07-01T09:00" },
    });
    fireEvent.change(screen.getByLabelText(/lý do điều chỉnh/i), {
      target: { value: "Sửa giờ check-in sai" },
    });
    fireEvent.click(screen.getByRole("button", { name: /áp dụng điều chỉnh/i }));

    await waitFor(() => {
      expect(mockAdjustDirect).toHaveBeenCalledTimes(1);
    });
    const [recordId, body] = mockAdjustDirect.mock.calls[0];
    expect(recordId).toBe("rec-1");
    expect(body.reason).toBe("Sửa giờ check-in sai");
    expect(body.items).toEqual([expect.objectContaining({ fieldName: "checkInAt" })]);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/attendance/adjustment-requests/adj-99" }),
      );
    });
  });

  it("403 khi submit → thông điệp forbidden inline", async () => {
    mockGetRecord.mockResolvedValue(RECORD);
    mockAdjustDirect.mockRejectedValue(new ApiError(403, "ERR", "forbidden"));
    renderPage();
    await waitFor(() => screen.getByLabelText(/check-in mới/i));

    fireEvent.change(screen.getByLabelText(/check-in mới/i), {
      target: { value: "2026-07-01T09:00" },
    });
    fireEvent.change(screen.getByLabelText(/lý do điều chỉnh/i), {
      target: { value: "Sửa giờ check-in sai" },
    });
    fireEvent.click(screen.getByRole("button", { name: /áp dụng điều chỉnh/i }));

    await waitFor(() => {
      expect(screen.getByText(/bạn không có quyền điều chỉnh trực tiếp/i)).toBeInTheDocument();
    });
  });
});
