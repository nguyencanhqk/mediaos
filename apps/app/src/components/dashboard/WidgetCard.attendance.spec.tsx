// @vitest-environment jsdom
/**
 * S20-DASH-QUICKACTION-1 — WidgetCard: đích quick action CŨ dẫn đúng chỗ + Check-in/Check-out ngay trên widget.
 *
 * - `API_CALL` CHECK_IN/CHECK_OUT ⇒ luồng chấm công ATT (useAttendanceToday + useCheckIn) — KHÔNG gọi
 *   `api_endpoint` của server một cách tổng quát.
 * - Widget tải lại (`onRefresh`) CHỈ sau khi server xác nhận; server từ chối ⇒ đúng lý do server trả, widget
 *   không tải lại (giữ trạng thái cũ).
 * - Quick action bị tắt (thiếu quyền) ⇒ không có nút, không gọi ATT.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { Clock } from "lucide-react";
import { ApiError, attendanceApi } from "@mediaos/web-core";
import type { AttendanceTodayV2Dto, QuickActionDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { WidgetCard } from "./WidgetCard";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigateMock }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: () => true,
    showApiErrorToast: vi.fn(),
    attendanceApi: {
      ...actual.attendanceApi,
      getToday: vi.fn(),
      checkIn: vi.fn(),
      checkOut: vi.fn(),
    },
  };
});

const CHECK_IN: QuickActionDto = {
  action_code: "CHECK_IN",
  label: "Check-in",
  target_module: "ATT",
  method: "API_CALL",
  target_url: null,
  api_endpoint: "/api/v1/attendance/check-in",
  enabled: true,
  disabled_reason: null,
};
const CHECK_OUT: QuickActionDto = {
  ...CHECK_IN,
  action_code: "CHECK_OUT",
  label: "Check-out",
  api_endpoint: "/api/v1/attendance/check-out",
};

function today(canCheckIn: boolean): AttendanceTodayV2Dto {
  return {
    workDate: "2026-10-26",
    employee: { id: "emp-1", status: "Official" },
    shift: null,
    rule: null,
    record: null,
    periodLocked: false,
    allowedActions: { canCheckIn, canCheckOut: !canCheckIn },
    disabledReason: null,
  } as unknown as AttendanceTodayV2Dto;
}

function renderCard(quickActions: readonly QuickActionDto[]) {
  const onRefresh = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <WidgetCard
          title="Chấm công hôm nay"
          icon={Clock}
          isLoading={false}
          isError={false}
          isEmpty={true}
          emptyTitle="Chưa có bản ghi"
          errorTitle="Lỗi"
          onRefresh={onRefresh}
          isRefreshing={false}
          quickActions={quickActions}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onRefresh };
}

describe("WidgetCard — Check-in/Check-out trên widget (S20-DASH-QUICKACTION-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("server xác nhận ⇒ gọi luồng ATT (không gọi api_endpoint tổng quát), rồi mới tải lại widget", async () => {
    vi.mocked(attendanceApi.getToday)
      .mockResolvedValueOnce(today(true))
      .mockResolvedValue(today(false));
    let confirm: (v: unknown) => void = () => undefined;
    vi.mocked(attendanceApi.checkIn).mockReturnValue(
      new Promise((resolve) => {
        confirm = resolve;
      }) as never,
    );
    const { onRefresh } = renderCard([CHECK_IN, CHECK_OUT]);

    fireEvent.click(await screen.findByTestId("btn-check-in"));
    await waitFor(() => expect(attendanceApi.checkIn).toHaveBeenCalledTimes(1));
    // Chưa có xác nhận ⇒ nút ở trạng thái xử lý, widget CHƯA đổi.
    expect(screen.getByTestId("btn-check-in")).toBeDisabled();
    expect(onRefresh).not.toHaveBeenCalled();

    confirm({});
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    // ATT today được invalidate ⇒ tải lại, nút thành Check-out.
    await waitFor(() => expect(screen.getByTestId("btn-check-out")).toBeEnabled());
    expect(attendanceApi.getToday).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("btn-check-in")).toBeDisabled();
  });

  it("server từ chối ⇒ hiện đúng lý do server trả, widget KHÔNG tải lại", async () => {
    vi.mocked(attendanceApi.getToday).mockResolvedValue(today(true));
    vi.mocked(attendanceApi.checkIn).mockRejectedValue(
      new ApiError({ status: 422, kind: "BUSINESS_RULE", message: "Kỳ công tháng này đã khoá." }),
    );
    const { onRefresh } = renderCard([CHECK_IN, CHECK_OUT]);

    fireEvent.click(await screen.findByTestId("btn-check-in"));
    expect(await screen.findByText("Kỳ công tháng này đã khoá.")).toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(attendanceApi.getToday).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("btn-check-in")).toBeEnabled());
  });

  it("quick action bị tắt (thiếu quyền) ⇒ không có nút chấm công, không gọi ATT", () => {
    renderCard([
      { ...CHECK_IN, enabled: false, disabled_reason: "Thiếu quyền check-in:attendance" },
      { ...CHECK_OUT, enabled: false, disabled_reason: "Thiếu quyền check-out:attendance" },
    ]);
    expect(screen.queryByTestId("btn-check-in")).not.toBeInTheDocument();
    expect(attendanceApi.getToday).not.toHaveBeenCalled();
  });
});

describe("WidgetCard — trạng thái chấm công hôm nay đang tải / lỗi tải (S20-DASH-QUICKACTION-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("đang tải trạng thái hôm nay ⇒ skeleton, chưa có nút chấm công", () => {
    vi.mocked(attendanceApi.getToday).mockReturnValue(new Promise(() => undefined) as never);
    renderCard([CHECK_IN, CHECK_OUT]);
    expect(screen.getByTestId("att-actions-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("btn-check-in")).not.toBeInTheDocument();
  });

  it("lỗi tải ⇒ báo lý do + nút thử lại; thử lại tải lại trạng thái, KHÔNG tải lại widget", async () => {
    vi.mocked(attendanceApi.getToday)
      .mockRejectedValueOnce(new ApiError({ status: 503, kind: "NETWORK", message: "x" }))
      .mockResolvedValue(today(true));
    const { onRefresh } = renderCard([CHECK_IN, CHECK_OUT]);

    expect(
      await screen.findByText("Có lỗi khi tải trạng thái chấm công. Vui lòng thử lại."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("btn-check-in")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("att-actions-retry"));
    expect(await screen.findByTestId("btn-check-in")).toBeEnabled();
    expect(attendanceApi.getToday).toHaveBeenCalledTimes(2);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe("WidgetCard — payload quick action CŨ (API chưa deploy) vẫn dẫn đúng chỗ", () => {
  it("«Tạo task» với đích cũ /tasks/new ⇒ điều hướng tới /tasks/my-tasks?create=1", () => {
    renderCard([
      {
        ...CHECK_IN,
        action_code: "CREATE_TASK",
        label: "Tạo task",
        target_module: "TASK",
        method: "NAVIGATE",
        target_url: "/tasks/new",
        api_endpoint: null,
      },
    ]);
    fireEvent.click(screen.getByText("Tạo task"));
    expect(navigateMock).toHaveBeenCalledWith({ href: "/tasks/my-tasks?create=1" });
  });
});
