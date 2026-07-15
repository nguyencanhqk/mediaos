import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { authUsersApi, hrApi } from "@mediaos/web-core";
import type { AuthUserListItemDto } from "@mediaos/contracts";
import { LinkUserDialog } from "./LinkUserDialog";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    authUsersApi: { ...actual.authUsersApi, listUsers: vi.fn() },
    hrApi: { ...actual.hrApi, linkUser: vi.fn() },
  };
});

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithQuery(ui: React.ReactElement) {
  const client = makeQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const CANDIDATE: AuthUserListItemDto = {
  id: "user-002",
  email: "b@demo.local",
  fullName: "Trần Thị B",
  status: "active",
  lockedAt: null,
  lockedReason: null,
  lastLoginAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  hasEmployeeProfile: false,
};

describe("LinkUserDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Loading / empty / error state của danh sách candidate ──────────────────
  it("shows loading, then empty when the search returns no candidates", async () => {
    vi.mocked(authUsersApi.listUsers).mockResolvedValue({ users: [], total: 0 });
    renderWithQuery(<LinkUserDialog employeeId="emp-001" onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText("Không tìm thấy tài khoản phù hợp.")).toBeInTheDocument(),
    );
  });

  it("shows an error message when the candidate search fails", async () => {
    vi.mocked(authUsersApi.listUsers).mockRejectedValue(new Error("network"));
    renderWithQuery(<LinkUserDialog employeeId="emp-001" onClose={vi.fn()} />);
    await waitFor(() =>
      expect(
        screen.getByText("Không thể tải danh sách tài khoản. Vui lòng thử lại."),
      ).toBeInTheDocument(),
    );
  });

  // ── Search qua GET /auth/users?linkedProfile=false (KHÔNG endpoint mới) ────
  it("queries GET /auth/users with linkedProfile=false (only unlinked candidates)", async () => {
    vi.mocked(authUsersApi.listUsers).mockResolvedValue({ users: [CANDIDATE], total: 1 });
    renderWithQuery(<LinkUserDialog employeeId="emp-001" onClose={vi.fn()} />);
    await waitFor(() =>
      expect(authUsersApi.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ linkedProfile: false }),
      ),
    );
  });

  // ── Chọn candidate → submit gọi hrApi.linkUser đúng payload ─────────────────
  it("submits the selected user and closes on success", async () => {
    vi.mocked(authUsersApi.listUsers).mockResolvedValue({ users: [CANDIDATE], total: 1 });
    vi.mocked(hrApi.linkUser).mockResolvedValue({ id: "emp-001", userId: "user-002" });
    const onClose = vi.fn();
    renderWithQuery(<LinkUserDialog employeeId="emp-001" onClose={onClose} />);

    await screen.findByText("b@demo.local");
    const submitBtn = screen.getByTestId("account-link-submit");
    expect(submitBtn).toBeDisabled(); // chưa chọn → disabled

    fireEvent.click(screen.getByText("b@demo.local"));
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);
    await waitFor(() =>
      expect(hrApi.linkUser).toHaveBeenCalledWith("emp-001", { userId: "user-002" }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  // ── Lỗi submit: message vi RÕ theo tình huống (HR-ERR-028) ──────────────────
  it("shows a mapped Vietnamese message when link fails (user already linked)", async () => {
    vi.mocked(authUsersApi.listUsers).mockResolvedValue({ users: [CANDIDATE], total: 1 });
    const { ApiError } = await import("@mediaos/web-core");
    vi.mocked(hrApi.linkUser).mockRejectedValue(
      new ApiError(
        409,
        "RESOURCE-ERR-CONFLICT",
        "User is already linked to another active employee",
      ),
    );
    renderWithQuery(<LinkUserDialog employeeId="emp-001" onClose={vi.fn()} />);

    await screen.findByText("b@demo.local");
    fireEvent.click(screen.getByText("b@demo.local"));
    fireEvent.click(screen.getByTestId("account-link-submit"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Tài khoản này đã được liên kết với nhân viên khác.");
  });

  // ── Cancel không gọi mutation ────────────────────────────────────────────────
  it("calls onClose without mutating when Cancel is clicked", async () => {
    vi.mocked(authUsersApi.listUsers).mockResolvedValue({ users: [], total: 0 });
    const onClose = vi.fn();
    renderWithQuery(<LinkUserDialog employeeId="emp-001" onClose={onClose} />);
    fireEvent.click(screen.getByText("Hủy"));
    expect(onClose).toHaveBeenCalled();
    expect(hrApi.linkUser).not.toHaveBeenCalled();
  });
});
