// @vitest-environment jsdom
/**
 * [leave-flow-smoke] S3-QA-2 — Frontend smoke happy-path cho module LEAVE (QA-03, IMPLEMENTATION-05 §17.3).
 *
 * Đi CẢ hành trình tự-phục-vụ + phê duyệt như MỘT mạch: guard (chưa đăng nhập chặn) → xem số dư phép →
 * tạo đơn + GỬI (Draft→Pending, submitNow=true) → manager DUYỆT. Đây là ALTITUDE khác với các spec per-page
 * (MyLeaveBalancePage.spec / CreateLeaveRequestPage.spec / LeaveApprovalPage.spec) — những spec đó phủ kiệt
 * loading/empty/error/deny từng chân RIÊNG LẺ. Spec này chỉ CHỨNG MINH các chân happy-path đã WIRED với nhau:
 * regression làm gãy luồng (nhưng từng page vẫn xanh khi đứng một mình) vẫn bị bắt. Nó CỐ Ý không lặp lại
 * ma trận trạng thái đã có ở per-page spec (KHÔNG nhân bản — chống trôi/DRY).
 *
 * Quyền: dùng CẶP ENGINE SEED THẬT (LEAVE_ENGINE_PAIRS, mig 0455) qua store.capabilities + useCan THẬT của
 * web-core — KHÔNG hard-code role, KHÔNG so sánh `role === ...`. Masking/gate thật vẫn ở server; đây chỉ là
 * tầng hiển thị.
 *
 * Chân phủ:
 *   guard      chưa đăng nhập → ProtectedRoute chặn nội dung LEAVE + phát redirect (login gate)
 *   balance    view-own:leave-balance → MyLeaveBalancePage render số dư
 *   create     create:leave → CreateLeaveRequestPage submit "Gửi đơn" → createDraft(submitNow=true) (Draft→Pending)
 *   approve    view:leave + approve:leave → LeaveApprovalPage duyệt 1 đơn Pending → approveRequest, dialog đóng
 *   logout     logout → auth store + capabilities cleared (query-cache clear được wire vào logout ở web-core)
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, leaveApi, type RouteMeta } from "@mediaos/web-core";
import type {
  LeaveBalanceView,
  LeaveTypeView,
  LeaveCalculateResponse,
  LeaveRequestDetailView,
  LeaveManagementListResponse,
} from "@mediaos/contracts";
import { ProtectedRoute } from "@/layouts/protected/ProtectedRoute";
import { MyLeaveBalancePage } from "@/routes/leave/MyLeaveBalancePage";
import { CreateLeaveRequestPage } from "@/routes/leave/CreateLeaveRequestPage";
import { LeaveApprovalPage } from "@/routes/leave/LeaveApprovalPage";
import { LEAVE_ENGINE_PAIRS, LEAVE_PERMS } from "@/routes/leave/constants";

// Giữ store/useCan/leaveKeys/leaveInvalidation/ApiError THẬT từ web-core; CHỈ stub bề mặt leaveApi các page gọi.
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    leaveApi: {
      getMyBalances: vi.fn(),
      listTypes: vi.fn().mockResolvedValue([]),
      calculate: vi.fn(),
      createDraft: vi.fn(),
      listRequests: vi.fn(),
      approveRequest: vi.fn(),
      rejectRequest: vi.fn(),
    },
  };
});

// Dirty-guard của form kéo state layout/router (không có RouterProvider ở đây) → stub no-op.
vi.mock("@/hooks/use-dirty-form-guard", () => ({ useDirtyFormGuard: () => {} }));

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

// action:resourceType key cho store.capabilities — dựng TỪ cặp engine seed thật (KHÔNG magic string).
const capKey = (p: { action: string; resourceType: string }): string =>
  `${p.action}:${p.resourceType}`;

/**
 * Bộ capability cho toàn hành trình — CẶP SEED THẬT (mig 0455 / LEAVE_ENGINE_PAIRS), KHÔNG role hard-code:
 *  - view-own:leave-balance → xem số dư của mình
 *  - create:leave           → tạo + gửi đơn (submitNow trong cùng tx do server)
 *  - view:leave             → danh sách đơn chờ duyệt (server scope Team/Company)
 *  - approve:leave          → duyệt đơn Pending
 */
const FLOW_CAPS: Record<string, boolean> = {
  [capKey(LEAVE_ENGINE_PAIRS.VIEW_OWN_BALANCE)]: true,
  [capKey(LEAVE_ENGINE_PAIRS.CREATE_REQUEST)]: true,
  [capKey(LEAVE_ENGINE_PAIRS.VIEW_REQUEST)]: true,
  [capKey(LEAVE_ENGINE_PAIRS.APPROVE_REQUEST)]: true,
};

function login(capabilities: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities,
    user: {
      id: "u1",
      email: "user@demo.local",
      fullName: "Người dùng",
      status: "Active",
      companyId: "co-1",
    },
    username: "user@demo.local",
    accessToken: "a",
    refreshToken: null,
  });
}

// Guard leg dùng route số-dư; requiredAnyPermissions = mã quyền (hằng chung, KHÔNG magic string).
const LEAVE_BALANCE_META: RouteMeta = {
  routeKey: "leave.balance",
  path: "/leave/me/balance",
  layout: "MODULE_WORKSPACE",
  titleKey: "routeTitle.leaveBalance",
  requiredAnyPermissions: [LEAVE_PERMS.BALANCE.VIEW_OWN],
};

// ── Fixtures (render những gì server trả — client không tự bịa field ẩn) ────────

const BALANCE: LeaveBalanceView = {
  id: "bal-1",
  leaveType: { id: "lt-1", code: "ANNUAL", name: "Nghỉ phép năm" },
  periodYear: 2026,
  openingBalance: 12,
  usedDays: 2,
  reservedDays: 1,
  adjustedDays: 0,
  remainingDays: 10,
  unit: "Day",
};

const LEAVE_TYPE: LeaveTypeView = {
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
};

const PREVIEW: LeaveCalculateResponse = {
  calculated_days: 1,
  calculated_hours: 8,
  is_balance_required: true,
  balance: { remaining_days: 10, requested_days: 1, after_remaining_days: 9, is_enough: true },
  days: [],
  warnings: [],
};

function makeDetail(overrides: Partial<LeaveRequestDetailView>): LeaveRequestDetailView {
  return {
    id: "req-new",
    leaveTypeId: "lt-1",
    leaveTypeCode: "ANNUAL",
    leaveTypeName: "Nghỉ phép năm",
    startDate: "2026-08-10",
    endDate: "2026-08-10",
    durationType: "FullDay",
    totalDays: 1,
    totalHours: null,
    status: "Pending",
    reason: null,
    balanceEffectStatus: null,
    submittedAt: "2026-08-01T02:00:00.000Z",
    createdAt: "2026-08-01T01:50:00.000Z",
    employeeId: null,
    leavePolicyId: null,
    halfDaySession: null,
    startTime: null,
    endTime: null,
    handoverNote: null,
    contactDuringLeave: null,
    cancelReason: null,
    cancelledAt: null,
    days: [],
    approvals: [],
    ...overrides,
  };
}

// 1 đơn Pending cho mặt phê duyệt (LeaveManagementListItemView + envelope meta).
const PENDING_LIST: LeaveManagementListResponse = {
  items: [
    {
      id: "req-1",
      leaveTypeId: "lt-1",
      leaveTypeCode: "ANNUAL",
      leaveTypeName: "Nghỉ phép năm",
      startDate: "2026-07-10",
      endDate: "2026-07-11",
      durationType: "FullDay",
      totalDays: 2,
      totalHours: null,
      status: "Pending",
      reason: "Về quê",
      balanceEffectStatus: null,
      submittedAt: "2026-07-01T03:00:00.000Z",
      createdAt: "2026-07-01T02:50:00.000Z",
      requester: {
        userId: "u-req",
        employeeCode: "EMP001",
        fullName: "Nguyễn Văn A",
        department: "Kỹ thuật",
      },
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
    },
  ],
  meta: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
};

describe("LEAVE flow smoke (§17.3 journey spine)", () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
    vi.clearAllMocks();
  });

  it("guard: chưa đăng nhập → ProtectedRoute chặn nội dung LEAVE + phát redirect (login gate)", () => {
    const onRedirect = vi.fn();
    render(
      <ProtectedRoute meta={LEAVE_BALANCE_META} onRedirect={onRedirect}>
        <div>guarded-leave-content</div>
      </ProtectedRoute>,
    );
    expect(onRedirect).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("guarded-leave-content")).not.toBeInTheDocument();
  });

  it("capable user: xem số dư → tạo + GỬI đơn (Draft→Pending) → DUYỆT đơn Pending", async () => {
    login(FLOW_CAPS);

    // — số dư phép — (view-own:leave-balance)
    vi.mocked(leaveApi.getMyBalances).mockResolvedValue([BALANCE]);
    const balance = renderWithQuery(<MyLeaveBalancePage />);
    await waitFor(() => expect(screen.getByText("Nghỉ phép năm")).toBeInTheDocument());
    expect(screen.getByText(String(BALANCE.remainingDays))).toBeInTheDocument();
    balance.unmount();

    // — tạo đơn + GỬI — (create:leave; submitNow=true ⇒ server chạy nhánh submit Draft→Pending cùng tx)
    vi.mocked(leaveApi.listTypes).mockResolvedValue([LEAVE_TYPE]);
    vi.mocked(leaveApi.calculate).mockResolvedValue(PREVIEW);
    vi.mocked(leaveApi.createDraft).mockResolvedValue(
      makeDetail({ id: "req-new", status: "Pending" }),
    );
    const create = renderWithQuery(<CreateLeaveRequestPage />);

    // Chờ option loại nghỉ (xác nhận listTypes đã resolve → "lt-1" là <option> hợp lệ) trước khi chọn.
    await waitFor(() => screen.getByRole("option", { name: /nghỉ phép năm/i }));
    const [typeSelect, durationSelect] = screen.getAllByRole("combobox");
    fireEvent.change(typeSelect, { target: { value: "lt-1" } });
    fireEvent.change(durationSelect, { target: { value: "FullDay" } });
    fireEvent.change(screen.getByLabelText("Ngày bắt đầu"), { target: { value: "2026-08-10" } });
    fireEvent.change(screen.getByLabelText("Ngày kết thúc"), { target: { value: "2026-08-10" } });

    // "Gửi đơn" = submitNow=true (KHÁC "Lưu nháp"). Chứng minh chân create→submit wired page→form→api.
    fireEvent.click(screen.getByRole("button", { name: /gửi đơn/i }));
    await waitFor(() =>
      expect(leaveApi.createDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          leaveTypeId: "lt-1",
          startDate: "2026-08-10",
          endDate: "2026-08-10",
          submitNow: true,
        }),
      ),
    );
    create.unmount();

    // — phê duyệt — (view:leave list + approve:leave action)
    vi.mocked(leaveApi.listTypes).mockResolvedValue([]); // filter loại nghỉ (mặt duyệt)
    vi.mocked(leaveApi.listRequests).mockResolvedValue(PENDING_LIST);
    vi.mocked(leaveApi.approveRequest).mockResolvedValue(
      makeDetail({ id: "req-1", status: "Approved" }),
    );
    const approval = renderWithQuery(<LeaveApprovalPage />);

    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Xem chi tiết" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("btn-open-approve"));
    await waitFor(() => expect(screen.getByTestId("btn-confirm-approve")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("btn-confirm-approve"));

    // approveRequest(id, note||undefined) — note rỗng ⇒ undefined; dialog đóng sau success.
    await waitFor(() => expect(leaveApi.approveRequest).toHaveBeenCalledWith("req-1", undefined));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    approval.unmount();
  });

  it("logout: xóa auth store + capabilities (cache-clear được wire vào logout ở web-core)", () => {
    login(FLOW_CAPS);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    useAuthStore.getState().logout();

    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.user).toBeNull();
    expect(s.capabilities).toEqual({});
  });
});
