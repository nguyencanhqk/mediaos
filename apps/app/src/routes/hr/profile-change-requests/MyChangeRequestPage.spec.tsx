// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, hrApi } from "@mediaos/web-core";
import type { ProfileChangeRequestListResponse } from "@mediaos/contracts";
import { MyChangeRequestPage } from "./MyChangeRequestPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrApi: {
      listMyProfileChangeRequests: vi.fn(),
      createProfileChangeRequest: vi.fn(),
    },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function setCapabilities(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "e@demo.local", fullName: "E", status: "Active", companyId: "co-1" },
  });
}

const LIST: ProfileChangeRequestListResponse = {
  items: [
    {
      id: "pcr-1",
      employeeId: "emp-1",
      employeeCode: "EMP0001",
      employeeFullName: "Nguyễn Văn A",
      status: "Pending",
      changedFields: ["phone"],
      reason: "Đổi SĐT",
      submittedAt: "2026-07-01T00:00:00.000Z",
      reviewedAt: null,
      reviewedByName: null,
      createdAt: "2026-07-01T00:00:00.000Z",
    },
  ],
  meta: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
};

describe("MyChangeRequestPage", () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
    vi.clearAllMocks();
  });

  it("shows loading state (table renders while fetching)", () => {
    setCapabilities({ "create:profile-change-request": true });
    vi.mocked(hrApi.listMyProfileChangeRequests).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<MyChangeRequestPage />);
    expect(document.querySelector("table")).toBeInTheDocument();
  });

  it("shows empty state when no own requests", async () => {
    setCapabilities({ "create:profile-change-request": true });
    vi.mocked(hrApi.listMyProfileChangeRequests).mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
    });
    renderWithQuery(<MyChangeRequestPage />);
    await waitFor(() => expect(screen.getByText(/chưa có yêu cầu nào/i)).toBeInTheDocument());
  });

  it("shows error state when the list call fails", async () => {
    setCapabilities({ "create:profile-change-request": true });
    vi.mocked(hrApi.listMyProfileChangeRequests).mockRejectedValue(new Error("boom"));
    renderWithQuery(<MyChangeRequestPage />);
    await waitFor(() => expect(screen.getByText(/không thể tải danh sách/i)).toBeInTheDocument());
  });

  it("renders own requests on success", async () => {
    setCapabilities({ "create:profile-change-request": true });
    vi.mocked(hrApi.listMyProfileChangeRequests).mockResolvedValue(LIST);
    renderWithQuery(<MyChangeRequestPage />);
    await waitFor(() => expect(screen.getByText(/chờ duyệt/i)).toBeInTheDocument());
  });

  // ── DENY-PATH: no create:profile-change-request → "Gửi yêu cầu mới" hidden ──
  it("hides the 'Gửi yêu cầu mới' button when the user lacks create:profile-change-request", async () => {
    setCapabilities({}); // useCan → false
    vi.mocked(hrApi.listMyProfileChangeRequests).mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
    });
    renderWithQuery(<MyChangeRequestPage />);
    await waitFor(() => expect(screen.getByText(/chưa có yêu cầu nào/i)).toBeInTheDocument());
    expect(screen.queryByText(/gửi yêu cầu mới/i)).not.toBeInTheDocument();
  });

  // ── Happy path: open form, select a field, submit ────────────────────────
  it("submits a new change request via the dialog form", async () => {
    setCapabilities({ "create:profile-change-request": true });
    vi.mocked(hrApi.listMyProfileChangeRequests).mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
    });
    vi.mocked(hrApi.createProfileChangeRequest).mockResolvedValue({
      id: "pcr-9",
      status: "Pending",
    });

    renderWithQuery(<MyChangeRequestPage />);
    await waitFor(() => expect(screen.getByText(/gửi yêu cầu mới/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/gửi yêu cầu mới/i));

    const phoneCheckbox = await screen.findByRole("checkbox", { name: /số điện thoại/i });
    fireEvent.click(phoneCheckbox);

    const valueInput = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>("#nv-phone");
      expect(el).toBeInTheDocument();
      return el!;
    });
    fireEvent.change(valueInput, { target: { value: "0911111111" } });

    fireEvent.click(screen.getByRole("button", { name: /^gửi yêu cầu$/i }));

    await waitFor(() =>
      expect(hrApi.createProfileChangeRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          changedFields: ["phone"],
          newValues: { phone: "0911111111" },
        }),
      ),
    );
  });
});
