import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, contractsApi } from "@mediaos/web-core";
import type { EmployeeContractDto } from "@mediaos/contracts";
import { ContractsPage } from "./ContractsPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    contractsApi: { listContracts: vi.fn() },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

const CONTRACT: EmployeeContractDto = {
  id: "c-1",
  companyId: "co1",
  employeeId: "emp-1",
  contractTypeId: "ct-1",
  contractCode: "HD-001",
  title: "Hợp đồng chính thức",
  startDate: "2026-01-01",
  endDate: "2027-01-01",
  signedDate: "2025-12-20",
  status: "Active",
  isPrimary: true,
  fileId: null,
  note: null,
  expiringSoon: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("ContractsPage (gate = view:contract)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(contractsApi.listContracts).mockResolvedValue([CONTRACT]);
  });

  it("shows forbidden and does not fetch without view:contract", () => {
    setCaps({ "read:employee": true });
    renderWithQuery(<ContractsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(contractsApi.listContracts).not.toHaveBeenCalled();
  });

  it("renders contract list with view:contract", async () => {
    setCaps({ "view:contract": true });
    renderWithQuery(<ContractsPage />);
    await waitFor(() => expect(screen.getByText("HD-001")).toBeInTheDocument());
    expect(screen.getByText("Hợp đồng chính thức")).toBeInTheDocument();
    expect(contractsApi.listContracts).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20 }),
    );
  });

  it("shows empty state when no contracts match filters", async () => {
    setCaps({ "view:contract": true });
    vi.mocked(contractsApi.listContracts).mockResolvedValue([]);
    renderWithQuery(<ContractsPage />);
    await waitFor(() => expect(screen.getByText(/không có hợp đồng/i)).toBeInTheDocument());
  });
});
