// @vitest-environment jsdom
/**
 * [deny-path] PublicHolidaysPage — S2-FE-FND-4.
 *
 * Gate: view/manage:foundation-holiday (cặp seed thật mig 0435, is_sensitive=false → useCan wildcard OK).
 *  - THIẾU view → forbidden EmptyState, KHÔNG gọi holidayApi.list.
 *  - THIẾU manage → list render nhưng nút Thêm/Sửa/Xoá ẨN.
 *  - scope='global' (holiday hệ thống) KHÔNG hiện nút sửa/xoá dù có manage (server-owned).
 *  - Xoá luôn qua ConfirmDialog trước khi gọi remove(id).
 * DataTable dùng THẬT (không mock) để cột "actions" render đúng — chỉ mock PageHeader/EmptyState
 * (pattern theo AttendanceShiftsPage.spec.tsx) + HolidayFormDialog (form riêng, test độc lập nếu cần).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => false),
  holidayApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  foundationKeys: {
    holidays: {
      all: ["foundation", "holidays"],
      list: (params?: unknown) => ["foundation", "holidays", "list", params],
    },
  },
  foundationInvalidation: {
    createHoliday: () => [["foundation", "holidays"]],
    updateHoliday: () => [["foundation", "holidays"]],
    deleteHoliday: () => [["foundation", "holidays"]],
  },
  HOLIDAY_TYPES: ["PublicHoliday", "CompanyHoliday", "WorkingDayOverride", "SpecialDay"],
}));

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
    EmptyState: ({
      title,
      description,
      "data-testid": testId,
    }: {
      title: string;
      description?: string;
      "data-testid"?: string;
    }) => (
      <div data-testid={testId ?? "empty-state"}>
        <p>{title}</p>
        {description && <p>{description}</p>}
      </div>
    ),
    // DataTable = actual (unmocked) — cần render columns thật (nút edit/delete theo scope).
  };
});

// Form dialog test riêng (form validation) — ở đây chỉ cần biết nó KHÔNG mở khi thiếu quyền.
vi.mock("./HolidayFormDialog", () => ({
  HolidayFormDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="holiday-form-dialog" /> : null,
}));

import { useCan, holidayApi, type HolidayView } from "@mediaos/web-core";
import { PublicHolidaysPage } from "./PublicHolidaysPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockList = holidayApi.list as ReturnType<typeof vi.fn>;
const mockRemove = holidayApi.remove as ReturnType<typeof vi.fn>;

const HOLIDAY: HolidayView = {
  id: "hol-1",
  scope: "company",
  companyId: "co-001",
  holidayCode: "TET-2026",
  name: "Tết Nguyên Đán",
  holidayDate: "2026-02-17",
  holidayType: "PublicHoliday",
  countryCode: "VN",
  regionCode: null,
  isRecurring: true,
  affectsAttendance: true,
  affectsLeaveCalculation: true,
  isPaidHoliday: true,
  status: "Active",
  source: "manual",
  description: null,
};

const GLOBAL_HOLIDAY: HolidayView = {
  ...HOLIDAY,
  id: "hol-global-1",
  scope: "global",
  companyId: null,
  holidayCode: "NEWYEAR",
  name: "Tết Dương lịch",
};

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <PublicHolidaysPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PublicHolidaysPage", () => {
  it("[deny] no view:foundation-holiday → forbidden EmptyState + list NOT called", () => {
    mockUseCan.mockReturnValue(false);
    renderPage(buildQC());

    expect(screen.getByTestId("holidays-forbidden")).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("view only (no manage) → row renders, create/edit/delete buttons HIDDEN", async () => {
    mockUseCan.mockImplementation((action: string) => action === "view");
    mockList.mockResolvedValue([HOLIDAY]);

    renderPage(buildQC());

    await waitFor(() => expect(screen.getByText("Tết Nguyên Đán")).toBeInTheDocument());
    expect(mockList).toHaveBeenCalled();
    expect(screen.queryByTestId("holiday-create-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("holiday-edit-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("holiday-delete-btn")).not.toBeInTheDocument();
  });

  it("view + manage → create/edit/delete buttons shown for company-scope row", async () => {
    mockUseCan.mockReturnValue(true);
    mockList.mockResolvedValue([HOLIDAY]);

    renderPage(buildQC());

    await waitFor(() => expect(screen.getByText("Tết Nguyên Đán")).toBeInTheDocument());
    expect(screen.getByTestId("holiday-create-btn")).toBeInTheDocument();
    expect(screen.getByTestId("holiday-edit-btn")).toBeInTheDocument();
    expect(screen.getByTestId("holiday-delete-btn")).toBeInTheDocument();
  });

  it("HIDES edit/delete for scope='global' rows even with manage permission (server-owned)", async () => {
    mockUseCan.mockReturnValue(true);
    mockList.mockResolvedValue([GLOBAL_HOLIDAY]);

    renderPage(buildQC());

    await waitFor(() => expect(screen.getByText("Tết Dương lịch")).toBeInTheDocument());
    expect(screen.queryByTestId("holiday-edit-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("holiday-delete-btn")).not.toBeInTheDocument();
  });

  it("delete flow: click delete → ConfirmDialog → confirm → calls holidayApi.remove(id)", async () => {
    mockUseCan.mockReturnValue(true);
    mockList.mockResolvedValue([HOLIDAY]);
    mockRemove.mockResolvedValue({ id: HOLIDAY.id, deleted: true });

    renderPage(buildQC());
    await waitFor(() => expect(screen.getByText("Tết Nguyên Đán")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("holiday-delete-btn"));
    const dialog = await screen.findByRole("dialog");
    const confirmBtn = within(dialog).getByRole("button", { name: /^xoá$/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith(HOLIDAY.id));
  });

  it("shows error EmptyState when holidayApi.list fails", async () => {
    mockUseCan.mockReturnValue(true);
    mockList.mockRejectedValue(new Error("Network error"));

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
  });

  it("shows empty state when list resolves with 0 items", async () => {
    mockUseCan.mockReturnValue(true);
    mockList.mockResolvedValue([]);

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getAllByText(/chưa có ngày nghỉ lễ/i).length).toBeGreaterThan(0);
    });
  });
});
