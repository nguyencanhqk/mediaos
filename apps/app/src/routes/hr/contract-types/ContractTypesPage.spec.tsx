import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@mediaos/web-core";
import { hrMasterDataApi } from "@mediaos/web-core";
import type { ContractTypeDto } from "@mediaos/contracts";
import { ContractTypesPage } from "./ContractTypesPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrMasterDataApi: {
      listContractTypes: vi.fn(),
      createContractType: vi.fn(),
      updateContractType: vi.fn(),
      deleteContractType: vi.fn(),
    },
  };
});
vi.mock("@/hooks/use-dirty-form-guard", () => ({ useDirtyFormGuard: () => {} }));

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

const CT: ContractTypeDto = {
  id: "ct-1",
  companyId: "co1",
  code: "FT",
  name: "Toàn thời gian",
  requiresEndDate: false,
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("ContractTypesPage (gate = manage:master-data)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(hrMasterDataApi.listContractTypes).mockResolvedValue([CT]);
  });

  it("shows forbidden and does not fetch without manage:master-data", () => {
    setCaps({ "read:employee": true });
    renderWithQuery(<ContractTypesPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(hrMasterDataApi.listContractTypes).not.toHaveBeenCalled();
  });

  it("renders contract-type list + requiresEndDate column with manage:master-data", async () => {
    setCaps({ "manage:master-data": true });
    renderWithQuery(<ContractTypesPage />);
    await waitFor(() => expect(screen.getByText("Toàn thời gian")).toBeInTheDocument());
    expect(screen.getByText("FT")).toBeInTheDocument();
    // requiresEndDate=false → "Không"
    expect(screen.getByText(/^không$/i)).toBeInTheDocument();
    expect(screen.getByText(/thêm loại hợp đồng/i)).toBeInTheDocument();
  });
});
