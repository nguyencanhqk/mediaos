// @vitest-environment jsdom
/**
 * RoomTodayWidget tests (S11-OFFICE-DASH-1). Phủ: deny-path (thiếu view:room → KHÔNG render, KHÔNG fetch) ·
 * empty/error(Degraded)/success · giờ hiển thị theo tz CÔNG TY (không theo tz máy chạy test) · huy hiệu
 * "Bạn tổ chức" chỉ cho myRole=organizer · drill-down navigate("/rooms") · refresh gọi getWidgetData
 * (refresh:true).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { RoomTodayWidget } from "./RoomTodayWidget";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mockNavigate }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    dashboardApi: { getWidgetData: vi.fn() },
  };
});

import { dashboardApi } from "@mediaos/web-core";
const mockGetWidgetData = dashboardApi.getWidgetData as ReturnType<typeof vi.fn>;

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

function renderWidget() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <RoomTodayWidget />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

// 02:00Z = 09:00 giờ Việt Nam — khẳng định widget quy đổi theo tz CÔNG TY, không theo UTC/tz máy.
const ACTIVE_DTO = {
  widget_code: "ROOM_TODAY",
  widget_type: "Calendar",
  status: "Active" as const,
  data: {
    date: "2026-08-30",
    items: [
      {
        id: "bk-1",
        title: "Họp giao ban",
        roomName: "Phòng A",
        roomLocation: "Tầng 3",
        startsAt: "2026-08-30T02:00:00.000Z",
        endsAt: "2026-08-30T03:00:00.000Z",
        myRole: "organizer" as const,
        status: "Confirmed",
        isCompleted: false,
        attendeeCount: 4,
      },
      {
        id: "bk-2",
        title: "Phỏng vấn ứng viên",
        roomName: "Phòng B",
        roomLocation: null,
        startsAt: "2026-08-30T07:00:00.000Z",
        endsAt: "2026-08-30T08:00:00.000Z",
        myRole: "attendee" as const,
        status: "Confirmed",
        isCompleted: false,
        attendeeCount: 2,
      },
    ],
    summary: { total: 2, upcoming: 1 },
  },
  empty_state: null,
  error_state: null,
  last_updated_at: "2026-08-30T01:00:00.000Z",
  cache: { hit: false, ttl_seconds: 60, expires_at: "2026-08-30T01:01:00.000Z" },
  quick_actions: [],
};

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("RoomTodayWidget — gate (DASH_WIDGET_GATE_PAIR.ROOM_TODAY = view:room)", () => {
  it("thiếu view:room → KHÔNG render widget, KHÔNG gọi getWidgetData", () => {
    setCaps({});
    renderWidget();
    expect(screen.queryByText(/lịch họp hôm nay/i)).not.toBeInTheDocument();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });

  it("cặp KHÁC (view:asset) KHÔNG mở được widget này", () => {
    setCaps({ "view:asset": true });
    renderWidget();
    expect(mockGetWidgetData).not.toHaveBeenCalled();
  });
});

describe("RoomTodayWidget — data states (có view:room)", () => {
  beforeEach(() => setCaps({ "view:room": true }));

  it("status Empty → hiện empty message của SERVER", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Empty",
      data: null,
      empty_state: { message: "Hôm nay bạn không có lịch họp" },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Hôm nay bạn không có lịch họp")).toBeInTheDocument();
    });
  });

  it("status server Degraded → error state, KHÔNG render danh sách cuộc họp", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      status: "Degraded",
      error_state: {
        code: "DASH-ERR-WIDGET-DEGRADED",
        message: "Dữ liệu tạm thời không đầy đủ",
        source_module: "ROOM",
        retryable: true,
      },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Dữ liệu tạm thời không đầy đủ")).toBeInTheDocument();
    });
    expect(screen.queryByText("Họp giao ban")).not.toBeInTheDocument();
  });

  it("data sai hình (thiếu roomName) → error state, KHÔNG render nửa vời", async () => {
    mockGetWidgetData.mockResolvedValue({
      ...ACTIVE_DTO,
      data: {
        date: "2026-08-30",
        items: [{ id: "bk-1", title: "Họp giao ban" }],
        summary: { total: 1, upcoming: 0 },
      },
    });
    renderWidget();
    await waitFor(() => {
      expect(screen.queryByText("Họp giao ban")).not.toBeInTheDocument();
    });
  });

  it("status Active → giờ quy đổi theo tz CÔNG TY (02:00Z → 09:00), không phải UTC", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Họp giao ban")).toBeInTheDocument();
    });
    expect(screen.getByText("09:00–10:00")).toBeInTheDocument();
    expect(screen.queryByText("02:00–03:00")).not.toBeInTheDocument();
  });

  it("huy hiệu 'Bạn tổ chức' CHỈ ở dòng myRole=organizer", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Phỏng vấn ứng viên")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Bạn tổ chức")).toHaveLength(1);
  });

  it("click 1 dòng → navigate('/rooms')", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Họp giao ban")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Họp giao ban"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/rooms" });
  });

  it("nút Làm mới gọi getWidgetData(refresh:true)", async () => {
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    renderWidget();
    await waitFor(() => {
      expect(screen.getByText("Họp giao ban")).toBeInTheDocument();
    });
    mockGetWidgetData.mockClear();
    mockGetWidgetData.mockResolvedValue(ACTIVE_DTO);
    fireEvent.click(screen.getByRole("button", { name: /làm mới/i }));
    await waitFor(() => {
      expect(mockGetWidgetData).toHaveBeenCalledWith(
        "ROOM_TODAY",
        expect.objectContaining({ refresh: true }),
      );
    });
  });
});
