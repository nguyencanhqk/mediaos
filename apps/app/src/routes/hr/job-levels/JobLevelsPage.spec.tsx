import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@mediaos/web-core";
import { hrMasterDataApi } from "@mediaos/web-core";
import type { JobLevelDto } from "@mediaos/contracts";
import { JobLevelsPage } from "./JobLevelsPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrMasterDataApi: {
      listJobLevels: vi.fn(),
      createJobLevel: vi.fn(),
      updateJobLevel: vi.fn(),
      deleteJobLevel: vi.fn(),
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

const LEVEL: JobLevelDto = {
  id: "lvl-1",
  companyId: "co1",
  code: "L3",
  name: "Senior",
  rankOrder: 3,
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("JobLevelsPage (gate = manage:master-data)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(hrMasterDataApi.listJobLevels).mockResolvedValue([LEVEL]);
  });

  // Đọc job-levels PHẢI gate manage:master-data — KHÔNG có cặp view riêng.
  it("shows forbidden and does not fetch without manage:master-data", () => {
    setCaps({ "read:employee": true }); // có quyền khác nhưng KHÔNG manage:master-data
    renderWithQuery(<JobLevelsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(hrMasterDataApi.listJobLevels).not.toHaveBeenCalled();
  });

  it("renders list + shows add/edit/delete once user has manage:master-data", async () => {
    setCaps({ "manage:master-data": true });
    renderWithQuery(<JobLevelsPage />);
    await waitFor(() => expect(screen.getByText("Senior")).toBeInTheDocument());
    expect(screen.getByText("L3")).toBeInTheDocument();
    // 1 cặp DUY NHẤT gate tất cả → nút thao tác hiện luôn
    expect(screen.getByText(/thêm cấp bậc/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sửa$/i })).toBeInTheDocument();
  });

  it("creates a job level with the correct payload", async () => {
    setCaps({ "manage:master-data": true });
    vi.mocked(hrMasterDataApi.createJobLevel).mockResolvedValue({ ...LEVEL, id: "lvl-2" });
    const { container } = renderWithQuery(<JobLevelsPage />);
    await waitFor(() => expect(screen.getByText("Senior")).toBeInTheDocument());
    fireEvent.click(screen.getByText(/thêm cấp bậc/i));
    fireEvent.change(container.querySelector("#code") as HTMLInputElement, {
      target: { value: "L4" },
    });
    fireEvent.change(container.querySelector("#name") as HTMLInputElement, {
      target: { value: "Lead" },
    });
    fireEvent.submit(container.querySelector("#master-data-form") as HTMLFormElement);
    await waitFor(() => expect(hrMasterDataApi.createJobLevel).toHaveBeenCalledTimes(1));
    expect(vi.mocked(hrMasterDataApi.createJobLevel).mock.calls[0][0]).toMatchObject({
      code: "L4",
      name: "Lead",
    });
  });
});
