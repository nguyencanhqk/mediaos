import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@mediaos/web-core";
import { hrMasterDataApi } from "@mediaos/web-core";
import type { PositionDto } from "@mediaos/contracts";
import { PositionsPage } from "./PositionsPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrMasterDataApi: {
      listPositions: vi.fn(),
      listDepartments: vi.fn().mockResolvedValue([]),
      createPosition: vi.fn(),
      updatePosition: vi.fn(),
      deletePosition: vi.fn(),
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

const POS: PositionDto = {
  id: "pos-1",
  companyId: "co1",
  orgUnitId: null,
  orgUnitName: null,
  name: "Kỹ sư Backend",
  code: "BE",
  level: 3,
  description: null,
  defaultRoleId: null,
  defaultRoleName: null,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("PositionsPage", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(hrMasterDataApi.listPositions).mockResolvedValue([POS]);
  });

  it("shows forbidden and does not fetch without read:position", () => {
    setCaps({});
    renderWithQuery(<PositionsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(hrMasterDataApi.listPositions).not.toHaveBeenCalled();
  });

  it("renders position list with read:position", async () => {
    setCaps({ "read:position": true });
    renderWithQuery(<PositionsPage />);
    await waitFor(() => expect(screen.getByText("Kỹ sư Backend")).toBeInTheDocument());
    expect(screen.getByText("BE")).toBeInTheDocument();
  });

  it("hides delete button without delete:position", async () => {
    setCaps({ "read:position": true });
    renderWithQuery(<PositionsPage />);
    await waitFor(() => expect(screen.getByText("Kỹ sư Backend")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^xoá$/i })).not.toBeInTheDocument();
  });

  it("deletes a position when user has delete:position", async () => {
    setCaps({ "read:position": true, "delete:position": true });
    vi.mocked(hrMasterDataApi.deletePosition).mockResolvedValue(undefined);
    renderWithQuery(<PositionsPage />);
    await waitFor(() => expect(screen.getByText("Kỹ sư Backend")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^xoá$/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^xoá$/i }));
    await waitFor(() => expect(hrMasterDataApi.deletePosition).toHaveBeenCalledWith("pos-1"));
  });
});
